// Lokasi: src/app/(protected)/layout.tsx
// Server Component Layout untuk seluruh rute terlindungi FIM-Property CRM

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { AppShell } from '@/components/layout/AppShell';

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const supabase = await createSupabaseServerClient();

  const [unreadRes, pendingPaymentRes] = await Promise.all([
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', user.userId)
      .eq('is_read', false),
    user.systemRole === 'ADMIN'
      ? supabase
          .from('payment_records')
          .select('id', { count: 'exact', head: true })
          .eq('verification_status', 'PENDING_VERIFICATION')
      : Promise.resolve({ count: 0 }),
  ]);

  const unreadNotificationsCount = unreadRes.count ?? 0;
  const pendingVerificationCount = pendingPaymentRes.count ?? 0;

  return (
    <ToastProvider>
      <AppShell
        user={user}
        unreadNotificationsCount={unreadNotificationsCount}
        pendingVerificationCount={pendingVerificationCount}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
