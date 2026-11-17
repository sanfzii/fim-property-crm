-- ============================================================================
-- FILE: supabase/migrations/20260301000100_extensions_and_enums.sql
-- TUJUAN: Inisialisasi ekstensi, fungsi trigger updated_at, dan 34 tipe ENUM
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 + Revisi KPR v1.2
-- ============================================================================

BEGIN;

-- 1. Aktifkan ekstensi pgcrypto untuk gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Siapkan schema privat app_security untuk tahap implementasi RLS & RPC nanti
CREATE SCHEMA IF NOT EXISTS app_security;
REVOKE ALL ON SCHEMA app_security FROM PUBLIC;

-- 3. Fungsi trigger reusable untuk memperbarui kolom updated_at secara otomatis
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. PEMBUATAN SELURUH 34 TIPE ENUM (SESUAI INVENTARIS BAGIAN 8.1)
-- ============================================================================

-- [ENUM 01] Role Sistem Utama (profiles)
CREATE TYPE public.system_role_enum AS ENUM (
    'ADMIN',
    'SUPERVISOR',
    'SALES'
);

-- [ENUM 02] Peran Keanggotaan dalam Tim (team_memberships)
CREATE TYPE public.team_member_role_enum AS ENUM (
    'TEAM_SUPERVISOR',
    'TEAM_SALES'
);

-- [ENUM 03] Status Proyek Perumahan (property_projects)
CREATE TYPE public.project_status_enum AS ENUM (
    'PRE_LAUNCH',
    'ACTIVE_SELLING',
    'SOLD_OUT',
    'CLOSED'
);

-- [ENUM 04] Status Inventaris Fisik Unit (units)
CREATE TYPE public.unit_status_enum AS ENUM (
    'AVAILABLE',
    'HELD',
    'BOOKED',
    'SOLD'
);

-- [ENUM 05] Klasifikasi Temperatur Prospek Lead (leads, lead_score_histories)
-- Catatan: Dihitung secara deterministik berbasis aturan bisnis (OQ-04), bukan ML.
CREATE TYPE public.lead_temperature_enum AS ENUM (
    'COLD',
    'WARM',
    'HOT'
);

-- [ENUM 06] Tahapan Sales Pipeline (leads, lead_pipeline_histories)
CREATE TYPE public.pipeline_stage_enum AS ENUM (
    'NEW',
    'CONTACTED',
    'QUALIFIED',
    'SITE_VISIT',
    'NEGOTIATION',
    'BOOKING',
    'PAYMENT_KPR_PROCESS',
    'CLOSED_WON',
    'CLOSED_LOST'
);

-- [ENUM 07] Status Kunjungan Survei Lokasi (site_visits)
CREATE TYPE public.site_visit_status_enum AS ENUM (
    'SCHEDULED',
    'COMPLETED',
    'RESCHEDULED',
    'CANCELLED'
);

-- [ENUM 08] Status Reservasi Booking (bookings)
CREATE TYPE public.booking_status_enum AS ENUM (
    'PENDING_FEE',
    'ACTIVE',
    'EXPIRED',
    'CANCELLED',
    'COMPLETED'
);

-- [ENUM 09] Status Jadwal Tagihan Transaksi Properti (payment_schedules)
CREATE TYPE public.schedule_status_enum AS ENUM (
    'UNPAID',
    'PARTIALLY_PAID',
    'PAID',
    'OVERDUE',
    'CANCELLED'
);

-- [ENUM 10] Status Verifikasi Bukti Pembayaran Aktual (payment_records)
CREATE TYPE public.payment_verification_enum AS ENUM (
    'PENDING_VERIFICATION',
    'VERIFIED',
    'REJECTED'
);

-- [ENUM 11] Status Transaksi Pengembalian Dana / Refund (refund_transactions)
CREATE TYPE public.refund_status_enum AS ENUM (
    'PENDING_REFUND',
    'COMPLETED',
    'CANCELLED'
);

-- [ENUM 12] 10 Tahapan Proses Workflow Pengajuan KPR s/d Pencairan Dana Bank (kpr_applications, kpr_stage_histories)
-- Catatan: Murni merepresentasikan tahapan proses pengajuan (bukan hasil penolakan/pembatalan
-- yang kini dipisahkan ke kpr_application_status_enum, dan bukan cicilan bulanan bank).
CREATE TYPE public.kpr_stage_enum AS ENUM (
    'DOCUMENT_COLLECTION',
    'DOCUMENT_VERIFICATION',
    'SUBMITTED',
    'BANK_VERIFICATION',
    'APPRAISAL',
    'ADDITIONAL_REQUIREMENTS',
    'APPROVED',
    'AKAD_SCHEDULED',
    'AKAD_COMPLETED',
    'DISBURSEMENT'
);

