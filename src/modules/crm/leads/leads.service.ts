// Lokasi: src/modules/crm/leads/leads.service.ts
// Level Topologis: L4 / L7 (Service Layer untuk Modul H — Lead Management)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AppError, translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { assertResourceOwnership } from '@/modules/identity/auth/auth.guards';
import { ProspectScoringUseCase } from '@/modules/crm/scoring-usecase/scoring.usecase';
import type { AuthenticatedUserContext } from '@/types/database.types';
import type { z } from 'zod';
import type { createLeadSchema, updateLeadQualificationSchema } from '../crm.schemas';

export const LeadsService = {
  /**
   * Membuat data Lead baru sesuai aturan OQ-01:
   * - Jika dibuat oleh SALES: assigned_sales_id = actor.userId & team_id = actor.activeTeamId.
   * - Jika dibuat oleh SUPERVISOR: wajib berada di dalam actor.activeTeamId.
   */
  async createLead(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof createLeadSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    let targetSalesId = actor.userId;
    let targetTeamId = actor.activeTeamId;

    if (actor.systemRole === 'SALES') {
      if (!actor.activeTeamId) {
        throw new AppError({
          message: 'Akun Sales Anda belum tergabung dalam tim penjualan aktif.',
          category: 'BUSINESS_RULE_ERROR',
          code: 'SALES_WITHOUT_ACTIVE_TEAM',
          statusCode: 422,
        });
      }
      targetSalesId = actor.userId;
      targetTeamId = actor.activeTeamId;
    } else if (actor.systemRole === 'SUPERVISOR') {
      if (!actor.activeTeamId) {
        throw new AppError({
          message: 'Akun Supervisor Anda belum memimpin tim aktif.',
          category: 'BUSINESS_RULE_ERROR',
          code: 'SUPERVISOR_WITHOUT_ACTIVE_TEAM',
          statusCode: 422,
        });
      }
      targetTeamId = actor.activeTeamId;
      targetSalesId = input.assignedSalesId ?? actor.userId;
    } else {
      // ADMIN wajib menyertakan assignedSalesId dan teamId yang valid
      if (!input.assignedSalesId || !input.teamId) {
        throw new AppError({
          message: 'Admin wajib memilih Tim dan Sales penanggung jawab saat membuat Lead.',
          category: 'VALIDATION_ERROR',
          code: 'ASSIGNEE_REQUIRED_FOR_ADMIN',
          statusCode: 400,
        });
      }
      targetSalesId = input.assignedSalesId;
      targetTeamId = input.teamId;
    }

    const { data: lead, error: insertError } = await supabase
      .from('leads')
      .insert({
        full_name: input.fullName,
        phone: input.phone,
        email: input.email ?? null,
        occupation: input.occupation ?? null,
        lead_source: input.leadSource,
        assigned_sales_id: targetSalesId,
        team_id: targetTeamId!,
        budget_amount: input.budgetAmount,
        preferred_city: input.preferredCity ?? null,
        preferred_project_id: input.preferredProjectId ?? null,
        preferred_property_type_id: input.preferredPropertyTypeId ?? null,
        preferred_payment_method: input.preferredPaymentMethod ?? null,
        purchase_timeline: input.purchaseTimeline,
        payment_readiness: input.paymentReadiness,
        pipeline_stage: 'NEW',
        created_by: actor.userId,
      })
      .select('*')
      .single();

    if (insertError || !lead) {
      throw translateDatabaseOrRpcError(insertError);
    }

    // Catat riwayat awal pipeline & assignment
    const { error: pipeHistErr } = await supabase.from('lead_pipeline_histories').insert({
      lead_id: lead.id,
      from_stage: null,
      to_stage: 'NEW',
      notes: 'Pembuatan data Lead awal.',
      changed_by: actor.userId,
    });

    if (pipeHistErr) {
      throw translateDatabaseOrRpcError(pipeHistErr);
    }

    const { error: assignHistErr } = await supabase.from('lead_assignment_histories').insert({
      lead_id: lead.id,
      from_sales_id: null,
      to_sales_id: targetSalesId,
      from_team_id: null,
      to_team_id: targetTeamId!,
      reason: 'Penugasan awal saat pembuatan Lead.',
      assigned_by: actor.userId,
    });

    if (assignHistErr) {
      throw translateDatabaseOrRpcError(assignHistErr);
    }

    // Hitung skor prospek awal secara otomatis (Modul I)
    const scoring = await ProspectScoringUseCase.recalculateAndPersistForLead(
      lead.id,
      'PROFILE_UPDATE'
    );

    return {
      ...lead,
      prospect_score: scoring.totalScore,
      lead_temperature: scoring.temperature,
      score_breakdown: scoring.breakdown,
    };
  },

  /**
   * Memperbarui atribut kualifikasi Lead (Tanpa mengizinkan perubahan assigned_sales_id/team_id)
   * dan langsung menghitung ulang Prospect Score.
   */
  async updateLeadQualification(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof updateLeadQualificationSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data: existing, error: fetchErr } = await supabase
      .from('leads')
      .select('id, assigned_sales_id, team_id')
      .eq('id', input.leadId)
      .single();

    if (fetchErr || !existing) {
      throw translateDatabaseOrRpcError(fetchErr);
    }

    assertResourceOwnership(actor, existing.assigned_sales_id, existing.team_id);

    const { error: updateErr } = await supabase
      .from('leads')
      .update({
        full_name: input.fullName,
        email: input.email ?? null,
        occupation: input.occupation ?? null,
        budget_amount: input.budgetAmount,
        preferred_city: input.preferredCity ?? null,
        preferred_project_id: input.preferredProjectId ?? null,
        preferred_property_type_id: input.preferredPropertyTypeId ?? null,
        preferred_payment_method: input.preferredPaymentMethod ?? null,
        purchase_timeline: input.purchaseTimeline,
        payment_readiness: input.paymentReadiness,
      })
      .eq('id', input.leadId);

    if (updateErr) {
      throw translateDatabaseOrRpcError(updateErr);
    }

    const scoring = await ProspectScoringUseCase.recalculateAndPersistForLead(
      input.leadId,
      'PROFILE_UPDATE'
    );

    return { leadId: input.leadId, scoring };
  },
};
