// Lokasi: src/lib/utils/kpr-deals-ui.ts
// Utilitas Deterministik Murni untuk UI KPR 10 Tahap (TC-01A), Deals 3 Dimensi & Laporan Eksekutif

import type {
  BookingStatus,
  DealContractStatus,
  DealSalesOutcome,
  DealSettlementStatus,
  DisbursementTranche,
  KprApplicationStatus,
  KprDisbursementStatus,
  KprDocStatus,
  KprStage,
  LeadSource,
  PaymentMethod,
} from '@/types/database.types';
import { MAX_UPLOAD_BYTES } from './transactions-ui';

export interface KprStageMeta {
  stage: KprStage;
  stepNumber: number;
  label: string;
  shortLabel: string;
}

/**
 * Tepat 10 tahap proses KPR murni sesuai kpr_stage_enum (tanpa tahap REJECTED).
 */
export const KPR_TEN_STAGES: readonly KprStageMeta[] = [
  {
    stage: 'DOCUMENT_COLLECTION',
    stepNumber: 1,
    label: 'Pengumpulan Berkas',
    shortLabel: 'Berkas',
  },
  {
    stage: 'DOCUMENT_VERIFICATION',
    stepNumber: 2,
    label: 'Verifikasi Berkas',
    shortLabel: 'Verifikasi',
  },
  {
    stage: 'SUBMITTED',
    stepNumber: 3,
    label: 'Diajukan ke Bank',
    shortLabel: 'Diajukan',
  },
  {
    stage: 'BANK_VERIFICATION',
    stepNumber: 4,
    label: 'Verifikasi Bank',
    shortLabel: 'Bank',
  },
  {
    stage: 'APPRAISAL',
    stepNumber: 5,
    label: 'Appraisal Agunan',
    shortLabel: 'Appraisal',
  },
  {
    stage: 'ADDITIONAL_REQUIREMENTS',
    stepNumber: 6,
    label: 'Berkas Tambahan',
    shortLabel: 'Tambahan',
  },
  {
    stage: 'APPROVED',
    stepNumber: 7,
    label: 'SP3K Disetujui',
    shortLabel: 'SP3K',
  },
  {
    stage: 'AKAD_SCHEDULED',
    stepNumber: 8,
    label: 'Jadwal Akad',
    shortLabel: 'Jadwal Akad',
  },
  {
    stage: 'AKAD_COMPLETED',
    stepNumber: 9,
    label: 'Akad Selesai',
    shortLabel: 'Akad Selesai',
  },
  {
    stage: 'DISBURSEMENT',
    stepNumber: 10,
    label: 'Pencairan Bank',
    shortLabel: 'Pencairan',
  },
] as const;

export function getKprStageMeta(stage: KprStage): KprStageMeta {
  return (
    KPR_TEN_STAGES.find((s) => s.stage === stage) ?? {
      stage,
      stepNumber: 1,
      label: stage.replace(/_/g, ' '),
      shortLabel: stage.replace(/_/g, ' '),
    }
  );
}

export function getKprStageIndex(stage: KprStage): number {
  const idx = KPR_TEN_STAGES.findIndex((s) => s.stage === stage);
  return idx >= 0 ? idx : 0;
}

export function isKprApplicationHalted(status: KprApplicationStatus): boolean {
  return (
    status === 'REJECTED_BY_BANK' ||
    status === 'CANCELLED_BY_CUSTOMER' ||
    status === 'BOOKING_CANCELLED'
  );
}

export interface KprMandatoryDocReadiness {
  totalMandatory: number;
  verifiedMandatory: number;
  unverifiedMandatory: number;
  isReadyForBankSubmission: boolean;
}

export function computeKprMandatoryDocReadiness(
  docs: ReadonlyArray<{ isMandatory: boolean; status: KprDocStatus }>
): KprMandatoryDocReadiness {
  const mandatoryDocs = docs.filter((d) => d.isMandatory);
  const totalMandatory = mandatoryDocs.length;
  const verifiedMandatory = mandatoryDocs.filter((d) => d.status === 'VERIFIED').length;
  const unverifiedMandatory = totalMandatory - verifiedMandatory;

  return {
    totalMandatory,
    verifiedMandatory,
    unverifiedMandatory,
    isReadyForBankSubmission: totalMandatory > 0 && unverifiedMandatory === 0,
  };
}

