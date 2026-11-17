// Lokasi: src/components/transactions/PaymentVerificationModal.tsx
// Split Modal Verifikasi & Pratinjau Bukti Pembayaran (TX-02, SLA 24/48h, & PD-01)

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import type {
  BookingStatus,
  PaymentMethod,
  PaymentVerificationStatus,
  ScheduleType,
  SystemRole,
} from '@/types/database.types';
import { verifyPaymentRecordAction } from '@/modules/transactions/transactions.actions';
import { formatDateID, formatDateTimeID, formatRupiah } from '@/lib/utils/format';
import { classifyPaymentSla } from '@/lib/utils/transactions-ui';
import { Modal } from '@/components/ui/Modal';
import { Badge, DomainStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/ToastProvider';
import { DocumentPreviewContent } from './DocumentPreviewModal';

export interface PaymentVerificationTarget {
  id: string;
  referenceNumber: string;
  bookingId: string;
  bookingReference: string;
  bookingStatus: BookingStatus;
  bookingExpiresAt: string;
  paymentMethod: PaymentMethod;
  unitCode: string;
  prospectName: string;
  scheduleTitle: string;
  scheduleType: ScheduleType;
  scheduledAmount: number;
  scheduleRemainingAmount: number;
  paidAmount: number;
  paymentDate: string;
  paymentChannel: string;
  proofFilePath: string;
  proofFileName: string;
  verificationStatus: PaymentVerificationStatus;
  submittedAt: string;
  submittedByName: string;
  salesNotes: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  replacesPaymentRef: string | null;
}

export interface PaymentVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: SystemRole;
  payment: PaymentVerificationTarget | null;
  referenceNowMs: number;
  onSuccess?: () => void;
}

const BANK_OPTIONS = [
  { value: 'Bank Mandiri', label: 'Bank Mandiri' },
  { value: 'Bank BCA', label: 'Bank BCA' },
  { value: 'Bank BTN', label: 'Bank BTN' },
  { value: 'Bank BRI', label: 'Bank BRI' },
  { value: 'Bank BNI', label: 'Bank BNI' },
  { value: 'Bank Syariah Indonesia (BSI)', label: 'Bank Syariah Indonesia (BSI)' },
  { value: 'CIMB Niaga', label: 'CIMB Niaga' },
];

const DECISION_OPTIONS = [
  { value: 'VERIFIED', label: 'VERIFIED — Setujui & Sahkan Pembayaran' },
  { value: 'REJECTED', label: 'REJECTED — Tolak Bukti Pembayaran' },
];

const EXPIRED_ACTION_OPTIONS = [
  {
    value: 'EXTEND_24H',
    label: 'EXTEND_24H — Perpanjang Batas Booking +24 Jam untuk Revisi',
  },
  {
    value: 'EXPIRE_NOW',
    label: 'EXPIRE_NOW — Kedaluwarsakan Booking & Kembalikan Unit AVAILABLE',
  },
];

