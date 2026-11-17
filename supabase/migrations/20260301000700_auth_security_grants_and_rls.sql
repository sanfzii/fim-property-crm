-- ============================================================================
-- FILE: supabase/migrations/20260301000700_auth_security_grants_and_rls.sql
-- TUJUAN: Implementasi Helper Functions (app_security), Views Perlindungan
--         Kolom Sensitif (security_invoker = true), Trigger Anti-Privilege-Escalation,
--         Grants, dan RLS 32 Tabel (Single-Company CRM)
-- REFERENSI: FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS_v1.1.md
-- DEPENDENCY: Migrasi 1 s/d 6 (File 02 v1.4)
-- ============================================================================

BEGIN;

-- ============================================================================
-- BAGIAN A: HELPER FUNCTIONS UNTUK AUTHORIZATION (SCHEMA PRIVAT app_security)
-- Standar Keamanan Phase 1A Bagian 11.2:
-- 1. Berada di schema privat app_security (tidak terekspos ke PostgREST RPC).
-- 2. Menggunakan SECURITY DEFINER agar tidak memicu infinite recursion RLS.
-- 3. Mengunci SET search_path = '' dan menggunakan schema-qualified names.
-- 4. Memeriksa auth.uid() secara internal & memvalidasi is_active = true.
-- 5. Mencabut hak EXECUTE dari PUBLIC & anon.
-- ============================================================================

GRANT USAGE ON SCHEMA app_security TO authenticated, service_role;

-- [Helper 1] Mengambil system_role pengguna aktif saat ini
CREATE OR REPLACE FUNCTION app_security.get_current_user_role()
RETURNS public.system_role_enum
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.system_role
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND p.is_active = true
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_security.get_current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.get_current_user_role() TO authenticated, service_role;

-- [Helper 2] Mengambil team_id aktif dari pengguna aktif saat ini
-- (Memastikan profil aktif, keanggotaan aktif, dan tim berstatus aktif)
CREATE OR REPLACE FUNCTION app_security.get_current_user_active_team_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT tm.team_id
    FROM public.team_memberships AS tm
    INNER JOIN public.profiles AS p ON p.id = tm.profile_id
    INNER JOIN public.teams AS t ON t.id = tm.team_id
    WHERE tm.profile_id = auth.uid()
      AND tm.is_active = true
      AND p.is_active = true
      AND t.is_active = true
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_security.get_current_user_active_team_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.get_current_user_active_team_id() TO authenticated, service_role;

