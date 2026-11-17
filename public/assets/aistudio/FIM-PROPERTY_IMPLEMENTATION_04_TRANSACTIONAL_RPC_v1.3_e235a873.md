# FIM-Property Transactional Database Functions & RPC Implementation

* **Nama File:** `FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC_v1.3.md`
* **Versi Dokumen:** `1.3` *(Revisi teknis lanjutan terhadap `v1.2` untuk mengunci seluruh `payment_schedules` dan `payment_records` terkait Booking secara deterministik pada `TX-06` (`rpc_cancel_booking_or_deal`) sebelum pemeriksaan `PENDING_VERIFICATION` dan perhitungan refund, serta memastikan keselarasan penuh `TX-04` dan `TX-06` dengan trigger penjaga pembayaran `trg_00_guard_payment_records_insert`)*
* **Tujuan Dokumen:** Menjadi pedoman implementasi teknis lengkap dan siap dijalankan (*runnable SQL migration*) untuk membangun seluruh **10 Fungsi Transaksi Atomik PostgreSQL (`TX-01` s/d `TX-10`)**, trigger penjaga integritas pengajuan pembayaran (`trg_00_guard_payment_records_insert`), trigger nomor referensi otomatis (`trg_01_assign_payment_reference_number`), serta generator nomor referensi transaksi konkuren (`BK`, `PAY`, `KPR`, `DL`, `REF`) pada sistem **FIM-Property CRM**.
* **Ruang Lingkup:**
  1. Inventarisasi lengkap spesifikasi `TX-01` s/d `TX-10`.
  2. Prinsip keselamatan transaksi (*Atomicity*, *Global Canonical Ordered Row-Level Locking*, *Staged Locking*, *Concurrency Control*, dan *Idempotency*).
  3. Arsitektur keamanan RPC (`SECURITY DEFINER`, penguncian `search_path`, verifikasi `auth.uid()` dan klaim `service_role`, isolasi tim tunggal PT FIM-Property, serta pembatasan `GRANT EXECUTE`).
  4. Implementasi SQL lengkap pada file migrasi `supabase/migrations/20260301000800_transactional_rpcs.sql`.
  5. Penjelasan alur logika, penanganan kesalahan (*Error Handling*), integrasi *Transactional Audit Log* & *Notification Outbox*, serta skenario pengujian SQL menyeluruh.
* **Referensi Dokumen:**
  1. `FIM-PROPERTY_MASTER_BUSINESS_DISCOVERY_v1.2_FINAL.md`
  2. `FIM-PROPERTY_PHASE_1A_SYSTEM_ARCHITECTURE_v1.2.md`
  3. `FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0.md` & `v1.1.md`
  4. `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`
  5. `FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`
  6. `FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS_v1.1.md`
  7. `FIM-PROPERTY_IMPLEMENTATION_05_STORAGE_DOCUMENTS_v1.0.md` & `06_APPLICATION_BACKEND_v1.0.md` *(referensi keselarasan downstream)*
* **Dependency terhadap File Lain:**
  * **Bergantung pada (Upstream):** File 01 `v1.1`, File 02 `v1.4` (Migrasi 1–6: **34 ENUM** & **32 Tabel**, termasuk `kpr_application_status_enum`, pemisahan `current_stage` vs `application_status`, `follow_up_tasks.related_kpr_application_id`, serta constraint `chk_kpr_applications_loan_reconciliation` & `chk_kpr_applications_status_consistency`), dan File 03 `v1.1` (Migrasi 7: **12 helper `app_security`**, **2 view `security_invoker = true`**, **6 trigger guard**, Grants, dan **80 Kebijakan RLS**).
  * **Menjadi Prasyarat bagi (Downstream):** File 05 (*Supabase Private Storage & Document Management*), File 06 (*Application Backend Services, Server Actions, Seeding & Integration Test Suite*), dan implementasi modul aplikasi Next.js.
* **Status Eksekusi:** Seluruh kode PL/pgSQL dalam dokumen ini telah diperiksa secara statis terhadap PostgreSQL 15+, skema File 02 `v1.4`, dan keamanan File 03 `v1.1`, namun **belum dieksekusi maupun diuji pada mesin database lokal/live**.

---

## 1. Tujuan dan Ruang Lingkup

Pada arsitektur **Next.js + Supabase** untuk aplikasi single-company **PT FIM-Property CRM** (tanpa multi-tenancy dan tanpa fitur Machine Learning maupun pemantauan cicilan bulanan KPR konsumen ke bank), menjalankan beberapa perintah `await supabase.from('...').update(...)` secara berurutan dari kode TypeScript **bukanlah satu transaksi database yang utuh**, karena setiap panggilan HTTP ke PostgREST langsung melakukan `COMMIT` secara terpisah. Jika langkah ke-3 gagal (misalnya gagal membuat jadwal tagihan *Booking Fee*), maka langkah ke-1 (perubahan status unit menjadi `'HELD'`) sudah telanjur tersimpan permanen dan menyebabkan korupsi status inventaris.

Selain itu, pada **`FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS_v1.1.md`**, kita sengaja mengunci izin `INSERT` dan `UPDATE` langsung dari browser untuk tabel-tabel kritikal (`units`, `bookings`, `payment_schedules`, `deals`, `kpr_applications`, `kpr_stage_histories`, `kpr_disbursements`, `refund_transactions`, `reference_sequences`, `notification_outbox`, `audit_logs`) agar pengguna tidak dapat memanipulasi status transaksi secara sepihak.

Oleh karena itu, dokumen ini mengimplementasikan **10 Fungsi Transaksi Atomik PostgreSQL (`TX-01` s/d `TX-10`)** yang dipanggil melalui `supabase.rpc(...)` beserta trigger pengaman pengajuan bukti bayar (`trg_00_guard_payment_records_insert`). Setiap fungsi RPC menjamin sifat **ACID (*Atomicity, Consistency, Isolation, Durability*)**: seluruh perubahan lintas-tabel beserta pencatatan `audit_logs` dan `notification_outbox` berhasil secara bersamaan dalam satu transaksi, atau dibatalkan seluruhnya (`ROLLBACK` 100%) apabila ada satu saja aturan bisnis yang gagal.

---

## 2. Referensi & Keputusan Bisnis Final

Dokumen ini disusun dengan mematuhi secara ketat seluruh ketentuan pada:
1. **`FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`:** Konteks single-company CRM, konfigurasi `KPR_SOLD_POLICY_MODE` (`TC-01A`), serta penghapusan komponen ML & cicilan bulanan bank.
2. **`FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`:** Nama eksak ke-32 tabel, kolom, **34 tipe ENUM**, constraint `CST-01` s/d `CST-12`, `chk_kpr_applications_loan_reconciliation`, `chk_kpr_applications_status_consistency`, dan kolom `follow_up_tasks.related_kpr_application_id`.
3. **`FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS_v1.1.md`:** 12 fungsi pembantu di schema `app_security`, 6 trigger proteksi privilege escalation, serta 80 kebijakan RLS pada ke-32 tabel.
4. **`FIM-PROPERTY_MASTER_BUSINESS_DISCOVERY_v1.2_FINAL.md` & `PHASE_1A/1B`:** Aturan bisnis `BR-01` s/d `BR-12`, `OQ-01` s/d `OQ-07`, `PD-01` s/d `PD-05`, serta Kebijakan C2 untuk *Cash Bertahap*.

### Keputusan Bisnis Final Terkait Modul KPR (`TC-01A`)
* **`TC-01A` (FINAL — Unit Menjadi `'SOLD'` Saat Pencairan KPR 100% `'FULLY_DISBURSED'`):**
  Sesuai keputusan final pada File 01 `v1.1`, File 02 `v1.4` (Bagian 2.2), dan File 03 `v1.1` (`app_security.get_kpr_sold_policy_mode()`), **`TC-01`** tidak lagi berstatus *pending*. Aturan baku yang berlaku di seluruh RPC adalah:
  * `NOT_DISBURSED`: Unit tetap `'BOOKED'`.
  * `PARTIALLY_DISBURSED`: Unit tetap `'BOOKED'` dan kontrak Deal tetap `'UNDER_CONTRACT'` (menunggu pencairan sisa retensi bank).
  * `FULLY_DISBURSED`: Total pencairan sama dengan `approved_loan_amount`, `remaining_undisbursed_amount = 0`, `kpr_applications.application_status` berubah menjadi `'COMPLETED'`, `bookings.status` menjadi `'COMPLETED'`, `deals.payment_settlement_status` menjadi `'FULLY_SETTLED'`, dan `units.status` berubah menjadi **`'SOLD'`**.
* **Pemisahan `current_stage` vs `application_status` pada `kpr_applications`:**
  Sesuai File 02 `v1.4`, `kpr_stage_enum` hanya memuat **10 tahap proses murni** (`DOCUMENT_COLLECTION` s/d `DISBURSEMENT`, **tanpa** nilai `'REJECTED'`). Kondisi keputusan & pembatalan pengajuan dicatat pada kolom `application_status` (`kpr_application_status_enum`: `IN_PROGRESS`, `APPROVED`, `REJECTED_BY_BANK`, `CANCELLED_BY_CUSTOMER`, `BOOKING_CANCELLED`, `COMPLETED`).

---

## 3. RPC Inventory TX-01 sampai TX-10

Berikut adalah tabel inventarisasi lengkap untuk seluruh fungsi transaksi & helper yang diimplementasikan pada dokumen ini:

