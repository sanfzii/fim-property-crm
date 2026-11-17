import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { FinanceSettingsClient } from '@/components/admin/FinanceSettingsClient';

export const dynamic = 'force-dynamic';

export default async function FinanceSettingsPage() {
  await requirePageAuth(['ADMIN']);
  const supabase = await createSupabaseServerClient();
  const [settingsRes, dealsRes, profilesRes, unitsRes, projectsRes] = await Promise.all([
    supabase.from('finance_settings').select('sales_split_rate, supervisor_split_rate, sales_base_salary, supervisor_base_salary').eq('id', true).maybeSingle(),
    supabase.from('deals').select('id, reference_number, final_deal_value, commission_total_snapshot, commission_received_amount, developer_commission_status, unit_id, team_id, sales_closed_won_at, created_at').eq('sales_outcome_status', 'CLOSED_WON').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, system_role').eq('is_active', true),
    supabase.from('units').select('id, project_id'),
    supabase.from('property_projects').select('id, name, developer_commission_rate'),
  ]);
  const salesCount = (profilesRes.data ?? []).filter((p) => p.system_role === 'SALES').length;
  const supervisorCount = (profilesRes.data ?? []).filter((p) => p.system_role === 'SUPERVISOR').length;
  const s = settingsRes.data;
  const salary = s ? salesCount * Number(s.sales_base_salary) + supervisorCount * Number(s.supervisor_base_salary) : 0;
  const unitProject = new Map((unitsRes.data ?? []).map((u) => [u.id, u.project_id]));
  const projectById = new Map((projectsRes.data ?? []).map((p) => [p.id, p]));
  const missingCommissionDeals = (dealsRes.data ?? []).filter((d) => d.commission_total_snapshot === null).map((d) => {
    const project = projectById.get(unitProject.get(d.unit_id) ?? '');
    return { id: d.id, label: d.reference_number, finalValue: Number(d.final_deal_value), projectName: project?.name ?? 'Proyek tidak ditemukan', projectRate: project?.developer_commission_rate === null || project?.developer_commission_rate === undefined ? null : Number(project.developer_commission_rate) };
  });
  const settings = s ? { salesSplitRate: Number(s.sales_split_rate), supervisorSplitRate: Number(s.supervisor_split_rate), salesBaseSalary: Number(s.sales_base_salary), supervisorBaseSalary: Number(s.supervisor_base_salary) } : { salesSplitRate: 70, supervisorSplitRate: 15, salesBaseSalary: 2000000, supervisorBaseSalary: 5000000 };
  return <FinanceSettingsClient settings={settings} salaryEstimate={salary} deals={(dealsRes.data ?? []).filter((d) => d.commission_total_snapshot !== null).map((d) => { const projectName = projectById.get(unitProject.get(d.unit_id) ?? '')?.name ?? 'Proyek tidak ditemukan'; return { id: d.id, label: `${d.reference_number} · ${projectName}`, total: Number(d.commission_total_snapshot), received: Number(d.commission_received_amount), status: d.developer_commission_status }; })} missingCommissionDeals={missingCommissionDeals} />;
}