-- [Helper 3] Memeriksa apakah sebuah profile_id merupakan anggota aktif dari team_id tertentu
-- Digunakan oleh policy RLS & trigger untuk mencegah Supervisor/Admin menugaskan data lintas tim.
CREATE OR REPLACE FUNCTION app_security.is_active_member_of_team(
    p_profile_id UUID,
    p_team_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.team_memberships AS tm
        INNER JOIN public.profiles AS p ON p.id = tm.profile_id
        INNER JOIN public.teams AS t ON t.id = tm.team_id
        WHERE tm.profile_id = p_profile_id
          AND tm.team_id = p_team_id
          AND tm.is_active = true
          AND p.is_active = true
          AND t.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION app_security.is_active_member_of_team(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.is_active_member_of_team(UUID, UUID) TO authenticated, service_role;

-- [Helper 4] Memeriksa apakah pemanggil berhak mengakses suatu Lead
-- Catatan Isolasi Tim: Bagi SALES, selain assigned_sales_id = auth.uid(),
-- team_id juga wajib cocok dengan tim aktifnya saat ini agar perpindahan tim langsung mencabut akses tim lama.
CREATE OR REPLACE FUNCTION app_security.can_access_lead(p_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.leads AS l
        WHERE l.id = p_lead_id
          AND (
              app_security.get_current_user_role() = 'ADMIN'
              OR (
                  app_security.get_current_user_role() = 'SUPERVISOR'
                  AND l.team_id = app_security.get_current_user_active_team_id()
              )
              OR (
                  app_security.get_current_user_role() = 'SALES'
                  AND l.assigned_sales_id = auth.uid()
                  AND l.team_id = app_security.get_current_user_active_team_id()
              )
          )
    );
$$;

REVOKE ALL ON FUNCTION app_security.can_access_lead(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.can_access_lead(UUID) TO authenticated, service_role;

-- [Helper 5] Memeriksa apakah pemanggil berhak mengakses suatu Booking beserta tabel anaknya
CREATE OR REPLACE FUNCTION app_security.can_access_booking(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.bookings AS b
        WHERE b.id = p_booking_id
          AND (
              app_security.get_current_user_role() = 'ADMIN'
              OR (
                  app_security.get_current_user_role() = 'SUPERVISOR'
                  AND b.team_id = app_security.get_current_user_active_team_id()
              )
              OR (
                  app_security.get_current_user_role() = 'SALES'
                  AND b.current_sales_id = auth.uid()
                  AND b.team_id = app_security.get_current_user_active_team_id()
              )
          )
    );
$$;

REVOKE ALL ON FUNCTION app_security.can_access_booking(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.can_access_booking(UUID) TO authenticated, service_role;

-- [Helper 6] Memeriksa apakah pemanggil berhak mengakses suatu Aplikasi KPR beserta dokumennya
CREATE OR REPLACE FUNCTION app_security.can_access_kpr_application(p_kpr_app_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.kpr_applications AS k
        WHERE k.id = p_kpr_app_id
          AND (
              app_security.get_current_user_role() = 'ADMIN'
              OR (
                  app_security.get_current_user_role() = 'SUPERVISOR'
                  AND k.team_id = app_security.get_current_user_active_team_id()
              )
              OR (
                  app_security.get_current_user_role() = 'SALES'
                  AND k.current_sales_id = auth.uid()
                  AND k.team_id = app_security.get_current_user_active_team_id()
              )
          )
    );
$$;

REVOKE ALL ON FUNCTION app_security.can_access_kpr_application(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.can_access_kpr_application(UUID) TO authenticated, service_role;

-- [Helper 7] Validasi silang relasi follow_up_tasks.related_kpr_application_id terhadap lead_id
-- Memastikan bahwa jika related_kpr_application_id diisi:
-- 1) Pemanggil berhak mengakses aplikasi KPR tersebut (can_access_kpr_application), DAN
-- 2) Aplikasi KPR tersebut berasal dari booking milik lead_id yang sama (File 02 v1.4 Bag. 2.3).
CREATE OR REPLACE FUNCTION app_security.is_valid_follow_up_kpr_link(
    p_lead_id UUID,
    p_kpr_app_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN app_security.get_current_user_role() IS NULL THEN false
        WHEN p_kpr_app_id IS NULL THEN true
        ELSE (
            app_security.can_access_kpr_application(p_kpr_app_id)
            AND EXISTS (
                SELECT 1
                FROM public.kpr_applications AS k
                INNER JOIN public.bookings AS b ON b.id = k.booking_id
                WHERE k.id = p_kpr_app_id
                  AND b.lead_id = p_lead_id
            )
        )
    END;
$$;

REVOKE ALL ON FUNCTION app_security.is_valid_follow_up_kpr_link(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.is_valid_follow_up_kpr_link(UUID, UUID) TO authenticated, service_role;

-- [Helper 8] Validasi silang relasi follow_up_tasks.related_schedule_id terhadap lead_id
-- Mencegah tugas pada Lead A ditautkan ke jadwal pembayaran milik Lead/Tim lain.
CREATE OR REPLACE FUNCTION app_security.is_valid_follow_up_schedule_link(
    p_lead_id UUID,
    p_schedule_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN app_security.get_current_user_role() IS NULL THEN false
        WHEN p_schedule_id IS NULL THEN true
        ELSE EXISTS (
            SELECT 1
            FROM public.payment_schedules AS ps
            INNER JOIN public.bookings AS b ON b.id = ps.booking_id
            WHERE ps.id = p_schedule_id
              AND b.lead_id = p_lead_id
              AND app_security.can_access_booking(b.id)
        )
    END;
$$;

REVOKE ALL ON FUNCTION app_security.is_valid_follow_up_schedule_link(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.is_valid_follow_up_schedule_link(UUID, UUID) TO authenticated, service_role;

-- [Helper 9] Validasi relasi payment_records.replaces_payment_id terhadap booking_id
-- Mencegah Sales mereferensikan record pembayaran milik Booking/Tim lain saat mengunggah bukti koreksi.
CREATE OR REPLACE FUNCTION app_security.is_valid_replacement_payment(
    p_booking_id UUID,
    p_replaces_payment_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN app_security.get_current_user_role() IS NULL THEN false
        WHEN p_replaces_payment_id IS NULL THEN true
        ELSE EXISTS (
            SELECT 1
            FROM public.payment_records AS pr
            WHERE pr.id = p_replaces_payment_id
              AND pr.booking_id = p_booking_id
              AND pr.verification_status = 'REJECTED'
        )
    END;
$$;

REVOKE ALL ON FUNCTION app_security.is_valid_replacement_payment(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.is_valid_replacement_payment(UUID, UUID) TO authenticated, service_role;

-- [Helper 10] Memastikan pengajuan KPR masih berstatus terbuka untuk unggah dokumen oleh Sales
-- (Mencegah Sales mengunggah/menyisipkan dokumen ke KPR yang sudah REJECTED_BY_BANK,
--  CANCELLED_BY_CUSTOMER, BOOKING_CANCELLED, atau COMPLETED)
CREATE OR REPLACE FUNCTION app_security.is_kpr_application_open(p_kpr_app_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.kpr_applications AS k
        WHERE k.id = p_kpr_app_id
          AND k.application_status IN ('IN_PROGRESS', 'APPROVED')
    );
$$;

REVOKE ALL ON FUNCTION app_security.is_kpr_application_open(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.is_kpr_application_open(UUID) TO authenticated, service_role;

-- [Helper 11] Kebijakan Final TC-01 (TC-01A: Unit menjadi SOLD saat pencairan KPR 100% FULLY_DISBURSED)
CREATE OR REPLACE FUNCTION app_security.get_kpr_sold_policy_mode()
RETURNS VARCHAR(10)
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT 'TC-01A'::varchar(10);
$$;

REVOKE ALL ON FUNCTION app_security.get_kpr_sold_policy_mode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.get_kpr_sold_policy_mode() TO authenticated, service_role;

-- ============================================================================
-- BAGIAN B: PERLINDUNGAN KOLOM SENSITIF STAF & VIEW KATALOG UNIT (OQ-05)
-- Menyediakan direktori nama & tim staf tanpa mengekspos email & nomor telepon.
-- Kedua view menggunakan WITH (security_invoker = true) (PostgreSQL 15+).
-- ============================================================================

CREATE OR REPLACE FUNCTION app_security.get_staff_directory()
RETURNS TABLE (
    profile_id UUID,
    full_name VARCHAR(120),
    system_role public.system_role_enum,
    is_active BOOLEAN,
    active_team_id UUID,
    active_team_code VARCHAR(20),
    active_team_name VARCHAR(100),
    membership_role public.team_member_role_enum
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        p.id AS profile_id,
        p.full_name,
        p.system_role,
        p.is_active,
        t.id AS active_team_id,
        t.code AS active_team_code,
        t.name AS active_team_name,
        tm.membership_role
    FROM public.profiles AS p
    LEFT JOIN public.team_memberships AS tm
        ON tm.profile_id = p.id AND tm.is_active = true
    LEFT JOIN public.teams AS t
        ON t.id = tm.team_id
    WHERE app_security.get_current_user_role() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION app_security.get_staff_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.get_staff_directory() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_staff_directory
WITH (security_invoker = true) AS
SELECT * FROM app_security.get_staff_directory();

CREATE OR REPLACE VIEW public.v_unit_catalog
WITH (security_invoker = true) AS
SELECT
    u.id,
    u.project_id,
    pp.code AS project_code,
    pp.name AS project_name,
    pp.city AS project_city,
    d.id AS developer_id,
    d.name AS developer_name,
    u.property_type_id,
    pt.code AS property_type_code,
    pt.name AS property_type_name,
    u.unit_code,
    u.block_number,
    u.land_area,
    u.building_area,
    u.catalog_price,
    u.orientation,
    u.is_hook,
    u.status,
    u.current_holder_sales_id,
    sd.full_name AS current_holder_sales_name,
    u.current_holder_team_id,
    t.name AS current_holder_team_name,
    u.status_updated_at
FROM public.units AS u
INNER JOIN public.property_projects AS pp ON pp.id = u.project_id
INNER JOIN public.developers AS d ON d.id = pp.developer_id
INNER JOIN public.property_types AS pt ON pt.id = u.property_type_id
LEFT JOIN public.v_staff_directory AS sd ON sd.profile_id = u.current_holder_sales_id
LEFT JOIN public.teams AS t ON t.id = u.current_holder_team_id
WHERE app_security.get_current_user_role() IS NOT NULL;

-- ============================================================================
-- BAGIAN C: TRIGGER PROTEKSI PRIVILEGE ESCALATION (PENJAGA KOLOM SENSITIF)
-- Mencegah pengguna mengubah role, status aktif, relasi induk, atau ownership
-- secara langsung melalui API Supabase.
-- ============================================================================

-- 1. Cegah Non-Admin mengubah system_role, is_active, atau email pada tabel profiles
CREATE OR REPLACE FUNCTION app_security.trg_guard_profiles_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.system_role_enum;
BEGIN
    -- Jika dijalankan oleh service_role / postgres (auth.uid() IS NULL), izinkan
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    v_role := app_security.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: Akun staf tidak ditemukan atau berstatus nonaktif.';
    END IF;

    IF v_role <> 'ADMIN' THEN
        IF NEW.system_role IS DISTINCT FROM OLD.system_role THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Anda dilarang mengubah system_role sendiri.';
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Anda dilarang mengubah status keaktifan akun sendiri.';
        END IF;
        IF NEW.email IS DISTINCT FROM OLD.email THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Perubahan email kerja hanya dapat dilakukan oleh Admin.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_00_guard_profiles_update
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_guard_profiles_update();

-- 2. Cegah manipulasi ownership (assigned_sales_id, team_id, created_by) pada tabel leads
CREATE OR REPLACE FUNCTION app_security.trg_guard_leads_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.system_role_enum;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    v_role := app_security.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: Akun staf tidak ditemukan atau berstatus nonaktif.';
    END IF;

    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'INTEGRITY_VIOLATION: Kolom created_by bersifat tetap dan tidak boleh diubah.';
    END IF;

    -- Sales dilarang memindahkan Lead atau mengubah team_id secara sepihak (ASM-04 & Modul J)
    IF v_role = 'SALES' THEN
        IF NEW.assigned_sales_id IS DISTINCT FROM OLD.assigned_sales_id
           OR NEW.team_id IS DISTINCT FROM OLD.team_id THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Sales tidak diizinkan mengubah kepemilikan Lead atau Tim.';
        END IF;
    END IF;

    -- Supervisor dilarang memindahkan Lead lintas tim atau menugaskan ke Sales di luar tim aktifnya
    IF v_role = 'SUPERVISOR' THEN
        IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Supervisor tidak diizinkan memindahkan Lead lintas tim.';
        END IF;
        IF NEW.assigned_sales_id IS DISTINCT FROM OLD.assigned_sales_id
           AND NOT app_security.is_active_member_of_team(NEW.assigned_sales_id, NEW.team_id) THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Supervisor hanya dapat menugaskan Lead ke anggota aktif di timnya sendiri.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_00_guard_leads_update
    BEFORE UPDATE ON public.leads
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_guard_leads_update();

-- 3. Cegah manipulasi relasi induk/kepemilikan pada tabel follow_up_tasks
CREATE OR REPLACE FUNCTION app_security.trg_guard_follow_up_tasks_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.system_role_enum;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    v_role := app_security.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: Akun staf tidak ditemukan atau berstatus nonaktif.';
    END IF;

    IF v_role <> 'ADMIN' THEN
        IF NEW.lead_id IS DISTINCT FROM OLD.lead_id
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.source_type IS DISTINCT FROM OLD.source_type
           OR NEW.deduplication_key IS DISTINCT FROM OLD.deduplication_key
           OR NEW.related_schedule_id IS DISTINCT FROM OLD.related_schedule_id
           OR NEW.related_kpr_application_id IS DISTINCT FROM OLD.related_kpr_application_id THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Atribut relasi induk, sumber tugas, dan tautan jadwal/KPR tidak dapat diubah langsung.';
        END IF;

        IF v_role = 'SALES' AND NEW.assigned_sales_id IS DISTINCT FROM OLD.assigned_sales_id THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Sales tidak diizinkan mengalihkan tugas tindak lanjut ke staf lain.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_00_guard_follow_up_tasks_update
    BEFORE UPDATE ON public.follow_up_tasks
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_guard_follow_up_tasks_update();

-- 4. Cegah manipulasi relasi lead_id dan ownership sales_id pada tabel site_visits
CREATE OR REPLACE FUNCTION app_security.trg_guard_site_visits_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.system_role_enum;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    v_role := app_security.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: Akun staf tidak ditemukan atau berstatus nonaktif.';
    END IF;

    IF v_role <> 'ADMIN' THEN
        IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Lead pada jadwal survei lokasi tidak boleh diubah.';
        END IF;

        IF v_role = 'SALES' AND NEW.sales_id IS DISTINCT FROM OLD.sales_id THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Sales tidak diizinkan mengubah penanggung jawab survei lokasi.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_00_guard_site_visits_update
    BEFORE UPDATE ON public.site_visits
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_guard_site_visits_update();

-- 5. Cegah Non-Admin memverifikasi sendiri atau memanipulasi metadata dokumen KPR pada kpr_documents
CREATE OR REPLACE FUNCTION app_security.trg_guard_kpr_documents_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.system_role_enum;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    v_role := app_security.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: Akun staf tidak ditemukan atau berstatus nonaktif.';
    END IF;

    IF v_role <> 'ADMIN' THEN
        IF OLD.status = 'VERIFIED' THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Dokumen KPR yang sudah berstatus VERIFIED tidak dapat diubah oleh non-Admin.';
        END IF;
        IF NEW.status <> 'UPLOADED' THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Sales hanya diizinkan mengunggah dokumen (status UPLOADED). Verifikasi dilakukan oleh Admin.';
        END IF;
        IF NEW.uploaded_by IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Atribut uploaded_by wajib sesuai dengan identitas pengunggah aktif.';
        END IF;
        IF NEW.kpr_application_id IS DISTINCT FROM OLD.kpr_application_id
           OR NEW.bank_requirement_id IS DISTINCT FROM OLD.bank_requirement_id
           OR NEW.document_name IS DISTINCT FROM OLD.document_name
           OR NEW.is_mandatory IS DISTINCT FROM OLD.is_mandatory
           OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
           OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
           OR NEW.verification_notes IS DISTINCT FROM OLD.verification_notes THEN
            RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: Non-Admin dilarang mengubah metadata checklist atau atribut verifikasi dokumen KPR.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_00_guard_kpr_documents_update
    BEFORE UPDATE ON public.kpr_documents
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_guard_kpr_documents_update();

-- 6. Cegah pengguna mengubah isi pesan notifikasi (Hanya boleh mengubah is_read dan read_at)
CREATE OR REPLACE FUNCTION app_security.trg_guard_notifications_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.system_role_enum;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    v_role := app_security.get_current_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: Akun staf tidak ditemukan atau berstatus nonaktif.';
    END IF;

    IF NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
       OR NEW.notification_type IS DISTINCT FROM OLD.notification_type
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.reference_type IS DISTINCT FROM OLD.reference_type
       OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
       OR NEW.deduplication_key IS DISTINCT FROM OLD.deduplication_key THEN
        RAISE EXCEPTION 'INTEGRITY_VIOLATION: Isi notifikasi bersifat tetap; hanya status baca (is_read) yang dapat diperbarui.';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_00_guard_notifications_update
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_guard_notifications_update();

-- ============================================================================
-- BAGIAN D: POSTGRESQL GRANTS & PRIVILEGES (LEAST PRIVILEGE ENFORCEMENT)
-- 1. Mencabut seluruh akses (REVOKE ALL) dari PUBLIC dan anon pada 32 tabel & view.
-- 2. Mencabut izin DELETE & TRUNCATE dari authenticated (BR-08 & BR-10: No Hard Delete).
-- 3. Memberikan GRANT SELECT, INSERT, UPDATE secara spesifik sesuai kebutuhan matriks.
-- ============================================================================

-- Cabut seluruh privilege default dari PUBLIC dan anon untuk semua tabel, view, sequence & fungsi awal di public
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_set_updated_at() FROM PUBLIC, anon;

-- Berikan akses penuh ke service_role untuk keperluan sistem server terisolasi & seeding
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Berikan akses baca pada View Direktori Staf & Katalog Unit (OQ-05) kepada authenticated
GRANT SELECT ON public.v_staff_directory TO authenticated;
GRANT SELECT ON public.v_unit_catalog TO authenticated;

-- [Domain A: Identity & Organization]
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.teams TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.team_memberships TO authenticated;

-- [Domain B: Property Catalog, Pricing & Promotions]
GRANT SELECT, INSERT, UPDATE ON public.developers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_projects TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_types TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.units TO authenticated;
GRANT SELECT, INSERT ON public.unit_price_histories TO authenticated; -- Append-only (Tanpa UPDATE)
GRANT SELECT, INSERT, UPDATE ON public.promotions TO authenticated;

-- [Domain C: CRM & Pre-Sales]
GRANT SELECT, INSERT, UPDATE ON public.leads TO authenticated;
GRANT SELECT, INSERT ON public.lead_score_histories TO authenticated;      -- Append-only
GRANT SELECT, INSERT ON public.lead_pipeline_histories TO authenticated;   -- Append-only
GRANT SELECT, INSERT ON public.lead_assignment_histories TO authenticated; -- Append-only
GRANT SELECT, INSERT ON public.lead_activities TO authenticated;           -- Append-only
GRANT SELECT, INSERT, UPDATE ON public.follow_up_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.site_visits TO authenticated;

-- [Domain D: Transaction, Finance, KPR & Deal]
GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;
GRANT SELECT, INSERT ON public.booking_extensions TO authenticated;        -- Append-only
GRANT SELECT, INSERT, UPDATE ON public.payment_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_records TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.refund_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kpr_bank_requirements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kpr_applications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kpr_documents TO authenticated;
GRANT SELECT, INSERT ON public.kpr_stage_histories TO authenticated;       -- Append-only
GRANT SELECT, INSERT ON public.kpr_disbursements TO authenticated;         -- Append-only
GRANT SELECT, INSERT, UPDATE ON public.deals TO authenticated;
GRANT SELECT, INSERT ON public.deal_status_histories TO authenticated;     -- Append-only

-- [Domain E: Supporting, Outbox, Notifications & Audit]
GRANT SELECT ON public.reference_sequences TO authenticated;               -- Mutasi hanya via RPC
GRANT SELECT ON public.notification_outbox TO authenticated;               -- Mutasi hanya via RPC/Dispatcher
GRANT SELECT, UPDATE (is_read, read_at) ON public.notifications TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;                        -- Read-only khusus Admin

-- ============================================================================
-- BAGIAN E: PENGAKTIFAN RLS & IMPLEMENTASI KEBIJAKAN RLS (SELURUH 32 TABEL)
-- ============================================================================

-- Aktifkan RLS pada seluruh 32 tabel
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_price_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_score_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_pipeline_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_assignment_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpr_bank_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpr_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpr_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpr_stage_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpr_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_status_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- [Tabel 01] Kebijakan RLS untuk public.profiles
-- Perlindungan kolom sensitif (email & phone):
-- - ADMIN: Membaca & mengelola semua profil.
-- - SUPERVISOR: Membaca profil dirinya sendiri dan anggota tim aktifnya.
-- - SALES: Hanya membaca profil dirinya sendiri (nama Sales tim lain dibaca lewat v_staff_directory).
-- - Catatan: id = auth.uid() pada SELECT sengaja tetap diizinkan agar
--   loginWithEmailPasswordAction dapat mendeteksi is_active = false sebelum signOut().
-- ----------------------------------------------------------------------------
CREATE POLICY pol_profiles_select ON public.profiles
    FOR SELECT TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR id = auth.uid()
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND EXISTS (
                SELECT 1
                FROM public.team_memberships AS tm
                WHERE tm.profile_id = public.profiles.id
                  AND tm.team_id = app_security.get_current_user_active_team_id()
                  AND tm.is_active = true
            )
        )
    );

CREATE POLICY pol_profiles_insert_admin ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_profiles_update ON public.profiles
    FOR UPDATE TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (id = auth.uid() AND app_security.get_current_user_role() IS NOT NULL)
    )
    WITH CHECK (
        app_security.get_current_user_role() = 'ADMIN'
        OR (id = auth.uid() AND app_security.get_current_user_role() IS NOT NULL)
    );

-- ----------------------------------------------------------------------------
-- [Tabel 02] Kebijakan RLS untuk public.teams
-- ----------------------------------------------------------------------------
CREATE POLICY pol_teams_select ON public.teams
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() IS NOT NULL);

CREATE POLICY pol_teams_insert_admin ON public.teams
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_teams_update_admin ON public.teams
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- [Tabel 03] Kebijakan RLS untuk public.team_memberships
-- ----------------------------------------------------------------------------
CREATE POLICY pol_team_memberships_select ON public.team_memberships
    FOR SELECT TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            profile_id = auth.uid()
            AND app_security.get_current_user_role() IS NOT NULL
        )
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND team_id = app_security.get_current_user_active_team_id()
        )
    );

CREATE POLICY pol_team_memberships_insert_admin ON public.team_memberships
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_team_memberships_update_admin ON public.team_memberships
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- [Tabel 04 - 09] Kebijakan RLS untuk Domain B (Property Catalog, Price History & Promotions)
-- Semua staf aktif dapat membaca (SELECT) katalog; hanya ADMIN yang dapat INSERT/UPDATE.
-- ----------------------------------------------------------------------------

-- [04] developers
CREATE POLICY pol_developers_select ON public.developers
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() IS NOT NULL);

CREATE POLICY pol_developers_insert_admin ON public.developers
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_developers_update_admin ON public.developers
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [05] property_projects
CREATE POLICY pol_property_projects_select ON public.property_projects
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() IS NOT NULL);

CREATE POLICY pol_property_projects_insert_admin ON public.property_projects
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_property_projects_update_admin ON public.property_projects
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [06] property_types
CREATE POLICY pol_property_types_select ON public.property_types
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() IS NOT NULL);

CREATE POLICY pol_property_types_insert_admin ON public.property_types
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_property_types_update_admin ON public.property_types
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [07] units
CREATE POLICY pol_units_select ON public.units
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() IS NOT NULL);

