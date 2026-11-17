// Lokasi: src/components/ui/KpiCard.tsx
// Komponen KPI Summary Card sesuai DESIGN.md v2.1 Bagian 6.1

import React from 'react';

export type KpiTone = 'default' | 'success' | 'warning' | 'error';

export interface KpiCardProps {
  label: string;
  value: string | number;
  subtext: string;
  icon: React.ReactNode;
  tone?: KpiTone;
  badge?: React.ReactNode;
}

const iconBoxClasses: Record<KpiTone, string> = {
  default: 'bg-[#F0FDF4] text-[#14532D] border-[#BBF7D0]',
  success: 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]',
  warning: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]',
  error: 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]',
};

const cardBorderClasses: Record<KpiTone, string> = {
  default: 'border-[#E2E8F0]',
  success: 'border-[#E2E8F0]',
  warning: 'border-[#FDE68A]',
  error: 'border-[#FECACA]',
};

export function KpiCard({
  label,
  value,
  subtext,
  icon,
  tone = 'default',
  badge,
}: KpiCardProps) {
  return (
    <div
      className={`flex flex-col justify-between rounded-lg border bg-white p-5 shadow-2xs ${cardBorderClasses[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-medium text-[#64748B]">{label}</span>
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${iconBoxClasses[tone]}`}
        >
          {icon}
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl font-bold tracking-tight text-[#0F172A] tabular-nums">
            {value}
          </p>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[#475569] tabular-nums">
          {subtext}
        </p>
      </div>
    </div>
  );
}