export type KprAdvanceTargetStage =
  | 'DOCUMENT_COLLECTION'
  | 'DOCUMENT_VERIFICATION'
  | 'SUBMITTED'
  | 'BANK_VERIFICATION'
  | 'APPRAISAL'
  | 'ADDITIONAL_REQUIREMENTS'
  | 'AKAD_SCHEDULED';

/**
 * Menyelaraskan daftar target transisi dengan graf state-machine pada RPC TX-09 (rpc_advance_kpr_stage).
 */
export function getAllowedNextKprAdvanceTargets(params: {
  bookingStatus: BookingStatus;
  applicationStatus: KprApplicationStatus;
  currentStage: KprStage;
}): KprAdvanceTargetStage[] {
  if (params.bookingStatus !== 'ACTIVE') {
    return [];
  }

  if (
    params.applicationStatus === 'APPROVED' &&
    params.currentStage === 'APPROVED'
  ) {
    return ['AKAD_SCHEDULED'];
  }

  if (params.applicationStatus !== 'IN_PROGRESS') {
    return [];
  }

  switch (params.currentStage) {
    case 'DOCUMENT_COLLECTION':
      return ['DOCUMENT_VERIFICATION'];
    case 'DOCUMENT_VERIFICATION':
      return ['SUBMITTED', 'DOCUMENT_COLLECTION'];
    case 'SUBMITTED':
      return ['BANK_VERIFICATION'];
    case 'BANK_VERIFICATION':
      return ['APPRAISAL', 'ADDITIONAL_REQUIREMENTS'];
    case 'APPRAISAL':
      return ['ADDITIONAL_REQUIREMENTS'];
    case 'ADDITIONAL_REQUIREMENTS':
      return ['BANK_VERIFICATION', 'APPRAISAL'];
    default:
      return [];
  }
}

export function canRecordKprApprovalDecision(params: {
  bookingStatus: BookingStatus;
  applicationStatus: KprApplicationStatus;
  currentStage: KprStage;
}): boolean {
  if (params.bookingStatus !== 'ACTIVE') return false;
  if (params.applicationStatus !== 'IN_PROGRESS') return false;
  return (
    params.currentStage === 'SUBMITTED' ||
    params.currentStage === 'BANK_VERIFICATION' ||
    params.currentStage === 'APPRAISAL' ||
    params.currentStage === 'ADDITIONAL_REQUIREMENTS'
  );
}

export function canCancelKprByCustomer(params: {
  bookingStatus: BookingStatus;
  applicationStatus: KprApplicationStatus;
  currentStage: KprStage;
  disbursementStatus: KprDisbursementStatus;
}): boolean {
  if (params.bookingStatus !== 'ACTIVE') return false;
  if (
    params.applicationStatus !== 'IN_PROGRESS' &&
    params.applicationStatus !== 'APPROVED'
  ) {
    return false;
  }
  if (params.disbursementStatus !== 'NOT_DISBURSED') return false;
  return (
    params.currentStage !== 'AKAD_COMPLETED' &&
    params.currentStage !== 'DISBURSEMENT'
  );
}

export function getEligibleKprDisbursementTranche(params: {
  bookingStatus: BookingStatus;
  applicationStatus: KprApplicationStatus;
  currentStage: KprStage;
  remainingUndisbursedAmount: number;
}): DisbursementTranche | null {
  if (params.bookingStatus !== 'ACTIVE') return null;
  if (params.applicationStatus !== 'APPROVED') return null;
  if (params.remainingUndisbursedAmount <= 0) return null;

  if (params.currentStage === 'AKAD_COMPLETED') {
    return 'PRIMARY';
  }
  if (params.currentStage === 'DISBURSEMENT') {
    return 'SUBSEQUENT';
  }
  return null;
}

export type DealTransitionActionType =
  | 'ACTIVATE_PPJB_CONTRACT'
  | 'RECORD_KPR_AKAD_COMPLETED'
  | 'FINALIZE_FULL_SETTLEMENT';

export interface DealTransitionEligibilityInput {
  bookingStatus: BookingStatus;
  paymentMethod: PaymentMethod;
  salesOutcomeStatus: DealSalesOutcome;
  contractStatus: DealContractStatus;
  paymentSettlementStatus: DealSettlementStatus;
  unitStatus: string;
  kprApplicationStatus: KprApplicationStatus | null;
  kprCurrentStage: KprStage | null;
  kprDisbursementStatus: KprDisbursementStatus | null;
}

