# FIM-Property CRM

## 1. Project Introduction

**FIM-Property CRM** adalah aplikasi web *Customer Relationship Management* (CRM) dan manajemen transaksi penjualan properti internal untuk **satu perusahaan (PT FIM-Property)**.

Aplikasi ini bertujuan memusatkan operasional pemasaran dan penjualan properti—mulai dari pengelolaan prospek (*lead*), koordinasi tim *Sales*, pemantauan katalog dan ketersediaan unit properti, reservasi *Booking*, verifikasi pembayaran, pemantauan pengajuan KPR, hingga penutupan transaksi (*Deal*) dan laporan penjualan.

Proyek ini dikembangkan sebagai **proyek akademik sekaligus portofolio rekayasa perangkat lunak** dengan pendekatan arsitektur dan standar keamanan tingkat produksi.

---

## 2. Key Features

* **Role-Based Access Control:** Tiga peran internal terkelola (**Admin**, **Supervisor**, dan **Sales**) tanpa registrasi mandiri oleh publik.
* **Lead Management & Pipeline:** Pencatatan prospek dengan validasi duplikasi kontak, *Pipeline* 9 tahap, riwayat aktivitas komunikasi permanen, dan pengalihan kepemilikan (*reassignment*).
* **Deterministic Lead Scoring:** Penilaian skor prospek (`0–100`) dan klasifikasi temperatur (`HOT`, `WARM`, `COLD`) berbasis 4 indikator aturan deterministik (`OQ-04`).
* **Follow-Up Tasks & Site Visits:** Pengelolaan tugas tindak lanjut (termasuk tautan ke jadwal tagihan dan pengajuan KPR) serta penjadwalan dan pencatatan hasil survei lokasi.
* **Property Catalog & Unit Availability:** Pengelolaan data developer, proyek, tipe unit, promo, riwayat perubahan harga, serta matriks ketersediaan unit dengan pembatasan tampilan pemegang unit (`Nama Depan • Kode Tim`).
* **Booking dengan Masa Tahan 72 Jam:** Penguncian unit sementara (*HELD*), *Price Freeze* atas harga kesepakatan, perpanjangan oleh Admin, dan pelepasan otomatis saat kedaluwarsa.
* **Payment Verification & Refund:** Jadwal tagihan terstruktur, unggah bukti transfer ke penyimpanan privat, verifikasi satu pintu oleh Admin, eskalasi SLA >24/48 jam, serta pembatalan dan *refund*.
* **Tiga Metode Pembayaran:** Mendukung penuh skema **Cash Keras**, **Cash Bertahap** (beserta jadwal termin cicilan ke perusahaan dan Kebijakan C2), serta **KPR**.
* **KPR Progress hingga Pencairan 100%:** Pemantauan 10 tahap proses KPR terpisah dari status pengajuan, *checklist* verifikasi berkas fiktif/simulasi, pencatatan SP3K dan *Top-Up DP*, akad, serta pencairan bertahap hingga 100% (`TC-01A`).
* **Dashboard, Laporan, Notifikasi & Audit Logs:** Dashboard terstandarisasi per role, laporan kinerja penjualan dan arus kas, *Hybrid Reminder Engine*, kotak masuk notifikasi internal, dan *Audit Log* khusus Admin.

---

## 3. Technology Stack

Teknologi berikut ditetapkan sesuai dokumentasi arsitektur dan implementasi resmi proyek:

* **Framework Web:** Next.js (App Router)
* **Bahasa Pemrograman:** TypeScript (*strict mode*)
* **Styling & Ikon UI:** Tailwind CSS, `clsx`, `tailwind-merge`, `lucide-react`
* **Validasi Skema:** Zod
* **Keamanan Server:** `server-only`
* **Backend & Basis Data:** Supabase (PostgreSQL 15+, Supabase Auth dengan `@supabase/ssr` & `@supabase/supabase-js`, Row Level Security, Private Storage)
* **Deployment & Penjadwalan:** Vercel & Vercel Cron *(opsional saat deployment produksi)*

---

## 4. Project Structure

Struktur repositori target yang ditetapkan oleh dokumentasi arsitektur (`File 01` dan `File 06`):

