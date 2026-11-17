// Lokasi: src/components/transactions/PaymentProofUploadModal.tsx
// Modal Unggah Bukti Pembayaran & Pengganti Bukti Ditolak (ADMIN & SALES saja)

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Upload } from 'lucide-react';
import { submitPaymentRecordAction } from '@/modules/transactions/transactions.actions';
import { formatRupiah } from '@/lib/utils/format';
import { validateUploadFileClient } from '@/lib/utils/transactions-ui';
import { Modal } from '@/components/ui/Modal';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';

export interface UploadScheduleTarget {
  id: string;
  title: string;
  scheduledAmount: number;
  verifiedPaidAmount: number;
  remainingAmount: number;
}

export interface ReplacementPaymentTarget {
  id: string;
  referenceNumber: string;
  paidAmount: number;
  verificationNotes: string | null;
}

export interface PaymentProofUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingId: string;
  bookingReference: string;
  schedule: UploadScheduleTarget | null;
  defaultPaymentDate: string;
  replacesPayment?: ReplacementPaymentTarget | null;
  onSuccess?: () => void;
}

const CHANNEL_OPTIONS = [
  { value: 'BANK_TRANSFER', label: 'Transfer Bank (BCA / Mandiri / BRI / BNI)' },
  { value: 'VIRTUAL_ACCOUNT', label: 'Virtual Account (VA)' },
  { value: 'QRIS', label: 'QRIS Perusahaan' },
  { value: 'EDC_DEBIT', label: 'Mesin EDC / Kartu Debit' },
  { value: 'CASH_COUNTER', label: 'Setoran Tunai Kasir Kantor' },
];

function PaymentProofUploadModalInner({
  isOpen,
  onClose,
  bookingId,
  bookingReference,
  schedule,
  defaultPaymentDate,
  replacesPayment = null,
  onSuccess,
}: Omit<PaymentProofUploadModalProps, 'schedule'> & {
  schedule: UploadScheduleTarget;
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const initialAmount = replacesPayment
    ? Math.min(replacesPayment.paidAmount, schedule.remainingAmount)
    : schedule.remainingAmount;

  const [paidAmount, setPaidAmount] = useState<string>(String(initialAmount));
  const [paymentDate, setPaymentDate] = useState<string>(defaultPaymentDate);
  const [paymentChannel, setPaymentChannel] = useState<string>('BANK_TRANSFER');
  const [salesNotes, setSalesNotes] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (!file) {
      setFileError(null);
      return;
    }
    setFileError(validateUploadFileClient(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const numericAmount = Number(paidAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError('Nominal pembayaran wajib lebih besar dari Rp 0.');
      return;
    }
    if (numericAmount > schedule.remainingAmount) {
      setFormError(
        `Nominal pembayaran (${formatRupiah(numericAmount)}) tidak boleh melebihi sisa tagihan (${formatRupiah(schedule.remainingAmount)}).`
      );
      return;
    }

    const clientFileErr = validateUploadFileClient(selectedFile);
    if (clientFileErr || !selectedFile) {
      setFileError(clientFileErr ?? 'File bukti transfer wajib diunggah.');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('bookingId', bookingId);
      formData.append('paymentScheduleId', schedule.id);
      formData.append('paidAmount', String(Math.round(numericAmount)));
      formData.append('paymentDate', paymentDate);
      formData.append('paymentChannel', paymentChannel);
      if (replacesPayment) {
        formData.append('replacesPaymentId', replacesPayment.id);
      }
      if (salesNotes.trim()) {
        formData.append('salesNotes', salesNotes.trim());
      }
      formData.append('proofFile', selectedFile);

      const result = await submitPaymentRecordAction(formData);
      if (!result.success) {
        setFormError(result.message);
        showToast({
          tone: 'error',
          title: 'Gagal mengunggah bukti pembayaran',
          description: result.message,
          correlationId: result.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Bukti pembayaran berhasil dikirim',
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
      title={
        replacesPayment
          ? `Unggah Bukti Pengganti (${replacesPayment.referenceNumber})`
          : 'Unggah Bukti Pembayaran'
      }
      description={`${bookingReference} • ${schedule.title}`}
      footer={
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
            form="payment-proof-upload-form"
            variant="primary"
            isLoading={isSubmitting}
            leftIcon={<Upload className="h-4 w-4" strokeWidth={1.75} />}
          >
            Kirim Bukti Pembayaran
          </Button>
        </>
      }
    >
      <form
        id="payment-proof-upload-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#64748B]">Total Tagihan Termin</span>
            <span className="font-semibold text-[#0F172A] tabular-nums">
              {formatRupiah(schedule.scheduledAmount)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[#64748B]">Sisa Belum Terverifikasi</span>
            <span className="font-bold text-[#14532D] tabular-nums">
              {formatRupiah(schedule.remainingAmount)}
            </span>
          </div>
        </div>

        {replacesPayment && (
          <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs">
            <p className="font-semibold text-[#991B1B]">
              Menggantikan bukti ditolak:{' '}
              <span className="font-mono">{replacesPayment.referenceNumber}</span>
            </p>
            {replacesPayment.verificationNotes && (
              <p className="mt-1 text-[#B91C1C]">
                Catatan penolakan Admin: {replacesPayment.verificationNotes}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CurrencyInput
            label="Nominal Dibayar (Rp)"
            min={1}
            max={schedule.remainingAmount}
            step={1}
            required
            value={paidAmount}
            onValueChange={setPaidAmount}
            helperText={`Maks. ${formatRupiah(schedule.remainingAmount)}`}
            disabled={isSubmitting}
          />
          <Input
            label="Tanggal Pembayaran"
            type="date"
            required
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <Select
          label="Kanal Pembayaran"
          options={CHANNEL_OPTIONS}
          value={paymentChannel}
          onChange={(e) => setPaymentChannel(e.target.value)}
          disabled={isSubmitting}
        />

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
            File Bukti Pembayaran (JPG, PNG, WEBP, PDF • Maks. 5 MB)
          </label>
          <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-3">
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="block w-full text-xs text-[#475569] file:mr-3 file:rounded-md file:border file:border-[#CBD5E1] file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[#0F172A] hover:file:bg-[#F1F5F9]"
            />
            {selectedFile && !fileError && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-[#047857]">
                <FileUp className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{selectedFile.name}</span>
                <span className="shrink-0 tabular-nums">
                  ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                </span>
              </p>
            )}
          </div>
          {fileError && (
            <p className="mt-1 text-xs font-medium text-[#DC2626]">{fileError}</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
            Catatan Sales (Opsional)
          </label>
          <textarea
            rows={2}
            maxLength={500}
            value={salesNotes}
            onChange={(e) => setSalesNotes(e.target.value)}
            disabled={isSubmitting}
            placeholder="Misal: Transfer dari rekening BCA a.n. konsumen..."
            className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none disabled:bg-[#F8FAFC]"
          />
        </div>

        {formError && (
          <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
            {formError}
          </div>
        )}
      </form>
    </Modal>
  );
}

export function PaymentProofUploadModal({
  schedule,
  replacesPayment = null,
  ...rest
}: PaymentProofUploadModalProps) {
  if (!schedule || !rest.isOpen) return null;
  return (
    <PaymentProofUploadModalInner
      key={`${schedule.id}-${replacesPayment?.id ?? 'new'}`}
      schedule={schedule}
      replacesPayment={replacesPayment}
      {...rest}
    />
  );
}
