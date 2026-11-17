// Lokasi: src/components/payments/PaymentsWorkspaceClient.tsx
// Client Workspace Pusat Pembayaran, Verifikasi SLA 24/48 Jam & Refund (/payments)

'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  Receipt,
  Search,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import type {
  BookingStatus,
  PaymentMethod,
  PaymentVerificationStatus,
  RefundStatus,
  ScheduleStatus,
  ScheduleType,
  SystemRole,
} from '@/types/database.types';
import { formatDateID, formatDateTimeID, formatRupiah } from '@/lib/utils/format';
import {
  classifyPaymentSla,
  getJakartaTodayDateString,
} from '@/lib/utils/transactions-ui';
import { Badge, DomainStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { KpiCard } from '@/components/ui/KpiCard';
import { Select } from '@/components/ui/Select';
import { DownloadDocumentButton } from '@/components/transactions/DownloadDocumentButton';
import type { UploadScheduleTarget } from '@/components/transactions/PaymentProofUploadModal';
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

export interface PaymentsWorkspaceRecordDto {
  id: string;
  referenceNumber: string;
  bookingId: string;
  bookingReference: string;
  bookingStatus: BookingStatus;
  bookingExpiresAt: string;
  paymentMethod: PaymentMethod;
  prospectName: string;
  unitCode: string;
  projectName: string;
  scheduleId: string;
  scheduleTitle: string;
  scheduleType: ScheduleType;
  scheduledAmount: number;
  scheduleRemainingAmount: number;
  paidAmount: number;
  paymentDate: string;
  paymentChannel: string;
  proofFilePath: string;
  proofFileName: string;
  replacesPaymentRef: string | null;
  verificationStatus: PaymentVerificationStatus;
  submittedAt: string;
  submittedByName: string;
  salesNotes: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
}

export interface PaymentsWorkspaceScheduleDto {
  id: string;
  bookingId: string;
  bookingReference: string;
  bookingStatus: BookingStatus;
  prospectName: string;
  unitCode: string;
  projectName: string;
  scheduleType: ScheduleType;
  installmentNumber: number;
  title: string;
  scheduledAmount: number;
  verifiedPaidAmount: number;
  remainingAmount: number;
  dueDate: string;
  status: ScheduleStatus;
}

export interface PaymentsWorkspaceRefundDto {
  id: string;
  referenceNumber: string;
  bookingId: string;
  bookingReference: string;
  prospectName: string;
  unitCode: string;
  refundAmount: number;
  refundDate: string | null;
  refundMethod: string;
  proofFilePath: string | null;
  status: RefundStatus;
  processedByName: string;
  notes: string | null;
  createdAt: string;
}

export interface PaymentsWorkspaceClientProps {
  userRole: SystemRole;
  records: PaymentsWorkspaceRecordDto[];
  schedules: PaymentsWorkspaceScheduleDto[];
  refunds: PaymentsWorkspaceRefundDto[];
  referenceNowMs: number;
}

type PaymentsTab = 'VERIFICATION' | 'SCHEDULES' | 'REFUNDS';

const RECORD_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Semua Status Verifikasi' },
  { value: 'PENDING_VERIFICATION', label: 'PENDING VERIFICATION' },
  { value: 'VERIFIED', label: 'VERIFIED' },
  { value: 'REJECTED', label: 'REJECTED' },
];

const SCHEDULE_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Semua Status Tagihan' },
  { value: 'OVERDUE', label: 'OVERDUE (Menunggak)' },
  { value: 'UNPAID', label: 'UNPAID' },
  { value: 'PARTIALLY_PAID', label: 'PARTIALLY PAID' },
  { value: 'PAID', label: 'PAID (Lunas)' },
];

const SCHEDULE_TYPE_OPTIONS = [
  { value: 'ALL', label: 'Semua Jenis Termin' },
  { value: 'BOOKING_FEE', label: 'Booking Fee' },
  { value: 'DOWN_PAYMENT', label: 'Uang Muka (DP)' },
  { value: 'INSTALLMENT', label: 'Cicilan Cash Bertahap' },
  { value: 'FINAL_SETTLEMENT', label: 'Pelunasan Cash Keras' },
  { value: 'KPR_TOPUP_DP', label: 'Top-up DP KPR' },
];

