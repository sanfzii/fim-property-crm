// Lokasi: src/modules/identity/profiles/profiles.service.ts
// Level Topologis: L1 (Service Layer untuk Modul B — User Management)
// Dependency: Hanya mengimpor L0 (server.ts, admin.ts, app-error.ts, audit.sink.ts)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { AppError, translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { serverLogger } from '@/lib/logger/server-logger';
import { AuditSink } from '@/modules/shared/audit/audit.sink';
import type { AuthenticatedUserContext } from '@/types/database.types';
import type { z } from 'zod';
import type {
  createStaffUserSchema,
  updateOwnProfileSchema,
  updateStaffStatusOrRoleSchema,
} from './profiles.schemas';

export const ProfilesService = {
  /**
   * Mengambil direktori staf yang aman (v_staff_directory) untuk dropdown & referensi katalog.
   */
  async listStaffDirectory() {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('v_staff_directory')
      .select('*')
      .order('full_name', { ascending: true });

    if (error) {
      throw translateDatabaseOrRpcError(error);
    }
    return data ?? [];
  },

  /**
   * Membuat akun staf baru di auth.users dan public.profiles (Khusus ADMIN).
   */
  async createStaffUser(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof createStaffUserSchema>
  ) {
    let supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;

    try {
      supabaseAdmin = createSupabaseAdminClient();
    } catch (error) {
      serverLogger.error(
        'Konfigurasi Supabase Admin tidak tersedia untuk pembuatan staf',
        error,
        {
          module: 'ProfilesService',
          action: 'createStaffUser',
        }
      );

      throw new AppError({
        message:
          'Konfigurasi server untuk menambah staf belum lengkap. Pastikan SUPABASE_SERVICE_ROLE_KEY sudah diatur pada environment deployment.',
        category: 'DATABASE_ERROR',
        code: 'ADMIN_CLIENT_CONFIGURATION_FAILED',
        statusCode: 500,
      });
    }

    // 1. Daftarkan kredensial ke Supabase Auth
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: input.email,
        password: input.initialPassword,
        email_confirm: true,
      });

    if (authError || !authData.user) {
      const authErrorCode = authError?.code?.toLowerCase() ?? '';
      const authErrorMessage = authError?.message?.toLowerCase() ?? '';
      const isDuplicateEmail =
        authErrorCode === 'email_exists' ||
        authErrorMessage.includes('already registered') ||
        authErrorMessage.includes('already exists');
      const isInvalidCredential =
        authErrorCode === 'email_address_invalid' ||
        authErrorCode === 'weak_password' ||
        authErrorMessage.includes('password') ||
        authErrorMessage.includes('email');

      throw new AppError({
        message: isDuplicateEmail
          ? 'Email kerja tersebut sudah terdaftar. Gunakan email lain atau periksa daftar staf.'
          : isInvalidCredential
            ? 'Email atau password awal tidak dapat digunakan. Periksa kembali data yang dimasukkan.'
            : 'Kredensial akun staf gagal dibuat. Silakan coba lagi atau hubungi Administrator.',
        category: isDuplicateEmail ? 'CONFLICT_ERROR' : 'VALIDATION_ERROR',
        code: isDuplicateEmail
          ? 'DUPLICATE_STAFF_EMAIL'
          : 'AUTH_USER_CREATION_FAILED',
        statusCode: isDuplicateEmail ? 409 : 400,
      });
    }

    const newUserId = authData.user.id;

    let profileCreated = false;

    try {
      // 2. Simpan baris profil ke tabel public.profiles
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: newUserId,
          full_name: input.fullName,
          email: input.email,
          phone: input.phone,
          system_role: input.systemRole,
          is_active: true,
        })
        .select('*')
        .single();

      if (profileError || !profile) {
        throw translateDatabaseOrRpcError(
          profileError ?? { message: 'Profil staf gagal dibuat.' }
        );
      }

      profileCreated = true;

      // 3. Catat ke Audit Log
      await AuditSink.record({
        actorUserId: actor.userId,
        actorRole: actor.systemRole,
        actionType: 'STAFF_USER_CREATED',
        entityTable: 'profiles',
        entityId: newUserId,
        oldValues: null,
        newValues: {
          full_name: profile.full_name,
          email: profile.email,
          system_role: profile.system_role,
          is_active: profile.is_active,
        },
        reason: 'Pembuatan akun staf internal baru oleh Admin.',
      });

      return profile;
    } catch (error) {
      // Compensating rollback menjaga Auth, profiles, dan audit tetap konsisten
      // jika salah satu langkah setelah pembuatan kredensial gagal.
      if (profileCreated) {
        const { error: profileRollbackError } = await supabaseAdmin
          .from('profiles')
          .delete()
          .eq('id', newUserId);

        if (profileRollbackError) {
          serverLogger.error(
            'Gagal membersihkan profil staf setelah pembuatan akun gagal',
            profileRollbackError,
            {
              module: 'ProfilesService',
              action: 'createStaffUser',
              entityId: newUserId,
            }
          );
        }
      }

      const { error: authRollbackError } =
        await supabaseAdmin.auth.admin.deleteUser(newUserId);

      if (authRollbackError) {
        serverLogger.error(
          'Gagal membersihkan kredensial Auth setelah pembuatan staf gagal',
          authRollbackError,
          {
            module: 'ProfilesService',
            action: 'createStaffUser',
            entityId: newUserId,
          }
        );
      }

      throw error;
    }
  },

  /**
   * Memperbarui status keaktifan atau role staf oleh Admin.
   * Menolak penonaktifan (is_active = false) jika staf masih memegang Lead aktif atau Booking berjalan,
   * serta menyinkronkan status ban ke Supabase Auth agar sesi lama langsung dicabut (File 03 v1.1).
   */
  async updateStaffStatusOrRole(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof updateStaffStatusOrRoleSchema>
  ) {
    const supabase = await createSupabaseServerClient();
    const supabaseAdmin = createSupabaseAdminClient();

    const { data: existing, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', input.profileId)
      .single();

    if (fetchError || !existing) {
      throw translateDatabaseOrRpcError(fetchError);
    }

    if (input.profileId === actor.userId && input.isActive === false) {
      throw new AppError({
        message: 'Anda tidak dapat menonaktifkan akun Admin Anda sendiri yang sedang digunakan.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'SELF_DEACTIVATION_BLOCKED',
        statusCode: 422,
      });
    }

    if (
      input.profileId === actor.userId &&
      input.systemRole &&
      input.systemRole !== existing.system_role
    ) {
      throw new AppError({
        message: 'Anda tidak dapat mengubah role akun Admin Anda sendiri yang sedang aktif.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'SELF_ROLE_CHANGE_BLOCKED',
        statusCode: 422,
      });
    }

    // Kondisi Khusus Modul B: Jika akan dinonaktifkan, pastikan tidak memegang Lead aktif maupun Booking berjalan
    if (input.isActive === false && existing.is_active === true) {
      const { count: activeLeadsCount, error: leadCountErr } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_sales_id', input.profileId)
        .not('pipeline_stage', 'in', '("CLOSED_WON","CLOSED_LOST")');

      if (leadCountErr) {
        throw translateDatabaseOrRpcError(leadCountErr);
      }

      if ((activeLeadsCount ?? 0) > 0) {
        throw new AppError({
          message: `Staf ini masih memegang ${activeLeadsCount} Lead aktif. Pindahkan (reassign) seluruh Lead aktifnya terlebih dahulu sebelum menonaktifkan akun.`,
          category: 'BUSINESS_RULE_ERROR',
          code: 'ACTIVE_LEADS_MUST_BE_REASSIGNED_FIRST',
          statusCode: 422,
        });
      }

      const { count: activeBookingsCount, error: bookingCountErr } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('current_sales_id', input.profileId)
        .in('status', ['PENDING_FEE', 'ACTIVE']);

      if (bookingCountErr) {
        throw translateDatabaseOrRpcError(bookingCountErr);
      }

      if ((activeBookingsCount ?? 0) > 0) {
        throw new AppError({
          message: `Staf ini masih menangani ${activeBookingsCount} transaksi Booking aktif. Alihkan kepemilikan Lead/Booking terkait terlebih dahulu sebelum menonaktifkan akun.`,
          category: 'BUSINESS_RULE_ERROR',
          code: 'ACTIVE_BOOKINGS_MUST_BE_REASSIGNED_FIRST',
          statusCode: 422,
        });
      }
    }

    const nextIsActive = input.isActive ?? existing.is_active;

    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: input.fullName ?? existing.full_name,
        phone: input.phone ?? existing.phone,
        system_role: input.systemRole ?? existing.system_role,
        is_active: nextIsActive,
      })
      .eq('id', input.profileId)
      .select('*')
      .single();

    if (updateError || !updated) {
      throw translateDatabaseOrRpcError(updateError);
    }

    // Sinkronisasi status Ban di Supabase Auth (File 03 v1.1 Bag. 5 & Bag. 9)
    if (nextIsActive !== existing.is_active) {
      const { error: authBanErr } = await supabaseAdmin.auth.admin.updateUserById(
        input.profileId,
        {
          ban_duration: nextIsActive ? 'none' : '876000h', // ~100 tahun jika nonaktif
        }
      );

      if (authBanErr) {
        // Compensating restore agar status profiles dan auth.users tetap sinkron
        await supabase
          .from('profiles')
          .update({ is_active: existing.is_active })
          .eq('id', input.profileId);

        serverLogger.error('Failed to sync Supabase Auth ban state with profile status', authBanErr, {
          module: 'ProfilesService',
          action: 'updateStaffStatusOrRole',
          entityId: input.profileId,
        });

        throw new AppError({
          message: 'Gagal menyinkronkan status penguncian sesi pada layanan autentikasi.',
          category: 'DATABASE_ERROR',
          code: 'AUTH_BAN_SYNC_FAILED',
          statusCode: 500,
        });
      }
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'STAFF_PROFILE_UPDATED',
      entityTable: 'profiles',
      entityId: updated.id,
      oldValues: {
        full_name: existing.full_name,
        system_role: existing.system_role,
        is_active: existing.is_active,
      },
      newValues: {
        full_name: updated.full_name,
        system_role: updated.system_role,
        is_active: updated.is_active,
      },
      reason: input.reason,
    });

    return updated;
  },

  /**
   * Memperbarui nama lengkap & nomor telepon milik pengguna sendiri (Whitelist field ketat).
   */
  async updateOwnProfile(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof updateOwnProfileSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name: input.fullName,
        phone: input.phone,
      })
      .eq('id', actor.userId)
      .select('id, full_name, email, phone, system_role, is_active')
      .single();

    if (error || !data) {
      throw translateDatabaseOrRpcError(error);
    }

    return data;
  },
};
