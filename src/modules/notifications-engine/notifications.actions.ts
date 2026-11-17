// Lokasi: src/modules/notifications-engine/notifications.actions.ts
// Layer 3: Server Actions untuk Pusat Notifikasi & Tombol Manual Sync (PD-05)

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  executeSafeServerAction,
  translateDatabaseOrRpcError,
} from '@/lib/errors/app-error';
import { requireActionAuth } from '@/modules/identity/auth/auth.guards';
import { ReminderSweepOrchestrator } from './reminder-sweep.orchestrator';

const notificationIdSchema = z.string().uuid('ID Notifikasi tidak valid.');

export async function markNotificationAsReadAction(notificationId: string) {
  return executeSafeServerAction(
    { module: 'notifications', action: 'markNotificationAsReadAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const validId = notificationIdSchema.parse(notificationId);
      const supabase = await createSupabaseServerClient();

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', validId)
        .eq('recipient_user_id', actor.userId);

      if (error) {
        throw translateDatabaseOrRpcError(error);
      }

      revalidatePath('/notifications');
      return { message: 'Notifikasi ditandai sudah dibaca.' };
    }
  );
}

export async function markAllNotificationsAsReadAction() {
  return executeSafeServerAction(
    { module: 'notifications', action: 'markAllNotificationsAsReadAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
      const supabase = await createSupabaseServerClient();

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('recipient_user_id', actor.userId)
        .eq('is_read', false);

      if (error) {
        throw translateDatabaseOrRpcError(error);
      }

      revalidatePath('/notifications');
      return { message: 'Seluruh notifikasi ditandai sudah dibaca.' };
    }
  );
}

/**
 * Tombol Manual Sync (PD-05 — Selaras PRD.md v1.1 & AGENTS.md Bag. 2.3):
 * Khusus ADMIN (['ADMIN']) untuk memicu evaluasi waktu global lintas perusahaan
 * (Booking Expiry TX-03, Overdue, SLA Escalation, & Outbox) secara instan.
 */
export async function runManualSystemSweepAction() {
  return executeSafeServerAction(
    { module: 'notifications', action: 'runManualSystemSweepAction' },
    async () => {
      await requireActionAuth(['ADMIN']);
      const summary = await ReminderSweepOrchestrator.runFullSystemSweep();
      revalidatePath('/dashboard');
      revalidatePath('/bookings');
      revalidatePath('/payments');
      revalidatePath('/notifications');
      return {
        message: `Sinkronisasi sistem selesai: ${summary.expiredBookingsCount} Booking kedaluwarsa dilepas, ${summary.overdueSchedulesMarked} tagihan ditandai Overdue.`,
        data: summary,
      };
    }
  );
}
