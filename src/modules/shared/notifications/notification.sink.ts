// Lokasi: src/modules/shared/notifications/notification.sink.ts
// Level Topologis: L0 (Core Infrastructure — Non-Blocking Notification Sink)

import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { serverLogger } from '@/lib/logger/server-logger';
import type { NotificationType } from '@/types/database.types';

export interface DirectNotificationPayload {
  recipientUserId: string;
  notificationType: NotificationType;
  title: string;
  description: string;
  referenceType:
    | 'LEAD'
    | 'UNIT'
    | 'BOOKING'
    | 'PAYMENT'
    | 'KPR'
    | 'PROMO'
    | 'DEAL'
    | 'FOLLOW_UP'
    | 'SITE_VISIT';
  referenceId: string;
  deduplicationKey: string;
}

export const NotificationSink = {
  /**
   * Menerbitkan notifikasi langsung ke tabel notifications secara idempoten (CST-12).
   * Bersifat non-blocking: jika terjadi error, dicatat ke serverLogger tanpa melempar exception.
   */
  async publishDirectSafe(
    items: DirectNotificationPayload | DirectNotificationPayload[]
  ): Promise<void> {
    const list = Array.isArray(items) ? items : [items];
    if (list.length === 0) {
      return;
    }

    try {
      const supabaseAdmin = createSupabaseAdminClient();
      const rows = list.map((item) => ({
        recipient_user_id: item.recipientUserId,
        notification_type: item.notificationType,
        title: item.title,
        description: item.description,
        reference_type: item.referenceType,
        reference_id: item.referenceId,
        deduplication_key: item.deduplicationKey,
      }));

      const { error } = await supabaseAdmin.from('notifications').upsert(rows, {
        onConflict: 'recipient_user_id,deduplication_key',
        ignoreDuplicates: true,
      });

      if (error) {
        serverLogger.warn('Failed to insert direct notifications (non-blocking)', {
          module: 'NotificationSink',
          action: 'publishDirectSafe',
          metadata: { error: error.message, count: rows.length },
        });
      }
    } catch (err) {
      serverLogger.warn('Unexpected error in NotificationSink.publishDirectSafe', {
        module: 'NotificationSink',
        action: 'publishDirectSafe',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  },
};