| Kode | Nama Fungsi RPC / Trigger (`public.*` / `app_security.*`) | Tujuan Bisnis Utama | Tabel yang Dilibatkan (Baca & Tulis) | Role yang Diizinkan Memanggil | Validasi Kritis Sebelum Mutasi | Efek Transaksi, Audit Log & Outbox |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Helper** | `app_security.next_reference_number` *(Internal)* | Membangkitkan kode unik bulanan (`BK/PAY/KPR/DL/REF-YYYYMM-XXXX`) secara aman terhadap transaksi bersamaan (*concurrency-safe*). | **Tulis:** `reference_sequences` | Hanya internal RPC / trigger (`REVOKE` dari `PUBLIC`, `anon`, `authenticated`). | Prefix wajib salah satu dari `BK`, `PAY`, `KPR`, `DL`, `REF`. | Menaikkan `last_value` secara atomik dengan `INSERT ... ON CONFLICT DO UPDATE`. |
| **Trigger 00** | `app_security.trg_guard_payment_records_insert` *(BEFORE INSERT)* | Mencegah pengajuan bukti bayar pada Booking/jadwal non-aktif, penggandaan `replaces_payment_id`, dan kelebihan bayar (*pending + baru > remaining*). | **Baca & Kunci:** `bookings` (`FOR SHARE`), `payment_schedules` (`FOR UPDATE`), `payment_records` | Otomatis saat `INSERT` ke `public.payment_records`. | • Kunci `bookings` (`FOR SHARE`) sebelum `payment_schedules` (`FOR UPDATE`).<br>• Booking berstatus `'PENDING_FEE'`/`'ACTIVE'` & jadwal belum `'PAID'`/`'CANCELLED'`.<br>• `SUM(PENDING_VERIFICATION) + paid_amount <= remaining_amount`. | Memblokir data korupsi & menserialisasikan pengajuan pembayaran terhadap `TX-03`/`TX-06` sebelum `PAY-...` diterbitkan. |
| **TX-01** | `public.rpc_create_booking` | Mengajukan Booking unit properti, menahan unit menjadi `'HELD'`, mengunci harga kesepakatan (*Price Freeze*), dan membuat jadwal tagihan *Booking Fee*. | **Baca:** `profiles`, `team_memberships`, `teams`, `leads`, `units`, `property_projects`, `developers`, `promotions`<br>**Tulis:** `reference_sequences`, `units`, `bookings`, `payment_schedules`, `leads`, `lead_pipeline_histories`, `notification_outbox`, `audit_logs` | `ADMIN`, `SUPERVISOR` (Lead timnya), `SALES` (Lead miliknya & tim aktifnya). | • Kunci `leads -> units`.<br>• Unit wajib `'AVAILABLE'` & proyek `'ACTIVE_SELLING'`.<br>• Lead bukan `'NEW'`/`'CLOSED_LOST'`/`'CLOSED_WON'`.<br>• Sales & tim aktif; promo & DP valid. | • Unit $\rightarrow$ `'HELD'` (+ set `current_holder_*`).<br>• Booking $\rightarrow$ `'PENDING_FEE'` (`+72 jam`).<br>• Buat jadwal `BOOKING_FEE`.<br>• Pipeline Lead $\rightarrow$ `'BOOKING'`.<br>• Tulis `audit_logs` & `notification_outbox`. |
| **TX-02** | `public.rpc_verify_payment_record` | Memverifikasi (`'VERIFIED'`) atau menolak (`'REJECTED'`) bukti pembayaran pelanggan oleh Admin beserta seluruh dampak turunannya. | **Baca & Tulis:** `payment_records`, `payment_schedules`, `bookings`, `booking_extensions`, `units`, `deals`, `deal_status_histories`, `kpr_applications`, `kpr_stage_histories`, `kpr_documents`, `kpr_bank_requirements`, `leads`, `lead_pipeline_histories`, `follow_up_tasks`, `reference_sequences`, `notification_outbox`, `audit_logs` | Khusus **`ADMIN`** (`ASM-04`). | • Kunci kanonik `leads -> bookings -> units -> deals -> payment_schedules -> payment_records -> follow_up_tasks`.<br>• Validasi status `PENDING_VERIFICATION`, Booking & Jadwal dilakukan **setelah** terkunci.<br>• Jika `'VERIFIED'`, `verified_paid + paid <= scheduled_amount`.<br>• Jika `'REJECTED'`, alasan $\ge 5$ karakter & `p_expired_booking_action` valid. | • Rekonsiliasi `verified_paid_amount` & `remaining_amount`.<br>• Jika `BOOKING_FEE` lunas: Booking $\rightarrow$ `'ACTIVE'`, Unit $\rightarrow$ `'BOOKED'`, buat `deals`, & inisiasi `kpr_applications` (`IN_PROGRESS`).<br>• Pulihkan `OVERDUE_IN_ARREARS` ke `DP_SETTLED_ONGOING` jika tunggakan selesai.<br>• Lunas 100% (`CASH_*`) $\rightarrow$ `SOLD`. |
| **TX-03** | `public.rpc_expire_overdue_bookings` | Mengubah Booking yang melewati batas waktu 72 jam menjadi `'EXPIRED'` dan melepaskan unit kembali menjadi `'AVAILABLE'` apabila syarat `PD-01` terpenuhi. | **Baca:** `payment_records`<br>**Tulis:** `bookings`, `payment_schedules`, `follow_up_tasks`, `units`, `notification_outbox`, `audit_logs` | Khusus **`ADMIN`** (pengguna interaktif) & **`service_role`** (Cron / `ReminderSweepOrchestrator`). **`SALES` & `SUPERVISOR` diblokir.** | • Tolak pemanggil `auth.uid() IS NULL` yang bukan `service_role`.<br>• Kunci batch `bookings` (`ORDER BY expires_at, id FOR UPDATE SKIP LOCKED`), lalu re-cek `PD-01` setelah terkunci (`NOT EXISTS PENDING_VERIFICATION/VERIFIED`).<br>• Kunci `units -> payment_schedules -> follow_up_tasks`. | • Booking $\rightarrow$ `'EXPIRED'`.<br>• Jadwal terkait & tugas `follow_up_tasks` penagihan (`related_schedule_id`) $\rightarrow$ `'CANCELLED'`.<br>• Unit `'HELD'` $\rightarrow$ `'AVAILABLE'`.<br>• Tulis `audit_logs` & `notification_outbox`. |
| **TX-04** | `public.rpc_record_kpr_approval` | Mencatat keputusan kredit bank (`'APPROVED'` / SP3K atau `'REJECTED_BY_BANK'`) dan membuat tagihan `'KPR_TOPUP_DP'` otomatis jika terjadi turun plafon. | **Baca:** `bookings`<br>**Tulis:** `kpr_applications`, `kpr_stage_histories`, `payment_schedules`, `follow_up_tasks`, `notification_outbox`, `audit_logs` | Khusus **`ADMIN`**. | • Kunci `bookings -> kpr_applications -> (payment_schedules / follow_up_tasks)`.<br>• Booking `'ACTIVE'` & KPR `application_status = 'IN_PROGRESS'`.<br>• `current_stage` wajib `'SUBMITTED'`, `'BANK_VERIFICATION'`, `'APPRAISAL'`, atau `'ADDITIONAL_REQUIREMENTS'`. | • Jika `'APPROVED'`: `current_stage = 'APPROVED'`, `application_status = 'APPROVED'`, `remaining_undisbursed_amount = approved_loan_amount`, & buat/update `KPR_TOPUP_DP` jika belum `'PAID'`.<br>• Jika `'REJECTED_BY_BANK'`: `current_stage` **dipertahankan**, `application_status = 'REJECTED_BY_BANK'`, batalkan tugas KPR aktif. |
| **TX-05** | `public.rpc_transition_deal_status` | Mengelola transisi 3 dimensi Deal: aktivasi PPJB (*Cash Bertahap* C2), penyelesaian Akad KPR, atau pengesahan pelunasan akhir (`'SOLD'`). | **Baca:** `payment_schedules`<br>**Tulis:** `deals`, `deal_status_histories`, `bookings`, `kpr_applications`, `kpr_stage_histories`, `units`, `leads`, `lead_pipeline_histories`, `notification_outbox`, `audit_logs` | Khusus **`ADMIN`**. | • Kunci `leads -> bookings -> units -> kpr_applications -> deals`.<br>• Deal & Booking masih aktif (`booking = 'ACTIVE'`, `contract <> 'CONTRACT_TERMINATED'`).<br>• Cek syarat DP/Akad/`FULLY_DISBURSED` per aksi. | • Memperbarui 3 dimensi Deal secara atomik.<br>• Pada C2 PPJB: `CLOSED_WON`, Unit tetap `'BOOKED'`.<br>• Pada pelunasan akhir: Booking `'COMPLETED'`, Unit `'SOLD'`.<br>• Tulis histori, `notification_outbox`, & `audit_logs`. |
| **TX-06** | `public.rpc_cancel_booking_or_deal` | Membatalkan Booking/Deal secara resmi, memblokir pembatalan jika ada bukti bayar menggantung, menyelaraskan `kpr_applications` ke `'BOOKING_CANCELLED'`, menetapkan resolusi dana, membuat `refund_transactions`, dan melepaskan unit ke `'AVAILABLE'`. | **Baca:** `payment_records`, `payment_schedules`<br>**Tulis:** `bookings`, `deals`, `deal_status_histories`, `payment_schedules`, `refund_transactions`, `kpr_applications`, `follow_up_tasks`, `units`, `reference_sequences`, `notification_outbox`, `audit_logs` | Khusus **`ADMIN`**. | • Kunci penuh `leads -> bookings -> units -> kpr_applications -> deals -> payment_schedules (ORDER BY id) -> payment_records (ORDER BY id)` **sebelum** mengecek `PENDING_VERIFICATION` & total `VERIFIED`.<br>• Booking tidak `'CANCELLED'`/`'EXPIRED'`/`'COMPLETED'`, Unit tidak `'SOLD'`, KPR `NOT_DISBURSED`, & bebas `PENDING_VERIFICATION`. | • Booking $\rightarrow$ `'CANCELLED'`, Deal $\rightarrow$ `'TERMINATED'`.<br>• KPR aktif (`IN_PROGRESS`/`APPROVED`) $\rightarrow$ `'BOOKING_CANCELLED'`.<br>• Batalkan jadwal & tugas terkait Booking/KPR.<br>• Buat `refund_transactions` (`REF-...`) & lepas Unit. |
| **TX-07** | `public.rpc_reassign_lead` | Memindahkan kepemilikan Lead beserta tugas aktif, survei terjadwal, dan transaksi berjalan ke Sales baru secara atomik (`BR-09`). | **Baca:** `profiles`, `team_memberships`, `teams`<br>**Tulis:** `leads`, `lead_assignment_histories`, `follow_up_tasks`, `site_visits`, `bookings`, `deals`, `kpr_applications`, `units`, `notification_outbox`, `audit_logs` | `ADMIN` (lintas tim & dalam tim) & `SUPERVISOR` (hanya tim aktifnya). | • Target Sales aktif, ber-role `'SALES'`, di tim aktif (`teams.is_active = true`).<br>• Jika `SUPERVISOR`, Lead & target wajib satu tim.<br>• Kunci `leads -> bookings -> units -> kpr_applications -> deals -> follow_up_tasks -> site_visits`. | • Update `assigned_sales_id`, tugas `PENDING`/`OVERDUE`, survei `SCHEDULED`, serta `current_sales_id` aktif.<br>• Jaga `origin_sales_id` & histori tetap utuh. |
| **TX-08** | `public.rpc_record_kpr_disbursement` | Mencatat pencairan dana KPR dari bank (`PRIMARY` / `SUBSEQUENT`), merekonsiliasi sisa plafon, dan menerapkan kebijakan final **`TC-01A`**. | **Baca:** `payment_schedules`<br>**Tulis:** `kpr_applications`, `kpr_disbursements`, `kpr_stage_histories`, `deals`, `deal_status_histories`, `bookings`, `units`, `leads`, `lead_pipeline_histories`, `follow_up_tasks`, `notification_outbox`, `audit_logs` | Khusus **`ADMIN`**. | • Kunci `leads -> bookings -> units -> kpr_applications -> deals -> follow_up_tasks`.<br>• Booking `'ACTIVE'`, KPR `'APPROVED'`, `TC-01A` aktif, DP + Top-up `'PAID'`, tidak duplikat referensi, & total cair $\le$ plafon. | • Sisipkan `kpr_disbursements` & hitung ulang agregat.<br>• Jika `PARTIALLY_DISBURSED`: Deal `UNDER_CONTRACT`, Unit **tetap `'BOOKED'`** (`TC-01A`).<br>• Jika `FULLY_DISBURSED`: KPR `'COMPLETED'`, Deal `'FULLY_SETTLED'`, Booking `'COMPLETED'`, Unit $\rightarrow$ **`'SOLD'`**, selesaikan tugas KPR. |
| **TX-09** | `public.rpc_advance_kpr_stage` | Memajukan tahapan proses KPR secara atomik pra-SP3K (`DOCUMENT_COLLECTION` s/d `ADDITIONAL_REQUIREMENTS`) dan penjadwalan Akad (`APPROVED -> AKAD_SCHEDULED`). | **Baca:** `kpr_documents`<br>**Tulis:** `kpr_applications`, `kpr_stage_histories`, `notification_outbox`, `audit_logs` | Khusus **`ADMIN`**. | • Kunci `bookings -> kpr_applications`.<br>• Booking `'ACTIVE'`, transisi sesuai graf state-machine.<br>• Menuju `SUBMITTED` wajib seluruh dokumen KPR `is_mandatory = true` berstatus `'VERIFIED'`. | • Update `current_stage` & metadata (`submitted_to_bank_at`, `akad_scheduled_at`, dll).<br>• Catat `kpr_stage_histories`, `notification_outbox`, & `audit_logs`. |
| **TX-10** | `public.rpc_cancel_kpr_by_customer` | Mencatat pembatalan pengajuan KPR atas inisiatif konsumen (`CANCELLED_BY_CUSTOMER`) tanpa menghapus `current_stage` dan tanpa menyentuh cicilan bank. | **Baca:** `bookings`<br>**Tulis:** `kpr_applications`, `follow_up_tasks`, `notification_outbox`, `audit_logs` | Khusus **`ADMIN`**. | • Kunci `bookings -> kpr_applications -> follow_up_tasks`.<br>• Booking `'ACTIVE'`, KPR `IN_PROGRESS`/`APPROVED`, `NOT_DISBURSED`, bukan `AKAD_COMPLETED`/`DISBURSEMENT`. | • Set `application_status = 'CANCELLED_BY_CUSTOMER'`, `cancelled_at`, `cancellation_reason` (pertahankan `current_stage`).<br>• Batalkan tugas KPR `PENDING`/`OVERDUE`.<br>• Catat outbox & `audit_logs`. |

---

## 4. Prinsip Implementasi Transaksi & Urutan Locking Global

Seluruh fungsi RPC dan trigger dalam dokumen ini dirancang dengan 5 prinsip ketahanan transaksi tingkat produksi:

1. **Atomisitas Mutlak dalam Satu Blok Eksekusi PL/pgSQL:**
   Di PostgreSQL, setiap pemanggilan fungsi melalui `supabase.rpc(...)` berjalan di dalam satu transaksi implisit. Apabila pada langkah terakhir terjadi pelanggaran constraint atau kondisi `RAISE EXCEPTION`, PostgreSQL membatalkan seluruh perubahan dari langkah pertama secara otomatis.
2. **Urutan Penguncian Baris Global Anti-Deadlock (*Global Canonical Row-Locking DAG*):**
   * Untuk meniadakan potensi *cross-RPC deadlock* dan *trigger-vs-RPC deadlock*, seluruh fungsi (`TX-01` s/d `TX-10`) serta `trg_00_guard_payment_records_insert` **wajib** mengakuisisi kunci baris (`SELECT ... FOR UPDATE`, `FOR SHARE`, maupun `UPDATE`) hanya dalam arah menaik sesuai hierarki global (*Directed Acyclic Graph* / DAG) berikut:
     $$\textbf{Rank 1: }\texttt{leads} \;\rightarrow\; \textbf{Rank 2: }\texttt{bookings} \;\rightarrow\; \textbf{Rank 3: }\texttt{units} \;\rightarrow\; \textbf{Rank 4: }\texttt{kpr\_applications} \;\rightarrow\; \textbf{Rank 5: }\texttt{deals} \;\rightarrow\; \textbf{Rank 6: }\texttt{payment\_schedules} \;\rightarrow\; \textbf{Rank 7: }\texttt{payment\_records} \;\rightarrow\; \textbf{Rank 8: }\texttt{follow\_up\_tasks} \;\rightarrow\; \textbf{Rank 9: }\texttt{site\_visits}$$
     *(diikuti operasi sisip tabel histori/outbox/audit dan leaf generator `reference_sequences` pada akhir transaksi).*
   * **Penguncian Bertahap (*Staged Locking*):** Jika sebuah RPC dipanggil hanya dengan ID anak (misalnya `p_payment_record_id` pada `TX-02`, `p_kpr_application_id` pada `TX-04`/`TX-08`/`TX-09`/`TX-10`, atau `p_deal_id` pada `TX-05`), fungsi terlebih dahulu melakukan **pembacaan non-penguncian (*non-locking lookup*)** untuk memperoleh ID induk (`lead_id`, `booking_id`, `unit_id`), lalu mengunci seluruh baris dari induk ke anak sesuai urutan global, dan **baru sesudahnya** memvalidasi kondisi status (`verification_status`, `status`, dll.) pada data segar yang sudah terkunci.
   * **Pengurutan Deterministik Multi-Baris:** Setiap penguncian lebih dari satu baris pada tabel yang sama (`bookings`, `units`, `kpr_applications`, `deals`, `payment_schedules`, `follow_up_tasks`, `site_visits`) wajib menggunakan `ORDER BY id` sebelum `FOR UPDATE`.
