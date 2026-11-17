// Lokasi: src/components/ui/CurrencyInput.tsx
// Input angka bulat dengan pemisah ribuan otomatis (format Indonesia).

'use client';

import React from 'react';
import { Input, type InputProps } from '@/components/ui/Input';
import { formatNumericInput } from '@/lib/utils/format';

export interface CurrencyInputProps
  extends Omit<InputProps, 'type' | 'value' | 'onChange'> {
  value: number | string | null | undefined;
  onValueChange: (value: string) => void;
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onValueChange, inputMode = 'numeric', ...props }, ref) => {
    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode={inputMode}
        value={formatNumericInput(value)}
        onChange={(event) => {
          onValueChange(event.target.value.replace(/\D/g, ''));
        }}
      />
    );
  }
);

CurrencyInput.displayName = 'CurrencyInput';
