# AGENTS.md — Pedoman Kerja AI Coding Agent (FIM-Property CRM)

Dokumen ini adalah pedoman operasional utama bagi setiap AI coding agent yang mengerjakan proyek **FIM-Property CRM**. Seluruh implementasi wajib konsisten, terstruktur, aman, dapat diuji, dan sepenuhnya patuh pada spesifikasi resmi proyek.

---

## 1. Project Context

* **Nama & Sifat Produk:** **FIM-Property CRM** adalah aplikasi web CRM dan manajemen transaksi penjualan properti internal khusus **satu perusahaan (PT FIM-Property — Single-Company Internal CRM)**.
* **Pengguna Sistem:** Hanya melayani **3 role internal** yang seluruh akunnya dibuat dan dikelola oleh Admin (`enable_signup = false`, tanpa registrasi publik):
  * **`ADMIN`:** Akses operasional, katalog, keuangan, verifikasi pembayaran & KPR, pembatalan/refund, manajemen user/tim, log audit, dan sinkronisasi sistem lintas perusahaan.
  * **`SUPERVISOR`:** Pemimpin satu Tim Sales aktif. Mengelola & memantau prospek/tugas/survei dalam **tim aktifnya sendiri**, serta melihat transaksi, pembayaran, KPR, dan Deal timnya secara *read-only*.
  * **`SALES`:** Mengelola prospek, aktivitas, tugas, *site visit*, mengajukan *Booking*, mengunggah bukti bayar, dan mengunggah dokumen persyaratan KPR (simulasi/fiktif) **miliknya sendiri di dalam tim aktifnya**.
* **Ringkasan Ruang Lingkup (*In-Scope*):**
  * Autentikasi SSR & manajemen tim/staf, Dashboard & Laporan sesuai Kamus Metrik Standar, Manajemen Lead & Pipeline 9 tahap, *Lead Scoring* deterministik 4 indikator (`OQ-04`), *Follow-Up Tasks* (termasuk tautan ke jadwal tagihan & pengajuan KPR) & *Site Visits*, Katalog Properti/Harga/Promo + matriks unit (`OQ-05`), *Booking* (tahan unit 72 jam + *Price Freeze*), Verifikasi Pembayaran (SLA >24/48 jam) & *Refund*, tiga metode bayar (**Cash Keras**, **Cash Bertahap** dengan Kebijakan C2, dan **KPR** 10 tahap hingga pencairan 100% `TC-01A`), Manajemen *Deal* 3 dimensi, Penyimpanan Privat (`fim-private-documents`, maks. 5 MB, *Signed URL* 300 detik), *Hybrid Reminder Engine*, dan *Audit Logs*.
* **Batasan Mutlak (*Out-of-Scope* — Dilarang Ditambahkan):**
  1. **Bukan Multi-Tenant:** Tidak ada `tenants`, `organizations`, `tenant_id`, subdomain penyewa, atau penagihan SaaS.
  2. **Tanpa Machine Learning / AI Prediktif:** Tidak ada model ML, inferensi AI, prediksi otomatis berbasis AI, atau *chatbot*. Penilaian prospek murni menggunakan rumus aturan deterministik (`OQ-04`).
  3. **Tanpa Pemantauan Cicilan Bank KPR Pasca-Pencairan:** Modul KPR berhenti saat pencairan dana bank mencapai 100% (`FULLY_DISBURSED`). Jadwal termin `INSTALLMENT` hanya berlaku untuk **Cash Bertahap** kepada PT FIM-Property.
  4. **Tanpa Payment Gateway, Blast Eksternal, & Hard Delete:** Verifikasi transfer dilakukan manual oleh Admin; notifikasi hanya internal aplikasi; tidak ada penghapusan fisik data historis.

---

## 2. Documentation Priority & Conflict Protocol

### 2.1 Hierarki Acuan Resmi
1. **`PRD.md` (`v1.1`):** Sumber kebenaran tertinggi untuk ruang lingkup produk, alur bisnis, dan *business rules*.
2. **`DESIGN.md` (`v2.1`):** Sumber kebenaran untuk sistem desain, token warna/tipografi, komponen UI, tata letak per role, responsivitas, dan batasan tampilan antarmuka.
3. **Enam Dokumen Implementasi Teknis (Acuan Teknis Kode & SQL):**
   * `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`
   * `FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`
   * `FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS_v1.1.md`
   * `FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC_v1.3.md`
   * `FIM-PROPERTY_IMPLEMENTATION_05_STORAGE_DOCUMENTS_v1.1.md`
   * `FIM-PROPERTY_IMPLEMENTATION_06_APPLICATION_BACKEND_v1.1.md`

