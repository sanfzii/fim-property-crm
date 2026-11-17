// Lokasi: src/modules/transactions/transactions.schemas.ts
// Level Topologis: L6-L9 (Validasi Input untuk Booking, Payment, Refund, KPR & Deal)

import { z } from 'zod';

export const createBookingSchema = z.object({
  leadId: z.string().uuid('ID Lead tidak valid.'),
  unitId: z.string().uuid('ID Unit tidak valid.'),
  paymentMethod: z.enum(['KPR', 'CASH_KERAS', 'CASH_BERTAHAP']),
  promoId: z.string().uuid().optional().nullable(),
  bookingFeeAmount: z.number().positive('Nominal Booking Fee wajib > Rp 0.'),
  isBookingFeePartOfDp: z.boolean().default(true),
  agreedDpTotalAmount: z.number().min(0).default(0),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const extendBookingExpirySchema = z.object({
  bookingId: z.string().uuid(),
  additionalHours: z.number().int().min(1).max(168).default(24),
  reason: z
    .string({ error: 'Alasan perpanjangan masa berlaku wajib diisi.' })
    .trim()
    .min(10, 'Alasan perpanjangan wajib minimal 10 karakter (OQ-03).')
    .max(500),
});

export const generateInstallmentSchedulesSchema = z.object({
  bookingId: z.string().uuid(),
  installmentCount: z
    .number()
    .int()
    .min(2, 'Cash Bertahap minimal terdiri dari 2 termin cicilan.')
    .max(60, 'Maksimal 60 termin cicilan.'),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD.'),
});

export const submitPaymentRecordSchema = z.object({
  bookingId: z.string().uuid(),
  paymentScheduleId: z.string().uuid(),
  paidAmount: z.number().positive('Nominal pembayaran harus > Rp 0.'),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD.'),
  paymentChannel: z.string().trim().min(2).max(60).default('BANK_TRANSFER'),
  replacesPaymentId: z.string().uuid().optional().nullable(),
  salesNotes: z.string().trim().max(500).optional().nullable(),
});

export const verifyPaymentRecordSchema = z
  .object({
    paymentRecordId: z.string().uuid(),
    decision: z.enum(['VERIFIED', 'REJECTED']),
    verificationNotes: z.string().trim().max(500).optional().nullable(),
    expiredBookingAction: z.enum(['EXPIRE_NOW', 'EXTEND_24H']).optional().nullable(),
    kprBankName: z.string().trim().min(2).max(100).default('Bank Mandiri'),
    kprTenorYears: z.number().int().min(1).max(35).default(15),
  })
  .refine(
    (data) =>
      data.decision !== 'REJECTED' ||
      (Boolean(data.verificationNotes) && data.verificationNotes!.trim().length >= 5),
    {
      message: 'Alasan penolakan wajib diisi minimal 5 karakter saat menolak bukti bayar.',
      path: ['verificationNotes'],
    }
  );

export const uploadKprDocumentSchema = z.object({
  bookingId: z.string().uuid('ID Booking tidak valid.'),
  kprApplicationId: z.string().uuid('ID Pengajuan KPR tidak valid.'),
  kprDocumentId: z.string().uuid('ID Item Dokumen KPR tidak valid.'),
  documentCode: z.string().trim().min(2).max(50).default('DOC'),
});

export const verifyKprDocumentSchema = z
  .object({
    kprDocumentId: z.string().uuid('ID Dokumen KPR tidak valid.'),
    decision: z.enum(['VERIFIED', 'REVISION_REQUIRED']),
    verificationNotes: z.string().trim().max(500).optional().nullable(),
  })
  .refine(
    (data) =>
      data.decision !== 'REVISION_REQUIRED' ||
      (Boolean(data.verificationNotes) && data.verificationNotes!.trim().length >= 5),
    {
      message: 'Catatan revisi minimal 5 karakter wajib diisi saat meminta perbaikan dokumen KPR.',
      path: ['verificationNotes'],
    }
  );

export const advanceKprPreApprovalStageSchema = z
  .object({
    kprApplicationId: z.string().uuid(),
    targetStage: z.enum([
      'DOCUMENT_COLLECTION',
      'DOCUMENT_VERIFICATION',
      'SUBMITTED',
      'BANK_VERIFICATION',
      'APPRAISAL',
      'ADDITIONAL_REQUIREMENTS',
      'AKAD_SCHEDULED',
    ]),
    akadScheduledAt: z.string().datetime().optional().nullable(),
    akadLocation: z.string().trim().max(200).optional().nullable(),
    notaryName: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.targetStage === 'AKAD_SCHEDULED' && !data.akadScheduledAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tanggal & waktu jadwal Akad wajib diisi saat masuk ke tahap AKAD_SCHEDULED.',
        path: ['akadScheduledAt'],
      });
    }
  });

