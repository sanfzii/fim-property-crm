# FIM-Property Database Migration Implementation

* **Nama File:** `FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`
* **Versi Dokumen:** `1.4` *(Revisi teknis terbatas terhadap `v1.3` untuk memperkuat constraint `chk_kpr_applications_loan_reconciliation` pada tabel `kpr_applications` agar `disbursement_status` selalu konsisten dengan jumlah dana pencairan sebenarnya, `fully_disbursed_at`, dan `application_status`, tanpa mengubah struktur tabel, ENUM, maupun ruang lingkup fitur)*
* **Tujuan Dokumen:** Menjadi pedoman implementasi teknis yang lengkap, berurutan, dan siap dijalankan (baik secara manual maupun menggunakan **Codex**) untuk membangun seluruh skema basis data PostgreSQL **FIM-Property** (34 tipe ENUM, 32 tabel ternormalisasi, *Primary Keys*, *Foreign Keys*, *Composite Foreign Keys*, *Partial Unique Indexes*, *Check Constraints*, 37 *Performance Indexes*, dan 17 *Triggers* `updated_at`) menggunakan **Supabase CLI** dan **SQL Migrations**.
* **Ruang Lingkup:** Implementasi struktur skema database PostgreSQL melalui 6 file migrasi SQL (`supabase/migrations/20260301000100_*.sql` s/d `20260301000600_*.sql`), verifikasi integritas relasional, pengujian eksekusi migrasi lokal, dan pembangkitan tipe TypeScript Supabase.
* **Referensi Dokumen:**
  1. `FIM-PROPERTY_MASTER_BUSINESS_DISCOVERY_v1.2_FINAL.md`
  2. `FIM-PROPERTY_PHASE_1A_SYSTEM_ARCHITECTURE_v1.2.md`
  3. `FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0.md`
  4. `FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.1.md`
  5. `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`
* **Dependency terhadap File Lain:**
  * **Bergantung pada (Upstream):** `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md` (Proyek Next.js, Docker Desktop, Supabase CLI, `supabase/config.toml`, dan `src/types/database.types.ts` harus sudah disiapkan).
  * **Menjadi Prasyarat bagi (Downstream):**
    * **File 03 (`FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS`):** Fungsi privat `app_security`, Views (`public.v_staff_directory`, `public.v_unit_catalog`), Trigger penjaga kolom (`trg_00_guard_*`), `GRANT`/`REVOKE`, dan kebijakan RLS untuk ke-32 tabel (`20260301000700`).
    * **File 04 (`FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC`):** Fungsi Transaksi Atomik PostgreSQL (`TX-01` s/d `TX-08` serta penanganan pembatalan KPR oleh konsumen), `app_security.next_reference_number`, dan trigger `trg_01_assign_payment_reference_number` (`20260301000800`).
    * **File 05 (`FIM-PROPERTY_IMPLEMENTATION_05_STORAGE_DOCUMENTS`):** Bucket privat `fim-private-documents` dan kebijakan RLS pada `storage.objects` (`20260301000900`).
    * **File 06 (`FIM-PROPERTY_IMPLEMENTATION_06_APPLICATION_BACKEND`):** *Service Layer*, *Server Actions*, kalkulator skor prospek deterministik berbasis aturan bisnis (non-ML), *Hybrid Reminder Engine*, dan *Metrics Service*.
* **Status Eksekusi:** Seluruh skrip SQL dalam dokumen ini valid secara sintaks PostgreSQL 15+ dan siap dieksekusi oleh pengembang maupun **Codex**, namun **belum dijalankan pada mesin lokal Anda**.

---

## 1. Tujuan Dokumen

Dokumen ini disusun khusus untuk memandu proses penerjemahan rancangan arsitektur database **FIM-Property** (Phase 1B `v1.0` dan `v1.1`) beserta penyempurnaan modul KPR terbaru menjadi skrip migrasi SQL nyata yang dikelola oleh **Supabase CLI**.

Menyusun puluhan tabel yang saling berelasi sering kali menimbulkan kegagalan eksekusi (*migration error*) akibat urutan pembuatan tabel yang salah (*missing relation*), tipe ENUM yang belum terdaftar, atau constraint yang saling bertabrakan. Dokumen ini menyelesaikan masalah tersebut dengan:
1. Memetakan inventarisasi utuh atas **34 ENUM** dan **32 Tabel** tanpa ada satu pun kolom atau tipe data penting yang tertinggal.
2. Menyusun urutan eksekusi migrasi berdasarkan pohon ketergantungan (*Dependency Graph*), termasuk penempatan `follow_up_tasks` setelah `payment_schedules` dan `kpr_applications`.
3. Menjelaskan alasan teknis di balik pemilihan tipe data, aturan `ON DELETE RESTRICT`, *Composite Foreign Key*, *Partial Unique Index*, pemisahan transaksi properti vs pemantauan pengajuan KPR (termasuk pemisahan tahap proses vs status pengajuan dan pembedaan kondisi akhir KPR), serta skoring berbasis aturan bisnis (tanpa *Machine Learning*).
4. Menyediakan perintah verifikasi SQL untuk membuktikan bahwa struktur database yang terbentuk di lokal 100% identik dengan spesifikasi.

---

## 2. Referensi dan Sumber Spesifikasi

Implementasi database dalam dokumen ini mengacu secara ketat pada gabungan spesifikasi berikut:
1. **`FIM-PROPERTY_MASTER_BUSINESS_DISCOVERY_v1.2_FINAL.md`:** Menetapkan aturan bisnis inti (`BR-01` s/d `BR-12`), keputusan `OQ-01` s/d `OQ-07`, keputusan `PD-01` s/d `PD-05`, pemisahan 4 dimensi penyelesaian transaksi (*Sales Outcome*, *Contract Status*, *Payment Settlement Status*, dan *Unit Inventory Status*), serta kamus metrik standar.
2. **`FIM-PROPERTY_PHASE_1A_SYSTEM_ARCHITECTURE_v1.2.md`:** Menetapkan batas transaksi atomik, pemisahan entitas `profiles`, `teams`, dan `team_memberships` untuk mencegah *circular dependency*, serta pemisahan *Audit Log* dari *Notification Outbox*.
3. **`FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0.md` & `v1.1.md`:**
   * Dokumen `v1.0` mendefinisikan arsitektur database, 6 ERD, kamus data (*Data Dictionary*) untuk 32 tabel, serta ENUM #1 s/d #13.
   * Dokumen `v1.1` melanjutkan ENUM #14 s/d #33, Bagian 5 s/d Bagian 12, serta menetapkan penguatan validasi skema (`CST-01` s/d `CST-12` dan konsistensi pemegang unit).
4. **`FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`:** Menetapkan kontrak ENUM TypeScript (`src/types/database.types.ts`), konfigurasi Supabase Local (`supabase/config.toml` yang menyembunyikan schema `app_security`), serta batasan proyek terbaru (*Single-Company CRM*, tanpa ML, dan pemantauan pengajuan KPR tanpa cicilan bulanan).

### 2.1 Rekonsiliasi Eksplisit antara Phase 1B `v1.0`, `v1.1`, dan Penyempurnaan Modul KPR `v1.2`
Dalam menyusun SQL pada dokumen ini, seluruh penyempurnaan validasi skema dari Phase 1B `v1.1` (`CST-01` s/d `CST-12`) serta pemutakhiran modul KPR pada versi `1.2` telah digabungkan langsung ke dalam definisi tabel sebagai spesifikasi final:

| No | Objek Database | Spesifikasi Sebelumnya (`v1.0` / `v1.1`) | Penyempurnaan Final yang Diterapkan di Dokumen `v1.2` Ini |
| :--- | :--- | :--- | :--- |
| **1** | `property_types` & `units` | FK tunggal `units.property_type_id` $\rightarrow$ `property_types(id)`. | Menambahkan `UNIQUE (id, project_id)` pada `property_types` dan menerapkan **Composite FK (`CST-04`)** pada `units(property_type_id, project_id)` agar tipe rumah dijamin berasal dari proyek yang sama dengan unit. |
| **2** | `promotions` | FK tunggal `promotions.property_type_id` $\rightarrow$ `property_types(id)`. | Menerapkan **Composite FK (`CST-04`)** `promotions(property_type_id, project_id) REFERENCES property_types(id, project_id) MATCH SIMPLE` agar jika tipe properti diisi, dijamin milik proyek yang sama. |
| **3** | `payment_schedules` & `payment_records` | FK tunggal `payment_records.payment_schedule_id` $\rightarrow$ `payment_schedules(id)`. | Menambahkan `UNIQUE (id, booking_id)` pada `payment_schedules` dan menerapkan **Composite FK (`CST-05`)** pada `payment_records(payment_schedule_id, booking_id)` agar pembayaran tidak mungkin salah merujuk ke jadwal milik Booking lain. |
| **4** | `bookings` & `deals` | FK tunggal `deals.booking_id` $\rightarrow$ `bookings(id)`. | Menambahkan `UNIQUE (id, lead_id, unit_id)` pada `bookings` dan menerapkan **Composite FK (`CST-06`)** pada `deals(booking_id, lead_id, unit_id)` agar ketiganya selalu identik antara Booking dan Deal. |
| **5** | `notifications` | `UNIQUE (deduplication_key)` pada satu kolom. | Diperbaiki menjadi **Composite Unique Constraint (`CST-12`)**: `UNIQUE (recipient_user_id, deduplication_key)` agar satu peristiwa *broadcast* (seperti Promo Baru) dapat diterima oleh banyak Sales berbeda, namun tetap dijamin maksimal 1 notifikasi per penerima. |
| **6** | `units` | Check constraint pemegang reservasi unit (`OQ-05`). | Menambahkan `chk_units_holder_consistency` agar `current_holder_sales_id` dan `current_holder_team_id` wajib bernilai `NULL` saat `status = 'AVAILABLE'`, dan wajib `NOT NULL` saat `status IN ('HELD', 'BOOKED', 'SOLD')`. |
| **7** | `team_memberships`, `bookings`, `leads`, `payment_schedules`, `kpr_applications`, `kpr_disbursements` | Aturan keunikan parsial dan rekonsiliasi angka. | Menegakkan `CST-01` & `CST-02` (`team_memberships`), `CST-03` (anti-*double-booking* pada `bookings`), `CST-07` (skor & temperatur pada `leads`), `CST-08` (matematika harga `bookings`), `CST-09` (rekonsiliasi `payment_schedules`), `CST-10` (rekonsiliasi ketat plafon KPR terhadap realisasi pencairan & `disbursement_status` pada `kpr_applications`), dan `CST-11` (maksimal 1 pencairan `PRIMARY` pada `kpr_disbursements`). |
| **8** | `kpr_stage_enum` & `kpr_applications` | `current_stage` mencampur tahap proses dan status keputusan (`REJECTED`); belum ada `application_status`, `cancelled_at`, atau `cancellation_reason`. | Memisahkan tahap proses (`current_stage`: 10 tahap murni dari `DOCUMENT_COLLECTION` s/d `DISBURSEMENT`, menghapus `'REJECTED'` dari `kpr_stage_enum`) dari status pengajuan (`application_status`: `kpr_application_status_enum` dengan 6 status, ditambah `cancelled_at`, `cancellation_reason`, dan `chk_kpr_applications_status_consistency`). |
| **9** | `follow_up_tasks` | Hanya memiliki `related_schedule_id` ke `payment_schedules(id)` dan ditempatkan sebelum `kpr_applications`. | Menambahkan kolom nullable `related_kpr_application_id UUID NULL` dengan FK `fk_follow_up_tasks_kpr_application` menuju `kpr_applications(id)`, memindahkan posisi pembuatan tabel setelah `kpr_applications` di Migrasi 5, serta menambahkan partial index `idx_followup_kpr_app_status`. |

### 2.2 Keputusan Bisnis Final `TC-01` (Perlakuan Status Unit `SOLD` pada KPR Pencairan Bertahap)
* **Keputusan Ditetapkan — `TC-01A` (Unit Berubah Menjadi `SOLD` Saat Pencairan Mencapai 100% / `FULLY_DISBURSED`):**
  Keputusan bisnis `TC-01` **tidak lagi berstatus tertunda**. Seluruh alur transaksi KPR pada sistem **FIM-Property** menggunakan kebijakan final **`TC-01A`** dengan ketentuan berikut:
  * Jika pencairan masih **`NOT_DISBURSED`**: unit **belum** berstatus `'SOLD'` (tetap `'BOOKED'`).
  * Jika pencairan masih **`PARTIALLY_DISBURSED`**: unit **belum** berstatus `'SOLD'` (tetap `'BOOKED'`).
  * Jika pencairan telah mencapai **`FULLY_DISBURSED`** (100%): unit berubah menjadi **`'SOLD'`**, sejalan dengan `kpr_applications.application_status` yang berubah menjadi `'COMPLETED'`.