CREATE POLICY pol_units_insert_admin ON public.units
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_units_update_admin ON public.units
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [08] unit_price_histories (Append-Only)
CREATE POLICY pol_unit_price_histories_select ON public.unit_price_histories
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() IS NOT NULL);

CREATE POLICY pol_unit_price_histories_insert_admin ON public.unit_price_histories
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.get_current_user_role() = 'ADMIN'
        AND changed_by = auth.uid()
    );

-- [09] promotions
CREATE POLICY pol_promotions_select ON public.promotions
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() IS NOT NULL);

CREATE POLICY pol_promotions_insert_admin ON public.promotions
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_promotions_update_admin ON public.promotions
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- [Tabel 10] Kebijakan RLS untuk public.leads (OQ-01 & Isolasi Tim/Sales Ketat)
-- ----------------------------------------------------------------------------
CREATE POLICY pol_leads_select ON public.leads
    FOR SELECT TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND team_id = app_security.get_current_user_active_team_id()
        )
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND assigned_sales_id = auth.uid()
            AND team_id = app_security.get_current_user_active_team_id()
        )
    );

CREATE POLICY pol_leads_insert ON public.leads
    FOR INSERT TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND (
            (
                app_security.get_current_user_role() = 'ADMIN'
                AND app_security.is_active_member_of_team(assigned_sales_id, team_id)
            )
            OR (
                app_security.get_current_user_role() = 'SUPERVISOR'
                AND team_id = app_security.get_current_user_active_team_id()
                AND app_security.is_active_member_of_team(assigned_sales_id, team_id)
            )
            OR (
                -- OQ-01: Lead yang dibuat Sales wajib langsung menjadi tanggung jawab Sales tersebut & tim aktifnya
                app_security.get_current_user_role() = 'SALES'
                AND assigned_sales_id = auth.uid()
                AND team_id = app_security.get_current_user_active_team_id()
            )
        )
    );

