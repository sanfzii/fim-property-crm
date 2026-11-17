// Lokasi: src/types/database.types.ts
// Level Topologis: L0 (Shared Types & Contracts — 34 ENUM Final & Authenticated Session Context)
// Diselaraskan dengan File 02 v1.4 Bagian 8.1 & Keputusan Final TC-01A

// [ENUM 01] Role Sistem Utama (profiles)
export type SystemRole = 'ADMIN' | 'SUPERVISOR' | 'SALES';

// [ENUM 02] Peran Keanggotaan dalam Tim (team_memberships)
export type TeamMemberRole = 'TEAM_SUPERVISOR' | 'TEAM_SALES';

// [ENUM 03] Status Proyek Perumahan (property_projects)
export type ProjectStatus = 'PRE_LAUNCH' | 'ACTIVE_SELLING' | 'SOLD_OUT' | 'CLOSED';

// [ENUM 04] Status Inventaris Fisik Unit (units)
export type UnitStatus = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'SOLD';

// [ENUM 05] Klasifikasi Temperatur Prospek Lead (leads, lead_score_histories)
export type LeadTemperature = 'COLD' | 'WARM' | 'HOT';

// [ENUM 06] Tahapan Sales Pipeline (leads, lead_pipeline_histories)
export type PipelineStage =
  | 'NEW'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'SITE_VISIT'
  | 'NEGOTIATION'
  | 'BOOKING'
  | 'PAYMENT_KPR_PROCESS'
  | 'CLOSED_WON'
  | 'CLOSED_LOST';

// [ENUM 07] Status Kunjungan Survei Lokasi (site_visits)
export type SiteVisitStatus = 'SCHEDULED' | 'COMPLETED' | 'RESCHEDULED' | 'CANCELLED';

// [ENUM 08] Status Reservasi Booking (bookings)
export type BookingStatus = 'PENDING_FEE' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'COMPLETED';

// [ENUM 09] Status Jadwal Tagihan Pembayaran (payment_schedules)
export type ScheduleStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';

// [ENUM 10] Status Verifikasi Bukti Pembayaran Aktual (payment_records)
export type PaymentVerificationStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED';

// [ENUM 11] Status Transaksi Pengembalian Dana / Refund (refund_transactions)
export type RefundStatus = 'PENDING_REFUND' | 'COMPLETED' | 'CANCELLED';

// [ENUM 12] 10 Tahapan Workflow Pengajuan KPR Murni (kpr_applications, kpr_stage_histories)
export type KprStage =
  | 'DOCUMENT_COLLECTION'
  | 'DOCUMENT_VERIFICATION'
  | 'SUBMITTED'
  | 'BANK_VERIFICATION'
  | 'APPRAISAL'
  | 'ADDITIONAL_REQUIREMENTS'
  | 'APPROVED'
  | 'AKAD_SCHEDULED'
  | 'AKAD_COMPLETED'
  | 'DISBURSEMENT';

// [ENUM 13] Status Realisasi Pencairan Plafon KPR (kpr_applications)
export type KprDisbursementStatus = 'NOT_DISBURSED' | 'PARTIALLY_DISBURSED' | 'FULLY_DISBURSED';

// [ENUM 14] Jenis Program Promosi (promotions)
export type PromoType = 'NOMINAL_DISCOUNT' | 'PERCENTAGE_DISCOUNT' | 'FREE_BENEFIT';

// [ENUM 15] Sumber Perolehan Lead (leads)
export type LeadSource =
  | 'INSTAGRAM_ADS'
  | 'FACEBOOK_ADS'
  | 'TIKTOK_ADS'
  | 'WEBSITE'
  | 'WALK_IN'
  | 'EXPO_EVENT'
  | 'REFERRAL'
  | 'OTHER';

// [ENUM 16] Metode Pembiayaan Properti (leads, bookings, deals)
export type PaymentMethod = 'KPR' | 'CASH_KERAS' | 'CASH_BERTAHAP';

// [ENUM 17] Indikator 2 Lead Scoring: Target Waktu Pembelian (leads)
export type PurchaseTimeline =
  | 'IMMEDIATE_LT_1M'
  | 'SHORT_1_3M'
  | 'MEDIUM_3_6M'
  | 'LONG_GT_6M'
  | 'UNSPECIFIED';

// [ENUM 18] Indikator 3 Lead Scoring: Kesiapan Pembayaran & Dokumen (leads)
export type PaymentReadiness =
  | 'READY_FULL_OR_DP_DOCS'
  | 'DP_READY_COLLECTING_DOCS'
  | 'SAVING_FOR_DP'
  | 'UNDECIDED';

// [ENUM 19] Kanal Komunikasi Aktivitas Lead (lead_activities)
export type ActivityChannel = 'WHATSAPP' | 'PHONE_CALL' | 'MEETING' | 'VIDEO_CALL' | 'EMAIL';

