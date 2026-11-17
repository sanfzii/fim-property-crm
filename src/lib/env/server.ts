// Lokasi: src/lib/env/server.ts
// Level Topologis: L0 (Core Infrastructure — Server-Only Environment Validator)

import 'server-only';
import { z } from 'zod';
import { getPublicEnv } from './client';

const serverOnlyEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, 'SUPABASE_SERVICE_ROLE_KEY wajib diisi di environment server.'),
  CRON_SECRET: z
    .string()
    .min(32, 'fim2026_kunci_rahasia_cron_panjang_aman_463799'),
  /**
   * Keputusan Bisnis Final (TC-01A — PRD v1.1 & File 02 v1.4–06 v1.1):
   * Unit pada transaksi KPR dengan pencairan bertahap berubah menjadi SOLD
   * hanya saat pencairan mencapai 100% (FULLY_DISBURSED).
   */
  KPR_SOLD_POLICY_MODE: z.literal('TC-01A').default('TC-01A'),
});

const supabaseAdminEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, 'SUPABASE_SERVICE_ROLE_KEY wajib diisi di environment server.'),
});

export type ServerEnv = ReturnType<typeof getPublicEnv> & z.infer<typeof serverOnlyEnvSchema>;
export type SupabaseAdminEnv = ReturnType<typeof getPublicEnv> &
  z.infer<typeof supabaseAdminEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;
let cachedSupabaseAdminEnv: SupabaseAdminEnv | null = null;

export function getSupabaseAdminEnv(): SupabaseAdminEnv {
  if (cachedSupabaseAdminEnv) {
    return cachedSupabaseAdminEnv;
  }

  const publicEnv = getPublicEnv();
  const parsed = supabaseAdminEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    const formattedErrors = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `[SUPABASE_ADMIN_ENV_CONFIGURATION_ERROR] Konfigurasi Supabase Admin tidak valid: ${formattedErrors}`
    );
  }

  cachedSupabaseAdminEnv = {
    ...publicEnv,
    ...parsed.data,
  };

  return cachedSupabaseAdminEnv;
}

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
