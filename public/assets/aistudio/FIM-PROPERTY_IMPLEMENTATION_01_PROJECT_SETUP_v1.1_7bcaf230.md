# FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md

* **Nama File:** `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`
* **Versi Dokumen:** `1.1` *(Revisi terhadap `v1.0` untuk menyelaraskan konteks proyek terbaru, kesiapan implementasi ulang berbasis Codex, dan sinkronisasi lintas File 02–06)*
* **Tujuan Dokumen:** Menjadi panduan implementasi teknis langkah-demi-langkah (*end-to-end*) yang menjadi acuan resmi untuk menginisialisasi ulang repositori proyek **FIM-Property CRM** (termasuk saat dieksekusi menggunakan **Codex**), mengonfigurasi lingkungan pengembangan lokal (**Next.js App Router**, **TypeScript**, **Tailwind CSS**, dan **Supabase Local Development**), menyiapkan manajemen sesi **Supabase SSR**, mengisolasi kredensial rahasia (*Environment Variables*), mendefinisikan kontrak tipe dasar (33 ENUM & konteks sesi), serta menegakkan struktur direktori **Modular Monolith** sesuai spesifikasi arsitektur.
* **Ruang Lingkup:**
  1. Spesifikasi *Technology Stack* dan alasan arsitektural pemilihannya untuk FIM-Property (*Single-Company CRM*, tanpa *Machine Learning*, dan pemantauan pengajuan KPR tanpa cicilan bulanan).
  2. Prasyarat perangkat keras dan perangkat lunak (*Prerequisites*).
  3. Inisialisasi proyek Next.js App Router dengan TypeScript.
  4. Konfigurasi Tailwind CSS dan utilitas fondasi antarmuka.
  5. Instalasi dan verifikasi Supabase CLI.
  6. Inisialisasi dan konfigurasi keamanan Supabase Local Development (`supabase/config.toml`).
  7. Instalasi paket Supabase SSR (`@supabase/ssr`, `@supabase/supabase-js`, `server-only`, `zod`).
  8. Struktur direktori proyek (*Strict Topological DAG* $L_0 \dots L_{11}$).
  9. Aturan pemisahan *Server Component* dan *Client Component*.
  10. Konfigurasi dan validasi *Environment Variables* (pemisahan *Publishable/Anon Key* vs *Secret/Service Role Key*).
  11. Implementasi kontrak tipe dasar (`src/types/database.types.ts`) dan Supabase Client untuk Browser, Server SSR, dan Server Admin.
  12. Implementasi manajemen sesi pada *Request Boundary* (`src/proxy.ts` pada Next.js 16+ / `src/middleware.ts` pada Next.js 15).
  13. Konfigurasi ketat TypeScript (`tsconfig.json`).
  14. Konfigurasi ESLint (`eslint.config.mjs`) untuk disiplin kualitas kode dan keamanan.
  15. Konfigurasi skrip otomatisasi pada `package.json`.
  16. Inisialisasi Git dan konfigurasi `.gitignore`.
  17. Prosedur menjalankan dan memverifikasi proyek secara lokal.
  18. Panduan *Troubleshooting* untuk kendala *setup* yang umum.
  19. *Acceptance Criteria* (Kriteria Keberterimaan Tahap Setup).
* **Referensi Dokumen Utama:**
  1. `FIM-PROPERTY_MASTER_BUSINESS_DISCOVERY_v1.2_FINAL.md`
  2. `FIM-PROPERTY_PHASE_1A_SYSTEM_ARCHITECTURE_v1.2.md`
  3. `FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0.md`
  4. `FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.1.md`
* **Dependency terhadap File Lain:**
  * Dokumen ini adalah **File Implementasi Pertama (01)** dan tidak bergantung pada file kode sebelumnya.
  * Dokumen ini menjadi prasyarat wajib sebelum mengeksekusi:
    * **File 02 (`FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION`):** Migrasi SQL 33 ENUM, 32 Tabel, Constraints & Indexes.
    * **File 03 (`FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS`):** Autentikasi SSR, `auth.guards.ts`, Grants, schema privat `app_security`, dan kebijakan RLS 32 Tabel.
    * **File 04 (`FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC`):** 8 Fungsi Transaksi Atomik PostgreSQL (`TX-01` s/d `TX-08`).
    * **File 05 (`FIM-PROPERTY_IMPLEMENTATION_05_STORAGE_DOCUMENTS`):** Bucket privat `fim-private-documents`, Storage RLS, dan manajemen dokumen.
    * **File 06 (`FIM-PROPERTY_IMPLEMENTATION_06_APPLICATION_BACKEND`):** Fondasi error & logger (`AppError`, `serverLogger`), validator Zod, kalkulator skor deterministik (non-ML), *Service Layer*, *Server Actions*, Cron Sweep, dan *Metrics Service*.
* **Status Eksekusi:** Spesifikasi ini siap digunakan sebagai acuan langsung implementasi ulang repositori proyek (baik secara manual maupun otomatis menggunakan **Codex**).

---

## 1. TECHNOLOGY STACK DAN ALASAN PEMILIHANNYA

Pemilihan teknologi untuk **FIM-Property** didasarkan langsung pada karakteristik operasional CRM untuk **satu perusahaan (Single-Company Internal CRM — bukan sistem multi-tenant)** yang membutuhkan integritas transaksi tinggi, keamanan berlapis berbasis peran (**Admin**, **Supervisor**, **Sales**), serta kemudahan *deployment*:

| Komponen Teknologi | Peran dalam Sistem | Alasan Teknis Pemilihan untuk FIM-Property |
| :--- | :--- | :--- |
| **Next.js (App Router)** | Full-Stack Web Framework | Mendukung *React Server Components (RSC)* dan *Server Actions* dalam satu proyek **Modular Monolith** (tanpa overhead layanan terpisah maupun abstraksi *multi-tenant*). Data sensitif (seperti pemantauan piutang & jadwal cicilan *Cash Bertahap*, verifikasi pembayaran, dan pemantauan progres pengajuan KPR konsumen) diproses dan divalidasi langsung di sisi server tanpa mengekspos logika bisnis ke browser. |
| **TypeScript (Strict Mode)** | Bahasa Pemrograman Utama | FIM-Property memiliki 32 tabel, 33 tipe ENUM, dan 4 dimensi status Deal yang saling berinteraksi. *Static typing* yang ketat mencegah kesalahan pengiriman parameter pada transaksi finansial (seperti tertukarnya nominal `booking_fee_amount` dengan `agreed_dp_total_amount`). |
| **Supabase PostgreSQL (v15+)** | Basis Data Relasional & Mesin Transaksi | Bisnis properti menuntut konsistensi ACID mutlak: pencegahan *double-booking* melalui `SELECT ... FOR UPDATE`, *Composite Foreign Keys*, *Partial Unique Indexes*, serta eksekusi 8 transaksi atomik multi-tabel (`TX-01` s/d `TX-08`) melalui fungsi PL/pgSQL (`.rpc()`). |
| **Supabase Auth & `@supabase/ssr`** | Autentikasi & Manajemen Sesi | Menyediakan manajemen identitas berbasis JWT yang disimpan di dalam *HTTP-Only Cookie* melalui `@supabase/ssr`. Identitas pengguna (`auth.uid()`) diteruskan secara otomatis dari Next.js ke mesin PostgreSQL untuk dievaluasi oleh **Row Level Security (RLS)**. |
| **Supabase Private Storage** | Penyimpanan Dokumen Sensitif | Bukti transfer pembayaran pelanggan, berkas KTP/NPWP/Slip Gaji pengajuan KPR (data fiktif untuk pengujian/demo), bukti pencairan bank, bukti refund, dan dokumen kontrak PPJB tidak boleh diakses publik. Supabase Private Storage mendukung kebijakan RLS pada `storage.objects` dan pembangkitan *Signed URL* berbatas waktu (300 detik). |
| **Tailwind CSS** | Styling & Sistem Desain | Memungkinkan pembangunan antarmuka responsif (*Desktop-first* untuk tabel analitik Admin/Supervisor dan *Mobile/Tablet-friendly* untuk Sales saat *Site Visit* di lapangan) tanpa overhead CSS runtime. |
| **Zod** | Validasi Skema Server & Environment | Menjamin seluruh *Environment Variables* dan seluruh payload input dari formulir pengguna divalidasi secara ketat di **Layer 3 (Application Layer)** sebelum menyentuh database. |
| **Vercel** | Platform Deployment & Cron | Terintegrasi langsung dengan Next.js App Router dan menyediakan fitur *Vercel Cron Jobs* untuk mengeksekusi penyapuan harian (*Hybrid Reminder Engine* — `PD-05`). |

