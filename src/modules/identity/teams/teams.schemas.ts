// Lokasi: src/modules/identity/teams/teams.schemas.ts
// Level Topologis: L2 (Input Validation untuk Modul C — Team Management)

import { z } from 'zod';

export const createOrUpdateTeamSchema = z.object({
  teamId: z.string().uuid().optional(),
  code: z
    .string({ error: 'Kode tim wajib diisi.' })
    .trim()
    .toUpperCase()
    .min(2, 'Kode tim minimal 2 karakter.')
    .max(20),
  name: z
    .string({ error: 'Nama tim wajib diisi.' })
    .trim()
    .min(2, 'Nama tim minimal 2 karakter.')
    .max(100),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

export const assignTeamMemberSchema = z.object({
  teamId: z.string().uuid('ID Tim tidak valid.'),
  profileId: z.string().uuid('ID Staf tidak valid.'),
  membershipRole: z.enum(['TEAM_SUPERVISOR', 'TEAM_SALES']),
  notes: z
    .string({ error: 'Catatan penugasan tim wajib diisi.' })
    .trim()
    .min(3, 'Catatan penugasan minimal 3 karakter.'),
});
