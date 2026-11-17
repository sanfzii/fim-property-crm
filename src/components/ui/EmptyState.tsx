// Lokasi: src/components/ui/EmptyState.tsx
// Komponen Empty State Terstruktur sesuai DESIGN.md v2.1 Bagian 6.7

import React from 'react';
import { Inbox } from 'lucide-react';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#64748B] shadow-2xs ring-1 ring-[#E2E8F0]">
        {icon ?? <Inbox className="h-5 w-5" strokeWidth={1.75} />}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-[#0F172A]">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-[#64748B]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
