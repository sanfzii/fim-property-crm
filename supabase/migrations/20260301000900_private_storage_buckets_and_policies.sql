-- ============================================================================
-- FILE: supabase/migrations/20260301000900_private_storage_buckets_and_policies.sql
-- TUJUAN: Pembuatan Bucket Privat 'fim-private-documents', Fungsi Validasi
--         Path & Status Transaksi Storage di Schema app_security, serta
--         Kebijakan RLS storage.objects
-- REFERENSI: FIM-PROPERTY_IMPLEMENTATION_05_STORAGE_DOCUMENTS_v1.1.md
-- DEPENDENCY: Migrasi 1 s/d 8 (File 02 v1.4, File 03 v1.1, File 04 v1.3)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PENDAFTARAN BUCKET PRIVAT 'fim-private-documents'
-- ============================================================================

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
) VALUES (
    'fim-private-documents',
    'fim-private-documents',
    false,
    5242880, -- 5 MiB (5 * 1024 * 1024 bytes)
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[];

-- ============================================================================
-- 2. FUNGSI HELPER KEAMANAN STORAGE DI SCHEMA PRIVAT app_security
-- ============================================================================

-- [Helper Storage 1] Konversi string ke UUID secara aman tanpa melempar exception cast
CREATE OR REPLACE FUNCTION app_security.try_parse_uuid(p_input TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_input IS NULL OR p_input !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NULL;
    END IF;
    RETURN p_input::uuid;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_security.try_parse_uuid(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.try_parse_uuid(TEXT) TO authenticated, service_role;

-- [Helper Storage 2] Evaluasi izin BACA / DOWNLOAD / SIGNED URL (SELECT pada storage.objects)
CREATE OR REPLACE FUNCTION app_security.can_read_storage_object(
    p_bucket_id TEXT,
    p_object_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_parts         TEXT[];
    v_booking_id    UUID;
    v_category      TEXT;
    v_sub_id        UUID;
    v_filename      TEXT;
BEGIN
    -- Tolak jika bukan bucket fim-private-documents, kosong, mengandung karakter kontrol,
    -- spasi tepi, path traversal ('..', '//', '\', '%'), atau slash di awal/akhir
    IF p_bucket_id IS DISTINCT FROM 'fim-private-documents'
       OR p_object_name IS NULL
       OR char_length(p_object_name) = 0
       OR btrim(p_object_name) <> p_object_name
       OR p_object_name ~ '[[:cntrl:]]'
       OR position('..' in p_object_name) > 0
       OR position('//' in p_object_name) > 0
       OR position(chr(92) in p_object_name) > 0
       OR position('%' in p_object_name) > 0
       OR left(p_object_name, 1) = '/'
       OR right(p_object_name, 1) = '/' THEN
        RETURN false;
    END IF;

    v_parts := string_to_array(p_object_name, '/');

    IF array_length(v_parts, 1) NOT IN (4, 5) OR v_parts[1] <> 'bookings' THEN
        RETURN false;
    END IF;

    v_booking_id := app_security.try_parse_uuid(v_parts[2]);
    v_category := v_parts[3];

    IF v_booking_id IS NULL THEN
        RETURN false;
    END IF;

    -- Validasi ketepatan jumlah segmen, UUID entitas anak, & ekstensi per kategori
    IF v_category IN ('payments', 'kpr-docs', 'kpr-disbursements') THEN
        IF array_length(v_parts, 1) <> 5 THEN
            RETURN false;
        END IF;
        v_sub_id := app_security.try_parse_uuid(v_parts[4]);
        v_filename := v_parts[5];
        IF v_sub_id IS NULL
           OR v_filename IS NULL
           OR v_filename !~* '^[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$' THEN
            RETURN false;
        END IF;
        IF v_category = 'kpr-disbursements' AND v_filename !~* '^tranche_[0-9]+_' THEN
            RETURN false;
        END IF;

    ELSIF v_category IN ('refunds', 'contracts') THEN
        IF array_length(v_parts, 1) <> 4 THEN
            RETURN false;
        END IF;
        v_filename := v_parts[4];
        IF v_filename IS NULL OR char_length(v_filename) < 42 THEN
            RETURN false;
        END IF;
        v_sub_id := app_security.try_parse_uuid(left(v_filename, 36));
        IF v_sub_id IS NULL OR substr(v_filename, 37, 1) <> '_' THEN
            RETURN false;
        END IF;
        IF v_category = 'contracts' THEN
            IF v_filename !~* '^[a-z0-9._-]+\.pdf$' THEN
                RETURN false;
            END IF;
        ELSE
            IF v_filename !~* '^[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$' THEN
                RETURN false;
            END IF;
        END IF;

    ELSE
        RETURN false;
    END IF;

    -- Evaluasi hak akses terhadap Booking (ADMIN, SUPERVISOR tim aktifnya, atau SALES pemegang aktif)
    RETURN app_security.can_access_booking(v_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION app_security.can_read_storage_object(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.can_read_storage_object(TEXT, TEXT) TO authenticated, service_role;

-- [Helper Storage 3] Evaluasi izin UPLOAD (INSERT pada storage.objects)
CREATE OR REPLACE FUNCTION app_security.can_upload_storage_object(
    p_bucket_id TEXT,
    p_object_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role          public.system_role_enum;
    v_parts         TEXT[];
    v_booking_id    UUID;
    v_category      TEXT;
    v_sub_id        UUID;
    v_filename      TEXT;
BEGIN
    v_role := app_security.get_current_user_role();
    -- Pengguna tidak aktif atau SUPERVISOR (Read-Only pada dokumen transaksi) ditolak upload
    IF v_role IS NULL OR v_role = 'SUPERVISOR' THEN
        RETURN false;
    END IF;

    IF p_bucket_id IS DISTINCT FROM 'fim-private-documents'
       OR p_object_name IS NULL
       OR char_length(p_object_name) = 0
       OR btrim(p_object_name) <> p_object_name
       OR p_object_name ~ '[[:cntrl:]]'
       OR position('..' in p_object_name) > 0
       OR position('//' in p_object_name) > 0
       OR position(chr(92) in p_object_name) > 0
       OR position('%' in p_object_name) > 0
       OR left(p_object_name, 1) = '/'
       OR right(p_object_name, 1) = '/' THEN
        RETURN false;
    END IF;

    v_parts := string_to_array(p_object_name, '/');
    IF array_length(v_parts, 1) NOT IN (4, 5) OR v_parts[1] <> 'bookings' THEN
        RETURN false;
    END IF;

    v_booking_id := app_security.try_parse_uuid(v_parts[2]);
    v_category := v_parts[3];

    IF v_booking_id IS NULL OR NOT app_security.can_access_booking(v_booking_id) THEN
        RETURN false;
    END IF;

    -- Validasi relasi entitas anak terhadap booking_id, ekstensi file, serta status transaksi
    IF v_category = 'payments' THEN
        -- Pola: bookings/{booking_id}/payments/{payment_schedule_id}/{ts}_{uuid}.{ext}
        IF array_length(v_parts, 1) <> 5 THEN
            RETURN false;
        END IF;
        v_sub_id := app_security.try_parse_uuid(v_parts[4]);
        v_filename := v_parts[5];
        IF v_sub_id IS NULL
           OR v_filename IS NULL
           OR v_filename !~* '^[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$' THEN
            RETURN false;
        END IF;
        RETURN EXISTS (
            SELECT 1
            FROM public.payment_schedules AS ps
            INNER JOIN public.bookings AS b ON b.id = ps.booking_id
            WHERE ps.id = v_sub_id
              AND ps.booking_id = v_booking_id
              AND b.status IN ('PENDING_FEE', 'ACTIVE')
              AND ps.status NOT IN ('PAID', 'CANCELLED')
        );

    ELSIF v_category = 'kpr-docs' THEN
        -- Pola: bookings/{booking_id}/kpr-docs/{kpr_application_id}/{code}_{ts}_{uuid}.{ext}
        IF array_length(v_parts, 1) <> 5 THEN
            RETURN false;
        END IF;
        v_sub_id := app_security.try_parse_uuid(v_parts[4]);
        v_filename := v_parts[5];
        IF v_sub_id IS NULL
           OR v_filename IS NULL
           OR v_filename !~* '^[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$' THEN
            RETURN false;
        END IF;
        RETURN EXISTS (
            SELECT 1
            FROM public.kpr_applications AS ka
            INNER JOIN public.bookings AS b ON b.id = ka.booking_id
            WHERE ka.id = v_sub_id
              AND ka.booking_id = v_booking_id
              AND b.status = 'ACTIVE'
              AND ka.application_status IN ('IN_PROGRESS', 'APPROVED')
        );

    ELSIF v_category = 'kpr-disbursements' THEN
        -- Pola: bookings/{booking_id}/kpr-disbursements/{kpr_application_id}/tranche_{seq}_{ts}_{uuid}.{ext} (Khusus ADMIN)
        IF v_role <> 'ADMIN' OR array_length(v_parts, 1) <> 5 THEN
            RETURN false;
        END IF;
        v_sub_id := app_security.try_parse_uuid(v_parts[4]);
        v_filename := v_parts[5];
        IF v_sub_id IS NULL
           OR v_filename IS NULL
           OR v_filename !~* '^tranche_[0-9]+_[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$' THEN
            RETURN false;
        END IF;
        RETURN EXISTS (
            SELECT 1
            FROM public.kpr_applications AS ka
            INNER JOIN public.bookings AS b ON b.id = ka.booking_id
            WHERE ka.id = v_sub_id
              AND ka.booking_id = v_booking_id
              AND b.status = 'ACTIVE'
              AND ka.application_status = 'APPROVED'
              AND ka.current_stage IN ('AKAD_COMPLETED', 'DISBURSEMENT')
        );

    ELSIF v_category = 'refunds' THEN
        -- Pola: bookings/{booking_id}/refunds/{refund_id}_{ts}_{uuid}.{ext} (Khusus ADMIN)
        IF v_role <> 'ADMIN' OR array_length(v_parts, 1) <> 4 THEN
            RETURN false;
        END IF;
        v_filename := v_parts[4];
        IF v_filename IS NULL OR char_length(v_filename) < 42 THEN
            RETURN false;
        END IF;
        v_sub_id := app_security.try_parse_uuid(left(v_filename, 36));
        IF v_sub_id IS NULL
           OR substr(v_filename, 37, 1) <> '_'
           OR v_filename !~* '^[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$' THEN
            RETURN false;
        END IF;
        RETURN EXISTS (
            SELECT 1
            FROM public.refund_transactions AS rt
            INNER JOIN public.bookings AS b ON b.id = rt.booking_id
            WHERE rt.id = v_sub_id
              AND rt.booking_id = v_booking_id
              AND b.status = 'CANCELLED'
              AND rt.status = 'PENDING_REFUND'
        );

    ELSIF v_category = 'contracts' THEN
        -- Pola: bookings/{booking_id}/contracts/{deal_id}_{ts}_{uuid}.pdf (Khusus ADMIN)
        IF v_role <> 'ADMIN' OR array_length(v_parts, 1) <> 4 THEN
            RETURN false;
        END IF;
        v_filename := v_parts[4];
        IF v_filename IS NULL OR char_length(v_filename) < 42 THEN
            RETURN false;
        END IF;
        v_sub_id := app_security.try_parse_uuid(left(v_filename, 36));
        IF v_sub_id IS NULL
           OR substr(v_filename, 37, 1) <> '_'
           OR v_filename !~* '^[a-z0-9._-]+\.pdf$' THEN
            RETURN false;
        END IF;
        RETURN EXISTS (
            SELECT 1
            FROM public.deals AS d
            INNER JOIN public.bookings AS b ON b.id = d.booking_id
            WHERE d.id = v_sub_id
              AND d.booking_id = v_booking_id
              AND b.status = 'ACTIVE'
              AND d.contract_status IN ('PRE_CONTRACT', 'UNDER_CONTRACT')
        );

    ELSE
        RETURN false;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_security.can_upload_storage_object(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_security.can_upload_storage_object(TEXT, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 3. KEBIJAKAN RLS PADA TABEL storage.objects
-- ============================================================================

DROP POLICY IF EXISTS pol_fim_storage_select ON storage.objects;
DROP POLICY IF EXISTS pol_fim_storage_insert ON storage.objects;

CREATE POLICY pol_fim_storage_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'fim-private-documents'
        AND app_security.can_read_storage_object(bucket_id, name)
    );

CREATE POLICY pol_fim_storage_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'fim-private-documents'
        AND owner = auth.uid()
        AND app_security.can_upload_storage_object(bucket_id, name)
    );

COMMIT;
