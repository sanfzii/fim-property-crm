// Lokasi: src/components/kpr/KprDetailClient.tsx
// Detail Aplikasi KPR 10 Tahap, Checklist Dokumen OQ-06, Pencairan Bank TC-01A & Riwayat

'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Info,
  Landmark,
  ShieldAlert,
  Upload,
  XCircle,
} from 'lucide-react';
import type {
  BookingStatus,
  DisbursementTranche,
  KprApplicationStatus,
  KprDisbursementStatus,
  KprDocStatus,
  KprStage,
  ScheduleStatus,
  SystemRole,
  TaskPriority,
  TaskStatus,
  UnitStatus,
} from '@/types/database.types';
import { formatDateID, formatDateTimeID, formatRupiah } from '@/lib/utils/format';
import {
  KPR_TEN_STAGES,
  canCancelKprByCustomer,
  canRecordKprApprovalDecision,
  computeKprMandatoryDocReadiness,
  getAllowedNextKprAdvanceTargets,
  getEligibleKprDisbursementTranche,
  getKprStageIndex,
  getKprStageMeta,
  isKprApplicationHalted,
} from '@/lib/utils/kpr-deals-ui';
import { Badge, DomainStatusBadge, UnitStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { DownloadDocumentButton } from '@/components/transactions/DownloadDocumentButton';
import type { KprDocModalTarget } from './KprActionModals';

const DocumentPreviewModal = dynamic(
  () =>
    import('@/components/transactions/DocumentPreviewModal').then(
      (mod) => mod.DocumentPreviewModal
    ),
  { ssr: false }
);
const AdvanceKprStageModal = dynamic(
  () => import('./KprActionModals').then((mod) => mod.AdvanceKprStageModal),
  { ssr: false }
);
const CancelKprCustomerModal = dynamic(
  () => import('./KprActionModals').then((mod) => mod.CancelKprCustomerModal),
  { ssr: false }
);
const RecordKprApprovalModal = dynamic(
  () => import('./KprActionModals').then((mod) => mod.RecordKprApprovalModal),
  { ssr: false }
);
const RecordKprDisbursementModal = dynamic(
  () =>
    import('./KprActionModals').then((mod) => mod.RecordKprDisbursementModal),
  { ssr: false }
);
const UploadKprDocModal = dynamic(
  () => import('./KprActionModals').then((mod) => mod.UploadKprDocModal),
  { ssr: false }
);
const VerifyKprDocModal = dynamic(
  () => import('./KprActionModals').then((mod) => mod.VerifyKprDocModal),
  { ssr: false }
);

export interface KprDetailDto {
  id: string;
  referenceNumber: string;
  bookingId: string;
  bookingReferenceNumber: string;
  bookingStatus: BookingStatus;
  leadId: string;
  leadFullName: string;
  leadPhone: string;
  unitId: string;
  unitCode: string;
  blockNumber: string;
  unitStatus: UnitStatus;
  projectName: string;
  salesName: string;
  teamCode: string;
  teamName: string;
  bankName: string;
  tenorYears: number;
  requestedLoanAmount: number;
  approvedLoanAmount: number | null;
  currentStage: KprStage;
  applicationStatus: KprApplicationStatus;
  disbursementStatus: KprDisbursementStatus;
  primaryDisbursedAmount: number;
  subsequentDisbursedAmount: number;
  remainingUndisbursedAmount: number;
  sp3kReferenceNumber: string | null;
  submittedToBankAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  akadScheduledAt: string | null;
  akadLocation: string | null;
  notaryName: string | null;
  akadCompletedAt: string | null;
  akadDeedNumber: string | null;
  firstDisbursedAt: string | null;
  fullyDisbursedAt: string | null;
  notes: string | null;
}

export interface KprTopupDpScheduleDto {
  id: string;
  title: string;
  scheduledAmount: number;
  verifiedPaidAmount: number;
  remainingAmount: number;
  dueDate: string;
  status: ScheduleStatus;
}

export interface KprDocumentItemDto {
  id: string;
  documentName: string;
  documentCode: string;
  isMandatory: boolean;
  status: KprDocStatus;
  filePath: string | null;
  fileName: string | null;
  uploadedByName: string | null;
  uploadedAt: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
}

export interface KprStageHistoryItemDto {
  id: string;
  fromStage: KprStage | null;
  toStage: KprStage;
  notes: string | null;
  changedByName: string;
  changedAt: string;
}

export interface KprDisbursementItemDto {
  id: string;
  trancheType: DisbursementTranche;
  sequenceNumber: number;
  disbursementReference: string;
  disbursedAmount: number;
  disbursementDate: string;
  proofFilePath: string;
  recordedByName: string;
  notes: string | null;
}

export interface KprTaskItemDto {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedSalesName: string;
}

export interface KprDetailClientProps {
  userRole: SystemRole;
  kpr: KprDetailDto;
  topupSchedule: KprTopupDpScheduleDto | null;
  documents: KprDocumentItemDto[];
  stageHistories: KprStageHistoryItemDto[];
  disbursements: KprDisbursementItemDto[];
  tasks: KprTaskItemDto[];
  defaultTodayDateStr: string;
  defaultTopupDueDateStr: string;
  defaultAkadDateTimeLocal: string;
}

type KprTabKey = 'documents' | 'disbursements' | 'history';

export function KprDetailClient({
  userRole,
  kpr,
  topupSchedule,
  documents,
  stageHistories,
  disbursements,
  tasks,
  defaultTodayDateStr,
  defaultTopupDueDateStr,
  defaultAkadDateTimeLocal,
}: KprDetailClientProps) {
  const [activeTab, setActiveTab] = useState<KprTabKey>('documents');

  // Preview modal state
  const [previewTarget, setPreviewTarget] = useState<{
    filePath: string;
    fileName: string;
    title: string;
  } | null>(null);

  // Action modals
  const [uploadTarget, setUploadTarget] = useState<KprDocModalTarget | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<{
    doc: KprDocModalTarget;
    decision: 'VERIFIED' | 'REVISION_REQUIRED';
  } | null>(null);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isDisbModalOpen, setIsDisbModalOpen] = useState(false);

  const isAdmin = userRole === 'ADMIN';
  const canUploadDocs =
    (userRole === 'ADMIN' || userRole === 'SALES') &&
    (kpr.applicationStatus === 'IN_PROGRESS' ||
      kpr.applicationStatus === 'APPROVED');

  const docReadiness = computeKprMandatoryDocReadiness(documents);
  const currentStageIdx = getKprStageIndex(kpr.currentStage);
  const isHalted = isKprApplicationHalted(kpr.applicationStatus);

  const allowedAdvanceTargets = isAdmin
    ? getAllowedNextKprAdvanceTargets({
        bookingStatus: kpr.bookingStatus,
        applicationStatus: kpr.applicationStatus,
        currentStage: kpr.currentStage,
      })
    : [];

  const canApproveDecision =
    isAdmin &&
    canRecordKprApprovalDecision({
      bookingStatus: kpr.bookingStatus,
      applicationStatus: kpr.applicationStatus,
      currentStage: kpr.currentStage,
    });

  const canCancelCustomer =
    isAdmin &&
    canCancelKprByCustomer({
      bookingStatus: kpr.bookingStatus,
      applicationStatus: kpr.applicationStatus,
      currentStage: kpr.currentStage,
      disbursementStatus: kpr.disbursementStatus,
    });

  const eligibleDisbursementTranche = isAdmin
    ? getEligibleKprDisbursementTranche({
        bookingStatus: kpr.bookingStatus,
        applicationStatus: kpr.applicationStatus,
        currentStage: kpr.currentStage,
        remainingUndisbursedAmount: kpr.remainingUndisbursedAmount,
      })
    : null;

  const totalDisbursed =
    kpr.primaryDisbursedAmount + kpr.subsequentDisbursedAmount;
  const approvedPlafond = kpr.approvedLoanAmount ?? 0;
  const disbursedPct =
    approvedPlafond > 0
      ? Math.min(100, Math.round((totalDisbursed / approvedPlafond) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb Kembali */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/kpr"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#475569] hover:text-[#14532D]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>Kembali ke Daftar KPR</span>
        </Link>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            href={`/bookings/${kpr.bookingId}`}
            className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 font-medium text-[#334155] hover:bg-[#F8FAFC]"
          >
            <span className="font-mono">{kpr.bookingReferenceNumber}</span>
            <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
          </Link>
          {kpr.leadId && (
            <Link
              href={`/leads/${kpr.leadId}`}
              className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 font-medium text-[#334155] hover:bg-[#F8FAFC]"
            >
              <span>Profil Prospek</span>
              <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            </Link>
          )}
        </div>
      </div>

      {/* Header Detail KPR */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-mono text-xl font-bold tracking-tight text-[#0F172A]">
                  {kpr.referenceNumber}
                </h1>
                <DomainStatusBadge value={kpr.applicationStatus} />
                <DomainStatusBadge value={kpr.disbursementStatus} />
                <UnitStatusBadge status={kpr.unitStatus} />
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#475569]">
                <span>
                  Konsumen:{' '}
                  <strong className="text-[#0F172A]">{kpr.leadFullName}</strong>
                </span>
                <span>
                  Unit:{' '}
                  <strong className="font-mono text-[#0F172A]">
                    {kpr.unitCode}
                  </strong>{' '}
                  ({kpr.projectName})
                </span>
                <span>
                  Bank:{' '}
                  <strong className="text-[#0F172A]">
                    {kpr.bankName} • Tenor {kpr.tenorYears} Tahun
                  </strong>
                </span>
                <span>
                  Sales:{' '}
                  <strong className="text-[#0F172A]">
                    {kpr.salesName} ({kpr.teamCode})
                  </strong>
                </span>
              </div>
            </div>

            {/* Tombol Aksi Khusus ADMIN */}
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2">
                {allowedAdvanceTargets.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={() => setIsAdvanceModalOpen(true)}
                    leftIcon={<ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  >
                    Majukan Tahap
                  </Button>
                )}

                {canApproveDecision && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setIsApprovalModalOpen(true)}
                    leftIcon={<FileCheck2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  >
                    Catat Keputusan Bank (SP3K)
                  </Button>
                )}

                {eligibleDisbursementTranche && (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={() => setIsDisbModalOpen(true)}
                    leftIcon={<Banknote className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  >
                    Catat Pencairan
                  </Button>
                )}

                {canCancelCustomer && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => setIsCancelModalOpen(true)}
                    leftIcon={<XCircle className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  >
                    Catat Pembatalan KPR Konsumen
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Kebijakan TC-01A 1 baris */}
          <div className="flex items-center gap-2 rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-xs text-[#1E40AF]">
            <Info className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>
              Status Unit tetap BOOKED hingga pencairan KPR mencapai 100% (FULLY_DISBURSED).
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Banner Alasan Penghentian (REJECTED_BY_BANK / CANCELLED_BY_CUSTOMER / BOOKING_CANCELLED) */}
      {isHalted && (
        <div className="flex items-start gap-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#991B1B]">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#DC2626]" strokeWidth={1.75} />
          <div className="space-y-1">
            <p className="font-bold">
              Pengajuan KPR Dihentikan ({kpr.applicationStatus.replace(/_/g, ' ')}) pada
              Tahap {getKprStageMeta(kpr.currentStage).stepNumber}/10 (
              {getKprStageMeta(kpr.currentStage).label})
            </p>
            <p className="leading-relaxed">
              Alasan:{' '}
              {kpr.rejectionReason ??
                kpr.cancellationReason ??
                'Pengajuan dihentikan sebelum pencairan.'}
            </p>
            {(kpr.rejectedAt || kpr.cancelledAt) && (
              <p className="text-[11px] text-[#B91C1C]">
                Dicatat pada: {formatDateTimeID(kpr.rejectedAt ?? kpr.cancelledAt)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Alert SP3K Turun Plafon (KPR_TOPUP_DP) */}
      {topupSchedule && (
        <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 text-xs text-[#92400E] sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-[#D97706]"
              strokeWidth={1.75}
            />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold text-[#78350F]">
                  SP3K Turun Plafon — Jadwal Tambahan DP (KPR_TOPUP_DP)
                </p>
                <DomainStatusBadge value={topupSchedule.status} />
              </div>
              <p>
                Selisih plafon kredit sebesar{' '}
                <strong className="font-mono tabular-nums">
                  {formatRupiah(topupSchedule.scheduledAmount)}
                </strong>{' '}
                (Sisa tagihan:{' '}
                <strong className="font-mono tabular-nums">
                  {formatRupiah(topupSchedule.remainingAmount)}
                </strong>
                , Jatuh tempo: {formatDateID(topupSchedule.dueDate)}).
              </p>
            </div>
          </div>

          <Link
            href={`/bookings/${kpr.bookingId}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#F59E0B] bg-white px-3 py-1.5 text-xs font-semibold text-[#92400E] hover:bg-[#FEF3C7]"
          >
            <span>Lihat Jadwal di Booking</span>
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Link>
        </div>
      )}

      {/* 10-Stage Stepper Murni (Tanpa Tahap REJECTED) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
            <CardTitle>Progres 10 Tahap KPR</CardTitle>
          </div>
          <span className="font-mono text-xs font-semibold text-[#14532D] tabular-nums">
            Tahap {getKprStageMeta(kpr.currentStage).stepNumber} / 10
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
            {KPR_TEN_STAGES.map((item, idx) => {
              const isCompleted =
                !isHalted &&
                (idx < currentStageIdx ||
                  (kpr.applicationStatus === 'COMPLETED' && idx === 9));
              const isCurrent =
                idx === currentStageIdx && kpr.applicationStatus !== 'COMPLETED';
              const isHaltedHere = isHalted && isCurrent;

              return (
                <div
                  key={item.stage}
                  className={`flex flex-col justify-between rounded-lg border p-2.5 text-xs ${
                    isHaltedHere
                      ? 'border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]'
                      : isCompleted
                        ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]'
                        : isCurrent
                          ? 'border-[#14532D] bg-[#F0FDF4] text-[#14532D] ring-1 ring-[#14532D]/20'
                          : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[11px] font-bold tabular-nums">
                      {String(item.stepNumber).padStart(2, '0')}
                    </span>
                    {isHaltedHere ? (
                      <XCircle className="h-3.5 w-3.5 text-[#DC2626]" strokeWidth={2} />
                    ) : isCompleted ? (
                      <Check className="h-3.5 w-3.5 text-[#059669]" strokeWidth={2.25} />
                    ) : null}
                  </div>
                  <p className="mt-1.5 leading-snug font-semibold">
                    {item.shortLabel}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Ringkasan Plafon & Detail SP3K / Akad */}
          <div className="grid grid-cols-1 gap-3 border-t border-[#E2E8F0] pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <p className="text-[11px] font-medium text-[#64748B]">Plafon Diajukan</p>
              <p className="mt-1 font-mono text-sm font-bold text-[#0F172A] tabular-nums">
                {formatRupiah(kpr.requestedLoanAmount)}
              </p>
            </div>

            <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <p className="text-[11px] font-medium text-[#64748B]">
                Plafon Disetujui (SP3K)
              </p>
              <p className="mt-1 font-mono text-sm font-bold text-[#047857] tabular-nums">
                {kpr.approvedLoanAmount !== null
                  ? formatRupiah(kpr.approvedLoanAmount)
                  : 'Menunggu SP3K'}
              </p>
              {kpr.sp3kReferenceNumber && (
                <p className="mt-0.5 truncate font-mono text-[11px] text-[#475569]">
                  {kpr.sp3kReferenceNumber}
                </p>
              )}
            </div>

            <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <p className="text-[11px] font-medium text-[#64748B]">
                Jadwal &amp; Lokasi Akad
              </p>
              <p className="mt-1 text-xs font-semibold text-[#0F172A] tabular-nums">
                {kpr.akadScheduledAt
                  ? formatDateTimeID(kpr.akadScheduledAt)
                  : 'Belum dijadwalkan'}
              </p>
              {kpr.akadLocation && (
                <p className="mt-0.5 truncate text-[11px] text-[#475569]">
                  {kpr.akadLocation}
                </p>
              )}
            </div>

            <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <p className="text-[11px] font-medium text-[#64748B]">
                Akta Akad &amp; Notaris
              </p>
              <p className="mt-1 font-mono text-xs font-semibold text-[#0F172A]">
                {kpr.akadDeedNumber ?? 'Belum terbit'}
              </p>
              {kpr.notaryName && (
                <p className="mt-0.5 truncate text-[11px] text-[#475569]">
                  {kpr.notaryName}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3 Tab Detail KPR */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('documents')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'documents'
                  ? 'bg-[#14532D] text-white'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Checklist Dokumen ({documents.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('disbursements')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'disbursements'
                  ? 'bg-[#14532D] text-white'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              <Banknote className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Pencairan Bank ({disbursements.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'history'
                  ? 'bg-[#14532D] text-white'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>
                Riwayat &amp; Tugas ({stageHistories.length + tasks.length})
              </span>
            </button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* TAB 1: CHECKLIST DOKUMEN (OQ-06) */}
          {activeTab === 'documents' && (
            <div className="space-y-4">
              <div className="flex flex-col justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-xs sm:flex-row sm:items-center">
                <p className="text-[#475569]">
                  Gunakan dokumen simulasi/fiktif untuk demo (maks. 5 MB: JPG, PNG,
                  WEBP, PDF).
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                    Dokumen Wajib: {docReadiness.verifiedMandatory}/
                    {docReadiness.totalMandatory} terverifikasi
                  </span>
                  {docReadiness.isReadyForBankSubmission ? (
                    <Badge tone="emerald">Siap Diajukan</Badge>
                  ) : (
                    <Badge tone="amber">Belum Lengkap</Badge>
                  )}
                </div>
              </div>

              {documents.length === 0 ? (
                <EmptyState
                  title="Checklist Dokumen Kosong"
                  description="Belum ada item persyaratan dokumen KPR yang terdaftar."
                />
              ) : (
                <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                  {documents.map((doc) => {
                    const modalTarget: KprDocModalTarget = {
                      id: doc.id,
                      documentName: doc.documentName,
                      documentCode: doc.documentCode,
                      status: doc.status,
                      isMandatory: doc.isMandatory,
                    };

                    const showUploadBtn = canUploadDocs && doc.status !== 'VERIFIED';
                    const showAdminVerifyBtns =
                      isAdmin && Boolean(doc.filePath) && doc.status !== 'VERIFIED';

                    return (
                      <div
                        key={doc.id}
                        className="flex flex-col justify-between gap-3 p-4 lg:flex-row lg:items-center"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold text-[#0F172A]">
                              {doc.documentName}
                            </p>
                            <Badge tone={doc.isMandatory ? 'forest' : 'slate'}>
                              {doc.isMandatory ? 'Wajib' : 'Opsional'}
                            </Badge>
                            <DomainStatusBadge value={doc.status} />
                          </div>

                          {doc.fileName ? (
                            <p className="font-mono text-[11px] text-[#475569]">
                              {doc.fileName} • Diunggah{' '}
                              {doc.uploadedAt
                                ? formatDateTimeID(doc.uploadedAt)
                                : '-'}
                              {doc.uploadedByName ? ` oleh ${doc.uploadedByName}` : ''}
                            </p>
                          ) : (
                            <p className="text-[11px] text-[#94A3B8]">
                              Belum ada file yang diunggah.
                            </p>
                          )}

                          {doc.verificationNotes && (
                            <p
                              className={`rounded px-2 py-1 text-[11px] ${
                                doc.status === 'REVISION_REQUIRED'
                                  ? 'bg-[#FEF2F2] text-[#B91C1C]'
                                  : 'bg-[#F8FAFC] text-[#475569]'
                              }`}
                            >
                              Catatan: {doc.verificationNotes}
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {doc.filePath && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setPreviewTarget({
                                    filePath: doc.filePath!,
                                    fileName: doc.fileName ?? 'dokumen-kpr.pdf',
                                    title: doc.documentName,
                                  })
                                }
                                leftIcon={<Eye className="h-3.5 w-3.5" strokeWidth={1.75} />}
                              >
                                Pratinjau
                              </Button>

                              <DownloadDocumentButton
                                filePath={doc.filePath}
                                fileName={doc.fileName ?? 'dokumen-kpr.pdf'}
                              />
                            </>
                          )}

                          {showUploadBtn && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => setUploadTarget(modalTarget)}
                              leftIcon={
                                <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                              }
                            >
                              Unggah
                            </Button>
                          )}

                          {showAdminVerifyBtns && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="primary"
                                onClick={() =>
                                  setVerifyTarget({
                                    doc: modalTarget,
                                    decision: 'VERIFIED',
                                  })
                                }
                                leftIcon={
                                  <CheckCircle2
                                    className="h-3.5 w-3.5"
                                    strokeWidth={1.75}
                                  />
                                }
                              >
                                Verifikasi
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  setVerifyTarget({
                                    doc: modalTarget,
                                    decision: 'REVISION_REQUIRED',
                                  })
                                }
                              >
                                Revisi
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PENCAIRAN BANK (kpr_disbursements — TX-08) */}
          {activeTab === 'disbursements' && (
            <div className="space-y-4">
              {/* Ringkasan & Progress Bar Pencairan */}
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-[#0F172A]">
                      Realisasi Pencairan Plafon Bank
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#64748B]">
                      {kpr.approvedLoanAmount !== null
                        ? `${disbursedPct}% dari plafon disetujui ${formatRupiah(approvedPlafond)}`
                        : 'Menunggu penerbitan SP3K bank'}
                    </p>
                  </div>

                  {eligibleDisbursementTranche && (
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => setIsDisbModalOpen(true)}
                      leftIcon={<Banknote className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    >
                      Catat Pencairan ({eligibleDisbursementTranche})
                    </Button>
                  )}
                </div>

                {/* Progress Bar */}
                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                  <div
                    className="h-full rounded-full bg-[#059669]"
                    style={{ width: `${disbursedPct}%` }}
                  />
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="rounded-md border border-[#E2E8F0] bg-white p-3">
                    <p className="text-[11px] text-[#64748B]">Plafon Disetujui</p>
                    <p className="mt-1 font-mono text-xs font-bold text-[#0F172A] tabular-nums">
                      {formatRupiah(approvedPlafond)}
                    </p>
                  </div>
                  <div className="rounded-md border border-[#A7F3D0] bg-white p-3">
                    <p className="text-[11px] text-[#047857]">
                      Pencairan Utama (PRIMARY)
                    </p>
                    <p className="mt-1 font-mono text-xs font-bold text-[#047857] tabular-nums">
                      {formatRupiah(kpr.primaryDisbursedAmount)}
                    </p>
                  </div>
                  <div className="rounded-md border border-[#BFDBFE] bg-white p-3">
                    <p className="text-[11px] text-[#1D4ED8]">
                      Pencairan Lanjutan (SUBSEQUENT)
                    </p>
                    <p className="mt-1 font-mono text-xs font-bold text-[#1D4ED8] tabular-nums">
                      {formatRupiah(kpr.subsequentDisbursedAmount)}
                    </p>
                  </div>
                  <div className="rounded-md border border-[#FDE68A] bg-white p-3">
                    <p className="text-[11px] text-[#B45309]">Sisa Belum Cair</p>
                    <p className="mt-1 font-mono text-xs font-bold text-[#B45309] tabular-nums">
                      {formatRupiah(kpr.remainingUndisbursedAmount)}
                    </p>
                  </div>
                </div>
              </div>

              {disbursements.length === 0 ? (
                <EmptyState
                  title="Belum Ada Pencairan Bank"
                  description="Pencairan bank hanya dapat dicatat oleh Admin setelah tahap AKAD_COMPLETED selesai."
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                        <th className="px-4 py-3">Urutan</th>
                        <th className="px-4 py-3">Termin</th>
                        <th className="px-4 py-3">No. Referensi</th>
                        <th className="px-4 py-3">Tanggal Cair</th>
                        <th className="px-4 py-3 text-right">Nominal Pencairan</th>
                        <th className="px-4 py-3">Catatan</th>
                        <th className="px-4 py-3 text-right">Bukti Bank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {disbursements.map((d) => (
                        <tr key={d.id} className="hover:bg-[#F8FAFC]">
                          <td className="px-4 py-3 font-mono font-semibold text-[#0F172A] tabular-nums">
                            #{d.sequenceNumber}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              tone={d.trancheType === 'PRIMARY' ? 'emerald' : 'blue'}
                            >
                              {d.trancheType}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono font-medium text-[#0F172A]">
                            {d.disbursementReference}
                          </td>
                          <td className="px-4 py-3 text-[#475569] tabular-nums">
                            {formatDateID(d.disbursementDate)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-[#047857] tabular-nums">
                            {formatRupiah(d.disbursedAmount)}
                          </td>
                          <td className="max-w-xs px-4 py-3 text-[#475569]">
                            {d.notes ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setPreviewTarget({
                                    filePath: d.proofFilePath,
                                    fileName: `${d.disbursementReference}.pdf`,
                                    title: `Bukti Pencairan ${d.disbursementReference}`,
                                  })
                                }
                                leftIcon={<Eye className="h-3.5 w-3.5" strokeWidth={1.75} />}
                              >
                                Pratinjau
                              </Button>
                              <DownloadDocumentButton
                                filePath={d.proofFilePath}
                                fileName={`${d.disbursementReference}.pdf`}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: RIWAYAT TAHAP & TUGAS KPR */}
          {activeTab === 'history' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <h2 className="text-xs font-bold tracking-wider text-[#64748B] uppercase">
                  Riwayat Perpindahan Tahap
                </h2>
                {stageHistories.length === 0 ? (
                  <EmptyState
                    title="Belum Ada Riwayat Tahap"
                    description="Riwayat perpindahan tahap akan muncul saat status tahap diperbarui."
                  />
                ) : (
                  <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                    {stageHistories.map((h) => (
                      <div key={h.id} className="space-y-1 p-3.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5 font-semibold text-[#0F172A]">
                            {h.fromStage && (
                              <>
                                <span className="text-[#64748B]">
                                  {getKprStageMeta(h.fromStage).label}
                                </span>
                                <ArrowRight
                                  className="h-3.5 w-3.5 text-[#94A3B8]"
                                  strokeWidth={1.75}
                                />
                              </>
                            )}
                            <span className="text-[#14532D]">
                              {getKprStageMeta(h.toStage).label}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#64748B] tabular-nums">
                            {formatDateTimeID(h.changedAt)}
                          </span>
                        </div>
                        {h.notes && (
                          <p className="text-[#475569]">{h.notes}</p>
                        )}
                        <p className="text-[11px] text-[#64748B]">
                          Oleh: {h.changedByName}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h2 className="text-xs font-bold tracking-wider text-[#64748B] uppercase">
                  Tugas Tindak Lanjut KPR
                </h2>
                {tasks.length === 0 ? (
                  <EmptyState
                    title="Tidak Ada Tugas KPR"
                    description="Tidak ada tugas tindak lanjut yang tertaut dengan aplikasi KPR ini."
                  />
                ) : (
                  <div className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
                    {tasks.map((t) => (
                      <div key={t.id} className="space-y-1.5 p-3.5 text-xs">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="font-semibold text-[#0F172A]">{t.title}</p>
                          <div className="flex items-center gap-1.5">
                            <DomainStatusBadge value={t.priority} />
                            <DomainStatusBadge value={t.status} />
                          </div>
                        </div>
                        {t.description && (
                          <p className="text-[#475569]">{t.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#64748B]">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Calendar className="h-3 w-3" strokeWidth={1.75} />
                            Jatuh tempo: {formatDateTimeID(t.dueAt)}
                          </span>
                          <span>PIC: {t.assignedSalesName}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reusable On-Demand Signed URL Preview Modal */}
      {previewTarget && (
        <DocumentPreviewModal
          isOpen={previewTarget !== null}
          onClose={() => setPreviewTarget(null)}
          filePath={previewTarget.filePath}
          fileName={previewTarget.fileName}
          title={previewTarget.title}
        />
      )}

      {/* Action Modals */}
      {uploadTarget && (
        <UploadKprDocModal
          isOpen={uploadTarget !== null}
          onClose={() => setUploadTarget(null)}
          bookingId={kpr.bookingId}
          kprApplicationId={kpr.id}
          doc={uploadTarget}
        />
      )}

      {verifyTarget && (
        <VerifyKprDocModal
          isOpen={verifyTarget !== null}
          onClose={() => setVerifyTarget(null)}
          doc={verifyTarget.doc}
          initialDecision={verifyTarget.decision}
        />
      )}

      {isAdvanceModalOpen && (
        <AdvanceKprStageModal
          isOpen={isAdvanceModalOpen}
          onClose={() => setIsAdvanceModalOpen(false)}
          kprApplicationId={kpr.id}
          currentStage={kpr.currentStage}
          allowedTargets={allowedAdvanceTargets}
          isAllMandatoryVerified={docReadiness.isReadyForBankSubmission}
          unverifiedMandatoryCount={docReadiness.unverifiedMandatory}
          defaultAkadDateTimeLocal={defaultAkadDateTimeLocal}
        />
      )}

      {isApprovalModalOpen && (
        <RecordKprApprovalModal
          isOpen={isApprovalModalOpen}
          onClose={() => setIsApprovalModalOpen(false)}
          kprApplicationId={kpr.id}
          requestedLoanAmount={kpr.requestedLoanAmount}
          defaultTopupDueDate={defaultTopupDueDateStr}
        />
      )}

      {isCancelModalOpen && (
        <CancelKprCustomerModal
          isOpen={isCancelModalOpen}
          onClose={() => setIsCancelModalOpen(false)}
          kprApplicationId={kpr.id}
        />
      )}

      {isDisbModalOpen && (
        <RecordKprDisbursementModal
          isOpen={isDisbModalOpen}
          onClose={() => setIsDisbModalOpen(false)}
          bookingId={kpr.bookingId}
          kprApplicationId={kpr.id}
          trancheType={eligibleDisbursementTranche}
          remainingUndisbursedAmount={kpr.remainingUndisbursedAmount}
          defaultDateStr={defaultTodayDateStr}
        />
      )}
    </div>
  );
}
