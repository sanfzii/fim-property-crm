// Lokasi: src/modules/crm/crm.actions.ts
// Layer 3: Server Actions untuk Seluruh Modul CRM & Pre-Sales (Modul H, I, J, K, L, M)

'use server';

import { revalidatePath } from 'next/cache';
import { executeSafeServerAction } from '@/lib/errors/app-error';
import { requireActionAuth } from '@/modules/identity/auth/auth.guards';
import {
  completeFollowUpTaskSchema,
  completeSiteVisitSchema,
  createFollowUpTaskSchema,
  createLeadSchema,
  logLeadActivitySchema,
  reassignLeadSchema,
  scheduleSiteVisitSchema,
  transitionLeadPipelineSchema,
  updateLeadQualificationSchema,
} from './crm.schemas';
import { LeadsService } from './leads/leads.service';
import { PipelineService } from './pipeline/pipeline.service';
import { ActivitiesAndFollowUpService } from './activities-followup/activities.service';
import { SiteVisitsService } from './site-visits/site-visits.service';
import { LeadAssignmentUseCase } from './assignment-usecase/assignment.usecase';

export async function createLeadAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'crm', action: 'createLeadAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = createLeadSchema.parse(rawInput);
      const data = await LeadsService.createLead(actor, validated);
      revalidatePath('/leads');
      revalidatePath('/dashboard');
      return {
        message: `Lead ${data.full_name} berhasil dibuat dengan skor awal ${data.prospect_score} (${data.lead_temperature}).`,
        data,
      };
    }
  );
}

export async function updateLeadQualificationAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'crm', action: 'updateLeadQualificationAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = updateLeadQualificationSchema.parse(rawInput);
      const data = await LeadsService.updateLeadQualification(actor, validated);
      revalidatePath(`/leads/${validated.leadId}`);
      revalidatePath('/leads');
      return {
        message: `Kualifikasi Lead diperbarui. Skor prospek saat ini: ${data.scoring.totalScore} (${data.scoring.temperature}).`,
        data,
      };
    }
  );
}

export async function transitionLeadPipelineAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'crm', action: 'transitionLeadPipelineAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = transitionLeadPipelineSchema.parse(rawInput);
      const data = await PipelineService.transitionPreTransactionStage(actor, validated);
      revalidatePath(`/leads/${validated.leadId}`);
      revalidatePath('/leads');
      return {
        message: `Tahap Pipeline Lead berhasil diubah menjadi ${data.pipeline_stage}.`,
        data,
      };
    }
  );
}

export async function logLeadActivityAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'crm', action: 'logLeadActivityAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = logLeadActivitySchema.parse(rawInput);
      const data = await ActivitiesAndFollowUpService.logInteractionActivity(
        actor,
        validated
      );
      revalidatePath(`/leads/${validated.leadId}`);
      return {
        message: 'Catatan komunikasi berhasil disimpan dan skor prospek telah diperbarui.',
        data,
      };
    }
  );
}

export async function createFollowUpTaskAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'crm', action: 'createFollowUpTaskAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = createFollowUpTaskSchema.parse(rawInput);
      const data = await ActivitiesAndFollowUpService.createFollowUpTask(
        actor,
        validated
      );
      revalidatePath(`/leads/${validated.leadId}`);
      if (validated.relatedKprApplicationId) {
        revalidatePath(`/kpr/${validated.relatedKprApplicationId}`);
      }
      revalidatePath('/dashboard');
      return { message: 'Jadwal tugas follow-up berhasil dibuat.', data };
    }
  );
}

export async function completeFollowUpTaskAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'crm', action: 'completeFollowUpTaskAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = completeFollowUpTaskSchema.parse(rawInput);
      const data = await ActivitiesAndFollowUpService.completeFollowUpTask(
        actor,
        validated
      );
      revalidatePath('/dashboard');
      revalidatePath(`/leads/${data.lead_id}`);
      if (data.related_kpr_application_id) {
        revalidatePath(`/kpr/${data.related_kpr_application_id}`);
      }
      return { message: 'Tugas follow-up ditandai selesai.', data };
    }
  );
}

export async function scheduleSiteVisitAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'crm', action: 'scheduleSiteVisitAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = scheduleSiteVisitSchema.parse(rawInput);
      const data = await SiteVisitsService.scheduleSiteVisit(actor, validated);
      revalidatePath(`/leads/${validated.leadId}`);
      revalidatePath('/site-visits');
      return { message: 'Jadwal survei lokasi (Site Visit) berhasil dibuat.', data };
    }
  );
}

export async function completeSiteVisitAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'crm', action: 'completeSiteVisitAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validated = completeSiteVisitSchema.parse(rawInput);
      const data = await SiteVisitsService.completeSiteVisit(actor, validated);
      revalidatePath('/site-visits');
      revalidatePath(`/leads/${data.visit.lead_id}`);
      return {
        message: `Hasil survei lokasi disimpan. Skor prospek: ${data.scoring.totalScore} (${data.scoring.temperature}).`,
        data,
      };
    }
  );
}

export async function reassignLeadAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'crm', action: 'reassignLeadAction' },
    async () => {
      await requireActionAuth(['ADMIN', 'SUPERVISOR']);
      const validated = reassignLeadSchema.parse(rawInput);
      const data = await LeadAssignmentUseCase.reassignLeadAtomically(validated);
      revalidatePath('/leads');
      revalidatePath(`/leads/${validated.leadId}`);
      revalidatePath('/bookings');
      return {
        message:
          'Kepemilikan Lead beserta tugas aktif dan transaksi berjalan berhasil dialihkan.',
        data,
      };
    }
  );
}
