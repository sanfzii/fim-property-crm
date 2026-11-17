// Lokasi: src/components/auth/LoginForm.tsx
// Layer 2: Presentation Layer (Client Component untuk Form Login)

'use client';

import { useActionState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { loginWithEmailPasswordAction, type AuthActionResult } from '@/modules/identity/auth/auth.actions';

interface LoginFormProps {
  redirectTo?: string;
}

const initialState: AuthActionResult = {
  success: false,
  message: '',
};

export function LoginForm({ redirectTo = '/dashboard' }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(
    loginWithEmailPasswordAction,
    initialState
  );

  return (
    <form action={formAction} className="mt-6 space-y-5" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {state.message && !state.success && (
        <div
          role="alert"
          className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3.5 text-sm font-medium text-[#B91C1C]"
        >
          {state.message}
        </div>
      )}

      <div>
        <label
          htmlFor="email"
          className="block text-[13px] font-medium text-[#0F172A]"
        >
          Email Kerja FIM-Property
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          placeholder="nama@fimproperty.local"
          className="mt-1.5 block h-10 w-full rounded-md border border-[#CBD5E1] bg-white px-3.5 text-sm text-[#0F172A] shadow-2xs transition-colors focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none disabled:bg-[#F1F5F9]"
        />
        {state.fieldErrors?.email && (
          <p className="mt-1 text-xs text-[#DC2626]">{state.fieldErrors.email[0]}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-[13px] font-medium text-[#0F172A]"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
          placeholder="••••••••"
          className="mt-1.5 block h-10 w-full rounded-md border border-[#CBD5E1] bg-white px-3.5 text-sm text-[#0F172A] shadow-2xs transition-colors focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none disabled:bg-[#F1F5F9]"
        />
        {state.fieldErrors?.password && (
          <p className="mt-1 text-xs text-[#DC2626]">{state.fieldErrors.password[0]}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#14532D] px-4 text-sm font-semibold text-white shadow-2xs transition-colors hover:bg-[#0F3F22] active:bg-[#0A2E18] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            <span>Memverifikasi Kredensial...</span>
          </>
        ) : (
          <>
            <LogIn className="h-4 w-4" strokeWidth={1.75} />
            <span>Masuk ke Sistem CRM</span>
          </>
        )}
      </button>
    </form>
  );
}

