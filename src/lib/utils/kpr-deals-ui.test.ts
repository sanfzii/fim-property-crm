// Lokasi: src/lib/utils/kpr-deals-ui.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KPR_TEN_STAGES,
  canCancelKprByCustomer,
  canRecordKprApprovalDecision,
  computeConversionRatePct,
  computeKprMandatoryDocReadiness,
  getAllowedDealTransitions,
  getAllowedNextKprAdvanceTargets,
  getEligibleKprDisbursementTranche,
  getKprStageIndex,
  isKprApplicationHalted,
  toIsoDateTimeFromJakartaLocal,
  validatePdfFileClient,
} from './kpr-deals-ui';

test('KPR_TEN_STAGES berisi tepat 10 tahap murni tanpa tahap REJECTED', () => {
  assert.equal(KPR_TEN_STAGES.length, 10);
  assert.equal(KPR_TEN_STAGES[0]?.stage, 'DOCUMENT_COLLECTION');
  assert.equal(KPR_TEN_STAGES[9]?.stage, 'DISBURSEMENT');
  assert.equal(
    KPR_TEN_STAGES.some((s) => (s.stage as string) === 'REJECTED'),
    false
  );
  assert.equal(getKprStageIndex('APPRAISAL'), 4);
  assert.equal(isKprApplicationHalted('REJECTED_BY_BANK'), true);
  assert.equal(isKprApplicationHalted('CANCELLED_BY_CUSTOMER'), true);
  assert.equal(isKprApplicationHalted('IN_PROGRESS'), false);
});

test('computeKprMandatoryDocReadiness menghitung dokumen wajib terverifikasi secara akurat', () => {
  const partial = computeKprMandatoryDocReadiness([
    { isMandatory: true, status: 'VERIFIED' },
    { isMandatory: true, status: 'UPLOADED' },
    { isMandatory: true, status: 'REVISION_REQUIRED' },
    { isMandatory: true, status: 'MISSING' },
    { isMandatory: false, status: 'MISSING' },
  ]);
  assert.equal(partial.totalMandatory, 4);
  assert.equal(partial.verifiedMandatory, 1);
  assert.equal(partial.unverifiedMandatory, 3);
  assert.equal(partial.isReadyForBankSubmission, false);

  const ready = computeKprMandatoryDocReadiness([
    { isMandatory: true, status: 'VERIFIED' },
    { isMandatory: true, status: 'VERIFIED' },
    { isMandatory: false, status: 'MISSING' },
  ]);
  assert.equal(ready.isReadyForBankSubmission, true);
});

test('getAllowedNextKprAdvanceTargets mengikuti graf state-machine RPC TX-09', () => {
  assert.deepEqual(
    getAllowedNextKprAdvanceTargets({
      bookingStatus: 'ACTIVE',
      applicationStatus: 'IN_PROGRESS',
      currentStage: 'DOCUMENT_VERIFICATION',
    }),
    ['SUBMITTED', 'DOCUMENT_COLLECTION']
  );

  assert.deepEqual(
    getAllowedNextKprAdvanceTargets({
      bookingStatus: 'ACTIVE',
      applicationStatus: 'APPROVED',
      currentStage: 'APPROVED',
    }),
    ['AKAD_SCHEDULED']
  );

  assert.deepEqual(
    getAllowedNextKprAdvanceTargets({
      bookingStatus: 'ACTIVE',
      applicationStatus: 'REJECTED_BY_BANK',
      currentStage: 'APPRAISAL',
    }),
    []
  );
});

