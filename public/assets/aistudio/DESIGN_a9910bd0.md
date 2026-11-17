# FIM-Property CRM Design System (`DESIGN.md`)

* **Versi Dokumen:** `2.1` *(Revisi terbatas atas `v2.0`: pengetatan privasi informasi pemegang unit pada Bagian 6.2 & perbaikan konflik CSS variable font monospace pada Bagian 10.1–10.2)*
* **Status:** Resmi & Siap Implementasi Frontend (**Next.js App Router**, **TypeScript**, **Tailwind CSS**, **Lucide React**)
* **Referensi Konteks Sistem:**
  * `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`
  * `FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`
  * `FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS_v1.1.md`
  * `FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC_v1.3.md`
  * `FIM-PROPERTY_IMPLEMENTATION_05_STORAGE_DOCUMENTS_v1.1.md`
  * `FIM-PROPERTY_IMPLEMENTATION_06_APPLICATION_BACKEND_v1.1.md`
* **Cakupan Sistem:** Aplikasi CRM internal **satu perusahaan (Single-Company Internal CRM — bukan multi-tenant)** untuk tiga peran pengguna: **`ADMIN`**, **`SUPERVISOR`** (Supervisor Tim Sales), dan **`SALES`**. Sistem ini **tidak menggunakan Machine Learning** (menggunakan *Lead Scoring* deterministik 4 indikator `OQ-04`), **tidak memantau cicilan bulanan KPR nasabah ke bank** (pemantauan KPR berhenti saat pencairan dana bank 100% `FULLY_DISBURSED`), dan menerapkan kebijakan final **`TC-01A`** (Unit berstatus `SOLD` hanya setelah pelunasan 100% atau pencairan KPR `FULLY_DISBURSED`).

---

## Ringkasan Revisi dari `DESIGN.md` Lama (Flip7 $\rightarrow$ FIM-Property CRM)

Dokumen ini **menggantikan 100%** sistem desain *Flip7 Card Game* (`v1.0`). Tidak ada satu pun elemen permainan, gaya retro-playful, maupun token visual lama yang dipertahankan:

| Aspek | Desain Lama (`v1.0` Flip7 — Dihapus Total) | Desain Baru (`v2.0` FIM-Property CRM) |
| :--- | :--- | :--- |
| **Identitas Visual** | Retro-playful card game, BounceBox/QuizForge gamification | **Premium Enterprise Real Estate CRM** — bersih, terstruktur, tenang, kredibel untuk operasional harian kantor & lapangan |
| **Palet Warna** | Teal `#2BA8A2`, Gold `#FFD23F`, Coral `#EF6C4A`, Cream `#FFF8E7` | **Forest Green** (`#14532D`) & **Emerald** (`#059669`) di atas kanvas putih (`#FFFFFF`) & abu netral lembut (`#F8FAFC`) dengan tipografi Charcoal (`#0F172A`) |
| **Satuan & Skala** | `rpx` (mini-program), font extra-bold + letter-spacing lebar | `px` / `rem` responsif standar Web (Desktop-first analitik + Mobile-friendly lapangan), font **Inter** dengan `tabular-nums` |
| **Radius & Elevasi** | Pill radius `999rpx` di semua tombol/badge, colored neon glow shadows | Sudut presisi `6px–10px` (`rounded-md`/`rounded-lg`), border tipis `#E2E8F0` + shadow netral sangat ringan |
| **Komponen** | Logo kartu kipas miring, tombol *BOOM* / *Flip7*, podium juara, confetti | Sidebar navigasi berbasis role, KPI Cards, tabel finansial & piutang, matriks ketersediaan unit `OQ-05`, stepper 10 tahap KPR + status terpisah, antrean verifikasi SLA 24/48 jam |
| **Ikonografi & Bahasa** | Emoji & teks kasual permainan | **Lucide React** ikon vektor monoline `1.75px` & copywriting profesional Bahasa Indonesia |

---

## 1. Visual Direction & Design Principles

### 1.1 Karakteristik Visual Utama
**FIM-Property CRM** dirancang dengan estetika **Premium Enterprise Real Estate CRM**:
* **Tenang & Fokus Data:** Area kerja didominasi latar putih (`#FFFFFF`) dan abu-abu sangat terang (`#F8FAFC`) sehingga staf **Admin**, **Supervisor**, dan **Sales** dapat bekerja berjam-jam meninjau tabel tagihan, dokumen KPR, dan daftar prospek tanpa kelelahan mata.
* **Otoritas Warna Terkendali:** Warna **Forest Green** (`#14532D`) merepresentasikan stabilitas aset properti dan tindakan utama, sementara **Emerald** (`#059669`) menandai progres sehat, pencapaian target, dan ketersediaan inventaris.
* **Hierarki Informasi Ketat:** Setiap kartu dan baris tabel wajib menampilkan metadata bisnis yang krusial lebih dahulu: *Reference Number* (`BK-...`, `PAY-...`, `KPR-...`, `DL-...`), nominal rupiah rata kanan (`tabular-nums`), batas waktu (*72 jam hold*, *SLA 24/48 jam*), dan status resmi database.
* **Anti-AI-Slop & Anti-Gimmick:** Tidak menggunakan gradasi warna mencolok, efek kaca (*glassmorphism*) berlebihan, animasi memantul (*bounce*), *confetti*, maupun badge palsu bertuliskan "AI Prediction" / "Smart ML".

### 1.2 Do's & Don'ts

| Do (Wajib Diterapkan) | Don't (Dilarang Keras) |
| :--- | :--- |
| Gunakan **1px solid border** (`#E2E8F0`) dan shadow netral tipis untuk memisahkan kartu & panel. | Jangan gunakan *colored glow shadow* (bayangan hijau/merah/kuning berpendar) atau kartu tanpa batas yang kabur. |
| Gunakan **tabular numerals** (`tabular-nums`) dan perataan kanan (*right-aligned*) untuk seluruh nominal IDR, skor, dan tanggal di tabel. | Jangan gunakan font proporsional biasa pada kolom angka finansial yang menyebabkan kolom bergeser saat dipindai. |
| Tampilkan status sesuai **ENUM database resmi** dengan warna semantik yang konsisten di seluruh modul. | Jangan mengarang status baru atau menggabungkan `kpr_applications.current_stage` dengan `application_status` ke dalam satu badge ambigu. |
| Sembunyikan atau nonaktifkan kontrol mutasi bagi role yang tidak berhak sesuai **Matrix RLS File 03** (mis. `SUPERVISOR` read-only pada transaksi/pembayaran/KPR). | Jangan tampilkan tombol *Verify Payment*, *Approve SP3K*, atau *Cancel Booking* kepada role `SALES` atau `SUPERVISOR`. |
| Gunakan ikon **Lucide React** dengan ukuran dan ketebalan garis seragam (`16px`–`20px`, `strokeWidth={1.75}`). | Jangan gunakan emoji sebagai ikon navigasi, judul seksi, atau indikator status di UI produksi. |
| Berikan dialog konfirmasi eksplisit untuk aksi transaksional kritikal (`TX-01` s/d `TX-10`) lengkap dengan ringkasan dampak ke Unit/Deal/KPR. | Jangan mengeksekusi pembatalan Booking, penolakan bukti bayar, atau penonaktifan akun hanya dengan satu klik tanpa konfirmasi dan alasan wajib. |

---

## 2. Color System

### 2.1 Core Brand, Neutral & Semantic Tokens

