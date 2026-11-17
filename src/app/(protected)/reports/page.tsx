// Lokasi: src/app/(protected)/reports/page.tsx
// Server Component Halaman Laporan Eksekutif / Tim (/reports — ADMIN & SUPERVISOR only)

import React from 'react';
import { after } from 'next/server';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { ExecutiveMetricsService } from '@/modules/analytics/metrics.service';
import { ReminderSweepOrchestrator } from '@/modules/notifications-engine/reminder-sweep.orchestrator';
import {
  ReportsWorkspaceClient,
  type AuditLogItemDto,
  type LeadSourceConversionRow,
  type SalesPerformanceRow,
} from '@/components/reports/ReportsWorkspaceClient';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  // SALES otomatis dialihkan ke /dashboard?error=forbidden oleh requirePageAuth
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR']);
  after(() => {
    return ReminderSweepOrchestrator.triggerThrottledOnAccessSweepSafe();
  });

  const supabase = await createSupabaseServerClient();
  const isAdmin = user.systemRole === 'ADMIN';

  const [metrics, leadsRes, dealsRes, verifiedPaymentsRes, staffRes, auditLogsRes, financeSettingsRes] =
    await Promise.all([
      ExecutiveMetricsService.getStandardizedMetrics(),
      supabase
        .from('leads')
        .select('id, lead_source, lead_temperature, pipeline_stage, assigned_sales_id'),
      supabase
        .from('deals')
        .select('id, current_sales_id, final_deal_value, sales_outcome_status'),
      supabase
        .from('payment_records')
        .select('id, paid_amount, bookings!inner(current_sales_id)')
        .eq('verification_status', 'VERIFIED'),
      supabase
        .from('v_staff_directory')
        .select(
          'profile_id, full_name, system_role, is_active, active_team_id, active_team_code, membership_role'
        ),
      // SUPERVISOR tidak pernah menerima query maupun payload audit_logs
      isAdmin
        ? supabase
            .from('audit_logs')
            .select(
              'id, actor_user_id, actor_role, action_type, entity_table, entity_id, old_values, new_values, reason, created_at'
            )
            .order('created_at', { ascending: false })
            .limit(100)
        : Promise.resolve({ data: null, error: null }),
      isAdmin ? supabase.from('finance_settings').select('sales_base_salary, supervisor_base_salary').eq('id', true).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);

  if (leadsRes.error) throw translateDatabaseOrRpcError(leadsRes.error);
  if (dealsRes.error) throw translateDatabaseOrRpcError(dealsRes.error);
  if (verifiedPaymentsRes.error)
    throw translateDatabaseOrRpcError(verifiedPaymentsRes.error);
  if (staffRes.error) throw translateDatabaseOrRpcError(staffRes.error);
  if (auditLogsRes.error) throw translateDatabaseOrRpcError(auditLogsRes.error);

  const leads = leadsRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const verifiedPayments = verifiedPaymentsRes.data ?? [];
  const staffDirectory = staffRes.data ?? [];
  const financeSettings = financeSettingsRes.data;
  const salaryEstimate = isAdmin && financeSettings
    ? staffDirectory.filter((s) => s.is_active).reduce((total, s) => total + (s.system_role === 'SALES' ? Number(financeSettings.sales_base_salary) : s.system_role === 'SUPERVISOR' ? Number(financeSettings.supervisor_base_salary) : 0), 0)
    : null;

  const staffNameMap = new Map(
    staffDirectory.map((s) => [s.profile_id, s.full_name])
  );

  // 1. Agregasi Konversi per Sumber Lead
  const sourceAccumulator = new Map<
    string,
    { totalLeads: number; hotLeads: number; closedWonLeads: number }
  >();
  for (const lead of leads) {
    const key = lead.lead_source ?? 'OTHER';
    const current = sourceAccumulator.get(key) ?? {
      totalLeads: 0,
      hotLeads: 0,
      closedWonLeads: 0,
    };
    current.totalLeads += 1;
    if (lead.lead_temperature === 'HOT') {
      current.hotLeads += 1;
    }
    if (lead.pipeline_stage === 'CLOSED_WON') {
      current.closedWonLeads += 1;
    }
    sourceAccumulator.set(key, current);
  }

  const leadSourceRows: LeadSourceConversionRow[] = Array.from(
    sourceAccumulator.entries()
  )
    .map(([leadSource, stats]) => ({
      leadSource,
      totalLeads: stats.totalLeads,
      hotLeads: stats.hotLeads,
      closedWonLeads: stats.closedWonLeads,
    }))
    .sort((a, b) => b.totalLeads - a.totalLeads);

  // 2. Agregasi Performa per Sales Aktif (dibatasi tim aktif untuk SUPERVISOR)
  const activeSalesMembers = staffDirectory.filter((s) => {
    if (!s.is_active) return false;
    const isSalesRole =
      s.membership_role === 'TEAM_SALES' || s.system_role === 'SALES';
    if (!isSalesRole) return false;
    if (!isAdmin && user.activeTeamId) {
      return s.active_team_id === user.activeTeamId;
    }
    return true;
  });

  const cashBySalesId = new Map<string, number>();
  for (const pay of verifiedPayments) {
    const bookingRel = Array.isArray(pay.bookings)
      ? pay.bookings[0]
      : pay.bookings;
    const salesId = bookingRel?.current_sales_id;
    if (!salesId) continue;
    cashBySalesId.set(
      salesId,
      (cashBySalesId.get(salesId) ?? 0) + Number(pay.paid_amount)
    );
  }

  const salesPerformanceRows: SalesPerformanceRow[] = activeSalesMembers
    .map((sales) => {
      const salesLeads = leads.filter(
        (l) => l.assigned_sales_id === sales.profile_id
      );
      const salesHotLeads = salesLeads.filter(
        (l) => l.lead_temperature === 'HOT'
      ).length;
      const salesWonDeals = deals.filter(
        (d) =>
          d.current_sales_id === sales.profile_id &&
          d.sales_outcome_status === 'CLOSED_WON'
      );
      const wonValue = salesWonDeals.reduce(
        (sum, d) => sum + Number(d.final_deal_value),
        0
      );

      return {
        salesId: sales.profile_id,
        fullName: sales.full_name,
        teamCode: sales.active_team_code ?? '-',
        totalLeads: salesLeads.length,
        hotLeads: salesHotLeads,
        closedWonDealsCount: salesWonDeals.length,
        closedWonDealsValue: wonValue,
        verifiedCashInflow: cashBySalesId.get(sales.profile_id) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        b.closedWonDealsValue - a.closedWonDealsValue ||
        b.totalLeads - a.totalLeads
    );

  // 3. Pemetaan Audit Logs (Hanya untuk ADMIN; SUPERVISOR selalu null)
  const auditLogs: AuditLogItemDto[] | null = isAdmin
    ? (auditLogsRes.data ?? []).map((row) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        actorName: row.actor_user_id
          ? (staffNameMap.get(row.actor_user_id) ?? 'Staf FIM')
          : 'Sistem Otomatis',
        actorRole: row.actor_role,
        actionType: row.action_type,
        entityTable: row.entity_table,
        entityId: row.entity_id,
        oldValues:
          row.old_values &&
          typeof row.old_values === 'object' &&
          !Array.isArray(row.old_values)
            ? (row.old_values as Record<string, unknown>)
            : null,
        newValues:
          row.new_values &&
          typeof row.new_values === 'object' &&
          !Array.isArray(row.new_values)
            ? (row.new_values as Record<string, unknown>)
            : null,
        reason: row.reason,
        createdAt: row.created_at,
      }))
    : null;

  return (
    <ReportsWorkspaceClient
      userRole={user.systemRole}
      teamName={user.activeTeamName}
      metrics={metrics}
      salaryEstimate={salaryEstimate}
      leadSourceRows={leadSourceRows}
      salesPerformanceRows={salesPerformanceRows}
      canViewAuditLogs={isAdmin}
      auditLogs={auditLogs}
    />
  );
}
