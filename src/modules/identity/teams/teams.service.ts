// Lokasi: src/modules/identity/teams/teams.service.ts
// Level Topologis: L2 (Service Layer untuk Modul C — Team Management)
// Dependency: Mengimpor L0 & L1 (profiles)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AppError, translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { AuditSink } from '@/modules/shared/audit/audit.sink';
import type { AuthenticatedUserContext } from '@/types/database.types';
import type { z } from 'zod';
import type { assignTeamMemberSchema, createOrUpdateTeamSchema } from './teams.schemas';

export const TeamsService = {
  async createTeam(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof createOrUpdateTeamSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from('teams')
      .insert({
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        is_active: input.isActive,
        created_by: actor.userId,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw translateDatabaseOrRpcError(error);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'TEAM_CREATED',
      entityTable: 'teams',
      entityId: data.id,
      newValues: data,
      reason: `Pembuatan tim penjualan ${data.name}`,
    });

    return data;
  },

  /**
   * Menempatkan atau memindahkan Supervisor / Sales ke dalam Tim dengan menjaga histori
   * keanggotaan masa lalu (team_memberships.left_at) dan memvalidasi CST-01 & CST-02.
   */
  async assignMemberToTeam(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof assignTeamMemberSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    // 1. Validasi bahwa Tim tujuan ada dan berstatus aktif (File 03 v1.1: get_current_user_active_team_id memeriksa teams.is_active)
    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .select('id, name, is_active')
      .eq('id', input.teamId)
      .single();

    if (teamErr || !team || !team.is_active) {
      throw new AppError({
        message: 'Tim penjualan tujuan tidak ditemukan atau berstatus nonaktif.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'INVALID_TARGET_TEAM',
        statusCode: 422,
      });
    }

    // 2. Validasi profil staf target (L1)
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('id, full_name, system_role, is_active')
      .eq('id', input.profileId)
      .single();

    if (profErr || !profile || !profile.is_active) {
      throw new AppError({
        message: 'Staf tidak ditemukan atau berstatus tidak aktif.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'INVALID_STAFF_PROFILE',
        statusCode: 422,
      });
    }

    if (
      (input.membershipRole === 'TEAM_SUPERVISOR' && profile.system_role !== 'SUPERVISOR') ||
      (input.membershipRole === 'TEAM_SALES' && profile.system_role !== 'SALES')
    ) {
      throw new AppError({
        message: `Staf dengan role sistem [${profile.system_role}] tidak dapat ditugaskan sebagai [${input.membershipRole}].`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'ROLE_MEMBERSHIP_MISMATCH',
        statusCode: 422,
      });
    }

    const nowIso = new Date().toISOString();
    const closedSupervisorIds: string[] = [];
    const closedMemberIds: string[] = [];

    // 3. Jika menunjuk TEAM_SUPERVISOR baru, tutup masa jabatan Supervisor aktif sebelumnya di tim tersebut
    if (input.membershipRole === 'TEAM_SUPERVISOR') {
      const { data: prevSups, error: closeSupErr } = await supabase
        .from('team_memberships')
        .update({
          is_active: false,
          left_at: nowIso,
          notes: `Digantikan oleh Supervisor baru (${profile.full_name}): ${input.notes}`,
        })
        .eq('team_id', input.teamId)
        .eq('membership_role', 'TEAM_SUPERVISOR')
        .eq('is_active', true)
        .select('id');

      if (closeSupErr) {
        throw translateDatabaseOrRpcError(closeSupErr);
      }
      for (const row of prevSups ?? []) {
        closedSupervisorIds.push(row.id);
      }
    }

    // 4. Jika staf masih aktif di tim lain, tutup keanggotaan tim lamanya (Menjaga CST-02 & Histori)
    const { data: prevMemberships, error: closeMemErr } = await supabase
      .from('team_memberships')
      .update({
        is_active: false,
        left_at: nowIso,
        notes: `Dipindahkan ke tim ${team.name}: ${input.notes}`,
      })
      .eq('profile_id', input.profileId)
      .eq('is_active', true)
      .select('id');

    if (closeMemErr) {
      // Compensating restore jika step 3 sudah menutup supervisor lama
      if (closedSupervisorIds.length > 0) {
        await supabase
          .from('team_memberships')
          .update({ is_active: true, left_at: null })
          .in('id', closedSupervisorIds);
      }
      throw translateDatabaseOrRpcError(closeMemErr);
    }

    for (const row of prevMemberships ?? []) {
      closedMemberIds.push(row.id);
    }

    // 5. Sisipkan baris keanggotaan aktif yang baru
    const { data: membership, error: insertError } = await supabase
      .from('team_memberships')
      .insert({
        team_id: input.teamId,
        profile_id: input.profileId,
        membership_role: input.membershipRole,
        is_active: true,
        joined_at: nowIso,
        assigned_by: actor.userId,
        notes: input.notes,
      })
      .select('*')
      .single();

    if (insertError || !membership) {
      // Compensating restore agar staf tidak terlantar tanpa tim jika insert gagal
      const restoreIds = Array.from(new Set([...closedSupervisorIds, ...closedMemberIds]));
      if (restoreIds.length > 0) {
        await supabase
          .from('team_memberships')
          .update({ is_active: true, left_at: null })
          .in('id', restoreIds);
      }
      throw translateDatabaseOrRpcError(insertError);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'TEAM_MEMBER_ASSIGNED',
      entityTable: 'team_memberships',
      entityId: membership.id,
      newValues: membership,
      reason: input.notes,
    });

    return membership;
  },
};