| Token Name | CSS Variable | HEX / Value | Penggunaan Utama |
| :--- | :--- | :--- | :--- |
| **Primary** | `--color-primary` | `#14532D` | Tombol CTA utama, indikator menu aktif, fokus utama brand FIM-Property, status akhir `SOLD` |
| **Primary Hover** | `--color-primary-hover` | `#0F3F22` | State hover pada tombol primary dan tautan aksi utama |
| **Primary Active** | `--color-primary-active` | `#0A2E18` | State pressed/active pada tombol primary |
| **Primary Light** | `--color-primary-light` | `#F0FDF4` | Latar halus item sidebar aktif, highlight baris terpilih, container ringkasan positif |
| **Secondary** | `--color-secondary` | `#059669` | Aksen sekunder, progres stepper selesai, badge unit `AVAILABLE`, indikator pertumbuhan sehat |
| **Secondary Hover** | `--color-secondary-hover` | `#047857` | State hover tombol atau tautan sekunder Emerald |
| **Secondary Light** | `--color-secondary-light` | `#ECFDF5` | Latar badge status positif ringan & info kesiapan |
| **Page Background** | `--color-bg-page` | `#F8FAFC` | Kanvas latar belakang utama seluruh halaman dashboard & modul kerja |
| **Surface** | `--color-bg-surface` | `#FFFFFF` | Kartu konten, tabel utama, form panel, sidebar, topbar |
| **Surface Elevated** | `--color-bg-elevated` | `#F1F5F9` | Header tabel, area pratinjau dokumen, kartu metrik sekunder, nested summary block |
| **Border** | `--color-border` | `#E2E8F0` | Garis tepi kartu, pembatas tabel, divider antar-bagian, input default |
| **Border Strong** | `--color-border-strong` | `#CBD5E1` | Garis tepi input saat hover, pembatas kolom sticky tabel, border dropdown |
| **Text Primary** | `--color-text-primary` | `#0F172A` | Judul halaman, nilai KPI utama, nama pelanggan, nominal transaksi |
| **Text Secondary** | `--color-text-secondary` | `#475569` | Label tabel, deskripsi sekunder, metadata proyek/unit, teks body standar |
| **Text Muted** | `--color-text-muted` | `#64748B` | Placeholder input, timestamp histori, helper text, caption |
| **Success** | `--color-success` | `#15803D` | Teks & ikon status berhasil (`VERIFIED`, `PAID`, `COMPLETED`, `CLOSED_WON`) — BG `#DCFCE7`, Border `#BBF7D0` |
| **Warning** | `--color-warning` | `#B45309` | Peringatan SLA 24 jam, unit `HELD`, `PARTIALLY_PAID`, `REVISION_REQUIRED` — BG `#FEF3C7`, Border `#FDE68A` |
| **Error** | `--color-error` | `#B91C1C` | `OVERDUE`, `REJECTED`, `REJECTED_BY_BANK`, `EXPIRED`, `CANCELLED`, SLA >48 jam — BG `#FEE2E2`, Border `#FECACA` |
| **Information** | `--color-info` | `#0369A1` | Unit `BOOKED`, proses berjalan (`IN_PROGRESS`, `UNDER_CONTRACT`), `UPLOADED` — BG `#E0F2FE`, Border `#BAE6FD` |
| **Focus Ring** | `--color-focus-ring` | `rgba(20, 83, 45, 0.25)` | Outline fokus aksesibilitas (`box-shadow: 0 0 0 3px ...`) saat navigasi keyboard |

### 2.2 CRM Semantic Status Matrix (Selaras 34 ENUM File 02 `v1.4`)

#### A. Lead Temperature (`lead_temperature_enum` — Skor Deterministik `OQ-04`)
| Status | Aturan Skor | Text | Background | Border | Indikator Visual |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`HOT`** | Skor `75–100` | `#B91C1C` | `#FEF2F2` | `#FECACA` | Ikon `Flame` + dot merah solid `#DC2626` |
| **`WARM`** | Skor `45–74` | `#B45309` | `#FFFBEB` | `#FDE68A` | Ikon `Sun` / dot amber `#D97706` |
| **`COLD`** | Skor `0–44` | `#475569` | `#F1F5F9` | `#CBD5E1` | Ikon `Snowflake` / dot abu `#64748B` |

#### B. Unit Inventory Status (`unit_status_enum` — Kebijakan `OQ-05` & Final `TC-01A`)
| Status | Makna Bisnis | Text | Background | Border |
| :--- | :--- | :--- | :--- | :--- |
| **`AVAILABLE`** | Unit bebas dipesan | `#047857` | `#ECFDF5` | `#A7F3D0` |
| **`HELD`** | Ditahan sementara 72 jam (`PENDING_FEE`) + tampilkan pemegang ringkas (`Nama Depan • Kode Tim`, `OQ-05`) | `#B45309` | `#FFFBEB` | `#FDE68A` |
| **`BOOKED`** | Booking aktif, Cash Bertahap `UNDER_CONTRACT`, atau KPR belum cair 100% (`TC-01A`) | `#0369A1` | `#E0F2FE` | `#BAE6FD` |
| **`SOLD`** | Lunas 100% (*Cash Keras/Bertahap*) atau pencairan KPR 100% (`FULLY_DISBURSED`) | `#FFFFFF` | `#14532D` | `#14532D` |

#### C. Pipeline Stage (`pipeline_stage_enum`)
* **Pra-Transaksi (`NEW`, `CONTACTED`, `QUALIFIED`, `SITE_VISIT`, `NEGOTIATION`):** Netral-biru progresif (`#334155` di `#F1F5F9` untuk `NEW`; `#0369A1` di `#E0F2FE` untuk tahap aktif).
* **Tahap Terkunci Transaksi (`BOOKING`, `PAYMENT_KPR_PROCESS`):** Emerald/Teal lembut (`#065F46` di `#D1FAE5`, ikon gembok kecil menandakan dikelola otomatis oleh RPC transaksi, bukan drag-drop manual).
* **Hasil Akhir:** `CLOSED_WON` (`#15803D` di `#DCFCE7`), `CLOSED_LOST` (`#475569` di `#F1F5F9` dengan border `#CBD5E1`).

#### D. Booking, Payment Schedule, Verification & Refund Status
| Domain | Status ENUM | Kategori Visual | Text / BG / Border |
| :--- | :--- | :--- | :--- |
| **Booking** (`booking_status_enum`) | `PENDING_FEE` | Warning (72h Hold) | `#B45309` / `#FEF3C7` / `#FDE68A` |
| | `ACTIVE` | Info / Active | `#0369A1` / `#E0F2FE` / `#BAE6FD` |
| | `COMPLETED` | Success | `#15803D` / `#DCFCE7` / `#BBF7D0` |
| | `EXPIRED` | Neutral-Warning | `#64748B` / `#F1F5F9` / `#CBD5E1` |
| | `CANCELLED` | Error | `#B91C1C` / `#FEE2E2` / `#FECACA` |
| **Payment Schedule** (`schedule_status_enum`) | `UNPAID` | Neutral | `#475569` / `#F1F5F9` / `#E2E8F0` |
| | `PARTIALLY_PAID` | Warning | `#B45309` / `#FEF3C7` / `#FDE68A` |
| | `PAID` | Success | `#15803D` / `#DCFCE7` / `#BBF7D0` |
| | `OVERDUE` | Error (Kritis) | `#B91C1C` / `#FEE2E2` / `#FECACA` |
| | `CANCELLED` | Muted | `#64748B` / `#F8FAFC` / `#E2E8F0` |
| **Payment Verification** (`payment_verification_enum`) | `PENDING_VERIFICATION` | Warning (+SLA badge >24h/>48h) | `#B45309` / `#FEF3C7` / `#FDE68A` |
| | `VERIFIED` | Success | `#15803D` / `#DCFCE7` / `#BBF7D0` |
| | `REJECTED` | Error | `#B91C1C` / `#FEE2E2` / `#FECACA` |
| **Refund** (`refund_status_enum`) | `PENDING_REFUND` | Warning | `#B45309` / `#FEF3C7` / `#FDE68A` |
| | `COMPLETED` | Success | `#15803D` / `#DCFCE7` / `#BBF7D0` |
| | `CANCELLED` | Muted | `#64748B` / `#F1F5F9` / `#CBD5E1` |

#### E. KPR Module Status (Pemisahan `current_stage`, `application_status`, `disbursement_status`, & `kpr_documents`)
1. **`kpr_applications.application_status` (`kpr_application_status_enum`):**
   * `IN_PROGRESS`: Info (`#0369A1` / `#E0F2FE`)
   * `APPROVED`: Emerald (`#047857` / `#ECFDF5` — SP3K terbit)
   * `COMPLETED`: Success Solid/Soft (`#15803D` / `#DCFCE7` — pencairan 100%)
   * `REJECTED_BY_BANK`: Error (`#B91C1C` / `#FEE2E2`)
   * `CANCELLED_BY_CUSTOMER` & `BOOKING_CANCELLED`: Neutral-Error (`#991B1B` / `#FEF2F2` atau `#475569` / `#F1F5F9` bila pembatalan administratif)
2. **`kpr_applications.current_stage` (`kpr_stage_enum` — 10 Tahapan Proses Murni):**
   * Dirender sebagai **Stage Stepper** horizontal/vertikal. Jika `application_status` berhenti (`REJECTED_BY_BANK` / `CANCELLED_BY_CUSTOMER` / `BOOKING_CANCELLED`), stepper tetap menampilkan `current_stage` terakhir dalam kondisi *halted/paused* dengan penanda merah/abu tanpa menghapus histori tahap.
3. **`kpr_applications.disbursement_status` (`kpr_disbursement_status_enum`):**
   * `NOT_DISBURSED`: Neutral (`#475569` / `#F1F5F9`)
   * `PARTIALLY_DISBURSED`: Warning-Info (`#B45309` / `#FEF3C7` — catatan `TC-01A`: Unit tetap `BOOKED` hingga `100%`)
   * `FULLY_DISBURSED`: Success (`#15803D` / `#DCFCE7` — Unit otomatis `SOLD`)
