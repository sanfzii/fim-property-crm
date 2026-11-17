// Lokasi: src/app/(protected)/profile/page.tsx
// Server Component Halaman Profil Saya (/profile)

import React from 'react';
import { Building2, Mail, Phone, Shield, Users } from 'lucide-react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getInitials, formatDateTimeID } from '@/lib/utils/format';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProfileFormClient } from '@/components/profile/ProfileFormClient';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const supabase = await createSupabaseServerClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, system_role, is_active, created_at, updated_at')
    .eq('id', user.userId)
    .single();

  const fullName = profile?.full_name ?? user.fullName;
  const phone = profile?.phone ?? '-';
  const email = profile?.email ?? user.email;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
          Profil Saya
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Kartu Ringkasan Identitas Staf */}
        <Card>
          <CardHeader>
            <CardTitle>Identitas &amp; Akses</CardTitle>
            <Badge tone="emerald">AKTIF</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] text-lg font-bold text-[#14532D]">
                {getInitials(fullName)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-[#0F172A]">
                  {fullName}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone="forest">{user.systemRole}</Badge>
                  {user.membershipRole && (
                    <Badge tone="blue">{user.membershipRole}</Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2.5 border-t border-[#E2E8F0] pt-4 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[#64748B]">
                  <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Email Kerja</span>
                </span>
                <span className="font-medium text-[#0F172A]">{email}</span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[#64748B]">
                  <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>No. Telepon</span>
                </span>
                <span className="font-mono font-medium text-[#0F172A] tabular-nums">
                  {phone}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[#64748B]">
                  <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Tim Penjualan Aktif</span>
                </span>
                <span className="font-semibold text-[#14532D]">
                  {user.activeTeamName
                    ? `${user.activeTeamName} (${user.activeTeamCode})`
                    : 'Lintas Perusahaan (Pusat)'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[#64748B]">
                  <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>Entitas</span>
                </span>
                <span className="font-medium text-[#0F172A]">PT FIM-Property</span>
              </div>

              {profile?.updated_at && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[#64748B]">
                    <Shield className="h-3.5 w-3.5" strokeWidth={1.75} />
                    <span>Pembaruan Terakhir</span>
                  </span>
                  <span className="text-[#475569] tabular-nums">
                    {formatDateTimeID(profile.updated_at)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Form Edit Profil Pribadi */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Informasi Kontak</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileFormClient
              initialFullName={fullName}
              initialPhone={phone === '-' ? '' : phone}
              email={email}
              systemRole={user.systemRole}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