> **Batasan Teknis & Cakupan Sistem pada Tahap Setup:**
> 1. **Single-Company CRM (Non-Multi-Tenant):** Tidak menggunakan paket, routing subdomain, atau mekanisme isolasi *tenant* (`tenants` / `organization_id`).
> 2. **Tanpa Machine Learning (Non-ML):** Sistem **tidak** menggunakan *Machine Learning* maupun fitur prediksi berbasis ML. Fitur *Lead Scoring* di `src/modules/shared/scoring-calculator/` diimplementasikan murni sebagai aturan deterministik di TypeScript berdasarkan 4 indikator `OQ-04`, sehingga tidak memerlukan runtime Python, model ML, atau layanan inferensi eksternal.
> 3. **Cakupan Fitur KPR:** Modul KPR berfokus pada pemantauan perkembangan tahapan pengajuan KPR konsumen (dokumen persyaratan, pengajuan ke bank, SP3K/persetujuan, akad, hingga pencairan dana bank), dan **tidak** mencakup pemantauan cicilan bulanan KPR setelah akad/pencairan. Jadwal termin cicilan (`INSTALLMENT`) di sistem hanya digunakan untuk metode pembayaran *Cash Bertahap*.

---

## 2. PRASYARAT PERANGKAT DAN SOFTWARE (PREREQUISITES)

Sebelum memulai inisialisasi proyek, pastikan lingkungan eksekusi (mesin lokal maupun lingkungan kerja implementasi) memenuhi spesifikasi perangkat keras dan perangkat lunak berikut:

### 2.1 Spesifikasi Perangkat Keras Minimum
* **RAM:** Minimal **8 GB** (Direkomendasikan **16 GB** karena Docker akan menjalankan kontainer PostgreSQL, GoTrue Auth, PostgREST, Storage, Kong API Gateway, dan Supabase Studio secara bersamaan dengan server kompilasi Next.js).
* **Ruang Penyimpanan Kosong (Disk):** Minimal **15 GB** ruang kosong untuk *image* Docker Supabase dan `node_modules`.

### 2.2 Perangkat Lunak Wajib & Cara Memeriksa Versinya
Buka terminal (PowerShell / WSL2 pada Windows, atau Terminal pada macOS/Linux) dan jalankan perintah pemeriksaan berikut satu per satu:

1. **Node.js (Versi LTS: `v20.11.0+` atau `v22.x`):**
   ```bash
   node --version
   npm --version
   ```
   *Hasil yang diharapkan:* Menampilkan versi Node minimal `v20.x` atau `v22.x` dan npm minimal `10.x`.

2. **Docker Desktop (atau Docker Engine + Docker Compose pada Linux):**
   *Diperlukan oleh Supabase CLI untuk menjalankan ekosistem Supabase secara lokal.*
   ```bash
   docker --version
   docker info
   ```
   *Hasil yang diharapkan:* Menampilkan versi Docker dan informasi *daemon* yang sedang berjalan (tanpa pesan error `Cannot connect to the Docker daemon`).

3. **Git:**
   ```bash
   git --version
   ```
   *Hasil yang diharapkan:* Menampilkan versi Git (misal `git version 2.43+`).

---

## 3. PEMBUATAN PROJECT NEXT.JS APP ROUTER MENGGUNAKAN TYPESCRIPT

### 3.1 Tujuan Langkah
Membuat kerangka dasar proyek Next.js menggunakan **App Router**, **TypeScript**, **Tailwind CSS**, direktori **`src/`**, dan alias impor **`@/*`**.

### 3.2 Perintah Terminal & Direktori Eksekusi
* **Direktori Eksekusi:** Direktori induk tempat repositori proyek akan dibuat (contoh: `~/projects` atau `C:\projects`).
* **Perintah Terminal:**
  ```bash
  npx create-next-app@latest fim-property \
    --ts \
    --tailwind \
    --eslint \
    --app \
    --src-dir \
    --import-alias "@/*" \
    --use-npm
  ```
  *(Catatan: Untuk eksekusi non-interaktif, dapat menambahkan flag `--yes` sesuai dukungan versi `create-next-app`. Jika muncul pertanyaan interaktif mengenai penggunaan Turbopack untuk `next dev`, pilih `Yes`.)*

* **Masuk ke Direktori Proyek:**
  ```bash
  cd fim-property
  ```

### 3.3 Memeriksa Versi Aktual Next.js yang Terinstal
Karena `create-next-app@latest` selalu mengunduh rilis stabil terbaru, periksa versi aktual Next.js yang terpasang di proyek:
```bash
npx next --version
```
* **Penting untuk Langkah 12, 14, dan 15 Nanti:**
  * Jika versi yang tampil adalah **Next.js `16.x` atau lebih baru**, konvensi file penjaga batas jaringan menggunakan **`src/proxy.ts`** dengan fungsi bernama `proxy()`, serta perintah linting menggunakan ESLint CLI (`eslint .`) dengan *Flat Config* langsung dari `eslint-config-next`.
  * Jika versi yang tampil adalah **Next.js `15.x`**, konvensi file penjaga batas jaringan menggunakan **`src/middleware.ts`** dengan fungsi bernama `middleware()`, dan konfigurasi ESLint menggunakan `FlatCompat` jika belum memakai *Flat Config* native.
  * Dokumen ini menyediakan panduan dan kode yang kompatibel untuk keduanya pada **Bagian 12**, **Bagian 14**, dan **Bagian 15**.

---

## 4. KONFIGURASI TAILWIND CSS DAN UTILITAS KOMPONEN UI DASAR

### 4.1 Tujuan Langkah
Menginstal pustaka ikon standar (`lucide-react`) dan utilitas penggabungan kelas Tailwind (`clsx` dan `tailwind-merge`) agar komponen UI di **Layer 2 (Presentation Layer)** dapat memiliki variasi status visual (seperti badge warna untuk `HOT`, `WARM`, `COLD`, atau status unit `AVAILABLE`, `HELD`, `BOOKED`, `SOLD`) secara bersih dan bebas konflik kelas CSS.

