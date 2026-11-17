// Lokasi: src/modules/identity/teams/teams.actions.ts
// Layer 3: Server Actions untuk Modul C (Team Management)

'use server';

import { revalidatePath } from 'next/cache';
import { executeSafeServerAction } from '@/lib/errors/app-error';
import { requireActionAuth } from '@/modules/identity/auth/auth.guards';
import { assignTeamMemberSchema, createOrUpdateTeamSchema } from './teams.schemas';
import { TeamsService } from './teams.service';

export async function createTeamAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'teams', action: 'createTeamAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = createOrUpdateTeamSchema.parse(rawInput);
      const team = await TeamsService.createTeam(actor, validated);
      revalidatePath('/admin/teams');
      return {
        message: `Tim penjualan ${team.name} berhasil dibuat.`,
        data: team,
      };
    }
  );
}

export async function assignTeamMemberAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'teams', action: 'assignTeamMemberAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = assignTeamMemberSchema.parse(rawInput);
      const membership = await TeamsService.assignMemberToTeam(actor, validated);
      revalidatePath('/admin/teams');
      return {
        message: 'Penugasan keanggotaan tim berhasil disimpan.',
        data: membership,
      };
    }
  );
}
