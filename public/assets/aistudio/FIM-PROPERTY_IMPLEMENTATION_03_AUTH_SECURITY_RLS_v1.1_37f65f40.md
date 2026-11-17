# FIM-Property Auth, Security & RLS Implementation

* **Nama File:** `FIM-PROPERTY_IMPLEMENTATION_03_AUTH_SECURITY_RLS_v1.1.md`
* **Versi Dokumen:** `1.1` *(Audit & revisi keamanan menyeluruh terhadap `v1.0` untuk menyelaraskan referensi File 01 `v1.1` & File 02 `v1.4` [34 ENUM, `kpr_application_status_enum`, `follow_up_tasks.related_kpr_application_id`, keputusan final `TC-01A`], menutup celah isolasi tim pada perpindahan Sales/Supervisor, mengetatkan validasi silang `follow_up_tasks` dan `kpr_documents`, memperbaiki bug evaluasi `NULL` pada trigger penjaga kolom, menambahkan guard trigger untuk `follow_up_tasks` & `site_visits`, serta menerapkan `security_invoker = true` pada Views)*
* **Tujuan Dokumen:** Menjadi pedoman implementasi teknis menyeluruh untuk membangun sistem autentikasi **Supabase Auth**, manajemen sesi **Supabase SSR** pada **Next.js App Router**, otorisasi sisi server (*Server-Side Authorization*), pengaturan hak akses tingkat objek PostgreSQL (**`GRANT` & `REVOKE`**), fungsi keamanan privat (**`app_security`**), perlindungan kolom sensitif, pencegahan *privilege escalation*, serta kebijakan **Row Level Security (RLS)** untuk seluruh **32 tabel** database **FIM-Property** (satu perusahaan / *Single-Company CRM*).
* **Ruang Lingkup:**
  1. Konfigurasi Supabase Auth dan integrasi siklus hidup pengguna dengan tabel `public.profiles`.
  2. Implementasi penuh login, logout, penyegaran sesi, dan pemeriksaan otorisasi di Next.js App Router.
  3. Pengaturan *PostgreSQL Grants & Privileges* untuk role database `anon`, `authenticated`, dan `service_role`.
  4. Matriks akses RLS lengkap dan implementasi SQL kebijakan RLS (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) untuk seluruh 32 tabel.
  5. Perlindungan kolom sensitif (`email`, `phone` staf dan identitas pelanggan lintas tim) menggunakan kombinasi RLS, *Security Guard Triggers*, dan *Restricted Directory Views* (`security_invoker = true`).
  6. Penyelarasan fondasi otorisasi database untuk integrasi *Private Storage* (File 05) dan transaksi atomik (File 04).
  7. Skenario pengujian keamanan positif dan negatif (*Security Test Suite*).
* **Referensi Dokumen:**
  1. `FIM-PROPERTY_MASTER_BUSINESS_DISCOVERY_v1.2_FINAL.md`
  2. `FIM-PROPERTY_PHASE_1A_SYSTEM_ARCHITECTURE_v1.2.md`
  3. `FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0.md`
  4. `FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.1.md`
  5. `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`
  6. `FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`
  7. `FIM-PROPERTY_IMPLEMENTATION_04_TRANSACTIONAL_RPC_v1.0.md` *(referensi silang)*
  8. `FIM-PROPERTY_IMPLEMENTATION_05_STORAGE_DOCUMENTS_v1.0.md` *(referensi silang)*
  9. `FIM-PROPERTY_IMPLEMENTATION_06_APPLICATION_BACKEND_v1.0.md` *(referensi silang)*
* **Dependency terhadap File Lain:**
  * **Bergantung pada (Upstream):** `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md` dan `FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md` (Seluruh **34 ENUM** dan **32 tabel** pada Migrasi 1 s/d 6 wajib sudah dibuat terlebih dahulu).
  * **Menjadi Prasyarat bagi (Downstream):** File 04 (*Transactional Database Functions / RPCs*), File 05 (*Supabase Private Storage & Document Management*), dan File 06 (*Application Backend Layer* Modul A s/d U).
* **Status Eksekusi:** Seluruh kode SQL dan TypeScript dalam dokumen ini telah disusun dan diaudit secara statis, namun **belum dieksekusi maupun diuji pada database Supabase lokal Anda**.

---

## 1. Tujuan Dokumen

Dalam pengembangan aplikasi berskala produksi untuk **PT FIM-Property** (*Single-Company Internal CRM*, bukan sistem *multi-tenant*), kesalahan paling fatal adalah menganggap aplikasi sudah aman hanya karena tombol "Edit", "Verifikasi Pembayaran", atau menu "Admin" disembunyikan di tampilan layar (*Frontend UI*).

Di ekosistem **Supabase** dan **Next.js**, setiap pengguna yang login di browser menerima *Publishable / Anon Key* beserta *JSON Web Token (JWT)* sesi mereka. Artinya, pengguna yang mengerti teknis dapat membuka *Browser Developer Tools (Inspect Element)* atau aplikasi seperti *Postman*, lalu mengirimkan perintah `SELECT`, `INSERT`, `UPDATE`, atau `DELETE` langsung ke alamat API Supabase tanpa melewati tampilan web sama sekali.

Dokumen ini memastikan **FIM-Property** terlindungi secara berlapis dari serangan tersebut dengan:
1. Mencabut seluruh hak akses publik anonim (`anon`) pada ke-32 tabel bisnis dan fungsi sistem.
2. Membatasi hak operasi SQL (`GRANT SELECT, INSERT, UPDATE`) sesuai kebutuhan riil dan mencabut hak `DELETE` fisik (`No Hard Delete` — `BR-08` & `BR-10`).
3. Menegakkan **Row Level Security (RLS)** di dalam mesin PostgreSQL berdasarkan kombinasi **Role Sistem (`ADMIN`, `SUPERVISOR`, `SALES`)**, **Status Keaktifan Akun (`is_active = true`)**, **Keanggotaan Tim Aktif (`team_id`)**, dan **Kepemilikan Data (`assigned_sales_id` / `current_sales_id`)** sehingga perpindahan tim atau penonaktifan akun langsung memutus akses data lama.
4. Menjaga integritas lintas relasi (termasuk penautan `follow_up_tasks.related_kpr_application_id` dan `related_schedule_id` terhadap `lead_id` yang sama, serta perlindungan mutasi langsung `kpr_applications` dan `kpr_documents`).
5. Mencegah *Privilege Escalation* (seperti Sales mengubah role-nya sendiri menjadi `ADMIN`, menyetujui dokumen KPR sendiri, atau Supervisor menugaskan Lead/Task ke Sales tim lain).

---

## 2. Referensi dan Sumber Spesifikasi

Seluruh aturan keamanan dalam dokumen ini diturunkan secara konsisten dari:
* **`FIM-PROPERTY_MASTER_BUSINESS_DISCOVERY_v1.2_FINAL.md`:**
  * **Bagian 0.2 (`OQ-01` & `OQ-05`):** Admin, Supervisor, dan Sales dapat membuat Lead (Lead buatan Sales otomatis milik Sales tersebut & timnya). Seluruh Sales aktif boleh melihat status ketersediaan unit, nama Sales pemegang reservasi, dan nama Tim-nya, namun identitas dan kontak pelanggan tetap dirahasiakan sesuai hak akses.
  * **Bagian 4.1:** Matriks RBAC & RLS untuk Admin, Supervisor, dan Sales.
  * **Bagian 7 (`BR-01` s/d `BR-10`):** Aturan bisnis penguncian unit, verifikasi pembayaran satu pintu oleh Admin, dan larangan menghapus data historis.
* **`FIM-PROPERTY_PHASE_1A_SYSTEM_ARCHITECTURE_v1.2.md`:**
  * **Bagian 11.1 & 11.2:** Arsitektur keamanan 4 lapis (*4-Layer Defense-in-Depth*) dan standar pengamanan fungsi `SECURITY DEFINER` di schema privat `app_security`.
* **`FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0.md` & `v1.1.md`:**
  * **Bagian 3 (`v1.0`) & Koreksi Validasi (`v1.1`):** Struktur 32 tabel dasar yang diperluas menjadi 34 ENUM pada **`FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`**.
  * **Bagian 6 (`v1.1`):** Spesifikasi fungsi `app_security` dan matriks RLS 32 tabel.
* **`FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`:**
  * Pemisahan `kpr_stage_enum` (10 tahap proses murni tanpa `'REJECTED'`) dan `[ENUM 34] kpr_application_status_enum` (`IN_PROGRESS`, `APPROVED`, `REJECTED_BY_BANK`, `CANCELLED_BY_CUSTOMER`, `BOOKING_CANCELLED`, `COMPLETED`), serta constraint `chk_kpr_applications_loan_reconciliation` & `chk_kpr_applications_status_consistency`.
  * Penambahan kolom `related_kpr_application_id` pada `follow_up_tasks` dan kewajiban validasi lintas relasi pada kebijakan RLS `follow_up_tasks`.
  * Ruang lingkup modul KPR hanya memantau perkembangan pengajuan KPR konsumen hingga pencairan dana bank (`kpr_disbursements`), **tidak mencakup pemantauan cicilan KPR bulanan konsumen ke bank**.

### Status Keputusan Bisnis Final `TC-01` (`TC-01A`)
* **`TC-01A` — Unit Berubah Menjadi `SOLD` Saat Pencairan KPR Mencapai 100% (`FULLY_DISBURSED`):**
  Keputusan `TC-01` **tidak lagi berstatus tertunda**. Sesuai `FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md` (`KPR_SOLD_POLICY_MODE="TC-01A"`) dan `FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md` (Bagian 2.2), unit tetap berstatus `'BOOKED'` selama `NOT_DISBURSED` maupun `PARTIALLY_DISBURSED`, dan baru berubah menjadi `'SOLD'` saat `FULLY_DISBURSED` (`application_status = 'COMPLETED'`). Fungsi `app_security.get_kpr_sold_policy_mode()` tetap disediakan di schema `app_security` dan secara deterministik mengembalikan `'TC-01A'` untuk dipanggil oleh fungsi RPC `TX-08` (File 04).

---

## 3. Konteks Autentikasi dan Otorisasi

Sistem otorisasi **FIM-Property** melayani satu perusahaan internal (**PT FIM-Property**, bukan *multi-tenant*) dengan kontrol akses kontekstual (*Context-Aware Multi-Dimensional Access Control*) yang mengevaluasi 4 dimensi sekaligus pada setiap permintaan data:

1. **Dimensi 1 — Status Keaktifan Staf (`profiles.is_active`):**
   Apakah akun staf yang sedang login masih berstatus aktif (`is_active = true`)? Jika seorang Sales atau Supervisor dinonaktifkan (`is_active = false`), maka **detik itu juga** seluruh akses baca dan tulisnya ke database terputus meskipun token JWT di browsernya belum kedaluwarsa.
2. **Dimensi 2 — Peran Sistem (`profiles.system_role`):**
   * `ADMIN`: Memiliki wewenang pengelolaan master katalog, manajemen user & tim, verifikasi pembayaran, pencatatan refund, pengelolaan pengajuan & pencairan KPR, pengesahan Deal, serta pemantauan seluruh tim penjualan perusahaan.
   * `SUPERVISOR`: Memimpin satu Tim Sales aktif. Memiliki wewenang membaca dan mengelola operasional pra-penjualan (*leads*, *follow-up*, *site visits*) serta memantau secara *read-only* transaksi, pembayaran, KPR, dan Deal di dalam cakupan tim aktifnya sendiri.
   * `SALES`: Anggota dari satu Tim Sales aktif. Memiliki wewenang mengelola prospek (*Lead*) dan aktivitas tindak lanjut yang ditugaskan kepadanya di dalam tim aktifnya, mengunggah bukti pembayaran (`PENDING_VERIFICATION`), mengunggah dokumen persyaratan KPR (`UPLOADED`), serta memantau secara *read-only* status transaksi & pengajuan KPR miliknya.
