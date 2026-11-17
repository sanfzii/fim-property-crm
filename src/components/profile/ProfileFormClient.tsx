// Lokasi: src/components/profile/ProfileFormClient.tsx
// Komponen Form Edit Profil Pribadi (full_name & phone) menggunakan updateOwnProfileAction

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, ShieldCheck } from 'lucide-react';
import { updateOwnProfileAction } from '@/modules/identity/profiles/profiles.actions';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';

export interface ProfileFormClientProps {
  initialFullName: string;
  initialPhone: string;
  email: string;
  systemRole: string;
}

export function ProfileFormClient({
  initialFullName,
  initialPhone,
  email,
  systemRole,
}: ProfileFormClientProps) {
  const router = useRouter();
  const { showToast } = useToast();

  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState(initialPhone);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    setFieldErrors({});

    try {
      const result = await updateOwnProfileAction({
        fullName,
        phone,
      });

      if (result.success) {
        showToast({
          title: 'Profil Diperbarui',
          description: result.message,
          tone: 'success',
        });
        router.refresh();
      } else {
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
        }
        showToast({
          title: 'Gagal Memperbarui Profil',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      showToast({
        title: 'Gangguan Jaringan',
        description: 'Tidak dapat menghubungi server saat menyimpan profil.',
        tone: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="fullName"
            className="block text-[13px] font-medium text-[#0F172A]"
          >
            Nama Lengkap Staf
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={isSaving}
            className="mt-1.5 block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-2xs transition-colors focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none disabled:bg-[#F1F5F9]"
          />
          {fieldErrors.fullName && (
            <p className="mt-1 text-xs text-[#DC2626]">{fieldErrors.fullName[0]}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="phone"
            className="block text-[13px] font-medium text-[#0F172A]"
          >
            Nomor Telepon / WhatsApp Kerja
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={isSaving}
            className="mt-1.5 block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 font-mono text-sm text-[#0F172A] shadow-2xs transition-colors focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none disabled:bg-[#F1F5F9]"
          />
          {fieldErrors.phone && (
            <p className="mt-1 text-xs text-[#DC2626]">{fieldErrors.phone[0]}</p>
          )}
        </div>

        <div>
          <label className="block text-[13px] font-medium text-[#64748B]">
            Alamat Email Resmi (Tidak Dapat Diubah Sendiri)
          </label>
          <input
            type="email"
            value={email}
            disabled
            readOnly
            className="mt-1.5 block h-9 w-full cursor-not-allowed rounded-md border border-[#E2E8F0] bg-[#F1F5F9] px-3 text-sm text-[#64748B]"
          />
        </div>

        <div>
          <label className="block text-[13px] font-medium text-[#64748B]">
            Role Sistem (Dikunci oleh Trigger Keamanan DB)
          </label>
          <input
            type="text"
            value={systemRole}
            disabled
            readOnly
            className="mt-1.5 block h-9 w-full cursor-not-allowed rounded-md border border-[#E2E8F0] bg-[#F1F5F9] px-3 font-mono text-sm font-semibold text-[#475569]"
          />
        </div>
      </div>

      <div className="flex flex-col justify-between gap-3 border-t border-[#E2E8F0] pt-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-xs text-[#64748B]">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#059669]" strokeWidth={1.75} />
          <span>
            Perubahan role sistem dan status aktif staf hanya dapat dilakukan oleh Administrator.
          </span>
        </div>

        <Button
          type="submit"
          variant="primary"
          isLoading={isSaving}
          leftIcon={<Save className="h-4 w-4" strokeWidth={1.75} />}
        >
          Simpan Perubahan Profil
        </Button>
      </div>
    </form>
  );
}
