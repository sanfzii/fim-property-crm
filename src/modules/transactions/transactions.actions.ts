// Lokasi: src/modules/transactions/transactions.actions.ts
// Layer 3: Server Actions untuk Modul N (Booking), O (Payment & Refund), P (KPR), R (Deal), & Dokumen

'use server';

import { revalidatePath } from 'next/cache';
import { executeSafeServerAction } from '@/lib/errors/app-error';
import { requireActionAuth } from '@/modules/identity/auth/auth.guards';
import { PrivateStorageService } from '@/modules/shared/storage/storage.service';
import {
  advanceKprPreApprovalStageSchema,
  cancelBookingOrDealSchema,
  cancelKprByCustomerSchema,
  completeRefundTransactionSchema,
  createBookingSchema,
  extendBookingExpirySchema,
  generateInstallmentSchedulesSchema,
  getDocumentSignedUrlSchema,
  recordKprApprovalSchema,
  recordKprDisbursementSchema,
  submitPaymentRecordSchema,
  transitionDealStatusSchema,
  uploadKprDocumentSchema,
  verifyKprDocumentSchema,
  verifyPaymentRecordSchema,
} from './transactions.schemas';
import { TransactionsService } from './transactions.service';

export async function createBookingAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'createBookingAction' },
    async () => {
      await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = createBookingSchema.parse(rawInput);
      const data = await TransactionsService.createBookingViaRpc(validated);
      revalidatePath('/catalog');
      revalidatePath('/bookings');
      revalidatePath(`/leads/${validated.leadId}`);
      revalidatePath('/dashboard');
      return {
        message: `Booking ${data.reference_number} berhasil dibuat. Unit kini ditahan sementara (HELD) selama 72 jam.`,
        data,
      };
    }
  );
}

export async function extendBookingExpiryAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'extendBookingExpiryAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = extendBookingExpirySchema.parse(rawInput);
      const data = await TransactionsService.extendBookingExpiry(actor, validated);
      revalidatePath(`/bookings/${validated.bookingId}`);
      revalidatePath('/bookings');
      return { message: 'Masa berlaku Booking berhasil diperpanjang.', data };
    }
  );
}

export async function generateInstallmentSchedulesAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'generateInstallmentSchedulesAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = generateInstallmentSchedulesSchema.parse(rawInput);
      const data = await TransactionsService.generateCashBertahapInstallments(
        actor,
        validated
      );
      revalidatePath(`/bookings/${validated.bookingId}`);
      return {
        message: `${data.length} jadwal termin cicilan Cash Bertahap berhasil dibuat.`,
        data,
      };
    }
  );
}

export async function submitPaymentRecordAction(formData: FormData) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'submitPaymentRecordAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SALES']);
      const validated = submitPaymentRecordSchema.parse({
        bookingId: formData.get('bookingId'),
        paymentScheduleId: formData.get('paymentScheduleId'),
        paidAmount: Number(formData.get('paidAmount')),
        paymentDate: formData.get('paymentDate'),
        paymentChannel: formData.get('paymentChannel') ?? 'BANK_TRANSFER',
        replacesPaymentId: formData.get('replacesPaymentId') || null,
        salesNotes: formData.get('salesNotes') || null,
      });
      const proofFile = formData.get('proofFile') as File | null;
      const data = await TransactionsService.submitPaymentProofAndRecord(
        actor,
        validated,
        proofFile
      );
      revalidatePath(`/bookings/${validated.bookingId}`);
      revalidatePath('/payments');
      revalidatePath('/dashboard');
      return {
        message: `Bukti pembayaran ${data.reference_number} berhasil diunggah dan menunggu verifikasi Admin.`,
        data,
      };
    }
  );
}

export async function verifyPaymentRecordAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'verifyPaymentRecordAction' },
    async () => {
      await requireActionAuth(['ADMIN']);
      const validated = verifyPaymentRecordSchema.parse(rawInput);
      const data = await TransactionsService.verifyPaymentRecordViaRpc(validated);
      revalidatePath('/payments');
      revalidatePath('/bookings');
      revalidatePath('/kpr');
      revalidatePath('/catalog');
      revalidatePath('/dashboard');
      return {
        message: `Pembayaran berhasil diproses dengan keputusan: ${validated.decision}.`,
        data,
      };
    }
  );
}

export async function uploadKprDocumentAction(formData: FormData) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'uploadKprDocumentAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SALES']);
      const validated = uploadKprDocumentSchema.parse({
        bookingId: formData.get('bookingId'),
        kprApplicationId: formData.get('kprApplicationId'),
        kprDocumentId: formData.get('kprDocumentId'),
        documentCode: formData.get('documentCode') ?? 'DOC',
      });
      const file = formData.get('file') as File | null;

      const data = await TransactionsService.uploadKprRequirementDocument(
        actor,
        validated,
        file
      );
      revalidatePath(`/kpr/${validated.kprApplicationId}`);
      return { message: `Dokumen ${data.document_name} berhasil diunggah.`, data };
    }
  );
}

export async function verifyKprDocumentAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'verifyKprDocumentAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = verifyKprDocumentSchema.parse(rawInput);
      const data = await TransactionsService.verifyKprDocument(actor, validated);
      revalidatePath(`/kpr/${data.kpr_application_id}`);
      revalidatePath('/kpr');
      return {
        message:
          validated.decision === 'VERIFIED'
            ? `Dokumen ${data.document_name} berhasil diverifikasi.`
            : `Dokumen ${data.document_name} ditandai memerlukan revisi.`,
        data,
      };
    }
  );
}