3. **Dimensi 3 — Cakupan Tim Aktif (`team_memberships.team_id` & `teams.is_active`):**
   Seorang Supervisor maupun Sales hanya boleh mengakses data operasional (`leads`, `bookings`, `kpr_applications`, `deals`, beserta tabel turunannya) yang berada di dalam `team_id` aktif miliknya saat ini (`team_memberships.is_active = true` pada tim yang aktif). Apabila seorang Sales atau Supervisor dipindahkan ke tim lain (atau keanggotaan timnya dinonaktifkan), aksesnya ke data tim lama langsung terputus seketika di level database.
4. **Dimensi 4 — Kepemilikan Data Individual (`assigned_sales_id` / `current_sales_id` / `recipient_user_id`):**
   Seorang Sales hanya boleh mengakses baris data yang secara eksplisit menunjuk ke `auth.uid()` miliknya **dan** berada dalam tim aktifnya saat ini.

---

## 4. Security Architecture

Arsitektur pertahanan berlapis (*Defense-in-Depth*) FIM-Property bekerja melalui 4 gerbang pemeriksaan berurutan:

```text
[ Permintaan dari Browser / Klien Eksternal ]
                    |
                    v
+-------------------------------------------------------------------------+
| GERBANG 1: REQUEST BOUNDARY (src/proxy.ts / middleware.ts)              |
| - Menyegarkan sesi cookie JWT via @supabase/ssr                         |
| - Mengalihkan pengguna belum login ke /login                            |
| - Memblokir akses ke /api/cron/* tanpa Bearer CRON_SECRET               |
+-----------------------------------+-------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| GERBANG 2: SERVER-SIDE AUTHENTICATION & ROLE GUARD (Layer 3)            |
| - Memanggil supabase.auth.getUser() langsung ke server Supabase Auth    |
| - Memeriksa profiles.is_active = true & keanggotaan tim aktif           |
| - Menolak aksi jika systemRole / activeTeamId / ownership tidak sesuai  |
+-----------------------------------+-------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| GERBANG 3: POSTGRESQL PRIVILEGES & ANTI-ESCALATION TRIGGERS (Layer 5)   |
| - Role 'anon' dicabut seluruh aksesnya (REVOKE ALL) dari 32 tabel       |
| - Role 'authenticated' tidak diberi izin DELETE fisik                   |
| - Trigger BEFORE UPDATE mengunci kolom sensitif/ownership/relasi induk  |
+-----------------------------------+-------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| GERBANG 4: POSTGRESQL ROW LEVEL SECURITY / RLS (Benteng Terakhir)       |
| - Mengevaluasi setiap baris dengan auth.uid() & fungsi app_security.*   |
| - Menjamin isolasi mutlak antar-Sales, antar-Tim, serta Storage (File05)|
+-------------------------------------------------------------------------+
```

---

## 5. Supabase Auth Configuration

Pada **`FIM-PROPERTY_IMPLEMENTATION_01_PROJECT_SETUP_v1.1.md`**, bagian `[auth]` di dalam `supabase/config.toml` telah dikonfigurasi. Pastikan konfigurasi berikut selalu aktif dan tidak diubah:

1. **Penonaktifan Registrasi Mandiri (`enable_signup = false`):**
   Sesuai aturan bisnis **Modul A**, calon pengguna luar tidak dapat mendaftarkan akun sendiri melalui endpoint publik `supabase.auth.signUp()`. Pembuatan akun staf baru hanya dapat dilakukan oleh **Admin** dari sisi server menggunakan `supabaseAdmin.auth.admin.createUser(...)`.
2. **Penonaktifan Login Anonim (`enable_anonymous_sign_ins = false`):**
   Tidak ada pengguna tamu tanpa identitas di dalam sistem CRM internal.
3. **Rotasi Refresh Token (`enable_refresh_token_rotation = true`):**
   Setiap kali *refresh token* digunakan untuk memperbarui *access token* yang habis masa berlakunya (setiap 3600 detik / 1 jam), token lama langsung hangus dan diganti dengan token baru guna mencegah pencurian sesi (*token replay attack*).
4. **Rekomendasi Penonaktifan Akun Lengkap (Auth + Profile):**
   Ketika Admin menonaktifkan akun staf di `public.profiles` (`is_active = false`), lapisan backend manajemen user (File 06 Modul B) juga disarankan melakukan *ban* / pencabutan sesi pada `auth.users` melalui `supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })` agar sesi cookie lama langsung ditolak sejak Gerbang 1 (`auth.getUser()`). Meski demikian, seluruh policy RLS & `requireAuthContext()` tetap memeriksa `profiles.is_active = true` sebagai pertahanan mandiri.

---

## 6. User Profile dan Role

### 6.1 Hubungan `auth.users` dan `public.profiles`
Supabase Auth menyimpan kredensial login (hash password, metadata token, waktu login terakhir) di dalam tabel internal **`auth.users`** (schema `auth`). Sementara itu, identitas bisnis staf FIM-Property disimpan di dalam tabel **`public.profiles`**.

Kedua tabel dihubungkan dengan relasi **`1:1` ketat**:
* Kolom `public.profiles.id` adalah *Primary Key* sekaligus *Foreign Key* yang merujuk langsung ke `auth.users(id)` (`ON UPDATE CASCADE ON DELETE RESTRICT`).
* Nilai `profiles.id` selalu sama persis dengan nilai yang dikembalikan oleh fungsi PostgreSQL `auth.uid()`.

### 6.2 Mengapa Kita Tidak Menyimpan Role dan `team_id` Hanya di `user_metadata` JWT?
> **Penjelasan Teknis Penting:**  
> Di Supabase Auth, terdapat kolom `raw_user_meta_data` di dalam JWT yang bisa diubah oleh pengguna sendiri melalui `supabase.auth.updateUser({ data: { role: 'ADMIN' } })` dari browser. Jika kebijakan RLS memeriksa `auth.jwt() -> 'user_metadata' ->> 'role'`, maka pengguna biasa dapat memalsukan perannya menjadi Admin.  
>   
> Oleh karena itu, di **FIM-Property**, sumber kebenaran (*Single Source of Truth*) untuk role sistem (`system_role`), status keaktifan (`is_active`), dan tim aktif (`team_id`) disimpan di dalam tabel relasional **`public.profiles`** dan **`public.team_memberships`** yang dikunci rapat oleh RLS dan trigger keamanan.

---

## 7. Supabase SSR Implementation

Pada **File 01 (`v1.1`)**, kita telah membuat fondasi client Supabase di `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts` (beserta `requireAuthContext()`), dan `src/lib/supabase/admin.ts`. Pada bagian ini, kita melengkapi arsitektur autentikasi di **Layer 3** agar siap menangani pembacaan sesi, login, logout, dan otorisasi granular.

### 7.1 Aturan Emas Penggunaan `auth.getUser()` vs `auth.getSession()`
* **Di Sisi Server (`server.ts`, `proxy.ts`, *Server Components*, *Server Actions*, *Route Handlers*):**
  **WAJIB** selalu memanggil `await supabase.auth.getUser()`. Fungsi ini mengirimkan permintaan verifikasi token ke server Supabase Auth untuk memastikan token belum dicabut dan tanda tangan kriptografinya sah.
* **DILARANG** menggunakan `await supabase.auth.getSession()` untuk mengambil keputusan keamanan di sisi server, karena `getSession()` hanya membaca isi cookie dari browser tanpa memverifikasi ulang status pencabutan sesi ke server Auth.

---

## 8. Login dan Logout

Berikut adalah implementasi lengkap fitur Login dan Logout yang memverifikasi kredensial sekaligus memeriksa status keaktifan staf (`profiles.is_active`) sebelum mengizinkan pengguna masuk ke dalam aplikasi.

### 8.1 Pembuatan Skema Validasi Login (`src/modules/identity/auth/auth.schemas.ts`)
Buat direktori `src/modules/identity/auth`:
```bash
mkdir -p src/modules/identity/auth
```

Simpan file `src/modules/identity/auth/auth.schemas.ts`:
```typescript
// Lokasi: src/modules/identity/auth/auth.schemas.ts
// Level Topologis: L0/L1 (Validation Schema untuk Autentikasi)

import { z } from 'zod';

/**
 * Sanitasi parameter redirectTo agar kebal terhadap Open Redirect
 * (menolak URL eksternal, protocol-relative '//', maupun backslash '/\').
 */
export function sanitizeInternalRedirectPath(rawPath: string | undefined | null): string {
  if (!rawPath) {
    return '/dashboard';
  }
  const trimmed = rawPath.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.includes('\\') ||
    /[\r\n\t]/.test(trimmed)
  ) {
    return '/dashboard';
  }
  return trimmed;
}

export const loginFormSchema = z.object({
  email: z
    .string({ required_error: 'Email wajib diisi.' })
    .trim()
    .toLowerCase()
    .email('Format alamat email tidak valid.'),
  password: z
    .string({ required_error: 'Password wajib diisi.' })
    .min(6, 'Password minimal terdiri dari 6 karakter.'),
  redirectTo: z
    .string()
    .optional()
    .default('/dashboard')
    .transform((val) => sanitizeInternalRedirectPath(val)),
});

export type LoginFormInput = z.infer<typeof loginFormSchema>;
```

### 8.2 Implementasi Server Actions Login & Logout (`src/modules/identity/auth/auth.actions.ts`)
Simpan file `src/modules/identity/auth/auth.actions.ts`:

```typescript
// Lokasi: src/modules/identity/auth/auth.actions.ts
// Layer 3: Application Entry Layer (Server Actions untuk Login & Logout)

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loginFormSchema } from './auth.schemas';

export interface AuthActionResult {
  success: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Server Action untuk memproses login staf internal FIM-Property.
 * Memverifikasi kredensial ke Supabase Auth DAN memeriksa bahwa profil staf
 * terdaftar serta berstatus aktif (is_active = true).
 */
export async function loginWithEmailPasswordAction(
  _prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  // 1. Validasi input di sisi server dengan Zod
  const rawInput = {
    email: formData.get('email'),
    password: formData.get('password'),
    redirectTo: formData.get('redirectTo') ?? '/dashboard',
  };

  const parsed = loginFormSchema.safeParse(rawInput);

  if (!parsed.success) {
    return {
      success: false,
      message: 'Mohon periksa kembali email dan password yang Anda masukkan.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { email, password, redirectTo } = parsed.data;
  const supabase = await createSupabaseServerClient();

  // 2. Autentikasi kredensial melalui Supabase Auth
  const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !authData.user) {
    return {
      success: false,
      message: 'Email atau password salah. Pastikan akun Anda telah terdaftar oleh Admin.',
    };
  }

  // 3. Periksa keberadaan dan status keaktifan profil di tabel public.profiles
  // Catatan: pol_profiles_select mengizinkan pengguna membaca baris id = auth.uid()
  // agar pesan penolakan akun nonaktif dapat dibedakan dari profil yang belum terdaftar.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, system_role, is_active')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) {
    // Jika tidak memiliki profil staf yang sah, segera hancurkan sesi
    await supabase.auth.signOut();
    return {
      success: false,
      message: 'Profil staf tidak ditemukan di database FIM-Property. Hubungi Administrator.',
    };
  }

  if (!profile.is_active) {
    // ATURAN BISNIS MODUL A & B: Staf berstatus Inactive langsung ditolak masuk
    await supabase.auth.signOut();
    return {
      success: false,
      message: 'Akun Anda berstatus nonaktif (Inactive). Hubungi Administrator FIM-Property.',
    };
  }

  // 4. Untuk SUPERVISOR / SALES, pastikan juga keanggotaan tim aktif jika sudah ditugaskan;
  // jika belum memiliki tim aktif, seluruh data tim terisolasi (0 baris) oleh RLS.
  // Segarkan cache rute dan arahkan ke halaman tujuan.
  revalidatePath('/', 'layout');
  redirect(redirectTo);
}

/**
 * Server Action untuk mengakhiri sesi pengguna (Logout) secara aman.
 */
export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
```

### 8.3 Komponen Formulir Login (`src/components/auth/LoginForm.tsx`)
Buat direktori `src/components/auth` dan simpan file `src/components/auth/LoginForm.tsx`:
```bash
mkdir -p src/components/auth
```