export function getAllowedDealTransitions(
  input: DealTransitionEligibilityInput
): DealTransitionActionType[] {
  if (
    input.bookingStatus !== 'ACTIVE' ||
    input.contractStatus === 'CONTRACT_TERMINATED' ||
    input.salesOutcomeStatus === 'CANCELLED_FAILED'
  ) {
    return [];
  }

  const actions: DealTransitionActionType[] = [];

  if (
    input.paymentMethod === 'CASH_BERTAHAP' &&
    input.contractStatus === 'PRE_CONTRACT'
  ) {
    actions.push('ACTIVATE_PPJB_CONTRACT');
  }

  if (
    input.paymentMethod === 'KPR' &&
    input.contractStatus === 'PRE_CONTRACT' &&
    input.kprApplicationStatus === 'APPROVED' &&
    input.kprCurrentStage === 'AKAD_SCHEDULED'
  ) {
    actions.push('RECORD_KPR_AKAD_COMPLETED');
  }

  const canFinalizeSettlement =
    input.paymentSettlementStatus !== 'FULLY_SETTLED' &&
    input.unitStatus !== 'SOLD' &&
    (input.paymentMethod !== 'KPR' ||
      (input.kprApplicationStatus === 'COMPLETED' &&
        input.kprDisbursementStatus === 'FULLY_DISBURSED'));

  if (canFinalizeSettlement) {
    actions.push('FINALIZE_FULL_SETTLEMENT');
  }

  return actions;
}

export function validatePdfFileClient(
  file: File | null | undefined,
  options?: { required?: boolean }
): string | null {
  if (!file) {
    return options?.required ? 'File PDF kontrak wajib dipilih.' : null;
  }
  if (file.size <= 0) {
    return 'File PDF yang dipilih kosong (0 byte).';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    return `Ukuran file (${mb} MB) melebihi batas maksimal 5 MB.`;
  }
  const cleanName = file.name.trim().toLowerCase();
  if (!cleanName.endsWith('.pdf')) {
    return 'Dokumen kontrak Deal wajib berformat PDF (.pdf).';
  }
  if (file.type && file.type.toLowerCase() !== 'application/pdf') {
    return 'Tipe MIME dokumen kontrak wajib application/pdf.';
  }
  return null;
}

/**
 * Mengonversi nilai <input type="datetime-local"> (diasumsikan WIB UTC+7) menjadi ISO UTC string
 * yang valid terhadap Zod `.string().datetime()`.
 */
export function toIsoDateTimeFromJakartaLocal(
  localDateTimeValue: string | null | undefined
): string | null {
  if (!localDateTimeValue) return null;
  const trimmed = localDateTimeValue.trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;

  const datePart = match[1];
  const timePart = match[2];
  const secPart = match[3] ?? '00';
  const parsed = new Date(`${datePart}T${timePart}:${secPart}+07:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function getJakartaNowDateTimeLocalValue(nowMs?: number): string {
  const ms = typeof nowMs === 'number' ? nowMs : Date.now();
  const wib = new Date(ms + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function computeConversionRatePct(
  wonCount: number,
  totalCount: number
): number {
  if (!Number.isFinite(wonCount) || !Number.isFinite(totalCount) || totalCount <= 0) {
    return 0;
  }
  const pct = (Math.max(0, wonCount) / totalCount) * 100;
  return Math.round(pct * 10) / 10;
}

export function formatLeadSourceLabel(source: LeadSource | string): string {
  switch (source) {
    case 'INSTAGRAM_ADS':
      return 'Instagram Ads';
    case 'FACEBOOK_ADS':
      return 'Facebook Ads';
    case 'TIKTOK_ADS':
      return 'TikTok Ads';
    case 'WEBSITE':
      return 'Website Resmi';
    case 'WALK_IN':
      return 'Walk-In Kantor';
    case 'EXPO_EVENT':
      return 'Pameran / Expo';
    case 'REFERRAL':
      return 'Referral';
    case 'OTHER':
      return 'Lainnya';
    default:
      return source.replace(/_/g, ' ');
  }
}

export function formatPaymentMethodShort(method: PaymentMethod | string): string {
  switch (method) {
    case 'KPR':
      return 'KPR Bank';
    case 'CASH_KERAS':
      return 'Cash Keras';
    case 'CASH_BERTAHAP':
      return 'Cash Bertahap';
    default:
      return method;
  }
}
