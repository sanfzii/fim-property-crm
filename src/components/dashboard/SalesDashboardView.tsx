// Lokasi: src/components/dashboard/SalesDashboardView.tsx
// View Dashboard Operasional Harian untuk Role SALES (DESIGN.md v2.1 Bagian 7.3)

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  CalendarClock,
  FileCheck2,
  Briefcase,
  CheckCircle2,
  MapPin,
  ArrowUpRight,
  Landmark,
  CreditCard,
  Clock,
  Building2,
  TrendingUp,
  TrendingDown,
  MessageSquare,
} from 'lucide-react';
import type { StandardizedExecutiveMetrics } from '@/modules/analytics/metrics.service';
import { formatRupiah, formatDateTimeID } from '@/lib/utils/format';
import { completeFollowUpTaskAction } from '@/modules/crm/crm.actions';
import { KpiCard } from '@/components/ui/KpiCard';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/Card';
import { Badge, DomainStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/ToastProvider';

export interface SalesFollowUpTaskItem {
  id: string;
  leadId: string;
  leadName: string;
  leadTemperature: string;
  title: string;
  description: string | null;
  dueAt: string;
  priority: string;
  status: string;
  taskSource: string;
  relatedScheduleTitle: string | null;
  relatedKprNumber: string | null;
}

export interface SalesSiteVisitItem {
  id: string;
  leadId: string;
  leadName: string;
  projectName: string;
  unitCode: string | null;
  scheduledAt: string;
  status: string;
  preparationNotes: string | null;
}

export interface SalesKprDocStatusItem {
  id: string;
  kprNumber: string;
  bankPartnerName: string;
  currentStage: string;
  leadName: string;
  unitCode: string;
  revisionDocsCount: number;
  missingDocsCount: number;
  uploadedDocsCount: number;
}

export interface SalesPaymentStatusItem {
  id: string;
  paymentNumber: string;
  paidAmount: number;
  verificationStatus: string;
  rejectionReason: string | null;
  submittedAt: string;
  bookingNumber: string;
  leadName: string;
  unitCode: string;
}

export interface SalesPendingBookingHoldItem {
  id: string;
  bookingNumber: string;
  bookingFeeAmount: number;
  expiresAt: string;
  hoursRemaining: number;
  leadName: string;
  unitCode: string;
}

export interface SalesImpactedLeadItem {
  id: string;
  fullName: string;
  phone: string;
  leadTemperature: string;
  pipelineStage: string;
  budgetAmount: number;
}

export interface SalesPriceUpdateItem {
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
  impactedLeads: SalesImpactedLeadItem[];
}

export interface SalesDashboardViewProps {
  salesFullName: string;
  teamName: string;
  teamCode: string;
  metrics: StandardizedExecutiveMetrics;
  activeBookingsCount: number;
  followUpTasks: SalesFollowUpTaskItem[];
  siteVisits: SalesSiteVisitItem[];
  kprStatusItems: SalesKprDocStatusItem[];
  paymentStatusItems: SalesPaymentStatusItem[];
  pendingHoldBookings: SalesPendingBookingHoldItem[];
  recentPriceUpdates: SalesPriceUpdateItem[];
}

function buildWhatsAppFollowUpUrl(params: {
  phone: string;
  leadName: string;
  salesName: string;
  projectName: string;
  unitCode: string;
  newPrice: number;
}): string {
  const digits = params.phone.replace(/[^0-9]/g, '');
  const normalizedPhone = digits.startsWith('0')
    ? `62${digits.slice(1)}`
    : digits.startsWith('62')
      ? digits
      : `62${digits}`;
  const text = `Halo Bapak/Ibu ${params.leadName}, saya ${params.salesName} dari PT FIM-Property. Menginformasikan pembaruan harga katalog terkini untuk proyek ${params.projectName} (Unit ${params.unitCode}: ${formatRupiah(params.newPrice)}). Apakah Bapak/Ibu berkenan berdiskusi lebih lanjut mengenai ketersediaan unit? Terima kasih.`;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(text)}`;
}

export function SalesDashboardView({
  salesFullName,
  teamName,
  teamCode,
  metrics,
  activeBookingsCount,
  followUpTasks,
  siteVisits,
  kprStatusItems,
  paymentStatusItems,
  pendingHoldBookings,
  recentPriceUpdates,
}: SalesDashboardViewProps) {
  const router = useRouter();
  const { showToast } = useToast();

  const [selectedTask, setSelectedTask] = useState<SalesFollowUpTaskItem | null>(
    null
  );
  const [completionNotes, setCompletionNotes] = useState(
    'Nasabah telah dihubungi dan konfirmasi tindak lanjut selesai.'
  );
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);

  const overdueTasksCount = followUpTasks.filter(
    (t) => t.status === 'OVERDUE'
  ).length;
  const scheduledVisitsCount = siteVisits.filter(
    (v) => v.status === 'SCHEDULED' || v.status === 'RESCHEDULED'
  ).length;

  const handleCompleteTask = async () => {
    if (!selectedTask || isSubmittingTask) return;
    setIsSubmittingTask(true);
    try {
      const result = await completeFollowUpTaskAction({
        taskId: selectedTask.id,
        completionNotes,
      });

      if (result.success) {
        showToast({
          title: 'Tugas Follow-Up Selesai',
          description: result.message,
          tone: 'success',
        });
        setSelectedTask(null);
        router.refresh();
      } else {
        showToast({
          title: 'Gagal Menyelesaikan Tugas',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      showToast({
        title: 'Gangguan Jaringan',
        description: 'Tidak dapat menghubungi server saat menyimpan tugas.',
        tone: 'error',
      });
    } finally {
      setIsSubmittingTask(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Personal Sales */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Ringkasan Kerja
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            {salesFullName} • {teamName} ({teamCode})
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

      {/* 4 Kartu KPI Pribadi */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Lead Aktif Saya"
          value={`${metrics.leads.totalActiveLeads} Prospek`}
          subtext={`HOT 75–100: ${metrics.leads.hotLeadsCount} • WARM 45–74: ${metrics.leads.warmLeadsCount} • COLD 0–44: ${metrics.leads.coldLeadsCount}`}
          icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />

        <KpiCard
          label="Tugas & Survei"
          value={`${followUpTasks.length} Tugas`}
          subtext={`${overdueTasksCount} Overdue • ${scheduledVisitsCount} Survei Terjadwal`}
          icon={<CalendarClock className="h-4 w-4" strokeWidth={1.75} />}
          tone={overdueTasksCount > 0 ? 'error' : 'default'}
        />

        <KpiCard
          label="Booking Berjalan"
          value={`${activeBookingsCount} Booking`}
          subtext={`${metrics.salesAndContracts.activeUnderContractCount} Kontrak Aktif`}
          icon={<FileCheck2 className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />

        <KpiCard
          label="Closing Saya (CLOSED_WON)"
          value={`${metrics.salesAndContracts.salesClosingsCount} Unit`}
          subtext={`Total: ${formatRupiah(metrics.salesAndContracts.totalContractedSalesValue)}`}
          icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Estimasi Komisi dari Closing Saya" value={formatRupiah(metrics.finance.estimatedDeveloperCommission)} subtext={metrics.finance.closedDealsWithoutCommissionConfig > 0 ? `${metrics.finance.closedDealsWithoutCommissionConfig} closing belum dikonfigurasi` : 'Komisi developer pada Deal milik Anda'} icon={<Briefcase className="h-4 w-4" />} />
        <KpiCard label="Alokasi Komisi Saya" value={formatRupiah(metrics.finance.salesCommissionAllocation)} subtext="Alokasi sesuai kebijakan, bukan bukti pembayaran" icon={<Briefcase className="h-4 w-4" />} />
        <KpiCard label="Status Komisi Developer" value={formatRupiah(metrics.finance.developerCommissionReceived)} subtext={`Diterima developer ${formatRupiah(metrics.finance.developerCommissionReceived)} · sisa ${formatRupiah(metrics.finance.developerCommissionOutstanding)}`} icon={<Landmark className="h-4 w-4" />} />
      </div>

      {/* Daftar Prioritas Tugas Follow-Up & Jadwal Survei */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tugas Follow-Up</CardTitle>
            <Badge tone={overdueTasksCount > 0 ? 'red' : 'forest'}>
              {followUpTasks.length} Tugas Aktif
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {followUpTasks.length === 0 ? (
              <EmptyState
                title="Tidak Ada Tugas Follow-Up Tertunda"
                description="Seluruh tugas tindak lanjut prospek Anda telah diselesaikan."
              />
            ) : (
              followUpTasks.map((task) => (
                <div
                  key={task.id}
                  className={`flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center ${
                    task.status === 'OVERDUE'
                      ? 'border-[#FECACA] bg-[#FEF2F2]/40'
                      : 'border-[#E2E8F0] bg-white'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <DomainStatusBadge value={task.status} />
                      <DomainStatusBadge value={task.priority} />
                      <span className="rounded bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-medium text-[#475569]">
                        {task.leadName} ({task.leadTemperature})
                      </span>
                    </div>

                    <p className="mt-1.5 text-sm font-semibold text-[#0F172A]">
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="mt-0.5 text-xs text-[#475569]">
                        {task.description}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[#64748B] tabular-nums">
                      <span>Jatuh Tempo: {formatDateTimeID(task.dueAt)}</span>
                      {task.relatedScheduleTitle && (
                        <span className="rounded bg-[#EFF6FF] px-1.5 py-0.5 font-medium text-[#1D4ED8]">
                          Terkait Tagihan: {task.relatedScheduleTitle}
                        </span>
                      )}
                      {task.relatedKprNumber && (
                        <span className="rounded bg-[#F0FDF4] px-1.5 py-0.5 font-mono font-medium text-[#14532D]">
                          Terkait KPR: {task.relatedKprNumber}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={
                        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      }
                      onClick={() => {
                        setCompletionNotes(
                          'Nasabah telah dihubungi dan konfirmasi tindak lanjut selesai.'
                        );
                        setSelectedTask(task);
                      }}
                    >
                      Tandai Selesai
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Jadwal Survei Lokasi (Site Visits) */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
              <CardTitle>Jadwal Survei Lokasi Saya</CardTitle>
            </div>
            <Badge tone="blue">{siteVisits.length} Agenda</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {siteVisits.length === 0 ? (
              <EmptyState
                title="Belum Ada Agenda Survei"
                description="Jadwalkan kunjungan survei lokasi dari halaman Leads & Pipeline."
              />
            ) : (
              siteVisits.map((visit) => (
                <div
                  key={visit.id}
                  className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#0F172A]">
                      {visit.leadName}
                    </span>
                    <DomainStatusBadge value={visit.status} />
                  </div>
                  <p className="mt-1 text-xs text-[#475569]">
                    {visit.projectName}
                    {visit.unitCode ? ` • Unit ${visit.unitCode}` : ''}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-[#14532D] tabular-nums">
                    {formatDateTimeID(visit.scheduledAt)}
                  </p>
                  {visit.preparationNotes && (
                    <p className="mt-1 text-[11px] text-[#64748B]">
                      Catatan: {visit.preparationNotes}
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Panel Status Pengajuan KPR, Bukti Pembayaran & Booking 72 Jam Nasabah Saya */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Status Berkas KPR & Booking 72 Jam */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
              <CardTitle>Status Berkas KPR &amp; Reservasi 72 Jam</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingHoldBookings.map((hb) => (
              <div
                key={hb.id}
                className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB]/70 p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#0F172A]">
                    {hb.bookingNumber} • Unit {hb.unitCode}
                  </span>
                  <Badge
                    tone={hb.hoursRemaining <= 0 ? 'red' : 'amber'}
                    icon={<Clock className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  >
                    {hb.hoursRemaining <= 0
                      ? `MENUNGGU VERIFIKASI ADMIN (Lewat ${Math.abs(hb.hoursRemaining)} Jam)`
                      : `PENDING FEE (Sisa ${hb.hoursRemaining} Jam)`}
                  </Badge>
                </div>
                <p className="mt-1 text-xs font-medium text-[#0F172A]">
                  Calon Pembeli: {hb.leadName} • Booking Fee:{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {formatRupiah(hb.bookingFeeAmount)}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-[#B45309] tabular-nums">
                  {hb.hoursRemaining <= 0
                    ? `Batas awal ${formatDateTimeID(hb.expiresAt)} — Unit dilindungi PD-01 selama bukti bayar diperiksa Admin`
                    : `Segera unggah bukti Booking Fee sebelum ${formatDateTimeID(hb.expiresAt)}`}
                </p>
              </div>
            ))}

            {kprStatusItems.length === 0 && pendingHoldBookings.length === 0 ? (
              <EmptyState
                title="Tidak Ada Pengajuan KPR atau Booking Hold"
                description="Seluruh dokumen KPR dan reservasi unit nasabah Anda dalam kondisi normal."
              />
            ) : (
              kprStatusItems.map((kpr) => (
                <div
                  key={kpr.id}
                  className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-[#0F172A]">
                      {kpr.kprNumber} • {kpr.bankPartnerName}
                    </span>
                    <DomainStatusBadge value={kpr.currentStage} />
                  </div>
                  <p className="mt-1 text-xs font-medium text-[#0F172A]">
                    {kpr.leadName} • Unit{' '}
                    <span className="font-mono">{kpr.unitCode}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {kpr.revisionDocsCount > 0 && (
                      <Badge tone="red">
                        {kpr.revisionDocsCount} Dokumen REVISION REQUIRED
                      </Badge>
                    )}
                    {kpr.missingDocsCount > 0 && (
                      <Badge tone="amber">
                        {kpr.missingDocsCount} Dokumen Belum Diunggah
                      </Badge>
                    )}
                    {kpr.uploadedDocsCount > 0 && (
                      <Badge tone="blue">
                        {kpr.uploadedDocsCount} Menunggu Verifikasi Admin
                      </Badge>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Status Verifikasi Bukti Pembayaran Nasabah Saya */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
              <CardTitle>Status Verifikasi Bukti Bayar Nasabah Saya</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {paymentStatusItems.length === 0 ? (
              <EmptyState
                title="Belum Ada Riwayat Bukti Pembayaran"
                description="Bukti pembayaran nasabah yang Anda unggah akan tampil di panel ini."
              />
            ) : (
              paymentStatusItems.map((pay) => (
                <div
                  key={pay.id}
                  className={`rounded-lg border p-3.5 ${
                    pay.verificationStatus === 'REJECTED'
                      ? 'border-[#FECACA] bg-[#FEF2F2]/60'
                      : 'border-[#E2E8F0] bg-[#F8FAFC]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-[#0F172A]">
                      {pay.paymentNumber} ({pay.bookingNumber})
                    </span>
                    <DomainStatusBadge value={pay.verificationStatus} />
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-[#0F172A]">
                      {pay.leadName} • Unit{' '}
                      <span className="font-mono">{pay.unitCode}</span>
                    </p>
                    <p className="font-mono text-xs font-bold text-[#0F172A] tabular-nums">
                      {formatRupiah(pay.paidAmount)}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#64748B] tabular-nums">
                    Diunggah: {formatDateTimeID(pay.submittedAt)}
                  </p>
                  {pay.verificationStatus === 'REJECTED' && pay.rejectionReason && (
                    <p className="mt-1.5 rounded bg-white p-2 text-xs font-medium text-[#B91C1C] ring-1 ring-[#FECACA]">
                      Alasan Ditolak Admin: {pay.rejectionReason} (Wajib Unggah Bukti Pengganti)
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Panel Perubahan Harga Unit & Prospek Terdampak */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
            <CardTitle>Perubahan Harga Unit</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/catalog"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-semibold text-[#0F172A] transition-colors hover:bg-[#F8FAFC]"
            >
              <span>Katalog</span>
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Link>
            <Link
              href="/leads"
              className="inline-flex h-8 items-center gap-1 rounded-md bg-[#ECFDF5] px-3 text-xs font-semibold text-[#065F46] ring-1 ring-[#A7F3D0] transition-colors hover:bg-[#D1FAE5]"
            >
              <span>Buka Leads</span>
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentPriceUpdates.length === 0 ? (
            <EmptyState
              title="Belum Ada Perubahan Harga"
              description="Riwayat perubahan harga unit dan prospek terkait akan muncul di sini."
            />
          ) : (
            recentPriceUpdates.map((item) => {
              const isIncrease = item.deltaAmount > 0;
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4"
                >
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#0F172A]">
                          Unit {item.unitCode}
                        </span>
                        <span className="text-xs font-medium text-[#475569]">
                          • {item.projectName} ({item.projectCode})
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                            isIncrease
                              ? 'bg-[#FFFBEB] text-[#B45309]'
                              : 'bg-[#ECFDF5] text-[#047857]'
                          }`}
                        >
                          {isIncrease ? (
                            <TrendingUp className="h-3 w-3" strokeWidth={1.75} />
                          ) : (
                            <TrendingDown className="h-3 w-3" strokeWidth={1.75} />
                          )}
                          {isIncrease ? '+' : ''}
                          {formatRupiah(item.deltaAmount)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#475569]">
                        Alasan: {item.reason}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#64748B] tabular-nums">
                        Diperbarui pada {formatDateTimeID(item.changedAt)} oleh {item.changedByName}
                      </p>
                    </div>

                    <div className="text-left sm:text-right">
                      <p className="font-mono text-xs text-[#64748B] line-through tabular-nums">
                        {formatRupiah(item.oldPrice)}
                      </p>
                      <p className="font-mono text-sm font-bold text-[#0F172A] tabular-nums">
                        {formatRupiah(item.newPrice)}
                      </p>
                    </div>
                  </div>

                  {/* Daftar Lead Aktif Milik Sales yang Meminati Proyek Ini */}
                  {item.impactedLeads.length > 0 && (
                    <div className="mt-3 border-t border-[#E2E8F0] pt-3">
                      <p className="text-[11px] font-semibold tracking-wider text-[#14532D] uppercase">
                        Prospek Aktif Anda yang Meminati {item.projectName} ({item.impactedLeads.length} Lead)
                      </p>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {item.impactedLeads.map((lead) => (
                          <div
                            key={lead.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-[#E2E8F0] bg-white px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-[#0F172A]">
                                {lead.fullName}{' '}
                                <span className="font-normal text-[#64748B]">
                                  ({lead.leadTemperature} • {lead.pipelineStage})
                                </span>
                              </p>
                              <p className="font-mono text-[11px] text-[#475569] tabular-nums">
                                Budget: {formatRupiah(lead.budgetAmount)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Link
                                href="/leads"
                                className="rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-medium text-[#0F172A] hover:bg-[#F8FAFC]"
                              >
                                Detail Lead
                              </Link>
                              <a
                                href={buildWhatsAppFollowUpUrl({
                                  phone: lead.phone,
                                  leadName: lead.fullName,
                                  salesName: salesFullName,
                                  projectName: item.projectName,
                                  unitCode: item.unitCode,
                                  newPrice: item.newPrice,
                                })}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded bg-[#ECFDF5] px-2 py-1 text-[11px] font-semibold text-[#065F46] ring-1 ring-[#A7F3D0] hover:bg-[#D1FAE5]"
                                title="Buka draf pesan WhatsApp manual untuk tindak lanjut"
                              >
                                <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
                                <span>WA Manual</span>
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Modal Konfirmasi Penyelesaian Tugas Follow-Up */}
      <ConfirmDialog
        isOpen={Boolean(selectedTask)}
        onClose={() => setSelectedTask(null)}
        onConfirm={handleCompleteTask}
        title="Selesaikan Tugas Follow-Up"
        description={
          selectedTask
            ? `Tandai tugas "${selectedTask.title}" untuk prospek ${selectedTask.leadName} sebagai selesai.`
            : ''
        }
        confirmLabel="Simpan & Tandai Selesai"
        isLoading={isSubmittingTask}
      >
        <div>
          <label
            htmlFor="completionNotes"
            className="block text-xs font-semibold text-[#0F172A]"
          >
            Catatan Hasil Tindak Lanjut (Wajib, min. 5 karakter)
          </label>
          <textarea
            id="completionNotes"
            rows={3}
            value={completionNotes}
            onChange={(e) => setCompletionNotes(e.target.value)}
            disabled={isSubmittingTask}
            className="mt-1.5 block w-full rounded-md border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
