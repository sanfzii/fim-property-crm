// Lokasi: src/components/ui/ToastProvider.tsx
// Sistem Notifikasi Toast Non-Intrusif dengan dukungan correlationId (ActionResult<T>)

'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  correlationId?: string;
  tone: ToastTone;
}

export interface ShowToastParams {
  title: string;
  description?: string;
  correlationId?: string;
  tone?: ToastTone;
}

interface ToastContextValue {
  showToast: (params: ShowToastParams) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    ({ title, description, correlationId, tone = 'info' }: ShowToastParams) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [
        ...prev.slice(-3),
        { id, title, description, correlationId, tone },
      ]);
      window.setTimeout(() => {
        dismissToast(id);
      }, 5000);
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2.5"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-lg ${
              t.tone === 'success'
                ? 'border-[#A7F3D0] bg-white text-[#0F172A]'
                : t.tone === 'error'
                  ? 'border-[#FECACA] bg-white text-[#0F172A]'
                  : 'border-[#E2E8F0] bg-white text-[#0F172A]'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {t.tone === 'success' && (
                <CheckCircle2
                  className="h-4 w-4 text-[#059669]"
                  strokeWidth={1.75}
                />
              )}
              {t.tone === 'error' && (
                <AlertCircle
                  className="h-4 w-4 text-[#DC2626]"
                  strokeWidth={1.75}
                />
              )}
              {t.tone === 'info' && (
                <Info className="h-4 w-4 text-[#2563EB]" strokeWidth={1.75} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#0F172A]">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-xs text-[#475569]">{t.description}</p>
              )}
              {t.correlationId && (
                <p className="mt-1 font-mono text-[11px] text-[#64748B]">
                  Ref ID: {t.correlationId}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="rounded p-1 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
              aria-label="Tutup notifikasi"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast harus digunakan di dalam ToastProvider.');
  }
  return ctx;
}
