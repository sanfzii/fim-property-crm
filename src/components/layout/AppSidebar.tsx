// Lokasi: src/components/layout/AppSidebar.tsx
// Komponen Sidebar Navigasi Role-Based sesuai DESIGN.md v2.1 Bagian 5.1

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BrandLogo } from './BrandLogo';
import {
  Building2,
  LayoutDashboard,
  Users,
  MapPin,
  FileCheck2,
  CreditCard,
  Landmark,
  Briefcase,
  BarChart3,
  Wallet,
  UserCog,
  Network,
  Bell,
  UserCircle,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import type { AuthenticatedUserContext, SystemRole } from '@/types/database.types';

interface NavItemConfig {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  allowedRoles: SystemRole[];
  badgeCount?: number;
  badgeTone?: 'amber' | 'red';
}

interface NavGroupConfig {
  title: string;
  items: NavItemConfig[];
}

export interface AppSidebarProps {
  user: AuthenticatedUserContext;
  unreadNotificationsCount: number;
  pendingVerificationCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export function AppSidebar({
  user,
  unreadNotificationsCount,
  pendingVerificationCount,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const prefetchedHrefs = React.useRef(new Set<string>());

  const prefetchOnIntent = (href: string) => {
    if (prefetchedHrefs.current.has(href)) return;
    prefetchedHrefs.current.add(href);
    void router.prefetch(href);
  };

  const navGroups: NavGroupConfig[] = [
    {
      title: 'UTAMA',
      items: [
        {
          label: 'Dashboard',
          href: '/dashboard',
          icon: LayoutDashboard,
          allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
        },
        {
          label: 'Katalog & Unit',
          href: '/catalog',
          icon: Building2,
          allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
        },
      ],
    },
    {
      title: 'CRM & PRE-SALES',
      items: [
        {
          label: 'Leads & Pipeline',
          href: '/leads',
          icon: Users,
          allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
        },
        {
          label: 'Survei Lokasi',
          href: '/site-visits',
          icon: MapPin,
          allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
        },
      ],
    },
    {
      title: 'TRANSAKSI & KEUANGAN',
      items: [
        {
          label: 'Booking & Reservasi',
          href: '/bookings',
          icon: FileCheck2,
          allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
        },
        {
          label: 'Pembayaran & Refund',
          href: '/payments',
          icon: CreditCard,
          allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
          badgeCount: user.systemRole === 'ADMIN' ? pendingVerificationCount : 0,
          badgeTone: 'amber',
        },
        {
          label: 'Pengajuan KPR',
          href: '/kpr',
          icon: Landmark,
          allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
        },
        {
          label: 'Deals & Kontrak',
          href: '/deals',
          icon: Briefcase,
          allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
        },
      ],
    },
    {
      title: 'ANALITIK & SISTEM',
      items: [
        {
          label:
            user.systemRole === 'SUPERVISOR'
              ? 'Laporan Tim'
              : 'Laporan Eksekutif',
          href: '/reports',
          icon: BarChart3,
          allowedRoles: ['ADMIN', 'SUPERVISOR'],
        },
        {
          label: 'Manajemen Pengguna',
          href: '/admin/users',
          icon: UserCog,
          allowedRoles: ['ADMIN'],
        },
        {
          label: 'Manajemen Tim',
          href: '/admin/teams',
          icon: Network,
          allowedRoles: ['ADMIN'],
        },
        {
          label: 'Pengaturan Keuangan',
          href: '/admin/finance',
          icon: Wallet,
          allowedRoles: ['ADMIN'],
        },
      ],
    },
  ];

  const bottomItems: NavItemConfig[] = [
    {
      label: 'Notifikasi',
      href: '/notifications',
      icon: Bell,
      allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
      badgeCount: unreadNotificationsCount,
      badgeTone: 'red',
    },
    {
      label: 'Profil Saya',
      href: '/profile',
      icon: UserCircle,
      allowedRoles: ['ADMIN', 'SUPERVISOR', 'SALES'],
    },
  ];

  const isPathActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderSidebarContent = (collapsedMode: boolean) => (
    <div className="flex h-full max-h-screen flex-col overflow-hidden bg-white">
      {/* Brand Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#E2E8F0] px-4">
        <Link
          href="/dashboard"
          prefetch={false}
          onMouseEnter={() => prefetchOnIntent('/dashboard')}
          onFocus={() => prefetchOnIntent('/dashboard')}
          onClick={onCloseMobile}
          className="flex min-w-0 items-center gap-3"
        >
          <BrandLogo size="sm" />
          {!collapsedMode && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight text-[#0F172A]">
                FIM-Property CRM
              </p>
              {user.systemRole === 'ADMIN' ? (
                <span className="inline-block truncate text-[11px] font-medium text-[#059669]">
                  PT FIM-Property • Pusat
                </span>
              ) : (
                <span className="inline-block truncate rounded bg-[#F0FDF4] px-1.5 py-0.5 text-[11px] font-medium text-[#14532D]">
                  {user.activeTeamName ?? 'Belum Ada Tim'}
                </span>
              )}
            </div>
          )}
        </Link>

        {/* Tombol Tutup khusus Mobile Drawer */}
        <button
          type="button"
          onClick={onCloseMobile}
          className="rounded-md p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] md:hidden"
          aria-label="Tutup menu navigasi"
        >
          <X className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      {/* Main Navigation Groups */}
      <nav
        aria-label="Menu Utama"
        className="flex-1 space-y-5 overflow-y-auto px-3 py-4"
      >
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((item) =>
            item.allowedRoles.includes(user.systemRole)
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.title}>
              {!collapsedMode && (
                <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                  {group.title}
                </p>
              )}
              <ul className="space-y-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = isPathActive(item.href);
                  const badgeVal = item.badgeCount ?? 0;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        prefetch={false}
                        onMouseEnter={() => prefetchOnIntent(item.href)}
                        onFocus={() => prefetchOnIntent(item.href)}
                        onClick={onCloseMobile}
                        title={collapsedMode ? item.label : undefined}
                        className={`group relative flex items-center justify-between rounded-md px-3 py-2 text-[13px] transition-colors ${
                          active
                            ? 'bg-[#F0FDF4] font-semibold text-[#14532D]'
                            : 'font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                        }`}
                      >
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-[#14532D]"
                          />
                        )}
                        <div className="flex min-w-0 items-center gap-3">
                          <Icon
                            className={`h-[18px] w-[18px] shrink-0 ${
                              active
                                ? 'text-[#14532D]'
                                : 'text-[#64748B] group-hover:text-[#0F172A]'
                            }`}
                            strokeWidth={1.75}
                          />
                          {!collapsedMode && (
                            <span className="truncate">{item.label}</span>
                          )}
                        </div>

                        {badgeVal > 0 && !collapsedMode && (
                          <span
                            className={`ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                              item.badgeTone === 'red'
                                ? 'bg-[#FEF2F2] text-[#B91C1C]'
                                : 'bg-[#FFFBEB] text-[#B45309]'
                            }`}
                          >
                            {badgeVal > 99 ? '99+' : badgeVal}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Bottom Account Utilities & Collapse Button */}
      <div className="shrink-0 border-t border-[#E2E8F0] bg-white p-3">
        <ul className="space-y-1">
          {bottomItems.map((item) => {
            const Icon = item.icon;
            const active = isPathActive(item.href);
            const badgeVal = item.badgeCount ?? 0;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  onMouseEnter={() => prefetchOnIntent(item.href)}
                  onFocus={() => prefetchOnIntent(item.href)}
                  onClick={onCloseMobile}
                  title={collapsedMode ? item.label : undefined}
                  className={`group relative flex items-center justify-between rounded-md px-3 py-2 text-[13px] transition-colors ${
                    active
                      ? 'bg-[#F0FDF4] font-semibold text-[#14532D]'
                      : 'font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-[#14532D]"
                    />
                  )}
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon
                      className={`h-[18px] w-[18px] shrink-0 ${
                        active
                          ? 'text-[#14532D]'
                          : 'text-[#64748B] group-hover:text-[#0F172A]'
                      }`}
                      strokeWidth={1.75}
                    />
                    {!collapsedMode && <span className="truncate">{item.label}</span>}
                  </div>

                  {badgeVal > 0 && !collapsedMode && (
                    <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#FEF2F2] px-1.5 text-[11px] font-semibold text-[#B91C1C] tabular-nums">
                      {badgeVal > 99 ? '99+' : badgeVal}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={onToggleCollapse}
          className="mt-2 hidden w-full items-center justify-center gap-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] md:flex"
          title={collapsedMode ? 'Perluas Sidebar' : 'Ciutkan Sidebar'}
        >
          {collapsedMode ? (
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
              <span>Ciutkan Menu</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (Sticky Viewport Height tanpa gap putih panjang) */}
      <aside
        className={`hidden border-r border-[#E2E8F0] bg-white transition-[width] duration-150 md:sticky md:top-0 md:flex md:h-screen md:max-h-screen md:shrink-0 md:flex-col ${
          isCollapsed ? 'w-[68px]' : 'w-[260px]'
        }`}
      >
        {renderSidebarContent(isCollapsed)}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 flex h-full w-[260px] max-w-[85vw] flex-col bg-white shadow-xl">
            {renderSidebarContent(false)}
          </aside>
        </div>
      )}
    </>
  );
}
