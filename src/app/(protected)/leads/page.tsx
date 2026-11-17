// Lokasi: src/app/(protected)/leads/page.tsx
// Server Component Halaman Daftar Leads & Pipeline Kanban (/leads — ADMIN, SUPERVISOR, SALES)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  LeadsWorkspaceClient,
  type LeadListItemDto,
  type LeadProjectOption,
  type LeadPropertyTypeOption,
  type LeadSalesOption,
  type LeadTeamOption,
} from '@/components/leads/LeadsWorkspaceClient';
import type {
  LeadSource,
  LeadTemperature,
  PaymentMethod,
  PaymentReadiness,
  PipelineStage,
  PurchaseTimeline,
} from '@/types/database.types';

export const dynamic = 'force-dynamic';

function computeOverdueCountByLeadId(
  tasks: { id: string; lead_id: string; status: string; due_at: string }[]
): Map<string, number> {
  const nowMs = Date.now();
  const map = new Map<string, number>();
  for (const t of tasks) {
    const isOverdue =
      t.status === 'OVERDUE' ||
      (t.status === 'PENDING' && new Date(t.due_at).getTime() < nowMs);
    if (isOverdue) {
      map.set(t.lead_id, (map.get(t.lead_id) ?? 0) + 1);
    }
  }
  return map;
}

export default async function LeadsPage() {
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const supabase = await createSupabaseServerClient();

  const [
    leadsRes,
    tasksRes,
    projectsRes,
    propertyTypesRes,
    teamsRes,
    staffDirRes,
  ] = await Promise.all([
    supabase
      .from('leads')
      .select(
        'id, full_name, phone, email, occupation, lead_source, assigned_sales_id, team_id, budget_amount, preferred_city, preferred_project_id, preferred_property_type_id, preferred_payment_method, purchase_timeline, payment_readiness, prospect_score, lead_temperature, pipeline_stage, lost_reason, last_interaction_at, updated_at'
      )
      .order('prospect_score', { ascending: false })
      .order('updated_at', { ascending: false }),
    supabase
      .from('follow_up_tasks')
      .select('id, lead_id, status, due_at')
      .in('status', ['PENDING', 'OVERDUE']),
    supabase
      .from('property_projects')
      .select('id, code, name, city')
      .order('code', { ascending: true }),
    supabase
      .from('property_types')
      .select('id, project_id, code, name')
      .eq('is_active', true)
      .order('code', { ascending: true }),
    supabase
      .from('teams')
      .select('id, code, name')
      .eq('is_active', true)
      .order('code', { ascending: true }),
    supabase
      .from('v_staff_directory')
      .select(
        'profile_id, full_name, system_role, is_active, active_team_id, active_team_code, active_team_name'
      ),
  ]);

  const overdueCountByLeadId = computeOverdueCountByLeadId(tasksRes.data ?? []);

  const projectMap = new Map(
    (projectsRes.data ?? []).map((p) => [p.id, p])
  );
  const propertyTypeMap = new Map(
    (propertyTypesRes.data ?? []).map((pt) => [pt.id, pt])
  );
  const teamMap = new Map((teamsRes.data ?? []).map((t) => [t.id, t]));
  const staffMap = new Map(
    (staffDirRes.data ?? []).map((s) => [s.profile_id, s])
  );

  const leads: LeadListItemDto[] = (leadsRes.data ?? []).map((row) => {
    const staff = staffMap.get(row.assigned_sales_id);
    const team = teamMap.get(row.team_id);
    const proj = row.preferred_project_id
      ? projectMap.get(row.preferred_project_id)
      : undefined;
    const ptype = row.preferred_property_type_id
      ? propertyTypeMap.get(row.preferred_property_type_id)
      : undefined;

    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      occupation: row.occupation,
      leadSource: row.lead_source as LeadSource,
      assignedSalesId: row.assigned_sales_id,
      assignedSalesName: staff?.full_name ?? 'Sales FIM',
      teamId: row.team_id,
      teamCode: team?.code ?? staff?.active_team_code ?? '-',
      teamName: team?.name ?? staff?.active_team_name ?? '-',
      budgetAmount: Number(row.budget_amount),
      preferredCity: row.preferred_city,
      preferredProjectId: row.preferred_project_id,
      preferredProjectName: proj?.name ?? null,
      preferredPropertyTypeId: row.preferred_property_type_id,
      preferredPropertyTypeName: ptype?.name ?? null,
      preferredPaymentMethod: row.preferred_payment_method as PaymentMethod | null,
      purchaseTimeline: row.purchase_timeline as PurchaseTimeline,
      paymentReadiness: row.payment_readiness as PaymentReadiness,
      prospectScore: Number(row.prospect_score),
      leadTemperature: row.lead_temperature as LeadTemperature,
      pipelineStage: row.pipeline_stage as PipelineStage,
      lostReason: row.lost_reason,
      overdueTasksCount: overdueCountByLeadId.get(row.id) ?? 0,
      lastInteractionAt: row.last_interaction_at,
      updatedAt: row.updated_at,
    };
  });

  const projects: LeadProjectOption[] = (projectsRes.data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    city: p.city,
  }));

  const propertyTypes: LeadPropertyTypeOption[] = (
    propertyTypesRes.data ?? []
  ).map((pt) => ({
    id: pt.id,
    projectId: pt.project_id,
    code: pt.code,
    name: pt.name,
  }));

  const teams: LeadTeamOption[] = (teamsRes.data ?? []).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
  }));

  const salesOptions: LeadSalesOption[] =
    user.systemRole === 'SALES'
      ? []
      : (staffDirRes.data ?? [])
          .filter(
            (s) =>
              s.system_role === 'SALES' &&
              s.is_active &&
              Boolean(s.active_team_id) &&
              (user.systemRole === 'ADMIN' ||
                s.active_team_id === user.activeTeamId)
          )
          .map((s) => ({
            id: s.profile_id,
            fullName: s.full_name,
            teamId: s.active_team_id as string,
            teamCode: s.active_team_code ?? '-',
          }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <LeadsWorkspaceClient
      userRole={user.systemRole}
      userId={user.userId}
      userActiveTeamId={user.activeTeamId}
      leads={leads}
      projects={projects}
      propertyTypes={propertyTypes}
      teams={teams}
      salesOptions={salesOptions}
    />
  );
}
