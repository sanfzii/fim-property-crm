// Lokasi: src/modules/crm/scoring-usecase/scoring.usecase.ts
// Level Topologis: L7 (Application Use-Case — Mengambil Data L3..L6 & Memanggil Kalkulator L0)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { calculateProspectScore } from '@/modules/shared/scoring-calculator/prospect-scoring.calculator';
import type {
  InteractionResponse,
  PaymentReadiness,
  PurchaseTimeline,
  SiteVisitOutcome,
  SiteVisitStatus,
} from '@/types/database.types';

export const ProspectScoringUseCase = {
  /**
   * Menghitung ulang skor dan temperatur satu Lead serta mencatat ke lead_score_histories
   * apabila terjadi perubahan skor atau temperatur.
   */
  async recalculateAndPersistForLead(
    leadId: string,
    triggerSource:
      | 'PROFILE_UPDATE'
      | 'ACTIVITY_ADDED'
      | 'SITE_VISIT_UPDATE'
      | 'CATALOG_PRICE_CHANGE'
  ) {
    const supabase = await createSupabaseServerClient();

    // 1. Ambil profil kualifikasi Lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(
        'id, budget_amount, preferred_project_id, preferred_property_type_id, purchase_timeline, payment_readiness, prospect_score, lead_temperature'
      )
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      throw translateDatabaseOrRpcError(leadError);
    }

    // 2. Cari harga unit AVAILABLE termurah sesuai preferensi Proyek/Tipe Lead (atau seluruh katalog jika belum spesifik)
    let unitQuery = supabase
      .from('units')
      .select('catalog_price')
      .eq('status', 'AVAILABLE')
      .order('catalog_price', { ascending: true })
      .limit(1);

    if (lead.preferred_property_type_id) {
      unitQuery = unitQuery.eq('property_type_id', lead.preferred_property_type_id);
    } else if (lead.preferred_project_id) {
      unitQuery = unitQuery.eq('project_id', lead.preferred_project_id);
    }

    const { data: minUnitRows, error: unitErr } = await unitQuery;
    if (unitErr) {
      throw translateDatabaseOrRpcError(unitErr);
    }
    const referenceMinUnitPrice =
      minUnitRows && minUnitRows[0] ? Number(minUnitRows[0].catalog_price) : null;

    // 3. Ambil respons komunikasi terakhir dari lead_activities
    const { data: latestActivityRows, error: actErr } = await supabase
      .from('lead_activities')
      .select('customer_response')
      .eq('lead_id', leadId)
      .order('interaction_at', { ascending: false })
      .limit(1);

    if (actErr) {
      throw translateDatabaseOrRpcError(actErr);
    }

    const latestInteractionResponse =
      (latestActivityRows?.[0]?.customer_response as InteractionResponse | undefined) ??
      null;

    // 4. Ambil Site Visit terakhir yang COMPLETED atau SCHEDULED
    const { data: latestVisitRows, error: visitErr } = await supabase
      .from('site_visits')
      .select('status, customer_interest_outcome')
      .eq('lead_id', leadId)
      .in('status', ['COMPLETED', 'SCHEDULED'])
      .order('scheduled_at', { ascending: false })
      .limit(1);

    if (visitErr) {
      throw translateDatabaseOrRpcError(visitErr);
    }

    const latestSiteVisit = latestVisitRows?.[0]
      ? {
          status: latestVisitRows[0].status as SiteVisitStatus,
          outcome:
            (latestVisitRows[0].customer_interest_outcome as SiteVisitOutcome | null) ??
            null,
        }
      : null;

    // 5. Panggil Kalkulator Murni L0 (Tanpa akses DB di dalam kalkulator)
    const scoringResult = calculateProspectScore({
      budgetAmount: Number(lead.budget_amount),
      referenceMinUnitPrice,
      purchaseTimeline: lead.purchase_timeline as PurchaseTimeline,
      paymentReadiness: lead.payment_readiness as PaymentReadiness,
      latestInteractionResponse,
      latestSiteVisit,
    });

    // 6. Perbarui tabel leads
    const { error: updateError } = await supabase
      .from('leads')
      .update({
        prospect_score: scoringResult.totalScore,
        lead_temperature: scoringResult.temperature,
        score_breakdown: scoringResult.breakdown as unknown as Record<string, unknown>,
      })
      .eq('id', leadId);

    if (updateError) {
      throw translateDatabaseOrRpcError(updateError);
    }

    // 7. Jika skor atau temperatur berubah, catat ke lead_score_histories
    if (
      lead.prospect_score !== scoringResult.totalScore ||
      lead.lead_temperature !== scoringResult.temperature
    ) {
      const { error: histErr } = await supabase.from('lead_score_histories').insert({
        lead_id: leadId,
        old_score: lead.prospect_score,
        new_score: scoringResult.totalScore,
        old_temperature: lead.lead_temperature,
        new_temperature: scoringResult.temperature,
        score_breakdown: scoringResult.breakdown as unknown as Record<string, unknown>,
        trigger_source: triggerSource,
      });

      if (histErr) {
        throw translateDatabaseOrRpcError(histErr);
      }
    }

    return scoringResult;
  },
};
