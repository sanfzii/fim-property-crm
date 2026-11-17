// Lokasi: src/components/layout/BrandLogo.tsx
// Komponen Logo Resmi PT FIM-Property.

import Image from 'next/image';
import { cn } from '@/lib/utils/cn';

export interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-9 w-9 p-1',
  md: 'h-10 w-10 p-1',
  lg: 'h-11 w-11 p-1.5',
};

export function BrandLogo({ size = 'sm', className }: BrandLogoProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white shadow-2xs',
        SIZE_CLASSES[size],
        className
      )}
    >
      <Image
        src="/fim-logo.png"
        alt="Logo PT FIM-Property"
        width={64}
        height={64}
        sizes="44px"
        className="h-full w-full object-contain"
      />
    </div>
  );
}