3. **Non-Blocking Queue Sweep (`SKIP LOCKED`) + Re-Evaluasi `PD-01` Pasca-Kunci:**
   Pada `TX-03 (rpc_expire_overdue_bookings)`, penguncian batch kandidat `bookings` dilakukan lebih dahulu dengan `ORDER BY b.expires_at ASC, b.id ASC ... FOR UPDATE OF b SKIP LOCKED` agar eksekusi konkuren (*Cron* vs *Admin*) tidak saling memblokir maupun memproses Booking yang sedang dipegang `TX-02`/`TX-06`/`TX-07`/`trg_00`. Setelah baris `bookings` terkunci, `TX-03` **wajib memeriksa ulang `EXISTS (payment_records ... PENDING_VERIFICATION/VERIFIED)`** agar celah *snapshot* `READ COMMITTED` terhadap `INSERT INTO payment_records` tertutup 100%.
4. **Rekonsiliasi Berbasis Agregasi Faktual (*Single-Source-of-Truth Aggregation*):**
   Saat memperbarui `verified_paid_amount` pada `payment_schedules` (`TX-02`) atau `primary_disbursed_amount` dan `subsequent_disbursed_amount` pada `kpr_applications` (`TX-08`), fungsi RPC menghitung ulang langsung menggunakan `SUM(...)` dari tabel rincian di dalam transaksi yang terkunci untuk menjamin 0% *balance drift*.
5. **Idempotensi Outbox & Notifikasi:**
   Penulisan ke `notification_outbox` di dalam RPC selalu menggunakan `ON CONFLICT (deduplication_key) DO NOTHING`.

---

## 5. Security dan Authorization

### 5.1 Mengapa Menggunakan `SECURITY DEFINER` pada `TX-01` s/d `TX-10`?
Berdasarkan desain keamanan pada **File 03 (`FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS_v1.1.md`)**, role `SALES` dan `SUPERVISOR` tidak diberi izin tulis langsung ke tabel kritikal (`units`, `bookings`, `payment_schedules`, `deals`, `kpr_applications`, `kpr_disbursements`, `refund_transactions`, `audit_logs`, `notification_outbox`). Dengan membungkus mutasi lintas-tabel ke dalam RPC `SECURITY DEFINER`, setiap perubahan hanya dapat terjadi melalui gerbang validasi bisnis & audit yang ketat.

### 5.2 Tujuh Aturan Pengamanan Ketat pada Setiap Fungsi RPC `SECURITY DEFINER`
1. **`SET search_path = ''`:** Dikunci kosong pada deklarasi fungsi untuk mencegah pembajakan nama tabel/fungsi (*search_path injection*).
2. **Penulisan *Schema-Qualified* Penuh:** Seluruh tabel, tipe, dan fungsi ditulis lengkap dengan schemanya (`public.bookings`, `app_security.get_current_user_role()`, `auth.uid()`).
3. **Tidak Pernah Mempercayai Identitas dari Parameter Input:**
   Tidak ada satu pun RPC yang menerima parameter `p_actor_user_id` atau `p_actor_role` dari luar. Identitas pemanggil selalu diambil secara internal dari `auth.uid()`, `app_security.get_current_user_role()`, `app_security.get_current_user_active_team_id()`, dan klaim JWT / role sesi PostgreSQL.
4. **Verifikasi Ketat `service_role` vs Pengguna Terautentikasi pada `TX-03`:**
   `TX-03` **dilarang** menganggap `auth.uid() IS NULL` otomatis sebagai `SYSTEM_AUTOMATION`. Bila `auth.uid() IS NOT NULL`, hanya `ADMIN` aktif yang diizinkan (`SALES` dan `SUPERVISOR` ditolak `42501`). Bila `auth.uid() IS NULL`, hak `SYSTEM_AUTOMATION` hanya diberikan apabila klaim JWT (`request.jwt.claims ->> 'role'` atau `request.jwt.claim.role`) benar-benar bernilai `'service_role'` (atau tidak ada klaim JWT namun `current_setting('role', true) = 'service_role'`); pemanggil anonim atau tanpa identitas sah ditolak keras dengan `42501`.
5. **Pembatasan `REVOKE` dan `GRANT EXECUTE`:**
   Seluruh fungsi RPC publik dicabut izin eksekusinya dari `PUBLIC` dan `anon` (`REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;`), dan hanya diberikan kepada `authenticated` serta `service_role`. Untuk `TX-03`, peran `authenticated` tetap diberi `GRANT EXECUTE` agar **`ADMIN`** (yang masuk via role database `authenticated`) dapat menjalankannya, sementara penolakan `SALES`, `SUPERVISOR`, akun nonaktif, dan pemanggil `auth.uid() IS NULL` non-`service_role` ditegakkan secara eksplisit di baris awal fungsi.
6. **Validasi Kepemilikan & Keaktifan Tim Sebelum Mutasi:**
   Pada `TX-01` dan `TX-07`, keanggotaan aktif Sales/Supervisor pada tim aktif diverifikasi sebelum perubahan diterapkan.
7. **Isolasi Fungsi Internal di Schema `app_security`:**
   `app_security.next_reference_number` serta fungsi trigger `app_security.trg_*` berada di schema privat `app_security` sehingga tidak terekspos ke PostgREST RPC.

---

## 6. SQL Migration Lengkap (`20260301000800_transactional_rpcs.sql`)

Buat file migrasi ke-8 dengan nama **`supabase/migrations/20260301000800_transactional_rpcs.sql`** dan salin seluruh kode SQL lengkap pada bagian ini secara berurutan:

```sql
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
```

---

## 7. Penjelasan Setiap RPC & Trigger

Bagian ini menguraikan alasan desain teknis di balik setiap fungsi transaksi di atas:

1. **`TX-01 (`rpc_create_booking`)`:**
   * Mengakuisisi kunci eksklusif baris secara kanonik (`leads` $\rightarrow$ `units`) di langkah paling awal. Jika dua Sales menekan tombol Booking untuk unit yang sama pada milidetik yang sama, panggilan kedua tertahan pada `SELECT ... FOR UPDATE` hingga panggilan pertama selesai `COMMIT`, lalu langsung gagal dengan `UNIT_NOT_AVAILABLE`.
   * Memvalidasi keaktifan `profiles`, `team_memberships`, dan `teams` milik Sales penanggung jawab, serta keaktifan tim Sales pemanggil.
   * Memastikan matematika DP selaras dengan metode pembiayaan (`CASH_KERAS` wajib `dp = 0`; `KPR` wajib menyisakan pokok pinjaman $> \text{Rp } 0$) serta menyimpan *Price Freeze Snapshot* (`BR-07`).
2. **`trg_00_guard_payment_records_insert` & `trg_01_assign_payment_reference_number`:**
   * `trg_00` berjalan sebelum `trg_01` saat `INSERT` ke `public.payment_records`. Ia mengunci **`bookings` terlebih dahulu (`FOR SHARE`)**, baru kemudian **`payment_schedules` (`FOR UPDATE`)**, memblokir pengajuan pembayaran pada Booking non-aktif atau jadwal `'PAID'`/`'CANCELLED'`, mencegah penggandaan koreksi `replaces_payment_id`, dan memblokir kelebihan bayar (`SUM(PENDING_VERIFICATION) + paid_amount <= remaining_amount`) sebelum nomor `PAY-YYYYMM-XXXX` diterbitkan.
   * Karena `bookings` dikunci sebelum `payment_schedules` (sama persis dengan `TX-02`, `TX-03`, `TX-04`, dan `TX-06`), `trg_00` mustahil mengalami *deadlock* melawan RPC transaksi maupun expiry, sekaligus menserialisasikan pengajuan bukti bayar baru dengan perubahan status Booking.
3. **`TX-02 (`rpc_verify_payment_record`)`:**
   * Menggunakan *Staged Locking*: terlebih dahulu membaca ID induk (`booking_id`, `payment_schedule_id`, `lead_id`, `unit_id`) tanpa mengunci, lalu mengunci dalam urutan global **`leads` $\rightarrow$ `bookings` $\rightarrow$ `units` $\rightarrow$ `deals` $\rightarrow$ `payment_schedules` $\rightarrow$ `payment_records`**, baru kemudian memvalidasi status `PENDING_VERIFICATION`, status Booking, dan status jadwal pada baris yang sudah terkunci.
   * Menghitung ulang `SUM(paid_amount)` langsung dari seluruh record `'VERIFIED'` (`payment_records`) sehingga tidak ada *balance drift*.
   * Ketika `BOOKING_FEE` lunas (`'PAID'`), mengaktifkan Booking (`'ACTIVE'`), mengunci Unit (`'BOOKED'`), membuat `deals`, menyusun jadwal lanjutan anti-*double-counting* (`BR-06`), dan menginisiasi `kpr_applications` (`application_status = 'IN_PROGRESS'`) beserta checklist `kpr_documents` untuk metode `'KPR'`.
   * Saat menolak bukti `BOOKING_FEE` setelah `expires_at` (`PD-01`), mendukung opsi `'EXTEND_24H'` atau `'EXPIRE_NOW'` (mengunci `payment_schedules` dan `follow_up_tasks` secara deterministik `ORDER BY id FOR UPDATE`, melepas unit, dan mengirim outbox `'BOOKING_EXPIRY_ALERT'`).
4. **`TX-03 (`rpc_expire_overdue_bookings`)`:**
   * **Otorisasi Ketat:** Hanya mengizinkan `ADMIN` aktif (bila `auth.uid() IS NOT NULL`) atau pemanggil sistem terverifikasi `service_role` (bila `auth.uid() IS NULL`). `SALES`, `SUPERVISOR`, `anon`, dan pemanggil tanpa identitas `service_role` ditolak (`42501`).
   * Mengunci seluruh batch kandidat `bookings` terlebih dahulu dengan `ORDER BY b.expires_at ASC, b.id ASC ... FOR UPDATE OF b SKIP LOCKED`, lalu **memeriksa ulang proteksi `PD-01`** (`NOT EXISTS ... PENDING_VERIFICATION/VERIFIED`) setelah baris `bookings` terkunci untuk menutup celah *snapshot* `READ COMMITTED` terhadap `INSERT INTO payment_records` konkuren, dan baru mengunci `units` $\rightarrow$ `payment_schedules` (`ORDER BY id`) $\rightarrow$ `follow_up_tasks` (`ORDER BY id`).
5. **`TX-04 (`rpc_record_kpr_approval`)`:**
   * Mengunci `bookings` $\rightarrow$ `kpr_applications` $\rightarrow$ (`payment_schedules` / `follow_up_tasks` `ORDER BY id`).
   * Menggunakan parameter `p_decision VARCHAR(30)` (`'APPROVED'` atau `'REJECTED_BY_BANK'`), selaras dengan penghapusan `'REJECTED'` dari `kpr_stage_enum` pada File 02 `v1.4`.
   * Pada `'APPROVED'`: menetapkan `current_stage = 'APPROVED'`, `application_status = 'APPROVED'`, `remaining_undisbursed_amount = approved_loan_amount`, dan menyisipkan/memperbarui jadwal `'KPR_TOPUP_DP'` jika terjadi turun plafon (tanpa menimpa jadwal `'PAID'`).
   * Pada `'REJECTED_BY_BANK'`: mempertahankan `current_stage` terakhir, menetapkan `application_status = 'REJECTED_BY_BANK'`, mencatat `rejected_at` dan `rejection_reason`, serta membatalkan tugas KPR terbuka.
6. **`TX-05 (`rpc_transition_deal_status`)`:**
   * Mengunci `leads` $\rightarrow$ `bookings` $\rightarrow$ `units` $\rightarrow$ `kpr_applications` $\rightarrow$ `deals`.
   * Mengelola **Kebijakan C2 (`PD-03`)** untuk *Cash Bertahap* (`ACTIVATE_PPJB_CONTRACT`), pengesahan Akad KPR (`RECORD_KPR_AKAD_COMPLETED`), dan pelunasan akhir (`FINALIZE_FULL_SETTLEMENT` yang mewajibkan KPR `'COMPLETED'` & `'FULLY_DISBURSED'`).
7. **`TX-06 (`rpc_cancel_booking_or_deal`)`:**
   * Mengunci penuh `leads` $\rightarrow$ `bookings` $\rightarrow$ `units` $\rightarrow$ `kpr_applications` $\rightarrow$ `deals` $\rightarrow$ `payment_schedules` (`ORDER BY id`) $\rightarrow$ `payment_records` (`ORDER BY id`) **sebelum** mengevaluasi `PENDING_VERIFICATION`, menghitung total `VERIFIED`, dan memvalidasi nominal refund, lalu mengunci `follow_up_tasks` (`ORDER BY id`) sebelum mutasi.
   * Karena `bookings` (`FOR UPDATE`) dikunci lebih awal daripada `payment_schedules` dan `payment_records` terkunci eksklusif, tidak ada pengajuan pembayaran baru (`trg_00`) maupun perubahan status verifikasi yang dapat berlomba (*race*) dengan pembatalan Booking tanpa menimbulkan *deadlock*.
   * Menolak pembatalan jika Booking `'COMPLETED'`, Unit `'SOLD'`, KPR `disbursement_status <> 'NOT_DISBURSED'`, atau masih ada bukti bayar `'PENDING_VERIFICATION'`, menyinkronkan `kpr_applications` aktif (`IN_PROGRESS`/`APPROVED`) menjadi `'BOOKING_CANCELLED'` tanpa menimpa `'REJECTED_BY_BANK'`/`'CANCELLED_BY_CUSTOMER'`, membuat `refund_transactions` (`REF-...`), dan melepas Unit ke `'AVAILABLE'`.
