// Lokasi: src/components/reports/ReportsWorkspaceClient.tsx
// Workspace Laporan Eksekutif (ADMIN) / Laporan Tim (SUPERVISOR) & Audit Logs (ADMIN-ONLY)

'use client';

import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  Eye,
  FileText,
  Landmark,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import type { StandardizedExecutiveMetrics } from '@/modules/analytics/metrics.service';
import type { LeadSource, SystemRole } from '@/types/database.types';
import { formatDateTimeID, formatRupiah } from '@/lib/utils/format';
import {
  computeConversionRatePct,
  formatLeadSourceLabel,
} from '@/lib/utils/kpr-deals-ui';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { KpiCard } from '@/components/ui/KpiCard';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';

export interface LeadSourceConversionRow {
  leadSource: LeadSource | string;
  totalLeads: number;
  hotLeads: number;
  closedWonLeads: number;
}

export interface SalesPerformanceRow {
  salesId: string;
  fullName: string;
  teamCode: string;
  totalLeads: number;
  hotLeads: number;
  closedWonDealsCount: number;
  closedWonDealsValue: number;
  verifiedCashInflow: number;
}

export interface AuditLogItemDto {
  id: string;
  actorUserId: string | null;
  actorName: string;
  actorRole: string;
  actionType: string;
  entityTable: string;
  entityId: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export interface ReportsWorkspaceClientProps {
  userRole: SystemRole;
  teamName: string | null;
  metrics: StandardizedExecutiveMetrics;
  salaryEstimate: number | null;
  leadSourceRows: LeadSourceConversionRow[];
  salesPerformanceRows: SalesPerformanceRow[];
  canViewAuditLogs: boolean;
  auditLogs: AuditLogItemDto[] | null;
}

function formatJsonBlock(value: Record<string, unknown> | null): string {
  if (!value || Object.keys(value).length === 0) {
    return '(tidak ada data)';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ReportsWorkspaceClient({
  userRole,
  teamName,
  metrics,
  salaryEstimate,
  leadSourceRows,
  salesPerformanceRows,
  canViewAuditLogs,
  auditLogs,
}: ReportsWorkspaceClientProps) {
  const isAdmin = userRole === 'ADMIN' && canViewAuditLogs;
  const [activeTab, setActiveTab] = useState<'METRICS' | 'AUDIT'>('METRICS');

  // Filter state untuk Audit Logs (hanya dipakai jika isAdmin === true)
  const [auditSearch, setAuditSearch] = useState('');
  const [actionTypeFilter, setActionTypeFilter] = useState('ALL');
  const [entityTableFilter, setEntityTableFilter] = useState('ALL');
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogItemDto | null>(null);

  const actionTypeOptions = useMemo(() => {
    const distinct = Array.from(
      new Set((auditLogs ?? []).map((item) => item.actionType))
    ).sort();
    return [
      { value: 'ALL', label: 'Semua Action Type' },
      ...distinct.map((val) => ({ value: val, label: val })),
    ];
  }, [auditLogs]);

  const entityTableOptions = useMemo(() => {
    const distinct = Array.from(
      new Set((auditLogs ?? []).map((item) => item.entityTable))
    ).sort();
    return [
      { value: 'ALL', label: 'Semua Tabel Entitas' },
      ...distinct.map((val) => ({ value: val, label: val })),
    ];
  }, [auditLogs]);

  const filteredAuditLogs = useMemo(() => {
    if (!isAdmin || !auditLogs) return [];
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (actionTypeFilter !== 'ALL' && log.actionType !== actionTypeFilter) {
        return false;
      }
      if (entityTableFilter !== 'ALL' && log.entityTable !== entityTableFilter) {
        return false;
      }
      if (!q) return true;
      return (
        log.actorName.toLowerCase().includes(q) ||
        log.actionType.toLowerCase().includes(q) ||
        log.entityTable.toLowerCase().includes(q) ||
        log.entityId.toLowerCase().includes(q) ||
        (log.reason ?? '').toLowerCase().includes(q)
      );
    });
  }, [isAdmin, auditLogs, auditSearch, actionTypeFilter, entityTableFilter]);

  const totalUnitsAll =
    metrics.unitInventory.availableUnitsCount +
    metrics.unitInventory.heldUnitsCount +
    metrics.unitInventory.unitsUnderContractOrBookedCount +
    metrics.unitInventory.unitsFullySoldCount;

  const pageTitle = isAdmin ? 'Laporan Eksekutif' : 'Laporan Tim';
  const scopeLabel = isAdmin
    ? 'PT FIM-Property • Cakupan Seluruh Tim & Perusahaan'
    : `Cakupan Tim: ${teamName ?? 'Tim Anda'}`;

  return (
    <div className="space-y-6">
      {/* Header Halaman */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            {pageTitle}
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            {scopeLabel} — Menggunakan Kamus Metrik Standar &amp; kebijakan inventaris{' '}
            <span className="font-mono font-semibold text-[#14532D]">TC-01A</span>.
          </p>
        </div>

        {/* Tab Navigasi: Audit Logs HANYA dirender untuk ADMIN */}
        {isAdmin && (
          <div
            className="inline-flex rounded-lg border border-[#E2E8F0] bg-white p-1"
            role="tablist"
            aria-label="Navigasi Laporan Eksekutif"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'METRICS'}
              onClick={() => setActiveTab('METRICS')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'METRICS'
                  ? 'bg-[#14532D] text-white'
                  : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" strokeWidth={1.75} />
              Ringkasan Metrik &amp; Penjualan
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'AUDIT'}
              onClick={() => setActiveTab('AUDIT')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'AUDIT'
                  ? 'bg-[#14532D] text-white'
                  : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
              Audit Logs ({(auditLogs ?? []).length})
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: RINGKASAN METRIK & PENJUALAN */}
      {(!isAdmin || activeTab === 'METRICS') && (
        <div className="space-y-6">
          {/* 4 KPI Utama Kamus Metrik Standar */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Penjualan Closing"
              value={`${metrics.salesAndContracts.salesClosingsCount} Unit`}
              subtext={`Total Nilai Transaksi Properti ${formatRupiah(
                metrics.salesAndContracts.totalContractedSalesValue
              )} · ${metrics.salesAndContracts.activeUnderContractCount} berkontrak aktif`}
              icon={<TrendingUp className="h-4 w-4" strokeWidth={1.75} />}
              tone="success"
            />
            <KpiCard
              label="Komisi Diterima dari Developer"
              value={formatRupiah(metrics.finance.developerCommissionReceived)}
              subtext={metrics.finance.closedDealsWithoutCommissionConfig > 0 ? `Estimasi ${formatRupiah(metrics.finance.estimatedDeveloperCommission)} · ${metrics.finance.closedDealsWithoutCommissionConfig} closing belum dikonfigurasi` : `Estimasi komisi ${formatRupiah(metrics.finance.estimatedDeveloperCommission)}`}
              icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
              tone="default"
            />
            <KpiCard
              label="Sisa Tagihan Pembayaran Konsumen"
              value={formatRupiah(metrics.finance.outstandingReceivablesTotal)}
              subtext={`Jatuh tempo ${formatRupiah(
                metrics.finance.overdueReceivablesAmount
              )} · ${metrics.finance.pendingVerificationCount} bukti antre`}
              icon={<FileText className="h-4 w-4" strokeWidth={1.75} />}
              tone={
                metrics.finance.overdueReceivablesAmount > 0 ? 'warning' : 'default'
              }
            />
            <KpiCard
              label="Inventaris Unit (TC-01A)"
              value={`${metrics.unitInventory.availableUnitsCount} AVAILABLE`}
              subtext={`${metrics.unitInventory.heldUnitsCount} HELD · ${metrics.unitInventory.unitsUnderContractOrBookedCount} BOOKED · ${metrics.unitInventory.unitsFullySoldCount} SOLD`}
              icon={<Building2 className="h-4 w-4" strokeWidth={1.75} />}
              tone="default"
            />
          </div>

          {/* Grid Rincian Kamus Metrik: Inventaris TC-01A + Leads | Keuangan & Pencairan KPR */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Status Inventaris (TC-01A) &amp; Komposisi Lead Aktif</CardTitle>
                  <CardDescription>
                    Unit hanya berstatus SOLD setelah lunas 100% / KPR cair penuh.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[#0F172A]">
                    <span>Inventaris Unit ({totalUnitsAll} Total)</span>
                    <span className="font-mono text-[11px] text-[#64748B]">TC-01A</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] p-3">
                      <p className="text-[11px] font-medium text-[#047857]">AVAILABLE</p>
                      <p className="mt-1 text-lg font-bold text-[#0F172A] tabular-nums">
                        {metrics.unitInventory.availableUnitsCount}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3">
                      <p className="text-[11px] font-medium text-[#B45309]">HELD (72J)</p>
                      <p className="mt-1 text-lg font-bold text-[#0F172A] tabular-nums">
                        {metrics.unitInventory.heldUnitsCount}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-3">
                      <p className="text-[11px] font-medium text-[#1D4ED8]">BOOKED</p>
                      <p className="mt-1 text-lg font-bold text-[#0F172A] tabular-nums">
                        {metrics.unitInventory.unitsUnderContractOrBookedCount}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#CBD5E1] bg-[#F1F5F9] p-3">
                      <p className="text-[11px] font-medium text-[#334155]">SOLD (100%)</p>
                      <p className="mt-1 text-lg font-bold text-[#0F172A] tabular-nums">
                        {metrics.unitInventory.unitsFullySoldCount}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-[#E2E8F0] pt-4">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[#0F172A]">
                    <span>Lead Pipeline Aktif</span>
                    <span className="tabular-nums text-[#64748B]">
                      {metrics.leads.totalActiveLeads} prospek berjalan
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5">
                      <p className="text-[11px] font-medium text-[#B91C1C]">HOT</p>
                      <p className="mt-0.5 text-base font-bold text-[#0F172A] tabular-nums">
                        {metrics.leads.hotLeadsCount}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#FED7AA] bg-[#FFF7ED] px-3 py-2.5">
                      <p className="text-[11px] font-medium text-[#C2410C]">WARM</p>
                      <p className="mt-0.5 text-base font-bold text-[#0F172A] tabular-nums">
                        {metrics.leads.warmLeadsCount}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2.5">
                      <p className="text-[11px] font-medium text-[#1D4ED8]">COLD</p>
                      <p className="mt-0.5 text-base font-bold text-[#0F172A] tabular-nums">
                        {metrics.leads.coldLeadsCount}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Komisi FIM-Property, Pembayaran Konsumen &amp; Monitoring Pencairan KPR</CardTitle>
                  <CardDescription>
                    Pembayaran konsumen dan pencairan bank adalah monitoring transaksi, bukan pendapatan FIM-Property.
                  </CardDescription>
                </div>
                <Landmark className="h-4 w-4 shrink-0 text-[#14532D]" strokeWidth={1.75} />
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="divide-y divide-[#F1F5F9] text-xs">
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-[#475569]">Total Pembayaran Konsumen Terverifikasi</dt>
                    <dd className="font-semibold text-[#0F172A] tabular-nums">
                      {formatRupiah(metrics.finance.grossVerifiedCashInflow)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-[#475569]">Refund Selesai (COMPLETED)</dt>
                    <dd className="font-semibold text-[#B91C1C] tabular-nums">
                      − {formatRupiah(metrics.finance.totalRefundedOutflow)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <dt className="font-semibold text-[#0F172A]">
                      Pembayaran Konsumen Bersih Terverifikasi
                    </dt>
                    <dd className="font-bold text-[#14532D] tabular-nums">
                      {formatRupiah(metrics.finance.netVerifiedCashInflow)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-[#475569]">Total Estimasi Komisi Developer</dt>
                    <dd className="font-semibold text-[#0F172A] tabular-nums">{formatRupiah(metrics.finance.estimatedDeveloperCommission)}</dd>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-[#475569]">Komisi Belum Diterima dari Developer</dt>
                    <dd className="font-semibold text-[#B45309] tabular-nums">{formatRupiah(metrics.finance.developerCommissionOutstanding)}</dd>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-[#475569]">Alokasi Komisi Sales / Supervisor</dt>
                    <dd className="font-semibold text-[#0F172A] tabular-nums">{formatRupiah(metrics.finance.salesCommissionAllocation)} / {formatRupiah(metrics.finance.supervisorCommissionAllocation)}</dd>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-[#475569]">Bagian Komisi Perusahaan</dt>
                    <dd className="font-semibold text-[#0F172A] tabular-nums">{formatRupiah(metrics.finance.companyCommissionAllocation)}</dd>
                  </div>
                  {isAdmin && salaryEstimate !== null && <div className="flex items-center justify-between py-2">
                    <dt className="text-[#475569]">Estimasi Beban Gaji Bulanan</dt>
                    <dd className="font-semibold text-[#0F172A] tabular-nums">{formatRupiah(salaryEstimate)}</dd>
                  </div>}
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-[#475569]">
                      Dana Hangus Dipertahankan (Forfeited)
                    </dt>
                    <dd className="font-semibold text-[#0F172A] tabular-nums">
                      {formatRupiah(metrics.finance.totalForfeitedRetainedFunds)}
                    </dd>
                  </div>
                </dl>

                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Monitoring Pencairan KPR Konsumen (SP3K / Completed)
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <span className="text-[#64748B]">Plafon KPR Konsumen</span>
                      <p className="font-semibold text-[#0F172A] tabular-nums">
                        {formatRupiah(metrics.kprDisbursementSummary.totalApprovedLoanPlafond)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[#64748B]">Cair Tahap 1 (Primary)</span>
                      <p className="font-semibold text-[#047857] tabular-nums">
                        {formatRupiah(metrics.kprDisbursementSummary.totalPrimaryDisbursed)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[#64748B]">Cair Susulan (Subsequent)</span>
                      <p className="font-semibold text-[#047857] tabular-nums">
                        {formatRupiah(
                          metrics.kprDisbursementSummary.totalSubsequentDisbursed
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="text-[#64748B]">Sisa Belum Cair</span>
                      <p className="font-semibold text-[#B45309] tabular-nums">
                        {formatRupiah(
                          metrics.kprDisbursementSummary.totalRemainingUndisbursed
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabel 1: Konversi per Sumber Lead */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Konversi per Sumber Lead</CardTitle>
                <CardDescription>
                  Perbandingan jumlah prospek, kualitas HOT, dan closing per kanal akuisisi.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {leadSourceRows.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="Belum Ada Data Prospek"
                    description="Belum ada prospek pada cakupan tim ini untuk dihitung tingkat konversinya."
                  />
                </div>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                          <th className="px-5 py-3">Sumber Lead</th>
                          <th className="px-4 py-3 text-right">Total Prospek</th>
                          <th className="px-4 py-3 text-right">Lead HOT</th>
                          <th className="px-4 py-3 text-right">Closing</th>
                          <th className="px-5 py-3 text-right">Tingkat Konversi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {leadSourceRows.map((row) => {
                          const ratePct = computeConversionRatePct(
                            row.closedWonLeads,
                            row.totalLeads
                          );
                          return (
                            <tr key={row.leadSource} className="hover:bg-[#F8FAFC]">
                              <td className="px-5 py-3 font-medium text-[#0F172A]">
                                {formatLeadSourceLabel(row.leadSource)}
                              </td>
                              <td className="px-4 py-3 text-right text-[#334155] tabular-nums">
                                {row.totalLeads}
                              </td>
                              <td className="px-4 py-3 text-right text-[#B91C1C] font-medium tabular-nums">
                                {row.hotLeads}
                              </td>
                              <td className="px-4 py-3 text-right text-[#047857] font-semibold tabular-nums">
                                {row.closedWonLeads}
                              </td>
                              <td className="px-5 py-3 text-right tabular-nums">
                                <div className="inline-flex items-center gap-2.5">
                                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#E2E8F0]">
                                    <div
                                      className="h-full rounded-full bg-[#059669]"
                                      style={{ width: `${Math.min(100, ratePct)}%` }}
                                    />
                                  </div>
                                  <span className="w-12 text-right font-semibold text-[#0F172A]">
                                    {ratePct.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card View */}
                  <div className="divide-y divide-[#E2E8F0] md:hidden">
                    {leadSourceRows.map((row) => {
                      const ratePct = computeConversionRatePct(
                        row.closedWonLeads,
                        row.totalLeads
                      );
                      return (
                        <div key={row.leadSource} className="space-y-2 p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-[#0F172A]">
                              {formatLeadSourceLabel(row.leadSource)}
                            </span>
                            <Badge tone="emerald">{ratePct.toFixed(1)}% konversi</Badge>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-[11px] text-[#475569] tabular-nums">
                            <div>
                              <span className="text-[#64748B]">Total:</span>{' '}
                              <span className="font-semibold text-[#0F172A]">
                                {row.totalLeads}
                              </span>
                            </div>
                            <div>
                              <span className="text-[#64748B]">HOT:</span>{' '}
                              <span className="font-semibold text-[#B91C1C]">
                                {row.hotLeads}
                              </span>
                            </div>
                            <div>
                              <span className="text-[#64748B]">Won:</span>{' '}
                              <span className="font-semibold text-[#047857]">
                                {row.closedWonLeads}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Tabel 2: Performa per Sales Aktif */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Performa per Sales Aktif</CardTitle>
                <CardDescription>
                  Rekap prospek aktif, jumlah closing, nilai kontrak, dan kas terverifikasi.
                </CardDescription>
              </div>
              <Users className="h-4 w-4 shrink-0 text-[#14532D]" strokeWidth={1.75} />
            </CardHeader>
            <CardContent className="p-0">
              {salesPerformanceRows.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="Belum Ada Sales Aktif"
                    description="Tidak ditemukan anggota Sales aktif dalam cakupan tim laporan ini."
                  />
                </div>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                          <th className="px-5 py-3">Nama Sales</th>
                          <th className="px-4 py-3">Tim</th>
                          <th className="px-4 py-3 text-right">Prospek (Total / HOT)</th>
                          <th className="px-4 py-3 text-right">Deal Closing</th>
                          <th className="px-4 py-3 text-right">Total Nilai Transaksi Properti</th>
                          <th className="px-5 py-3 text-right">Pembayaran Konsumen Terverifikasi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {salesPerformanceRows.map((row) => (
                          <tr key={row.salesId} className="hover:bg-[#F8FAFC]">
                            <td className="px-5 py-3 font-medium text-[#0F172A]">
                              {row.fullName}
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded bg-[#F1F5F9] px-2 py-0.5 font-mono text-[11px] font-medium text-[#334155]">
                                {row.teamCode}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#334155]">
                              {row.totalLeads}{' '}
                              <span className="text-[#B91C1C]">({row.hotLeads} HOT)</span>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-[#0F172A] tabular-nums">
                              {row.closedWonDealsCount}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-[#14532D] tabular-nums">
                              {formatRupiah(row.closedWonDealsValue)}
                            </td>
                            <td className="px-5 py-3 text-right font-semibold text-[#047857] tabular-nums">
                              {formatRupiah(row.verifiedCashInflow)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card View */}
                  <div className="divide-y divide-[#E2E8F0] md:hidden">
                    {salesPerformanceRows.map((row) => (
                      <div key={row.salesId} className="space-y-2 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#0F172A]">
                            {row.fullName}
                          </span>
                          <span className="rounded bg-[#F1F5F9] px-2 py-0.5 font-mono text-[11px] font-medium text-[#334155]">
                            {row.teamCode}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums">
                          <div>
                            <span className="text-[#64748B]">Prospek:</span>{' '}
                            <span className="font-semibold text-[#0F172A]">
                              {row.totalLeads} ({row.hotLeads} HOT)
                            </span>
                          </div>
                          <div>
                            <span className="text-[#64748B]">Closing:</span>{' '}
                            <span className="font-semibold text-[#0F172A]">
                              {row.closedWonDealsCount} unit
                            </span>
                          </div>
                          <div>
                            <span className="text-[#64748B]">Nilai Deal:</span>
                            <p className="font-semibold text-[#14532D]">
                              {formatRupiah(row.closedWonDealsValue)}
                            </p>
                          </div>
                          <div>
                            <span className="text-[#64748B]">Pembayaran Konsumen Terverifikasi:</span>
                            <p className="font-semibold text-[#047857]">
                              {formatRupiah(row.verifiedCashInflow)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: AUDIT LOGS (HANYA ADMIN) */}
      {isAdmin && activeTab === 'AUDIT' && (
        <div className="space-y-4">
          {/* Filter Bar Audit Logs */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]"
                    strokeWidth={1.75}
                  />
                  <Input
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Cari aktor, aksi, ID entitas, atau alasan..."
                    className="pl-9"
                    aria-label="Cari Audit Log"
                  />
                </div>
                <Select
                  value={actionTypeFilter}
                  onChange={(e) => setActionTypeFilter(e.target.value)}
                  options={actionTypeOptions}
                  aria-label="Filter Action Type"
                />
                <Select
                  value={entityTableFilter}
                  onChange={(e) => setEntityTableFilter(e.target.value)}
                  options={entityTableOptions}
                  aria-label="Filter Tabel Entitas"
                />
              </div>
            </CardContent>
          </Card>

          {/* Daftar Audit Logs */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Rekam Jejak Audit Sistem (Append-Only)</CardTitle>
                <CardDescription>
                  Menampilkan {filteredAuditLogs.length} dari {(auditLogs ?? []).length} catatan terbaru (maksimal 100 entri terakhir).
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredAuditLogs.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="Tidak Ada Catatan Audit"
                    description="Tidak ada catatan audit yang cocok dengan filter pencarian saat ini."
                  />
                </div>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                          <th className="px-5 py-3">Waktu (WIB)</th>
                          <th className="px-4 py-3">Aktor</th>
                          <th className="px-4 py-3">Action Type</th>
                          <th className="px-4 py-3">Entitas</th>
                          <th className="px-4 py-3">Alasan</th>
                          <th className="px-5 py-3 text-right">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {filteredAuditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-[#F8FAFC]">
                            <td className="px-5 py-3 whitespace-nowrap text-[#475569] tabular-nums">
                              {formatDateTimeID(log.createdAt)}
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-[#0F172A]">{log.actorName}</p>
                              <p className="font-mono text-[10px] text-[#64748B]">
                                {log.actorRole}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-block rounded bg-[#F0FDF4] px-2 py-0.5 font-mono text-[11px] font-medium text-[#14532D]">
                                {log.actionType}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-mono text-[11px] font-medium text-[#0F172A]">
                                {log.entityTable}
                              </p>
                              <p className="font-mono text-[10px] text-[#64748B]">
                                {log.entityId.slice(0, 8)}...
                              </p>
                            </td>
                            <td className="max-w-xs px-4 py-3 text-[#475569]">
                              <span className="line-clamp-2">{log.reason ?? '-'}</span>
                            </td>
                            <td className="px-5 py-3 text-right whitespace-nowrap">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                leftIcon={<Eye className="h-3.5 w-3.5" strokeWidth={1.75} />}
                                onClick={() => setSelectedAuditLog(log)}
                              >
                                Lihat Diff JSON
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card View */}
                  <div className="divide-y divide-[#E2E8F0] md:hidden">
                    {filteredAuditLogs.map((log) => (
                      <div key={log.id} className="space-y-2 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <span className="inline-block rounded bg-[#F0FDF4] px-2 py-0.5 font-mono text-[11px] font-medium text-[#14532D]">
                            {log.actionType}
                          </span>
                          <span className="text-[11px] text-[#64748B] tabular-nums">
                            {formatDateTimeID(log.createdAt)}
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="font-semibold text-[#0F172A]">
                            {log.actorName}
                          </span>{' '}
                          <span className="font-mono text-[11px] text-[#64748B]">
                            ({log.actorRole})
                          </span>
                        </div>
                        <p className="font-mono text-[11px] text-[#475569]">
                          {log.entityTable} · {log.entityId.slice(0, 8)}...
                        </p>
                        {log.reason && (
                          <p className="text-xs text-[#475569]">{log.reason}</p>
                        )}
                        <div className="pt-1">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            leftIcon={<Eye className="h-3.5 w-3.5" strokeWidth={1.75} />}
                            onClick={() => setSelectedAuditLog(log)}
                          >
                            Lihat Diff JSON
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Modal Perbandingan Diff JSON Audit Log */}
          <Modal
            isOpen={selectedAuditLog !== null}
            onClose={() => setSelectedAuditLog(null)}
            title={
              selectedAuditLog
                ? `Detail Audit: ${selectedAuditLog.actionType}`
                : 'Detail Audit Log'
            }
            description={
              selectedAuditLog
                ? `${selectedAuditLog.entityTable} (${selectedAuditLog.entityId}) • ${formatDateTimeID(selectedAuditLog.createdAt)}`
                : undefined
            }
            size="lg"
            footer={
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSelectedAuditLog(null)}
              >
                Tutup
              </Button>
            }
          >
            {selectedAuditLog && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-[#64748B]">Aktor:</span>
                    <p className="font-semibold text-[#0F172A]">
                      {selectedAuditLog.actorName}{' '}
                      <span className="font-mono text-[11px] font-normal text-[#475569]">
                        ({selectedAuditLog.actorRole})
                      </span>
                    </p>
                  </div>
                  <div>
                    <span className="text-[#64748B]">ID Entitas:</span>
                    <p className="font-mono text-[11px] break-all text-[#0F172A]">
                      {selectedAuditLog.entityId}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-[#64748B]">Alasan / Catatan:</span>
                    <p className="mt-0.5 text-[#0F172A]">
                      {selectedAuditLog.reason ?? '(Tidak ada catatan alasan)'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-[#B91C1C]">
                      Nilai Sebelumnya (old_values)
                    </p>
                    <pre className="max-h-72 overflow-auto rounded-lg border border-[#FECACA] bg-[#FEF2F2]/60 p-3 font-mono text-[11px] leading-relaxed text-[#0F172A]">
                      {formatJsonBlock(selectedAuditLog.oldValues)}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-[#047857]">
                      Nilai Baru (new_values)
                    </p>
                    <pre className="max-h-72 overflow-auto rounded-lg border border-[#A7F3D0] bg-[#ECFDF5]/60 p-3 font-mono text-[11px] leading-relaxed text-[#0F172A]">
                      {formatJsonBlock(selectedAuditLog.newValues)}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </Modal>
        </div>
      )}
    </div>
  );
}