4. **`kpr_documents.status` (`kpr_doc_status_enum`):**
   * `MISSING`: Neutral (`#64748B` / `#F1F5F9`)
   * `UPLOADED`: Info (`#0369A1` / `#E0F2FE` — Menunggu Verifikasi Admin)
   * `VERIFIED`: Success (`#15803D` / `#DCFCE7` — Terkunci permanen)
   * `REVISION_REQUIRED`: Error (`#B91C1C` / `#FEE2E2` — Wajib unggah perbaikan)

#### F. Deal 3-Axis Status (`deals`), Follow-Up & Site Visit
* **Deal (`deals`):** Menampilkan maksimal 3 chip ringkas berlabel sumbu:
  * *Outcome:* `IN_PROGRESS` (Info), `CLOSED_WON` (Success), `CANCELLED_FAILED` (Error).
  * *Contract:* `PRE_CONTRACT` (Neutral), `UNDER_CONTRACT` (Info), `CONTRACT_COMPLETED` (Success), `CONTRACT_TERMINATED` (Error).
  * *Settlement:* `BOOKING_FEE_SETTLED` (Info), `DP_SETTLED_ONGOING` (Emerald), `OVERDUE_IN_ARREARS` (Error), `DISBURSED_RETENTION_PENDING` (Warning), `FULLY_SETTLED` (Success), `TERMINATED` (Neutral-Error).
* **Follow-Up Tasks (`task_status_enum` & `task_priority_enum`):** `PENDING` (Info), `COMPLETED` (Success), `OVERDUE` (Error), `CANCELLED` (Muted); Prioritas `HIGH` (Red), `MEDIUM` (Amber), `LOW` (Slate).
* **Site Visits (`site_visit_status_enum` & `site_visit_outcome_enum`):** `SCHEDULED` (Info), `RESCHEDULED` (Warning), `COMPLETED` (Success), `CANCELLED` (Muted); Outcome `POSITIVE_INTEREST` (Emerald), `NEUTRAL_CONSIDERATION` (Amber), `NOT_SUITABLE` (Slate/Red).

---

## 3. Typography System

* **Font Family Utama:** `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` (dimuat via `next/font/google` dengan CSS variable `--font-inter`).
* **Font Monospace (Hanya untuk Kode Referensi & ID):** `'JetBrains Mono', ui-monospace, SFMono-Regular, monospace` (dimuat via `next/font/google` dengan CSS variable `--font-jetbrains-mono` lalu dipetakan ke token Tailwind `--font-mono`) untuk `BK-202603-0001`, `KPR-...`, `correlationId` (`req_...`), dan nama file.
* **Aturan Angka Finansial & Tanggal:** Seluruh angka harga unit, IDR (`Rp 1.250.000.000`), persentase, skor prospek (`82/100`), dan tanggal wajib menerapkan `font-variant-numeric: tabular-nums` (`tabular-nums`).

| Role Tipografi | Ukuran (`px` / `rem`) | Weight | Line Height | Letter Spacing | Penggunaan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display** | `30px` / `1.875rem` | `700` (Bold) | `1.2` (`36px`) | `-0.025em` | Angka KPI utama eksekutif di Dashboard, nilai total kontrak `CLOSED_WON` |
| **H1 (Page Title)** | `24px` / `1.5rem` | `700` (Bold) | `1.25` (`30px`) | `-0.02em` | Judul halaman utama modul (`/dashboard`, `/leads`, `/kpr/[id]`) |
| **H2 (Section)** | `18px` / `1.125rem` | `600` (SemiBold) | `1.35` (`24px`) | `-0.015em` | Judul panel utama, header kartu ringkasan transaksi, judul modal |
| **H3 (Card/Group)** | `16px` / `1rem` | `600` (SemiBold) | `1.4` (`22px`) | `-0.01em` | Judul sub-panel detail Lead, judul tab, nama proyek pada kartu katalog |
| **H4 (Subheader)** | `14px` / `0.875rem` | `600` (SemiBold) | `1.4` (`20px`) | `0em` | Sub-grup form, header kolom penting, judul notifikasi |
| **Body** | `14px` / `0.875rem` | `400` (Regular) | `1.5` (`21px`) | `0em` | Konten utama halaman, deskripsi aktivitas komunikasi, catatan verifikasi |
| **Body Small** | `13px` / `0.8125rem` | `400` / `500` | `1.45` (`19px`) | `0em` | Teks kartu prospek padat, item checklist dokumen KPR, deskripsi notifikasi |
| **Caption** | `12px` / `0.75rem` | `400` / `500` | `1.35` (`16px`) | `0.01em` | Timestamp riwayat, helper text form, batas ukuran file (`Maks. 5 MB`), `correlationId` |
| **Label** | `12px` / `0.75rem` | `600` (SemiBold) | `1.3` (`16px`) | `0.02em` | Label field form, header kolom tabel (`uppercase` ringan opsional untuk header kecil) |
| **Button** | `14px` (`md`) / `13px` (`sm`) | `500`–`600` | `1.2` | `0em` | Teks tombol aksi (tidak pernah menggunakan huruf kapital seluruhnya) |
| **Table Text** | `13px` / `0.8125rem` | `400` / `500` | `1.4` (`18px`) | `0em` | Isi sel tabel data (`14px` pada sel judul/nama utama agar tetap mudah dipindai) |

---

## 4. Spacing, Radius, Border & Elevation Tokens

### 4.1 Spacing Scale (Grid 4px / 8px)
| Token | Nilai | Penggunaan |
| :--- | :--- | :--- |
| `space-1` | `4px` (`0.25rem`) | Jarak ikon kecil ke teks badge, jarak label ke indikator wajib `*` |
| `space-2` | `8px` (`0.5rem`) | Jarak antar-badge, gap antar-field vertikal rapat, padding sel kompak |
| `space-3` | `12px` (`0.75rem`) | Padding item navigasi sidebar, jarak antar-tombol aksi, gap kartu grid rapat |
| `space-4` | `16px` (`1rem`) | Padding standar kartu kecil, gap grid antar-KPI card, padding horizontal input |
| `space-5` | `20px` (`1.25rem`) | Padding standar kartu konten & panel detail |
| `space-6` | `24px` (`1.5rem`) | Padding halaman utama (`main`), jarak antar-seksi halaman, padding modal |
| `space-8` | `32px` (`2rem`) | Pemisah antar-blok analitik besar pada halaman laporan |

### 4.2 Border Radius (Enterprise Restrained — Tanpa Pill-Everything)
| Token | Nilai | Penggunaan |
| :--- | :--- | :--- |
| `radius-sm` | `4px` | Checkbox, tag kode unit/proyek kecil, scrollbar thumb |
| `radius-md` | `6px` | Tombol standar (`sm`/`md`), input field, select, item menu sidebar, status badge |
| `radius-lg` | `8px` | Kartu KPI, kartu properti, tabel container, alert banner, toast |
| `radius-xl` | `12px` | Modal konfirmasi, drawer panel detail, login card |
| `radius-full` | `9999px` | **Hanya** untuk avatar inisial pengguna & titik indikator notifikasi belum dibaca (*unread dot*) |

### 4.3 Border Width & Elevation (Minimal Shadow)
* **Border Width:** Default `1px solid var(--color-border)`. Highlight aksen kartu/alert kiri menggunakan `border-l-4` (`4px`). Focus state menggunakan `border-color: #14532D` + focus ring.
* **Elevation:**
  * `shadow-none`: Elemen rata dalam container (nested summary, table row).
  * `shadow-xs` (`0 1px 2px 0 rgba(15, 23, 42, 0.04)`): Default seluruh kartu, KPI card, panel form, dan tombol primary/outline.
  * `shadow-sm` (`0 1px 3px 0 rgba(15, 23, 42, 0.08), 0 1px 2px -1px rgba(15, 23, 42, 0.04)`): Hover kartu interaktif & sticky header tabel.
  * `shadow-lg` (`0 10px 25px -5px rgba(15, 23, 42, 0.10), 0 4px 10px -6px rgba(15, 23, 42, 0.06)`): Dropdown menu, popover date-picker, toast, dan modal dialog.

### 4.4 Layout Dimensions, Grid & Breakpoints
* **Sidebar Width:** Expanded `256px` (`w-64`), Collapsed `68px` (`w-[68px]`), Mobile Drawer `280px`.
* **Topbar Height:** `64px` (`h-16`) sticky di atas area konten dengan border bawah `1px solid #E2E8F0`.
* **Content Max Width:** `1440px` terpusat untuk halaman tabel lebar/analitik (`mx-auto w-full max-w-[1440px]`), atau `1120px` untuk halaman formulir & detail transaksi fokus.
* **Grid System:** 12-kolom CSS Grid (`gap-4` di mobile/tablet, `gap-6` di desktop).
* **Breakpoints:** Mobile `< 768px`, Tablet `768px–1023px`, Laptop `1024px–1279px`, Desktop `>= 1280px`.