> Gunakan **hanya versi terbaru** di atas. Jangan mengacu pada file versi lama (`02 v1.1–v1.3`, `04 v1.1–v1.2`).

### 2.2 Aturan Penanganan Konflik
* Jika ditemukan konflik aturan antar dokumen atau ketidaksesuaian dengan kode yang ada, **BERHENTI pada bagian yang konflik dan laporkan secara jelas kepada pengguna**.
* **Dilarang** membuat keputusan sepihak yang mengubah *business rules*, melemahkan otorisasi, atau mengubah kontrak skema database secara diam-diam.

### 2.3 Daftar Perbedaan Antar-Dokumen yang Sudah Teridentifikasi
Saat menyentuh area berikut, wajib ikuti ketetapan yang sudah ditetapkan dan konfirmasikan penyesuaian kode teknisnya kepada pengguna sebelum mengeksekusi:

1. **Otoritas Sinkronisasi Sistem (`Sinkronisasi Sistem` vs `TX-03`):**
   * `PRD.md v1.1` (Bag. 4, 6.2, 6.13, 8.4) dan **File 04 `v1.3`** (`TX-03 rpc_expire_overdue_bookings`) membatasi evaluasi global & kedaluwarsa Booking massal **hanya untuk `ADMIN` dan proses `Cron` (`service_role`)**, serta melarang `SUPERVISOR` menjalankan evaluasi lintas perusahaan.
   * Namun **File 06 `v1.1`** (`runManualSystemSweepAction`) dan **`DESIGN.md v2.1`** (Bag. 5.1 & 7.2) masih mencantumkan `SUPERVISOR` pada tombol *Sinkronisasi Sistem* yang memanggil `ReminderSweepOrchestrator.runFullSystemSweep()`.
   * **Ketetapan:** Jangan mengizinkan `SUPERVISOR` memicu evaluasi global atau memanggil `TX-03`. Sebelum mengimplementasikan `notifications.actions.ts` dan UI topbar/dashboard Supervisor, konfirmasikan penghapusan akses sweep global dari Supervisor (atau pembatasan khusus tim bila diminta pengguna).
2. **Privasi Pemegang Unit (`OQ-05`):**
   * **File 03 `v1.1`** (`v_staff_directory` & `v_unit_catalog`) menyediakan kolom nama lengkap staf & nama tim di view database, sedangkan **`DESIGN.md v2.1`** (Bag. 6.2) dan **`PRD.md v1.1`** (Bag. 6.5 & 8.4) mewajibkan UI **hanya** menampilkan **Nama Depan Sales + Kode Tim Sales** (contoh: `Fariz • TIM-01`).
   * **Ketetapan:** UI dan DTO klien tidak boleh menampilkan nama lengkap, email, maupun nomor telepon pemegang unit. Konfirmasikan jika diperlukan penyesuaian view/query agar data berlebih tidak ikut dikirim ke klien.
3. **Versi Kontrak ENUM, `TC-01A`, Jumlah RPC, & Skrip Lint pada File 01 vs File 02–06:**
   * **File 01 `v1.1`** (`src/types/database.types.ts` & Bag. 10.2) masih mencatat `TC-01` sebagai *pending*, menyebut 33 ENUM / 8 RPC, dan menyertakan `'REJECTED'` di `KprStage`.
   * **File 02 `v1.4`–06 `v1.1`**, **`PRD.md v1.1`**, dan **`DESIGN.md v2.1`** sudah final menetapkan **34 ENUM** (`kpr_stage_enum` berisi 10 tahap murni tanpa `'REJECTED'` + `kpr_application_status_enum`), **10 RPC (`TX-01`–`TX-10`)**, dan kebijakan final **`TC-01A`** (Unit `SOLD` hanya saat pencairan 100% `FULLY_DISBURSED`).
   * Pada konfigurasi script `package.json`, ikuti **File 01 `v1.1`** (`"lint": "eslint ."`, karena `next lint` tidak berlaku di Next.js 16+).

