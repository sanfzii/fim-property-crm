// Lokasi: src/components/ui/Select.tsx
// Komponen Select Form Standar sesuai DESIGN.md v2.1 Bagian 5.4

'use client';

import React, { useId } from 'react';
import { cn } from '@/lib/utils/cn';

export interface SelectOptionItem {
  value: string;
  label: string;
}

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOptionItem[];
  error?: string;
  helperText?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, error, helperText, className, id, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="mb-1.5 block text-xs font-semibold text-[#0F172A]"
          >
            {label}
          </label>
        )}
        <select
          id={selectId}
          ref={ref}
          className={cn(
            'block h-9 w-full rounded-md border bg-white px-3 text-xs font-medium text-[#0F172A] transition-colors focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#64748B]',
            error
              ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
              : 'border-[#CBD5E1] focus:border-[#059669] focus:ring-[#10B981]/20',
            className
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error ? (
          <p className="mt-1 text-xs font-medium text-[#DC2626]">{error}</p>
        ) : helperText ? (
          <p className="mt-1 text-[11px] text-[#64748B]">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Select.displayName = 'Select';
