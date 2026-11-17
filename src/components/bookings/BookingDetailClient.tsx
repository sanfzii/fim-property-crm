// Lokasi: src/components/bookings/BookingDetailClient.tsx
// Client Component Halaman Detail Booking (/bookings/[id])

'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  History,
  Landmark,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import type {
  BookingStatus,
  DealContractStatus,
  DealSalesOutcome,
  DealSettlementStatus,
  KprStage,
  PaymentMethod,
  PaymentVerificationStatus,
  RefundPolicy,
  RefundStatus,
  ScheduleStatus,
  ScheduleType,
  SystemRole,
} from '@/types/database.types';
import {
  cancelBookingOrDealAction,
  extendBookingExpiryAction,
  generateInstallmentSchedulesAction,
} from '@/modules/transactions/transactions.actions';
import { formatDateID, formatDateTimeID, formatRupiah } from '@/lib/utils/format';
import {
  classifyPaymentSla,
  computeBookingHoldProtection,
  computeDefaultRefundAmount,
  computePriceFreezeDiff,
  getAllowedRefundPolicies,
  getJakartaTodayDateString,
} from '@/lib/utils/transactions-ui';
import { Badge, DomainStatusBadge, UnitStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/ToastProvider';
import { DownloadDocumentButton } from '@/components/transactions/DownloadDocumentButton';
import type {
  ReplacementPaymentTarget,
  UploadScheduleTarget,
} from '@/components/transactions/PaymentProofUploadModal';
import type { PaymentVerificationTarget } from '@/components/transactions/PaymentVerificationModal';
import type { RefundCompletionTarget } from '@/components/transactions/RefundCompletionModal';

const DocumentPreviewModal = dynamic(
  () =>
    import('@/components/transactions/DocumentPreviewModal').then(
      (mod) => mod.DocumentPreviewModal
    ),
  { ssr: false }
);
const PaymentProofUploadModal = dynamic(
  () =>
    import('@/components/transactions/PaymentProofUploadModal').then(
      (mod) => mod.PaymentProofUploadModal
    ),
  { ssr: false }
);
const PaymentVerificationModal = dynamic(
  () =>
    import('@/components/transactions/PaymentVerificationModal').then(
      (mod) => mod.PaymentVerificationModal
    ),
  { ssr: false }
);
const RefundCompletionModal = dynamic(
  () =>
    import('@/components/transactions/RefundCompletionModal').then(
      (mod) => mod.RefundCompletionModal
    ),
  { ssr: false }
);

export interface BookingDetailDto {
  id: string;
  referenceNumber: string;
  leadId: string;
  leadFullName: string;
  leadPhone: string;
  leadEmail: string | null;
  unitId: string;
  unitCode: string;
  blockNumber: string;
  unitStatus: string;
  unitCurrentCatalogPrice: number;
  projectName: string;
  propertyTypeName: string;
  salesName: string;
  teamCode: string;
  teamName: string;
  paymentMethod: PaymentMethod;
  promoLabel: string | null;
  catalogPriceSnapshot: number;
  promoDiscountSnapshot: number;
  agreedFinalPrice: number;
  bookingFeeAmount: number;
  isBookingFeePartOfDp: boolean;
  agreedDpTotalAmount: number;
  status: BookingStatus;
  bookedAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  refundPolicyType: RefundPolicy | null;
  agreedRefundAmount: number;
  forfeitedRetainedAmount: number;
  notes: string | null;
}

export interface BookingScheduleDto {
  id: string;
  scheduleType: ScheduleType;
  installmentNumber: number;
  title: string;
  scheduledAmount: number;
  verifiedPaidAmount: number;
  remainingAmount: number;
  dueDate: string;
  status: ScheduleStatus;
  paidAt: string | null;
}

export interface BookingPaymentRecordDto {
  id: string;
  referenceNumber: string;
  paymentScheduleId: string;
  scheduleTitle: string;
  scheduleType: ScheduleType;
  scheduledAmount: number;
  scheduleRemainingAmount: number;
  scheduleStatus: ScheduleStatus;
  paidAmount: number;
  paymentDate: string;
  paymentChannel: string;
  proofFilePath: string;
  proofFileName: string;
  replacesPaymentId: string | null;
  replacesPaymentRef: string | null;
  replacedByRef: string | null;
  hasActiveOrVerifiedReplacement: boolean;
  verificationStatus: PaymentVerificationStatus;
  submittedAt: string;
  submittedByName: string;
  salesNotes: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
}

export interface BookingExtensionDto {
  id: string;
  oldExpiresAt: string;
  newExpiresAt: string;
  reason: string;
  extendedByName: string;
  createdAt: string;
}

export interface BookingRefundDto {
  id: string;
  referenceNumber: string;
  refundAmount: number;
  refundDate: string | null;
  refundMethod: string;
  proofFilePath: string | null;
  status: RefundStatus;
  processedByName: string;
  notes: string | null;
  createdAt: string;
}

export interface BookingKprSummaryDto {
  id: string;
  referenceNumber: string;
  bankName: string;
  tenorYears: number;
  requestedLoanAmount: number;
  approvedLoanAmount: number | null;
  currentStage: KprStage;
  applicationStatus: string;
}

export interface BookingDealSummaryDto {
  id: string;
  dealNumber: string;
  salesOutcomeStatus: DealSalesOutcome;
  contractStatus: DealContractStatus;
  settlementStatus: DealSettlementStatus;
}

export interface BookingDetailClientProps {
  userRole: SystemRole;
  booking: BookingDetailDto;
  schedules: BookingScheduleDto[];
  payments: BookingPaymentRecordDto[];
  extensions: BookingExtensionDto[];
  refunds: BookingRefundDto[];
  kprApplication: BookingKprSummaryDto | null;
  deal: BookingDealSummaryDto | null;
  referenceNowMs: number;
}

const REFUND_POLICY_LABELS: Record<RefundPolicy, string> = {
  NONE: 'NONE — Tidak Ada Dana Terverifikasi',
  FORFEITED_FULL: 'FORFEITED FULL — Dana Hangus Seluruhnya',
  FULL_REFUND: 'FULL REFUND — Pengembalian Penuh 100%',
  PARTIAL_REFUND: 'PARTIAL REFUND — Pengembalian Sebagian',
};

function formatPaymentMethod(method: PaymentMethod): string {
  switch (method) {
    case 'KPR':
      return 'KPR Bank';
    case 'CASH_KERAS':
      return 'Cash Keras';
    case 'CASH_BERTAHAP':
      return 'Cash Bertahap';
  }
}

export function BookingDetailClient({
  userRole,
  booking,
  schedules,
  payments,
  extensions,
  refunds,
  kprApplication,
  deal,
  referenceNowMs,
}: BookingDetailClientProps) {
  const router = useRouter();
  const { showToast } = useToast();

  const isAdmin = userRole === 'ADMIN';
  const canUploadProof = userRole === 'ADMIN' || userRole === 'SALES';
  const todayWib = getJakartaTodayDateString(referenceNowMs);

  // State Modals
  const [uploadTarget, setUploadTarget] = useState<{
    schedule: UploadScheduleTarget;
    replacesPayment: ReplacementPaymentTarget | null;
  } | null>(null);

  const [verificationTarget, setVerificationTarget] =
    useState<PaymentVerificationTarget | null>(null);

  const [previewDoc, setPreviewDoc] = useState<{
    filePath: string;
    fileName: string;
    title: string;
  } | null>(null);

  const [refundTarget, setRefundTarget] =
    useState<RefundCompletionTarget | null>(null);

  // Extend Booking Modal (Admin-only)
  const [isExtendOpen, setIsExtendOpen] = useState(false);
  const [additionalHours, setAdditionalHours] = useState('24');
  const [extendReason, setExtendReason] = useState('');
  const [extendError, setExtendError] = useState<string | null>(null);
  const [isExtending, setIsExtending] = useState(false);

  // Cash Bertahap Installments Modal (Admin-only)
  const [isInstallmentOpen, setIsInstallmentOpen] = useState(false);
  const [installmentCount, setInstallmentCount] = useState('12');
  const [firstDueDate, setFirstDueDate] = useState(todayWib);
  const [installmentError, setInstallmentError] = useState<string | null>(null);
  const [isGeneratingInstallments, setIsGeneratingInstallments] = useState(false);

  // Cancel Booking Modal (Admin-only)
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [refundPolicyType, setRefundPolicyType] = useState<RefundPolicy>('NONE');
  const [agreedRefundAmount, setAgreedRefundAmount] = useState('0');
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancelNotes, setCancelNotes] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Derived computations
  const hasPendingVerification = useMemo(
    () => payments.some((p) => p.verificationStatus === 'PENDING_VERIFICATION'),
    [payments]
  );

  const totalVerifiedPaid = useMemo(
    () =>
      payments
        .filter((p) => p.verificationStatus === 'VERIFIED')
        .reduce((acc, p) => acc + p.paidAmount, 0),
    [payments]
  );

  const holdProtection = useMemo(
    () =>
      computeBookingHoldProtection({
        status: booking.status,
        expiresAt: booking.expiresAt,
        hasPendingVerificationPayment: hasPendingVerification,
        nowMs: referenceNowMs,
      }),
    [booking.status, booking.expiresAt, hasPendingVerification, referenceNowMs]
  );

  const priceFreeze = useMemo(
    () =>
      computePriceFreezeDiff(
        booking.catalogPriceSnapshot,
        booking.unitCurrentCatalogPrice
      ),
    [booking.catalogPriceSnapshot, booking.unitCurrentCatalogPrice]
  );

  const hasExistingInstallments = useMemo(
    () =>
      schedules.some(
        (s) => s.scheduleType === 'INSTALLMENT' && s.status !== 'CANCELLED'
      ),
    [schedules]
  );

  const canExtendBooking = isAdmin && booking.status === 'PENDING_FEE';
  const canGenerateInstallments =
    isAdmin &&
    booking.status === 'ACTIVE' &&
    booking.paymentMethod === 'CASH_BERTAHAP' &&
    !hasExistingInstallments;
  const canCancelBooking =
    isAdmin &&
    booking.status !== 'CANCELLED' &&
    booking.status !== 'EXPIRED' &&
    booking.status !== 'COMPLETED';

  const bookingAcceptsPayments =
    booking.status === 'PENDING_FEE' || booking.status === 'ACTIVE';

  const allowedPolicies = useMemo(
    () => getAllowedRefundPolicies(totalVerifiedPaid),
    [totalVerifiedPaid]
  );

  const openCancelModal = () => {
    const initialPolicy = allowedPolicies[0] ?? 'NONE';
    setRefundPolicyType(initialPolicy);
    setAgreedRefundAmount(
      String(computeDefaultRefundAmount(initialPolicy, totalVerifiedPaid))
    );
    setCancellationReason('');
    setCancelNotes('');
    setCancelError(null);
    setIsCancelOpen(true);
  };

  const handlePolicyChange = (nextPolicy: RefundPolicy) => {
    setRefundPolicyType(nextPolicy);
    setAgreedRefundAmount(
      String(computeDefaultRefundAmount(nextPolicy, totalVerifiedPaid))
    );
  };

  const handleExtendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setExtendError(null);
    const hrs = Number(additionalHours);
    if (!Number.isInteger(hrs) || hrs < 1 || hrs > 168) {
      setExtendError('Durasi perpanjangan wajib antara 1 s.d. 168 jam.');
      return;
    }
    if (extendReason.trim().length < 10) {
      setExtendError('Alasan perpanjangan wajib diisi minimal 10 karakter (OQ-03).');
      return;
    }

    setIsExtending(true);
    try {
      const result = await extendBookingExpiryAction({
        bookingId: booking.id,
        additionalHours: hrs,
        reason: extendReason.trim(),
      });

      if (!result.success) {
        setExtendError(result.message);
        showToast({
          tone: 'error',
          title: 'Gagal memperpanjang masa berlaku',
          description: result.message,
          correlationId: result.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Masa berlaku Booking diperpanjang',
        description: result.message,
      });
      setIsExtendOpen(false);
      router.refresh();
    } finally {
      setIsExtending(false);
    }
  };

  const handleInstallmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInstallmentError(null);
    const count = Number(installmentCount);
    if (!Number.isInteger(count) || count < 2 || count > 60) {
      setInstallmentError('Jumlah termin Cash Bertahap harus 2 s.d. 60 bulan.');
      return;
    }

    setIsGeneratingInstallments(true);
    try {
      const result = await generateInstallmentSchedulesAction({
        bookingId: booking.id,
        installmentCount: count,
        firstDueDate,
      });

      if (!result.success) {
        setInstallmentError(result.message);
        showToast({
          tone: 'error',
          title: 'Gagal menyusun termin Cash Bertahap',
          description: result.message,
          correlationId: result.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Termin Cash Bertahap terbentuk',
        description: result.message,
      });
      setIsInstallmentOpen(false);
      router.refresh();
    } finally {
      setIsGeneratingInstallments(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCancelError(null);

    if (hasPendingVerification) {
      setCancelError(
        'Masih terdapat bukti pembayaran berstatus PENDING_VERIFICATION. Proses verifikasi/penolakan terlebih dahulu.'
      );
      return;
    }

    if (cancellationReason.trim().length < 5) {
      setCancelError('Alasan pembatalan wajib diisi minimal 5 karakter.');
      return;
    }

    const numericRefund = Number(agreedRefundAmount);
    if (
      refundPolicyType === 'PARTIAL_REFUND' &&
      (!Number.isFinite(numericRefund) ||
        numericRefund <= 0 ||
        numericRefund >= totalVerifiedPaid)
    ) {
      setCancelError(
        `Untuk PARTIAL_REFUND, nominal pengembalian harus di antara Rp 1 dan ${formatRupiah(totalVerifiedPaid - 1)}.`
      );
      return;
    }

    setIsCancelling(true);
    try {
      const result = await cancelBookingOrDealAction({
        bookingId: booking.id,
        cancellationReason: cancellationReason.trim(),
        refundPolicyType,
        agreedRefundAmount:
          refundPolicyType === 'PARTIAL_REFUND'
            ? Math.round(numericRefund)
            : computeDefaultRefundAmount(refundPolicyType, totalVerifiedPaid),
        notes: cancelNotes.trim() || null,
      });

      if (!result.success) {
        setCancelError(result.message);
        showToast({
          tone: 'error',
          title: 'Pembatalan transaksi gagal',
          description: result.message,
          correlationId: result.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Transaksi dibatalkan & Unit tersedia kembali',
        description: result.message,
      });
      setIsCancelOpen(false);
      router.refresh();
    } finally {
      setIsCancelling(false);
    }
  };

  const openPaymentModal = (p: BookingPaymentRecordDto) => {
    setVerificationTarget({
      id: p.id,
      referenceNumber: p.referenceNumber,
      bookingId: booking.id,
      bookingReference: booking.referenceNumber,
      bookingStatus: booking.status,
      bookingExpiresAt: booking.expiresAt,
      paymentMethod: booking.paymentMethod,
      unitCode: booking.unitCode,
      prospectName: booking.leadFullName,
      scheduleTitle: p.scheduleTitle,
      scheduleType: p.scheduleType,
      scheduledAmount: p.scheduledAmount,
      scheduleRemainingAmount: p.scheduleRemainingAmount,
      paidAmount: p.paidAmount,
      paymentDate: p.paymentDate,
      paymentChannel: p.paymentChannel,
      proofFilePath: p.proofFilePath,
      proofFileName: p.proofFileName,
      verificationStatus: p.verificationStatus,
      submittedAt: p.submittedAt,
      submittedByName: p.submittedByName,
      salesNotes: p.salesNotes,
      verifiedByName: p.verifiedByName,
      verifiedAt: p.verifiedAt,
      verificationNotes: p.verificationNotes,
      replacesPaymentRef: p.replacesPaymentRef,
    });
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Header */}
      <div className="flex flex-col gap-4 border-b border-[#E2E8F0] pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <Link
            href="/bookings"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#475569] hover:text-[#0F172A]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Kembali ke Daftar Booking
          </Link>

          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-xl font-bold tracking-tight text-[#0F172A]">
              {booking.referenceNumber}
            </h1>
            <DomainStatusBadge value={booking.status} />
            <Badge tone="slate">{formatPaymentMethod(booking.paymentMethod)}</Badge>
            {holdProtection.isPd01Protected && (
              <Badge
                tone="amber"
                icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                Tertahan Verifikasi PD-01
              </Badge>
            )}
            {holdProtection.isExpiredPendingRelease && (
              <Badge
                tone="red"
                icon={<Clock className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                Lewat Batas Hold ({Math.abs(holdProtection.remainingHours)}j)
              </Badge>
            )}
          </div>

          <p className="text-xs text-[#475569]">
            Prospek:{' '}
            <Link
              href={`/leads/${booking.leadId}`}
              className="font-semibold text-[#14532D] hover:underline"
            >
              {booking.leadFullName}
            </Link>{' '}
            ({booking.leadPhone}) • Unit{' '}
            <span className="font-mono font-semibold text-[#0F172A]">
              {booking.unitCode}
            </span>{' '}
            ({booking.projectName}) • {booking.teamCode} • {booking.salesName}
          </p>

          <div className="flex flex-wrap items-center gap-3 text-xs text-[#64748B]">
            <span>Dibuat: {formatDateTimeID(booking.bookedAt)}</span>
            <span>•</span>
            <span>
              Batas Hold:{' '}
              <span className="font-medium text-[#0F172A]">
                {formatDateTimeID(booking.expiresAt)}
              </span>
              {booking.status === 'PENDING_FEE' &&
                !holdProtection.isPd01Protected &&
                !holdProtection.isExpiredPendingRelease && (
                  <span className="ml-1 text-[#B45309] tabular-nums">
                    (Sisa {holdProtection.remainingHours} jam)
                  </span>
                )}
            </span>
          </div>
        </div>

        {/* Tautan Entitas Terkait + Aksi Khusus ADMIN */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/leads/${booking.leadId}`}>
            <Button variant="outline" size="sm">
              Detail Lead
            </Button>
          </Link>
          {kprApplication && (
            <Link href={`/kpr/${kprApplication.id}`}>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Landmark className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                {kprApplication.referenceNumber}
              </Button>
            </Link>
          )}
          {deal && (
            <Link href="/deals">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<FileCheck2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                {deal.dealNumber}
              </Button>
            </Link>
          )}

          {canExtendBooking && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAdditionalHours('24');
                setExtendReason('');
                setExtendError(null);
                setIsExtendOpen(true);
              }}
              leftIcon={<Clock className="h-3.5 w-3.5" strokeWidth={1.75} />}
            >
              Perpanjang 24–168 Jam
            </Button>
          )}

          {canGenerateInstallments && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setInstallmentCount('12');
                setFirstDueDate(todayWib);
                setInstallmentError(null);
                setIsInstallmentOpen(true);
              }}
              leftIcon={<CalendarPlus className="h-3.5 w-3.5" strokeWidth={1.75} />}
            >
              Susun Termin Cash Bertahap
            </Button>
          )}

          {canCancelBooking && (
            <Button
              variant="destructive"
              size="sm"
              onClick={openCancelModal}
              leftIcon={<Ban className="h-3.5 w-3.5" strokeWidth={1.75} />}
            >
              Batalkan Transaksi
            </Button>
          )}
        </div>
      </div>

      {/* Banner Resolusi Pembatalan (Jika CANCELLED) */}
      {booking.status === 'CANCELLED' && (
        <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#991B1B]">
                Transaksi Dibatalkan —{' '}
                {booking.refundPolicyType
                  ? REFUND_POLICY_LABELS[booking.refundPolicyType]
                  : 'Kebijakan Pembatalan Tercatat'}
              </p>
              <p className="text-xs text-[#B91C1C]">
                Alasan: {booking.cancellationReason ?? '-'} • Waktu:{' '}
                {formatDateTimeID(booking.cancelledAt)}
              </p>
            </div>
            <div className="flex shrink-0 gap-4 text-xs">
              <div>
                <span className="block text-[11px] text-[#991B1B]">
                  Dana Dikembalikan (Refund)
                </span>
                <span className="font-bold text-[#991B1B] tabular-nums">
                  {formatRupiah(booking.agreedRefundAmount)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[#991B1B]">
                  Dana Hangus / Ditahan
                </span>
                <span className="font-bold text-[#991B1B] tabular-nums">
                  {formatRupiah(booking.forfeitedRetainedAmount)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grid Ringkasan Finansial & Price Freeze (BR-06 & BR-07) + Informasi Unit/Deal/KPR */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader>
            <div>
              <CardTitle>Kesepakatan Harga &amp; Price Freeze (BR-07)</CardTitle>
              <CardDescription>
                Snapshot harga katalog saat Booking diajukan terkunci secara
                permanen.
              </CardDescription>
            </div>
            {priceFreeze.isPriceFrozenDifferent ? (
              <Badge
                tone="emerald"
                icon={<Lock className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                Harga Terkunci (Price Freeze)
              </Badge>
            ) : (
              <Badge
                tone="slate"
                icon={<Lock className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                Snapshot Terkunci
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#64748B]">Harga Katalog Snapshot (Saat Booking)</span>
              <span className="font-semibold text-[#0F172A] tabular-nums">
                {formatRupiah(booking.catalogPriceSnapshot)}
              </span>
            </div>

            {priceFreeze.isPriceFrozenDifferent && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-[#047857]">
                <span>
                  Harga katalog unit terbaru saat ini:{' '}
                  <strong className="tabular-nums">
                    {formatRupiah(booking.unitCurrentCatalogPrice)}
                  </strong>
                </span>
                <span className="font-semibold tabular-nums">
                  Selisih terlindungi:{' '}
                  {priceFreeze.deltaAmount > 0 ? '+' : ''}
                  {formatRupiah(priceFreeze.deltaAmount)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <span className="text-[#64748B]">
                Diskon Promo{booking.promoLabel ? ` (${booking.promoLabel})` : ''}
              </span>
              <span className="font-medium text-[#047857] tabular-nums">
                - {formatRupiah(booking.promoDiscountSnapshot)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[#E2E8F0] pt-2.5">
              <span className="font-semibold text-[#0F172A]">
                Harga Kesepakatan Final
              </span>
              <span className="text-base font-bold text-[#14532D] tabular-nums">
                {formatRupiah(booking.agreedFinalPrice)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-lg bg-[#F8FAFC] p-3.5 sm:grid-cols-3">
              <div>
                <span className="block text-[11px] text-[#64748B]">Booking Fee</span>
                <span className="mt-0.5 block font-semibold text-[#0F172A] tabular-nums">
                  {formatRupiah(booking.bookingFeeAmount)}
                </span>
                <span className="text-[11px] text-[#475569]">
                  {booking.isBookingFeePartOfDp
                    ? 'Termasuk dalam DP'
                    : 'Terpisah dari DP'}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[#64748B]">
                  Kesepakatan Total DP
                </span>
                <span className="mt-0.5 block font-semibold text-[#0F172A] tabular-nums">
                  {formatRupiah(booking.agreedDpTotalAmount)}
                </span>
                <span className="text-[11px] text-[#475569]">
                  {formatPaymentMethod(booking.paymentMethod)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[#64748B]">
                  Total Dana Terverifikasi
                </span>
                <span className="mt-0.5 block font-bold text-[#047857] tabular-nums">
                  {formatRupiah(totalVerifiedPaid)}
                </span>
                <span className="text-[11px] text-[#475569]">
                  Dari pembayaran VERIFIED
                </span>
              </div>
            </div>

            {booking.notes && (
              <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[#475569]">
                <span className="font-semibold text-[#0F172A]">Catatan Booking: </span>
                {booking.notes}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Panel Unit, KPR & Deal */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <div>
              <CardTitle>Status Unit &amp; Entitas Terkait</CardTitle>
              <CardDescription>
                Progres sinkronisasi otomatis unit, KPR, dan Deal.
              </CardDescription>
            </div>
            <UnitStatusBadge status={booking.unitStatus} />
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <p className="font-semibold text-[#0F172A]">
                <span className="font-mono">{booking.unitCode}</span> •{' '}
                {booking.blockNumber.toLowerCase().startsWith('blok')
                  ? booking.blockNumber
                  : `Blok ${booking.blockNumber}`}
              </p>
              <p className="mt-0.5 text-[#475569]">
                {booking.projectName} • {booking.propertyTypeName}
              </p>
            </div>

            {kprApplication && (
              <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-[#1D4ED8]">
                    {kprApplication.referenceNumber}
                  </span>
                  <DomainStatusBadge value={kprApplication.currentStage} />
                </div>
                <p className="mt-1 text-[#1E3A8A]">
                  {kprApplication.bankName} • Tenor {kprApplication.tenorYears} tahun •
                  Plafon{' '}
                  <strong className="tabular-nums">
                    {formatRupiah(
                      kprApplication.approvedLoanAmount ??
                        kprApplication.requestedLoanAmount
                    )}
                  </strong>
                </p>
              </div>
            )}

            {deal && (
              <div className="rounded-lg border border-[#E2E8F0] bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-[#0F172A]">
                    {deal.dealNumber}
                  </span>
                  <DomainStatusBadge value={deal.salesOutcomeStatus} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <DomainStatusBadge value={deal.contractStatus} />
                  <DomainStatusBadge value={deal.settlementStatus} />
                </div>
              </div>
            )}

            {!kprApplication && !deal && (
              <p className="text-xs text-[#64748B]">
                Deal &amp; KPR (khusus metode KPR) akan terbentuk otomatis setelah
                Admin memverifikasi pembayaran Booking Fee hingga lunas (OQ-02).
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bagian Jadwal Tagihan (payment_schedules) */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Jadwal Tagihan Pembayaran</CardTitle>
            <CardDescription>
              Progres pelunasan setiap termin tagihan ke perusahaan.
              {userRole === 'SUPERVISOR'
                ? ' Mode Supervisor: Read-Only.'
                : ' Unggah bukti pembayaran per termin untuk diverifikasi Admin.'}
            </CardDescription>
          </div>
          {canGenerateInstallments && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setInstallmentCount('12');
                setFirstDueDate(todayWib);
                setInstallmentError(null);
                setIsInstallmentOpen(true);
              }}
              leftIcon={<CalendarPlus className="h-3.5 w-3.5" strokeWidth={1.75} />}
            >
              Susun Termin Cash Bertahap
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <EmptyState
              title="Belum ada jadwal tagihan"
              description="Jadwal tagihan akan tampil di sini setelah Booking terbentuk."
            />
          ) : (
            <div className="space-y-3">
              {schedules.map((s) => {
                const progressPct =
                  s.scheduledAmount > 0
                    ? Math.min(
                        100,
                        Math.round((s.verifiedPaidAmount / s.scheduledAmount) * 100)
                      )
                    : 0;
                const scheduleOpen =
                  bookingAcceptsPayments &&
                  s.status !== 'PAID' &&
                  s.status !== 'CANCELLED' &&
                  s.remainingAmount > 0;

                return (
                  <div
                    key={s.id}
                    className="rounded-lg border border-[#E2E8F0] bg-white p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[#0F172A]">
                            {s.title}
                          </span>
                          <DomainStatusBadge value={s.status} />
                        </div>
                        <p className="text-xs text-[#64748B]">
                          Jatuh Tempo: {formatDateID(s.dueDate)}
                          {s.paidAt ? ` • Lunas pada ${formatDateTimeID(s.paidAt)}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        <div className="text-left sm:text-right">
                          <p className="text-xs text-[#64748B]">
                            Terverifikasi{' '}
                            <span className="font-semibold text-[#047857] tabular-nums">
                              {formatRupiah(s.verifiedPaidAmount)}
                            </span>{' '}
                            /{' '}
                            <span className="font-semibold text-[#0F172A] tabular-nums">
                              {formatRupiah(s.scheduledAmount)}
                            </span>
                          </p>
                          <p className="text-[11px] text-[#475569] tabular-nums">
                            Sisa tagihan:{' '}
                            <strong className="text-[#0F172A]">
                              {formatRupiah(s.remainingAmount)}
                            </strong>
                          </p>
                        </div>

                        {canUploadProof && scheduleOpen && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() =>
                              setUploadTarget({
                                schedule: {
                                  id: s.id,
                                  title: s.title,
                                  scheduledAmount: s.scheduledAmount,
                                  verifiedPaidAmount: s.verifiedPaidAmount,
                                  remainingAmount: s.remainingAmount,
                                },
                                replacesPayment: null,
                              })
                            }
                            leftIcon={
                              <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                            }
                          >
                            Unggah Bukti
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                      <div
                        className={`h-full rounded-full transition-all ${
                          s.status === 'OVERDUE'
                            ? 'bg-[#DC2626]'
                            : s.status === 'PAID'
                              ? 'bg-[#059669]'
                              : 'bg-[#14532D]'
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bagian Riwayat Pembayaran Aktual (payment_records) */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Riwayat Bukti Pembayaran</CardTitle>
            <CardDescription>
              Catatan pembayaran bersifat permanen (immutable). Bukti yang ditolak
              dapat digantikan dengan bukti revisi baru.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <EmptyState
              title="Belum ada bukti pembayaran diunggah"
              description="Gunakan tombol Unggah Bukti pada jadwal tagihan di atas untuk mengirim bukti transfer konsumen."
            />
          ) : (
            <div className="space-y-3">
              {payments.map((p) => {
                const sla = classifyPaymentSla({
                  verificationStatus: p.verificationStatus,
                  submittedAt: p.submittedAt,
                  bookingStatus: booking.status,
                  bookingExpiresAt: booking.expiresAt,
                  nowMs: referenceNowMs,
                });
                const canUploadReplacement =
                  canUploadProof &&
                  p.verificationStatus === 'REJECTED' &&
                  !p.hasActiveOrVerifiedReplacement &&
                  bookingAcceptsPayments &&
                  p.scheduleStatus !== 'PAID' &&
                  p.scheduleStatus !== 'CANCELLED' &&
                  p.scheduleRemainingAmount > 0;

                return (
                  <div
                    key={p.id}
                    className="rounded-lg border border-[#E2E8F0] bg-white p-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#0F172A]">
                            {p.referenceNumber}
                          </span>
                          <DomainStatusBadge value={p.verificationStatus} />
                          {sla.level === 'ESCALATION_48H' && (
                            <Badge
                              tone="red"
                              icon={
                                <ShieldAlert
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.75}
                                />
                              }
                            >
                              ESKALASI &gt; 48J ({sla.hoursWaiting}j)
                            </Badge>
                          )}
                          {sla.level === 'SLA_24H' && (
                            <Badge
                              tone="amber"
                              icon={
                                <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                              }
                            >
                              SLA &gt; 24J ({sla.hoursWaiting}j)
                            </Badge>
                          )}
                          {p.replacesPaymentRef && (
                            <Badge
                              tone="blue"
                              icon={
                                <RefreshCw
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.75}
                                />
                              }
                            >
                              Menggantikan {p.replacesPaymentRef}
                            </Badge>
                          )}
                          {p.replacedByRef && (
                            <Badge tone="slate">
                              Digantikan oleh {p.replacedByRef}
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-[#0F172A]">
                          <span className="font-semibold">{p.scheduleTitle}</span> •{' '}
                          <span className="font-bold text-[#14532D] tabular-nums">
                            {formatRupiah(p.paidAmount)}
                          </span>
                        </p>

                        <p className="text-[11px] text-[#64748B]">
                          Tgl Bayar: {formatDateID(p.paymentDate)} • Kanal:{' '}
                          {p.paymentChannel} • Diunggah oleh {p.submittedByName} (
                          {formatDateTimeID(p.submittedAt)})
                        </p>

                        {p.salesNotes && (
                          <p className="text-xs text-[#475569]">
                            Catatan Sales: {p.salesNotes}
                          </p>
                        )}

                        {p.verificationStatus !== 'PENDING_VERIFICATION' && (
                          <div
                            className={`mt-1.5 rounded-md px-3 py-2 text-xs ${
                              p.verificationStatus === 'REJECTED'
                                ? 'border border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                                : 'border border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]'
                            }`}
                          >
                            <span className="font-semibold">
                              {p.verificationStatus === 'REJECTED'
                                ? 'Alasan Penolakan: '
                                : 'Diverifikasi Admin: '}
                            </span>
                            {p.verificationNotes ?? 'Terverifikasi'}
                            {p.verifiedByName && (
                              <span className="ml-1 opacity-80">
                                ({p.verifiedByName} •{' '}
                                {formatDateTimeID(p.verifiedAt)})
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openPaymentModal(p)}
                          leftIcon={
                            <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                          }
                        >
                          Pratinjau
                        </Button>
                        <DownloadDocumentButton
                          filePath={p.proofFilePath}
                          fileName={p.proofFileName}
                        />
                        {isAdmin &&
                          p.verificationStatus === 'PENDING_VERIFICATION' && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => openPaymentModal(p)}
                              leftIcon={
                                <CheckCircle2
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.75}
                                />
                              }
                            >
                              Verifikasi / Tolak
                            </Button>
                          )}
                        {canUploadReplacement && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setUploadTarget({
                                schedule: {
                                  id: p.paymentScheduleId,
                                  title: p.scheduleTitle,
                                  scheduledAmount: p.scheduledAmount,
                                  verifiedPaidAmount:
                                    p.scheduledAmount - p.scheduleRemainingAmount,
                                  remainingAmount: p.scheduleRemainingAmount,
                                },
                                replacesPayment: {
                                  id: p.id,
                                  referenceNumber: p.referenceNumber,
                                  paidAmount: p.paidAmount,
                                  verificationNotes: p.verificationNotes,
                                },
                              })
                            }
                            leftIcon={
                              <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                            }
                          >
                            Unggah Bukti Pengganti
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grid Bawah: Pengembalian Dana (Refund) & Riwayat Perpanjangan Hold */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Refund Transactions */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Pengembalian Dana (Refund)</CardTitle>
              <CardDescription>
                Catatan pencairan dana pengembalian pembatalan (PD-04).
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {refunds.length === 0 ? (
              <EmptyState
                title="Tidak ada transaksi refund"
                description="Transaksi refund akan muncul otomatis bila pembatalan transaksi disetujui dengan pengembalian dana."
              />
            ) : (
              <div className="space-y-3">
                {refunds.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-bold text-[#0F172A]">
                        {r.referenceNumber}
                      </span>
                      <DomainStatusBadge value={r.status} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[#64748B]">Nominal Refund</span>
                      <span className="text-sm font-bold text-[#0F172A] tabular-nums">
                        {formatRupiah(r.refundAmount)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#64748B]">
                      Metode: {r.refundMethod} • Diproses: {r.processedByName}
                      {r.refundDate
                        ? ` • Tgl Transfer: ${formatDateID(r.refundDate)}`
                        : ''}
                    </p>
                    {r.notes && (
                      <p className="mt-1.5 text-[#475569]">{r.notes}</p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {r.proofFilePath && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPreviewDoc({
                                filePath: r.proofFilePath!,
                                fileName: `${r.referenceNumber}-bukti-refund.pdf`,
                                title: `Bukti Refund • ${r.referenceNumber}`,
                              })
                            }
                            leftIcon={
                              <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                            }
                          >
                            Pratinjau Bukti
                          </Button>
                          <DownloadDocumentButton
                            filePath={r.proofFilePath}
                            fileName={`${r.referenceNumber}-bukti-refund`}
                          />
                        </>
                      )}
                      {isAdmin && r.status === 'PENDING_REFUND' && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() =>
                            setRefundTarget({
                              id: r.id,
                              referenceNumber: r.referenceNumber,
                              bookingId: booking.id,
                              bookingReference: booking.referenceNumber,
                              refundAmount: r.refundAmount,
                              refundMethod: r.refundMethod,
                              prospectName: booking.leadFullName,
                              unitCode: booking.unitCode,
                            })
                          }
                          leftIcon={
                            <CheckCircle2
                              className="h-3.5 w-3.5"
                              strokeWidth={1.75}
                            />
                          }
                        >
                          Selesaikan Refund
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Booking Extensions */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Riwayat Perpanjangan Masa Berlaku (OQ-03)</CardTitle>
              <CardDescription>
                Jejak audit perpanjangan batas waktu hold 72 jam oleh Admin.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {extensions.length === 0 ? (
              <EmptyState
                title="Belum ada perpanjangan masa berlaku"
                description="Booking masih menggunakan batas waktu awal 72 jam atau belum pernah diperpanjang."
              />
            ) : (
              <div className="space-y-3">
                {extensions.map((ext) => (
                  <div
                    key={ext.id}
                    className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#0F172A]">
                        <History className="h-3.5 w-3.5 text-[#14532D]" />
                        {ext.extendedByName}
                      </span>
                      <span className="text-[11px] text-[#64748B]">
                        {formatDateTimeID(ext.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[#475569]">
                      {formatDateTimeID(ext.oldExpiresAt)} &rarr;{' '}
                      <strong className="text-[#0F172A]">
                        {formatDateTimeID(ext.newExpiresAt)}
                      </strong>
                    </p>
                    <p className="mt-1 text-[#0F172A]">Alasan: {ext.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal 1: Unggah Bukti Pembayaran / Pengganti (ADMIN & SALES) */}
      {uploadTarget && (
        <PaymentProofUploadModal
          isOpen={Boolean(uploadTarget)}
          onClose={() => setUploadTarget(null)}
          bookingId={booking.id}
          bookingReference={booking.referenceNumber}
          schedule={uploadTarget.schedule}
          defaultPaymentDate={todayWib}
          replacesPayment={uploadTarget.replacesPayment}
        />
      )}

      {/* Modal 2: Split Modal Pratinjau & Verifikasi Pembayaran */}
      {verificationTarget && (
        <PaymentVerificationModal
          isOpen={Boolean(verificationTarget)}
          onClose={() => setVerificationTarget(null)}
          userRole={userRole}
          payment={verificationTarget}
          referenceNowMs={referenceNowMs}
        />
      )}

      {/* Modal 3: Pratinjau Bukti Refund */}
      {previewDoc && (
        <DocumentPreviewModal
          isOpen={Boolean(previewDoc)}
          onClose={() => setPreviewDoc(null)}
          filePath={previewDoc.filePath}
          fileName={previewDoc.fileName}
          title={previewDoc.title}
        />
      )}

      {/* Modal 4: Selesaikan Refund (ADMIN ONLY) */}
      {refundTarget && (
        <RefundCompletionModal
          isOpen={Boolean(refundTarget)}
          onClose={() => setRefundTarget(null)}
          refund={refundTarget}
          defaultRefundDate={todayWib}
        />
      )}

      {/* Modal 5: Perpanjang Masa Berlaku Booking (ADMIN ONLY) */}
      <Modal
        isOpen={isExtendOpen}
        onClose={() => setIsExtendOpen(false)}
        isDismissDisabled={isExtending}
        title="Perpanjang Masa Berlaku Booking (OQ-03)"
        description={`${booking.referenceNumber} • Batas saat ini ${formatDateTimeID(booking.expiresAt)}`}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsExtendOpen(false)}
              disabled={isExtending}
            >
              Batal
            </Button>
            <Button
              type="submit"
              form="extend-booking-form"
              variant="primary"
              isLoading={isExtending}
            >
              Simpan Perpanjangan
            </Button>
          </>
        }
      >
        <form
          id="extend-booking-form"
          onSubmit={handleExtendSubmit}
          className="space-y-4"
        >
          <Input
            label="Tambahan Durasi (Jam, 1–168)"
            type="number"
            min={1}
            max={168}
            required
            value={additionalHours}
            onChange={(e) => setAdditionalHours(e.target.value)}
            helperText="Maksimal 168 jam (7 hari) per perpanjangan."
            disabled={isExtending}
          />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
              Alasan Perpanjangan (Wajib, min. 10 karakter)
            </label>
            <textarea
              rows={3}
              required
              minLength={10}
              maxLength={500}
              value={extendReason}
              onChange={(e) => setExtendReason(e.target.value)}
              disabled={isExtending}
              placeholder="Misal: Konsumen meminta waktu tambahan 24 jam karena limit transfer harian bank."
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none disabled:bg-[#F8FAFC]"
            />
          </div>
          {extendError && (
            <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
              {extendError}
            </div>
          )}
        </form>
      </Modal>

      {/* Modal 6: Susun Termin Cash Bertahap (ADMIN ONLY) */}
      <Modal
        isOpen={isInstallmentOpen}
        onClose={() => setIsInstallmentOpen(false)}
        isDismissDisabled={isGeneratingInstallments}
        title="Susun Termin Cash Bertahap"
        description={`${booking.referenceNumber} • Harga Final ${formatRupiah(booking.agreedFinalPrice)}`}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsInstallmentOpen(false)}
              disabled={isGeneratingInstallments}
            >
              Batal
            </Button>
            <Button
              type="submit"
              form="generate-installments-form"
              variant="primary"
              isLoading={isGeneratingInstallments}
            >
              Buat Jadwal Termin
            </Button>
          </>
        }
      >
        <form
          id="generate-installments-form"
          onSubmit={handleInstallmentSubmit}
          className="space-y-4"
        >
          <Input
            label="Jumlah Termin Bulanan (2–60)"
            type="number"
            min={2}
            max={60}
            required
            value={installmentCount}
            onChange={(e) => setInstallmentCount(e.target.value)}
            disabled={isGeneratingInstallments}
          />
          <Input
            label="Tanggal Jatuh Tempo Termin Pertama"
            type="date"
            required
            value={firstDueDate}
            onChange={(e) => setFirstDueDate(e.target.value)}
            disabled={isGeneratingInstallments}
          />
          {installmentError && (
            <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
              {installmentError}
            </div>
          )}
        </form>
      </Modal>

      {/* Modal 7: Batalkan Transaksi (ADMIN ONLY — TX-06) */}
      <Modal
        isOpen={isCancelOpen}
        onClose={() => setIsCancelOpen(false)}
        isDismissDisabled={isCancelling}
        title={`Batalkan Transaksi • ${booking.referenceNumber}`}
        description="Unit akan dikembalikan menjadi AVAILABLE setelah pembatalan disahkan."
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCancelOpen(false)}
              disabled={isCancelling}
            >
              Tutup
            </Button>
            <Button
              type="submit"
              form="cancel-booking-form"
              variant="destructive"
              isLoading={isCancelling}
              disabled={hasPendingVerification}
            >
              Sahkan Pembatalan
            </Button>
          </>
        }
      >
        <form
          id="cancel-booking-form"
          onSubmit={handleCancelSubmit}
          className="space-y-4"
        >
          {hasPendingVerification && (
            <div className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#B45309]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>
                Terdapat bukti pembayaran berstatus{' '}
                <strong>PENDING_VERIFICATION</strong>. Verifikasi atau tolak bukti
                tersebut terlebih dahulu sebelum membatalkan transaksi (TX-06).
              </span>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
            <span className="text-[#64748B]">Total Dana Terverifikasi Masuk</span>
            <span className="text-sm font-bold text-[#0F172A] tabular-nums">
              {formatRupiah(totalVerifiedPaid)}
            </span>
          </div>

          <Select
            label="Kebijakan Resolusi Dana"
            options={allowedPolicies.map((p) => ({
              value: p,
              label: REFUND_POLICY_LABELS[p],
            }))}
            value={refundPolicyType}
            onChange={(e) => handlePolicyChange(e.target.value as RefundPolicy)}
            disabled={isCancelling}
          />

          <CurrencyInput
            label="Nominal Dana Dikembalikan / Refund (Rp)"
            min={0}
            max={totalVerifiedPaid}
            value={agreedRefundAmount}
            onValueChange={setAgreedRefundAmount}
            disabled={isCancelling || refundPolicyType !== 'PARTIAL_REFUND'}
            helperText={
              refundPolicyType === 'PARTIAL_REFUND'
                ? `Masukkan nilai di antara Rp 1 s.d. ${formatRupiah(Math.max(1, totalVerifiedPaid - 1))}`
                : 'Otomatis disesuaikan oleh kebijakan yang dipilih.'
            }
          />

          <Input
            label="Alasan Pembatalan (Wajib, min. 5 karakter)"
            required
            minLength={5}
            maxLength={150}
            value={cancellationReason}
            onChange={(e) => setCancellationReason(e.target.value)}
            placeholder="Misal: Konsumen membatalkan karena pindah tugas luar kota."
            disabled={isCancelling}
          />

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
              Catatan Tambahan (Opsional)
            </label>
            <textarea
              rows={2}
              maxLength={1000}
              value={cancelNotes}
              onChange={(e) => setCancelNotes(e.target.value)}
              disabled={isCancelling}
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none disabled:bg-[#F8FAFC]"
            />
          </div>

          {cancelError && (
            <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
              {cancelError}
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}
