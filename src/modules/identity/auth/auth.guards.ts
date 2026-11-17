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