* **Konsistensi dengan `KPR_SOLD_POLICY_MODE` pada File 01 & Dampak Skema:**
  * Kebijakan **`TC-01A`** ini selaras dengan nilai `KPR_SOLD_POLICY_MODE="TC-01A"` pada File 01 (`FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`) dan menjadi acuan tunggal untuk logika transisi pada fungsi RPC `TX-08` (File 04).
  * **Tidak ada perubahan struktur tabel, kolom, ENUM, maupun constraint** pada dokumen migrasi ini karena skema `units`, `kpr_applications`, `kpr_disbursements`, dan `deals` sudah mendukung penuh kebijakan `TC-01A`.

### 2.3 Catatan Konsistensi dan Dampak Perubahan ke Dokumen Lain (Untuk Revisi Berikutnya)
Revisi `v1.2`–`v1.3` ini memperkenalkan perubahan skema terarah pada modul KPR (`related_kpr_application_id` di `follow_up_tasks`, serta `kpr_application_status_enum`, `application_status`, `cancelled_at`, `cancellation_reason`, dan pemurnian `kpr_stage_enum` di `kpr_applications`) serta menetapkan keputusan final **`TC-01A`**. **File 01 `v1.1` serta File 03–06 `v1.0` tidak diubah pada tahap ini**, namun seluruh dampaknya dicatat di bawah ini agar diselaraskan pada revisi masing-masing dokumen:

1. **Dampak terhadap File 01 (`FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`):**
   * File `src/types/database.types.ts` perlu diselaraskan pada revisi berikutnya agar mencerminkan **34 ENUM** (menghapus `'REJECTED'` dari `KprStage` serta menambahkan `KprApplicationStatus`).
   * Nilai `KPR_SOLD_POLICY_MODE="TC-01A"` sudah sesuai dengan keputusan final `TC-01A`; keterangan yang masih menandai `TC-01` sebagai keputusan tertunda atau mencantumkan opsi alternatif lain perlu diselaraskan pada revisi File 01 berikutnya.
   * Tipe tabel di `src/types/supabase-generated.types.ts` otomatis mengikuti skema terbaru setelah menjalankan `npm run db:types`.
2. **Dampak terhadap File 03 (`FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS`):**
   * Kebijakan RLS `pol_follow_up_tasks_insert` dan `pol_follow_up_tasks_update` perlu menambahkan pemeriksaan bahwa apabila `related_kpr_application_id IS NOT NULL`, pengguna harus memiliki akses ke aplikasi KPR tersebut (`app_security.can_access_kpr_application(related_kpr_application_id)`) **dan** aplikasi KPR tersebut harus berasal dari `booking` milik `lead_id` yang sama (`EXISTS (SELECT 1 FROM public.kpr_applications k JOIN public.bookings b ON b.id = k.booking_id WHERE k.id = related_kpr_application_id AND b.lead_id = lead_id)`).
   * Kebijakan *read-only* bagi Sales/Supervisor dan kontrol tulis Admin pada `kpr_applications` tetap berlaku; tidak memerlukan tabel/kebijakan RLS baru.
3. **Dampak terhadap File 04 (`FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC`):**
   * **`TX-04` (`rpc_record_kpr_approval`):** Parameter `p_decision` tidak lagi bertipe `kpr_stage_enum` untuk `'REJECTED'`. Saat disetujui, set `current_stage = 'APPROVED'` dan `application_status = 'APPROVED'`. Saat ditolak bank, **pertahankan `current_stage`** pada tahap terakhirnya (mis. `'BANK_VERIFICATION'` / `'APPRAISAL'`), set `application_status = 'REJECTED_BY_BANK'`, isi `rejected_at` & `rejection_reason`, serta catat keputusan ke `audit_logs` (tidak memasukkan `'REJECTED'` ke `kpr_stage_histories`).
   * **`TX-06` (`rpc_cancel_booking_or_deal`):** Saat perusahaan membatalkan Booking, perbarui `kpr_applications` terkait yang masih berstatus `'IN_PROGRESS'` atau `'APPROVED'` menjadi `application_status = 'BOOKING_CANCELLED'`, isi `cancelled_at` & `cancellation_reason`, serta batalkan `follow_up_tasks` aktif (`PENDING`/`OVERDUE`) yang merujuk pada `related_kpr_application_id` tersebut. Jika `application_status` sudah `'REJECTED_BY_BANK'` atau `'CANCELLED_BY_CUSTOMER'`, **jangan ditimpa** agar riwayat penyebab asli tetap terjaga.
   * **`TX-08` (`rpc_record_kpr_disbursement`):** Saat pencairan mencapai 100% (`v_new_disb_status = 'FULLY_DISBURSED'`), ubah `application_status = 'COMPLETED'` dan ubah status unit menjadi `'SOLD'` sesuai keputusan final **`TC-01A`**. Selama masih `'NOT_DISBURSED'` atau baru cair sebagian (`'PARTIALLY_DISBURSED'`), pertahankan `application_status = 'APPROVED'` dan unit **belum** berstatus `'SOLD'` (tetap `'BOOKED'`).
   * **Pembatalan KPR oleh Konsumen:** Perlu disiapkan alur transaksi atomik khusus (misal `rpc_cancel_kpr_by_customer`) pada File 04 untuk mengubah `application_status = 'CANCELLED_BY_CUSTOMER'`, mengisi `cancelled_at` & `cancellation_reason`, membatalkan `follow_up_tasks` dengan `related_kpr_application_id` terkait, mencatat `audit_logs`, dan menangani implikasinya terhadap Booking/Deal (misal jika konsumen ingin beralih cara bayar atau mengajukan pembatalan Booking terpisah lewat `TX-06`).
   * **Skrip Uji Integrasi File 04 (Bagian 10.3):** Perlu diperbarui agar ikut memverifikasi `application_status` pada `TX-04`, `TX-06`, dan `TX-08`.
4. **Dampak terhadap File 06 (`FIM-PROPERTY_IMPLEMENTATION_06_APPLICATION_BACKEND`):**
   * `createFollowUpTaskSchema` dan `ActivitiesAndFollowUpService.createFollowUpTask` perlu menerima field opsional `relatedKprApplicationId` dan memvalidasi bahwa aplikasi KPR tersebut terhubung ke `leadId` yang sama melalui `bookings`.
   * `TransactionsService` (tahap KPR, `advanceKprStage`, pembatalan KPR konsumen, serta query list/detail tugas KPR) perlu membaca/memfilter `application_status` dan mendukung penautan `related_kpr_application_id`.
   * `ExecutiveMetricsService` perlu memfilter `kpr_applications` menggunakan `application_status IN ('APPROVED', 'COMPLETED')` agar pengajuan yang dibatalkan tidak masuk ke ringkasan pencairan aktif.
5. **Istilah `INSTALLMENT`, `INSTALLMENT_DUE`, `PAYMENT_OVERDUE`, dan `OVERDUE_IN_ARREARS`:**
   * Tetap dipertahankan khusus untuk mekanisme penagihan transaksi properti kepada PT FIM-Property/Developer (termin *Cash Bertahap*, Booking Fee, DP, Pelunasan *Cash Keras*, dan `KPR_TOPUP_DP`), dan **tidak satu pun darinya digunakan untuk cicilan KPR bulanan konsumen ke bank**.

---

## 3. Konteks Database FIM-Property

Dalam memahami relasi antartabel dan batasan bisnis pada database ini, pegang teguh lima prinsip konteks berikut:
1. **Single-Company Internal CRM (Bukan Multi-Tenant):** Database ini khusus melayani satu perusahaan, yaitu **PT FIM-Property**. Oleh sebab itu, **tidak ada** tabel `tenants`, `organizations`, maupun kolom `tenant_id` / `organization_id` pada tabel-tabel master maupun transaksi.
2. **`developers` dan `property_projects` Adalah Katalog Produk:** Perusahaan memasarkan properti dari berbagai Developer dan Proyek Perumahan. Di dalam database, `developers` dan `property_projects` adalah induk dari katalog inventaris produk (`property_types` dan `units`), **bukan** entitas *tenant* pengguna aplikasi CRM.
3. **Hierarki Organisasi Penjualan:** Pengguna aplikasi dibagi menjadi 3 role sistem (`ADMIN`, `SUPERVISOR`, `SALES`) pada tabel `profiles`. Pengelompokan ke dalam Tim Sales dikelola melalui tabel `teams` dan `team_memberships`. Isolasi visibilitas data pada tabel `leads`, `bookings`, `kpr_applications`, dan `deals` mengacu pada kolom kepemilikan Sales (`assigned_sales_id` / `current_sales_id`) dan Tim (`team_id`).
4. **Skoring Prospek Berbasis Aturan Bisnis (Tanpa Machine Learning):** Sistem **tidak** memiliki integrasi *Machine Learning*, **tidak** menyimpan tabel hasil prediksi ML, dan **tidak** memiliki fitur prediksi kelayakan KPR maupun prediksi pembelian berbasis ML. Kolom `prospect_score`, `lead_temperature`, dan `score_breakdown` pada tabel `leads` serta histori perubahannya di `lead_score_histories` dihitung secara deterministik berdasarkan aturan bisnis 4 indikator (`OQ-04`) di *Application Backend Layer* (File 06).
5. **Cakupan Pemantauan Pengajuan KPR & Pemisahannya dari Pembayaran Transaksi Properti:**
   * **Dalam Cakupan (In-Scope):** Modul KPR (`kpr_bank_requirements`, `kpr_applications`, `kpr_documents`, `kpr_stage_histories`, `kpr_disbursements`) — beserta keterkaitan langsung ke `follow_up_tasks.related_kpr_application_id` — memantau progres pengajuan KPR konsumen secara detail mulai dari persiapan & verifikasi berkas dokumen persyaratan (`DOCUMENT_COLLECTION`, `DOCUMENT_VERIFICATION`), pengajuan ke bank (`SUBMITTED`), proses bank & appraisal (`BANK_VERIFICATION`, `APPRAISAL`, `ADDITIONAL_REQUIREMENTS`), penerbitan persetujuan SP3K (`APPROVED`), penjadwalan & pelaksanaan akad (`AKAD_SCHEDULED`, `AKAD_COMPLETED`), hingga realisasi pencairan dana kredit dari bank ke perusahaan/developer (`DISBURSEMENT` — `PRIMARY` & `SUBSEQUENT`). Kondisi pengajuan dibedakan secara tegas lewat `application_status` (`IN_PROGRESS`, `APPROVED`, `REJECTED_BY_BANK`, `CANCELLED_BY_CUSTOMER`, `BOOKING_CANCELLED`, `COMPLETED`).
   * **Di Luar Cakupan (Out-of-Scope):** Sistem **tidak** menyimpan dan **tidak** memantau pembayaran cicilan KPR bulanan konsumen kepada bank pasca-akad/pencairan, status pembayaran cicilan ke bank, tunggakan cicilan bank, maupun riwayat keterlambatan cicilan bank.
   * **Pemisahan Tegas dengan Pembayaran Transaksi Properti CRM:** Tabel `payment_schedules`, `payment_records`, dan `refund_transactions` tetap digunakan penuh untuk memantau kewajiban pembayaran transaksi pembelian properti kepada perusahaan/developer (`BOOKING_FEE`, `DOWN_PAYMENT`, termin `INSTALLMENT` khusus untuk metode `CASH_BERTAHAP`, `FINAL_SETTLEMENT` khusus `CASH_KERAS`, serta `KPR_TOPUP_DP` apabila terjadi turun plafon KPR).

---

## 4. Ruang Lingkup dan Batasan

### 4.1 Termasuk dalam Ruang Lingkup Dokumen Ini (In-Scope)
* Penyiapan folder `supabase/migrations/` dan strategi urutan 6 file migrasi awal.
* Implementasi ekstensi PostgreSQL (`pgcrypto`), inisialisasi schema `app_security`, dan fungsi trigger `public.trigger_set_updated_at()`.
* Implementasi lengkap **34 tipe ENUM** (33 ENUM dasar + `kpr_application_status_enum`).
* Implementasi lengkap **32 tabel database** (`BASE TABLE`) beserta tipe data, nilai `DEFAULT`, dan aturan `NULL` / `NOT NULL`.
* Implementasi seluruh *Primary Key*, *Foreign Key*, *Composite Foreign Key*, *Unique Constraint*, *Partial Unique Index* (4 buah), dan *Check Constraint* (`CST-01` s/d `CST-12` + `chk_kpr_applications_status_consistency`).
* Implementasi seluruh **37 indeks performa (*Composite B-Tree* & *Partial Indexes*)** dan **17 trigger `updated_at`**.
* Panduan eksekusi, verifikasi skema, pembangkitan tipe TypeScript (`npm run db:types`), dan pemulihan migrasi lokal.