### 4.2 Perintah Instalasi Package UI
* **Direktori Eksekusi:** Root proyek (`fim-property/`)
* **Perintah Terminal:**
  ```bash
  npm install clsx tailwind-merge lucide-react
  ```

### 4.3 Pembuatan File Utilitas Kelas UI (`src/lib/utils/cn.ts`)
Buat folder `src/lib/utils` dan simpan file `src/lib/utils/cn.ts`:

```bash
mkdir -p src/lib/utils
```

**Isi Lengkap File `src/lib/utils/cn.ts`:**
```typescript
// Lokasi: src/lib/utils/cn.ts
// Level Topologis: L0 (Shared UI Utility)

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Menggabungkan class Tailwind CSS secara kondisional dan menyelesaikan
 * konflik class utilitas (contoh: 'px-2 px-4' menjadi 'px-4').
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

---

## 5. INSTALASI DAN KONFIGURASI SUPABASE CLI

### 5.1 Tujuan Langkah
Memasang **Supabase CLI** sebagai `devDependency` lokal di dalam proyek agar versi CLI terkunci secara konsisten dan dapat dipanggil melalui skrip `npm run ...` tanpa bergantung pada instalasi global sistem operasi.

### 5.2 Perintah Instalasi Supabase CLI
* **Direktori Eksekusi:** Root proyek (`fim-property/`)
* **Perintah Terminal:**
  ```bash
  npm install --save-dev supabase
  ```

### 5.3 Verifikasi Instalasi Supabase CLI
```bash
npx supabase --version
```
* **Hasil yang diharapkan:** Menampilkan nomor versi Supabase CLI (contoh: `2.x.x`).

---

## 6. SETUP SUPABASE LOCAL DEVELOPMENT

### 6.1 Tujuan Langkah
Menginisialisasi folder `supabase/` di dalam proyek dan mengonfigurasi `supabase/config.toml` sesuai arsitektur keamanan **Phase 1A & 1B**:
1. Hanya mengekspos schema `public` dan `storage` ke API, serta **menyembunyikan schema `app_security`** agar fungsi bantuan RLS (`SECURITY DEFINER`) tidak dapat dipanggil langsung dari luar melalui HTTP PostgREST.
2. Menonaktifkan pendaftaran publik mandiri (`enable_signup = false`) sesuai aturan bisnis **Modul A** (seluruh akun dibuat oleh Admin).
3. Membatasi ukuran unggahan file pada Supabase Storage maksimal **5 MiB** (`file_size_limit = "5MiB"`) sesuai spesifikasi **Phase 1B Bagian 10** dan **File 05**.

### 6.2 Inisialisasi Direktori Supabase
* **Direktori Eksekusi:** Root proyek (`fim-property/`)
* **Perintah Terminal:**
  ```bash
  npx supabase init
  ```
* **Hasil yang terlihat:** Terbentuk folder `supabase/` beserta file `supabase/config.toml` dan folder `supabase/migrations/` (jika belum ada, buat dengan `mkdir -p supabase/migrations`).

### 6.3 Konfigurasi Lengkap `supabase/config.toml`
Buka file `supabase/config.toml` dan ganti seluruh isinya dengan konfigurasi lengkap berikut:

```toml
# Lokasi: supabase/config.toml
# Konfigurasi Supabase Local Development untuk FIM-Property CRM

project_id = "fim-property-crm"