-- [ENUM 13] Status Realisasi Pencairan Plafon KPR (kpr_applications)
CREATE TYPE public.kpr_disbursement_status_enum AS ENUM (
    'NOT_DISBURSED',
    'PARTIALLY_DISBURSED',
    'FULLY_DISBURSED'
);

-- [ENUM 14] Jenis Program Promosi (promotions)
CREATE TYPE public.promo_type_enum AS ENUM (
    'NOMINAL_DISCOUNT',
    'PERCENTAGE_DISCOUNT',
    'FREE_BENEFIT'
);

-- [ENUM 15] Sumber Perolehan Lead (leads)
CREATE TYPE public.lead_source_enum AS ENUM (
    'INSTAGRAM_ADS',
    'FACEBOOK_ADS',
    'TIKTOK_ADS',
    'WEBSITE',
    'WALK_IN',
    'EXPO_EVENT',
    'REFERRAL',
    'OTHER'
);

-- [ENUM 16] Metode Pembiayaan Properti (leads, bookings, deals)
CREATE TYPE public.payment_method_enum AS ENUM (
    'KPR',
    'CASH_KERAS',
    'CASH_BERTAHAP'
);

-- [ENUM 17] Indikator 2 Lead Scoring: Target Waktu Pembelian (leads)
CREATE TYPE public.purchase_timeline_enum AS ENUM (
    'IMMEDIATE_LT_1M',
    'SHORT_1_3M',
    'MEDIUM_3_6M',
    'LONG_GT_6M',
    'UNSPECIFIED'
);

-- [ENUM 18] Indikator 3 Lead Scoring: Kesiapan Pembayaran & Dokumen (leads)
CREATE TYPE public.payment_readiness_enum AS ENUM (
    'READY_FULL_OR_DP_DOCS',
    'DP_READY_COLLECTING_DOCS',
    'SAVING_FOR_DP',
    'UNDECIDED'
);

-- [ENUM 19] Kanal Komunikasi Aktivitas Lead (lead_activities)
CREATE TYPE public.activity_channel_enum AS ENUM (
    'WHATSAPP',
    'PHONE_CALL',
    'MEETING',
    'VIDEO_CALL',
    'EMAIL'
);

-- [ENUM 20] Respons Interaksi Calon Pembeli (lead_activities)
CREATE TYPE public.interaction_response_enum AS ENUM (
    'RESPONSIVE_TWO_WAY',
    'INITIAL_ONE_WAY',
    'UNRESPONSIVE'
);

-- [ENUM 21] Tingkat Prioritas Tugas Follow-up (follow_up_tasks)
CREATE TYPE public.task_priority_enum AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH'
);

-- [ENUM 22] Sumber Pembuatan Tugas Follow-up (follow_up_tasks)
CREATE TYPE public.task_source_enum AS ENUM (
    'MANUAL_SALES',
    'SUPERVISOR_INSTRUCTION',
    'PAYMENT_REMINDER_SYSTEM'
);

-- [ENUM 23] Status Pengerjaan Tugas Follow-up (follow_up_tasks)
CREATE TYPE public.task_status_enum AS ENUM (
    'PENDING',
    'COMPLETED',
    'OVERDUE',
    'CANCELLED'
);

-- [ENUM 24] Hasil Evaluasi Ketertarikan Pasca-Survei Lokasi (site_visits)
CREATE TYPE public.site_visit_outcome_enum AS ENUM (
    'POSITIVE_INTEREST',
    'NEUTRAL_CONSIDERATION',
    'NOT_SUITABLE'
);

-- [ENUM 25] Kebijakan Resolusi Dana Saat Pembatalan Transaksi (bookings)
CREATE TYPE public.refund_policy_enum AS ENUM (
    'NONE',
    'FORFEITED_FULL',
    'FULL_REFUND',
    'PARTIAL_REFUND'
);

-- [ENUM 26] Jenis Termin Jadwal Tagihan Pembayaran Transaksi Properti (payment_schedules)
-- PENTING: Nilai 'INSTALLMENT' digunakan EKSKLUSIF untuk termin cicilan metode CASH_BERTAHAP
-- kepada perusahaan/developer, BUKAN cicilan bulanan KPR ke bank.
CREATE TYPE public.schedule_type_enum AS ENUM (
    'BOOKING_FEE',
    'DOWN_PAYMENT',
    'INSTALLMENT',
    'FINAL_SETTLEMENT',
    'KPR_TOPUP_DP'
);