---

## 5. Core Component System

### 5.1 Navigation Components
1. **Sidebar (`AppSidebar`):**
   * Latar `#FFFFFF`, border kanan `1px solid #E2E8F0`. Bagian atas memuat logo ringkas **FIM-Property** (monogram persegi Forest Green `#14532D` + teks `FIM-Property CRM`) dan badge kecil nama tim aktif pengguna (bila `SUPERVISOR` / `SALES`).
   * **Menu Item & Active Nav State:** Tinggi `40px`, radius `6px`, padding horizontal `12px`, ikon Lucide `18px`. Default: teks `#475569`, hover `#F8FAFC` / `#0F172A`. **Active:** latar `#F0FDF4`, teks `#14532D` (`font-semibold`), indikator bar vertikal `3px` `#14532D` di tepi kiri.
   * **Collapsed Sidebar:** Hanya menampilkan ikon `20px` terpusat + `Tooltip` nama menu saat hover.
   * **Role-Based Navigation Matrix (Sesuai File 03 & File 06):**
     * **ADMIN:** `Dashboard` (`/dashboard`), `Leads & Pipeline` (`/leads`), `Site Visits` (`/site-visits`), `Katalog & Promo` (`/catalog`), `Bookings` (`/bookings`), `Payments & Refund` (`/payments` + badge count pending verifikasi), `KPR Monitoring` (`/kpr`), `Deals` (`/deals`), `Laporan & Audit` (`/reports`), `Manajemen Staf` (`/admin/users`), `Manajemen Tim` (`/admin/teams`).
     * **SUPERVISOR:** `Dashboard Tim` (`/dashboard`), `Leads & Pipeline Tim` (`/leads`), `Site Visits Tim` (`/site-visits`), `Katalog & Promo` (`/catalog` — Read-Only), `Bookings Tim` (`/bookings` — Read-Only), `Payments Tim` (`/payments` — Read-Only), `KPR Tim` (`/kpr` — Read-Only), `Deals Tim` (`/deals` — Read-Only), `Laporan Tim` (`/reports`). *(Menu `/admin/users`, `/admin/teams`, & Audit Log disembunyikan).*
     * **SALES:** `Dashboard Saya` (`/dashboard`), `Leads Saya` (`/leads`), `Site Visits Saya` (`/site-visits`), `Katalog & Promo` (`/catalog` — Read-Only), `Bookings Saya` (`/bookings`), `Pembayaran Saya` (`/payments`), `Pengajuan KPR` (`/kpr`), `Deals Saya` (`/deals`). *(Menu `/reports` perusahaan, `/admin/*`, & Audit Log disembunyikan).*
2. **Topbar (`AppTopbar`):**
   * Kiri: Tombol toggle sidebar / hamburger mobile + **Breadcrumb** halaman aktif (maks. 3 tingkat, mis. `KPR Monitoring / KPR-202603-0004`).
   * Kanan: Tombol **Manual Sync (`PD-05`)** khusus `ADMIN` & `SUPERVISOR` (ikon `RefreshCw`, label `Sinkronisasi Sistem` yang memanggil `runManualSystemSweepAction`), **Notification Bell** (`/notifications` dengan angka unread maksimal `99+`), dan **User Profile Menu** (avatar inisial, nama lengkap, chip role `ADMIN`/`SUPERVISOR`/`SALES`, tautan `/profile`, tombol `Keluar`).

### 5.2 Data Display Components
* **KPI Cards:** Kartu putih (`border #E2E8F0`, `radius 8px`, `padding 20px`). Memuat: Label metrik (`13px`, `#475569`), ikon kategori kecil dalam kotak `36px` bernuansa `#F0FDF4`/`#F8FAFC`, nilai utama (`24px–30px`, `font-bold`, `tabular-nums`, `#0F172A`), dan sub-info pembanding 1 baris (mis. `3 menunggu verifikasi` atau `Termasuk KPR belum cair 100%`).
* **Data Tables:** Header `#F8FAFC` dengan border bawah `#E2E8F0`, tinggi baris `48px–52px`, hover baris `#F8FAFC`. Kolom paling kiri menampilkan kode referensi / nama utama (`sticky left` pada mobile/tablet), kolom angka & nominal rata kanan (`tabular-nums`), kolom paling kanan berisi menu aksi `...` (*Action Dropdown*). Tidak menggunakan zebra-striping kontras tinggi; cukup garis pemisah `1px solid #F1F5F9`.
* **Status Badges:** Padding `2px 8px` (atau `4px 10px` pada header detail), radius `6px`, font `12px` `font-semibold`, `border: 1px solid`, wajib memiliki teks yang dapat dibaca jelas tanpa mengandalkan warna semata.
* **Avatar:** Lingkaran `32px` (tabel/topbar) atau `40px` (profil), latar `#DCFCE7` teks `#14532D` `font-semibold` (atau `#E2E8F0` teks `#334155` untuk prospek).
* **Empty States:** Wadah terpusat di area tabel/list dengan ikon Lucide `40px` (`#94A3B8`), judul singkat (`15px` `font-semibold`), penjelasan 1 kalimat, dan maksimal 1 tombol CTA primer yang sesuai role.
* **Pagination, Search, Filter & Sorting:** Toolbar di atas tabel berisi `Search Input` (debounce 300ms, lebar `280px–340px`), filter dropdown (Status, Tim, Sales, Proyek, Temperatur — sesuai visibilitas role), dan chip reset filter. Pagination di bawah tabel menampilkan `Menampilkan 1–20 dari 45 data`, pemilih jumlah baris, serta tombol Sebelumnya/Berikutnya.

### 5.3 Form & Input Components
* **Text Input, Select, Date Picker & Textarea:** Tinggi standar input/select `40px` (`36px` pada filter kompak), latar `#FFFFFF`, border `1px solid #CBD5E1`, radius `6px`, placeholder `#94A3B8`. Hover border `#94A3B8`. Focus border `#14532D` + `box-shadow: 0 0 0 3px rgba(20, 83, 45, 0.2)`. Disabled latar `#F1F5F9` teks `#64748B`.
* **Currency / IDR Input:** Prefix `Rp` di dalam slot kiri (`bg-slate-50 border-r`), input rata kanan atau kiri dengan pemisah ribuan otomatis (`1.250.000.000`), selalu mengirim angka integer murni ke server.
* **Checkbox & Radio:** Aksen `#14532D` (`accent-[#14532D]`), ukuran `16px`, selalu disertai label dapat diklik dengan jarak `8px`.
* **Form Validation:** Label merah `#B91C1C` hanya pada teks error di bawah field (`12px`, `mt-1.5`), border input `#DC2626`, serta ringkasan error server di bagian atas form yang menampilkan `fieldErrors` dari Zod (`ActionResult`).
* **Upload Field (Selaras File 05 `v1.1`):**
  * Dropzone berbatas garis putus-putus `1px dashed #CBD5E1` (hover `#14532D`, bg `#F8FAFC`).
  * Wajib menampilkan batasan eksplisit di antarmuka: **Maks. 5 MB**; format **`JPG, PNG, WEBP, PDF`** (khusus unggah **Kontrak PPJB/Akta Deal** wajib **hanya `PDF`**).
  * Untuk modul **Dokumen Persyaratan KPR (`OQ-06`)**, tampilkan pengingat jelas: *"Gunakan dokumen simulasi/fiktif untuk keperluan pengujian/demo; file disimpan di Private Storage & diakses melalui Signed URL 5 menit."*
  * Setelah dipilih/terunggah: tampilkan nama file ter-sanitasi, ukuran, tipe file, serta tombol `Pratinjau` (`PREVIEW` Signed URL) dan `Unduh` (`DOWNLOAD` Signed URL).

### 5.4 Action Components
| Varian | Background | Text | Border | Penggunaan |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Button** | `#14532D` (Hover `#0F3F22`) | `#FFFFFF` | `none` | Simpan, Buat Booking, Verifikasi Pembayaran, Catat Pencairan KPR |
| **Secondary Button** | `#ECFDF5` (Hover `#D1FAE5`) | `#065F46` | `1px solid #A7F3D0` | Aksi positif pendukung (Jadwalkan Survei, Tambah Aktivitas, Sinkronisasi) |
| **Outline Button** | `#FFFFFF` (Hover `#F8FAFC`) | `#0F172A` | `1px solid #CBD5E1` | Filter, Batal modal, Pratinjau dokumen, Export laporan |
| **Ghost Button** | `transparent` (Hover `#F1F5F9`) | `#475569` | `none` | Aksi sekunder dalam kartu/header tabel, Reset filter |
| **Destructive Button** | `#B91C1C` (Hover `#991B1B`) | `#FFFFFF` | `none` | Tolak Bukti Bayar, Batalkan Booking/Deal, Nonaktifkan Akun Staf |
| **Icon Button** | `36px × 36px` (`32px` di tabel) | `#475569` | `1px solid #E2E8F0` / Ghost | Toggle sidebar, Lonceng notifikasi, Menu aksi baris `MoreHorizontal` |
| **Dropdown Menu** | `#FFFFFF`, radius `8px`, `shadow-lg` | `#0F172A` | `1px solid #E2E8F0` | Aksi baris tabel, switcher status cepat, menu profil |