[api]
enabled = true
port = 54321
# PENTING (Keamanan Phase 1A Bagian 11.2):
# Schema 'app_security' DILARANG dimasukkan ke dalam daftar schemas di bawah ini
# agar fungsi SECURITY DEFINER tidak terekspos sebagai endpoint RPC publik.
schemas = ["public", "storage", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 15

[db.pooler]
enabled = false
port = 54329
pool_mode = "transaction"
default_pool_size = 20
max_client_conn = 100

[studio]
enabled = true
port = 54323
api_url = "http://127.0.0.1"

[inbucket]
enabled = true
port = 54324

[storage]
enabled = true
# Batas maksimal ukuran file bukti pembayaran & dokumen KPR = 5 MiB (Phase 1B Bagian 10 / File 05)
file_size_limit = "5MiB"

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/**"]
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10
# ATURAN BISNIS MODUL A: Tidak ada Self Sign-Up publik; semua akun dibuat Admin.
enable_signup = false
enable_anonymous_sign_ins = false

[auth.email]
enable_signup = false
double_confirm_changes = true
enable_confirmations = false
```

### 6.4 Menjalankan Supabase Lokal untuk Pertama Kali & Mengambil Kunci Lokal
Pastikan daemon **Docker** sudah berjalan, lalu jalankan perintah berikut di root proyek (`fim-property/`):

```bash
npx supabase start
```

* **Hasil yang seharusnya terlihat di terminal setelah unduhan kontainer selesai:**
  Terminal akan menampilkan URL dan kunci kredensial lokal. Perhatikan perbedaan nama kunci pada versi terbaru Supabase CLI:
  * `API URL`: `http://127.0.0.1:54321`
  * `Studio URL`: `http://127.0.0.1:54323`
  * `anon key` (atau disebut **`Publishable key`**): Kunci publik yang aman digunakan di browser karena selalu melewati pemeriksaan **Row Level Security (RLS)**.
  * `service_role key` (atau disebut **`Secret key`**): Kunci rahasia tingkat sistem yang **melewati seluruh aturan RLS (`bypass RLS`)**. Kunci ini **haram** diekspos ke browser.

* **Cara memeriksa kembali kredensial lokal kapan saja:**
  ```bash
  npx supabase status
  ```

---

## 7. SETUP SUPABASE SSR DAN PAKET KEAMANAN SERVER UNTUK NEXT.JS

### 7.1 Tujuan Langkah
Menginstal pustaka resmi `@supabase/ssr` dan `@supabase/supabase-js` untuk integrasi autentikasi berbasis cookie di Next.js App Router, `zod` untuk validasi skema, serta paket `server-only` untuk mencegah kebocoran modul rahasia server ke dalam bundel JavaScript browser. Tidak ada paket pihak ketiga untuk *multi-tenancy* maupun *Machine Learning* yang perlu diinstal.

### 7.2 Perintah Instalasi
* **Direktori Eksekusi:** Root proyek (`fim-property/`)
* **Perintah Terminal:**
  ```bash
  npm install @supabase/supabase-js @supabase/ssr zod server-only
  ```

### 7.3 Cara Memeriksa Versi Paket yang Terinstal
```bash
npm list @supabase/supabase-js @supabase/ssr zod server-only
```
* **Hasil yang diharapkan:** Keempat paket tampil tanpa pesan `UNMET DEPENDENCY` atau konflik *peer dependency*.

---

## 8. STRUKTUR DIREKTORI PROJECT YANG DIREKOMENDASIKAN

### 8.1 Tujuan Langkah
Membuat kerangka folder modular di dalam `src/` yang memetakan **5 Layer Arsitektur** dan **12 Level Topologis ($L_0 \dots L_{11}$)** dari `FIM-PROPERTY_PHASE_1A_SYSTEM_ARCHITECTURE_v1.2.md`, serta disinkronkan sepenuhnya dengan jalur file yang dibutuhkan oleh **File 02 hingga File 06**.

### 8.2 Perintah Pembuatan Kerangka Direktori
* **Direktori Eksekusi:** Root proyek (`fim-property/`)
* **Perintah Terminal:**
  ```bash
  mkdir -p \
    supabase/migrations \
    src/types \
    src/lib/env \
    src/lib/errors \
    src/lib/logger \
    src/lib/supabase \
    src/lib/utils \
    src/components/auth \
    src/components/ui \
    src/components/layout \
    src/modules/shared/audit \
    src/modules/shared/notifications \
    src/modules/shared/scoring-calculator \
    src/modules/shared/storage \
    src/modules/identity/auth \
    src/modules/identity/profiles \
    src/modules/identity/teams \
    src/modules/catalog/developers \
    src/modules/catalog/projects \
    src/modules/catalog/units \
    src/modules/catalog/pricing-promotions \
    src/modules/crm/leads \
    src/modules/crm/pipeline \
    src/modules/crm/activities-followup \
    src/modules/crm/site-visits \
    src/modules/crm/scoring-usecase \
    src/modules/crm/assignment-usecase \
    src/modules/transactions/bookings \
    src/modules/transactions/payments-refunds \
    src/modules/transactions/kpr \
    src/modules/transactions/deals \
    src/modules/transactions/documents \
    src/modules/notifications-engine \
    src/modules/analytics/dashboard \
    src/modules/analytics/reporting \
    src/modules/analytics/audit-viewer \
    src/app/\(auth\)/login \
    src/app/\(protected\)/dashboard \
    src/app/api/cron/system-sweep
  ```

### 8.3 Peta Arsitektur Direktori Proyek
```text
fim-property/
├── supabase/
│   ├── config.toml                              # Konfigurasi Supabase Local Development
│   └── migrations/                              # Lokasi file migrasi SQL (Dibuat pada File 02–05)
├── src/
│   ├── proxy.ts                                 # [Layer 1] Request Boundary (Next.js 16+ / middleware.ts Next 15)
│   ├── types/
│   │   ├── database.types.ts                    # [L0] Kontrak Tipe TypeScript 33 ENUM & Konteks Sesi
│   │   └── supabase-generated.types.ts          # [L0] Tipe otomatis via `npm run db:types` (pasca migrasi)
│   ├── lib/
│   │   ├── env/
│   │   │   ├── client.ts                        # [L0] Validasi Environment Variables Publik (Browser & Server)
│   │   │   └── server.ts                        # [L0] Validasi Environment Variables Rahasia (Server-Only)
│   │   ├── errors/                              # [L0] AppError, ActionResult<T> & Error Translator (File 06)
│   │   ├── logger/                              # [L0] Structured Server Logger + PII Redaction (File 06)
│   │   ├── supabase/
│   │   │   ├── client.ts                        # [L0] Supabase Browser Client (Publishable/Anon Key)
│   │   │   ├── server.ts                        # [L0] Supabase Server SSR Client + requireAuthContext()
│   │   │   └── admin.ts                         # [L0] Supabase Service-Role Client (Server-Only, Terisolasi)
│   │   └── utils/
│   │       └── cn.ts                            # [L0] Utilitas penggabung class Tailwind
│   ├── modules/                                 # [Layer 3, 4, 5] Domain Modules sesuai Level Topologis DAG
│   │   ├── shared/                              # [L0] AuditSink, NotificationSink, Pure Rule-Based Scoring Calculator (Non-ML), Storage Service (File 05)
│   │   ├── identity/                            # [L0-L2] Auth (File 03), Modul B (profiles) & Modul C (teams, memberships)
│   │   ├── catalog/                             # [L1-L4, L10] Modul D, E, F (units), G (price & promo)
│   │   ├── crm/                                 # [L4-L7, L10] Modul H, K, L, M, I-UseCase, J-UseCase
│   │   ├── transactions/                        # [L6-L9] Modul N (booking), O (payment/refund), P (pemantauan pengajuan KPR — tanpa cicilan bulanan), R (deal), & documents (File 05)
│   │   ├── notifications-engine/                # [L10] Modul Q-Engine (Outbox Dispatcher & Reminder Sweep)
│   │   └── analytics/                           # [L11] Modul S (Dashboard), T (Reporting), U-View (Audit UI)
│   ├── components/                              # [Layer 2] Komponen UI Reusable (auth/, ui/, layout/)
│   └── app/                                     # [Layer 2 & 3] Next.js App Router Pages & API Route Handlers
│       ├── (auth)/login/                        # Rute halaman login publik
│       ├── (protected)/dashboard/               # Rute aplikasi internal terproteksi
│       └── api/cron/system-sweep/               # Endpoint Cron harian berpelindung CRON_SECRET
```

---

## 9. PEMISAHAN SERVER COMPONENT DAN CLIENT COMPONENT

Dalam arsitektur **FIM-Property**, penggunaan *React Server Components (RSC)* dan *Client Components* diatur dengan aturan tegas berikut agar keamanan data dan performa aplikasi tetap terjaga:

| Karakteristik | React Server Component (Default di App Router) | React Client Component (Wajib diawali `'use client';`) |
| :--- | :--- | :--- |
| **Deklarasi File** | Tanpa direktif khusus di baris pertama. | Wajib menulis `'use client';` pada baris paling atas file. |
| **Lokasi Eksekusi** | Hanya dieksekusi di **Server Node.js**. Kode tidak pernah dikirim ke bundel browser. | Dirender awal di server (*SSR*), lalu dihidrasi (*hydrated*) dan berjalan secara interaktif di **Browser**. |
| **Penggunaan di FIM-Property** | • Halaman utama modul (`page.tsx`, `layout.tsx`).<br>• Pengambilan data awal dari database melalui Layer 3/5.<br>• Pemeriksaan sesi `requireAuthContext()`.<br>• Pembuatan *Signed URL* dokumen privat pengajuan KPR & bukti bayar.<br>• Pemicu *Throttled On-Access Reminder Check*. | • Formulir input interaktif (Form Login, Form Booking, Form Upload Bukti Bayar, Form Kualifikasi Lead).<br>• Papan Kanban *Sales Pipeline* interaktif.<br>• Filter tabel dinamis, Modal konfirmasi, Dropdown, dan Lonceng Notifikasi. |
| **Aturan Keamanan & Import** | Boleh mengimpor `src/lib/supabase/server.ts` dan `src/lib/env/server.ts`. | **DILARANG KERAS** mengimpor `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, atau `src/lib/env/server.ts`. Hanya boleh memanggil *Server Actions* atau menggunakan `src/lib/supabase/client.ts`. |

---

## 10. KONFIGURASI ENVIRONMENT VARIABLES (PEMISAHAN PUBLISHABLE vs SECRET KEY)

### 10.1 Perbedaan Kritis *Publishable/Anon Key* vs *Secret/Service Role Key*
1. **Supabase Publishable / Anon Key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`):**
   * Memiliki awalan `NEXT_PUBLIC_` karena dibutuhkan oleh browser maupun server untuk membuat koneksi awal ke Supabase.
   * **Aman berada di browser** karena setiap query yang menggunakan kunci ini **wajib tunduk pada aturan Row Level Security (RLS)** di PostgreSQL berdasarkan token JWT pengguna yang sedang login (`auth.uid()`).
2. **Supabase Secret / Service Role Key (`SUPABASE_SERVICE_ROLE_KEY`):**
   * **TIDAK BOLEH** memiliki awalan `NEXT_PUBLIC_`.
   * Kunci ini memiliki hak akses penuh yang **melewati seluruh kebijakan RLS (`bypass RLS`)**.
   * Di dalam FIM-Property, kunci ini hanya boleh diakses di sisi server melalui `src/lib/env/server.ts` (yang dilindungi oleh paket `server-only`) untuk keperluan administratif tingkat sistem seperti manajemen akun oleh Admin (`auth.admin.*`), pencatatan sinkronisasi sistem, skrip *Database Seeding*, atau pemrosesan *background cron* yang terverifikasi.

### 10.2 Catatan Khusus Konfigurasi `KPR_SOLD_POLICY_MODE` (`PENDING BUSINESS DECISION`)
> **STATUS: `PENDING BUSINESS DECISION (TC-01)`**  
> Sesuai dokumen `FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.1.md` (Bagian 9.2), pemilihan kebijakan final antara **`TC-01A`** (Unit KPR dengan pencairan bertahap berubah menjadi `SOLD` saat pencairan mencapai 100% `FULLY_DISBURSED`) dan **`TC-01B`** (Unit berubah menjadi `SOLD` begitu Pencairan Utama `PRIMARY` diterima / `PARTIALLY_DISBURSED`) disiapkan agar dapat dikonfigurasi secara fleksibel.  
> Untuk menjaga fleksibilitas penuh tanpa mengubah struktur database atau kode aplikasi, disediakan variabel konfigurasi `KPR_SOLD_POLICY_MODE` dengan nilai default sementara **`"TC-01A"`**.

### 10.3 Pembuatan File `.env.example` dan `.env.local`
Buat file `.env.example` (yang **boleh** di-commit ke Git sebagai template) di root proyek (`fim-property/.env.example`):

```env
# ==============================================================================
# FIM-PROPERTY CRM — ENVIRONMENT VARIABLES TEMPLATE (.env.example)
# Salin file ini menjadi .env.local dan isi dengan nilai dari `npx supabase status`
# ==============================================================================

# 1. URL Aplikasi
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# 2. Supabase Public Configuration (Aman untuk Browser & Server — Tunduk pada RLS)
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="isi-dengan-anon-atau-publishable-key-dari-supabase-status"

# 3. Supabase Secret / Service Role Key (RAHASIA SERVER — DILARANG DIBERI NEXT_PUBLIC_)
SUPABASE_SERVICE_ROLE_KEY="isi-dengan-service-role-atau-secret-key-dari-supabase-status"

# 4. Keamanan Endpoint Cron Hybrid Reminder Engine (PD-05 — Minimal 32 Karakter)
CRON_SECRET="fim-property-local-dev-cron-secret-key-2026-secure"

# 5. Konfigurasi Sementara TC-01 (PENDING BUSINESS DECISION: "TC-01A" atau "TC-01B")
KPR_SOLD_POLICY_MODE="TC-01A"
```

Selanjutnya, salin `.env.example` menjadi `.env.local`:
```bash
cp .env.example .env.local
```
Buka `.env.local` dan ganti nilai `NEXT_PUBLIC_SUPABASE_ANON_KEY` serta `SUPABASE_SERVICE_ROLE_KEY` sesuai output dari perintah `npx supabase status` pada Langkah 6.4.

### 10.4 Implementasi Validasi Environment Publik (`src/lib/env/client.ts`)
Buat file `src/lib/env/client.ts` yang aman diimpor oleh komponen Server maupun Client:

```typescript
// Lokasi: src/lib/env/client.ts
// Level Topologis: L0 (Core Infrastructure — Public Environment Validator)

import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url('NEXT_PUBLIC_APP_URL harus berupa URL yang valid.')
    .default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL harus berupa URL Supabase yang valid.'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY (Publishable/Anon Key) wajib diisi.'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cachedPublicEnv: PublicEnv | null = null;

export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) {
    return cachedPublicEnv;
  }

  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    const formattedErrors = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`[ENV_CONFIGURATION_ERROR] Konfigurasi environment publik tidak valid: ${formattedErrors}`);
  }

  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}
```

### 10.5 Implementasi Validasi Environment Rahasia Server (`src/lib/env/server.ts`)
Buat file `src/lib/env/server.ts` yang dilindungi oleh `import 'server-only';` sehingga **mustahil** bocor ke sisi browser:

```typescript
// Lokasi: src/lib/env/server.ts
// Level Topologis: L0 (Core Infrastructure — Server-Only Environment Validator)

import 'server-only';
import { z } from 'zod';
import { getPublicEnv } from './client';

const serverOnlyEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, 'SUPABASE_SERVICE_ROLE_KEY (Secret/Service Role Key) wajib diisi di server.'),
  CRON_SECRET: z
    .string()
    .min(32, 'CRON_SECRET wajib memiliki panjang minimal 32 karakter demi keamanan endpoint Cron.'),
  /**
   * PENDING BUSINESS DECISION (TC-01):
   * Menentukan kapan Unit pada transaksi KPR dengan pencairan bertahap berubah menjadi SOLD.
   * - TC-01A (Default sementara): Unit menjadi SOLD saat pencairan mencapai 100% (FULLY_DISBURSED).
   * - TC-01B: Unit menjadi SOLD saat Pencairan Utama (PRIMARY) diterima (PARTIALLY_DISBURSED).
   */
  KPR_SOLD_POLICY_MODE: z.enum(['TC-01A', 'TC-01B']).default('TC-01A'),
});