```text
fim-property/
├── src/
│   ├── app/                     # Next.js App Router pages, layouts, & API route (/api/cron/system-sweep)
│   ├── components/              # Komponen UI reusable (auth/, layout/, ui/)
│   ├── lib/                     # Utilitas inti: env/, errors/, logger/, supabase/, utils/
│   ├── modules/                 # Domain Modular Monolith (shared, identity, catalog, crm, transactions, notifications-engine, analytics)
│   ├── types/                   # Kontrak tipe ENUM & tipe tergenerasi Supabase
│   └── proxy.ts                 # Request boundary / manajemen sesi (atau middleware.ts pada Next.js 15)
├── supabase/
│   ├── config.toml              # Konfigurasi Supabase Local Development (belum diinisialisasi di repo saat ini)
│   └── migrations/              # Skrip migrasi SQL berurutan (File 02–05, belum dijalankan)
├── docs/
│   └── implementation/          # Lokasi dokumen implementasi 01–06 (saat ini masih berada di root sebagai FIM-PROPERTY_IMPLEMENTATION_*.md)
├── public/                      # Aset statis publik
├── AGENTS.md                    # Pedoman kerja AI coding agent
├── PRD.md                       # Product Requirements Document (v1.1)
├── DESIGN.md                    # Design System & panduan UI/UX (v2.1)
└── README.md                    # Pengenalan dan panduan awal proyek
```

> *Catatan:* Folder `supabase/` serta isi modul `src/modules/`, `src/lib/`, `src/types/`, dan rute App Router di `src/app/` merupakan struktur target resmi sesuai File 01 yang belum dibuat pada repositori kerja saat ini.

---

## 5. Documentation Guide

Seluruh aturan bisnis, desain, dan spesifikasi teknis proyek diatur dalam dokumen berikut:

| Dokumen | Fungsi Utama |
| :--- | :--- |
| **`AGENTS.md`** | Pedoman operasional, prinsip *anti-slop*, prioritas dokumen, protokol konflik, standar keamanan, dan alur kerja AI coding agent. |
| **`PRD.md`** | Sumber kebenaran utama (*v1.1*) untuk ruang lingkup produk, peran pengguna, kebutuhan fungsional, alur bisnis, dan *business rules*. |
| **`DESIGN.md`** | Acuan sistem desain (*v2.1*): palet warna, tipografi, komponen UI, tata letak per role, responsivitas, dan batasan privasi antarmuka. |
| **`docs/implementation/01–06`** | Enam dokumen teknis implementasi (*di root repositori saat ini bernama `FIM-PROPERTY_IMPLEMENTATION_01_*.md` s/d `06_*.md`*):<br>1. `01_PROJECT_SETUP_v1.1`: Inisialisasi Next.js, Supabase lokal, env, dan struktur direktori.<br>2. `02_DATABASE_MIGRATION_v1.4`: Skema 34 ENUM, 32 tabel, *constraints*, *indexes*, dan *triggers*.<br>3. `03_AUTH_SECURITY_RLS_v1.1`: Autentikasi SSR, `app_security`, *guard triggers*, dan 80 kebijakan RLS.<br>4. `04_TRANSACTIONAL_RPC_v1.3`: 10 fungsi transaksi atomik (`TX-01` s/d `TX-10`) dan *locking order*.<br>5. `05_STORAGE_DOCUMENTS_v1.1`: Bucket privat `fim-private-documents`, *Magic Bytes*, dan *Signed URL*.<br>6. `06_APPLICATION_BACKEND_v1.1`: Error handling, Zod schemas, kalkulator skor, *Services*, *Server Actions*, dan *Reminder Engine*. |

---

## 6. Prerequisites

Kebutuhan awal untuk menjalankan dan mengembangkan proyek ini secara lokal:

* **Node.js** (versi LTS `v20.11.0+` atau `v22.x`) dan **npm** (`10.x`)
* **Git**
* **Docker** (Docker Desktop atau Docker Engine + Compose) — *wajib jika menjalankan Supabase Local Development*
* **Akun Supabase** — *jika menghubungkan proyek ke Supabase Cloud* *(URL dan project reference Cloud belum dikonfigurasi)*

---

## 7. Installation & Setup

> *Catatan status:* Saat ini repositori masih berisi dokumen spesifikasi dan kerangka awal; proyek Next.js dan konfigurasi Supabase belum diinisialisasi. URL repositori GitHub resmi **belum dikonfigurasi**.

Langkah awal yang direncanakan mengacu pada **`FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`**:

