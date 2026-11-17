// Lokasi: src/lib/errors/app-error.ts
// Level Topologis: L0 (Core Infrastructure — Unified Error Handling & Translator)

import { ZodError } from 'zod';
import { AuthorizationError } from '@/modules/identity/auth/auth.guards';
import { generateCorrelationId, serverLogger } from '@/lib/logger/server-logger';

export type AppErrorCategory =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND_ERROR'
  | 'CONFLICT_ERROR'
  | 'BUSINESS_RULE_ERROR'
  | 'STORAGE_ERROR'
  | 'DATABASE_ERROR'
  | 'UNEXPECTED_ERROR';

export interface ActionResult<T = undefined> {
  success: boolean;
  message: string;
  code: string;
  category?: AppErrorCategory;
  correlationId: string;
  data?: T;
  fieldErrors?: Record<string, string[]>;
}

export class AppError extends Error {
  public readonly category: AppErrorCategory;
  public readonly code: string;
  public readonly statusCode: number;
  public readonly fieldErrors?: Record<string, string[]>;

  constructor(params: {
    message: string;
    category: AppErrorCategory;
    code: string;
    statusCode?: number;
    fieldErrors?: Record<string, string[]>;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.category = params.category;
    this.code = params.code;
    this.statusCode = params.statusCode ?? 400;
    this.fieldErrors = params.fieldErrors;
  }
}

/**
 * Menerjemahkan pesan error terstruktur dari fungsi PostgreSQL RPC (TX-01 s/d TX-10),
 * 6 trigger guard File 03, atau constraint PostgreSQL menjadi AppError yang aman bagi pengguna.
 */
export function translateDatabaseOrRpcError(
  rawError: { code?: string; message?: string; details?: string } | unknown
): AppError {
  if (rawError instanceof AppError) {
    return rawError;
  }

  const pgCode = (rawError as { code?: string })?.code ?? '';
  const rawMessage = (rawError as { message?: string })?.message ?? '';

  // 1. Tangkap pola "<KODE_ERROR>: <Pesan Bisnis>" dari RPC TX-01 s/d TX-10 & Trigger Keamanan
  const prefixMatch = rawMessage.match(/^([A-Z0-9_]+):\s*(.+)$/);
  if (prefixMatch) {
    const [, errorCode = 'RPC_ERROR', cleanMessage = 'Operasi ditolak oleh aturan bisnis.'] =
      prefixMatch;

    if (errorCode === 'UNAUTHORIZED') {
      return new AppError({
        message: cleanMessage,
        category: 'AUTHENTICATION_ERROR',
        code: errorCode,
        statusCode: 401,
      });
    }

    if (
      errorCode === 'FORBIDDEN' ||
      errorCode === 'PRIVILEGE_ESCALATION_BLOCKED' ||
      errorCode === 'CROSS_TEAM_TRANSFER_DENIED' ||
      errorCode === 'INTEGRITY_VIOLATION'
    ) {
      return new AppError({
        message: cleanMessage,
        category: 'AUTHORIZATION_ERROR',
        code: errorCode,
        statusCode: 403,
      });
    }

    if (errorCode === 'NOT_FOUND') {
      return new AppError({
        message: cleanMessage,
        category: 'NOT_FOUND_ERROR',
        code: errorCode,
        statusCode: 404,
      });
    }

    if (
      errorCode === 'UNIT_NOT_AVAILABLE' ||
      errorCode === 'ALREADY_PROCESSED' ||
      errorCode === 'ALREADY_CANCELLED' ||
      errorCode === 'ALREADY_SETTLED' ||
      errorCode === 'DUPLICATE_DISBURSEMENT_REF' ||
      errorCode === 'INSTALLMENTS_ALREADY_GENERATED' ||
      errorCode === 'SAME_STAGE'
    ) {
      return new AppError({
        message: cleanMessage,
        category: 'CONFLICT_ERROR',
        code: errorCode,
        statusCode: 409,
      });
    }

    return new AppError({
      message: cleanMessage,
      category: 'BUSINESS_RULE_ERROR',
      code: errorCode,
      statusCode: 422,
    });
  }

  // 2. Tangkap SQLSTATE standar PostgreSQL
  if (pgCode === '23505') {
    if (rawMessage.includes('uq_leads_phone')) {
      return new AppError({
        message: 'Nomor telepon calon pembeli ini sudah terdaftar di dalam database Lead.',
        category: 'CONFLICT_ERROR',
        code: 'DUPLICATE_LEAD_PHONE',
        statusCode: 409,
      });
    }
    if (rawMessage.includes('uq_one_active_booking_per_unit')) {
      return new AppError({
        message: 'Unit properti ini sudah memiliki reservasi Booking yang sedang aktif.',
        category: 'CONFLICT_ERROR',
        code: 'DOUBLE_BOOKING_PREVENTED',
        statusCode: 409,
      });
    }
    if (rawMessage.includes('uq_one_active_supervisor_per_team')) {
      return new AppError({
        message: 'Tim penjualan ini sudah memiliki satu Supervisor aktif.',
        category: 'CONFLICT_ERROR',
        code: 'DUPLICATE_TEAM_SUPERVISOR',
        statusCode: 409,
      });
    }
    if (rawMessage.includes('uq_kpr_disbursements_ref')) {
      return new AppError({
        message: 'Nomor referensi pencairan KPR ini sudah pernah dicatat sebelumnya.',
        category: 'CONFLICT_ERROR',
        code: 'DUPLICATE_DISBURSEMENT_REF',
        statusCode: 409,
      });
    }
    return new AppError({
      message: 'Data dengan kode atau identitas unik tersebut sudah terdaftar di sistem.',
      category: 'CONFLICT_ERROR',
      code: 'UNIQUE_CONSTRAINT_VIOLATION',
      statusCode: 409,
    });
  }

  if (pgCode === '23514') {
    return new AppError({
      message: 'Nilai data yang dikirimkan melanggar aturan validasi bisnis pada database.',
      category: 'BUSINESS_RULE_ERROR',
      code: 'CHECK_CONSTRAINT_VIOLATION',
      statusCode: 422,
    });
  }

  if (pgCode === '23503') {
    return new AppError({
      message: 'Data referensi induk tidak ditemukan atau sedang terikat dengan transaksi aktif.',
      category: 'BUSINESS_RULE_ERROR',
      code: 'FOREIGN_KEY_VIOLATION',
      statusCode: 422,
    });
  }

  if (pgCode === '22P02') {
    return new AppError({
      message: 'Format parameter atau identitas UUID tidak valid.',
      category: 'VALIDATION_ERROR',
      code: 'INVALID_INPUT_SYNTAX',
      statusCode: 400,
    });
  }

  if (pgCode === '40P01') {
    return new AppError({
      message: 'Terjadi konflik pembaruan serentak pada data yang sama. Silakan ulangi operasi.',
      category: 'CONFLICT_ERROR',
      code: 'CONCURRENT_LOCK_CONFLICT',
      statusCode: 409,
    });
  }

  if (pgCode === '42501') {
    return new AppError({
      message: 'Anda tidak memiliki izin akses untuk menjalankan operasi ini.',
      category: 'AUTHORIZATION_ERROR',
      code: 'RLS_POLICY_DENIED',
      statusCode: 403,
    });
  }

  if (pgCode === 'PGRST116' || pgCode === 'P0002') {
    return new AppError({
      message: 'Data yang diminta tidak ditemukan atau berada di luar cakupan akses Anda.',
      category: 'NOT_FOUND_ERROR',
      code: 'RESOURCE_NOT_FOUND',
      statusCode: 404,
    });
  }

  return new AppError({
    message: 'Terjadi kendala saat memproses data di server. Silakan coba beberapa saat lagi.',
    category: 'DATABASE_ERROR',
    code: 'DATABASE_OPERATION_FAILED',
    statusCode: 500,
  });
}

/**
 * Pembungkus (Wrapper) eksekusi Server Action agar seluruh Server Action memiliki
 * format respons, pencatatan log, dan penanganan error yang 100% seragam.
 */
export async function executeSafeServerAction<T>(
  context: { module: string; action: string },
  fn: (correlationId: string) => Promise<{ message: string; data?: T }>
): Promise<ActionResult<T>> {
  const correlationId = generateCorrelationId();

  try {
    const result = await fn(correlationId);
    return {
      success: true,
      message: result.message,
      code: 'OK',
      correlationId,
      data: result.data,
    };
  } catch (error) {
    // 1. Jika error validasi Zod
    if (error instanceof ZodError) {
      const fieldErrors = error.flatten().fieldErrors as Record<string, string[]>;
      const firstIssue = error.issues[0]?.message ?? 'Data input tidak valid.';
      return {
        success: false,
        message: firstIssue,
        code: 'VALIDATION_FAILED',
        category: 'VALIDATION_ERROR',
        correlationId,
        fieldErrors,
      };
    }

    // 2. Jika error otorisasi dari auth.guards.ts
    if (error instanceof AuthorizationError) {
      serverLogger.warn('Authorization denied on Server Action', {
        correlationId,
        module: context.module,
        action: context.action,
        metadata: { code: error.code, message: error.message },
      });
      return {
        success: false,
        message: error.message.replace(/^(UNAUTHORIZED|FORBIDDEN):\s*/i, ''),
        code: error.code,
        category:
          error.statusCode === 401 ? 'AUTHENTICATION_ERROR' : 'AUTHORIZATION_ERROR',
        correlationId,
      };
    }

    // 3. Jika sudah berupa AppError terstruktur
    if (error instanceof AppError) {
      if (error.category === 'DATABASE_ERROR' || error.category === 'UNEXPECTED_ERROR') {
        serverLogger.error('Application error in Server Action', error, {
          correlationId,
          module: context.module,
          action: context.action,
        });
      }
      return {
        success: false,
        message: error.message,
        code: error.code,
        category: error.category,
        correlationId,
        fieldErrors: error.fieldErrors,
      };
    }

    // 4. Error tidak terduga lainnya (Jangan bocorkan stack trace ke browser!)
    serverLogger.error('Unhandled exception in Server Action', error, {
      correlationId,
      module: context.module,
      action: context.action,
    });

    return {
      success: false,
      message: 'Terjadi kesalahan internal pada sistem. Kode referensi: ' + correlationId,
      code: 'INTERNAL_SERVER_ERROR',
      category: 'UNEXPECTED_ERROR',
      correlationId,
    };
  }
}