CREATE POLICY pol_leads_update ON public.leads
    FOR UPDATE TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND team_id = app_security.get_current_user_active_team_id()
        )
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND assigned_sales_id = auth.uid()
            AND team_id = app_security.get_current_user_active_team_id()
        )
    )
    WITH CHECK (
        (
            app_security.get_current_user_role() = 'ADMIN'
            AND app_security.is_active_member_of_team(assigned_sales_id, team_id)
        )
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND team_id = app_security.get_current_user_active_team_id()
            AND app_security.is_active_member_of_team(assigned_sales_id, team_id)
        )
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND assigned_sales_id = auth.uid()
            AND team_id = app_security.get_current_user_active_team_id()
        )
    );

-- ----------------------------------------------------------------------------
-- [Tabel 11 - 14] Kebijakan RLS untuk Histori & Aktivitas Lead
-- ----------------------------------------------------------------------------

-- [11] lead_score_histories
CREATE POLICY pol_lead_score_histories_select ON public.lead_score_histories
    FOR SELECT TO authenticated
    USING (app_security.can_access_lead(lead_id));

CREATE POLICY pol_lead_score_histories_insert ON public.lead_score_histories
    FOR INSERT TO authenticated
    WITH CHECK (app_security.can_access_lead(lead_id));