export const recordKprApprovalSchema = z
  .object({
    kprApplicationId: z.string().uuid(),
    // Selaras dengan ENUM TX-04 rpc_record_kpr_approval ('APPROVED' | 'REJECTED_BY_BANK')
    decision: z.enum(['APPROVED', 'REJECTED_BY_BANK']),
    sp3kReferenceNumber: z.string().trim().max(80).optional().nullable(),
    approvedLoanAmount: z.number().positive().optional().nullable(),
    topupDpDueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD.')
      .optional()
      .nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === 'APPROVED') {
      if (!data.sp3kReferenceNumber || data.sp3kReferenceNumber.trim().length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Nomor referensi SP3K bank wajib diisi (minimal 3 karakter) saat KPR disetujui.',
          path: ['sp3kReferenceNumber'],
        });
      }
      if (!data.approvedLoanAmount || data.approvedLoanAmount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Nominal plafon kredit yang disetujui wajib > Rp 0.',
          path: ['approvedLoanAmount'],
        });
      }
    }
    if (data.decision === 'REJECTED_BY_BANK') {
      if (!data.notes || data.notes.trim().length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Catatan alasan penolakan bank wajib diisi minimal 5 karakter.',
          path: ['notes'],
        });
      }
    }
  });

export const cancelKprByCustomerSchema = z.object({
  kprApplicationId: z.string().uuid('ID Pengajuan KPR tidak valid.'),
  cancellationReason: z
    .string({ error: 'Alasan pembatalan oleh konsumen wajib diisi.' })
    .trim()
    .min(5, 'Alasan pembatalan minimal 5 karakter.')
    .max(500),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const recordKprDisbursementSchema = z.object({
  bookingId: z.string().uuid(),
  kprApplicationId: z.string().uuid(),
  trancheType: z.enum(['PRIMARY', 'SUBSEQUENT']),
  disbursementReference: z.string().trim().min(3).max(80),
  disbursedAmount: z.number().positive('Nominal pencairan harus > Rp 0.'),
  disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const transitionDealStatusSchema = z.object({
  bookingId: z.string().uuid(),
  dealId: z.string().uuid(),
  transitionAction: z.enum([
    'ACTIVATE_PPJB_CONTRACT',
    'RECORD_KPR_AKAD_COMPLETED',
    'FINALIZE_FULL_SETTLEMENT',
  ]),
  contractDocNumber: z.string().trim().max(80).optional().nullable(),
  notaryName: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const cancelBookingOrDealSchema = z.object({
  bookingId: z.string().uuid(),
  cancellationReason: z.string().trim().min(5, 'Alasan pembatalan minimal 5 karakter.').max(150),
  refundPolicyType: z.enum([
    'NONE',
    'FORFEITED_FULL',
    'FULL_REFUND',
    'PARTIAL_REFUND',
  ]),
  agreedRefundAmount: z.number().min(0).default(0),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const completeRefundTransactionSchema = z.object({
  bookingId: z.string().uuid(),
  refundTransactionId: z.string().uuid(),
  refundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  refundMethod: z.string().trim().min(2).max(60).default('BANK_TRANSFER'),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const getDocumentSignedUrlSchema = z.object({
  filePath: z.string().trim().min(1, 'Path dokumen wajib diisi.'),
  mode: z.enum(['PREVIEW', 'DOWNLOAD']).default('PREVIEW'),
  downloadFileName: z.string().trim().max(150).optional(),
});