### 5.5 Feedback & State Components
* **Toast:** Muncul di kanan atas/bawah (`max-width: 400px`, `shadow-lg`, border kiri `4px`). Untuk error server (`ActionResult.success === false`), wajib menampilkan pesan bisnis yang aman beserta kode referensi **`correlationId`** (contoh: `Ref: req_8f9d2a1b4c3e5f6a`) agar mudah dilaporkan ke Admin.
* **Alert Banner:** Banner kontekstual dalam halaman (mis. peringatan *Price Freeze* pada Booking aktif, peringatan selisih plafon `KPR_TOPUP_DP`, atau peringatan SLA >24/48 jam).
* **Confirmation Dialog:** Modal berukuran `440px` (`max-w-md`) untuk seluruh mutasi berisiko (`TX-02 Reject`, `TX-04 Rejection`, `TX-06 Cancel Booking/Deal`, `TX-07 Reassign Lead`, `TX-10 Customer Cancel KPR`, `Deactivate User`). Wajib menyertakan field input alasan (*reason/notes*) apabila diwajibkan oleh skema Zod/RPC.
* **Modal:** Lebar standar `560px` (`md`) atau `720px` (`lg`, mis. form Buat Booking atau Verifikasi Pembayaran dengan pratinjau bukti transfer berdampingan). Header dengan border bawah `#E2E8F0`, body scrollable, footer sticky kanan untuk tombol Batal & Simpan.
* **Loading State, Skeleton & Error State:** Tombol mutasi wajib disabled + ikon `Loader2` berputar selama `isPending` (mencegah *double submit*). Halaman & tabel menggunakan *Skeleton* abu-abu `#E2E8F0` tanpa kedipan berlebihan. Error state menampilkan pesan bersih, tombol `Coba Lagi`, dan `correlationId` bila ada.

---

## 6. CRM-Specific Domain Components

Seluruh komponen domain di bawah ini diturunkan langsung dari skema tabel File 02 `v1.4`, aturan keamanan File 03 `v1.1`, transaksi File 04 `v1.3`, dokumen File 05 `v1.1`, dan layanan File 06 `v1.1`.

### 6.1 Lead & Pre-Sales Components
1. **Lead Card (Kanban & Mobile List):**
   * Header: Nama prospek (`14px` `font-semibold`), **Lead Temperature Badge** (`HOT`/`WARM`/`COLD`), dan angka skor (`82/100`).
   * Body: Nomor telepon/WhatsApp (hanya terlihat oleh pemilik/tim/Admin sesuai RLS), proyek & tipe unit minat, estimasi budget (`Rp ...`), serta **Lead Source Chip** (`INSTAGRAM_ADS`, `WALK_IN`, `REFERRAL`, dll.).
   * Footer: Nama Sales penanggung jawab + indikator tugas overdue (bila ada).
2. **Lead Status / Pipeline Component:**
   * Mendukung tampilan **Kanban Board** 9 kolom (`NEW` $\rightarrow$ `CLOSED_LOST`) dan **Table View**.
   * Kolom `BOOKING`, `PAYMENT_KPR_PROCESS`, dan `CLOSED_WON` ditandai ikon gembok kecil (*System-Driven*) untuk menegaskan bahwa tahap tersebut berpindah otomatis lewat RPC (`TX-01`, `TX-02`, `TX-05`, `TX-08`), bukan dipindah manual oleh Sales.
3. **Lead Detail Panel & Deterministic Score Breakdown (`OQ-04`):**
   * Panel kiri/atas: Profil lengkap prospek, preferensi properti, budget, dan status kepemilikan Sales & Tim.
   * **Score Breakdown Widget (Non-ML):** Menampilkan skor total `0–100`, temperatur (`HOT >= 75`, `WARM >= 45`, `COLD < 45`), dan **4 batang progres transparan** sesuai `ProspectScoringCalculator`:
     1. *Kesesuaian Budget (`budgetCompatibility`)*: Maks. **30 poin** (menampilkan rasio `%` terhadap harga unit `AVAILABLE` termurah).
     2. *Target Waktu Beli (`purchaseTimeline`)*: Maks. **25 poin**.
     3. *Kesiapan Dana & Dokumen (`paymentReadiness`)*: Maks. **20 poin**.
     4. *Interaksi & Site Visit (`interactionAndSiteVisit`)*: Maks. **25 poin**.
4. **Lead Activity Timeline & Follow-Up Reminder:**
   * *Activity Timeline (`lead_activities`, immutable):* Garis waktu kronologis dengan ikon kanal (`WHATSAPP`, `PHONE_CALL`, `MEETING`, `VIDEO_CALL`, `EMAIL`), badge respons (`RESPONSIVE_TWO_WAY`, `INITIAL_ONE_WAY`, `UNRESPONSIVE`), ringkasan catatan, dan pembuat catatan.
   * *Follow-Up Reminder (`follow_up_tasks`):* Kartu tugas dengan badge sumber (`MANUAL_SALES`, `SUPERVISOR_INSTRUCTION`, `PAYMENT_REMINDER_SYSTEM`), prioritas (`HIGH`/`MEDIUM`/`LOW`), tenggat waktu, dan **tautan konteks opsional**:
     * Chip tautan ke **Jadwal Pembayaran** (`related_schedule_id`, mis. tugas penagihan DP/Cash Bertahap overdue).
     * Chip tautan ke **Pengajuan KPR** (`related_kpr_application_id`, mis. melengkapi dokumen KPR, memantau appraisal, jadwal akad, atau pencairan dana).

### 6.2 Property Catalog & Unit Matrix Components
1. **Property Project & Type Card:** Menampilkan kode & nama proyek, developer mitra, kota/kecamatan, badge status proyek (`PRE_LAUNCH`, `ACTIVE_SELLING`, `SOLD_OUT`, `CLOSED`), jumlah unit `AVAILABLE`, dan rentang harga katalog.
2. **Unit Availability Matrix & Badge (`v_unit_catalog` — `OQ-05`):**
   * Grid unit per blok/nomor (`A-01`, `A-02`, dst.) atau tabel inventaris: kode unit, tipe rumah, luas tanah/bangunan (`LT/LB m²`), orientasi, badge `Hook` (`is_hook`), harga katalog (`Rp ...`), dan badge status (`AVAILABLE`, `HELD`, `BOOKED`, `SOLD`).
   * **Transparansi & Privasi Pemegang Unit (`OQ-05`):** Jika unit berstatus `HELD`, `BOOKED`, atau `SOLD`, kartu/baris unit **hanya** boleh menampilkan **Nama Depan Sales** dan **Kode Tim Sales** pemegang (contoh tampilan: `Fariz • TIM-01`). Dilarang menampilkan nama lengkap Sales, email, nomor HP, atau informasi pribadi staf lainnya.
3. **Unit Price Display, Price Freeze & Price Change Indicator (`BR-03` & `BR-07`):**
   * Pada katalog: menampilkan `catalog_price` terkini dan indikator delta harga terbaru dari `unit_price_histories` (ikon panah naik/turun + tanggal efektif + alasan).
   * Pada Booking/Deal: menampilkan badge **`Harga Terkunci (Price Freeze)`** yang membandingkan `agreed_unit_price` + diskon promo terhadap `catalog_price` jika harga katalog unit berubah setelah Booking dibuat.

### 6.3 Booking, Payment & Refund Components
1. **Booking Summary & 72-Hour Expiry Countdown (`TX-01`, `TX-03`, `OQ-03`):**
   * Menampilkan `BK-YYYYMM-XXXX`, metode bayar (`KPR`, `CASH_KERAS`, `CASH_BERTAHAP`), rincian harga (*Harga Kesepakatan*, *Promo/Diskon*, *Harga Net Deal*, *Booking Fee*, *DP*, *Plafon/Pokok*), serta **Countdown Timer 72 Jam** saat `status = 'PENDING_FEE'`.
   * Jika `expires_at` terlewati namun ada bukti bayar `PENDING_VERIFICATION`, tampilkan badge khusus **`Ditahan Menunggu Verifikasi Admin (PD-01)`**.
   * Khusus `ADMIN`: tombol **`Perpanjang Masa Berlaku`** (mencatat ke `booking_extensions`).
