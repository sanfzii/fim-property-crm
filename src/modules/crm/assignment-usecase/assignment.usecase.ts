// Lokasi: src/modules/crm/assignment-usecase/assignment.usecase.ts
// Level Topologis: L10 (Use-Case Orchestrator — Memanggil RPC Atomik TX-07)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import type { z } from 'zod';
import type { reassignLeadSchema } from '../crm.schemas';

export const LeadAssignmentUseCase = {
  async reassignLeadAtomically(input: z.infer<typeof reassignLeadSchema>) {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc('rpc_reassign_lead', {
      p_lead_id: input.leadId,
      p_target_sales_id: input.targetSalesId,
      p_reason: input.reason,
    });

    if (error) {
      throw translateDatabaseOrRpcError(error);
    }

    return data as {
      lead_id: string;
      from_sales_id: string;
      to_sales_id: string;
      from_team_id: string;
      to_team_id: string;
      reassigned_at: string;
    };
  },
};
