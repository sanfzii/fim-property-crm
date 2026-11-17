// Lokasi: src/lib/supabase/server.ts
// Level Topologis: L0 (Core Infrastructure — Server SSR Client & Layer 3 Auth Guard)

import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { getPublicEnv } from '@/lib/env/client';
import type { AuthenticatedUserContext, SystemRole, TeamMemberRole } from '@/types/database.types';

/**
 * Mendeteksi apakah request berjalan di atas protokol HTTPS atau domain Cloud Run preview iframe
 * sehingga cookie wajib menggunakan SameSite=None; Secure; Partitioned agar diterima oleh browser di dalam cross-site iframe.
 */
function isHttpsRequestHeaders(headerStore: Awaited<ReturnType<typeof headers>>): boolean {
  const forwardedProto = headerStore.get('x-forwarded-proto') ?? '';
  const origin = headerStore.get('origin') ?? '';
  const referer = headerStore.get('referer') ?? '';
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host') ?? '';

  return (
    forwardedProto.toLowerCase().includes('https') ||
    origin.toLowerCase().startsWith('https://') ||
    referer.toLowerCase().startsWith('https://') ||
    host.toLowerCase().endsWith('.run.app')
  );
}

/**
 * Membuat instance Supabase Client untuk Server Components, Server Actions, dan Route Handlers.
 * Tetap menggunakan Publishable/Anon Key + JWT Cookie pengguna sehingga seluruh query
 * secara otomatis dievaluasi oleh kebijakan Row Level Security (RLS) PostgreSQL.
 */
export async function createSupabaseServerClient() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const env = getPublicEnv();
  const isHttps = isHttpsRequestHeaders(headerStore);

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
              const finalOptions = isHttps
                ? {
                    ...options,
                    sameSite: 'none' as const,
                    secure: true,
                    partitioned: true,
                  }
                : options;
              cookieStore.set(name, value, finalOptions);
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
/**
 * React cache di sini hanya memoize selama satu render request.
 * Ini mencegah layout + page melakukan getUser/profile/membership dua kali,
 * tanpa menyimpan konteks pengguna ke Data Cache lintas request.
 */
const getBaseAuthContext = cache(async (): Promise<AuthenticatedUserContext> => {
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
    .select('team_id, membership_role, teams(code, name, is_active)')
    .eq('profile_id', profile.id)
    .eq('is_active', true)
    .maybeSingle();

  const teamData = (
    Array.isArray(membership?.teams)
      ? membership.teams[0]
      : membership?.teams
  ) as { code?: string; name?: string; is_active?: boolean } | null | undefined;

  const isTeamActive = teamData?.is_active === true;

  const context: AuthenticatedUserContext = {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    systemRole: profile.system_role as SystemRole,
    isActive: profile.is_active,
    activeTeamId: isTeamActive ? (membership?.team_id ?? null) : null,
    activeTeamCode: isTeamActive ? (teamData?.code ?? null) : null,
    activeTeamName: isTeamActive ? (teamData?.name ?? null) : null,
    membershipRole: isTeamActive
      ? ((membership?.membership_role as TeamMemberRole | undefined) ?? null)
      : null,
  };

  return context;
});

export async function requireAuthContext(
  allowedRoles?: SystemRole[]
): Promise<AuthenticatedUserContext> {
  const context = await getBaseAuthContext();

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(context.systemRole)) {
    throw new Error(
      `FORBIDDEN: Operasi ini membutuhkan role [${allowedRoles.join(', ')}], sedangkan role Anda adalah [${context.systemRole}].`
    );
  }

  return context;
}
