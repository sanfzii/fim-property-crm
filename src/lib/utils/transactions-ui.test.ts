// Lokasi: src/lib/utils/transactions-ui.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPaymentSla,
  computeBookingHoldProtection,
  computeDefaultRefundAmount,
  computePriceFreezeDiff,
  detectDocumentKind,
  getAllowedRefundPolicies,
  getJakartaTodayDateString,
} from './transactions-ui';

const BASE_NOW = Date.UTC(2026, 10, 14, 12, 0, 0);

test('detectDocumentKind identifies image, pdf, and other', () => {
  assert.equal(detectDocumentKind('bookings/id/payments/bukti.pdf'), 'PDF');
  assert.equal(detectDocumentKind('bukti_transfer.JPG'), 'IMAGE');
  assert.equal(detectDocumentKind('resi.webp'), 'IMAGE');
  assert.equal(detectDocumentKind('arsip.docx'), 'OTHER');
});

test('classifyPaymentSla distinguishes normal, >24h, >48h, and PD-01 expired booking', () => {
  const normal = classifyPaymentSla({
    verificationStatus: 'PENDING_VERIFICATION',
    submittedAt: new Date(BASE_NOW - 6 * 3600 * 1000).toISOString(),
    bookingStatus: 'ACTIVE',
    bookingExpiresAt: new Date(BASE_NOW + 20 * 3600 * 1000).toISOString(),
    nowMs: BASE_NOW,
  });
  assert.equal(normal.level, 'NORMAL');
  assert.equal(normal.hoursWaiting, 6);

  const sla24 = classifyPaymentSla({
    verificationStatus: 'PENDING_VERIFICATION',
    submittedAt: new Date(BASE_NOW - 30 * 3600 * 1000).toISOString(),
    bookingStatus: 'ACTIVE',
    bookingExpiresAt: new Date(BASE_NOW + 20 * 3600 * 1000).toISOString(),
    nowMs: BASE_NOW,
  });
  assert.equal(sla24.level, 'SLA_24H');

  const sla48 = classifyPaymentSla({
    verificationStatus: 'PENDING_VERIFICATION',
    submittedAt: new Date(BASE_NOW - 52 * 3600 * 1000).toISOString(),
    bookingStatus: 'PENDING_FEE',
    bookingExpiresAt: new Date(BASE_NOW - 8 * 3600 * 1000).toISOString(),
    nowMs: BASE_NOW,
  });
  assert.equal(sla48.level, 'ESCALATION_48H');
  assert.equal(sla48.isPastBookingExpiry, true);

  const verified = classifyPaymentSla({
    verificationStatus: 'VERIFIED',
    submittedAt: new Date(BASE_NOW - 100 * 3600 * 1000).toISOString(),
    bookingStatus: 'ACTIVE',
    bookingExpiresAt: new Date(BASE_NOW - 50 * 3600 * 1000).toISOString(),
    nowMs: BASE_NOW,
  });
  assert.equal(verified.level, 'NONE');
});

test('computeBookingHoldProtection enforces PD-01 protection on expired PENDING_FEE with pending proof', () => {
  const protectedHold = computeBookingHoldProtection({
    status: 'PENDING_FEE',
    expiresAt: new Date(BASE_NOW - 8 * 3600 * 1000).toISOString(),
    hasPendingVerificationPayment: true,
    nowMs: BASE_NOW,
  });
  assert.equal(protectedHold.isPd01Protected, true);
  assert.equal(protectedHold.isExpiredPendingRelease, false);

  const unprotectedExpired = computeBookingHoldProtection({
    status: 'PENDING_FEE',
    expiresAt: new Date(BASE_NOW - 2 * 3600 * 1000).toISOString(),
    hasPendingVerificationPayment: false,
    nowMs: BASE_NOW,
  });
  assert.equal(unprotectedExpired.isPd01Protected, false);
  assert.equal(unprotectedExpired.isExpiredPendingRelease, true);
});

test('computePriceFreezeDiff detects current catalog price drift', () => {
  const diff = computePriceFreezeDiff(850_000_000, 880_000_000);
  assert.equal(diff.isPriceFrozenDifferent, true);
  assert.equal(diff.deltaAmount, 30_000_000);
});

test('refund helpers match PD-04 cancellation rules', () => {
  assert.deepEqual(getAllowedRefundPolicies(0), ['NONE']);
  assert.deepEqual(getAllowedRefundPolicies(10_000_000), [
    'FORFEITED_FULL',
    'FULL_REFUND',
    'PARTIAL_REFUND',
  ]);
  assert.equal(computeDefaultRefundAmount('FULL_REFUND', 15_000_000), 15_000_000);
  assert.equal(computeDefaultRefundAmount('FORFEITED_FULL', 15_000_000), 0);
  assert.equal(computeDefaultRefundAmount('PARTIAL_REFUND', 10_000_000), 5_000_000);
});

test('getJakartaTodayDateString converts UTC midnight+ to Asia/Jakarta date', () => {
  // 2026-11-14T18:00:00Z == 2026-11-15T01:00:00 WIB
  const utcEvening = Date.UTC(2026, 10, 14, 18, 0, 0);
  assert.equal(getJakartaTodayDateString(utcEvening), '2026-11-15');
});
