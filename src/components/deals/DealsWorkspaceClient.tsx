// Lokasi: src/components/deals/DealsWorkspaceClient.tsx
// Workspace Deals 3 Dimensi, Pratinjau Kontrak PDF, Riwayat & Transisi Status (TX-05)

'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Eye,
  FileCheck2,
  History,
  Search,
  Wallet,
} from 'lucide-react';
import { transitionDealStatusAction } from '@/modules/transactions/transactions.actions';
import type {
  BookingStatus,
  DealContractStatus,
  DealSalesOutcome,
  DealSettlementStatus,
  KprApplicationStatus,
  KprDisbursementStatus,
  KprStage,
  PaymentMethod,
  SystemRole,
  UnitStatus,
} from '@/types/database.types';
import { formatDateID, formatDateTimeID, formatRupiah } from '@/lib/utils/format';
import {
  formatPaymentMethodShort,
  getAllowedDealTransitions,
  validatePdfFileClient,
  type DealTransitionActionType,
} from '@/lib/utils/kpr-deals-ui';
import { Badge, DomainStatusBadge, UnitStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { KpiCard } from '@/components/ui/KpiCard';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/ToastProvider';
import { DownloadDocumentButton } from '@/components/transactions/DownloadDocumentButton';

const DocumentPreviewModal = dynamic(
  () =>
    import('@/components/transactions/DocumentPreviewModal').then(
      (mod) => mod.DocumentPreviewModal
    ),
  { ssr: false }
);

export interface DealHistoryItemDto {
  id: string;
  changedDimension: string;
  oldStatus: string;
  newStatus: string;
  reason: string | null;
  changedByName: string;
  changedAt: string;
}

export interface DealListItemDto {
  id: string;
  referenceNumber: string;
  bookingId: string;
  bookingReferenceNumber: string;
  bookingStatus: BookingStatus;
  leadId: string;
  leadFullName: string;
  unitCode: string;
  unitStatus: UnitStatus;
  projectName: string;
  salesName: string;
  teamCode: string;
  paymentMethod: PaymentMethod;
  finalDealValue: number;
  salesOutcomeStatus: DealSalesOutcome;
  contractStatus: DealContractStatus;
  paymentSettlementStatus: DealSettlementStatus;
  contractDocumentNumber: string | null;
  contractFilePath: string | null;
  contractSignedAt: string | null;
  fullySettledAt: string | null;
  kprApplicationId: string | null;
  kprApplicationStatus: KprApplicationStatus | null;
  kprCurrentStage: KprStage | null;
  kprDisbursementStatus: KprDisbursementStatus | null;
  histories: DealHistoryItemDto[];
}

export interface DealsWorkspaceClientProps {
  userRole: SystemRole;
  deals: DealListItemDto[];
}

const OUTCOME_OPTIONS = [
  { value: 'ALL', label: 'Semua Sales Outcome' },
  { value: 'IN_PROGRESS', label: 'Outcome: IN PROGRESS' },
  { value: 'CLOSED_WON', label: 'Outcome: CLOSED WON' },
  { value: 'CANCELLED_FAILED', label: 'Outcome: CANCELLED FAILED' },
];

const CONTRACT_OPTIONS = [
  { value: 'ALL', label: 'Semua Status Kontrak' },
  { value: 'PRE_CONTRACT', label: 'Kontrak: PRE CONTRACT' },
  { value: 'UNDER_CONTRACT', label: 'Kontrak: UNDER CONTRACT' },
  { value: 'CONTRACT_COMPLETED', label: 'Kontrak: CONTRACT COMPLETED' },
  { value: 'CONTRACT_TERMINATED', label: 'Kontrak: CONTRACT TERMINATED' },
];

const SETTLEMENT_OPTIONS = [
  { value: 'ALL', label: 'Semua Status Pelunasan' },
  { value: 'BOOKING_FEE_SETTLED', label: 'Pelunasan: BOOKING FEE SETTLED' },
  { value: 'DP_SETTLED_ONGOING', label: 'Pelunasan: DP SETTLED ONGOING' },
  { value: 'OVERDUE_IN_ARREARS', label: 'Pelunasan: OVERDUE IN ARREARS' },
  {
    value: 'DISBURSED_RETENTION_PENDING',
    label: 'Pelunasan: DISBURSED RETENTION PENDING',
  },
  { value: 'FULLY_SETTLED', label: 'Pelunasan: FULLY SETTLED' },
  { value: 'TERMINATED', label: 'Pelunasan: TERMINATED' },
];

const METHOD_OPTIONS = [
  { value: 'ALL', label: 'Semua Metode Bayar' },
  { value: 'KPR', label: 'KPR Bank' },
  { value: 'CASH_BERTAHAP', label: 'Cash Bertahap' },
  { value: 'CASH_KERAS', label: 'Cash Keras' },
];

const TRANSITION_LABELS: Record<DealTransitionActionType, string> = {
  ACTIVATE_PPJB_CONTRACT: 'ACTIVATE_PPJB_CONTRACT — Aktivasi PPJB Cash Bertahap (C2)',
  RECORD_KPR_AKAD_COMPLETED: 'RECORD_KPR_AKAD_COMPLETED — Sahkan Akad Kredit KPR',
  FINALIZE_FULL_SETTLEMENT: 'FINALIZE_FULL_SETTLEMENT — Finalisasi Lunas 100% & Unit SOLD',
};

function DealTransitionModalInner({
  deal,
  allowedActions,
  onClose,
}: {
  deal: DealListItemDto;
  allowedActions: DealTransitionActionType[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [action, setAction] = useState<DealTransitionActionType>(
    allowedActions[0] ?? 'FINALIZE_FULL_SETTLEMENT'
  );
  const [contractDocNumber, setContractDocNumber] = useState(
    deal.contractDocumentNumber ?? ''
  );
  const [notaryName, setNotaryName] = useState('');
  const [notes, setNotes] = useState('');
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requiresDocNumber =
    action === 'ACTIVATE_PPJB_CONTRACT' ||
    action === 'RECORD_KPR_AKAD_COMPLETED';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (requiresDocNumber && contractDocNumber.trim().length < 3) {
      setErrorMsg('Nomor dokumen kontrak / akta wajib diisi minimal 3 karakter.');
      return;
    }

    if (contractFile) {
      const pdfErr = validatePdfFileClient(contractFile, { required: false });
      if (pdfErr) {
        setErrorMsg(pdfErr);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('bookingId', deal.bookingId);
      formData.append('dealId', deal.id);
      formData.append('transitionAction', action);
      if (contractDocNumber.trim()) {
        formData.append('contractDocNumber', contractDocNumber.trim());
      }
      if (notaryName.trim()) {
        formData.append('notaryName', notaryName.trim());
      }
      if (notes.trim()) {
        formData.append('notes', notes.trim());
      }
      if (contractFile && contractFile.size > 0) {
        formData.append('contractFile', contractFile);
      }

      const res = await transitionDealStatusAction(formData);
      if (!res.success) {
        showToast({
          tone: 'error',
          title: 'Transisi status Deal gagal',
          description: res.message,
          correlationId: res.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Status Deal diperbarui',
        description: res.message,
      });
      router.refresh();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
        <p className="font-mono font-bold text-[#0F172A]">
          {deal.referenceNumber} • {deal.unitCode}
        </p>
        <p className="mt-0.5 text-[#475569]">
          {deal.leadFullName} ({formatPaymentMethodShort(deal.paymentMethod)})
        </p>
      </div>

      <Select
        label="Aksi Transisi Status (TX-05) *"
        value={action}
        onChange={(e) => {
          setAction(e.target.value as DealTransitionActionType);
          setErrorMsg(null);
        }}
        options={allowedActions.map((a) => ({
          value: a,
          label: TRANSITION_LABELS[a],
        }))}
      />

      {requiresDocNumber && (
        <Input
          label="Nomor Dokumen Kontrak / Akta *"
          placeholder={
            action === 'ACTIVATE_PPJB_CONTRACT'
              ? 'Contoh: PPJB/FIM-BSD/2026/0030'
              : 'Contoh: AKAD-BMRI-2026-0105'
          }
          value={contractDocNumber}
          onChange={(e) => setContractDocNumber(e.target.value)}
          required
        />
      )}

      {action === 'RECORD_KPR_AKAD_COMPLETED' && (
        <Input
          label="Nama Notaris / PPAT (Opsional)"
          placeholder="Contoh: Notaris & PPAT Hj. Ratna Kemala, S.H."
          value={notaryName}
          onChange={(e) => setNotaryName(e.target.value)}
        />
      )}

      <div>
        <label
          htmlFor="deal-contract-pdf-input"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          Unggah Salinan Kontrak (Khusus PDF, Maks. 5 MB — Opsional)
        </label>
        <input
          id="deal-contract-pdf-input"
          type="file"
          accept=".pdf,application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setContractFile(file);
            setErrorMsg(file ? validatePdfFileClient(file) : null);
          }}
          className="block w-full cursor-pointer rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] file:mr-3 file:rounded file:border-0 file:bg-[#F0FDF4] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[#14532D]"
        />
      </div>

      <div>
        <label
          htmlFor="deal-transition-notes"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          Catatan Pengesahan (Opsional)
        </label>
        <textarea
          id="deal-transition-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Keterangan penandatanganan atau finalisasi pelunasan..."
          className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:outline-none"
        />
      </div>

      {errorMsg && (
        <p className="text-xs font-medium text-[#DC2626]">{errorMsg}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" variant="primary" isLoading={isSubmitting}>
          Sahkan Transisi
        </Button>
      </div>
    </form>
  );
}

export function DealsWorkspaceClient({
  userRole,
  deals,
}: DealsWorkspaceClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('ALL');
  const [contractFilter, setContractFilter] = useState('ALL');
  const [settlementFilter, setSettlementFilter] = useState('ALL');
  const [methodFilter, setMethodFilter] = useState('ALL');

  const [previewTarget, setPreviewTarget] = useState<{
    filePath: string;
    fileName: string;
    title: string;
  } | null>(null);
  const [historyDeal, setHistoryDeal] = useState<DealListItemDto | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<{
    deal: DealListItemDto;
    actions: DealTransitionActionType[];
  } | null>(null);

  const isAdmin = userRole === 'ADMIN';

  const stats = useMemo(() => {
    let closedWonCount = 0;
    let totalClosedWonValue = 0;
    let underContractCount = 0;
    let fullySettledCount = 0;

    for (const d of deals) {
      if (d.salesOutcomeStatus === 'CLOSED_WON') {
        closedWonCount += 1;
        totalClosedWonValue += d.finalDealValue;
      }
      if (d.contractStatus === 'UNDER_CONTRACT') {
        underContractCount += 1;
      }
      if (d.paymentSettlementStatus === 'FULLY_SETTLED') {
        fullySettledCount += 1;
      }
    }

    return {
      total: deals.length,
      closedWonCount,
      totalClosedWonValue,
      underContractCount,
      fullySettledCount,
    };
  }, [deals]);

  const filteredDeals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return deals.filter((d) => {
      if (outcomeFilter !== 'ALL' && d.salesOutcomeStatus !== outcomeFilter) {
        return false;
      }
      if (contractFilter !== 'ALL' && d.contractStatus !== contractFilter) {
        return false;
      }
      if (
        settlementFilter !== 'ALL' &&
        d.paymentSettlementStatus !== settlementFilter
      ) {
        return false;
      }
      if (methodFilter !== 'ALL' && d.paymentMethod !== methodFilter) {
        return false;
      }
      if (!q) return true;
      return (
        d.referenceNumber.toLowerCase().includes(q) ||
        d.bookingReferenceNumber.toLowerCase().includes(q) ||
        d.leadFullName.toLowerCase().includes(q) ||
        d.unitCode.toLowerCase().includes(q) ||
        d.projectName.toLowerCase().includes(q) ||
        (d.contractDocumentNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [
    deals,
    searchQuery,
    outcomeFilter,
    contractFilter,
    settlementFilter,
    methodFilter,
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Deals &amp; Kontrak
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            Pelacakan 3 dimensi Deal: Sales Outcome, Status Kontrak, dan Pelunasan Pembayaran
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="forest" icon={<Briefcase className="h-3.5 w-3.5" strokeWidth={1.75} />}>
            3 Dimensi Terpisah
          </Badge>
        </div>
      </div>

      {/* KPI Ringkas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Deal"
          value={`${stats.total} Transaksi`}
          subtext={`${stats.underContractCount} Sedang UNDER_CONTRACT`}
          icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="Sales Closing"
          value={`${stats.closedWonCount} Closing`}
          subtext="Memenuhi kriteria closing per metode bayar"
          icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
        />
        <KpiCard
          label="Total Nilai Transaksi Properti"
          value={formatRupiah(stats.totalClosedWonValue)}
          subtext="Total final_deal_value terikat"
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="Pelunasan Penuh (100%)"
          value={`${stats.fullySettledCount} Deal`}
          subtext="Status FULLY_SETTLED (Unit SOLD)"
          icon={<FileCheck2 className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
      </div>

      {/* Bar Pencarian & Filter */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]"
              strokeWidth={1.75}
            />
            <Input
              placeholder="Cari no. Deal, Booking, unit..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Cari deal"
            />
          </div>
          <Select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            options={OUTCOME_OPTIONS}
            aria-label="Filter sales outcome"
          />
          <Select
            value={contractFilter}
            onChange={(e) => setContractFilter(e.target.value)}
            options={CONTRACT_OPTIONS}
            aria-label="Filter status kontrak"
          />
          <Select
            value={settlementFilter}
            onChange={(e) => setSettlementFilter(e.target.value)}
            options={SETTLEMENT_OPTIONS}
            aria-label="Filter status pelunasan"
          />
          <Select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            options={METHOD_OPTIONS}
            aria-label="Filter metode bayar"
          />
        </CardContent>
      </Card>

      {/* Daftar Deals */}
      {filteredDeals.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={<Briefcase className="h-6 w-6" strokeWidth={1.5} />}
              title="Tidak Ada Data Deal"
              description="Belum ada transaksi Deal yang sesuai dengan filter pencarian Anda."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tabel Desktop */}
          <Card className="hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                    <th className="px-4 py-3">No. Deal &amp; Booking</th>
                    <th className="px-4 py-3">Konsumen &amp; Unit</th>
                    <th className="px-4 py-3">Metode</th>
                    <th className="px-4 py-3 text-right">Total Nilai Transaksi Properti</th>
                    <th className="px-4 py-3">Dimensi Status (3 Chip)</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {filteredDeals.map((deal) => {
                    const allowedActions = isAdmin
                      ? getAllowedDealTransitions({
                          bookingStatus: deal.bookingStatus,
                          paymentMethod: deal.paymentMethod,
                          salesOutcomeStatus: deal.salesOutcomeStatus,
                          contractStatus: deal.contractStatus,
                          paymentSettlementStatus: deal.paymentSettlementStatus,
                          unitStatus: deal.unitStatus,
                          kprApplicationStatus: deal.kprApplicationStatus,
                          kprCurrentStage: deal.kprCurrentStage,
                          kprDisbursementStatus: deal.kprDisbursementStatus,
                        })
                      : [];

                    return (
                      <tr key={deal.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-4 py-3 align-top">
                          <p className="font-mono font-bold text-[#0F172A]">
                            {deal.referenceNumber}
                          </p>
                          <Link
                            href={`/bookings/${deal.bookingId}`}
                            className="mt-0.5 inline-block font-mono text-[11px] text-[#14532D] hover:underline"
                          >
                            {deal.bookingReferenceNumber}
                          </Link>
                          {deal.contractDocumentNumber && (
                            <p className="mt-0.5 font-mono text-[11px] text-[#64748B]">
                              {deal.contractDocumentNumber}
                            </p>
                          )}
                        </td>

                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-[#0F172A]">
                            {deal.leadFullName}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-[#F1F5F9] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#334155]">
                              {deal.unitCode}
                            </span>
                            <UnitStatusBadge status={deal.unitStatus} />
                          </div>
                          <p className="mt-0.5 text-[11px] text-[#64748B]">
                            {deal.projectName} • {deal.salesName}
                          </p>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <span className="font-medium text-[#0F172A]">
                            {formatPaymentMethodShort(deal.paymentMethod)}
                          </span>
                          {deal.contractSignedAt && (
                            <p className="mt-0.5 text-[11px] text-[#64748B] tabular-nums">
                              Kontrak: {formatDateID(deal.contractSignedAt)}
                            </p>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right align-top font-mono font-semibold text-[#0F172A] tabular-nums">
                          {formatRupiah(deal.finalDealValue)}
                        </td>

                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col items-start gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="w-16 text-[10px] font-semibold text-[#64748B] uppercase">
                                Outcome
                              </span>
                              <DomainStatusBadge value={deal.salesOutcomeStatus} />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-16 text-[10px] font-semibold text-[#64748B] uppercase">
                                Kontrak
                              </span>
                              <DomainStatusBadge value={deal.contractStatus} />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-16 text-[10px] font-semibold text-[#64748B] uppercase">
                                Lunas
                              </span>
                              <DomainStatusBadge
                                value={deal.paymentSettlementStatus}
                              />
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3 text-right align-top">
                          <div className="flex flex-col items-end gap-1.5">
                            {deal.contractFilePath && (
                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setPreviewTarget({
                                      filePath: deal.contractFilePath!,
                                      fileName: `${deal.referenceNumber}-kontrak.pdf`,
                                      title: `Kontrak ${deal.referenceNumber}`,
                                    })
                                  }
                                  leftIcon={
                                    <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                                  }
                                >
                                  Pratinjau PDF
                                </Button>
                                <DownloadDocumentButton
                                  filePath={deal.contractFilePath}
                                  fileName={`${deal.referenceNumber}-kontrak.pdf`}
                                />
                              </div>
                            )}

                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setHistoryDeal(deal)}
                                leftIcon={
                                  <History
                                    className="h-3.5 w-3.5"
                                    strokeWidth={1.75}
                                  />
                                }
                              >
                                Riwayat Status ({deal.histories.length})
                              </Button>

                              {isAdmin && allowedActions.length > 0 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="primary"
                                  onClick={() =>
                                    setTransitionTarget({
                                      deal,
                                      actions: allowedActions,
                                    })
                                  }
                                >
                                  Transisi Status
                                </Button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Kartu Mobile / Tablet */}
          <div className="space-y-3 lg:hidden">
            {filteredDeals.map((deal) => {
              const allowedActions = isAdmin
                ? getAllowedDealTransitions({
                    bookingStatus: deal.bookingStatus,
                    paymentMethod: deal.paymentMethod,
                    salesOutcomeStatus: deal.salesOutcomeStatus,
                    contractStatus: deal.contractStatus,
                    paymentSettlementStatus: deal.paymentSettlementStatus,
                    unitStatus: deal.unitStatus,
                    kprApplicationStatus: deal.kprApplicationStatus,
                    kprCurrentStage: deal.kprCurrentStage,
                    kprDisbursementStatus: deal.kprDisbursementStatus,
                  })
                : [];

              return (
                <Card key={deal.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm font-bold text-[#0F172A]">
                          {deal.referenceNumber}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold text-[#0F172A]">
                          {deal.leadFullName}
                        </p>
                        <p className="text-[11px] text-[#64748B]">
                          {deal.unitCode} •{' '}
                          {formatPaymentMethodShort(deal.paymentMethod)}
                        </p>
                      </div>
                      <UnitStatusBadge status={deal.unitStatus} />
                    </div>

                    <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
                      <p className="text-[11px] text-[#64748B]">Total Nilai Transaksi Properti</p>
                      <p className="font-mono text-sm font-bold text-[#0F172A] tabular-nums">
                        {formatRupiah(deal.finalDealValue)}
                      </p>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[#64748B]">
                          Sales Outcome
                        </span>
                        <DomainStatusBadge value={deal.salesOutcomeStatus} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[#64748B]">Kontrak</span>
                        <DomainStatusBadge value={deal.contractStatus} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[#64748B]">
                          Pelunasan
                        </span>
                        <DomainStatusBadge value={deal.paymentSettlementStatus} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {deal.contractFilePath && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPreviewTarget({
                              filePath: deal.contractFilePath!,
                              fileName: `${deal.referenceNumber}-kontrak.pdf`,
                              title: `Kontrak ${deal.referenceNumber}`,
                            })
                          }
                          leftIcon={<Eye className="h-3.5 w-3.5" strokeWidth={1.75} />}
                        >
                          Pratinjau PDF
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setHistoryDeal(deal)}
                        leftIcon={<History className="h-3.5 w-3.5" strokeWidth={1.75} />}
                      >
                        Riwayat
                      </Button>
                      {isAdmin && allowedActions.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          onClick={() =>
                            setTransitionTarget({ deal, actions: allowedActions })
                          }
                        >
                          Transisi Status
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

      {/* Modal Pratinjau PDF Kontrak */}
      {previewTarget && (
        <DocumentPreviewModal
          isOpen={previewTarget !== null}
          onClose={() => setPreviewTarget(null)}
          filePath={previewTarget.filePath}
          fileName={previewTarget.fileName}
          title={previewTarget.title}
        />
      )}

      {/* Modal Riwayat Status 3 Dimensi */}
      <Modal
        isOpen={historyDeal !== null}
        onClose={() => setHistoryDeal(null)}
        title={`Riwayat Status — ${historyDeal?.referenceNumber ?? ''}`}
        description={historyDeal?.leadFullName}
        size="md"
        footer={
          <Button
            type="button"
            variant="outline"
            onClick={() => setHistoryDeal(null)}
          >
            Tutup
          </Button>
        }
      >
        {historyDeal && (
          <div className="space-y-3">
            {historyDeal.histories.length === 0 ? (
              <EmptyState
                title="Belum Ada Riwayat Transisi"
                description="Transisi status dimensi Deal akan tercatat di sini."
              />
            ) : (
              <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                {historyDeal.histories.map((h) => (
                  <div key={h.id} className="space-y-1 p-3.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge tone="blue">{h.changedDimension}</Badge>
                      <span className="text-[11px] text-[#64748B] tabular-nums">
                        {formatDateTimeID(h.changedAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 font-mono text-[11px] font-semibold">
                      <span className="text-[#64748B]">{h.oldStatus}</span>
                      <ArrowRight className="h-3 w-3 text-[#94A3B8]" />
                      <span className="text-[#14532D]">{h.newStatus}</span>
                    </div>
                    {h.reason && <p className="text-[#334155]">{h.reason}</p>}
                    <p className="text-[11px] text-[#64748B]">
                      Oleh: {h.changedByName}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal Transisi Status (TX-05 — Admin-ONLY) */}
      <Modal
        isOpen={transitionTarget !== null}
        onClose={() => setTransitionTarget(null)}
        title="Transisi Status Deal (TX-05)"
        description="Pengesahan status kontrak dan pelunasan Deal oleh Admin"
        size="md"
      >
        {transitionTarget && (
          <DealTransitionModalInner
            key={transitionTarget.deal.id}
            deal={transitionTarget.deal}
            allowedActions={transitionTarget.actions}
            onClose={() => setTransitionTarget(null)}
          />
        )}
      </Modal>
    </div>
  );
}