```typescript
// Lokasi: src/components/auth/LoginForm.tsx
// Layer 2: Presentation Layer (Client Component untuk Form Login)

'use client';

import { useActionState } from 'react';
import { loginWithEmailPasswordAction, type AuthActionResult } from '@/modules/identity/auth/auth.actions';

interface LoginFormProps {
  redirectTo?: string;
}

const initialState: AuthActionResult = {
  success: false,
  message: '',
};

export function LoginForm({ redirectTo = '/dashboard' }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(
    loginWithEmailPasswordAction,
    initialState
  );

  return (
    <form action={formAction} className="mt-6 space-y-5" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {state.message && !state.success && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
        >
          {state.message}
        </div>
      )}

      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-slate-700"
        >
          Email Kerja FIM-Property
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          placeholder="nama@fimproperty.co.id"
          className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-xs focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
        />
        {state.fieldErrors?.email && (
          <p className="mt-1 text-xs text-red-600">{state.fieldErrors.email[0]}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-700"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
          placeholder="••••••••"
          className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-xs focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
        />
        {state.fieldErrors?.password && (
          <p className="mt-1 text-xs text-red-600">{state.fieldErrors.password[0]}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Memverifikasi Kredensial...' : 'Masuk ke Sistem CRM'}
      </button>
    </form>
  );
}
```

### 8.4 Pembaruan Halaman Login (`src/app/(auth)/login/page.tsx`)
Perbarui file `src/app/(auth)/login/page.tsx` agar merender `LoginForm` dengan sanitasi `redirectTo` dan penanganan parameter `reason`:

```typescript
// Lokasi: src/app/(auth)/login/page.tsx
// Layer 2: Presentation Layer (Server Component Halaman Login)

import { LoginForm } from '@/components/auth/LoginForm';
import { sanitizeInternalRedirectPath } from '@/modules/identity/auth/auth.schemas';

interface LoginPageProps {
  searchParams: Promise<{ redirectTo?: string; reason?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const redirectTo = sanitizeInternalRedirectPath(params.redirectTo);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="border-b border-slate-100 pb-4">
          <span className="inline-block rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            INTERNAL PORTAL
          </span>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            FIM-Property CRM
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Silakan masuk menggunakan akun resmi yang diberikan oleh Administrator.
          </p>
        </div>

        {params.reason === 'inactive' && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Sesi Anda dihentikan karena status akun tidak lagi aktif.
          </div>
        )}

        {params.reason === 'profile_missing' && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            Data profil staf internal tidak ditemukan. Hubungi Administrator FIM-Property.
          </div>
        )}

        <LoginForm redirectTo={redirectTo} />
      </div>
    </main>
  );
}
```

---

## 9. Session Management

Manajemen sesi di **FIM-Property** berjalan secara otomatis melalui koordinasi tiga komponen:
1. **Penyimpanan Sesi di HTTP-Only Cookie:**
   Saat `loginWithEmailPasswordAction` berhasil, `@supabase/ssr` menulis *access token* dan *refresh token* ke dalam cookie browser.
2. **Penyegaran Sesi Otomatis pada *Request Boundary* (`src/proxy.ts`):**
   Setiap kali pengguna berpindah halaman atau mengirim *form*, `src/proxy.ts` (yang telah dibuat pada File 01 `v1.1` Bagian 12) memanggil `await supabase.auth.getUser()`. Jika *access token* (masa berlaku 1 jam) sudah habis tetapi *refresh token* masih sah, `@supabase/ssr` otomatis menukarnya dengan *access token* baru dan memperbarui cookie di browser serta di header request server.
3. **Penanganan Sesi Kedaluwarsa (*Expired Session*) atau User Dinonaktifkan di Tengah Jalan:**
   * Jika *refresh token* juga sudah kedaluwarsa, `supabase.auth.getUser()` mengembalikan `user = null`, dan `src/proxy.ts` langsung mengarahkan pengguna kembali ke `/login?redirectTo=<path_terakhir>`.
   * Jika Admin menonaktifkan akun seorang Sales (`profiles.is_active = false`) saat Sales tersebut sedang membuka aplikasi, pemeriksaan `requireAuthContext()` di server dan fungsi `app_security.get_current_user_role()` di RLS database langsung mengembalikan `NULL` / menolak akses pada permintaan berikutnya tanpa menunggu token 1 jam habis.
   * **Catatan Sinkronisasi Lintas-Dokumen (`src/proxy.ts` pada File 01 `v1.1` & Modul B pada File 06):** Pada File 01 `v1.1`, blok #4 di `src/proxy.ts` mengalihkan setiap pengguna yang masih memiliki token `auth.getUser()` valid dari `/login` ke `/dashboard`. Agar tidak terjadi *redirect loop* ketika `requirePageAuth()` mengarahkan pengguna nonaktif ke `/login?reason=inactive`, pastikan pada implementasi backend (File 06 Modul B) penonaktifan akun juga melakukan *ban* sesi pada `auth.users` (`ban_duration`), atau pada penyelarasan `src/proxy.ts` berikutnya berikan pengecualian jika query `?reason=inactive` / `?reason=profile_missing` hadir serta bersihkan sesi di handler `/auth/logout`.

---

## 10. Server-side Authorization

Selain pemeriksaan dasar `requireAuthContext()` di `src/lib/supabase/server.ts`, kita membutuhkan penjaga otorisasi kontekstual (*Contextual Authorization Guards*) di **Layer 3** untuk melindungi halaman, *Server Actions*, dan *Route Handlers*.

### 10.1 Implementasi Guard Otorisasi (`src/modules/identity/auth/auth.guards.ts`)
Simpan file `src/modules/identity/auth/auth.guards.ts`:

```typescript
// Lokasi: src/modules/identity/auth/auth.guards.ts
// Layer 3: Server-Side Contextual Authorization Guards

import 'server-only';
import { redirect } from 'next/navigation';
import { requireAuthContext } from '@/lib/supabase/server';
import type { AuthenticatedUserContext, SystemRole } from '@/types/database.types';

export class AuthorizationError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code = 'FORBIDDEN_ACCESS', statusCode = 403) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Digunakan di dalam Server Components (page.tsx / layout.tsx) untuk melindungi halaman.
 * - Jika belum login -> redirect ke /login.
 * - Jika akun nonaktif -> redirect ke /login?reason=inactive.
 * - Jika profil tidak ditemukan -> redirect ke /login?reason=profile_missing.
 * - Jika role tidak diizinkan -> redirect ke /dashboard?error=forbidden.
 */
export async function requirePageAuth(
  allowedRoles?: SystemRole[]
): Promise<AuthenticatedUserContext> {
  try {
    return await requireAuthContext(allowedRoles);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.startsWith('UNAUTHORIZED:')) {
      redirect('/login');
    }
    if (message.includes('dinonaktifkan')) {
      redirect('/login?reason=inactive');
    }
    if (message.includes('profil staf internal tidak ditemukan')) {
      redirect('/login?reason=profile_missing');
    }
    redirect('/dashboard?error=forbidden');
  }
}

/**
 * Digunakan di dalam Server Actions dan Route Handlers sebelum menjalankan mutasi.
 * Melempar AuthorizationError terstruktur jika pengguna tidak memiliki hak akses.
 */
export async function requireActionAuth(
  allowedRoles?: SystemRole[]
): Promise<AuthenticatedUserContext> {
  try {
    return await requireAuthContext(allowedRoles);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Akses ditolak.';
    const isUnauth = message.startsWith('UNAUTHORIZED:');
    throw new AuthorizationError(
      message,
      isUnauth ? 'UNAUTHORIZED' : 'FORBIDDEN',
      isUnauth ? 401 : 403
    );
  }
}

/**
 * Memastikan bahwa pengguna yang sedang login berstatus aktif dan berhak
 * mengelola data dalam cakupan tim tertentu.
 * - ADMIN: Berhak atas seluruh tim perusahaan.
 * - SUPERVISOR / SALES: Hanya berhak jika targetTeamId sama dengan activeTeamId miliknya.
 */
export function assertTeamScopeAccess(
  actor: AuthenticatedUserContext,
  targetTeamId: string
): void {
  if (!actor.isActive) {
    throw new AuthorizationError(
      'FORBIDDEN: Akun staf Anda berstatus nonaktif.',
      'INACTIVE_ACCOUNT',
      403
    );
  }

  if (actor.systemRole === 'ADMIN') {
    return;
  }

  if (!actor.activeTeamId || actor.activeTeamId !== targetTeamId) {
    throw new AuthorizationError(
      'FORBIDDEN: Anda tidak memiliki wewenang untuk mengakses atau mengubah data milik tim penjualan lain.',
      'CROSS_TEAM_ACCESS_DENIED',
      403
    );
  }
}

/**
 * Memastikan kepemilikan data untuk level Sales / Supervisor / Admin:
 * - ADMIN: Berhak penuh.
 * - SUPERVISOR: Berhak jika data berada di dalam activeTeamId miliknya.
 * - SALES: Hanya berhak jika data berada di dalam activeTeamId miliknya DAN
 *          ownerSalesId sama dengan userId miliknya sendiri.
 */
export function assertResourceOwnership(
  actor: AuthenticatedUserContext,
  resourceOwnerSalesId: string,
  resourceTeamId: string
): void {
  if (!actor.isActive) {
    throw new AuthorizationError(
      'FORBIDDEN: Akun staf Anda berstatus nonaktif.',
      'INACTIVE_ACCOUNT',
      403
    );
  }

  if (actor.systemRole === 'ADMIN') {
    return;
  }

  // Baik SUPERVISOR maupun SALES wajib berada di dalam cakupan tim aktif yang sama
  assertTeamScopeAccess(actor, resourceTeamId);

  if (actor.systemRole === 'SUPERVISOR') {
    return;
  }

  if (actor.userId !== resourceOwnerSalesId) {
    throw new AuthorizationError(
      'FORBIDDEN: Data ini berada di bawah tanggung jawab Sales lain.',
      'OWNERSHIP_ACCESS_DENIED',
      403
    );
  }
}
```

---

## 11. PostgreSQL Grants dan Privileges

### 11.1 Hubungan antara PostgreSQL Privileges (`GRANT`/`REVOKE`) dan RLS
> **Konsep Fundamental Database:**  
> **Row Level Security (RLS) TIDAK menggantikan PostgreSQL Privileges (`GRANT`/`REVOKE`), melainkan bekerja secara berdampingan (*AND logic*).**  
> Agar sebuah query `DELETE FROM public.leads` berhasil dijalankan oleh seorang user, PostgreSQL memeriksa **dua hal**:
> 1. Apakah role database user tersebut (`anon` atau `authenticated`) memiliki izin `GRANT DELETE ON TABLE public.leads`?
> 2. Apakah ada kebijakan RLS `FOR DELETE` yang bernilai `true` untuk baris tersebut?
>
> Secara default di Supabase, setiap tabel baru yang dibuat di schema `public` otomatis mendapatkan `GRANT ALL` (termasuk `SELECT, INSERT, UPDATE, DELETE, TRUNCATE`) kepada role `anon` dan `authenticated`. Oleh karena itu, seluruh izin yang tidak semestinya wajib dicabut (`REVOKE`) secara eksplisit.

### 11.2 Strategi Pembatasan Hak Akses (`Least Privilege Grants`) FIM-Property
1. **Role `anon` (Pengguna Belum Login):**
   * Karena FIM-Property adalah sistem CRM internal tertutup, role **`anon` dicabut (`REVOKE ALL`) seluruh hak aksesnya** dari ke-32 tabel, kedua View, seluruh sequence, dan fungsi-fungsi di schema `public` maupun `app_security`. Pengguna yang belum login tidak bisa membaca atau mengubah satu objek pun di database.