-- [12] lead_pipeline_histories
CREATE POLICY pol_lead_pipeline_histories_select ON public.lead_pipeline_histories
    FOR SELECT TO authenticated
    USING (app_security.can_access_lead(lead_id));

CREATE POLICY pol_lead_pipeline_histories_insert ON public.lead_pipeline_histories
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.can_access_lead(lead_id)
        AND changed_by = auth.uid()
    );

-- [13] lead_assignment_histories
CREATE POLICY pol_lead_assignment_histories_select ON public.lead_assignment_histories
    FOR SELECT TO authenticated
    USING (app_security.can_access_lead(lead_id));

CREATE POLICY pol_lead_assignment_histories_insert ON public.lead_assignment_histories
    FOR INSERT TO authenticated
    WITH CHECK (
        assigned_by = auth.uid()
        AND app_security.can_access_lead(lead_id)
        AND (
            (
                app_security.get_current_user_role() = 'ADMIN'
                AND app_security.is_active_member_of_team(to_sales_id, to_team_id)
            )
            OR (
                app_security.get_current_user_role() = 'SUPERVISOR'
                AND to_team_id = app_security.get_current_user_active_team_id()
                AND (from_team_id IS NULL OR from_team_id = app_security.get_current_user_active_team_id())
                AND app_security.is_active_member_of_team(to_sales_id, to_team_id)
            )
            OR (
                -- Hanya untuk pencatatan assignment awal saat Sales membuat Lead sendiri (OQ-01)
                app_security.get_current_user_role() = 'SALES'
                AND from_sales_id IS NULL
                AND from_team_id IS NULL
                AND to_sales_id = auth.uid()
                AND to_team_id = app_security.get_current_user_active_team_id()
            )
        )
    );

