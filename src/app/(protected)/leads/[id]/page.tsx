// Lokasi: src/app/(protected)/leads/[id]/page.tsx
// Server Component Halaman Detail Lead (/leads/[id] — ADMIN, SUPERVISOR, SALES)

import React from 'react';
import { notFound } from 'next/navigation';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CatalogService } from '@/modules/catalog/catalog.service';
import type { ScoreBreakdown } from '@/modules/shared/scoring-calculator/prospect-scoring.calculator';
import type {
  ActivityChannel,
  BookingStatus,
  InteractionResponse,
  KprApplicationStatus,
  KprStage,
  LeadSource,
  LeadTemperature,
  PaymentMethod,
  PaymentReadiness,
  PipelineStage,
  PromoType,
  PurchaseTimeline,
  ScheduleStatus,
  ScheduleType,
  SiteVisitOutcome,
  SiteVisitStatus,
  TaskPriority,
  TaskSource,
  TaskStatus,
} from '@/types/database.types';
import {
  LeadDetailClient,
  type ActivePromoOptionDto,
  type AvailableUnitOptionDto,
  type FollowUpTaskDto,
  type LeadActivityDto,
  type LeadAssignmentHistoryDto,
  type LeadBookingSummaryDto,
  type LeadDetailDto,
  type LeadDetailProjectOption,
  type LeadDetailPropertyTypeOption,
  type LeadKprSummaryDto,
  type LeadPipelineHistoryDto,
  type LeadScheduleOptionDto,
  type LeadScoreHistoryDto,
  type LeadSiteVisitDto,
  type ReassignSalesOptionDto,
} from '@/components/leads/LeadDetailClient';

