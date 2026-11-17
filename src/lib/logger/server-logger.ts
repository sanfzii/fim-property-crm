// Lokasi: src/lib/logger/server-logger.ts
// Level Topologis: L0 (Core Infrastructure — Production-Safe Structured Logger)

import 'server-only';
import { randomUUID } from 'crypto';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
  correlationId?: string;
  actorUserId?: string;
  actorRole?: string;
  module?: string;
  action?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'confirm_password',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cron_secret',
  'service_role_key',
  'supabase_service_role_key',
]);

/**
 * Menyensor field rahasia secara rekursif agar tidak pernah tertulis ke dalam log server.
 */
function redactSensitiveData(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(redactSensitiveData);
  }

  if (typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitized[key] = '[REDACTED_SECRET]';
      } else {
        sanitized[key] = redactSensitiveData(value);
      }
    }
    return sanitized;
  }

  return input;
}

export function generateCorrelationId(): string {
  return `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export const serverLogger = {
  info(message: string, context?: LogContext): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level: 'INFO' as LogLevel,
      correlationId: context?.correlationId ?? generateCorrelationId(),
      message,
      ...context,
      metadata: context?.metadata ? redactSensitiveData(context.metadata) : undefined,
    };
    console.info(JSON.stringify(payload));
  },

  warn(message: string, context?: LogContext): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level: 'WARN' as LogLevel,
      correlationId: context?.correlationId ?? generateCorrelationId(),
      message,
      ...context,
      metadata: context?.metadata ? redactSensitiveData(context.metadata) : undefined,
    };
    console.warn(JSON.stringify(payload));
  },

  error(message: string, error: unknown, context?: LogContext): void {
    const errObj =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            // Stack trace hanya dicatat di log internal server pada mode development
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          }
        : redactSensitiveData(error);

    const payload = {
      timestamp: new Date().toISOString(),
      level: 'ERROR' as LogLevel,
      correlationId: context?.correlationId ?? generateCorrelationId(),
      message,
      error: errObj,
      ...context,
      metadata: context?.metadata ? redactSensitiveData(context.metadata) : undefined,
    };
    console.error(JSON.stringify(payload));
  },
};