-- [14] lead_activities
CREATE POLICY pol_lead_activities_select ON public.lead_activities
    FOR SELECT TO authenticated
    USING (app_security.can_access_lead(lead_id));

CREATE POLICY pol_lead_activities_insert ON public.lead_activities
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.can_access_lead(lead_id)
        AND sales_id = auth.uid()
    );

-- ----------------------------------------------------------------------------
-- [Tabel 15 & 16] Kebijakan RLS untuk follow_up_tasks & site_visits
-- Memastikan isolasi tim, keaktifan user, serta validasi silang
-- related_kpr_application_id & related_schedule_id terhadap lead_id.
-- ----------------------------------------------------------------------------

-- [15] follow_up_tasks
CREATE POLICY pol_follow_up_tasks_select ON public.follow_up_tasks
    FOR SELECT TO authenticated
    USING (app_security.can_access_lead(lead_id));

CREATE POLICY pol_follow_up_tasks_insert ON public.follow_up_tasks
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.can_access_lead(lead_id)
        AND created_by = auth.uid()
        AND app_security.is_valid_follow_up_schedule_link(lead_id, related_schedule_id)
        AND app_security.is_valid_follow_up_kpr_link(lead_id, related_kpr_application_id)
        AND (
            (
                app_security.get_current_user_role() = 'ADMIN'
                AND source_type IN ('MANUAL_SALES', 'SUPERVISOR_INSTRUCTION')
            )
            OR (
                app_security.get_current_user_role() = 'SUPERVISOR'
                AND source_type IN ('MANUAL_SALES', 'SUPERVISOR_INSTRUCTION')
                AND app_security.is_active_member_of_team(
                    assigned_sales_id,
                    app_security.get_current_user_active_team_id()
                )
            )
            OR (
                app_security.get_current_user_role() = 'SALES'
                AND source_type = 'MANUAL_SALES'
                AND assigned_sales_id = auth.uid()
            )
        )
    );