// [ENUM 20] Respons Interaksi Calon Pembeli (lead_activities)
export type InteractionResponse = 'RESPONSIVE_TWO_WAY' | 'INITIAL_ONE_WAY' | 'UNRESPONSIVE';

// [ENUM 21] Tingkat Prioritas Tugas Follow-up (follow_up_tasks)
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

// [ENUM 22] Sumber Pembuatan Tugas Follow-up (follow_up_tasks)
export type TaskSource = 'MANUAL_SALES' | 'SUPERVISOR_INSTRUCTION' | 'PAYMENT_REMINDER_SYSTEM';

// [ENUM 23] Status Pengerjaan Tugas Follow-up (follow_up_tasks)
export type TaskStatus = 'PENDING' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED';

// [ENUM 24] Hasil Evaluasi Ketertarikan Pasca-Survei Lokasi (site_visits)
export type SiteVisitOutcome = 'POSITIVE_INTEREST' | 'NEUTRAL_CONSIDERATION' | 'NOT_SUITABLE';

// [ENUM 25] Kebijakan Resolusi Dana Saat Pembatalan Transaksi (bookings)
export type RefundPolicy = 'NONE' | 'FORFEITED_FULL' | 'FULL_REFUND' | 'PARTIAL_REFUND';

// [ENUM 26] Jenis Termin Jadwal Tagihan Pembayaran (payment_schedules)
export type ScheduleType =
  | 'BOOKING_FEE'
  | 'DOWN_PAYMENT'
  | 'INSTALLMENT'
  | 'FINAL_SETTLEMENT'
  | 'KPR_TOPUP_DP';

// [ENUM 27] Status Kelengkapan & Verifikasi Dokumen KPR (kpr_documents)
export type KprDocStatus = 'MISSING' | 'UPLOADED' | 'VERIFIED' | 'REVISION_REQUIRED';

// [ENUM 28] Jenis Tahap Pencairan Bank KPR (kpr_disbursements)
export type DisbursementTranche = 'PRIMARY' | 'SUBSEQUENT';

// [ENUM 29] Dimensi 1 Deal: Sales Outcome Status (deals)
export type DealSalesOutcome = 'IN_PROGRESS' | 'CLOSED_WON' | 'CANCELLED_FAILED';

// [ENUM 30] Dimensi 2 Deal: Contract Status (deals)
export type DealContractStatus =
  | 'PRE_CONTRACT'
  | 'UNDER_CONTRACT'
  | 'CONTRACT_COMPLETED'
  | 'CONTRACT_TERMINATED';

// [ENUM 31] Dimensi 3 Deal: Payment Settlement Status (deals)
export type DealSettlementStatus =
  | 'BOOKING_FEE_SETTLED'
  | 'DP_SETTLED_ONGOING'
  | 'OVERDUE_IN_ARREARS'
  | 'DISBURSED_RETENTION_PENDING'
  | 'FULLY_SETTLED'
  | 'TERMINATED';

// [ENUM 32] Status Pemrosesan Transactional Outbox (notification_outbox)
export type OutboxStatus = 'PENDING' | 'PROCESSED' | 'FAILED_RETRYABLE' | 'DEAD_LETTER';

// [ENUM 33] Jenis Notifikasi Internal Aplikasi (notifications)
export type NotificationType =
  | 'FOLLOW_UP_REMINDER'
  | 'SITE_VISIT_REMINDER'
  | 'BOOKING_FEE_DUE'
  | 'DP_DUE'
  | 'INSTALLMENT_DUE'
  | 'PAYMENT_OVERDUE'
  | 'KPR_DOCUMENT_UPDATE'
  | 'KPR_AKAD_SCHEDULED'
  | 'UNIT_PRICE_CHANGED'
  | 'NEW_PROMO_LAUNCHED'
  | 'BOOKING_EXPIRY_ALERT'
  | 'PAYMENT_VERIFICATION_ESCALATION'
  | 'LEAD_ASSIGNED'
  | 'PAYMENT_VERIFICATION_RESULT';

// [ENUM 34] Status Lifecycle & Keputusan Akhir Pengajuan KPR (kpr_applications)
export type KprApplicationStatus =
  | 'IN_PROGRESS'
  | 'APPROVED'
  | 'REJECTED_BY_BANK'
  | 'CANCELLED_BY_CUSTOMER'
  | 'BOOKING_CANCELLED'
  | 'COMPLETED';

/**
 * Keputusan Bisnis Final (TC-01A):
 * Unit pada transaksi KPR dengan pencairan bertahap berubah menjadi SOLD saat pencairan mencapai 100% (FULLY_DISBURSED).
 */
export type KprSoldPolicyMode = 'TC-01A';

export interface AuthenticatedUserContext {
  userId: string;
  email: string;
  fullName: string;
  systemRole: SystemRole;
  isActive: boolean;
  activeTeamId: string | null;
  activeTeamCode: string | null;
  activeTeamName: string | null;
  membershipRole: TeamMemberRole | null;
}
