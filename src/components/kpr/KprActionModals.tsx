// Lokasi: src/components/kpr/KprActionModals.tsx
// Kumpulan Modal Aksi KPR (Unggah Dokumen, Verifikasi Admin, Majukan Tahap TX-09, SP3K TX-04, Batal Konsumen TX-10, Pencairan TX-08)

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  advanceKprStageAction,
  cancelKprByCustomerAction,
  recordKprApprovalAction,
  recordKprDisbursementAction,
  uploadKprDocumentAction,
  verifyKprDocumentAction,
} from '@/modules/transactions/transactions.actions';
import type {
  DisbursementTranche,
  KprDocStatus,
  KprStage,
} from '@/types/database.types';
import { formatRupiah } from '@/lib/utils/format';
import {
  getKprStageMeta,
  toIsoDateTimeFromJakartaLocal,
  type KprAdvanceTargetStage,
} from '@/lib/utils/kpr-deals-ui';
import { validateUploadFileClient } from '@/lib/utils/transactions-ui';
import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/ToastProvider';

export interface KprDocModalTarget {
  id: string;
  documentName: string;
  documentCode: string;
  status: KprDocStatus;
  isMandatory: boolean;
}

/* 1. Modal Unggah Dokumen KPR (ADMIN & SALES) */
function UploadKprDocModalInner({
  bookingId,
  kprApplicationId,
  doc,
  onClose,
}: {
  bookingId: string;
  kprApplicationId: string;
  doc: KprDocModalTarget;
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErr = validateUploadFileClient(selectedFile);
    if (validationErr) {
      setFileError(validationErr);
      return;
    }
    if (!selectedFile) return;

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('bookingId', bookingId);
      formData.append('kprApplicationId', kprApplicationId);
      formData.append('kprDocumentId', doc.id);
      formData.append('documentCode', doc.documentCode || 'DOC');
      formData.append('file', selectedFile);

      const res = await uploadKprDocumentAction(formData);
      if (!res.success) {
        showToast({
          tone: 'error',
          title: 'Gagal mengunggah dokumen KPR',
          description: res.message,
          correlationId: res.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Dokumen KPR diunggah',
        description: res.message,
      });
      router.refresh();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
        <p className="font-semibold text-[#0F172A]">{doc.documentName}</p>
        <p className="mt-1 text-[#475569]">
          Gunakan dokumen simulasi/fiktif untuk demo (maks. 5 MB: JPG, PNG, WEBP, PDF).
        </p>
      </div>

      <div>
        <label
          htmlFor="kpr-doc-file-input"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          Pilih File Dokumen *
        </label>
        <input
          id="kpr-doc-file-input"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setSelectedFile(file);
            setFileError(file ? validateUploadFileClient(file) : null);
          }}
          className="block w-full cursor-pointer rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] file:mr-3 file:rounded file:border-0 file:bg-[#F0FDF4] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[#14532D]"
        />
        {fileError && (
          <p className="mt-1 text-xs font-medium text-[#DC2626]">{fileError}</p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" variant="primary" isLoading={isSubmitting}>
          Unggah Dokumen
        </Button>
      </div>
    </form>
  );
}

export function UploadKprDocModal({
  isOpen,
  onClose,
  bookingId,
  kprApplicationId,
  doc,
}: {
  isOpen: boolean;
  onClose: () => void;
  bookingId: string;
  kprApplicationId: string;
  doc: KprDocModalTarget | null;
}) {
  return (
    <Modal
      isOpen={isOpen && doc !== null}
      onClose={onClose}
      title="Unggah Dokumen KPR"
      description={doc?.documentName}
      size="md"
    >
      {doc && (
        <UploadKprDocModalInner
          key={doc.id}
          bookingId={bookingId}
          kprApplicationId={kprApplicationId}
          doc={doc}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/* 2. Modal Verifikasi / Revisi Dokumen KPR (Admin-ONLY) */
function VerifyKprDocModalInner({
  doc,
  initialDecision,
  onClose,
}: {
  doc: KprDocModalTarget;
  initialDecision: 'VERIFIED' | 'REVISION_REQUIRED';
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [decision, setDecision] = useState<'VERIFIED' | 'REVISION_REQUIRED'>(
    initialDecision
  );
  const [notes, setNotes] = useState('');
  const [notesError, setNotesError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (decision === 'REVISION_REQUIRED' && notes.trim().length < 5) {
      setNotesError(
        'Catatan revisi wajib diisi minimal 5 karakter saat meminta perbaikan.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await verifyKprDocumentAction({
        kprDocumentId: doc.id,
        decision,
        verificationNotes: notes.trim() || null,
      });

      if (!res.success) {
        showToast({
          tone: 'error',
          title: 'Gagal memproses dokumen KPR',
          description: res.message,
          correlationId: res.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title:
          decision === 'VERIFIED'
            ? 'Dokumen KPR terverifikasi'
            : 'Permintaan revisi dikirim',
        description: res.message,
      });
      router.refresh();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
        <p className="font-semibold text-[#0F172A]">{doc.documentName}</p>
        <p className="mt-0.5 text-[#64748B]">
          Status saat ini: {doc.status.replace(/_/g, ' ')}
        </p>
      </div>

      <Select
        label="Keputusan Verifikasi *"
        value={decision}
        onChange={(e) => {
          setDecision(e.target.value as 'VERIFIED' | 'REVISION_REQUIRED');
          setNotesError(null);
        }}
        options={[
          { value: 'VERIFIED', label: 'VERIFIED — Dokumen Sah & Lengkap' },
          {
            value: 'REVISION_REQUIRED',
            label: 'REVISION_REQUIRED — Minta Perbaikan Sales',
          },
        ]}
      />

      <div>
        <label
          htmlFor="verify-kpr-doc-notes"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          Catatan Verifikasi {decision === 'REVISION_REQUIRED' ? '*' : '(Opsional)'}
        </label>
        <textarea
          id="verify-kpr-doc-notes"
          rows={3}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesError(null);
          }}
          placeholder={
            decision === 'REVISION_REQUIRED'
              ? 'Jelaskan kekurangan dokumen yang harus diperbaiki Sales (min. 5 karakter)...'
              : 'Catatan verifikasi internal (opsional)...'
          }
          className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:outline-none"
        />
        {notesError && (
          <p className="mt-1 text-xs font-medium text-[#DC2626]">{notesError}</p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button
          type="submit"
          variant={decision === 'REVISION_REQUIRED' ? 'destructive' : 'primary'}
          isLoading={isSubmitting}
        >
          {decision === 'VERIFIED' ? 'Sahkan Dokumen' : 'Kirim Permintaan Revisi'}
        </Button>
      </div>
    </form>
  );
}

export function VerifyKprDocModal({
  isOpen,
  onClose,
  doc,
  initialDecision,
}: {
  isOpen: boolean;
  onClose: () => void;
  doc: KprDocModalTarget | null;
  initialDecision: 'VERIFIED' | 'REVISION_REQUIRED';
}) {
  return (
    <Modal
      isOpen={isOpen && doc !== null}
      onClose={onClose}
      title="Pemeriksaan Dokumen KPR"
      description={doc?.documentName}
      size="md"
    >
      {doc && (
        <VerifyKprDocModalInner
          key={`${doc.id}-${initialDecision}`}
          doc={doc}
          initialDecision={initialDecision}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/* 3. Modal Majukan Tahap KPR (TX-09 — Admin-ONLY) */
function AdvanceKprStageModalInner({
  kprApplicationId,
  currentStage,
  allowedTargets,
  isAllMandatoryVerified,
  unverifiedMandatoryCount,
  defaultAkadDateTimeLocal,
  onClose,
}: {
  kprApplicationId: string;
  currentStage: KprStage;
  allowedTargets: KprAdvanceTargetStage[];
  isAllMandatoryVerified: boolean;
  unverifiedMandatoryCount: number;
  defaultAkadDateTimeLocal: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [targetStage, setTargetStage] = useState<KprAdvanceTargetStage>(
    allowedTargets[0] ?? 'DOCUMENT_VERIFICATION'
  );
  const [akadLocal, setAkadLocal] = useState(defaultAkadDateTimeLocal);
  const [akadLocation, setAkadLocation] = useState('');
  const [notaryName, setNotaryName] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSubmittedTargetBlocked =
    targetStage === 'SUBMITTED' && !isAllMandatoryVerified;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (isSubmittedTargetBlocked) {
      setFormError(
        `Masih terdapat ${unverifiedMandatoryCount} dokumen wajib yang belum berstatus VERIFIED.`
      );
      return;
    }

    let akadIso: string | null = null;
    if (targetStage === 'AKAD_SCHEDULED') {
      akadIso = toIsoDateTimeFromJakartaLocal(akadLocal);
      if (!akadIso) {
        setFormError('Jadwal tanggal dan waktu Akad wajib diisi.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await advanceKprStageAction({
        kprApplicationId,
        targetStage,
        akadScheduledAt: akadIso,
        akadLocation:
          targetStage === 'AKAD_SCHEDULED'
            ? akadLocation.trim() || null
            : null,
        notaryName:
          targetStage === 'AKAD_SCHEDULED' ? notaryName.trim() || null : null,
        notes: notes.trim() || null,
      });

      if (!res.success) {
        showToast({
          tone: 'error',
          title: 'Gagal memajukan tahap KPR',
          description: res.message,
          correlationId: res.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Tahap KPR diperbarui',
        description: res.message,
      });
      router.refresh();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
        <span className="text-[#64748B]">Tahap Saat Ini: </span>
        <span className="font-semibold text-[#0F172A]">
          {getKprStageMeta(currentStage).stepNumber}.{' '}
          {getKprStageMeta(currentStage).label}
        </span>
      </div>

      <Select
        label="Tahap Tujuan *"
        value={targetStage}
        onChange={(e) => {
          setTargetStage(e.target.value as KprAdvanceTargetStage);
          setFormError(null);
        }}
        options={allowedTargets.map((t) => {
          const meta = getKprStageMeta(t);
          return {
            value: t,
            label: `${meta.stepNumber}. ${meta.label} (${t})`,
          };
        })}
      />

      {isSubmittedTargetBlocked && (
        <div className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
          Belum siap dikirim ke bank: masih terdapat{' '}
          <span className="font-semibold">{unverifiedMandatoryCount}</span>{' '}
          dokumen wajib yang belum berstatus VERIFIED.
        </div>
      )}

      {targetStage === 'AKAD_SCHEDULED' && (
        <div className="space-y-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
          <div>
            <label
              htmlFor="akad-scheduled-at"
              className="mb-1.5 block text-xs font-medium text-[#334155]"
            >
              Tanggal &amp; Waktu Akad (WIB) *
            </label>
            <input
              id="akad-scheduled-at"
              type="datetime-local"
              value={akadLocal}
              onChange={(e) => setAkadLocal(e.target.value)}
              className="h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs text-[#0F172A] focus:border-[#059669] focus:outline-none"
              required
            />
          </div>

          <Input
            label="Lokasi Akad Kredit"
            placeholder="Contoh: Kantor Cabang Bank Mandiri BSD"
            value={akadLocation}
            onChange={(e) => setAkadLocation(e.target.value)}
          />

          <Input
            label="Nama Notaris / PPAT"
            placeholder="Contoh: Notaris & PPAT Hj. Ratna Kemala, S.H."
            value={notaryName}
            onChange={(e) => setNotaryName(e.target.value)}
          />
        </div>
      )}

      <div>
        <label
          htmlFor="advance-stage-notes"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          Catatan Perpindahan Tahap (Opsional)
        </label>
        <textarea
          id="advance-stage-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Catatan perkembangan berkas atau jadwal dari bank..."
          className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:outline-none"
        />
      </div>

      {formError && (
        <p className="text-xs font-medium text-[#DC2626]">{formError}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button
          type="submit"
          variant="primary"
          isLoading={isSubmitting}
          disabled={isSubmittedTargetBlocked}
        >
          Simpan Tahap
        </Button>
      </div>
    </form>
  );
}

export function AdvanceKprStageModal({
  isOpen,
  onClose,
  kprApplicationId,
  currentStage,
  allowedTargets,
  isAllMandatoryVerified,
  unverifiedMandatoryCount,
  defaultAkadDateTimeLocal,
}: {
  isOpen: boolean;
  onClose: () => void;
  kprApplicationId: string;
  currentStage: KprStage;
  allowedTargets: KprAdvanceTargetStage[];
  isAllMandatoryVerified: boolean;
  unverifiedMandatoryCount: number;
  defaultAkadDateTimeLocal: string;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Majukan Tahap KPR"
      description="Transisi tahapan proses pengajuan KPR secara atomik"
      size="md"
    >
      {isOpen && (
        <AdvanceKprStageModalInner
          key={`${kprApplicationId}-${currentStage}`}
          kprApplicationId={kprApplicationId}
          currentStage={currentStage}
          allowedTargets={allowedTargets}
          isAllMandatoryVerified={isAllMandatoryVerified}
          unverifiedMandatoryCount={unverifiedMandatoryCount}
          defaultAkadDateTimeLocal={defaultAkadDateTimeLocal}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/* 4. Modal Catat Keputusan Bank / SP3K (TX-04 — Admin-ONLY) */
function RecordKprApprovalModalInner({
  kprApplicationId,
  requestedLoanAmount,
  defaultTopupDueDate,
  onClose,
}: {
  kprApplicationId: string;
  requestedLoanAmount: number;
  defaultTopupDueDate: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED_BY_BANK'>(
    'APPROVED'
  );
  const [sp3kRef, setSp3kRef] = useState('');
  const [approvedAmountStr, setApprovedAmountStr] = useState(
    String(requestedLoanAmount)
  );
  const [topupDueDate, setTopupDueDate] = useState(defaultTopupDueDate);
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const numericApproved = Number(approvedAmountStr) || 0;
  const shortfallAmount = Math.max(0, requestedLoanAmount - numericApproved);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (decision === 'APPROVED') {
      if (sp3kRef.trim().length < 3) {
        setErrorMsg('Nomor referensi SP3K bank wajib diisi minimal 3 karakter.');
        return;
      }
      if (numericApproved <= 0 || numericApproved > requestedLoanAmount) {
        setErrorMsg(
          `Plafon disetujui harus > Rp 0 dan tidak melebihi plafon pengajuan (${formatRupiah(requestedLoanAmount)}).`
        );
        return;
      }
    } else if (notes.trim().length < 5) {
      setErrorMsg(
        'Alasan penolakan dari bank wajib diisi minimal 5 karakter.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await recordKprApprovalAction({
        kprApplicationId,
        decision,
        sp3kReferenceNumber: decision === 'APPROVED' ? sp3kRef.trim() : null,
        approvedLoanAmount: decision === 'APPROVED' ? numericApproved : null,
        topupDpDueDate:
          decision === 'APPROVED' && shortfallAmount > 0 ? topupDueDate : null,
        notes: notes.trim() || null,
      });

      if (!res.success) {
        showToast({
          tone: 'error',
          title: 'Gagal mencatat keputusan bank',
          description: res.message,
          correlationId: res.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Keputusan KPR bank dicatat',
        description: res.message,
      });
      router.refresh();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select
        label="Keputusan Bank *"
        value={decision}
        onChange={(e) => {
          setDecision(e.target.value as 'APPROVED' | 'REJECTED_BY_BANK');
          setErrorMsg(null);
        }}
        options={[
          { value: 'APPROVED', label: 'APPROVED — Terbit SP3K / SPPK' },
          {
            value: 'REJECTED_BY_BANK',
            label: 'REJECTED_BY_BANK — Pengajuan Ditolak Bank',
          },
        ]}
      />

      {decision === 'APPROVED' ? (
        <div className="space-y-3">
          <Input
            label="Nomor Referensi SP3K *"
            placeholder="Contoh: SP3K/BMRI/2026/03/0012"
            value={sp3kRef}
            onChange={(e) => setSp3kRef(e.target.value)}
            required
          />

          <CurrencyInput
            label={`Plafon Disetujui (Maks. ${formatRupiah(requestedLoanAmount)}) *`}
            min={1}
            max={requestedLoanAmount}
            value={approvedAmountStr}
            onValueChange={setApprovedAmountStr}
            required
          />

          {shortfallAmount > 0 && (
            <div className="space-y-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
              <p className="font-semibold">
                Terdeteksi Penurunan Plafon: {formatRupiah(shortfallAmount)}
              </p>
              <p>
                Sistem akan otomatis membuat jadwal tagihan{' '}
                <span className="font-mono font-semibold">KPR_TOPUP_DP</span>{' '}
                sebesar selisih plafon pada Booking terkait.
              </p>
              <Input
                label="Jatuh Tempo Top-Up DP *"
                type="date"
                value={topupDueDate}
                onChange={(e) => setTopupDueDate(e.target.value)}
                required
              />
            </div>
          )}
        </div>
      ) : null}

      <div>
        <label
          htmlFor="kpr-approval-notes"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          {decision === 'REJECTED_BY_BANK'
            ? 'Alasan Penolakan Bank (Min. 5 Karakter) *'
            : 'Catatan SP3K (Opsional)'}
        </label>
        <textarea
          id="kpr-approval-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            decision === 'REJECTED_BY_BANK'
              ? 'Contoh: Rasio DSR pemohon melebihi ketentuan kredit bank.'
              : 'Catatan tambahan mengenai ketentuan SP3K...'
          }
          className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:outline-none"
        />
      </div>

      {errorMsg && (
        <p className="text-xs font-medium text-[#DC2626]">{errorMsg}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button
          type="submit"
          variant={decision === 'REJECTED_BY_BANK' ? 'destructive' : 'primary'}
          isLoading={isSubmitting}
        >
          {decision === 'APPROVED' ? 'Simpan SP3K' : 'Catat Penolakan Bank'}
        </Button>
      </div>
    </form>
  );
}

export function RecordKprApprovalModal({
  isOpen,
  onClose,
  kprApplicationId,
  requestedLoanAmount,
  defaultTopupDueDate,
}: {
  isOpen: boolean;
  onClose: () => void;
  kprApplicationId: string;
  requestedLoanAmount: number;
  defaultTopupDueDate: string;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Catat Keputusan Bank (SP3K)"
      description="Keputusan persetujuan plafon SP3K atau penolakan oleh bank"
      size="md"
    >
      {isOpen && (
        <RecordKprApprovalModalInner
          key={kprApplicationId}
          kprApplicationId={kprApplicationId}
          requestedLoanAmount={requestedLoanAmount}
          defaultTopupDueDate={defaultTopupDueDate}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/* 5. Modal Pembatalan KPR oleh Konsumen (TX-10 — Admin-ONLY) */
function CancelKprCustomerModalInner({
  kprApplicationId,
  onClose,
}: {
  kprApplicationId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setErrorMsg('Alasan pembatalan konsumen minimal 5 karakter.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await cancelKprByCustomerAction({
        kprApplicationId,
        cancellationReason: reason.trim(),
        notes: notes.trim() || null,
      });

      if (!res.success) {
        showToast({
          tone: 'error',
          title: 'Gagal mencatat pembatalan KPR',
          description: res.message,
          correlationId: res.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Pembatalan KPR dicatat',
        description: res.message,
      });
      router.refresh();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]">
        Pengajuan KPR akan berstatus CANCELLED_BY_CUSTOMER pada tahap terakhirnya. Status Booking &amp; Unit tetap aktif hingga Admin memproses pembatalan transaksi resmi bila diperlukan.
      </div>

      <div>
        <label
          htmlFor="cancel-kpr-reason"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          Alasan Pembatalan Konsumen (Min. 5 Karakter) *
        </label>
        <textarea
          id="cancel-kpr-reason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setErrorMsg(null);
          }}
          placeholder="Contoh: Konsumen membatalkan KPR karena beralih ke pembayaran Cash Bertahap..."
          className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:outline-none"
          required
        />
        {errorMsg && (
          <p className="mt-1 text-xs font-medium text-[#DC2626]">{errorMsg}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="cancel-kpr-notes"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          Catatan Tambahan (Opsional)
        </label>
        <input
          id="cancel-kpr-notes"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Keterangan tindak lanjut..."
          className="h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs text-[#0F172A] focus:border-[#059669] focus:outline-none"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" variant="destructive" isLoading={isSubmitting}>
          Sahkan Pembatalan KPR
        </Button>
      </div>
    </form>
  );
}

export function CancelKprCustomerModal({
  isOpen,
  onClose,
  kprApplicationId,
}: {
  isOpen: boolean;
  onClose: () => void;
  kprApplicationId: string;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Pembatalan KPR oleh Konsumen"
      description="Mencatat pembatalan pengajuan kredit atas permintaan konsumen"
      size="md"
    >
      {isOpen && (
        <CancelKprCustomerModalInner
          key={kprApplicationId}
          kprApplicationId={kprApplicationId}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/* 6. Modal Catat Pencairan Dana Bank KPR (TX-08 — Admin-ONLY) */
function RecordKprDisbursementModalInner({
  bookingId,
  kprApplicationId,
  trancheType,
  remainingUndisbursedAmount,
  defaultDateStr,
  onClose,
}: {
  bookingId: string;
  kprApplicationId: string;
  trancheType: DisbursementTranche;
  remainingUndisbursedAmount: number;
  defaultDateStr: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [disbursementReference, setDisbursementReference] = useState('');
  const [disbursedAmountStr, setDisbursedAmountStr] = useState(
    String(remainingUndisbursedAmount)
  );
  const [disbursementDate, setDisbursementDate] = useState(defaultDateStr);
  const [notes, setNotes] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const numericAmount = Number(disbursedAmountStr) || 0;
  const willFullyDisburse = numericAmount === remainingUndisbursedAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (disbursementReference.trim().length < 3) {
      setErrorMsg('Nomor referensi pencairan wajib diisi minimal 3 karakter.');
      return;
    }
    if (numericAmount <= 0 || numericAmount > remainingUndisbursedAmount) {
      setErrorMsg(
        `Nominal pencairan harus > Rp 0 dan maksimal sebesar sisa plafon (${formatRupiah(remainingUndisbursedAmount)}).`
      );
      return;
    }

    const fileErr = validateUploadFileClient(proofFile);
    if (fileErr) {
      setErrorMsg(fileErr);
      return;
    }
    if (!proofFile) return;

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('bookingId', bookingId);
      formData.append('kprApplicationId', kprApplicationId);
      formData.append('trancheType', trancheType);
      formData.append('disbursementReference', disbursementReference.trim());
      formData.append('disbursedAmount', String(numericAmount));
      formData.append('disbursementDate', disbursementDate);
      if (notes.trim()) {
        formData.append('notes', notes.trim());
      }
      formData.append('proofFile', proofFile);

      const res = await recordKprDisbursementAction(formData);
      if (!res.success) {
        showToast({
          tone: 'error',
          title: 'Gagal mencatat pencairan KPR',
          description: res.message,
          correlationId: res.correlationId,
        });
        return;
      }

      showToast({
        tone: 'success',
        title: 'Pencairan KPR berhasil dicatat',
        description: res.message,
      });
      router.refresh();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-xs text-[#1E40AF]">
        <p className="font-semibold">
          Termin Pencairan: {trancheType} • Sisa Plafon:{' '}
          <span className="font-mono tabular-nums">
            {formatRupiah(remainingUndisbursedAmount)}
          </span>
        </p>
        <p className="mt-1">
          {willFullyDisburse
            ? 'Pencairan ini mencapai 100% (FULLY_DISBURSED) -> Unit akan beralih menjadi SOLD (TC-01A).'
            : 'Pencairan parsial (PARTIALLY_DISBURSED) -> Unit tetap BOOKED hingga pencairan 100% (TC-01A).'}
        </p>
      </div>

      <Input
        label="Nomor Referensi Advis Pencairan *"
        placeholder="Contoh: DISB-BMRI-2026-0091-S2"
        value={disbursementReference}
        onChange={(e) => setDisbursementReference(e.target.value)}
        required
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CurrencyInput
          label="Nominal Pencairan (Rp) *"
          min={1}
          max={remainingUndisbursedAmount}
          value={disbursedAmountStr}
          onValueChange={setDisbursedAmountStr}
          required
        />
        <Input
          label="Tanggal Pencairan *"
          type="date"
          value={disbursementDate}
          onChange={(e) => setDisbursementDate(e.target.value)}
          required
        />
      </div>

      <div>
        <label
          htmlFor="kpr-disb-proof-input"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          Bukti Advis Kredit / Mutasi Bank (Maks. 5 MB: JPG, PNG, WEBP, PDF) *
        </label>
        <input
          id="kpr-disb-proof-input"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setProofFile(file);
            setErrorMsg(file ? validateUploadFileClient(file) : null);
          }}
          className="block w-full cursor-pointer rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] file:mr-3 file:rounded file:border-0 file:bg-[#F0FDF4] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[#14532D]"
        />
      </div>

      <div>
        <label
          htmlFor="kpr-disb-notes"
          className="mb-1.5 block text-xs font-medium text-[#334155]"
        >
          Catatan Pencairan (Opsional)
        </label>
        <textarea
          id="kpr-disb-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Catatan termin pencairan atau BAST..."
          className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:outline-none"
        />
      </div>

      {errorMsg && (
        <p className="text-xs font-medium text-[#DC2626]">{errorMsg}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" variant="primary" isLoading={isSubmitting}>
          Catat Pencairan
        </Button>
      </div>
    </form>
  );
}

export function RecordKprDisbursementModal({
  isOpen,
  onClose,
  bookingId,
  kprApplicationId,
  trancheType,
  remainingUndisbursedAmount,
  defaultDateStr,
}: {
  isOpen: boolean;
  onClose: () => void;
  bookingId: string;
  kprApplicationId: string;
  trancheType: DisbursementTranche | null;
  remainingUndisbursedAmount: number;
  defaultDateStr: string;
}) {
  return (
    <Modal
      isOpen={isOpen && trancheType !== null}
      onClose={onClose}
      title="Catat Pencairan Dana Bank (KPR)"
      description="Rekonsiliasi pencairan bank sesuai kebijakan TC-01A"
      size="md"
    >
      {isOpen && trancheType && (
        <RecordKprDisbursementModalInner
          key={`${kprApplicationId}-${trancheType}-${remainingUndisbursedAmount}`}
          bookingId={bookingId}
          kprApplicationId={kprApplicationId}
          trancheType={trancheType}
          remainingUndisbursedAmount={remainingUndisbursedAmount}
          defaultDateStr={defaultDateStr}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
