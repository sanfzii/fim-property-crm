// Lokasi: src/modules/shared/storage/storage.service.ts
// Level Topologis: L0 (Core Infrastructure — Private Storage Integration Service)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';
import { serverLogger } from '@/lib/logger/server-logger';
import { isValidStorageObjectPath } from './storage.paths';
import {
  STORAGE_BUCKET_NAME,
  SIGNED_URL_EXPIRES_IN_SECONDS,
  sanitizeFileName,
  validateUploadedFileServer,
  type ValidatedFileMetadata,
} from './storage.validator';

export interface UploadedStorageObject {
  filePath: string;
  originalFileName: string;
  sanitizedFileName: string;
  mimeType: string;
  sizeBytes: number;
}

export const PrivateStorageService = {
  /**
   * Memvalidasi struktur path, ukuran, ekstensi, MIME, dan Magic Bytes lalu mengunggah file
   * ke bucket privat 'fim-private-documents' menggunakan konteks sesi pengguna (RLS Storage aktif).
   */
  async validateAndUpload(params: {
    file: File | null | undefined;
    targetPath: string;
    pdfOnly?: boolean;
  }): Promise<UploadedStorageObject> {
    if (!isValidStorageObjectPath(params.targetPath)) {
      throw new AppError({
        message: 'Format path tujuan dokumen tidak valid.',
        category: 'VALIDATION_ERROR',
        code: 'INVALID_STORAGE_PATH',
        statusCode: 400,
      });
    }

    let validated: ValidatedFileMetadata;
    try {
      validated = await validateUploadedFileServer(params.file, {
        pdfOnly: params.pdfOnly,
      });
    } catch (validationErr) {
      const rawMsg =
        validationErr instanceof Error ? validationErr.message : 'File dokumen tidak valid.';
      const match = rawMsg.match(/^([A-Z0-9_]+):\s*(.+)$/);
      throw new AppError({
        message: match?.[2] ?? rawMsg,
        category: 'VALIDATION_ERROR',
        code: match?.[1] ?? 'INVALID_UPLOAD_FILE',
        statusCode: 400,
      });
    }

    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET_NAME)
      .upload(params.targetPath, validated.buffer, {
        contentType: validated.mimeType,
        upsert: false, // Dilarang menimpa file yang sudah ada (BR-10)
      });

    if (error) {
      throw new AppError({
        message: `Gagal mengunggah dokumen ke penyimpanan privat: ${error.message}`,
        category: 'STORAGE_ERROR',
        code: 'STORAGE_UPLOAD_FAILED',
        statusCode: 400,
      });
    }

    return {
      filePath: params.targetPath,
      originalFileName: validated.originalFileName,
      sanitizedFileName: validated.sanitizedFileName,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
    };
  },

  /**
   * Membangkitkan Signed URL berbatas waktu (300 detik / 5 menit) untuk pratinjau atau unduh.
   * Menggunakan Server Client pengguna sehingga otomatis melewati pemeriksaan RLS storage.objects!
   * Pesan penolakan diseragamkan untuk mencegah existence oracle.
   */
  async createAuthorizedSignedUrl(
    filePath: string,
    options?: { downloadFileName?: string }
  ): Promise<{ signedUrl: string; expiresAt: string; expiresInSeconds: number }> {
    if (!isValidStorageObjectPath(filePath)) {
      throw new AppError({
        message: 'Format path dokumen tidak valid.',
        category: 'VALIDATION_ERROR',
        code: 'INVALID_STORAGE_PATH',
        statusCode: 400,
      });
    }

    const safeDownloadName = options?.downloadFileName?.trim()
      ? sanitizeFileName(options.downloadFileName)
      : undefined;

    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET_NAME)
      .createSignedUrl(
        filePath,
        SIGNED_URL_EXPIRES_IN_SECONDS,
        safeDownloadName ? { download: safeDownloadName } : undefined
      );

    if (error || !data?.signedUrl) {
      throw new AppError({
        message: 'Dokumen tidak ditemukan atau Anda tidak berwenang mengakses dokumen transaksi ini.',
        category: 'AUTHORIZATION_ERROR',
        code: 'SIGNED_URL_ACCESS_DENIED',
        statusCode: 403,
      });
    }

    const expiresAt = new Date(
      Date.now() + SIGNED_URL_EXPIRES_IN_SECONDS * 1000
    ).toISOString();

    return {
      signedUrl: data.signedUrl,
      expiresAt,
      expiresInSeconds: SIGNED_URL_EXPIRES_IN_SECONDS,
    };
  },

  /**
   * Compensating Cleanup:
   * Karena Supabase Storage dan PostgreSQL tidak berada dalam satu transaksi 2PC yang sama,
   * fungsi ini dipanggil di blok catch apabila unggah file ke Storage berhasil tetapi
   * penyimpanan metadata ke tabel PostgreSQL gagal, sehingga tidak meninggalkan file yatim.
   */
  async rollbackOrphanedUploadSafe(filePath: string): Promise<void> {
    if (!isValidStorageObjectPath(filePath)) {
      serverLogger.warn('Skipped compensating storage cleanup due to invalid path', {
        module: 'PrivateStorageService',
        action: 'rollbackOrphanedUploadSafe',
        metadata: { filePath },
      });
      return;
    }

    try {
      const supabaseAdmin = createSupabaseAdminClient();
      const { error } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET_NAME)
        .remove([filePath]);

      if (error) {
        serverLogger.warn('Supabase rejected orphaned storage object removal', {
          module: 'PrivateStorageService',
          action: 'rollbackOrphanedUploadSafe',
          metadata: { filePath, error: error.message },
        });
      }
    } catch (err) {
      serverLogger.warn('Failed to remove orphaned storage object during rollback', {
        module: 'PrivateStorageService',
        action: 'rollbackOrphanedUploadSafe',
        metadata: { filePath, error: err instanceof Error ? err.message : String(err) },
      });
    }
  },
};