### 4.2 Di Luar Ruang Lingkup Dokumen Ini (Out-of-Scope — Dikerjakan di Dokumen Berikutnya)
* **Kebijakan Row Level Security (RLS), Fungsi `app_security`, Views Perlindungan Kolom, & Security Guard Triggers (File 03):**
  * 6 fungsi helper `SECURITY DEFINER` di schema `app_security`.
  * **Views Database (`public.v_staff_directory` dan `public.v_unit_catalog`)** — sengaja ditempatkan pada **File 03 (`20260301000700`)** dan **tidak diduplikasi di File 02** karena kedua view tersebut bergantung pada fungsi `app_security.get_staff_directory()` dan `app_security.get_current_user_role()`.
  * 4 trigger anti-*privilege escalation* (`trg_00_guard_*`), `GRANT`/`REVOKE`, serta kebijakan RLS untuk seluruh 32 tabel (termasuk penyesuaian RLS `follow_up_tasks` terhadap `related_kpr_application_id`).
* **Fungsi Transaksi Atomik PostgreSQL RPC & Generator Nomor Referensi (File 04):**
  * Fungsi transaksi atomik (`TX-01` s/d `TX-08` termasuk penyesuaian `application_status` pada `TX-04`, `TX-06`, `TX-08`, serta pembatalan KPR oleh konsumen), `app_security.next_reference_number()`, dan trigger `trg_01_assign_payment_reference_number` (`20260301000800`).
* **Konfigurasi Bucket & Kebijakan Supabase Private Storage (File 05):**
  * Pembuatan bucket privat `fim-private-documents` dan kebijakan RLS `storage.objects` (`20260301000900`).
* **Layanan Backend Aplikasi, Skoring Prospek Deterministik (Non-ML), & Data Seeding (File 06 & Tahap Seeding):**
  * Implementasi kalkulator skor prospek berbasis aturan bisnis (`OQ-04`), *Service Layer*, *Server Actions*, *Hybrid Reminder Engine*, dan pengisian data demonstrasi.

> **PERINGATAN KEAMANAN PENTING:**  
> Menyelesaikan pembuatan tabel dan constraint pada dokumen ini **belum** membuat database siap diakses langsung dari aplikasi klien/produksi, karena kebijakan **Row Level Security (RLS)** dan pencabutan hak akses `anon` baru akan diaktifkan pada **File 03**. Jangan memasukkan data rahasia atau membuka akses publik sebelum implementasi File 03 selesai.

---

## 5. Prasyarat Implementasi

Sebelum menjalankan langkah-langkah pada dokumen ini, pastikan Anda telah menyelesaikan seluruh tahapan pada **`FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`**:
1. **Docker Desktop** (atau Docker Engine) sudah menyala dan berjalan normal (`docker info` tidak menghasilkan error).
2. **Supabase CLI** telah terpasang sebagai `devDependency` proyek (`npx supabase --version` berfungsi).
3. File `supabase/config.toml` telah dikonfigurasi sesuai File 01 `v1.1` (khususnya `schemas = ["public", "storage", "graphql_public"]` tanpa mengekspos `app_security`, `enable_signup = false`, dan `file_size_limit = "5MiB"`).
4. Kontainer Supabase lokal sedang berjalan (`npm run db:start` telah dieksekusi dan `npm run db:status` menampilkan `API URL`, `DB URL`, dan `Studio URL`).

---

## 6. Persiapan Supabase CLI

Untuk memastikan lingkungan Supabase CLI siap menerima file migrasi baru, jalankan pemeriksaan berikut di terminal dari direktori root proyek (`fim-property/`):

```bash
# Periksa status kontainer database lokal
npm run db:status
```

* **Hasil yang diharapkan:** Terminal menampilkan alamat `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres` dan `Studio URL: http://127.0.0.1:54323`.
* Pastikan folder `supabase/migrations` belum berisi file migrasi percobaan yang bertabrakan agar tidak terjadi benturan nama objek:
  ```bash
  ls -la supabase/migrations
  ```

---

## 7. Struktur Folder Database

Di dalam proyek **FIM-Property**, seluruh definisi skema database disimpan sebagai kode (*Database-as-Code*) di dalam direktori `supabase/migrations/` dengan konvensi penamaan berbasis *timestamp* berurutan (`YYYYMMDDHHMMSS_<deskripsi_migrasi>.sql`):

```text
fim-property/
└── supabase/
    ├── config.toml                                                    # Konfigurasi Supabase Local (dari File 01 v1.1)
    └── migrations/
        ├── 20260301000100_extensions_and_enums.sql                    # Migrasi 1: Ekstensi, Schema app_security, Fungsi Trigger & 34 ENUM
        ├── 20260301000200_identity_and_supporting_tables.sql          # Migrasi 2: Tabel Domain A (Organisasi) & Domain E (Supporting)
        ├── 20260301000300_property_catalog_tables.sql                 # Migrasi 3: Tabel Domain B (Katalog Properti, Harga & Promo)
        ├── 20260301000400_crm_presales_tables.sql                     # Migrasi 4: Tabel Domain C (Leads, Histori, Aktivitas & Site Visit)
        ├── 20260301000500_transaction_finance_kpr_deal_tables.sql     # Migrasi 5: Tabel Domain D (Booking, Payment, KPR, Deal) + follow_up_tasks
        └── 20260301000600_indexes_and_triggers.sql                    # Migrasi 6: Seluruh 37 Performance Indexes & 17 Trigger updated_at
```

### Mengapa Konvensi Penamaan Ini Digunakan?
Supabase CLI mengeksekusi file di dalam `supabase/migrations/` secara **alfanumerik dari angka terkecil ke terbesar**. Penggunaan awalan `20260301000100` hingga `20260301000600` (dengan selisih 100 poin antar-file) menjamin urutan eksekusi selalu deterministik dan menyisakan ruang nomor bagi migrasi File 03 (`20260301000700`), File 04 (`20260301000800`), dan File 05 (`20260301000900`).

---

## 8. Inventaris Enum dan Tabel

Berikut adalah daftar inventarisasi lengkap dari dokumen **Phase 1B `v1.0` + `v1.1`** beserta penyempurnaan modul KPR **`v1.2`** yang menjadi tolok ukur kelengkapan:

### 8.1 Inventaris 34 Tipe ENUM
| No | Nama Tipe ENUM | Domain Penggunaan | Jumlah & Nilai / Keterangan |
| :---: | :--- | :--- | :--- |
| 1 | `system_role_enum` | `profiles` | 3 (`ADMIN`, `SUPERVISOR`, `SALES`) |
| 2 | `team_member_role_enum` | `team_memberships` | 2 (`TEAM_SUPERVISOR`, `TEAM_SALES`) |
| 3 | `project_status_enum` | `property_projects` | 4 (`PRE_LAUNCH`, `ACTIVE_SELLING`, `SOLD_OUT`, `CLOSED`) |
| 4 | `unit_status_enum` | `units` | 4 (`AVAILABLE`, `HELD`, `BOOKED`, `SOLD`) |
| 5 | `lead_temperature_enum` | `leads`, `lead_score_histories` | 3 (`COLD`, `WARM`, `HOT` — rule-based `OQ-04`) |
| 6 | `pipeline_stage_enum` | `leads`, `lead_pipeline_histories` | 9 (`NEW` s/d `CLOSED_LOST`) |
| 7 | `site_visit_status_enum` | `site_visits` | 4 (`SCHEDULED`, `COMPLETED`, `RESCHEDULED`, `CANCELLED`) |
| 8 | `booking_status_enum` | `bookings` | 5 (`PENDING_FEE`, `ACTIVE`, `EXPIRED`, `CANCELLED`, `COMPLETED`) |
| 9 | `schedule_status_enum` | `payment_schedules` | 5 (`UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED` — tagihan transaksi properti ke perusahaan) |
| 10 | `payment_verification_enum` | `payment_records` | 3 (`PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`) |
| 11 | `refund_status_enum` | `refund_transactions` | 3 (`PENDING_REFUND`, `COMPLETED`, `CANCELLED`) |
| 12 | `kpr_stage_enum` | `kpr_applications`, `kpr_stage_histories` | 10 (10 tahapan proses pengajuan KPR murni dari `DOCUMENT_COLLECTION` s/d `DISBURSEMENT`; tidak lagi mencampur status `'REJECTED'`) |
| 13 | `kpr_disbursement_status_enum` | `kpr_applications` | 3 (`NOT_DISBURSED`, `PARTIALLY_DISBURSED`, `FULLY_DISBURSED`) |
| 14 | `promo_type_enum` | `promotions` | 3 (`NOMINAL_DISCOUNT`, `PERCENTAGE_DISCOUNT`, `FREE_BENEFIT`) |
| 15 | `lead_source_enum` | `leads` | 8 (`INSTAGRAM_ADS` s/d `OTHER`) |
| 16 | `payment_method_enum` | `leads`, `bookings`, `deals` | 3 (`KPR`, `CASH_KERAS`, `CASH_BERTAHAP`) |
| 17 | `purchase_timeline_enum` | `leads` | 5 (`IMMEDIATE_LT_1M` s/d `UNSPECIFIED`) |
| 18 | `payment_readiness_enum` | `leads` | 4 (`READY_FULL_OR_DP_DOCS` s/d `UNDECIDED`) |
| 19 | `activity_channel_enum` | `lead_activities` | 5 (`WHATSAPP`, `PHONE_CALL`, `MEETING`, `VIDEO_CALL`, `EMAIL`) |
| 20 | `interaction_response_enum` | `lead_activities` | 3 (`RESPONSIVE_TWO_WAY`, `INITIAL_ONE_WAY`, `UNRESPONSIVE`) |
| 21 | `task_priority_enum` | `follow_up_tasks` | 3 (`LOW`, `MEDIUM`, `HIGH`) |
| 22 | `task_source_enum` | `follow_up_tasks` | 3 (`MANUAL_SALES`, `SUPERVISOR_INSTRUCTION`, `PAYMENT_REMINDER_SYSTEM`) |
| 23 | `task_status_enum` | `follow_up_tasks` | 4 (`PENDING`, `COMPLETED`, `OVERDUE`, `CANCELLED`) |
| 24 | `site_visit_outcome_enum` | `site_visits` | 3 (`POSITIVE_INTEREST`, `NEUTRAL_CONSIDERATION`, `NOT_SUITABLE`) |
| 25 | `refund_policy_enum` | `bookings` | 4 (`NONE`, `FORFEITED_FULL`, `FULL_REFUND`, `PARTIAL_REFUND`) |
| 26 | `schedule_type_enum` | `payment_schedules` | 5 (`BOOKING_FEE`, `DOWN_PAYMENT`, `INSTALLMENT` *[khusus Cash Bertahap]*, `FINAL_SETTLEMENT`, `KPR_TOPUP_DP`) |
| 27 | `kpr_doc_status_enum` | `kpr_documents` | 4 (`MISSING`, `UPLOADED`, `VERIFIED`, `REVISION_REQUIRED`) |
| 28 | `disbursement_tranche_enum` | `kpr_disbursements` | 2 (`PRIMARY`, `SUBSEQUENT`) |
| 29 | `deal_sales_outcome_enum` | `deals` | 3 (`IN_PROGRESS`, `CLOSED_WON`, `CANCELLED_FAILED`) |
| 30 | `deal_contract_status_enum` | `deals` | 4 (`PRE_CONTRACT`, `UNDER_CONTRACT`, `CONTRACT_COMPLETED`, `CONTRACT_TERMINATED`) |
| 31 | `deal_settlement_status_enum` | `deals` | 6 (`BOOKING_FEE_SETTLED` s/d `TERMINATED`; `OVERDUE_IN_ARREARS` khusus tunggakan tagihan DP/Cash Bertahap CRM, bukan cicilan bank) |
| 32 | `outbox_status_enum` | `notification_outbox` | 4 (`PENDING`, `PROCESSED`, `FAILED_RETRYABLE`, `DEAD_LETTER`) |
| 33 | `notification_type_enum` | `notifications` | 14 (11 skenario wajib Fase 0 + eskalasi SLA + penugasan + hasil verifikasi; `INSTALLMENT_DUE` & `PAYMENT_OVERDUE` khusus tagihan properti CRM) |
| 34 | `kpr_application_status_enum` | `kpr_applications` | 6 (`IN_PROGRESS`, `APPROVED`, `REJECTED_BY_BANK`, `CANCELLED_BY_CUSTOMER`, `BOOKING_CANCELLED`, `COMPLETED`) |