export const dynamic = 'force-dynamic';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const { id } = await params;

  if (!id || !UUID_REGEX.test(id)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();

  // 1. Ambil baris Lead utama (RLS akan menolak jika tidak memiliki akses)
  const { data: leadRow, error: leadErr } = await supabase
    .from('leads')
    .select(
      'id, full_name, email, phone, occupation, preferred_city, preferred_project_id, preferred_property_type_id, preferred_payment_method, budget_amount, purchase_timeline, payment_readiness, lead_source, lead_temperature, pipeline_stage, prospect_score, score_breakdown, assigned_sales_id, team_id, lost_reason, last_interaction_at, created_at, updated_at'
    )
    .eq('id', id)
    .maybeSingle();

  if (leadErr || !leadRow) {
    notFound();
  }

  // 2. Ambil seluruh data pendukung secara paralel
  const [
    activitiesRes,
    tasksRes,
    visitsRes,
    scoreHistRes,
    pipeHistRes,
    assignHistRes,
    bookingsRes,
    projectsRes,
    propertyTypesRes,
    teamsRes,
    staffDirRes,
    promosRes,
    availableCatalogUnits,
  ] = await Promise.all([
    supabase
      .from('lead_activities')
      .select('id, sales_id, channel, interaction_at, summary, customer_response')
      .eq('lead_id', id)
      .order('interaction_at', { ascending: false }),
    supabase
      .from('follow_up_tasks')
      .select(
        'id, assigned_sales_id, related_schedule_id, related_kpr_application_id, title, description, due_at, priority, source_type, status, completion_notes, completed_at'
      )
      .eq('lead_id', id)
      .order('due_at', { ascending: true }),
    supabase
      .from('site_visits')
      .select(
        'id, project_id, unit_id, sales_id, scheduled_at, preparation_notes, status, customer_interest_outcome, evaluation_notes, completed_at'
      )
      .eq('lead_id', id)
      .order('scheduled_at', { ascending: false }),
    supabase
      .from('lead_score_histories')
      .select(
        'id, old_score, new_score, old_temperature, new_temperature, trigger_source, calculated_at'
      )
      .eq('lead_id', id)
      .order('calculated_at', { ascending: false }),
    supabase
      .from('lead_pipeline_histories')
      .select('id, from_stage, to_stage, notes, lost_reason, changed_by, changed_at')
      .eq('lead_id', id)
      .order('changed_at', { ascending: false }),
    supabase
      .from('lead_assignment_histories')
      .select(
        'id, from_sales_id, to_sales_id, from_team_id, to_team_id, reason, assigned_by, assigned_at'
      )
      .eq('lead_id', id)
      .order('assigned_at', { ascending: false }),
    supabase
      .from('bookings')
      .select(
        'id, reference_number, unit_id, payment_method, agreed_final_price, booking_fee_amount, agreed_dp_total_amount, status, booked_at, expires_at'
      )
      .eq('lead_id', id)
      .order('booked_at', { ascending: false }),
    supabase
      .from('property_projects')
      .select('id, code, name, city, status, developers!inner(is_active)')
      .order('code', { ascending: true }),
    supabase
      .from('property_types')
      .select('id, project_id, code, name')
      .eq('is_active', true)
      .order('code', { ascending: true }),
    supabase
      .from('teams')
      .select('id, code, name, is_active')
      .order('code', { ascending: true }),
    supabase
      .from('v_staff_directory')
      .select(
        'profile_id, full_name, system_role, is_active, active_team_id, active_team_code, active_team_name'
      ),
    supabase
      .from('promotions')
      .select(
        'id, project_id, property_type_id, code, name, promo_type, discount_value, bonus_description, start_date, end_date'
      )
      .eq('is_active', true)
      .order('code', { ascending: true }),
    CatalogService.listUnitCatalog({ status: 'AVAILABLE' }),
  ]);

  const bookingRows = bookingsRes.data ?? [];
  const bookingIds = bookingRows.map((b) => b.id);
  const bookedUnitIds = Array.from(new Set(bookingRows.map((b) => b.unit_id)));
  const visitUnitIds = Array.from(
    new Set((visitsRes.data ?? []).map((v) => v.unit_id).filter(Boolean) as string[])
  );
  const allRelevantUnitIds = Array.from(new Set([...bookedUnitIds, ...visitUnitIds]));

  const [schedulesRes, kprsRes, relevantUnitsRes] = await Promise.all([
    bookingIds.length > 0
      ? supabase
          .from('payment_schedules')
          .select(
            'id, booking_id, schedule_type, installment_number, title, scheduled_amount, due_date, status'
          )
          .in('booking_id', bookingIds)
          .neq('status', 'CANCELLED')
          .order('due_date', { ascending: true })
      : Promise.resolve({ data: [] as never[], error: null }),
    bookingIds.length > 0
      ? supabase
          .from('kpr_applications')
          .select(
            'id, reference_number, booking_id, bank_name, requested_loan_amount, approved_loan_amount, current_stage, application_status'
          )
          .in('booking_id', bookingIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as never[], error: null }),
    allRelevantUnitIds.length > 0
      ? supabase
          .from('units')
          .select('id, unit_code, project_id')
          .in('id', allRelevantUnitIds)
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);

  // Lookup Maps
  const projectMap = new Map((projectsRes.data ?? []).map((p) => [p.id, p]));
  const propertyTypeMap = new Map(
    (propertyTypesRes.data ?? []).map((pt) => [pt.id, pt])
  );
  const teamMap = new Map((teamsRes.data ?? []).map((t) => [t.id, t]));
  const staffMap = new Map(
    (staffDirRes.data ?? []).map((s) => [s.profile_id, s])
  );
  const unitMap = new Map(
    (relevantUnitsRes.data ?? []).map((u) => [u.id, u])
  );
  const bookingRefMap = new Map(bookingRows.map((b) => [b.id, b.reference_number]));
  const scheduleMap = new Map(
    (schedulesRes.data ?? []).map((s) => [s.id, s])
  );
  const kprMap = new Map((kprsRes.data ?? []).map((k) => [k.id, k]));

  // Susun DTO Utama Lead
  const assignedStaff = staffMap.get(leadRow.assigned_sales_id);
  const assignedTeam = teamMap.get(leadRow.team_id);
  const prefProject = leadRow.preferred_project_id
    ? projectMap.get(leadRow.preferred_project_id)
    : undefined;
  const prefPropType = leadRow.preferred_property_type_id
    ? propertyTypeMap.get(leadRow.preferred_property_type_id)
    : undefined;

  const lead: LeadDetailDto = {
    id: leadRow.id,
    fullName: leadRow.full_name,
    phone: leadRow.phone,
    email: leadRow.email,
    occupation: leadRow.occupation,
    leadSource: leadRow.lead_source as LeadSource,
    assignedSalesId: leadRow.assigned_sales_id,
    assignedSalesName: assignedStaff?.full_name ?? 'Sales FIM',
    teamId: leadRow.team_id,
    teamCode: assignedTeam?.code ?? assignedStaff?.active_team_code ?? '-',
    teamName: assignedTeam?.name ?? assignedStaff?.active_team_name ?? '-',
    budgetAmount: Number(leadRow.budget_amount),
    preferredCity: leadRow.preferred_city,
    preferredProjectId: leadRow.preferred_project_id,
    preferredProjectName: prefProject?.name ?? null,
    preferredPropertyTypeId: leadRow.preferred_property_type_id,
    preferredPropertyTypeName: prefPropType?.name ?? null,
    preferredPaymentMethod: leadRow.preferred_payment_method as PaymentMethod | null,
    purchaseTimeline: leadRow.purchase_timeline as PurchaseTimeline,
    paymentReadiness: leadRow.payment_readiness as PaymentReadiness,
    prospectScore: Number(leadRow.prospect_score),
    leadTemperature: leadRow.lead_temperature as LeadTemperature,
    scoreBreakdown: (leadRow.score_breakdown ?? {}) as Partial<ScoreBreakdown>,
    pipelineStage: leadRow.pipeline_stage as PipelineStage,
    lostReason: leadRow.lost_reason,
    lastInteractionAt: leadRow.last_interaction_at,
    createdAt: leadRow.created_at,
    updatedAt: leadRow.updated_at,
  };

  const activities: LeadActivityDto[] = (activitiesRes.data ?? []).map((a) => ({
    id: a.id,
    salesId: a.sales_id,
    salesName: staffMap.get(a.sales_id)?.full_name ?? 'Staf FIM',
    channel: a.channel as ActivityChannel,
    interactionAt: a.interaction_at,
    summary: a.summary,
    customerResponse: a.customer_response as InteractionResponse,
  }));

  const tasks: FollowUpTaskDto[] = (tasksRes.data ?? []).map((t) => {
    const sched = t.related_schedule_id
      ? scheduleMap.get(t.related_schedule_id)
      : undefined;
    const kpr = t.related_kpr_application_id
      ? kprMap.get(t.related_kpr_application_id)
      : undefined;
    return {
      id: t.id,
      assignedSalesId: t.assigned_sales_id,
      assignedSalesName: staffMap.get(t.assigned_sales_id)?.full_name ?? 'Sales FIM',
      relatedScheduleId: t.related_schedule_id,
      relatedScheduleLabel: sched
        ? `Tagihan: ${sched.title} (${bookingRefMap.get(sched.booking_id) ?? ''})`
        : null,
      relatedKprApplicationId: t.related_kpr_application_id,
      relatedKprLabel: kpr ? `KPR: ${kpr.reference_number} (${kpr.bank_name})` : null,
      title: t.title,
      description: t.description,
      dueAt: t.due_at,
      priority: t.priority as TaskPriority,
      sourceType: t.source_type as TaskSource,
      status: t.status as TaskStatus,
      completionNotes: t.completion_notes,
      completedAt: t.completed_at,
    };
  });

  const siteVisits: LeadSiteVisitDto[] = (visitsRes.data ?? []).map((v) => ({
    id: v.id,
    projectId: v.project_id,
    projectName: projectMap.get(v.project_id)?.name ?? 'Proyek FIM',
    unitId: v.unit_id,
    unitCode: v.unit_id ? (unitMap.get(v.unit_id)?.unit_code ?? null) : null,
    salesName: staffMap.get(v.sales_id)?.full_name ?? 'Sales FIM',
    scheduledAt: v.scheduled_at,
    preparationNotes: v.preparation_notes,
    status: v.status as SiteVisitStatus,
    outcome: v.customer_interest_outcome as SiteVisitOutcome | null,
    evaluationNotes: v.evaluation_notes,
    completedAt: v.completed_at,
  }));

  const scoreHistories: LeadScoreHistoryDto[] = (scoreHistRes.data ?? []).map(
    (h) => ({
      id: h.id,
      oldScore: Number(h.old_score),
      newScore: Number(h.new_score),
      oldTemperature: h.old_temperature as LeadTemperature,
      newTemperature: h.new_temperature as LeadTemperature,
      triggerSource: h.trigger_source,
      calculatedAt: h.calculated_at,
    })
  );

  const pipelineHistories: LeadPipelineHistoryDto[] = (pipeHistRes.data ?? []).map(
    (h) => ({
      id: h.id,
      fromStage: h.from_stage as PipelineStage | null,
      toStage: h.to_stage as PipelineStage,
      notes: h.notes,
      lostReason: h.lost_reason,
      changedByName: h.changed_by
        ? (staffMap.get(h.changed_by)?.full_name ?? 'Sistem')
        : 'Sistem Otomatis',
      changedAt: h.changed_at,
    })
  );

  const assignmentHistories: LeadAssignmentHistoryDto[] = (
    assignHistRes.data ?? []
  ).map((h) => ({
    id: h.id,
    fromSalesName: h.from_sales_id
      ? (staffMap.get(h.from_sales_id)?.full_name ?? 'Sales Sebelumnya')
      : null,
    toSalesName: staffMap.get(h.to_sales_id)?.full_name ?? 'Sales Tujuan',
    fromTeamCode: h.from_team_id
      ? (teamMap.get(h.from_team_id)?.code ?? null)
      : null,
    toTeamCode: teamMap.get(h.to_team_id)?.code ?? '-',
    reason: h.reason,
    assignedByName: staffMap.get(h.assigned_by)?.full_name ?? 'Admin/Supervisor',
    assignedAt: h.assigned_at,
  }));

  const bookings: LeadBookingSummaryDto[] = bookingRows.map((b) => {
    const unit = unitMap.get(b.unit_id);
    const proj = unit ? projectMap.get(unit.project_id) : undefined;
    return {
      id: b.id,
      referenceNumber: b.reference_number,
      unitId: b.unit_id,
      unitCode: unit?.unit_code ?? '-',
      projectName: proj?.name ?? 'Proyek FIM',
      paymentMethod: b.payment_method as PaymentMethod,
      agreedFinalPrice: Number(b.agreed_final_price),
      bookingFeeAmount: Number(b.booking_fee_amount),
      agreedDpTotalAmount: Number(b.agreed_dp_total_amount),
      status: b.status as BookingStatus,
      bookedAt: b.booked_at,
      expiresAt: b.expires_at,
    };
  });

  const scheduleOptions: LeadScheduleOptionDto[] = (schedulesRes.data ?? []).map(
    (s) => ({
      id: s.id,
      bookingId: s.booking_id,
      bookingRef: bookingRefMap.get(s.booking_id) ?? 'Booking',
      scheduleType: s.schedule_type as ScheduleType,
      installmentNumber: Number(s.installment_number),
      title: s.title,
      scheduledAmount: Number(s.scheduled_amount),
      dueDate: s.due_date,
      status: s.status as ScheduleStatus,
    })
  );

  const kprApplications: LeadKprSummaryDto[] = (kprsRes.data ?? []).map((k) => ({
    id: k.id,
    referenceNumber: k.reference_number,
    bookingId: k.booking_id,
    bookingRef: bookingRefMap.get(k.booking_id) ?? 'Booking',
    bankName: k.bank_name,
    requestedLoanAmount: Number(k.requested_loan_amount),
    approvedLoanAmount:
      k.approved_loan_amount !== null ? Number(k.approved_loan_amount) : null,
    currentStage: k.current_stage as KprStage,
    applicationStatus: k.application_status as KprApplicationStatus,
  }));

  // Hanya unit AVAILABLE pada proyek yang berstatus ACTIVE_SELLING & developer aktif yang bisa diajukan Booking (TX-01)
  const activeSellingProjectIds = new Set(
    (projectsRes.data ?? [])
      .filter((p) => {
        const dev = Array.isArray(p.developers) ? p.developers[0] : p.developers;
        return p.status === 'ACTIVE_SELLING' && dev?.is_active === true;
      })
      .map((p) => p.id)
  );

  const availableUnits: AvailableUnitOptionDto[] = availableCatalogUnits
    .filter((u) => activeSellingProjectIds.has(u.project_id))
    .map((u) => ({
      id: u.id,
      projectId: u.project_id,
      projectName: u.project_name,
      propertyTypeId: u.property_type_id,
      propertyTypeName: u.property_type_name,
      unitCode: u.unit_code,
      blockNumber: u.block_number,
      catalogPrice: Number(u.catalog_price),
    }));

  const todayJakarta = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
  }).format(new Date());

  const activePromos: ActivePromoOptionDto[] = (promosRes.data ?? [])
    .filter((pr) => pr.start_date <= todayJakarta && pr.end_date >= todayJakarta)
    .map((pr) => ({
      id: pr.id,
      projectId: pr.project_id,
      propertyTypeId: pr.property_type_id,
      code: pr.code,
      name: pr.name,
      promoType: pr.promo_type as PromoType,
      discountValue: Number(pr.discount_value),
      bonusDescription: pr.bonus_description,
      startDate: pr.start_date,
      endDate: pr.end_date,
    }));

  const projects: LeadDetailProjectOption[] = (projectsRes.data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    city: p.city,
  }));

  const propertyTypes: LeadDetailPropertyTypeOption[] = (
    propertyTypesRes.data ?? []
  ).map((pt) => ({
    id: pt.id,
    projectId: pt.project_id,
    code: pt.code,
    name: pt.name,
  }));

  // Opsi Sales tujuan Reassignment TX-07 (SUPERVISOR dibatasi tim aktifnya; ADMIN lintas tim aktif)
  const activeTeamIds = new Set(
    (teamsRes.data ?? []).filter((t) => t.is_active).map((t) => t.id)
  );

  const reassignSalesOptions: ReassignSalesOptionDto[] =
    user.systemRole === 'SALES'
      ? []
      : (staffDirRes.data ?? [])
          .filter(
            (s) =>
              s.system_role === 'SALES' &&
              s.is_active &&
              Boolean(s.active_team_id) &&
              activeTeamIds.has(s.active_team_id as string) &&
              s.profile_id !== lead.assignedSalesId &&
              (user.systemRole === 'ADMIN' ||
                s.active_team_id === user.activeTeamId)
          )
          .map((s) => ({
            id: s.profile_id,
            fullName: s.full_name,
            teamId: s.active_team_id as string,
            teamCode: s.active_team_code ?? '-',
            teamName: s.active_team_name ?? '-',
          }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <LeadDetailClient
      userRole={user.systemRole}
      lead={lead}
      activities={activities}
      tasks={tasks}
      siteVisits={siteVisits}
      scoreHistories={scoreHistories}
      pipelineHistories={pipelineHistories}
      assignmentHistories={assignmentHistories}
      bookings={bookings}
      scheduleOptions={scheduleOptions}
      kprApplications={kprApplications}
      availableUnits={availableUnits}
      activePromos={activePromos}
      projects={projects}
      propertyTypes={propertyTypes}
      reassignSalesOptions={reassignSalesOptions}
    />
  );
}
