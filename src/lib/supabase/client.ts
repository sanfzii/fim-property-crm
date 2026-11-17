// Lokasi: src/lib/supabase/client.ts
// Level Topologis: L0 (Core Infrastructure — Browser Client)

import { createBrowserClient } from '@supabase/ssr';
import { getPublicEnv } from '@/lib/env/client';

export function createSupabaseBrowserClient() {
  const env = getPublicEnv();
  const isHttpsBrowser =
    typeof window !== 'undefined' && window.location.protocol === 'https:';

  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    isHttpsBrowser
      ? {
          cookieOptions: {
            sameSite: 'none',
            secure: true,
          },
        }
      : undefined
  );
}

