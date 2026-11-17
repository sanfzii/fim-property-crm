// Lokasi: src/components/kpr/KprWorkspaceClient.tsx
// Workspace Daftar Pengajuan KPR 10 Tahap & TC-01A (/kpr)

'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  Landmark,
  Search,
  Wallet,
} from 'lucide-react';
import type {
  KprApplicationStatus,
  KprDisbursementStatus,
  KprStage,
  UnitStatus,
} from '@/types/database.types';
import { formatRupiah } from '@/lib/utils/format';
import { KPR_TEN_STAGES, getKprStageMeta } from '@/lib/utils/kpr-deals-ui';
import { Badge, DomainStatusBadge, UnitStatusBadge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { KpiCard } from '@/components/ui/KpiCard';
import { Select } from '@/components/ui/Select';

export interface KprListItemDto {
  id: string;
  referenceNumber: string;
  bookingId: string;
  bookingReferenceNumber: string;
  leadId: string;
  leadFullName: string;
  unitCode: string;
  unitStatus: UnitStatus;
  projectName: string;
  teamCode: string;
  teamName: string;
  salesName: string;
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
  mandatoryDocsVerified: number;
  mandatoryDocsTotal: number;
}

export interface KprWorkspaceClientProps {
  applications: KprListItemDto[];
}

const APP_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Semua Status Pengajuan' },
  { value: 'IN_PROGRESS', label: 'IN PROGRESS' },
  { value: 'APPROVED', label: 'APPROVED (SP3K)' },
  { value: 'COMPLETED', label: 'COMPLETED (100% Cair)' },
  { value: 'REJECTED_BY_BANK', label: 'REJECTED BY BANK' },
  { value: 'CANCELLED_BY_CUSTOMER', label: 'CANCELLED BY CUSTOMER' },
  { value: 'BOOKING_CANCELLED', label: 'BOOKING CANCELLED' },
];

const STAGE_OPTIONS = [
  { value: 'ALL', label: 'Semua Tahap (1–10)' },
  ...KPR_TEN_STAGES.map((s) => ({
    value: s.stage,
    label: `${s.stepNumber}. ${s.label}`,
  })),
];

const DISBURSEMENT_OPTIONS = [
  { value: 'ALL', label: 'Semua Status Pencairan' },
  { value: 'NOT_DISBURSED', label: 'NOT DISBURSED' },
  { value: 'PARTIALLY_DISBURSED', label: 'PARTIALLY DISBURSED' },
  { value: 'FULLY_DISBURSED', label: 'FULLY DISBURSED' },
];

