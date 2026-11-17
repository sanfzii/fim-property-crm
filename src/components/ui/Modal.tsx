// Lokasi: src/components/ui/Modal.tsx
// Komponen Modal Reusable sesuai DESIGN.md v2.1 Bagian 5.5

'use client';

import React, { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'md' | 'lg';
  isDismissDisabled?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  size = 'md',
  isDismissDisabled = false,
  children,
  footer,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDismissDisabled) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDismissDisabled, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDismissDisabled) {
          onClose();
        }
      }}
    >
      <div
        className={cn(
          'flex max-h-[90vh] w-full flex-col rounded-xl border border-[#E2E8F0] bg-white shadow-xl',
          size === 'lg' ? 'max-w-[720px]' : 'max-w-[560px]'
        )}
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#E2E8F0] px-6 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-[#0F172A]"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1 text-xs leading-relaxed text-[#475569]"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={isDismissDisabled}
            onClick={onClose}
            className="rounded-md p-1.5 text-[#64748B] transition-colors hover:bg-[#F1F5F9] hover:text-[#0F172A] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Tutup modal"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {/* Optional Sticky Footer */}
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-[#E2E8F0] bg-[#F8FAFC] px-6 py-4 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
