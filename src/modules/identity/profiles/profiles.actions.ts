// Lokasi: src/modules/identity/profiles/profiles.actions.ts
// Layer 3: Server Actions untuk Modul B (User Management)

'use server';

import { revalidatePath } from 'next/cache';
import { executeSafeServerAction } from '@/lib/errors/app-error';
import { requireActionAuth } from '@/modules/identity/auth/auth.guards';
import {
  createStaffUserSchema,
  updateOwnProfileSchema,
  updateStaffStatusOrRoleSchema,
} from './profiles.schemas';
import { ProfilesService } from './profiles.service';

export async function createStaffUserAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'profiles', action: 'createStaffUserAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = createStaffUserSchema.parse(rawInput);
      const profile = await ProfilesService.createStaffUser(actor, validated);
      revalidatePath('/admin/users');
      return {
        message: `Akun staf ${profile.full_name} (${profile.system_role}) berhasil dibuat.`,
        data: profile,
      };
    }
  );
}

export async function updateStaffStatusOrRoleAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'profiles', action: 'updateStaffStatusOrRoleAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = updateStaffStatusOrRoleSchema.parse(rawInput);
      const updated = await ProfilesService.updateStaffStatusOrRole(actor, validated);
      revalidatePath('/admin/users');
      return {
        message: `Profil staf ${updated.full_name} berhasil diperbarui.`,
        data: updated,
      };
    }
  );
}

export async function updateOwnProfileAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'profiles', action: 'updateOwnProfileAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = updateOwnProfileSchema.parse(rawInput);
      const updated = await ProfilesService.updateOwnProfile(actor, validated);
      revalidatePath('/profile');
      return {
        message: 'Profil pribadi Anda berhasil diperbarui.',
        data: updated,
      };
    }
  );
}