test('Approval, customer cancel, dan disbursement tranche guards selaras dengan TX-04, TX-10, TX-08', () => {
  assert.equal(
    canRecordKprApprovalDecision({
      bookingStatus: 'ACTIVE',
      applicationStatus: 'IN_PROGRESS',
      currentStage: 'DOCUMENT_VERIFICATION',
    }),
    false
  );
  assert.equal(
    canRecordKprApprovalDecision({
      bookingStatus: 'ACTIVE',
      applicationStatus: 'IN_PROGRESS',
      currentStage: 'APPRAISAL',
    }),
    true
  );

  assert.equal(
    canCancelKprByCustomer({
      bookingStatus: 'ACTIVE',
      applicationStatus: 'APPROVED',
      currentStage: 'AKAD_SCHEDULED',
      disbursementStatus: 'NOT_DISBURSED',
    }),
    true
  );
  assert.equal(
    canCancelKprByCustomer({
      bookingStatus: 'ACTIVE',
      applicationStatus: 'APPROVED',
      currentStage: 'DISBURSEMENT',
      disbursementStatus: 'PARTIALLY_DISBURSED',
    }),
    false
  );

  assert.equal(
    getEligibleKprDisbursementTranche({
      bookingStatus: 'ACTIVE',
      applicationStatus: 'APPROVED',
      currentStage: 'AKAD_COMPLETED',
      remainingUndisbursedAmount: 500_000_000,
    }),
    'PRIMARY'
  );
  assert.equal(
    getEligibleKprDisbursementTranche({
      bookingStatus: 'ACTIVE',
      applicationStatus: 'APPROVED',
      currentStage: 'DISBURSEMENT',
      remainingUndisbursedAmount: 100_000_000,
    }),
    'SUBSEQUENT'
  );
  assert.equal(
    getEligibleKprDisbursementTranche({
      bookingStatus: 'COMPLETED',
      applicationStatus: 'COMPLETED',
      currentStage: 'DISBURSEMENT',
      remainingUndisbursedAmount: 0,
    }),
    null
  );
});

test('getAllowedDealTransitions dan validatePdfFileClient memvalidasi transisi TX-05 & PDF-only', () => {
  assert.deepEqual(
    getAllowedDealTransitions({
      bookingStatus: 'ACTIVE',
      paymentMethod: 'CASH_BERTAHAP',
      salesOutcomeStatus: 'IN_PROGRESS',
      contractStatus: 'PRE_CONTRACT',
      paymentSettlementStatus: 'DP_SETTLED_ONGOING',
      unitStatus: 'BOOKED',
      kprApplicationStatus: null,
      kprCurrentStage: null,
      kprDisbursementStatus: null,
    }),
    ['ACTIVATE_PPJB_CONTRACT', 'FINALIZE_FULL_SETTLEMENT']
  );

  assert.deepEqual(
    getAllowedDealTransitions({
      bookingStatus: 'ACTIVE',
      paymentMethod: 'KPR',
      salesOutcomeStatus: 'IN_PROGRESS',
      contractStatus: 'PRE_CONTRACT',
      paymentSettlementStatus: 'DP_SETTLED_ONGOING',
      unitStatus: 'BOOKED',
      kprApplicationStatus: 'APPROVED',
      kprCurrentStage: 'AKAD_SCHEDULED',
      kprDisbursementStatus: 'NOT_DISBURSED',
    }),
    ['RECORD_KPR_AKAD_COMPLETED']
  );

  assert.deepEqual(
    getAllowedDealTransitions({
      bookingStatus: 'ACTIVE',
      paymentMethod: 'KPR',
      salesOutcomeStatus: 'CLOSED_WON',
      contractStatus: 'UNDER_CONTRACT',
      paymentSettlementStatus: 'DISBURSED_RETENTION_PENDING',
      unitStatus: 'BOOKED',
      kprApplicationStatus: 'APPROVED',
      kprCurrentStage: 'DISBURSEMENT',
      kprDisbursementStatus: 'PARTIALLY_DISBURSED',
    }),
    []
  );

  const validPdf = new File([new Uint8Array([1, 2, 3])], 'kontrak-ppjb.pdf', {
    type: 'application/pdf',
  });
  assert.equal(validatePdfFileClient(validPdf, { required: true }), null);

  const nonPdf = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', {
    type: 'image/jpeg',
  });
  assert.ok(validatePdfFileClient(nonPdf) !== null);
});

test('toIsoDateTimeFromJakartaLocal & computeConversionRatePct bekerja deterministik', () => {
  assert.equal(
    toIsoDateTimeFromJakartaLocal('2026-04-10T10:30'),
    '2026-04-10T03:30:00.000Z'
  );
  assert.equal(computeConversionRatePct(3, 15), 20);
  assert.equal(computeConversionRatePct(0, 0), 0);
});