1. **Clone repository:**
   ```bash
   git clone <url-repositori-belum-dikonfigurasi>
   cd fim-property
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Siapkan environment variables:**
   Salin templat konfigurasi menjadi `.env.local` (setelah templat `.env.example` diselaraskan pada tahap *Project Setup*):
   ```bash
   cp .env.example .env.local
   ```
4. **Konfigurasi Supabase (Lokal atau Cloud):**
   * Untuk pengembangan lokal dengan Docker, ikuti panduan inisialisasi `supabase/config.toml` dan `npx supabase start` pada **`FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`**, lalu lanjutkan migrasi skema, RLS, RPC, dan Storage sesuai **`File 02`–`File 05`**.
   * Konfigurasi Supabase Cloud **belum dikonfigurasi**.
5. **Jalankan aplikasi dalam mode development:**
   ```bash
   npm run dev
   ```

---

## 8. Environment Variables

Variabel lingkungan sensitif **wajib disimpan hanya di `.env.local`** (yang diabaikan oleh `.gitignore`) dan **tidak boleh pernah di-commit ke Git** atau dibagikan secara terbuka.

Daftar variabel yang ditetapkan dalam **`FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`** (belum dikonfigurasi di lingkungan aktif saat ini):

* `NEXT_PUBLIC_APP_URL` — URL aplikasi (default lokal: `http://localhost:3000`)
* `NEXT_PUBLIC_SUPABASE_URL` — URL API Supabase
* `NEXT_PUBLIC_SUPABASE_ANON_KEY` — *Publishable / Anon Key* Supabase (tunduk pada RLS)
* `SUPABASE_SERVICE_ROLE_KEY` — *Secret / Service Role Key* khusus server (dilarang diberi prefix `NEXT_PUBLIC_`)
* `CRON_SECRET` — Token rahasia minimal 32 karakter untuk mengamankan endpoint cron `/api/cron/system-sweep`
* `KPR_SOLD_POLICY_MODE` — Mode kebijakan status unit KPR (ditetapkan final sebagai `TC-01A`)

---

## 9. Development Workflow

Pengembangan aplikasi dilakukan **secara bertahap** mengikuti urutan dokumen implementasi (`01` $\rightarrow$ `02` $\rightarrow$ `03` $\rightarrow$ `04` $\rightarrow$ `05` $\rightarrow$ `06` $\rightarrow$ Frontend UI sesuai `DESIGN.md`):

1. Baca bagian terkait pada `PRD.md`, `DESIGN.md`, `AGENTS.md`, dan dokumen implementasi tahap berjalan sebelum menulis kode.
2. Kerjakan satu lingkup fitur/modul yang terdefinisi jelas pada satu tahap.
3. Jalankan verifikasi wajib setelah setiap perubahan sesuai ketentuan `File 01` dan `AGENTS.md` (seperti `npm run typecheck`, `npm run lint`, `npm run check:all`, `npm run db:reset`, `npm run db:types`, serta pengujian aturan bisnis & keamanan).
4. Laporkan hasil verifikasi secara objektif (termasuk pengujian yang belum dijalankan) dan hentikan eksekusi untuk konfirmasi bila ditemukan konflik antar-dokumen.

---

## 10. Project Scope & Limitations

Batasan mutlak proyek ini sesuai `PRD.md`:

* **Single-Company CRM:** Dirancang eksklusif untuk operasional internal **PT FIM-Property**, bukan platform SaaS *multi-tenant*.
* **Tanpa Machine Learning / AI Prediktif:** Penilaian prospek murni menggunakan rumus deterministik 4 indikator (`OQ-04`) tanpa model ML atau inferensi AI.
* **Tanpa Pemantauan Cicilan KPR Pasca-Pencairan:** Sistem berhenti memantau KPR setelah pencairan dana bank mencapai 100% (`FULLY_DISBURSED`); jadwal termin cicilan hanya berlaku untuk pembayaran *Cash Bertahap* kepada perusahaan.
* **Tanpa Payment Gateway & Blast Eksternal Otomatis:** Verifikasi bukti transfer dilakukan secara manual oleh Admin dan notifikasi hanya berjalan di dalam kotak masuk aplikasi (tanpa integrasi *payment gateway* maupun WhatsApp/email blast otomatis).
* **Tanpa Pendaftaran Publik & Hard Delete:** Seluruh akun staf dikelola oleh Admin dan data historis transaksi/audit tidak dihapus permanen.

---

## 11. Project Status

**Sedang dalam tahap pengembangan (Fase Dokumentasi & Persiapan Implementasi).**

* **Selesai:** Penyusunan dan audit `PRD.md (v1.1)`, `DESIGN.md (v2.1)`, `AGENTS.md`, serta enam dokumen spesifikasi implementasi teknis (`01–06`).
* **Belum Dikerjakan:** Inisialisasi proyek Next.js target (`File 01`), eksekusi migrasi basis data & RLS (`File 02–05`), implementasi kode aplikasi backend & frontend (`File 06` & `DESIGN.md`), serta pengujian runtime.