8. **`TX-07 (`rpc_reassign_lead`)`:**
   * Mengunci baris secara global: `leads` $\rightarrow$ `bookings` $\rightarrow$ `units` $\rightarrow$ `kpr_applications` $\rightarrow$ `deals` $\rightarrow$ `follow_up_tasks` $\rightarrow$ `site_visits` (semua multi-baris diurutkan `ORDER BY id FOR UPDATE`) agar 100% bebas *deadlock* melawan seluruh RPC lain, memvalidasi keaktifan `teams.is_active = true`, serta memelihara `origin_sales_id` dan histori masa lalu (`BR-09`).
9. **`TX-08 (`rpc_record_kpr_disbursement`)`:**
   * Mengunci `leads` $\rightarrow$ `bookings` $\rightarrow$ `units` $\rightarrow$ `kpr_applications` $\rightarrow$ `deals` $\rightarrow$ `follow_up_tasks` (`ORDER BY id`).
   * Menegakkan keputusan bisnis final **`TC-01A`**: saat `PARTIALLY_DISBURSED`, Unit **tetap `'BOOKED'`** dan kontrak tetap `'UNDER_CONTRACT'`; hanya ketika total pencairan mencapai 100% (`FULLY_DISBURSED`), RPC mengubah `kpr_applications.application_status = 'COMPLETED'`, `bookings.status = 'COMPLETED'`, `deals.payment_settlement_status = 'FULLY_SETTLED'`, menyelesaikan tugas KPR terbuka, dan mengubah `units.status = 'SOLD'`.
10. **`TX-09 (`rpc_advance_kpr_stage`)`:**
    * Mengunci `bookings` $\rightarrow$ `kpr_applications`. Memvalidasi transisi graf tahapan pra-SP3K dan penjadwalan Akad (`APPROVED -> AKAD_SCHEDULED`), memastikan seluruh dokumen wajib (`is_mandatory = true`) sudah `'VERIFIED'` sebelum `'SUBMITTED'`, lalu memperbarui `kpr_applications`, `kpr_stage_histories`, `notification_outbox`, dan `audit_logs`.
11. **`TX-10 (`rpc_cancel_kpr_by_customer`)`:**
    * Mengunci `bookings` $\rightarrow$ `kpr_applications` $\rightarrow$ `follow_up_tasks` (`ORDER BY id`). Mengubah `application_status = 'CANCELLED_BY_CUSTOMER'` sambil mempertahankan `current_stage` dan membiarkan Booking/Deal/Unit tetap aktif hingga tindak lanjut Admin via `TX-06`.

---

## 8. Error Handling

Setiap fungsi RPC menggunakan awalan kode kesalahan bisnis terstruktur (`<ERROR_CODE>: <Pesan Bahasa Indonesia>`) yang dipasangkan dengan standar `SQLSTATE ERRCODE` PostgreSQL agar mudah ditangkap dan diterjemahkan oleh **Layer 3 (Next.js Server Actions)**:

| Kategori Kesalahan | SQLSTATE `ERRCODE` | Contoh Awalan Pesan di RPC | Perilaku Database & Penanganan di Aplikasi |
| :--- | :---: | :--- | :--- |
| **Autentikasi & Izin Akses** | `42501` (`insufficient_privilege`) | `UNAUTHORIZED:`, `FORBIDDEN:`, `CROSS_TEAM_TRANSFER_DENIED:` | Transaksi `ROLLBACK`; aplikasi mengembalikan status HTTP `401` / `403`. |
| **Data Tidak Ditemukan** | `P0002` (`no_data_found`) | `NOT_FOUND:` | Transaksi `ROLLBACK`; aplikasi mengembalikan status HTTP `404`. |
| **Konflik Stok / Duplikasi** | `23505` (`unique_violation`) | `UNIT_NOT_AVAILABLE:`, `DUPLICATE_DISBURSEMENT_REF:`, `DUPLICATE_REPLACEMENT_PAYMENT:` | Transaksi `ROLLBACK`; aplikasi menampilkan peringatan konflik/duplikasi (HTTP `409`). |
| **Pelanggaran Aturan Bisnis / State Machine** | `22023` (`invalid_parameter_value`) | `INVALID_PIPELINE_STAGE:`, `OVERPAYMENT_BLOCKED:`, `DP_NOT_SETTLED:`, `PENDING_PAYMENT_EXISTS:`, `MANDATORY_KPR_DOCS_UNVERIFIED:`, `INVALID_STAGE_TRANSITION:`, `CANNOT_CANCEL_COMPLETED:` | Transaksi `ROLLBACK`; aplikasi menampilkan pesan validasi bisnis langsung pada formulir pengguna (HTTP `400` / `422`). |

---

## 9. Audit Log dan Outbox

Perhatikan perbedaan arsitektur antara `audit_logs` dan `notification_outbox` di dalam kesepuluh fungsi RPC (`TX-01` s/d `TX-10`):
1. **`public.audit_logs` (Strict Atomic Coupling):**
   Setiap RPC menyisipkan baris ke `public.audit_logs` lengkap dengan `old_values` (kondisi sebelum RPC berjalan) dan `new_values` (kondisi setelah RPC berjalan). Pada `TX-03`, `actor_role` tercatat sebagai `'ADMIN'` (bila dipanggil Admin) atau `'SYSTEM_AUTOMATION'` (hanya bila dipanggil oleh `service_role` terverifikasi).
2. **`public.notification_outbox` (Idempotent Transactional Outbox):**
   Setiap RPC (`TX-01` s/d `TX-10`) menulis pemicu notifikasi ke `public.notification_outbox` menggunakan `ON CONFLICT (deduplication_key) DO NOTHING`. Dengan cara ini, peristiwa bisnis dijamin tercatat bersama transaksi utamanya, sedangkan pengiriman notifikasi individual di `public.notifications` dilakukan oleh *Outbox Dispatcher*.

---

## 10. Testing dan Test Scenarios

### 10.1 Penting: Mengapa SQL Editor Supabase Tidak Otomatis Berjalan sebagai Pengguna Biasa?
> **Catatan Teknis Kritis untuk Pengujian di Supabase:**  
> Saat Anda membuka **Supabase Studio SQL Editor** (`http://127.0.0.1:54323`) dan menjalankan query biasa, sesi SQL Editor berjalan menggunakan role superuser **`postgres`**, di mana `auth.uid()` bernilai `NULL`!  
>   
> Agar pengujian RPC kita benar-benar menyimulasikan pemanggilan nyata dari aplikasi Next.js atau Cron, setel konteks sesi di dalam blok transaksi pengujian:
> * **Simulasi Pengguna (`Sales` / `Supervisor` / `Admin`):**
>   ```sql
>   SET LOCAL role = 'authenticated';
>   SELECT set_config('request.jwt.claims', json_build_object('sub', '<UUID_USER>', 'role', 'authenticated')::text, true);
>   ```
> * **Simulasi Cron / Backend Terisolasi (`service_role`):**
>   ```sql
>   SET LOCAL role = 'service_role';
>   SELECT set_config('request.jwt.claims', '{"role":"service_role"}'::text, true);
>   ```

---

### 10.2 Matriks Skenario Pengujian Lengkap (`TX-01` s/d `TX-10` & Trigger Penjaga)

| ID Uji | Target RPC / Trigger | Kategori Skenario Uji | Kondisi Awal & Input | Hasil yang Diharapkan (Acceptance Criteria) |
| :--- | :---: | :--- | :--- | :--- |
| **TST-01** | `TX-01` (`rpc_create_booking`) | **1. Transaksi Berhasil (`SALES`)** | Login sebagai Sales A1 (Tim Alpha); Unit A-01 `'AVAILABLE'`; Lead L1 `'NEGOTIATION'` milik Sales A1. | • Menghasilkan kode `BK-YYYYMM-0001`.<br>• Status Unit A-01 $\rightarrow$ `'HELD'` (`current_holder_sales_id = Sales A1`).<br>• Jadwal `BOOKING_FEE` `'UNPAID'`.<br>• Tercatat di `audit_logs` & `notification_outbox`. |
| **TST-02** | `TX-01` (`rpc_create_booking`) | **2. Input Tidak Valid (`CASH_KERAS` / Fee / DP)** | Sales A1 mengirim `p_booking_fee_amount` negatif, atau `CASH_KERAS` dengan `agreed_dp > 0`, atau `KPR` dengan `BF + DP >= Harga`. | Transaksi ditolak (`ROLLBACK`) dengan `INVALID_BOOKING_FEE` / `INVALID_DP_AMOUNT` / `INVALID_DP_MATH`. Status unit tetap `'AVAILABLE'`. |
| **TST-03** | `TX-01` (`rpc_create_booking`) | **6. Percobaan Akses Lintas-Sales / Lintas-Tim** | Sales B1 (Tim Bravo) mencoba memanggil `rpc_create_booking` menggunakan `p_lead_id` milik Sales A1 (Tim Alpha). | Ditolak dengan `FORBIDDEN` (`42501`). |
| **TST-04** | `TX-01` (`rpc_create_booking`) | **8. Duplicate / Concurrent Double Booking** | Sales B1 mencoba memanggil `rpc_create_booking` pada Unit A-01 yang sedang `'HELD'`. | Ditolak seketika dengan `UNIT_NOT_AVAILABLE` (`23505`). |
| **TST-04B** | `Trigger 00` (`trg_00_guard_payment_records_insert`) | **8. Proteksi Overpayment / Jadwal Tertutup** | Sales mencoba `INSERT` bukti bayar ke `payment_records` melebihi `remaining_amount` (atau pada jadwal `'PAID'`). | Diblokir langsung sebelum nomor `PAY-` terbit dengan `OVERPAYMENT_BLOCKED` / `SCHEDULE_CLOSED`. |
| **TST-05** | `TX-02` (`rpc_verify_payment_record`) | **3. Pengguna Tanpa Izin (`SALES` mencoba Verify)** | Sales A1 memanggil `rpc_verify_payment_record` untuk memverifikasi pembayarannya sendiri. | Ditolak dengan `FORBIDDEN` (`42501`). |
| **TST-06** | `TX-02` (`rpc_verify_payment_record`) | **1 & 10. Verifikasi Booking Fee Berhasil (`ADMIN`)** | Admin memverifikasi pembayaran `BOOKING_FEE` pada Booking metode `'KPR'`. | • `payment_records` $\rightarrow$ `'VERIFIED'`, jadwal $\rightarrow$ `'PAID'`.<br>• Booking $\rightarrow$ `'ACTIVE'`, Unit $\rightarrow$ `'BOOKED'`.<br>• Terbentuk `deals` (`DL-..`), `DOWN_PAYMENT` bersih (`BR-06`), & `kpr_applications` (`application_status = 'IN_PROGRESS'`). |
| **TST-07** | `TX-02` (`rpc_verify_payment_record`) | **8. Pencegahan Double Verification & Overpayment** | Admin memverifikasi ulang record yang sudah `'VERIFIED'` atau nominal melebihi sisa tagihan. | Ditolak dengan `ALREADY_PROCESSED` atau `OVERPAYMENT_BLOCKED`. |
| **TST-08** | `TX-03` (`rpc_expire_overdue_bookings`) | **3, 5 & 9. Otorisasi Ketat `TX-03` & Proteksi `PD-01`** | 1. `SALES`, `SUPERVISOR`, & pemanggil `auth.uid() IS NULL` tanpa `service_role` memanggil `TX-03`.<br>2. `service_role` / `ADMIN` memanggil `TX-03` saat Booking 1 lewat `expires_at` tanpa bukti bayar & Booking 2 punya bukti bayar `'PENDING_VERIFICATION'`. | 1. Seluruh pemanggil tidak berhak ditolak keras (`42501`); pemanggil tanpa identitas sah tidak mendapat `SYSTEM_AUTOMATION`.<br>2. Booking 1 $\rightarrow$ `'EXPIRED'`, tugas `related_schedule_id` $\rightarrow$ `'CANCELLED'`, Unit $\rightarrow$ `'AVAILABLE'`. Booking 2 **tetap `'HELD'`**. |
| **TST-09** | `TX-09` (`rpc_advance_kpr_stage`) | **5. Validasi Dokumen Wajib & Progres Tahap KPR** | Admin mencoba memajukan KPR dari `DOCUMENT_VERIFICATION` ke `SUBMITTED` saat dokumen wajib masih `'MISSING'`, lalu memverifikasi dokumen & mengulangi. | Gagal pertama dengan `MANDATORY_KPR_DOCS_UNVERIFIED`; setelah dokumen `'VERIFIED'`, berhasil pindah ke `SUBMITTED` dan mencatat `kpr_stage_histories`. |
| **TST-10** | `TX-04` (`rpc_record_kpr_approval`) | **1 & 5. Persetujuan SP3K (Turun Plafon) vs Ditolak Bank** | 1. Plafon diajukan Rp 450 jt, disetujui Rp 420 jt (`'APPROVED'`).<br>2. Pada pengajuan lain, dicatat `'REJECTED_BY_BANK'`. | 1. `current_stage = 'APPROVED'`, `application_status = 'APPROVED'`, terbentuk `'KPR_TOPUP_DP'` Rp 30 jt.<br>2. `application_status = 'REJECTED_BY_BANK'`, `current_stage` tetap utuh, tugas KPR terbuka dibatalkan. |
| **TST-11** | `TX-05` (`rpc_transition_deal_status`) | **1 & 5. Kebijakan C2 Cash Bertahap & Akad KPR** | 1. `RECORD_KPR_AKAD_COMPLETED` saat `KPR_TOPUP_DP` belum lunas $\rightarrow$ gagal; setelah lunas & `AKAD_SCHEDULED` $\rightarrow$ berhasil.<br>2. `ACTIVATE_PPJB_CONTRACT` pada Cash Bertahap. | Validasi *Stage Gate* bekerja; pada C2 PPJB, `Sales Outcome = 'CLOSED_WON'` namun Unit tetap `'BOOKED'`. |
| **TST-12** | `TX-08` (`rpc_record_kpr_disbursement`) | **1 & 5. Pencairan KPR Bertahap (`TC-01A` Final)** | Admin mencatat `'PRIMARY'` 80% lalu `'SUBSEQUENT'` 20%. | • Pencairan ke-1: `PARTIALLY_DISBURSED`, `application_status = 'APPROVED'`, Unit **tetap `'BOOKED'`** (`TC-01A`).<br>• Pencairan ke-2: `FULLY_DISBURSED`, `application_status = 'COMPLETED'`, `booking = 'COMPLETED'`, `unit = 'SOLD'`. |
| **TST-13** | `TX-10` & `TX-06` (`rpc_cancel_kpr_by_customer` & `rpc_cancel_booking_or_deal`) | **1, 7, 8 & 9. Pembatalan KPR Konsumen, Blokir `PENDING_PAYMENT_EXISTS`, Pembatalan Booking, & Blokir Unit `SOLD`** | 1. Konsumen membatalkan KPR lewat `TX-10`; muncul bukti bayar DP berstatus `'PENDING_VERIFICATION'`, lalu Admin memanggil `TX-06`, kemudian menolak bukti bayar DP via `TX-02` dan mengulang `TX-06` (`FULL_REFUND` Rp 5 jt).<br>2. Admin mencoba membatalkan Booking yang Unit-nya sudah `'SOLD'`. | 1. `TX-10` mengubah `application_status = 'CANCELLED_BY_CUSTOMER'` dengan `current_stage` utuh; `TX-06` menolak (`PENDING_PAYMENT_EXISTS`) saat bukti DP masih pending; setelah ditolak via `TX-02`, `TX-06` berhasil membuat `refund_transactions` sebesar Rp 5 jt, tidak menimpa `'CANCELLED_BY_CUSTOMER'`, & melepas unit.<br>2. `TX-06` menolak pembatalan Unit `'SOLD'` (`CANNOT_CANCEL_COMPLETED`). |
| **TST-14** | `TX-07` (`rpc_reassign_lead`) | **1 & 6. Reassignment Lead + Transaksi Aktif & Blokir Lintas-Tim** | Supervisor Tim Alpha memindahkan Lead ke Sales Tim Bravo (gagal), lalu ke Sales A2 (berhasil). | `assigned_sales_id` & `current_sales_id` berpindah ke Sales A2; `origin_sales_id` & histori lama tetap atas nama Sales A1. |

