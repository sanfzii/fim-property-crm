// Lokasi: src/components/ui/Button.tsx
// Komponen Tombol Standar sesuai DESIGN.md v2.1 Bagian 6.6

'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[#14532D] text-white hover:bg-[#0F3F22] active:bg-[#0A2E18] border border-transparent shadow-2xs',
  secondary:
    'bg-white text-[#14532D] border border-[#14532D] hover:bg-[#F0FDF4] active:bg-[#DCFCE7]',
  outline:
    'bg-white text-[#475569] border border-[#CBD5E1] hover:bg-[#F8FAFC] hover:text-[#0F172A] active:bg-[#F1F5F9]',
  ghost:
    'bg-transparent text-[#475569] border border-transparent hover:bg-[#F1F5F9] hover:text-[#0F172A]',
  destructive:
    'bg-[#DC2626] text-white hover:bg-[#B91C1C] active:bg-[#991B1B] border border-transparent shadow-2xs',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-4 text-sm gap-2 rounded-md',
  icon: 'h-9 w-9 p-0 justify-center rounded-md',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  disabled,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[#10B981]/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.75} />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      {children && <span>{children}</span>}
      {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
}
