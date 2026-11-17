// Lokasi: src/components/transactions/RefundCompletionModal.tsx
// Modal Penyelesaian Pencairan Refund Pembatalan (PD-04 — Khusus ADMIN)

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileUp } from 'lucide-react';
import { completeRefundTransactionAction } from '@/modules/transactions/transactions.actions';
import { formatRupiah } from '@/lib/utils/format';
import { validateUploadFileClient } from '@/lib/utils/transactions-ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';

export interface RefundCompletionTarget {
  id: string;
  referenceNumber: string;
  bookingId: string;
  bookingReference: string;
  refundAmount: number;
  refundMethod: string;
  prospectName: string;
  unitCode: string;
}

export interface RefundCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  refund: RefundCompletionTarget | null;
  defaultRefundDate: string;
  onSuccess?: () => void;
}

const REFUND_METHOD_OPTIONS = [
  { value: 'BANK_TRANSFER', label: 'Transfer Bank (BI-FAST / Online)' },
  { value: 'RTGS_SKN', label: 'Transfer RTGS / SKN' },
  { value: 'CHEQUE_GIRO', label: 'Cek / Bilyet Giro Perusahaan' },
];

function RefundCompletionModalInner({
  isOpen,
  onClose,
  refund,
  defaultRefundDate,
  onSuccess,
}: Omit<RefundCompletionModalProps, 'refund'> & {
  refund: RefundCompletionTarget;
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [refundDate, setRefundDate] = useState(defaultRefundDate);
  const [refundMethod, setRefundMethod] = useState(
    refund.refundMethod || 'BANK_TRANSFER'
  );
  const [notes, setNotes] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setProofFile(file);
    setFileError(file ? validateUploadFileClient(file) : null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const err = validateUploadFileClient(proofFile);
    if (err || !proofFile) {
      setFileError(err ?? 'Bukti transfer pengembalian dana wajib diunggah.');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('bookingId', refund.bookingId);
      formData.append('refundTransactionId', refund.id);
      formData.append('refundDate', refundDate);
      formData.append('refundMethod', refundMethod);
      if (notes.trim()) {
        formData.append('notes', notes.trim());
      }
      formData.append('proofFile', proofFile);

      const result = await completeRefundTransactionAction(formData);
      if (!result.success) {
        setFormError(result.message);
        showToast({
          tone: 'error',
          title: 'Gagal menyelesaikan pengembalian dana',
          description: result.message,
          correlationId: result.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Pengembalian dana diselesaikan',
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
      title={`Selesaikan Refund • ${refund.referenceNumber}`}
      description={`${refund.bookingReference} • Unit ${refund.unitCode} • ${refund.prospectName}`}
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
            form="refund-completion-form"
            variant="primary"
            isLoading={isSubmitting}
            leftIcon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />}
          >
            Sahkan Pencairan Refund
          </Button>
        </>
      }
    >
      <form
        id="refund-completion-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <div className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
          <span className="text-[#64748B]">Nominal Pengembalian Dana</span>
          <span className="text-sm font-bold text-[#0F172A] tabular-nums">
            {formatRupiah(refund.refundAmount)}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Tanggal Transfer Refund"
            type="date"
            required
            value={refundDate}
            onChange={(e) => setRefundDate(e.target.value)}
            disabled={isSubmitting}
          />
          <Select
            label="Metode Pengembalian"
            options={REFUND_METHOD_OPTIONS}
            value={refundMethod}
            onChange={(e) => setRefundMethod(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
            Bukti Transfer Refund (JPG, PNG, WEBP, PDF • Maks. 5 MB)
          </label>
          <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-3">
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="block w-full text-xs text-[#475569] file:mr-3 file:rounded-md file:border file:border-[#CBD5E1] file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[#0F172A] hover:file:bg-[#F1F5F9]"
            />
            {proofFile && !fileError && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-[#047857]">
                <FileUp className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{proofFile.name}</span>
              </p>
            )}
          </div>
          {fileError && (
            <p className="mt-1 text-xs font-medium text-[#DC2626]">{fileError}</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
            Catatan Pencairan (Opsional)
          </label>
          <textarea
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isSubmitting}
            placeholder="Misal: Ditransfer ke rekening BCA konsumen sesuai permohonan pembatalan."
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

export function RefundCompletionModal({
  refund,
  ...rest
}: RefundCompletionModalProps) {
  if (!refund || !rest.isOpen) return null;
  return (
    <RefundCompletionModalInner
      key={refund.id}
      refund={refund}
      {...rest}
    />
  );
}