---

## 3. Development Principles (Anti-Slop)

1. **Kesederhanaan yang Benar:** Pilih solusi paling sederhana yang memenuhi spesifikasi secara tepat. Jangan menulis kode rumit hanya agar terlihat canggih.
2. **Larangan Overengineering:** Jangan membuat abstraksi generik berlebihan, *wrapper* berlapis tanpa fungsi, *factory/strategy* yang tidak diminta, atau menambah dependency npm di luar stack yang ditetapkan tanpa persetujuan pengguna.
3. **Zero Duplication:** Jangan menduplikasi aturan bisnis, validasi, kalkulator skor, atau penerjemah error. Gunakan kembali modul terpusat (`ProspectScoringCalculator`, `app-error.ts`, `storage.validator.ts`, layanan domain).
4. **No Placeholder / Fake Implementation:** Dilarang membuat fungsi kosong, komentar `// TODO: implement later`, data mock, atau API palsu seolah-olah fitur sudah berfungsi penuh.
5. **No Silent Error Swallowing:** Jangan menutupi kegagalan dengan fallback samar atau mengabaikan `error` dari query Supabase. Selalu periksa `{ data, error }`, catat via `serverLogger`, dan kembalikan `ActionResult<T>` yang aman dengan `correlationId`.
6. **Zero Hallucination:** Jangan mengarang tabel, kolom, nilai ENUM, endpoint, aturan bisnis, atau komponen UI yang tidak ada dalam dokumen acuan.
7. **Keterbacaan & Kemudahan Uji:** Utamakan kode eksplisit, penamaan jelas sesuai istilah domain, fungsi fokus, dan mudah diuji secara otomatis.

---

## 4. Architecture & Coding Standards

* **Stack Resmi:** Next.js (App Router), TypeScript (*strict mode*), Tailwind CSS (`@import "tailwindcss";` & `@theme inline`), Lucide React, `clsx` + `tailwind-merge` (`cn`), Supabase (`@supabase/supabase-js`, `@supabase/ssr`, PostgreSQL 15+, Private Storage), Zod, dan `server-only`.
* **Arsitektur Modular Monolith & Topological DAG ($L_0 \dots L_{11}$):**
  * Pertahankan batas struktur `src/types/`, `src/lib/`, `src/components/`, `src/modules/` (`shared`, `identity`, `catalog`, `crm`, `transactions`, `notifications-engine`, `analytics`), dan `src/app/`.
  * Patuhi arah ketergantungan asiklik (*zero circular dependency*): modul Level $L_0$ (`app-error`, `server-logger`, `prospect-scoring.calculator`, `storage/*`, `audit.sink`, `notification.sink`) **dilarang** mengimpor modul bisnis di atasnya.
* **Pemisahan Ketat Server vs Client:**
  * **Server Components (`page.tsx`, `layout.tsx`):** Memeriksa sesi (`requirePageAuth()` / `requireAuthContext()`) dan mengambil data awal melalui *Service Layer*.
  * **Client Components (`'use client'`):** Hanya untuk interaksi UI, form, modal, dan memanggil *Server Actions*. **Dilarang keras** mengimpor `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/lib/env/server.ts`, atau *Service Layer*, dan dilarang menghitung skor prospek maupun menjalankan mutasi bisnis langsung di browser.
  * **Server Actions (`*.actions.ts`):** Wajib dibungkus `executeSafeServerAction` dengan alur baku: `requireActionAuth(allowedRoles)` $\rightarrow$ validasi **Zod** (*field whitelisting* / anti-*mass assignment*) $\rightarrow$ *Service* / *Use-Case* / *RPC* $\rightarrow$ `revalidatePath(...)` $\rightarrow$ `ActionResult<T>`.
  * **Pure Domain Logic ($L_0$):** Kalkulator aturan bisnis (`ProspectScoringCalculator`) harus murni TypeScript tanpa dependensi database/I/O.