export function KprWorkspaceClient({ applications }: KprWorkspaceClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [stageFilter, setStageFilter] = useState('ALL');
  const [disbursementFilter, setDisbursementFilter] = useState('ALL');

  const stats = useMemo(() => {
    let inProgress = 0;
    let approvedOrCompleted = 0;
    let partialRetentionCount = 0;
    let totalApprovedPlafond = 0;

    for (const app of applications) {
      if (app.applicationStatus === 'IN_PROGRESS') inProgress += 1;
      if (
        app.applicationStatus === 'APPROVED' ||
        app.applicationStatus === 'COMPLETED'
      ) {
        approvedOrCompleted += 1;
        totalApprovedPlafond += app.approvedLoanAmount ?? 0;
      }
      if (app.disbursementStatus === 'PARTIALLY_DISBURSED') {
        partialRetentionCount += 1;
      }
    }

    return {
      total: applications.length,
      inProgress,
      approvedOrCompleted,
      partialRetentionCount,
      totalApprovedPlafond,
    };
  }, [applications]);

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return applications.filter((app) => {
      if (statusFilter !== 'ALL' && app.applicationStatus !== statusFilter) {
        return false;
      }
      if (stageFilter !== 'ALL' && app.currentStage !== stageFilter) {
        return false;
      }
      if (
        disbursementFilter !== 'ALL' &&
        app.disbursementStatus !== disbursementFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        app.referenceNumber.toLowerCase().includes(q) ||
        app.bookingReferenceNumber.toLowerCase().includes(q) ||
        app.leadFullName.toLowerCase().includes(q) ||
        app.bankName.toLowerCase().includes(q) ||
        app.unitCode.toLowerCase().includes(q) ||
        app.projectName.toLowerCase().includes(q)
      );
    });
  }, [
    applications,
    searchQuery,
    statusFilter,
    stageFilter,
    disbursementFilter,
  ]);

  return (
    <div className="space-y-6">
      {/* Header Halaman */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Pengajuan KPR
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            Pemantauan 10 tahap pengajuan kredit bank, kelengkapan dokumen, dan pencairan bertahap (TC-01A)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue" icon={<Landmark className="h-3.5 w-3.5" strokeWidth={1.75} />}>
            Kebijakan TC-01A Aktif
          </Badge>
        </div>
      </div>

      {/* Ringkasan KPI KPR */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Pengajuan KPR"
          value={`${stats.total} Aplikasi`}
          subtext={`${stats.inProgress} Sedang diproses bank/internal`}
          icon={<Landmark className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="SP3K Terbit / Selesai"
          value={`${stats.approvedOrCompleted} Aplikasi`}
          subtext="Status APPROVED atau COMPLETED"
          icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
        />
        <KpiCard
          label="Cair Bertahap (Retensi)"
          value={`${stats.partialRetentionCount} Aplikasi`}
          subtext="Unit tetap BOOKED hingga cair 100%"
          icon={<FileCheck2 className="h-4 w-4" strokeWidth={1.75} />}
          tone={stats.partialRetentionCount > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Total Plafon KPR Konsumen"
          value={formatRupiah(stats.totalApprovedPlafond)}
          subtext="Akumulasi SP3K APPROVED & COMPLETED"
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
      </div>

      {/* Bar Pencarian & Filter */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]"
              strokeWidth={1.75}
            />
            <Input
              placeholder="Cari no. KPR, konsumen, bank, unit..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Cari pengajuan KPR"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={APP_STATUS_OPTIONS}
            aria-label="Filter status pengajuan KPR"
          />
          <Select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            options={STAGE_OPTIONS}
            aria-label="Filter tahap KPR"
          />
          <Select
            value={disbursementFilter}
            onChange={(e) => setDisbursementFilter(e.target.value)}
            options={DISBURSEMENT_OPTIONS}
            aria-label="Filter status pencairan KPR"
          />
        </CardContent>
      </Card>

      {/* Daftar Pengajuan KPR: Tabel Desktop + Kartu Mobile */}
      {filteredApps.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={<Landmark className="h-6 w-6" strokeWidth={1.5} />}
              title="Tidak Ada Pengajuan KPR"
              description="Belum ada pengajuan KPR yang cocok dengan filter pencarian Anda."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tabel Desktop */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                    <th className="px-4 py-3">No. KPR &amp; Booking</th>
                    <th className="px-4 py-3">Konsumen &amp; Unit</th>
                    <th className="px-4 py-3">Bank &amp; Tenor</th>
                    <th className="px-4 py-3">Tahap Saat Ini</th>
                    <th className="px-4 py-3">Status Pengajuan &amp; Pencairan</th>
                    <th className="px-4 py-3">Dokumen Wajib</th>
                    <th className="px-4 py-3 text-right">Plafon Kredit</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {filteredApps.map((app) => {
                    const stageMeta = getKprStageMeta(app.currentStage);
                    return (
                      <tr key={app.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-4 py-3 align-top">
                          <Link
                            href={`/kpr/${app.id}`}
                            className="font-mono font-semibold text-[#14532D] hover:underline"
                          >
                            {app.referenceNumber}
                          </Link>
                          <p className="mt-0.5 font-mono text-[11px] text-[#64748B]">
                            {app.bookingReferenceNumber}
                          </p>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-[#0F172A]">
                            {app.leadFullName}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-[#F1F5F9] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#334155]">
                              {app.unitCode}
                            </span>
                            <UnitStatusBadge status={app.unitStatus} />
                          </div>
                          <p className="mt-0.5 text-[11px] text-[#64748B]">
                            {app.projectName}
                          </p>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-[#0F172A]">{app.bankName}</p>
                          <p className="mt-0.5 text-[11px] text-[#64748B] tabular-nums">
                            Tenor {app.tenorYears} Tahun
                          </p>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-[#0F172A]">
                            Tahap {stageMeta.stepNumber}/10
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#475569]">
                            {stageMeta.label}
                          </p>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col items-start gap-1.5">
                            <DomainStatusBadge value={app.applicationStatus} />
                            <DomainStatusBadge value={app.disbursementStatus} />
                          </div>
                        </td>

                        <td className="px-4 py-3 align-top">
                          {app.mandatoryDocsTotal > 0 ? (
                            <span className="inline-flex items-center rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 font-mono text-[11px] font-medium text-[#334155] tabular-nums">
                              {app.mandatoryDocsVerified}/{app.mandatoryDocsTotal} terverifikasi
                            </span>
                          ) : (
                            <span className="text-[11px] text-[#94A3B8]">Belum ada</span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right align-top tabular-nums">
                          {app.approvedLoanAmount !== null ? (
                            <>
                              <p className="font-semibold text-[#047857]">
                                {formatRupiah(app.approvedLoanAmount)}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[#64748B]">
                                Pengajuan: {formatRupiah(app.requestedLoanAmount)}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-semibold text-[#0F172A]">
                                {formatRupiah(app.requestedLoanAmount)}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[#64748B]">
                                Plafon diajukan
                              </p>
                            </>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right align-top">
                          <Link
                            href={`/kpr/${app.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#14532D] transition-colors hover:bg-[#F0FDF4]"
                          >
                            <span>Detail</span>
                            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Kartu Mobile */}
          <div className="space-y-3 md:hidden">
            {filteredApps.map((app) => {
              const stageMeta = getKprStageMeta(app.currentStage);
              return (
                <Card key={app.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link
                          href={`/kpr/${app.id}`}
                          className="font-mono text-sm font-bold text-[#14532D] hover:underline"
                        >
                          {app.referenceNumber}
                        </Link>
                        <p className="mt-0.5 text-xs font-semibold text-[#0F172A]">
                          {app.leadFullName}
                        </p>
                        <p className="text-[11px] text-[#64748B]">
                          {app.unitCode} • {app.bankName} ({app.tenorYears} thn)
                        </p>
                      </div>
                      <UnitStatusBadge status={app.unitStatus} />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <DomainStatusBadge value={app.applicationStatus} />
                      <DomainStatusBadge value={app.disbursementStatus} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 text-xs">
                      <div>
                        <p className="text-[11px] text-[#64748B]">
                          Tahap {stageMeta.stepNumber}/10
                        </p>
                        <p className="font-semibold text-[#0F172A]">
                          {stageMeta.label}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-[#64748B]">Plafon Kredit</p>
                        <p className="font-semibold text-[#0F172A] tabular-nums">
                          {formatRupiah(
                            app.approvedLoanAmount ?? app.requestedLoanAmount
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="font-mono text-[11px] text-[#475569] tabular-nums">
                        Dok. Wajib: {app.mandatoryDocsVerified}/{app.mandatoryDocsTotal}
                      </span>
                      <Link
                        href={`/kpr/${app.id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-[#14532D] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        <span>Buka Detail</span>
                        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