2. **Payment Timeline (`payment_schedules`):**
   * Daftar jadwal termin (`BOOKING_FEE`, `DOWN_PAYMENT`, `INSTALLMENT` *[eksklusif Cash Bertahap]*, `FINAL_SETTLEMENT`, `KPR_TOPUP_DP`) lengkap dengan tanggal jatuh tempo, nominal tagihan, jumlah terverifikasi (`verified_paid_amount`), sisa tagihan (`remaining_amount`), progress bar, dan badge status.
3. **Payment Verification Status, SLA Badge & Proof History (`payment_records`):**
   * Menampilkan `PAY-YYYYMM-XXXX`, metode transfer, tanggal bayar, tautan pratinjau/unduh bukti bayar (*Signed URL 300s*), serta badge SLA antrean verifikasi bila berstatus `PENDING_VERIFICATION`:
     * `> 24 jam`: Warning Badge **`SLA > 24 Jam`**.
     * `> 48 jam` atau melewati `expires_at` Booking: Error Badge **`ESKALASI KRITIS > 48 Jam`**.
   * Jika bukti ditolak (`REJECTED`): menampilkan alasan penolakan (`verification_notes`) dan penanda rantai koreksi (`replaces_payment_id` $\rightarrow$ *Menggantikan bukti yang ditolak*), karena histori bukti ditolak tidak pernah dihapus (`BR-08`).
4. **Refund Summary Card (`refund_transactions` — `PD-04`):**
   * Muncul pada Booking berstatus `CANCELLED` dengan kebijakan `FULL_REFUND` / `PARTIAL_REFUND` / `FORFEITED_FULL`: menampilkan `REF-YYYYMM-XXXX`, total dana masuk terverifikasi, nominal hangus (`forfeited_retained_amount`), nominal refund disepakati, status (`PENDING_REFUND` / `COMPLETED`), dan tombol Admin untuk mengunggah bukti transfer refund (`completeRefundTransactionAction`).

### 6.4 KPR Monitoring Components (Pemisahan `current_stage` & `application_status`)
1. **KPR Application Summary Header:**
   * Menampilkan `KPR-YYYYMM-XXXX`, nama bank tujuan, nomor & nama Booking/Unit terkait, serta **dua badge status terpisah secara berdampingan**:
     * **Status Pengajuan (`application_status`):** `IN_PROGRESS`, `APPROVED`, `REJECTED_BY_BANK`, `CANCELLED_BY_CUSTOMER`, `BOOKING_CANCELLED`, `COMPLETED`.
     * **Status Pencairan (`disbursement_status`):** `NOT_DISBURSED`, `PARTIALLY_DISBURSED`, `FULLY_DISBURSED`.
   * Menampilkan banner **`TC-01A`**: *"Status Unit tetap `BOOKED` hingga pencairan dana bank mencapai 100% (`FULLY_DISBURSED`)."*
2. **KPR Progress Stepper (10 Tahap Proses `kpr_stage_enum` — `TX-09`):**
   * Stepper horizontal (atau vertikal pada layar sempit):
     1. `DOCUMENT_COLLECTION` $\rightarrow$ 2. `DOCUMENT_VERIFICATION` $\rightarrow$ 3. `SUBMITTED` $\rightarrow$ 4. `BANK_VERIFICATION` $\rightarrow$ 5. `APPRAISAL` $\rightarrow$ 6. `ADDITIONAL_REQUIREMENTS` $\rightarrow$ 7. `APPROVED` (SP3K) $\rightarrow$ 8. `AKAD_SCHEDULED` $\rightarrow$ 9. `AKAD_COMPLETED` $\rightarrow$ 10. `DISBURSEMENT`.
   * Tidak ada tahap `REJECTED` pada stepper. Jika `application_status` adalah `REJECTED_BY_BANK` atau `CANCELLED_BY_CUSTOMER`, stepper membeku di `current_stage` terakhir dengan indikator berhenti dan menampilkan panel alasan keputusan bank / pembatalan konsumen.
3. **KPR Document Checklist (`kpr_documents` — `OQ-06`):**
   * Daftar per syarat bank (`is_mandatory` badge `Wajib` vs `Opsional`), status (`MISSING`, `UPLOADED`, `VERIFIED`, `REVISION_REQUIRED`), catatan verifikasi Admin, tombol unggah (`ADMIN` / `SALES` selama `application_status` terbuka & status dokumen belum `VERIFIED`), tombol pratinjau/unduh *Signed URL*, serta tombol Admin **`Verifikasi`** / **`Minta Revisi`** (`verifyKprDocumentAction`).
   * Sebelum Admin memindahkan tahap ke `SUBMITTED` (`TX-09`), sistem menampilkan indikator kesiapan dokumen wajib (*"X dari Y dokumen wajib terverifikasi"*).
4. **Bank Decision (`TX-04`) & SP3K Top-Up DP Alert:**
   * Menampilkan ringkasan pengajuan plafon vs `approved_loan_amount` dari SP3K. Jika plafon disetujui bank lebih kecil daripada rencana pembiayaan, sistem menyorot **Alert Top-Up DP (`KPR_TOPUP_DP`)** beserta nominal selisih yang otomatis masuk ke `payment_schedules`.
5. **Disbursement Progress (`kpr_disbursements` — `TX-08`):**
   * Progress bar nominal pencairan terhadap `approved_loan_amount`: `primary_disbursed_amount` (`PRIMARY`), `subsequent_disbursed_amount` (`SUBSEQUENT` / retensi), dan `remaining_undisbursed_amount`.
   * Tabel riwayat pencairan: urutan termin, nomor referensi pencairan bank, tanggal, nominal, dan tautan bukti pencairan bank (*Signed URL*). *(Catatan: Tidak ada komponen jadwal atau riwayat cicilan bulanan nasabah ke bank).*

### 6.5 Sales Team & Performance Components
* **Sales Team Performance Card (`SUPERVISOR` & `ADMIN`):** Ringkasan per tim (`teams`): nama tim, Supervisor aktif, jumlah Sales aktif, total Lead aktif (`HOT`/`WARM`/`COLD`), jumlah closing `CLOSED_WON`, dan nilai kontrak berjalan.
* **Sales Member List & Reassignment Control (`TX-07`):** Daftar anggota tim (`v_staff_directory`) dengan beban Lead aktif & Booking aktif. Memuat aksi **`Alihkan Lead (Reassign)`** untuk `ADMIN` (lintas/dalam tim) dan `SUPERVISOR` (hanya dalam tim aktifnya) dengan opsi alasan wajib.
* **Standardized Performance Metrics Panel (`ExecutiveMetricsService`):** Menampilkan 5 kelompok metrik konsisten: *Leads & Temperatur*, *Penjualan & Kontrak (`CLOSED_WON` vs `UNDER_CONTRACT`)*, *Keuangan (Gross Verified Cash, Refunded Outflow, Net Cash, Forfeited Funds, Outstanding & Overdue Receivables, Pending Verification)*, *Inventaris Unit (`AVAILABLE`, `HELD`, `BOOKED`, `SOLD`)*, dan *Ringkasan Pencairan KPR (`Plafond`, `Primary`, `Subsequent`, `Remaining`)*.

---

## 7. Role-Based Dashboard & Page Layouts

### 7.1 Admin Dashboard (`/dashboard` — Role `ADMIN`)
* **Header:** Judul `Dashboard Operasional Perusahaan`, tombol **`Sinkronisasi Sistem` (`PD-05`)**, dan filter ringkasan.
* **Baris 1 (4 KPI Utama):** `Total Nilai Kontrak (CLOSED_WON)`, `Net Verified Cash Inflow` (+ info Gross & Refund), `Piutang Jatuh Tempo & Overdue`, `Antrean Verifikasi Pembayaran` (sorot merah bila ada SLA >24/48 jam).
* **Baris 2 (8 kolom + 4 kolom):**
  * Kiri (8 kol): **Antrean Tindakan Mendesak Admin** — tab cepat: *Bukti Bayar Menunggu Verifikasi*, *Booking Mendekati Batas 72 Jam*, *Dokumen KPR Menunggu Verifikasi*, dan *Refund Pending*.
  * Kanan (4 kol): **Ringkasan Inventaris Unit (`TC-01A`)** (`AVAILABLE`, `HELD`, `BOOKED`, `SOLD`) + **Ringkasan Pencairan KPR**.
* **Baris 3:** Ringkasan performa per Tim Sales & Lead Temperatur perusahaan.

