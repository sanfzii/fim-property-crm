// Lokasi: src/modules/crm/pipeline/pipeline.service.ts
// Level Topologis: L5 (Service Layer untuk Modul K — Sales Pipeline)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AppError, translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { assertResourceOwnership } from '@/modules/identity/auth/auth.guards';
import type { AuthenticatedUserContext } from '@/types/database.types';
import type { z } from 'zod';
import type { transitionLeadPipelineSchema } from '../crm.schemas';

const TRANSACTION_CONTROLLED_STAGES = new Set([
  'BOOKING',
  'PAYMENT_KPR_PROCESS',
  'CLOSED_WON',
]);

export const PipelineService = {
  /**
   * Memindahkan tahap pipeline pra-transaksi (NEW s/d NEGOTIATION atau CLOSED_LOST).
   * Catatan: Tahap BOOKING, PAYMENT_KPR_PROCESS, dan CLOSED_WON dikendalikan otomatis oleh RPC TX-01, TX-02, TX-05, TX-06, TX-08!
   */
  async transitionPreTransactionStage(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof transitionLeadPipelineSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    const { data: lead, error: fetchErr } = await supabase
      .from('leads')
      .select(
        'id, assigned_sales_id, team_id, pipeline_stage, budget_amount, purchase_timeline'
      )
      .eq('id', input.leadId)
      .single();

    if (fetchErr || !lead) {
      throw translateDatabaseOrRpcError(fetchErr);
    }

    assertResourceOwnership(actor, lead.assigned_sales_id, lead.team_id);

    if (lead.pipeline_stage === input.targetStage) {
      return lead;
    }

    if (TRANSACTION_CONTROLLED_STAGES.has(lead.pipeline_stage)) {
      throw new AppError({
        message: `Lead sedang berada pada tahap transaksi terkunci (${lead.pipeline_stage}) dan tidak dapat diubah manual lewat pipeline pra-transaksi.`,
        category: 'BUSINESS_RULE_ERROR',
        code: 'TRANSACTION_PIPELINE_STAGE_LOCKED',
        statusCode: 422,
      });
    }

    // Stage Gate Modul K: Untuk naik ke QUALIFIED, budget & timeline wajib sudah diisi
    if (
      input.targetStage === 'QUALIFIED' &&
      (Number(lead.budget_amount) <= 0 || lead.purchase_timeline === 'UNSPECIFIED')
    ) {
      throw new AppError({
        message:
          'Untuk memindahkan Lead ke tahap QUALIFIED, estimasi Budget dan Timeline Pembelian wajib dilengkapi terlebih dahulu.',
        category: 'BUSINESS_RULE_ERROR',
        code: 'QUALIFICATION_INCOMPLETE',
        statusCode: 422,
      });
    }

    const { data: updated, error: updateErr } = await supabase
      .from('leads')
      .update({
        pipeline_stage: input.targetStage,
        lost_reason: input.targetStage === 'CLOSED_LOST' ? input.lostReason : null,
      })
      .eq('id', input.leadId)
      .select('*')
      .single();

    if (updateErr || !updated) {
      throw translateDatabaseOrRpcError(updateErr);
    }

    const { error: histErr } = await supabase.from('lead_pipeline_histories').insert({
      lead_id: lead.id,
      from_stage: lead.pipeline_stage,
      to_stage: input.targetStage,
      notes: input.notes ?? null,
      lost_reason: input.targetStage === 'CLOSED_LOST' ? input.lostReason : null,
      changed_by: actor.userId,
    });

    if (histErr) {
      throw translateDatabaseOrRpcError(histErr);
    }

    return updated;
  },
};