export function PaymentsWorkspaceClient({
  userRole,
  records,
  schedules,
  refunds,
  referenceNowMs,
}: PaymentsWorkspaceClientProps) {
  const isAdmin = userRole === 'ADMIN';
  const canUploadProof = userRole === 'ADMIN' || userRole === 'SALES';
  const todayWib = getJakartaTodayDateString(referenceNowMs);

  const [activeTab, setActiveTab] = useState<PaymentsTab>('VERIFICATION');

  // Filter Tab 1: Verifikasi
  const [recordSearch, setRecordSearch] = useState('');
  const [recordStatusFilter, setRecordStatusFilter] = useState('ALL');

  // Filter Tab 2: Jadwal Tagihan
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState('ALL');
  const [scheduleTypeFilter, setScheduleTypeFilter] = useState('ALL');

  // Modals
  const [verificationTarget, setVerificationTarget] =
    useState<PaymentVerificationTarget | null>(null);
  const [uploadTarget, setUploadTarget] = useState<{
    bookingId: string;
    bookingReference: string;
    schedule: UploadScheduleTarget;
  } | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{
    filePath: string;
    fileName: string;
    title: string;
  } | null>(null);
  const [refundTarget, setRefundTarget] =
    useState<RefundCompletionTarget | null>(null);

  // KPI Metrics
  const kpi = useMemo(() => {
    let pendingCount = 0;
    let sla24Count = 0;
    let escalation48Count = 0;

    for (const r of records) {
      if (r.verificationStatus === 'PENDING_VERIFICATION') {
        pendingCount += 1;
        const sla = classifyPaymentSla({
          verificationStatus: r.verificationStatus,
          submittedAt: r.submittedAt,
          bookingStatus: r.bookingStatus,
          bookingExpiresAt: r.bookingExpiresAt,
          nowMs: referenceNowMs,
        });
        if (sla.level === 'ESCALATION_48H') escalation48Count += 1;
        else if (sla.level === 'SLA_24H') sla24Count += 1;
      }
    }

    let overdueSchedulesCount = 0;
    let overdueNominal = 0;
    for (const s of schedules) {
      if (s.status === 'OVERDUE') {
        overdueSchedulesCount += 1;
        overdueNominal += s.remainingAmount;
      }
    }

    let pendingRefundCount = 0;
    let pendingRefundNominal = 0;
    for (const rf of refunds) {
      if (rf.status === 'PENDING_REFUND') {
        pendingRefundCount += 1;
        pendingRefundNominal += rf.refundAmount;
      }
    }

    return {
      pendingCount,
      sla24Count,
      escalation48Count,
      overdueSchedulesCount,
      overdueNominal,
      pendingRefundCount,
      pendingRefundNominal,
    };
  }, [records, schedules, refunds, referenceNowMs]);

  const filteredRecords = useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    return records.filter((r) => {
      if (
        recordStatusFilter !== 'ALL' &&
        r.verificationStatus !== recordStatusFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        r.referenceNumber.toLowerCase().includes(q) ||
        r.bookingReference.toLowerCase().includes(q) ||
        r.prospectName.toLowerCase().includes(q) ||
        r.unitCode.toLowerCase().includes(q)
      );
    });
  }, [records, recordSearch, recordStatusFilter]);

  const filteredSchedules = useMemo(() => {
    const q = scheduleSearch.trim().toLowerCase();
    return schedules.filter((s) => {
      if (scheduleStatusFilter !== 'ALL' && s.status !== scheduleStatusFilter) {
        return false;
      }
      if (
        scheduleTypeFilter !== 'ALL' &&
        s.scheduleType !== scheduleTypeFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        s.bookingReference.toLowerCase().includes(q) ||
        s.prospectName.toLowerCase().includes(q) ||
        s.unitCode.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q)
      );
    });
  }, [schedules, scheduleSearch, scheduleStatusFilter, scheduleTypeFilter]);

  const openVerificationModal = (r: PaymentsWorkspaceRecordDto) => {
    setVerificationTarget({
      id: r.id,
      referenceNumber: r.referenceNumber,
      bookingId: r.bookingId,
      bookingReference: r.bookingReference,
      bookingStatus: r.bookingStatus,
      bookingExpiresAt: r.bookingExpiresAt,
      paymentMethod: r.paymentMethod,
      unitCode: r.unitCode,
      prospectName: r.prospectName,
      scheduleTitle: r.scheduleTitle,
      scheduleType: r.scheduleType,
      scheduledAmount: r.scheduledAmount,
      scheduleRemainingAmount: r.scheduleRemainingAmount,
      paidAmount: r.paidAmount,
      paymentDate: r.paymentDate,
      paymentChannel: r.paymentChannel,
      proofFilePath: r.proofFilePath,
      proofFileName: r.proofFileName,
      verificationStatus: r.verificationStatus,
      submittedAt: r.submittedAt,
      submittedByName: r.submittedByName,
      salesNotes: r.salesNotes,
      verifiedByName: r.verifiedByName,
      verifiedAt: r.verifiedAt,
      verificationNotes: r.verificationNotes,
      replacesPaymentRef: r.replacesPaymentRef,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Pembayaran, Verifikasi &amp; Refund
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Pemantauan SLA verifikasi bukti transfer (24/48 jam), piutang termin,
            dan pencairan pengembalian dana pembatalan.
          </p>
        </div>
        <Link href="/bookings">
          <Button variant="outline" size="sm">
            Daftar Booking &amp; Reservasi
          </Button>
        </Link>
      </div>

      {/* KPI Ringkas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Antrean Verifikasi"
          value={kpi.pendingCount}
          subtext={
            kpi.sla24Count > 0
              ? `${kpi.sla24Count} melewati SLA 24 jam`
              : 'Target SLA verifikasi maksimal 24 jam'
          }
          tone={kpi.pendingCount > 0 ? 'warning' : 'default'}
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Eskalasi > 48 Jam / Hold"
          value={kpi.escalation48Count}
          subtext="Butuh keputusan Admin segera (PD-01)"
          tone={kpi.escalation48Count > 0 ? 'error' : 'success'}
          icon={<ShieldAlert className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Tagihan Pembayaran Konsumen Terlambat"
          value={kpi.overdueSchedulesCount}
          subtext={`Total tertunggak: ${formatRupiah(kpi.overdueNominal)}`}
          tone={kpi.overdueSchedulesCount > 0 ? 'error' : 'default'}
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Refund Menunggu Cair"
          value={kpi.pendingRefundCount}
          subtext={`Total komitmen: ${formatRupiah(kpi.pendingRefundNominal)}`}
          tone={kpi.pendingRefundCount > 0 ? 'warning' : 'default'}
          icon={<Banknote className="h-4 w-4" strokeWidth={1.75} />}
        />
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-[#E2E8F0] pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('VERIFICATION')}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
            activeTab === 'VERIFICATION'
              ? 'bg-[#14532D] text-white'
              : 'bg-white text-[#475569] ring-1 ring-[#CBD5E1] hover:bg-[#F8FAFC]'
          }`}
        >
          <CreditCard className="h-3.5 w-3.5" strokeWidth={1.75} />
          Verifikasi &amp; Bukti Bayar ({records.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('SCHEDULES')}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
            activeTab === 'SCHEDULES'
              ? 'bg-[#14532D] text-white'
              : 'bg-white text-[#475569] ring-1 ring-[#CBD5E1] hover:bg-[#F8FAFC]'
          }`}
        >
          <Receipt className="h-3.5 w-3.5" strokeWidth={1.75} />
          Jadwal Tagihan &amp; Sisa Tagihan Pembayaran Konsumen ({schedules.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('REFUNDS')}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
            activeTab === 'REFUNDS'
              ? 'bg-[#14532D] text-white'
              : 'bg-white text-[#475569] ring-1 ring-[#CBD5E1] hover:bg-[#F8FAFC]'
          }`}
        >
          <Banknote className="h-3.5 w-3.5" strokeWidth={1.75} />
          Pengembalian Dana ({refunds.length})
        </button>
      </div>

      {/* TAB 1: Verifikasi & Bukti Bayar */}
      {activeTab === 'VERIFICATION' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="relative md:col-span-8">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
                    strokeWidth={1.75}
                  />
                  <Input
                    value={recordSearch}
                    onChange={(e) => setRecordSearch(e.target.value)}
                    placeholder="Cari kode PAY-..., BK-..., nama prospek, atau kode unit..."
                    className="pl-9"
                  />
                </div>
                <div className="md:col-span-4">
                  <Select
                    options={RECORD_STATUS_OPTIONS}
                    value={recordStatusFilter}
                    onChange={(e) => setRecordStatusFilter(e.target.value)}
                    aria-label="Filter status verifikasi"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {filteredRecords.length === 0 ? (
            <EmptyState
              title="Tidak ada bukti pembayaran ditemukan"
              description="Coba ubah filter status verifikasi atau kata kunci pencarian."
            />
          ) : (
            <>
              {/* Desktop Table */}
              <Card className="hidden overflow-hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wide text-[#64748B] uppercase">
                        <th className="px-4 py-3">Kode Bayar</th>
                        <th className="px-4 py-3">Booking &amp; Prospek</th>
                        <th className="px-4 py-3">Termin</th>
                        <th className="px-4 py-3 text-right">Nominal</th>
                        <th className="px-4 py-3">Status &amp; SLA</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] text-xs">
                      {filteredRecords.map((r) => {
                        const sla = classifyPaymentSla({
                          verificationStatus: r.verificationStatus,
                          submittedAt: r.submittedAt,
                          bookingStatus: r.bookingStatus,
                          bookingExpiresAt: r.bookingExpiresAt,
                          nowMs: referenceNowMs,
                        });
                        return (
                          <tr
                            key={r.id}
                            className="transition-colors hover:bg-[#F8FAFC]"
                          >
                            <td className="px-4 py-3.5 align-top whitespace-nowrap">
                              <span className="font-mono font-semibold text-[#0F172A]">
                                {r.referenceNumber}
                              </span>
                              <p className="mt-0.5 text-[11px] text-[#64748B]">
                                {formatDateTimeID(r.submittedAt)}
                              </p>
                            </td>
                            <td className="px-4 py-3.5 align-top">
                              <Link
                                href={`/bookings/${r.bookingId}`}
                                className="font-mono font-semibold whitespace-nowrap text-[#14532D] hover:underline"
                              >
                                {r.bookingReference}
                              </Link>
                              <p className="mt-0.5 font-medium text-[#0F172A]">
                                {r.prospectName}
                              </p>
                              <p className="text-[11px] text-[#64748B]">
                                <span className="font-mono">{r.unitCode}</span> •{' '}
                                {r.projectName}
                              </p>
                            </td>
                            <td className="px-4 py-3.5 align-top">
                              <p className="font-medium text-[#0F172A]">
                                {r.scheduleTitle}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[#64748B]">
                                Tgl Bayar: {formatDateID(r.paymentDate)} •{' '}
                                {r.paymentChannel}
                              </p>
                            </td>
                            <td className="px-4 py-3.5 text-right align-top font-semibold whitespace-nowrap text-[#0F172A] tabular-nums">
                              {formatRupiah(r.paidAmount)}
                            </td>
                            <td className="px-4 py-3.5 align-top">
                              <div className="flex flex-col items-start gap-1">
                                <DomainStatusBadge value={r.verificationStatus} />
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
                                      <Clock
                                        className="h-3.5 w-3.5"
                                        strokeWidth={1.75}
                                      />
                                    }
                                  >
                                    SLA &gt; 24J ({sla.hoursWaiting}j)
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right align-top">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openVerificationModal(r)}
                                  leftIcon={
                                    <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                                  }
                                >
                                  Pratinjau
                                </Button>
                                <DownloadDocumentButton
                                  filePath={r.proofFilePath}
                                  fileName={r.proofFileName}
                                />
                                {isAdmin &&
                                  r.verificationStatus ===
                                    'PENDING_VERIFICATION' && (
                                    <Button
                                      size="sm"
                                      variant="primary"
                                      onClick={() => openVerificationModal(r)}
                                      leftIcon={
                                        <CheckCircle2
                                          className="h-3.5 w-3.5"
                                          strokeWidth={1.75}
                                        />
                                      }
                                    >
                                      Verifikasi
                                    </Button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Mobile Cards */}
              <div className="space-y-3 md:hidden">
                {filteredRecords.map((r) => {
                  const sla = classifyPaymentSla({
                    verificationStatus: r.verificationStatus,
                    submittedAt: r.submittedAt,
                    bookingStatus: r.bookingStatus,
                    bookingExpiresAt: r.bookingExpiresAt,
                    nowMs: referenceNowMs,
                  });
                  return (
                    <Card key={r.id}>
                      <CardContent className="space-y-3 p-4 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-mono font-bold text-[#0F172A]">
                              {r.referenceNumber}
                            </span>
                            <p className="mt-0.5 font-semibold text-[#0F172A]">
                              {r.prospectName}
                            </p>
                            <Link
                              href={`/bookings/${r.bookingId}`}
                              className="font-mono text-[11px] font-medium text-[#14532D] hover:underline"
                            >
                              {r.bookingReference} • {r.unitCode}
                            </Link>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <DomainStatusBadge value={r.verificationStatus} />
                            {sla.level === 'ESCALATION_48H' && (
                              <Badge tone="red">ESKALASI &gt; 48J</Badge>
                            )}
                            {sla.level === 'SLA_24H' && (
                              <Badge tone="amber">SLA &gt; 24J</Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between rounded bg-[#F8FAFC] p-2.5">
                          <span className="text-[#475569]">{r.scheduleTitle}</span>
                          <span className="font-bold text-[#14532D] tabular-nums">
                            {formatRupiah(r.paidAmount)}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openVerificationModal(r)}
                            leftIcon={
                              <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                            }
                          >
                            Pratinjau
                          </Button>
                          <DownloadDocumentButton
                            filePath={r.proofFilePath}
                            fileName={r.proofFileName}
                          />
                          {isAdmin &&
                            r.verificationStatus === 'PENDING_VERIFICATION' && (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => openVerificationModal(r)}
                              >
                                Verifikasi
                              </Button>
                            )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: Jadwal Tagihan & Sisa Tagihan Konsumen */}
      {activeTab === 'SCHEDULES' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="relative md:col-span-6">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
                    strokeWidth={1.75}
                  />
                  <Input
                    value={scheduleSearch}
                    onChange={(e) => setScheduleSearch(e.target.value)}
                    placeholder="Cari BK-..., nama prospek, kode unit, atau judul termin..."
                    className="pl-9"
                  />
                </div>
                <div className="md:col-span-3">
                  <Select
                    options={SCHEDULE_STATUS_OPTIONS}
                    value={scheduleStatusFilter}
                    onChange={(e) => setScheduleStatusFilter(e.target.value)}
                    aria-label="Filter status tagihan"
                  />
                </div>
                <div className="md:col-span-3">
                  <Select
                    options={SCHEDULE_TYPE_OPTIONS}
                    value={scheduleTypeFilter}
                    onChange={(e) => setScheduleTypeFilter(e.target.value)}
                    aria-label="Filter jenis termin"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {filteredSchedules.length === 0 ? (
            <EmptyState
              title="Tidak ada jadwal tagihan ditemukan"
              description="Coba ubah filter status tagihan atau kata kunci pencarian."
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wide text-[#64748B] uppercase">
                      <th className="px-4 py-3">Booking &amp; Prospek</th>
                      <th className="px-4 py-3">Termin Tagihan</th>
                      <th className="px-4 py-3">Jatuh Tempo</th>
                      <th className="px-4 py-3 text-right">Total Tagihan</th>
                      <th className="px-4 py-3 text-right">Sisa Tagihan</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] text-xs">
                    {filteredSchedules.map((s) => {
                      const canQuickUpload =
                        canUploadProof &&
                        (s.bookingStatus === 'PENDING_FEE' ||
                          s.bookingStatus === 'ACTIVE') &&
                        s.status !== 'PAID' &&
                        s.status !== 'CANCELLED' &&
                        s.remainingAmount > 0;

                      return (
                        <tr
                          key={s.id}
                          className="transition-colors hover:bg-[#F8FAFC]"
                        >
                          <td className="px-4 py-3.5 align-top">
                            <Link
                              href={`/bookings/${s.bookingId}`}
                              className="font-mono font-semibold whitespace-nowrap text-[#14532D] hover:underline"
                            >
                              {s.bookingReference}
                            </Link>
                            <p className="mt-0.5 font-medium text-[#0F172A]">
                              {s.prospectName}
                            </p>
                            <p className="text-[11px] text-[#64748B]">
                              <span className="font-mono">{s.unitCode}</span> •{' '}
                              {s.projectName}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 align-top">
                            <p className="font-medium text-[#0F172A]">{s.title}</p>
                            <p className="mt-0.5 text-[11px] text-[#64748B]">
                              {s.scheduleType.replace(/_/g, ' ')} • Ke-
                              {s.installmentNumber}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 align-top whitespace-nowrap text-[#475569]">
                            {formatDateID(s.dueDate)}
                          </td>
                          <td className="px-4 py-3.5 text-right align-top font-medium whitespace-nowrap text-[#0F172A] tabular-nums">
                            {formatRupiah(s.scheduledAmount)}
                          </td>
                          <td className="px-4 py-3.5 text-right align-top font-bold whitespace-nowrap text-[#0F172A] tabular-nums">
                            {formatRupiah(s.remainingAmount)}
                          </td>
                          <td className="px-4 py-3.5 align-top">
                            <DomainStatusBadge value={s.status} />
                          </td>
                          <td className="px-4 py-3.5 text-right align-top">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {canQuickUpload && (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() =>
                                    setUploadTarget({
                                      bookingId: s.bookingId,
                                      bookingReference: s.bookingReference,
                                      schedule: {
                                        id: s.id,
                                        title: s.title,
                                        scheduledAmount: s.scheduledAmount,
                                        verifiedPaidAmount: s.verifiedPaidAmount,
                                        remainingAmount: s.remainingAmount,
                                      },
                                    })
                                  }
                                  leftIcon={
                                    <Upload
                                      className="h-3.5 w-3.5"
                                      strokeWidth={1.75}
                                    />
                                  }
                                >
                                  Unggah Bukti
                                </Button>
                              )}
                              <Link href={`/bookings/${s.bookingId}`}>
                                <Button size="sm" variant="outline">
                                  Detail
                                </Button>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* TAB 3: Pengembalian Dana (Refund) */}
      {activeTab === 'REFUNDS' && (
        <div className="space-y-4">
          {refunds.length === 0 ? (
            <EmptyState
              title="Belum ada transaksi pengembalian dana"
              description="Transaksi pengembalian dana (REF-...) akan tampil di sini apabila ada pembatalan booking dengan refund."
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wide text-[#64748B] uppercase">
                      <th className="px-4 py-3">Kode Refund</th>
                      <th className="px-4 py-3">Booking &amp; Prospek</th>
                      <th className="px-4 py-3 text-right">Nominal Refund</th>
                      <th className="px-4 py-3">Metode &amp; Tanggal</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] text-xs">
                    {refunds.map((rf) => (
                      <tr
                        key={rf.id}
                        className="transition-colors hover:bg-[#F8FAFC]"
                      >
                        <td className="px-4 py-3.5 align-top whitespace-nowrap">
                          <span className="font-mono font-semibold text-[#0F172A]">
                            {rf.referenceNumber}
                          </span>
                          <p className="mt-0.5 text-[11px] text-[#64748B]">
                            Dibuat: {formatDateID(rf.createdAt)}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          <Link
                            href={`/bookings/${rf.bookingId}`}
                            className="font-mono font-semibold whitespace-nowrap text-[#14532D] hover:underline"
                          >
                            {rf.bookingReference}
                          </Link>
                          <p className="mt-0.5 font-medium text-[#0F172A]">
                            {rf.prospectName}
                          </p>
                          <p className="text-[11px] text-[#64748B]">
                            Unit <span className="font-mono">{rf.unitCode}</span>
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-right align-top font-bold whitespace-nowrap text-[#0F172A] tabular-nums">
                          {formatRupiah(rf.refundAmount)}
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          <p className="font-medium text-[#0F172A]">
                            {rf.refundMethod}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#64748B]">
                            {rf.refundDate
                              ? `Cair: ${formatDateID(rf.refundDate)}`
                              : 'Belum ditransfer'}
                          </p>
                          {rf.notes && (
                            <p className="mt-0.5 max-w-xs text-[11px] text-[#475569]">
                              {rf.notes}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          <DomainStatusBadge value={rf.status} />
                        </td>
                        <td className="px-4 py-3.5 text-right align-top">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {rf.proofFilePath && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setPreviewDoc({
                                      filePath: rf.proofFilePath!,
                                      fileName: `${rf.referenceNumber}-bukti-refund.pdf`,
                                      title: `Bukti Refund • ${rf.referenceNumber}`,
                                    })
                                  }
                                  leftIcon={
                                    <Eye
                                      className="h-3.5 w-3.5"
                                      strokeWidth={1.75}
                                    />
                                  }
                                >
                                  Pratinjau
                                </Button>
                                <DownloadDocumentButton
                                  filePath={rf.proofFilePath}
                                  fileName={`${rf.referenceNumber}-bukti-refund`}
                                />
                              </>
                            )}
                            {isAdmin && rf.status === 'PENDING_REFUND' && (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() =>
                                  setRefundTarget({
                                    id: rf.id,
                                    referenceNumber: rf.referenceNumber,
                                    bookingId: rf.bookingId,
                                    bookingReference: rf.bookingReference,
                                    refundAmount: rf.refundAmount,
                                    refundMethod: rf.refundMethod,
                                    prospectName: rf.prospectName,
                                    unitCode: rf.unitCode,
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Split Modal Verifikasi & Pratinjau */}
      {verificationTarget && (
        <PaymentVerificationModal
          isOpen={Boolean(verificationTarget)}
          onClose={() => setVerificationTarget(null)}
          userRole={userRole}
          payment={verificationTarget}
          referenceNowMs={referenceNowMs}
        />
      )}

      {/* Modal Unggah Bukti Pembayaran (ADMIN & SALES) */}
      {uploadTarget && (
        <PaymentProofUploadModal
          isOpen={Boolean(uploadTarget)}
          onClose={() => setUploadTarget(null)}
          bookingId={uploadTarget.bookingId}
          bookingReference={uploadTarget.bookingReference}
          schedule={uploadTarget.schedule}
          defaultPaymentDate={todayWib}
        />
      )}

      {/* Modal Pratinjau Bukti Refund */}
      {previewDoc && (
        <DocumentPreviewModal
          isOpen={Boolean(previewDoc)}
          onClose={() => setPreviewDoc(null)}
          filePath={previewDoc.filePath}
          fileName={previewDoc.fileName}
          title={previewDoc.title}
        />
      )}

      {/* Modal Selesaikan Refund (ADMIN ONLY) */}
      {refundTarget && (
        <RefundCompletionModal
          isOpen={Boolean(refundTarget)}
          onClose={() => setRefundTarget(null)}
          refund={refundTarget}
          defaultRefundDate={todayWib}
        />
      )}
    </div>
  );
}