export type ServerEnv = ReturnType<typeof getPublicEnv> & z.infer<typeof serverOnlyEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) {
    return cachedServerEnv;
  }

  const publicEnv = getPublicEnv();
  const parsed = serverOnlyEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    KPR_SOLD_POLICY_MODE: process.env.KPR_SOLD_POLICY_MODE ?? 'TC-01A',
  });

  if (!parsed.success) {
    const formattedErrors = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`[SERVER_ENV_CONFIGURATION_ERROR] Konfigurasi environment server tidak valid: ${formattedErrors}`);
  }

  cachedServerEnv = {
    ...publicEnv,
    ...parsed.data,
  };

  return cachedServerEnv;
}
```

---

## 11. PEMBUATAN SUPABASE CLIENT UNTUK BROWSER, SERVER SSR, DAN ADMIN

### 11.1 Kontrak Tipe Dasar 33 ENUM & Konteks Sesi (`src/types/database.types.ts`)
Sebelum membuat client Supabase, buat file `src/types/database.types.ts` untuk mendefinisikan kontrak tipe TypeScript dari seluruh **33 ENUM database** (sesuai spesifikasi **File 02**) serta **konteks sesi pengguna terautentikasi** yang digunakan oleh lapisan autentikasi (**File 03**) dan seluruh modul backend (**File 06**):

```typescript
// Lokasi: src/types/database.types.ts
// Level Topologis: L0 (Shared Types & Contracts — 33 ENUM & Authenticated Session Context)

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