2. **Role `authenticated` (Staf yang Sudah Login):**
   * **Larangan Mutlak `DELETE` & `TRUNCATE`:** Sesuai aturan bisnis **`BR-08`** dan **`BR-10`** (tidak ada *Hard Delete*), izin `DELETE` dan `TRUNCATE` dicabut dari `authenticated` pada **seluruh 32 tabel**.
   * **Tabel Histori & Audit (*Append-Only*):** Pada tabel histori dan log (`unit_price_histories`, `lead_score_histories`, `lead_pipeline_histories`, `lead_assignment_histories`, `lead_activities`, `booking_extensions`, `kpr_stage_histories`, `kpr_disbursements`, `deal_status_histories`), izin `UPDATE` tidak diberikan kepada `authenticated` sehingga rekam jejak masa lalu tidak pernah bisa dimodifikasi secara langsung.
   * **Tabel Transaksi Terkontrol RPC:** Pada `payment_records`, `bookings`, `payment_schedules`, `refund_transactions`, `kpr_applications`, dan `deals`, modifikasi oleh staf non-Admin sangat dibatasi oleh RLS serta trigger (misal `SALES` hanya bisa `INSERT` `payment_records` dengan status `'PENDING_VERIFICATION'`; perubahan status resmi berjalan lewat `ADMIN` atau fungsi RPC `SECURITY DEFINER` di File 04).
   * **Tabel Sistem Internal (`reference_sequences`, `notification_outbox`, `audit_logs`):** Dicabut izin tulis langsungnya dari `authenticated` sehingga hanya dapat dibaca oleh `ADMIN` dan dimutasi oleh RPC / `service_role`.
3. **Role `service_role` (Klien Admin Server Terisolasi):**
   * Tetap memiliki hak penuh untuk keperluan administrasi sistem, *Database Seeding*, *Transactional Outbox Dispatcher*, dan *Reminder Sweep*.

---

## 12. RLS Access Matrix (Matriks Akses Lengkap 32 Tabel)

Tabel berikut adalah spesifikasi matriks akses otoritatif untuk ke-32 tabel berdasarkan dokumen **Phase 0 `v1.2_FINAL`**, **Phase 1B `v1.1` Bagian 6.2**, dan **`FIM-PROPERTY_IMPLEMENTATION_02_DATABASE_MIGRATION_v1.4.md`**:

| No | Nama Tabel | Role | SELECT | INSERT | UPDATE | DELETE | Cakupan Data, Kondisi Ownership, Kondisi Tim & Catatan Keamanan |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **1** | `profiles` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola seluruh profil staf. |
| | | **SUPERVISOR** | Ya (Timnya + Diri) | Tidak | Ya (Diri sendiri) | Tidak | Supervisor membaca profil anggota tim aktifnya (`team_id = active_team_id`) & dirinya sendiri. Dilarang mengubah `system_role`, `is_active`, atau `email`. |
| | | **SALES** | Ya (Diri sendiri) | Tidak | Ya (Diri sendiri) | Tidak | Sales hanya membaca baris dirinya sendiri (`id = auth.uid()`) agar `email` & `phone` staf lain terlindungi. Nama Sales/Tim untuk katalog unit (`OQ-05`) diakses lewat `v_staff_directory`. |
| **2** | `teams` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola master data Tim Sales internal perusahaan. |
| | | **SUPERVISOR / SALES** | Ya (Semua) | Tidak | Tidak | Tidak | Read-only seluruh nama tim untuk keterbukaan katalog unit (`OQ-05`) bagi staf aktif (`is_active = true`). |
| **3** | `team_memberships` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin menugaskan Supervisor dan anggota Sales ke dalam tim. |
| | | **SUPERVISOR** | Ya (Timnya + Diri) | Tidak | Tidak | Tidak | Staf aktif membaca keanggotaan tim di dalam `team_id = active_team_id` miliknya serta baris dirinya sendiri (`is_active = true`). |
| | | **SALES** | Ya (Diri sendiri) | Tidak | Tidak | Tidak | Staf aktif membaca keanggotaan tim miliknya sendiri (`profile_id = auth.uid()` dan `get_current_user_role() IS NOT NULL`). |
| **4** | `developers` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola katalog Developer mitra produk (bukan tenant). |
| | | **SUPERVISOR / SALES** | Ya (Semua) | Tidak | Tidak | Tidak | Read-only seluruh katalog Developer untuk staf aktif (`ASM-01`). |
| **5** | `property_projects`| **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola katalog Proyek Perumahan. |
| | | **SUPERVISOR / SALES** | Ya (Semua) | Tidak | Tidak | Tidak | Read-only seluruh katalog Proyek Perumahan untuk staf aktif. |
| **6** | `property_types` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola spesifikasi Tipe Rumah. |
| | | **SUPERVISOR / SALES** | Ya (Semua) | Tidak | Tidak | Tidak | Read-only seluruh spesifikasi Tipe Rumah untuk staf aktif. |
| **7** | `units` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola katalog Unit. |
| | | **SUPERVISOR / SALES** | Ya (Semua) | Tidak | Via RPC | Tidak | Staf aktif dapat melihat status unit serta `current_holder_sales_id` & `current_holder_team_id` (`OQ-05`). Perubahan status unit menjadi `HELD` dilakukan lewat RPC `TX-01`. |
| **8** | `unit_price_histories`| **ADMIN** | Ya (Semua) | Ya | Tidak | Tidak | Tabel *immutable*; hanya boleh `INSERT` saat Admin mengubah harga unit (`changed_by = auth.uid()`). |
| | | **SUPERVISOR / SALES** | Ya (Semua) | Tidak | Tidak | Tidak | Read-only riwayat perubahan harga unit untuk staf aktif. |
| **9** | `promotions` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola program Promo. |
| | | **SUPERVISOR / SALES** | Ya (Semua) | Tidak | Tidak | Tidak | Read-only seluruh daftar Promo untuk staf aktif. |
| **10**| `leads` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Akses penuh seluruh Leads perusahaan; `assigned_sales_id` harus anggota aktif `team_id`. |
| | | **SUPERVISOR** | Ya (Timnya) | Ya (Timnya) | Ya (Timnya) | Tidak | Hanya Leads dengan `team_id = active_team_id`; saat `INSERT`/`UPDATE`, `assigned_sales_id` wajib anggota aktif di `active_team_id` (mencegah penugasan lintas tim). |
| | | **SALES** | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Tidak | Hanya Leads dengan `assigned_sales_id = auth.uid()` **dan** `team_id = active_team_id`. Saat `INSERT` (`OQ-01`), wajib milik dirinya & tim aktifnya. Dilarang mengubah `assigned_sales_id`, `team_id`, atau `created_by`. |
| **11**| `lead_score_histories`| **ADMIN** | Ya (Semua) | Ya | Tidak | Tidak | *Immutable history* (skoring deterministik berbasis aturan bisnis, non-ML). |
| | | **SUPERVISOR** | Ya (Timnya) | Ya (Timnya) | Tidak | Tidak | Hanya untuk `lead_id` yang lulus `can_access_lead(lead_id)`. |
| | | **SALES** | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Tidak | Tidak | Hanya untuk `lead_id` yang lulus `can_access_lead(lead_id)`. |
| **12**| `lead_pipeline_histories`| **ADMIN** | Ya (Semua) | Ya | Tidak | Tidak | *Immutable history*. `changed_by = auth.uid()`. |
| | | **SUPERVISOR** | Ya (Timnya) | Ya (Timnya) | Tidak | Tidak | Hanya untuk `lead_id` di dalam `active_team_id` (`changed_by = auth.uid()`). |
| | | **SALES** | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Tidak | Tidak | Hanya untuk `lead_id` miliknya di tim aktif (`changed_by = auth.uid()`). |
| **13**| `lead_assignment_histories`| **ADMIN** | Ya (Semua) | Ya | Tidak | Tidak | Admin dapat memindahkan Lead lintas tim & dalam tim. |
| | | **SUPERVISOR** | Ya (Timnya) | Ya (Timnya) | Tidak | Tidak | Wajib `can_access_lead(lead_id)`, `to_team_id = active_team_id`, dan `to_sales_id` anggota aktif tim tersebut. |
| | | **SALES** | Ya (Miliknya & Tim) | Ya (Awal `OQ-01`) | Tidak | Tidak | Wajib `can_access_lead(lead_id)`, `from_sales_id IS NULL`, `from_team_id IS NULL`, `to_sales_id = auth.uid()`, dan `to_team_id = active_team_id`. |
| **14**| `lead_activities` | **ADMIN** | Ya (Semua) | Ya | Tidak | Tidak | *Immutable communication log* (`BR-09`). |
| | | **SUPERVISOR** | Ya (Timnya) | Ya (Timnya) | Tidak | Tidak | Membaca & mencatat aktivitas untuk `lead_id` di dalam tim aktifnya (`sales_id = auth.uid()`). |
| | | **SALES** | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Tidak | Tidak | Membaca histori aktivitas pada `lead_id` yang kini dipegangnya, dan `INSERT` aktivitas baru dengan `sales_id = auth.uid()`. |
| **15**| `follow_up_tasks` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Akses penuh seluruh tugas tindak lanjut, termasuk validasi `related_kpr_application_id` & `related_schedule_id` terhadap `lead_id`. |
| | | **SUPERVISOR** | Ya (Timnya) | Ya (Timnya) | Ya (Timnya) | Tidak | Hanya untuk `lead_id` di dalam tim aktif (`can_access_lead`). Wajib validasi `assigned_sales_id` anggota aktif tim, serta konsistensi `related_kpr_application_id` & `related_schedule_id` dengan `lead_id`. |
| | | **SALES** | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Tidak | Hanya untuk `lead_id` yang lulus `can_access_lead(lead_id)` (`SELECT`), dan pada `INSERT`/`UPDATE` wajib `assigned_sales_id = auth.uid()` serta relasi `related_kpr_application_id` / `related_schedule_id` sah dan milik `lead_id` yang sama. Dikunci oleh trigger `trg_00_guard_follow_up_tasks_update`. |
| **16**| `site_visits` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Akses penuh seluruh jadwal survei lokasi. |
| | | **SUPERVISOR** | Ya (Timnya) | Ya (Timnya) | Ya (Timnya) | Tidak | Hanya survei untuk `lead_id` di tim aktif; `sales_id` harus anggota aktif tim tersebut. |
| | | **SALES** | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Tidak | Wajib `can_access_lead(lead_id)` (`SELECT`) dan `sales_id = auth.uid()` (`INSERT`/`UPDATE`). Dikunci oleh trigger `trg_00_guard_site_visits_update`. |
| **17**| `bookings` | **ADMIN** | Ya (Semua) | Via RPC | Ya / Via RPC | Tidak | Admin melihat semua, memperpanjang masa berlaku, dan membatalkan Booking. |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only monitoring untuk Booking di dalam `team_id = active_team_id`. |
| | | **SALES** | Ya (Miliknya & Tim) | Via RPC `TX-01` | Tidak | Tidak | Sales melihat Booking dengan `current_sales_id = auth.uid()` **dan** `team_id = active_team_id`. |
| **18**| `booking_extensions`| **ADMIN** | Ya (Semua) | Ya | Tidak | Tidak | Hanya Admin yang dapat memberikan perpanjangan masa berlaku (`OQ-03`). |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk Booking di dalam tim aktifnya (`can_access_booking`). |
| | | **SALES** | Ya (Miliknya & Tim) | Tidak | Tidak | Tidak | Read-only untuk Booking miliknya di tim aktifnya (`can_access_booking`). |
| **19**| `payment_schedules`| **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola jadwal tagihan transaksi properti (bukan cicilan bulanan bank). |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk Booking di dalam tim aktifnya (`can_access_booking`). |
| | | **SALES** | Ya (Miliknya & Tim) | Tidak | Tidak | Tidak | Read-only untuk Booking miliknya di tim aktifnya (`can_access_booking`). |
| **20**| `payment_records` | **ADMIN** | Ya (Semua) | Ya | Via RPC `TX-02` | Tidak | Hanya Admin yang berhak melakukan `VERIFY` / `REJECT` (`ASM-04`). |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk Booking di dalam tim aktifnya (`can_access_booking`). |
| | | **SALES** | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Tidak | Tidak | Sales menginput pembayaran baru untuk Booking miliknya dengan status wajib `'PENDING_VERIFICATION'`, `submitted_by_sales_id = auth.uid()`, `verified_by_admin_id IS NULL`, `verified_at IS NULL`, `verification_notes IS NULL`, serta validasi `replaces_payment_id` milik Booking yang sama dan berstatus `'REJECTED'`. |
| **21**| `refund_transactions`| **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Hanya Admin yang memproses pencairan refund (`PD-04`). |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk Booking di dalam tim aktifnya (`can_access_booking`). |
| | | **SALES** | Ya (Miliknya & Tim) | Tidak | Tidak | Tidak | Read-only untuk Booking miliknya di tim aktifnya (`can_access_booking`). |
| **22**| `kpr_bank_requirements`| **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola template syarat dokumen pengajuan KPR per bank (`OQ-06`). |
| | | **SUPERVISOR / SALES** | Ya (Semua) | Tidak | Tidak | Tidak | Read-only master syarat dokumen bank bagi staf aktif. |
| **23**| `kpr_applications` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin mengelola tahapan pengajuan KPR (`current_stage`), status (`application_status`), SP3K, Akad, dan pencairan dana bank. |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk pengajuan KPR dengan `team_id = active_team_id`. |
| | | **SALES** | Ya (Miliknya & Tim) | Tidak | Tidak | Tidak | Read-only untuk pengajuan KPR dengan `current_sales_id = auth.uid()` **dan** `team_id = active_team_id`. |
| **24**| `kpr_documents` | **ADMIN** | Ya (Semua) | Ya | Ya (Semua) | Tidak | Admin memverifikasi dokumen (`VERIFIED` / `REVISION_REQUIRED`). |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk KPR di dalam tim aktifnya (`can_access_kpr_application`). |
| | | **SALES** | Ya (Miliknya & Tim) | Ya (Miliknya & Tim) | Ya (Upload saja)| Tidak | Sales hanya boleh `INSERT`/`UPDATE` pada aplikasi KPR berstatus terbuka (`IN_PROGRESS`/`APPROVED`), status akhir `MISSING`/`UPLOADED` (`INSERT`) atau `UPLOADED` (`UPDATE`), tidak bisa menyentuh dokumen yang sudah `VERIFIED`, dan dilarang mengubah atribut verifikasi maupun `document_name`/`kpr_application_id`. |
| **25**| `kpr_stage_histories`| **ADMIN** | Ya (Semua) | Ya | Tidak | Tidak | *Immutable history* perpindahan tahap pengajuan KPR (`changed_by = auth.uid()`). |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk KPR di dalam tim aktifnya (`can_access_kpr_application`). |
| | | **SALES** | Ya (Miliknya & Tim) | Tidak | Tidak | Tidak | Read-only untuk KPR miliknya di tim aktifnya (`can_access_kpr_application`). |
| **26**| `kpr_disbursements`| **ADMIN** | Ya (Semua) | Via RPC `TX-08` | Tidak | Tidak | Hanya Admin yang mencatat pencairan dana KPR dari bank (`PRIMARY` & `SUBSEQUENT`, bukan cicilan bulanan konsumen). |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk KPR di dalam tim aktifnya (`can_access_kpr_application`). |
| | | **SALES** | Ya (Miliknya & Tim) | Tidak | Tidak | Tidak | Read-only untuk KPR miliknya di tim aktifnya (`can_access_kpr_application`). |
| **27**| `deals` | **ADMIN** | Ya (Semua) | Via RPC | Via RPC `TX-05` | Tidak | Admin mengesahkan transisi 3 dimensi Deal. |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk Deal dengan `team_id = active_team_id`. |
| | | **SALES** | Ya (Miliknya & Tim) | Tidak | Tidak | Tidak | Read-only untuk Deal dengan `current_sales_id = auth.uid()` **dan** `team_id = active_team_id`. |
| **28**| `deal_status_histories`| **ADMIN** | Ya (Semua) | Via RPC | Tidak | Tidak | *Immutable history* dimensi Deal. |
| | | **SUPERVISOR** | Ya (Timnya) | Tidak | Tidak | Tidak | Read-only untuk Deal di dalam tim aktifnya. |
| | | **SALES** | Ya (Miliknya & Tim) | Tidak | Tidak | Tidak | Read-only untuk Deal miliknya di tim aktifnya. |
| **29**| `reference_sequences`| **ADMIN** | Ya (Semua) | Via RPC | Via RPC | Tidak | Hanya dimutasi oleh generator nomor referensi di dalam transaksi RPC. |
| | | **SUPERVISOR / SALES** | Tidak | Tidak | Tidak | Tidak | Tidak ada akses langsung. |
| **30**| `notification_outbox`| **ADMIN** | Ya (Semua) | Via Sistem | Via Sistem | Tidak | Antrean internal *Transactional Outbox*. |
| | | **SUPERVISOR / SALES** | Tidak | Tidak | Tidak | Tidak | Tidak ada akses langsung. |
| **31**| `notifications` | **ADMIN / SUP / SALES** | Ya (Miliknya) | Via Sistem | Ya (`is_read` saja) | Tidak | Setiap user aktif hanya bisa membaca dan menandai `is_read = true` pada notifikasi dengan `recipient_user_id = auth.uid()`. |
| **32**| `audit_logs` | **ADMIN** | Ya (Semua) | Via RPC/Sistem | Tidak | Tidak | *Append-Only* khusus Admin (`Modul U`). |
| | | **SUPERVISOR / SALES** | Tidak | Tidak | Tidak | Tidak | Tidak memiliki akses baca maupun tulis. |

