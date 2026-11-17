// Lokasi: src/components/bookings/BookingsWorkspaceClient.tsx
// Client Workspace untuk Daftar Booking & Reservasi (/bookings)

'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Clock,
  FileCheck2,
  Lock,
  Search,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { BookingStatus, PaymentMethod } from '@/types/database.types';
import { formatDateID, formatDateTimeID, formatRupiah } from '@/lib/utils/format';
import { computeBookingHoldProtection } from '@/lib/utils/transactions-ui';
import { Badge, DomainStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { KpiCard } from '@/components/ui/KpiCard';
import { Select } from '@/components/ui/Select';

export interface BookingListItemDto {
  id: string;
  referenceNumber: string;
  leadId: string;
  leadFullName: string;
  leadPhone: string;
  unitId: string;
  unitCode: string;
  blockNumber: string;
  projectName: string;
  salesName: string;
  teamCode: string;
  paymentMethod: PaymentMethod;
  agreedFinalPrice: number;
  bookingFeeAmount: number;
  status: BookingStatus;
  bookedAt: string;
  expiresAt: string;
  hasPendingVerificationPayment: boolean;
}

export interface BookingsWorkspaceClientProps {
  bookings: BookingListItemDto[];
  referenceNowMs: number;
}

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Semua Status Booking' },
  { value: 'PENDING_FEE', label: 'PENDING FEE (Hold 72 Jam)' },
  { value: 'ACTIVE', label: 'ACTIVE (Terkonfirmasi)' },
  { value: 'COMPLETED', label: 'COMPLETED (Selesai / Lunas)' },
  { value: 'EXPIRED', label: 'EXPIRED (Kedaluwarsa)' },
  { value: 'CANCELLED', label: 'CANCELLED (Dibatalkan)' },
];

const METHOD_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Semua Metode Bayar' },
  { value: 'KPR', label: 'KPR Bank' },
  { value: 'CASH_KERAS', label: 'Cash Keras' },
  { value: 'CASH_BERTAHAP', label: 'Cash Bertahap' },
];

function formatPaymentMethodLabel(method: PaymentMethod): string {
  switch (method) {
    case 'KPR':
      return 'KPR';
    case 'CASH_KERAS':
      return 'Cash Keras';
    case 'CASH_BERTAHAP':
      return 'Cash Bertahap';
  }
}

