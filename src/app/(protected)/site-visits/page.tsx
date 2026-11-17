// Lokasi: src/app/(protected)/site-visits/page.tsx
// Server Component Halaman Survei Lokasi (/site-visits — ADMIN, SUPERVISOR, SALES)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  SiteVisitsWorkspaceClient,
  type SiteVisitLeadOption,
  type SiteVisitProjectOption,
  type SiteVisitRowDto,
  type SiteVisitUnitOption,
} from '@/components/site-visits/SiteVisitsWorkspaceClient';
import type { SiteVisitOutcome, SiteVisitStatus } from '@/types/database.types';

export const dynamic = 'force-dynamic';

export default async function SiteVisitsPage() {
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const supabase = await createSupabaseServerClient();

  const [visitsRes, leadsRes, projectsRes, unitsRes, staffDirRes] =
    await Promise.all([
      supabase
        .from('site_visits')
        .select(
          'id, lead_id, sales_id, project_id, unit_id, scheduled_at, preparation_notes, status, customer_interest_outcome, evaluation_notes, completed_at'
        )
        .order('scheduled_at', { ascending: false }),
      supabase
        .from('leads')
        .select('id, full_name, phone, preferred_project_id')
        .order('full_name', { ascending: true }),
      supabase
        .from('property_projects')
        .select('id, code, name')
        .order('code', { ascending: true }),
      supabase
        .from('units')
        .select('id, project_id, unit_code, block_number, status')
        .order('unit_code', { ascending: true }),
      supabase
        .from('v_staff_directory')
        .select('profile_id, full_name, active_team_code'),
    ]);

  const leadMap = new Map((leadsRes.data ?? []).map((l) => [l.id, l]));
  const projectMap = new Map(
    (projectsRes.data ?? []).map((p) => [p.id, p])
  );
  const unitMap = new Map((unitsRes.data ?? []).map((u) => [u.id, u]));
  const staffMap = new Map(
    (staffDirRes.data ?? []).map((s) => [s.profile_id, s])
  );

  const siteVisits: SiteVisitRowDto[] = (visitsRes.data ?? []).map((v) => {
    const lead = leadMap.get(v.lead_id);
    const project = projectMap.get(v.project_id);
    const unit = v.unit_id ? unitMap.get(v.unit_id) : undefined;
    const staff = staffMap.get(v.sales_id);

    return {
      id: v.id,
      leadId: v.lead_id,
      leadName: lead?.full_name ?? 'Prospek FIM',
      leadPhone: lead?.phone ?? '-',
      salesId: v.sales_id,
      salesName: staff?.full_name ?? 'Sales FIM',
      teamCode: staff?.active_team_code ?? '-',
      projectId: v.project_id,
      projectName: project?.name ?? 'Proyek FIM',
      unitId: v.unit_id,
      unitCode: unit?.unit_code ?? null,
      scheduledAt: v.scheduled_at,
      preparationNotes: v.preparation_notes,
      status: v.status as SiteVisitStatus,
      outcome: v.customer_interest_outcome as SiteVisitOutcome | null,
      evaluationNotes: v.evaluation_notes,
      completedAt: v.completed_at,
    };
  });

  const leads: SiteVisitLeadOption[] = (leadsRes.data ?? []).map((l) => ({
    id: l.id,
    fullName: l.full_name,
    phone: l.phone,
    preferredProjectId: l.preferred_project_id,
  }));

  const projects: SiteVisitProjectOption[] = (projectsRes.data ?? []).map(
    (p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
    })
  );

  const availableUnits: SiteVisitUnitOption[] = (unitsRes.data ?? [])
    .filter((u) => u.status === 'AVAILABLE')
    .map((u) => ({
      id: u.id,
      projectId: u.project_id,
      unitCode: u.unit_code,
      blockNumber: u.block_number,
    }));

  return (
    <SiteVisitsWorkspaceClient
      userRole={user.systemRole}
      siteVisits={siteVisits}
      leads={leads}
      projects={projects}
      availableUnits={availableUnits}
    />
  );
}