export async function advanceKprStageAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'advanceKprStageAction' },
    async () => {
      await requireActionAuth(['ADMIN']);
      const validated = advanceKprPreApprovalStageSchema.parse(rawInput);
      const data = await TransactionsService.advanceKprStageViaRpc(validated);
      revalidatePath(`/kpr/${validated.kprApplicationId}`);
      revalidatePath('/kpr');
      return {
        message: `Tahap pengajuan KPR berhasil diperbarui ke ${data.current_stage}.`,
        data,
      };
    }
  );
}

export async function recordKprApprovalAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'recordKprApprovalAction' },
    async () => {
      await requireActionAuth(['ADMIN']);
      const validated = recordKprApprovalSchema.parse(rawInput);
      const data = await TransactionsService.recordKprApprovalViaRpc(validated);
      revalidatePath(`/kpr/${validated.kprApplicationId}`);
      revalidatePath('/kpr');
      revalidatePath('/payments');
      return {
        message: `Keputusan KPR bank (${validated.decision}) berhasil dicatat.`,
        data,
      };
    }
  );
}

export async function cancelKprByCustomerAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'cancelKprByCustomerAction' },
    async () => {
      await requireActionAuth(['ADMIN']);
      const validated = cancelKprByCustomerSchema.parse(rawInput);
      const data = await TransactionsService.cancelKprByCustomerViaRpc(validated);
      revalidatePath(`/kpr/${validated.kprApplicationId}`);
      revalidatePath('/kpr');
      revalidatePath('/bookings');
      revalidatePath('/deals');
      revalidatePath('/dashboard');
      return {
        message: 'Pembatalan pengajuan KPR oleh konsumen berhasil dicatat.',
        data,
      };
    }
  );
}

export async function recordKprDisbursementAction(formData: FormData) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'recordKprDisbursementAction' },
    async () => {
      await requireActionAuth(['ADMIN']);
      const validated = recordKprDisbursementSchema.parse({
        bookingId: formData.get('bookingId'),
        kprApplicationId: formData.get('kprApplicationId'),
        trancheType: formData.get('trancheType'),
        disbursementReference: formData.get('disbursementReference'),
        disbursedAmount: Number(formData.get('disbursedAmount')),
        disbursementDate: formData.get('disbursementDate'),
        notes: formData.get('notes') || null,
      });
      const proofFile = formData.get('proofFile') as File | null;
      const data = await TransactionsService.recordKprDisbursementWithProof(
        validated,
        proofFile
      );
      revalidatePath(`/kpr/${validated.kprApplicationId}`);
      revalidatePath('/deals');
      revalidatePath('/catalog');
      revalidatePath('/dashboard');
      return {
        message: `Pencairan dana KPR (${validated.trancheType}) berhasil dicatat.`,
        data,
      };
    }
  );
}

export async function transitionDealStatusAction(formData: FormData) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'transitionDealStatusAction' },
    async () => {
      await requireActionAuth(['ADMIN']);
      const validated = transitionDealStatusSchema.parse({
        bookingId: formData.get('bookingId'),
        dealId: formData.get('dealId'),
        transitionAction: formData.get('transitionAction'),
        contractDocNumber: formData.get('contractDocNumber') || null,
        notaryName: formData.get('notaryName') || null,
        notes: formData.get('notes') || null,
      });
      const contractFile = formData.get('contractFile') as File | null;
      const data = await TransactionsService.transitionDealStatusWithOptionalContract(
        validated,
        contractFile
      );
      revalidatePath('/deals');
      revalidatePath('/bookings');
      revalidatePath('/catalog');
      revalidatePath('/dashboard');
      return {
        message: `Transisi status Deal (${validated.transitionAction}) berhasil disahkan.`,
        data,
      };
    }
  );
}

export async function cancelBookingOrDealAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'cancelBookingOrDealAction' },
    async () => {
      await requireActionAuth(['ADMIN']);
      const validated = cancelBookingOrDealSchema.parse(rawInput);
      const data = await TransactionsService.cancelBookingOrDealViaRpc(validated);
      revalidatePath('/bookings');
      revalidatePath('/deals');
      revalidatePath('/kpr');
      revalidatePath('/catalog');
      revalidatePath('/dashboard');
      return {
        message: 'Transaksi berhasil dibatalkan dan status Unit telah dikembalikan menjadi AVAILABLE.',
        data,
      };
    }
  );
}

export async function completeRefundTransactionAction(formData: FormData) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'completeRefundTransactionAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = completeRefundTransactionSchema.parse({
        bookingId: formData.get('bookingId'),
        refundTransactionId: formData.get('refundTransactionId'),
        refundDate: formData.get('refundDate'),
        refundMethod: formData.get('refundMethod') ?? 'BANK_TRANSFER',
        notes: formData.get('notes') || null,
      });
      const proofFile = formData.get('proofFile') as File | null;
      const data = await TransactionsService.completeRefundDisbursement(
        actor,
        validated,
        proofFile
      );
      revalidatePath(`/bookings/${validated.bookingId}`);
      revalidatePath('/payments');
      return {
        message: `Pencairan pengembalian dana (${data.reference_number}) berhasil diselesaikan.`,
        data,
      };
    }
  );
}

export async function getDocumentSignedUrlAction(rawInput: {
  filePath: string;
  mode?: 'PREVIEW' | 'DOWNLOAD';
  downloadFileName?: string;
}) {
  return executeSafeServerAction(
    { module: 'transactions', action: 'getDocumentSignedUrlAction' },
    async () => {
      await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = getDocumentSignedUrlSchema.parse(rawInput);
      const data = await PrivateStorageService.createAuthorizedSignedUrl(
        validated.filePath,
        validated.mode === 'DOWNLOAD'
          ? { downloadFileName: validated.downloadFileName ?? 'dokumen-fim-property' }
          : undefined
      );
      return {
        message: 'Tautan dokumen berhasil dibuat (berlaku 5 menit).',
        data,
      };
    }
  );
}