### 8.2 Inventaris 32 Tabel Database & Atribut Audit/Timestamp-nya
| No | Nama Tabel | Domain | File Migrasi | Memiliki `updated_at` & Trigger? | Tabel Induk yang Dirujuk (Foreign Keys) |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `profiles` | A | Migrasi 2 | **Ya** | `auth.users(id)` |
| 2 | `teams` | A | Migrasi 2 | **Ya** | `profiles(id)` |
| 3 | `team_memberships` | A | Migrasi 2 | Tidak (Histori) | `teams(id)`, `profiles(id)` |
| 4 | `developers` | B | Migrasi 3 | **Ya** | `profiles(id)` |
| 5 | `property_projects` | B | Migrasi 3 | **Ya** | `developers(id)`, `profiles(id)` |
| 6 | `property_types` | B | Migrasi 3 | **Ya** | `property_projects(id)` |
| 7 | `units` | B | Migrasi 3 | **Ya** | `property_projects(id)`, `property_types(id, project_id)`, `profiles(id)`, `teams(id)` |
| 8 | `unit_price_histories` | B | Migrasi 3 | Tidak (`changed_at`) | `units(id)`, `profiles(id)` |
| 9 | `promotions` | B | Migrasi 3 | **Ya** | `property_projects(id)`, `property_types(id, project_id)`, `profiles(id)` |
| 10 | `leads` | C | Migrasi 4 | **Ya** | `profiles(id)`, `teams(id)`, `property_projects(id)`, `property_types(id, project_id)` |
| 11 | `lead_score_histories` | C | Migrasi 4 | Tidak (`calculated_at`) | `leads(id)` |
| 12 | `lead_pipeline_histories`| C | Migrasi 4 | Tidak (`changed_at`) | `leads(id)`, `profiles(id)` |
| 13 | `lead_assignment_histories`| C | Migrasi 4 | Tidak (`assigned_at`) | `leads(id)`, `profiles(id)`, `teams(id)` |
| 14 | `lead_activities` | C | Migrasi 4 | Tidak (`created_at`) | `leads(id)`, `profiles(id)` |
| 15 | `follow_up_tasks` | C | Migrasi 5 | **Ya** | `leads(id)`, `profiles(id)`, `payment_schedules(id)`, `kpr_applications(id)` |
| 16 | `site_visits` | C | Migrasi 4 | **Ya** | `leads(id)`, `profiles(id)`, `property_projects(id)`, `units(id)` |
| 17 | `bookings` | D | Migrasi 5 | **Ya** | `leads(id)`, `units(id)`, `profiles(id)`, `teams(id)`, `promotions(id)` |
| 18 | `booking_extensions` | D | Migrasi 5 | Tidak (`created_at`) | `bookings(id)`, `profiles(id)` |
| 19 | `payment_schedules` | D | Migrasi 5 | **Ya** | `bookings(id)` |
| 20 | `payment_records` | D | Migrasi 5 | Tidak (`created_at`) | `bookings(id)`, `payment_schedules(id, booking_id)`, `profiles(id)`, `payment_records(id)` |
| 21 | `refund_transactions` | D | Migrasi 5 | **Ya** | `bookings(id)`, `profiles(id)` |
| 22 | `kpr_bank_requirements` | D | Migrasi 5 | Tidak (`created_at`) | — (Master Tabel) |
| 23 | `kpr_applications` | D | Migrasi 5 | **Ya** | `bookings(id)`, `profiles(id)`, `teams(id)` |
| 24 | `kpr_documents` | D | Migrasi 5 | **Ya** | `kpr_applications(id)`, `kpr_bank_requirements(id)`, `profiles(id)` |
| 25 | `kpr_stage_histories` | D | Migrasi 5 | Tidak (`changed_at`) | `kpr_applications(id)`, `profiles(id)` |
| 26 | `kpr_disbursements` | D | Migrasi 5 | Tidak (`created_at`) | `kpr_applications(id)`, `profiles(id)` |
| 27 | `deals` | D | Migrasi 5 | **Ya** | `bookings(id, lead_id, unit_id)`, `profiles(id)`, `teams(id)` |
| 28 | `deal_status_histories` | D | Migrasi 5 | Tidak (`changed_at`) | `deals(id)`, `profiles(id)` |
| 29 | `reference_sequences` | E | Migrasi 2 | **Ya** | — (Master Sequence) |
| 30 | `notification_outbox` | E | Migrasi 2 | Tidak (`created_at`) | — (Antrean Sistem) |
| 31 | `notifications` | E | Migrasi 2 | Tidak (`created_at`) | `profiles(id)` |
| 32 | `audit_logs` | E | Migrasi 2 | Tidak (`created_at`) | `profiles(id)` |

---

## 9. Dependency dan Urutan Migration

Perhatikan mengapa urutan pembuatan tabel tidak boleh dilakukan secara acak:
1. **Ketergantungan ENUM:** Seluruh 34 ENUM harus ada sebelum tabel apa pun dibuat.
2. **Ketergantungan Organisasi (`profiles` & `teams`):** Hampir semua tabel di Domain B, C, D, dan E memiliki kolom `created_by`, `changed_by`, `assigned_sales_id`, atau `team_id` yang merujuk ke `profiles(id)` dan `teams(id)`. Oleh karena itu, `profiles`, `teams`, dan `team_memberships` **wajib dibuat pertama kali** setelah ENUM.
3. **Ketergantungan Katalog Properti (`developers` $\rightarrow$ `property_projects` $\rightarrow$ `property_types` $\rightarrow$ `units`):** Tabel `leads` merujuk ke `property_projects` dan `property_types`, sedangkan `site_visits` dan `bookings` merujuk ke `units`. Maka seluruh tabel Domain B wajib dibuat sebelum Domain C dan D.
4. **Ketergantungan Silang `follow_up_tasks` terhadap `payment_schedules` dan `kpr_applications`:**
   * Tabel `follow_up_tasks` adalah bagian dari Domain C (CRM), tetapi memiliki kolom opsional `related_schedule_id` yang merujuk ke `payment_schedules(id)` (untuk penagihan jadwal pembayaran) **serta** `related_kpr_application_id` yang merujuk ke `kpr_applications(id)` (untuk tindak lanjut dokumen tambahan, kontak bank, hasil appraisal, jadwal akad, dan pencairan dana KPR).
   * Tabel `payment_records`, `refund_transactions`, `kpr_bank_requirements`, dan `kpr_applications` tidak memiliki FK ke `follow_up_tasks`. Oleh sebab itu, pada **Migrasi 5**, `follow_up_tasks` ditempatkan tepat **setelah `kpr_applications`** (yang juga sudah melewati pembuatan `payment_schedules`) agar kedua Foreign Key tercipta dalam satu file migrasi tanpa *missing relation error*.

```text
[Migrasi 1: Extensions, Schema app_security, Trigger Function & 34 ENUMs]
        |
        v
[Migrasi 2: profiles -> teams -> team_memberships + reference_sequences, outbox, notifications, audit_logs]
        |
        v
[Migrasi 3: developers -> property_projects -> property_types -> units -> unit_price_histories -> promotions]
        |
        v
[Migrasi 4: leads -> lead_score_histories, lead_pipeline_histories, lead_assignment_histories, lead_activities, site_visits]
        |
        v
[Migrasi 5: bookings -> booking_extensions -> payment_schedules -> payment_records -> refund_transactions -> kpr_bank_requirements -> kpr_applications -> follow_up_tasks -> kpr_documents, kpr_stage_histories, kpr_disbursements -> deals -> deal_status_histories]
        |
        v
[Migrasi 6: 37 Performance Indexes & 17 Triggers updated_at]
```

---

## 10. Strategi Implementasi Migration

Untuk menjamin migrasi berjalan secara aman (*safe migration strategy*):
1. **Transaksional (`BEGIN; ... COMMIT;`):** Setiap file migrasi dibungkus di dalam blok transaksi eksplisit. Di PostgreSQL, pernyataan DDL (`CREATE TABLE`, `CREATE TYPE`, `CREATE INDEX`) bersifat transaksional. Jika terjadi kesalahan di tengah file migrasi, seluruh objek di dalam file tersebut otomatis di-*rollback* sehingga database tidak tertinggal dalam kondisi setengah jadi.
2. **Kebijakan `ON DELETE RESTRICT` & `ON UPDATE CASCADE`:**
   * Sesuai aturan bisnis **`BR-08`** dan **`BR-10`**, data staf, properti, Lead, dan transaksi di FIM-Property **dilarang hilang secara berantai (*no accidental cascade wipe*)**.
   * Oleh karena itu, seluruh Foreign Key menggunakan **`ON DELETE RESTRICT`** (mencegah penghapusan baris induk jika masih ada baris anak yang merujuknya) dan **`ON UPDATE CASCADE`**.

---

## 11. Implementasi SQL Migration

Berikut adalah isi kode SQL lengkap untuk keenam file migrasi. Buat masing-masing file di dalam folder `supabase/migrations/`.

---

### 11.1 Migrasi 1: Ekstensi, Fungsi Trigger & 34 ENUM
* **Nama File:** `supabase/migrations/20260301000100_extensions_and_enums.sql`
* **Tujuan:** Mengaktifkan ekstensi `pgcrypto`, menyiapkan schema `app_security` (sebagai wadah fungsi keamanan pada File 03 & File 04), membuat fungsi trigger pembaru `updated_at`, dan mendaftarkan ke-34 tipe ENUM.
* **Objek yang Dibuat:** Ekstensi `pgcrypto`, Schema `app_security`, Fungsi `public.trigger_set_updated_at()`, dan 34 tipe ENUM.
* **Dependency:** Tidak ada (File migrasi pertama).

```sql
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
```

* **Cara Memverifikasi Migrasi 1:**
  Jalankan `SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e';` di SQL Editor. Hasilnya harus bernilai **`34`**.

---

### 11.2 Migrasi 2: Tabel Domain A (Identity & Organization) & Domain E (Supporting)
* **Nama File:** `supabase/migrations/20260301000200_identity_and_supporting_tables.sql`
* **Tujuan:** Membuat tabel organisasi pengguna dan tim internal satu perusahaan (`profiles`, `teams`, `team_memberships`) beserta constraint `CST-01` dan `CST-02`, serta tabel infrastruktur pendukung (`reference_sequences`, `notification_outbox`, `notifications` beserta `CST-12`, dan `audit_logs`).
* **Objek yang Dibuat:** 7 Tabel (`profiles`, `teams`, `team_memberships`, `reference_sequences`, `notification_outbox`, `notifications`, `audit_logs`) + 2 Partial Unique Index (`CST-01`, `CST-02`) + 1 Composite Unique Constraint (`CST-12`).
* **Dependency:** Migrasi 1 (`20260301000100_extensions_and_enums.sql`) dan tabel internal `auth.users` milik Supabase.