---

### 10.3 Skrip SQL Pengujian End-to-End (`TX-01` s/d `TX-10`) yang Aman (`BEGIN ... ROLLBACK`)

Skrip di bawah ini adalah *Self-Contained Verification Test Suite* yang dapat dijalankan di **Supabase Studio SQL Editor** atau melalui `psql`. Skrip ini membuat data uji sementara, menguji **seluruh 10 fungsi RPC (`TX-01` s/d `TX-10`)**, trigger penjaga pembayaran (`trg_00`), pengujian otorisasi ketat `TX-03` (`SALES`/`SUPERVISOR`/`auth.uid() IS NULL` tanpa `service_role` ditolak `42501`; `service_role` berhasil), serta proteksi `PD-01`, lalu diakhiri dengan `ROLLBACK;` agar database lokal Anda tetap bersih.

```sql
-- ============================================================================
-- SKRIP PENGUJIAN INTEGRASI OTOMATIS TX-01 s/d TX-10 (SANDBOX TRANSAKSIONAL)
-- Cara pakai: Salin & jalankan seluruh blok ini di Supabase Studio SQL Editor.
-- Jika seluruh pengujian lulus, akan tampil NOTICE "SELURUH PENGUJIAN INTEGRASI TX-01 s/d TX-10 LULUS 100%".
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_admin_id          UUID := '00000000-0000-0000-0000-000000000001';
    v_sup_alpha_id      UUID := '00000000-0000-0000-0000-000000000002';
    v_sales_a1_id       UUID := '00000000-0000-0000-0000-000000000003';
    v_sales_a2_id       UUID := '00000000-0000-0000-0000-000000000004';
    v_sales_b1_id       UUID := '00000000-0000-0000-0000-000000000005';
    v_team_alpha_id     UUID := '00000000-0000-0000-0000-000000000011';
    v_team_bravo_id     UUID := '00000000-0000-0000-0000-000000000012';
    v_dev_id            UUID := '00000000-0000-0000-0000-000000000021';
    v_proj_id           UUID := '00000000-0000-0000-0000-000000000031';
    v_type_id           UUID := '00000000-0000-0000-0000-000000000041';
    v_unit_kpr_id       UUID := '00000000-0000-0000-0000-000000000051';
    v_unit_exp_id       UUID := '00000000-0000-0000-0000-000000000052';
    v_unit_pd01_id      UUID := '00000000-0000-0000-0000-000000000053';
    v_lead_kpr_id       UUID := '00000000-0000-0000-0000-000000000061';
    v_lead_exp_id       UUID := '00000000-0000-0000-0000-000000000062';
    v_lead_pd01_id      UUID := '00000000-0000-0000-0000-000000000063';

    v_res_tx01          JSONB;
    v_res_tx01_exp      JSONB;
    v_res_tx01_pd01     JSONB;
    v_booking_kpr_id    UUID;
    v_booking_exp_id    UUID;
    v_booking_pd01_id   UUID;
    v_bf_sched_id       UUID;
    v_bf_sched_exp_id   UUID;
    v_bf_sched_pd01_id  UUID;
    v_dp_sched_id       UUID;
    v_dp_sched_exp_id   UUID;
    v_topup_sched_id    UUID;
    v_pay_bf_id         UUID;
    v_pay_bf_exp_id     UUID;
    v_pay_bf_pd01_id    UUID;
    v_pay_dp_id         UUID;
    v_pay_dp_exp_id     UUID;
    v_pay_topup_id      UUID;
    v_kpr_app_id        UUID;
    v_kpr_cancel_id     UUID;
    v_deal_kpr_id       UUID;
    v_res_tx02          JSONB;
    v_res_tx03          JSONB;
    v_res_tx04          JSONB;
    v_res_tx05          JSONB;
    v_res_tx06          JSONB;
    v_res_tx07          JSONB;
    v_res_tx08_1        JSONB;
    v_res_tx08_2        JSONB;
    v_res_tx09          JSONB;
    v_res_tx10          JSONB;
    v_caught_error      BOOLEAN;
BEGIN
    -- ========================================================================
    -- PERSIAPAN DATA UJI (SEED FIXTURES MINIMAL DALAM TRANSAKSI)
    -- ========================================================================
    INSERT INTO auth.users (id, email) VALUES
        (v_admin_id, 'admin.test@fimproperty.local'),
        (v_sup_alpha_id, 'sup.alpha@fimproperty.local'),
        (v_sales_a1_id, 'sales.a1@fimproperty.local'),
        (v_sales_a2_id, 'sales.a2@fimproperty.local'),
        (v_sales_b1_id, 'sales.b1@fimproperty.local');

    INSERT INTO public.profiles (id, full_name, email, phone, system_role, is_active) VALUES
        (v_admin_id, 'Admin Utama', 'admin.test@fimproperty.local', '081100000001', 'ADMIN', true),
        (v_sup_alpha_id, 'Supervisor Alpha', 'sup.alpha@fimproperty.local', '081100000002', 'SUPERVISOR', true),
        (v_sales_a1_id, 'Sales Alpha 1', 'sales.a1@fimproperty.local', '081100000003', 'SALES', true),
        (v_sales_a2_id, 'Sales Alpha 2', 'sales.a2@fimproperty.local', '081100000004', 'SALES', true),
        (v_sales_b1_id, 'Sales Bravo 1', 'sales.b1@fimproperty.local', '081100000005', 'SALES', true);

    INSERT INTO public.teams (id, code, name, created_by) VALUES
        (v_team_alpha_id, 'TM-ALPHA-T', 'Tim Alpha Test', v_admin_id),
        (v_team_bravo_id, 'TM-BRAVO-T', 'Tim Bravo Test', v_admin_id);

    INSERT INTO public.team_memberships (team_id, profile_id, membership_role, is_active, assigned_by) VALUES
        (v_team_alpha_id, v_sup_alpha_id, 'TEAM_SUPERVISOR', true, v_admin_id),
        (v_team_alpha_id, v_sales_a1_id, 'TEAM_SALES', true, v_admin_id),
        (v_team_alpha_id, v_sales_a2_id, 'TEAM_SALES', true, v_admin_id),
        (v_team_bravo_id, v_sales_b1_id, 'TEAM_SALES', true, v_admin_id);

    INSERT INTO public.developers (id, code, name, address, pic_name, pic_phone, created_by) VALUES
        (v_dev_id, 'DEV-TST', 'PT Developer Nusantara', 'Jl. Uji Coba No. 1', 'Bpk. Hendra', '081200001111', v_admin_id);

    INSERT INTO public.property_projects (id, developer_id, code, name, province, city, district, address, status, created_by) VALUES
        (v_proj_id, v_dev_id, 'PRJ-TST', 'Cluster Harmoni Test', 'Jawa Barat', 'Bekasi', 'Tambun', 'Jl. Harmoni Raya', 'ACTIVE_SELLING', v_admin_id);

    INSERT INTO public.property_types (id, project_id, code, name, standard_land_area, standard_building_area) VALUES
        (v_type_id, v_proj_id, 'T45-90', 'Tipe 45/90', 90, 45);

    INSERT INTO public.units (id, project_id, property_type_id, unit_code, block_number, land_area, building_area, catalog_price, status) VALUES
        (v_unit_kpr_id, v_proj_id, v_type_id, 'A-01', 'Blok A', 90, 45, 500000000, 'AVAILABLE'),
        (v_unit_exp_id, v_proj_id, v_type_id, 'A-02', 'Blok A', 90, 45, 500000000, 'AVAILABLE'),
        (v_unit_pd01_id, v_proj_id, v_type_id, 'A-03', 'Blok A', 90, 45, 500000000, 'AVAILABLE');

    INSERT INTO public.kpr_bank_requirements (bank_name, document_code, document_name, is_mandatory) VALUES
        ('Bank Mandiri', 'KTP', 'Fotokopi KTP Pemohon (Fiktif)', true),
        ('Bank Mandiri', 'SLIP_GAJI', 'Slip Gaji 3 Bulan Terakhir (Fiktif)', true);

    INSERT INTO public.leads (id, full_name, phone, lead_source, assigned_sales_id, team_id, budget_amount, pipeline_stage, created_by) VALUES
        (v_lead_kpr_id, 'Calon Pembeli KPR 1', '089911112222', 'INSTAGRAM_ADS', v_sales_a1_id, v_team_alpha_id, 550000000, 'NEGOTIATION', v_sales_a1_id),
        (v_lead_exp_id, 'Calon Pembeli Expiry', '089933334444', 'WALK_IN', v_sales_a1_id, v_team_alpha_id, 500000000, 'NEGOTIATION', v_sales_a1_id),
        (v_lead_pd01_id, 'Calon Pembeli PD01', '089955556666', 'REFERRAL', v_sales_a1_id, v_team_alpha_id, 500000000, 'NEGOTIATION', v_sales_a1_id);

    -- ========================================================================
    -- UJI 1: TX-01 (rpc_create_booking) — Negatif Lintas-Sales, Validasi DP, & Positif Sukses
    -- ========================================================================
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sales_b1_id, 'role', 'authenticated')::text, true);
    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_create_booking(v_lead_kpr_id, v_unit_kpr_id, 'KPR', 5000000, NULL, true, 50000000, 'Percobaan Ilegal');
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: Sales Bravo 1 seharusnya ditolak saat mem-booking Lead milik Sales Alpha 1';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sales_a1_id, 'role', 'authenticated')::text, true);
    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_create_booking(v_lead_kpr_id, v_unit_kpr_id, 'CASH_KERAS', 5000000, NULL, true, 50000000, 'DP invalid pada Cash Keras');
    EXCEPTION WHEN invalid_parameter_value THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: CASH_KERAS dengan agreed_dp_total_amount > 0 seharusnya ditolak';

    v_res_tx01 := public.rpc_create_booking(v_lead_kpr_id, v_unit_kpr_id, 'KPR', 5000000, NULL, true, 50000000, 'Booking KPR Resmi');
    v_booking_kpr_id := (v_res_tx01->>'booking_id')::uuid;
    v_bf_sched_id := (v_res_tx01->>'booking_fee_schedule_id')::uuid;
    ASSERT (v_res_tx01->>'unit_status') = 'HELD', 'GAGAL: Status unit seharusnya berubah menjadi HELD';

    -- Uji Anti-Double Booking pada unit HELD
    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_create_booking(v_lead_exp_id, v_unit_kpr_id, 'CASH_KERAS', 5000000, NULL, true, 0, 'Double Booking');
    EXCEPTION WHEN unique_violation THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: Double booking pada unit HELD seharusnya ditolak';

    -- ========================================================================
    -- UJI 2: Trigger Penjaga Pembayaran & TX-02 (rpc_verify_payment_record)
    -- ========================================================================
    -- 2A. Uji blokir overpayment oleh trg_00_guard_payment_records_insert
    v_caught_error := false;
    BEGIN
        INSERT INTO public.payment_records (
            booking_id, payment_schedule_id, submitted_by_sales_id, paid_amount,
            payment_date, proof_file_path, proof_file_name
        ) VALUES (
            v_booking_kpr_id, v_bf_sched_id, v_sales_a1_id, 6000000,
            CURRENT_DATE, 'bookings/' || v_booking_kpr_id || '/payments/over.pdf', 'over.pdf'
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: Trigger penjaga seharusnya memblokir pembayaran melebihi sisa tagihan';

    -- 2B. Pengajuan bukti bayar valid (Rp 5.000.000) & penolakan verifikasi oleh Sales
    INSERT INTO public.payment_records (
        booking_id, payment_schedule_id, submitted_by_sales_id, paid_amount,
        payment_date, proof_file_path, proof_file_name
    ) VALUES (
        v_booking_kpr_id, v_bf_sched_id, v_sales_a1_id, 5000000,
        CURRENT_DATE, 'bookings/' || v_booking_kpr_id || '/payments/bf_proof.pdf', 'bf_proof.pdf'
    ) RETURNING id INTO v_pay_bf_id;

    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_verify_payment_record(v_pay_bf_id, 'VERIFIED', 'Coba verifikasi sendiri');
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: Sales tidak boleh bisa memverifikasi pembayaran sendiri';

    -- 2C. Admin memverifikasi Booking Fee Rp 5.000.000
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
    v_res_tx02 := public.rpc_verify_payment_record(v_pay_bf_id, 'VERIFIED', 'Mutasi rekening cocok Rp 5 juta');

    ASSERT (v_res_tx02->>'schedule_status') = 'PAID', 'GAGAL: Jadwal Booking Fee seharusnya berstatus PAID';
    ASSERT (SELECT status FROM public.units WHERE id = v_unit_kpr_id) = 'BOOKED', 'GAGAL: Status unit seharusnya berubah menjadi BOOKED';

    SELECT id INTO v_dp_sched_id
    FROM public.payment_schedules
    WHERE booking_id = v_booking_kpr_id AND schedule_type = 'DOWN_PAYMENT';
    ASSERT (SELECT scheduled_amount FROM public.payment_schedules WHERE id = v_dp_sched_id) = 45000000,
        'GAGAL: Jadwal DP bersih seharusnya Rp 45.000.000 (Anti-Double Counting BR-06)';

    -- ========================================================================
    -- UJI 3: TX-07 (rpc_reassign_lead) — Pemindahan Lead & Transaksi Aktif
    -- ========================================================================
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sup_alpha_id, 'role', 'authenticated')::text, true);
    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_reassign_lead(v_lead_kpr_id, v_sales_b1_id, 'Percobaan pindah lintas tim');
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: Supervisor tidak boleh memindahkan Lead ke Sales tim lain';

    v_res_tx07 := public.rpc_reassign_lead(v_lead_kpr_id, v_sales_a2_id, 'Rotasi beban kerja tim Alpha');
    ASSERT (SELECT current_sales_id FROM public.bookings WHERE id = v_booking_kpr_id) = v_sales_a2_id,
        'GAGAL: current_sales_id pada Booking aktif seharusnya berpindah ke Sales Alpha 2';
    ASSERT (SELECT origin_sales_id FROM public.bookings WHERE id = v_booking_kpr_id) = v_sales_a1_id,
        'GAGAL: origin_sales_id pada Booking seharusnya tetap menunjuk ke Sales Alpha 1';

    -- ========================================================================
    -- UJI 4: TX-09 (rpc_advance_kpr_stage) & TX-04 (rpc_record_kpr_approval)
    -- ========================================================================
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
    SELECT id INTO v_kpr_app_id FROM public.kpr_applications WHERE booking_id = v_booking_kpr_id;
    SELECT id INTO v_deal_kpr_id FROM public.deals WHERE booking_id = v_booking_kpr_id;

    -- Majukan tahap ke DOCUMENT_VERIFICATION
    v_res_tx09 := public.rpc_advance_kpr_stage(v_kpr_app_id, 'DOCUMENT_VERIFICATION', NULL, NULL, NULL, 'Mulai verifikasi berkas');
    ASSERT (v_res_tx09->>'current_stage') = 'DOCUMENT_VERIFICATION', 'GAGAL: Tahap KPR seharusnya menjadi DOCUMENT_VERIFICATION';

    -- Uji blokir SUBMITTED saat dokumen wajib masih MISSING
    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_advance_kpr_stage(v_kpr_app_id, 'SUBMITTED', NULL, NULL, NULL, 'Kirim paksa sebelum dokumen lengkap');
    EXCEPTION WHEN invalid_parameter_value THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: SUBMITTED seharusnya ditolak jika dokumen wajib belum VERIFIED';

    -- Verifikasi dokumen wajib lalu majukan SUBMITTED -> BANK_VERIFICATION via TX-09
    UPDATE public.kpr_documents
    SET status = 'VERIFIED',
        file_path = 'bookings/' || v_booking_kpr_id || '/kpr-docs/' || id || '.pdf',
        file_name = 'dokumen_kpr.pdf',
        uploaded_by = v_sales_a2_id,
        uploaded_at = now(),
        verified_by = v_admin_id,
        verified_at = now()
    WHERE kpr_application_id = v_kpr_app_id;

    PERFORM public.rpc_advance_kpr_stage(v_kpr_app_id, 'SUBMITTED', NULL, NULL, NULL, 'Berkas lengkap dikirim ke bank');
    PERFORM public.rpc_advance_kpr_stage(v_kpr_app_id, 'BANK_VERIFICATION', NULL, NULL, NULL, 'Berkas diproses analis bank');

    -- TX-04: Plafon diajukan Rp 450.000.000; Bank menyetujui Rp 420.000.000 (Turun Plafon Rp 30.000.000)
    v_res_tx04 := public.rpc_record_kpr_approval(
        v_kpr_app_id, 'APPROVED', 'SP3K/MND/2026/0099', 420000000, CURRENT_DATE + 7, 'Disetujui turun plafon Rp 30 juta'
    );

    ASSERT (v_res_tx04->>'application_status') = 'APPROVED', 'GAGAL: application_status KPR seharusnya APPROVED';
    ASSERT (v_res_tx04->>'current_stage') = 'APPROVED', 'GAGAL: current_stage KPR seharusnya APPROVED';
    ASSERT (v_res_tx04->>'shortfall_topup_dp')::numeric = 30000000, 'GAGAL: Selisih turun plafon seharusnya Rp 30.000.000';
    v_topup_sched_id := (v_res_tx04->>'topup_schedule_id')::uuid;
    ASSERT v_topup_sched_id IS NOT NULL, 'GAGAL: Jadwal KPR_TOPUP_DP seharusnya otomatis dibuat';

    -- ========================================================================
    -- UJI 5: TX-02 (DP & Top-Up DP), TX-09 (AKAD_SCHEDULED), & TX-05 (Akad KPR)
    -- ========================================================================
    INSERT INTO public.payment_records (
        booking_id, payment_schedule_id, submitted_by_sales_id, paid_amount, payment_date, proof_file_path, proof_file_name
    ) VALUES
        (v_booking_kpr_id, v_dp_sched_id, v_sales_a2_id, 45000000, CURRENT_DATE, 'bookings/dp.pdf', 'dp.pdf')
    RETURNING id INTO v_pay_dp_id;

    INSERT INTO public.payment_records (
        booking_id, payment_schedule_id, submitted_by_sales_id, paid_amount, payment_date, proof_file_path, proof_file_name
    ) VALUES
        (v_booking_kpr_id, v_topup_sched_id, v_sales_a2_id, 30000000, CURRENT_DATE, 'bookings/topup.pdf', 'topup.pdf')
    RETURNING id INTO v_pay_topup_id;

    PERFORM public.rpc_verify_payment_record(v_pay_dp_id, 'VERIFIED', 'DP Rp 45 juta lunas');
    PERFORM public.rpc_verify_payment_record(v_pay_topup_id, 'VERIFIED', 'Top-up DP Rp 30 juta lunas');

    -- Jadwalkan Akad via TX-09 lalu selesaikan Akad via TX-05
    PERFORM public.rpc_advance_kpr_stage(v_kpr_app_id, 'AKAD_SCHEDULED', now() + interval '2 days', 'Bank Mandiri KC Bekasi', 'Notaris Sari, S.H.', 'Jadwal Akad ditetapkan');

    v_res_tx05 := public.rpc_transition_deal_status(
        v_deal_kpr_id, 'RECORD_KPR_AKAD_COMPLETED', 'AKTA-AJB-2026-88', 'bookings/akta.pdf', 'Notaris Sari, S.H.', 'Akad berjalan lancar'
    );
    ASSERT (SELECT current_stage FROM public.kpr_applications WHERE id = v_kpr_app_id) = 'AKAD_COMPLETED',
        'GAGAL: Tahap KPR seharusnya menjadi AKAD_COMPLETED';

    -- ========================================================================
    -- UJI 6: TX-08 (rpc_record_kpr_disbursement) — TC-01A Final (PRIMARY & SUBSEQUENT)
    -- ========================================================================
    -- 6A. Pencairan Utama (PRIMARY) 80% = Rp 336.000.000 (Sisa Rp 84.000.000)
    v_res_tx08_1 := public.rpc_record_kpr_disbursement(
        v_kpr_app_id, 'PRIMARY', 'DISB-MND-001', 336000000, CURRENT_DATE, 'bookings/disb1.pdf', 'Pencairan Utama 80%'
    );
    ASSERT (v_res_tx08_1->>'disbursement_status') = 'PARTIALLY_DISBURSED', 'GAGAL: Status pencairan seharusnya PARTIALLY_DISBURSED';
    ASSERT (v_res_tx08_1->>'application_status') = 'APPROVED', 'GAGAL: application_status seharusnya tetap APPROVED saat PARTIALLY_DISBURSED';
    ASSERT (v_res_tx08_1->>'remaining_undisbursed_amount')::numeric = 84000000, 'GAGAL: Sisa belum cair seharusnya Rp 84.000.000';
    ASSERT (v_res_tx08_1->>'unit_status') = 'BOOKED', 'GAGAL: Sesuai TC-01A, unit tetap BOOKED selama PARTIALLY_DISBURSED';

    -- 6B. Pencairan Lanjutan (SUBSEQUENT) 20% = Rp 84.000.000 (Lunas 100% Plafon Rp 420.000.000)
    v_res_tx08_2 := public.rpc_record_kpr_disbursement(
        v_kpr_app_id, 'SUBSEQUENT', 'DISB-MND-002', 84000000, CURRENT_DATE, 'bookings/disb2.pdf', 'Pencairan Retensi Atap 20%'
    );
    ASSERT (v_res_tx08_2->>'disbursement_status') = 'FULLY_DISBURSED', 'GAGAL: Status pencairan seharusnya FULLY_DISBURSED';
    ASSERT (v_res_tx08_2->>'application_status') = 'COMPLETED', 'GAGAL: application_status seharusnya menjadi COMPLETED saat FULLY_DISBURSED';
    ASSERT (v_res_tx08_2->>'booking_status') = 'COMPLETED', 'GAGAL: booking_status seharusnya menjadi COMPLETED';
    ASSERT (v_res_tx08_2->>'deal_settlement_status') = 'FULLY_SETTLED', 'GAGAL: Settlement status seharusnya FULLY_SETTLED';
    ASSERT (v_res_tx08_2->>'unit_status') = 'SOLD', 'GAGAL: Status unit seharusnya berubah menjadi SOLD saat FULLY_DISBURSED';

    -- 6C. Uji blokir TX-06 pada transaksi yang sudah COMPLETED / SOLD
    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_cancel_booking_or_deal(v_booking_kpr_id, 'Coba batalkan unit SOLD', 'FULL_REFUND', 5000000, 'Harus gagal');
    EXCEPTION WHEN invalid_parameter_value THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: TX-06 tidak boleh mengizinkan pembatalan Booking/Unit yang sudah SOLD';

    -- ========================================================================
    -- UJI 7: TX-03 (Otorisasi Ketat & Proteksi PD-01), TX-10, & TX-06
    -- ========================================================================
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sales_a1_id, 'role', 'authenticated')::text, true);
    v_res_tx01_exp := public.rpc_create_booking(v_lead_exp_id, v_unit_exp_id, 'CASH_KERAS', 5000000, NULL, true, 0, 'Booking Uji Expiry');
    v_booking_exp_id := (v_res_tx01_exp->>'booking_id')::uuid;

    v_res_tx01_pd01 := public.rpc_create_booking(v_lead_pd01_id, v_unit_pd01_id, 'CASH_KERAS', 5000000, NULL, true, 0, 'Booking Uji Proteksi PD-01');
    v_booking_pd01_id := (v_res_tx01_pd01->>'booking_id')::uuid;
    v_bf_sched_pd01_id := (v_res_tx01_pd01->>'booking_fee_schedule_id')::uuid;

    -- Sisipkan bukti bayar PENDING_VERIFICATION untuk Booking PD-01
    INSERT INTO public.payment_records (
        booking_id, payment_schedule_id, submitted_by_sales_id, paid_amount, payment_date, proof_file_path, proof_file_name
    ) VALUES (
        v_booking_pd01_id, v_bf_sched_pd01_id, v_sales_a1_id, 5000000, CURRENT_DATE, 'bookings/bf_pd01.pdf', 'bf_pd01.pdf'
    ) RETURNING id INTO v_pay_bf_pd01_id;

    -- 7A. SALES tidak boleh memanggil TX-03
    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_expire_overdue_bookings(10);
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: SALES seharusnya ditolak (42501) saat memanggil TX-03';

    -- 7B. SUPERVISOR tidak boleh memanggil TX-03
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sup_alpha_id, 'role', 'authenticated')::text, true);
    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_expire_overdue_bookings(10);
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: SUPERVISOR seharusnya ditolak (42501) saat memanggil TX-03';

    -- 7C. Pemanggil dengan auth.uid() IS NULL tanpa klaim/role service_role wajib ditolak (42501)
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}'::text, true);
    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_expire_overdue_bookings(10);
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: auth.uid() IS NULL tanpa role service_role tidak boleh diizinkan menjalankan TX-03';

    -- Buat kedua Booking melewati batas waktu 72 jam
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
    UPDATE public.bookings
    SET expires_at = now() - interval '2 hours'
    WHERE id IN (v_booking_exp_id, v_booking_pd01_id);

    -- 7D. Simulasikan eksekusi Cron terverifikasi sebagai service_role
    SET LOCAL role = 'service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}'::text, true);

    v_res_tx03 := public.rpc_expire_overdue_bookings(10);

    -- Pulihkan role sesi ke postgres sebelum beralih kembali ke konteks ADMIN
    RESET role;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);

    ASSERT (v_res_tx03->>'expired_count')::int = 1, 'GAGAL: TX-03 seharusnya hanya meng-expire 1 Booking tanpa bukti bayar';
    ASSERT (SELECT status FROM public.bookings WHERE id = v_booking_exp_id) = 'EXPIRED', 'GAGAL: Booking tanpa bukti bayar seharusnya EXPIRED';
    ASSERT (SELECT status FROM public.units WHERE id = v_unit_exp_id) = 'AVAILABLE', 'GAGAL: Unit A-02 seharusnya kembali AVAILABLE';
    ASSERT (SELECT status FROM public.bookings WHERE id = v_booking_pd01_id) = 'PENDING_FEE', 'GAGAL: Proteksi PD-01 gagal — Booking dengan bukti bayar PENDING_VERIFICATION ikut expired';
    ASSERT (SELECT status FROM public.units WHERE id = v_unit_pd01_id) = 'HELD', 'GAGAL: Unit A-03 seharusnya tetap HELD oleh proteksi PD-01';
    ASSERT (
        SELECT actor_role
        FROM public.audit_logs
        WHERE entity_table = 'bookings' AND entity_id = v_booking_exp_id AND action_type = 'BOOKING_AUTO_EXPIRED'
        LIMIT 1
    ) = 'SYSTEM_AUTOMATION', 'GAGAL: Audit log eksekusi service_role harus mencatat actor_role = SYSTEM_AUTOMATION';

    -- 7E. Uji TX-10 & TX-06 pada siklus KPR yang dibatalkan konsumen
    v_res_tx01_exp := public.rpc_create_booking(v_lead_exp_id, v_unit_exp_id, 'KPR', 5000000, NULL, true, 50000000, 'Booking KPR Uji Batal Konsumen');
    v_booking_exp_id := (v_res_tx01_exp->>'booking_id')::uuid;
    v_bf_sched_exp_id := (v_res_tx01_exp->>'booking_fee_schedule_id')::uuid;

    INSERT INTO public.payment_records (
        booking_id, payment_schedule_id, submitted_by_sales_id, paid_amount, payment_date, proof_file_path, proof_file_name
    ) VALUES (
        v_booking_exp_id, v_bf_sched_exp_id, v_sales_a1_id, 5000000, CURRENT_DATE, 'bookings/bf_exp.pdf', 'bf_exp.pdf'
    ) RETURNING id INTO v_pay_bf_exp_id;

    PERFORM public.rpc_verify_payment_record(v_pay_bf_exp_id, 'VERIFIED', 'Verifikasi BF sebelum uji TX-10');
    SELECT id INTO v_kpr_cancel_id FROM public.kpr_applications WHERE booking_id = v_booking_exp_id;

    -- Buat tugas tindak lanjut KPR lalu batalkan KPR via TX-10
    INSERT INTO public.follow_up_tasks (
        lead_id, assigned_sales_id, related_kpr_application_id, title, due_at, source_type, created_by
    ) VALUES (
        v_lead_exp_id, v_sales_a1_id, v_kpr_cancel_id, 'Lengkapi dokumen KPR konsumen', now() + interval '1 day', 'MANUAL_SALES', v_admin_id
    );

    v_res_tx10 := public.rpc_cancel_kpr_by_customer(v_kpr_cancel_id, 'Konsumen membatalkan rencana KPR karena mutasi kerja', 'Catatan uji TX-10');
    ASSERT (v_res_tx10->>'application_status') = 'CANCELLED_BY_CUSTOMER', 'GAGAL: Status KPR seharusnya CANCELLED_BY_CUSTOMER';
    ASSERT (v_res_tx10->>'current_stage') = 'DOCUMENT_COLLECTION', 'GAGAL: current_stage harus tetap dipertahankan saat pembatalan KPR';

    -- Uji blokir TX-06 ketika masih ada bukti bayar DP PENDING_VERIFICATION (PENDING_PAYMENT_EXISTS)
    SELECT id INTO v_dp_sched_exp_id
    FROM public.payment_schedules
    WHERE booking_id = v_booking_exp_id AND schedule_type = 'DOWN_PAYMENT';

    INSERT INTO public.payment_records (
        booking_id, payment_schedule_id, submitted_by_sales_id, paid_amount, payment_date, proof_file_path, proof_file_name
    ) VALUES (
        v_booking_exp_id, v_dp_sched_exp_id, v_sales_a1_id, 10000000, CURRENT_DATE, 'bookings/dp_pending.pdf', 'dp_pending.pdf'
    ) RETURNING id INTO v_pay_dp_exp_id;

    v_caught_error := false;
    BEGIN
        PERFORM public.rpc_cancel_booking_or_deal(v_booking_exp_id, 'Coba batal saat ada bukti bayar pending', 'FULL_REFUND', 5000000, 'Harus gagal');
    EXCEPTION WHEN invalid_parameter_value THEN
        v_caught_error := true;
    END;
    ASSERT v_caught_error = true, 'GAGAL: TX-06 seharusnya menolak pembatalan saat masih ada payment_records berstatus PENDING_VERIFICATION';

    -- Tolak bukti bayar DP pending melalui TX-02 lalu batalkan Booking via TX-06
    PERFORM public.rpc_verify_payment_record(v_pay_dp_exp_id, 'REJECTED', 'Bukti transfer DP tidak terbaca sebelum pembatalan');

    -- Batalkan Booking via TX-06 dan pastikan hanya Rp 5.000.000 VERIFIED yang di-refund serta status CANCELLED_BY_CUSTOMER tidak tertimpa
    v_res_tx06 := public.rpc_cancel_booking_or_deal(v_booking_exp_id, 'Konsumen batal transaksi KPR dan meminta refund penuh', 'FULL_REFUND', 5000000, 'Refund penuh disetujui');
    ASSERT (v_res_tx06->>'booking_status') = 'CANCELLED', 'GAGAL: Status Booking seharusnya CANCELLED';
    ASSERT (v_res_tx06->>'unit_status') = 'AVAILABLE', 'GAGAL: Status Unit seharusnya kembali AVAILABLE';
    ASSERT (v_res_tx06->>'kpr_application_status') = 'CANCELLED_BY_CUSTOMER', 'GAGAL: TX-06 tidak boleh menimpa status CANCELLED_BY_CUSTOMER';
    ASSERT (v_res_tx06->>'total_verified_paid')::numeric = 5000000, 'GAGAL: Total pembayaran terverifikasi seharusnya tetap Rp 5.000.000';
    ASSERT (v_res_tx06->>'refund_transaction_id') IS NOT NULL, 'GAGAL: refund_transactions seharusnya dibuat saat FULL_REFUND';

    RAISE NOTICE '====================================================================';
    RAISE NOTICE 'SELURUH PENGUJIAN INTEGRASI TX-01 s/d TX-10 LULUS 100%% TANPA ERROR!';
    RAISE NOTICE '====================================================================';
END;
$$;

-- Batalkan seluruh data uji sementara agar database lokal tetap bersih
ROLLBACK;
```

