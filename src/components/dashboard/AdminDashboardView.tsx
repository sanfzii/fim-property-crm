// Lokasi: src/components/dashboard/AdminDashboardView.tsx
// View Dashboard Operasional & Eksekutif untuk Role ADMIN (DESIGN.md v2.1 Bagian 7.1)

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Wallet,
  AlertTriangle,
  Clock,
  Building2,
  Landmark,
  Users,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-react';
import type { StandardizedExecutiveMetrics } from '@/modules/analytics/metrics.service';
import { formatRupiah, formatDateTimeID } from '@/lib/utils/format';
import { KpiCard } from '@/components/ui/KpiCard';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/Card';
import {
  Badge,
  DomainStatusBadge,
  LeadTemperatureBadge,
  UnitStatusBadge,
} from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

export interface AdminPendingPaymentItem {
  id: string;
  paymentNumber: string;
  paidAmount: number;
  channel: string;
  submittedAt: string;
  hoursWaiting: number;
  bookingNumber: string;
  leadName: string;
  unitCode: string;
}

export interface AdminExpiringBookingItem {
  id: string;
  bookingNumber: string;
  bookingFeeAmount: number;
  expiresAt: string;
  hoursRemaining: number;
  leadName: string;
  unitCode: string;
  salesName: string;
}

export interface AdminPendingKprDocItem {
  id: string;
  documentLabel: string;
  status: string;
  updatedAt: string;
  kprNumber: string;
  bankPartnerName: string;
  leadName: string;
  unitCode: string;
}

export interface AdminPendingRefundItem {
  id: string;
  refundNumber: string;
  refundAmount: number;
  bankName: string;
  bankAccountHolder: string;
  createdAt: string;
  bookingNumber: string;
  leadName: string;
  unitCode: string;
}

export interface AdminTeamSummaryItem {
  teamId: string;
  teamCode: string;
  teamName: string;
  activeLeadsCount: number;
  hotLeadsCount: number;
  activeBookingsCount: number;
  closedWonCount: number;
  closedWonValue: number;
}

export interface AdminDashboardViewProps {
  adminFullName: string;
  metrics: StandardizedExecutiveMetrics;
  salaryEstimate: number;
  pendingPayments: AdminPendingPaymentItem[];
  expiringBookings: AdminExpiringBookingItem[];
  pendingKprDocs: AdminPendingKprDocItem[];
  pendingRefunds: AdminPendingRefundItem[];
  teamSummaries: AdminTeamSummaryItem[];
}

type QueueTabKey = 'payments' | 'bookings' | 'kpr_docs' | 'refunds';