```sql
-- ============================================================================
-- FILE: supabase/migrations/20260301000200_identity_and_supporting_tables.sql
-- TUJUAN: Pembuatan tabel Domain A (Identity & Organization) dan Domain E (Supporting)
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 (Tabel 1-3 & 29-32)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- [Tabel 01] profiles
-- Menyimpan profil staf internal satu perusahaan PT FIM-Property (1:1 dengan auth.users)
-- Catatan Keamanan: Kolom email dan phone bersifat sensitif dan dibatasi akses
-- bacanya melalui kebijakan RLS & View v_staff_directory pada File 03.
-- ----------------------------------------------------------------------------
CREATE TABLE public.profiles (
    id UUID NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    system_role public.system_role_enum NOT NULL DEFAULT 'SALES',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_profiles PRIMARY KEY (id),
    CONSTRAINT uq_profiles_email UNIQUE (email),
    CONSTRAINT fk_profiles_auth_user
        FOREIGN KEY (id) REFERENCES auth.users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_profiles_full_name CHECK (char_length(trim(full_name)) >= 2),
    CONSTRAINT chk_profiles_email CHECK (position('@' in email) > 1),
    CONSTRAINT chk_profiles_phone CHECK (char_length(trim(phone)) >= 8)
);

-- ----------------------------------------------------------------------------
-- [Tabel 02] teams
-- Menyimpan master data grup penjualan internal perusahaan (Tim Sales)
-- ----------------------------------------------------------------------------
CREATE TABLE public.teams (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_teams PRIMARY KEY (id),
    CONSTRAINT uq_teams_code UNIQUE (code),
    CONSTRAINT uq_teams_name UNIQUE (name),
    CONSTRAINT fk_teams_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_teams_code CHECK (char_length(trim(code)) >= 2),
    CONSTRAINT chk_teams_name CHECK (char_length(trim(name)) >= 2)
);

-- ----------------------------------------------------------------------------
-- [Tabel 03] team_memberships
-- Menyimpan keanggotaan aktif dan histori perpindahan tim untuk Supervisor & Sales
-- ----------------------------------------------------------------------------
CREATE TABLE public.team_memberships (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    profile_id UUID NOT NULL,
    membership_role public.team_member_role_enum NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ NULL,
    assigned_by UUID NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_team_memberships PRIMARY KEY (id),
    CONSTRAINT fk_team_memberships_team
        FOREIGN KEY (team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_team_memberships_profile
        FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_team_memberships_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_team_memberships_dates CHECK (
        (is_active = true AND left_at IS NULL)
        OR (is_active = false AND left_at IS NOT NULL AND left_at >= joined_at)
    )
);

-- CST-01: Satu tim maksimal memiliki tepat satu Supervisor aktif pada satu waktu
CREATE UNIQUE INDEX uq_one_active_supervisor_per_team
    ON public.team_memberships(team_id)
    WHERE is_active = true AND membership_role = 'TEAM_SUPERVISOR';

-- CST-02: Satu staf maksimal memiliki satu keanggotaan tim aktif pada satu waktu
CREATE UNIQUE INDEX uq_one_active_team_per_profile
    ON public.team_memberships(profile_id)
    WHERE is_active = true;

-- ----------------------------------------------------------------------------
-- [Tabel 29] reference_sequences
-- Menyimpan counter nomor urut bulanan untuk BK, PAY, KPR, DL, dan REF (OQ-07)
-- ----------------------------------------------------------------------------
CREATE TABLE public.reference_sequences (
    prefix VARCHAR(10) NOT NULL,
    year_month VARCHAR(6) NOT NULL,
    last_value INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_reference_sequences PRIMARY KEY (prefix, year_month),
    CONSTRAINT chk_reference_sequences_prefix CHECK (prefix IN ('BK', 'PAY', 'KPR', 'DL', 'REF')),
    CONSTRAINT chk_reference_sequences_ym CHECK (year_month ~ '^[0-9]{6}$'),
    CONSTRAINT chk_reference_sequences_val CHECK (last_value >= 0)
);

-- ----------------------------------------------------------------------------
-- [Tabel 30] notification_outbox
-- Antrean Transactional Outbox untuk pengiriman notifikasi yang fault-tolerant
-- ----------------------------------------------------------------------------
CREATE TABLE public.notification_outbox (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    event_type VARCHAR(60) NOT NULL,
    deduplication_key VARCHAR(150) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status public.outbox_status_enum NOT NULL DEFAULT 'PENDING',
    retry_count SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_notification_outbox PRIMARY KEY (id),
    CONSTRAINT uq_notification_outbox_dedup UNIQUE (deduplication_key),
    CONSTRAINT chk_notification_outbox_retry CHECK (retry_count >= 0 AND retry_count <= 5)
);

-- ----------------------------------------------------------------------------
-- [Tabel 31] notifications
-- Pusat notifikasi internal aplikasi (In-App Notification Center)
-- ----------------------------------------------------------------------------
CREATE TABLE public.notifications (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    recipient_user_id UUID NOT NULL,
    notification_type public.notification_type_enum NOT NULL,
    title VARCHAR(160) NOT NULL,
    description TEXT NOT NULL,
    reference_type VARCHAR(40) NOT NULL,
    reference_id UUID NOT NULL,
    deduplication_key VARCHAR(160) NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_notifications PRIMARY KEY (id),
    CONSTRAINT fk_notifications_recipient
        FOREIGN KEY (recipient_user_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- CST-12 (Refinement v1.1 #5): Mencegah notifikasi ganda per penerima
    CONSTRAINT uq_notifications_recipient_dedup UNIQUE (recipient_user_id, deduplication_key),
    CONSTRAINT chk_notifications_ref_type CHECK (
        reference_type IN ('LEAD', 'UNIT', 'BOOKING', 'PAYMENT', 'KPR', 'PROMO', 'DEAL', 'FOLLOW_UP', 'SITE_VISIT')
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 32] audit_logs
-- Rekam jejak audit sistem yang bersifat Append-Only (Modul U)
-- ----------------------------------------------------------------------------
CREATE TABLE public.audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    actor_user_id UUID NULL,
    actor_role VARCHAR(30) NOT NULL,
    action_type VARCHAR(60) NOT NULL,
    entity_table VARCHAR(60) NOT NULL,
    entity_id UUID NOT NULL,
    old_values JSONB NULL,
    new_values JSONB NULL,
    reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_audit_logs PRIMARY KEY (id),
    CONSTRAINT fk_audit_logs_actor
        FOREIGN KEY (actor_user_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMIT;
```

* **Cara Memverifikasi Migrasi 2:**
  Jalankan `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;` dan pastikan ke-7 tabel di atas telah muncul.

---

### 11.3 Migrasi 3: Tabel Domain B (Property Catalog, Pricing & Promotions)
* **Nama File:** `supabase/migrations/20260301000300_property_catalog_tables.sql`
* **Tujuan:** Membuat hierarki katalog properti 4 level (`developers` $\rightarrow$ `property_projects` $\rightarrow$ `property_types` $\rightarrow$ `units`), tabel riwayat perubahan harga (`unit_price_histories`), dan tabel program promo (`promotions`), lengkap dengan *Composite Foreign Key* `CST-04`. Data `developers` dan `property_projects` adalah **katalog produk** untuk satu perusahaan CRM (bukan akun tenant).
* **Objek yang Dibuat:** 6 Tabel (`developers`, `property_projects`, `property_types`, `units`, `unit_price_histories`, `promotions`) + Constraint `CST-04`.
* **Dependency:** Migrasi 2 (`profiles` dan `teams`).

```sql
-- ============================================================================
-- FILE: supabase/migrations/20260301000300_property_catalog_tables.sql
-- TUJUAN: Pembuatan tabel Domain B (Property Catalog, Price History & Promotions)
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 (Tabel 4-9)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- [Tabel 04] developers (Level 1 Hierarki Katalog Properti)
-- Catatan: Entitas mitra developer pada katalog produk, BUKAN tenant sistem CRM.
-- ----------------------------------------------------------------------------
CREATE TABLE public.developers (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(150) NOT NULL,
    address TEXT NOT NULL,
    pic_name VARCHAR(120) NOT NULL,
    pic_phone VARCHAR(30) NOT NULL,
    pic_email VARCHAR(150) NULL,
    policy_notes TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_developers PRIMARY KEY (id),
    CONSTRAINT uq_developers_code UNIQUE (code),
    CONSTRAINT uq_developers_name UNIQUE (name),
    CONSTRAINT fk_developers_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_developers_code CHECK (char_length(trim(code)) >= 2),
    CONSTRAINT chk_developers_name CHECK (char_length(trim(name)) >= 2)
);

-- ----------------------------------------------------------------------------
-- [Tabel 05] property_projects (Level 2 Hierarki Katalog Properti)
-- ----------------------------------------------------------------------------
CREATE TABLE public.property_projects (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    developer_id UUID NOT NULL,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    province VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    facilities TEXT NULL,
    status public.project_status_enum NOT NULL DEFAULT 'ACTIVE_SELLING',
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_property_projects PRIMARY KEY (id),
    CONSTRAINT uq_property_projects_code UNIQUE (code),
    CONSTRAINT uq_property_projects_dev_name UNIQUE (developer_id, name),
    CONSTRAINT fk_property_projects_developer
        FOREIGN KEY (developer_id) REFERENCES public.developers(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_property_projects_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- [Tabel 06] property_types (Level 3 Hierarki Katalog Properti)
-- ----------------------------------------------------------------------------
CREATE TABLE public.property_types (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(120) NOT NULL,
    standard_land_area NUMERIC(8,2) NOT NULL,
    standard_building_area NUMERIC(8,2) NOT NULL,
    bedrooms SMALLINT NOT NULL DEFAULT 2,
    bathrooms SMALLINT NOT NULL DEFAULT 1,
    electricity_watt INTEGER NOT NULL DEFAULT 1300,
    specifications TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_property_types PRIMARY KEY (id),
    CONSTRAINT uq_property_types_project_code UNIQUE (project_id, code),
    -- Constraint unik komposit untuk mendukung CST-04 (Refinement v1.1 #1 & #2)
    CONSTRAINT uq_property_types_id_project UNIQUE (id, project_id),
    CONSTRAINT fk_property_types_project
        FOREIGN KEY (project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_property_types_areas CHECK (
        standard_land_area > 0 AND standard_building_area > 0
    ),
    CONSTRAINT chk_property_types_rooms CHECK (
        bedrooms >= 0 AND bathrooms >= 0 AND electricity_watt > 0
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 07] units (Level 4 Hierarki Katalog Properti)
-- ----------------------------------------------------------------------------
CREATE TABLE public.units (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    property_type_id UUID NOT NULL,
    unit_code VARCHAR(30) NOT NULL,
    block_number VARCHAR(20) NOT NULL,
    land_area NUMERIC(8,2) NOT NULL,
    building_area NUMERIC(8,2) NOT NULL,
    catalog_price NUMERIC(15,2) NOT NULL,
    orientation VARCHAR(50) NULL,
    is_hook BOOLEAN NOT NULL DEFAULT false,
    status public.unit_status_enum NOT NULL DEFAULT 'AVAILABLE',
    current_holder_sales_id UUID NULL,
    current_holder_team_id UUID NULL,
    status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_units PRIMARY KEY (id),
    CONSTRAINT uq_units_project_unit_code UNIQUE (project_id, unit_code),
    CONSTRAINT fk_units_project
        FOREIGN KEY (project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- CST-04 (Refinement v1.1 #1): Menjamin property_type_id berasal dari project_id yang sama
    CONSTRAINT fk_units_property_type_project
        FOREIGN KEY (property_type_id, project_id)
        REFERENCES public.property_types(id, project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_units_holder_sales
        FOREIGN KEY (current_holder_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_units_holder_team
        FOREIGN KEY (current_holder_team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_units_dimensions_price CHECK (
        land_area > 0 AND building_area > 0 AND catalog_price > 0
    ),
    -- Refinement v1.1 #7: Konsistensi atribut pemegang reservasi unit (OQ-05)
    CONSTRAINT chk_units_holder_consistency CHECK (
        (status = 'AVAILABLE' AND current_holder_sales_id IS NULL AND current_holder_team_id IS NULL)
        OR (status IN ('HELD', 'BOOKED', 'SOLD') AND current_holder_sales_id IS NOT NULL AND current_holder_team_id IS NOT NULL)
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 08] unit_price_histories
-- Mencatat seluruh riwayat perubahan harga katalog unit secara permanen (BR-03)
-- ----------------------------------------------------------------------------
CREATE TABLE public.unit_price_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL,
    old_price NUMERIC(15,2) NOT NULL,
    new_price NUMERIC(15,2) NOT NULL,
    reason TEXT NOT NULL,
    changed_by UUID NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_unit_price_histories PRIMARY KEY (id),
    CONSTRAINT fk_unit_price_histories_unit
        FOREIGN KEY (unit_id) REFERENCES public.units(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_unit_price_histories_changed_by
        FOREIGN KEY (changed_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_unit_price_histories_values CHECK (
        old_price > 0 AND new_price > 0 AND old_price <> new_price
    ),
    CONSTRAINT chk_unit_price_histories_reason CHECK (
        char_length(trim(reason)) >= 10
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 09] promotions
-- Menyimpan program promosi penjualan pada proyek atau tipe properti tertentu
-- ----------------------------------------------------------------------------
CREATE TABLE public.promotions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    property_type_id UUID NULL,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    promo_type public.promo_type_enum NOT NULL,
    discount_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    bonus_description TEXT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_promotions PRIMARY KEY (id),
    CONSTRAINT uq_promotions_code UNIQUE (code),
    CONSTRAINT fk_promotions_project
        FOREIGN KEY (project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- CST-04 (Refinement v1.1 #2): Jika property_type_id diisi, wajib milik project_id yang sama
    CONSTRAINT fk_promotions_property_type_project
        FOREIGN KEY (property_type_id, project_id)
        REFERENCES public.property_types(id, project_id) MATCH SIMPLE
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_promotions_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_promotions_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_promotions_discount CHECK (
        (promo_type = 'PERCENTAGE_DISCOUNT' AND discount_value > 0 AND discount_value <= 100)
        OR (promo_type = 'NOMINAL_DISCOUNT' AND discount_value > 0)
        OR (promo_type = 'FREE_BENEFIT' AND discount_value = 0 AND bonus_description IS NOT NULL)
    )
);

COMMIT;
```

