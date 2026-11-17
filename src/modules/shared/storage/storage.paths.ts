// Lokasi: src/modules/shared/storage/storage.paths.ts
// Level Topologis: L0 (Shared Storage Object Path Builder & Validator)

import { randomUUID } from 'crypto';
import { ALLOWED_FILE_EXTENSIONS } from './storage.validator';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STANDARD_FILENAME_REGEX = /^[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$/i;
const DISBURSEMENT_FILENAME_REGEX =
  /^tranche_[0-9]+_[a-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$/i;
const CONTRACT_FILENAME_REGEX = /^[a-z0-9._-]+\.pdf$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function assertValidUuid(value: string, label: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new Error(`INVALID_PATH_UUID: Parameter ${label} bukan UUID yang valid.`);
  }
}

function buildUniqueSuffix(extension: string): string {
  const cleanExt = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    !ALLOWED_FILE_EXTENSIONS.includes(
      cleanExt as (typeof ALLOWED_FILE_EXTENSIONS)[number]
    )
  ) {
    throw new Error(
      `INVALID_STORAGE_EXTENSION: Ekstensi ".${cleanExt || 'unknown'}" tidak diizinkan pada Private Storage.`
    );
  }
  const timestamp = Date.now();
  const shortUuid = randomUUID().split('-')[0];
  return `${timestamp}_${shortUuid}.${cleanExt}`;
}

/**
 * Validasi struktur path Storage secara ketat (simetris dengan app_security.can_read_storage_object).
 */
export function isValidStorageObjectPath(filePath: string): boolean {
  if (
    !filePath ||
    typeof filePath !== 'string' ||
    filePath.trim() !== filePath ||
    /[\x00-\x1f\x7f]/.test(filePath) ||
    filePath.includes('..') ||
    filePath.includes('//') ||
    filePath.includes('\\') ||
    filePath.includes('%') ||
    filePath.startsWith('/') ||
    filePath.endsWith('/')
  ) {
    return false;
  }

  const parts = filePath.split('/');
  if (parts[0] !== 'bookings' || !UUID_REGEX.test(parts[1] ?? '')) {
    return false;
  }

  const category = parts[2];

  if (category === 'payments' || category === 'kpr-docs') {
    return (
      parts.length === 5 &&
      UUID_REGEX.test(parts[3] ?? '') &&
      STANDARD_FILENAME_REGEX.test(parts[4] ?? '')
    );
  }

  if (category === 'kpr-disbursements') {
    return (
      parts.length === 5 &&
      UUID_REGEX.test(parts[3] ?? '') &&
      DISBURSEMENT_FILENAME_REGEX.test(parts[4] ?? '')
    );
  }

  if (category === 'refunds' || category === 'contracts') {
    if (parts.length !== 4) {
      return false;
    }
    const fileName = parts[3] ?? '';
    if (
      fileName.length < 42 ||
      !UUID_REGEX.test(fileName.slice(0, 36)) ||
      fileName[36] !== '_'
    ) {
      return false;
    }
    return category === 'contracts'
      ? CONTRACT_FILENAME_REGEX.test(fileName)
      : STANDARD_FILENAME_REGEX.test(fileName);
  }

  return false;
}

export function buildPaymentProofStoragePath(params: {
  bookingId: string;
  paymentScheduleId: string;
  extension: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.paymentScheduleId, 'paymentScheduleId');
  return `bookings/${params.bookingId}/payments/${params.paymentScheduleId}/${buildUniqueSuffix(
    params.extension
  )}`;
}

export function buildKprDocumentStoragePath(params: {
  bookingId: string;
  kprApplicationId: string;
  documentCode: string;
  extension: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.kprApplicationId, 'kprApplicationId');
  const safeCode = params.documentCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

  if (!safeCode) {
    throw new Error('INVALID_DOCUMENT_CODE: Kode dokumen KPR tidak valid.');
  }

  return `bookings/${params.bookingId}/kpr-docs/${params.kprApplicationId}/${safeCode}_${buildUniqueSuffix(
    params.extension
  )}`;
}

export function buildKprDisbursementProofStoragePath(params: {
  bookingId: string;
  kprApplicationId: string;
  sequenceNumber: number;
  extension: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.kprApplicationId, 'kprApplicationId');
  if (!Number.isInteger(params.sequenceNumber) || params.sequenceNumber < 1) {
    throw new Error(
      'INVALID_SEQUENCE_NUMBER: Nomor urut pencairan (sequenceNumber) harus bilangan bulat positif.'
    );
  }
  return `bookings/${params.bookingId}/kpr-disbursements/${params.kprApplicationId}/tranche_${params.sequenceNumber}_${buildUniqueSuffix(
    params.extension
  )}`;
}

export function buildRefundProofStoragePath(params: {
  bookingId: string;
  refundTransactionId: string;
  extension: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.refundTransactionId, 'refundTransactionId');
  return `bookings/${params.bookingId}/refunds/${params.refundTransactionId}_${buildUniqueSuffix(
    params.extension
  )}`;
}

export function buildDealContractStoragePath(params: {
  bookingId: string;
  dealId: string;
}): string {
  assertValidUuid(params.bookingId, 'bookingId');
  assertValidUuid(params.dealId, 'dealId');
  return `bookings/${params.bookingId}/contracts/${params.dealId}_${buildUniqueSuffix('pdf')}`;
}