---

## 11. Cara Menjalankan Migration

Simpan SQL pada Bagian 6 ke dalam file **`supabase/migrations/20260301000800_transactional_rpcs.sql`**, lalu jalankan perintah berikut dari direktori root proyek (`fim-property/`):

```bash
# 1. Terapkan seluruh migrasi (Migrasi 1 s/d Migrasi 8)
npm run db:reset

# 2. Perbarui file definisi tipe TypeScript otomatis dari Supabase lokal
npm run db:types
```

* **Hasil yang seharusnya terlihat:**
  Terminal menampilkan `Applying migration 20260301000800_transactional_rpcs.sql...` tanpa pesan error sintaks maupun referensi.

---

## 12. Cara Menjalankan Testing

1. **Verifikasi Keberadaan Fungsi RPC & Trigger di Database:**
   Buka **Supabase Studio SQL Editor** (`http://127.0.0.1:54323`) dan jalankan query pemeriksaan daftar fungsi berikut:
   ```sql
   SELECT routine_schema, routine_name, security_type
   FROM information_schema.routines
   WHERE routine_name IN (
       'next_reference_number',
       'trg_guard_payment_records_insert',
       'trg_assign_payment_reference_number',
       'rpc_create_booking',
       'rpc_verify_payment_record',
       'rpc_expire_overdue_bookings',
       'rpc_record_kpr_approval',
       'rpc_transition_deal_status',
       'rpc_cancel_booking_or_deal',
       'rpc_reassign_lead',
       'rpc_record_kpr_disbursement',
       'rpc_advance_kpr_stage',
       'rpc_cancel_kpr_by_customer'
   )
   ORDER BY routine_schema, routine_name;
   ```
   *Hasil yang diharapkan:* Menampilkan tepat **13 fungsi** (`3` di schema `app_security` [`next_reference_number`, `trg_guard_payment_records_insert`, `trg_assign_payment_reference_number`] dan `10` di schema `public` [`TX-01` s/d `TX-10`]), seluruhnya memiliki `security_type = 'DEFINER'`.

