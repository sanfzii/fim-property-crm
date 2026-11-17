// Tombol unduh dokumen privat via signed URL. Dipisahkan dari preview modal
// agar fitur unduh yang sering terlihat tidak menarik bundle preview yang berat.

'use client';

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { getDocumentSignedUrlAction } from '@/modules/transactions/transactions.actions';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';

function triggerAnchorDownload(url: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName || 'dokumen-fim-property';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function DownloadDocumentButton({
  filePath,
  fileName,
  label = 'Unduh',
  size = 'sm',
  variant = 'outline',
}: {
  filePath: string;
  fileName: string;
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'outline' | 'secondary' | 'ghost';
}) {
  const { showToast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);

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
          title: 'Gagal mengunduh dokumen',
          description: result.message,
          correlationId: result.correlationId,
        });
        return;
      }

      triggerAnchorDownload(result.data.signedUrl, fileName);
      showToast({
        tone: 'success',
        title: 'Tautan unduhan aktif (berlaku 300 detik)',
        description: fileName,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      isLoading={isDownloading}
      onClick={handleDownload}
      leftIcon={<Download className="h-3.5 w-3.5" strokeWidth={1.75} />}
    >
      {label}
    </Button>
  );
}
