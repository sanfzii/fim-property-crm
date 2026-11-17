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
    .string({ error: 'Email wajib diisi.' })
    .trim()
    .toLowerCase()
    .email('Format alamat email tidak valid.'),
  password: z
    .string({ error: 'Password wajib diisi.' })
    .min(6, 'Password minimal terdiri dari 6 karakter.'),
  redirectTo: z
    .string()
    .optional()
    .default('/dashboard')
    .transform((val) => sanitizeInternalRedirectPath(val)),
});

export type LoginFormInput = z.infer<typeof loginFormSchema>;