// [ENUM 12] Tahapan Workflow Pengajuan KPR (kpr_applications, kpr_stage_histories)
export type KprStage =
  | 'DOCUMENT_COLLECTION'
  | 'DOCUMENT_VERIFICATION'
  | 'SUBMITTED'
  | 'BANK_VERIFICATION'
  | 'APPRAISAL'
  | 'ADDITIONAL_REQUIREMENTS'
  | 'APPROVED'
  | 'REJECTED'
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

/**
 * PENDING BUSINESS DECISION (TC-01):
 * Mode kebijakan perubahan status Unit menjadi SOLD pada KPR pencairan bertahap.
 */
export type KprSoldPolicyMode = 'TC-01A' | 'TC-01B';

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
```

### 11.2 Supabase Browser Client (`src/lib/supabase/client.ts`)
Digunakan oleh *Client Components* (`'use client'`). Hanya menggunakan *Publishable/Anon Key* dan tunduk penuh pada RLS database.

```typescript
// Lokasi: src/lib/supabase/client.ts
// Level Topologis: L0 (Core Infrastructure — Browser Client)

import { createBrowserClient } from '@supabase/ssr';
import { getPublicEnv } from '@/lib/env/client';

export function createSupabaseBrowserClient() {
  const env = getPublicEnv();

  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
```

### 11.3 Supabase Server SSR Client (`src/lib/supabase/server.ts`)
Digunakan oleh *Server Components*, *Server Actions*, dan *Route Handlers*. Membaca dan memperbarui cookie sesi HTTP-Only, serta menyediakan fungsi penjaga otorisasi **Layer 3 (`requireAuthContext`)** yang memverifikasi token langsung ke server Supabase Auth melalui `supabase.auth.getUser()`.

```typescript
// Lokasi: src/lib/supabase/server.ts
// Level Topologis: L0 (Core Infrastructure — Server SSR Client & Layer 3 Auth Guard)

import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicEnv } from '@/lib/env/client';
import type { AuthenticatedUserContext, SystemRole, TeamMemberRole } from '@/types/database.types';

/**
 * Membuat instance Supabase Client untuk Server Components, Server Actions, dan Route Handlers.
 * Tetap menggunakan Publishable/Anon Key + JWT Cookie pengguna sehingga seluruh query
 * secara otomatis dievaluasi oleh kebijakan Row Level Security (RLS) PostgreSQL.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Diabaikan ketika dipanggil dari dalam Server Component murni karena
            // penulisan header Set-Cookie pada navigasi halaman sudah ditangani oleh proxy.ts / middleware.ts.
          }
        },
      },
    }
  );
}

/**
 * Layer 3 Security Guard (Phase 1A Bagian 11.2):
 * Memverifikasi keaslian token JWT ke server Supabase Auth (menggunakan getUser(), BUKAN getSession()),
 * memeriksa bahwa profil staf berstatus aktif (is_active = true), mengambil keanggotaan tim aktif,
 * dan memvalidasi kesesuaian role apabila allowedRoles ditentukan.
 */
export async function requireAuthContext(
  allowedRoles?: SystemRole[]
): Promise<AuthenticatedUserContext> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('UNAUTHORIZED: Sesi autentikasi tidak valid atau telah berakhir.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email, system_role, is_active')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('FORBIDDEN: Data profil staf internal tidak ditemukan.');
  }

  if (!profile.is_active) {
    throw new Error('FORBIDDEN: Akun staf Anda telah dinonaktifkan oleh Administrator.');
  }

  const { data: membership } = await supabase
    .from('team_memberships')
    .select('team_id, membership_role, teams(code, name)')
    .eq('profile_id', profile.id)
    .eq('is_active', true)
    .maybeSingle();

  const teamData = Array.isArray(membership?.teams)
    ? membership.teams[0]
    : membership?.teams;

  const context: AuthenticatedUserContext = {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    systemRole: profile.system_role as SystemRole,
    isActive: profile.is_active,
    activeTeamId: membership?.team_id ?? null,
    activeTeamCode: (teamData as { code?: string } | null)?.code ?? null,
    activeTeamName: (teamData as { name?: string } | null)?.name ?? null,
    membershipRole: (membership?.membership_role as TeamMemberRole | undefined) ?? null,
  };

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(context.systemRole)) {
    throw new Error(
      `FORBIDDEN: Operasi ini membutuhkan role [${allowedRoles.join(', ')}], sedangkan role Anda adalah [${context.systemRole}].`
    );
  }

  return context;
}
```

### 11.4 Supabase Service-Role / Admin Client (`src/lib/supabase/admin.ts`)
Digunakan **secara terbatas di sisi server** hanya untuk operasi sistem yang memang harus menggunakan *Service Role Key* (seperti pembuatan akun pengguna baru di `auth.users` oleh Admin melalui `supabaseAdmin.auth.admin.createUser(...)` pada Modul B, sinkronisasi `AuditSink`/`NotificationSink`/`ReminderSweepOrchestrator`, atau eksekusi *Database Seeding*).

```typescript
// Lokasi: src/lib/supabase/admin.ts
// Level Topologis: L0 (Core Infrastructure — Isolated Server-Only Admin Client)

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env/server';

