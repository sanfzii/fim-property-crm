// Lokasi: src/modules/identity/profiles/profiles.schemas.ts
// Level Topologis: L1 (Input Validation untuk Modul B — User Management)

import { z } from 'zod';

export const systemRoleSchema = z.enum(['ADMIN', 'SUPERVISOR', 'SALES']);

export const createStaffUserSchema = z.object({
  fullName: z
    .string({ error: 'Nama lengkap wajib diisi.' })
    .trim()
    .min(2, 'Nama lengkap minimal 2 karakter.')
    .max(120, 'Nama lengkap maksimal 120 karakter.'),
  email: z
    .string({ error: 'Email kerja wajib diisi.' })
    .trim()
    .toLowerCase()
    .email('Format email tidak valid.')
    .max(150),
  phone: z
    .string({ error: 'Nomor telepon wajib diisi.' })
    .trim()
    .regex(/^[0-9+()-\s]{8,30}$/, 'Nomor telepon harus terdiri dari 8-30 digit angka yang valid.'),
  initialPassword: z
    .string({ error: 'Password awal wajib diisi.' })
    .min(8, 'Password awal minimal 8 karakter.'),
  systemRole: systemRoleSchema,
});

export const updateStaffStatusOrRoleSchema = z.object({
  profileId: z.string().uuid('ID profil tidak valid.'),
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()-\s]{8,30}$/)
    .optional(),
  systemRole: systemRoleSchema.optional(),
  isActive: z.boolean().optional(),
  reason: z
    .string({ error: 'Alasan perubahan akun wajib diisi.' })
    .trim()
    .min(5, 'Alasan perubahan minimal 5 karakter.'),
});

export const updateOwnProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Nama minimal 2 karakter.').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()-\s]{8,30}$/, 'Format nomor telepon tidak valid.'),
});
