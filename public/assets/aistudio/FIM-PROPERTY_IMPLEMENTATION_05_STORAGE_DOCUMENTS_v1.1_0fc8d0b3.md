# FIM-Property Supabase Storage & Document Management Implementation

* **Nama File:** `FIM-PROPERTY_IMPLEMENTATION_05_STORAGE_DOCUMENTS_v1.1.md`
* **Versi Dokumen:** `1.1` *(Revisi audit teknis & pengamanan terhadap `v1.0` untuk menyelaraskan Storage RLS dengan `File 02 v1.4`, `File 03 v1.1`, `File 04 v1.3`, dan `File 06 v1.0`; menutup celah unggah pada Booking/Jadwal/KPR tertutup dan spoofing `refund_id`/`deal_id` lintas-Booking; serta memperkuat validasi path, sanitasi header unduhan, dan perlindungan pre-upload di TypeScript)*
* **Tujuan Dokumen:** Menjadi pedoman implementasi teknis lengkap untuk membangun infrastruktur pengelolaan dokumen sensitif **FIM-Property CRM** menggunakan **Supabase Private Storage**, kebijakan **Storage RLS (`storage.objects`)**, validasi biner *Magic Bytes* di sisi server, pembuatan *Signed URL* berbatas waktu (300 detik), serta sinkronisasi metadata dokumen dengan tabel database PostgreSQL.
* **Ruang Lingkup:**
  1. Inventarisasi bucket dan 5 kategori dokumen transaksi sesuai spesifikasi Phase 1B beserta prasyarat status bisnis masing-masing.
  2. Konfigurasi bucket privat `fim-private-documents` (`public = false`, batas `5 MB`, pembatasan MIME type).
  3. Migrasi SQL lengkap (`supabase/migrations/20260301000900_private_storage_buckets_and_policies.sql`) untuk pembuatan bucket, fungsi validasi path & status transaksi di schema `app_security`, dan kebijakan RLS `storage.objects`.
  4. Implementasi TypeScript lengkap di Next.js App Router (validasi ukuran, MIME type, ekstensi, dan *Magic Bytes*, pembangun & validator path deterministik, unggah dokumen beserta validasi pra-unggah dan *compensating cleanup*, serta pratinjau/unduh melalui *Signed URL*).
  5. Penanganan konsistensi non-atomik antara penyimpanan objek (Storage) dan database (PostgreSQL).
  6. Skenario pengujian keamanan dan fungsionalitas Storage (16 skenario uji).
* **Referensi Dokumen:**
  1. `FIM-PROPERTY_MASTER_BUSINESS_DISCOVERY_v1.2_FINAL.md`
  2. `FIM-PROPERTY_PHASE_1A_SYSTEM_ARCHITECTURE_v1.2.md`
  3. `FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0.md` & `v1.1.md`
  4. `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`
  5. `FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`
  6. `FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS_v1.1.md`
  7. `FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC_v1.3.md`
  8. `FIM-PROPERTY_IMPLEMENTATION_06_APPLICATION_BACKEND_v1.0.md` *(referensi keselarasan antarmuka downstream)*
* **Dependency terhadap File Lain:**
  * **Bergantung pada (Upstream):** File 01 `v1.1` (`supabase/config.toml`), File 02 `v1.4` (Tabel `bookings`, `payment_schedules`, `payment_records`, `kpr_applications`, `kpr_documents`, `kpr_disbursements`, `refund_transactions`, `deals`), File 03 `v1.1` (Fungsi `app_security.can_access_booking`, `app_security.is_kpr_application_open`, `trg_00_guard_kpr_documents_update`, `auth.guards.ts`, & RLS), dan File 04 `v1.3` (`TX-02`, `TX-04`, `TX-05`, `TX-06`, `TX-07`, `TX-08`, `TX-10`, dan `trg_00_guard_payment_records_insert`).
  * **Menjadi Prasyarat bagi (Downstream):** File 06 (*Application Backend Layer* — `TransactionsService` & `transactions.actions.ts`) serta komponen UI transaksi dan KPR.
* **Status Eksekusi:** Seluruh kode SQL dan TypeScript dalam dokumen ini telah disusun dan diaudit secara statis agar siap dijalankan, namun **belum dieksekusi pada mesin PostgreSQL/Supabase lokal atau produksi**.

---

## 1. Tujuan dan Ruang Lingkup

Operasional penjualan properti di **PT FIM-Property** (aplikasi CRM internal satu perusahaan, tanpa *multi-tenant*, tanpa *Machine Learning*, dan tanpa pelacakan cicilan KPR bulanan nasabah ke bank) menghasilkan dokumen bernilai hukum dan keuangan yang bersifat rahasia: bukti transfer *Booking Fee*, Uang Muka (DP), dan termin *Cash Bertahap*, berkas persyaratan pengajuan KPR pelanggan (KTP, KK, NPWP, Slip Gaji, Rekening Koran — yang pada lingkungan demonstrasi/pengujian wajib berupa **dokumen fiktif** sesuai keputusan **`OQ-06`**), bukti pencairan dana KPR dari bank, bukti transfer pengembalian dana (*refund*), serta dokumen kontrak PPJB/Akta.

Dokumen ini mengimplementasikan arsitektur penyimpanan dokumen yang menegakkan tiga aturan utama dari **Phase 1B `v1.1` (Bagian 10)**:
1. **Larangan Menyimpan File Biner di Tabel PostgreSQL:** File gambar atau PDF disimpan di **Supabase Private Storage**, sedangkan tabel PostgreSQL hanya menyimpan path objek (`proof_file_path`, `file_path`, `contract_file_path`) dan nama file (`proof_file_name`, `file_name`).
2. **Bucket 100% Privat & *Signed URL* Berbatas Waktu:** Bucket `fim-private-documents` diset `public = false`. Seluruh akses pratinjau (*preview*) dan unduh (*download*) wajib menggunakan **Signed URL** dengan masa berlaku **300 detik (5 menit)** yang hanya diterbitkan setelah otorisasi pengguna terverifikasi melalui RLS.
3. **Pelestarian Histori Audit Dokumen (`BR-08` & `BR-10`):** File bukti bayar yang telah ditolak (`REJECTED`) atau dokumen KPR yang diminta revisi (`REVISION_REQUIRED`) **tidak boleh dihapus atau ditimpa (*no overwrite*)** oleh pengguna agar rekam jejak verifikasi Admin tetap utuh. Dokumen perbaikan selalu diunggah sebagai objek baru dengan *timestamp* dan UUID unik (`upsert: false`), sementara dokumen KPR yang sudah berstatus `'VERIFIED'` dikunci dari penimpaan ulang.

---

## 2. Referensi

Seluruh spesifikasi teknis pada dokumen ini mengacu langsung pada:
* **`FIM-PROPERTY_MASTER_BUSINESS_DISCOVERY_v1.2_FINAL.md`:** Keputusan **`OQ-06`** (Checklist + upload ke Supabase Private Storage dengan dokumen fiktif), **`PD-04`** (Bukti refund pada `refund_transactions`), **`TC-01A`** (Unit `SOLD` saat pencairan KPR mencapai 100% `FULLY_DISBURSED`), dan **`BR-08`/`BR-10`** (Imutabilitas histori pembayaran & dokumen).
* **`FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0.md` & `v1.1.md` (Bagian 3 & Bagian 10):**
  * Nama bucket tunggal: `fim-private-documents` (`public = false`).
  * Batas ukuran file maksimal: **5 MB** (`5242880 bytes`).
  * Daftar MIME type yang diizinkan: `image/jpeg`, `image/png`, `image/webp`, dan `application/pdf`.
  * Masa berlaku Signed URL: **300 detik**.
  * Lima tabel pemilik metadata dokumen: `payment_records`, `kpr_documents`, `kpr_disbursements`, `refund_transactions`, dan `deals`.
* **`FIM-PROPERTY_IMPLEMENTATION_02` (`v1.4`), `03` (`v1.1`), dan `04` (`v1.3`):**
  * Pemisahan kolom `kpr_applications.current_stage` vs `kpr_applications.application_status` (`IN_PROGRESS`, `APPROVED`, `REJECTED_BY_BANK`, `CANCELLED_BY_CUSTOMER`, `BOOKING_CANCELLED`, `COMPLETED`).
  * Perlindungan trigger `trg_00_guard_payment_records_insert` (blokir pembayaran pada Booking selain `PENDING_FEE`/`ACTIVE` dan jadwal `PAID`/`CANCELLED`) serta `trg_00_guard_kpr_documents_update` (blokir manipulasi dokumen `VERIFIED` oleh non-Admin).

---

## 3. Storage Inventory

Berikut adalah inventarisasi lengkap bucket dan 5 kategori dokumen beserta syarat otorisasi dan status bisnisnya:

| Nama Bucket | Sifat Bucket | Kategori Dokumen | Tabel & Kolom Metadata Database | Pola Path Objek (`storage.objects.name`) | Syarat Role & Status Transaksi Upload (`INSERT`) | Role yang Diizinkan Lihat/Unduh (`SELECT`) | Batas Ukuran & MIME Types | Masa Berlaku Signed URL |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| `fim-private-documents` | **PRIVATE** (`public = false`) | **1. Bukti Pembayaran Pelanggan** | `public.payment_records`<br>(`proof_file_path`, `proof_file_name`) | `bookings/{booking_id}/payments/{payment_schedule_id}/{timestamp}_{uuid}.{ext}` | • Role: `ADMIN` atau `SALES` pemegang aktif Booking<br>• Booking berstatus `'PENDING_FEE'` / `'ACTIVE'`<br>• Jadwal `payment_schedule_id` milik `booking_id` dan berstatus bukan `'PAID'` / `'CANCELLED'` | `ADMIN`, `SUPERVISOR` (tim Booking terkait), `SALES` (pemegang aktif Booking) | • Maks: **5 MB** (`5.242.880 B`)<br>• MIME: `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | **300 Detik** (5 Menit) |
| `fim-private-documents` | **PRIVATE** (`public = false`) | **2. Dokumen Persyaratan KPR** *(Wajib Fiktif `OQ-06`)* | `public.kpr_documents`<br>(`file_path`, `file_name`) | `bookings/{booking_id}/kpr-docs/{kpr_application_id}/{document_code}_{timestamp}_{uuid}.{ext}` | • Role: `ADMIN` atau `SALES` pemegang aktif Booking<br>• Booking berstatus `'ACTIVE'`<br>• `kpr_applications.application_status` dalam `'IN_PROGRESS'` / `'APPROVED'` | `ADMIN`, `SUPERVISOR` (tim Booking terkait), `SALES` (pemegang aktif Booking) | • Maks: **5 MB** (`5.242.880 B`)<br>• MIME: `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | **300 Detik** (5 Menit) |
| `fim-private-documents` | **PRIVATE** (`public = false`) | **3. Bukti Pencairan Dana Bank KPR** | `public.kpr_disbursements`<br>(`proof_file_path`) | `bookings/{booking_id}/kpr-disbursements/{kpr_application_id}/tranche_{sequence_number}_{timestamp}_{uuid}.{ext}` | • Khusus **`ADMIN`**<br>• Booking berstatus `'ACTIVE'`<br>• `kpr_applications.application_status = 'APPROVED'` dan `current_stage` dalam `'AKAD_COMPLETED'` / `'DISBURSEMENT'` | `ADMIN`, `SUPERVISOR` (tim Booking terkait), `SALES` (pemegang aktif Booking) | • Maks: **5 MB** (`5.242.880 B`)<br>• MIME: `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | **300 Detik** (5 Menit) |
| `fim-private-documents` | **PRIVATE** (`public = false`) | **4. Bukti Transfer Pengembalian Dana (Refund)** | `public.refund_transactions`<br>(`proof_file_path`) | `bookings/{booking_id}/refunds/{refund_id}_{timestamp}_{uuid}.{ext}` | • Khusus **`ADMIN`**<br>• `refund_id` milik `booking_id` tersebut<br>• `refund_transactions.status = 'PENDING_REFUND'` & Booking berstatus `'CANCELLED'` | `ADMIN`, `SUPERVISOR` (tim Booking terkait), `SALES` (pemegang aktif Booking) | • Maks: **5 MB** (`5.242.880 B`)<br>• MIME: `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | **300 Detik** (5 Menit) |
| `fim-private-documents` | **PRIVATE** (`public = false`) | **5. Dokumen Kontrak Perjanjian (PPJB / Akta)** | `public.deals`<br>(`contract_file_path`) | `bookings/{booking_id}/contracts/{deal_id}_{timestamp}_{uuid}.pdf` | • Khusus **`ADMIN`**<br>• `deal_id` milik `booking_id` tersebut<br>• Booking berstatus `'ACTIVE'` & `deals.contract_status` dalam `'PRE_CONTRACT'` / `'UNDER_CONTRACT'` | `ADMIN`, `SUPERVISOR` (tim Booking terkait), `SALES` (pemegang aktif Booking) | • Maks: **5 MB** (`5.242.880 B`)<br>• MIME: Khusus `application/pdf` | **300 Detik** (5 Menit) |

---

## 4. Arsitektur Penyimpanan Dokumen

Seluruh objek di dalam bucket `fim-private-documents` diorganisasikan di bawah akar path `bookings/{booking_id}/...`. Desain ini memberikan tiga jaminan keamanan dan operasional:
1. **Evaluasi Otorisasi Terpusat melalui `app_security.can_access_booking(booking_id)`:**
   Kebijakan RLS pada tabel `storage.objects` langsung mengekstrak `booking_id` dari segmen ke-2 path objek dan memvalidasi apakah pengguna yang sedang login berstatus aktif (`is_active = true`) serta merupakan `ADMIN`, `SUPERVISOR` dari tim aktif Booking tersebut, atau `SALES` pemegang aktif Booking tersebut di tim aktifnya.
2. **Validasi Ketat Kepemilikan Entitas Anak & Status Transaksi pada Storage RLS:**
   Sebelum file diizinkan masuk ke bucket (`INSERT`), fungsi `app_security.can_upload_storage_object` memeriksa kecocokan UUID entitas anak (`payment_schedule_id`, `kpr_application_id`, `refund_id`, `deal_id`) terhadap `booking_id`, memeriksa jumlah segmen dan ekstensi file yang diizinkan, serta memverifikasi bahwa Booking/Jadwal/KPR/Refund/Deal masih berada pada status yang sah menerima unggahan.
3. **Kontinuitas Akses Saat Terjadi Reassignment Lead/Transaksi (`TX-07`):**
   Ketika sebuah Lead beserta Booking aktifnya dialihkan dari Sales A ke Sales B melalui `rpc_reassign_lead` (`TX-07`), kita tidak perlu mengubah nama atau memindahkan file fisik di Storage. Begitu `bookings.current_sales_id` berubah menjadi Sales B, Sales B otomatis berhak membuka seluruh dokumen transaksi tersebut dan akses Sales A tertutup seketika.

```text
fim-private-documents (Private Bucket)
└── bookings/
    └── {booking_id}/                                                   <-- Segmen [2]: Diverifikasi oleh can_access_booking()
        ├── payments/{payment_schedule_id}/{ts}_{uuid}.{ext}            <-- Segmen [3]: 'payments' (5 segmen; Upload: ADMIN/SALES saat Booking aktif & jadwal belum PAID/CANCELLED)
        ├── kpr-docs/{kpr_application_id}/{code}_{ts}_{uuid}.{ext}      <-- Segmen [3]: 'kpr-docs' (5 segmen; Upload: ADMIN/SALES saat Booking ACTIVE & KPR IN_PROGRESS/APPROVED)
        ├── kpr-disbursements/{kpr_application_id}/tranche_{seq}_{ts}_{uuid}.{ext} <-- Segmen [3]: 'kpr-disbursements' (5 segmen; Upload: ADMIN saat KPR APPROVED & AKAD_COMPLETED/DISBURSEMENT)
        ├── refunds/{refund_id}_{ts}_{uuid}.{ext}                       <-- Segmen [3]: 'refunds' (4 segmen; Upload: ADMIN saat refund PENDING_REFUND & Booking CANCELLED)
        └── contracts/{deal_id}_{ts}_{uuid}.pdf                         <-- Segmen [3]: 'contracts' (4 segmen; Upload: ADMIN saat Booking ACTIVE & Deal PRE_CONTRACT/UNDER_CONTRACT)
```

---

## 5. Konfigurasi Bucket

Konfigurasi bucket ditegakkan pada dua lapisan secara konsisten:
1. **Konfigurasi Global Supabase (`supabase/config.toml` pada File 01 `v1.1`):**
   Menetapkan `file_size_limit = "5MiB"` pada bagian `[storage]`.
2. **Konfigurasi Baris `storage.buckets` di PostgreSQL:**
   Menetapkan `public = false`, `file_size_limit = 5242880`, dan `allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']`. Dengan konfigurasi di level tabel `storage.buckets` ini, mesin Supabase Storage akan langsung menolak file berukuran $> 5\text{ MB}$ atau bertipe MIME di luar keempat tipe tersebut bahkan sebelum menyentuh disk penyimpanan.

---

## 6. SQL Migration (`20260301000900_private_storage_buckets_and_policies.sql`)

Buat file migrasi ke-9 dengan nama **`supabase/migrations/20260301000900_private_storage_buckets_and_policies.sql`** dan salin kode SQL lengkap berikut:

```sql
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
```

---

## 7. Storage RLS Policies

Tabel di bawah ini merangkum alasan keamanan dari kebijakan RLS `storage.objects` yang diimplementasikan pada Bagian 6:

| Nama Policy | Operasi SQL | Role Target | Kondisi & Risiko yang Dicegah |
| :--- | :---: | :---: | :--- |
| **`pol_fim_storage_select`** | `SELECT` *(Download & Signed URL)* | `authenticated` (`ADMIN`, `SUPERVISOR`, `SALES`) | Memanggil `app_security.can_read_storage_object(bucket_id, name)`. Memvalidasi struktur path ketat (4 atau 5 segmen, karakter aman, ekstensi valid) dan kepemilikan Booking. Mencegah Sales Tim Alpha atau pengguna nonaktif membuat *Signed URL* maupun mengunduh bukti bayar / KTP fiktif milik pelanggan Sales lain atau Tim Bravo. |
| **`pol_fim_storage_insert`** | `INSERT` *(Upload)* | `authenticated` (`ADMIN`, `SALES`) | Memanggil `app_security.can_upload_storage_object(bucket_id, name)` dan mewajibkan `owner = auth.uid()`. Memastikan: (1) `SUPERVISOR` dan akun nonaktif ditolak; (2) `SALES` hanya mengunggah ke `payments` / `kpr-docs` milik Booking yang dipegangnya; (3) seluruh UUID anak (`payment_schedule_id`, `kpr_application_id`, `refund_id`, `deal_id`) cocok dengan `booking_id` (mencegah spoofing lintas-Booking); dan (4) unggahan ditolak jika Booking sudah `'EXPIRED'`/`'CANCELLED'`/`'COMPLETED'`, jadwal sudah `'PAID'`/`'CANCELLED'`, KPR bukan `'IN_PROGRESS'`/`'APPROVED'` (atau bukan `'APPROVED'` untuk pencairan), maupun refund sudah `'COMPLETED'`. |
| *(Tidak Ada Policy `UPDATE` / `DELETE`)* | `UPDATE`, `DELETE` | `authenticated` (Ditolak) | Sesuai **Phase 1B Bagian 10.2** serta **`BR-08` & `BR-10`**, pengguna biasa dilarang menimpa (`UPDATE`) atau menghapus (`DELETE`) file bukti bayar dan dokumen KPR yang sudah terunggah agar jejak audit bukti bayar yang pernah ditolak (`REJECTED`) tetap utuh. Penghapusan objek yatim hanya dilakukan di server lewat `service_role` (*compensating cleanup*). |

---

## 8. Implementasi Next.js dan TypeScript

Seluruh kode pengelolaan dokumen di sisi aplikasi ditempatkan di dalam `src/modules/shared/storage/` dan `src/modules/transactions/documents/`.

> **Catatan Integrasi dengan File 06 (`v1.0`):**  
> Modul L0 (`storage.validator.ts`, `storage.paths.ts`, `storage.service.ts`) mempertahankan tanda tangan ekspor dan kontrak parameter/hasil yang digunakan langsung oleh `TransactionsService` & `transactions.actions.ts` pada File 06. Pada File 06, `storage.service.ts` dapat memperluas error standar menjadi `AppError` + `serverLogger` terstruktur tanpa mengubah kontrak method `PrivateStorageService`.

Buat direktori yang diperlukan:
```bash
mkdir -p src/modules/shared/storage src/modules/transactions/documents
```

---

