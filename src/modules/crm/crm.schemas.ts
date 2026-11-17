// Lokasi: src/modules/crm/crm.schemas.ts
// Level Topologis: L4-L6 (Validasi Input untuk Lead, Pipeline, Aktivitas, Follow-up & Site Visit)

import { z } from 'zod';

export const leadSourceSchema = z.enum([
  'INSTAGRAM_ADS',
  'FACEBOOK_ADS',
  'TIKTOK_ADS',
  'WEBSITE',
  'WALK_IN',
  'EXPO_EVENT',
  'REFERRAL',
  'OTHER',
]);

export const paymentMethodSchema = z.enum(['KPR', 'CASH_KERAS', 'CASH_BERTAHAP']);

export const purchaseTimelineSchema = z.enum([
  'IMMEDIATE_LT_1M',
  'SHORT_1_3M',
  'MEDIUM_3_6M',
  'LONG_GT_6M',
  'UNSPECIFIED',
]);

export const paymentReadinessSchema = z.enum([
  'READY_FULL_OR_DP_DOCS',
  'DP_READY_COLLECTING_DOCS',
  'SAVING_FOR_DP',
  'UNDECIDED',
]);

export const createLeadSchema = z.object({
  fullName: z.string().trim().min(2, 'Nama calon pembeli minimal 2 karakter.').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()-\s]{8,30}$/, 'Nomor telepon wajib berisi 8-30 digit angka yang valid.'),
  email: z.string().trim().email('Format email tidak valid.').max(150).optional().nullable(),
  occupation: z.string().trim().max(100).optional().nullable(),
  leadSource: leadSourceSchema,
  // Hanya digunakan jika dibuat oleh ADMIN atau SUPERVISOR; jika dibuat SALES akan di-override ke dirinya sendiri (OQ-01)
  assignedSalesId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  budgetAmount: z.number().min(0, 'Budget tidak boleh negatif.').default(0),
  preferredCity: z.string().trim().max(100).optional().nullable(),
  preferredProjectId: z.string().uuid().optional().nullable(),
  preferredPropertyTypeId: z.string().uuid().optional().nullable(),
  preferredPaymentMethod: paymentMethodSchema.optional().nullable(),
  purchaseTimeline: purchaseTimelineSchema.default('UNSPECIFIED'),
  paymentReadiness: paymentReadinessSchema.default('UNDECIDED'),
});

export const updateLeadQualificationSchema = z.object({
  leadId: z.string().uuid('ID Lead tidak valid.'),
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(150).optional().nullable(),
  occupation: z.string().trim().max(100).optional().nullable(),
  budgetAmount: z.number().min(0),
  preferredCity: z.string().trim().max(100).optional().nullable(),
  preferredProjectId: z.string().uuid().optional().nullable(),
  preferredPropertyTypeId: z.string().uuid().optional().nullable(),
  preferredPaymentMethod: paymentMethodSchema.optional().nullable(),
  purchaseTimeline: purchaseTimelineSchema,
  paymentReadiness: paymentReadinessSchema,
});

export const transitionLeadPipelineSchema = z
  .object({
    leadId: z.string().uuid(),
    targetStage: z.enum([
      'NEW',
      'CONTACTED',
      'QUALIFIED',
      'SITE_VISIT',
      'NEGOTIATION',
      'CLOSED_LOST',
    ]),
    notes: z.string().trim().max(500).optional().nullable(),
    lostReason: z.string().trim().max(150).optional().nullable(),
  })
  .refine(
    (data) =>
      data.targetStage !== 'CLOSED_LOST' ||
      (Boolean(data.lostReason) && data.lostReason!.trim().length >= 3),
    {
      message: 'Alasan gagal (Lost Reason) wajib diisi saat mengubah status ke CLOSED_LOST.',
      path: ['lostReason'],
    }
  );

export const logLeadActivitySchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(['WHATSAPP', 'PHONE_CALL', 'MEETING', 'VIDEO_CALL', 'EMAIL']),
  summary: z.string().trim().min(5, 'Ringkasan komunikasi minimal 5 karakter.').max(2000),
  customerResponse: z.enum(['RESPONSIVE_TWO_WAY', 'INITIAL_ONE_WAY', 'UNRESPONSIVE']),
});

export const createFollowUpTaskSchema = z.object({
  leadId: z.string().uuid('ID Lead tidak valid.'),
  assignedSalesId: z.string().uuid('ID Sales tidak valid.').optional(),
  relatedScheduleId: z.string().uuid('ID Jadwal Pembayaran tidak valid.').optional().nullable(),
  relatedKprApplicationId: z.string().uuid('ID Pengajuan KPR tidak valid.').optional().nullable(),
  title: z.string().trim().min(3, 'Judul tugas minimal 3 karakter.').max(150),
  description: z.string().trim().max(1000).optional().nullable(),
  dueAt: z.string().datetime({ message: 'Format waktu jatuh tempo harus ISO-8601.' }),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
});

export const completeFollowUpTaskSchema = z.object({
  taskId: z.string().uuid(),
  completionNotes: z
    .string({ error: 'Catatan hasil tindak lanjut wajib diisi.' })
    .trim()
    .min(5, 'Catatan hasil tindak lanjut minimal 5 karakter.')
    .max(1000),
});

export const scheduleSiteVisitSchema = z.object({
  leadId: z.string().uuid(),
  projectId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  scheduledAt: z.string().datetime(),
  preparationNotes: z.string().trim().max(1000).optional().nullable(),
});

export const completeSiteVisitSchema = z.object({
  siteVisitId: z.string().uuid(),
  customerInterestOutcome: z.enum([
    'POSITIVE_INTEREST',
    'NEUTRAL_CONSIDERATION',
    'NOT_SUITABLE',
  ]),
  evaluationNotes: z
    .string({ error: 'Evaluasi hasil kunjungan wajib diisi.' })
    .trim()
    .min(5, 'Evaluasi hasil survei minimal 5 karakter.')
    .max(2000),
});

export const reassignLeadSchema = z.object({
  leadId: z.string().uuid('ID Lead tidak valid.'),
  targetSalesId: z.string().uuid('ID Sales tujuan tidak valid.'),
  reason: z
    .string({ error: 'Alasan pemindahan Lead wajib diisi.' })
    .trim()
    .min(5, 'Alasan pemindahan Lead minimal 5 karakter.')
    .max(500),
});
