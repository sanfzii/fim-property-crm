// Lokasi: src/modules/crm/site-visits/site-visits.service.ts
// Level Topologis: L6 / L7 (Service Layer untuk Modul M — Site Visit Management)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AppError, translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { assertResourceOwnership } from '@/modules/identity/auth/auth.guards';
import { ProspectScoringUseCase } from '@/modules/crm/scoring-usecase/scoring.usecase';
import type { AuthenticatedUserContext } from '@/types/database.types';
import type { z } from 'zod';
import type { completeSiteVisitSchema, scheduleSiteVisitSchema } from '../crm.schemas';

export const SiteVisitsService = {
  async scheduleSiteVisit(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof scheduleSiteVisitSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, assigned_sales_id, team_id, pipeline_stage')
      .eq('id', input.leadId)
      .single();

    if (leadErr || !lead) {
      throw translateDatabaseOrRpcError(leadErr);
    }

    assertResourceOwnership(actor, lead.assigned_sales_id, lead.team_id);

    const { data: visit, error: visitErr } = await supabase
      .from('site_visits')
      .insert({
        lead_id: lead.id,
        sales_id: lead.assigned_sales_id,
        project_id: input.projectId,
        unit_id: input.unitId ?? null,
        scheduled_at: input.scheduledAt,
        preparation_notes: input.preparationNotes ?? null,
        status: 'SCHEDULED',
      })
      .select('*')
      .single();

    if (visitErr || !visit) {
      throw translateDatabaseOrRpcError(visitErr);
    }

    // Majukan Pipeline ke SITE_VISIT jika sebelumnya masih di NEW/CONTACTED/QUALIFIED
    if (['NEW', 'CONTACTED', 'QUALIFIED'].includes(lead.pipeline_stage)) {
      const { error: updErr } = await supabase
        .from('leads')
        .update({ pipeline_stage: 'SITE_VISIT' })
        .eq('id', lead.id);

      if (updErr) {
        throw translateDatabaseOrRpcError(updErr);
      }

      const { error: histErr } = await supabase.from('lead_pipeline_histories').insert({
        lead_id: lead.id,
        from_stage: lead.pipeline_stage,
        to_stage: 'SITE_VISIT',
        notes: 'Penjadwalan survei lokasi perumahan (Site Visit).',
        changed_by: actor.userId,
      });

      if (histErr) {
        throw translateDatabaseOrRpcError(histErr);
      }
    }

    // Hitung ulang skor indikator ke-4 (+20 poin saat Site Visit SCHEDULED)
    const scoring = await ProspectScoringUseCase.recalculateAndPersistForLead(
      lead.id,
      'SITE_VISIT_UPDATE'
    );

    return { visit, scoring };
  },

  async completeSiteVisit(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof completeSiteVisitSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data: existing, error: fetchErr } = await supabase
      .from('site_visits')
      .select('id, lead_id, sales_id, status, leads!inner(team_id)')
      .eq('id', input.siteVisitId)
      .single();

    if (fetchErr || !existing) {
      throw translateDatabaseOrRpcError(fetchErr);
    }

    const leadRel = Array.isArray(existing.leads) ? existing.leads[0] : existing.leads;
    assertResourceOwnership(actor, existing.sales_id, leadRel?.team_id ?? null);

    if (existing.status !== 'SCHEDULED' && existing.status !== 'RESCHEDULED') {
      throw new AppError({
        message: `Jadwal Site Visit berstatus [${existing.status}] dan tidak dapat diselesaikan ulang.`,
        category: 'CONFLICT_ERROR',
        code: 'SITE_VISIT_ALREADY_FINALIZED',
        statusCode: 409,
      });
    }

    const { data: visit, error: updateErr } = await supabase
      .from('site_visits')
      .update({
        status: 'COMPLETED',
        customer_interest_outcome: input.customerInterestOutcome,
        evaluation_notes: input.evaluationNotes,
        completed_at: new Date().toISOString(),
      })
      .eq('id', input.siteVisitId)
      .in('status', ['SCHEDULED', 'RESCHEDULED'])
      .select('*')
      .single();

    if (updateErr || !visit) {
      throw translateDatabaseOrRpcError(updateErr);
    }

    const scoring = await ProspectScoringUseCase.recalculateAndPersistForLead(
      visit.lead_id,
      'SITE_VISIT_UPDATE'
    );

    return { visit, scoring };
  },
};
