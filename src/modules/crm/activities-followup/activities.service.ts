// Lokasi: src/modules/crm/activities-followup/activities.service.ts
// Level Topologis: L5 / L7 (Service Layer untuk Modul L — Lead Activities & Follow-up)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AppError, translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { assertResourceOwnership } from '@/modules/identity/auth/auth.guards';
import { ProspectScoringUseCase } from '@/modules/crm/scoring-usecase/scoring.usecase';
import type { AuthenticatedUserContext } from '@/types/database.types';
import type { z } from 'zod';
import type {
  completeFollowUpTaskSchema,
  createFollowUpTaskSchema,
  logLeadActivitySchema,
} from '../crm.schemas';

export const ActivitiesAndFollowUpService = {
  async logInteractionActivity(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof logLeadActivitySchema>
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

    const nowIso = new Date().toISOString();

    const { data: activity, error: actErr } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: lead.id,
        sales_id: actor.userId,
        channel: input.channel,
        interaction_at: nowIso,
        summary: input.summary,
        customer_response: input.customerResponse,
      })
      .select('*')
      .single();

    if (actErr || !activity) {
      throw translateDatabaseOrRpcError(actErr);
    }

    // Perbarui last_interaction_at (dan majukan NEW -> CONTACTED secara otomatis jika baru kontak pertama)
    const nextStage = lead.pipeline_stage === 'NEW' ? 'CONTACTED' : lead.pipeline_stage;
    const { error: leadUpdateErr } = await supabase
      .from('leads')
      .update({
        last_interaction_at: nowIso,
        pipeline_stage: nextStage,
      })
      .eq('id', lead.id);

    if (leadUpdateErr) {
      throw translateDatabaseOrRpcError(leadUpdateErr);
    }

    if (lead.pipeline_stage === 'NEW') {
      const { error: histErr } = await supabase.from('lead_pipeline_histories').insert({
        lead_id: lead.id,
        from_stage: 'NEW',
        to_stage: 'CONTACTED',
        notes: 'Kontak komunikasi pertama dicatat.',
        changed_by: actor.userId,
      });

      if (histErr) {
        throw translateDatabaseOrRpcError(histErr);
      }
    }

    // Hitung ulang skor interaksi Lead (Modul I)
    const scoring = await ProspectScoringUseCase.recalculateAndPersistForLead(
      lead.id,
      'ACTIVITY_ADDED'
    );

    return { activity, scoring };
  },

  /**
   * Membuat tugas tindak lanjut (termasuk tindak lanjut pengajuan KPR tertentu melalui
   * related_kpr_application_id atau penagihan termin via related_schedule_id — File 02 v1.4).
   */
  async createFollowUpTask(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof createFollowUpTaskSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, assigned_sales_id, team_id')
      .eq('id', input.leadId)
      .single();

    if (leadErr || !lead) {
      throw translateDatabaseOrRpcError(leadErr);
    }

    assertResourceOwnership(actor, lead.assigned_sales_id, lead.team_id);

    // Validasi relasi silang KPR (is_valid_follow_up_kpr_link File 03 v1.1) sebelum insert
    if (input.relatedKprApplicationId) {
      const { data: kprRow, error: kprErr } = await supabase
        .from('kpr_applications')
        .select('id, bookings!inner(lead_id)')
        .eq('id', input.relatedKprApplicationId)
        .single();

      const kprBooking = Array.isArray(kprRow?.bookings)
        ? kprRow?.bookings[0]
        : kprRow?.bookings;

      if (kprErr || !kprRow || kprBooking?.lead_id !== lead.id) {
        throw new AppError({
          message: 'Pengajuan KPR yang ditautkan tidak ditemukan atau bukan milik Lead terkait.',
          category: 'BUSINESS_RULE_ERROR',
          code: 'INVALID_FOLLOW_UP_KPR_LINK',
          statusCode: 422,
        });
      }
    }

    // Validasi relasi silang jadwal pembayaran (is_valid_follow_up_schedule_link File 03 v1.1)
    if (input.relatedScheduleId) {
      const { data: schedRow, error: schedErr } = await supabase
        .from('payment_schedules')
        .select('id, bookings!inner(lead_id)')
        .eq('id', input.relatedScheduleId)
        .single();

      const schedBooking = Array.isArray(schedRow?.bookings)
        ? schedRow?.bookings[0]
        : schedRow?.bookings;

      if (schedErr || !schedRow || schedBooking?.lead_id !== lead.id) {
        throw new AppError({
          message: 'Jadwal tagihan yang ditautkan tidak ditemukan atau bukan milik Lead terkait.',
          category: 'BUSINESS_RULE_ERROR',
          code: 'INVALID_FOLLOW_UP_SCHEDULE_LINK',
          statusCode: 422,
        });
      }
    }

    const assignedSalesId =
      actor.systemRole === 'SALES'
        ? actor.userId
        : (input.assignedSalesId ?? lead.assigned_sales_id);

    const sourceType =
      actor.systemRole === 'SUPERVISOR' || actor.systemRole === 'ADMIN'
        ? 'SUPERVISOR_INSTRUCTION'
        : 'MANUAL_SALES';

    const { data: task, error: taskErr } = await supabase
      .from('follow_up_tasks')
      .insert({
        lead_id: lead.id,
        assigned_sales_id: assignedSalesId,
        related_schedule_id: input.relatedScheduleId ?? null,
        related_kpr_application_id: input.relatedKprApplicationId ?? null,
        title: input.title,
        description: input.description ?? null,
        due_at: input.dueAt,
        priority: input.priority,
        source_type: sourceType,
        status: 'PENDING',
        created_by: actor.userId,
      })
      .select('*')
      .single();

    if (taskErr || !task) {
      throw translateDatabaseOrRpcError(taskErr);
    }

    return task;
  },

  async completeFollowUpTask(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof completeFollowUpTaskSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data: existing, error: fetchErr } = await supabase
      .from('follow_up_tasks')
      .select('id, lead_id, status, assigned_sales_id, leads!inner(team_id)')
      .eq('id', input.taskId)
      .single();

    if (fetchErr || !existing) {
      throw translateDatabaseOrRpcError(fetchErr);
    }

    const leadRel = Array.isArray(existing.leads) ? existing.leads[0] : existing.leads;
    assertResourceOwnership(actor, existing.assigned_sales_id, leadRel?.team_id ?? null);

    if (existing.status !== 'PENDING' && existing.status !== 'OVERDUE') {
      throw new AppError({
        message: `Tugas follow-up berstatus [${existing.status}] dan tidak dapat diselesaikan lagi.`,
        category: 'CONFLICT_ERROR',
        code: 'TASK_ALREADY_FINALIZED',
        statusCode: 409,
      });
    }

    const { data: updated, error } = await supabase
      .from('follow_up_tasks')
      .update({
        status: 'COMPLETED',
        completion_notes: input.completionNotes,
        completed_at: new Date().toISOString(),
      })
      .eq('id', input.taskId)
      .in('status', ['PENDING', 'OVERDUE'])
      .select('*')
      .single();

    if (error || !updated) {
      throw translateDatabaseOrRpcError(error);
    }

    return updated;
  },
};