* **Standar Kode TypeScript & Lint:**
  * Wajib lolos `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, dan `noUncheckedIndexedAccess: true`.
  * Dilarang menggunakan `any` (`@typescript-eslint/no-explicit-any: error`) dan variabel tidak terpakai; gunakan `serverLogger` untuk log server.
  * Jangan membuat file atau modul baru di luar peta arsitektur tanpa kebutuhan yang jelas dan terverifikasi.

---

## 5. Security & Data Integrity

1. **Pertahanan 4 Lapis (Zero Client Trust):**
   * *Gerbang 1:* `src/proxy.ts` (atau `src/middleware.ts` pada Next.js 15) untuk penyegaran cookie sesi, proteksi rute, dan validasi `Bearer CRON_SECRET` pada `/api/cron/*`.
   * *Gerbang 2:* Otorisasi server (`requireAuthContext()` / `requireActionAuth()`, `assertTeamScopeAccess()`, `assertResourceOwnership()`). **Wajib** memanggil `supabase.auth.getUser()` di server — **dilarang** memakai `auth.getSession()` untuk keputusan otorisasi.
   * *Gerbang 3 & 4:* PostgreSQL `GRANT`/`REVOKE`, 6 *Security Guard Triggers* (`trg_00_guard_*`), schema privat `app_security` (tersembunyi dari PostgREST `config.toml`), dan 80 kebijakan RLS pada 32 tabel.
2. **Isolasi Rahasia & Service Role Key:**
   * Jangan pernah mengekspos `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, atau modul `server-only` ke klien.
   * `createSupabaseAdminClient()` **hanya** digunakan di server untuk: manajemen akun Auth oleh Admin (`auth.admin.*` + sinkronisasi *Auth Ban*), *compensating cleanup* file yatim di Storage (setelah lolos `isValidStorageObjectPath()`), dan tugas sistem terverifikasi (`CRON_SECRET` / `AuditSink` / `NotificationSink`). Dilarang memakainya untuk query operasional biasa Sales/Supervisor.
3. **Kepatuhan Transaksi Atomik (RPC `TX-01` s/d `TX-10`):**
   * Seluruh mutasi multi-tabel (Booking, Verifikasi Bayar, Booking Expiry, Keputusan KPR/SP3K, Transisi Deal, Pembatalan/Refund, Reassignment Lead, Pencairan KPR, Majukan Tahap KPR, Pembatalan KPR Konsumen) **wajib** melalui fungsi RPC atomik, tidak boleh dipecah menjadi beberapa `.from(...).update(...)` terpisah.
   * Pertahankan urutan penguncian baris global anti-deadlock (*Global Canonical Row-Locking DAG*: `leads -> bookings -> units -> kpr_applications -> deals -> payment_schedules -> payment_records -> follow_up_tasks -> site_visits`).
4. **Integritas Aturan Bisnis & Audit:**
   * Jaga `No Hard Delete` (`BR-08`, `BR-10`), *Price Freeze* (`BR-07`), *Anti-Double Counting Booking Fee* (`BR-06`), *Segregation of Duties* (Sales tidak bisa verifikasi bayar/KPR sendiri), perlindungan bukti `PENDING_VERIFICATION` atas kedaluwarsa 72 jam (`PD-01`), kebijakan C2 *Cash Bertahap* (`PD-03`), kebijakan final `TC-01A`, serta pelestarian histori & atribusi *Sales asal* saat *reassignment* (`TX-07`).
   * Jangan pernah menghapus, menonaktifkan, atau melemahkan batasan keamanan/RLS/trigger demi mempermudah implementasi.
5. **Keamanan Storage (`fim-private-documents`):**
   * Bucket wajib `public = false`, batas ukuran 5 MB (`5242880` bytes), `upsert: false`, validasi tipe file + *Magic Bytes* di server, validasi path ketat, pra-cek status transaksi di DB sebelum unggah, *compensating cleanup* bila insert/RPC DB gagal, dan akses baca hanya via *Signed URL* **300 detik**. Dokumen KPR uji/demo wajib menggunakan dokumen fiktif (`OQ-06`).

---

## 6. UI/UX Standards

* **Konsistensi Visual (`DESIGN.md v2.1`):**
  * Gunakan palet **Forest Green** (`#14532D`) & **Emerald** (`#059669`) di atas kanvas netral (`#F8FAFC`, `#FFFFFF`), border `1px solid #E2E8F0`, elevasi ringan netral, tanpa gradasi mencolok, tanpa *neon/colored glow*, tanpa animasi memantul/confetti, dan tanpa gaya *pill* berlebihan (radius `9999px` hanya untuk avatar & *unread dot*).
  * Gunakan font `Inter` (`--font-inter`) dan `JetBrains Mono` (`--font-jetbrains-mono` $\rightarrow$ `--font-mono`, khusus ID/kode referensi), dengan `tabular-nums` dan rata kanan untuk nominal IDR, skor, dan tanggal.
  * Gunakan hanya ikon `lucide-react` (`strokeWidth={1.75}`), tanpa emoji pada elemen navigasi/status.
* **Kejujuran Domain & Role-Based UI:**
  * Tampilkan status persis sesuai ENUM database resmi; **jangan** menggabungkan `kpr_applications.current_stage`, `application_status`, dan `disbursement_status` menjadi satu badge ambigu.
  * Terapkan privasi pemegang unit (`OQ-05`): tampilkan hanya **`Nama Depan Sales • Kode Tim Sales`** (`Fariz • TIM-01`).
  * Sembunyikan/nonaktifkan tombol mutasi yang tidak dimiliki role pengguna (ingat: UI hanya *UX disclosure*, keamanan mutlak tetap di server & RLS).
* **States, Konfirmasi, & Responsivitas:**
  * Sediakan *loading state* (skeleton tabel/kartu + tombol disabled dengan `Loader2` saat `isPending`), *empty state* terarah, *error state* aman disertai `correlationId`, dan *success toast/feedback*.
  * Setiap mutasi berisiko/destruktif (`TX-02 Reject`, `TX-04 Rejection`, `TX-06 Cancel`, `TX-07 Reassign`, `TX-10 Cancel KPR`, penonaktifan akun) wajib memakai dialog konfirmasi eksplisit dan input alasan wajib.
  * Rancang *Desktop-first* (`>= 1280px`) dan *Mobile-friendly* (`< 768px` transformasi tabel ke kartu, target sentuh minimal `44px`), lengkap dengan fokus aksesibilitas dan `prefers-reduced-motion`.

---

## 7. Implementation Workflow

1. **Bertahap & Terbatas:** Kerjakan proyek per tahap/modul yang jelas (mis. Setup $\rightarrow$ Migrasi DB $\rightarrow$ Auth/RLS $\rightarrow$ RPC $\rightarrow$ Storage $\rightarrow$ Backend Services $\rightarrow$ UI per Modul). Dilarang membangun seluruh sistem sekaligus dalam satu langkah besar.
2. **Baca Dulu Sebelum Ubah:** Baca bagian terkait pada `PRD.md`, `DESIGN.md`, dan File Implementasi `01–06`, lalu periksa kode yang sudah ada di repositori sebelum membuat atau mengubah file.
3. **Jaga Lingkup Tugas:** Hanya ubah file yang memang berkaitan dengan tahap yang sedang diminta. Jangan menyentuh modul lain yang tidak relevan.
4. **Verifikasi Wajib Setelah Perubahan:**
   * Jalankan `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`eslint .`), dan pengujian otomatis yang relevan setelah setiap perubahan kode.
   * Jika mengubah migrasi SQL / skema database, pastikan `npm run db:reset` / verifikasi SQL dan pembaruan `npm run db:types` ikut dijalankan atau diinstruksikan dengan jelas.
5. **Kejujuran Status:** Dilarang menyatakan tugas selesai jika kompilasi, lint, atau pengujian belum diverifikasi.

---

## 8. Testing & Verification

* **Pengujian Berbasis Aturan Bisnis & Keamanan:** Buat dan jalankan pengujian yang memverifikasi perilaku nyata, bukan sekadar tampilan UI (*smoke render*):
  1. **Otorisasi & Batas Role:** Uji kasus positif dan negatif untuk `ADMIN`, `SUPERVISOR`, `SALES`, serta `anon` (mis. `SALES` ditolak memverifikasi pembayaran/KPR, `SUPERVISOR` bersifat *read-only* di transaksi dan dilarang menjalankan sweep global).
  2. **Isolasi Tim & Keaktifan Akun:** Pastikan `SALES`/`SUPERVISOR` tidak dapat membaca atau memutasi data tim lain, akun `is_active = false` langsung terblokir, dan perpindahan tim langsung memutus akses tim lama.
  3. **Integritas Transaksi & Concurrency:** Uji pencegahan *double booking* (`TX-01`), penahanan unit 72 jam saat ada bukti `PENDING_VERIFICATION` (`PD-01`), urutan locking anti-deadlock, aturan `TC-01A` (`PARTIALLY_DISBURSED` tetap `BOOKED`, `FULLY_DISBURSED` menjadi `SOLD`), Kebijakan C2, dan pelestarian `origin_sales_id` pada `TX-07`.
  4. **Validasi Input & Storage:** Uji penolakan *mass assignment* (Zod), file $>5\text{ MB}$, spoofing MIME/*Magic Bytes*, *path traversal*, penolakan timpa dokumen `VERIFIED`, dan *compensating cleanup* saat DB gagal.
* **Pelaporan Jujur:** Laporkan persis perintah pengujian yang dijalankan beserta hasilnya (lulus/gagal), dan sebutkan secara eksplisit pengujian apa saja yang **belum** dijalankan.

---

## 9. Supabase Learning Workflow

Pengguna masih dalam tahap belajar menggunakan Supabase. Setiap kali suatu tahap membutuhkan konfigurasi atau tindakan pada **Supabase (Lokal Studio maupun Cloud Dashboard)**, AI coding agent wajib mematuhi aturan berikut:

1. **Pisahkan Tanggung Jawab dengan Jelas:**
   * Tandai secara eksplisit mana bagian **`[Dikerjakan oleh AI Agent]`** (mis. menulis file migrasi SQL, TypeScript client, Zod schema, skrip uji) dan mana bagian **`[Dilakukan oleh User]`** (mis. menjalankan Docker, menyalin kunci ke `.env.local`, mengatur menu di Supabase Dashboard/Studio).
2. **Instruksi Langkah-demi-Langkah Tanpa Asumsi:**
   * Jangan berasumsi pengguna sudah hafal letak menu Supabase. Sebutkan jalur menu secara spesifik (misal: *Supabase Studio Lokal `http://127.0.0.1:54323` $\rightarrow$ Menu kiri `SQL Editor` $\rightarrow$ `New query`*, atau di Cloud Dashboard: *`Project Settings` $\rightarrow$ `API` / `Authentication` $\rightarrow$ `Providers`*).
   * Jelaskan fungsi setiap konfigurasi (mis. mengapa `enable_signup = false`, mengapa schema `app_security` disembunyikan dari `schemas`, perbedaan *Publishable/Anon Key* vs *Secret/Service Role Key*).
3. **Sertakan SQL & Cara Memverifikasi:**
   * Berikan kueri SQL verifikasi siap tempel beserta hasil yang diharapkan (*expected output*) agar pengguna bisa memastikan konfigurasi berhasil.
4. **Larangan Keamanan Kredensial:**
   * **DILARANG KERAS** meminta pengguna membagikan, menempelkan ke chat, atau mengirimkan nilai `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, password database, atau token rahasia lainnya. Selalu arahkan pengguna untuk mengisi kunci tersebut langsung di `.env.local` (atau Environment Variables di Vercel) secara mandiri.

---

## 10. Reporting Standard

Setiap kali menyelesaikan satu tahap atau tugas, berikan laporan ringkas dan terstruktur dengan 5 bagian berikut:

1. **Yang Dikerjakan:** Ringkasan objektif fitur/modul atau pemeriksaan yang diselesaikan.
2. **File yang Dibuat atau Diubah:** Daftar path file yang disentuh beserta perannya.
3. **Pengujian & Verifikasi yang Dijalankan:** Perintah yang dieksekusi (`typecheck`, `lint`, test, atau verifikasi SQL), hasil nyatanya, dan daftar hal yang belum dijalankan/diuji.
4. **Masalah Penting / Konflik yang Ditemukan:** Kendala teknis, bug, atau perbedaan antar dokumen spesifikasi (jika ada).
5. **Langkah Berikutnya:** Rekomendasi tahap lanjutan yang logis dan instruksi tindakan pengguna (jika ada langkah Supabase/lingkungan).

---

## 11. Scope & File Modification Guardrails

* **Jangan membuat dokumentasi tambahan yang redundan** di luar permintaan pengguna.
* **Jangan mengubah** `PRD.md`, `DESIGN.md`, maupun keenam file `FIM-PROPERTY_IMPLEMENTATION_*.md` ketika diminta mengerjakan implementasi kode—kecuali ditemukan konflik atau kesalahan kritis yang harus dilaporkan dan disetujui terlebih dahulu.