### 8.1 Validator File & Pemeriksa *Magic Bytes* (`src/modules/shared/storage/storage.validator.ts`)
Memeriksa ukuran file ($> 0$ dan $\le 5\text{ MB}$), MIME type, kecocokan ekstensi, sanitasi nama file bebas traversal/header injection, serta **memverifikasi byte header biner (*Magic Bytes*)** agar file berbahaya (`.exe`, `.html`, `.js`) yang diubah namanya menjadi `.pdf` atau `.jpg` langsung ditolak di server.

```typescript
// Lokasi: src/modules/shared/storage/storage.validator.ts
// Level Topologis: L0 (Shared Pure File Validator & Magic Bytes Inspector)

export const STORAGE_BUCKET_NAME = 'fim-private-documents' as const;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB (5.242.880 bytes)
export const SIGNED_URL_EXPIRES_IN_SECONDS = 300; // 300 detik (5 menit)

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const ALLOWED_FILE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];
export type AllowedFileExtension = (typeof ALLOWED_FILE_EXTENSIONS)[number];

const MIME_TO_EXTENSIONS: Record<AllowedMimeType, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

export interface ValidatedFileMetadata {
  originalFileName: string;
  sanitizedFileName: string;
  extension: string;
  mimeType: AllowedMimeType;
  sizeBytes: number;
  buffer: Uint8Array;
}

/**
 * Membersihkan nama file untuk metadata DB & Content-Disposition download
 * tanpa path separator, '..', karakter kontrol (CR/LF), atau titik berulang.
 */
export function sanitizeFileName(rawName: string): string {
  const fileNameOnly = rawName.split(/[\\/]/).pop() ?? '';
  const cleaned = fileNameOnly
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '');
  return cleaned.slice(0, 120) || 'document';
}

export function extractFileExtension(fileName: string): string {
  const cleanName = fileName.trim();
  const parts = cleanName.toLowerCase().split('.');
  if (parts.length < 2) {
    return '';
  }
  return parts[parts.length - 1] ?? '';
}

/**
 * Memeriksa tanda tangan biner (Magic Bytes) dari isi file.
 */
export function verifyFileMagicBytes(
  bytes: Uint8Array,
  expectedMime: AllowedMimeType
): boolean {
  if (bytes.byteLength < 12) {
    return false;
  }

  switch (expectedMime) {
    case 'application/pdf':
      // '%PDF-' -> 0x25 0x50 0x44 0x46 0x2D
      return (
        bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46 &&
        bytes[4] === 0x2d
      );

    case 'image/jpeg':
      // JPEG SOI -> 0xFF 0xD8 0xFF
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

    case 'image/png':
      // PNG 8-byte header -> 89 50 4E 47 0D 0A 1A 0A
      return (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );

    case 'image/webp':
      // 'RIFF' (0..3) & 'WEBP' (8..11)
      return (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );

    default:
      return false;
  }
}

export async function validateUploadedFileServer(
  file: File | null | undefined,
  options?: { pdfOnly?: boolean }
): Promise<ValidatedFileMetadata> {
  if (
    !file ||
    typeof file.arrayBuffer !== 'function' ||
    typeof file.size !== 'number' ||
    typeof file.name !== 'string'
  ) {
    throw new Error('FILE_REQUIRED: File dokumen wajib dipilih untuk diunggah.');
  }

  if (file.size <= 0) {
    throw new Error('EMPTY_FILE: File yang diunggah kosong (0 bytes) atau rusak.');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    throw new Error(
      `FILE_TOO_LARGE: Ukuran file (${sizeMb} MB) melebihi batas maksimal 5 MB.`
    );
  }

  const rawMime = (file.type ?? '').trim().toLowerCase() as AllowedMimeType;
  if (!ALLOWED_MIME_TYPES.includes(rawMime)) {
    throw new Error(
      `INVALID_MIME_TYPE: Tipe file "${file.type || 'unknown'}" tidak diizinkan. Gunakan JPG, PNG, WEBP, atau PDF.`
    );
  }

  if (options?.pdfOnly && rawMime !== 'application/pdf') {
    throw new Error(
      'PDF_REQUIRED: Dokumen kontrak perjanjian (PPJB/Akta) wajib berformat PDF.'
    );
  }

  const extension = extractFileExtension(file.name);
  const allowedExtensions = MIME_TO_EXTENSIONS[rawMime];

  if (!extension || !allowedExtensions.includes(extension)) {
    throw new Error(
      `EXTENSION_MISMATCH: Ekstensi file ".${extension}" tidak sesuai dengan tipe konten "${rawMime}".`
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  if (uint8Array.byteLength === 0 || uint8Array.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      'INVALID_FILE_PAYLOAD: Ukuran biner file tidak valid atau melebihi batas maksimal 5 MB.'
    );
  }

  if (!verifyFileMagicBytes(uint8Array, rawMime)) {
    throw new Error(
      'CORRUPTED_OR_SPOOFED_FILE: Struktur biner file tidak valid atau tidak sesuai dengan format yang diklaim.'
    );
  }

  return {
    originalFileName: file.name,
    sanitizedFileName: sanitizeFileName(file.name),
    extension,
    mimeType: rawMime,
    sizeBytes: uint8Array.byteLength,
    buffer: uint8Array,
  };
}
```

---

### 8.2 Pembangun & Validator Path Objek Deterministik (`src/modules/shared/storage/storage.paths.ts`)
Membangkitkan path objek untuk kelima kategori dokumen sesuai pola **Phase 1B Bagian 10.1**, memvalidasi ekstensi terhadap daftar putih, serta menyediakan validator `isValidStorageObjectPath()` yang sepadan 1:1 dengan fungsi SQL `app_security.can_read_storage_object`.

```typescript
// Lokasi: src/modules/shared/storage/storage.paths.ts
// Level Topologis: L0 (Shared Storage Object Path Builder & Validator)

import { randomUUID } from 'crypto';
import { ALLOWED_FILE_EXTENSIONS } from './storage.validator';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STANDARD_FILENAME_REGEX = /^[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$/i;
const DISBURSEMENT_FILENAME_REGEX =
  /^tranche_[0-9]+_[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$/i;
const CONTRACT_FILENAME_REGEX = /^[a-z0-9._-]+\.pdf$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function assertValidUuid(value: string, label: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new Error(`INVALID_PATH_UUID: Parameter ${label} bukan UUID yang valid.`);
  }
}

function buildUniqueSuffix(extension: string): string {
  const cleanExt = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    !ALLOWED_FILE_EXTENSIONS.includes(
      cleanExt as (typeof ALLOWED_FILE_EXTENSIONS)[number]
    )
  ) {
    throw new Error(
      `INVALID_STORAGE_EXTENSION: Ekstensi ".${cleanExt || 'unknown'}" tidak diizinkan pada Private Storage.`
    );
  }
  const timestamp = Date.now();
  const shortUuid = randomUUID().split('-')[0];
  return `${timestamp}_${shortUuid}.${cleanExt}`;
}

/**
 * Validasi struktur path Storage secara ketat (simetris dengan app_security.can_read_storage_object).
 */
export function isValidStorageObjectPath(filePath: string): boolean {
  if (
    !filePath ||
    typeof filePath !== 'string' ||
    filePath.trim() !== filePath ||
    /[\x00-\x1f\x7f]/.test(filePath) ||
    filePath.includes('..') ||
    filePath.includes('//') ||
    filePath.includes('\\') ||
    filePath.includes('%') ||
    filePath.startsWith('/') ||
    filePath.endsWith('/')
  ) {
    return false;
  }

  const parts = filePath.split('/');
  if (parts[0] !== 'bookings' || !UUID_REGEX.test(parts[1] ?? '')) {
    return false;
  }

  const category = parts[2];

  if (category === 'payments' || category === 'kpr-docs') {
    return (
      parts.length === 5 &&
      UUID_REGEX.test(parts[3] ?? '') &&
      STANDARD_FILENAME_REGEX.test(parts[4] ?? '')
    );
  }

  if (category === 'kpr-disbursements') {
    return (
      parts.length === 5 &&
      UUID_REGEX.test(parts[3] ?? '') &&
      DISBURSEMENT_FILENAME_REGEX.test(parts[4] ?? '')
    );
  }

  if (category === 'refunds' || category === 'contracts') {
    if (parts.length !== 4) {
      return false;
    }
    const fileName = parts[3] ?? '';
    if (
      fileName.length < 42 ||
      !UUID_REGEX.test(fileName.slice(0, 36)) ||
      fileName[36] !== '_'
    ) {
      return false;
    }
    return category === 'contracts'
      ? CONTRACT_FILENAME_REGEX.test(fileName)
      : STANDARD_FILENAME_REGEX.test(fileName);
  }

  return false;
}

export function buildPaymentProofStoragePath(params: {
  bookingId: string;
  paymentScheduleId: string;
  extension: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.paymentScheduleId, 'paymentScheduleId');
  return `bookings/${params.bookingId}/payments/${params.paymentScheduleId}/${buildUniqueSuffix(
    params.extension
  )}`;
}

export function buildKprDocumentStoragePath(params: {
  bookingId: string;
  kprApplicationId: string;
  documentCode: string;
  extension: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.kprApplicationId, 'kprApplicationId');
  const safeCode = params.documentCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

  if (!safeCode) {
    throw new Error('INVALID_DOCUMENT_CODE: Kode dokumen KPR tidak valid.');
  }

  return `bookings/${params.bookingId}/kpr-docs/${params.kprApplicationId}/${safeCode}_${buildUniqueSuffix(
    params.extension
  )}`;
}

export function buildKprDisbursementProofStoragePath(params: {
  bookingId: string;
  kprApplicationId: string;
  sequenceNumber: number;
  extension: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.kprApplicationId, 'kprApplicationId');
  if (!Number.isInteger(params.sequenceNumber) || params.sequenceNumber < 1) {
    throw new Error(
      'INVALID_SEQUENCE_NUMBER: Nomor urut pencairan (sequenceNumber) harus bilangan bulat positif.'
    );
  }
  return `bookings/${params.bookingId}/kpr-disbursements/${params.kprApplicationId}/tranche_${params.sequenceNumber}_${buildUniqueSuffix(
    params.extension
  )}`;
}

export function buildRefundProofStoragePath(params: {
  bookingId: string;
  refundTransactionId: string;
  extension: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.refundTransactionId, 'refundTransactionId');
  return `bookings/${params.bookingId}/refunds/${params.refundTransactionId}_${buildUniqueSuffix(
    params.extension
  )}`;
}

export function buildDealContractStoragePath(params: {
  bookingId: string;
  dealId: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.dealId, 'dealId');
  return `bookings/${params.bookingId}/contracts/${params.dealId}_${buildUniqueSuffix('pdf')}`;
}
```