### 7.2 Supervisor Dashboard (`/dashboard` — Role `SUPERVISOR`)
* **Header:** Judul `Dashboard Tim: [Nama Tim Aktif]`, tombol **`Sinkronisasi Sistem` (`PD-05`)**, badge keterangan *Cakupan Tim Aktif*.
* **Baris 1 (4 KPI Tim):** `Lead Aktif Tim` (breakdown `HOT`/`WARM`/`COLD`), `Closing Tim (CLOSED_WON)`, `Booking & Kontrak Aktif Tim`, `Tugas Overdue Tim`.
* **Baris 2 (8 kolom + 4 kolom):**
  * Kiri (8 kol): **Monitoring Beban & Aktivitas Sales Tim** (tabel per anggota Sales: jumlah Lead, Site Visit minggu ini, Booking aktif, piutang overdue di bawah tanggung jawabnya, serta aksi cepat *Instruksikan Follow-Up* atau *Reassign Lead*).
  * Kanan (4 kol): **Peringatan SLA & Progres Transaksi Tim (Read-Only)** — menampilkan bukti bayar tim yang tertahan verifikasi >24/48 jam, KPR yang butuh kelengkapan dokumen Sales, dan jadwal tagihan jatuh tempo.

### 7.3 Sales Dashboard (`/dashboard` — Role `SALES`)
* **Header:** Judul `Ringkasan Kerja Sales`, CTA primer **`+ Tambah Lead Baru`**.
* **Baris 1 (4 KPI Pribadi):** `Lead Aktif Saya` (`HOT`/`WARM`/`COLD`), `Tugas Follow-Up Hari Ini / Overdue`, `Booking & Transaksi Berjalan`, `Target & Closing Saya (CLOSED_WON)`.
* **Baris 2 (7 kolom + 5 kolom):**
  * Kiri (7 kol): **Daftar Prioritas Tugas Follow-Up & Survei Hari Ini** (checklist selesai cepat, tautan langsung ke `/leads/[id]`, badge jika tugas tertaut ke jadwal tagihan atau pengajuan KPR).
  * Kanan (5 kol): **Status Pengajuan KPR & Bukti Pembayaran Saya** (menyorot dokumen KPR berstatus `REVISION_REQUIRED`, bukti bayar `REJECTED` untuk unggah ulang, dan Booking `PENDING_FEE` dengan hitung mundur 72 jam).

### 7.4 Leads Page (`/leads`) & Lead Detail Page (`/leads/[id]`)
* **Leads Page (`/leads`):** Toggle tampilan **`Kanban Pipeline`** / **`Tabel Daftar`**, filter Temperatur (`HOT`/`WARM`/`COLD`), Sumber Lead, Tahap Pipeline, dan (khusus Admin/Supervisor) filter Sales/Tim. Tombol **`+ Tambah Lead`** (`ADMIN`, `SUPERVISOR`, `SALES`).
* **Lead Detail Page (`/leads/[id]`):** Layout 2 kolom (Desktop `7:5`):
  * Kolom Kiri: Header identitas prospek + stage stepper + aksi `Ajukan Booking` (`TX-01`, tampil saat stage memenuhi syarat & bukan `NEW`/`CLOSED_*`), tab **Aktivitas Komunikasi**, **Tugas Follow-Up** (dapat ditautkan ke `related_schedule_id` atau `related_kpr_application_id`), **Jadwal Site Visit**, dan **Histori Pipeline & Assignment**.
  * Kolom Kanan: Kartu **Skor Prospek & Breakdown 4 Indikator (`OQ-04`)**, form edit kualifikasi (Budget, Timeline, Kesiapan Bayar, Proyek/Tipe minat), serta ringkasan Booking/KPR terkait bila sudah ada.

### 7.5 Property & Unit Catalog Page (`/catalog`)
* Tab navigasi: **`Matriks Unit`**, **`Proyek & Tipe`**, **`Developer`**, **`Program Promo`**.
* Semua role aktif (`ADMIN`, `SUPERVISOR`, `SALES`) dapat memfilter proyek, tipe, kisaran harga, status `AVAILABLE`/`HELD`/`BOOKED`/`SOLD`, serta melihat informasi ringkas pemegang unit (`Nama Depan Sales • Kode Tim`, contoh: `Fariz • TIM-01`, sesuai `OQ-05`) dan riwayat perubahan harga.
* Kontrol mutasi (`+ Developer`, `+ Proyek`, `+ Unit`, `Ubah Harga`, `+ Promo`) **hanya dirender untuk `ADMIN`**.

### 7.6 Booking Page (`/bookings` & `/bookings/[id]`)
* **List (`/bookings`):** Filter status (`PENDING_FEE`, `ACTIVE`, `EXPIRED`, `CANCELLED`, `COMPLETED`), metode bayar, dan indikator countdown 72 jam.
* **Detail (`/bookings/[id]`):** Kartu *Price Freeze* & ringkasan finansial, timer 72 jam, riwayat perpanjangan (`booking_extensions`), tabel jadwal pembayaran (`payment_schedules`), tab bukti pembayaran (`payment_records`), tautan ke KPR & Deal terkait, serta kartu `refund_transactions` bila `CANCELLED`.
* **Kontrol Aksi:** `SALES` & `ADMIN` dapat mengunggah bukti bayar; **khusus `ADMIN`** dapat memperpanjang masa berlaku, membuat jadwal cicilan *Cash Bertahap* (`ACTIVE`), membatalkan Booking (`TX-06`), dan menyelesaikan pencairan refund.

### 7.7 Payment Page (`/payments`)
* Diarahkan untuk kebutuhan operasional harian verifikasi & penagihan:
  * **Tab 1 — Antrean Verifikasi (`PENDING_VERIFICATION`):** Prioritas terurut dari terlama dengan badge SLA `>24 Jam` & `>48 Jam`. Klik baris membuka **Split Modal / Drawer** berisi pratinjau bukti bayar (*Signed URL*) di kiri dan rincian tagihan + tombol **`Verifikasi (VERIFIED)`** / **`Tolak (REJECTED)`** (`TX-02`, khusus `ADMIN`) di kanan.
  * **Tab 2 — Jadwal Tagihan & Piutang (`payment_schedules`):** Filter `OVERDUE`, `UNPAID`, `PARTIALLY_PAID`, `PAID` (`BOOKING_FEE`, `DOWN_PAYMENT`, `INSTALLMENT` Cash Bertahap, `KPR_TOPUP_DP`, `FINAL_SETTLEMENT`). Sales dapat mengunggah bukti bayar / koreksi bukti ditolak dari sini.
  * **Tab 3 — Pengembalian Dana (`refund_transactions`):** Daftar refund `PENDING_REFUND` & `COMPLETED` beserta aksi upload bukti refund khusus `ADMIN`.

### 7.8 KPR Monitoring Page (`/kpr` & `/kpr/[id]`)
* **List (`/kpr`):** Tabel pengajuan KPR dengan kolom `KPR-YYYYMM-XXXX`, Nama Konsumen & Unit, Bank, `current_stage`, `application_status`, `disbursement_status`, progres verifikasi dokumen wajib, dan nilai plafon disetujui.
* **Detail (`/kpr/[id]`):**
  * Header 2 status terpisah (`application_status` + `disbursement_status`) + Banner kebijakan `TC-01A`.
  * **10-Stage Stepper** + kontrol **`Majukan Tahap`** (`TX-09`, khusus `ADMIN`), **`Catat Keputusan Bank / SP3K`** (`TX-04`, khusus `ADMIN`), dan **`Catat Pembatalan KPR Konsumen`** (`TX-10`, khusus `ADMIN`).
  * Tab **`Checklist Dokumen KPR` (`OQ-06`):** `SALES` & `ADMIN` unggah dokumen fiktif; `ADMIN` verifikasi / minta revisi.
  * Tab **`Pencairan Bank` (`TX-08`):** Ringkasan plafon vs cair (`PRIMARY` & `SUBSEQUENT`), sisa belum cair, dan tombol **`Catat Pencairan`** (khusus `ADMIN` saat `APPROVED` & tahap `AKAD_COMPLETED`/`DISBURSEMENT`).
  * Tab **`Riwayat Tahap & Tugas KPR`:** Histori `kpr_stage_histories` dan daftar `follow_up_tasks` yang tertaut via `related_kpr_application_id`.

### 7.9 Deals, Reports, Notifications, & Admin Management
* **Deals (`/deals`):** Daftar transaksi `DL-YYYYMM-XXXX` dengan 3 kolom chip status (*Outcome*, *Contract*, *Settlement*), pratinjau PDF kontrak PPJB/Akta (*Signed URL*), dan tombol transisi status (`TX-05`, khusus `ADMIN`).
* **Reports (`/reports`):** Tersedia untuk `ADMIN` (seluruh perusahaan + tab **`Audit Logs`** *read-only* `audit_logs`) dan `SUPERVISOR` (cakupan tim aktif tanpa Audit Logs). Menyajikan ringkasan Kamus Metrik Standar, konversi Lead per sumber, dan performa Sales.
* **Notifications (`/notifications`):** Daftar notifikasi internal (`notifications`) dengan filter *Belum Dibaca*, tombol `Tandai Sudah Dibaca`, dan tautan langsung ke entitas target (`LEAD`, `BOOKING`, `PAYMENT`, `KPR`, `DEAL`).
* **Admin Users (`/admin/users`) & Teams (`/admin/teams`):** Khusus `ADMIN` — tabel staf, form buat akun baru, ubah role/nonaktifkan akun (dengan validasi blokir bila masih pegang Lead/Booking aktif + sinkronisasi Auth Ban), serta penugasan anggota & Supervisor tim (`team_memberships`).