CREATE POLICY pol_follow_up_tasks_update ON public.follow_up_tasks
    FOR UPDATE TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND app_security.can_access_lead(lead_id)
        )
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND app_security.can_access_lead(lead_id)
            AND assigned_sales_id = auth.uid()
        )
    )
    WITH CHECK (
        app_security.can_access_lead(lead_id)
        AND app_security.is_valid_follow_up_schedule_link(lead_id, related_schedule_id)
        AND app_security.is_valid_follow_up_kpr_link(lead_id, related_kpr_application_id)
        AND (
            app_security.get_current_user_role() = 'ADMIN'
            OR (
                app_security.get_current_user_role() = 'SUPERVISOR'
                AND app_security.is_active_member_of_team(
                    assigned_sales_id,
                    app_security.get_current_user_active_team_id()
                )
            )
            OR (
                app_security.get_current_user_role() = 'SALES'
                AND assigned_sales_id = auth.uid()
            )
        )
    );

-- [16] site_visits
CREATE POLICY pol_site_visits_select ON public.site_visits
    FOR SELECT TO authenticated
    USING (app_security.can_access_lead(lead_id));

CREATE POLICY pol_site_visits_insert ON public.site_visits
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.can_access_lead(lead_id)
        AND (
            app_security.get_current_user_role() = 'ADMIN'
            OR (
                app_security.get_current_user_role() = 'SUPERVISOR'
                AND app_security.is_active_member_of_team(
                    sales_id,
                    app_security.get_current_user_active_team_id()
                )
            )
            OR (
                app_security.get_current_user_role() = 'SALES'
                AND sales_id = auth.uid()
            )
        )
    );

CREATE POLICY pol_site_visits_update ON public.site_visits
    FOR UPDATE TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND app_security.can_access_lead(lead_id)
        )
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND app_security.can_access_lead(lead_id)
            AND sales_id = auth.uid()
        )
    )
    WITH CHECK (
        app_security.can_access_lead(lead_id)
        AND (
            app_security.get_current_user_role() = 'ADMIN'
            OR (
                app_security.get_current_user_role() = 'SUPERVISOR'
                AND app_security.is_active_member_of_team(
                    sales_id,
                    app_security.get_current_user_active_team_id()
                )
            )
            OR (
                app_security.get_current_user_role() = 'SALES'
                AND sales_id = auth.uid()
            )
        )
    );

-- ----------------------------------------------------------------------------
-- [Tabel 17 - 21] Kebijakan RLS untuk Bookings, Payment Schedules, Records & Refunds
-- ----------------------------------------------------------------------------

-- [17] bookings
CREATE POLICY pol_bookings_select ON public.bookings
    FOR SELECT TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND team_id = app_security.get_current_user_active_team_id()
        )
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND current_sales_id = auth.uid()
            AND team_id = app_security.get_current_user_active_team_id()
        )
    );

CREATE POLICY pol_bookings_insert_admin ON public.bookings
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_bookings_update_admin ON public.bookings
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [18] booking_extensions
CREATE POLICY pol_booking_extensions_select ON public.booking_extensions
    FOR SELECT TO authenticated
    USING (app_security.can_access_booking(booking_id));

CREATE POLICY pol_booking_extensions_insert_admin ON public.booking_extensions
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.get_current_user_role() = 'ADMIN'
        AND extended_by = auth.uid()
    );

-- [19] payment_schedules
CREATE POLICY pol_payment_schedules_select ON public.payment_schedules
    FOR SELECT TO authenticated
    USING (app_security.can_access_booking(booking_id));

CREATE POLICY pol_payment_schedules_insert_admin ON public.payment_schedules
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_payment_schedules_update_admin ON public.payment_schedules
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [20] payment_records
CREATE POLICY pol_payment_records_select ON public.payment_records
    FOR SELECT TO authenticated
    USING (app_security.can_access_booking(booking_id));

CREATE POLICY pol_payment_records_insert_sales_or_admin ON public.payment_records
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.can_access_booking(booking_id)
        AND submitted_by_sales_id = auth.uid()
        AND verification_status = 'PENDING_VERIFICATION'
        AND verified_by_admin_id IS NULL
        AND verified_at IS NULL
        AND verification_notes IS NULL
        AND app_security.is_valid_replacement_payment(booking_id, replaces_payment_id)
        AND app_security.get_current_user_role() IN ('SALES', 'ADMIN')
    );

CREATE POLICY pol_payment_records_update_admin ON public.payment_records
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [21] refund_transactions
CREATE POLICY pol_refund_transactions_select ON public.refund_transactions
    FOR SELECT TO authenticated
    USING (app_security.can_access_booking(booking_id));

CREATE POLICY pol_refund_transactions_insert_admin ON public.refund_transactions
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.get_current_user_role() = 'ADMIN'
        AND processed_by_admin_id = auth.uid()
    );

CREATE POLICY pol_refund_transactions_update_admin ON public.refund_transactions
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- [Tabel 22 - 26] Kebijakan RLS untuk KPR Management (Pemantauan Pengajuan KPR)
-- ----------------------------------------------------------------------------

-- [22] kpr_bank_requirements
CREATE POLICY pol_kpr_bank_requirements_select ON public.kpr_bank_requirements
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() IS NOT NULL);

CREATE POLICY pol_kpr_bank_requirements_insert_admin ON public.kpr_bank_requirements
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_kpr_bank_requirements_update_admin ON public.kpr_bank_requirements
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [23] kpr_applications
CREATE POLICY pol_kpr_applications_select ON public.kpr_applications
    FOR SELECT TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND team_id = app_security.get_current_user_active_team_id()
        )
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND current_sales_id = auth.uid()
            AND team_id = app_security.get_current_user_active_team_id()
        )
    );