---

### 8.3 Layanan Utama Private Storage (`src/modules/shared/storage/storage.service.ts`)
Mengelola unggah file tervalidasi, pembuatan *Signed URL* (300 detik) untuk pratinjau maupun unduhan (dengan sanitasi `downloadFileName` serta perlindungan terhadap *existence oracle*), dan penghapusan kompensasi (*Compensating Cleanup*) yang juga memvalidasi path sebelum memanggil `supabaseAdmin`.

```typescript
// Lokasi: src/modules/shared/storage/storage.service.ts
// Level Topologis: L0 (Core Infrastructure — Private Storage Service)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isValidStorageObjectPath } from './storage.paths';
import {
  STORAGE_BUCKET_NAME,
  SIGNED_URL_EXPIRES_IN_SECONDS,
  sanitizeFileName,
  validateUploadedFileServer,
} from './storage.validator';

export interface UploadedStorageObject {
  filePath: string;
  originalFileName: string;
  sanitizedFileName: string;
  mimeType: string;
  sizeBytes: number;
}

export const PrivateStorageService = {
  /**
   * 1. Validasi path & biner (ukuran, ekstensi, MIME, Magic Bytes) + Upload ke bucket privat
   *    menggunakan Supabase Server Client (dievaluasi oleh pol_fim_storage_insert).
   */
  async validateAndUpload(params: {
    file: File | null | undefined;
    targetPath: string;
    pdfOnly?: boolean;
  }): Promise<UploadedStorageObject> {
    if (!isValidStorageObjectPath(params.targetPath)) {
      throw new Error('INVALID_STORAGE_PATH: Format path tujuan dokumen tidak valid.');
    }

    const validated = await validateUploadedFileServer(params.file, {
      pdfOnly: params.pdfOnly,
    });

    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET_NAME)
      .upload(params.targetPath, validated.buffer, {
        contentType: validated.mimeType,
        upsert: false, // Dilarang menimpa file yang sudah ada (BR-10)
      });

    if (error) {
      throw new Error(
        `STORAGE_UPLOAD_FAILED: Gagal mengunggah dokumen (${error.message}).`
      );
    }

    return {
      filePath: params.targetPath,
      originalFileName: validated.originalFileName,
      sanitizedFileName: validated.sanitizedFileName,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
    };
  },

  /**
   * 2. Membangkitkan Signed URL sementara (berlaku 300 detik / 5 menit) untuk Preview atau Download.
   *    Menggunakan Server Client pengguna sehingga otomatis melewati pemeriksaan RLS pol_fim_storage_select.
   *    Pesan error diseragamkan agar tidak membocorkan keberadaan file milik Booking lain (anti-oracle).
   */
  async createAuthorizedSignedUrl(
    filePath: string,
    options?: { downloadFileName?: string }
  ): Promise<{ signedUrl: string; expiresAt: string; expiresInSeconds: number }> {
    if (!isValidStorageObjectPath(filePath)) {
      throw new Error('INVALID_STORAGE_PATH: Format path dokumen tidak valid.');
    }

    const safeDownloadName = options?.downloadFileName?.trim()
      ? sanitizeFileName(options.downloadFileName)
      : undefined;

    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET_NAME)
      .createSignedUrl(
        filePath,
        SIGNED_URL_EXPIRES_IN_SECONDS,
        safeDownloadName ? { download: safeDownloadName } : undefined
      );

    if (error || !data?.signedUrl) {
      throw new Error(
        'SIGNED_URL_ACCESS_DENIED: Dokumen tidak ditemukan atau Anda tidak berwenang mengakses dokumen transaksi ini.'
      );
    }

    return {
      signedUrl: data.signedUrl,
      expiresAt: new Date(
        Date.now() + SIGNED_URL_EXPIRES_IN_SECONDS * 1000
      ).toISOString(),
      expiresInSeconds: SIGNED_URL_EXPIRES_IN_SECONDS,
    };
  },

  /**
   * 3. Compensating Cleanup:
   *    Menghapus file yatim (orphaned file) di Storage apabila unggah ke Storage berhasil
   *    tetapi penyimpanan metadata ke tabel PostgreSQL gagal pada detik berikutnya.
   */
  async rollbackOrphanedUploadSafe(filePath: string): Promise<void> {
    if (!isValidStorageObjectPath(filePath)) {
      console.warn(
        '[STORAGE_COMPENSATING_CLEANUP_SKIPPED] Path tidak valid:',
        filePath
      );
      return;
    }

    try {
      const supabaseAdmin = createSupabaseAdminClient();
      const { error } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET_NAME)
        .remove([filePath]);

      if (error) {
        console.warn(
          '[STORAGE_COMPENSATING_CLEANUP_WARNING] Supabase menolak penghapusan file yatim:',
          filePath,
          error.message
        );
      }
    } catch (cleanupErr) {
      console.warn(
        '[STORAGE_COMPENSATING_CLEANUP_WARNING] Gagal menghapus file yatim:',
        filePath,
        cleanupErr
      );
    }
  },
};
```

---

### 8.4 Layanan & Server Actions Pengelolaan Dokumen (`src/modules/transactions/documents/documents.actions.ts`)
Mengimplementasikan operasi unggah dokumen dengan **validasi input & pra-kondisi database sebelum unggah** (plus *compensating cleanup* untuk *race condition*), pengambilan daftar metadata dokumen per Booking dengan penanganan `.error` eksplisit, serta pembuatan *Signed URL* untuk pratinjau (*preview*) dan unduh (*download*).