function PaymentVerificationModalInner({
  isOpen,
  onClose,
  userRole,
  payment,
  referenceNowMs,
  onSuccess,
}: Omit<PaymentVerificationModalProps, 'payment'> & {
  payment: PaymentVerificationTarget;
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [decision, setDecision] = useState<'VERIFIED' | 'REJECTED'>('VERIFIED');
  const [verificationNotes, setVerificationNotes] = useState('');
  const [expiredBookingAction, setExpiredBookingAction] = useState<
    'EXTEND_24H' | 'EXPIRE_NOW'
  >('EXTEND_24H');
  const [kprBankName, setKprBankName] = useState('Bank Mandiri');
  const [kprTenorYears, setKprTenorYears] = useState('15');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canAdminVerify =
    userRole === 'ADMIN' && payment.verificationStatus === 'PENDING_VERIFICATION';

  const slaInfo = classifyPaymentSla({
    verificationStatus: payment.verificationStatus,
    submittedAt: payment.submittedAt,
    bookingStatus: payment.bookingStatus,
    bookingExpiresAt: payment.bookingExpiresAt,
    nowMs: referenceNowMs,
  });

  const needsKprBankConfig =
    canAdminVerify &&
    decision === 'VERIFIED' &&
    payment.scheduleType === 'BOOKING_FEE' &&
    payment.paymentMethod === 'KPR';

  const needsExpiredBookingAction =
    canAdminVerify &&
    decision === 'REJECTED' &&
    payment.scheduleType === 'BOOKING_FEE' &&
    slaInfo.isPastBookingExpiry;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdminVerify) return;
    setFormError(null);

    if (decision === 'REJECTED' && verificationNotes.trim().length < 5) {
      setFormError(
        'Alasan penolakan wajib diisi minimal 5 karakter saat menolak bukti pembayaran.'
      );
      return;
    }

    const tenorNumber = Number(kprTenorYears);
    if (
      needsKprBankConfig &&
      (!Number.isInteger(tenorNumber) || tenorNumber < 1 || tenorNumber > 35)
    ) {
      setFormError('Tenor KPR harus berupa bilangan bulat 1 s.d. 35 tahun.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await verifyPaymentRecordAction({
        paymentRecordId: payment.id,
        decision,
        verificationNotes: verificationNotes.trim() || null,
        expiredBookingAction: needsExpiredBookingAction ? expiredBookingAction : null,
        kprBankName: needsKprBankConfig ? kprBankName : 'Bank Mandiri',
        kprTenorYears: needsKprBankConfig ? tenorNumber : 15,
      });

      if (!result.success) {
        setFormError(result.message);
        showToast({
          tone: 'error',
          title: 'Verifikasi pembayaran gagal',
          description: result.message,
          correlationId: result.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title:
          decision === 'VERIFIED'
            ? 'Pembayaran berhasil diverifikasi'
            : 'Bukti pembayaran ditolak',
        description: result.message,
      });
      onClose();
      onSuccess?.();
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      isDismissDisabled={isSubmitting}
      size="lg"
      title={
        canAdminVerify
          ? `Verifikasi Pembayaran • ${payment.referenceNumber}`
          : `Pratinjau Pembayaran • ${payment.referenceNumber}`
      }
      description={`${payment.bookingReference} • Unit ${payment.unitCode} • ${payment.prospectName}`}
      footer={
        canAdminVerify ? (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Batal
            </Button>
            <Button
              type="submit"
              form="admin-verify-payment-form"
              variant={decision === 'REJECTED' ? 'destructive' : 'primary'}
              isLoading={isSubmitting}
              leftIcon={
                decision === 'REJECTED' ? (
                  <XCircle className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                )
              }
            >
              {decision === 'REJECTED' ? 'Tolak Bukti Pembayaran' : 'Sahkan Pembayaran'}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={onClose}>
            Tutup
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
        <div className="md:col-span-7">
          <DocumentPreviewContent
            filePath={payment.proofFilePath}
            fileName={payment.proofFileName}
            title={payment.referenceNumber}
            isActive={isOpen}
          />
        </div>

        <div className="flex flex-col gap-4 md:col-span-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <DomainStatusBadge value={payment.verificationStatus} />
            {slaInfo.level === 'ESCALATION_48H' && (
              <Badge
                tone="red"
                icon={<ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                ESKALASI &gt; 48J ({slaInfo.hoursWaiting}j)
              </Badge>
            )}
            {slaInfo.level === 'SLA_24H' && (
              <Badge
                tone="amber"
                icon={<Clock className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                SLA &gt; 24J ({slaInfo.hoursWaiting}j)
              </Badge>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-[#64748B]">Termin</span>
              <span className="text-right font-medium text-[#0F172A]">
                {payment.scheduleTitle}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Nominal Dibayar</span>
              <span className="text-sm font-bold text-[#14532D] tabular-nums">
                {formatRupiah(payment.paidAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Sisa Tagihan Termin</span>
              <span className="font-semibold text-[#0F172A] tabular-nums">
                {formatRupiah(payment.scheduleRemainingAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Tanggal Bayar</span>
              <span className="text-right text-[#0F172A]">
                {formatDateID(payment.paymentDate)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Kanal</span>
              <span className="text-right font-mono text-[11px] text-[#0F172A]">
                {payment.paymentChannel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Diunggah Oleh</span>
              <span className="text-right text-[#0F172A]">{payment.submittedByName}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Waktu Unggah</span>
              <span className="text-right text-[#475569]">
                {formatDateTimeID(payment.submittedAt)}
              </span>
            </div>
            {payment.replacesPaymentRef && (
              <div className="flex items-center justify-between gap-2 border-t border-[#E2E8F0] pt-2">
                <span className="text-[#64748B]">Pengganti Bukti</span>
                <span className="font-mono font-semibold text-[#0F172A]">
                  {payment.replacesPaymentRef}
                </span>
              </div>
            )}
            {payment.salesNotes && (
              <div className="border-t border-[#E2E8F0] pt-2">
                <span className="block text-[11px] font-medium text-[#64748B]">
                  Catatan Sales:
                </span>
                <p className="mt-0.5 text-[#0F172A]">{payment.salesNotes}</p>
              </div>
            )}
          </div>

          {payment.verificationStatus !== 'PENDING_VERIFICATION' && (
            <div className="rounded-lg border border-[#E2E8F0] bg-white p-3.5 text-xs">
              <p className="font-semibold text-[#0F172A]">
                Catatan Verifikasi Admin
              </p>
              <p className="mt-1 text-[#475569]">
                Diproses oleh {payment.verifiedByName ?? 'Admin'} pada{' '}
                {formatDateTimeID(payment.verifiedAt)}
              </p>
              {payment.verificationNotes && (
                <p className="mt-1.5 rounded bg-[#F8FAFC] p-2 text-[#0F172A]">
                  {payment.verificationNotes}
                </p>
              )}
            </div>
          )}

          {canAdminVerify && (
            <form
              id="admin-verify-payment-form"
              onSubmit={handleSubmit}
              className="space-y-3 rounded-lg border border-[#E2E8F0] bg-white p-3.5"
            >
              <Select
                label="Keputusan Verifikasi Admin"
                options={DECISION_OPTIONS}
                value={decision}
                onChange={(e) =>
                  setDecision(e.target.value as 'VERIFIED' | 'REJECTED')
                }
                disabled={isSubmitting}
              />

              {needsKprBankConfig && (
                <div className="space-y-3 rounded-md border border-[#BFDBFE] bg-[#EFF6FF] p-3">
                  <p className="text-[11px] font-medium text-[#1D4ED8]">
                    Verifikasi Booking Fee KPR akan mengesahkan Unit menjadi BOOKED
                    serta membuka Deal &amp; pengajuan KPR otomatis.
                  </p>
                  <Select
                    label="Bank Pengajuan KPR"
                    options={BANK_OPTIONS}
                    value={kprBankName}
                    onChange={(e) => setKprBankName(e.target.value)}
                    disabled={isSubmitting}
                  />
                  <Input
                    label="Tenor KPR (Tahun)"
                    type="number"
                    min={1}
                    max={35}
                    value={kprTenorYears}
                    onChange={(e) => setKprTenorYears(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              )}

              {needsExpiredBookingAction && (
                <div className="space-y-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-3">
                  <p className="text-[11px] font-medium text-[#B45309]">
                    Booking telah melewati batas hold 72 jam (PD-01). Tentukan
                    tindak lanjut saat menolak bukti bayar ini:
                  </p>
                  <Select
                    label="Tindakan Booking Kedaluwarsa (PD-01)"
                    options={EXPIRED_ACTION_OPTIONS}
                    value={expiredBookingAction}
                    onChange={(e) =>
                      setExpiredBookingAction(
                        e.target.value as 'EXTEND_24H' | 'EXPIRE_NOW'
                      )
                    }
                    disabled={isSubmitting}
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
                  {decision === 'REJECTED'
                    ? 'Alasan Penolakan (Wajib, min. 5 karakter)'
                    : 'Catatan Verifikasi (Opsional)'}
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  required={decision === 'REJECTED'}
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  disabled={isSubmitting}
                  placeholder={
                    decision === 'REJECTED'
                      ? 'Misal: Nominal mutasi tidak sesuai atau foto struk buram.'
                      : 'Misal: Dana terkonfirmasi masuk rekening PT FIM.'
                  }
                  className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none disabled:bg-[#F8FAFC]"
                />
              </div>

              {formError && (
                <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
                  {formError}
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function PaymentVerificationModal({
  payment,
  ...rest
}: PaymentVerificationModalProps) {
  if (!payment || !rest.isOpen) return null;
  return (
    <PaymentVerificationModalInner
      key={payment.id}
      payment={payment}
      {...rest}
    />
  );
}
