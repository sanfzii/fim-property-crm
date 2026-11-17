// Lokasi: src/lib/env/client.ts
// Level Topologis: L0 (Core Infrastructure — Public Environment Validator)

import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url(process.env.NEXT_PUBLIC_SUPABASE_URL)
    .default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
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
