// Lokasi: src/components/layout/AppTopbar.tsx
// Komponen Topbar Kontekstual sesuai DESIGN.md v2.1 Bagian 5.2

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Menu,
  Bell,
  LogOut,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';
import type { AuthenticatedUserContext } from '@/types/database.types';
import { getInitials } from '@/lib/utils/format';
import { logoutAction } from '@/modules/identity/auth/auth.actions';
import { Button } from '@/components/ui/Button';

export interface AppTopbarProps {
  user: AuthenticatedUserContext;
  unreadNotificationsCount: number;
  onOpenMobileSidebar: () => void;
}

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/catalog': 'Katalog & Unit',
  '/leads': 'Leads & Pipeline',
  '/site-visits': 'Survei Lokasi',
  '/bookings': 'Booking & Reservasi',
  '/payments': 'Pembayaran & Refund',
  '/kpr': 'Pengajuan KPR',
  '/deals': 'Deals & Kontrak',
  '/reports': 'Laporan Eksekutif',
  '/admin/users': 'Manajemen Pengguna',
  '/admin/teams': 'Manajemen Tim',
  '/notifications': 'Notifikasi',
  '/profile': 'Profil Saya',
};

export function AppTopbar({
  user,
  unreadNotificationsCount,
  onOpenMobileSidebar,
}: AppTopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const prefetchedHrefs = React.useRef(new Set<string>());

  const prefetchOnIntent = (href: string) => {
    if (prefetchedHrefs.current.has(href)) return;
    prefetchedHrefs.current.add(href);
    void router.prefetch(href);
  };

  const resolvePageLabel = () => {
    if (pathname === '/reports' && user.systemRole === 'SUPERVISOR') {
      return 'Laporan Tim';
    }
    if (ROUTE_TITLES[pathname]) {
      return ROUTE_TITLES[pathname];
    }
    const matchedPrefix = Object.keys(ROUTE_TITLES).find(
      (key) => key !== '/dashboard' && pathname.startsWith(`${key}/`)
    );
    return matchedPrefix ? ROUTE_TITLES[matchedPrefix] : 'Ringkasan Sistem';
  };

  const handleBackNavigation = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/dashboard');
    }
  };

  const roleBadgeClasses =
    user.systemRole === 'ADMIN'
      ? 'bg-[#F0FDF4] text-[#14532D] border-[#BBF7D0]'
      : user.systemRole === 'SUPERVISOR'
        ? 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]'
        : 'bg-[#F1F5F9] text-[#334155] border-[#CBD5E1]';

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-[#E2E8F0] bg-white px-4 md:px-6">
      {/* Left: Mobile Hamburger + Back Button (non-dashboard) + Contextual Breadcrumb */}
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          className="rounded-md p-2 text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] md:hidden"
          aria-label="Buka menu navigasi"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>

        {pathname !== '/dashboard' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleBackNavigation}
            aria-label="Kembali"
            leftIcon={<ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />}
            className="shrink-0"
          >
            <span className="hidden sm:inline">Kembali</span>
          </Button>
        )}

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          <span className="hidden text-xs font-medium text-[#64748B] sm:inline">
            FIM-Property
          </span>
          <ChevronRight
            className="hidden h-3.5 w-3.5 shrink-0 text-[#94A3B8] sm:inline"
            strokeWidth={1.75}
          />
          <span className="truncate text-sm font-semibold text-[#0F172A]">
            {resolvePageLabel()}
          </span>
        </nav>
      </div>

      {/* Right: Actions & Account Controls */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        {/* Notification Bell */}
        <Link
          href="/notifications"
          prefetch={false}
          onMouseEnter={() => prefetchOnIntent('/notifications')}
          onFocus={() => prefetchOnIntent('/notifications')}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#E2E8F0] bg-white text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A]"
          aria-label="Pusat Notifikasi"
          title="Pusat Notifikasi"
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
          {unreadNotificationsCount > 0 && (
            <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#DC2626] px-1 text-[10px] font-bold text-white tabular-nums">
              {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
            </span>
          )}
        </Link>

        {/* User Profile Pill + Logout */}
        <div className="flex items-center gap-1.5 border-l border-[#E2E8F0] pl-1.5 sm:gap-2 sm:pl-3">
          <Link
            href="/profile"
            prefetch={false}
            onMouseEnter={() => prefetchOnIntent('/profile')}
            onFocus={() => prefetchOnIntent('/profile')}
            className="flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors hover:bg-[#F8FAFC]"
            title="Lihat & Ubah Profil Saya"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#BBF7D0] bg-[#F0FDF4] text-xs font-bold text-[#14532D]">
              {getInitials(user.fullName)}
            </div>
            <div className="hidden text-left lg:block">
              <div className="flex items-center gap-1.5">
                <p className="max-w-[160px] truncate text-xs font-semibold text-[#0F172A]">
                  {user.fullName}
                </p>
                <span
                  className={`rounded border px-1.5 py-0.2 text-[10px] font-semibold ${roleBadgeClasses}`}
                >
                  {user.systemRole}
                </span>
              </div>
              <p className="max-w-[200px] truncate text-[11px] text-[#64748B]">
                {user.activeTeamName ?? user.email}
              </p>
            </div>
          </Link>

          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-white px-2.5 text-xs font-medium text-[#475569] transition-colors hover:border-[#FECACA] hover:bg-[#FEF2F2] hover:text-[#B91C1C]"
              title="Keluar dari Sistem CRM"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden md:inline">Keluar</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
