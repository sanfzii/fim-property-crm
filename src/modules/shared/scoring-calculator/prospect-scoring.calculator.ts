// Lokasi: src/modules/shared/scoring-calculator/prospect-scoring.calculator.ts
// Level Topologis: L0 (Layer 4 — Pure Stateless Prospect Scoring Calculator, 0 DB Imports)

import type {
  InteractionResponse,
  LeadTemperature,
  PaymentReadiness,
  PurchaseTimeline,
  SiteVisitOutcome,
  SiteVisitStatus,
} from '@/types/database.types';

export interface ProspectScoringInput {
  budgetAmount: number;
  referenceMinUnitPrice: number | null;
  purchaseTimeline: PurchaseTimeline;
  paymentReadiness: PaymentReadiness;
  latestInteractionResponse: InteractionResponse | null;
  latestSiteVisit: {
    status: SiteVisitStatus;
    outcome: SiteVisitOutcome | null;
  } | null;
}

export interface ScoreBreakdown {
  budgetCompatibility: {
    score: number;
    maxScore: 30;
    ratioPercentage: number | null;
    reason: string;
  };
  purchaseTimeline: {
    score: number;
    maxScore: 25;
    timeline: PurchaseTimeline;
    reason: string;
  };
  paymentReadiness: {
    score: number;
    maxScore: 20;
    readiness: PaymentReadiness;
    reason: string;
  };
  interactionAndSiteVisit: {
    score: number;
    maxScore: 25;
    reason: string;
  };
}

export interface ProspectScoringOutput {
  totalScore: number;
  temperature: LeadTemperature;
  breakdown: ScoreBreakdown;
}

/**
 * Menghitung skor prospek (0-100) dan menetapkan Lead Temperature (COLD, WARM, HOT)
 * berdasarkan 4 indikator deterministik OQ-04 (Tanpa Machine Learning).
 */
export function calculateProspectScore(
  input: ProspectScoringInput
): ProspectScoringOutput {
  // 1. Indikator 1: Budget Compatibility (Maksimal 30 Poin)
  let budgetScore = 0;
  let budgetRatio: number | null = null;
  let budgetReason = 'Budget belum diisi atau di bawah 70% dari harga unit acuan.';

  if (
    input.budgetAmount > 0 &&
    input.referenceMinUnitPrice !== null &&
    input.referenceMinUnitPrice > 0
  ) {
    budgetRatio = Number(
      ((input.budgetAmount / input.referenceMinUnitPrice) * 100).toFixed(2)
    );

    if (budgetRatio >= 100) {
      budgetScore = 30;
      budgetReason = `Budget mencukupi >= 100% dari harga unit acuan (${budgetRatio}%).`;
    } else if (budgetRatio >= 85) {
      budgetScore = 20;
      budgetReason = `Budget berada pada rentang negosiasi 85% - 99.9% dari harga acuan (${budgetRatio}%).`;
    } else if (budgetRatio >= 70) {
      budgetScore = 10;
      budgetReason = `Budget berada pada rentang 70% - 84.9% dari harga acuan (${budgetRatio}%).`;
    }
  }

  // 2. Indikator 2: Purchase Timeline (Maksimal 25 Poin)
  let timelineScore = 0;
  let timelineReason = 'Target waktu pembelian belum ditentukan.';

  switch (input.purchaseTimeline) {
    case 'IMMEDIATE_LT_1M':
      timelineScore = 25;
      timelineReason = 'Rencana pembelian segera (< 1 bulan).';
      break;
    case 'SHORT_1_3M':
      timelineScore = 18;
      timelineReason = 'Rencana pembelian jangka pendek (1 - 3 bulan).';
      break;
    case 'MEDIUM_3_6M':
      timelineScore = 10;
      timelineReason = 'Rencana pembelian jangka menengah (3 - 6 bulan).';
      break;
    case 'LONG_GT_6M':
      timelineScore = 5;
      timelineReason = 'Rencana pembelian jangka panjang (> 6 bulan / baru survei).';
      break;
    case 'UNSPECIFIED':
    default:
      timelineScore = 0;
      break;
  }

  // 3. Indikator 3: Payment Readiness (Maksimal 20 Poin)
  let readinessScore = 0;
  let readinessReason = 'Kesiapan metode pembayaran belum jelas.';

  switch (input.paymentReadiness) {
    case 'READY_FULL_OR_DP_DOCS':
      readinessScore = 20;
      readinessReason = 'Dana Cash Keras siap, atau DP & dokumen KPR telah siap.';
      break;
    case 'DP_READY_COLLECTING_DOCS':
      readinessScore = 15;
      readinessReason = 'Dana DP siap, dokumen KPR sedang dikumpulkan.';
      break;
    case 'SAVING_FOR_DP':
      readinessScore = 8;
      readinessReason = 'Masih mempersiapkan dana DP / simulasi cicilan.';
      break;
    case 'UNDECIDED':
    default:
      readinessScore = 0;
      break;
  }

  // 4. Indikator 4: Interaction & Site Visit (Maksimal 25 Poin — Diambil capaian tertinggi)
  let interactionScore = 0;
  let interactionReason = 'Belum ada interaksi komunikasi dua arah atau kunjungan lokasi.';

  if (
    input.latestSiteVisit?.status === 'COMPLETED' &&
    input.latestSiteVisit.outcome === 'POSITIVE_INTEREST'
  ) {
    interactionScore = 25;
    interactionReason = 'Telah menyelesaikan Site Visit dengan ketertarikan positif.';
  } else if (
    input.latestSiteVisit?.status === 'SCHEDULED' ||
    (input.latestSiteVisit?.status === 'COMPLETED' &&
      input.latestSiteVisit.outcome === 'NEUTRAL_CONSIDERATION')
  ) {
    interactionScore = 20;
    interactionReason =
      'Telah menjadwalkan Site Visit atau selesai Site Visit dengan pertimbangan netral.';
  } else if (
    input.latestInteractionResponse === 'RESPONSIVE_TWO_WAY' ||
    (input.latestSiteVisit?.status === 'COMPLETED' &&
      input.latestSiteVisit.outcome === 'NOT_SUITABLE')
  ) {
    interactionScore = 12;
    interactionReason = 'Komunikasi aktif dua arah (Responsif).';
  } else if (input.latestInteractionResponse === 'INITIAL_ONE_WAY') {
    interactionScore = 5;
    interactionReason = 'Baru komunikasi awal satu arah.';
  }

  const totalScore = Math.min(
    100,
    Math.max(0, budgetScore + timelineScore + readinessScore + interactionScore)
  );

  let temperature: LeadTemperature = 'COLD';
  if (totalScore >= 75) {
    temperature = 'HOT';
  } else if (totalScore >= 45) {
    temperature = 'WARM';
  }

  return {
    totalScore,
    temperature,
    breakdown: {
      budgetCompatibility: {
        score: budgetScore,
        maxScore: 30,
        ratioPercentage: budgetRatio,
        reason: budgetReason,
      },
      purchaseTimeline: {
        score: timelineScore,
        maxScore: 25,
        timeline: input.purchaseTimeline,
        reason: timelineReason,
      },
      paymentReadiness: {
        score: readinessScore,
        maxScore: 20,
        readiness: input.paymentReadiness,
        reason: readinessReason,
      },
      interactionAndSiteVisit: {
        score: interactionScore,
        maxScore: 25,
        reason: interactionReason,
      },
    },
  };
}