```typescript
// Lokasi: src/modules/transactions/documents/documents.actions.ts
// Layer 3: Server Actions untuk Upload, Preview, Download, & Pengambilan Metadata Dokumen

'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireActionAuth } from '@/modules/identity/auth/auth.guards';
import { PrivateStorageService } from '@/modules/shared/storage/storage.service';
import {
  buildKprDocumentStoragePath,
  buildPaymentProofStoragePath,
  isValidStorageObjectPath,
  isValidUuid,
} from '@/modules/shared/storage/storage.paths';
import {
  ALLOWED_FILE_EXTENSIONS,
  extractFileExtension,
} from '@/modules/shared/storage/storage.validator';

export interface DocumentActionResult<T = undefined> {
  success: boolean;
  message: string;
  data?: T;
}

export interface BookingDocumentsMetadata {
  paymentProofs: Array<{
    id: string;
    reference_number: string;
    paid_amount: number;
    payment_date: string;
    proof_file_path: string;
    proof_file_name: string;
    verification_status: string;
    submitted_at: string;
  }>;
  kprApplicationStatus: string | null;
  kprCurrentStage: string | null;
  kprDocuments: Array<{
    id: string;
    document_name: string;
    is_mandatory: boolean;
    status: string;
    file_path: string | null;
    file_name: string | null;
    uploaded_at: string | null;
    verified_at: string | null;
    verification_notes: string | null;
  }>;
  kprDisbursementProofs: Array<{
    id: string;
    tranche_type: string;
    sequence_number: number;
    disbursement_reference: string;
    proof_file_path: string;
    disbursement_date: string;
  }>;
  refundProofs: Array<{
    id: string;
    reference_number: string;
    refund_amount: number;
    status: string;
    proof_file_path: string | null;
    refund_date: string | null;
  }>;
  dealContract: {
    id: string;
    reference_number: string;
    contract_document_number: string | null;
    contract_file_path: string | null;
    contract_signed_at: string | null;
  } | null;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_PAYMENT_CHANNELS = [
  'BANK_TRANSFER',
  'VIRTUAL_ACCOUNT',
  'QRIS',
  'DEBIT_CARD',
  'CASH_COUNTER',
] as const;

function resolveValidatedUploadExtension(file: File | null | undefined): string {
  if (!file || typeof file.name !== 'string') {
    throw new Error('FILE_REQUIRED: File dokumen wajib dipilih untuk diunggah.');
  }
  const ext = extractFileExtension(file.name);
  if (
    !ALLOWED_FILE_EXTENSIONS.includes(
      ext as (typeof ALLOWED_FILE_EXTENSIONS)[number]
    )
  ) {
    throw new Error(
      `INVALID_EXTENSION: Ekstensi file ".${ext || 'unknown'}" tidak diizinkan. Gunakan JPG, PNG, WEBP, atau PDF.`
    );
  }
  return ext;
}

/**
 * 1. Server Action: Mengambil Signed URL (300 detik) untuk Preview atau Download Dokumen.
 *    Otorisasi ditegakkan di tiga lapis: requireActionAuth() + isValidStorageObjectPath() + RLS storage.objects.
 */
export async function getDocumentSignedUrlAction(params: {
  filePath: string;
  mode: 'PREVIEW' | 'DOWNLOAD';
  downloadFileName?: string;
}): Promise<
  DocumentActionResult<{
    signedUrl: string;
    expiresAt: string;
    expiresInSeconds: number;
  }>
> {
  try {
    await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);

    if (params.mode !== 'PREVIEW' && params.mode !== 'DOWNLOAD') {
      return {
        success: false,
        message: 'Mode akses dokumen harus PREVIEW atau DOWNLOAD.',
      };
    }

    if (!isValidStorageObjectPath(params.filePath)) {
      return {
        success: false,
        message: 'Format path dokumen tidak valid.',
      };
    }

    const result = await PrivateStorageService.createAuthorizedSignedUrl(
      params.filePath,
      params.mode === 'DOWNLOAD'
        ? { downloadFileName: params.downloadFileName ?? 'dokumen-fim-property' }
        : undefined
    );

    return {
      success: true,
      message: 'Tautan akses dokumen berhasil dibuat (berlaku 5 menit).',
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message.replace(/^[A-Z0-9_]+:\s*/, '')
          : 'Gagal mengakses dokumen.',
    };
  }
}

/**
 * 2. Server Action: Upload Bukti Pembayaran Pelanggan & Simpan ke payment_records.
 *    Memvalidasi status Booking, jadwal tagihan, dan sisa tagihan sebelum upload,
 *    serta dilengkapi Compensating Cleanup jika insert ke PostgreSQL gagal akibat race condition.
 */
export async function uploadPaymentProofAndCreateRecordAction(
  formData: FormData
): Promise<
  DocumentActionResult<{ paymentRecordId: string; referenceNumber: string; filePath: string }>
> {
  let uploadedFilePath: string | null = null;

  try {
    const actor = await requireActionAuth(['ADMIN', 'SALES']);

    const bookingId = String(formData.get('bookingId') ?? '').trim();
    const paymentScheduleId = String(formData.get('paymentScheduleId') ?? '').trim();
    const paidAmount = Number(formData.get('paidAmount'));
    const paymentDate = String(formData.get('paymentDate') ?? '').trim();
    const paymentChannel = String(
      formData.get('paymentChannel') ?? 'BANK_TRANSFER'
    )
      .trim()
      .toUpperCase();
    const replacesPaymentIdRaw = String(formData.get('replacesPaymentId') ?? '').trim();
    const salesNotes = String(formData.get('salesNotes') ?? '').trim();
    const file = formData.get('proofFile') as File | null;

    if (!isValidUuid(bookingId) || !isValidUuid(paymentScheduleId)) {
      return {
        success: false,
        message: 'Identitas Booking atau jadwal tagihan tidak valid.',
      };
    }

    if (replacesPaymentIdRaw && !isValidUuid(replacesPaymentIdRaw)) {
      return {
        success: false,
        message: 'Identitas bukti pembayaran pengganti tidak valid.',
      };
    }

    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return {
        success: false,
        message: 'Nominal pembayaran harus berupa angka positif lebih dari Rp 0.',
      };
    }

    if (!ISO_DATE_REGEX.test(paymentDate)) {
      return {
        success: false,
        message: 'Tanggal pembayaran wajib menggunakan format YYYY-MM-DD.',
      };
    }

    if (
      !ALLOWED_PAYMENT_CHANNELS.includes(
        paymentChannel as (typeof ALLOWED_PAYMENT_CHANNELS)[number]
      )
    ) {
      return {
        success: false,
        message: 'Kanal pembayaran yang dipilih tidak valid.',
      };
    }

    const supabase = await createSupabaseServerClient();

    // Pra-cek status Booking & jadwal agar tidak mengunggah file yang pasti ditolak trigger DB
    const { data: scheduleRow, error: scheduleErr } = await supabase
      .from('payment_schedules')
      .select('id, booking_id, status, remaining_amount, bookings!inner(id, status)')
      .eq('id', paymentScheduleId)
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (scheduleErr) {
      throw new Error(scheduleErr.message);
    }

    if (!scheduleRow) {
      return {
        success: false,
        message: 'Jadwal tagihan tidak ditemukan atau Anda tidak berwenang mengakses Booking ini.',
      };
    }

    const bookingStatus = (scheduleRow.bookings as unknown as { status: string }).status;
    if (!['PENDING_FEE', 'ACTIVE'].includes(bookingStatus)) {
      return {
        success: false,
        message: `Booking berstatus ${bookingStatus} tidak dapat menerima pengajuan pembayaran baru.`,
      };
    }

    if (['PAID', 'CANCELLED'].includes(scheduleRow.status)) {
      return {
        success: false,
        message: `Jadwal tagihan berstatus ${scheduleRow.status} tidak dapat menerima pembayaran baru.`,
      };
    }

    if (paidAmount > Number(scheduleRow.remaining_amount)) {
      return {
        success: false,
        message: 'Nominal pembayaran melebihi sisa tagihan jadwal saat ini.',
      };
    }

    const ext = resolveValidatedUploadExtension(file);
    const targetPath = buildPaymentProofStoragePath({
      bookingId,
      paymentScheduleId,
      extension: ext,
    });

    // Langkah A: Validasi biner & unggah file ke bucket privat
    const uploaded = await PrivateStorageService.validateAndUpload({
      file,
      targetPath,
    });
    uploadedFilePath = uploaded.filePath;

    // Langkah B: Simpan metadata ke tabel payment_records
    const { data: record, error: dbError } = await supabase
      .from('payment_records')
      .insert({
        reference_number: '', // Diisi otomatis oleh trigger trg_01_assign_payment_reference_number
        booking_id: bookingId,
        payment_schedule_id: paymentScheduleId,
        submitted_by_sales_id: actor.userId,
        paid_amount: paidAmount,
        payment_date: paymentDate,
        payment_channel: paymentChannel,
        proof_file_path: uploaded.filePath,
        proof_file_name: uploaded.sanitizedFileName,
        replaces_payment_id: replacesPaymentIdRaw || null,
        verification_status: 'PENDING_VERIFICATION',
        sales_notes: salesNotes || null,
      })
      .select('id, reference_number, proof_file_path')
      .single();

    if (dbError || !record) {
      throw new Error(dbError?.message ?? 'Gagal menyimpan catatan pembayaran di database.');
    }

    revalidatePath(`/bookings/${bookingId}`);
    revalidatePath('/payments');

    return {
      success: true,
      message: `Bukti pembayaran (${record.reference_number}) berhasil diunggah dan menunggu verifikasi Admin.`,
      data: {
        paymentRecordId: record.id,
        referenceNumber: record.reference_number,
        filePath: record.proof_file_path,
      },
    };
  } catch (error) {
    // Langkah C (Compensating Cleanup): Jika file sudah terunggah tetapi DB gagal, hapus file yatim!
    if (uploadedFilePath) {
      await PrivateStorageService.rollbackOrphanedUploadSafe(uploadedFilePath);
    }

    return {
      success: false,
      message:
        error instanceof Error
          ? error.message.replace(/^[A-Z0-9_]+:\s*/, '')
          : 'Gagal mengunggah bukti pembayaran.',
    };
  }
}

/**
 * 3. Server Action: Upload Dokumen Persyaratan KPR Fiktif (OQ-06) & Update kpr_documents.
 *    Melarang penimpaan dokumen yang sudah VERIFIED dan memverifikasi status KPR terbuka.
 */
export async function uploadKprRequirementDocumentAction(
  formData: FormData
): Promise<DocumentActionResult<{ kprDocumentId: string; status: string; filePath: string }>> {
  let uploadedFilePath: string | null = null;

  try {
    const actor = await requireActionAuth(['ADMIN', 'SALES']);

    const bookingId = String(formData.get('bookingId') ?? '').trim();
    const kprApplicationId = String(formData.get('kprApplicationId') ?? '').trim();
    const kprDocumentId = String(formData.get('kprDocumentId') ?? '').trim();
    const fallbackDocCode = String(formData.get('documentCode') ?? 'KPR_DOC').trim();
    const file = formData.get('file') as File | null;

    if (
      !isValidUuid(bookingId) ||
      !isValidUuid(kprApplicationId) ||
      !isValidUuid(kprDocumentId)
    ) {
      return {
        success: false,
        message: 'Parameter aplikasi KPR, Booking, atau item dokumen tidak valid.',
      };
    }

    const supabase = await createSupabaseServerClient();

    // Pra-cek kepemilikan dokumen KPR, status aplikasi KPR terbuka, dan cegah re-upload jika sudah VERIFIED
    const { data: docRow, error: docCheckErr } = await supabase
      .from('kpr_documents')
      .select(
        'id, status, document_name, kpr_bank_requirements(document_code), kpr_applications!inner(id, booking_id, application_status, bookings!inner(status))'
      )
      .eq('id', kprDocumentId)
      .eq('kpr_application_id', kprApplicationId)
      .maybeSingle();

    if (docCheckErr) {
      throw new Error(docCheckErr.message);
    }

    if (!docRow) {
      return {
        success: false,
        message: 'Item checklist dokumen KPR tidak ditemukan atau Anda tidak berwenang mengaksesnya.',
      };
    }

    const kprApp = docRow.kpr_applications as unknown as {
      id: string;
      booking_id: string;
      application_status: string;
      bookings: { status: string };
    };

    if (kprApp.booking_id !== bookingId) {
      return {
        success: false,
        message: 'Aplikasi KPR tidak sesuai dengan Booking yang dipilih.',
      };
    }

    if (kprApp.bookings.status !== 'ACTIVE') {
      return {
        success: false,
        message: `Booking berstatus ${kprApp.bookings.status} tidak dapat menerima dokumen KPR.`,
      };
    }

    if (!['IN_PROGRESS', 'APPROVED'].includes(kprApp.application_status)) {
      return {
        success: false,
        message: `Pengajuan KPR berstatus ${kprApp.application_status} sudah ditutup untuk unggah dokumen.`,
      };
    }

    if (docRow.status === 'VERIFIED') {
      return {
        success: false,
        message: 'Dokumen KPR yang sudah berstatus VERIFIED tidak dapat ditimpa atau diunggah ulang.',
      };
    }

    const reqMeta = docRow.kpr_bank_requirements as unknown as {
      document_code?: string;
    } | null;
    const effectiveDocCode =
      reqMeta?.document_code?.trim() ||
      docRow.document_name?.trim() ||
      fallbackDocCode ||
      'KPR_DOC';

    const ext = resolveValidatedUploadExtension(file);
    const targetPath = buildKprDocumentStoragePath({
      bookingId,
      kprApplicationId,
      documentCode: effectiveDocCode,
      extension: ext,
    });

    const uploaded = await PrivateStorageService.validateAndUpload({
      file,
      targetPath,
    });
    uploadedFilePath = uploaded.filePath;

    // Optimistic guard .neq('status', 'VERIFIED') menutup race condition jika Admin baru saja memverifikasi
    const { data: updatedDoc, error: dbError } = await supabase
      .from('kpr_documents')
      .update({
        status: 'UPLOADED',
        file_path: uploaded.filePath,
        file_name: uploaded.sanitizedFileName,
        uploaded_by: actor.userId,
        uploaded_at: new Date().toISOString(),
      })
      .eq('id', kprDocumentId)
      .eq('kpr_application_id', kprApplicationId)
      .neq('status', 'VERIFIED')
      .select('id, status, file_path')
      .single();

    if (dbError || !updatedDoc) {
      throw new Error(
        dbError?.message ??
          'Gagal memperbarui metadata dokumen KPR atau dokumen telah diverifikasi Admin.'
      );
    }

    revalidatePath(`/kpr/${kprApplicationId}`);
    revalidatePath(`/bookings/${bookingId}`);

    return {
      success: true,
      message: 'Dokumen persyaratan KPR berhasil diunggah ke penyimpanan privat.',
      data: {
        kprDocumentId: updatedDoc.id,
        status: updatedDoc.status,
        filePath: updatedDoc.file_path ?? uploaded.filePath,
      },
    };
  } catch (error) {
    if (uploadedFilePath) {
      await PrivateStorageService.rollbackOrphanedUploadSafe(uploadedFilePath);
    }

    return {
      success: false,
      message:
        error instanceof Error
          ? error.message.replace(/^[A-Z0-9_]+:\s*/, '')
          : 'Gagal mengunggah dokumen KPR.',
    };
  }
}

/**
 * 4. Server Action: Mengambil Seluruh Metadata Dokumen Terkait Satu Booking.
 *    Digunakan untuk menampilkan repositori dokumen terpadu pada halaman detail Booking/Deal.
 */
export async function listBookingDocumentsMetadataAction(
  bookingId: string
): Promise<DocumentActionResult<BookingDocumentsMetadata>> {
  try {
    await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);

    if (!isValidUuid(bookingId)) {
      return {
        success: false,
        message: 'Identitas Booking tidak valid.',
      };
    }

    const supabase = await createSupabaseServerClient();

    const [paymentRecordsRes, kprAppRes, refundsRes, dealRes] = await Promise.all([
      supabase
        .from('payment_records')
        .select(
          'id, reference_number, paid_amount, payment_date, proof_file_path, proof_file_name, verification_status, submitted_at'
        )
        .eq('booking_id', bookingId)
        .order('submitted_at', { ascending: false }),
      supabase
        .from('kpr_applications')
        .select(
          'id, reference_number, application_status, current_stage, kpr_documents(id, document_name, is_mandatory, status, file_path, file_name, uploaded_at, verified_at, verification_notes), kpr_disbursements(id, tranche_type, sequence_number, disbursement_reference, proof_file_path, disbursement_date)'
        )
        .eq('booking_id', bookingId)
        .maybeSingle(),
      supabase
        .from('refund_transactions')
        .select('id, reference_number, refund_amount, status, proof_file_path, refund_date')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false }),
      supabase
        .from('deals')
        .select(
          'id, reference_number, contract_document_number, contract_file_path, contract_signed_at'
        )
        .eq('booking_id', bookingId)
        .maybeSingle(),
    ]);

    if (
      paymentRecordsRes.error ||
      kprAppRes.error ||
      refundsRes.error ||
      dealRes.error
    ) {
      throw new Error(
        paymentRecordsRes.error?.message ||
          kprAppRes.error?.message ||
          refundsRes.error?.message ||
          dealRes.error?.message ||
          'Gagal memuat daftar metadata dokumen Booking.'
      );
    }

    const kprDocs = [...(kprAppRes.data?.kpr_documents ?? [])].sort((a, b) =>
      a.document_name.localeCompare(b.document_name)
    );
    const kprDisbursements = [...(kprAppRes.data?.kpr_disbursements ?? [])].sort(
      (a, b) => a.sequence_number - b.sequence_number
    );

    return {
      success: true,
      message: 'Metadata dokumen Booking berhasil dimuat.',
      data: {
        paymentProofs: paymentRecordsRes.data ?? [],
        kprApplicationStatus: kprAppRes.data?.application_status ?? null,
        kprCurrentStage: kprAppRes.data?.current_stage ?? null,
        kprDocuments: kprDocs,
        kprDisbursementProofs: kprDisbursements,
        refundProofs: refundsRes.data ?? [],
        dealContract: dealRes.data ?? null,
      },
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message.replace(/^[A-Z0-9_]+:\s*/, '')
          : 'Gagal memuat daftar dokumen Booking.',
    };
  }
}
```

