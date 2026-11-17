-- ============================================================================
-- FILE: supabase/migrations/20260301000800_transactional_rpcs.sql
-- TUJUAN: Implementasi Generator Nomor Referensi Atomik, Trigger Penjaga
--         Pembayaran, & 10 Transactional RPCs (TX-01 s/d TX-10)
--         untuk Sistem FIM-Property CRM (Single-Company)
-- REFERENSI: FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC_v1.3.md
-- DEPENDENCY: Migrasi 1 s/d 7 (File 02 v1.4 & File 03 v1.1)
-- URUTAN LOCKING GLOBAL (DAG):
--   leads -> bookings -> units -> kpr_applications -> deals
--   -> payment_schedules -> payment_records -> follow_up_tasks -> site_visits
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. HELPER INTERNAL: CONCURRENCY-SAFE REFERENCE NUMBER GENERATOR (OQ-07)
-- Menghasilkan format: BK-YYYYMM-XXXX, PAY-YYYYMM-XXXX, KPR-YYYYMM-XXXX,
-- DL-YYYYMM-XXXX, dan REF-YYYYMM-XXXX secara atomik.
-- Ditempatkan di schema privat app_security agar tidak bisa dipanggil dari luar.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_security.next_reference_number(
    p_prefix VARCHAR(10),
    p_reference_time TIMESTAMPTZ DEFAULT clock_timestamp()
)
RETURNS VARCHAR(30)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_clean_prefix VARCHAR(10);
    v_year_month   VARCHAR(6);
    v_next_val     INTEGER;