* **Cara Memverifikasi Migrasi 3:**
  Pastikan tabel `developers`, `property_projects`, `property_types`, `units`, `unit_price_histories`, dan `promotions` telah terbentuk dan memiliki constraint `fk_units_property_type_project` serta `fk_promotions_property_type_project`.

---

### 11.4 Migrasi 4: Tabel Domain C (CRM & Pre-Sales)
* **Nama File:** `supabase/migrations/20260301000400_crm_presales_tables.sql`
* **Tujuan:** Membuat tabel `leads` beserta constraint rentang skor berbasis aturan bisnis (`CST-07`), tabel riwayat (`lead_score_histories`, `lead_pipeline_histories`, `lead_assignment_histories`), tabel log komunikasi (`lead_activities`), dan tabel survei lokasi (`site_visits`).
* **Objek yang Dibuat:** 6 Tabel (`leads`, `lead_score_histories`, `lead_pipeline_histories`, `lead_assignment_histories`, `lead_activities`, `site_visits`) + Constraint `CST-07`.
* **Dependency:** Migrasi 2 (`profiles`, `teams`) dan Migrasi 3 (`property_projects`, `property_types`, `units`).

```sql
-- ============================================================================
-- FILE: supabase/migrations/20260301000400_crm_presales_tables.sql
-- TUJUAN: Pembuatan tabel Domain C (CRM & Pre-Sales, kecuali follow_up_tasks)
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 (Tabel 10-14, 16)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- [Tabel 10] leads
-- Pusat database calon pembeli beserta atribut kualifikasi, skor aturan bisnis
-- (OQ-04, non-ML), temperatur & pipeline
-- ----------------------------------------------------------------------------
CREATE TABLE public.leads (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(150) NULL,
    occupation VARCHAR(100) NULL,
    lead_source public.lead_source_enum NOT NULL,
    assigned_sales_id UUID NOT NULL,
    team_id UUID NOT NULL,
    budget_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    preferred_city VARCHAR(100) NULL,
    preferred_project_id UUID NULL,
    preferred_property_type_id UUID NULL,
    preferred_payment_method public.payment_method_enum NULL,
    purchase_timeline public.purchase_timeline_enum NOT NULL DEFAULT 'UNSPECIFIED',
    payment_readiness public.payment_readiness_enum NOT NULL DEFAULT 'UNDECIDED',
    prospect_score SMALLINT NOT NULL DEFAULT 0,
    lead_temperature public.lead_temperature_enum NOT NULL DEFAULT 'COLD',
    score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    pipeline_stage public.pipeline_stage_enum NOT NULL DEFAULT 'NEW',
    lost_reason VARCHAR(150) NULL,
    created_by UUID NOT NULL,
    last_interaction_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_leads PRIMARY KEY (id),
    CONSTRAINT uq_leads_phone UNIQUE (phone),
    CONSTRAINT fk_leads_assigned_sales
        FOREIGN KEY (assigned_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leads_team
        FOREIGN KEY (team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leads_preferred_project
        FOREIGN KEY (preferred_project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leads_preferred_type_project
        FOREIGN KEY (preferred_property_type_id, preferred_project_id)
        REFERENCES public.property_types(id, project_id) MATCH SIMPLE
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leads_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_leads_budget CHECK (budget_amount >= 0),
    -- CST-07: Membatasi skor pada 0-100 dan menjaga keselarasan kategori Cold/Warm/Hot (OQ-04)
    CONSTRAINT chk_leads_score_and_temperature CHECK (
        prospect_score BETWEEN 0 AND 100
        AND (
            (lead_temperature = 'COLD' AND prospect_score BETWEEN 0 AND 44)
            OR (lead_temperature = 'WARM' AND prospect_score BETWEEN 45 AND 74)
            OR (lead_temperature = 'HOT' AND prospect_score BETWEEN 75 AND 100)
        )
    ),
    CONSTRAINT chk_leads_closed_lost_reason CHECK (
        pipeline_stage <> 'CLOSED_LOST'
        OR (lost_reason IS NOT NULL AND char_length(trim(lost_reason)) >= 3)
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 11] lead_score_histories
-- Riwayat audit skor prospek berbasis aturan bisnis deterministik (OQ-04, bukan ML)
-- ----------------------------------------------------------------------------
CREATE TABLE public.lead_score_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    old_score SMALLINT NOT NULL,
    new_score SMALLINT NOT NULL,
    old_temperature public.lead_temperature_enum NOT NULL,
    new_temperature public.lead_temperature_enum NOT NULL,
    score_breakdown JSONB NOT NULL,
    trigger_source VARCHAR(50) NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_lead_score_histories PRIMARY KEY (id),
    CONSTRAINT fk_lead_score_histories_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_lead_score_histories_bounds CHECK (
        old_score BETWEEN 0 AND 100 AND new_score BETWEEN 0 AND 100
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 12] lead_pipeline_histories
-- ----------------------------------------------------------------------------
CREATE TABLE public.lead_pipeline_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    from_stage public.pipeline_stage_enum NULL,
    to_stage public.pipeline_stage_enum NOT NULL,
    notes TEXT NULL,
    lost_reason VARCHAR(150) NULL,
    changed_by UUID NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_lead_pipeline_histories PRIMARY KEY (id),
    CONSTRAINT fk_lead_pipeline_histories_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_pipeline_histories_changed_by
        FOREIGN KEY (changed_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- [Tabel 13] lead_assignment_histories
-- ----------------------------------------------------------------------------
CREATE TABLE public.lead_assignment_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    from_sales_id UUID NULL,
    to_sales_id UUID NOT NULL,
    from_team_id UUID NULL,
    to_team_id UUID NOT NULL,
    reason TEXT NOT NULL,
    assigned_by UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_lead_assignment_histories PRIMARY KEY (id),
    CONSTRAINT fk_lead_assignment_histories_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_from_sales
        FOREIGN KEY (from_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_to_sales
        FOREIGN KEY (to_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_from_team
        FOREIGN KEY (from_team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_to_team
        FOREIGN KEY (to_team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_lead_assignment_histories_reason CHECK (
        char_length(trim(reason)) >= 3
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 14] lead_activities
-- Catatan komunikasi historis yang tidak boleh dihapus saat Lead pindah Sales
-- ----------------------------------------------------------------------------
CREATE TABLE public.lead_activities (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    sales_id UUID NOT NULL,
    channel public.activity_channel_enum NOT NULL,
    interaction_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    summary TEXT NOT NULL,
    customer_response public.interaction_response_enum NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_lead_activities PRIMARY KEY (id),
    CONSTRAINT fk_lead_activities_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_activities_sales
        FOREIGN KEY (sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_lead_activities_summary CHECK (
        char_length(trim(summary)) >= 5
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 16] site_visits
-- ----------------------------------------------------------------------------
CREATE TABLE public.site_visits (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    sales_id UUID NOT NULL,
    project_id UUID NOT NULL,
    unit_id UUID NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    preparation_notes TEXT NULL,
    status public.site_visit_status_enum NOT NULL DEFAULT 'SCHEDULED',
    customer_interest_outcome public.site_visit_outcome_enum NULL,
    evaluation_notes TEXT NULL,
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_site_visits PRIMARY KEY (id),
    CONSTRAINT fk_site_visits_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_site_visits_sales
        FOREIGN KEY (sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_site_visits_project
        FOREIGN KEY (project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_site_visits_unit
        FOREIGN KEY (unit_id) REFERENCES public.units(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_site_visits_completion CHECK (
        status <> 'COMPLETED'
        OR (
            customer_interest_outcome IS NOT NULL
            AND evaluation_notes IS NOT NULL
            AND completed_at IS NOT NULL
        )
    )
);

COMMIT;
```

* **Cara Memverifikasi Migrasi 4:**
  Pastikan tabel `leads` beserta ke-5 tabel anak CRM di atas telah terbentuk di schema `public`.

---

