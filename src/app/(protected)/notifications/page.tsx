// Lokasi: src/app/(protected)/notifications/page.tsx
// Server Component Halaman Pusat Notifikasi (/notifications)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  NotificationListClient,
  type NotificationRowItem,
} from '@/components/notifications/NotificationListClient';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from('notifications')
    .select(
      'id, notification_type, title, description, reference_type, reference_id, is_read, read_at, created_at'
    )
    .eq('recipient_user_id', user.userId)
    .order('created_at', { ascending: false })
    .limit(100);

  const notifications: NotificationRowItem[] = (data ?? []).map((n) => ({
    id: n.id,
    notification_type: n.notification_type,
    title: n.title,
    description: n.description,
    reference_type: n.reference_type,
    reference_id: n.reference_id,
    is_read: Boolean(n.is_read),
    read_at: n.read_at,
    created_at: n.created_at,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
          Notifikasi
        </h1>
        <p className="mt-0.5 text-xs text-[#64748B]">
          {user.fullName} ({user.systemRole})
        </p>
      </div>

      <NotificationListClient initialNotifications={notifications} />
    </div>
  );
}
