// Lokasi: src/lib/utils/transactions-ui.ts
// Utilitas Deterministik Murni untuk UI Transaksi, SLA Pembayaran, PD-01, Price Freeze & Refund

import type {
  BookingStatus,
  PaymentVerificationStatus,
  RefundPolicy,
} from '@/types/database.types';

export type DocumentKind = 'IMAGE' | 'PDF' | 'OTHER';

export function detectDocumentKind(filePathOrName: string | null | undefined): DocumentKind {
  if (!filePathOrName) return 'OTHER';
  const clean = filePathOrName.trim().toLowerCase().split('?')[0] ?? '';
  if (clean.endsWith('.pdf')) return 'PDF';
  if (
    clean.endsWith('.jpg') ||
    clean.endsWith('.jpeg') ||
    clean.endsWith('.png') ||
    clean.endsWith('.webp')
  ) {
    return 'IMAGE';
  }
  return 'OTHER';
}

export type PaymentSlaLevel = 'NONE' | 'NORMAL' | 'SLA_24H' | 'ESCALATION_48H';

export interface PaymentSlaInfo {
  level: PaymentSlaLevel;
  hoursWaiting: number;
  isPastBookingExpiry: boolean;
}

export function classifyPaymentSla(params: {
  verificationStatus: PaymentVerificationStatus;
  submittedAt: string;
  bookingStatus: BookingStatus;
  bookingExpiresAt: string;
  nowMs: number;
}): PaymentSlaInfo {
  const submittedMs = new Date(params.submittedAt).getTime();
  const expiresMs = new Date(params.bookingExpiresAt).getTime();
  const elapsedMs = Number.isNaN(submittedMs) ? 0 : Math.max(0, params.nowMs - submittedMs);
  const hoursWaiting = Math.round(elapsedMs / (1000 * 60 * 60));
  const isPastBookingExpiry =
    params.bookingStatus === 'PENDING_FEE' &&
    !Number.isNaN(expiresMs) &&
    params.nowMs > expiresMs;

  if (params.verificationStatus !== 'PENDING_VERIFICATION') {
    return { level: 'NONE', hoursWaiting, isPastBookingExpiry };
  }

  if (elapsedMs > 48 * 60 * 60 * 1000 || isPastBookingExpiry) {
    return { level: 'ESCALATION_48H', hoursWaiting, isPastBookingExpiry };
  }

  if (elapsedMs > 24 * 60 * 60 * 1000) {
    return { level: 'SLA_24H', hoursWaiting, isPastBookingExpiry };
  }

  return { level: 'NORMAL', hoursWaiting, isPastBookingExpiry };
}

export interface BookingHoldProtectionInfo {
  isPd01Protected: boolean;
  isExpiredPendingRelease: boolean;
  remainingHours: number;
}

export function computeBookingHoldProtection(params: {
  status: BookingStatus;
  expiresAt: string;
  hasPendingVerificationPayment: boolean;
  nowMs: number;
}): BookingHoldProtectionInfo {
  if (params.status !== 'PENDING_FEE') {
    return {
      isPd01Protected: false,
      isExpiredPendingRelease: false,
      remainingHours: 0,
    };
  }

  const expiresMs = new Date(params.expiresAt).getTime();
  const diffMs = Number.isNaN(expiresMs) ? 0 : expiresMs - params.nowMs;
  const remainingHours = Math.round(diffMs / (1000 * 60 * 60));

  if (diffMs <= 0) {
    return {
      isPd01Protected: params.hasPendingVerificationPayment,
      isExpiredPendingRelease: !params.hasPendingVerificationPayment,
      remainingHours,
    };
  }

  return {
    isPd01Protected: false,
    isExpiredPendingRelease: false,
    remainingHours,
  };
}

export function computePriceFreezeDiff(
  catalogPriceSnapshot: number,
  currentUnitCatalogPrice: number
): { isPriceFrozenDifferent: boolean; deltaAmount: number } {
  const deltaAmount = currentUnitCatalogPrice - catalogPriceSnapshot;
  return {
    isPriceFrozenDifferent: Math.abs(deltaAmount) > 0,
    deltaAmount,
  };
}

export function getAllowedRefundPolicies(totalVerifiedPaid: number): RefundPolicy[] {
  if (totalVerifiedPaid <= 0) {
    return ['NONE'];
  }
  return ['FORFEITED_FULL', 'FULL_REFUND', 'PARTIAL_REFUND'];
}

export function computeDefaultRefundAmount(
  policy: RefundPolicy,
  totalVerifiedPaid: number
): number {
  if (totalVerifiedPaid <= 0) return 0;
  switch (policy) {
    case 'NONE':
    case 'FORFEITED_FULL':
      return 0;
    case 'FULL_REFUND':
      return totalVerifiedPaid;
    case 'PARTIAL_REFUND':
      return Math.max(1, Math.round(totalVerifiedPaid * 0.5));
  }
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'] as const;

export function validateUploadFileClient(file: File | null | undefined): string | null {
  if (!file) {
    return 'File bukti dokumen wajib dipilih.';
  }
  if (file.size <= 0) {
    return 'File yang dipilih kosong (0 byte).';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    return `Ukuran file (${mb} MB) melebihi batas maksimal 5 MB.`;
  }
  const ext = file.name.trim().toLowerCase().split('.').pop() ?? '';
  if (!ALLOWED_UPLOAD_EXTS.includes(ext as (typeof ALLOWED_UPLOAD_EXTS)[number])) {
    return 'Format file tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF.';
  }
  return null;
}

export function getJakartaTodayDateString(nowMs?: number): string {
  const ms = typeof nowMs === 'number' ? nowMs : Date.now();
  const wib = new Date(ms + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