### 11.5 Migrasi 5: Tabel Domain D (Transaction, Finance, KPR & Deal) + `follow_up_tasks`
* **Nama File:** `supabase/migrations/20260301000500_transaction_finance_kpr_deal_tables.sql`
* **Tujuan:** Membuat seluruh 12 tabel Domain D (`bookings`, `booking_extensions`, `payment_schedules`, `payment_records`, `refund_transactions`, `kpr_bank_requirements`, `kpr_applications`, `kpr_documents`, `kpr_stage_histories`, `kpr_disbursements`, `deals`, `deal_status_histories`) serta tabel `follow_up_tasks` (Tabel #15, ditempatkan tepat setelah `kpr_applications`), lengkap dengan constraint `CST-03`, `CST-05`, `CST-06`, `CST-08`, `CST-09`, `CST-10`, `CST-11`, serta `chk_kpr_applications_status_consistency`.
* **Objek yang Dibuat:** 13 Tabel + 2 Partial Unique Index (`CST-03`, `CST-11`) + 2 Composite FK (`CST-05`, `CST-06`) + Check Constraints rekonsiliasi keuangan, plafon KPR, dan konsistensi status pengajuan KPR.
* **Dependency:** Migrasi 2, 3, dan 4.

```sql
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
```

* **Cara Memverifikasi Migrasi 5:**
  Pastikan total tabel bertipe `BASE TABLE` di schema `public` kini tepat berjumlah **32 tabel**, dan `follow_up_tasks` memiliki `fk_follow_up_tasks_kpr_application`.

---

### 11.6 Migrasi 6: Seluruh Performance Indexes & Trigger `updated_at`
* **Nama File:** `supabase/migrations/20260301000600_indexes_and_triggers.sql`
* **Tujuan:** Membuat seluruh **37 indeks performa** (*Composite B-Tree* & *Partial Indexes*) sesuai strategi **Phase 1B Bagian 5.2** + kebutuhan pencarian tugas tindak lanjut KPR, serta memasang **17 trigger `updated_at`** pada seluruh tabel yang memiliki kolom `updated_at`.
* **Objek yang Dibuat:** 37 Index Performa + 17 Trigger `trg_*_updated_at`.
* **Dependency:** Migrasi 1 s/d Migrasi 5.

```sql
-- ============================================================================
-- FILE: supabase/migrations/20260301000600_indexes_and_triggers.sql
-- TUJUAN: Pembuatan seluruh Performance Indexes dan Trigger updated_at
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 + Revisi KPR v1.2
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PERFORMANCE INDEXES (37 INDEKS TERARAH DI DOMAIN A s/d E)
-- ============================================================================

-- Domain A: Identity & Organization (2 Indeks)
CREATE INDEX idx_profiles_system_role_active
    ON public.profiles(system_role, is_active);

CREATE INDEX idx_team_memberships_lookup
    ON public.team_memberships(profile_id, team_id, is_active);

-- Domain B: Property Catalog, Pricing & Promotions (6 Indeks)
CREATE INDEX idx_projects_developer_status
    ON public.property_projects(developer_id, status);

CREATE INDEX idx_projects_city
    ON public.property_projects(city);

CREATE INDEX idx_property_types_project
    ON public.property_types(project_id, is_active);

CREATE INDEX idx_units_catalog_lookup
    ON public.units(project_id, property_type_id, status, catalog_price);

CREATE INDEX idx_unit_price_histories_unit
    ON public.unit_price_histories(unit_id, changed_at DESC);

CREATE INDEX idx_promotions_project_dates
    ON public.promotions(project_id, is_active, start_date, end_date);

-- Domain C: CRM & Pre-Sales (12 Indeks)
CREATE INDEX idx_leads_sales_filter
    ON public.leads(assigned_sales_id, pipeline_stage, lead_temperature);

CREATE INDEX idx_leads_team_filter
    ON public.leads(team_id, pipeline_stage, lead_temperature);

CREATE INDEX idx_leads_preferred_project
    ON public.leads(preferred_project_id, pipeline_stage);

CREATE INDEX idx_leads_search_name_phone
    ON public.leads(full_name, phone);

CREATE INDEX idx_lead_score_histories_lead
    ON public.lead_score_histories(lead_id, calculated_at DESC);

CREATE INDEX idx_lead_pipeline_histories_lead
    ON public.lead_pipeline_histories(lead_id, changed_at DESC);

CREATE INDEX idx_lead_assignment_histories_lead
    ON public.lead_assignment_histories(lead_id, assigned_at DESC);

CREATE INDEX idx_lead_activities_lead_time
    ON public.lead_activities(lead_id, interaction_at DESC);

CREATE INDEX idx_followup_sales_status_due
    ON public.follow_up_tasks(assigned_sales_id, status, due_at);

CREATE INDEX idx_followup_kpr_app_status
    ON public.follow_up_tasks(related_kpr_application_id, status, due_at)
    WHERE related_kpr_application_id IS NOT NULL;

CREATE INDEX idx_site_visits_lead
    ON public.site_visits(lead_id, scheduled_at DESC);

CREATE INDEX idx_site_visits_sales_sched
    ON public.site_visits(sales_id, status, scheduled_at);

-- Domain D: Transaction, Finance, KPR & Deal (13 Indeks)
CREATE INDEX idx_bookings_pending_expiry
    ON public.bookings(expires_at)
    WHERE status = 'PENDING_FEE';

CREATE INDEX idx_bookings_team_sales
    ON public.bookings(team_id, current_sales_id, status);

CREATE INDEX idx_schedules_unpaid_due
    ON public.payment_schedules(due_date, status)
    WHERE status IN ('UNPAID', 'PARTIALLY_PAID', 'OVERDUE');

CREATE INDEX idx_payment_schedules_booking
    ON public.payment_schedules(booking_id, installment_number);

CREATE INDEX idx_payments_pending_sla
    ON public.payment_records(verification_sla_due_at, submitted_at)
    WHERE verification_status = 'PENDING_VERIFICATION';

CREATE INDEX idx_refund_transactions_booking
    ON public.refund_transactions(booking_id, status);

CREATE INDEX idx_kpr_team_stage
    ON public.kpr_applications(team_id, application_status, current_stage, disbursement_status);

CREATE INDEX idx_kpr_akad_sched
    ON public.kpr_applications(akad_scheduled_at)
    WHERE current_stage = 'AKAD_SCHEDULED' AND application_status = 'APPROVED';

CREATE INDEX idx_kpr_documents_app_status
    ON public.kpr_documents(kpr_application_id, status);

CREATE INDEX idx_kpr_stage_histories_app
    ON public.kpr_stage_histories(kpr_application_id, changed_at DESC);

CREATE INDEX idx_kpr_disbursements_app
    ON public.kpr_disbursements(kpr_application_id, sequence_number);

CREATE INDEX idx_deals_reporting
    ON public.deals(team_id, current_sales_id, sales_outcome_status, contract_status, payment_settlement_status, sales_closed_won_at);

CREATE INDEX idx_deal_status_histories_deal
    ON public.deal_status_histories(deal_id, changed_at DESC);

-- Domain E: Outbox, Notifications & Audit (4 Indeks)
CREATE INDEX idx_notification_outbox_pending
    ON public.notification_outbox(status, next_retry_at)
    WHERE status IN ('PENDING', 'FAILED_RETRYABLE');

CREATE INDEX idx_notifications_recipient_unread
    ON public.notifications(recipient_user_id, is_read, created_at DESC);

CREATE INDEX idx_audit_entity_time
    ON public.audit_logs(entity_table, entity_id, created_at DESC);

CREATE INDEX idx_audit_actor_time
    ON public.audit_logs(actor_user_id, action_type, created_at DESC);

-- ============================================================================
-- 2. TRIGGER OTOMATIS updated_at (17 TABEL YANG MEMILIKI KOLOM updated_at)
-- ============================================================================

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_teams_updated_at
    BEFORE UPDATE ON public.teams
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_reference_sequences_updated_at
    BEFORE UPDATE ON public.reference_sequences
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_developers_updated_at
    BEFORE UPDATE ON public.developers
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_property_projects_updated_at
    BEFORE UPDATE ON public.property_projects
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_property_types_updated_at
    BEFORE UPDATE ON public.property_types
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_units_updated_at
    BEFORE UPDATE ON public.units
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_promotions_updated_at
    BEFORE UPDATE ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_site_visits_updated_at
    BEFORE UPDATE ON public.site_visits
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_bookings_updated_at
    BEFORE UPDATE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_payment_schedules_updated_at
    BEFORE UPDATE ON public.payment_schedules
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_follow_up_tasks_updated_at
    BEFORE UPDATE ON public.follow_up_tasks
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_refund_transactions_updated_at
    BEFORE UPDATE ON public.refund_transactions
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_kpr_applications_updated_at
    BEFORE UPDATE ON public.kpr_applications
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_kpr_documents_updated_at
    BEFORE UPDATE ON public.kpr_documents
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_deals_updated_at
    BEFORE UPDATE ON public.deals
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

COMMIT;
```

---

## 12. Penjelasan Relasi dan Constraint

Penting untuk memahami **mengapa** skema di atas menggunakan mekanisme constraint tingkat lanjut di PostgreSQL:

1. **Mengapa Seluruh Foreign Key Menggunakan `ON DELETE RESTRICT` (Bukan `ON DELETE CASCADE`)?**
   * Jika kita memasang `ON DELETE CASCADE` pada `leads` atau `units`, maka ketika seseorang tidak sengaja menghapus 1 baris Lead atau Unit, PostgreSQL akan ikut menghapus seluruh riwayat pembayaran (`payment_records`), aplikasi KPR (`kpr_applications`), dan Deal (`deals`) secara diam-diam!
   * Dengan `ON DELETE RESTRICT`, PostgreSQL memblokir penghapusan induk jika sudah ada rekam jejak transaksi atau aktivitas di bawahnya (`BR-08` & `BR-10`).
2. **Cara Kerja *Composite Foreign Key* (`CST-04`, `CST-05`, `CST-06`) & `MATCH SIMPLE`:**
   * Pada `units`, constraint `FOREIGN KEY (property_type_id, project_id) REFERENCES property_types(id, project_id)` memaksa database memeriksa bahwa pasangan `(property_type_id, project_id)` benar-benar ada di satu baris yang sama pada tabel `property_types`. Mustahil ada unit di Proyek Harmoni yang bertipe rumah milik Proyek Griya Asri.
   * Pada `promotions` dan `leads`, kolom `property_type_id` bersifat opsional (`NULL` jika berlaku untuk semua tipe di proyek tersebut). Dengan mode `MATCH SIMPLE` di PostgreSQL, ketika `property_type_id` bernilai `NULL`, constraint komposit mengizinkannya (sementara FK `project_id` tetap divalidasi); namun begitu `property_type_id` diisi, PostgreSQL langsung memeriksa kecocokan proyeknya!
3. **Cara Kerja *Partial Unique Index* (`CST-01`, `CST-02`, `CST-03`, `CST-11`):**
   * Sebuah unit rumah bisa memiliki beberapa baris di tabel `bookings` sepanjang sejarahnya (misal: bulan lalu pernah di-booking oleh Pembeli A namun `EXPIRED`, lalu bulan ini di-booking lagi oleh Pembeli B dengan status `ACTIVE`).
   * Jika kita memasang `UNIQUE (unit_id)` biasa, Pembeli B tidak akan pernah bisa mem-booking unit yang sudah lepas dari Pembeli A.
   * Dengan *Partial Unique Index* `WHERE status IN ('PENDING_FEE', 'ACTIVE')` (`CST-03`), indeks keunikan **hanya berlaku pada Booking yang sedang menguasai unit**, sehingga mencegah *double-booking* 100% sekaligus tetap mengizinkan penyimpanan histori Booking masa lalu yang sudah `EXPIRED` atau `CANCELLED`.
4. **Cara Kerja Pemisahan `current_stage`, `application_status`, & `disbursement_status` (`chk_kpr_applications_status_consistency`):**
   * `current_stage` (`kpr_stage_enum`) murni menunjukkan titik proses pengajuan (10 tahap dari `DOCUMENT_COLLECTION` hingga `DISBURSEMENT`), sehingga ketika pengajuan ditolak bank (`REJECTED_BY_BANK`) atau dibatalkan (`CANCELLED_BY_CUSTOMER` / `BOOKING_CANCELLED`), posisi tahap terakhir tetap terlihat tanpa tertimpa.
   * `application_status` (`kpr_application_status_enum`) menunjukkan kondisi hidup/keputusan akhir pengajuan secara tegas: `IN_PROGRESS` (pra-SP3K), `APPROVED` (SP3K terbit & proses akad/pencairan berjalan), `REJECTED_BY_BANK` (ditolak bank), `CANCELLED_BY_CUSTOMER` (dibatalkan konsumen), `BOOKING_CANCELLED` (booking dibatalkan perusahaan), dan `COMPLETED` (tuntas setelah pencairan 100%).
   * `disbursement_status` tetap khusus memantau realisasi dana pencairan (`NOT_DISBURSED`, `PARTIALLY_DISBURSED`, `FULLY_DISBURSED`) tanpa tumpang tindih dengan `application_status`.
5. **Cara Kerja Rekonsiliasi Ketat Realisasi Pencairan KPR (`chk_kpr_applications_loan_reconciliation` / `CST-10`):**
   * Bekerja saling melengkapi tanpa konflik dengan `chk_kpr_applications_status_consistency` untuk menjamin `disbursement_status` selalu akurat terhadap angka pencairan aktual:
     * **`NOT_DISBURSED`:** `primary_disbursed_amount` dan `subsequent_disbursed_amount` wajib `0` dan `fully_disbursed_at` wajib `NULL`. Jika `approved_loan_amount IS NULL` maka `remaining_undisbursed_amount = 0`; jika SP3K sudah terbit (`approved_loan_amount IS NOT NULL`), seluruh plafon wajib tercatat pada `remaining_undisbursed_amount`.
     * **`PARTIALLY_DISBURSED`:** total pencairan (`primary + subsequent`) wajib `> 0`, `remaining_undisbursed_amount` wajib `> 0`, jumlah keduanya wajib sama persis dengan `approved_loan_amount`, dan `fully_disbursed_at` tetap `NULL`. Pada tahap ini, sesuai keputusan final **`TC-01A`**, unit belum berstatus `'SOLD'`.
     * **`FULLY_DISBURSED`:** total pencairan wajib sama persis dengan `approved_loan_amount`, `remaining_undisbursed_amount` wajib `0`, `fully_disbursed_at` wajib terisi, dan `application_status` wajib `'COMPLETED'` (yang menjadi syarat perubahan status unit menjadi `'SOLD'` menurut `TC-01A`).

---

## 13. Implementasi Index dan Penempatan View Database

### 13.1 Strategi 37 Performance Indexes
Seluruh **37 indeks performa** pada Migrasi 6 (ditambah 4 *Partial Unique Index* di Migrasi 2 & 5 sehingga total 41 indeks kustom) dibagi menjadi dua strategi:
1. **Composite B-Tree Indexes:** Mengurutkan kolom dari selektivitas filter kesamaan (`=`) menuju pengurutan (`ORDER BY ... DESC`) atau rentang (`BETWEEN`). Contoh: `idx_kpr_team_stage (team_id, application_status, current_stage, disbursement_status)` langsung melayani halaman daftar & pemantauan progres KPR per tim tanpa *Sequential Scan*.
2. **Partial Indexes untuk Penyapuan Waktu & Lookup Terfokus:** Indeks `idx_bookings_pending_expiry`, `idx_schedules_unpaid_due`, `idx_payments_pending_sla`, `idx_kpr_akad_sched` (`WHERE current_stage = 'AKAD_SCHEDULED' AND application_status = 'APPROVED'`), `idx_notification_outbox_pending`, dan `idx_followup_kpr_app_status` (`WHERE related_kpr_application_id IS NOT NULL`) menggunakan klausa `WHERE` sehingga ukurannya tetap sangat ramping dan efisien.

### 13.2 Catatan Penempatan Views (`v_staff_directory` & `v_unit_catalog`)
Pada tahap Migrasi 1 s/d 6 (File 02), seluruh objek yang dibuat adalah **32 `BASE TABLE`** tanpa `VIEW`. Kedua *View* resmi sistem — yaitu **`public.v_staff_directory`** dan **`public.v_unit_catalog`** (`OQ-05`) — **sengaja ditempatkan pada Migrasi 7 (File 03: `20260301000700_auth_security_grants_and_rls.sql`)** karena keduanya bergantung pada fungsi otorisasi `app_security.get_staff_directory()` dan `app_security.get_current_user_role()` yang baru dibuat di File 03.

---

## 14. Implementasi Trigger Database

Pada tahap skema dasar ini (Migrasi 6), hanya trigger **`trigger_set_updated_at()`** yang dipasang pada ke-17 tabel yang memiliki kolom `updated_at`.
* **Alasan Teknis:** Lima belas tabel lainnya (seperti `unit_price_histories`, `lead_activities`, `payment_records`, `kpr_stage_histories`, `kpr_disbursements`, dan `audit_logs`) adalah **tabel catatan peristiwa historis (*Append-Only Event/History Tables*) atau master statis** yang menurut spesifikasi Phase 1B memang tidak memiliki kolom `updated_at` karena barisnya tidak boleh diedit setelah dibuat.
* Fungsi trigger menggunakan `SET search_path = ''` dan `clock_timestamp()` untuk keamanan dan ketepatan waktu perubahan di dalam transaksi.
* **Trigger Lanjutan di Dokumen Berikutnya:**
  * 4 *Security Guard Triggers* (`trg_00_guard_profiles_update`, `trg_00_guard_leads_update`, `trg_00_guard_kpr_documents_update`, `trg_00_guard_notifications_update`) diimplementasikan pada **File 03 (`20260301000700`)**.
  * 1 trigger pembangkit nomor referensi pembayaran (`trg_01_assign_payment_reference_number`) pada `payment_records` diimplementasikan pada **File 04 (`20260301000800`)**.

---

## 15. Menjalankan Migration

Setelah keenam file migrasi disimpan di dalam folder `supabase/migrations/`, jalankan prosedur berikut dari direktori root proyek (`fim-property/`):

```bash
# Terapkan seluruh file migrasi dari awal pada database lokal Supabase
npm run db:reset
```

### Hasil yang Seharusnya Terlihat di Terminal
Supabase CLI akan menghancurkan kontainer database lama (jika ada), membuat ulang database bersih, lalu mengeksekusi keenam file migrasi secara berurutan:
```text
Resetting local database...
Applying migration 20260301000100_extensions_and_enums.sql...
Applying migration 20260301000200_identity_and_supporting_tables.sql...
Applying migration 20260301000300_property_catalog_tables.sql...
Applying migration 20260301000400_crm_presales_tables.sql...
Applying migration 20260301000500_transaction_finance_kpr_deal_tables.sql...
Applying migration 20260301000600_indexes_and_triggers.sql...
Finished supabase db reset on branch main.
```

Selanjutnya, bangkitkan file tipe TypeScript otomatis dari skema database lokal ke `src/types/supabase-generated.types.ts` (sesuai skrip `package.json` pada File 01 `v1.1`, berdampingan dengan kontrak manual ENUM pada `src/types/database.types.ts`):
```bash
npm run db:types
```

---

## 16. Verifikasi Schema

Buka **Supabase Studio SQL Editor** di browser (`http://127.0.0.1:54323`), lalu jalankan skrip SQL verifikasi komprehensif berikut untuk memeriksa hasil migrasi:

```sql
-- ============================================================================
-- SKRIP VERIFIKASI SKEMA FIM-PROPERTY (JALANKAN DI SUPABASE STUDIO SQL EDITOR)
-- ============================================================================

-- 1. Pastikan jumlah ENUM di schema public tepat 34
SELECT count(*) AS total_enums
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e';

-- 2. Pastikan jumlah Tabel di schema public tepat 32
SELECT count(*) AS total_tables
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- 3. Pastikan keempat Partial Unique Index kritis (CST-01, CST-02, CST-03, CST-11) aktif
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
      'uq_one_active_supervisor_per_team',
      'uq_one_active_team_per_profile',
      'uq_one_active_booking_per_unit',
      'uq_one_primary_disbursement_per_kpr'
  );

-- 4. Pastikan Composite Foreign Keys (CST-04, CST-05, CST-06) dan FK KPR follow-up terdaftar
SELECT conname AS constraint_name, conrelid::regclass AS table_name
FROM pg_constraint
WHERE contype = 'f'
  AND conname IN (
      'fk_units_property_type_project',
      'fk_promotions_property_type_project',
      'fk_payment_records_schedule_booking',
      'fk_deals_booking_lead_unit',
      'fk_follow_up_tasks_kpr_application'
  );

-- 5. Pastikan jumlah Trigger updated_at tepat 17
SELECT count(*) AS total_updated_at_triggers
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE 'trg_%_updated_at';

-- 6. Pastikan jumlah Performance Indexes (idx_*) tepat 37
SELECT count(*) AS total_performance_indexes
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%';

-- 7. Pastikan Check Constraints kritis KPR (CST-10 & konsistensi status) terdaftar
SELECT conname AS constraint_name, conrelid::regclass AS table_name
FROM pg_constraint
WHERE contype = 'c'
  AND conname IN (
      'chk_kpr_applications_loan_reconciliation',
      'chk_kpr_applications_status_consistency'
  );
```

* **Kriteria Lulus Verifikasi:**
  * `total_enums` = **`34`**
  * `total_tables` = **`32`**
  * Keempat *Partial Unique Index* tampil lengkap.
  * Keempat *Composite Foreign Key* serta `fk_follow_up_tasks_kpr_application` tampil lengkap.
  * `total_updated_at_triggers` = **`17`**
  * `total_performance_indexes` = **`37`**
  * Kedua *Check Constraint* kritis pada `kpr_applications` (`chk_kpr_applications_loan_reconciliation` dan `chk_kpr_applications_status_consistency`) tampil lengkap.

---

## 17. Changelog (`v1.0` $\rightarrow$ `v1.1` $\rightarrow$ `v1.2` $\rightarrow$ `v1.3` $\rightarrow$ `v1.4`)

### Perubahan `v1.3` $\rightarrow$ `v1.4`
| Bagian | Perubahan dari `v1.3` ke `v1.4` | Alasan |
| :--- | :--- | :--- |
| **Header & Bag. 2.1** | Memperbarui versi dokumen menjadi `1.4` dan memperjelas deskripsi `CST-10` pada ringkasan rekonsiliasi skema. | Menyelaraskan dokumentasi versi revisi terbatas tanpa mengubah jumlah tabel, ENUM, maupun ruang lingkup fitur. |
| **Migrasi 5 (`kpr_applications` — `chk_kpr_applications_loan_reconciliation`)** | Memperketat constraint `chk_kpr_applications_loan_reconciliation` dengan aturan eksplisit per nilai `disbursement_status` (`NOT_DISBURSED`, `PARTIALLY_DISBURSED`, dan `FULLY_DISBURSED`), termasuk kewajiban `fully_disbursed_at` dan `application_status = 'COMPLETED'` saat `FULLY_DISBURSED`. | Mencegah inkonsistensi antara `disbursement_status` dan nominal realisasi/sisa pencairan (misal `PARTIALLY_DISBURSED` dengan pencairan `0` atau sisa `0`, maupun `NOT_DISBURSED` dengan pencairan `> 0`), serta tetap selaras penuh dengan `chk_kpr_applications_status_consistency` dan `TC-01A`. |
| **Bag. 12 & Bag. 16** | Menambahkan penjelasan kerja constraint `chk_kpr_applications_loan_reconciliation` (`CST-10`) terhadap `chk_kpr_applications_status_consistency` serta menambahkan query #7 pada skrip verifikasi skema. | Memastikan pengembang/Codex dapat memverifikasi keberadaan kedua constraint kritis KPR pada database target. |

### Perubahan `v1.2` $\rightarrow$ `v1.3`
| Bagian | Perubahan dari `v1.2` ke `v1.3` | Alasan |
| :--- | :--- | :--- |
| **Header & Bag. 2.2** | Menghapus status keputusan bisnis tertunda untuk `TC-01` dan menetapkan keputusan final **`TC-01A`** (unit KPR berubah menjadi `SOLD` hanya saat pencairan mencapai 100% `FULLY_DISBURSED`; tetap belum `SOLD` saat `NOT_DISBURSED` maupun `PARTIALLY_DISBURSED`), selaras dengan `KPR_SOLD_POLICY_MODE="TC-01A"` pada File 01. | Menyelaraskan dokumen dengan keputusan bisnis final proyek tanpa mengubah struktur tabel, ENUM, maupun constraint database. |
| **Bag. 2.3 & Migrasi 5 (`deals`)** | Menghapus referensi opsi alternatif yang bertentangan pada komentar `[Tabel 27] deals` dan memperjelas catatan konsistensi `TC-01A` untuk File 01 (`KPR_SOLD_POLICY_MODE`) dan File 04 (`TX-08`). | Memastikan tidak ada lagi referensi pilihan kebijakan lain yang bertentangan dengan keputusan final `TC-01A`. |

### Perubahan `v1.1` $\rightarrow$ `v1.2`
| Bagian | Perubahan dari `v1.1` ke `v1.2` | Alasan |
| :--- | :--- | :--- |
| **Migrasi 1 (`kpr_stage_enum` & `kpr_application_status_enum`), Bag. 8.1, Bag. 16** | Memurnikan `kpr_stage_enum` menjadi **10 tahap proses workflow** (menghapus `'REJECTED'`) dan menambahkan `[ENUM 34] kpr_application_status_enum` (`IN_PROGRESS`, `APPROVED`, `REJECTED_BY_BANK`, `CANCELLED_BY_CUSTOMER`, `BOOKING_CANCELLED`, `COMPLETED`). | Memisahkan tahapan proses dari kondisi/hasil pengajuan KPR serta membedakan penolakan bank, pembatalan konsumen, pembatalan booking oleh perusahaan, dan penyelesaian pasca-pencairan tanpa tumpang tindih dengan `disbursement_status` maupun `kpr_stage_histories`. |
| **Migrasi 5 (`kpr_applications`), Bag. 2.1, Bag. 12** | Menambahkan kolom `application_status`, `cancelled_at`, `cancellation_reason`, serta constraint `chk_kpr_applications_status_consistency` pada `kpr_applications`. | Menegakkan konsistensi state machine KPR di level database agar kondisi penolakan bank, pembatalan konsumen, pembatalan booking perusahaan, dan selesai pasca-pencairan tidak pernah tercampur atau kehilangan konteks tahap terakhir. |
| **Migrasi 5 (`follow_up_tasks`), Bag. 8.2, Bag. 9, Bag. 16** | Menambahkan kolom nullable `related_kpr_application_id UUID NULL` dengan FK `fk_follow_up_tasks_kpr_application` menuju `kpr_applications(id)` dan memindahkan pembuatan `follow_up_tasks` tepat setelah `kpr_applications`. | Memungkinkan tugas tindak lanjut Sales (dokumen tambahan, kontak bank, appraisal, jadwal akad, pencairan) ditautkan langsung ke aplikasi KPR terkait tanpa error urutan migrasi. |
| **Migrasi 6 (`indexes_and_triggers`), Bag. 4.1, Bag. 13, Bag. 16** | Menambahkan partial index `idx_followup_kpr_app_status` pada `follow_up_tasks` (total *Performance Index*: 36 $\rightarrow$ **37**) serta memperbarui `idx_kpr_team_stage` dan `idx_kpr_akad_sched` agar menyertakan `application_status`. | Mempercepat query daftar tugas tindak lanjut per aplikasi KPR dan filter dashboard KPR berdasarkan status pengajuan. |
| **Bag. 2.3** | Mendokumentasikan dampak skema `v1.2` terhadap File 01, File 03 (RLS `follow_up_tasks`), File 04 (`TX-04`, `TX-06`, `TX-08`, serta pembatalan KPR konsumen), dan File 06 (*schemas*, *services*, dan *metrics*). | Menjaga keterlacakan perubahan lintas-dokumen sebelum masuk ke tahap revisi File 03–06 berikutnya tanpa mengubah dokumen lain di luar ruang lingkup saat ini. |

### Ringkasan Perubahan Sebelumnya (`v1.0` $\rightarrow$ `v1.1`)
| Bagian | Perubahan dari `v1.0` ke `v1.1` | Alasan |
| :--- | :--- | :--- |
| **Header, Bag. 2, Bag. 5, Bag. 15** | Memperbarui referensi upstream ke `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`, memperjelas dependensi File 03–06, serta menyebut target output `npm run db:types` (`src/types/supabase-generated.types.ts`). | Menyelaraskan alur implementasi dengan File 01 `v1.1`. |
| **Bag. 3 & Komentar SQL** | Menegaskan konteks Single-Company CRM, skoring prospek deterministik `OQ-04` (non-ML), cakupan KPR tanpa cicilan bulanan bank, dan pemisahan transaksi properti CRM (`Cash Bertahap` `INSTALLMENT`, DP, Booking Fee, Pelunasan). | Menjaga implementasi Codex agar tetap sesuai keputusan bisnis terbaru. |
| **Bag. 4.1, 11.6, 13, 16** | Mengoreksi jumlah *Performance Index* awal dari 29 menjadi 36, memperjelas lokasi Views (`File 03`) & Trigger lanjutan (`File 03`/`File 04`), serta menambah query verifikasi indeks. | Menghilangkan inkonsistensi faktual internal pada `v1.0`. |
