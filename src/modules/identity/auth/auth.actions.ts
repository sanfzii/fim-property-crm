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
