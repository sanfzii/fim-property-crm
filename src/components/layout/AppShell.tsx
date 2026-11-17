// Lokasi: src/components/layout/AppShell.tsx
// Pembungkus App Shell Interaktif (Sidebar + Topbar + Main Content Container)

'use client';

import React, { useState } from 'react';
import type { AuthenticatedUserContext } from '@/types/database.types';
import { AppSidebar } from './AppSidebar';
import { AppTopbar } from './AppTopbar';

export interface AppShellProps {
  user: AuthenticatedUserContext;
  unreadNotificationsCount: number;
  pendingVerificationCount: number;
  children: React.ReactNode;
}

export function AppShell({
  user,
  unreadNotificationsCount,
  pendingVerificationCount,
  children,
}: AppShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-[#F8FAFC] text-[#0F172A]">
      <AppSidebar
        user={user}
        unreadNotificationsCount={unreadNotificationsCount}
        pendingVerificationCount={pendingVerificationCount}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar
          user={user}
          unreadNotificationsCount={unreadNotificationsCount}
          onOpenMobileSidebar={() => setIsMobileOpen(true)}
        />

        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 md:p-6">
          {children}
        </main>

        <footer className="border-t border-[#E2E8F0] bg-white/60 px-6 py-3 text-center text-xs text-[#64748B] sm:text-left">
          © 2026 FIM-Property CRM • Muhammad Ichsan Fachrulrozi, Muzayin Arifin &amp; Fariz Aditya Ardhana
        </footer>
      </div>
    </div>
  );
}