2. **Eksekusi Skrip Pengujian Integrasi (`Bagian 10.3`):**
   Salin seluruh blok `BEGIN; DO $$ ... $$; ROLLBACK;` dari **Bagian 10.3** ke dalam **Supabase Studio SQL Editor** lalu klik **Run**.
   *Hasil yang diharapkan:* Muncul pesan `NOTICE: SELURUH PENGUJIAN INTEGRASI TX-01 s/d TX-10 LULUS 100% TANPA ERROR!`.

---

## 13. Acceptance Criteria

Implementasi **File 04 (Transactional Database Functions & RPC)** dinyatakan **SELESAI** apabila seluruh kriteria berikut terpenuhi:

- [ ] **AC-01:** File migrasi `supabase/migrations/20260301000800_transactional_rpcs.sql` berhasil dijalankan melalui `npm run db:reset` tanpa error.
- [ ] **AC-02:** Generator nomor referensi `app_security.next_reference_number` berada di schema privat `app_security`, dan tabel `payment_records` dilindungi berurutan oleh `trg_00_guard_payment_records_insert` (mengunci `bookings` (`FOR SHARE`) sebelum `payment_schedules` (`FOR UPDATE`)) serta `trg_01_assign_payment_reference_number`.
- [ ] **AC-03:** Seluruh 10 fungsi RPC (`TX-01` s/d `TX-10`) telah terdaftar di schema `public` dengan `SECURITY DEFINER`, `SET search_path = ''`, pencabutan akses dari `PUBLIC`/`anon`, dan pemberian `GRANT EXECUTE` hanya kepada `authenticated` serta `service_role`.
- [ ] **AC-04:** `TX-03` (`rpc_expire_overdue_bookings`) menolak keras (`42501`) pemanggil `SALES`, `SUPERVISOR`, akun nonaktif, maupun pemanggil `auth.uid() IS NULL` tanpa klaim/role `service_role`, serta melakukan re-cek `PD-01` setelah baris `bookings` terkunci `FOR UPDATE SKIP LOCKED`.
- [ ] **AC-05:** Seluruh `TX-01` s/d `TX-10` dan `trg_00` mematuhi urutan penguncian baris global tunggal (*Global Canonical Row-Locking DAG*: `leads -> bookings -> units -> kpr_applications -> deals -> payment_schedules -> payment_records -> follow_up_tasks -> site_visits`) dengan pengurutan deterministik `ORDER BY id` pada penguncian multi-baris, termasuk penguncian penuh `payment_schedules` & `payment_records` pada `TX-06` sebelum pemeriksaan `PENDING_VERIFICATION` dan perhitungan refund.
- [ ] **AC-06:** Seluruh mutasi multi-tabel pada `TX-01` s/d `TX-10` mencatat baris `audit_logs` dan event `notification_outbox` di dalam transaksi atomik yang sama.
- [ ] **AC-07:** `TX-04`, `TX-05`, `TX-06`, `TX-08`, `TX-09`, dan `TX-10` selaras penuh dengan pemisahan `current_stage` vs `application_status` (`File 02 v1.4`), aturan `chk_kpr_applications_loan_reconciliation` & `chk_kpr_applications_status_consistency`, serta keputusan final **`TC-01A`** (Unit hanya menjadi `'SOLD'` saat pencairan KPR mencapai 100% `'FULLY_DISBURSED'`).
- [ ] **AC-08:** Skrip pengujian integrasi pada Bagian 10.3 berhasil dieksekusi pada database PostgreSQL/Supabase dan melewati seluruh `ASSERT` tanpa kegagalan.

---

## 14. Troubleshooting

