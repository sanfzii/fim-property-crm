// Lokasi: src/modules/notifications-engine/reminder-sweep.orchestrator.ts
// Level Topologis: L10 (Use-Case Orchestrator untuk Modul Q — Hybrid Reminder & Outbox Engine)

import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { serverLogger } from '@/lib/logger/server-logger';
import {
  NotificationSink,
  type DirectNotificationPayload,
} from '@/modules/shared/notifications/notification.sink';

// Pembatas frekuensi (Throttle) & in-flight guard di memori proses untuk On-Access Evaluation (Minimal jeda 5 menit)
let lastOnAccessSweepTimestamp = 0;
let isOnAccessSweepRunning = false;
const ON_ACCESS_THROTTLE_MS = 5 * 60 * 1000;

export interface SystemSweepSummary {
  expiredBookingsCount: number;
  overdueSchedulesMarked: number;
  paymentTasksGenerated: number;
  slaEscalationsSent: number;
  outboxProcessedCount: number;
  executedAt: string;
}

export const ReminderSweepOrchestrator = {
  /**
   * Dipanggil secara ringan saat Dashboard dimuat (On-Access Evaluation).
   * Dibatasi (throttled) maksimal 1 kali setiap 5 menit per instance server dan dilindungi in-flight guard.
   */
  async triggerThrottledOnAccessSweepSafe(): Promise<void> {
    const now = Date.now();
    if (isOnAccessSweepRunning || now - lastOnAccessSweepTimestamp < ON_ACCESS_THROTTLE_MS) {
      return;
    }

    isOnAccessSweepRunning = true;
    lastOnAccessSweepTimestamp = now;

    try {
      await this.runFullSystemSweep();
    } catch (err) {
      serverLogger.warn('Throttled on-access sweep encountered non-fatal error', {
        module: 'ReminderSweepOrchestrator',
        action: 'triggerThrottledOnAccessSweepSafe',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      isOnAccessSweepRunning = false;
    }
  },

  /**
   * Menjalankan penyapuan penuh secara idempoten (Digunakan oleh Cron Harian, Manual Sync Admin, & On-Access).
   */
  async runFullSystemSweep(): Promise<SystemSweepSummary> {
    const supabaseAdmin = createSupabaseAdminClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const todayStr = nowIso.slice(0, 10);

    // 1. Jalankan RPC TX-03 (via service_role) untuk melepaskan Booking kedaluwarsa yang memenuhi syarat
    const { data: expiryResult, error: expiryErr } = await supabaseAdmin.rpc(
      'rpc_expire_overdue_bookings',
      { p_batch_limit: 50 }
    );
    if (expiryErr) {
      throw translateDatabaseOrRpcError(expiryErr);
    }
    const expiredBookingsCount = Number(
      (expiryResult as { expired_count?: number } | null)?.expired_count ?? 0
    );

    // 2. Ambil daftar Admin aktif untuk pengiriman eskalasi & pemberitahuan pembatalan/kedaluwarsa
    const { data: activeAdmins, error: adminErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('system_role', 'ADMIN')
      .eq('is_active', true);

    if (adminErr) {
      throw translateDatabaseOrRpcError(adminErr);
    }
    const adminIds = (activeAdmins ?? []).map((a) => a.id);

    // 3. Evaluasi Eskalasi SLA Verifikasi Pembayaran 24 Jam & 48 Jam / Lewat Expiry (PD-01)
    let slaEscalationsSent = 0;
    const { data: pendingPayments, error: pendingErr } = await supabaseAdmin
      .from('payment_records')
      .select(
        'id, reference_number, booking_id, paid_amount, submitted_at, verification_sla_due_at, bookings(reference_number, expires_at, team_id, current_sales_id)'
      )
      .eq('verification_status', 'PENDING_VERIFICATION')
      .lte('verification_sla_due_at', nowIso)
      .limit(100);

    if (pendingErr) {
      throw translateDatabaseOrRpcError(pendingErr);
    }

    if (pendingPayments && pendingPayments.length > 0) {
      const escalationNotifications: DirectNotificationPayload[] = [];

      for (const rec of pendingPayments) {
        const bookingInfo = Array.isArray(rec.bookings)
          ? rec.bookings[0]
          : rec.bookings;
        if (!bookingInfo) continue;

        const submittedMs = new Date(rec.submitted_at).getTime();
        const ageHours = (now.getTime() - submittedMs) / (1000 * 3600);
        const isPastBookingExpiry =
          now.getTime() > new Date(bookingInfo.expires_at).getTime();

        // Level 1: Lewat SLA 24 Jam -> Peringatan ke seluruh Admin
        for (const adminId of adminIds) {
          escalationNotifications.push({
            recipientUserId: adminId,
            notificationType: 'PAYMENT_VERIFICATION_ESCALATION',
            title: `SLA Verifikasi 24 Jam Terlewati (${rec.reference_number})`,
            description: `Bukti bayar ${rec.reference_number} pada Booking ${bookingInfo.reference_number} menunggu verifikasi lebih dari 24 jam.`,
            referenceType: 'PAYMENT',
            referenceId: rec.id,
            deduplicationKey: `SLA_VERIFY_24H:${rec.id}`,
          });
        }

        // Level 2: Lewat 48 Jam ATAU menahan Unit melewati Booking Expiry -> Eskalasi ke Admin & Supervisor Tim
        if (ageHours >= 48 || isPastBookingExpiry) {
          const { data: teamSupervisor, error: supErr } = await supabaseAdmin
            .from('team_memberships')
            .select('profile_id')
            .eq('team_id', bookingInfo.team_id)
            .eq('membership_role', 'TEAM_SUPERVISOR')
            .eq('is_active', true)
            .maybeSingle();

          if (supErr) {
            serverLogger.warn('Failed to lookup active team supervisor for SLA escalation', {
              module: 'ReminderSweepOrchestrator',
              action: 'runFullSystemSweep',
              metadata: { teamId: bookingInfo.team_id, error: supErr.message },
            });
          }

          const level2Recipients = new Set<string>(adminIds);
          if (teamSupervisor?.profile_id) {
            level2Recipients.add(teamSupervisor.profile_id);
          }

          for (const recipientId of level2Recipients) {
            escalationNotifications.push({
              recipientUserId: recipientId,
              notificationType: 'PAYMENT_VERIFICATION_ESCALATION',
              title: `ESKALASI KRITIS: Unit Tertahan Verifikasi (${bookingInfo.reference_number})`,
              description: `Bukti bayar ${rec.reference_number} telah menggantung >48 jam atau melewati batas waktu Booking sehingga menahan status Unit tetap HELD. Segera verifikasi atau tolak.`,
              referenceType: 'PAYMENT',
              referenceId: rec.id,
              deduplicationKey: `SLA_VERIFY_48H_ESC:${rec.id}`,
            });
          }
        }
      }

      if (escalationNotifications.length > 0) {
        await NotificationSink.publishDirectSafe(escalationNotifications);
        slaEscalationsSent = escalationNotifications.length;
      }
    }

    // 4. Tandai Jadwal Pembayaran pada Booking aktif/pending yang melewati due_date menjadi OVERDUE (BR-07 & BR-11)
    const { data: overdueCandidates, error: candErr } = await supabaseAdmin
      .from('payment_schedules')
      .select('id, bookings!inner(status)')
      .in('status', ['UNPAID', 'PARTIALLY_PAID'])
      .in('bookings.status', ['PENDING_FEE', 'ACTIVE'])
      .lt('due_date', todayStr)
      .limit(200);

    if (candErr) {
      throw translateDatabaseOrRpcError(candErr);
    }

    let overdueSchedulesMarked = 0;
    const candidateIds = (overdueCandidates ?? []).map((c) => c.id);
    if (candidateIds.length > 0) {
      const { data: newlyOverdue, error: markOverdueErr } = await supabaseAdmin
        .from('payment_schedules')
        .update({ status: 'OVERDUE' })
        .in('id', candidateIds)
        .in('status', ['UNPAID', 'PARTIALLY_PAID'])
        .select('id');

      if (markOverdueErr) {
        throw translateDatabaseOrRpcError(markOverdueErr);
      }
      overdueSchedulesMarked = newlyOverdue?.length ?? 0;
    }

    let paymentTasksGenerated = 0;

    // Ambil jadwal OVERDUE / jatuh tempo hari ini pada Booking aktif untuk tugas & notifikasi idempoten
    const { data: dueOrOverdueSchedules, error: dueErr } = await supabaseAdmin
      .from('payment_schedules')
      .select(
        'id, booking_id, schedule_type, title, remaining_amount, due_date, status, bookings!inner(id, reference_number, lead_id, current_sales_id, team_id, status)'
      )
      .in('status', ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'])
      .in('bookings.status', ['PENDING_FEE', 'ACTIVE'])
      .lte('due_date', todayStr)
      .limit(100);

    if (dueErr) {
      throw translateDatabaseOrRpcError(dueErr);
    }

    if (dueOrOverdueSchedules && dueOrOverdueSchedules.length > 0) {
      const reminderNotifications: DirectNotificationPayload[] = [];

      for (const sched of dueOrOverdueSchedules) {
        const bInfo = Array.isArray(sched.bookings)
          ? sched.bookings[0]
          : sched.bookings;
        if (!bInfo) continue;

        const isOverdue = sched.due_date < todayStr || sched.status === 'OVERDUE';
        const milestoneTag = isOverdue ? 'OVERDUE_DAY_1' : 'DUE_DAY_OF';
        const taskDedupKey = `SCHED_TASK:${sched.id}:${milestoneTag}`;

        // Buat Follow-up Task penagihan otomatis untuk Sales secara idempoten (ON CONFLICT DO NOTHING)
        const { data: insertedTasks, error: taskErr } = await supabaseAdmin
          .from('follow_up_tasks')
          .upsert(
            {
              lead_id: bInfo.lead_id,
              assigned_sales_id: bInfo.current_sales_id,
              related_schedule_id: sched.id,
              title: isOverdue
                ? `[OVERDUE] Tagih Tunggakan: ${sched.title}`
                : `[JATUH TEMPO] Hubungi Klien: ${sched.title}`,
              description: `Tagihan ${sched.title} pada Booking ${bInfo.reference_number} sebesar Rp ${Number(sched.remaining_amount).toLocaleString('id-ID')} jatuh tempo pada ${sched.due_date}.`,
              due_at: nowIso,
              priority: 'HIGH',
              source_type: 'PAYMENT_REMINDER_SYSTEM',
              status: 'PENDING',
              deduplication_key: taskDedupKey,
            },
            { onConflict: 'deduplication_key', ignoreDuplicates: true }
          )
          .select('id');

        if (taskErr) {
          serverLogger.warn('Failed to upsert payment reminder task', {
            module: 'ReminderSweepOrchestrator',
            action: 'runFullSystemSweep',
            metadata: { scheduleId: sched.id, error: taskErr.message },
          });
        } else {
          paymentTasksGenerated += insertedTasks?.length ?? 0;
        }

        reminderNotifications.push({
          recipientUserId: bInfo.current_sales_id,
          notificationType: isOverdue ? 'PAYMENT_OVERDUE' : 'INSTALLMENT_DUE',
          title: isOverdue
            ? `Tagihan Terlambat (Overdue): ${bInfo.reference_number}`
            : `Tagihan Jatuh Tempo Hari Ini: ${bInfo.reference_number}`,
          description: `${sched.title} memiliki sisa tagihan Rp ${Number(sched.remaining_amount).toLocaleString('id-ID')} (Jatuh tempo: ${sched.due_date}). Tugas follow-up telah ditambahkan.`,
          referenceType: 'BOOKING',
          referenceId: bInfo.id,
          deduplicationKey: `SCHED_NOTIF:${sched.id}:${milestoneTag}`,
        });
      }

      if (reminderNotifications.length > 0) {
        await NotificationSink.publishDirectSafe(reminderNotifications);
      }
    }

    // 5. Tandai Follow-up Tasks yang lewat due_at menjadi OVERDUE
    const { error: taskOverdueErr } = await supabaseAdmin
      .from('follow_up_tasks')
      .update({ status: 'OVERDUE' })
      .eq('status', 'PENDING')
      .lt('due_at', nowIso);

    if (taskOverdueErr) {
      throw translateDatabaseOrRpcError(taskOverdueErr);
    }

    // 6. Proses Antrean Transactional Outbox (notification_outbox -> notifications)
    const outboxProcessedCount = await this.processPendingOutboxBatch(adminIds);

    return {
      expiredBookingsCount,
      overdueSchedulesMarked,
      paymentTasksGenerated,
      slaEscalationsSent,
      outboxProcessedCount,
      executedAt: nowIso,
    };
  },

  /**
   * Memproses antrean notification_outbox yang dibuat oleh RPC TX-01 s/d TX-10
   * menjadi notifikasi in-app individual di tabel notifications.
   */
  async processPendingOutboxBatch(adminIds: string[]): Promise<number> {
    const supabaseAdmin = createSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    const { data: outboxRows, error: outboxErr } = await supabaseAdmin
      .from('notification_outbox')
      .select('*')
      .in('status', ['PENDING', 'FAILED_RETRYABLE'])
      .lte('next_retry_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(50);

    if (outboxErr) {
      throw translateDatabaseOrRpcError(outboxErr);
    }

    if (!outboxRows || outboxRows.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const item of outboxRows) {
      try {
        const payload = (item.payload ?? {}) as Record<string, unknown>;
        const targetSalesId = payload.sales_id as string | undefined;
        const targetToSalesId = payload.to_sales_id as string | undefined;
        const recipients = new Set<string>();

        if (targetSalesId) recipients.add(targetSalesId);
        if (targetToSalesId) recipients.add(targetToSalesId);
        if (
          item.event_type === 'BOOKING_EXPIRY_ALERT' ||
          item.event_type === 'BOOKING_CANCELLED'
        ) {
          adminIds.forEach((id) => recipients.add(id));
        }

        const notifList: DirectNotificationPayload[] = [];

        for (const recipientId of recipients) {
          if (item.event_type === 'BOOKING_FEE_DUE') {
            notifList.push({
              recipientUserId: recipientId,
              notificationType: 'BOOKING_FEE_DUE',
              title: `Booking Baru Dibuat (${String(payload.booking_reference ?? '')})`,
              description: `Unit ${String(payload.unit_code ?? '')} ditahan (HELD). Pastikan Booking Fee dilunasi sebelum batas waktu 72 jam.`,
              referenceType: 'BOOKING',
              referenceId: String(payload.booking_id),
              deduplicationKey: item.deduplication_key,
            });
          } else if (item.event_type === 'BOOKING_EXPIRY_ALERT') {
            notifList.push({
              recipientUserId: recipientId,
              notificationType: 'BOOKING_EXPIRY_ALERT',
              title: `Booking Kedaluwarsa (${String(payload.booking_reference ?? '')})`,
              description:
                'Masa berlaku 72 jam telah habis tanpa pembayaran Booking Fee. Unit telah dilepaskan kembali menjadi AVAILABLE.',
              referenceType: 'BOOKING',
              referenceId: String(payload.booking_id),
              deduplicationKey: item.deduplication_key,
            });
          } else if (item.event_type === 'BOOKING_CANCELLED') {
            notifList.push({
              recipientUserId: recipientId,
              notificationType: 'BOOKING_EXPIRY_ALERT',
              title: `Booking Dibatalkan (${String(payload.booking_reference ?? '')})`,
              description: `Booking dibatalkan dengan kebijakan refund [${String(payload.refund_policy_type ?? 'NONE')}]. Nominal refund disepakati: Rp ${Number(payload.agreed_refund_amount ?? 0).toLocaleString('id-ID')}.`,
              referenceType: 'BOOKING',
              referenceId: String(payload.booking_id),
              deduplicationKey: item.deduplication_key,
            });
          } else if (item.event_type === 'PAYMENT_VERIFICATION_RESULT') {
            notifList.push({
              recipientUserId: recipientId,
              notificationType: 'PAYMENT_VERIFICATION_RESULT',
              title: `Hasil Verifikasi Pembayaran ${String(payload.payment_reference ?? '')}: ${String(payload.decision ?? '')}`,
              description: `Pembayaran telah diproses Admin dengan status ${String(payload.decision ?? '')}. Catatan: ${String(payload.verification_notes ?? '-')}`,
              referenceType: 'BOOKING',
              referenceId: String(payload.booking_id),
              deduplicationKey: item.deduplication_key,
            });
          } else if (item.event_type === 'LEAD_ASSIGNED') {
            notifList.push({
              recipientUserId: recipientId,
              notificationType: 'LEAD_ASSIGNED',
              title: `Penugasan Lead Baru: ${String(payload.lead_name ?? '')}`,
              description: `Lead telah dialihkan kepada Anda. Alasan: ${String(payload.reason ?? '-')}`,
              referenceType: 'LEAD',
              referenceId: String(payload.lead_id),
              deduplicationKey: item.deduplication_key,
            });
          } else if (item.event_type === 'KPR_AKAD_SCHEDULED') {
            notifList.push({
              recipientUserId: recipientId,
              notificationType: 'KPR_AKAD_SCHEDULED',
              title: `Jadwal Akad KPR Ditetapkan (${String(payload.kpr_reference ?? '')})`,
              description: `Akad kredit dijadwalkan pada ${String(payload.akad_scheduled_at ?? '-')} di ${String(payload.akad_location ?? '-')}.`,
              referenceType: 'KPR',
              referenceId: String(payload.kpr_application_id),
              deduplicationKey: item.deduplication_key,
            });
          } else if (item.event_type === 'KPR_DOCUMENT_UPDATE') {
            const kprRef = String(payload.kpr_reference ?? '');
            let title = `Pembaruan KPR (${kprRef})`;
            let description = 'Status proses pengajuan KPR telah diperbarui.';

            if (payload.decision) {
              // Emisi dari TX-04 (rpc_record_kpr_approval)
              title = `Keputusan KPR Bank (${kprRef}): ${String(payload.decision)}`;
              description = `Keputusan bank untuk pengajuan KPR ${kprRef} adalah ${String(payload.decision)}.`;
            } else if (payload.disbursement_id) {
              // Emisi dari TX-08 (rpc_record_kpr_disbursement)
              title = `Pencairan KPR ${String(payload.tranche_type ?? '')} (${kprRef})`;
              description = `Dana pencairan KPR sebesar Rp ${Number(payload.disbursed_amount ?? 0).toLocaleString('id-ID')} dicatat. Status pencairan: ${String(payload.disbursement_status ?? '')}.`;
            } else if (payload.application_status === 'CANCELLED_BY_CUSTOMER') {
              // Emisi dari TX-10 (rpc_cancel_kpr_by_customer)
              title = `KPR Dibatalkan Konsumen (${kprRef})`;
              description = `Pengajuan KPR dibatalkan atas inisiatif konsumen. Alasan: ${String(payload.cancellation_reason ?? '-')}`;
            } else if (payload.to_stage) {
              // Emisi dari TX-09 (rpc_advance_kpr_stage non-Akad)
              title = `Tahap KPR Berpindah (${kprRef}): ${String(payload.to_stage)}`;
              description = `Pengajuan KPR berpindah dari tahap ${String(payload.from_stage ?? '-')} ke ${String(payload.to_stage)}.`;
            }

            notifList.push({
              recipientUserId: recipientId,
              notificationType: 'KPR_DOCUMENT_UPDATE',
              title,
              description,
              referenceType: 'KPR',
              referenceId: String(payload.kpr_application_id),
              deduplicationKey: item.deduplication_key,
            });
          } else if (item.event_type === 'DEAL_STATUS_UPDATED') {
            // Emisi dari TX-05 (rpc_transition_deal_status); dipetakan ke notification_type_enum yang valid
            notifList.push({
              recipientUserId: recipientId,
              notificationType: 'PAYMENT_VERIFICATION_RESULT',
              title: `Pembaruan Status Deal (${String(payload.transition_action ?? '')})`,
              description: `Status kontrak Deal kini [${String(payload.contract_status ?? '-')}], penyelesaian bayar [${String(payload.payment_settlement_status ?? '-')}], dan status Unit [${String(payload.unit_status ?? '-')}].`,
              referenceType: 'DEAL',
              referenceId: String(payload.deal_id),
              deduplicationKey: item.deduplication_key,
            });
          } else {
            serverLogger.warn('Unhandled outbox event_type encountered', {
              module: 'ReminderSweepOrchestrator',
              action: 'processPendingOutboxBatch',
              metadata: { outboxId: item.id, eventType: item.event_type },
            });
          }
        }

        if (notifList.length > 0) {
          await NotificationSink.publishDirectSafe(notifList);
        }

        const { error: procErr } = await supabaseAdmin
          .from('notification_outbox')
          .update({
            status: 'PROCESSED',
            processed_at: new Date().toISOString(),
          })
          .eq('id', item.id)
          .in('status', ['PENDING', 'FAILED_RETRYABLE']);

        if (procErr) {
          throw procErr;
        }

        processedCount += 1;
      } catch (err) {
        const nextRetryCount = (item.retry_count ?? 0) + 1;
        const nextStatus = nextRetryCount >= 5 ? 'DEAD_LETTER' : 'FAILED_RETRYABLE';
        const nextRetryAt = new Date(
          Date.now() + nextRetryCount * 5 * 60 * 1000
        ).toISOString();

        const { error: retryErr } = await supabaseAdmin
          .from('notification_outbox')
          .update({
            status: nextStatus,
            retry_count: nextRetryCount,
            last_error: err instanceof Error ? err.message : String(err),
            next_retry_at: nextRetryAt,
          })
          .eq('id', item.id);

        if (retryErr) {
          serverLogger.error('Failed to update notification_outbox retry state', retryErr, {
            module: 'ReminderSweepOrchestrator',
            action: 'processPendingOutboxBatch',
            entityId: item.id,
          });
        }
      }
    }

    return processedCount;
  },
};
