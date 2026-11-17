// Lokasi: src/components/notifications/NotificationListClient.tsx
// Komponen Interaktif Pusat Notifikasi (Filter Semua vs Belum Dibaca + Tandai Dibaca)

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Check,
  CheckCheck,
  AlertTriangle,
  Clock,
  FileCheck2,
  Landmark,
  Users,
} from 'lucide-react';
import { formatDateTimeID } from '@/lib/utils/format';
import {
  markNotificationAsReadAction,
  markAllNotificationsAsReadAction,
} from '@/modules/notifications-engine/notifications.actions';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';

export interface NotificationRowItem {
  id: string;
  notification_type: string;
  title: string;
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListClientProps {
  initialNotifications: NotificationRowItem[];
}

export function NotificationListClient({
  initialNotifications,
}: NotificationListClientProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [filterMode, setFilterMode] = useState<'ALL' | 'UNREAD'>('ALL');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const unreadCount = initialNotifications.filter((n) => !n.is_read).length;
  const displayedItems =
    filterMode === 'UNREAD'
      ? initialNotifications.filter((n) => !n.is_read)
      : initialNotifications;

  const handleMarkOneRead = async (id: string) => {
    setLoadingId(id);
    try {
      const result = await markNotificationAsReadAction(id);
      if (result.success) {
        showToast({
          title: 'Notifikasi Dibaca',
          description: result.message,
          tone: 'success',
        });
        router.refresh();
      } else {
        showToast({
          title: 'Gagal Memperbarui Notifikasi',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } finally {
      setLoadingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || isMarkingAll) return;
    setIsMarkingAll(true);
    try {
      const result = await markAllNotificationsAsReadAction();
      if (result.success) {
        showToast({
          title: 'Seluruh Notifikasi Dibaca',
          description: result.message,
          tone: 'success',
        });
        router.refresh();
      } else {
        showToast({
          title: 'Gagal Memperbarui Notifikasi',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } finally {
      setIsMarkingAll(false);
    }
  };

  const renderTypeIcon = (type: string) => {
    if (
      type === 'PAYMENT_VERIFICATION_ESCALATION' ||
      type === 'PAYMENT_OVERDUE' ||
      type === 'BOOKING_EXPIRY_ALERT'
    ) {
      return <AlertTriangle className="h-4 w-4 text-[#DC2626]" strokeWidth={1.75} />;
    }
    if (type.includes('KPR')) {
      return <Landmark className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />;
    }
    if (type.includes('LEAD') || type.includes('FOLLOW_UP')) {
      return <Users className="h-4 w-4 text-[#2563EB]" strokeWidth={1.75} />;
    }
    if (type.includes('DUE')) {
      return <Clock className="h-4 w-4 text-[#D97706]" strokeWidth={1.75} />;
    }
    return <FileCheck2 className="h-4 w-4 text-[#059669]" strokeWidth={1.75} />;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftar Notifikasi</CardTitle>

        <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-0">
          <div className="inline-flex rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-0.5">
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                filterMode === 'ALL'
                  ? 'bg-[#14532D] text-white'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              Semua ({initialNotifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('UNREAD')}
              className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                filterMode === 'UNREAD'
                  ? 'bg-[#14532D] text-white'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              Belum Dibaca ({unreadCount})
            </button>
          </div>

          <Button
            variant="secondary"
            size="sm"
            disabled={unreadCount === 0}
            isLoading={isMarkingAll}
            leftIcon={<CheckCheck className="h-3.5 w-3.5" strokeWidth={1.75} />}
            onClick={handleMarkAllRead}
          >
            Tandai Semua Dibaca
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {displayedItems.length === 0 ? (
          <EmptyState
            icon={<Bell className="h-5 w-5" strokeWidth={1.75} />}
            title={
              filterMode === 'UNREAD'
                ? 'Tidak Ada Notifikasi Belum Dibaca'
                : 'Belum Ada Notifikasi Masuk'
            }
            description={
              filterMode === 'UNREAD'
                ? 'Seluruh pemberitahuan pada akun Anda telah dibaca.'
                : 'Pemberitahuan operasional sistem akan muncul secara otomatis di halaman ini.'
            }
          />
        ) : (
          displayedItems.map((item) => (
            <div
              key={item.id}
              className={`flex flex-col justify-between gap-3 rounded-lg border p-4 transition-colors sm:flex-row sm:items-start ${
                item.is_read
                  ? 'border-[#E2E8F0] bg-white'
                  : 'border-[#BBF7D0] bg-[#F0FDF4]/60'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white shadow-2xs">
                  {renderTypeIcon(item.notification_type)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[#0F172A]">
                      {item.title}
                    </span>
                    {!item.is_read && <Badge tone="forest">BARU</Badge>}
                    <Badge tone="slate">
                      {item.notification_type.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#475569]">
                    {item.description}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[#64748B] tabular-nums">
                    <span>Diterima: {formatDateTimeID(item.created_at)}</span>
                    {item.reference_type && (
                      <span className="font-mono">
                        Ref: {item.reference_type}
                      </span>
                    )}
                    {item.is_read && item.read_at && (
                      <span>Dibaca: {formatDateTimeID(item.read_at)}</span>
                    )}
                  </div>
                </div>
              </div>

              {!item.is_read && (
                <div className="shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    isLoading={loadingId === item.id}
                    leftIcon={<Check className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    onClick={() => handleMarkOneRead(item.id)}
                  >
                    Tandai Dibaca
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
