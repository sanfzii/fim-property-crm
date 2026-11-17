// Lokasi: src/proxy.ts
// Layer 1: Request Boundary Layer (Next.js 16+ Proxy Convention)

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicEnv } from '@/lib/env/client';

const PUBLIC_ROUTES = ['/login', '/auth/callback'];

function isHttpsProxyRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
  const origin = request.headers.get('origin') ?? '';
  const referer = request.headers.get('referer') ?? '';
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';

  return (
    request.nextUrl.protocol === 'https:' ||
    forwardedProto.toLowerCase().includes('https') ||
    origin.toLowerCase().startsWith('https://') ||
    referer.toLowerCase().startsWith('https://') ||
    host.toLowerCase().endsWith('.run.app')
  );
}

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
  const isHttps = isHttpsProxyRequest(request);

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
          cookiesToSet.forEach(({ name, value, options }) => {
            const finalOptions = isHttps
              ? {
                  ...options,
                  sameSite: 'none' as const,
                  secure: true,
                  partitioned: true,
                }
              : options;
            supabaseResponse.cookies.set(name, value, finalOptions);
          });
        },
      },
    }
  );

  // PENTING: Gunakan auth.getUser() (bukan getSession()) untuk memverifikasi token.
  // Fail-closed (user = null) saat terjadi gangguan jaringan dengan log singkat tanpa membocorkan token/cookie.
  let user = null;
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PROXY_AUTH_ERROR] Gagal memverifikasi sesi ke Supabase Auth:', errorMessage);
    user = null;
  }

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
  // Perbaikan redirect loop (File 03 v1.1 Bag. 9): Jangan redirect jika /login membawa reason=inactive atau reason=profile_missing
  const loginReason = request.nextUrl.searchParams.get('reason');
  const hasAuthFallbackReason =
    pathname === '/login' &&
    (loginReason === 'inactive' || loginReason === 'profile_missing');

  if (user && (pathname === '/login' || pathname === '/') && !hasAuthFallbackReason) {
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