CREATE POLICY pol_kpr_applications_insert_admin ON public.kpr_applications
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_kpr_applications_update_admin ON public.kpr_applications
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [24] kpr_documents
CREATE POLICY pol_kpr_documents_select ON public.kpr_documents
    FOR SELECT TO authenticated
    USING (app_security.can_access_kpr_application(kpr_application_id));

CREATE POLICY pol_kpr_documents_insert ON public.kpr_documents
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND app_security.can_access_kpr_application(kpr_application_id)
            AND app_security.is_kpr_application_open(kpr_application_id)
            AND status IN ('MISSING', 'UPLOADED')
            AND verified_by IS NULL
            AND verified_at IS NULL
            AND verification_notes IS NULL
            AND (
                (status = 'MISSING' AND uploaded_by IS NULL AND uploaded_at IS NULL AND file_path IS NULL)
                OR (status = 'UPLOADED' AND uploaded_by = auth.uid())
            )
        )
    );

CREATE POLICY pol_kpr_documents_update ON public.kpr_documents
    FOR UPDATE TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND app_security.can_access_kpr_application(kpr_application_id)
            AND app_security.is_kpr_application_open(kpr_application_id)
        )
    )
    WITH CHECK (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND app_security.can_access_kpr_application(kpr_application_id)
            AND app_security.is_kpr_application_open(kpr_application_id)
            AND status = 'UPLOADED'
            AND uploaded_by = auth.uid()
        )
    );

-- [25] kpr_stage_histories
CREATE POLICY pol_kpr_stage_histories_select ON public.kpr_stage_histories
    FOR SELECT TO authenticated
    USING (app_security.can_access_kpr_application(kpr_application_id));

CREATE POLICY pol_kpr_stage_histories_insert_admin ON public.kpr_stage_histories
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.get_current_user_role() = 'ADMIN'
        AND changed_by = auth.uid()
    );

-- [26] kpr_disbursements
CREATE POLICY pol_kpr_disbursements_select ON public.kpr_disbursements
    FOR SELECT TO authenticated
    USING (app_security.can_access_kpr_application(kpr_application_id));

CREATE POLICY pol_kpr_disbursements_insert_admin ON public.kpr_disbursements
    FOR INSERT TO authenticated
    WITH CHECK (
        app_security.get_current_user_role() = 'ADMIN'
        AND recorded_by_admin_id = auth.uid()
    );

-- ----------------------------------------------------------------------------
-- [Tabel 27 & 28] Kebijakan RLS untuk Deals & Deal Status Histories
-- ----------------------------------------------------------------------------

-- [27] deals
CREATE POLICY pol_deals_select ON public.deals
    FOR SELECT TO authenticated
    USING (
        app_security.get_current_user_role() = 'ADMIN'
        OR (
            app_security.get_current_user_role() = 'SUPERVISOR'
            AND team_id = app_security.get_current_user_active_team_id()
        )
        OR (
            app_security.get_current_user_role() = 'SALES'
            AND current_sales_id = auth.uid()
            AND team_id = app_security.get_current_user_active_team_id()
        )
    );

CREATE POLICY pol_deals_insert_admin ON public.deals
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

CREATE POLICY pol_deals_update_admin ON public.deals
    FOR UPDATE TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN')
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- [28] deal_status_histories
CREATE POLICY pol_deal_status_histories_select ON public.deal_status_histories
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.deals AS d
            WHERE d.id = public.deal_status_histories.deal_id
              AND (
                  app_security.get_current_user_role() = 'ADMIN'
                  OR (
                      app_security.get_current_user_role() = 'SUPERVISOR'
                      AND d.team_id = app_security.get_current_user_active_team_id()
                  )
                  OR (
                      app_security.get_current_user_role() = 'SALES'
                      AND d.current_sales_id = auth.uid()
                      AND d.team_id = app_security.get_current_user_active_team_id()
                  )
              )
        )
    );

CREATE POLICY pol_deal_status_histories_insert_admin ON public.deal_status_histories
    FOR INSERT TO authenticated
    WITH CHECK (app_security.get_current_user_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- [Tabel 29 - 32] Kebijakan RLS untuk Sequences, Outbox, Notifications & Audit Log
-- ----------------------------------------------------------------------------

-- [29] reference_sequences (Hanya dibaca oleh Admin; dimutasi lewat RPC)
CREATE POLICY pol_reference_sequences_select_admin ON public.reference_sequences
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN');

-- [30] notification_outbox (Hanya dibaca oleh Admin; dimutasi lewat RPC/Dispatcher)
CREATE POLICY pol_notification_outbox_select_admin ON public.notification_outbox
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN');

-- [31] notifications (Setiap pengguna aktif hanya mengakses notifikasi untuk dirinya sendiri)
CREATE POLICY pol_notifications_select_own ON public.notifications
    FOR SELECT TO authenticated
    USING (
        recipient_user_id = auth.uid()
        AND app_security.get_current_user_role() IS NOT NULL
    );

CREATE POLICY pol_notifications_update_own ON public.notifications
    FOR UPDATE TO authenticated
    USING (
        recipient_user_id = auth.uid()
        AND app_security.get_current_user_role() IS NOT NULL
    )
    WITH CHECK (
        recipient_user_id = auth.uid()
        AND app_security.get_current_user_role() IS NOT NULL
    );

-- [32] audit_logs (Hanya Admin yang dapat membaca Audit Log — Modul U)
CREATE POLICY pol_audit_logs_select_admin ON public.audit_logs
    FOR SELECT TO authenticated
    USING (app_security.get_current_user_role() = 'ADMIN');

COMMIT;