---

## 13. Implementasi RLS Policies, Grants, Helper Functions & Perlindungan Kolom (SQL Migration Lengkap)

Seluruh spesifikasi pada Bagian 11, 12, 14, 15, dan 16 diimplementasikan ke dalam satu file migrasi SQL yang utuh: **`supabase/migrations/20260301000700_auth_security_grants_and_rls.sql`**.

> **Penjelasan Struktur File Migrasi 7 Ini:**
> 1. **Bagian A:** Pembuatan **11 Helper Functions** di schema privat `app_security` (`SECURITY DEFINER` dengan `SET search_path = ''`), mencakup helper peran/tim (`get_current_user_role`, `get_current_user_active_team_id`, `is_active_member_of_team`), helper kepemilikan entitas (`can_access_lead`, `can_access_booking`, `can_access_kpr_application`), helper validasi silang relasi (`is_valid_follow_up_kpr_link`, `is_valid_follow_up_schedule_link`, `is_valid_replacement_payment`, `is_kpr_application_open`), serta `get_kpr_sold_policy_mode` (`TC-01A`).
> 2. **Bagian B:** Pembuatan fungsi `app_security.get_staff_directory()` serta View `public.v_staff_directory` dan `public.v_unit_catalog` dengan opsi **`WITH (security_invoker = true)`** untuk melindungi kolom sensitif (`email`, `phone`) pada `profiles` sekaligus memenuhi keterbukaan katalog unit `OQ-05`.
> 3. **Bagian C:** Pembuatan **6 *Anti-Privilege-Escalation Triggers*** (`trg_00_guard_profiles_update`, `trg_00_guard_leads_update`, `trg_00_guard_follow_up_tasks_update`, `trg_00_guard_site_visits_update`, `trg_00_guard_kpr_documents_update`, dan `trg_00_guard_notifications_update`) dengan penanganan eksplisit nilai `NULL` pada role.
> 4. **Bagian D:** Pengaturan `REVOKE` dan `GRANT` eksplisit untuk `anon`, `authenticated`, dan `service_role`.
> 5. **Bagian E:** Pengaktifan `ENABLE ROW LEVEL SECURITY` dan pembuatan seluruh **80 kebijakan RLS** (`CREATE POLICY`) untuk ke-32 tabel.

### Buat File: `supabase/migrations/20260301000700_auth_security_grants_and_rls.sql`

```sql
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
```

```sql
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
```

---

### 13.1 Penjelasan Mendalam Setiap Kelompok Kebijakan RLS (6 Poin Analisis)

#### Kelompok 1: Kebijakan Identitas & Keanggotaan Tim (`profiles`, `teams`, `team_memberships`)
1. **Tujuan:** Mengamankan data pribadi staf (email dan nomor telepon) sekaligus memastikan struktur tim hanya dapat dimodifikasi oleh Admin.
2. **Role yang Diperbolehkan:** `ADMIN` (CRUD tanpa Delete), `SUPERVISOR` (Read anggota tim aktifnya + diri sendiri, Update profil non-sensitif dirinya sendiri), `SALES` (Read/Update profil non-sensitif dirinya sendiri).
3. **Kondisi Akses:** Menggunakan `id = auth.uid()` pada `profiles` `SELECT` (agar login bisa mendeteksi `is_active = false`), `profile_id = auth.uid() AND get_current_user_role() IS NOT NULL` pada `team_memberships`, serta pemeriksaan `team_id = app_security.get_current_user_active_team_id()` untuk Supervisor.
4. **Alasan Keamanan:** Mencegah pengintaian kontak pribadi staf lintas tim (*staff contact harvesting*) sementara tetap menyediakan `v_staff_directory` untuk menampilkan nama Sales pemegang unit (`OQ-05`).
5. **Risiko yang Dicegah:** Pengubahan `system_role`, `is_active`, atau perpindahan tim secara ilegal oleh pengguna biasa.
6. **Cara Menguji Policy:** Login sebagai Sales Tim Alpha, jalankan `SELECT * FROM public.profiles`. Hanya 1 baris (miliknya sendiri) yang kembali.

#### Kelompok 2: Kebijakan Katalog Properti, Harga & Promo (`developers`, `property_projects`, `property_types`, `units`, `unit_price_histories`, `promotions`)
1. **Tujuan:** Memberikan visibilitas katalog properti ke seluruh staf aktif (`ASM-01` & `OQ-05`) namun mengunci wewenang perubahan katalog dan harga hanya pada Admin.
2. **Role yang Diperbolehkan:** `ADMIN`, `SUPERVISOR`, `SALES` untuk `SELECT`; khusus `ADMIN` untuk `INSERT`/`UPDATE`.
3. **Kondisi Akses:** `app_security.get_current_user_role() IS NOT NULL` (memastikan user tidak hanya login, tetapi juga berstatus `is_active = true`).
4. **Alasan Keamanan:** Mencegah Sales memanipulasi harga katalog unit atau mengubah diskon promo sebelum mengajukan Booking.
5. **Risiko yang Dicegah:** Manipulasi harga katalog tanpa jejak `unit_price_histories` dan perubahan status unit secara paksa di luar prosedur Booking.
6. **Cara Menguji Policy:** Login sebagai Sales atau Supervisor, coba jalankan `UPDATE public.units SET catalog_price = 100000 WHERE ...`. Operasi ditolak oleh RLS (`0 rows updated`).

#### Kelompok 3: Kebijakan Operasional CRM & Pre-Sales (`leads`, `lead_score_histories`, `lead_pipeline_histories`, `lead_assignment_histories`, `lead_activities`, `follow_up_tasks`, `site_visits`)
1. **Tujuan:** Menegakkan isolasi data pelanggan (*Lead Isolation* — `ASM-02`) agar prospek milik Sales A tidak bocor ke Sales B atau ke Tim lain, sekaligus mencegah penautan tugas tindak lanjut lintas Lead/KPR.
2. **Role yang Diperbolehkan:** `ADMIN` (Seluruh perusahaan), `SUPERVISOR` (Cakupan tim aktifnya), `SALES` (Miliknya sendiri di dalam tim aktifnya).
3. **Kondisi Akses:** Pada `leads`, evaluasi langsung terhadap `team_id = get_current_user_active_team_id()` dan `assigned_sales_id = auth.uid()`. Pada tabel anak, evaluasi menggunakan fungsi `app_security.can_access_lead(lead_id)`. Pada `follow_up_tasks`, ditambahkan validasi silang `is_valid_follow_up_kpr_link(lead_id, related_kpr_application_id)` dan `is_valid_follow_up_schedule_link(lead_id, related_schedule_id)` serta pembatasan `assigned_sales_id` melalui `is_active_member_of_team`.
4. **Alasan Keamanan:** Menjamin seorang Sales tidak dapat membuat Lead atas nama Sales lain, Supervisor tidak dapat menugaskan Lead/Task/Site Visit ke Sales tim lain, perpindahan tim langsung memutus akses data tim lama, serta tugas KPR tidak bisa ditautkan ke pengajuan KPR milik prospek lain.
5. **Risiko yang Dicegah:** Pembajakan prospek (*lead poaching*), manipulasi histori assignment, kebocoran data kontak calon pembeli antar-tim, dan akses pasca-nonaktif/pasca-pindah-tim pada `follow_up_tasks` & `site_visits`.
6. **Cara Menguji Policy:** Login sebagai Sales A, lakukan query `SELECT * FROM public.leads WHERE assigned_sales_id = '<ID_SALES_B>'`. Hasil wajib `0 baris`.

