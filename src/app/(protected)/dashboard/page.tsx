// Lokasi: src/app/(protected)/dashboard/page.tsx
// Server Component Halaman Dashboard Role-Based (ADMIN, SUPERVISOR, SALES) dengan Data Riil Supabase Cloud

import React from 'react';
import dynamicImport from 'next/dynamic';
import { after } from 'next/server';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ExecutiveMetricsService } from '@/modules/analytics/metrics.service';
import { ReminderSweepOrchestrator } from '@/modules/notifications-engine/reminder-sweep.orchestrator';
import {
  getElapsedHoursSince,
  getRemainingHoursUntil,
} from '@/lib/utils/format';
import type {
  AdminPendingPaymentItem,
  AdminExpiringBookingItem,
  AdminPendingKprDocItem,
  AdminPendingRefundItem,
  AdminTeamSummaryItem,
} from '@/components/dashboard/AdminDashboardView';
import type {
  SupervisorSalesMemberWorkload,
  SupervisorTeamPaymentWaitItem,
  SupervisorTeamKprAlertItem,
  SupervisorTeamScheduleAlertItem,
  SupervisorPriceUpdateItem,
} from '@/components/dashboard/SupervisorDashboardView';
import type {
  SalesFollowUpTaskItem,
  SalesSiteVisitItem,
  SalesKprDocStatusItem,
  SalesPaymentStatusItem,
  SalesPendingBookingHoldItem,
  SalesPriceUpdateItem,
} from '@/components/dashboard/SalesDashboardView';

const AdminDashboardView = dynamicImport(
  () => import('@/components/dashboard/AdminDashboardView').then((mod) => mod.AdminDashboardView)
);
const SupervisorDashboardView = dynamicImport(
  () =>
    import('@/components/dashboard/SupervisorDashboardView').then(
      (mod) => mod.SupervisorDashboardView
    )
);
const SalesDashboardView = dynamicImport(
  () => import('@/components/dashboard/SalesDashboardView').then((mod) => mod.SalesDashboardView)
);

export const dynamic = 'force-dynamic';