export function BookingsWorkspaceClient({
  bookings,
  referenceNowMs,
}: BookingsWorkspaceClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [methodFilter, setMethodFilter] = useState('ALL');

  const stats = useMemo(() => {
    let pendingFee = 0;
    let activeCount = 0;
    let pd01ProtectedCount = 0;
    let totalPipelineValue = 0;

    for (const b of bookings) {
      if (b.status === 'PENDING_FEE') {
        pendingFee += 1;
        const hold = computeBookingHoldProtection({
          status: b.status,
          expiresAt: b.expiresAt,
          hasPendingVerificationPayment: b.hasPendingVerificationPayment,
          nowMs: referenceNowMs,
        });
        if (hold.isPd01Protected) {
          pd01ProtectedCount += 1;
        }
      } else if (b.status === 'ACTIVE') {
        activeCount += 1;
      }

      if (b.status === 'PENDING_FEE' || b.status === 'ACTIVE' || b.status === 'COMPLETED') {
        totalPipelineValue += b.agreedFinalPrice;
      }
    }

    return {
      totalCount: bookings.length,
      pendingFee,
      activeCount,
      pd01ProtectedCount,
      totalPipelineValue,
    };
  }, [bookings, referenceNowMs]);

  const filteredBookings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bookings.filter((b) => {
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      if (methodFilter !== 'ALL' && b.paymentMethod !== methodFilter) return false;
      if (!q) return true;
      return (
        b.referenceNumber.toLowerCase().includes(q) ||
        b.leadFullName.toLowerCase().includes(q) ||
        b.unitCode.toLowerCase().includes(q) ||
        b.projectName.toLowerCase().includes(q)
      );
    });
  }, [bookings, searchQuery, statusFilter, methodFilter]);

  const renderHoldCell = (b: BookingListItemDto) => {
    if (b.status !== 'PENDING_FEE') {
      return (
        <span className="text-xs text-[#64748B]">
          {b.status === 'ACTIVE' || b.status === 'COMPLETED'
            ? 'Booking Fee Lunas'
            : `Batas: ${formatDateID(b.expiresAt)}`}
        </span>
      );
    }

    const hold = computeBookingHoldProtection({
      status: b.status,
      expiresAt: b.expiresAt,
      hasPendingVerificationPayment: b.hasPendingVerificationPayment,
      nowMs: referenceNowMs,
    });

    if (hold.isPd01Protected) {
      return (
        <div className="flex flex-col items-start gap-1">
          <Badge
            tone="amber"
            icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />}
          >
            Tertahan Verifikasi PD-01
          </Badge>
          <span className="text-[11px] text-[#64748B]">
            Batas awal: {formatDateTimeID(b.expiresAt)}
          </span>
        </div>
      );
    }

    if (hold.isExpiredPendingRelease) {
      return (
        <div className="flex flex-col items-start gap-1">
          <Badge
            tone="red"
            icon={<Clock className="h-3.5 w-3.5" strokeWidth={1.75} />}
          >
            Lewat Batas Hold ({Math.abs(hold.remainingHours)}j)
          </Badge>
          <span className="text-[11px] text-[#64748B]">
            {formatDateTimeID(b.expiresAt)}
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#B45309] tabular-nums">
          <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Sisa {hold.remainingHours} jam
        </span>
        <span className="text-[11px] text-[#64748B]">
          s/d {formatDateTimeID(b.expiresAt)}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Booking &amp; Reservasi
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Pemantauan reservasi unit, masa hold 72 jam (PD-01), dan harga terkunci
            kesepakatan (Price Freeze).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/payments">
            <Button variant="outline" size="sm">
              Pusat Pembayaran &amp; Verifikasi
            </Button>
          </Link>
        </div>
      </div>

      {/* Ringkasan KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Booking Tercatat"
          value={stats.totalCount}
          subtext="Sesuai cakupan akses peran Anda"
          icon={<FileCheck2 className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Menunggu Booking Fee"
          value={stats.pendingFee}
          subtext={
            stats.pd01ProtectedCount > 0
              ? `${stats.pd01ProtectedCount} tertahan verifikasi PD-01`
              : 'Hold sementara maksimal 72 jam'
          }
          tone={stats.pd01ProtectedCount > 0 ? 'warning' : 'default'}
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Booking Aktif"
          value={stats.activeCount}
          subtext="Unit resmi terkunci (BOOKED)"
          tone="success"
          icon={<Lock className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Nilai Transaksi Berjalan"
          value={formatRupiah(stats.totalPipelineValue)}
          subtext="Akumulasi harga final kesepakatan aktif & selesai"
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
        />
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative md:col-span-6">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
                strokeWidth={1.75}
              />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari kode BK-..., nama prospek, kode unit, atau proyek..."
                className="pl-9"
              />
            </div>
            <div className="md:col-span-3">
              <Select
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter status booking"
              />
            </div>
            <div className="md:col-span-3">
              <Select
                options={METHOD_FILTER_OPTIONS}
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                aria-label="Filter metode pembayaran"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Daftar Booking */}
      {filteredBookings.length === 0 ? (
        <EmptyState
          title="Belum ada data booking yang cocok"
          description="Coba ubah filter pencarian atau ajukan Booking baru dari halaman Detail Lead berstatus QUALIFIED atau lebih tinggi."
        />
      ) : (
        <>
          {/* Desktop Table */}
          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wide text-[#64748B] uppercase">
                    <th className="px-4 py-3">Kode Booking</th>
                    <th className="px-4 py-3">Prospek &amp; Unit</th>
                    <th className="px-4 py-3">Metode</th>
                    <th className="px-4 py-3 text-right">Harga Final</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Batas Hold 72J</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {filteredBookings.map((b) => (
                    <tr
                      key={b.id}
                      className="transition-colors hover:bg-[#F8FAFC]"
                    >
                      <td className="px-4 py-3.5 align-top whitespace-nowrap">
                        <Link
                          href={`/bookings/${b.id}`}
                          className="font-mono font-semibold text-[#14532D] hover:underline"
                        >
                          {b.referenceNumber}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-[#64748B]">
                          {formatDateID(b.bookedAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        <p className="font-semibold text-[#0F172A]">
                          {b.leadFullName}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#475569]">
                          <span className="font-mono font-medium text-[#0F172A]">
                            {b.unitCode}
                          </span>{' '}
                          • {b.projectName}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#64748B]">
                          {b.teamCode} • {b.salesName}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 align-top whitespace-nowrap">
                        <Badge tone="slate">
                          {formatPaymentMethodLabel(b.paymentMethod)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right align-top font-semibold whitespace-nowrap text-[#0F172A] tabular-nums">
                        {formatRupiah(b.agreedFinalPrice)}
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        <DomainStatusBadge value={b.status} />
                      </td>
                      <td className="px-4 py-3.5 align-top">{renderHoldCell(b)}</td>
                      <td className="px-4 py-3.5 text-right align-top">
                        <Link href={`/bookings/${b.id}`}>
                          <Button
                            variant="outline"
                            size="sm"
                            rightIcon={
                              <ArrowRight
                                className="h-3.5 w-3.5"
                                strokeWidth={1.75}
                              />
                            }
                          >
                            Detail
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile Card List */}
          <div className="space-y-3 md:hidden">
            {filteredBookings.map((b) => (
              <Card key={b.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/bookings/${b.id}`}
                        className="font-mono text-xs font-semibold text-[#14532D] hover:underline"
                      >
                        {b.referenceNumber}
                      </Link>
                      <p className="mt-0.5 text-sm font-semibold text-[#0F172A]">
                        {b.leadFullName}
                      </p>
                      <p className="text-xs text-[#475569]">
                        <span className="font-mono font-medium">{b.unitCode}</span>{' '}
                        • {b.projectName}
                      </p>
                    </div>
                    <DomainStatusBadge value={b.status} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-md bg-[#F8FAFC] p-2.5 text-xs">
                    <div>
                      <span className="text-[11px] text-[#64748B]">Metode</span>
                      <p className="font-medium text-[#0F172A]">
                        {formatPaymentMethodLabel(b.paymentMethod)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] text-[#64748B]">Harga Final</span>
                      <p className="font-bold text-[#0F172A] tabular-nums">
                        {formatRupiah(b.agreedFinalPrice)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div>{renderHoldCell(b)}</div>
                    <Link href={`/bookings/${b.id}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        rightIcon={
                          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                        }
                      >
                        Detail
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