---

## 9. Upload dan Download Flow

### 9.1 Mengapa Kita Menggunakan *Server-Side Upload* (Melalui Server Actions)?
Dalam arsitektur FIM-Property, ukuran maksimal file adalah **5 MB**. Mengunggah file melalui **Server Actions (`uploadPaymentProofAndCreateRecordAction` & `uploadKprRequirementDocumentAction`, serta `TransactionsService` pada File 06)** dipilih karena memberikan 4 keunggulan keamanan dibanding unggah langsung dari browser:
1. **Validasi Pra-Unggah terhadap Status Bisnis:** Server memastikan Booking, jadwal tagihan, maupun status pengajuan KPR masih terbuka dan item checklist KPR belum berstatus `'VERIFIED'` sebelum file disentuh.
2. **Inspeksi Biner *Magic Bytes* di Server:** Server membaca byte header (`%PDF-`, `FF D8 FF`, `89 50 4E 47`, `RIFF....WEBP`) sebelum file masuk ke bucket Storage.
3. **Koordinasi Satu Pintu antara Storage & Database:** Server menjalankan unggah ke Storage (`upsert: false`), langsung menyimpan path-nya ke tabel PostgreSQL, dan apabila database menolak transaksi (misal *race condition*), server langsung menjalankan **Compensating Cleanup** dalam satu siklus permintaan yang sama.
4. **Konstruksi Path Deterministik:** Browser tidak pernah diizinkan menentukan string `file_path` sendiri; path selalu dirakit di server oleh `storage.paths.ts` menggunakan ID terverifikasi.

### 9.2 Alur Pratinjau (Preview) dan Unduh (Download) dengan Signed URL
1. Pengguna (Sales, Supervisor, atau Admin) mengklik tombol **"Lihat Bukti Bayar"** atau **"Unduh Dokumen KPR"**.
2. Komponen klien memanggil `getDocumentSignedUrlAction({ filePath, mode: 'PREVIEW' | 'DOWNLOAD', downloadFileName })`.
3. Server memverifikasi sesi melalui `requireActionAuth()`, memeriksa pola path melalui `isValidStorageObjectPath()`, mensanitasi `downloadFileName`, lalu memanggil `supabase.storage.from('fim-private-documents').createSignedUrl(filePath, 300)`.
4. Mesin Supabase memeriksa kebijakan RLS `pol_fim_storage_select` (`app_security.can_read_storage_object`).
   * Jika pengguna berhak $\rightarrow$ Mengembalikan URL bertanda tangan kriptografi yang otomatis hangus setelah **300 detik (5 menit)**.
   * Jika pengguna tidak berhak (misal Sales mencoba mengakses path Booking milik Sales lain atau path non-standar) $\rightarrow$ Ditolak dengan pesan seragam `SIGNED_URL_ACCESS_DENIED` tanpa membocorkan apakah objek tersebut ada atau tidak.

---

## 10. Metadata dan Konsistensi Data

Karena **Supabase Storage** dan **PostgreSQL** tidak berada dalam satu transaksi database *Two-Phase Commit (2PC)*, berikut adalah cara sistem menangani 6 skenario tepi (*edge cases*) konsistensi data:

| No | Kondisi / Skenario Tepi | Mekanisme Penanganan di Sistem FIM-Property |
| :--- | :--- | :--- |
| **1** | **File berhasil di-upload ke Storage, tetapi penyimpanan metadata di PostgreSQL gagal.** | Blok `catch` pada Server Action / `TransactionsService` langsung memanggil `PrivateStorageService.rollbackOrphanedUploadSafe(uploadedFilePath)` untuk menghapus file yatim tersebut dari bucket `fim-private-documents` (setelah memastikan `isValidStorageObjectPath(filePath)`). |
| **2** | **Bukti pembayaran ditolak Admin (`REJECTED`), lalu Sales mengunggah bukti bayar koreksi.** | Sesuai **`BR-08` & `BR-10`**, baris `payment_records` yang `REJECTED` beserta file buktinya di Storage **tetap disimpan utuh**. Bukti bayar koreksi diunggah dengan nama objek baru (`{timestamp}_{uuid}`) dan disimpan sebagai baris `payment_records` baru dengan `replaces_payment_id` menunjuk ke record lama. |
| **3** | **Dokumen KPR diminta revisi (`REVISION_REQUIRED`), lalu Sales mengunggah perbaikan.** | File perbaikan diunggah dengan path ber-*timestamp* baru dan kolom `kpr_documents.file_path` diperbarui menunjuk ke file terbaru (`status = 'UPLOADED'`), sementara file lama tidak ditimpa (`upsert: false`). |
| **4** | **Dokumen KPR baru saja diverifikasi Admin (`VERIFIED`) bersamaan dengan percobaan upload ulang.** | Pra-cek di server langsung menolak `doc.status === 'VERIFIED'`, dan query `UPDATE kpr_documents` menyertakan guard `.neq('status', 'VERIFIED')` (serta `trg_00_guard_kpr_documents_update` untuk non-Admin). Jika bentrok konkuren terjadi, 0 baris ter-update dan *compensating cleanup* menghapus file baru di Storage. |
| **5** | **Dua pengguna atau satu pengguna mengunggah dua file dengan nama asli yang sama (`ktp.pdf`) secara bersamaan.** | Fungsi `buildUniqueSuffix()` pada `storage.paths.ts` selalu menambahkan `{Date.now()}_{shortUuid}` pada nama objek di Storage, sehingga kedua unggahan menghasilkan path unik dan tidak pernah saling bertabrakan. |
| **6** | **Metadata tersimpan di database, tetapi file fisik di Storage hilang/tidak ditemukan.** | Saat `createAuthorizedSignedUrl()` dipanggil, Supabase Storage mengembalikan error `Object not found` yang ditangkap oleh `PrivateStorageService` dan dikembalikan sebagai pesan terstruktur (`SIGNED_URL_ACCESS_DENIED`) tanpa menyebabkan aplikasi *crash*. |

---

## 11. Security dan Authorization

1. **Larangan Mutlak `SUPABASE_SERVICE_ROLE_KEY` di Browser:**
   Seluruh operasi unggah (`validateAndUpload`) dan pembuatan *Signed URL* (`createAuthorizedSignedUrl`) berjalan di sisi server menggunakan `createSupabaseServerClient()` yang membawa identitas pengguna (`auth.uid()`). Klien admin (`createSupabaseAdminClient()`) hanya digunakan di sisi server untuk penghapusan kompensasi (`rollbackOrphanedUploadSafe`) ketika transaksi database gagal, dan hanya menerima path yang lulus `isValidStorageObjectPath()`.
2. **Signed URL Bukan Pengganti Otorisasi:**
   Aplikasi tidak pernah menyimpan *Signed URL* di dalam database. Database hanya menyimpan `file_path` relatif (misal `bookings/.../payments/.../1741000_a1b2.pdf`). Setiap kali pengguna ingin melihat dokumen, hak aksesnya terhadap Booking tersebut diverifikasi ulang secara *real-time* sebelum *Signed URL* 300 detik diterbitkan.
