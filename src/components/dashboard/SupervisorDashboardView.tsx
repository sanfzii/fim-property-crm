// Lokasi: src/components/dashboard/SupervisorDashboardView.tsx
// View Dashboard Tim untuk Role SUPERVISOR (DESIGN.md v2.1 Bagian 7.2)

import React from 'react';
import Link from 'next/link';
import {
  Users,
  Briefcase,
  FileCheck2,
  AlertTriangle,
  Clock,
  Landmark,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Building2,
} from 'lucide-react';
import type { StandardizedExecutiveMetrics } from '@/modules/analytics/metrics.service';
import { formatRupiah, formatDateID, formatDateTimeID } from '@/lib/utils/format';
import { KpiCard } from '@/components/ui/KpiCard';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/Card';
import { Badge, DomainStatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

export interface SupervisorSalesMemberWorkload {
  salesId: string;
  fullName: string;
  email: string;
  activeLeadsCount: number;
  hotLeadsCount: number;
  warmLeadsCount: number;
  scheduledSiteVisitsCount: number;
  completedSiteVisitsCount: number;
  activeBookingsCount: number;
  overdueTasksCount: number;
}

export interface SupervisorTeamPaymentWaitItem {
  id: string;
  paymentNumber: string;
  paidAmount: number;
  submittedAt: string;
  hoursWaiting: number;
  bookingNumber: string;
  leadName: string;
  unitCode: string;
  salesName: string;
}

export interface SupervisorTeamKprAlertItem {
  id: string;
  kprNumber: string;
  bankPartnerName: string;
  currentStage: string;
  leadName: string;
  unitCode: string;
  salesName: string;
  issueSummary: string;
}

export interface SupervisorTeamScheduleAlertItem {
  id: string;
  title: string;
  scheduleType: string;
  dueDate: string;
  remainingAmount: number;
  status: string;
  bookingNumber: string;
  leadName: string;
  salesName: string;
}

export interface SupervisorPriceUpdateItem {
  id: string;
  unitId: string;
  unitCode: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  oldPrice: number;
  newPrice: number;
  deltaAmount: number;
  reason: string;
  changedByName: string;
  changedAt: string;
}

export interface SupervisorDashboardViewProps {
  supervisorName: string;
  teamName: string;
  teamCode: string;
  metrics: StandardizedExecutiveMetrics;
  activeTeamBookingsCount: number;
  teamOverdueTasksCount: number;
  memberWorkloads: SupervisorSalesMemberWorkload[];
  waitingTeamPayments: SupervisorTeamPaymentWaitItem[];
  teamKprAlerts: SupervisorTeamKprAlertItem[];
  teamScheduleAlerts: SupervisorTeamScheduleAlertItem[];
  recentPriceUpdates: SupervisorPriceUpdateItem[];
}

export function SupervisorDashboardView({
  supervisorName,
  teamName,
  teamCode,
  metrics,
  activeTeamBookingsCount,
  teamOverdueTasksCount,
  memberWorkloads,
  waitingTeamPayments,
  teamKprAlerts,
  teamScheduleAlerts,
  recentPriceUpdates,
}: SupervisorDashboardViewProps) {
  return (
    <div className="space-y-6">
      {/* Header Tim Aktif */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Dashboard Tim
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            {supervisorName} • {teamName} ({teamCode})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/leads"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#14532D] px-3.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#0F3F22]"
          >
            <span>Kelola Leads</span>
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Link>
        </div>
      </div>

      {/* 4 Kartu KPI Tim */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Lead Aktif Tim"
          value={`${metrics.leads.totalActiveLeads} Prospek`}
          subtext={`HOT 75–100: ${metrics.leads.hotLeadsCount} • WARM 45–74: ${metrics.leads.warmLeadsCount} • COLD 0–44: ${metrics.leads.coldLeadsCount}`}
          icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />

        <KpiCard
          label="Closing Tim"
          value={`${metrics.salesAndContracts.salesClosingsCount} Unit`}
          subtext={`Total Nilai Transaksi Properti: ${formatRupiah(metrics.salesAndContracts.totalContractedSalesValue)}`}
          icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
        />

        <KpiCard
          label="Booking Aktif Tim"
          value={`${activeTeamBookingsCount} Booking`}
          subtext={`${metrics.salesAndContracts.activeUnderContractCount} Kontrak Aktif`}
          icon={<FileCheck2 className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />

        <KpiCard
          label="Tugas Overdue Tim"
          value={`${teamOverdueTasksCount} Tugas`}
          subtext={`Tagihan Pembayaran Konsumen Terlambat: ${formatRupiah(metrics.finance.overdueReceivablesAmount)}`}
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />}
          tone={teamOverdueTasksCount > 0 ? 'error' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Estimasi Komisi Closing Tim" value={formatRupiah(metrics.finance.estimatedDeveloperCommission)} subtext={metrics.finance.closedDealsWithoutCommissionConfig > 0 ? `${metrics.finance.closedDealsWithoutCommissionConfig} closing belum dikonfigurasi` : 'Komisi developer sesuai snapshot Deal'} icon={<Landmark className="h-4 w-4" />} />
        <KpiCard label="Alokasi Komisi Sales Tim" value={formatRupiah(metrics.finance.salesCommissionAllocation)} subtext="Alokasi, belum berarti dibayarkan" icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Alokasi Komisi Supervisor" value={formatRupiah(metrics.finance.supervisorCommissionAllocation)} subtext="Untuk Supervisor tim closing" icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Komisi Developer Belum Diterima" value={formatRupiah(metrics.finance.developerCommissionOutstanding)} subtext={`Diterima ${formatRupiah(metrics.finance.developerCommissionReceived)}`} icon={<Landmark className="h-4 w-4" />} />
      </div>

      {/* Tabel Beban Kerja & Aktivitas Anggota Sales Tim */}
      <Card>
        <CardHeader>
          <CardTitle>Aktivitas Anggota Sales ({teamName})</CardTitle>
          <Badge tone="forest">{memberWorkloads.length} Sales Aktif</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {memberWorkloads.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Belum Ada Anggota Sales di Tim Ini"
                description="Hubungi Admin untuk menugaskan anggota Sales ke dalam tim Anda."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                    <th className="px-4 py-3">Nama Anggota Sales</th>
                    <th className="px-4 py-3 text-right">Lead Aktif</th>
                    <th className="px-4 py-3 text-right">Komposisi HOT / WARM</th>
                    <th className="px-4 py-3 text-right">Survei (Terjadwal / Selesai)</th>
                    <th className="px-4 py-3 text-right">Booking Aktif</th>
                    <th className="px-4 py-3 text-right">Tugas Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {memberWorkloads.map((m) => (
                    <tr key={m.salesId} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#0F172A]">{m.fullName}</p>
                        <p className="text-[11px] text-[#64748B]">{m.email}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#0F172A] tabular-nums">
                        {m.activeLeadsCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone="red">{m.hotLeadsCount} HOT</Badge>
                          <Badge tone="orange">{m.warmLeadsCount} WARM</Badge>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[#475569] tabular-nums">
                        <span className="font-semibold text-[#0F172A]">
                          {m.scheduledSiteVisitsCount}
                        </span>{' '}
                        Terjadwal •{' '}
                        <span className="font-semibold text-[#047857]">
                          {m.completedSiteVisitsCount}
                        </span>{' '}
                        Selesai
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#1D4ED8] tabular-nums">
                        {m.activeBookingsCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {m.overdueTasksCount > 0 ? (
                          <Badge tone="red">{m.overdueTasksCount} Overdue</Badge>
                        ) : (
                          <Badge tone="emerald">0 Overdue</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panel Peringatan SLA & Progres Transaksi Tim (Read-Only Monitoring) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Bukti Bayar Nasabah Tim yang Tertahan di Verifikasi Admin */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#B45309]" strokeWidth={1.75} />
              <CardTitle>Monitor SLA Verifikasi Pembayaran Tim</CardTitle>
            </div>
            <Badge tone="amber">{waitingTeamPayments.length} Menunggu Admin</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {waitingTeamPayments.length === 0 ? (
              <EmptyState
                title="Tidak Ada Bukti Bayar Tertahan"
                description="Seluruh bukti pembayaran dari nasabah tim Anda sudah diverifikasi Admin."
              />
            ) : (
              waitingTeamPayments.map((wp) => (
                <div
                  key={wp.id}
                  className="flex flex-col justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 sm:flex-row sm:items-center"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[#0F172A]">
                        {wp.paymentNumber}
                      </span>
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#334155] ring-1 ring-[#E2E8F0]">
                        {wp.unitCode}
                      </span>
                      {wp.hoursWaiting >= 48 ? (
                        <Badge tone="red">ESKALASI &gt; 48J ({wp.hoursWaiting}j)</Badge>
                      ) : wp.hoursWaiting >= 24 ? (
                        <Badge tone="amber">SLA &gt; 24J ({wp.hoursWaiting}j)</Badge>
                      ) : (
                        <Badge tone="blue">{wp.hoursWaiting} Jam</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-medium text-[#0F172A]">
                      {wp.leadName}{' '}
                      <span className="font-normal text-[#64748B]">
                        • PIC: {wp.salesName}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#64748B] tabular-nums">
                      Diunggah: {formatDateTimeID(wp.submittedAt)}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="font-mono text-sm font-bold text-[#0F172A] tabular-nums">
                      {formatRupiah(wp.paidAmount)}
                    </p>
                    <p className="text-[11px] text-[#64748B]">Read-Only (Wewenang Admin)</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Pengajuan KPR & Jadwal Tagihan Tim yang Membutuhkan Tindak Lanjut */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
              <CardTitle>Peringatan Berkas KPR &amp; Tagihan Nasabah Tim</CardTitle>
            </div>
            <Badge tone="red">
              {teamKprAlerts.length + teamScheduleAlerts.length} Perlu Perhatian
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {teamKprAlerts.length === 0 && teamScheduleAlerts.length === 0 ? (
              <EmptyState
                title="Berkas KPR & Tagihan Tim Terkendali"
                description="Tidak ada dokumen KPR yang menunggu revisi maupun jadwal tagihan yang terlambat."
              />
            ) : (
              <>
                {teamKprAlerts.map((ka) => (
                  <div
                    key={ka.id}
                    className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB]/60 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-[#0F172A]">
                        {ka.kprNumber} • {ka.bankPartnerName}
                      </span>
                      <DomainStatusBadge value={ka.currentStage} />
                    </div>
                    <p className="mt-1 text-xs font-medium text-[#0F172A]">
                      {ka.leadName} ({ka.unitCode}) • PIC: {ka.salesName}
                    </p>
                    <p className="mt-1 text-xs text-[#B45309]">{ka.issueSummary}</p>
                  </div>
                ))}

                {teamScheduleAlerts.map((sa) => (
                  <div
                    key={sa.id}
                    className="flex flex-col justify-between gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2]/50 p-3.5 sm:flex-row sm:items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#0F172A]">
                          {sa.bookingNumber}
                        </span>
                        <DomainStatusBadge value={sa.status} />
                      </div>
                      <p className="mt-1 text-xs font-medium text-[#0F172A]">
                        {sa.title} — {sa.leadName}
                      </p>
                      <p className="text-[11px] text-[#64748B]">
                        Jatuh Tempo: {formatDateID(sa.dueDate)} • PIC: {sa.salesName}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="font-mono text-sm font-bold text-[#B91C1C] tabular-nums">
                        {formatRupiah(sa.remainingAmount)}
                      </p>
                      <p className="text-[11px] text-[#64748B]">Sisa Tagihan</p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Panel Perubahan Harga Unit */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
            <CardTitle>Perubahan Harga Unit</CardTitle>
          </div>
          <Link
            href="/catalog"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-semibold text-[#0F172A] transition-colors hover:bg-[#F8FAFC]"
          >
            <span>Buka Katalog</span>
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {recentPriceUpdates.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Belum Ada Perubahan Harga"
                description="Riwayat penyesuaian harga unit oleh Admin akan tampil di sini."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                    <th className="px-4 py-3">Unit &amp; Proyek</th>
                    <th className="px-4 py-3 text-right">Harga Lama</th>
                    <th className="px-4 py-3 text-right">Harga Baru</th>
                    <th className="px-4 py-3 text-right">Selisih</th>
                    <th className="px-4 py-3">Alasan</th>
                    <th className="px-4 py-3">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {recentPriceUpdates.map((item) => {
                    const isIncrease = item.deltaAmount > 0;
                    return (
                      <tr key={item.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-4 py-3">
                          <p className="font-mono font-semibold text-[#0F172A]">
                            {item.unitCode}
                          </p>
                          <p className="text-[11px] text-[#64748B]">
                            {item.projectName} ({item.projectCode})
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[#64748B] line-through tabular-nums">
                          {formatRupiah(item.oldPrice)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-[#0F172A] tabular-nums">
                          {formatRupiah(item.newPrice)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-xs font-semibold ${
                              isIncrease ? 'text-[#B45309]' : 'text-[#047857]'
                            }`}
                          >
                            {isIncrease ? (
                              <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                            ) : (
                              <TrendingDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                            )}
                            {isIncrease ? '+' : ''}
                            {formatRupiah(item.deltaAmount)}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-[280px] text-[#475569]">
                          <p className="line-clamp-2">{item.reason}</p>
                          <p className="mt-0.5 text-[11px] text-[#64748B]">
                            Oleh: {item.changedByName}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-[#475569] tabular-nums">
                          {formatDateTimeID(item.changedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
