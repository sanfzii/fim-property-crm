-- ============================================================================
-- FILE: supabase/migrations/20260301000500_transaction_finance_kpr_deal_tables.sql
-- TUJUAN: Pembuatan seluruh tabel Domain D (Transaksi, Payment, KPR, Deal) + follow_up_tasks
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 + Revisi KPR v1.2
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- [Tabel 17] bookings
-- Reservasi unit (BK-YYYYMM-XXXX), Price Freeze Snapshot (BR-07), & Resolusi Batal (PD-04)
-- ----------------------------------------------------------------------------
CREATE TABLE public.bookings (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    reference_number VARCHAR(30) NOT NULL,
    lead_id UUID NOT NULL,
    unit_id UUID NOT NULL,
    origin_sales_id UUID NOT NULL,
    current_sales_id UUID NOT NULL,
    team_id UUID NOT NULL,
    payment_method public.payment_method_enum NOT NULL,
    promo_id UUID NULL,
    catalog_price_snapshot NUMERIC(15,2) NOT NULL,
    promo_discount_snapshot NUMERIC(15,2) NOT NULL DEFAULT 0,
    agreed_final_price NUMERIC(15,2) NOT NULL,
    booking_fee_amount NUMERIC(15,2) NOT NULL,
    is_booking_fee_part_of_dp BOOLEAN NOT NULL DEFAULT true,
    agreed_dp_total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    status public.booking_status_enum NOT NULL DEFAULT 'PENDING_FEE',
    booked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    cancellation_reason VARCHAR(150) NULL,
    refund_policy_type public.refund_policy_enum NULL,
    agreed_refund_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    forfeited_retained_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_bookings PRIMARY KEY (id),
    CONSTRAINT uq_bookings_reference_number UNIQUE (reference_number),
    -- Constraint unik komposit untuk mendukung CST-06 pada tabel deals (Refinement v1.1 #9)
    CONSTRAINT uq_bookings_id_lead_unit UNIQUE (id, lead_id, unit_id),
    CONSTRAINT fk_bookings_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_unit
        FOREIGN KEY (unit_id) REFERENCES public.units(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_origin_sales
        FOREIGN KEY (origin_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_current_sales
        FOREIGN KEY (current_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_team
        FOREIGN KEY (team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_promo
        FOREIGN KEY (promo_id) REFERENCES public.promotions(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- CST-08: Validasi matematika harga kesepakatan, booking fee, DP, dan dana pembatalan
    CONSTRAINT chk_bookings_price_math CHECK (
        catalog_price_snapshot > 0
        AND promo_discount_snapshot >= 0
        AND agreed_final_price = catalog_price_snapshot - promo_discount_snapshot
        AND agreed_final_price > 0
        AND booking_fee_amount > 0
        AND booking_fee_amount < agreed_final_price
        AND agreed_dp_total_amount >= 0
        AND agreed_dp_total_amount < agreed_final_price
        AND agreed_refund_amount >= 0
        AND forfeited_retained_amount >= 0
    )
);

-- CST-03: Pencegahan Mutlak Double Booking (Maksimal 1 Booking berstatus PENDING_FEE atau ACTIVE per Unit)
CREATE UNIQUE INDEX uq_one_active_booking_per_unit
    ON public.bookings(unit_id)
    WHERE status IN ('PENDING_FEE', 'ACTIVE');

-- ----------------------------------------------------------------------------
-- [Tabel 18] booking_extensions
-- Riwayat perpanjangan masa berlaku Booking oleh Admin beserta alasan wajib (OQ-03)
-- ----------------------------------------------------------------------------
CREATE TABLE public.booking_extensions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL,
    old_expires_at TIMESTAMPTZ NOT NULL,
    new_expires_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    extended_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_booking_extensions PRIMARY KEY (id),
    CONSTRAINT fk_booking_extensions_booking
        FOREIGN KEY (booking_id) REFERENCES public.bookings(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_booking_extensions_extended_by
        FOREIGN KEY (extended_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_booking_extensions_dates CHECK (new_expires_at > old_expires_at),
    CONSTRAINT chk_booking_extensions_reason CHECK (char_length(trim(reason)) >= 10)
);

-- ----------------------------------------------------------------------------
-- [Tabel 19] payment_schedules
-- Jadwal jatuh tempo pembayaran transaksi properti kepada perusahaan/developer:
-- Booking Fee, DP, Termin Cash Bertahap (INSTALLMENT), Pelunasan Cash Keras, & KPR Top-up DP.
-- Catatan: TIDAK digunakan untuk cicilan bulanan KPR konsumen kepada bank.
-- ----------------------------------------------------------------------------
CREATE TABLE public.payment_schedules (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL,
    schedule_type public.schedule_type_enum NOT NULL,
    installment_number SMALLINT NOT NULL DEFAULT 1,
    title VARCHAR(120) NOT NULL,
    scheduled_amount NUMERIC(15,2) NOT NULL,
    verified_paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    remaining_amount NUMERIC(15,2) NOT NULL,
    due_date DATE NOT NULL,
    status public.schedule_status_enum NOT NULL DEFAULT 'UNPAID',
    paid_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_payment_schedules PRIMARY KEY (id),
    -- Constraint unik komposit untuk mendukung CST-05 pada payment_records (Refinement v1.1 #3)
    CONSTRAINT uq_payment_schedules_id_booking UNIQUE (id, booking_id),
    CONSTRAINT uq_payment_schedules_booking_type_inst UNIQUE (booking_id, schedule_type, installment_number),
    CONSTRAINT fk_payment_schedules_booking
        FOREIGN KEY (booking_id) REFERENCES public.bookings(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_payment_schedules_installment CHECK (installment_number >= 1),
    -- CST-09: Validasi rekonsiliasi tagihan vs pembayaran terverifikasi vs sisa tagihan
    CONSTRAINT chk_payment_schedules_amounts CHECK (
        scheduled_amount > 0
        AND verified_paid_amount >= 0
        AND verified_paid_amount <= scheduled_amount
        AND remaining_amount = scheduled_amount - verified_paid_amount
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 20] payment_records
-- Catatan pembayaran aktual transaksi properti (PAY-YYYYMM-XXXX), SLA Verifikasi 24/48 jam (PD-01)
-- Bersifat Immutable: bukti bayar yang REJECTED tetap disimpan dan dikoreksi lewat replaces_payment_id
-- ----------------------------------------------------------------------------
CREATE TABLE public.payment_records (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    reference_number VARCHAR(30) NOT NULL,
    booking_id UUID NOT NULL,
    payment_schedule_id UUID NOT NULL,
    submitted_by_sales_id UUID NOT NULL,
    paid_amount NUMERIC(15,2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_channel VARCHAR(60) NOT NULL DEFAULT 'BANK_TRANSFER',
    proof_file_path TEXT NOT NULL,
    proof_file_name VARCHAR(255) NOT NULL,
    replaces_payment_id UUID NULL,
    verification_status public.payment_verification_enum NOT NULL DEFAULT 'PENDING_VERIFICATION',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    verification_sla_due_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
    verified_by_admin_id UUID NULL,
    verified_at TIMESTAMPTZ NULL,
    verification_notes TEXT NULL,
    sales_notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_payment_records PRIMARY KEY (id),
    CONSTRAINT uq_payment_records_reference_number UNIQUE (reference_number),
    CONSTRAINT fk_payment_records_booking
        FOREIGN KEY (booking_id) REFERENCES public.bookings(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- CST-05 (Refinement v1.1 #3): Menjamin payment_schedule_id adalah milik booking_id yang sama
    CONSTRAINT fk_payment_records_schedule_booking
        FOREIGN KEY (payment_schedule_id, booking_id)
        REFERENCES public.payment_schedules(id, booking_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_payment_records_submitted_by
        FOREIGN KEY (submitted_by_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_payment_records_replaces
        FOREIGN KEY (replaces_payment_id) REFERENCES public.payment_records(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_payment_records_verified_by
        FOREIGN KEY (verified_by_admin_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_payment_records_amount CHECK (paid_amount > 0),
    CONSTRAINT chk_payment_records_verification CHECK (
        (verification_status = 'PENDING_VERIFICATION' AND verified_by_admin_id IS NULL AND verified_at IS NULL)
        OR (verification_status = 'VERIFIED' AND verified_by_admin_id IS NOT NULL AND verified_at IS NOT NULL)
        OR (
            verification_status = 'REJECTED'
            AND verified_by_admin_id IS NOT NULL
            AND verified_at IS NOT NULL
            AND verification_notes IS NOT NULL
        )
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 21] refund_transactions
-- Pencatatan pencairan pengembalian dana pembatalan (REF-YYYYMM-XXXX) secara terpisah (PD-04)
-- ----------------------------------------------------------------------------
CREATE TABLE public.refund_transactions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    reference_number VARCHAR(30) NOT NULL,
    booking_id UUID NOT NULL,
    refund_amount NUMERIC(15,2) NOT NULL,
    refund_date DATE NULL,
    refund_method VARCHAR(60) NOT NULL DEFAULT 'BANK_TRANSFER',
    proof_file_path TEXT NULL,
    status public.refund_status_enum NOT NULL DEFAULT 'PENDING_REFUND',
    processed_by_admin_id UUID NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_refund_transactions PRIMARY KEY (id),
    CONSTRAINT uq_refund_transactions_reference_number UNIQUE (reference_number),
    CONSTRAINT fk_refund_transactions_booking
        FOREIGN KEY (booking_id) REFERENCES public.bookings(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_refund_transactions_processed_by
        FOREIGN KEY (processed_by_admin_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_refund_transactions_amount CHECK (refund_amount > 0),
    CONSTRAINT chk_refund_transactions_completed CHECK (
        status <> 'COMPLETED'
        OR (refund_date IS NOT NULL AND proof_file_path IS NOT NULL)
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 22] kpr_bank_requirements
-- Master template persyaratan dokumen KPR berdasarkan kebijakan masing-masing Bank (OQ-06)
-- ----------------------------------------------------------------------------
CREATE TABLE public.kpr_bank_requirements (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    bank_name VARCHAR(100) NOT NULL,
    document_code VARCHAR(40) NOT NULL,
    document_name VARCHAR(150) NOT NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT true,
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_kpr_bank_requirements PRIMARY KEY (id),
    CONSTRAINT uq_kpr_bank_requirements_bank_code UNIQUE (bank_name, document_code)
);

-- ----------------------------------------------------------------------------
-- [Tabel 23] kpr_applications
-- Pemantauan progres pengajuan KPR 10 Tahap (KPR-YYYYMM-XXXX) dari persiapan
-- dokumen hingga pencairan dana bank (Persetujuan, Akad & Pencairan Bertahap).
-- Memisahkan secara tegas:
-- 1. current_stage      : Tahapan proses workflow pengajuan KPR (10 tahap murni)
-- 2. application_status : Kondisi/hasil pengajuan (IN_PROGRESS, APPROVED,
--                         REJECTED_BY_BANK, CANCELLED_BY_CUSTOMER,
--                         BOOKING_CANCELLED, COMPLETED)
-- 3. disbursement_status: Realisasi pencairan dana kredit bank (NOT/PARTIALLY/FULLY)
-- Catatan: TIDAK menyimpan cicilan KPR bulanan maupun tunggakan cicilan bank.
-- ----------------------------------------------------------------------------
CREATE TABLE public.kpr_applications (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    reference_number VARCHAR(30) NOT NULL,
    booking_id UUID NOT NULL,
    current_sales_id UUID NOT NULL,
    team_id UUID NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    requested_loan_amount NUMERIC(15,2) NOT NULL,
    tenor_years SMALLINT NOT NULL DEFAULT 15,
    current_stage public.kpr_stage_enum NOT NULL DEFAULT 'DOCUMENT_COLLECTION',
    application_status public.kpr_application_status_enum NOT NULL DEFAULT 'IN_PROGRESS',
    requires_appraisal BOOLEAN NOT NULL DEFAULT true,
    requires_additional_docs BOOLEAN NOT NULL DEFAULT false,
    submitted_to_bank_at TIMESTAMPTZ NULL,
    approved_at TIMESTAMPTZ NULL,
    sp3k_reference_number VARCHAR(80) NULL,
    approved_loan_amount NUMERIC(15,2) NULL,
    rejected_at TIMESTAMPTZ NULL,
    rejection_reason TEXT NULL,
    cancelled_at TIMESTAMPTZ NULL,
    cancellation_reason TEXT NULL,
    akad_scheduled_at TIMESTAMPTZ NULL,
    akad_location VARCHAR(200) NULL,
    notary_name VARCHAR(120) NULL,
    akad_completed_at TIMESTAMPTZ NULL,
    akad_deed_number VARCHAR(80) NULL,
    disbursement_status public.kpr_disbursement_status_enum NOT NULL DEFAULT 'NOT_DISBURSED',
    primary_disbursed_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    subsequent_disbursed_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    remaining_undisbursed_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    first_disbursed_at TIMESTAMPTZ NULL,
    fully_disbursed_at TIMESTAMPTZ NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_kpr_applications PRIMARY KEY (id),
    CONSTRAINT uq_kpr_applications_reference_number UNIQUE (reference_number),
    CONSTRAINT uq_kpr_applications_booking UNIQUE (booking_id),
    CONSTRAINT fk_kpr_applications_booking
        FOREIGN KEY (booking_id) REFERENCES public.bookings(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_kpr_applications_sales
        FOREIGN KEY (current_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_kpr_applications_team
        FOREIGN KEY (team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_kpr_applications_request CHECK (
        requested_loan_amount > 0 AND tenor_years BETWEEN 1 AND 35
    ),
    -- CST-10: Rekonsiliasi ketat plafon KPR yang disetujui terhadap realisasi pencairan dan disbursement_status
    CONSTRAINT chk_kpr_applications_loan_reconciliation CHECK (
        (
            disbursement_status = 'NOT_DISBURSED'
            AND primary_disbursed_amount = 0
            AND subsequent_disbursed_amount = 0
            AND fully_disbursed_at IS NULL
            AND (
                (
                    approved_loan_amount IS NULL
                    AND remaining_undisbursed_amount = 0
                )
                OR (
                    approved_loan_amount IS NOT NULL
                    AND approved_loan_amount > 0
                    AND approved_loan_amount <= requested_loan_amount
                    AND remaining_undisbursed_amount = approved_loan_amount
                )
            )
        )
        OR (
            disbursement_status = 'PARTIALLY_DISBURSED'
            AND approved_loan_amount IS NOT NULL
            AND approved_loan_amount > 0
            AND approved_loan_amount <= requested_loan_amount
            AND primary_disbursed_amount >= 0
            AND subsequent_disbursed_amount >= 0
            AND (primary_disbursed_amount + subsequent_disbursed_amount) > 0
            AND remaining_undisbursed_amount > 0
            AND (primary_disbursed_amount + subsequent_disbursed_amount + remaining_undisbursed_amount = approved_loan_amount)
            AND fully_disbursed_at IS NULL
        )
        OR (
            disbursement_status = 'FULLY_DISBURSED'
            AND approved_loan_amount IS NOT NULL
            AND approved_loan_amount > 0
            AND approved_loan_amount <= requested_loan_amount
            AND primary_disbursed_amount >= 0
            AND subsequent_disbursed_amount >= 0
            AND (primary_disbursed_amount + subsequent_disbursed_amount = approved_loan_amount)
            AND remaining_undisbursed_amount = 0
            AND fully_disbursed_at IS NOT NULL
            AND application_status = 'COMPLETED'
        )
    ),
    -- Menjaga keselarasan tegas antara current_stage, application_status, dan disbursement_status
    CONSTRAINT chk_kpr_applications_status_consistency CHECK (
        (
            application_status = 'IN_PROGRESS'
            AND approved_at IS NULL
            AND rejected_at IS NULL
            AND cancelled_at IS NULL
            AND disbursement_status = 'NOT_DISBURSED'
            AND current_stage IN (
                'DOCUMENT_COLLECTION',
                'DOCUMENT_VERIFICATION',
                'SUBMITTED',
                'BANK_VERIFICATION',
                'APPRAISAL',
                'ADDITIONAL_REQUIREMENTS'
            )
        )
        OR (
            application_status = 'APPROVED'
            AND approved_at IS NOT NULL
            AND approved_loan_amount IS NOT NULL
            AND rejected_at IS NULL
            AND cancelled_at IS NULL
            AND disbursement_status IN ('NOT_DISBURSED', 'PARTIALLY_DISBURSED')
            AND current_stage IN ('APPROVED', 'AKAD_SCHEDULED', 'AKAD_COMPLETED', 'DISBURSEMENT')
        )
        OR (
            application_status = 'REJECTED_BY_BANK'
            AND rejected_at IS NOT NULL
            AND rejection_reason IS NOT NULL
            AND char_length(trim(rejection_reason)) >= 5
            AND approved_at IS NULL
            AND cancelled_at IS NULL
            AND disbursement_status = 'NOT_DISBURSED'
            AND current_stage IN (
                'SUBMITTED',
                'BANK_VERIFICATION',
                'APPRAISAL',
                'ADDITIONAL_REQUIREMENTS'
            )
        )
        OR (
            application_status IN ('CANCELLED_BY_CUSTOMER', 'BOOKING_CANCELLED')
            AND cancelled_at IS NOT NULL
            AND cancellation_reason IS NOT NULL
            AND char_length(trim(cancellation_reason)) >= 5
            AND rejected_at IS NULL
            AND disbursement_status = 'NOT_DISBURSED'
        )
        OR (
            application_status = 'COMPLETED'
            AND approved_at IS NOT NULL
            AND approved_loan_amount IS NOT NULL
            AND rejected_at IS NULL
            AND cancelled_at IS NULL
            AND disbursement_status = 'FULLY_DISBURSED'
            AND fully_disbursed_at IS NOT NULL
            AND current_stage = 'DISBURSEMENT'
        )
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 15] follow_up_tasks
-- Jadwal tugas tindak lanjut Sales:
-- - Tugas umum prospek Lead (related_schedule_id & related_kpr_application_id NULL)
-- - Tugas penagihan jadwal pembayaran (related_schedule_id terisi)
-- - Tugas tindak lanjut progres pengajuan KPR (related_kpr_application_id terisi)
-- Ditempatkan setelah payment_schedules & kpr_applications agar kedua FK valid.
-- ----------------------------------------------------------------------------
CREATE TABLE public.follow_up_tasks (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    assigned_sales_id UUID NOT NULL,
    related_schedule_id UUID NULL,
    related_kpr_application_id UUID NULL,
    title VARCHAR(150) NOT NULL,
    description TEXT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    priority public.task_priority_enum NOT NULL DEFAULT 'MEDIUM',
    source_type public.task_source_enum NOT NULL DEFAULT 'MANUAL_SALES',
    status public.task_status_enum NOT NULL DEFAULT 'PENDING',
    completion_notes TEXT NULL,
    completed_at TIMESTAMPTZ NULL,
    deduplication_key VARCHAR(150) NULL,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_follow_up_tasks PRIMARY KEY (id),
    CONSTRAINT uq_follow_up_tasks_dedup UNIQUE (deduplication_key),
    CONSTRAINT fk_follow_up_tasks_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_follow_up_tasks_assigned_sales
        FOREIGN KEY (assigned_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_follow_up_tasks_schedule
        FOREIGN KEY (related_schedule_id) REFERENCES public.payment_schedules(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_follow_up_tasks_kpr_application
        FOREIGN KEY (related_kpr_application_id) REFERENCES public.kpr_applications(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_follow_up_tasks_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_follow_up_tasks_completed CHECK (
        status <> 'COMPLETED'
        OR (completion_notes IS NOT NULL AND completed_at IS NOT NULL)
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 24] kpr_documents
-- Checklist, status kelengkapan/revisi, dan metadata berkas KPR di Supabase Private Storage (OQ-06)
-- ----------------------------------------------------------------------------
CREATE TABLE public.kpr_documents (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    kpr_application_id UUID NOT NULL,
    bank_requirement_id UUID NULL,
    document_name VARCHAR(150) NOT NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT true,
    status public.kpr_doc_status_enum NOT NULL DEFAULT 'MISSING',
    file_path TEXT NULL,
    file_name VARCHAR(255) NULL,
    uploaded_by UUID NULL,
    uploaded_at TIMESTAMPTZ NULL,
    verified_by UUID NULL,
    verified_at TIMESTAMPTZ NULL,
    verification_notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_kpr_documents PRIMARY KEY (id),
    CONSTRAINT fk_kpr_documents_application
        FOREIGN KEY (kpr_application_id) REFERENCES public.kpr_applications(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_kpr_documents_bank_req
        FOREIGN KEY (bank_requirement_id) REFERENCES public.kpr_bank_requirements(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_kpr_documents_uploaded_by
        FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_kpr_documents_verified_by
        FOREIGN KEY (verified_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_kpr_documents_upload CHECK (
        status = 'MISSING'
        OR (file_path IS NOT NULL AND uploaded_by IS NOT NULL AND uploaded_at IS NOT NULL)
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 25] kpr_stage_histories
-- Jejak historis perpindahan tahapan proses pengajuan KPR beserta waktu & catatan
-- ----------------------------------------------------------------------------
CREATE TABLE public.kpr_stage_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    kpr_application_id UUID NOT NULL,
    from_stage public.kpr_stage_enum NULL,
    to_stage public.kpr_stage_enum NOT NULL,
    notes TEXT NULL,
    changed_by UUID NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_kpr_stage_histories PRIMARY KEY (id),
    CONSTRAINT fk_kpr_stage_histories_application
        FOREIGN KEY (kpr_application_id) REFERENCES public.kpr_applications(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_kpr_stage_histories_changed_by
        FOREIGN KEY (changed_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- [Tabel 26] kpr_disbursements
-- Riwayat pencairan dana kredit KPR individual dari bank (PRIMARY & SUBSEQUENT tranches)
-- ----------------------------------------------------------------------------
CREATE TABLE public.kpr_disbursements (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    kpr_application_id UUID NOT NULL,
    tranche_type public.disbursement_tranche_enum NOT NULL,
    sequence_number SMALLINT NOT NULL DEFAULT 1,
    disbursement_reference VARCHAR(80) NOT NULL,
    disbursed_amount NUMERIC(15,2) NOT NULL,
    disbursement_date DATE NOT NULL,
    proof_file_path TEXT NOT NULL,
    recorded_by_admin_id UUID NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_kpr_disbursements PRIMARY KEY (id),
    CONSTRAINT uq_kpr_disbursements_app_seq UNIQUE (kpr_application_id, sequence_number),
    CONSTRAINT fk_kpr_disbursements_application
        FOREIGN KEY (kpr_application_id) REFERENCES public.kpr_applications(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_kpr_disbursements_recorded_by
        FOREIGN KEY (recorded_by_admin_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_kpr_disbursements_values CHECK (
        sequence_number >= 1 AND disbursed_amount > 0
    )
);

-- CST-11: Hanya boleh ada maksimal 1 Pencairan Utama (PRIMARY) per aplikasi KPR
CREATE UNIQUE INDEX uq_one_primary_disbursement_per_kpr
    ON public.kpr_disbursements(kpr_application_id)
    WHERE tranche_type = 'PRIMARY';

-- ----------------------------------------------------------------------------
-- [Tabel 27] deals
-- Mengelola siklus 3 dimensi Deal (Sales Outcome, Contract Status, Payment Settlement)
-- yang mendukung penuh Kebijakan C2 Cash Bertahap (PD-03) serta Kebijakan Final TC-01A
-- ----------------------------------------------------------------------------
CREATE TABLE public.deals (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    reference_number VARCHAR(30) NOT NULL,
    booking_id UUID NOT NULL,
    lead_id UUID NOT NULL,
    unit_id UUID NOT NULL,
    origin_sales_id UUID NOT NULL,
    current_sales_id UUID NOT NULL,
    team_id UUID NOT NULL,
    payment_method public.payment_method_enum NOT NULL,
    final_deal_value NUMERIC(15,2) NOT NULL,
    sales_outcome_status public.deal_sales_outcome_enum NOT NULL DEFAULT 'IN_PROGRESS',
    contract_status public.deal_contract_status_enum NOT NULL DEFAULT 'PRE_CONTRACT',
    payment_settlement_status public.deal_settlement_status_enum NOT NULL DEFAULT 'BOOKING_FEE_SETTLED',
    contract_document_number VARCHAR(80) NULL,
    contract_file_path TEXT NULL,
    contract_signed_at TIMESTAMPTZ NULL,
    sales_closed_won_at TIMESTAMPTZ NULL,
    fully_settled_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_deals PRIMARY KEY (id),
    CONSTRAINT uq_deals_reference_number UNIQUE (reference_number),
    CONSTRAINT uq_deals_booking UNIQUE (booking_id),
    -- CST-06 (Refinement v1.1 #9): Menjamin booking_id, lead_id, dan unit_id selalu konsisten
    CONSTRAINT fk_deals_booking_lead_unit
        FOREIGN KEY (booking_id, lead_id, unit_id)
        REFERENCES public.bookings(id, lead_id, unit_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_deals_origin_sales
        FOREIGN KEY (origin_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_deals_current_sales
        FOREIGN KEY (current_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_deals_team
        FOREIGN KEY (team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_deals_value CHECK (final_deal_value > 0)
);

-- ----------------------------------------------------------------------------
-- [Tabel 28] deal_status_histories
-- ----------------------------------------------------------------------------
CREATE TABLE public.deal_status_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL,
    changed_dimension VARCHAR(40) NOT NULL,
    old_status VARCHAR(50) NULL,
    new_status VARCHAR(50) NOT NULL,
    reason TEXT NULL,
    changed_by UUID NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_deal_status_histories PRIMARY KEY (id),
    CONSTRAINT fk_deal_status_histories_deal
        FOREIGN KEY (deal_id) REFERENCES public.deals(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_deal_status_histories_changed_by
        FOREIGN KEY (changed_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_deal_status_histories_dim CHECK (
        changed_dimension IN ('SALES_OUTCOME', 'CONTRACT_STATUS', 'PAYMENT_SETTLEMENT')
    )
);

COMMIT;
