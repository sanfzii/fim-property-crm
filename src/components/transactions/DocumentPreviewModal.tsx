// Lokasi: src/components/transactions/DocumentPreviewModal.tsx
// Komponen Reusable Pratinjau & Unduh Dokumen Aman via Signed URL (300 detik on-demand)

'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Clock,
  Download,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { getDocumentSignedUrlAction } from '@/modules/transactions/transactions.actions';
import { detectDocumentKind } from '@/lib/utils/transactions-ui';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';

export interface DocumentPreviewContentProps {
  filePath: string;
  fileName: string;
  title?: string;
  isActive: boolean;
}

function triggerAnchorDownload(url: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName || 'dokumen-fim-property';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

interface PreviewFetchState {
  targetKey: string;
  status: 'ready' | 'error';
  signedUrl: string | null;
  expiresInSeconds: number;
  errorState: {
    message: string;
    correlationId?: string;
  } | null;
}

export function DocumentPreviewContent({
  filePath,
  fileName,
  title,
  isActive,
}: DocumentPreviewContentProps) {
  const { showToast } = useToast();
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loadedState, setLoadedState] = useState<PreviewFetchState | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const activeKey = isActive && filePath ? `${filePath}::${reloadNonce}` : null;

  useEffect(() => {
    if (!activeKey || !filePath) {
      return;
    }

    let cancelled = false;

    void getDocumentSignedUrlAction({
      filePath,
      mode: 'PREVIEW',
    })
      .then((result) => {
        if (cancelled) return;
        if (!result.success || !result.data) {
          setLoadedState({
            targetKey: activeKey,
            status: 'error',
            signedUrl: null,
            expiresInSeconds: 300,
            errorState: {
              message: result.message,
              correlationId: result.correlationId,
            },
          });
          return;
        }

        setLoadedState({
          targetKey: activeKey,
          status: 'ready',
          signedUrl: result.data.signedUrl,
          expiresInSeconds: result.data.expiresInSeconds,
          errorState: null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoadedState({
          targetKey: activeKey,
          status: 'error',
          signedUrl: null,
          expiresInSeconds: 300,
          errorState: {
            message: 'Terjadi kesalahan saat meminta tautan pratinjau dokumen.',
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeKey, filePath]);

  const currentResult =
    activeKey && loadedState?.targetKey === activeKey ? loadedState : null;
  const status: 'idle' | 'loading' | 'ready' | 'error' = !activeKey
    ? 'idle'
    : currentResult
      ? currentResult.status
      : 'loading';
  const signedUrl = currentResult?.signedUrl ?? null;
  const expiresInSeconds = currentResult?.expiresInSeconds ?? 300;
  const errorState = currentResult?.errorState ?? null;

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const result = await getDocumentSignedUrlAction({
        filePath,
        mode: 'DOWNLOAD',
        downloadFileName: fileName,
      });

      if (!result.success || !result.data) {
        showToast({
          tone: 'error',
          title: 'Gagal membuat tautan unduh',
          description: result.message,
          correlationId: result.correlationId,
        });
        return;
      }

      triggerAnchorDownload(result.data.signedUrl, fileName);
    } finally {
      setIsDownloading(false);
    }
  };

  const docKind = detectDocumentKind(fileName || filePath);

  return (
    <div className="flex flex-col gap-3">
      {/* Info masa berlaku Signed URL 300 detik + aksi Unduh */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-[#475569]">
          <Clock className="h-3.5 w-3.5 shrink-0 text-[#059669]" strokeWidth={1.75} />
          <span className="truncate">
            Tautan terotorisasi berlaku 5 menit ({expiresInSeconds} detik)
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setReloadNonce((n) => n + 1)}
            disabled={status === 'loading'}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
          >
            Muat Ulang
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            isLoading={isDownloading}
            onClick={handleDownload}
            leftIcon={<Download className="h-3.5 w-3.5" strokeWidth={1.75} />}
          >
            Unduh
          </Button>
        </div>
      </div>

      {/* Area Konten Pratinjau */}
      {status === 'loading' || status === 'idle' ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-2.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-6 text-center">
          <Loader2
            className="h-6 w-6 animate-spin text-[#14532D]"
            strokeWidth={1.75}
          />
          <p className="text-xs font-medium text-[#0F172A]">
            Menyiapkan pratinjau dokumen privat...
          </p>
          <p className="text-[11px] text-[#64748B]">{fileName}</p>
        </div>
      ) : status === 'error' ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#DC2626] ring-1 ring-[#FECACA]">
            <AlertCircle className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="max-w-md space-y-1">
            <p className="text-xs font-semibold text-[#991B1B]">
              Pratinjau Dokumen Tidak Tersedia
            </p>
            <p className="text-xs leading-relaxed text-[#B91C1C]">
              {errorState?.message ?? 'Dokumen tidak dapat dimuat.'}
            </p>
            {errorState?.correlationId && (
              <p className="font-mono text-[11px] text-[#991B1B]">
                Ref ID: {errorState.correlationId}
              </p>
            )}
            <p className="pt-1 font-mono text-[11px] break-all text-[#64748B]">
              {fileName}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setReloadNonce((n) => n + 1)}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
          >
            Coba Muat Ulang
          </Button>
        </div>
      ) : signedUrl ? (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
          {docKind === 'IMAGE' ? (
            <div className="flex max-h-[420px] items-center justify-center overflow-auto bg-[#0F172A]/5 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signedUrl}
                alt={title ?? fileName}
                className="max-h-[396px] w-auto rounded object-contain"
              />
            </div>
          ) : docKind === 'PDF' ? (
            <iframe
              src={signedUrl}
              title={title ? `Pratinjau Dokumen — ${title}` : 'Pratinjau Dokumen'}
              className="h-[420px] w-full bg-white"
            />
          ) : (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 p-6 text-center">
              <FileText className="h-8 w-8 text-[#64748B]" strokeWidth={1.5} />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#0F172A]">{fileName}</p>
                <p className="text-xs text-[#64748B]">
                  Format file ini tidak mendukung pratinjau langsung. Silakan unduh file.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="primary"
                isLoading={isDownloading}
                onClick={handleDownload}
                leftIcon={<Download className="h-3.5 w-3.5" strokeWidth={1.75} />}
              >
                Unduh Dokumen
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export interface DocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  fileName: string;
  title?: string;
  description?: string;
}

export function DocumentPreviewModal({
  isOpen,
  onClose,
  filePath,
  fileName,
  title = 'Pratinjau Dokumen',
  description,
}: DocumentPreviewModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description ?? fileName}
      size="lg"
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          Tutup
        </Button>
      }
    >
      <DocumentPreviewContent
        filePath={filePath}
        fileName={fileName}
        title={title}
        isActive={isOpen}
      />
    </Modal>
  );
}
