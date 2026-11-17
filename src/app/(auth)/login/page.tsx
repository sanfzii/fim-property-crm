// Lokasi: src/app/(auth)/login/page.tsx
// Layer 2: Presentation Layer (Server Component Halaman Login)

import { BrandLogo } from '@/components/layout/BrandLogo';
import { LoginForm } from '@/components/auth/LoginForm';
import { sanitizeInternalRedirectPath } from '@/modules/identity/auth/auth.schemas';

interface LoginPageProps {
  searchParams: Promise<{ redirectTo?: string; reason?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const redirectTo = sanitizeInternalRedirectPath(params.redirectTo);

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-[#F8FAFC]">
      <div className="flex w-full flex-1 flex-col items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-[#E2E8F0] bg-white p-8 shadow-xs">
          <div className="border-b border-[#E2E8F0] pb-5">
            <div className="flex items-center gap-3">
              <BrandLogo size="lg" />
              <div>
                <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
                  FIM-Property CRM
                </h1>
                <p className="text-xs text-[#64748B]">PT FIM-Property</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-[#475569]">
              Masuk menggunakan akun staf resmi.
            </p>
          </div>

          {params.reason === 'inactive' && (
            <div className="mt-4 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs font-medium text-[#B45309]">
              Sesi dihentikan karena status akun tidak aktif.
            </div>
          )}

          {params.reason === 'profile_missing' && (
            <div className="mt-4 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-medium text-[#B91C1C]">
              Profil staf tidak ditemukan. Hubungi Administrator.
            </div>
          )}

          <LoginForm redirectTo={redirectTo} />
        </div>
      </div>

      <footer className="w-full border-t border-[#E2E8F0] bg-white/60 px-6 py-3 text-center text-xs text-[#64748B]">
        © 2026 FIM-Property CRM • Muhammad Ichsan Fachrulrozi, Muzayin Arifin &amp; Fariz Aditya Ardhana
      </footer>
    </main>
  );
}



