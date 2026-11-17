// Lokasi: src/app/(protected)/admin/teams/page.tsx
// Server Component Halaman Manajemen Tim Penjualan (/admin/teams — Khusus ADMIN)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  TeamsManagementClient,
  type AdminTeamCardDto,
  type TeamActiveMemberDto,
  type TeamMembershipHistoryDto,
  type AssignableStaffDto,
} from '@/components/admin/TeamsManagementClient';

export const dynamic = 'force-dynamic';

export default async function AdminTeamsPage() {
  await requirePageAuth(['ADMIN']);
  const supabase = await createSupabaseServerClient();

  const [teamsRes, membershipsRes, profilesRes] = await Promise.all([
    supabase
      .from('teams')
      .select('id, code, name, description, is_active, created_at')
      .order('code', { ascending: true }),
    supabase
      .from('team_memberships')
      .select(
        'id, team_id, profile_id, membership_role, is_active, joined_at, left_at, notes, created_at'
      )
      .order('joined_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, full_name, email, phone, system_role, is_active')
      .order('full_name', { ascending: true }),
  ]);

  const teamsData = teamsRes.data ?? [];
  const membershipsData = membershipsRes.data ?? [];
  const profilesData = profilesRes.data ?? [];

  const profileMap = new Map(profilesData.map((p) => [p.id, p]));
  const teamMap = new Map(teamsData.map((t) => [t.id, t]));

  const activeMembershipByProfile = new Map(
    membershipsData.filter((m) => m.is_active).map((m) => [m.profile_id, m])
  );

  const teams: AdminTeamCardDto[] = teamsData.map((team) => {
    const activeInTeam = membershipsData.filter(
      (m) => m.team_id === team.id && m.is_active
    );

    const supRow = activeInTeam.find(
      (m) => m.membership_role === 'TEAM_SUPERVISOR'
    );
    const supProfile = supRow ? profileMap.get(supRow.profile_id) : undefined;

    const supervisor: TeamActiveMemberDto | null =
      supRow && supProfile
        ? {
            membershipId: supRow.id,
            profileId: supProfile.id,
            fullName: supProfile.full_name,
            email: supProfile.email,
            phone: supProfile.phone,
            membershipRole: 'TEAM_SUPERVISOR',
            joinedAt: supRow.joined_at,
            notes: supRow.notes,
          }
        : null;

    const salesMembers: TeamActiveMemberDto[] = activeInTeam
      .filter((m) => m.membership_role === 'TEAM_SALES')
      .map((m) => {
        const prof = profileMap.get(m.profile_id);
        return {
          membershipId: m.id,
          profileId: m.profile_id,
          fullName: prof?.full_name ?? 'Anggota Sales',
          email: prof?.email ?? '-',
          phone: prof?.phone ?? '-',
          membershipRole: 'TEAM_SALES' as const,
          joinedAt: m.joined_at,
          notes: m.notes,
        };
      });

    return {
      id: team.id,
      code: team.code,
      name: team.name,
      description: team.description,
      isActive: team.is_active,
      supervisor,
      salesMembers,
    };
  });

  const assignableStaff: AssignableStaffDto[] = profilesData
    .filter(
      (p) =>
        p.is_active &&
        (p.system_role === 'SUPERVISOR' || p.system_role === 'SALES')
    )
    .map((p) => {
      const activeMem = activeMembershipByProfile.get(p.id);
      const currTeam = activeMem ? teamMap.get(activeMem.team_id) : undefined;
      return {
        id: p.id,
        fullName: p.full_name,
        email: p.email,
        systemRole: p.system_role,
        currentTeamCode: currTeam?.code ?? null,
        currentTeamName: currTeam?.name ?? null,
      };
    });

  const membershipHistory: TeamMembershipHistoryDto[] = membershipsData.map(
    (m) => {
      const team = teamMap.get(m.team_id);
      const prof = profileMap.get(m.profile_id);
      return {
        id: m.id,
        teamCode: team?.code ?? '-',
        teamName: team?.name ?? 'Tim Penjualan',
        staffName: prof?.full_name ?? 'Staf Internal',
        staffEmail: prof?.email ?? '-',
        membershipRole: m.membership_role,
        isActive: m.is_active,
        joinedAt: m.joined_at,
        leftAt: m.left_at,
        notes: m.notes,
      };
    }
  );

  return (
    <TeamsManagementClient
      teams={teams}
      assignableStaff={assignableStaff}
      membershipHistory={membershipHistory}
    />
  );
}
