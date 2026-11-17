// Lokasi: src/components/ui/Card.tsx
// Komponen Kontainer Card Standar sesuai DESIGN.md v2.1 Bagian 4.2 & 4.3

import React from 'react';

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-[#E2E8F0] bg-white shadow-2xs ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-1 border-b border-[#E2E8F0] px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-[15px] font-semibold tracking-tight text-[#0F172A] ${className}`}
    >
      {children}
    </h2>
  );
}

export function CardDescription({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={`text-xs text-[#64748B] ${className}`}>{children}</p>;
}

export function CardContent({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}