| No | Gejala / Pesan Error Saat Memanggil RPC | Penyebab Utama | Solusi Penyelesaian |
| :--- | :--- | :--- | :--- |
| **1** | `UNAUTHORIZED: Sesi pengguna tidak valid atau akun telah dinonaktifkan` saat menguji `TX-01`/`TX-02`/`TX-04`..`TX-10` di SQL Editor. | Anda memanggil fungsi RPC langsung di SQL Editor tanpa menyetel `request.jwt.claims` terlebih dahulu, sehingga `auth.uid()` bernilai `NULL`. | Gunakan `PERFORM set_config('request.jwt.claims', json_build_object('sub', '<UUID_USER>', 'role', 'authenticated')::text, true);` sebelum memanggil RPC di SQL Editor. |
| **2** | `UNAUTHORIZED: Pemanggil tanpa identitas sah atau tanpa hak service_role tidak diizinkan...` atau `FORBIDDEN` saat memanggil `TX-03`. | Pemanggil ber-role `SALES`/`SUPERVISOR`, atau koneksi tanpa `auth.uid()` tidak membawa klaim/role `service_role`. | Panggil `TX-03` hanya melalui backend terisolasi menggunakan `service_role` client (`createSupabaseAdminClient()`), atau sebagai pengguna `ADMIN` aktif. Di SQL Editor, simulasikan `SET LOCAL role = 'service_role'` + klaim `{"role":"service_role"}`. |
| **3** | `INVALID_DP_MATH` saat memanggil `rpc_create_booking`. | `p_is_booking_fee_part_of_dp` bernilai `true` dengan `agreed_dp < booking_fee`, atau pada metode `KPR` jumlah `BF + DP >= agreed_final_price`. | Pastikan total kesepakatan DP sesuai ketentuan metode bayar (`CASH_KERAS` wajib DP `0`; `KPR` wajib menyisakan pokok kredit $> 0$). |
| **4** | `PENDING_PAYMENT_EXISTS` saat Admin mencoba membatalkan Booking (`TX-06`). | Masih ada bukti pembayaran pelanggan yang berstatus `'PENDING_VERIFICATION'` pada Booking tersebut. | Admin wajib memverifikasi (`'VERIFIED'`) atau menolak (`'REJECTED'`) bukti bayar tersebut terlebih dahulu melalui `TX-02` sebelum membatalkan transaksi. |
| **5** | `DP_OR_TOPUP_UNPAID` saat Admin mencoba mengesahkan selesai Akad KPR (`TX-05`). | Terdapat tagihan `'BOOKING_FEE'`, `'DOWN_PAYMENT'`, atau `'KPR_TOPUP_DP'` (akibat turun plafon) yang belum berstatus `'PAID'`. | Lunasi dan verifikasi seluruh jadwal tagihan kewajiban pembeli pada Booking tersebut terlebih dahulu. |
| **6** | `MANDATORY_KPR_DOCS_UNVERIFIED` saat memajukan KPR ke `'SUBMITTED'` (`TX-09`). | Terdapat item pada `kpr_documents` yang bertanda `is_mandatory = true` namun statusnya belum `'VERIFIED'`. | Pastikan seluruh berkas wajib KPR telah diunggah oleh Sales dan diverifikasi (`'VERIFIED'`) oleh Admin sebelum dikirim ke bank. |
| **7** | `KPR_ALREADY_DISBURSED` / `CANNOT_CANCEL_COMPLETED` saat `TX-06` atau `TX-10`. | Pengajuan KPR sudah memasuki pencairan dana bank atau unit telah berstatus `'SOLD'`. | Transaksi yang sudah dicairkan/selesai tidak dapat dibatalkan melalui `TX-06`/`TX-10`; selesaikan penutupan transaksi secara administratif atau lakukan audit koreksi khusus. |

---

## 15. Checklist Penyelesaian

- [x] Perbaikan otorisasi ketat `TX-03` (`ADMIN` & `service_role` terverifikasi saja; blokir `SALES`, `SUPERVISOR`, dan `auth.uid() IS NULL` tanpa klaim `service_role`).
- [x] Penyatuan urutan penguncian baris global (*Global Canonical Row-Locking DAG*) pada `trg_00` dan seluruh `TX-01` s/d `TX-10` beserta *Staged Locking* di `TX-02` dan `ORDER BY id` di seluruh penguncian multi-baris.
- [x] Penguncian penuh `payment_schedules` & `payment_records` (`ORDER BY id FOR UPDATE`) di `TX-06` sebelum pemeriksaan `PENDING_VERIFICATION`, agregasi `VERIFIED`, perhitungan refund, dan pembatalan Booking dalam satu transaksi atomik.
- [x] Penutupan celah *snapshot* `READ COMMITTED` `PD-01` dan pemblokiran *double-processing* pada `TX-03` (`FOR UPDATE OF b SKIP LOCKED` + re-cek `PD-01` pasca-kunci).
- [x] Penegakan aturan konsistensi penuh: `SECURITY DEFINER` + `SET search_path = ''`, atomisitas `audit_logs` & `notification_outbox`, keputusan final `TC-01A`, pemisahan `current_stage` vs `application_status`, dan nol fitur cicilan bulanan bank / ML.
- [x] Pembaruan matriks & skrip SQL pengujian end-to-end (`Bagian 10.2` & `10.3`) termasuk negative test `TX-03`, proteksi `PD-01`, dan `PENDING_PAYMENT_EXISTS` pada `TX-06`.

---

## 16. Tahap Implementasi Berikutnya

Dengan selesainya **File 04 (`FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC_v1.3.md`)**, seluruh fondasi inti database—mulai dari **34 ENUM** dan **32 Tabel** (File 02 `v1.4`), **12 helper `app_security`**, **6 trigger guard**, dan **80 Kebijakan RLS** (File 03 `v1.1`), hingga **10 Mesin Transaksi Atomik RPC (`TX-01` s/d `TX-10`)** yang aman dari *deadlock*, *race condition*, dan eskalasi otorisasi—telah selaras penuh.

Catatan penyesuaian untuk dokumen downstream (**`File 05`** & **`File 06`**, tidak diubah pada revisi ini):
1. **Penyelarasan Storage & RLS Storage (`File 05`):** Penambahan validasi `kpr_applications.application_status IN ('IN_PROGRESS', 'APPROVED')`, pemblokiran unggah bukti bayar pada Booking `'EXPIRED'`/`'CANCELLED'`/`'COMPLETED'` atau jadwal `'PAID'`, serta validasi kepemilikan `refund_id`/`deal_id` terhadap `booking_id`.
2. **Penyelarasan Application Backend (`File 06`):**
   * **Pemanggilan `TX-03` (`rpc_expire_overdue_bookings`):** Pastikan seluruh jalur *Cron Sweep*, *Manual Sync*, maupun *Throttled On-Access Sweep* (`ReminderSweepOrchestrator.runFullSystemSweep()`) tetap memanggil `rpc_expire_overdue_bookings` melalui `createSupabaseAdminClient()` (`service_role`), bukan user-scoped client milik `SALES`/`SUPERVISOR` (yang akan ditolak dengan `42501`).
   * **Penyelarasan KPR & Transaksi Lainnya:** Penyesuaian tipe keputusan `'REJECTED_BY_BANK'` pada `TX-04`, pemanggilan `TX-09 (`rpc_advance_kpr_stage`)` & `TX-10 (`rpc_cancel_kpr_by_customer`)` secara atomik, penanganan event outbox tambahan, transaksi atomik untuk perpanjangan booking & termin *Cash Bertahap*, serta filter `application_status` pada metrik pencairan KPR.

---

## Changelog (`v1.2` $\rightarrow$ `v1.3`)

1. **Pengamanan Pemeriksaan & Penguncian `payment_records` pada `TX-06` (`rpc_cancel_booking_or_deal`):**
   * Menambahkan Langkah **2B** pada `TX-06` yang mengunci **seluruh baris `payment_schedules`** (`WHERE booking_id = v_booking.id ORDER BY ps.id FOR UPDATE`) dan **seluruh baris `payment_records`** (`WHERE booking_id = v_booking.id ORDER BY pr.id FOR UPDATE`) milik Booking sebelum memeriksa `PENDING_VERIFICATION`, menghitung total `VERIFIED`, serta menghitung nominal *refund*/*forfeited*.
   * Menyelaraskan Langkah **4B** agar mengunci `follow_up_tasks` (`ORDER BY fut.id FOR UPDATE`) tepat setelah validasi refund dan sebelum mutasi, sehingga seluruh penguncian di `TX-06` mematuhi arah tunggal `leads -> bookings -> units -> kpr_applications -> deals -> payment_schedules -> payment_records -> follow_up_tasks`.
   * Mencegah *race condition* antara pengajuan pembayaran baru (`trg_00_guard_payment_records_insert`), perubahan status verifikasi (`TX-02` maupun *direct update* `payment_records`), perhitungan *refund*, dan pembatalan Booking tanpa menimbulkan *deadlock*.
2. **Audit Keselarasan `TX-04`, `TX-05`, `TX-07`, `TX-02`, `TX-03`, dan `trg_00_guard_payment_records_insert`:**
   * Memverifikasi secara statis bahwa seluruh RPC (`TX-01` s/d `TX-10`) dan trigger pembayaran (`trg_00`) telah mengunci `bookings` (`FOR UPDATE` atau `FOR SHARE`) **sebelum** `payment_schedules` (`FOR UPDATE`) dan `payment_records` (`FOR UPDATE`), termasuk pada cabang turun plafon `TX-04`, penolakan `PD-01` pada `TX-02`, dan `TX-03`.
3. **Pembaruan Pengujian Integrasi (`Bagian 10.2` & `10.3`):**
   * Menambahkan skenario pengujian penolakan `TX-06` (`PENDING_PAYMENT_EXISTS`) saat masih ada bukti bayar `DOWN_PAYMENT` berstatus `'PENDING_VERIFICATION'`, dilanjutkan penolakan bukti bayar via `TX-02` dan eksekusi sukses `TX-06` dengan rekonsiliasi *refund* Rp 5.000.000 pada `UJI 7E`.

---

## Changelog (`v1.1` $\rightarrow$ `v1.2`)

1. **Perbaikan Otorisasi Kritis `TX-03` (`rpc_expire_overdue_bookings`):**
   * Menghapus celah keamanan yang menganggap `auth.uid() IS NULL` otomatis sebagai `'SYSTEM_AUTOMATION'`.
   * Menolak keras (`42501`) pemanggil `SALES`, `SUPERVISOR`, akun nonaktif, dan pemanggil `auth.uid() IS NULL` yang tidak memiliki klaim JWT `role = 'service_role'` (atau local session role `'service_role'` ketika klaim JWT kosong).
   * Membatasi pengguna interaktif hanya kepada **`ADMIN`** aktif, sementara `GRANT EXECUTE` tetap diberikan kepada `authenticated, service_role` agar `ADMIN` tetap dapat mengeksekusinya via PostgREST/Next.js sementara role non-Admin langsung ditolak oleh validasi internal.
2. **Penyeragaman Global Row-Locking DAG Anti-Deadlock (`trg_00` & `TX-01` s/d `TX-10`):**
   * Menetapkan satu hierarki penguncian global tunggal: `leads -> bookings -> units -> kpr_applications -> deals -> payment_schedules -> payment_records -> follow_up_tasks -> site_visits`.
   * **`trg_00_guard_payment_records_insert`:** Membalik urutan penguncian dari `payment_schedules -> bookings` menjadi **`bookings (FOR SHARE) -> payment_schedules (FOR UPDATE)`**, sehingga seragam dengan `TX-02`, `TX-03`, `TX-04`, dan `TX-06` serta menserialisasikan pengajuan pembayaran baru terhadap expiry/pembatalan Booking.
   * **`TX-02` (`rpc_verify_payment_record`):** Merefaktor total penguncian awal dari `payment_records -> payment_schedules -> leads -> bookings -> units -> deals` menjadi **Staged Locking** (`non-locking ID lookup` $\rightarrow$ `leads -> bookings -> units -> deals -> payment_schedules -> payment_records`), lalu memvalidasi status `PENDING_VERIFICATION` / Booking / jadwal setelah seluruh baris terkunci, serta menambahkan penguncian deterministik `ORDER BY id FOR UPDATE` untuk jadwal & `follow_up_tasks` pada cabang `'EXTEND_24H'` dan `'EXPIRE_NOW'`.
   * **`TX-07` (`rpc_reassign_lead`):** Menyesuaikan urutan penguncian dari `leads -> follow_up_tasks -> site_visits -> bookings -> deals -> kpr_applications -> units` menjadi **`leads -> bookings -> units -> kpr_applications -> deals -> follow_up_tasks -> site_visits`** dengan `ORDER BY id FOR UPDATE` di seluruh penguncian multi-baris.
   * **`TX-04`, `TX-05`, `TX-06`, `TX-08`, `TX-09`, `TX-10`:** Menambahkan pre-lock deterministik `ORDER BY id FOR UPDATE` pada seluruh `payment_schedules` dan `follow_up_tasks` sebelum mutasi, menyelaraskan urutan `kpr_applications -> deals`, dan menambahkan guard `IF NOT FOUND` pasca-penguncian.
3. **Penutupan Celah Konkurensi `TX-03` & Proteksi `PD-01`:**
   * Mengubah loop cursor `TX-03` menjadi penguncian batch awal `ARRAY(... ORDER BY b.expires_at ASC, b.id ASC ... FOR UPDATE OF b SKIP LOCKED)` sehingga panggilan Cron/Admin paralel tidak mengalami *double-processing* maupun terblokir transaksi aktif lain.
   * Menambahkan pemeriksaan ulang **`IF EXISTS (payment_records ... PENDING_VERIFICATION/VERIFIED)` setelah baris `bookings` terkunci** untuk menutup celah *snapshot* `READ COMMITTED` terhadap `INSERT INTO payment_records` konkuren oleh `trg_00`.
4. **Pembaruan Pengujian (`Bagian 10.2` & `10.3`), Acceptance Criteria (`Bagian 13`), & Catatan File 06 (`Bagian 16`):**
   * Menambahkan skenario uji negatif otorisasi `TX-03` (`SALES`, `SUPERVISOR`, dan `auth.uid() IS NULL` non-`service_role`), skenario `service_role`, serta verifikasi proteksi `PD-01` terhadap bukti bayar `PENDING_VERIFICATION` pada skrip SQL `BEGIN ... ROLLBACK`.