export function AdminDashboardView({
  adminFullName,
  metrics,
  salaryEstimate,
  pendingPayments,
  expiringBookings,
  pendingKprDocs,
  pendingRefunds,
  teamSummaries,
}: AdminDashboardViewProps) {
  const [activeTab, setActiveTab] = useState<QueueTabKey>('payments');

  const sla48Count = pendingPayments.filter((p) => p.hoursWaiting >= 48).length;
  const sla24Count = pendingPayments.filter(
    (p) => p.hoursWaiting >= 24 && p.hoursWaiting < 48
  ).length;

  const totalUnits =
    metrics.unitInventory.availableUnitsCount +
    metrics.unitInventory.heldUnitsCount +
    metrics.unitInventory.unitsUnderContractOrBookedCount +
    metrics.unitInventory.unitsFullySoldCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Dashboard
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            {adminFullName} • Ringkasan transaksi, kas, dan performa tim
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/payments"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#14532D] px-3.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#0F3F22]"
          >
            <span>Antrean Pembayaran</span>
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Link>
        </div>
      </div>

      {/* 4 Kartu KPI Utama */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Nilai Transaksi Properti"
          value={formatRupiah(metrics.salesAndContracts.totalContractedSalesValue)}
          subtext={`${metrics.salesAndContracts.salesClosingsCount} Closing • ${metrics.salesAndContracts.activeUnderContractCount} Kontrak Aktif`}
          icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />

        <KpiCard
          label="Komisi Diterima dari Developer"
          value={formatRupiah(metrics.finance.developerCommissionReceived)}
          subtext={metrics.finance.closedDealsWithoutCommissionConfig > 0 ? `Estimasi: ${formatRupiah(metrics.finance.estimatedDeveloperCommission)} • ${metrics.finance.closedDealsWithoutCommissionConfig} closing belum dikonfigurasi` : `Estimasi: ${formatRupiah(metrics.finance.estimatedDeveloperCommission)}`}
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
        />

        <KpiCard
          label="Komisi Belum Diterima"
          value={formatRupiah(metrics.finance.developerCommissionOutstanding)}
          subtext="Sisa komisi developer"
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />}
          tone={metrics.finance.overdueReceivablesAmount > 0 ? 'warning' : 'default'}
        />

        <KpiCard
          label="Antrean Verifikasi Pembayaran"
          value={`${metrics.finance.pendingVerificationCount} Bukti`}
          subtext={
            sla48Count > 0
              ? `${sla48Count} Eskalasi > 48 Jam • ${sla24Count} > 24 Jam`
              : sla24Count > 0
                ? `${sla24Count} Melewati SLA > 24 Jam`
                : 'Seluruh bukti dalam batas SLA normal'
          }
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
          tone={
            metrics.finance.pendingVerificationCount > 0 || sla48Count > 0
              ? 'error'
              : 'default'
          }
          badge={
            sla48Count > 0 ? (
              <Badge tone="red">ESKALASI &gt; 48J</Badge>
            ) : sla24Count > 0 ? (
              <Badge tone="amber">SLA &gt; 24J</Badge>
            ) : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Alokasi Komisi Sales" value={formatRupiah(metrics.finance.salesCommissionAllocation)} subtext="Alokasi transaksi closing" icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Alokasi Komisi Supervisor" value={formatRupiah(metrics.finance.supervisorCommissionAllocation)} subtext="Untuk supervisor tim closing" icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Bagian Komisi Perusahaan" value={formatRupiah(metrics.finance.companyCommissionAllocation)} subtext="Belum dikurangi seluruh biaya operasional" icon={<Wallet className="h-4 w-4" />} />
        <KpiCard label="Estimasi Beban Gaji Bulanan" value={formatRupiah(salaryEstimate)} subtext="Perkiraan staf aktif, bukan pembayaran gaji" icon={<Wallet className="h-4 w-4" />} />
        <KpiCard label="Pembayaran Konsumen Terverifikasi" value={formatRupiah(metrics.finance.consumerPaymentsVerified)} subtext="Monitoring transaksi konsumen, bukan pendapatan FIM-Property" icon={<Wallet className="h-4 w-4" />} />
      </div>

      {/* Panel Antrean Tindakan Admin */}
      <Card>
        <CardHeader>
          <CardTitle>Antrean Tindakan</CardTitle>
          <div className="flex shrink-0 flex-wrap gap-1.5 pt-2 sm:pt-0">
            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'payments'
                  ? 'bg-[#14532D] text-white'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              <span>Bukti Bayar</span>
              <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[11px] tabular-nums">
                {pendingPayments.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('bookings')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'bookings'
                  ? 'bg-[#14532D] text-white'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              <span>Booking 72 Jam</span>
              <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[11px] tabular-nums">
                {expiringBookings.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('kpr_docs')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'kpr_docs'
                  ? 'bg-[#14532D] text-white'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              <span>Dokumen KPR</span>
              <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[11px] tabular-nums">
                {pendingKprDocs.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('refunds')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'refunds'
                  ? 'bg-[#14532D] text-white'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              <span>Refund Pending</span>
              <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[11px] tabular-nums">
                {pendingRefunds.length}
              </span>
            </button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {activeTab === 'payments' && (
            <div>
              {pendingPayments.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="Tidak Ada Antrean Bukti Pembayaran"
                    description="Seluruh bukti pembayaran nasabah telah diverifikasi oleh Admin."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                        <th className="px-4 py-3">No. Pembayaran</th>
                        <th className="px-4 py-3">Booking &amp; Unit</th>
                        <th className="px-4 py-3">Calon Pembeli</th>
                        <th className="px-4 py-3">Kanal</th>
                        <th className="px-4 py-3 text-right">Nominal Dibayar</th>
                        <th className="px-4 py-3">Waktu Unggah</th>
                        <th className="px-4 py-3">Status SLA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {pendingPayments.map((item) => (
                        <tr key={item.id} className="hover:bg-[#F8FAFC]">
                          <td className="px-4 py-3 font-mono font-semibold text-[#0F172A] tabular-nums">
                            {item.paymentNumber}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono font-medium text-[#0F172A]">
                              {item.bookingNumber}
                            </span>
                            <span className="ml-1.5 rounded bg-[#F1F5F9] px-1.5 py-0.5 font-mono text-[11px] text-[#334155]">
                              {item.unitCode}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-[#0F172A]">
                            {item.leadName}
                          </td>
                          <td className="px-4 py-3 text-[#475569]">{item.channel}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#0F172A] tabular-nums">
                            {formatRupiah(item.paidAmount)}
                          </td>
                          <td className="px-4 py-3 text-[#475569] tabular-nums">
                            {formatDateTimeID(item.submittedAt)}
                          </td>
                          <td className="px-4 py-3">
                            {item.hoursWaiting >= 48 ? (
                              <Badge
                                tone="red"
                                icon={
                                  <ShieldAlert
                                    className="h-3.5 w-3.5"
                                    strokeWidth={1.75}
                                  />
                                }
                              >
                                ESKALASI &gt; 48 JAM ({item.hoursWaiting}j)
                              </Badge>
                            ) : item.hoursWaiting >= 24 ? (
                              <Badge
                                tone="amber"
                                icon={<Clock className="h-3.5 w-3.5" strokeWidth={1.75} />}
                              >
                                SLA &gt; 24 JAM ({item.hoursWaiting}j)
                              </Badge>
                            ) : (
                              <Badge tone="blue">Menunggu ({item.hoursWaiting}j)</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'bookings' && (
            <div>
              {expiringBookings.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="Tidak Ada Booking Menunggu Booking Fee"
                    description="Tidak ada reservasi unit yang sedang berada dalam masa tunggu 72 jam."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                        <th className="px-4 py-3">No. Booking</th>
                        <th className="px-4 py-3">Unit</th>
                        <th className="px-4 py-3">Calon Pembeli</th>
                        <th className="px-4 py-3">Sales PIC</th>
                        <th className="px-4 py-3 text-right">Booking Fee</th>
                        <th className="px-4 py-3">Batas Waktu 72 Jam</th>
                        <th className="px-4 py-3">Sisa Waktu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {expiringBookings.map((b) => (
                        <tr key={b.id} className="hover:bg-[#F8FAFC]">
                          <td className="px-4 py-3 font-mono font-semibold text-[#0F172A]">
                            {b.bookingNumber}
                          </td>
                          <td className="px-4 py-3 font-mono font-medium text-[#14532D]">
                            {b.unitCode}
                          </td>
                          <td className="px-4 py-3 font-medium text-[#0F172A]">
                            {b.leadName}
                          </td>
                          <td className="px-4 py-3 text-[#475569]">{b.salesName}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#0F172A] tabular-nums">
                            {formatRupiah(b.bookingFeeAmount)}
                          </td>
                          <td className="px-4 py-3 text-[#475569] tabular-nums">
                            {formatDateTimeID(b.expiresAt)}
                          </td>
                          <td className="px-4 py-3">
                            {b.hoursRemaining <= 0 ? (
                              <Badge tone="red">Siap Dilepas (Expired)</Badge>
                            ) : b.hoursRemaining <= 24 ? (
                              <Badge tone="amber">Sisa {b.hoursRemaining} Jam</Badge>
                            ) : (
                              <Badge tone="blue">Sisa {b.hoursRemaining} Jam</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'kpr_docs' && (
            <div>
              {pendingKprDocs.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="Tidak Ada Dokumen KPR Menunggu Pemeriksaan"
                    description="Seluruh dokumen persyaratan KPR nasabah telah diperiksa."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                        <th className="px-4 py-3">No. KPR &amp; Bank</th>
                        <th className="px-4 py-3">Calon Pembeli &amp; Unit</th>
                        <th className="px-4 py-3">Jenis Dokumen</th>
                        <th className="px-4 py-3">Pembaruan Terakhir</th>
                        <th className="px-4 py-3">Status Dokumen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {pendingKprDocs.map((doc) => (
                        <tr key={doc.id} className="hover:bg-[#F8FAFC]">
                          <td className="px-4 py-3">
                            <p className="font-mono font-semibold text-[#0F172A]">
                              {doc.kprNumber}
                            </p>
                            <p className="text-[11px] text-[#64748B]">
                              {doc.bankPartnerName}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-[#0F172A]">{doc.leadName}</p>
                            <p className="font-mono text-[11px] text-[#64748B]">
                              {doc.unitCode}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-[#0F172A]">
                              {doc.documentLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#475569] tabular-nums">
                            {formatDateTimeID(doc.updatedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <DomainStatusBadge value={doc.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'refunds' && (
            <div>
              {pendingRefunds.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="Tidak Ada Antrean Refund Pending"
                    description="Seluruh transaksi pengembalian dana (Refund) telah diselesaikan."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                        <th className="px-4 py-3">No. Refund</th>
                        <th className="px-4 py-3">Booking &amp; Unit</th>
                        <th className="px-4 py-3">Calon Pembeli</th>
                        <th className="px-4 py-3">Rekening Tujuan</th>
                        <th className="px-4 py-3 text-right">Nominal Refund</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {pendingRefunds.map((rf) => (
                        <tr key={rf.id} className="hover:bg-[#F8FAFC]">
                          <td className="px-4 py-3 font-mono font-semibold text-[#0F172A]">
                            {rf.refundNumber}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono font-medium text-[#0F172A]">
                              {rf.bookingNumber}
                            </span>
                            <span className="ml-1.5 font-mono text-[11px] text-[#64748B]">
                              ({rf.unitCode})
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-[#0F172A]">
                            {rf.leadName}
                          </td>
                          <td className="px-4 py-3 text-[#475569]">
                            {rf.bankName} • a.n. {rf.bankAccountHolder}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-[#0F172A] tabular-nums">
                            {formatRupiah(rf.refundAmount)}
                          </td>
                          <td className="px-4 py-3">
                            <DomainStatusBadge value="PENDING_REFUND" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grid Inventaris Unit (TC-01A) & Ringkasan Pencairan KPR */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
              <CardTitle>Status Unit Properti</CardTitle>
            </div>
            <span className="text-xs font-semibold text-[#64748B] tabular-nums">
              Total {totalUnits} Unit
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5]/60 p-3.5">
                <UnitStatusBadge status="AVAILABLE" />
                <p className="mt-2 text-2xl font-bold text-[#047857] tabular-nums">
                  {metrics.unitInventory.availableUnitsCount}
                </p>
                <p className="mt-0.5 text-[11px] text-[#047857]">Siap jual</p>
              </div>

              <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB]/60 p-3.5">
                <UnitStatusBadge status="HELD" />
                <p className="mt-2 text-2xl font-bold text-[#B45309] tabular-nums">
                  {metrics.unitInventory.heldUnitsCount}
                </p>
                <p className="mt-0.5 text-[11px] text-[#B45309]">Tahan 72 Jam</p>
              </div>

              <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF]/60 p-3.5">
                <UnitStatusBadge status="BOOKED" />
                <p className="mt-2 text-2xl font-bold text-[#1D4ED8] tabular-nums">
                  {metrics.unitInventory.unitsUnderContractOrBookedCount}
                </p>
                <p className="mt-0.5 text-[11px] text-[#1D4ED8]">
                  Kontrak / KPR &lt; 100%
                </p>
              </div>

              <div className="rounded-lg border border-[#CBD5E1] bg-[#F1F5F9] p-3.5">
                <UnitStatusBadge status="SOLD" />
                <p className="mt-2 text-2xl font-bold text-[#0F172A] tabular-nums">
                  {metrics.unitInventory.unitsFullySoldCount}
                </p>
                <p className="mt-0.5 text-[11px] text-[#475569]">
                  Lunas / Cair 100%
                </p>
              </div>
            </div>

            <p className="text-xs text-[#64748B]">
              Status SOLD berlaku saat lunas / pencairan KPR 100% (TC-01A).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
              <CardTitle>Monitoring Pencairan KPR Konsumen</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                <p className="text-xs font-medium text-[#64748B]">
                  Total Plafon KPR Konsumen
                </p>
                <p className="mt-1 text-lg font-bold text-[#0F172A] tabular-nums">
                  {formatRupiah(metrics.kprDisbursementSummary.totalApprovedLoanPlafond)}
                </p>
              </div>

              <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5]/50 p-3.5">
                <p className="text-xs font-medium text-[#047857]">
                  Pencairan Utama (Primary / Akad)
                </p>
                <p className="mt-1 text-lg font-bold text-[#047857] tabular-nums">
                  {formatRupiah(metrics.kprDisbursementSummary.totalPrimaryDisbursed)}
                </p>
              </div>

              <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF]/50 p-3.5">
                <p className="text-xs font-medium text-[#1D4ED8]">
                  Pencairan Bertahap / Retensi (Subsequent)
                </p>
                <p className="mt-1 text-lg font-bold text-[#1D4ED8] tabular-nums">
                  {formatRupiah(metrics.kprDisbursementSummary.totalSubsequentDisbursed)}
                </p>
              </div>

              <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB]/50 p-3.5">
                <p className="text-xs font-medium text-[#B45309]">
                  Sisa Plafon Belum Cair (Undisbursed)
                </p>
                <p className="mt-1 text-lg font-bold text-[#B45309] tabular-nums">
                  {formatRupiah(
                    metrics.kprDisbursementSummary.totalRemainingUndisbursed
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-xs">
              <span className="font-medium text-[#475569]">
                Dana Hangus Ditahan Perusahaan (Cancelled Forfeited Funds)
              </span>
              <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                {formatRupiah(metrics.finance.totalForfeitedRetainedFunds)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ringkasan Performa Tim & Distribusi Temperatur Lead */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
              <CardTitle>Performa Tim Penjualan</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                    <th className="px-4 py-3">Tim Penjualan</th>
                    <th className="px-4 py-3 text-right">Lead Aktif</th>
                    <th className="px-4 py-3 text-right">Prospek HOT</th>
                    <th className="px-4 py-3 text-right">Booking Aktif</th>
                    <th className="px-4 py-3 text-right">Closing (WON)</th>
                    <th className="px-4 py-3 text-right">Total Nilai Transaksi Properti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {teamSummaries.map((team) => (
                    <tr key={team.teamId} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#0F172A]">{team.teamName}</p>
                        <p className="font-mono text-[11px] text-[#64748B]">
                          {team.teamCode}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#0F172A] tabular-nums">
                        {team.activeLeadsCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <Badge tone="red">{team.hotLeadsCount} HOT</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-[#0F172A] tabular-nums">
                        {team.activeBookingsCount}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#047857] tabular-nums">
                        {team.closedWonCount} Unit
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#0F172A] tabular-nums">
                        {formatRupiah(team.closedWonValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Temperatur Prospek</CardTitle>
            <span className="text-xs font-semibold text-[#64748B] tabular-nums">
              {metrics.leads.totalActiveLeads} Aktif
            </span>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div className="flex items-center justify-between rounded-lg border border-[#FECACA] bg-[#FEF2F2]/60 p-3.5">
              <div>
                <LeadTemperatureBadge temperature="HOT" />
                <p className="mt-1 text-xs text-[#475569]">Skor 75–100</p>
              </div>
              <span className="text-2xl font-bold text-[#B91C1C] tabular-nums">
                {metrics.leads.hotLeadsCount}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[#FED7AA] bg-[#FFF7ED]/60 p-3.5">
              <div>
                <LeadTemperatureBadge temperature="WARM" />
                <p className="mt-1 text-xs text-[#475569]">Skor 45–74</p>
              </div>
              <span className="text-2xl font-bold text-[#C2410C] tabular-nums">
                {metrics.leads.warmLeadsCount}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[#BFDBFE] bg-[#EFF6FF]/60 p-3.5">
              <div>
                <LeadTemperatureBadge temperature="COLD" />
                <p className="mt-1 text-xs text-[#475569]">Skor 0–44</p>
              </div>
              <span className="text-2xl font-bold text-[#1D4ED8] tabular-nums">
                {metrics.leads.coldLeadsCount}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