---

## 8. Responsive Design

Aplikasi dirancang **Desktop-first untuk manajemen data & analitik**, namun tetap **Mobile/Tablet-friendly** untuk Sales saat berada di lapangan / *Site Visit*:

| Breakpoint | Perilaku Layout & Navigasi | Penyesuaian Tabel, Form & Domain Komponen |
| :--- | :--- | :--- |
| **Desktop (`>= 1280px`)** | Sidebar penuh `256px` (dapat di-collapse ke `68px`). Grid 12 kolom penuh; layout detail Lead/Booking/KPR menggunakan split 2 kolom (`7:5` atau `8:4`). | Tabel tampil penuh tanpa scroll horizontal. Modal verifikasi bukti bayar & dokumen KPR menampilkan pratinjau dokumen dan form keputusan berdampingan. |
| **Laptop (`1024px–1279px`)** | Sidebar `256px` atau default `68px` pada layar `1024px`. KPI Grid 4 kolom (`2×2` bila teks panjang). | Tabel data mendukung scroll horizontal halus pada kolom tengah dengan kolom referensi kiri & aksi kanan tetap terlihat. |
| **Tablet (`768px–1023px`)** | Sidebar otomatis collapse menjadi drawer overlay saat dibuka dari topbar. Split layout detail berubah menjadi 1 kolom bertumpuk (ringkasan utama di atas). | Kanban Pipeline menggunakan scroll horizontal dengan *snap* per kolom; KPI Grid 2 kolom; form 2 kolom. |
| **Mobile (`< 768px`)** | Sidebar tersembunyi ke dalam **Mobile Slide-over Drawer** dari tombol hamburger topbar. Topbar disederhanakan (ikon notifikasi, sinkronisasi ringkas, avatar). | **Table-to-Card Transformation** untuk daftar Leads, Follow-Up Tasks, Site Visits, dan Booking agar Sales mudah menindaklanjuti di lapangan. Form 2 kolom menjadi 1 kolom penuh (`w-full`), tombol aksi modal bertumpuk penuh lebar, target sentuh minimal `44px`. |

---

## 9. Animation & Interaction Guidelines

Gerakan antarmuka harus terasa **presisi, tenang, dan fungsional** — tidak pernah memperlambat staf yang bekerja cepat:
* **Durasi & Kurva Standar:** `150ms–200ms` dengan kurva `cubic-bezier(0.16, 1, 0.3, 1)` (`ease-out`) untuk dropdown, modal masuk, drawer sidebar, dan hover tombol.
* **Hover & Focus:** Perubahan warna latar/border halus (`transition-colors duration-150`). Tombol **tidak** menggunakan efek *scale bounce* atau loncatan vertikal berlebih.
* **Modal, Drawer & Toast:** Transisi opacity + pergeseran mikro `4px–8px` (`180ms` masuk, `120ms` keluar). Wajib mematuhi `prefers-reduced-motion: reduce`.
* **Loading & Optimistic Feedback:** Gunakan skeleton shimmer netral lembut (`animate-pulse bg-slate-200`) dan spinner tombol inline (`Loader2 animate-spin`).
* **Daftar Larangan Animasi:** Dilarang keras memakai `animate-bounce`, confetti, efek partikel, glow berdenyut, atau transisi halaman lambat (>300ms).

---

## 10. Implementation Guidelines (Panduan Token & Konvensi Kode UI)

Panduan ini disiapkan agar implementasi komponen Next.js & Tailwind CSS di `src/app/globals.css`, `src/app/layout.tsx`, dan `src/components/ui/` langsung konsisten dengan **File 01 `v1.1`** dan **File 06 `v1.1`**. *(Catatan: Snippet di bawah adalah referensi konfigurasi token desain untuk diimplementasikan saat membangun Layer 2 Presentation Layer).*

### 10.1 Font & Root Setup (`src/app/layout.tsx`)
* Muat font `Inter` (variable `--font-inter`) dan `JetBrains_Mono` (variable `--font-jetbrains-mono`) menggunakan `next/font/google`. Gunakan nama variabel font tersendiri agar tidak berkonflik dengan token `--font-mono` pada `@theme inline` di `globals.css`.
* Pasang kedua class variabel font pada `<html>` dan terapkan `bg-[#F8FAFC] text-[#0F172A] font-sans antialiased` pada `<body>`:

```tsx
// Contoh konfigurasi konsisten di src/app/layout.tsx
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

// <html lang="id" className={`${inter.variable} ${jetbrainsMono.variable}`}>
//   <body className="bg-[#F8FAFC] text-[#0F172A] font-sans antialiased">
```

### 10.2 CSS Custom Properties & Tailwind Tokens (`src/app/globals.css`)
```css
@import "tailwindcss";

:root {
  /* Brand Forest Green & Emerald */
  --color-primary: #14532d;
  --color-primary-hover: #0f3f22;
  --color-primary-active: #0a2e18;
  --color-primary-light: #f0fdf4;
  --color-secondary: #059669;
  --color-secondary-hover: #047857;
  --color-secondary-light: #ecfdf5;

  /* Neutrals */
  --color-bg-page: #f8fafc;
  --color-bg-surface: #ffffff;
  --color-bg-elevated: #f1f5f9;
  --color-border: #e2e8f0;
  --color-border-strong: #cbd5e1;

  /* Typography */
  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-muted: #64748b;

  /* Semantic */
  --color-success: #15803d;
  --color-warning: #b45309;
  --color-error: #b91c1c;
  --color-info: #0369a1;
  --color-focus-ring: rgba(20, 83, 45, 0.25);

  /* Layout */
  --sidebar-width: 256px;
  --sidebar-collapsed-width: 68px;
  --topbar-height: 64px;
}

@theme inline {
  --font-sans: var(--font-inter), system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace;
  --color-brand-primary: var(--color-primary);
  --color-brand-secondary: var(--color-secondary);
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}
```

### 10.3 Pemetaan Ikon Standar (`lucide-react`)
Gunakan hanya ikon dari `lucide-react` (sudah ditetapkan pada File 01 `v1.1` Bagian 4.2) dengan konsistensi makna:
* **Navigasi:** `LayoutDashboard` (Dashboard), `Users` (Leads), `CalendarClock` (Site Visits), `Building2` (Katalog & Unit), `FileCheck2` (Bookings), `Wallet` (Payments & Refund), `Landmark` (KPR), `FileSignature` (Deals), `BarChart3` (Reports), `Bell` (Notifications), `UserCog` (Manajemen Staf), `UsersRound` (Manajemen Tim), `ShieldCheck` (Audit Logs), `RefreshCw` (Manual Sync).
* **Domain & Status:** `Flame` (`HOT`), `Sun` (`WARM`), `Snowflake` (`COLD`), `Lock` (tahap pipeline/dokumen terkunci), `Clock` (timer 72 jam & SLA), `AlertTriangle` (eskalasi SLA >48 jam / Top-Up DP / Overdue), `UploadCloud` (upload Storage), `Eye` (Signed URL Preview), `Download` (Signed URL Download), `CheckCircle2` (`VERIFIED`/`PAID`/`COMPLETED`), `XCircle` (`REJECTED`/`CANCELLED`).

### 10.4 Aturan Arsitektur UI Next.js (Selaras File 01 & File 06)
1. **Utilitas Kelas:** Selalu gunakan `cn(...)` dari `@/lib/utils/cn` untuk variasi status badge dan komponen tombol.
2. **Pemisahan RSC & Client:** Pengambilan data awal (`ExecutiveMetricsService`, query daftar/detail lewat Service Layer) wajib dilakukan di **Server Component (`page.tsx`)**; interaksi form, modal konfirmasi, filter aktif, dan pemanggilan **Server Actions** dilakukan di **Client Component (`'use client'`)** dengan membaca kontrak `ActionResult<T>` (`success`, `message`, `fieldErrors`, `correlationId`).
3. **Zero Client Trust:** Penyembunyian tombol/menu di UI sesuai role (`ADMIN`, `SUPERVISOR`, `SALES`) adalah bantuan UX (*progressive disclosure*), sementara otorisasi sesungguhnya tetap ditegakkan oleh `requireActionAuth()`, `assertResourceOwnership()`, RLS PostgreSQL, dan RPC `TX-01` s/d `TX-10`.
