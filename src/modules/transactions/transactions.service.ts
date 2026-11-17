// Lokasi: src/modules/transactions/transactions.service.ts
// Level Topologis: L6-L9 (Service Layer untuk Modul N, O, P, dan R)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getServerEnv } from '@/lib/env/server';
import { AppError, translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { AuditSink } from '@/modules/shared/audit/audit.sink';
import { NotificationSink } from '@/modules/shared/notifications/notification.sink';
import { PrivateStorageService } from '@/modules/shared/storage/storage.service';
import {
  buildDealContractStoragePath,
  buildKprDisbursementProofStoragePath,
  buildKprDocumentStoragePath,
  buildPaymentProofStoragePath,
  buildRefundProofStoragePath,
} from '@/modules/shared/storage/storage.paths';
import {
  ALLOWED_FILE_EXTENSIONS,
  extractFileExtension,
} from '@/modules/shared/storage/storage.validator';
import type { AuthenticatedUserContext } from '@/types/database.types';
import type { z } from 'zod';
import type {
  advanceKprPreApprovalStageSchema,
  cancelBookingOrDealSchema,
  cancelKprByCustomerSchema,
  completeRefundTransactionSchema,
  createBookingSchema,
  extendBookingExpirySchema,
  generateInstallmentSchedulesSchema,
  recordKprApprovalSchema,
  recordKprDisbursementSchema,
  submitPaymentRecordSchema,
  transitionDealStatusSchema,
  uploadKprDocumentSchema,
  verifyKprDocumentSchema,
  verifyPaymentRecordSchema,
} from './transactions.schemas';

function resolveValidatedUploadExtension(file: File | null | undefined): string {
  if (!file || typeof file.name !== 'string' || file.size <= 0) {
    throw new AppError({
      message: 'File dokumen wajib dipilih dan tidak boleh kosong.',
      category: 'VALIDATION_ERROR',
      code: 'FILE_REQUIRED',
      statusCode: 400,
    });
  }

  const ext = extractFileExtension(file.name);
  if (
    !ext ||
    !ALLOWED_FILE_EXTENSIONS.includes(ext as (typeof ALLOWED_FILE_EXTENSIONS)[number])
  ) {
    throw new AppError({
      message: 'Ekstensi file tidak diizinkan. Gunakan format JPG, PNG, WEBP, atau PDF.',
      category: 'VALIDATION_ERROR',
      code: 'INVALID_FILE_EXTENSION',
      statusCode: 400,
    });
  }

  return ext;
}

export const TransactionsService = {
  /**
   * 1. Mengajukan Booking baru melalui RPC Atomik TX-01 (rpc_create_booking).
   */
  async createBookingViaRpc(input: z.infer<typeof createBookingSchema>) {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc('rpc_create_booking', {
      p_lead_id: input.leadId,
      p_unit_id: input.unitId,
      p_payment_method: input.paymentMethod,
      p_booking_fee_amount: input.bookingFeeAmount,
      p_promo_id: input.promoId ?? null,
      p_is_booking_fee_part_of_dp: input.isBookingFeePartOfDp,
      p_agreed_dp_total_amount: input.agreedDpTotalAmount,
      p_notes: input.notes ?? null,
    });

    if (error) {
      throw translateDatabaseOrRpcError(error);
    }

    return data as {
      booking_id: string;
      reference_number: string;
      unit_id: string;
      unit_status: string;
      agreed_final_price: number;
      booking_fee_schedule_id: string;
      expires_at: string;
    };
  },

  /**
   * 2. Memperpanjang masa berlaku Booking oleh Admin dengan alasan tercatat (OQ-03).
   *    Memperbarui bookings.expires_at terlebih dahulu dengan optimistic lock sebelum
   *    mencatat ke tabel append-only booking_extensions (beserta compensating restore).
   */
  async extendBookingExpiry(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof extendBookingExpirySchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, reference_number, status, expires_at')
      .eq('id', input.bookingId)
      .single();

    if (fetchErr || !booking) {
      throw translateDatabaseOrRpcError(fetchErr);
    }

    if (booking.status !== 'PENDING_FEE') {
      throw new AppError({
        message: `Hanya Booking dengan status PENDING_FEE yang dapat diperpanjang masa berlakunya (status saat ini: ${booking.status}).`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'INVALID_BOOKING_EXTENSION_STATE',
        statusCode: 422,
      });
    }

    const baseTime = Math.max(Date.now(), new Date(booking.expires_at).getTime());
    const newExpiresAt = new Date(
      baseTime + input.additionalHours * 3600 * 1000
    ).toISOString();

    // Perbarui bookings dengan guard status & expires_at sebelumnya (optimistic concurrency)
    const { data: updatedBooking, error: updErr } = await supabase
      .from('bookings')
      .update({ expires_at: newExpiresAt })
      .eq('id', booking.id)
      .eq('status', 'PENDING_FEE')
      .eq('expires_at', booking.expires_at)
      .select('id')
      .single();

    if (updErr || !updatedBooking) {
      throw translateDatabaseOrRpcError(updErr);
    }

    const { error: extErr } = await supabase.from('booking_extensions').insert({
      booking_id: booking.id,
      old_expires_at: booking.expires_at,
      new_expires_at: newExpiresAt,
      reason: input.reason,
      extended_by: actor.userId,
    });

    if (extErr) {
      // Compensating restore expires_at jika pencatatan riwayat ekstensi gagal
      await supabase
        .from('bookings')
        .update({ expires_at: booking.expires_at })
        .eq('id', booking.id);
      throw translateDatabaseOrRpcError(extErr);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'BOOKING_EXPIRY_EXTENDED',
      entityTable: 'bookings',
      entityId: booking.id,
      oldValues: { expires_at: booking.expires_at },
      newValues: { expires_at: newExpiresAt },
      reason: input.reason,
    });

    return { bookingId: booking.id, newExpiresAt };
  },

  /**
   * 3. Menyusun jadwal cicilan Cash Bertahap (INSTALLMENT 1..N) dengan rekonsiliasi
   *    matematis tepat sama dengan agreed_final_price (BR-06).
   */
  async generateCashBertahapInstallments(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof generateInstallmentSchedulesSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select(
        'id, payment_method, agreed_final_price, booking_fee_amount, is_booking_fee_part_of_dp, agreed_dp_total_amount, status'
      )
      .eq('id', input.bookingId)
      .single();

    if (bErr || !booking) {
      throw translateDatabaseOrRpcError(bErr);
    }

    if (booking.status !== 'ACTIVE') {
      throw new AppError({
        message: `Jadwal cicilan Cash Bertahap hanya dapat disusun saat Booking berstatus ACTIVE (status saat ini: ${booking.status}).`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'INVALID_BOOKING_STATUS_FOR_INSTALLMENTS',
        statusCode: 422,
      });
    }

    if (booking.payment_method !== 'CASH_BERTAHAP') {
      throw new AppError({
        message: 'Pembuatan termin cicilan bertahap hanya berlaku untuk metode CASH_BERTAHAP.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'NOT_CASH_BERTAHAP',
        statusCode: 422,
      });
    }

    const { count: existingInstallments, error: countErr } = await supabase
      .from('payment_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', booking.id)
      .eq('schedule_type', 'INSTALLMENT')
      .neq('status', 'CANCELLED');

    if (countErr) {
      throw translateDatabaseOrRpcError(countErr);
    }

    if ((existingInstallments ?? 0) > 0) {
      throw new AppError({
        message: 'Jadwal cicilan bertahap untuk Booking ini sudah dibuat sebelumnya.',
        category: 'CONFLICT_ERROR',
        code: 'INSTALLMENTS_ALREADY_GENERATED',
        statusCode: 409,
      });
    }

    const totalUpfront = booking.is_booking_fee_part_of_dp
      ? Math.max(Number(booking.agreed_dp_total_amount), Number(booking.booking_fee_amount))
      : Number(booking.agreed_dp_total_amount) + Number(booking.booking_fee_amount);

    const remainingPrincipal = Number(booking.agreed_final_price) - totalUpfront;

    if (remainingPrincipal < input.installmentCount) {
      throw new AppError({
        message: 'Sisa pokok cicilan setelah dikurangi Booking Fee dan DP tidak mencukupi untuk jumlah termin yang diminta.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'INSUFFICIENT_INSTALLMENT_PRINCIPAL',
        statusCode: 422,
      });
    }

    const baseInstallment = Math.floor(remainingPrincipal / input.installmentCount);
    const remainder =
      remainingPrincipal - baseInstallment * (input.installmentCount - 1);

    const startDate = new Date(`${input.firstDueDate}T00:00:00Z`);
    const rowsToInsert = [];

    for (let i = 1; i <= input.installmentCount; i++) {
      const dueDate = new Date(startDate);
      dueDate.setUTCMonth(dueDate.getUTCMonth() + (i - 1));
      const dueDateStr = dueDate.toISOString().slice(0, 10);
      const amount = i === input.installmentCount ? remainder : baseInstallment;

      rowsToInsert.push({
        booking_id: booking.id,
        schedule_type: 'INSTALLMENT' as const,
        installment_number: i,
        title: `Cicilan Cash Bertahap Termin Ke-${i} dari ${input.installmentCount}`,
        scheduled_amount: amount,
        verified_paid_amount: 0,
        remaining_amount: amount,
        due_date: dueDateStr,
        status: 'UNPAID' as const,
      });
    }

    const { data: inserted, error: insErr } = await supabase
      .from('payment_schedules')
      .insert(rowsToInsert)
      .select('*');

    if (insErr) {
      throw translateDatabaseOrRpcError(insErr);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'INSTALLMENT_SCHEDULES_GENERATED',
      entityTable: 'bookings',
      entityId: booking.id,
      newValues: {
        installment_count: input.installmentCount,
        total_installment_principal: remainingPrincipal,
      },
      reason: `Pembuatan ${input.installmentCount} termin jadwal cicilan Cash Bertahap.`,
    });

    return inserted ?? [];
  },

  /**
   * 4. Pra-cek validitas tagihan + mengunggah bukti pembayaran ke Private Storage
   *    + mencatat ke payment_records. Menerapkan Compensating Cleanup jika insert gagal.
   */
  async submitPaymentProofAndRecord(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof submitPaymentRecordSchema>,
    proofFile: File | null | undefined
  ) {
    const ext = resolveValidatedUploadExtension(proofFile);
    const supabase = await createSupabaseServerClient();

    // Pra-cek DB sebelum upload agar tidak mengirim file yatim ke Storage
    const { data: schedule, error: schedErr } = await supabase
      .from('payment_schedules')
      .select('id, booking_id, remaining_amount, status, bookings!inner(status)')
      .eq('id', input.paymentScheduleId)
      .eq('booking_id', input.bookingId)
      .single();

    if (schedErr || !schedule) {
      throw new AppError({
        message: 'Jadwal pembayaran tidak ditemukan atau Anda tidak berwenang mengakses Booking ini.',
        category: 'NOT_FOUND_ERROR',
        code: 'PAYMENT_SCHEDULE_NOT_FOUND',
        statusCode: 404,
      });
    }

    const bookingRel = Array.isArray(schedule.bookings)
      ? schedule.bookings[0]
      : schedule.bookings;

    if (!bookingRel || !['PENDING_FEE', 'ACTIVE'].includes(bookingRel.status)) {
      throw new AppError({
        message: `Booking berstatus [${bookingRel?.status ?? 'UNKNOWN'}] dan tidak lagi menerima pengajuan bukti pembayaran.`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'BOOKING_NOT_PAYABLE',
        statusCode: 422,
      });
    }

    if (schedule.status === 'PAID' || schedule.status === 'CANCELLED') {
      throw new AppError({
        message: `Jadwal tagihan berstatus [${schedule.status}] dan tidak dapat menerima pembayaran baru.`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'SCHEDULE_NOT_PAYABLE',
        statusCode: 422,
      });
    }

    if (input.paidAmount > Number(schedule.remaining_amount)) {
      throw new AppError({
        message: `Nominal pembayaran (Rp ${input.paidAmount.toLocaleString('id-ID')}) melebihi sisa tagihan (Rp ${Number(schedule.remaining_amount).toLocaleString('id-ID')}).`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'OVERPAYMENT_BLOCKED',
        statusCode: 422,
      });
    }

    const storagePath = buildPaymentProofStoragePath({
      bookingId: input.bookingId,
      paymentScheduleId: input.paymentScheduleId,
      extension: ext,
    });

    // 1. Validasi biner Magic Bytes & unggah ke bucket privat
    const uploaded = await PrivateStorageService.validateAndUpload({
      file: proofFile,
      targetPath: storagePath,
    });

    try {
      // 2. Simpan metadata ke tabel payment_records (Nomor PAY-YYYYMM-XXXX diisi otomatis oleh trigger!)
      const { data: record, error } = await supabase
        .from('payment_records')
        .insert({
          reference_number: '',
          booking_id: input.bookingId,
          payment_schedule_id: input.paymentScheduleId,
          submitted_by_sales_id: actor.userId,
          paid_amount: input.paidAmount,
          payment_date: input.paymentDate,
          payment_channel: input.paymentChannel,
          proof_file_path: uploaded.filePath,
          proof_file_name: uploaded.sanitizedFileName,
          replaces_payment_id: input.replacesPaymentId ?? null,
          verification_status: 'PENDING_VERIFICATION',
          sales_notes: input.salesNotes ?? null,
        })
        .select('*')
        .single();

      if (error || !record) {
        throw translateDatabaseOrRpcError(error);
      }

      return record;
    } catch (dbErr) {
      // Compensating Cleanup: hapus file dari Storage agar tidak menjadi orphan object
      await PrivateStorageService.rollbackOrphanedUploadSafe(uploaded.filePath);
      throw dbErr;
    }
  },

  /**
   * 5. Memverifikasi atau menolak bukti pembayaran melalui RPC Atomik TX-02.
   */
  async verifyPaymentRecordViaRpc(input: z.infer<typeof verifyPaymentRecordSchema>) {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc('rpc_verify_payment_record', {
      p_payment_record_id: input.paymentRecordId,
      p_decision: input.decision,
      p_verification_notes: input.verificationNotes ?? null,
      p_expired_booking_action: input.expiredBookingAction ?? null,
      p_kpr_bank_name: input.kprBankName,
      p_kpr_tenor_years: input.kprTenorYears,
    });

    if (error) {
      throw translateDatabaseOrRpcError(error);
    }

    return data;
  },

  /**
   * 6. Pra-cek KPR + mengunggah berkas persyaratan KPR ke Private Storage & memperbarui kpr_documents.
   *    Mencegah penimpaan dokumen berstatus VERIFIED (selaras dengan File 03 v1.1 & File 05 v1.1).
   */
  async uploadKprRequirementDocument(
    actor: AuthenticatedUserContext,
    params: z.infer<typeof uploadKprDocumentSchema>,
    file: File | null | undefined
  ) {
    const ext = resolveValidatedUploadExtension(file);
    const supabase = await createSupabaseServerClient();

    // Pra-cek dokumen dan status pengajuan KPR sebelum upload ke Storage
    const { data: existingDoc, error: docErr } = await supabase
      .from('kpr_documents')
      .select(
        'id, status, kpr_application_id, kpr_applications!inner(booking_id, application_status)'
      )
      .eq('id', params.kprDocumentId)
      .eq('kpr_application_id', params.kprApplicationId)
      .single();

    const kprRel = Array.isArray(existingDoc?.kpr_applications)
      ? existingDoc?.kpr_applications[0]
      : existingDoc?.kpr_applications;

    if (docErr || !existingDoc || !kprRel || kprRel.booking_id !== params.bookingId) {
      throw new AppError({
        message: 'Item dokumen KPR tidak ditemukan atau Anda tidak berwenang mengakses pengajuan ini.',
        category: 'NOT_FOUND_ERROR',
        code: 'KPR_DOCUMENT_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!['IN_PROGRESS', 'APPROVED'].includes(kprRel.application_status)) {
      throw new AppError({
        message: `Dokumen tidak dapat diunggah karena status pengajuan KPR adalah [${kprRel.application_status}].`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'KPR_APPLICATION_CLOSED',
        statusCode: 422,
      });
    }

    if (existingDoc.status === 'VERIFIED') {
      throw new AppError({
        message: 'Dokumen KPR yang sudah berstatus VERIFIED terkunci dan tidak dapat ditimpa.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'KPR_DOCUMENT_LOCKED_VERIFIED',
        statusCode: 422,
      });
    }

    const storagePath = buildKprDocumentStoragePath({
      bookingId: params.bookingId,
      kprApplicationId: params.kprApplicationId,
      documentCode: params.documentCode,
      extension: ext,
    });

    const uploaded = await PrivateStorageService.validateAndUpload({
      file,
      targetPath: storagePath,
    });

    try {
      const { data, error } = await supabase
        .from('kpr_documents')
        .update({
          status: 'UPLOADED',
          file_path: uploaded.filePath,
          file_name: uploaded.sanitizedFileName,
          uploaded_by: actor.userId,
          uploaded_at: new Date().toISOString(),
        })
        .eq('id', params.kprDocumentId)
        .eq('kpr_application_id', params.kprApplicationId)
        .neq('status', 'VERIFIED')
        .select('*')
        .single();

      if (error || !data) {
        throw translateDatabaseOrRpcError(error);
      }

      return data;
    } catch (dbErr) {
      await PrivateStorageService.rollbackOrphanedUploadSafe(uploaded.filePath);
      throw dbErr;
    }
  },

  /**
   * 6b. Verifikasi atau permintaan revisi dokumen persyaratan KPR oleh ADMIN.
   *     Syarat agar dokumen wajib memenuhi ketentuan TX-09 sebelum pengajuan dikirim ke bank (SUBMITTED).
   */
  async verifyKprDocument(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof verifyKprDocumentSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data: doc, error: fetchErr } = await supabase
      .from('kpr_documents')
      .select(
        'id, kpr_application_id, document_name, status, file_path, kpr_applications!inner(id, reference_number, application_status, current_sales_id)'
      )
      .eq('id', input.kprDocumentId)
      .single();

    if (fetchErr || !doc) {
      throw translateDatabaseOrRpcError(fetchErr);
    }

    const kprApp = Array.isArray(doc.kpr_applications)
      ? doc.kpr_applications[0]
      : doc.kpr_applications;

    if (!kprApp || !['IN_PROGRESS', 'APPROVED'].includes(kprApp.application_status)) {
      throw new AppError({
        message: `Dokumen tidak dapat diverifikasi karena pengajuan KPR berstatus [${kprApp?.application_status ?? 'UNKNOWN'}].`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'KPR_APPLICATION_NOT_OPEN_FOR_VERIFICATION',
        statusCode: 422,
      });
    }

    if (input.decision === 'VERIFIED' && (!doc.file_path || doc.status === 'MISSING')) {
      throw new AppError({
        message: 'Dokumen belum memiliki file unggahan sehingga tidak dapat disahkan sebagai VERIFIED.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'KPR_DOCUMENT_FILE_MISSING',
        statusCode: 422,
      });
    }

    if (doc.status === 'VERIFIED') {
      throw new AppError({
        message: 'Dokumen KPR ini sudah berstatus VERIFIED.',
        category: 'CONFLICT_ERROR',
        code: 'KPR_DOCUMENT_ALREADY_VERIFIED',
        statusCode: 409,
      });
    }

    const nowIso = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from('kpr_documents')
      .update({
        status: input.decision,
        verified_by: actor.userId,
        verified_at: nowIso,
        verification_notes: input.verificationNotes ?? null,
      })
      .eq('id', doc.id)
      .neq('status', 'VERIFIED')
      .select('*')
      .single();

    if (updErr || !updated) {
      throw translateDatabaseOrRpcError(updErr);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: `KPR_DOCUMENT_${input.decision}`,
      entityTable: 'kpr_documents',
      entityId: updated.id,
      oldValues: { status: doc.status },
      newValues: {
        status: updated.status,
        verified_by: actor.userId,
        verification_notes: updated.verification_notes,
      },
      reason:
        input.verificationNotes ?? `Verifikasi dokumen KPR ${doc.document_name} oleh Admin.`,
    });

    await NotificationSink.publishDirectSafe({
      recipientUserId: kprApp.current_sales_id,
      notificationType: 'KPR_DOCUMENT_UPDATE',
      title:
        input.decision === 'VERIFIED'
          ? `Dokumen KPR Terverifikasi (${kprApp.reference_number})`
          : `Revisi Dokumen KPR Diperlukan (${kprApp.reference_number})`,
      description:
        input.decision === 'VERIFIED'
          ? `Dokumen "${doc.document_name}" telah diverifikasi oleh Admin.`
          : `Dokumen "${doc.document_name}" perlu diperbaiki oleh Sales. Catatan: ${input.verificationNotes ?? '-'}`,
      referenceType: 'KPR',
      referenceId: kprApp.id,
      deduplicationKey: `KPR_DOC_REVIEW:${updated.id}:${input.decision}:${nowIso}`,
    });

    return updated;
  },

  /**
   * 7. Memajukan tahapan KPR pra-persetujuan & penjadwalan Akad secara atomik melalui RPC TX-09.
   */
  async advanceKprStageViaRpc(input: z.infer<typeof advanceKprPreApprovalStageSchema>) {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc('rpc_advance_kpr_stage', {
      p_kpr_application_id: input.kprApplicationId,
      p_target_stage: input.targetStage,
      p_akad_scheduled_at: input.akadScheduledAt ?? null,
      p_akad_location: input.akadLocation ?? null,
      p_notary_name: input.notaryName ?? null,
      p_notes: input.notes ?? null,
    });

    if (error) {
      throw translateDatabaseOrRpcError(error);
    }

    return data as {
      kpr_application_id: string;
      from_stage: string;
      current_stage: string;
      application_status: string;
      updated_at: string;
    };
  },

  /**
   * 8. Mencatat keputusan persetujuan KPR bank (SP3K / Turun Plafon / Ditolak Bank) melalui RPC TX-04.
   */
  async recordKprApprovalViaRpc(input: z.infer<typeof recordKprApprovalSchema>) {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc('rpc_record_kpr_approval', {
      p_kpr_application_id: input.kprApplicationId,
      p_decision: input.decision,
      p_sp3k_reference_number: input.sp3kReferenceNumber ?? null,
      p_approved_loan_amount: input.approvedLoanAmount ?? null,
      p_topup_dp_due_date: input.topupDpDueDate ?? null,
      p_notes: input.notes ?? null,
    });

    if (error) {
      throw translateDatabaseOrRpcError(error);
    }

    return data;
  },

  /**
   * 9. Mencatat pembatalan pengajuan KPR oleh konsumen secara atomik melalui RPC TX-10.
   */
  async cancelKprByCustomerViaRpc(input: z.infer<typeof cancelKprByCustomerSchema>) {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc('rpc_cancel_kpr_by_customer', {
      p_kpr_application_id: input.kprApplicationId,
      p_cancellation_reason: input.cancellationReason,
      p_notes: input.notes ?? null,
    });

    if (error) {
      throw translateDatabaseOrRpcError(error);
    }

    return data as {
      kpr_application_id: string;
      application_status: 'CANCELLED_BY_CUSTOMER';
      current_stage: string;
      cancelled_at: string;
    };
  },

  /**
   * 10. Pra-cek KPR + mengunggah bukti pencairan KPR + memanggil RPC Atomik TX-08 (rpc_record_kpr_disbursement).
   *     Selaras dengan kebijakan final TC-01A (Unit hanya menjadi SOLD saat pencairan mencapai 100%).
   */
  async recordKprDisbursementWithProof(
    input: z.infer<typeof recordKprDisbursementSchema>,
    proofFile: File | null | undefined
  ) {
    const serverEnv = getServerEnv();
    if (serverEnv.KPR_SOLD_POLICY_MODE !== 'TC-01A') {
      throw new AppError({
        message: 'Konfigurasi kebijakan KPR_SOLD_POLICY_MODE harus bernilai TC-01A.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'INVALID_KPR_SOLD_POLICY_MODE',
        statusCode: 422,
      });
    }

    const ext = resolveValidatedUploadExtension(proofFile);
    const supabase = await createSupabaseServerClient();

    // Pra-cek KPR & hitung sequence_number berikutnya sebelum mengunggah ke Storage
    const { data: kpr, error: kprErr } = await supabase
      .from('kpr_applications')
      .select('id, booking_id, application_status, remaining_undisbursed_amount')
      .eq('id', input.kprApplicationId)
      .eq('booking_id', input.bookingId)
      .single();

    if (kprErr || !kpr) {
      throw new AppError({
        message: 'Pengajuan KPR tidak ditemukan untuk Booking tersebut.',
        category: 'NOT_FOUND_ERROR',
        code: 'KPR_APPLICATION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (kpr.application_status !== 'APPROVED') {
      throw new AppError({
        message: `Pencairan KPR hanya dapat dicatat pada pengajuan berstatus APPROVED (status saat ini: ${kpr.application_status}).`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'KPR_NOT_APPROVED_FOR_DISBURSEMENT',
        statusCode: 422,
      });
    }

    if (input.disbursedAmount > Number(kpr.remaining_undisbursed_amount ?? 0)) {
      throw new AppError({
        message: `Nominal pencairan melebihi sisa plafon KPR yang belum cair (Rp ${Number(kpr.remaining_undisbursed_amount ?? 0).toLocaleString('id-ID')}).`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'DISBURSEMENT_EXCEEDS_LOAN',
        statusCode: 422,
      });
    }

    const { data: latestDisb, error: seqErr } = await supabase
      .from('kpr_disbursements')
      .select('sequence_number')
      .eq('kpr_application_id', kpr.id)
      .order('sequence_number', { ascending: false })
      .limit(1);

    if (seqErr) {
      throw translateDatabaseOrRpcError(seqErr);
    }

    const nextSeq = Number(latestDisb?.[0]?.sequence_number ?? 0) + 1;

    const storagePath = buildKprDisbursementProofStoragePath({
      bookingId: input.bookingId,
      kprApplicationId: input.kprApplicationId,
      sequenceNumber: nextSeq,
      extension: ext,
    });

    const uploaded = await PrivateStorageService.validateAndUpload({
      file: proofFile,
      targetPath: storagePath,
    });

    try {
      const { data, error } = await supabase.rpc('rpc_record_kpr_disbursement', {
        p_kpr_application_id: input.kprApplicationId,
        p_tranche_type: input.trancheType,
        p_disbursement_reference: input.disbursementReference,
        p_disbursed_amount: input.disbursedAmount,
        p_disbursement_date: input.disbursementDate,
        p_proof_file_path: uploaded.filePath,
        p_notes: input.notes ?? null,
      });

      if (error) {
        throw translateDatabaseOrRpcError(error);
      }

      return data;
    } catch (rpcErr) {
      await PrivateStorageService.rollbackOrphanedUploadSafe(uploaded.filePath);
      throw rpcErr;
    }
  },

  /**
   * 11. Mengelola transisi 3 dimensi Deal melalui RPC Atomik TX-05 (rpc_transition_deal_status).
   */
  async transitionDealStatusWithOptionalContract(
    input: z.infer<typeof transitionDealStatusSchema>,
    contractPdfFile?: File | null
  ) {
    const supabase = await createSupabaseServerClient();

    // Pra-cek Deal & kesesuaian Booking sebelum mengunggah kontrak PDF ke Storage
    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .select('id, booking_id, sales_outcome_status')
      .eq('id', input.dealId)
      .eq('booking_id', input.bookingId)
      .single();

    if (dealErr || !deal) {
      throw new AppError({
        message: 'Data Deal tidak ditemukan atau tidak cocok dengan Booking terkait.',
        category: 'NOT_FOUND_ERROR',
        code: 'DEAL_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (deal.sales_outcome_status === 'CANCELLED_FAILED') {
      throw new AppError({
        message: 'Deal yang sudah dibatalkan tidak dapat diproses lebih lanjut.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'DEAL_ALREADY_CANCELLED',
        statusCode: 422,
      });
    }

    let uploadedPath: string | null = null;

    if (contractPdfFile && contractPdfFile.size > 0) {
      const storagePath = buildDealContractStoragePath({
        bookingId: input.bookingId,
        dealId: input.dealId,
      });
      const uploaded = await PrivateStorageService.validateAndUpload({
        file: contractPdfFile,
        targetPath: storagePath,
        pdfOnly: true,
      });
      uploadedPath = uploaded.filePath;
    }

    try {
      const { data, error } = await supabase.rpc('rpc_transition_deal_status', {
        p_deal_id: input.dealId,
        p_transition_action: input.transitionAction,
        p_contract_doc_number: input.contractDocNumber ?? null,
        p_contract_file_path: uploadedPath,
        p_notary_name: input.notaryName ?? null,
        p_notes: input.notes ?? null,
      });

      if (error) {
        throw translateDatabaseOrRpcError(error);
      }

      return data;
    } catch (rpcErr) {
      if (uploadedPath) {
        await PrivateStorageService.rollbackOrphanedUploadSafe(uploadedPath);
      }
      throw rpcErr;
    }
  },

  /**
   * 12. Membatalkan Booking atau Deal melalui RPC Atomik TX-06 (rpc_cancel_booking_or_deal).
   */
  async cancelBookingOrDealViaRpc(input: z.infer<typeof cancelBookingOrDealSchema>) {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc('rpc_cancel_booking_or_deal', {
      p_booking_id: input.bookingId,
      p_cancellation_reason: input.cancellationReason,
      p_refund_policy_type: input.refundPolicyType,
      p_agreed_refund_amount: input.agreedRefundAmount,
      p_notes: input.notes ?? null,
    });

    if (error) {
      throw translateDatabaseOrRpcError(error);
    }

    return data;
  },

  /**
   * 13. Pra-cek + menyelesaikan pencairan pengembalian dana (Refund) beserta unggah bukti transfer (PD-04).
   */
  async completeRefundDisbursement(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof completeRefundTransactionSchema>,
    proofFile: File | null | undefined
  ) {
    const ext = resolveValidatedUploadExtension(proofFile);
    const supabase = await createSupabaseServerClient();

    const { data: existingRefund, error: refErr } = await supabase
      .from('refund_transactions')
      .select('id, booking_id, status')
      .eq('id', input.refundTransactionId)
      .eq('booking_id', input.bookingId)
      .single();

    if (refErr || !existingRefund) {
      throw new AppError({
        message: 'Catatan transaksi refund tidak ditemukan untuk Booking terkait.',
        category: 'NOT_FOUND_ERROR',
        code: 'REFUND_RECORD_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (existingRefund.status !== 'PENDING_REFUND') {
      throw new AppError({
        message: `Transaksi refund berstatus [${existingRefund.status}] dan tidak dapat diproses ulang.`,
        category: 'CONFLICT_ERROR',
        code: 'REFUND_ALREADY_FINALIZED',
        statusCode: 409,
      });
    }

    const storagePath = buildRefundProofStoragePath({
      bookingId: input.bookingId,
      refundTransactionId: input.refundTransactionId,
      extension: ext,
    });

    const uploaded = await PrivateStorageService.validateAndUpload({
      file: proofFile,
      targetPath: storagePath,
    });

    try {
      const { data, error } = await supabase
        .from('refund_transactions')
        .update({
          refund_date: input.refundDate,
          refund_method: input.refundMethod,
          proof_file_path: uploaded.filePath,
          status: 'COMPLETED',
          processed_by_admin_id: actor.userId,
          notes: input.notes ?? null,
        })
        .eq('id', input.refundTransactionId)
        .eq('booking_id', input.bookingId)
        .eq('status', 'PENDING_REFUND')
        .select('*')
        .single();

      if (error || !data) {
        throw translateDatabaseOrRpcError(error);
      }

      await AuditSink.record({
        actorUserId: actor.userId,
        actorRole: actor.systemRole,
        actionType: 'REFUND_COMPLETED',
        entityTable: 'refund_transactions',
        entityId: data.id,
        oldValues: { status: 'PENDING_REFUND' },
        newValues: data,
        reason: input.notes ?? 'Penyelesaian transfer pengembalian dana (Refund).',
      });

      return data;
    } catch (dbErr) {
      await PrivateStorageService.rollbackOrphanedUploadSafe(uploaded.filePath);
      throw dbErr;
    }
  },
};