BEGIN
    v_clean_prefix := upper(trim(p_prefix));

    IF v_clean_prefix NOT IN ('BK', 'PAY', 'KPR', 'DL', 'REF') THEN
        RAISE EXCEPTION 'INVALID_REFERENCE_PREFIX: Prefix [%] tidak dikenali.', v_clean_prefix
            USING ERRCODE = '22023';
    END IF;

    -- Gunakan zona waktu Asia/Jakarta (WIB) untuk penomoran bulanan perusahaan
    v_year_month := to_char(p_reference_time AT TIME ZONE 'Asia/Jakarta', 'YYYYMM');

    INSERT INTO public.reference_sequences (prefix, year_month, last_value, updated_at)
    VALUES (v_clean_prefix, v_year_month, 1, clock_timestamp())
    ON CONFLICT (prefix, year_month)
    DO UPDATE SET
        last_value = public.reference_sequences.last_value + 1,
        updated_at = clock_timestamp()
    RETURNING last_value INTO v_next_val;

    RETURN v_clean_prefix || '-' || v_year_month || '-' || lpad(v_next_val::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION app_security.next_reference_number(VARCHAR, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_security.next_reference_number(VARCHAR, TIMESTAMPTZ) TO service_role;

-- ============================================================================
-- 1. TX-01: public.rpc_create_booking
-- Tujuan: Mengajukan Booking baru atas unit AVAILABLE, menahan unit menjadi HELD,
--         mengunci harga kesepakatan (Price Freeze BR-07), menetapkan masa berlaku
--         72 jam (OQ-03 / PD-01), dan membuat jadwal tagihan pertama (BOOKING_FEE).
-- Urutan Penguncian Global: leads -> units
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_create_booking(
    p_lead_id UUID,
    p_unit_id UUID,
    p_payment_method public.payment_method_enum,
    p_booking_fee_amount NUMERIC(15,2),
    p_promo_id UUID DEFAULT NULL,
    p_is_booking_fee_part_of_dp BOOLEAN DEFAULT true,
    p_agreed_dp_total_amount NUMERIC(15,2) DEFAULT 0,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id              UUID;
    v_actor_role            public.system_role_enum;
    v_actor_team_id         UUID;
    v_lead                  RECORD;
    v_unit                  RECORD;
    v_project               RECORD;
    v_promo                 RECORD;
    v_sales_active_in_team  BOOLEAN;
    v_promo_discount        NUMERIC(15,2) := 0;
    v_agreed_final_price    NUMERIC(15,2);
    v_is_bf_part_of_dp      BOOLEAN;
    v_dp_total              NUMERIC(15,2);
    v_total_upfront_cash    NUMERIC(15,2);
    v_booking_ref           VARCHAR(30);
    v_booking_id            UUID;
    v_schedule_id           UUID;
    v_now                   TIMESTAMPTZ := clock_timestamp();
    v_expires_at            TIMESTAMPTZ;
BEGIN
    -- 1. Validasi Autentikasi & Role Pemanggil
    v_actor_id := auth.uid();
    v_actor_role := app_security.get_current_user_role();
    v_actor_team_id := app_security.get_current_user_active_team_id();

    IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_actor_role NOT IN ('ADMIN', 'SUPERVISOR', 'SALES') THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Sesi pengguna tidak valid atau akun telah dinonaktifkan.'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Kunci Baris sesuai Urutan Global: leads -> units
    SELECT l.*
    INTO v_lead
    FROM public.leads AS l
    WHERE l.id = p_lead_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Lead calon pembeli tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT u.*
    INTO v_unit
    FROM public.units AS u
    WHERE u.id = p_unit_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Unit properti tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    -- 3. Validasi Otorisasi Kepemilikan Lead & Keanggotaan Tim Aktif (Single-Company Team Isolation)
    IF v_actor_role = 'SALES' AND (
        v_lead.assigned_sales_id <> v_actor_id
        OR v_actor_team_id IS NULL
        OR v_lead.team_id <> v_actor_team_id
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: Anda hanya dapat mengajukan Booking untuk Lead yang menjadi tanggung jawab Anda di tim aktif Anda.'
            USING ERRCODE = '42501';
    ELSIF v_actor_role = 'SUPERVISOR' AND (v_actor_team_id IS NULL OR v_lead.team_id <> v_actor_team_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: Supervisor hanya dapat mengajukan Booking untuk Lead di dalam timnya.'
            USING ERRCODE = '42501';
    END IF;

    -- Pastikan Sales penanggung jawab Lead, keanggotaannya, dan timnya benar-benar aktif
    SELECT EXISTS (
        SELECT 1
        FROM public.team_memberships AS tm
        INNER JOIN public.profiles AS p ON p.id = tm.profile_id
        INNER JOIN public.teams AS t ON t.id = tm.team_id
        WHERE tm.profile_id = v_lead.assigned_sales_id
          AND tm.team_id = v_lead.team_id
          AND tm.is_active = true
          AND p.is_active = true
          AND t.is_active = true
    ) INTO v_sales_active_in_team;

    IF NOT v_sales_active_in_team THEN
        RAISE EXCEPTION 'INVALID_STATE: Sales penanggung jawab Lead atau tim terkait tidak lagi aktif. Lakukan reassignment Lead terlebih dahulu.'
            USING ERRCODE = '22023';
    END IF;

    -- 4. Validasi Status Tahapan Lead
    IF v_lead.pipeline_stage IN ('NEW', 'CLOSED_LOST', 'CLOSED_WON') THEN
        RAISE EXCEPTION 'INVALID_PIPELINE_STAGE: Lead dengan status [%] tidak dapat langsung diajukan Booking.', v_lead.pipeline_stage
            USING ERRCODE = '22023';
    END IF;

    -- 5. Validasi Ketersediaan Unit & Status Proyek (Anti-Double Booking BR-02 & BR-05)
    IF v_unit.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'UNIT_NOT_AVAILABLE: Unit [%] saat ini berstatus [%] dan tidak dapat dipesan.', v_unit.unit_code, v_unit.status
            USING ERRCODE = '23505';
    END IF;

    SELECT pp.*
    INTO v_project
    FROM public.property_projects AS pp
    INNER JOIN public.developers AS d ON d.id = pp.developer_id
    WHERE pp.id = v_unit.project_id
      AND d.is_active = true;

    IF NOT FOUND OR v_project.status <> 'ACTIVE_SELLING' THEN
        RAISE EXCEPTION 'PROJECT_NOT_SELLING: Proyek perumahan tidak aktif atau belum dibuka untuk penjualan.'
            USING ERRCODE = '22023';
    END IF;

    -- 6. Validasi & Perhitungan Diskon Promo (Jika Promo Dipilih — ASM-02)
    IF p_promo_id IS NOT NULL THEN
        SELECT pr.*
        INTO v_promo
        FROM public.promotions AS pr
        WHERE pr.id = p_promo_id;

        IF NOT FOUND OR NOT v_promo.is_active THEN
            RAISE EXCEPTION 'INVALID_PROMO: Program promo tidak ditemukan atau sudah tidak aktif.'
                USING ERRCODE = '22023';
        END IF;

        IF (v_now AT TIME ZONE 'Asia/Jakarta')::date NOT BETWEEN v_promo.start_date AND v_promo.end_date THEN
            RAISE EXCEPTION 'PROMO_EXPIRED: Program promo [%] berada di luar periode berlaku.', v_promo.code
                USING ERRCODE = '22023';
        END IF;

        IF v_promo.project_id <> v_unit.project_id
           OR (v_promo.property_type_id IS NOT NULL AND v_promo.property_type_id <> v_unit.property_type_id) THEN
            RAISE EXCEPTION 'PROMO_MISMATCH: Program promo tidak berlaku untuk proyek atau tipe rumah dari unit ini.'
                USING ERRCODE = '22023';
        END IF;

        IF v_promo.promo_type = 'NOMINAL_DISCOUNT' THEN
            v_promo_discount := v_promo.discount_value;
        ELSIF v_promo.promo_type = 'PERCENTAGE_DISCOUNT' THEN
            v_promo_discount := round((v_unit.catalog_price * v_promo.discount_value) / 100.0, 2);
        ELSE
            v_promo_discount := 0;
        END IF;
    END IF;

    -- 7. Hitung Harga Kesepakatan Final (Price Freeze Snapshot — BR-07) & Validasi Nominal
    v_agreed_final_price := v_unit.catalog_price - v_promo_discount;
    v_is_bf_part_of_dp := COALESCE(p_is_booking_fee_part_of_dp, true);
    v_dp_total := COALESCE(p_agreed_dp_total_amount, 0);

    IF v_agreed_final_price <= 0 THEN
        RAISE EXCEPTION 'INVALID_PRICE_MATH: Harga kesepakatan final harus lebih besar dari Rp 0.'
            USING ERRCODE = '22023';
    END IF;

    IF p_booking_fee_amount IS NULL OR p_booking_fee_amount <= 0 OR p_booking_fee_amount >= v_agreed_final_price THEN
        RAISE EXCEPTION 'INVALID_BOOKING_FEE: Nominal Booking Fee harus lebih dari Rp 0 dan lebih kecil dari Harga Kesepakatan Final.'
            USING ERRCODE = '22023';
    END IF;

    IF v_dp_total < 0 OR v_dp_total >= v_agreed_final_price THEN
        RAISE EXCEPTION 'INVALID_DP_AMOUNT: Nominal kesepakatan DP tidak valid terhadap Harga Kesepakatan Final.'
            USING ERRCODE = '22023';
    END IF;

    IF p_payment_method = 'CASH_KERAS' AND v_dp_total <> 0 THEN
        RAISE EXCEPTION 'INVALID_DP_AMOUNT: Untuk metode CASH_KERAS, nominal kesepakatan DP (p_agreed_dp_total_amount) harus bernilai Rp 0.'
            USING ERRCODE = '22023';
    END IF;

    IF p_payment_method IN ('KPR', 'CASH_BERTAHAP')
       AND v_is_bf_part_of_dp = true
       AND v_dp_total > 0
       AND v_dp_total < p_booking_fee_amount THEN
        RAISE EXCEPTION 'INVALID_DP_MATH: Jika Booking Fee merupakan bagian dari DP, total kesepakatan DP kotor tidak boleh lebih kecil dari Booking Fee.'
            USING ERRCODE = '22023';
    END IF;

    v_total_upfront_cash := CASE
        WHEN v_is_bf_part_of_dp THEN GREATEST(v_dp_total, p_booking_fee_amount)
        ELSE (v_dp_total + p_booking_fee_amount)
    END;

    IF p_payment_method = 'KPR' AND v_total_upfront_cash >= v_agreed_final_price THEN
        RAISE EXCEPTION 'INVALID_DP_MATH: Total Booking Fee dan DP tidak boleh mencapai atau melebihi Harga Kesepakatan Final pada metode KPR agar pokok pinjaman KPR > Rp 0.'
            USING ERRCODE = '22023';
    END IF;

    IF p_payment_method = 'CASH_BERTAHAP' AND v_total_upfront_cash > v_agreed_final_price THEN
        RAISE EXCEPTION 'INVALID_DP_MATH: Total Booking Fee dan DP tidak boleh melebihi Harga Kesepakatan Final.'
            USING ERRCODE = '22023';
    END IF;

    -- 8. Bangkitkan Nomor Referensi BK-YYYYMM-XXXX & Tetapkan Masa Berlaku 72 Jam (PD-01)
    v_booking_ref := app_security.next_reference_number('BK', v_now);
    v_expires_at := v_now + interval '72 hours';

    -- 9. Perbarui Lead, Unit, Booking, & Jadwal Tagihan Pertama
    IF v_lead.pipeline_stage <> 'BOOKING' THEN
        UPDATE public.leads
        SET pipeline_stage = 'BOOKING'
        WHERE id = v_lead.id;

        INSERT INTO public.lead_pipeline_histories (
            lead_id,
            from_stage,
            to_stage,
            notes,
            changed_by,
            changed_at
        ) VALUES (
            v_lead.id,
            v_lead.pipeline_stage,
            'BOOKING',
            'Pengajuan Booking ' || v_booking_ref || ' untuk Unit ' || v_unit.unit_code,
            v_actor_id,
            v_now
        );
    END IF;

    UPDATE public.units
    SET status = 'HELD',
        current_holder_sales_id = v_lead.assigned_sales_id,
        current_holder_team_id = v_lead.team_id,
        status_updated_at = v_now
    WHERE id = v_unit.id;

    INSERT INTO public.bookings (
        reference_number,
        lead_id,
        unit_id,
        origin_sales_id,
        current_sales_id,
        team_id,
        payment_method,
        promo_id,
        catalog_price_snapshot,
        promo_discount_snapshot,
        agreed_final_price,
        booking_fee_amount,
        is_booking_fee_part_of_dp,
        agreed_dp_total_amount,
        status,
        booked_at,
        expires_at,
        notes
    ) VALUES (
        v_booking_ref,
        v_lead.id,
        v_unit.id,
        v_lead.assigned_sales_id,
        v_lead.assigned_sales_id,
        v_lead.team_id,
        p_payment_method,
        p_promo_id,
        v_unit.catalog_price,
        v_promo_discount,
        v_agreed_final_price,
        p_booking_fee_amount,
        v_is_bf_part_of_dp,
        v_dp_total,
        'PENDING_FEE',
        v_now,
        v_expires_at,
        p_notes
    )
    RETURNING id INTO v_booking_id;

    INSERT INTO public.payment_schedules (
        booking_id,
        schedule_type,
        installment_number,
        title,
        scheduled_amount,
        verified_paid_amount,
        remaining_amount,
        due_date,
        status
    ) VALUES (
        v_booking_id,
        'BOOKING_FEE',
        1,
        'Pembayaran Booking Fee (' || v_booking_ref || ')',
        p_booking_fee_amount,
        0,
        p_booking_fee_amount,
        (v_expires_at AT TIME ZONE 'Asia/Jakarta')::date,
        'UNPAID'
    )
    RETURNING id INTO v_schedule_id;

    -- 10. Masukkan Event ke Notification Outbox (Idempotent)
    INSERT INTO public.notification_outbox (
        event_type,
        deduplication_key,
        payload
    ) VALUES (
        'BOOKING_FEE_DUE',
        'BOOKING_CREATED_BF_DUE:' || v_booking_id::text,
        jsonb_build_object(
            'booking_id', v_booking_id,
            'booking_reference', v_booking_ref,
            'schedule_id', v_schedule_id,
            'lead_id', v_lead.id,
            'unit_id', v_unit.id,
            'unit_code', v_unit.unit_code,
            'sales_id', v_lead.assigned_sales_id,
            'team_id', v_lead.team_id,
            'booking_fee_amount', p_booking_fee_amount,
            'expires_at', v_expires_at
        )
    )
    ON CONFLICT (deduplication_key) DO NOTHING;

    -- 11. Catat ke Audit Log dalam Transaksi yang Sama
    INSERT INTO public.audit_logs (
        actor_user_id,
        actor_role,
        action_type,
        entity_table,
        entity_id,
        old_values,
        new_values,
        reason,
        created_at
    ) VALUES (
        v_actor_id,
        v_actor_role::text,
        'BOOKING_CREATED',
        'bookings',
        v_booking_id,
        jsonb_build_object('unit_status', 'AVAILABLE', 'lead_pipeline_stage', v_lead.pipeline_stage),
        jsonb_build_object(
            'booking_reference', v_booking_ref,
            'unit_id', v_unit.id,
            'unit_code', v_unit.unit_code,
            'unit_status', 'HELD',
            'catalog_price_snapshot', v_unit.catalog_price,
            'promo_discount_snapshot', v_promo_discount,
            'agreed_final_price', v_agreed_final_price,
            'booking_fee_amount', p_booking_fee_amount,
            'expires_at', v_expires_at
        ),
        COALESCE(p_notes, 'Pengajuan Booking baru'),
        v_now
    );

    RETURN jsonb_build_object(
        'booking_id', v_booking_id,
        'reference_number', v_booking_ref,
        'unit_id', v_unit.id,
        'unit_status', 'HELD',
        'agreed_final_price', v_agreed_final_price,
        'booking_fee_schedule_id', v_schedule_id,
        'expires_at', v_expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_create_booking(UUID, UUID, public.payment_method_enum, NUMERIC, UUID, BOOLEAN, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_booking(UUID, UUID, public.payment_method_enum, NUMERIC, UUID, BOOLEAN, NUMERIC, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 1B. TRIGGER PENJAGA PENGAJUAN PEMBAYARAN & NOMOR REFERENSI (PAY-YYYYMM-XXXX)
--     - trg_00_guard_payment_records_insert:
--       Urutan Penguncian Global: bookings (FOR SHARE) -> payment_schedules (FOR UPDATE).
--       Wajib mengunci bookings SEBELUM payment_schedules agar selaras 100% dengan
--       TX-02, TX-03, TX-04, & TX-06 dan menserialisasikan pengajuan pembayaran
--       terhadap proses expiry/pembatalan Booking (PD-01).
--     - trg_01_assign_payment_reference_number: Membentuk PAY-YYYYMM-XXXX atomik.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_security.trg_guard_payment_records_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_booking       RECORD;
    v_schedule      RECORD;
    v_pending_sum   NUMERIC(15,2) := 0;
BEGIN
    IF NEW.paid_amount IS NULL OR NEW.paid_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_AMOUNT: Nominal pembayaran harus lebih besar dari Rp 0.'
            USING ERRCODE = '22023';
    END IF;

    -- 1. Kunci baris Booking terlebih dahulu (FOR SHARE) sesuai urutan global:
    --    bookings -> payment_schedules.
    --    FOR SHARE berkonflik dengan FOR UPDATE pada TX-02, TX-03, dan TX-06
    --    sehingga mencegah deadlock maupun race condition PD-01.
    SELECT b.id, b.status
    INTO v_booking
    FROM public.bookings AS b
    WHERE b.id = NEW.booking_id
    FOR SHARE;

    IF NOT FOUND OR v_booking.status NOT IN ('PENDING_FEE', 'ACTIVE') THEN
        RAISE EXCEPTION 'INVALID_BOOKING_STATUS: Booking berstatus [%] tidak dapat menerima pengajuan pembayaran baru.',
            COALESCE(v_booking.status::text, 'UNKNOWN')
            USING ERRCODE = '22023';
    END IF;

    -- 2. Kunci baris jadwal tagihan setelah Booking (FOR UPDATE) untuk mencegah
    --    double-submit atau overpayment konkuren pada jadwal yang sama.
    SELECT ps.*
    INTO v_schedule
    FROM public.payment_schedules AS ps
    WHERE ps.id = NEW.payment_schedule_id
    FOR UPDATE;

    IF NOT FOUND OR v_schedule.booking_id <> NEW.booking_id THEN
        RAISE EXCEPTION 'INVALID_SCHEDULE_BOOKING: Jadwal tagihan tidak ditemukan atau tidak sesuai dengan Booking terkait.'
            USING ERRCODE = '22023';
    END IF;

    IF v_schedule.status IN ('PAID', 'CANCELLED') THEN
        RAISE EXCEPTION 'SCHEDULE_CLOSED: Jadwal tagihan ini sudah berstatus [%] dan tidak menerima pengajuan pembayaran baru.', v_schedule.status
            USING ERRCODE = '22023';
    END IF;

    IF NEW.replaces_payment_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.payment_records AS pr_old
            WHERE pr_old.id = NEW.replaces_payment_id
              AND pr_old.booking_id = NEW.booking_id
              AND pr_old.payment_schedule_id = NEW.payment_schedule_id
              AND pr_old.verification_status = 'REJECTED'
        ) THEN
            RAISE EXCEPTION 'INVALID_REPLACEMENT_PAYMENT: Bukti pembayaran yang diganti tidak valid, bukan milik jadwal yang sama, atau tidak berstatus REJECTED.'
                USING ERRCODE = '22023';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.payment_records AS pr_dup
            WHERE pr_dup.replaces_payment_id = NEW.replaces_payment_id
              AND pr_dup.verification_status IN ('PENDING_VERIFICATION', 'VERIFIED')
        ) THEN
            RAISE EXCEPTION 'DUPLICATE_REPLACEMENT_PAYMENT: Bukti pembayaran yang ditolak tersebut sudah memiliki pengajuan pengganti yang aktif atau terverifikasi.'
                USING ERRCODE = '23505';
        END IF;
    END IF;

    SELECT COALESCE(SUM(pr.paid_amount), 0)
    INTO v_pending_sum
    FROM public.payment_records AS pr
    WHERE pr.payment_schedule_id = NEW.payment_schedule_id
      AND pr.verification_status = 'PENDING_VERIFICATION';

    IF v_pending_sum + NEW.paid_amount > v_schedule.remaining_amount THEN
        RAISE EXCEPTION 'OVERPAYMENT_BLOCKED: Total pembayaran menunggu verifikasi (Rp %) ditambah pengajuan baru (Rp %) melebihi sisa tagihan jadwal (Rp %).',
            v_pending_sum, NEW.paid_amount, v_schedule.remaining_amount
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_00_guard_payment_records_insert
    BEFORE INSERT ON public.payment_records
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_guard_payment_records_insert();

CREATE OR REPLACE FUNCTION app_security.trg_assign_payment_reference_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.reference_number IS NULL OR trim(NEW.reference_number) = '' THEN
        NEW.reference_number := app_security.next_reference_number('PAY', clock_timestamp());
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_01_assign_payment_reference_number
    BEFORE INSERT ON public.payment_records
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_assign_payment_reference_number();

-- ============================================================================
-- 2. TX-02: public.rpc_verify_payment_record
-- Tujuan: Memverifikasi ('VERIFIED') atau menolak ('REJECTED') catatan pembayaran
--         pelanggan oleh Admin (ASM-04), menghitung ulang saldo jadwal tagihan,
--         mengesahkan Unit menjadi 'BOOKED' & membuat Deal/KPR saat Booking Fee
--         lunas (OQ-02), memulihkan status arrears bila tunggakan lunas, serta
--         menangani penolakan saat lewat batas waktu (PD-01).
-- Urutan Penguncian Global:
--   leads -> bookings -> units -> deals -> payment_schedules
--   -> payment_records -> follow_up_tasks
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_verify_payment_record(
    p_payment_record_id UUID,
    p_decision public.payment_verification_enum,
    p_verification_notes TEXT DEFAULT NULL,
    p_expired_booking_action VARCHAR(20) DEFAULT NULL,
    p_kpr_bank_name VARCHAR(100) DEFAULT 'Bank Mandiri',
    p_kpr_tenor_years SMALLINT DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id              UUID;
    v_actor_role            public.system_role_enum;
    v_booking_id            UUID;
    v_schedule_id           UUID;
    v_lead_id               UUID;
    v_unit_id               UUID;
    v_payment               RECORD;
    v_schedule              RECORD;
    v_booking               RECORD;
    v_unit                  RECORD;
    v_lead                  RECORD;
    v_deal                  RECORD;
    v_now                   TIMESTAMPTZ := clock_timestamp();
    v_new_verified_sum      NUMERIC(15,2) := 0;
    v_new_remaining         NUMERIC(15,2) := 0;
    v_new_sched_status      public.schedule_status_enum;
    v_deal_id               UUID;
    v_deal_ref              VARCHAR(30);
    v_kpr_id                UUID;
    v_kpr_ref               VARCHAR(30);
    v_net_dp_amount         NUMERIC(15,2);
    v_cash_final_amount     NUMERIC(15,2);
    v_loan_principal        NUMERIC(15,2);
    v_unpaid_sched_count    INTEGER;
    v_total_scheduled_sum   NUMERIC(15,2);
    v_overdue_count         INTEGER;
    v_unpaid_dp_count       INTEGER;
    v_other_pending_exists  BOOLEAN;
    v_new_unit_status       public.unit_status_enum;
    v_new_booking_status    public.booking_status_enum;
    v_expired_action        VARCHAR(20);
BEGIN
    -- 1. Validasi Otorisasi: Hanya ADMIN yang boleh memverifikasi pembayaran (ASM-04)
    v_actor_id := auth.uid();
    v_actor_role := app_security.get_current_user_role();

    IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_actor_role <> 'ADMIN' THEN
        RAISE EXCEPTION 'FORBIDDEN: Hanya ADMIN yang berwenang memverifikasi atau menolak bukti pembayaran.'
            USING ERRCODE = '42501';
    END IF;

    IF p_decision NOT IN ('VERIFIED', 'REJECTED') THEN
        RAISE EXCEPTION 'INVALID_DECISION: Keputusan verifikasi harus VERIFIED atau REJECTED.'
            USING ERRCODE = '22023';
    END IF;

    IF p_decision = 'REJECTED' AND (p_verification_notes IS NULL OR char_length(trim(p_verification_notes)) < 5) THEN
        RAISE EXCEPTION 'REASON_REQUIRED: Alasan penolakan pembayaran wajib diisi minimal 5 karakter.'
            USING ERRCODE = '22023';
    END IF;

    IF p_expired_booking_action IS NOT NULL AND p_expired_booking_action NOT IN ('EXPIRE_NOW', 'EXTEND_24H') THEN
        RAISE EXCEPTION 'INVALID_ACTION: Aksi booking kedaluwarsa harus EXPIRE_NOW atau EXTEND_24H.'
            USING ERRCODE = '22023';
    END IF;

    IF p_kpr_tenor_years IS NOT NULL AND (p_kpr_tenor_years < 1 OR p_kpr_tenor_years > 35) THEN
        RAISE EXCEPTION 'INVALID_TENOR: Tenor pengajuan KPR harus berada di antara 1 sampai 35 tahun.'
            USING ERRCODE = '22023';
    END IF;

    -- 2A. Pembacaan Non-Penguncian untuk Mengumpulkan ID Induk (Staged Locking)
    SELECT pr.booking_id, pr.payment_schedule_id, b.lead_id, b.unit_id
    INTO v_booking_id, v_schedule_id, v_lead_id, v_unit_id
    FROM public.payment_records AS pr
    INNER JOIN public.bookings AS b ON b.id = pr.booking_id
    WHERE pr.id = p_payment_record_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Catatan pembayaran tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    -- 2B. Kunci Baris sesuai Urutan Global:
    --     leads -> bookings -> units -> deals -> payment_schedules -> payment_records
    SELECT l.*
    INTO v_lead
    FROM public.leads AS l
    WHERE l.id = v_lead_id
    FOR UPDATE;

    SELECT b.*
    INTO v_booking
    FROM public.bookings AS b
    WHERE b.id = v_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Booking terkait pembayaran tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT u.*
    INTO v_unit
    FROM public.units AS u
    WHERE u.id = v_unit_id
    FOR UPDATE;

    SELECT d.*
    INTO v_deal
    FROM public.deals AS d
    WHERE d.booking_id = v_booking.id
    FOR UPDATE;

    -- Kunci seluruh jadwal tagihan milik Booking ini secara deterministik (ORDER BY id)
    -- sebelum mengunci payment_records (Rank 6 -> Rank 7) agar agregasi & cabang PD-01 bebas deadlock
    PERFORM 1
    FROM public.payment_schedules AS ps_all
    WHERE ps_all.booking_id = v_booking.id
    ORDER BY ps_all.id
    FOR UPDATE;

    SELECT ps.*
    INTO v_schedule
    FROM public.payment_schedules AS ps
    WHERE ps.id = v_schedule_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Jadwal tagihan terkait pembayaran tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT pr.*
    INTO v_payment
    FROM public.payment_records AS pr
    WHERE pr.id = p_payment_record_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Catatan pembayaran tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    -- 2C. Validasi Status Segar SETELAH Seluruh Baris Terkunci
    IF v_payment.verification_status <> 'PENDING_VERIFICATION' THEN
        RAISE EXCEPTION 'ALREADY_PROCESSED: Pembayaran [%] sudah pernah diproses dengan status [%].',
            v_payment.reference_number, v_payment.verification_status
            USING ERRCODE = '22023';
    END IF;

    IF v_booking.status NOT IN ('PENDING_FEE', 'ACTIVE') THEN
        RAISE EXCEPTION 'INVALID_BOOKING_STATUS: Tidak dapat memproses pembayaran pada Booking yang sudah berstatus [%].', v_booking.status
            USING ERRCODE = '22023';
    END IF;

    IF v_schedule.status IN ('PAID', 'CANCELLED') THEN
        RAISE EXCEPTION 'INVALID_SCHEDULE_STATUS: Jadwal tagihan sudah berstatus [%] dan tidak dapat diproses lagi.', v_schedule.status
            USING ERRCODE = '22023';
    END IF;

    v_new_unit_status := v_unit.status;
    v_new_booking_status := v_booking.status;
    v_new_verified_sum := v_schedule.verified_paid_amount;
    v_new_remaining := v_schedule.remaining_amount;
    v_new_sched_status := v_schedule.status;

    -- ========================================================================
    -- CABANG A: KEPUTUSAN VERIFIKASI = 'VERIFIED'
    -- ========================================================================
    IF p_decision = 'VERIFIED' THEN
        -- Validasi agar total yang diverifikasi tidak melampaui nominal jadwal tagihan (CST-09)
        IF v_schedule.verified_paid_amount + v_payment.paid_amount > v_schedule.scheduled_amount THEN
            RAISE EXCEPTION 'OVERPAYMENT_BLOCKED: Nominal pembayaran (Rp %) melebihi sisa tagihan jadwal ini (Rp %).',
                v_payment.paid_amount, v_schedule.remaining_amount
                USING ERRCODE = '22023';
        END IF;

        -- 1. Perbarui status payment_records menjadi VERIFIED
        UPDATE public.payment_records
        SET verification_status = 'VERIFIED',
            verified_by_admin_id = v_actor_id,
            verified_at = v_now,
            verification_notes = p_verification_notes
        WHERE id = v_payment.id;

        -- 2. Rekonsiliasi ulang akumulasi pembayaran terverifikasi langsung dari payment_records
        SELECT COALESCE(SUM(pr.paid_amount), 0)
        INTO v_new_verified_sum
        FROM public.payment_records AS pr
        WHERE pr.payment_schedule_id = v_schedule.id
          AND pr.verification_status = 'VERIFIED';

        v_new_remaining := v_schedule.scheduled_amount - v_new_verified_sum;

        IF v_new_remaining = 0 THEN
            v_new_sched_status := 'PAID';
        ELSIF v_schedule.due_date < (v_now AT TIME ZONE 'Asia/Jakarta')::date THEN
            v_new_sched_status := 'OVERDUE';
        ELSE
            v_new_sched_status := 'PARTIALLY_PAID';
        END IF;

        UPDATE public.payment_schedules
        SET verified_paid_amount = v_new_verified_sum,
            remaining_amount = v_new_remaining,
            status = v_new_sched_status,
            paid_at = CASE WHEN v_new_remaining = 0 THEN v_now ELSE paid_at END
        WHERE id = v_schedule.id;

        -- 3. Jika jadwal lunas ('PAID'), kunci deterministik & selesaikan tugas follow-up penagihan terkait
        IF v_new_sched_status = 'PAID' THEN
            PERFORM 1
            FROM public.follow_up_tasks AS fut
            WHERE fut.related_schedule_id = v_schedule.id
              AND fut.status IN ('PENDING', 'OVERDUE')
            ORDER BY fut.id
            FOR UPDATE;

            UPDATE public.follow_up_tasks
            SET status = 'COMPLETED',
                completion_notes = 'Otomatis selesai: Jadwal tagihan telah diverifikasi lunas (PAID) oleh Admin.',
                completed_at = v_now
            WHERE related_schedule_id = v_schedule.id
              AND status IN ('PENDING', 'OVERDUE');
        END IF;

        -- 4. EFEK KHUSUS JIKA YANG LUNAS ADALAH BOOKING_FEE PADA BOOKING 'PENDING_FEE' (OQ-02)
        IF v_schedule.schedule_type = 'BOOKING_FEE'
           AND v_new_sched_status = 'PAID'
           AND v_booking.status = 'PENDING_FEE' THEN

            -- 4a. Ubah status Booking -> ACTIVE dan Unit -> BOOKED
            UPDATE public.bookings
            SET status = 'ACTIVE',
                confirmed_at = v_now
            WHERE id = v_booking.id;
            v_new_booking_status := 'ACTIVE';

            UPDATE public.units
            SET status = 'BOOKED',
                status_updated_at = v_now
            WHERE id = v_unit.id;
            v_new_unit_status := 'BOOKED';

            -- 4b. Majukan Pipeline Lead ke 'PAYMENT_KPR_PROCESS'
            IF v_lead.pipeline_stage <> 'PAYMENT_KPR_PROCESS' THEN
                UPDATE public.leads
                SET pipeline_stage = 'PAYMENT_KPR_PROCESS'
                WHERE id = v_lead.id;

                INSERT INTO public.lead_pipeline_histories (
                    lead_id, from_stage, to_stage, notes, changed_by, changed_at
                ) VALUES (
                    v_lead.id,
                    v_lead.pipeline_stage,
                    'PAYMENT_KPR_PROCESS',
                    'Booking Fee telah diverifikasi lunas; masuk ke tahap pembayaran lanjutan / KPR.',
                    v_actor_id,
                    v_now
                );
            END IF;

            -- 4c. Inisiasi Record Deal (DL-YYYYMM-XXXX)
            v_deal_ref := app_security.next_reference_number('DL', v_now);

            INSERT INTO public.deals (
                reference_number,
                booking_id,
                lead_id,
                unit_id,
                origin_sales_id,
                current_sales_id,
                team_id,
                payment_method,
                final_deal_value,
                sales_outcome_status,
                contract_status,
                payment_settlement_status
            ) VALUES (
                v_deal_ref,
                v_booking.id,
                v_booking.lead_id,
                v_booking.unit_id,
                v_booking.origin_sales_id,
                v_booking.current_sales_id,
                v_booking.team_id,
                v_booking.payment_method,
                v_booking.agreed_final_price,
                'IN_PROGRESS',
                'PRE_CONTRACT',
                'BOOKING_FEE_SETTLED'
            )
            RETURNING id INTO v_deal_id;

            INSERT INTO public.deal_status_histories (
                deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
            ) VALUES (
                v_deal_id, 'PAYMENT_SETTLEMENT', NULL, 'BOOKING_FEE_SETTLED',
                'Inisiasi Deal setelah Booking Fee terverifikasi lunas.', v_actor_id, v_now
            );

            -- 4d. Susun jadwal tagihan lanjutan otomatis sesuai metode pembiayaan (Anti-Double Counting BR-06)
            IF v_booking.payment_method = 'CASH_KERAS' THEN
                v_cash_final_amount := v_booking.agreed_final_price -
                    CASE WHEN v_booking.is_booking_fee_part_of_dp THEN v_booking.booking_fee_amount ELSE 0 END;

                IF v_cash_final_amount > 0 AND NOT EXISTS (
                    SELECT 1 FROM public.payment_schedules
                    WHERE booking_id = v_booking.id AND schedule_type = 'FINAL_SETTLEMENT'
                ) THEN
                    INSERT INTO public.payment_schedules (
                        booking_id, schedule_type, installment_number, title,
                        scheduled_amount, verified_paid_amount, remaining_amount, due_date, status
                    ) VALUES (
                        v_booking.id, 'FINAL_SETTLEMENT', 1, 'Pelunasan Cash Keras (100%)',
                        v_cash_final_amount, 0, v_cash_final_amount,
                        ((v_now + interval '30 days') AT TIME ZONE 'Asia/Jakarta')::date, 'UNPAID'
                    );
                END IF;

            ELSIF v_booking.payment_method IN ('KPR', 'CASH_BERTAHAP') THEN
                IF v_booking.agreed_dp_total_amount > 0 THEN
                    v_net_dp_amount := v_booking.agreed_dp_total_amount -
                        CASE WHEN v_booking.is_booking_fee_part_of_dp THEN v_booking.booking_fee_amount ELSE 0 END;

                    IF v_net_dp_amount > 0 AND NOT EXISTS (
                        SELECT 1 FROM public.payment_schedules
                        WHERE booking_id = v_booking.id AND schedule_type = 'DOWN_PAYMENT'
                    ) THEN
                        INSERT INTO public.payment_schedules (
                            booking_id, schedule_type, installment_number, title,
                            scheduled_amount, verified_paid_amount, remaining_amount, due_date, status
                        ) VALUES (
                            v_booking.id, 'DOWN_PAYMENT', 1, 'Pembayaran Uang Muka / DP Bersih',
                            v_net_dp_amount, 0, v_net_dp_amount,
                            ((v_now + interval '14 days') AT TIME ZONE 'Asia/Jakarta')::date, 'UNPAID'
                        );
                    END IF;
                END IF;

                -- 4e. Jika metode KPR, otomatis inisiasi kpr_applications & checklist kpr_documents
                IF v_booking.payment_method = 'KPR' AND NOT EXISTS (
                    SELECT 1 FROM public.kpr_applications WHERE booking_id = v_booking.id
                ) THEN
                    v_kpr_ref := app_security.next_reference_number('KPR', v_now);
                    v_loan_principal := v_booking.agreed_final_price -
                        CASE
                            WHEN v_booking.is_booking_fee_part_of_dp THEN GREATEST(v_booking.agreed_dp_total_amount, v_booking.booking_fee_amount)
                            ELSE (v_booking.agreed_dp_total_amount + v_booking.booking_fee_amount)
                        END;

                    IF v_loan_principal <= 0 THEN
                        RAISE EXCEPTION 'INVALID_KPR_PRINCIPAL: Pokok pinjaman KPR yang dihitung bernilai <= Rp 0.'
                            USING ERRCODE = '22023';
                    END IF;

                    INSERT INTO public.kpr_applications (
                        reference_number,
                        booking_id,
                        current_sales_id,
                        team_id,
                        bank_name,
                        requested_loan_amount,
                        tenor_years,
                        current_stage,
                        application_status
                    ) VALUES (
                        v_kpr_ref,
                        v_booking.id,
                        v_booking.current_sales_id,
                        v_booking.team_id,
                        COALESCE(NULLIF(trim(p_kpr_bank_name), ''), 'Bank Mandiri'),
                        v_loan_principal,
                        COALESCE(p_kpr_tenor_years, 15),
                        'DOCUMENT_COLLECTION',
                        'IN_PROGRESS'
                    )
                    RETURNING id INTO v_kpr_id;

                    INSERT INTO public.kpr_stage_histories (
                        kpr_application_id, from_stage, to_stage, notes, changed_by, changed_at
                    ) VALUES (
                        v_kpr_id, NULL, 'DOCUMENT_COLLECTION',
                        'Inisiasi aplikasi KPR otomatis setelah Booking Fee diverifikasi.', v_actor_id, v_now
                    );

                    -- Muat checklist dokumen dari master kpr_bank_requirements sesuai bank tujuan (OQ-06)
                    INSERT INTO public.kpr_documents (
                        kpr_application_id,
                        bank_requirement_id,
                        document_name,
                        is_mandatory,
                        status
                    )
                    SELECT
                        v_kpr_id,
                        kbr.id,
                        kbr.document_name,
                        kbr.is_mandatory,
                        'MISSING'
                    FROM public.kpr_bank_requirements AS kbr
                    WHERE lower(kbr.bank_name) = lower(COALESCE(NULLIF(trim(p_kpr_bank_name), ''), 'Bank Mandiri'))
                      AND kbr.is_active = true;
                END IF;
            END IF;
        END IF;

        -- 5. Evaluasi Progres Pelunasan pada Deal untuk Pembayaran DP / Cicilan / Pelunasan Akhir
        --    (Baris v_deal sudah dikunci di langkah 2B jika sudah ada sebelum verifikasi ini)
        IF v_deal.id IS NOT NULL THEN
            v_deal_id := v_deal.id;

            SELECT
                count(*) FILTER (WHERE status <> 'PAID' AND status <> 'CANCELLED'),
                COALESCE(SUM(scheduled_amount) FILTER (WHERE status <> 'CANCELLED'), 0),
                count(*) FILTER (WHERE status = 'OVERDUE'),
                count(*) FILTER (WHERE schedule_type IN ('BOOKING_FEE', 'DOWN_PAYMENT', 'KPR_TOPUP_DP') AND status <> 'PAID' AND status <> 'CANCELLED')
            INTO v_unpaid_sched_count, v_total_scheduled_sum, v_overdue_count, v_unpaid_dp_count
            FROM public.payment_schedules
            WHERE booking_id = v_booking.id;

            -- Jika metode CASH_KERAS atau CASH_BERTAHAP dan seluruh tagihan pokok (100% agreed_final_price) telah PAID
            IF v_booking.payment_method IN ('CASH_KERAS', 'CASH_BERTAHAP')
               AND v_unpaid_sched_count = 0
               AND v_total_scheduled_sum >= v_booking.agreed_final_price THEN

                UPDATE public.deals
                SET sales_outcome_status = 'CLOSED_WON',
                    contract_status = 'CONTRACT_COMPLETED',
                    payment_settlement_status = 'FULLY_SETTLED',
                    sales_closed_won_at = COALESCE(sales_closed_won_at, v_now),
                    fully_settled_at = v_now
                WHERE id = v_deal.id;

                INSERT INTO public.deal_status_histories (
                    deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
                ) VALUES (
                    v_deal.id, 'PAYMENT_SETTLEMENT', v_deal.payment_settlement_status::text, 'FULLY_SETTLED',
                    'Seluruh kewajiban pembayaran (100%) telah terverifikasi lunas.', v_actor_id, v_now
                );

                UPDATE public.bookings
                SET status = 'COMPLETED'
                WHERE id = v_booking.id;
                v_new_booking_status := 'COMPLETED';

                UPDATE public.units
                SET status = 'SOLD',
                    status_updated_at = v_now
                WHERE id = v_unit.id;
                v_new_unit_status := 'SOLD';

                IF v_lead.pipeline_stage <> 'CLOSED_WON' THEN
                    UPDATE public.leads
                    SET pipeline_stage = 'CLOSED_WON'
                    WHERE id = v_lead.id;

                    INSERT INTO public.lead_pipeline_histories (
                        lead_id, from_stage, to_stage, notes, changed_by, changed_at
                    ) VALUES (
                        v_lead.id, v_lead.pipeline_stage, 'CLOSED_WON',
                        'Transaksi lunas 100% dan Deal disahkan menjadi Closed Won.', v_actor_id, v_now
                    );
                END IF;

            ELSIF v_unpaid_dp_count = 0
                  AND v_overdue_count = 0
                  AND v_deal.payment_settlement_status IN ('BOOKING_FEE_SETTLED', 'OVERDUE_IN_ARREARS')
                  AND (
                      EXISTS (
                          SELECT 1
                          FROM public.payment_schedules ps_dp
                          WHERE ps_dp.booking_id = v_booking.id
                            AND ps_dp.schedule_type IN ('DOWN_PAYMENT', 'KPR_TOPUP_DP')
                            AND ps_dp.status = 'PAID'
                      )
                      OR v_deal.payment_settlement_status = 'OVERDUE_IN_ARREARS'
                  ) THEN

                UPDATE public.deals
                SET payment_settlement_status = 'DP_SETTLED_ONGOING'
                WHERE id = v_deal.id;

                INSERT INTO public.deal_status_histories (
                    deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
                ) VALUES (
                    v_deal.id, 'PAYMENT_SETTLEMENT', v_deal.payment_settlement_status::text, 'DP_SETTLED_ONGOING',
                    'Seluruh kewajiban DP / tunggakan jadwal CRM telah diverifikasi lunas.', v_actor_id, v_now
                );
            END IF;
        END IF;

    -- ========================================================================
    -- CABANG B: KEPUTUSAN VERIFIKASI = 'REJECTED'
    -- ========================================================================
    ELSE
        -- 1. Tandai payment_records sebagai REJECTED (Histori tetap utuh, tidak dihapus — BR-08 & BR-10)
        UPDATE public.payment_records
        SET verification_status = 'REJECTED',
            verified_by_admin_id = v_actor_id,
            verified_at = v_now,
            verification_notes = trim(p_verification_notes)
        WHERE id = v_payment.id;

        -- 2. Penanganan Edge Case PD-01: Jika Booking Fee ditolak saat masa berlaku Booking sudah lewat
        IF v_booking.status = 'PENDING_FEE' AND v_now > v_booking.expires_at THEN
            SELECT EXISTS (
                SELECT 1
                FROM public.payment_records AS pr
                WHERE pr.booking_id = v_booking.id
                  AND pr.id <> v_payment.id
                  AND pr.verification_status IN ('PENDING_VERIFICATION', 'VERIFIED')
            ) INTO v_other_pending_exists;

            IF NOT v_other_pending_exists THEN
                v_expired_action := COALESCE(p_expired_booking_action, 'EXPIRE_NOW');

                IF v_expired_action = 'EXTEND_24H' THEN
                    INSERT INTO public.booking_extensions (
                        booking_id, old_expires_at, new_expires_at, reason, extended_by, created_at
                    ) VALUES (
                        v_booking.id,
                        v_booking.expires_at,
                        v_now + interval '24 hours',
                        'Perpanjangan otomatis 24 jam pasca-penolakan bukti bayar: ' || trim(p_verification_notes),
                        v_actor_id,
                        v_now
                    );

                    UPDATE public.bookings
                    SET expires_at = v_now + interval '24 hours'
                    WHERE id = v_booking.id;

                    -- Seluruh baris payment_schedules milik Booking ini sudah terkunci di langkah 2B
                    UPDATE public.payment_schedules
                    SET due_date = ((v_now + interval '24 hours') AT TIME ZONE 'Asia/Jakarta')::date,
                        status = CASE
                            WHEN status = 'OVERDUE' AND verified_paid_amount > 0 THEN 'PARTIALLY_PAID'::public.schedule_status_enum
                            WHEN status = 'OVERDUE' THEN 'UNPAID'::public.schedule_status_enum
                            ELSE status
                        END
                    WHERE booking_id = v_booking.id
                      AND schedule_type = 'BOOKING_FEE'
                      AND status <> 'PAID';
                ELSE
                    UPDATE public.bookings
                    SET status = 'EXPIRED',
                        cancelled_at = v_now,
                        cancellation_reason = 'Bukti bayar Booking Fee ditolak setelah melewati masa berlaku.'
                    WHERE id = v_booking.id;
                    v_new_booking_status := 'EXPIRED';

                    -- Seluruh baris payment_schedules milik Booking ini sudah terkunci di langkah 2B
                    UPDATE public.payment_schedules
                    SET status = 'CANCELLED'
                    WHERE booking_id = v_booking.id
                      AND status <> 'PAID';

                    PERFORM 1
                    FROM public.follow_up_tasks AS fut_exp
                    WHERE fut_exp.related_schedule_id IN (
                        SELECT ps_cancel.id
                        FROM public.payment_schedules AS ps_cancel
                        WHERE ps_cancel.booking_id = v_booking.id
                    )
                      AND fut_exp.status IN ('PENDING', 'OVERDUE')
                    ORDER BY fut_exp.id
                    FOR UPDATE;

                    UPDATE public.follow_up_tasks
                    SET status = 'CANCELLED'
                    WHERE related_schedule_id IN (
                        SELECT ps_cancel.id
                        FROM public.payment_schedules AS ps_cancel
                        WHERE ps_cancel.booking_id = v_booking.id
                    )
                      AND status IN ('PENDING', 'OVERDUE');

                    UPDATE public.units
                    SET status = 'AVAILABLE',
                        current_holder_sales_id = NULL,
                        current_holder_team_id = NULL,
                        status_updated_at = v_now
                    WHERE id = v_unit.id
                      AND status = 'HELD';
                    v_new_unit_status := 'AVAILABLE';

                    INSERT INTO public.notification_outbox (
                        event_type,
                        deduplication_key,
                        payload
                    ) VALUES (
                        'BOOKING_EXPIRY_ALERT',
                        'BOOKING_EXPIRED:' || v_booking.id::text,
                        jsonb_build_object(
                            'booking_id', v_booking.id,
                            'booking_reference', v_booking.reference_number,
                            'unit_id', v_unit.id,
                            'lead_id', v_lead.id,
                            'sales_id', v_booking.current_sales_id,
                            'team_id', v_booking.team_id,
                            'expired_at', v_now,
                            'trigger_source', 'PAYMENT_REJECTED_AFTER_EXPIRY'
                        )
                    )
                    ON CONFLICT (deduplication_key) DO NOTHING;
                END IF;
            END IF;
        END IF;
    END IF;

    -- 3. Kirim Notifikasi Hasil Verifikasi ke Outbox
    INSERT INTO public.notification_outbox (
        event_type,
        deduplication_key,
        payload
    ) VALUES (
        'PAYMENT_VERIFICATION_RESULT',
        'PAYMENT_VERIFIED:' || v_payment.id::text || ':' || p_decision::text,
        jsonb_build_object(
            'payment_record_id', v_payment.id,
            'payment_reference', v_payment.reference_number,
            'booking_id', v_booking.id,
            'decision', p_decision,
            'sales_id', v_booking.current_sales_id,
            'team_id', v_booking.team_id,
            'paid_amount', v_payment.paid_amount,
            'verification_notes', p_verification_notes
        )
    )
    ON CONFLICT (deduplication_key) DO NOTHING;

    -- 4. Catat ke Audit Log
    INSERT INTO public.audit_logs (
        actor_user_id, actor_role, action_type, entity_table, entity_id,
        old_values, new_values, reason, created_at
    ) VALUES (
        v_actor_id,
        v_actor_role::text,
        'PAYMENT_' || p_decision::text,
        'payment_records',
        v_payment.id,
        jsonb_build_object(
            'verification_status', 'PENDING_VERIFICATION',
            'schedule_verified_paid', v_schedule.verified_paid_amount,
            'booking_status', v_booking.status,
            'unit_status', v_unit.status
        ),
        jsonb_build_object(
            'verification_status', p_decision,
            'paid_amount', v_payment.paid_amount,
            'schedule_verified_paid', v_new_verified_sum,
            'schedule_remaining', v_new_remaining,
            'booking_status', v_new_booking_status,
            'unit_status', v_new_unit_status,
            'deal_id', v_deal_id,
            'kpr_application_id', v_kpr_id
        ),
        COALESCE(p_verification_notes, 'Verifikasi pembayaran oleh Admin'),
        v_now
    );

    RETURN jsonb_build_object(
        'payment_record_id', v_payment.id,
        'payment_reference', v_payment.reference_number,
        'decision', p_decision,
        'schedule_id', v_schedule.id,
        'schedule_status', COALESCE(v_new_sched_status, v_schedule.status),
        'verified_paid_amount', v_new_verified_sum,
        'remaining_amount', v_new_remaining,
        'booking_status', v_new_booking_status,
        'unit_status', v_new_unit_status,
        'deal_id', v_deal_id,
        'kpr_application_id', v_kpr_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_verify_payment_record(UUID, public.payment_verification_enum, TEXT, VARCHAR, VARCHAR, SMALLINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_verify_payment_record(UUID, public.payment_verification_enum, TEXT, VARCHAR, VARCHAR, SMALLINT) TO authenticated, service_role;

-- ============================================================================
-- 3. TX-03: public.rpc_expire_overdue_bookings
-- Tujuan: Menyapu dan mengubah Booking yang melewati batas waktu 72 jam menjadi
--         'EXPIRED' serta melepaskan Unit kembali menjadi 'AVAILABLE' dengan syarat
--         TIDAK ADA bukti bayar Booking Fee yang sedang 'PENDING_VERIFICATION'
--         atau sudah 'VERIFIED' (Proteksi PD-01).
-- Otorisasi Ketat:
--   - Pemanggil ber-identitas (auth.uid() IS NOT NULL): WAJIB ADMIN aktif.
--     SALES, SUPERVISOR, dan akun nonaktif ditolak (42501).
--   - Pemanggil sistem (auth.uid() IS NULL): HANYA diizinkan jika klaim JWT
--     atau role sesi benar-benar 'service_role' -> actor_role = 'SYSTEM_AUTOMATION'.
--     Pemanggil tanpa identitas sah ditolak (42501).
-- Urutan Penguncian Global:
--   bookings (batch ORDER BY expires_at, id FOR UPDATE SKIP LOCKED)
--   -> units -> payment_schedules (ORDER BY id) -> follow_up_tasks (ORDER BY id)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_expire_overdue_bookings(
    p_batch_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id          UUID;
    v_user_role         public.system_role_enum;
    v_actor_role        VARCHAR(30);
    v_jwt_claims_raw    TEXT;
    v_jwt_role          TEXT;
    v_local_role        TEXT;
    v_now               TIMESTAMPTZ := clock_timestamp();
    v_batch_limit       INTEGER;
    v_candidate_ids     UUID[];
    v_booking_id        UUID;
    v_candidate         RECORD;
    v_expired_count     INTEGER := 0;
    v_expired_ids       UUID[] := ARRAY[]::UUID[];
BEGIN
    -- 1. Validasi Otorisasi Ketat (ADMIN atau service_role terverifikasi saja)
    v_actor_id := auth.uid();
    v_jwt_claims_raw := NULLIF(trim(current_setting('request.jwt.claims', true)), '');

    IF v_jwt_claims_raw IS NOT NULL THEN
        BEGIN
            v_jwt_role := NULLIF(trim(v_jwt_claims_raw::jsonb ->> 'role'), '');
        EXCEPTION WHEN OTHERS THEN
            v_jwt_role := NULL;
        END;
    END IF;

    v_jwt_role := COALESCE(v_jwt_role, NULLIF(trim(current_setting('request.jwt.claim.role', true)), ''));
    v_local_role := NULLIF(trim(current_setting('role', true)), '');

    IF v_actor_id IS NOT NULL THEN
        v_user_role := app_security.get_current_user_role();
        IF v_user_role IS NULL OR v_user_role <> 'ADMIN' THEN
            RAISE EXCEPTION 'FORBIDDEN: Hanya ADMIN atau service_role (Cron) yang berwenang menjalankan proses kedaluwarsa Booking massal.'
                USING ERRCODE = '42501';
        END IF;
        v_actor_role := v_user_role::text;
    ELSE
        -- JANGAN pernah menganggap auth.uid() IS NULL otomatis sebagai SYSTEM_AUTOMATION.
        -- Wajib terverifikasi sebagai service_role melalui klaim JWT atau local session role.
        IF v_jwt_role = 'service_role'
           OR (v_jwt_role IS NULL AND v_local_role = 'service_role') THEN
            v_actor_role := 'SYSTEM_AUTOMATION';
        ELSE
            RAISE EXCEPTION 'UNAUTHORIZED: Pemanggil tanpa identitas sah atau tanpa hak service_role tidak diizinkan menjalankan kedaluwarsa Booking.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    v_batch_limit := LEAST(GREATEST(COALESCE(p_batch_limit, 50), 1), 200);

    -- 2. Kunci batch kandidat Booking secara deterministik dengan SKIP LOCKED
    --    agar eksekusi konkuren (Cron vs Admin / trg_00) tidak saling memblokir
    --    atau memproses Booking yang sedang dipegang transaksi lain.
    SELECT ARRAY(
        SELECT b.id
        FROM public.bookings AS b
        WHERE b.status = 'PENDING_FEE'
          AND b.expires_at < v_now
          AND NOT EXISTS (
              SELECT 1
              FROM public.payment_records AS pr
              WHERE pr.booking_id = b.id
                AND pr.verification_status IN ('PENDING_VERIFICATION', 'VERIFIED')
          )
        ORDER BY b.expires_at ASC, b.id ASC
        LIMIT v_batch_limit
        FOR UPDATE OF b SKIP LOCKED
    ) INTO v_candidate_ids;

    IF v_candidate_ids IS NULL OR array_length(v_candidate_ids, 1) IS NULL THEN
        RETURN jsonb_build_object(
            'expired_count', 0,
            'expired_booking_ids', v_expired_ids,
            'evaluated_at', v_now
        );
    END IF;

    -- 3. Proses setiap Booking yang sudah terkunci sesuai urutan global:
    --    bookings (sudah terkunci) -> units -> payment_schedules -> follow_up_tasks
    FOREACH v_booking_id IN ARRAY v_candidate_ids
    LOOP
        SELECT b.id, b.reference_number, b.unit_id, b.lead_id, b.current_sales_id, b.team_id, b.expires_at, b.status
        INTO v_candidate
        FROM public.bookings AS b
        WHERE b.id = v_booking_id;

        IF NOT FOUND OR v_candidate.status <> 'PENDING_FEE' OR v_candidate.expires_at >= v_now THEN
            CONTINUE;
        END IF;

        -- Re-evaluasi proteksi PD-01 SETELAH baris booking terkunci FOR UPDATE:
        -- menutup celah snapshot READ COMMITTED apabila ada transaksi payment_records
        -- yang baru saja COMMIT tepat sebelum baris booking ini berhasil dikunci.
        IF EXISTS (
            SELECT 1
            FROM public.payment_records AS pr_chk
            WHERE pr_chk.booking_id = v_candidate.id
              AND pr_chk.verification_status IN ('PENDING_VERIFICATION', 'VERIFIED')
        ) THEN
            CONTINUE;
        END IF;

        -- Kunci baris anak secara kanonik sebelum mutasi
        PERFORM 1
        FROM public.units AS u
        WHERE u.id = v_candidate.unit_id
        FOR UPDATE;

        PERFORM 1
        FROM public.payment_schedules AS ps
        WHERE ps.booking_id = v_candidate.id
          AND ps.status <> 'PAID'
        ORDER BY ps.id
        FOR UPDATE;

        PERFORM 1
        FROM public.follow_up_tasks AS fut
        WHERE fut.related_schedule_id IN (
            SELECT ps_sub.id
            FROM public.payment_schedules AS ps_sub
            WHERE ps_sub.booking_id = v_candidate.id
        )
          AND fut.status IN ('PENDING', 'OVERDUE')
        ORDER BY fut.id
        FOR UPDATE;

        -- 3a. Ubah status Booking menjadi EXPIRED
        UPDATE public.bookings
        SET status = 'EXPIRED',
            cancelled_at = v_now,
            cancellation_reason = 'Masa berlaku Booking 72 jam berakhir tanpa pembayaran Booking Fee.'
        WHERE id = v_candidate.id;

        -- 3b. Batalkan jadwal tagihan yang belum dibayar
        UPDATE public.payment_schedules
        SET status = 'CANCELLED'
        WHERE booking_id = v_candidate.id
          AND status <> 'PAID';

        -- 3c. Batalkan hanya tugas penagihan yang tertaut langsung ke jadwal Booking ini
        UPDATE public.follow_up_tasks
        SET status = 'CANCELLED'
        WHERE related_schedule_id IN (
            SELECT ps.id
            FROM public.payment_schedules AS ps
            WHERE ps.booking_id = v_candidate.id
        )
          AND status IN ('PENDING', 'OVERDUE');

        -- 3d. Lepaskan status Unit kembali menjadi AVAILABLE & kosongkan pemegang reservasi
        UPDATE public.units
        SET status = 'AVAILABLE',
            current_holder_sales_id = NULL,
            current_holder_team_id = NULL,
            status_updated_at = v_now
        WHERE id = v_candidate.unit_id
          AND status = 'HELD';

        -- 3e. Masukkan event ke Notification Outbox dengan deduplication_key unik
        INSERT INTO public.notification_outbox (
            event_type,
            deduplication_key,
            payload
        ) VALUES (
            'BOOKING_EXPIRY_ALERT',
            'BOOKING_EXPIRED:' || v_candidate.id::text,
            jsonb_build_object(
                'booking_id', v_candidate.id,
                'booking_reference', v_candidate.reference_number,
                'unit_id', v_candidate.unit_id,
                'lead_id', v_candidate.lead_id,
                'sales_id', v_candidate.current_sales_id,
                'team_id', v_candidate.team_id,
                'expired_at', v_now
            )
        )
        ON CONFLICT (deduplication_key) DO NOTHING;

        -- 3f. Catat ke Audit Log
        INSERT INTO public.audit_logs (
            actor_user_id, actor_role, action_type, entity_table, entity_id,
            old_values, new_values, reason, created_at
        ) VALUES (
            v_actor_id,
            v_actor_role,
            'BOOKING_AUTO_EXPIRED',
            'bookings',
            v_candidate.id,
            jsonb_build_object('booking_status', 'PENDING_FEE', 'unit_status', 'HELD', 'expires_at', v_candidate.expires_at),
            jsonb_build_object('booking_status', 'EXPIRED', 'unit_status', 'AVAILABLE'),
            'Pelepasan otomatis karena melewati batas waktu pembayaran Booking Fee (PD-01).',
            v_now
        );

        v_expired_count := v_expired_count + 1;
        v_expired_ids := array_append(v_expired_ids, v_candidate.id);
    END LOOP;

    RETURN jsonb_build_object(
        'expired_count', v_expired_count,
        'expired_booking_ids', v_expired_ids,
        'evaluated_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_expire_overdue_bookings(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_expire_overdue_bookings(INTEGER) TO authenticated, service_role;

-- ============================================================================
-- 4. TX-04: public.rpc_record_kpr_approval
-- Tujuan: Mencatat peristiwa Keputusan Kredit Bank ('APPROVED' / SP3K atau
--         'REJECTED_BY_BANK') secara terpisah dari Akad & Pencairan (PD-02),
--         menjaga pemisahan current_stage vs application_status (File 02 v1.4),
--         serta otomatis membuat jadwal tagihan 'KPR_TOPUP_DP' jika Turun Plafon.
-- Urutan Penguncian Global:
--   bookings -> kpr_applications -> (payment_schedules / follow_up_tasks)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_record_kpr_approval(
    p_kpr_application_id UUID,
    p_decision VARCHAR(30),
    p_sp3k_reference_number VARCHAR(80) DEFAULT NULL,
    p_approved_loan_amount NUMERIC(15,2) DEFAULT NULL,
    p_topup_dp_due_date DATE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id              UUID;
    v_actor_role            public.system_role_enum;
    v_decision              VARCHAR(30);
    v_booking_id            UUID;
    v_booking               RECORD;
    v_kpr                   RECORD;
    v_existing_topup        RECORD;
    v_now                   TIMESTAMPTZ := clock_timestamp();
    v_shortfall_amount      NUMERIC(15,2) := 0;
    v_topup_schedule_id     UUID := NULL;
    v_new_app_status        public.kpr_application_status_enum;
    v_new_stage             public.kpr_stage_enum;
    v_topup_due_date        DATE;
BEGIN
    -- 1. Validasi Otorisasi: Hanya ADMIN
    v_actor_id := auth.uid();
    v_actor_role := app_security.get_current_user_role();

    IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_actor_role <> 'ADMIN' THEN
        RAISE EXCEPTION 'FORBIDDEN: Hanya ADMIN yang dapat mencatat keputusan persetujuan KPR bank.'
            USING ERRCODE = '42501';
    END IF;

    v_decision := upper(trim(COALESCE(p_decision, '')));
    IF v_decision NOT IN ('APPROVED', 'REJECTED_BY_BANK') THEN
        RAISE EXCEPTION 'INVALID_DECISION: Keputusan KPR harus APPROVED atau REJECTED_BY_BANK.'
            USING ERRCODE = '22023';
    END IF;

    -- 2. Pembacaan Non-Penguncian lalu Kunci Baris sesuai Urutan Global:
    --    bookings -> kpr_applications
    SELECT k.booking_id
    INTO v_booking_id
    FROM public.kpr_applications AS k
    WHERE k.id = p_kpr_application_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Aplikasi KPR tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT b.*
    INTO v_booking
    FROM public.bookings AS b
    WHERE b.id = v_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Booking terkait KPR tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT k.*
    INTO v_kpr
    FROM public.kpr_applications AS k
    WHERE k.id = p_kpr_application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Aplikasi KPR tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_booking.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'INVALID_BOOKING_STATUS: Keputusan KPR hanya dapat dicatat pada Booking berstatus ACTIVE (saat ini: [%]).',
            v_booking.status
            USING ERRCODE = '22023';
    END IF;

    IF v_kpr.application_status <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'INVALID_KPR_STATUS: Aplikasi KPR sudah berstatus [%] dan tidak dapat diputuskan ulang.',
            v_kpr.application_status
            USING ERRCODE = '22023';
    END IF;

    IF v_kpr.current_stage NOT IN ('SUBMITTED', 'BANK_VERIFICATION', 'APPRAISAL', 'ADDITIONAL_REQUIREMENTS') THEN
        RAISE EXCEPTION 'INVALID_KPR_STAGE: Aplikasi KPR pada tahap [%] belum siap menerima keputusan bank.',
            v_kpr.current_stage
            USING ERRCODE = '22023';
    END IF;

    -- 3. Eksekusi Keputusan APPROVED vs REJECTED_BY_BANK
    IF v_decision = 'APPROVED' THEN
        IF p_sp3k_reference_number IS NULL OR char_length(trim(p_sp3k_reference_number)) < 3 THEN
            RAISE EXCEPTION 'SP3K_REQUIRED: Nomor referensi SP3K/SPPK dari bank wajib diisi.'
                USING ERRCODE = '22023';
        END IF;

        IF p_approved_loan_amount IS NULL OR p_approved_loan_amount <= 0 OR p_approved_loan_amount > v_kpr.requested_loan_amount THEN
            RAISE EXCEPTION 'INVALID_APPROVED_AMOUNT: Plafon disetujui (Rp %) harus > 0 dan tidak boleh melebihi plafon diajukan (Rp %).',
                p_approved_loan_amount, v_kpr.requested_loan_amount
                USING ERRCODE = '22023';
        END IF;

        v_new_app_status := 'APPROVED';
        v_new_stage := 'APPROVED';

        UPDATE public.kpr_applications
        SET current_stage = v_new_stage,
            application_status = v_new_app_status,
            approved_at = v_now,
            sp3k_reference_number = trim(p_sp3k_reference_number),
            approved_loan_amount = p_approved_loan_amount,
            disbursement_status = 'NOT_DISBURSED',
            primary_disbursed_amount = 0,
            subsequent_disbursed_amount = 0,
            remaining_undisbursed_amount = p_approved_loan_amount,
            notes = COALESCE(p_notes, notes)
        WHERE id = v_kpr.id;

        INSERT INTO public.kpr_stage_histories (
            kpr_application_id, from_stage, to_stage, notes, changed_by, changed_at
        ) VALUES (
            v_kpr.id,
            v_kpr.current_stage,
            'APPROVED',
            COALESCE(p_notes, 'SP3K terbit (' || trim(p_sp3k_reference_number) || ') dengan plafon disetujui Rp ' || p_approved_loan_amount::text),
            v_actor_id,
            v_now
        );

        -- Evaluasi Kasus Turun Plafon (Shortfall) — mengunci payment_schedules setelah kpr_applications
        v_shortfall_amount := v_kpr.requested_loan_amount - p_approved_loan_amount;

        IF v_shortfall_amount > 0 THEN
            v_topup_due_date := COALESCE(p_topup_dp_due_date, ((v_now + interval '7 days') AT TIME ZONE 'Asia/Jakarta')::date);

            SELECT ps.*
            INTO v_existing_topup
            FROM public.payment_schedules AS ps
            WHERE ps.booking_id = v_booking.id
              AND ps.schedule_type = 'KPR_TOPUP_DP'
              AND ps.installment_number = 1
            ORDER BY ps.id
            FOR UPDATE;

            IF FOUND THEN
                IF v_existing_topup.status = 'PAID' OR v_existing_topup.verified_paid_amount > v_shortfall_amount THEN
                    RAISE EXCEPTION 'INVALID_TOPUP_DP_STATE: Jadwal KPR_TOPUP_DP sudah lunas atau nominal terbayar melebihi selisih turun plafon.'
                        USING ERRCODE = '22023';
                END IF;

                UPDATE public.payment_schedules
                SET title = 'Tambahan DP (Selisih Turun Plafon KPR ' || v_kpr.reference_number || ')',
                    scheduled_amount = v_shortfall_amount,
                    remaining_amount = v_shortfall_amount - v_existing_topup.verified_paid_amount,
                    due_date = v_topup_due_date,
                    status = CASE
                        WHEN v_shortfall_amount - v_existing_topup.verified_paid_amount = 0 THEN 'PAID'::public.schedule_status_enum
                        WHEN v_existing_topup.verified_paid_amount > 0 THEN 'PARTIALLY_PAID'::public.schedule_status_enum
                        ELSE 'UNPAID'::public.schedule_status_enum
                    END,
                    paid_at = CASE
                        WHEN v_shortfall_amount - v_existing_topup.verified_paid_amount = 0 THEN COALESCE(paid_at, v_now)
                        ELSE paid_at
                    END
                WHERE id = v_existing_topup.id
                RETURNING id INTO v_topup_schedule_id;
            ELSE
                INSERT INTO public.payment_schedules (
                    booking_id,
                    schedule_type,
                    installment_number,
                    title,
                    scheduled_amount,
                    verified_paid_amount,
                    remaining_amount,
                    due_date,
                    status
                ) VALUES (
                    v_booking.id,
                    'KPR_TOPUP_DP',
                    1,
                    'Tambahan DP (Selisih Turun Plafon KPR ' || v_kpr.reference_number || ')',
                    v_shortfall_amount,
                    0,
                    v_shortfall_amount,
                    v_topup_due_date,
                    'UNPAID'
                )
                RETURNING id INTO v_topup_schedule_id;
            END IF;
        END IF;

    ELSE
        -- Jika REJECTED_BY_BANK: pertahankan current_stage terakhir & ubah application_status
        IF p_notes IS NULL OR char_length(trim(p_notes)) < 5 THEN
            RAISE EXCEPTION 'REJECTION_REASON_REQUIRED: Alasan penolakan KPR oleh bank wajib diisi minimal 5 karakter.'
                USING ERRCODE = '22023';
        END IF;

        v_new_app_status := 'REJECTED_BY_BANK';
        v_new_stage := v_kpr.current_stage;

        UPDATE public.kpr_applications
        SET application_status = 'REJECTED_BY_BANK',
            rejected_at = v_now,
            rejection_reason = trim(p_notes),
            notes = COALESCE(p_notes, notes)
        WHERE id = v_kpr.id;

        -- Kunci deterministik lalu batalkan tugas tindak lanjut KPR yang masih terbuka
        PERFORM 1
        FROM public.follow_up_tasks AS fut
        WHERE fut.related_kpr_application_id = v_kpr.id
          AND fut.status IN ('PENDING', 'OVERDUE')
        ORDER BY fut.id
        FOR UPDATE;

        UPDATE public.follow_up_tasks
        SET status = 'CANCELLED'
        WHERE related_kpr_application_id = v_kpr.id
          AND status IN ('PENDING', 'OVERDUE');
    END IF;

    -- 4. Kirim Event ke Notification Outbox
    INSERT INTO public.notification_outbox (
        event_type,
        deduplication_key,
        payload
    ) VALUES (
        'KPR_DOCUMENT_UPDATE',
        'KPR_DECISION:' || v_kpr.id::text || ':' || v_decision,
        jsonb_build_object(
            'kpr_application_id', v_kpr.id,
            'kpr_reference', v_kpr.reference_number,
            'booking_id', v_booking.id,
            'decision', v_decision,
            'application_status', v_new_app_status,
            'current_stage', v_new_stage,
            'approved_loan_amount', p_approved_loan_amount,
            'shortfall_topup_dp', v_shortfall_amount,
            'sales_id', v_kpr.current_sales_id,
            'team_id', v_kpr.team_id
        )
    )
    ON CONFLICT (deduplication_key) DO NOTHING;

    -- 5. Catat ke Audit Log
    INSERT INTO public.audit_logs (
        actor_user_id, actor_role, action_type, entity_table, entity_id,
        old_values, new_values, reason, created_at
    ) VALUES (
        v_actor_id,
        v_actor_role::text,
        'KPR_' || v_decision,
        'kpr_applications',
        v_kpr.id,
        jsonb_build_object(
            'current_stage', v_kpr.current_stage,
            'application_status', v_kpr.application_status,
            'requested_loan_amount', v_kpr.requested_loan_amount
        ),
        jsonb_build_object(
            'current_stage', v_new_stage,
            'application_status', v_new_app_status,
            'sp3k_reference_number', p_sp3k_reference_number,
            'approved_loan_amount', p_approved_loan_amount,
            'shortfall_topup_dp', v_shortfall_amount,
            'topup_schedule_id', v_topup_schedule_id
        ),
        COALESCE(p_notes, 'Pencatatan keputusan KPR bank: ' || v_decision),
        v_now
    );

    RETURN jsonb_build_object(
        'kpr_application_id', v_kpr.id,
        'decision', v_decision,
        'application_status', v_new_app_status,
        'current_stage', v_new_stage,
        'approved_loan_amount', p_approved_loan_amount,
        'shortfall_topup_dp', v_shortfall_amount,
        'topup_schedule_id', v_topup_schedule_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_record_kpr_approval(UUID, VARCHAR, VARCHAR, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_record_kpr_approval(UUID, VARCHAR, VARCHAR, NUMERIC, DATE, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 5. TX-05: public.rpc_transition_deal_status
-- Tujuan: Mengelola transisi 3 dimensi Deal (Sales Outcome, Contract Status,
--         Payment Settlement Status):
--         1. ACTIVATE_PPJB_CONTRACT (Khusus Cash Bertahap Kebijakan C2 PD-03):
--            Sales Outcome -> CLOSED_WON, Contract -> UNDER_CONTRACT, Unit tetap BOOKED.
--         2. RECORD_KPR_AKAD_COMPLETED (Khusus KPR Tahap 9 PD-02):
--            Memvalidasi seluruh DP & Top-Up DP sudah PAID, mencatat Akta Akad.
--         3. FINALIZE_FULL_SETTLEMENT:
--            Mengunci pelunasan 100%, Deal -> FULLY_SETTLED, Unit -> SOLD.
-- Urutan Penguncian Global:
--   leads -> bookings -> units -> kpr_applications -> deals
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_transition_deal_status(
    p_deal_id UUID,
    p_transition_action VARCHAR(40),
    p_contract_doc_number VARCHAR(80) DEFAULT NULL,
    p_contract_file_path TEXT DEFAULT NULL,
    p_notary_name VARCHAR(120) DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id              UUID;
    v_actor_role            public.system_role_enum;
    v_lead_id               UUID;
    v_booking_id            UUID;
    v_unit_id               UUID;
    v_deal                  RECORD;
    v_booking               RECORD;
    v_unit                  RECORD;
    v_lead                  RECORD;
    v_kpr                   RECORD;
    v_now                   TIMESTAMPTZ := clock_timestamp();
    v_unpaid_dp_count       INTEGER;
    v_unpaid_all_count      INTEGER;
    v_total_scheduled       NUMERIC(15,2);
    v_new_unit_status       public.unit_status_enum;
    v_new_booking_status    public.booking_status_enum;
    v_new_sales_outcome     public.deal_sales_outcome_enum;
    v_new_contract_status   public.deal_contract_status_enum;
    v_new_settlement_status public.deal_settlement_status_enum;
BEGIN
    -- 1. Validasi Otorisasi: Hanya ADMIN
    v_actor_id := auth.uid();
    v_actor_role := app_security.get_current_user_role();

    IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_actor_role <> 'ADMIN' THEN
        RAISE EXCEPTION 'FORBIDDEN: Hanya ADMIN yang dapat mengesahkan transisi status kontrak dan Deal.'
            USING ERRCODE = '42501';
    END IF;

    SELECT d.lead_id, d.booking_id, d.unit_id
    INTO v_lead_id, v_booking_id, v_unit_id
    FROM public.deals AS d
    WHERE d.id = p_deal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Deal tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    -- 2. Kunci Baris sesuai Urutan Global:
    --    leads -> bookings -> units -> kpr_applications -> deals
    SELECT l.* INTO v_lead FROM public.leads AS l WHERE l.id = v_lead_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Lead terkait Deal tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT b.* INTO v_booking FROM public.bookings AS b WHERE b.id = v_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Booking terkait Deal tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT u.* INTO v_unit FROM public.units AS u WHERE u.id = v_unit_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Unit terkait Deal tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT k.* INTO v_kpr FROM public.kpr_applications AS k WHERE k.booking_id = v_booking_id FOR UPDATE;

    SELECT d.* INTO v_deal FROM public.deals AS d WHERE d.id = p_deal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Deal tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    IF v_deal.contract_status = 'CONTRACT_TERMINATED'
       OR v_booking.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'INVALID_DEAL_STATE: Transaksi berstatus Booking [%] / Kontrak [%] tidak dapat ditransisikan.',
            v_booking.status, v_deal.contract_status
            USING ERRCODE = '22023';
    END IF;

    v_new_unit_status := v_unit.status;
    v_new_booking_status := v_booking.status;
    v_new_sales_outcome := v_deal.sales_outcome_status;
    v_new_contract_status := v_deal.contract_status;
    v_new_settlement_status := v_deal.payment_settlement_status;

    -- ========================================================================
    -- AKSI 1: ACTIVATE_PPJB_CONTRACT (Implementasi Kebijakan C2 Cash Bertahap PD-03)
    -- ========================================================================
    IF p_transition_action = 'ACTIVATE_PPJB_CONTRACT' THEN
        IF v_deal.payment_method <> 'CASH_BERTAHAP' THEN
            RAISE EXCEPTION 'INVALID_ACTION: Aktivasi PPJB sebelum lunas 100%% khusus untuk metode CASH_BERTAHAP.'
                USING ERRCODE = '22023';
        END IF;

        IF v_deal.contract_status <> 'PRE_CONTRACT' THEN
            RAISE EXCEPTION 'INVALID_CONTRACT_STATE: Kontrak PPJB hanya dapat diaktifkan saat status kontrak PRE_CONTRACT (saat ini: [%]).',
                v_deal.contract_status
                USING ERRCODE = '22023';
        END IF;

        IF p_contract_doc_number IS NULL OR char_length(trim(p_contract_doc_number)) < 3 THEN
            RAISE EXCEPTION 'DOCUMENT_REQUIRED: Nomor dokumen kontrak PPJB wajib diisi.'
                USING ERRCODE = '22023';
        END IF;

        -- Pastikan seluruh jadwal BOOKING_FEE dan DOWN_PAYMENT sudah berstatus PAID
        SELECT count(*)
        INTO v_unpaid_dp_count
        FROM public.payment_schedules
        WHERE booking_id = v_booking.id
          AND schedule_type IN ('BOOKING_FEE', 'DOWN_PAYMENT')
          AND status <> 'PAID';

        IF v_unpaid_dp_count > 0 THEN
            RAISE EXCEPTION 'DP_NOT_SETTLED: Booking Fee dan Down Payment (DP) wajib berstatus PAID sebelum kontrak PPJB diaktifkan.'
                USING ERRCODE = '22023';
        END IF;

        v_new_sales_outcome := 'CLOSED_WON';
        v_new_contract_status := 'UNDER_CONTRACT';
        v_new_settlement_status := CASE
            WHEN v_deal.payment_settlement_status = 'BOOKING_FEE_SETTLED' THEN 'DP_SETTLED_ONGOING'::public.deal_settlement_status_enum
            ELSE v_deal.payment_settlement_status
        END;

        IF v_lead.pipeline_stage <> 'CLOSED_WON' THEN
            UPDATE public.leads SET pipeline_stage = 'CLOSED_WON' WHERE id = v_lead.id;
            INSERT INTO public.lead_pipeline_histories (
                lead_id, from_stage, to_stage, notes, changed_by, changed_at
            ) VALUES (
                v_lead.id, v_lead.pipeline_stage, 'CLOSED_WON',
                'Closing Sales Cash Bertahap melalui aktivasi kontrak PPJB ' || trim(p_contract_doc_number), v_actor_id, v_now
            );
        END IF;

        -- Kebijakan C2: Sales Outcome -> CLOSED_WON, Contract -> UNDER_CONTRACT, Unit tetap BOOKED
        UPDATE public.deals
        SET sales_outcome_status = v_new_sales_outcome,
            contract_status = v_new_contract_status,
            payment_settlement_status = v_new_settlement_status,
            contract_document_number = trim(p_contract_doc_number),
            contract_file_path = COALESCE(p_contract_file_path, contract_file_path),
            contract_signed_at = v_now,
            sales_closed_won_at = COALESCE(sales_closed_won_at, v_now),
            notes = COALESCE(p_notes, notes)
        WHERE id = v_deal.id;

        INSERT INTO public.deal_status_histories (
            deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
        ) VALUES
            (v_deal.id, 'SALES_OUTCOME', v_deal.sales_outcome_status::text, 'CLOSED_WON', 'Kontrak PPJB Cash Bertahap aktif & DP lunas (Kebijakan C2).', v_actor_id, v_now),
            (v_deal.id, 'CONTRACT_STATUS', v_deal.contract_status::text, 'UNDER_CONTRACT', 'Penandatanganan PPJB: ' || trim(p_contract_doc_number), v_actor_id, v_now);

        IF v_new_settlement_status IS DISTINCT FROM v_deal.payment_settlement_status THEN
            INSERT INTO public.deal_status_histories (
                deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
            ) VALUES (
                v_deal.id, 'PAYMENT_SETTLEMENT', v_deal.payment_settlement_status::text, v_new_settlement_status::text,
                'Booking Fee & DP lunas saat aktivasi PPJB.', v_actor_id, v_now
            );
        END IF;

    -- ========================================================================
    -- AKSI 2: RECORD_KPR_AKAD_COMPLETED (Peristiwa Pengikatan Hukum Akad KPR PD-02)
    -- ========================================================================
    ELSIF p_transition_action = 'RECORD_KPR_AKAD_COMPLETED' THEN
        IF v_deal.payment_method <> 'KPR' THEN
            RAISE EXCEPTION 'INVALID_ACTION: Pencatatan Akad KPR hanya untuk transaksi bermetode KPR.'
                USING ERRCODE = '22023';
        END IF;

        IF v_deal.contract_status <> 'PRE_CONTRACT' THEN
            RAISE EXCEPTION 'INVALID_CONTRACT_STATE: Akad KPR hanya dapat dicatat saat kontrak berstatus PRE_CONTRACT (saat ini: [%]).',
                v_deal.contract_status
                USING ERRCODE = '22023';
        END IF;

        IF v_kpr.id IS NULL
           OR v_kpr.application_status <> 'APPROVED'
           OR v_kpr.current_stage <> 'AKAD_SCHEDULED' THEN
            RAISE EXCEPTION 'INVALID_KPR_STAGE: Aplikasi KPR harus berstatus APPROVED dan berada pada tahap AKAD_SCHEDULED sebelum diselesaikan menjadi AKAD_COMPLETED.'
                USING ERRCODE = '22023';
        END IF;

        IF p_contract_doc_number IS NULL OR char_length(trim(p_contract_doc_number)) < 3 THEN
            RAISE EXCEPTION 'DEED_NUMBER_REQUIRED: Nomor Akta Perjanjian Kredit / AJB wajib diisi.'
                USING ERRCODE = '22023';
        END IF;

        -- Validasi bahwa seluruh kewajiban tunai pembeli (Booking Fee, DP, dan KPR_TOPUP_DP jika ada) sudah PAID
        SELECT count(*)
        INTO v_unpaid_dp_count
        FROM public.payment_schedules
        WHERE booking_id = v_booking.id
          AND schedule_type IN ('BOOKING_FEE', 'DOWN_PAYMENT', 'KPR_TOPUP_DP')
          AND status <> 'PAID';

        IF v_unpaid_dp_count > 0 THEN
            RAISE EXCEPTION 'DP_OR_TOPUP_UNPAID: Seluruh tagihan Booking Fee, DP, dan Tambahan DP (Turun Plafon) wajib lunas (PAID) sebelum Akad KPR disahkan selesai.'
                USING ERRCODE = '22023';
        END IF;

        UPDATE public.kpr_applications
        SET current_stage = 'AKAD_COMPLETED',
            akad_completed_at = v_now,
            akad_deed_number = trim(p_contract_doc_number),
            notary_name = COALESCE(NULLIF(trim(p_notary_name), ''), notary_name),
            notes = COALESCE(p_notes, notes)
        WHERE id = v_kpr.id;

        INSERT INTO public.kpr_stage_histories (
            kpr_application_id, from_stage, to_stage, notes, changed_by, changed_at
        ) VALUES (
            v_kpr.id, 'AKAD_SCHEDULED', 'AKAD_COMPLETED',
            'Akad Kredit selesai ditandatangani. Nomor Akta: ' || trim(p_contract_doc_number), v_actor_id, v_now
        );

        v_new_contract_status := 'UNDER_CONTRACT';
        v_new_settlement_status := 'DP_SETTLED_ONGOING';

        UPDATE public.deals
        SET contract_status = v_new_contract_status,
            payment_settlement_status = v_new_settlement_status,
            contract_document_number = trim(p_contract_doc_number),
            contract_file_path = COALESCE(p_contract_file_path, contract_file_path),
            contract_signed_at = v_now,
            notes = COALESCE(p_notes, notes)
        WHERE id = v_deal.id;

        INSERT INTO public.deal_status_histories (
            deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
        ) VALUES (
            v_deal.id, 'CONTRACT_STATUS', v_deal.contract_status::text, 'UNDER_CONTRACT',
            'Penyelesaian Akad KPR (' || trim(p_contract_doc_number) || '). Menunggu pencairan dana bank.', v_actor_id, v_now
        );

        IF v_deal.payment_settlement_status IS DISTINCT FROM 'DP_SETTLED_ONGOING' THEN
            INSERT INTO public.deal_status_histories (
                deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
            ) VALUES (
                v_deal.id, 'PAYMENT_SETTLEMENT', v_deal.payment_settlement_status::text, 'DP_SETTLED_ONGOING',
                'Kewajiban tunai pembeli & Akad KPR selesai.', v_actor_id, v_now
            );
        END IF;

    -- ========================================================================
    -- AKSI 3: FINALIZE_FULL_SETTLEMENT (Penutupan Lunas Akhir 100% & Unit SOLD)
    -- ========================================================================
    ELSIF p_transition_action = 'FINALIZE_FULL_SETTLEMENT' THEN
        IF v_deal.payment_settlement_status = 'FULLY_SETTLED' OR v_unit.status = 'SOLD' THEN
            RAISE EXCEPTION 'ALREADY_SETTLED: Deal sudah berstatus FULLY_SETTLED atau Unit sudah berstatus SOLD.'
                USING ERRCODE = '22023';
        END IF;

        SELECT
            count(*) FILTER (WHERE status <> 'PAID' AND status <> 'CANCELLED'),
            COALESCE(SUM(scheduled_amount) FILTER (WHERE status <> 'CANCELLED'), 0)
        INTO v_unpaid_all_count, v_total_scheduled
        FROM public.payment_schedules
        WHERE booking_id = v_booking.id;

        IF v_unpaid_all_count > 0 THEN
            RAISE EXCEPTION 'OUTSTANDING_BALANCE_EXISTS: Masih terdapat % jadwal pembayaran yang belum lunas (PAID).', v_unpaid_all_count
                USING ERRCODE = '22023';
        END IF;

        IF v_deal.payment_method = 'KPR' THEN
            IF v_kpr.id IS NULL
               OR v_kpr.application_status <> 'COMPLETED'
               OR v_kpr.disbursement_status <> 'FULLY_DISBURSED' THEN
                RAISE EXCEPTION 'KPR_NOT_FULLY_DISBURSED: Aplikasi KPR wajib berstatus COMPLETED dan pencairan plafon mencapai 100%% (FULLY_DISBURSED).'
                    USING ERRCODE = '22023';
            END IF;
        ELSIF v_total_scheduled < v_booking.agreed_final_price THEN
            RAISE EXCEPTION 'INCOMPLETE_SCHEDULE_TOTAL: Total jadwal tagihan (Rp %) belum mencapai Harga Kesepakatan Final (Rp %).',
                v_total_scheduled, v_booking.agreed_final_price
                USING ERRCODE = '22023';
        END IF;

        v_new_sales_outcome := 'CLOSED_WON';
        v_new_contract_status := 'CONTRACT_COMPLETED';
        v_new_settlement_status := 'FULLY_SETTLED';
        v_new_booking_status := 'COMPLETED';
        v_new_unit_status := 'SOLD';

        IF v_lead.pipeline_stage <> 'CLOSED_WON' THEN
            UPDATE public.leads SET pipeline_stage = 'CLOSED_WON' WHERE id = v_lead.id;
            INSERT INTO public.lead_pipeline_histories (
                lead_id, from_stage, to_stage, notes, changed_by, changed_at
            ) VALUES (
                v_lead.id, v_lead.pipeline_stage, 'CLOSED_WON',
                'Deal difinalisasi lunas 100% (Fully Settled).', v_actor_id, v_now
            );
        END IF;

        UPDATE public.bookings SET status = 'COMPLETED' WHERE id = v_booking.id;
        UPDATE public.units SET status = 'SOLD', status_updated_at = v_now WHERE id = v_unit.id;

        UPDATE public.deals
        SET sales_outcome_status = v_new_sales_outcome,
            contract_status = v_new_contract_status,
            payment_settlement_status = v_new_settlement_status,
            sales_closed_won_at = COALESCE(sales_closed_won_at, v_now),
            fully_settled_at = v_now,
            notes = COALESCE(p_notes, notes)
        WHERE id = v_deal.id;

        INSERT INTO public.deal_status_histories (
            deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
        ) VALUES (
            v_deal.id, 'PAYMENT_SETTLEMENT', v_deal.payment_settlement_status::text, 'FULLY_SETTLED',
            COALESCE(p_notes, 'Finalisasi pelunasan penuh 100% dan penguncian unit menjadi SOLD.'), v_actor_id, v_now
        );

    ELSE
        RAISE EXCEPTION 'UNKNOWN_TRANSITION_ACTION: Aksi transisi [%] tidak valid.', p_transition_action
            USING ERRCODE = '22023';
    END IF;

    -- 3. Kirim Event ke Notification Outbox
    INSERT INTO public.notification_outbox (
        event_type,
        deduplication_key,
        payload
    ) VALUES (
        'DEAL_STATUS_UPDATED',
        'DEAL_TRANSITION:' || v_deal.id::text || ':' || p_transition_action,
        jsonb_build_object(
            'deal_id', v_deal.id,
            'booking_id', v_booking.id,
            'unit_id', v_unit.id,
            'transition_action', p_transition_action,
            'sales_outcome_status', v_new_sales_outcome,
            'contract_status', v_new_contract_status,
            'payment_settlement_status', v_new_settlement_status,
            'unit_status', v_new_unit_status,
            'sales_id', v_deal.current_sales_id,
            'team_id', v_deal.team_id
        )
    )
    ON CONFLICT (deduplication_key) DO NOTHING;

    -- 4. Catat ke Audit Log
    INSERT INTO public.audit_logs (
        actor_user_id, actor_role, action_type, entity_table, entity_id,
        old_values, new_values, reason, created_at
    ) VALUES (
        v_actor_id,
        v_actor_role::text,
        'DEAL_TRANSITION_' || p_transition_action,
        'deals',
        v_deal.id,
        jsonb_build_object(
            'sales_outcome', v_deal.sales_outcome_status,
            'contract_status', v_deal.contract_status,
            'payment_settlement', v_deal.payment_settlement_status,
            'booking_status', v_booking.status,
            'unit_status', v_unit.status
        ),
        jsonb_build_object(
            'transition_action', p_transition_action,
            'contract_document_number', p_contract_doc_number,
            'sales_outcome', v_new_sales_outcome,
            'contract_status', v_new_contract_status,
            'payment_settlement', v_new_settlement_status,
            'booking_status', v_new_booking_status,
            'unit_status', v_new_unit_status
        ),
        COALESCE(p_notes, 'Transisi status Deal: ' || p_transition_action),
        v_now
    );

    RETURN jsonb_build_object(
        'deal_id', v_deal.id,
        'transition_action', p_transition_action,
        'sales_outcome_status', v_new_sales_outcome,
        'contract_status', v_new_contract_status,
        'payment_settlement_status', v_new_settlement_status,
        'booking_status', v_new_booking_status,
        'unit_status', v_new_unit_status,
        'updated_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_transition_deal_status(UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_transition_deal_status(UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 6. TX-06: public.rpc_cancel_booking_or_deal
-- Tujuan: Membatalkan Booking atau Deal secara resmi, memvalidasi tidak ada bukti
--         bayar menggantung, menyinkronkan kpr_applications ('BOOKING_CANCELLED')
--         bila masih aktif, menetapkan resolusi dana (NONE, FORFEITED_FULL,
--         FULL_REFUND, PARTIAL_REFUND), mencatat ke refund_transactions tanpa
--         mengubah payment_records (PD-04), dan melepaskan Unit ke AVAILABLE.
-- Urutan Penguncian Global:
--   leads -> bookings -> units -> kpr_applications -> deals
--   -> payment_schedules (ORDER BY id) -> payment_records (ORDER BY id)
--   -> follow_up_tasks (ORDER BY id)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_cancel_booking_or_deal(
    p_booking_id UUID,
    p_cancellation_reason VARCHAR(150),
    p_refund_policy_type public.refund_policy_enum,
    p_agreed_refund_amount NUMERIC(15,2) DEFAULT 0,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id              UUID;
    v_actor_role            public.system_role_enum;
    v_lead_id               UUID;
    v_booking               RECORD;
    v_unit                  RECORD;
    v_kpr                   RECORD;
    v_deal                  RECORD;
    v_kpr_id                UUID := NULL;
    v_kpr_new_status        public.kpr_application_status_enum := NULL;
    v_now                   TIMESTAMPTZ := clock_timestamp();
    v_pending_pay_count     INTEGER := 0;
    v_total_verified_paid   NUMERIC(15,2) := 0;
    v_forfeited_amount      NUMERIC(15,2) := 0;
    v_refund_id             UUID := NULL;
    v_refund_ref            VARCHAR(30) := NULL;
BEGIN
    -- 1. Validasi Otorisasi: Hanya ADMIN
    v_actor_id := auth.uid();
    v_actor_role := app_security.get_current_user_role();

    IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_actor_role <> 'ADMIN' THEN
        RAISE EXCEPTION 'FORBIDDEN: Hanya ADMIN yang berwenang membatalkan Booking atau Deal.'
            USING ERRCODE = '42501';
    END IF;

    IF p_cancellation_reason IS NULL OR char_length(trim(p_cancellation_reason)) < 5 THEN
        RAISE EXCEPTION 'REASON_REQUIRED: Alasan pembatalan wajib diisi minimal 5 karakter.'
            USING ERRCODE = '22023';
    END IF;

    SELECT b.lead_id INTO v_lead_id FROM public.bookings AS b WHERE b.id = p_booking_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Booking tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    -- 2. Kunci Baris sesuai Urutan Global:
    --    leads -> bookings -> units -> kpr_applications -> deals
    PERFORM 1 FROM public.leads AS l WHERE l.id = v_lead_id FOR UPDATE;
    SELECT b.* INTO v_booking FROM public.bookings AS b WHERE b.id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Booking tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT u.* INTO v_unit FROM public.units AS u WHERE u.id = v_booking.unit_id FOR UPDATE;
    SELECT k.* INTO v_kpr FROM public.kpr_applications AS k WHERE k.booking_id = v_booking.id FOR UPDATE;
    SELECT d.* INTO v_deal FROM public.deals AS d WHERE d.booking_id = v_booking.id FOR UPDATE;

    IF v_booking.status IN ('CANCELLED', 'EXPIRED') THEN
        RAISE EXCEPTION 'ALREADY_CANCELLED: Booking [%] sudah berstatus [%].',
            v_booking.reference_number, v_booking.status
            USING ERRCODE = '22023';
    END IF;

    IF v_booking.status = 'COMPLETED' OR v_unit.status = 'SOLD' THEN
        RAISE EXCEPTION 'CANNOT_CANCEL_COMPLETED: Transaksi yang sudah selesai (Booking [%], Unit [%]) tidak dapat dibatalkan.',
            v_booking.status, v_unit.status
            USING ERRCODE = '22023';
    END IF;

    IF v_kpr.id IS NOT NULL THEN
        v_kpr_id := v_kpr.id;
        IF v_kpr.disbursement_status <> 'NOT_DISBURSED' THEN
            RAISE EXCEPTION 'KPR_ALREADY_DISBURSED: Booking tidak dapat dibatalkan karena pencairan KPR sudah berjalan (status: [%]).',
                v_kpr.disbursement_status
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 2B. Kunci seluruh baris payment_schedules dan payment_records milik Booking
    --     secara deterministik sesuai urutan global (Rank 6 -> Rank 7) SEBELUM
    --     memeriksa PENDING_VERIFICATION, menjumlahkan VERIFIED, dan menghitung refund.
    --     Karena bookings (FOR UPDATE) sudah dipegang di Langkah 2 dan urutan
    --     bookings -> payment_schedules -> payment_records identik dengan trg_00
    --     serta TX-02, maka pengajuan pembayaran baru, perubahan status verifikasi,
    --     dan pembatalan Booking ter-serialisasi penuh tanpa potensi deadlock.
    PERFORM 1
    FROM public.payment_schedules AS ps
    WHERE ps.booking_id = v_booking.id
    ORDER BY ps.id
    FOR UPDATE;

    PERFORM 1
    FROM public.payment_records AS pr
    WHERE pr.booking_id = v_booking.id
    ORDER BY pr.id
    FOR UPDATE;

    -- 3. Pastikan tidak ada bukti bayar yang masih menggantung di PENDING_VERIFICATION (Edge Case PD-04)
    SELECT
        count(*) FILTER (WHERE verification_status = 'PENDING_VERIFICATION'),
        COALESCE(SUM(paid_amount) FILTER (WHERE verification_status = 'VERIFIED'), 0)
    INTO v_pending_pay_count, v_total_verified_paid
    FROM public.payment_records
    WHERE booking_id = v_booking.id
      AND verification_status IN ('PENDING_VERIFICATION', 'VERIFIED');

    IF v_pending_pay_count > 0 THEN
        RAISE EXCEPTION 'PENDING_PAYMENT_EXISTS: Terdapat % bukti pembayaran yang masih berstatus PENDING_VERIFICATION. Verifikasi atau tolak terlebih dahulu sebelum membatalkan transaksi.',
            v_pending_pay_count
            USING ERRCODE = '22023';
    END IF;

    -- 4. Validasi Rekonsiliasi Kebijakan Resolusi Dana Pembatalan (PD-04)
    IF v_total_verified_paid = 0 THEN
        IF p_refund_policy_type <> 'NONE' OR COALESCE(p_agreed_refund_amount, 0) <> 0 THEN
            RAISE EXCEPTION 'INVALID_REFUND_POLICY: Belum ada pembayaran terverifikasi (Rp 0); kebijakan refund harus NONE dengan nominal 0.'
                USING ERRCODE = '22023';
        END IF;
        v_forfeited_amount := 0;
    ELSE
        IF p_refund_policy_type = 'NONE' THEN
            RAISE EXCEPTION 'REFUND_POLICY_REQUIRED: Transaksi ini sudah memiliki uang masuk terverifikasi sebesar Rp %. Pilih FORFEITED_FULL, FULL_REFUND, atau PARTIAL_REFUND.',
                v_total_verified_paid
                USING ERRCODE = '22023';
        ELSIF p_refund_policy_type = 'FORFEITED_FULL' THEN
            IF COALESCE(p_agreed_refund_amount, 0) <> 0 THEN
                RAISE EXCEPTION 'INVALID_REFUND_MATH: Untuk kebijakan FORFEITED_FULL (Dana Hangus 100%%), nominal refund harus Rp 0.'
                    USING ERRCODE = '22023';
            END IF;
            v_forfeited_amount := v_total_verified_paid;
        ELSIF p_refund_policy_type = 'FULL_REFUND' THEN
            IF COALESCE(p_agreed_refund_amount, 0) <> v_total_verified_paid THEN
                RAISE EXCEPTION 'INVALID_REFUND_MATH: Untuk FULL_REFUND, nominal refund harus sama persis dengan total uang masuk terverifikasi (Rp %).',
                    v_total_verified_paid
                    USING ERRCODE = '22023';
            END IF;
            v_forfeited_amount := 0;
        ELSIF p_refund_policy_type = 'PARTIAL_REFUND' THEN
            IF p_agreed_refund_amount IS NULL OR p_agreed_refund_amount <= 0 OR p_agreed_refund_amount >= v_total_verified_paid THEN
                RAISE EXCEPTION 'INVALID_REFUND_MATH: Untuk PARTIAL_REFUND, nominal refund harus lebih dari Rp 0 dan lebih kecil dari total uang masuk terverifikasi (Rp %).',
                    v_total_verified_paid
                    USING ERRCODE = '22023';
            END IF;
            v_forfeited_amount := v_total_verified_paid - p_agreed_refund_amount;
        END IF;
    END IF;

    -- 4B. Kunci baris follow_up_tasks secara deterministik sebelum mutasi (Rank 8)
    --     (Seluruh payment_schedules & payment_records terkait sudah terkunci di Langkah 2B)
    PERFORM 1
    FROM public.follow_up_tasks AS fut
    WHERE fut.status IN ('PENDING', 'OVERDUE')
      AND (
          fut.related_schedule_id IN (
              SELECT ps_sub.id
              FROM public.payment_schedules AS ps_sub
              WHERE ps_sub.booking_id = v_booking.id
          )
          OR (v_kpr_id IS NOT NULL AND fut.related_kpr_application_id = v_kpr_id)
      )
    ORDER BY fut.id
    FOR UPDATE;

    -- 5. Perbarui Status Booking
    UPDATE public.bookings
    SET status = 'CANCELLED',
        cancelled_at = v_now,
        cancellation_reason = trim(p_cancellation_reason),
        refund_policy_type = p_refund_policy_type,
        agreed_refund_amount = COALESCE(p_agreed_refund_amount, 0),
        forfeited_retained_amount = v_forfeited_amount,
        notes = COALESCE(p_notes, notes)
    WHERE id = v_booking.id;

    -- 6. Lepaskan Unit Kembali ke AVAILABLE
    UPDATE public.units
    SET status = 'AVAILABLE',
        current_holder_sales_id = NULL,
        current_holder_team_id = NULL,
        status_updated_at = v_now
    WHERE id = v_unit.id;

    -- 6B. Sinkronisasi kpr_applications (File 02 v1.4 Bag. 2.3):
    -- Jika masih IN_PROGRESS atau APPROVED, hentikan menjadi BOOKING_CANCELLED.
    -- Jika sudah REJECTED_BY_BANK atau CANCELLED_BY_CUSTOMER, pertahankan status awalnya.
    IF v_kpr.id IS NOT NULL THEN
        IF v_kpr.application_status IN ('IN_PROGRESS', 'APPROVED') THEN
            v_kpr_new_status := 'BOOKING_CANCELLED';
            UPDATE public.kpr_applications
            SET application_status = 'BOOKING_CANCELLED',
                cancelled_at = v_now,
                cancellation_reason = trim(p_cancellation_reason),
                notes = COALESCE(p_notes, notes)
            WHERE id = v_kpr.id;
        ELSE
            v_kpr_new_status := v_kpr.application_status;
        END IF;
    END IF;

    -- 7. Jika Sudah Memiliki Record Deal, Terminasi Ketiga Dimensi Deal
    IF v_deal.id IS NOT NULL THEN
        UPDATE public.deals
        SET sales_outcome_status = 'CANCELLED_FAILED',
            contract_status = 'CONTRACT_TERMINATED',
            payment_settlement_status = 'TERMINATED',
            cancelled_at = v_now,
            notes = COALESCE(p_notes, notes)
        WHERE id = v_deal.id;

        INSERT INTO public.deal_status_histories (
            deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
        ) VALUES
            (v_deal.id, 'SALES_OUTCOME', v_deal.sales_outcome_status::text, 'CANCELLED_FAILED', trim(p_cancellation_reason), v_actor_id, v_now),
            (v_deal.id, 'CONTRACT_STATUS', v_deal.contract_status::text, 'CONTRACT_TERMINATED', trim(p_cancellation_reason), v_actor_id, v_now),
            (v_deal.id, 'PAYMENT_SETTLEMENT', v_deal.payment_settlement_status::text, 'TERMINATED', trim(p_cancellation_reason), v_actor_id, v_now);
    END IF;

    -- 8. Batalkan Jadwal Tagihan Sisa & Tugas Tindak Lanjut Pembayaran/KPR yang Terkait
    UPDATE public.payment_schedules
    SET status = 'CANCELLED'
    WHERE booking_id = v_booking.id
      AND status <> 'PAID';

    UPDATE public.follow_up_tasks
    SET status = 'CANCELLED'
    WHERE status IN ('PENDING', 'OVERDUE')
      AND (
          related_schedule_id IN (
              SELECT ps.id
              FROM public.payment_schedules AS ps
              WHERE ps.booking_id = v_booking.id
          )
          OR (v_kpr_id IS NOT NULL AND related_kpr_application_id = v_kpr_id)
      );

    -- 9. Jika Ada Dana yang Dikembalikan, Buat Record di refund_transactions (Tanpa Mengubah payment_records!)
    IF COALESCE(p_agreed_refund_amount, 0) > 0 THEN
        v_refund_ref := app_security.next_reference_number('REF', v_now);

        INSERT INTO public.refund_transactions (
            reference_number,
            booking_id,
            refund_amount,
            refund_method,
            status,
            processed_by_admin_id,
            notes
        ) VALUES (
            v_refund_ref,
            v_booking.id,
            p_agreed_refund_amount,
            'BANK_TRANSFER',
            'PENDING_REFUND',
            v_actor_id,
            COALESCE(p_notes, 'Pengembalian dana atas pembatalan Booking ' || v_booking.reference_number)
        )
        RETURNING id INTO v_refund_id;
    END IF;

    -- 10. Kirim Event ke Notification Outbox
    INSERT INTO public.notification_outbox (
        event_type,
        deduplication_key,
        payload
    ) VALUES (
        'BOOKING_CANCELLED',
        'BOOKING_CANCELLED:' || v_booking.id::text,
        jsonb_build_object(
            'booking_id', v_booking.id,
            'booking_reference', v_booking.reference_number,
            'unit_id', v_unit.id,
            'lead_id', v_booking.lead_id,
            'sales_id', v_booking.current_sales_id,
            'team_id', v_booking.team_id,
            'refund_policy_type', p_refund_policy_type,
            'agreed_refund_amount', COALESCE(p_agreed_refund_amount, 0),
            'forfeited_retained_amount', v_forfeited_amount,
            'kpr_application_id', v_kpr_id,
            'kpr_application_status', v_kpr_new_status,
            'cancellation_reason', trim(p_cancellation_reason)
        )
    )
    ON CONFLICT (deduplication_key) DO NOTHING;

    -- 11. Catat ke Audit Log
    INSERT INTO public.audit_logs (
        actor_user_id, actor_role, action_type, entity_table, entity_id,
        old_values, new_values, reason, created_at
    ) VALUES (
        v_actor_id,
        v_actor_role::text,
        'BOOKING_DEAL_CANCELLED',
        'bookings',
        v_booking.id,
        jsonb_build_object(
            'booking_status', v_booking.status,
            'unit_status', v_unit.status,
            'total_verified_paid', v_total_verified_paid,
            'kpr_application_status', CASE WHEN v_kpr.id IS NOT NULL THEN v_kpr.application_status::text ELSE NULL END
        ),
        jsonb_build_object(
            'booking_status', 'CANCELLED',
            'unit_status', 'AVAILABLE',
            'refund_policy_type', p_refund_policy_type,
            'agreed_refund_amount', COALESCE(p_agreed_refund_amount, 0),
            'forfeited_retained_amount', v_forfeited_amount,
            'refund_transaction_id', v_refund_id,
            'refund_reference', v_refund_ref,
            'kpr_application_status', v_kpr_new_status
        ),
        trim(p_cancellation_reason),
        v_now
    );

    RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'booking_status', 'CANCELLED',
        'unit_id', v_unit.id,
        'unit_status', 'AVAILABLE',
        'total_verified_paid', v_total_verified_paid,
        'refund_policy_type', p_refund_policy_type,
        'agreed_refund_amount', COALESCE(p_agreed_refund_amount, 0),
        'forfeited_retained_amount', v_forfeited_amount,
        'refund_transaction_id', v_refund_id,
        'refund_reference', v_refund_ref,
        'kpr_application_id', v_kpr_id,
        'kpr_application_status', v_kpr_new_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_cancel_booking_or_deal(UUID, VARCHAR, public.refund_policy_enum, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_booking_or_deal(UUID, VARCHAR, public.refund_policy_enum, NUMERIC, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 7. TX-07: public.rpc_reassign_lead
-- Tujuan: Memindahkan kepemilikan Lead ke Sales baru (di dalam tim oleh Supervisor/Admin,
--         atau lintas tim oleh Admin) sekaligus mengalihkan tugas aktif dan
--         kepengurusan transaksi berjalan (Booking, Deal, KPR, Pemegang Unit)
--         tanpa menghilangkan histori aktivitas masa lalu (BR-09).
-- Urutan Penguncian Global:
--   leads -> bookings (ORDER BY id) -> units (ORDER BY id)
--   -> kpr_applications (ORDER BY id) -> deals (ORDER BY id)
--   -> follow_up_tasks (ORDER BY id) -> site_visits (ORDER BY id)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_reassign_lead(
    p_lead_id UUID,
    p_target_sales_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id              UUID;
    v_actor_role            public.system_role_enum;
    v_actor_team_id         UUID;
    v_lead                  RECORD;
    v_target_sales          RECORD;
    v_target_team_id        UUID;
    v_now                   TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- 1. Validasi Otorisasi Pemanggil: Hanya ADMIN atau SUPERVISOR
    v_actor_id := auth.uid();
    v_actor_role := app_security.get_current_user_role();
    v_actor_team_id := app_security.get_current_user_active_team_id();

    IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_actor_role NOT IN ('ADMIN', 'SUPERVISOR') THEN
        RAISE EXCEPTION 'FORBIDDEN: Hanya ADMIN atau SUPERVISOR yang berwenang memindahkan penugasan Lead.'
            USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR char_length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'REASON_REQUIRED: Alasan pemindahan Lead wajib diisi minimal 5 karakter.'
            USING ERRCODE = '22023';
    END IF;

    -- 2. Kunci Baris Lead Terlebih Dahulu (Rank 1)
    SELECT l.* INTO v_lead FROM public.leads AS l WHERE l.id = p_lead_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Lead tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    IF v_lead.assigned_sales_id = p_target_sales_id THEN
        RAISE EXCEPTION 'SAME_ASSIGNEE: Lead ini sudah berada di bawah tanggung jawab Sales tersebut.'
            USING ERRCODE = '22023';
    END IF;

    -- 3. Validasi Sales Penerima, Keanggotaan Aktif, & Keaktifan Tim Tujuan
    SELECT p.*
    INTO v_target_sales
    FROM public.profiles AS p
    WHERE p.id = p_target_sales_id
      AND p.is_active = true
      AND p.system_role = 'SALES';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_TARGET_SALES: Pengguna tujuan tidak ditemukan, tidak aktif, atau bukan ber-role SALES.'
            USING ERRCODE = '22023';
    END IF;

    SELECT tm.team_id
    INTO v_target_team_id
    FROM public.team_memberships AS tm
    INNER JOIN public.teams AS t ON t.id = tm.team_id
    WHERE tm.profile_id = p_target_sales_id
      AND tm.is_active = true
      AND tm.membership_role = 'TEAM_SALES'
      AND t.is_active = true
    LIMIT 1;

    IF v_target_team_id IS NULL THEN
        RAISE EXCEPTION 'TARGET_HAS_NO_ACTIVE_TEAM: Sales tujuan belum tergabung dalam tim penjualan aktif mana pun.'
            USING ERRCODE = '22023';
    END IF;

    -- 4. Jika Pemanggil Adalah SUPERVISOR, Batasi Hanya di Dalam Tim Aktifnya Sendiri
    IF v_actor_role = 'SUPERVISOR' THEN
        IF v_actor_team_id IS NULL OR v_lead.team_id <> v_actor_team_id OR v_target_team_id <> v_actor_team_id THEN
            RAISE EXCEPTION 'CROSS_TEAM_TRANSFER_DENIED: Supervisor hanya dapat memindahkan Lead di antara anggota Sales dalam timnya sendiri.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 5. Akuisisi Kunci sesuai Urutan Global Sebelum Mutasi Lintas Tabel:
    --    bookings -> units -> kpr_applications -> deals -> follow_up_tasks -> site_visits
    PERFORM 1
    FROM public.bookings AS b
    WHERE b.lead_id = v_lead.id
      AND b.status IN ('PENDING_FEE', 'ACTIVE')
    ORDER BY b.id
    FOR UPDATE;

    PERFORM 1
    FROM public.units AS u
    WHERE u.id IN (
        SELECT b.unit_id
        FROM public.bookings AS b
        WHERE b.lead_id = v_lead.id
          AND b.status IN ('PENDING_FEE', 'ACTIVE')
    )
    ORDER BY u.id
    FOR UPDATE;

    PERFORM 1
    FROM public.kpr_applications AS k
    WHERE k.booking_id IN (
        SELECT b.id
        FROM public.bookings AS b
        WHERE b.lead_id = v_lead.id
          AND b.status IN ('PENDING_FEE', 'ACTIVE')
    )
    ORDER BY k.id
    FOR UPDATE;

    PERFORM 1
    FROM public.deals AS d
    WHERE d.lead_id = v_lead.id
      AND d.contract_status NOT IN ('CONTRACT_COMPLETED', 'CONTRACT_TERMINATED')
    ORDER BY d.id
    FOR UPDATE;

    PERFORM 1
    FROM public.follow_up_tasks AS fut
    WHERE fut.lead_id = v_lead.id
      AND fut.status IN ('PENDING', 'OVERDUE')
    ORDER BY fut.id
    FOR UPDATE;

    PERFORM 1
    FROM public.site_visits AS sv
    WHERE sv.lead_id = v_lead.id
      AND sv.status = 'SCHEDULED'
    ORDER BY sv.id
    FOR UPDATE;

    -- 6. Perbarui Kepemilikan pada Tabel leads & Catat Histori Penugasan
    UPDATE public.leads
    SET assigned_sales_id = p_target_sales_id,
        team_id = v_target_team_id
    WHERE id = v_lead.id;

    INSERT INTO public.lead_assignment_histories (
        lead_id, from_sales_id, to_sales_id, from_team_id, to_team_id, reason, assigned_by, assigned_at
    ) VALUES (
        v_lead.id,
        v_lead.assigned_sales_id,
        p_target_sales_id,
        v_lead.team_id,
        v_target_team_id,
        trim(p_reason),
        v_actor_id,
        v_now
    );

    -- 7. Alihkan Kepengurusan Aktif pada Booking, Unit Holder, KPR, Deal, Tugas & Survei
    --    (origin_sales_id pada bookings/deals serta lead_activities/tugas COMPLETED tetap utuh — BR-09)
    UPDATE public.bookings
    SET current_sales_id = p_target_sales_id,
        team_id = v_target_team_id
    WHERE lead_id = v_lead.id
      AND status IN ('PENDING_FEE', 'ACTIVE');

    UPDATE public.units AS u
    SET current_holder_sales_id = p_target_sales_id,
        current_holder_team_id = v_target_team_id
    FROM public.bookings AS b
    WHERE b.unit_id = u.id
      AND b.lead_id = v_lead.id
      AND b.status IN ('PENDING_FEE', 'ACTIVE');

    UPDATE public.kpr_applications AS k
    SET current_sales_id = p_target_sales_id,
        team_id = v_target_team_id
    FROM public.bookings AS b
    WHERE k.booking_id = b.id
      AND b.lead_id = v_lead.id
      AND b.status IN ('PENDING_FEE', 'ACTIVE');

    UPDATE public.deals
    SET current_sales_id = p_target_sales_id,
        team_id = v_target_team_id
    WHERE lead_id = v_lead.id
      AND contract_status NOT IN ('CONTRACT_COMPLETED', 'CONTRACT_TERMINATED');

    UPDATE public.follow_up_tasks
    SET assigned_sales_id = p_target_sales_id
    WHERE lead_id = v_lead.id
      AND status IN ('PENDING', 'OVERDUE');

    UPDATE public.site_visits
    SET sales_id = p_target_sales_id
    WHERE lead_id = v_lead.id
      AND status = 'SCHEDULED';

    -- 8. Kirim Notifikasi Penugasan ke Sales Baru melalui Outbox (dedup presisi mikrodetik)
    INSERT INTO public.notification_outbox (
        event_type,
        deduplication_key,
        payload
    ) VALUES (
        'LEAD_ASSIGNED',
        'LEAD_REASSIGNED:' || v_lead.id::text || ':' || to_char(v_now AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'),
        jsonb_build_object(
            'lead_id', v_lead.id,
            'lead_name', v_lead.full_name,
            'from_sales_id', v_lead.assigned_sales_id,
            'to_sales_id', p_target_sales_id,
            'from_team_id', v_lead.team_id,
            'to_team_id', v_target_team_id,
            'assigned_by', v_actor_id,
            'reason', trim(p_reason)
        )
    )
    ON CONFLICT (deduplication_key) DO NOTHING;

    -- 9. Catat ke Audit Log
    INSERT INTO public.audit_logs (
        actor_user_id, actor_role, action_type, entity_table, entity_id,
        old_values, new_values, reason, created_at
    ) VALUES (
        v_actor_id,
        v_actor_role::text,
        'LEAD_REASSIGNED',
        'leads',
        v_lead.id,
        jsonb_build_object('assigned_sales_id', v_lead.assigned_sales_id, 'team_id', v_lead.team_id),
        jsonb_build_object('assigned_sales_id', p_target_sales_id, 'team_id', v_target_team_id),
        trim(p_reason),
        v_now
    );

    RETURN jsonb_build_object(
        'lead_id', v_lead.id,
        'from_sales_id', v_lead.assigned_sales_id,
        'to_sales_id', p_target_sales_id,
        'from_team_id', v_lead.team_id,
        'to_team_id', v_target_team_id,
        'reassigned_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_reassign_lead(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_reassign_lead(UUID, UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 8. TX-08: public.rpc_record_kpr_disbursement
-- Tujuan: Mencatat realisasi pencairan dana KPR dari bank (Pencairan Utama 'PRIMARY'
--         maupun Pencairan Lanjutan 'SUBSEQUENT' pada pencairan bertahap),
--         menghitung ulang sisa plafon belum cair, memperbarui application_status
--         menjadi 'COMPLETED' saat 100% cair (sesuai constraint File 02 v1.4),
--         serta menerapkan kebijakan final TC-01A (Unit menjadi 'SOLD' hanya
--         ketika pencairan mencapai 100% 'FULLY_DISBURSED').
-- Urutan Penguncian Global:
--   leads -> bookings -> units -> kpr_applications -> deals -> follow_up_tasks (ORDER BY id)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_record_kpr_disbursement(
    p_kpr_application_id UUID,
    p_tranche_type public.disbursement_tranche_enum,
    p_disbursement_reference VARCHAR(80),
    p_disbursed_amount NUMERIC(15,2),
    p_disbursement_date DATE,
    p_proof_file_path TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id              UUID;
    v_actor_role            public.system_role_enum;
    v_booking_id            UUID;
    v_lead_id               UUID;
    v_unit_id               UUID;
    v_kpr                   RECORD;
    v_booking               RECORD;
    v_deal                  RECORD;
    v_unit                  RECORD;
    v_lead                  RECORD;
    v_now                   TIMESTAMPTZ := clock_timestamp();
    v_unpaid_dp_count       INTEGER;
    v_next_seq              SMALLINT;
    v_disbursement_id       UUID;
    v_primary_sum           NUMERIC(15,2) := 0;
    v_subsequent_sum        NUMERIC(15,2) := 0;
    v_remaining_amount      NUMERIC(15,2) := 0;
    v_new_disb_status       public.kpr_disbursement_status_enum;
    v_new_app_status        public.kpr_application_status_enum;
    v_policy_mode           VARCHAR(10);
    v_target_unit_status    public.unit_status_enum;
    v_target_booking_stat   public.booking_status_enum;
    v_target_contract_stat  public.deal_contract_status_enum;
    v_target_settle_stat    public.deal_settlement_status_enum;
BEGIN
    -- 1. Validasi Otorisasi: Hanya ADMIN
    v_actor_id := auth.uid();
    v_actor_role := app_security.get_current_user_role();

    IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_actor_role <> 'ADMIN' THEN
        RAISE EXCEPTION 'FORBIDDEN: Hanya ADMIN yang dapat mencatat pencairan dana KPR dari bank.'
            USING ERRCODE = '42501';
    END IF;

    IF p_disbursed_amount IS NULL OR p_disbursed_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT: Nominal pencairan KPR harus lebih besar dari Rp 0.'
            USING ERRCODE = '22023';
    END IF;

    IF p_disbursement_reference IS NULL OR char_length(trim(p_disbursement_reference)) < 3 THEN
        RAISE EXCEPTION 'REFERENCE_REQUIRED: Nomor referensi bukti pencairan bank wajib diisi.'
            USING ERRCODE = '22023';
    END IF;

    IF p_proof_file_path IS NULL OR char_length(trim(p_proof_file_path)) < 5 THEN
        RAISE EXCEPTION 'PROOF_FILE_REQUIRED: Path bukti pencairan di Private Storage wajib disertakan.'
            USING ERRCODE = '22023';
    END IF;

    v_policy_mode := app_security.get_kpr_sold_policy_mode();
    IF v_policy_mode <> 'TC-01A' THEN
        RAISE EXCEPTION 'INVALID_POLICY_CONFIG: Kebijakan final yang diizinkan pada sistem adalah TC-01A (ditemukan: [%]).', v_policy_mode
            USING ERRCODE = '22023';
    END IF;

    SELECT k.booking_id, b.lead_id, b.unit_id
    INTO v_booking_id, v_lead_id, v_unit_id
    FROM public.kpr_applications AS k
    INNER JOIN public.bookings AS b ON b.id = k.booking_id
    WHERE k.id = p_kpr_application_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Aplikasi KPR atau Booking terkait tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    -- 2. Kunci Baris sesuai Urutan Global:
    --    leads -> bookings -> units -> kpr_applications -> deals
    SELECT l.* INTO v_lead FROM public.leads AS l WHERE l.id = v_lead_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Lead terkait transaksi KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT b.* INTO v_booking FROM public.bookings AS b WHERE b.id = v_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Booking terkait transaksi KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT u.* INTO v_unit FROM public.units AS u WHERE u.id = v_unit_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Unit terkait transaksi KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT k.* INTO v_kpr FROM public.kpr_applications AS k WHERE k.id = p_kpr_application_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Aplikasi KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT d.* INTO v_deal FROM public.deals AS d WHERE d.booking_id = v_booking.id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Deal terkait transaksi KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    IF v_booking.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'INVALID_BOOKING_STATUS: Pencairan KPR hanya dapat dicatat pada Booking berstatus ACTIVE (saat ini: [%]).',
            v_booking.status
            USING ERRCODE = '22023';
    END IF;

    IF v_kpr.application_status <> 'APPROVED' THEN
        RAISE EXCEPTION 'INVALID_KPR_STATUS: Pencairan KPR hanya dapat dicatat pada aplikasi KPR berstatus APPROVED (saat ini: [%]).',
            v_kpr.application_status
            USING ERRCODE = '22023';
    END IF;

    -- 3. Validasi Tahap KPR, Referensi Duplikat & Pelunasan Kewajiban Tunai Pembeli (PD-02)
    IF p_tranche_type = 'PRIMARY' AND v_kpr.current_stage <> 'AKAD_COMPLETED' THEN
        RAISE EXCEPTION 'INVALID_KPR_STAGE: Pencairan Utama (PRIMARY) hanya dapat dicatat setelah tahap AKAD_COMPLETED selesai.'
            USING ERRCODE = '22023';
    ELSIF p_tranche_type = 'SUBSEQUENT' AND v_kpr.current_stage <> 'DISBURSEMENT' THEN
        RAISE EXCEPTION 'INVALID_KPR_STAGE: Pencairan Lanjutan (SUBSEQUENT) hanya dapat dicatat setelah Pencairan Utama (tahap DISBURSEMENT).'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.kpr_disbursements AS kd
        WHERE kd.kpr_application_id = v_kpr.id
          AND lower(trim(kd.disbursement_reference)) = lower(trim(p_disbursement_reference))
    ) THEN
        RAISE EXCEPTION 'DUPLICATE_DISBURSEMENT_REF: Nomor referensi pencairan [%] sudah pernah dicatat pada aplikasi KPR ini.',
            trim(p_disbursement_reference)
            USING ERRCODE = '23505';
    END IF;

    SELECT count(*)
    INTO v_unpaid_dp_count
    FROM public.payment_schedules
    WHERE booking_id = v_booking.id
      AND schedule_type IN ('BOOKING_FEE', 'DOWN_PAYMENT', 'KPR_TOPUP_DP')
      AND status <> 'PAID';

    IF v_unpaid_dp_count > 0 THEN
        RAISE EXCEPTION 'DP_NOT_SETTLED: Seluruh kewajiban DP pembeli wajib PAID sebelum pencairan KPR dicatat.'
            USING ERRCODE = '22023';
    END IF;

    IF v_kpr.approved_loan_amount IS NULL
       OR (v_kpr.primary_disbursed_amount + v_kpr.subsequent_disbursed_amount + p_disbursed_amount > v_kpr.approved_loan_amount) THEN
        RAISE EXCEPTION 'DISBURSEMENT_EXCEEDS_LOAN: Nominal pencairan (Rp %) melebihi sisa plafon KPR yang belum cair (Rp %).',
            p_disbursed_amount, v_kpr.remaining_undisbursed_amount
            USING ERRCODE = '22023';
    END IF;

    -- 4. Hitung sequence_number berikutnya & Sisipkan ke kpr_disbursements
    SELECT COALESCE(MAX(sequence_number), 0) + 1
    INTO v_next_seq
    FROM public.kpr_disbursements
    WHERE kpr_application_id = v_kpr.id;

    INSERT INTO public.kpr_disbursements (
        kpr_application_id,
        tranche_type,
        sequence_number,
        disbursement_reference,
        disbursed_amount,
        disbursement_date,
        proof_file_path,
        recorded_by_admin_id,
        notes
    ) VALUES (
        v_kpr.id,
        p_tranche_type,
        v_next_seq,
        trim(p_disbursement_reference),
        p_disbursed_amount,
        p_disbursement_date,
        p_proof_file_path,
        v_actor_id,
        p_notes
    )
    RETURNING id INTO v_disbursement_id;

    -- 5. Rekonsiliasi Ulang Agregat Pencairan Langsung dari kpr_disbursements (Validasi File 02 v1.4)
    SELECT
        COALESCE(SUM(disbursed_amount) FILTER (WHERE tranche_type = 'PRIMARY'), 0),
        COALESCE(SUM(disbursed_amount) FILTER (WHERE tranche_type = 'SUBSEQUENT'), 0)
    INTO v_primary_sum, v_subsequent_sum
    FROM public.kpr_disbursements
    WHERE kpr_application_id = v_kpr.id;

    v_remaining_amount := v_kpr.approved_loan_amount - (v_primary_sum + v_subsequent_sum);

    IF v_remaining_amount = 0 THEN
        v_new_disb_status := 'FULLY_DISBURSED';
        v_new_app_status := 'COMPLETED';
    ELSE
        v_new_disb_status := 'PARTIALLY_DISBURSED';
        v_new_app_status := 'APPROVED';
    END IF;

    -- 6. Evaluasi Target Status Deal, Booking, & Unit Sesuai Kebijakan Final TC-01A
    IF v_new_disb_status = 'FULLY_DISBURSED' THEN
        v_target_unit_status := 'SOLD';
        v_target_booking_stat := 'COMPLETED';
        v_target_contract_stat := 'CONTRACT_COMPLETED';
        v_target_settle_stat := 'FULLY_SETTLED';

        PERFORM 1
        FROM public.follow_up_tasks AS fut
        WHERE fut.related_kpr_application_id = v_kpr.id
          AND fut.status IN ('PENDING', 'OVERDUE')
        ORDER BY fut.id
        FOR UPDATE;
    ELSE
        -- TC-01A Final: Saat PARTIALLY_DISBURSED (masih ada sisa retensi), Unit TETAP BOOKED & Booking TETAP ACTIVE
        v_target_unit_status := 'BOOKED';
        v_target_booking_stat := 'ACTIVE';
        v_target_contract_stat := 'UNDER_CONTRACT';
        v_target_settle_stat := 'DISBURSED_RETENTION_PENDING';
    END IF;

    -- 7. Terapkan Mutasi sesuai Urutan Global (leads -> bookings -> units -> kpr_applications -> deals -> follow_up_tasks)
    IF v_lead.pipeline_stage <> 'CLOSED_WON' THEN
        UPDATE public.leads SET pipeline_stage = 'CLOSED_WON' WHERE id = v_lead.id;
        INSERT INTO public.lead_pipeline_histories (
            lead_id, from_stage, to_stage, notes, changed_by, changed_at
        ) VALUES (
            v_lead.id, v_lead.pipeline_stage, 'CLOSED_WON',
            'Transaksi KPR mencapai tahap pencairan dana bank (Disbursement).', v_actor_id, v_now
        );
    END IF;

    IF v_new_disb_status = 'FULLY_DISBURSED' THEN
        UPDATE public.bookings SET status = 'COMPLETED' WHERE id = v_booking.id;
    END IF;

    IF v_unit.status <> v_target_unit_status THEN
        UPDATE public.units
        SET status = v_target_unit_status,
            status_updated_at = v_now
        WHERE id = v_unit.id;
    END IF;

    UPDATE public.kpr_applications
    SET current_stage = 'DISBURSEMENT',
        application_status = v_new_app_status,
        disbursement_status = v_new_disb_status,
        primary_disbursed_amount = v_primary_sum,
        subsequent_disbursed_amount = v_subsequent_sum,
        remaining_undisbursed_amount = v_remaining_amount,
        first_disbursed_at = COALESCE(first_disbursed_at, v_now),
        fully_disbursed_at = CASE WHEN v_remaining_amount = 0 THEN v_now ELSE fully_disbursed_at END
    WHERE id = v_kpr.id;

    IF v_kpr.current_stage <> 'DISBURSEMENT' THEN
        INSERT INTO public.kpr_stage_histories (
            kpr_application_id, from_stage, to_stage, notes, changed_by, changed_at
        ) VALUES (
            v_kpr.id, v_kpr.current_stage, 'DISBURSEMENT',
            'Pencairan Utama KPR diterima (' || trim(p_disbursement_reference) || '). Status: ' || v_new_disb_status::text,
            v_actor_id, v_now
        );
    END IF;

    -- Sales Outcome pada KPR menjadi CLOSED_WON begitu DP lunas & masuk tahap DISBURSEMENT (PD-02)
    UPDATE public.deals
    SET sales_outcome_status = 'CLOSED_WON',
        contract_status = v_target_contract_stat,
        payment_settlement_status = v_target_settle_stat,
        sales_closed_won_at = COALESCE(sales_closed_won_at, v_now),
        fully_settled_at = CASE WHEN v_new_disb_status = 'FULLY_DISBURSED' THEN v_now ELSE fully_settled_at END
    WHERE id = v_deal.id;

    IF v_deal.sales_outcome_status <> 'CLOSED_WON' THEN
        INSERT INTO public.deal_status_histories (
            deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
        ) VALUES (
            v_deal.id, 'SALES_OUTCOME', v_deal.sales_outcome_status::text, 'CLOSED_WON',
            'KPR mencapai tahap Disbursement dan seluruh DP pembeli lunas (PD-02).', v_actor_id, v_now
        );
    END IF;

    IF v_deal.contract_status IS DISTINCT FROM v_target_contract_stat THEN
        INSERT INTO public.deal_status_histories (
            deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
        ) VALUES (
            v_deal.id, 'CONTRACT_STATUS', v_deal.contract_status::text, v_target_contract_stat::text,
            'Pembaruan status kontrak pada pencairan KPR ' || v_new_disb_status::text, v_actor_id, v_now
        );
    END IF;

    INSERT INTO public.deal_status_histories (
        deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at
    ) VALUES (
        v_deal.id, 'PAYMENT_SETTLEMENT', v_deal.payment_settlement_status::text, v_target_settle_stat::text,
        'Pencairan KPR ' || p_tranche_type::text || ' sebesar Rp ' || p_disbursed_amount::text, v_actor_id, v_now
    );

    IF v_new_disb_status = 'FULLY_DISBURSED' THEN
        UPDATE public.follow_up_tasks
        SET status = 'COMPLETED',
            completion_notes = 'Otomatis selesai: Pencairan KPR telah mencapai 100% (FULLY_DISBURSED).',
            completed_at = v_now
        WHERE related_kpr_application_id = v_kpr.id
          AND status IN ('PENDING', 'OVERDUE');
    END IF;

    -- 8. Kirim Event ke Notification Outbox
    INSERT INTO public.notification_outbox (
        event_type,
        deduplication_key,
        payload
    ) VALUES (
        'KPR_DOCUMENT_UPDATE',
        'KPR_DISBURSEMENT:' || v_disbursement_id::text,
        jsonb_build_object(
            'disbursement_id', v_disbursement_id,
            'kpr_application_id', v_kpr.id,
            'kpr_reference', v_kpr.reference_number,
            'booking_id', v_booking.id,
            'tranche_type', p_tranche_type,
            'disbursed_amount', p_disbursed_amount,
            'disbursement_status', v_new_disb_status,
            'application_status', v_new_app_status,
            'unit_status', v_target_unit_status,
            'sales_id', v_kpr.current_sales_id,
            'team_id', v_kpr.team_id
        )
    )
    ON CONFLICT (deduplication_key) DO NOTHING;

    -- 9. Catat ke Audit Log
    INSERT INTO public.audit_logs (
        actor_user_id, actor_role, action_type, entity_table, entity_id,
        old_values, new_values, reason, created_at
    ) VALUES (
        v_actor_id,
        v_actor_role::text,
        'KPR_DISBURSEMENT_' || p_tranche_type::text,
        'kpr_disbursements',
        v_disbursement_id,
        jsonb_build_object(
            'application_status', v_kpr.application_status,
            'disbursement_status', v_kpr.disbursement_status,
            'primary_disbursed_amount', v_kpr.primary_disbursed_amount,
            'subsequent_disbursed_amount', v_kpr.subsequent_disbursed_amount,
            'remaining_undisbursed_amount', v_kpr.remaining_undisbursed_amount,
            'unit_status', v_unit.status,
            'booking_status', v_booking.status
        ),
        jsonb_build_object(
            'tranche_type', p_tranche_type,
            'disbursed_amount', p_disbursed_amount,
            'application_status', v_new_app_status,
            'disbursement_status', v_new_disb_status,
            'primary_disbursed_amount', v_primary_sum,
            'subsequent_disbursed_amount', v_subsequent_sum,
            'remaining_undisbursed_amount', v_remaining_amount,
            'unit_status', v_target_unit_status,
            'booking_status', v_target_booking_stat,
            'policy_mode_applied', v_policy_mode
        ),
        COALESCE(p_notes, 'Pencatatan pencairan KPR ' || p_tranche_type::text),
        v_now
    );

    RETURN jsonb_build_object(
        'disbursement_id', v_disbursement_id,
        'kpr_application_id', v_kpr.id,
        'application_status', v_new_app_status,
        'disbursement_status', v_new_disb_status,
        'primary_disbursed_amount', v_primary_sum,
        'subsequent_disbursed_amount', v_subsequent_sum,
        'remaining_undisbursed_amount', v_remaining_amount,
        'deal_sales_outcome', 'CLOSED_WON',
        'deal_settlement_status', v_target_settle_stat,
        'booking_status', v_target_booking_stat,
        'unit_status', v_target_unit_status,
        'policy_mode_applied', v_policy_mode
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_record_kpr_disbursement(UUID, public.disbursement_tranche_enum, VARCHAR, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_record_kpr_disbursement(UUID, public.disbursement_tranche_enum, VARCHAR, NUMERIC, DATE, TEXT, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 9. TX-09: public.rpc_advance_kpr_stage
-- Tujuan: Memajukan tahapan workflow proses pengajuan KPR secara atomik untuk
--         tahap pra-SP3K ('DOCUMENT_COLLECTION' s/d 'ADDITIONAL_REQUIREMENTS')
--         dan penjadwalan Akad ('APPROVED' -> 'AKAD_SCHEDULED') oleh Admin,
--         lengkap dengan validasi kelengkapan dokumen wajib KPR sebelum 'SUBMITTED',
--         histori tahapan, outbox notifikasi, serta audit_logs.
-- Urutan Penguncian Global: bookings -> kpr_applications
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_advance_kpr_stage(
    p_kpr_application_id UUID,
    p_target_stage public.kpr_stage_enum,
    p_akad_scheduled_at TIMESTAMPTZ DEFAULT NULL,
    p_akad_location VARCHAR(200) DEFAULT NULL,
    p_notary_name VARCHAR(120) DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id              UUID;
    v_actor_role            public.system_role_enum;
    v_booking_id            UUID;
    v_booking               RECORD;
    v_kpr                   RECORD;
    v_now                   TIMESTAMPTZ := clock_timestamp();
    v_unverified_docs       INTEGER := 0;
    v_is_valid_transition   BOOLEAN := false;
    v_outbox_event_type     VARCHAR(60);
BEGIN
    -- 1. Validasi Otorisasi: Hanya ADMIN
    v_actor_id := auth.uid();
    v_actor_role := app_security.get_current_user_role();

    IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_actor_role <> 'ADMIN' THEN
        RAISE EXCEPTION 'FORBIDDEN: Hanya ADMIN yang berwenang memajukan tahapan workflow KPR.'
            USING ERRCODE = '42501';
    END IF;

    IF p_target_stage IN ('APPROVED', 'AKAD_COMPLETED', 'DISBURSEMENT') THEN
        RAISE EXCEPTION 'INVALID_TARGET_STAGE: Tahap [%] wajib diproses melalui RPC khusus (TX-04, TX-05, atau TX-08).',
            p_target_stage
            USING ERRCODE = '22023';
    END IF;

    SELECT k.booking_id
    INTO v_booking_id
    FROM public.kpr_applications AS k
    WHERE k.id = p_kpr_application_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Aplikasi KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    -- 2. Kunci Baris sesuai Urutan Global: bookings -> kpr_applications
    SELECT b.* INTO v_booking FROM public.bookings AS b WHERE b.id = v_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Booking terkait KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT k.* INTO v_kpr FROM public.kpr_applications AS k WHERE k.id = p_kpr_application_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Aplikasi KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    IF v_booking.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'INVALID_BOOKING_STATUS: Tahapan KPR tidak dapat diproses karena Booking berstatus [%].',
            v_booking.status
            USING ERRCODE = '22023';
    END IF;

    IF v_kpr.current_stage = p_target_stage THEN
        RAISE EXCEPTION 'SAME_STAGE: Aplikasi KPR sudah berada pada tahap [%].', p_target_stage
            USING ERRCODE = '22023';
    END IF;

    -- 3. Validasi Graf State-Machine Tahapan & Konsistensi application_status
    IF p_target_stage = 'AKAD_SCHEDULED' THEN
        IF v_kpr.application_status <> 'APPROVED' OR v_kpr.current_stage <> 'APPROVED' THEN
            RAISE EXCEPTION 'INVALID_KPR_STAGE: Penjadwalan Akad (AKAD_SCHEDULED) hanya dapat dilakukan dari tahap dan status APPROVED.'
                USING ERRCODE = '22023';
        END IF;
        IF p_akad_scheduled_at IS NULL THEN
            RAISE EXCEPTION 'AKAD_DATE_REQUIRED: Jadwal tanggal & waktu Akad KPR wajib diisi.'
                USING ERRCODE = '22023';
        END IF;
        v_is_valid_transition := true;
    ELSE
        IF v_kpr.application_status <> 'IN_PROGRESS' THEN
            RAISE EXCEPTION 'INVALID_KPR_STATUS: Tahapan pra-persetujuan hanya dapat diubah saat application_status berstatus IN_PROGRESS (saat ini: [%]).',
                v_kpr.application_status
                USING ERRCODE = '22023';
        END IF;

        v_is_valid_transition := CASE
            WHEN v_kpr.current_stage = 'DOCUMENT_COLLECTION' AND p_target_stage = 'DOCUMENT_VERIFICATION' THEN true
            WHEN v_kpr.current_stage = 'DOCUMENT_VERIFICATION' AND p_target_stage IN ('DOCUMENT_COLLECTION', 'SUBMITTED') THEN true
            WHEN v_kpr.current_stage = 'SUBMITTED' AND p_target_stage = 'BANK_VERIFICATION' THEN true
            WHEN v_kpr.current_stage = 'BANK_VERIFICATION' AND p_target_stage IN ('APPRAISAL', 'ADDITIONAL_REQUIREMENTS') THEN true
            WHEN v_kpr.current_stage = 'APPRAISAL' AND p_target_stage = 'ADDITIONAL_REQUIREMENTS' THEN true
            WHEN v_kpr.current_stage = 'ADDITIONAL_REQUIREMENTS' AND p_target_stage IN ('BANK_VERIFICATION', 'APPRAISAL') THEN true
            ELSE false
        END;
    END IF;

    IF NOT v_is_valid_transition THEN
        RAISE EXCEPTION 'INVALID_STAGE_TRANSITION: Transisi KPR dari [%] ke [%] tidak diizinkan.',
            v_kpr.current_stage, p_target_stage
            USING ERRCODE = '22023';
    END IF;

    -- Validasi kelengkapan dokumen wajib KPR sebelum diajukan ke bank ('SUBMITTED')
    IF p_target_stage = 'SUBMITTED' THEN
        SELECT count(*)
        INTO v_unverified_docs
        FROM public.kpr_documents AS kd
        WHERE kd.kpr_application_id = v_kpr.id
          AND kd.is_mandatory = true
          AND kd.status <> 'VERIFIED';

        IF v_unverified_docs > 0 THEN
            RAISE EXCEPTION 'MANDATORY_KPR_DOCS_UNVERIFIED: Masih terdapat % dokumen wajib KPR yang belum berstatus VERIFIED sebelum pengajuan dikirim ke bank.',
                v_unverified_docs
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 4. Perbarui kpr_applications & Sisipkan Riwayat Tahap
    UPDATE public.kpr_applications
    SET current_stage = p_target_stage,
        submitted_to_bank_at = CASE
            WHEN p_target_stage = 'SUBMITTED' THEN COALESCE(submitted_to_bank_at, v_now)
            ELSE submitted_to_bank_at
        END,
        requires_additional_docs = CASE
            WHEN p_target_stage = 'ADDITIONAL_REQUIREMENTS' THEN true
            ELSE requires_additional_docs
        END,
        akad_scheduled_at = CASE
            WHEN p_target_stage = 'AKAD_SCHEDULED' THEN p_akad_scheduled_at
            ELSE akad_scheduled_at
        END,
        akad_location = CASE
            WHEN p_target_stage = 'AKAD_SCHEDULED' THEN COALESCE(NULLIF(trim(p_akad_location), ''), akad_location)
            ELSE akad_location
        END,
        notary_name = CASE
            WHEN p_target_stage = 'AKAD_SCHEDULED' THEN COALESCE(NULLIF(trim(p_notary_name), ''), notary_name)
            ELSE notary_name
        END,
        notes = COALESCE(p_notes, notes)
    WHERE id = v_kpr.id;

    INSERT INTO public.kpr_stage_histories (
        kpr_application_id, from_stage, to_stage, notes, changed_by, changed_at
    ) VALUES (
        v_kpr.id,
        v_kpr.current_stage,
        p_target_stage,
        COALESCE(p_notes, 'Perpindahan tahap KPR ke ' || p_target_stage::text),
        v_actor_id,
        v_now
    );

    -- 5. Kirim Event ke Notification Outbox
    v_outbox_event_type := CASE
        WHEN p_target_stage = 'AKAD_SCHEDULED' THEN 'KPR_AKAD_SCHEDULED'
        ELSE 'KPR_DOCUMENT_UPDATE'
    END;

    INSERT INTO public.notification_outbox (
        event_type,
        deduplication_key,
        payload
    ) VALUES (
        v_outbox_event_type,
        'KPR_STAGE:' || v_kpr.id::text || ':' || p_target_stage::text || ':' || to_char(v_now AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'),
        jsonb_build_object(
            'kpr_application_id', v_kpr.id,
            'kpr_reference', v_kpr.reference_number,
            'booking_id', v_booking.id,
            'from_stage', v_kpr.current_stage,
            'to_stage', p_target_stage,
            'akad_scheduled_at', p_akad_scheduled_at,
            'akad_location', p_akad_location,
            'notary_name', p_notary_name,
            'sales_id', v_kpr.current_sales_id,
            'team_id', v_kpr.team_id
        )
    )
    ON CONFLICT (deduplication_key) DO NOTHING;

    -- 6. Catat ke Audit Log
    INSERT INTO public.audit_logs (
        actor_user_id, actor_role, action_type, entity_table, entity_id,
        old_values, new_values, reason, created_at
    ) VALUES (
        v_actor_id,
        v_actor_role::text,
        'KPR_STAGE_ADVANCED',
        'kpr_applications',
        v_kpr.id,
        jsonb_build_object('current_stage', v_kpr.current_stage, 'application_status', v_kpr.application_status),
        jsonb_build_object(
            'current_stage', p_target_stage,
            'application_status', v_kpr.application_status,
            'akad_scheduled_at', p_akad_scheduled_at,
            'akad_location', p_akad_location
        ),
        COALESCE(p_notes, 'Pembaruan tahapan proses KPR menjadi ' || p_target_stage::text),
        v_now
    );

    RETURN jsonb_build_object(
        'kpr_application_id', v_kpr.id,
        'from_stage', v_kpr.current_stage,
        'current_stage', p_target_stage,
        'application_status', v_kpr.application_status,
        'updated_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_advance_kpr_stage(UUID, public.kpr_stage_enum, TIMESTAMPTZ, VARCHAR, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_advance_kpr_stage(UUID, public.kpr_stage_enum, TIMESTAMPTZ, VARCHAR, VARCHAR, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 10. TX-10: public.rpc_cancel_kpr_by_customer
-- Tujuan: Mencatat pembatalan pengajuan KPR atas inisiatif konsumen
--         ('CANCELLED_BY_CUSTOMER') dengan tetap mempertahankan posisi tahap
--         terakhir (current_stage), membatalkan tugas tindak lanjut KPR aktif,
--         dan membiarkan status Booking/Unit/Deal tetap aktif hingga Admin
--         menindaklanjuti pembatalan transaksi melalui TX-06 (File 02 v1.4 Bag. 2.3).
-- Urutan Penguncian Global:
--   bookings -> kpr_applications -> follow_up_tasks (ORDER BY id)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_cancel_kpr_by_customer(
    p_kpr_application_id UUID,
    p_cancellation_reason TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id      UUID;
    v_actor_role    public.system_role_enum;
    v_booking_id    UUID;
    v_booking       RECORD;
    v_kpr           RECORD;
    v_now           TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- 1. Validasi Otorisasi: Hanya ADMIN
    v_actor_id := auth.uid();
    v_actor_role := app_security.get_current_user_role();

    IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_actor_role <> 'ADMIN' THEN
        RAISE EXCEPTION 'FORBIDDEN: Hanya ADMIN yang berwenang mencatat pembatalan pengajuan KPR oleh konsumen.'
            USING ERRCODE = '42501';
    END IF;

    IF p_cancellation_reason IS NULL OR char_length(trim(p_cancellation_reason)) < 5 THEN
        RAISE EXCEPTION 'REASON_REQUIRED: Alasan pembatalan KPR wajib diisi minimal 5 karakter.'
            USING ERRCODE = '22023';
    END IF;

    SELECT k.booking_id
    INTO v_booking_id
    FROM public.kpr_applications AS k
    WHERE k.id = p_kpr_application_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Aplikasi KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    -- 2. Kunci Baris sesuai Urutan Global: bookings -> kpr_applications
    SELECT b.* INTO v_booking FROM public.bookings AS b WHERE b.id = v_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Data Booking terkait KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    SELECT k.* INTO v_kpr FROM public.kpr_applications AS k WHERE k.id = p_kpr_application_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Aplikasi KPR tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;

    IF v_booking.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'INVALID_BOOKING_STATUS: Pembatalan KPR oleh konsumen hanya berlaku untuk Booking berstatus ACTIVE (saat ini: [%]).',
            v_booking.status
            USING ERRCODE = '22023';
    END IF;

    IF v_kpr.application_status NOT IN ('IN_PROGRESS', 'APPROVED') THEN
        RAISE EXCEPTION 'INVALID_KPR_STATUS: Pengajuan KPR sudah berstatus [%] dan tidak dapat dibatalkan lagi.',
            v_kpr.application_status
            USING ERRCODE = '22023';
    END IF;

    IF v_kpr.disbursement_status <> 'NOT_DISBURSED' THEN
        RAISE EXCEPTION 'KPR_ALREADY_DISBURSED: Pengajuan KPR tidak dapat dibatalkan oleh konsumen karena dana bank sudah mulai dicairkan.'
            USING ERRCODE = '22023';
    END IF;

    IF v_kpr.current_stage IN ('AKAD_COMPLETED', 'DISBURSEMENT') THEN
        RAISE EXCEPTION 'INVALID_KPR_STAGE: Pengajuan KPR pada tahap [%] tidak dapat dibatalkan lewat pembatalan KPR konsumen; proses pembatalan transaksi resmi via TX-06.',
            v_kpr.current_stage
            USING ERRCODE = '22023';
    END IF;

    -- 3. Kunci deterministik lalu batalkan tugas tindak lanjut KPR yang masih terbuka
    PERFORM 1
    FROM public.follow_up_tasks AS fut
    WHERE fut.related_kpr_application_id = v_kpr.id
      AND fut.status IN ('PENDING', 'OVERDUE')
    ORDER BY fut.id
    FOR UPDATE;

    -- 4. Perbarui application_status menjadi CANCELLED_BY_CUSTOMER (current_stage dipertahankan!)
    UPDATE public.kpr_applications
    SET application_status = 'CANCELLED_BY_CUSTOMER',
        cancelled_at = v_now,
        cancellation_reason = trim(p_cancellation_reason),
        notes = COALESCE(p_notes, notes)
    WHERE id = v_kpr.id;

    UPDATE public.follow_up_tasks
    SET status = 'CANCELLED'
    WHERE related_kpr_application_id = v_kpr.id
      AND status IN ('PENDING', 'OVERDUE');

    -- 5. Kirim Event ke Notification Outbox
    INSERT INTO public.notification_outbox (
        event_type,
        deduplication_key,
        payload
    ) VALUES (
        'KPR_DOCUMENT_UPDATE',
        'KPR_CANCELLED_CUSTOMER:' || v_kpr.id::text,
        jsonb_build_object(
            'kpr_application_id', v_kpr.id,
            'kpr_reference', v_kpr.reference_number,
            'booking_id', v_booking.id,
            'application_status', 'CANCELLED_BY_CUSTOMER',
            'current_stage', v_kpr.current_stage,
            'cancellation_reason', trim(p_cancellation_reason),
            'sales_id', v_kpr.current_sales_id,
            'team_id', v_kpr.team_id
        )
    )
    ON CONFLICT (deduplication_key) DO NOTHING;

    -- 6. Catat ke Audit Log
    INSERT INTO public.audit_logs (
        actor_user_id, actor_role, action_type, entity_table, entity_id,
        old_values, new_values, reason, created_at
    ) VALUES (
        v_actor_id,
        v_actor_role::text,
        'KPR_CANCELLED_BY_CUSTOMER',
        'kpr_applications',
        v_kpr.id,
        jsonb_build_object(
            'application_status', v_kpr.application_status,
            'current_stage', v_kpr.current_stage
        ),
        jsonb_build_object(
            'application_status', 'CANCELLED_BY_CUSTOMER',
            'current_stage', v_kpr.current_stage,
            'cancelled_at', v_now
        ),
        trim(p_cancellation_reason),
        v_now
    );

    RETURN jsonb_build_object(
        'kpr_application_id', v_kpr.id,
        'application_status', 'CANCELLED_BY_CUSTOMER',
        'current_stage', v_kpr.current_stage,
        'cancelled_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_cancel_kpr_by_customer(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_kpr_by_customer(UUID, TEXT, TEXT) TO authenticated, service_role;

COMMIT;
