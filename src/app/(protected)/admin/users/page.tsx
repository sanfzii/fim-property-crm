// Lokasi: src/app/(protected)/admin/users/page.tsx
// Server Component Halaman Manajemen Pengguna (/admin/users — Khusus ADMIN)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  UsersManagementClient,
  type AdminStaffListItem,
} from '@/components/admin/UsersManagementClient';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const user = await requirePageAuth(['ADMIN']);
  const supabase = await createSupabaseServerClient();

  const [profilesRes, membershipsRes, teamsRes, leadsRes, bookingsRes] =
    await Promise.all([
      supabase
        .from('profiles')
        .select(
          'id, full_name, email, phone, system_role, is_active, created_at'
        )
        .order('created_at', { ascending: true }),
      supabase
        .from('team_memberships')
        .select('profile_id, team_id, membership_role, is_active')
        .eq('is_active', true),
      supabase.from('teams').select('id, code, name'),
      supabase
        .from('leads')
        .select('id, assigned_sales_id, pipeline_stage')
        .not('pipeline_stage', 'in', '("CLOSED_WON","CLOSED_LOST")'),
      supabase
        .from('bookings')
        .select('id, current_sales_id, status')
        .in('status', ['PENDING_FEE', 'ACTIVE']),
    ]);

  const teamMap = new Map((teamsRes.data ?? []).map((t) => [t.id, t]));
  const activeMembershipByProfile = new Map(
    (membershipsRes.data ?? []).map((m) => [m.profile_id, m])
  );

  const activeLeadsCountBySales = new Map<string, number>();
  for (const lead of leadsRes.data ?? []) {
    activeLeadsCountBySales.set(
      lead.assigned_sales_id,
      (activeLeadsCountBySales.get(lead.assigned_sales_id) ?? 0) + 1
    );
  }

  const activeBookingsCountBySales = new Map<string, number>();
  for (const bk of bookingsRes.data ?? []) {
    activeBookingsCountBySales.set(
      bk.current_sales_id,
      (activeBookingsCountBySales.get(bk.current_sales_id) ?? 0) + 1
    );
  }

  const staffList: AdminStaffListItem[] = (profilesRes.data ?? []).map((p) => {
    const mem = activeMembershipByProfile.get(p.id);
    const team = mem ? teamMap.get(mem.team_id) : undefined;

    return {
      id: p.id,
      fullName: p.full_name,
      email: p.email,
      phone: p.phone,
      systemRole: p.system_role,
      isActive: p.is_active,
      activeTeamId: team?.id ?? null,
      activeTeamCode: team?.code ?? null,
      activeTeamName: team?.name ?? null,
      membershipRole: mem?.membership_role ?? null,
      activeLeadsCount: activeLeadsCountBySales.get(p.id) ?? 0,
      activeBookingsCount: activeBookingsCountBySales.get(p.id) ?? 0,
      createdAt: p.created_at,
    };
  });

  return (
    <UsersManagementClient
      currentAdminId={user.userId}
      staffList={staffList}
    />
  );
}