/**
 * PERINGATAN KEAMANAN KERAS:
 * Client ini menggunakan SUPABASE_SERVICE_ROLE_KEY yang melewati (bypass) seluruh kebijakan RLS.
 * HANYA boleh digunakan di sisi server untuk:
 * 1. Manajemen akun Supabase Auth oleh ADMIN (auth.admin.createUser / updateUserById).
 * 2. Eksekusi background job / cron sistem yang telah terverifikasi CRON_SECRET serta sinkronisasi sistem (AuditSink / NotificationSink).
 * 3. Skrip Database Seeding.
 * DILARANG digunakan untuk query operasional biasa milik Sales atau Supervisor.
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
```

---

## 12. SESSION MANAGEMENT PADA REQUEST BOUNDARY (`src/proxy.ts` / `src/middleware.ts`)

### 12.1 Tujuan Langkah
Mengimplementasikan **Layer 1 (Request Boundary Layer)** sesuai dokumen `FIM-PROPERTY_PHASE_1A_SYSTEM_ARCHITECTURE_v1.2.md` (Bagian 11.1):
1. Menyegarkan token sesi JWT di dalam cookie HTTP-Only pada setiap permintaan halaman menggunakan `@supabase/ssr`.
2. Melindungi rute `/api/cron/*` dengan memverifikasi header `Authorization: Bearer <CRON_SECRET>`.
3. Mengarahkan pengguna yang belum login dari rute internal ke halaman `/login`.
4. **Penting:** Sebagaimana ditetapkan di Phase 1A, lapisan ini **bukan** satu-satunya pengaman data; setiap *Server Component* dan *Server Action* tetap wajib memanggil `requireAuthContext()` dan tunduk pada RLS PostgreSQL.

### 12.2 Implementasi `src/proxy.ts` (Untuk Next.js 16+) & Kompatibilitas Next.js 15
Buat file `src/proxy.ts` *(catatan: pengecekan `CRON_SECRET` di sini membaca `process.env.CRON_SECRET` secara langsung tanpa mengimpor `src/lib/env/server.ts` agar tetap kompatibel apabila dijalankan pada Edge Runtime `middleware.ts` di Next.js 15.x; validasi penuh `getServerEnv()` tetap ditegakkan di dalam Route Handler `/api/cron/system-sweep/route.ts`)*:

```typescript
// Lokasi: src/proxy.ts
// Layer 1: Request Boundary Layer (Next.js 16+ Proxy Convention)

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicEnv } from '@/lib/env/client';

const PUBLIC_ROUTES = ['/login', '/auth/callback'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Pengamanan Endpoint Cron (PD-05): Wajib memiliki Bearer CRON_SECRET yang sah
  if (pathname.startsWith('/api/cron/')) {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || cronSecret.length < 32 || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        {
          success: false,
          error: 'UNAUTHORIZED_CRON_ACCESS',
          message: 'Token otorisasi Cron tidak valid atau tidak ditemukan.',
        },
        { status: 401 }
      );
    }

    return NextResponse.next();
  }

  // 2. Inisialisasi Response & Penyegaran Sesi Cookie Supabase SSR
  let supabaseResponse = NextResponse.next({
    request,
  });

  const env = getPublicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // PENTING: Gunakan auth.getUser() (bukan getSession()) untuk memverifikasi token
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // 3. Redirect pengguna yang belum terautentikasi ke /login
  if (!user && !isPublicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    if (pathname !== '/') {
      loginUrl.searchParams.set('redirectTo', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // 4. Redirect pengguna yang sudah login dari halaman /login atau '/' ke /dashboard
  if (user && (pathname === '/login' || pathname === '/')) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    return NextResponse.redirect(dashboardUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Cocokkan seluruh request path kecuali file statis internal Next.js dan aset gambar:
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
```

> **Catatan Kompatibilitas Jika Hasil `npx next --version` Adalah Next.js 15.x:**  
> Apabila proyek menggunakan Next.js `15.x` (sebelum rilis Next.js 16 yang memperkenalkan `proxy.ts`), buat file `src/middleware.ts` yang mengekspor ulang fungsi `proxy` tersebut sebagai `middleware`:
> ```typescript
> // Lokasi: src/middleware.ts (Hanya diperlukan jika menggunakan Next.js 15.x)
> export { proxy as middleware, config } from './proxy';
> ```

---

## 13. KONFIGURASI TYPESCRIPT (`tsconfig.json`)

### 13.1 Tujuan Langkah
Menegakkan pemeriksaan tipe paling ketat (`strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`) agar potensi `undefined` pada array atau hasil query database wajib ditangani sebelum kode dikompilasi.

### 13.2 Isi Lengkap File `tsconfig.json`
Buka file `tsconfig.json` di root proyek dan pastikan isinya sesuai dengan konfigurasi berikut:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "supabase"]
}
```

---

## 14. KONFIGURASI ESLINT (`eslint.config.mjs`)

### 14.1 Tujuan Langkah
Mengonfigurasi ESLint untuk mendeteksi variabel yang tidak terpakai, melarang penggunaan tipe `any` secara sembarangan, dan menjaga disiplin kualitas kode TypeScript.

### 14.2 Isi Lengkap File `eslint.config.mjs` (Next.js 16+ Native Flat Config)
Pada Next.js 16+, `eslint-config-next` sudah menyediakan *Flat Config* secara langsung tanpa membutuhkan `@eslint/eslintrc`. Perbarui `eslint.config.mjs` di root proyek:

```javascript
// Lokasi: eslint.config.mjs (Next.js 16+ Flat Config)

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
```

> **Catatan Kompatibilitas Jika Menggunakan Next.js 15.x:**  
> Apabila proyek yang terpasang menggunakan Next.js `15.x` dengan `@eslint/eslintrc`, pertahankan pola `FlatCompat` bawaan `create-next-app` (`...compat.extends('next/core-web-vitals', 'next/typescript')`) dan tambahkan blok `rules` yang sama persis seperti di atas.

---

## 15. KONFIGURASI PACKAGE SCRIPTS (`package.json`)

### 15.1 Tujuan Langkah
Menyediakan skrip standar pada `package.json` untuk menjalankan server pengembangan Next.js, pemeriksaan tipe TypeScript, pemeriksaan ESLint, serta pengelolaan siklus hidup database lokal Supabase.

### 15.2 Isi Lengkap Bagian `scripts` pada `package.json`
Buka `package.json` di root proyek dan pastikan bagian `"scripts"` memuat daftar perintah berikut *(catatan: gunakan `"lint": "eslint ."` karena perintah `next lint` telah dihapus pada Next.js 16 dan `eslint .` juga berfungsi di Next.js 15)*:

```json
{
  "name": "fim-property",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "check:all": "npm run typecheck && npm run lint",
    "db:start": "npx supabase start",
    "db:stop": "npx supabase stop",
    "db:status": "npx supabase status",
    "db:reset": "npx supabase db reset",
    "db:types": "npx supabase gen types typescript --local --schema public > src/types/supabase-generated.types.ts"
  }
}
```

---

## 16. KONFIGURASI GIT DAN `.gitignore`

### 16.1 Tujuan Langkah
Memastikan file kredensial rahasia (`.env`, `.env.local`, `.env.*.local`), artefak kompilasi (`.next/`), dan folder internal Supabase (`supabase/.temp/`, `supabase/.branches/`) tidak pernah tidak sengaja ter-commit ke repositori Git.

### 16.2 Isi Lengkap File `.gitignore`
Buka file `.gitignore` di root proyek dan pastikan isinya mencakup seluruh aturan berikut:

```gitignore
# Dependencies
/node_modules
/.pnp
.pnp.*

# Next.js Build Output
/.next/
/out/
/build

# Testing & Coverage
/coverage

# Environment Variables (KRITIS: Jangan pernah commit file .env aktual!)
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Izinkan template .env.example masuk ke Git
!.env.example

# Vercel
.vercel

# TypeScript & Logs
*.tsbuildinfo
next-env.d.ts
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Supabase Local CLI Temp Files
supabase/.branches
supabase/.temp

# OS & Editor Files
.DS_Store
*.pem
.idea/
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
```

### 16.3 Verifikasi Status Git
Jalankan perintah berikut di root proyek (`fim-property/`):
```bash
git status
```
* **Verifikasi Keamanan:** Pastikan file `.env.example` muncul dalam daftar *Untracked/Modified files*, sedangkan file **`.env.local` TIDAK MUNCUL** sama sekali pada output `git status`.

---

## 17. LANGKAH MENJALANKAN DAN MEMVERIFIKASI PROJECT SECARA LOKAL

Untuk menguji bahwa seluruh konfigurasi *project setup*, validasi *environment*, koneksi Supabase SSR, dan *Request Boundary Proxy* telah bekerja tanpa error sebelum mengeksekusi migrasi database dan implementasi fitur CRM, buat halaman kerangka minimal `/login` *(halaman ini nantinya digantikan oleh implementasi autentikasi penuh pada **File 03**)*:

### 17.1 Buat Halaman Kerangka `/login` (`src/app/(auth)/login/page.tsx`)
```typescript
// Lokasi: src/app/(auth)/login/page.tsx
// Halaman placeholder awal untuk memverifikasi redirect Request Boundary (proxy.ts)
// Akan digantikan oleh formulir login terintegrasi pada File 03.

import { getPublicEnv } from '@/lib/env/client';

export default function LoginPage() {
  const env = getPublicEnv();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">FIM-Property CRM</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sistem Manajemen Penjualan &amp; Properti Internal PT FIM-Property.
        </p>
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
          <p className="font-semibold">Status Setup Lingkungan Lokal:</p>
          <p className="mt-1">App URL: {env.NEXT_PUBLIC_APP_URL}</p>
          <p>Supabase API: {env.NEXT_PUBLIC_SUPABASE_URL}</p>
        </div>
      </div>
    </main>
  );
}
```

### 17.2 Urutan Eksekusi Verifikasi di Terminal
Jalankan perintah berikut secara berurutan di root proyek (`fim-property/`):

1. **Verifikasi Supabase Lokal Berjalan:**
   ```bash
   npm run db:status
   ```
   *Hasil yang diharapkan:* Menampilkan status kontainer lokal Supabase yang sedang aktif (`API URL: http://127.0.0.1:54321`, `Studio URL: http://127.0.0.1:54323`).

2. **Verifikasi Kompilasi TypeScript & Aturan ESLint:**
   ```bash
   npm run check:all
   ```
   *Hasil yang diharapkan:* Proses `tsc --noEmit` dan `eslint .` selesai dengan **0 error**.

3. **Jalankan Server Pengembangan Next.js:**
   ```bash
   npm run dev
   ```
   *Hasil yang diharapkan:* Server menyala di `http://localhost:3000`.

4. **Verifikasi Perilaku *Request Boundary Proxy* (via Browser atau `curl`):**
   * Akses `http://localhost:3000/dashboard`.
   * Karena belum memiliki sesi login aktif, `src/proxy.ts` (atau `src/middleware.ts` di Next.js 15) akan secara otomatis melakukan *redirect* ke `http://localhost:3000/login?redirectTo=%2Fdashboard` dan menampilkan halaman status setup lokal.
   * Akses `http://localhost:3000/api/cron/system-sweep` tanpa header `Authorization`.
   * *Hasil yang diharapkan:* Mengembalikan respons JSON `{"success":false,"error":"UNAUTHORIZED_CRON_ACCESS",...}` dengan kode status HTTP `401 Unauthorized`.

---

## 18. TROUBLESHOOTING UNTUK ERROR SETUP YANG UMUM

| No | Gejala / Pesan Error | Penyebab Utama | Solusi Penyelesaian |
| :--- | :--- | :--- | :--- |
| **1** | `Cannot connect to the Docker daemon` saat menjalankan `npm run db:start`. | Layanan/aplikasi Docker belum dinyalakan atau belum siap. | Nyalakan **Docker Desktop** (atau daemon Docker pada Linux), tunggu hingga berstatus *Running*, lalu ulangi `npm run db:start`. |
| **2** | `Port 54321 (atau 54322 / 54323) is already allocated`. | Ada proyek Supabase lokal lain yang masih berjalan di latar belakang. | Jalankan `npx supabase stop --all` di terminal untuk menghentikan kontainer Supabase proyek lain, lalu jalankan kembali `npm run db:start`. |
| **3** | `[ENV_CONFIGURATION_ERROR] NEXT_PUBLIC_SUPABASE_ANON_KEY wajib diisi`. | File `.env.local` belum dibuat, atau nilai kuncinya masih kosong / server Next.js belum di-*restart*. | Pastikan `.env.local` berada di root proyek (`fim-property/.env.local`), isi nilainya dari `npm run db:status`, lalu matikan (`Ctrl+C`) dan jalankan ulang `npm run dev`. |
| **4** | Error kompilasi: `You're importing a component that needs "server-only"`. | Sebuah file Client Component (`'use client'`) mencoba mengimpor `src/lib/env/server.ts`, `src/lib/supabase/server.ts`, atau `src/lib/supabase/admin.ts`. | Hapus `import` tersebut dari Client Component. Gunakan `src/lib/supabase/client.ts` untuk operasi browser, atau pindahkan logika tersebut ke dalam *Server Action*. |
| **5** | Halaman `/dashboard` tidak di-*redirect* ke `/login` saat menggunakan Next.js 15.x. | Next.js 15.x mencari file `src/middleware.ts`, sedangkan `src/proxy.ts` adalah konvensi untuk Next.js 16+. | Buat file jembatan `src/middleware.ts` berisi `export { proxy as middleware, config } from './proxy';` sebagaimana dijelaskan pada Bagian 12.2. |
| **6** | Error `Invalid command 'next lint'` atau konfigurasi `FlatCompat` gagal saat `npm run lint` pada Next.js 16+. | Skrip `package.json` masih memakai `next lint` atau `eslint.config.mjs` masih memakai `@eslint/eslintrc` yang sudah digantikan Flat Config native di Next.js 16. | Pastikan `package.json` menggunakan `"lint": "eslint ."` (Bagian 15.2) dan `eslint.config.mjs` menggunakan konfigurasi Flat Config native `eslint-config-next` (Bagian 14.2). |

---

## 19. ACCEPTANCE CRITERIA (KRITERIA KEBERTERIMAAN FILE 01)

Tahap **Project Setup & Environment Configuration** dinyatakan **SELESAI** dan siap melanjutkan ke **File 02 (Database Migrations)** apabila seluruh daftar periksa berikut telah terpenuhi:

- [ ] **AC-01:** Proyek Next.js App Router dengan TypeScript dan Tailwind CSS berhasil dibuat di dalam direktori `fim-property/` tanpa ketergantungan *multi-tenancy* maupun pustaka *Machine Learning*.
- [ ] **AC-02:** Seluruh struktur direktori modular di dalam `src/` (`src/lib/*`, `src/types/`, `src/components/*`, dan `src/modules/*`) telah terbentuk sesuai pembagian domain, Level Topologis ($L_0 \dots L_{11}$) Phase 1A v1.2, serta selaras dengan kebutuhan **File 02–06**.
- [ ] **AC-03:** `supabase/config.toml` telah dikonfigurasi dengan `schemas = ["public", "storage", "graphql_public"]` (menyembunyikan `app_security`), `enable_signup = false`, dan `file_size_limit = "5MiB"`.
- [ ] **AC-04:** Kontainer Supabase lokal berhasil dijalankan (`npm run db:start`) dan Supabase Studio dapat diakses di `http://127.0.0.1:54323`.
- [ ] **AC-05:** File `.env.local` telah terisi kredensial lokal yang valid dan terkonfirmasi **tidak terlacak** oleh Git (`git status` bersih dari `.env.local`).
- [ ] **AC-06:** Validasi *environment* publik (`src/lib/env/client.ts`) dan rahasia server (`src/lib/env/server.ts` dengan proteksi `server-only` serta dukungan `KPR_SOLD_POLICY_MODE="TC-01A"`) telah terpasang.
- [ ] **AC-07:** Kontrak tipe dasar 33 ENUM & sesi (`src/types/database.types.ts`) serta ketiga klien Supabase (`client.ts` untuk browser, `server.ts` untuk SSR + `requireAuthContext()`, dan `admin.ts` untuk service-role terisolasi) telah dibuat tanpa error TypeScript.
- [ ] **AC-08:** Penjaga batas jaringan (`src/proxy.ts` / `src/middleware.ts`) berhasil mengarahkan akses tanpa login ke `/login` dan memblokir akses tanpa token ke `/api/cron/*` dengan status `401`.
- [ ] **AC-09:** Perintah `npm run check:all` (`tsc --noEmit` & `eslint .`) berjalan dengan **0 error**.

---