#### Kelompok 4: Kebijakan Transaksi, Keuangan, Refund, KPR & Deal (`bookings`, `booking_extensions`, `payment_schedules`, `payment_records`, `refund_transactions`, `kpr_*`, `deals`, `deal_status_histories`)
1. **Tujuan:** Mengamankan dokumen kontrak, jadwal tagihan transaksi properti, verifikasi uang masuk, pencairan refund, serta pemantauan progres pengajuan KPR pelanggan hingga pencairan dana bank.
2. **Role yang Diperbolehkan:** `ADMIN` (Kontrol penuh & verifikasi), `SUPERVISOR` (Monitoring tim aktifnya), `SALES` (Monitoring transaksi miliknya di tim aktifnya + input pembayaran baru dengan status wajib `'PENDING_VERIFICATION'` + unggah berkas persyaratan KPR berstatus terbuka dengan status `'UPLOADED'`).
3. **Kondisi Akses:** Menggunakan `app_security.can_access_booking(booking_id)`, `app_security.can_access_kpr_application(kpr_application_id)`, `app_security.is_valid_replacement_payment(...)`, dan `app_security.is_kpr_application_open(...)`.
4. **Alasan Keamanan:** Menegakkan prinsip pemisahan tugas keuangan (*Segregation of Duties* — `ASM-04`): pihak yang mengunggah bukti bayar atau dokumen KPR (`SALES`) mustahil memverifikasi pembayarannya/dokumennya sendiri (`VERIFIED`), maupun memalsukan status `kpr_documents` lewat `INSERT` atau mengubah status tahapan `kpr_applications`.
5. **Risiko yang Dicegah:** Pemalsuan status lunas (`PAID`/`VERIFIED`), penyisipan dokumen `VERIFIED` oleh Sales via `INSERT`, koreksi pembayaran lintas Booking (`replaces_payment_id` spoofing), dan kebocoran dokumen KPR pelanggan ke tim lain.
6. **Cara Menguji Policy:** Login sebagai Sales, coba jalankan `INSERT INTO public.payment_records (..., verification_status) VALUES (..., 'VERIFIED')` atau `INSERT INTO public.kpr_documents (..., status) VALUES (..., 'VERIFIED')`. Keduanya ditolak langsung oleh klausa `WITH CHECK` RLS.

#### Kelompok 5: Kebijakan Infrastruktur Sistem (`reference_sequences`, `notification_outbox`, `notifications`, `audit_logs`)
1. **Tujuan:** Mengisolasi antrean sistem, melindungi kotak masuk notifikasi pribadi, dan menjaga kemurnian Audit Log (`BR-10`).
2. **Role yang Diperbolehkan:** `notifications` diakses oleh pemiliknya yang masih aktif (`recipient_user_id = auth.uid()` dan `get_current_user_role() IS NOT NULL`); `audit_logs`, `reference_sequences`, dan `notification_outbox` hanya dapat dibaca oleh `ADMIN`.
3. **Kondisi Akses:** Pada `notifications`, pengguna hanya diizinkan melakukan `UPDATE` pada kolom `(is_read, read_at)` berkat kombinasi *Column-Level Grant* (`GRANT UPDATE (is_read, read_at)`) dan trigger `trg_00_guard_notifications_update`.
4. **Alasan Keamanan:** Mencegah penghapusan jejak kejahatan pada `audit_logs` oleh siapa pun (termasuk Admin sekalipun karena tidak ada izin `UPDATE` atau `DELETE` pada `audit_logs`).
5. **Risiko yang Dicegah:** Manipulasi nomor urut transaksi dan penghapusan rekam jejak audit.
6. **Cara Menguji Policy:** Login sebagai Admin sekalipun, coba jalankan `DELETE FROM public.audit_logs` atau `UPDATE public.audit_logs SET ...`. Keduanya langsung ditolak dengan `ERROR: permission denied for table audit_logs`.

### 13.2 Integrasi Fondasi Keamanan dengan Supabase Private Storage (File 05)
Kebijakan RLS pada tabel `storage.objects` untuk bucket privat `fim-private-documents` (diimplementasikan di File 05: `20260301000900_private_storage_buckets_and_policies.sql`) bergantung langsung pada fungsi `app_security` yang didefinisikan pada dokumen ini:
1. **`app_security.can_access_booking(booking_id)`:** Dipanggil oleh `app_security.can_read_storage_object` dan `app_security.can_upload_storage_object`. Karena fungsi ini kini mewajibkan `b.team_id = app_security.get_current_user_active_team_id()` untuk `SALES` (selain `b.current_sales_id = auth.uid()`) dan memvalidasi `is_active = true`, maka ketika seorang Sales dipindahkan ke tim lain atau dinonaktifkan, hak pembuatan *Signed URL* (300 detik) dan hak unggahnya pada bucket `fim-private-documents` langsung tercabut otomatis tanpa perlu memodifikasi file fisik di Storage.
2. **`app_security.get_current_user_role()`:** Menentukan pemisahan hak unggah antar-subfolder di Storage (`payments` & `kpr-docs` oleh `ADMIN`/`SALES`; `kpr-disbursements`, `refunds`, & `contracts` khusus `ADMIN`; `SUPERVISOR` bersifat *read-only* sepenuhnya terhadap dokumen Storage).

---

## 14. Perlindungan Kolom Sensitif

Banyak pengembang pemula salah mengira bahwa kebijakan RLS dapat menyembunyikan kolom tertentu dalam satu baris. **Faktanya, RLS di PostgreSQL bekerja pada tingkat baris (*Row-Level*), bukan tingkat kolom (*Column-Level*)**: jika sebuah baris lolos kondisi `USING (...)`, maka seluruh kolom pada baris tersebut yang memiliki izin `GRANT SELECT` dapat dibaca oleh pemanggil.

Di **FIM-Property**, terdapat dua kasus perlindungan kolom sensitif yang kita selesaikan secara arsitektural:

1. **Kasus 1: Melindungi `email` dan `phone` Staf di Tabel `profiles` Saat Menampilkan Pemegang Reservasi Unit (`OQ-05`)**
   * *Masalah:* Aturan `OQ-05` mewajibkan semua Sales aktif dapat melihat **Nama Sales** dan **Nama Tim** yang sedang memegang reservasi unit (`HELD`/`BOOKED`/`SOLD`). Namun jika kita membuka kebijakan `SELECT` pada tabel `public.profiles` untuk semua Sales, maka Sales Tim Alpha dapat mengambil alamat email dan nomor telepon pribadi seluruh Sales Tim Bravo dan Tim Charlie.
   * *Solusi yang Diterapkan:*
     * Kebijakan RLS `pol_profiles_select` pada tabel `public.profiles` mengunci akses `SELECT` bagi Sales **hanya untuk baris dirinya sendiri (`id = auth.uid()`)**.
     * Untuk kebutuhan direktori nama staf dan katalog unit (`OQ-05`), kita menyediakan View **`public.v_staff_directory`** dan **`public.v_unit_catalog`** dengan opsi **`WITH (security_invoker = true)`** yang hanya mengekspos kolom non-sensitif (`profile_id`, `full_name`, `system_role`, `is_active`, `active_team_name`) melalui fungsi `app_security.get_staff_directory()` dan **tidak menyertakan kolom `email` maupun `phone`**.
2. **Kasus 2: Melindungi Kolom Status, Relasi Induk & Ownership dari Manipulasi `UPDATE` (`profiles`, `leads`, `follow_up_tasks`, `site_visits`, `kpr_documents`, `notifications`)**
   * *Masalah:* Seorang Sales berhak melakukan `UPDATE` pada baris `leads`, `follow_up_tasks`, `site_visits`, atau `kpr_documents` miliknya. Namun tanpa penguncian tingkat kolom, Sales tersebut dapat ikut memodifikasi kolom `assigned_sales_id`, `team_id`, `lead_id`, `source_type`, `related_kpr_application_id`, atau `verified_by` dalam perintah `UPDATE` yang sama.
   * *Solusi yang Diterapkan:* Kombinasi **Column-Level `GRANT UPDATE`** (pada `notifications`), pemeriksaan klausa **`WITH CHECK`** pada RLS, serta **6 Trigger Penjaga Kolom (`BEFORE UPDATE` Security Guard Triggers)** pada Bagian C migrasi di atas.

---

## 15. Helper Functions

Seluruh **12 *Helper Functions*** di dalam schema **`app_security`** pada Migrasi 7 (11 helper otorisasi/kebijakan di Bagian A + `get_staff_directory` di Bagian B) dirancang dengan parameter keamanan ketat:
1. **Mengapa Menggunakan `SECURITY DEFINER`?**
   Ketika pengguna mengakses tabel `payment_schedules` atau `follow_up_tasks`, kebijakan RLS memanggil `app_security.can_access_booking(booking_id)`, `app_security.can_access_lead(lead_id)`, atau `app_security.is_valid_follow_up_kpr_link(...)`. Jika kita menulis subquery langsung di dalam kebijakan RLS setiap tabel anak yang merujuk berjenjang ke `kpr_applications` $\rightarrow$ `bookings` $\rightarrow$ `team_memberships` $\rightarrow$ `profiles`, evaluasi RLS bertingkat di PostgreSQL dapat mengalami penurunan performa drastis atau bahkan *infinite recursion* (saat kebijakan `profiles` dan `team_memberships` saling memeriksa). Dengan `SECURITY DEFINER` + atribut `STABLE`, PostgreSQL mengeksekusi pemeriksaan kepemilikan secara cepat dengan memanfaatkan indeks dan melakukan *caching* hasil fungsi selama satu pernyataan query berjalan.
2. **Mengapa Aman dari *Privilege Escalation*?**
   * Ditempatkan di schema **`app_security`** yang **tidak terdaftar** pada `schemas = ["public", "storage", "graphql_public"]` di `supabase/config.toml`, sehingga fungsi ini **tidak bisa dipanggil melalui HTTP REST/RPC dari browser**.
   * Mendeklarasikan **`SET search_path = ''`** sehingga kebal terhadap serangan pembajakan objek schema.
   * Identitas pemanggil selalu diambil secara internal dari `auth.uid()` (tidak menerima `p_actor_id` dari luar) dan selalu memvalidasi `p.is_active = true` serta `tm.is_active = true`. Untuk fungsi pengecek relasi seperti `is_valid_follow_up_kpr_link`, fungsi juga langsung mengembalikan `false` jika `get_current_user_role() IS NULL`.

---

## 16. Proteksi Privilege Escalation

Tabel berikut merangkum bagaimana sistem menggagalkan 9 vektor serangan *Privilege Escalation* dan manipulasi relasi paling berbahaya:

| Vektor Percobaan Serangan | Lapisan Pertahanan yang Memblokir | Hasil Saat Serangan Dicoba |
| :--- | :--- | :--- |
| **1. Sales mencoba mengubah `system_role` miliknya menjadi `'ADMIN'` di tabel `profiles`** | Trigger `app_security.trg_00_guard_profiles_update` (`BEFORE UPDATE`). | Transaksi langsung gagal dengan `ERROR: PRIVILEGE_ESCALATION_BLOCKED: Anda dilarang mengubah system_role sendiri.` |
| **2. Sales mencoba mengubah `team_id` atau memasukkan dirinya ke tim lain di `team_memberships`** | Kebijakan RLS `pol_team_memberships_insert_admin` & `pol_team_memberships_update_admin`. | Ditolak oleh RLS karena hanya `ADMIN` yang memiliki policy `INSERT`/`UPDATE` pada `team_memberships`. |
| **3. Sales mencoba mengambil alih Lead milik Sales lain atau memindahkan Lead-nya sendiri** | Kebijakan RLS `pol_leads_update` (`USING` & `WITH CHECK`) + Trigger `trg_00_guard_leads_update`. | Jika Lead milik orang lain: `0 rows affected`. Jika mencoba mengubah `assigned_sales_id`/`team_id` pada Lead sendiri: melempar `EXCEPTION: PRIVILEGE_ESCALATION_BLOCKED`. |
| **4. Supervisor Tim Alpha mencoba menugaskan Lead, Task, atau Site Visit ke Sales Tim Bravo** | Kebijakan RLS (`is_active_member_of_team`) + Trigger `trg_00_guard_leads_update`. | Ditolak oleh RLS (`new row violates row-level security policy`) atau Trigger (`PRIVILEGE_ESCALATION_BLOCKED`). |
| **5. Sales mencoba menginput `payment_records` langsung dengan status `'VERIFIED'` atau mereferensikan `replaces_payment_id` Booking lain** | Kebijakan RLS `pol_payment_records_insert_sales_or_admin` (`WITH CHECK` + `is_valid_replacement_payment`). | Ditolak oleh RLS (`new row violates row-level security policy`). |
| **6. Sales mencoba menyisipkan (`INSERT`) dokumen KPR berstatus `'VERIFIED'` atau mengubah status dokumen di `kpr_documents` menjadi `'VERIFIED'`** | Kebijakan RLS `pol_kpr_documents_insert` (`status IN ('MISSING', 'UPLOADED')`, `verified_by IS NULL`) & `pol_kpr_documents_update` + Trigger `trg_00_guard_kpr_documents_update`. | Ditolak oleh RLS saat `INSERT` dan oleh Trigger `EXCEPTION: PRIVILEGE_ESCALATION_BLOCKED` saat `UPDATE`. |
| **7. Sales/Supervisor mencoba menautkan `follow_up_tasks.related_kpr_application_id` atau `related_schedule_id` ke pengajuan KPR/jadwal milik Lead lain** | Kebijakan RLS `pol_follow_up_tasks_insert` & `pol_follow_up_tasks_update` (`is_valid_follow_up_kpr_link`, `is_valid_follow_up_schedule_link`) + Trigger `trg_00_guard_follow_up_tasks_update`. | Ditolak oleh RLS (`new row violates row-level security policy`) saat pembuatan/pembaruan. |
| **8. Sales mencoba memodifikasi tahap/status pengajuan pada `kpr_applications` secara langsung** | Kebijakan RLS `pol_kpr_applications_update_admin` (`ADMIN` only). | Operasi `UPDATE` ditolak RLS (`0 rows affected`). |
| **9. Pengguna mencoba menghapus baris di `audit_logs`, `leads`, atau `payment_records`** | Pencabutan hak akses objek (`REVOKE ALL` / tidak ada `GRANT DELETE`) + tidak adanya policy `FOR DELETE`. | Ditolak seketika di tingkat gerbang privilege PostgreSQL (`ERROR: permission denied for table ...`). |

---

## 17. Pengujian Security (18 Skenario Pengujian Keamanan Wajib)

Setelah Anda menerapkan migrasi ke-7 dengan perintah `npm run db:reset`, jalankan **Skrip Pengujian Keamanan** berikut di **Supabase Studio SQL Editor** (`http://127.0.0.1:54323`) untuk memverifikasi seluruh aturan keamanan di atas pada database target Anda.

### 17.1 Matriks 18 Skenario Pengujian Keamanan

| ID Skenario | Skenario Pengujian | Kondisi Awal | Langkah / Query yang Diuji | Hasil yang Diharapkan & Kriteria Lulus |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **User Belum Login (`anon`)** | Role diset ke `anon` (`auth.uid() = NULL`). | `SELECT * FROM public.leads;` atau `SELECT * FROM public.units;` | **Ditolak (`permission denied for table`)**. Role `anon` memiliki 0 akses ke seluruh tabel & view. |
| **SEC-02** | **User Login sebagai Admin** | Sesi JWT disimulasikan sebagai Admin aktif. | `SELECT count(*) FROM public.leads;` & `SELECT count(*) FROM public.audit_logs;` | **Berhasil**. Admin dapat membaca seluruh Leads lintas tim dan membaca Audit Log. |
| **SEC-03** | **User Login sebagai Supervisor** | Sesi disimulasikan sebagai Supervisor Tim Alpha. | `SELECT * FROM public.leads;` | **Berhasil Terfilter**. Hanya menampilkan Leads yang berada di dalam `Tim Alpha`. |
| **SEC-04** | **User Login sebagai Sales** | Sesi disimulasikan sebagai Sales 1 (Tim Alpha). | `SELECT * FROM public.leads;` | **Berhasil Terfilter**. Hanya menampilkan Leads dengan `assigned_sales_id = ID Sales 1` dan `team_id = Tim Alpha`. |
| **SEC-05** | **Sales Membaca Lead Sales Lain** | Login sebagai Sales 1 (Tim Alpha). | `SELECT * FROM public.leads WHERE assigned_sales_id = '<ID_SALES_2>';` | **Mengembalikan 0 Baris**. Sales 1 tidak bisa mengintip Lead milik Sales 2 meskipun satu tim. |
| **SEC-06** | **Sales Mengubah Ownership Lead** | Login sebagai Sales 1. | `UPDATE public.leads SET assigned_sales_id = '<ID_SALES_2>' WHERE id = '<LEAD_SALES_1>';` | **Ditolak dengan Exception**: `PRIVILEGE_ESCALATION_BLOCKED: Sales tidak diizinkan mengubah kepemilikan Lead atau Tim.` |
| **SEC-07** | **Sales Mengubah Role Sendiri menjadi Admin** | Login sebagai Sales 1. | `UPDATE public.profiles SET system_role = 'ADMIN' WHERE id = auth.uid();` | **Ditolak dengan Exception**: `PRIVILEGE_ESCALATION_BLOCKED: Anda dilarang mengubah system_role sendiri.` |
| **SEC-08** | **Sales Mengubah Team Assignment** | Login sebagai Sales 1. | `UPDATE public.team_memberships SET team_id = '<ID_TIM_BRAVO>' WHERE profile_id = auth.uid();` | **Mengembalikan 0 Baris Terubah** (Ditolak oleh RLS `pol_team_memberships_update_admin`). |
| **SEC-09** | **Supervisor Mengakses Data Tim Lain** | Login sebagai Supervisor Tim Alpha. | Query `SELECT` atau `UPDATE` pada Lead/Booking/KPR milik `Tim Bravo`. | **Mengembalikan 0 Baris**. Supervisor Tim Alpha terisolasi penuh dari data Tim Bravo. |
| **SEC-10** | **User Nonaktif (`is_active = false`) Mengakses Database** | Akun Sales diubah menjadi `is_active = false`, namun JWT-nya masih dikirim. | `SELECT * FROM public.units;`, `SELECT * FROM public.follow_up_tasks;`, `UPDATE public.site_visits ...` | **Mengembalikan 0 Baris / 0 Baris Terubah**. Karena `get_current_user_role()` dan `can_access_lead()` memeriksa `is_active = true`, seluruh akses langsung tertutup. |
| **SEC-11** | **Request Langsung Memalsukan Status `VERIFIED` Pembayaran** | Login sebagai Sales 1, mengirim query `INSERT` langsung ke `payment_records`. | `INSERT INTO public.payment_records (..., verification_status) VALUES (..., 'VERIFIED');` | **Ditolak oleh RLS (`new row violates row-level security policy`)**. |
| **SEC-12** | **Perlindungan Kolom Sensitif Staf (`email` & `phone`) vs Katalog Unit (`OQ-05`)** | Login sebagai Sales 1 (Tim Alpha). | 1. `SELECT email, phone FROM public.profiles WHERE id = '<ID_SALES_BRAVO>';`<br>2. `SELECT unit_code, status, current_holder_sales_name, current_holder_team_name FROM public.v_unit_catalog;` | 1. Query ke `profiles` mengembalikan **0 Baris** (email & telepon staf lain terlindungi).<br>2. Query ke `v_unit_catalog` **berhasil** menampilkan nama Sales & nama Tim pemegang unit (`OQ-05`). |
| **SEC-13** | **Percobaan Menghapus Data (`DELETE`) pada Tabel & Audit Log** | Login sebagai Sales, Supervisor, maupun Admin. | `DELETE FROM public.audit_logs;` atau `DELETE FROM public.leads;` | **Ditolak (`permission denied for table`)** karena izin `DELETE` telah dicabut (`REVOKE`). |
| **SEC-14** | **Perpindahan Tim Mencabut Akses Data Tim Lama Secara Langsung** | Sales 1 dipindahkan dari Tim Alpha ke Tim Bravo (`team_memberships` aktif = Bravo), sementara masih ada histori/data di Tim Alpha. | Query `SELECT` / `UPDATE` pada `leads`, `follow_up_tasks`, `bookings`, dan `kpr_applications` milik Tim Alpha. | **Mengembalikan 0 Baris / 0 Baris Terubah** karena seluruh helper & policy Sales memverifikasi `team_id = get_current_user_active_team_id()`. |
| **SEC-15** | **Validasi Silang `follow_up_tasks.related_kpr_application_id` & `related_schedule_id`** | Login sebagai Sales 1 (pemegang Lead A) atau Supervisor Alpha. | `INSERT INTO public.follow_up_tasks (lead_id, ..., related_kpr_application_id) VALUES ('<LEAD_A>', ..., '<KPR_MILIK_LEAD_B>');` | **Ditolak oleh RLS (`new row violates row-level security policy`)** karena `is_valid_follow_up_kpr_link` memastikan KPR harus berasal dari Booking milik `lead_id` yang sama. |
| **SEC-16** | **Sales Menyisipkan Dokumen KPR Berstatus `VERIFIED` via `INSERT` atau Mengubah Dokumen `VERIFIED`** | Login sebagai Sales 1 pada KPR miliknya. | 1. `INSERT INTO public.kpr_documents (..., status) VALUES (..., 'VERIFIED');`<br>2. `UPDATE public.kpr_documents SET file_path = 'hack.pdf' WHERE status = 'VERIFIED';` | 1. Ditolak oleh RLS `pol_kpr_documents_insert`.<br>2. Ditolak oleh Trigger `trg_00_guard_kpr_documents_update` (`PRIVILEGE_ESCALATION_BLOCKED`). |
| **SEC-17** | **Supervisor Menugaskan Lead/Task/Site Visit ke Sales Tim Lain** | Login sebagai Supervisor Tim Alpha. | `INSERT`/`UPDATE` `leads`, `follow_up_tasks`, atau `site_visits` dengan `assigned_sales_id = '<ID_SALES_BRAVO>'`. | **Ditolak oleh RLS / Trigger** karena `is_active_member_of_team` menolak anggota di luar Tim Alpha. |
| **SEC-18** | **Sales Memodifikasi Langsung `kpr_applications`** | Login sebagai Sales 1. | `UPDATE public.kpr_applications SET current_stage = 'APPROVED', application_status = 'APPROVED' WHERE current_sales_id = auth.uid();` | **Mengembalikan 0 Baris Terubah** (Ditolak oleh RLS `pol_kpr_applications_update_admin`). |

---

### 17.2 Skrip SQL Verifikasi Otomatis Kebijakan Keamanan & RLS
Jalankan perintah berikut di terminal untuk menerapkan Migrasi 7 terlebih dahulu:
```bash
npm run db:reset
```

Kemudian jalankan query pemeriksaan struktur keamanan berikut di **Supabase Studio SQL Editor**:

```sql
-- ============================================================================
-- VERIFIKASI AKTIVASI RLS & KEBIJAKAN KEAMANAN PADA 32 TABEL
-- ============================================================================

-- 1. Pastikan seluruh 32 tabel di schema public memiliki rowsecurity = true (Harus 32)
SELECT count(*) AS total_rls_enabled_tables
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = true;

-- 2. Pastikan TIDAK ADA satu pun tabel di schema public yang lupa diaktifkan RLS-nya (Harus 0)
SELECT tablename AS unprotected_table
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false;

-- 3. Pastikan role 'anon' memiliki 0 privilege pada seluruh tabel di schema public (Harus 0)
SELECT count(*) AS anon_table_grants
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon';

-- 4. Pastikan role 'authenticated' TIDAK memiliki izin DELETE pada tabel mana pun (Harus 0)
SELECT count(*) AS authenticated_delete_grants
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'authenticated'
  AND privilege_type = 'DELETE';

-- 5. Tampilkan rekapitulasi jumlah policy RLS yang terpasang (Harus 80)
SELECT count(*) AS total_rls_policies
FROM pg_policies
WHERE schemaname = 'public';

-- 6. Pastikan seluruh 18 fungsi di schema app_security (12 helper + 6 fungsi trigger) menggunakan SECURITY DEFINER
SELECT routine_name, security_type
FROM information_schema.routines
WHERE routine_schema = 'app_security'
ORDER BY routine_name;

-- 7. Pastikan keenam trigger guard BEFORE UPDATE terpasang di schema public
SELECT event_object_table, trigger_name
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE 'trg_00_guard_%'
ORDER BY event_object_table;
```

* **Kriteria Lulus Verifikasi:**
  * `total_rls_enabled_tables` = **`32`**
  * `unprotected_table` = **`0 baris`**
  * `anon_table_grants` = **`0`**
  * `authenticated_delete_grants` = **`0`**
  * `total_rls_policies` = **`80`** kebijakan RLS aktif yang melindungi seluruh 32 tabel.
  * Seluruh **18 fungsi** pada schema `app_security` (`12` helper otorisasi/direktori + `6` fungsi trigger `trg_guard_*`) tampil dengan `security_type = 'DEFINER'`.
  * Keenam trigger `trg_00_guard_*` terpasang pada `profiles`, `leads`, `follow_up_tasks`, `site_visits`, `kpr_documents`, dan `notifications`.

---

## 18. Troubleshooting

| No | Gejala / Pesan Error | Penyebab Utama | Solusi Penyelesaian |
| :--- | :--- | :--- | :--- |
| **1** | Query di Server Component mengembalikan array kosong `[]` padahal data ada di Supabase Studio. | Supabase Studio berjalan sebagai `postgres` (superuser), sedangkan aplikasi berjalan sebagai `authenticated`. User yang sedang login mungkin belum memiliki baris di `public.profiles`, `is_active = false`, atau belum dimasukkan ke `team_memberships` aktif. | Periksa bahwa `auth.uid()` pengguna tersebut sudah terdaftar di tabel `public.profiles` dengan `is_active = true` dan memiliki baris aktif di `public.team_memberships` pada tim yang juga aktif (`teams.is_active = true`). |
| **2** | `ERROR: infinite recursion detected in policy for relation "profiles"`. | Terjadi jika kebijakan RLS pada `profiles` memanggil subquery biasa ke `profiles` atau `team_memberships` tanpa melalui fungsi `SECURITY DEFINER` di schema `app_security`. | Pastikan seluruh kebijakan RLS selalu memanggil `app_security.get_current_user_role()` dan `app_security.get_current_user_active_team_id()`, bukan menulis subquery mentah ke `profiles`. |
| **3** | `ERROR: permission denied for schema app_security`. | Lupa memberikan `GRANT USAGE ON SCHEMA app_security TO authenticated;` setelah menjalankan `REVOKE ALL`. | Pastikan baris `GRANT USAGE ON SCHEMA app_security TO authenticated, service_role;` pada Bagian A Migrasi 7 telah dieksekusi. |
| **4** | `PRIVILEGE_ESCALATION_BLOCKED` muncul saat mengubah data dari aplikasi. | Fungsi atau aksi pembaruan dipanggil menggunakan sesi pengguna non-Admin sambil menyertakan perubahan pada kolom terlarang (`system_role`, `assigned_sales_id`, `lead_id`, `related_kpr_application_id`, atau dokumen `kpr_documents` berstatus `VERIFIED`). | Pastikan *Server Action* / *Service* hanya mengirim kolom yang diizinkan sesuai peran pemanggil, dan mutasi status resmi KPR/Deal/Reassignment dilakukan oleh `ADMIN` atau RPC `SECURITY DEFINER` pada File 04. |
| **5** | `new row violates row-level security policy for table "follow_up_tasks"`. | Nilai `related_kpr_application_id` atau `related_schedule_id` tidak berasal dari `booking` milik `lead_id` yang sama, atau `assigned_sales_id` bukan anggota aktif tim Lead tersebut. | Pastikan tugas KPR/tagihan selalu ditautkan ke `kpr_application_id` / `payment_schedule_id` yang berasal dari `booking` milik `lead_id` yang bersangkutan. |

---

## 19. Acceptance Criteria (Kriteria Keberterimaan File 03)

Implementasi **Supabase Auth, Security & RLS** dinyatakan **SELESAI** apabila seluruh kriteria berikut terpenuhi:

- [ ] **AC-01:** File migrasi `supabase/migrations/20260301000700_auth_security_grants_and_rls.sql` berhasil dieksekusi setelah Migrasi 1–6 (File 02 `v1.4`) melalui `npm run db:reset` tanpa error.
- [ ] **AC-02:** Seluruh **12 fungsi** di schema privat `app_security` telah terbuat dengan atribut `SECURITY DEFINER`, `SET search_path = ''`, dan pembatasan `EXECUTE` hanya untuk `authenticated` & `service_role`.
- [ ] **AC-03:** View `public.v_staff_directory` dan `public.v_unit_catalog` telah terbentuk dengan `WITH (security_invoker = true)` untuk mendukung transparansi katalog unit (`OQ-05`) tanpa membocorkan kolom `email` dan `phone` pribadi staf lintas tim.
- [ ] **AC-04:** Keenam trigger pencegah *Privilege Escalation* (`trg_00_guard_profiles_update`, `trg_00_guard_leads_update`, `trg_00_guard_follow_up_tasks_update`, `trg_00_guard_site_visits_update`, `trg_00_guard_kpr_documents_update`, `trg_00_guard_notifications_update`) telah aktif.
- [ ] **AC-05:** Role `anon` memiliki `0` hak akses terhadap ke-32 tabel dan kedua View, dan role `authenticated` memiliki `0` hak akses `DELETE` pada ke-32 tabel.
- [ ] **AC-06:** Seluruh 32 tabel memiliki `rowsecurity = true` dan dilindungi oleh **80 kebijakan RLS** yang sesuai dengan matriks akses Bagian 12 (termasuk isolasi perpindahan tim dan validasi silang `follow_up_tasks.related_kpr_application_id` & `related_schedule_id`).
- [ ] **AC-07:** File autentikasi dan otorisasi TypeScript (`auth.schemas.ts`, `auth.actions.ts`, `auth.guards.ts`, `LoginForm.tsx`, dan `login/page.tsx`) telah terpasang dan lulus pemeriksaan `npm run check:all` (`tsc --noEmit` & `eslint .`) dengan 0 error.

---

## 20. Changelog (`v1.0` $\rightarrow$ `v1.1`)

| Bagian | Perubahan dari `v1.0` ke `v1.1` | Alasan |
| :--- | :--- | :--- |
| **Header, Bag. 2 & `[Helper 11]`** | Memperbarui referensi ke File 01 `v1.1` dan File 02 `v1.4` (34 ENUM, `kpr_application_status_enum`, `follow_up_tasks.related_kpr_application_id`), serta menghapus status `PENDING BUSINESS DECISION` pada `TC-01` dan menetapkan keputusan final **`TC-01A`**. | Menyelaraskan dokumen dengan spesifikasi skema database final (`v1.4`) dan kebijakan bisnis terbaru tanpa mengubah struktur tabel File 02. |
| **Bag. 13 Bagian A (`app_security`)** | Memperketat `get_current_user_active_team_id()` (cek `t.is_active = true`), `can_access_lead()`, `can_access_booking()`, dan `can_access_kpr_application()` (wajib `team_id = get_current_user_active_team_id()` untuk `SALES`), serta menambahkan 5 helper baru: `is_active_member_of_team()`, `is_valid_follow_up_kpr_link()`, `is_valid_follow_up_schedule_link()`, `is_valid_replacement_payment()`, dan `is_kpr_application_open()`. | Memastikan perpindahan Sales/Supervisor ke tim baru langsung mencabut akses data tim lama, mencegah penugasan lintas tim, dan memvalidasi relasi silang KPR/jadwal pada `follow_up_tasks` serta bukti koreksi `payment_records`. |
| **Bag. 13 Bagian B (`Views`)** | Menambahkan opsi **`WITH (security_invoker = true)`** pada `public.v_staff_directory` dan `public.v_unit_catalog`. | Menutup potensi bypass hak pemanggil pada PostgreSQL 15+ serta mematuhi standar keamanan Supabase untuk View. |
| **Bag. 13 Bagian C (`Guard Triggers`)** | Memperbaiki bug evaluasi `NULL <> 'ADMIN'` pada PL/pgSQL (`IF v_role IS NULL THEN RAISE EXCEPTION ...`) di semua trigger penjaga, memperketat `trg_guard_kpr_documents_update` (kunci dokumen `VERIFIED`, `uploaded_by`, dan metadata checklist), menambahkan cek anggota tim pada `trg_guard_leads_update`, serta menambahkan 2 trigger baru: `trg_00_guard_follow_up_tasks_update` dan `trg_00_guard_site_visits_update`. | Mencegah user nonaktif lolos dari pengecekan trigger `<> 'ADMIN'` dan menutup celah mutasi langsung kolom kepemilikan/relasi induk pada `follow_up_tasks`, `site_visits`, dan `kpr_documents`. |
| **Bag. 13 Bagian D & E (`Grants` & `RLS`)** | Mencabut izin eksekusi `trigger_set_updated_at()` dari `PUBLIC`/`anon`, menambahkan cek `get_current_user_role() IS NOT NULL` pada `pol_team_memberships_select`, menghilangkan celah `assigned_sales_id = auth.uid()` / `sales_id = auth.uid()` tanpa cek tim/keaktifan pada `follow_up_tasks` & `site_visits`, menambahkan validasi `related_kpr_application_id` & `related_schedule_id` pada `follow_up_tasks`, mengetatkan `pol_kpr_documents_insert`/`update`, `pol_lead_assignment_histories_insert`, `pol_lead_pipeline_histories_insert`, `pol_payment_records_insert_sales_or_admin`, dan isolasi tim `SALES` pada `leads`, `bookings`, `kpr_applications`, `deals`, serta `deal_status_histories`. | Menutup seluruh temuan celah otorisasi langsung via API Supabase tanpa mengubah struktur tabel di File 02 `v1.4`. |
| **Bag. 8, 9, 10 (`TypeScript Auth`)** | Memperketat sanitasi `sanitizeInternalRedirectPath()` terhadap `/\` & backslash pada `auth.schemas.ts` & `login/page.tsx`, menambahkan penanganan `reason=profile_missing` di `requirePageAuth()`, memvalidasi `actor.isActive` & `assertTeamScopeAccess()` untuk `SALES` di `assertResourceOwnership()`, serta mendokumentasikan koordinasi `proxy.ts` (File 01) & ban akun di Auth (File 06). | Mencegah *open redirect* varian backslash, *redirect loop* profil hilang, dan menyelaraskan Layer 3 dengan isolasi tim di RLS. |
| **Bag. 13.2, 16, 17, 19** | Menambahkan penjelasan integrasi keamanan Storage (File 05), memperbarui tabel vektor *Privilege Escalation* (9 vektor), memperluas uji keamanan menjadi **18 skenario** (`SEC-01` s/d `SEC-18`), dan mengoreksi hitungan total policy RLS dari `71` menjadi **`80`** sesuai jumlah aktual `CREATE POLICY` pada Migrasi 7. | Menjamin akurasi dokumentasi dan verifikasi sebelum implementasi ke kode aplikasi maupun Codex. |

---
