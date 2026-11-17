// Lokasi: src/modules/shared/audit/audit.sink.ts
// Level Topologis: L0 (Core Infrastructure — Application Audit Sink)

import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';
import type { SystemRole } from '@/types/database.types';

export interface AuditRecordPayload {
  actorUserId: string | null;
  actorRole: SystemRole | 'SYSTEM_AUTOMATION';
  actionType: string;
  entityTable: string;
  entityId: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
}

export const AuditSink = {
  /**
   * Menyisipkan baris audit_logs. Sesuai arsitektur Phase 1A Bagian 10,
   * kegagalan menulis Audit Log akan melempar AppError agar operasi dinilai gagal.
   */
  async record(payload: AuditRecordPayload): Promise<void> {
    const supabaseAdmin = createSupabaseAdminClient();

    const { error } = await supabaseAdmin.from('audit_logs').insert({
      actor_user_id: payload.actorUserId,
      actor_role: payload.actorRole,
      action_type: payload.actionType,
      entity_table: payload.entityTable,
      entity_id: payload.entityId,
      old_values: payload.oldValues ?? null,
      new_values: payload.newValues ?? null,
      reason: payload.reason ?? null,
    });

    if (error) {
      throw new AppError({
        message: 'Gagal mencatat rekam jejak audit keamanan transaksi.',
        category: 'DATABASE_ERROR',
        code: 'AUDIT_LOG_WRITE_FAILED',
        statusCode: 500,
      });
    }
  },
};
