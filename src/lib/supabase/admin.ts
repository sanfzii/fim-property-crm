// Lokasi: src/lib/supabase/admin.ts
// Level Topologis: L0 (Core Infrastructure — Isolated Server-Only Admin Client)

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminEnv } from '@/lib/env/server';

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
  const env = getSupabaseAdminEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