3. **Anti-Spoofing, Anti-Header-Injection, & Anti-Existence-Oracle:**
   * `can_upload_storage_object` mewajibkan `refund_id` dan `deal_id` pada segmen nama file `refunds/` dan `contracts/` benar-benar ada dan bertaut dengan `booking_id` di tabel `refund_transactions` / `deals`.
   * `sanitizeFileName` membersihkan `CR/LF`, tanda kutip, backslash, dan `..` baik untuk metadata DB maupun header `Content-Disposition` pada `createSignedUrl`.
   * `createAuthorizedSignedUrl` menyamakan pesan penolakan untuk "tidak ditemukan" dan "tidak berwenang" sehingga pengguna tidak bisa memindai keberadaan dokumen Booking milik Sales atau tim lain.

---

## 12. Testing (16 Skenario Pengujian Storage & Dokumen)

### 12.1 Matriks 16 Skenario Pengujian Wajib

| ID Uji | Skenario Pengujian | Langkah / Input Pengujian | Hasil yang Diharapkan (Acceptance Criteria) |
| :--- | :--- | :--- | :--- |
| **STG-01** | **1. Upload File Valid (`PDF` / `JPG` $\le 5\text{ MB}$)** | Login sebagai Sales A1; unggah bukti transfer PDF asli berukuran 400 KB untuk Booking miliknya yang berstatus `ACTIVE` / `PENDING_FEE`. | **Berhasil.** File tersimpan di bucket `fim-private-documents` dan baris `payment_records` terbentuk dengan status `'PENDING_VERIFICATION'`. |
| **STG-02** | **2. Upload File Melebihi Batas Ukuran ($> 5\text{ MB}$)** | Unggah file gambar/PDF berukuran 6.2 MB. | **Ditolak** di validator server dengan pesan `FILE_TOO_LARGE: Ukuran file (6.20 MB) melebihi batas maksimal 5 MB` (dan ditolak juga oleh `file_size_limit` bucket). |
| **STG-03** | **3. Upload MIME Type / Magic Bytes Tidak Diizinkan** | 1. Unggah file `.exe` atau `.docx`.<br>2. Ubah nama `script.html` menjadi `bukti.pdf` lalu unggah. | 1. Ditolak dengan `INVALID_EXTENSION` / `INVALID_MIME_TYPE`.<br>2. Ditolak oleh pemeriksa *Magic Bytes* dengan `CORRUPTED_OR_SPOOFED_FILE`. |
| **STG-04** | **4. Upload Tanpa Login (`anon`) atau Akun Nonaktif** | Kirim request unggah ke Storage tanpa sesi login, atau menggunakan akun staf dengan `is_active = false`. | **Ditolak (`401 / 403`)** oleh `requireActionAuth()` dan RLS `storage.objects` (`get_current_user_role()` bernilai `NULL`). |
| **STG-05** | **5. Upload oleh Role Tidak Berwenang** | 1. Login sebagai `SUPERVISOR`, coba unggah bukti bayar.<br>2. Login sebagai `SALES`, coba unggah ke subfolder `refunds/`, `contracts/`, atau `kpr-disbursements/`. | **Ditolak (`false`)** oleh `app_security.can_upload_storage_object`. Supervisor bersifat *Read-Only*, dan subfolder `refunds`/`kpr-disbursements`/`contracts` khusus `ADMIN`. |
| **STG-06** | **6. Download / Preview Dokumen yang Boleh Diakses** | Login sebagai Sales A1 (pemilik Booking), Supervisor Tim Alpha (tim aktif yang sama), atau Admin; panggil `getDocumentSignedUrlAction`. | **Berhasil.** Mengembalikan `signedUrl` yang valid dengan `expiresInSeconds = 300`. |
| **STG-07** | **7. Download Dokumen Milik Sales / Tim Lain** | Login sebagai Sales B1 (Tim Bravo) atau Supervisor Tim Bravo; minta `signedUrl` untuk `filePath` milik Booking Tim Alpha. | **Ditolak** oleh RLS `pol_fim_storage_select` (`can_read_storage_object = false`) dengan pesan `SIGNED_URL_ACCESS_DENIED`. |
| **STG-08** | **8. Manipulasi Path (*Path Traversal / Spoofing Schedule*)** | Coba akses/unggah path `bookings/../secret.pdf`, `bookings\id\payments\...`, `bookings/<BOOKING_SENDIRI>/payments/<SCHEDULE_ORANG_LAIN>/a.pdf`, atau `contracts/test.jpg`. | **Ditolak (`false`)** oleh `isValidStorageObjectPath()`, `can_read_storage_object()`, dan `can_upload_storage_object()`. |
| **STG-09** | **9. Menghapus / Menimpa Dokumen dari Client** | Pengguna menjalankan `supabase.storage.from('fim-private-documents').remove([path])` atau `.upload(..., { upsert: true })` dari client. | **Ditolak** karena tidak ada policy RLS `FOR DELETE` maupun `FOR UPDATE` untuk role `authenticated`. |
| **STG-10** | **10. Signed URL yang Kedaluwarsa ($> 300\text{ Detik}$)** | Buka `signedUrl` setelah lebih dari 5 menit (300 detik) sejak dibuat. | Server Supabase Storage menolak akses dengan status token kedaluwarsa (`InvalidJWT / Expired`). |
| **STG-11** | **11. Kegagalan Penyimpanan Metadata Database** | Simulasikan insert ke `payment_records` ditolak constraint/trigger DB setelah file terunggah (misal *overpayment* konkuren). | `rollbackOrphanedUploadSafe` berjalan otomatis menghapus file yang baru diunggah dari Storage sehingga tidak ada file yatim. |
| **STG-12** | **12. Imutabilitas Saat Bukti Bayar Ditolak & Dikoreksi** | Admin menolak bukti bayar #1 (`REJECTED`), lalu Sales mengunggah bukti bayar koreksi #2 (`replacesPaymentId` diisi). | Kedua record dan kedua file bukti bayar tetap ada di database dan Storage sebagai rekam jejak audit yang utuh. |
| **STG-13** | **13. Upload Dua File dengan Nama Asli yang Sama** | Unggah `slip_gaji_fiktif.pdf` dua kali berturut-turut. | Keduanya berhasil disimpan tanpa bentrok karena `buildUniqueSuffix()` menghasilkan nama objek `{timestamp}_{shortUuid}.pdf` yang berbeda. |
| **STG-14** | **14. Upload Ditolak pada Booking / Jadwal / KPR Tertutup** | 1. Coba unggah bukti bayar untuk jadwal `'PAID'` atau Booking `'CANCELLED'`/`'EXPIRED'`.<br>2. Coba unggah dokumen KPR saat `kpr_applications.application_status = 'REJECTED_BY_BANK'` atau `'COMPLETED'`.<br>3. Coba unggah bukti pencairan saat `application_status = 'IN_PROGRESS'`. | **Ditolak** oleh validasi pra-unggah pada `documents.actions.ts` dan oleh kebijakan RLS `app_security.can_upload_storage_object()`. |
| **STG-15** | **15. Pencegahan Spoofing `refund_id` / `deal_id` & Re-upload Dokumen `VERIFIED`** | 1. Admin mencoba unggah langsung ke `bookings/{booking_A}/refunds/{refund_milik_booking_B}_1_abcd.pdf` atau `contracts/{deal_milik_booking_B}_1_abcd.pdf`.<br>2. Sales/Admin mencoba mengunggah file baru ke item `kpr_documents` yang sudah berstatus `'VERIFIED'`. | 1. **Ditolak (`false`)** oleh `can_upload_storage_object` karena `refund_id`/`deal_id` bukan milik `booking_A` atau status tidak sah.<br>2. **Ditolak** (`Dokumen KPR yang sudah berstatus VERIFIED tidak dapat ditimpa`). |
| **STG-16** | **16. Sanitasi `downloadFileName` & Kegagalan Query Metadata** | 1. Panggil `getDocumentSignedUrlAction` dengan `downloadFileName: '../../test\r\nX-Test:1.pdf'`.<br>2. Simulasikan `bookingId` non-UUID pada `listBookingDocumentsMetadataAction`. | 1. Nama file unduhan disanitasi menjadi `test__X-Test_1.pdf` tanpa karakter kontrol atau traversal.<br>2. Mengembalikan `{ success: false, message: 'Identitas Booking tidak valid.' }`. |

---

### 12.2 Skrip SQL Verifikasi Konfigurasi Bucket & Fungsi Keamanan Storage
Jalankan query berikut di **Supabase Studio SQL Editor** (`http://127.0.0.1:54323`) setelah menjalankan migrasi untuk memverifikasi kesiapan Storage:

```sql
-- 1. Verifikasi konfigurasi bucket 'fim-private-documents'
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'fim-private-documents';

-- 2. Verifikasi keberadaan 3 fungsi helper keamanan Storage di schema app_security
SELECT routine_name, security_type
FROM information_schema.routines
WHERE routine_schema = 'app_security'
  AND routine_name IN (
      'try_parse_uuid',
      'can_read_storage_object',
      'can_upload_storage_object'
  )
ORDER BY routine_name;

-- 3. Verifikasi kebijakan RLS pada tabel storage.objects
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN ('pol_fim_storage_select', 'pol_fim_storage_insert')
ORDER BY policyname;

-- 4. Uji statis penolakan path berbahaya pada fungsi validator Storage
SELECT
    app_security.can_read_storage_object('fim-private-documents', 'bookings/../secret.pdf') AS test_traversal_rejected,
    app_security.can_read_storage_object('fim-private-documents', 'bookings/00000000-0000-0000-0000-000000000001/contracts/bad.jpg') AS test_non_pdf_contract_rejected,
    app_security.can_read_storage_object('public-bucket', 'bookings/00000000-0000-0000-0000-000000000001/contracts/00000000-0000-0000-0000-000000000002_1_abcd.pdf') AS test_wrong_bucket_rejected;
```

* **Kriteria Lulus Verifikasi:**
  1. Bucket `fim-private-documents` tampil dengan `public = false`, `file_size_limit = 5242880`, dan 4 MIME type yang diizinkan.
  2. Ketiga fungsi helper di schema `app_security` tampil dengan `security_type = 'DEFINER'`.
  3. Kedua policy RLS (`pol_fim_storage_select` dan `pol_fim_storage_insert`) aktif pada `storage.objects` tanpa policy `UPDATE`/`DELETE` untuk `authenticated`.
  4. Seluruh hasil `test_*_rejected` bernilai `false`.

---

## 13. Cara Menjalankan Migration

Simpan kode SQL pada Bagian 6 ke dalam file **`supabase/migrations/20260301000900_private_storage_buckets_and_policies.sql`**, lalu jalankan perintah berikut dari root proyek (`fim-property/`):

```bash
# Terapkan seluruh migrasi database & storage (Migrasi 1 s/d Migrasi 9)
npm run db:reset
```