interface DashboardPageProps {
  searchParams?: Promise<{ error?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [user, resolvedSearchParams] = await Promise.all([
    requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']),
    searchParams ? searchParams : Promise.resolve({} as { error?: string }),
  ]);

  after(() => {
    return ReminderSweepOrchestrator.triggerThrottledOnAccessSweepSafe();
  });

  const [metrics, supabase] = await Promise.all([
    ExecutiveMetricsService.getStandardizedMetrics(),
    createSupabaseServerClient(),
  ]);

  const forbiddenBanner =
    resolvedSearchParams.error === 'forbidden' ? (
      <div
        role="alert"
        className="mb-5 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs font-medium text-[#B91C1C]"
      >
        Akses ditolak: Anda tidak memiliki hak akses (Role {user.systemRole}) untuk membuka halaman administrasi tersebut.
      </div>
    ) : null;

  // ============================================================================
  // 1. ROLE: ADMIN (Seluruh Perusahaan)
  // ============================================================================
  if (user.systemRole === 'ADMIN') {
    const [
      teamsRes,
      profilesRes,
      leadsRes,
      unitsRes,
      bookingsRes,
      pendingPaymentsRes,
      pendingKprDocsRes,
      kprAppsRes,
      pendingRefundsRes,
      dealsRes,
      financeSettingsRes,
    ] = await Promise.all([
      supabase.from('teams').select('id, code, name, is_active').order('code'),
      supabase.from('profiles').select('id, full_name, email, system_role, is_active'),
      supabase
        .from('leads')
        .select('id, full_name, team_id, lead_temperature, pipeline_stage'),
      supabase.from('units').select('id, unit_code'),
      supabase
        .from('bookings')
        .select(
          'id, reference_number, lead_id, unit_id, current_sales_id, team_id, booking_fee_amount, status, expires_at'
        )
        .order('booked_at', { ascending: false }),
      supabase
        .from('payment_records')
        .select(
          'id, reference_number, booking_id, paid_amount, payment_channel, submitted_at, verification_status'
        )
        .eq('verification_status', 'PENDING_VERIFICATION')
        .order('submitted_at', { ascending: true }),
      supabase
        .from('kpr_documents')
        .select(
          'id, kpr_application_id, document_name, status, uploaded_at, verified_at, updated_at'
        )
        .in('status', ['UPLOADED', 'REVISION_REQUIRED'])
        .order('updated_at', { ascending: false }),
      supabase
        .from('kpr_applications')
        .select('id, reference_number, booking_id, bank_name, current_stage'),
      supabase
        .from('refund_transactions')
        .select(
          'id, reference_number, booking_id, refund_amount, refund_method, status, notes, created_at'
        )
        .eq('status', 'PENDING_REFUND')
        .order('created_at', { ascending: false }),
      supabase
        .from('deals')
        .select('id, team_id, sales_outcome_status, final_deal_value'),
      supabase.from('finance_settings').select('sales_base_salary, supervisor_base_salary').eq('id', true).maybeSingle(),
    ]);

    const profileMap = new Map(
      (profilesRes.data ?? []).map((p) => [p.id, p.full_name])
    );
    const leadMap = new Map(
      (leadsRes.data ?? []).map((l) => [l.id, l.full_name])
    );
    const unitMap = new Map(
      (unitsRes.data ?? []).map((u) => [u.id, u.unit_code])
    );
    const bookingMap = new Map((bookingsRes.data ?? []).map((b) => [b.id, b]));
    const kprAppMap = new Map((kprAppsRes.data ?? []).map((k) => [k.id, k]));

    const pendingPayments: AdminPendingPaymentItem[] = (
      pendingPaymentsRes.data ?? []
    ).map((pr) => {
      const bk = bookingMap.get(pr.booking_id);
      const hoursWaiting = getElapsedHoursSince(pr.submitted_at);

      return {
        id: pr.id,
        paymentNumber: pr.reference_number,
        paidAmount: Number(pr.paid_amount),
        channel: pr.payment_channel,
        submittedAt: pr.submitted_at,
        hoursWaiting,
        bookingNumber: bk?.reference_number ?? '-',
        leadName: bk ? (leadMap.get(bk.lead_id) ?? '-') : '-',
        unitCode: bk ? (unitMap.get(bk.unit_id) ?? '-') : '-',
      };
    });

    const expiringBookings: AdminExpiringBookingItem[] = (
      bookingsRes.data ?? []
    )
      .filter((b) => b.status === 'PENDING_FEE')
      .map((b) => {
        const hoursRemaining = getRemainingHoursUntil(b.expires_at);
        return {
          id: b.id,
          bookingNumber: b.reference_number,
          bookingFeeAmount: Number(b.booking_fee_amount),
          expiresAt: b.expires_at,
          hoursRemaining,
          leadName: leadMap.get(b.lead_id) ?? '-',
          unitCode: unitMap.get(b.unit_id) ?? '-',
          salesName: profileMap.get(b.current_sales_id) ?? '-',
        };
      });

    const pendingKprDocs: AdminPendingKprDocItem[] = (
      pendingKprDocsRes.data ?? []
    ).map((doc) => {
      const kpr = kprAppMap.get(doc.kpr_application_id);
      const bk = kpr ? bookingMap.get(kpr.booking_id) : undefined;
      return {
        id: doc.id,
        documentLabel: doc.document_name,
        status: doc.status,
        updatedAt: doc.uploaded_at ?? doc.updated_at,
        kprNumber: kpr?.reference_number ?? '-',
        bankPartnerName: kpr?.bank_name ?? '-',
        leadName: bk ? (leadMap.get(bk.lead_id) ?? '-') : '-',
        unitCode: bk ? (unitMap.get(bk.unit_id) ?? '-') : '-',
      };
    });

    const pendingRefunds: AdminPendingRefundItem[] = (
      pendingRefundsRes.data ?? []
    ).map((rf) => {
      const bk = bookingMap.get(rf.booking_id);
      const leadName = bk ? (leadMap.get(bk.lead_id) ?? '-') : '-';
      return {
        id: rf.id,
        refundNumber: rf.reference_number,
        refundAmount: Number(rf.refund_amount),
        bankName: rf.refund_method,
        bankAccountHolder: leadName,
        createdAt: rf.created_at,
        bookingNumber: bk?.reference_number ?? '-',
        leadName,
        unitCode: bk ? (unitMap.get(bk.unit_id) ?? '-') : '-',
      };
    });

    const allLeads = leadsRes.data ?? [];
    const allBookings = bookingsRes.data ?? [];
    const allDeals = dealsRes.data ?? [];
    const salaryEstimate = (profilesRes.data ?? []).filter((p) => p.is_active).reduce((sum, p) => sum + (p.system_role === 'SALES' ? Number(financeSettingsRes.data?.sales_base_salary ?? 2000000) : p.system_role === 'SUPERVISOR' ? Number(financeSettingsRes.data?.supervisor_base_salary ?? 5000000) : 0), 0);

    const teamSummaries: AdminTeamSummaryItem[] = (teamsRes.data ?? []).map(
      (team) => {
        const teamActiveLeads = allLeads.filter(
          (l) =>
            l.team_id === team.id &&
            l.pipeline_stage !== 'CLOSED_WON' &&
            l.pipeline_stage !== 'CLOSED_LOST'
        );
        const teamHotLeads = teamActiveLeads.filter(
          (l) => l.lead_temperature === 'HOT'
        );
        const teamActiveBookings = allBookings.filter(
          (b) =>
            b.team_id === team.id &&
            (b.status === 'PENDING_FEE' || b.status === 'ACTIVE')
        );
        const teamClosedWonDeals = allDeals.filter(
          (d) => d.team_id === team.id && d.sales_outcome_status === 'CLOSED_WON'
        );
        const closedWonValue = teamClosedWonDeals.reduce(
          (sum, d) => sum + Number(d.final_deal_value),
          0
        );

        return {
          teamId: team.id,
          teamCode: team.code,
          teamName: team.name,
          activeLeadsCount: teamActiveLeads.length,
          hotLeadsCount: teamHotLeads.length,
          activeBookingsCount: teamActiveBookings.length,
          closedWonCount: teamClosedWonDeals.length,
          closedWonValue,
        };
      }
    );

    return (
      <>
        {forbiddenBanner}
        <AdminDashboardView
          adminFullName={user.fullName}
          metrics={metrics}
          salaryEstimate={salaryEstimate}
          pendingPayments={pendingPayments}
          expiringBookings={expiringBookings}
          pendingKprDocs={pendingKprDocs}
          pendingRefunds={pendingRefunds}
          teamSummaries={teamSummaries}
        />
      </>
    );
  }

  // ============================================================================
  // 2. ROLE: SUPERVISOR (Cakupan Tim Aktif)
  // ============================================================================
  if (user.systemRole === 'SUPERVISOR') {
    const activeTeamId = user.activeTeamId;

    const [
      membershipsRes,
      profilesRes,
      staffDirRes,
      leadsRes,
      unitsRes,
      projectsRes,
      priceHistoriesRes,
      siteVisitsRes,
      bookingsRes,
      tasksRes,
      pendingPaymentsRes,
      kprAppsRes,
      kprDocsRes,
      schedulesRes,
    ] = await Promise.all([
      activeTeamId
        ? supabase
            .from('team_memberships')
            .select('profile_id, membership_role, is_active')
            .eq('team_id', activeTeamId)
            .eq('is_active', true)
        : Promise.resolve({ data: [] }),
      supabase.from('profiles').select('id, full_name, email, system_role'),
      supabase
        .from('v_staff_directory')
        .select('profile_id, full_name, system_role'),
      supabase
        .from('leads')
        .select(
          'id, full_name, assigned_sales_id, lead_temperature, pipeline_stage'
        ),
      supabase.from('units').select('id, unit_code, project_id'),
      supabase.from('property_projects').select('id, code, name'),
      supabase
        .from('unit_price_histories')
        .select('id, unit_id, old_price, new_price, reason, changed_by, changed_at')
        .order('changed_at', { ascending: false })
        .limit(5),
      supabase
        .from('site_visits')
        .select('id, sales_id, status'),
      supabase
        .from('bookings')
        .select(
          'id, reference_number, lead_id, unit_id, current_sales_id, status'
        ),
      supabase
        .from('follow_up_tasks')
        .select('id, assigned_sales_id, status'),
      supabase
        .from('payment_records')
        .select(
          'id, reference_number, booking_id, submitted_by_sales_id, paid_amount, submitted_at, verification_status'
        )
        .eq('verification_status', 'PENDING_VERIFICATION')
        .order('submitted_at', { ascending: true }),
      supabase
        .from('kpr_applications')
        .select(
          'id, reference_number, booking_id, current_sales_id, bank_name, current_stage, application_status'
        ),
      supabase
        .from('kpr_documents')
        .select('id, kpr_application_id, document_name, status'),
      supabase
        .from('payment_schedules')
        .select(
          'id, booking_id, title, schedule_type, due_date, remaining_amount, status'
        )
        .in('status', ['OVERDUE', 'PARTIALLY_PAID']),
    ]);

    const profileMap = new Map(
      (profilesRes.data ?? []).map((p) => [p.id, p])
    );
    for (const sd of staffDirRes.data ?? []) {
      if (!profileMap.has(sd.profile_id)) {
        profileMap.set(sd.profile_id, {
          id: sd.profile_id,
          full_name: sd.full_name,
          email: '-',
          system_role: sd.system_role,
        });
      }
    }
    const leadMap = new Map((leadsRes.data ?? []).map((l) => [l.id, l]));
    const unitObjMap = new Map(
      (unitsRes.data ?? []).map((u) => [u.id, u])
    );
    const unitMap = new Map(
      (unitsRes.data ?? []).map((u) => [u.id, u.unit_code])
    );
    const projectObjMap = new Map(
      (projectsRes.data ?? []).map((p) => [p.id, p])
    );
    const bookingMap = new Map((bookingsRes.data ?? []).map((b) => [b.id, b]));

    const teamLeads = leadsRes.data ?? [];
    const teamVisits = siteVisitsRes.data ?? [];
    const teamBookings = bookingsRes.data ?? [];
    const teamTasks = tasksRes.data ?? [];

    const activeTeamBookingsCount = teamBookings.filter(
      (b) => b.status === 'PENDING_FEE' || b.status === 'ACTIVE'
    ).length;
    const teamOverdueTasksCount = teamTasks.filter(
      (t) => t.status === 'OVERDUE'
    ).length;

    const salesMemberships = (membershipsRes.data ?? []).filter(
      (m) => m.membership_role === 'TEAM_SALES'
    );

    const memberWorkloads: SupervisorSalesMemberWorkload[] = salesMemberships
      .map((m) => {
        const prof = profileMap.get(m.profile_id);
        const memberActiveLeads = teamLeads.filter(
          (l) =>
            l.assigned_sales_id === m.profile_id &&
            l.pipeline_stage !== 'CLOSED_WON' &&
            l.pipeline_stage !== 'CLOSED_LOST'
        );
        const hotCount = memberActiveLeads.filter(
          (l) => l.lead_temperature === 'HOT'
        ).length;
        const warmCount = memberActiveLeads.filter(
          (l) => l.lead_temperature === 'WARM'
        ).length;
        const memberVisits = teamVisits.filter(
          (v) => v.sales_id === m.profile_id
        );
        const scheduledVisits = memberVisits.filter(
          (v) => v.status === 'SCHEDULED' || v.status === 'RESCHEDULED'
        ).length;
        const completedVisits = memberVisits.filter(
          (v) => v.status === 'COMPLETED'
        ).length;
        const memberActiveBookings = teamBookings.filter(
          (b) =>
            b.current_sales_id === m.profile_id &&
            (b.status === 'PENDING_FEE' || b.status === 'ACTIVE')
        ).length;
        const memberOverdueTasks = teamTasks.filter(
          (t) =>
            t.assigned_sales_id === m.profile_id && t.status === 'OVERDUE'
        ).length;

        return {
          salesId: m.profile_id,
          fullName: prof?.full_name ?? 'Anggota Sales',
          email: prof?.email ?? '-',
          activeLeadsCount: memberActiveLeads.length,
          hotLeadsCount: hotCount,
          warmLeadsCount: warmCount,
          scheduledSiteVisitsCount: scheduledVisits,
          completedSiteVisitsCount: completedVisits,
          activeBookingsCount: memberActiveBookings,
          overdueTasksCount: memberOverdueTasks,
        };
      })
      .sort((a, b) => b.activeLeadsCount - a.activeLeadsCount);

    const waitingTeamPayments: SupervisorTeamPaymentWaitItem[] = (
      pendingPaymentsRes.data ?? []
    ).map((pr) => {
      const bk = bookingMap.get(pr.booking_id);
      const lead = bk ? leadMap.get(bk.lead_id) : undefined;
      const salesProf = profileMap.get(pr.submitted_by_sales_id);
      const hoursWaiting = getElapsedHoursSince(pr.submitted_at);

      return {
        id: pr.id,
        paymentNumber: pr.reference_number,
        paidAmount: Number(pr.paid_amount),
        submittedAt: pr.submitted_at,
        hoursWaiting,
        bookingNumber: bk?.reference_number ?? '-',
        leadName: lead?.full_name ?? '-',
        unitCode: bk ? (unitMap.get(bk.unit_id) ?? '-') : '-',
        salesName: salesProf?.full_name ?? '-',
      };
    });

    const docsByKpr = new Map<
      string,
      Array<{ document_name: string; status: string }>
    >();
    for (const d of kprDocsRes.data ?? []) {
      const arr = docsByKpr.get(d.kpr_application_id) ?? [];
      arr.push(d);
      docsByKpr.set(d.kpr_application_id, arr);
    }

    const teamKprAlerts: SupervisorTeamKprAlertItem[] = [];
    for (const kpr of kprAppsRes.data ?? []) {
      if (kpr.application_status !== 'IN_PROGRESS') continue;
      const docs = docsByKpr.get(kpr.id) ?? [];
      const revCount = docs.filter(
        (d) => d.status === 'REVISION_REQUIRED'
      ).length;
      const missCount = docs.filter((d) => d.status === 'MISSING').length;

      if (revCount > 0 || missCount > 0) {
        const bk = bookingMap.get(kpr.booking_id);
        const lead = bk ? leadMap.get(bk.lead_id) : undefined;
        const salesProf = profileMap.get(kpr.current_sales_id);
        teamKprAlerts.push({
          id: kpr.id,
          kprNumber: kpr.reference_number,
          bankPartnerName: kpr.bank_name,
          currentStage: kpr.current_stage,
          leadName: lead?.full_name ?? '-',
          unitCode: bk ? (unitMap.get(bk.unit_id) ?? '-') : '-',
          salesName: salesProf?.full_name ?? '-',
          issueSummary: `${revCount} dokumen butuh revisi (REVISION_REQUIRED), ${missCount} dokumen belum diunggah.`,
        });
      }
    }

    const teamScheduleAlerts: SupervisorTeamScheduleAlertItem[] = (
      schedulesRes.data ?? []
    ).map((sc) => {
      const bk = bookingMap.get(sc.booking_id);
      const lead = bk ? leadMap.get(bk.lead_id) : undefined;
      const salesProf = bk ? profileMap.get(bk.current_sales_id) : undefined;
      return {
        id: sc.id,
        title: sc.title,
        scheduleType: sc.schedule_type,
        dueDate: sc.due_date,
        remainingAmount: Number(sc.remaining_amount),
        status: sc.status,
        bookingNumber: bk?.reference_number ?? '-',
        leadName: lead?.full_name ?? '-',
        salesName: salesProf?.full_name ?? '-',
      };
    });

    const recentPriceUpdates: SupervisorPriceUpdateItem[] = (
      priceHistoriesRes.data ?? []
    ).map((ph) => {
      const unitObj = unitObjMap.get(ph.unit_id);
      const projObj = unitObj ? projectObjMap.get(unitObj.project_id) : undefined;
      const changer = profileMap.get(ph.changed_by);
      const oldPrice = Number(ph.old_price);
      const newPrice = Number(ph.new_price);
      return {
        id: ph.id,
        unitId: ph.unit_id,
        unitCode: unitObj?.unit_code ?? '-',
        projectId: unitObj?.project_id ?? '',
        projectCode: projObj?.code ?? '-',
        projectName: projObj?.name ?? 'Proyek Properti',
        oldPrice,
        newPrice,
        deltaAmount: newPrice - oldPrice,
        reason: ph.reason,
        changedByName: changer?.full_name ?? 'Admin FIM-Property',
        changedAt: ph.changed_at,
      };
    });

    return (
      <>
        {forbiddenBanner}
        <SupervisorDashboardView
          supervisorName={user.fullName}
          teamName={user.activeTeamName ?? 'Tim Penjualan'}
          teamCode={user.activeTeamCode ?? 'TIM'}
          metrics={metrics}
          activeTeamBookingsCount={activeTeamBookingsCount}
          teamOverdueTasksCount={teamOverdueTasksCount}
          memberWorkloads={memberWorkloads}
          waitingTeamPayments={waitingTeamPayments}
          teamKprAlerts={teamKprAlerts}
          teamScheduleAlerts={teamScheduleAlerts}
          recentPriceUpdates={recentPriceUpdates}
        />
      </>
    );
  }

  // ============================================================================
  // 3. ROLE: SALES (Cakupan Pribadi)
  // ============================================================================
  const [
    leadsRes,
    projectsRes,
    unitsRes,
    priceHistoriesRes,
    staffDirRes,
    tasksRes,
    siteVisitsRes,
    bookingsRes,
    schedulesRes,
    kprAppsRes,
    kprDocsRes,
    paymentsRes,
  ] = await Promise.all([
    supabase
      .from('leads')
      .select(
        'id, full_name, phone, lead_temperature, pipeline_stage, budget_amount, preferred_project_id'
      )
      .eq('assigned_sales_id', user.userId),
    supabase.from('property_projects').select('id, code, name'),
    supabase.from('units').select('id, unit_code, project_id'),
    supabase
      .from('unit_price_histories')
      .select('id, unit_id, old_price, new_price, reason, changed_by, changed_at')
      .order('changed_at', { ascending: false })
      .limit(5),
    supabase.from('v_staff_directory').select('profile_id, full_name'),
    supabase
      .from('follow_up_tasks')
      .select(
        'id, lead_id, related_schedule_id, related_kpr_application_id, title, description, due_at, priority, source_type, status'
      )
      .eq('assigned_sales_id', user.userId)
      .in('status', ['OVERDUE', 'PENDING'])
      .order('due_at', { ascending: true }),
    supabase
      .from('site_visits')
      .select(
        'id, lead_id, project_id, unit_id, scheduled_at, status, preparation_notes'
      )
      .eq('sales_id', user.userId)
      .order('scheduled_at', { ascending: true })
      .limit(8),
    supabase
      .from('bookings')
      .select(
        'id, reference_number, lead_id, unit_id, booking_fee_amount, status, expires_at'
      )
      .eq('current_sales_id', user.userId),
    supabase.from('payment_schedules').select('id, title'),
    supabase
      .from('kpr_applications')
      .select(
        'id, reference_number, booking_id, bank_name, current_stage, application_status'
      )
      .eq('current_sales_id', user.userId),
    supabase
      .from('kpr_documents')
      .select('id, kpr_application_id, status'),
    supabase
      .from('payment_records')
      .select(
        'id, reference_number, booking_id, paid_amount, verification_status, verification_notes, submitted_at'
      )
      .eq('submitted_by_sales_id', user.userId)
      .order('submitted_at', { ascending: false }),
  ]);

  const leadMap = new Map((leadsRes.data ?? []).map((l) => [l.id, l]));
  const projectMap = new Map(
    (projectsRes.data ?? []).map((p) => [p.id, p.name])
  );
  const projectObjMap = new Map(
    (projectsRes.data ?? []).map((p) => [p.id, p])
  );
  const unitMap = new Map(
    (unitsRes.data ?? []).map((u) => [u.id, u.unit_code])
  );
  const unitObjMap = new Map(
    (unitsRes.data ?? []).map((u) => [u.id, u])
  );
  const staffNameMap = new Map(
    (staffDirRes.data ?? []).map((s) => [s.profile_id, s.full_name])
  );
  const bookingMap = new Map((bookingsRes.data ?? []).map((b) => [b.id, b]));
  const scheduleTitleMap = new Map(
    (schedulesRes.data ?? []).map((s) => [s.id, s.title])
  );
  const kprNumberMap = new Map(
    (kprAppsRes.data ?? []).map((k) => [k.id, k.reference_number])
  );

  const myBookings = bookingsRes.data ?? [];
  const activeBookingsCount = myBookings.filter(
    (b) => b.status === 'PENDING_FEE' || b.status === 'ACTIVE'
  ).length;

  const followUpTasks: SalesFollowUpTaskItem[] = (tasksRes.data ?? []).map(
    (t) => {
      const lead = leadMap.get(t.lead_id);
      return {
        id: t.id,
        leadId: t.lead_id,
        leadName: lead?.full_name ?? 'Prospek Nasabah',
        leadTemperature: lead?.lead_temperature ?? 'WARM',
        title: t.title,
        description: t.description,
        dueAt: t.due_at,
        priority: t.priority,
        status: t.status,
        taskSource: t.source_type,
        relatedScheduleTitle: t.related_schedule_id
          ? (scheduleTitleMap.get(t.related_schedule_id) ?? null)
          : null,
        relatedKprNumber: t.related_kpr_application_id
          ? (kprNumberMap.get(t.related_kpr_application_id) ?? null)
          : null,
      };
    }
  );

  const siteVisits: SalesSiteVisitItem[] = (siteVisitsRes.data ?? []).map(
    (v) => {
      const lead = leadMap.get(v.lead_id);
      return {
        id: v.id,
        leadId: v.lead_id,
        leadName: lead?.full_name ?? 'Prospek Nasabah',
        projectName: projectMap.get(v.project_id) ?? 'Proyek FIM-Property',
        unitCode: v.unit_id ? (unitMap.get(v.unit_id) ?? null) : null,
        scheduledAt: v.scheduled_at,
        status: v.status,
        preparationNotes: v.preparation_notes,
      };
    }
  );

  const docsByKpr = new Map<string, Array<{ status: string }>>();
  for (const doc of kprDocsRes.data ?? []) {
    const arr = docsByKpr.get(doc.kpr_application_id) ?? [];
    arr.push(doc);
    docsByKpr.set(doc.kpr_application_id, arr);
  }

  const kprStatusItems: SalesKprDocStatusItem[] = (kprAppsRes.data ?? []).map(
    (kpr) => {
      const bk = bookingMap.get(kpr.booking_id);
      const lead = bk ? leadMap.get(bk.lead_id) : undefined;
      const docs = docsByKpr.get(kpr.id) ?? [];
      return {
        id: kpr.id,
        kprNumber: kpr.reference_number,
        bankPartnerName: kpr.bank_name,
        currentStage: kpr.current_stage,
        leadName: lead?.full_name ?? '-',
        unitCode: bk ? (unitMap.get(bk.unit_id) ?? '-') : '-',
        revisionDocsCount: docs.filter((d) => d.status === 'REVISION_REQUIRED')
          .length,
        missingDocsCount: docs.filter((d) => d.status === 'MISSING').length,
        uploadedDocsCount: docs.filter((d) => d.status === 'UPLOADED').length,
      };
    }
  );

  const statusPriorityRank = (status: string): number => {
    if (status === 'REJECTED') return 0;
    if (status === 'PENDING_VERIFICATION') return 1;
    return 2;
  };

  const paymentStatusItems: SalesPaymentStatusItem[] = (paymentsRes.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        statusPriorityRank(a.verification_status) -
        statusPriorityRank(b.verification_status)
    )
    .slice(0, 6)
    .map((pr) => {
      const bk = bookingMap.get(pr.booking_id);
      const lead = bk ? leadMap.get(bk.lead_id) : undefined;
      return {
        id: pr.id,
        paymentNumber: pr.reference_number,
        paidAmount: Number(pr.paid_amount),
        verificationStatus: pr.verification_status,
        rejectionReason: pr.verification_notes,
        submittedAt: pr.submitted_at,
        bookingNumber: bk?.reference_number ?? '-',
        leadName: lead?.full_name ?? '-',
        unitCode: bk ? (unitMap.get(bk.unit_id) ?? '-') : '-',
      };
    });

  const pendingHoldBookings: SalesPendingBookingHoldItem[] = myBookings
    .filter((b) => b.status === 'PENDING_FEE')
    .map((b) => {
      const lead = leadMap.get(b.lead_id);
      const hoursRemaining = getRemainingHoursUntil(b.expires_at);
      return {
        id: b.id,
        bookingNumber: b.reference_number,
        bookingFeeAmount: Number(b.booking_fee_amount),
        expiresAt: b.expires_at,
        hoursRemaining,
        leadName: lead?.full_name ?? '-',
        unitCode: unitMap.get(b.unit_id) ?? '-',
      };
    });

  const activeMyLeads = (leadsRes.data ?? []).filter(
    (l) =>
      l.pipeline_stage !== 'CLOSED_WON' && l.pipeline_stage !== 'CLOSED_LOST'
  );

  const recentPriceUpdates: SalesPriceUpdateItem[] = (
    priceHistoriesRes.data ?? []
  ).map((ph) => {
    const unitObj = unitObjMap.get(ph.unit_id);
    const projObj = unitObj ? projectObjMap.get(unitObj.project_id) : undefined;
    const oldPrice = Number(ph.old_price);
    const newPrice = Number(ph.new_price);
    const impactedLeads = unitObj
      ? activeMyLeads
          .filter((l) => l.preferred_project_id === unitObj.project_id)
          .map((l) => ({
            id: l.id,
            fullName: l.full_name,
            phone: l.phone,
            leadTemperature: l.lead_temperature,
            pipelineStage: l.pipeline_stage,
            budgetAmount: Number(l.budget_amount),
          }))
      : [];

    return {
      id: ph.id,
      unitId: ph.unit_id,
      unitCode: unitObj?.unit_code ?? '-',
      projectId: unitObj?.project_id ?? '',
      projectCode: projObj?.code ?? '-',
      projectName: projObj?.name ?? 'Proyek Properti',
      oldPrice,
      newPrice,
      deltaAmount: newPrice - oldPrice,
      reason: ph.reason,
      changedByName: staffNameMap.get(ph.changed_by) ?? 'Admin FIM-Property',
      changedAt: ph.changed_at,
      impactedLeads,
    };
  });

  return (
    <>
      {forbiddenBanner}
      <SalesDashboardView
        salesFullName={user.fullName}
        teamName={user.activeTeamName ?? 'Tim Penjualan'}
        teamCode={user.activeTeamCode ?? 'TIM'}
        metrics={metrics}
        activeBookingsCount={activeBookingsCount}
        followUpTasks={followUpTasks}
        siteVisits={siteVisits}
        kprStatusItems={kprStatusItems}
        paymentStatusItems={paymentStatusItems}
        pendingHoldBookings={pendingHoldBookings}
        recentPriceUpdates={recentPriceUpdates}
      />
    </>
  );
}