-- [ENUM 27] Status Kelengkapan & Verifikasi Dokumen KPR (kpr_documents)
CREATE TYPE public.kpr_doc_status_enum AS ENUM (
    'MISSING',
    'UPLOADED',
    'VERIFIED',
    'REVISION_REQUIRED'
);

-- [ENUM 28] Jenis Tahap Pencairan Dana Kredit KPR dari Bank (kpr_disbursements)
CREATE TYPE public.disbursement_tranche_enum AS ENUM (
    'PRIMARY',
    'SUBSEQUENT'
);

-- [ENUM 29] Dimensi 1 Deal: Sales Outcome Status (deals)
CREATE TYPE public.deal_sales_outcome_enum AS ENUM (
    'IN_PROGRESS',
    'CLOSED_WON',
    'CANCELLED_FAILED'
);

-- [ENUM 30] Dimensi 2 Deal: Contract Status (deals)
CREATE TYPE public.deal_contract_status_enum AS ENUM (
    'PRE_CONTRACT',
    'UNDER_CONTRACT',
    'CONTRACT_COMPLETED',
    'CONTRACT_TERMINATED'
);

-- [ENUM 31] Dimensi 3 Deal: Payment Settlement Status (deals)
-- Catatan: 'OVERDUE_IN_ARREARS' merujuk pada tunggakan kewajiban DP / Cash Bertahap di CRM,
-- bukan tunggakan cicilan KPR bulanan ke bank.
CREATE TYPE public.deal_settlement_status_enum AS ENUM (
    'BOOKING_FEE_SETTLED',
    'DP_SETTLED_ONGOING',
    'OVERDUE_IN_ARREARS',
    'DISBURSED_RETENTION_PENDING',
    'FULLY_SETTLED',
    'TERMINATED'
);

-- [ENUM 32] Status Pemrosesan Transactional Outbox (notification_outbox)
CREATE TYPE public.outbox_status_enum AS ENUM (
    'PENDING',
    'PROCESSED',
    'FAILED_RETRYABLE',
    'DEAD_LETTER'
);

-- [ENUM 33] Jenis Notifikasi Internal Aplikasi (notifications)
-- Catatan: 'INSTALLMENT_DUE' dan 'PAYMENT_OVERDUE' hanya untuk jadwal payment_schedules CRM (Cash Bertahap/DP/Booking/Pelunasan).
CREATE TYPE public.notification_type_enum AS ENUM (
    'FOLLOW_UP_REMINDER',
    'SITE_VISIT_REMINDER',
    'BOOKING_FEE_DUE',
    'DP_DUE',
    'INSTALLMENT_DUE',
    'PAYMENT_OVERDUE',
    'KPR_DOCUMENT_UPDATE',
    'KPR_AKAD_SCHEDULED',
    'UNIT_PRICE_CHANGED',
    'NEW_PROMO_LAUNCHED',
    'BOOKING_EXPIRY_ALERT',
    'PAYMENT_VERIFICATION_ESCALATION',
    'LEAD_ASSIGNED',
    'PAYMENT_VERIFICATION_RESULT'
);

-- [ENUM 34] Status Lifecycle & Keputusan Akhir Pengajuan KPR (kpr_applications)
-- Memisahkan kondisi/hasil pengajuan dari current_stage (tahap proses) dan disbursement_status:
-- - IN_PROGRESS           : Pengajuan KPR sedang berjalan pra-persetujuan SP3K
-- - APPROVED              : Bank menyetujui kredit (SP3K terbit), proses Akad/Pencairan berjalan
-- - REJECTED_BY_BANK      : Pengajuan KPR ditolak oleh pihak bank
-- - CANCELLED_BY_CUSTOMER : Pengajuan KPR dibatalkan atas inisiatif konsumen
-- - BOOKING_CANCELLED     : Pengajuan KPR berhenti karena Booking dibatalkan oleh perusahaan
-- - COMPLETED             : Pengajuan KPR tuntas selesai setelah pencairan dana bank 100%
CREATE TYPE public.kpr_application_status_enum AS ENUM (
    'IN_PROGRESS',
    'APPROVED',
    'REJECTED_BY_BANK',
    'CANCELLED_BY_CUSTOMER',
    'BOOKING_CANCELLED',
    'COMPLETED'
);

COMMIT;