---

## 14. Acceptance Criteria

Implementasi **File 05 (Supabase Storage & Document Management)** dinyatakan **SELESAI** apabila seluruh kriteria berikut terpenuhi:

- [ ] **AC-01:** File migrasi `supabase/migrations/20260301000900_private_storage_buckets_and_policies.sql` berhasil dieksekusi melalui `npm run db:reset` tanpa error.
- [ ] **AC-02:** Bucket `fim-private-documents` berstatus privat (`public = false`) dengan batas ukuran `5242880 bytes` (5 MB) dan hanya mengizinkan `image/jpeg`, `image/png`, `image/webp`, serta `application/pdf`.
- [ ] **AC-03:** Fungsi `app_security.can_read_storage_object` dan `app_security.can_upload_storage_object` memvalidasi struktur path ketat (4/5 segmen, ekstensi valid, bebas traversal), kepemilikan Booking, kecocokan `payment_schedule_id` / `kpr_application_id` / `refund_id` / `deal_id` terhadap `booking_id`, serta memblokir unggahan pada Booking, jadwal, KPR, refund, atau kontrak yang sudah tertutup.
- [ ] **AC-04:** Validator server (`storage.validator.ts`) dan pembangun path (`storage.paths.ts`) memeriksa ukuran file, MIME type, ekstensi, sanitasi nama file bebas traversal/header injection, dan tanda tangan biner (*Magic Bytes*).
- [ ] **AC-05:** Seluruh pratinjau dan unduhan dokumen menggunakan *Signed URL* berdurasi **300 detik** yang melewati evaluasi RLS pengguna serta menyamarkan keberadaan objek yang tidak berhak diakses.
- [ ] **AC-06:** Server Actions dokumen (`documents.actions.ts`) memvalidasi input & pra-kondisi database sebelum upload, mencegah penimpaan dokumen KPR berstatus `'VERIFIED'`, menangani `.error` pada seluruh query metadata, dan menjalankan *Compensating Cleanup* (`rollbackOrphanedUploadSafe`) bila transaksi DB gagal.

---

## 15. Troubleshooting

| No | Gejala / Pesan Error | Penyebab Utama | Solusi Penyelesaian |
| :--- | :--- | :--- | :--- |
| **1** | `new row violates row-level security policy` saat mengunggah file ke Storage. | Path objek tidak mengikuti pola 4/5 segmen atau ekstensi valid `bookings/{booking_id}/...`, pengguna yang login adalah `SUPERVISOR` / nonaktif, `payment_schedule_id`/`kpr_application_id`/`refund_id`/`deal_id` tidak cocok dengan `booking_id`, atau status Booking/Jadwal/KPR/Refund sudah tertutup. | Gunakan fungsi pembangun path dari `src/modules/shared/storage/storage.paths.ts`, pastikan akun pengunggah berwenang (`SALES` pemegang aktif atau `ADMIN`), dan pastikan status transaksi di DB masih terbuka. |
| **2** | `CORRUPTED_OR_SPOOFED_FILE` saat mengunggah gambar atau PDF. | File yang diunggah bukan file JPG/PNG/WEBP/PDF asli (misalnya file teks/HTML yang hanya diganti ekstensi namanya). | Gunakan file dokumen PDF atau gambar asli yang memiliki header biner standar. |
| **3** | Gambar bukti bayar tidak tampil lagi setelah halaman didiamkan selama $> 5\text{ menit}$. | *Signed URL* memiliki masa berlaku keamanan 300 detik (5 menit) sesuai spesifikasi Phase 1B. | Klik kembali tombol "Lihat Dokumen" atau muat ulang modal pratinjau untuk membangkitkan *Signed URL* baru. |
| **4** | `Dokumen KPR yang sudah berstatus VERIFIED tidak dapat ditimpa atau diunggah ulang.` | Dokumen persyaratan KPR pada item checklist tersebut sudah disetujui (`VERIFIED`) oleh Admin (`BR-10`). | Bila dokumen benar-benar perlu diganti karena kesalahan verifikasi, hanya Admin yang dapat mengubah status item checklist tersebut terlebih dahulu di tabel `kpr_documents` menjadi `'REVISION_REQUIRED'` melalui audit terkontrol. |

---

## 16. Checklist Penyelesaian

- [x] Penyelarasan penuh referensi terhadap `File 01 v1.1`, `File 02 v1.4`, `File 03 v1.1`, `File 04 v1.3`, dan `File 06 v1.0`.
- [x] Inventarisasi bucket `fim-private-documents` dan 5 kategori dokumen transaksi sesuai Phase 1B `v1.1` Bagian 10 beserta prasyarat status bisnisnya.
- [x] Pembaruan SQL migrasi `20260301000900_private_storage_buckets_and_policies.sql` dengan validasi status transaksi (`payments`, `kpr-docs`, `kpr-disbursements`, `refunds`, `contracts`), pencegahan spoofing `refund_id`/`deal_id` lintas-Booking, serta pengetatan segmen & ekstensi path.
- [x] Pembaruan modul TypeScript (`storage.validator.ts`, `storage.paths.ts`, `storage.service.ts`, dan `documents.actions.ts`) termasuk `isValidStorageObjectPath()`, sanitasi nama file bebas traversal/CR-LF, validasi `NaN`/`sequenceNumber`/tanggal/UUID, pra-cek DB, guard `.neq('status', 'VERIFIED')`, dan penanganan `.error` pada metadata query.
- [x] Pembaruan matriks pengujian menjadi 16 skenario (`STG-01` s/d `STG-16`) beserta skrip SQL verifikasi statis.

---

## Changelog (`v1.0` $\rightarrow$ `v1.1`)

1. **Penyelarasan Referensi & Status Transaksi Storage RLS (`Bagian 6` — `app_security.can_upload_storage_object`):**
   * Menambahkan validasi status Booking dan entitas anak agar selaras dengan **`File 02 v1.4`**, **`File 03 v1.1`**, dan **`File 04 v1.3`**:
     * `payments`: Wajib `bookings.status IN ('PENDING_FEE', 'ACTIVE')` dan `payment_schedules.status NOT IN ('PAID', 'CANCELLED')` (selaras dengan `trg_00_guard_payment_records_insert`).
     * `kpr-docs`: Wajib `bookings.status = 'ACTIVE'` dan `kpr_applications.application_status IN ('IN_PROGRESS', 'APPROVED')` (menutup celah unggah pada KPR yang sudah `REJECTED_BY_BANK`, `CANCELLED_BY_CUSTOMER`, `BOOKING_CANCELLED`, atau `COMPLETED`).
     * `kpr-disbursements`: Wajib `bookings.status = 'ACTIVE'`, `kpr_applications.application_status = 'APPROVED'`, dan `current_stage IN ('AKAD_COMPLETED', 'DISBURSEMENT')`.
     * `refunds`: Mengekstrak `refund_id` dari prefix nama file (`left(v_parts[4], 36)`) dan memverifikasi kepemilikan di `public.refund_transactions` (`rt.booking_id = v_booking_id`, `rt.status = 'PENDING_REFUND'`, `b.status = 'CANCELLED'`).
     * `contracts`: Mengekstrak `deal_id` dari prefix nama file (`left(v_parts[4], 36)`) dan memverifikasi kepemilikan di `public.deals` (`d.booking_id = v_booking_id`, `b.status = 'ACTIVE'`, `d.contract_status IN ('PRE_CONTRACT', 'UNDER_CONTRACT')`).
2. **Pengetatan Validasi Path, Segmen, dan Ekstensi (`can_read_storage_object`, `can_upload_storage_object`, & `isValidStorageObjectPath`):**
   * Menolak karakter kontrol (`[[:cntrl:]]`), backslash (`\`), persen (`%`), spasi tepi, serta slash di akhir path.
   * Menegakkan jumlah segmen eksak per kategori (`5` untuk `payments`, `kpr-docs`, `kpr-disbursements`; `4` untuk `refunds`, `contracts`), format awalan `tranche_{seq}_` pada `kpr-disbursements`, format UUID prefix pada `refunds`/`contracts`, serta daftar ekstensi yang diizinkan (`jpg|jpeg|png|webp|pdf`, khusus `pdf` untuk `contracts`) secara simetris di SQL dan TypeScript.
3. **Perbaikan Keamanan & Keandalan Implementasi TypeScript (`Bagian 8`):**
   * **`storage.validator.ts`:** Memperbaiki `sanitizeFileName()` agar membuang prefix direktori, karakter kontrol, dan `..`; menormalkan MIME type dengan `.trim().toLowerCase()`; serta memeriksa panjang aktual biner hasil `arrayBuffer()`.
   * **`storage.paths.ts`:** Menambahkan validasi `sequenceNumber` bilangan bulat positif (`>= 1`) agar tidak pernah menghasilkan `tranche_NaN_...`, memvalidasi ekstensi terhadap `ALLOWED_FILE_EXTENSIONS`, dan mengekspor `isValidStorageObjectPath()` serta `isValidUuid()`.
   * **`storage.service.ts`:** Memvalidasi `targetPath`/`filePath` via `isValidStorageObjectPath()` di `validateAndUpload()`, `createAuthorizedSignedUrl()`, dan `rollbackOrphanedUploadSafe()` (melindungi panggilan `supabaseAdmin`); mensanitasi `downloadFileName` untuk mencegah injeksi header `Content-Disposition`; serta tetap menjaga kompatibilitas penuh kontrak return dengan `File 06 v1.0`.
   * **`documents.actions.ts`:** Memperbaiki celah `NaN` pada `paidAmount` (`!Number.isFinite(paidAmount)`), memvalidasi format UUID, tanggal ISO, dan kanal pembayaran, menambahkan pra-cek database sebelum upload pada `uploadPaymentProofAndCreateRecordAction` & `uploadKprRequirementDocumentAction`, mencegah penimpaan dokumen KPR berstatus `'VERIFIED'` (termasuk guard optimistik `.neq('status', 'VERIFIED')`), memvalidasi `params.mode` pada `getDocumentSignedUrlAction`, serta menambahkan pemeriksaan `.error` eksplisit dan tipe hasil terstruktur `DocumentActionResult<BookingDocumentsMetadata>` pada `listBookingDocumentsMetadataAction`.
4. **Pembaruan Pengujian & Verifikasi (`Bagian 12`, `14`, `15`, `16`):**
   * Menambahkan skenario uji **`STG-14`**, **`STG-15`**, dan **`STG-16`** serta kueri verifikasi penolakan path statis pada `Bagian 12.2`.
