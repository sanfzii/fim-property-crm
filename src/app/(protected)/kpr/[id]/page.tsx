// Lokasi: src/app/(protected)/kpr/[id]/page.tsx
// Server Component Halaman Detail Aplikasi KPR 10 Tahap (/kpr/[id] — ADMIN, SUPERVISOR, SALES)

import React from 'react';
import { notFound } from 'next/navigation';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  BookingStatus,
  DisbursementTranche,
  KprApplicationStatus,
  KprDisbursementStatus,
  KprDocStatus,
  KprStage,
  ScheduleStatus,
  TaskPriority,
  TaskStatus,
  UnitStatus,
} from '@/types/database.types';
import {
  getJakartaNowDateTimeLocalValue,
} from '@/lib/utils/kpr-deals-ui';
import { getJakartaTodayDateString } from '@/lib/utils/transactions-ui';
import {
  KprDetailClient,
  type KprDetailDto,
  type KprDisbursementItemDto,
  type KprDocumentItemDto,
  type KprStageHistoryItemDto,
  type KprTaskItemDto,
  type KprTopupDpScheduleDto,
} from '@/components/kpr/KprDetailClient';

export const dynamic = 'force-dynamic';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getServerNowMs(): number {
  return Date.now();
}

export default async function KprDetailPage({
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
  const nowMs = getServerNowMs();

  // 1. Ambil aplikasi KPR utama (RLS otomatis memblokir akses lintas tim/sales)
  const { data: kprRow, error: kprErr } = await supabase
    .from('kpr_applications')
    .select(
      `
      id,
      reference_number,
      booking_id,
      current_sales_id,
      bank_name,
      requested_loan_amount,
      tenor_years,
      current_stage,
      application_status,
      submitted_to_bank_at,
      approved_at,
      sp3k_reference_number,
      approved_loan_amount,
      rejected_at,
      rejection_reason,
      cancelled_at,
      cancellation_reason,
      akad_scheduled_at,
      akad_location,
      notary_name,
      akad_completed_at,
      akad_deed_number,
      disbursement_status,
      primary_disbursed_amount,
      subsequent_disbursed_amount,
      remaining_undisbursed_amount,
      first_disbursed_at,
      fully_disbursed_at,
      notes,
      bookings!inner(
        id,
        reference_number,
        status,
        lead_id,
        unit_id,
        leads!inner(id, full_name, phone),
        units!inner(id, unit_code, block_number, status, property_projects!inner(name))
      ),
      teams(code, name)
    `
    )
    .eq('id', id)
    .maybeSingle();

  if (kprErr || !kprRow) {
    notFound();
  }

  const bookingRel = Array.isArray(kprRow.bookings)
    ? kprRow.bookings[0]
    : kprRow.bookings;
  const leadRel = bookingRel?.leads
    ? Array.isArray(bookingRel.leads)
      ? bookingRel.leads[0]
      : bookingRel.leads
    : null;
  const unitRel = bookingRel?.units
    ? Array.isArray(bookingRel.units)
      ? bookingRel.units[0]
      : bookingRel.units
    : null;
  const projectRel = unitRel?.property_projects
    ? Array.isArray(unitRel.property_projects)
      ? unitRel.property_projects[0]
      : unitRel.property_projects
    : null;
  const teamRel = Array.isArray(kprRow.teams) ? kprRow.teams[0] : kprRow.teams;

  // 2. Ambil seluruh relasi pendukung secara paralel
  const [
    topupSchedRes,
    docsRes,
    historiesRes,
    disbRes,
    tasksRes,
    staffRes,
  ] = await Promise.all([
    supabase
      .from('payment_schedules')
      .select(
        'id, title, scheduled_amount, verified_paid_amount, remaining_amount, due_date, status'
      )
      .eq('booking_id', kprRow.booking_id)
      .eq('schedule_type', 'KPR_TOPUP_DP')
      .order('installment_number', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('kpr_documents')
      .select(
        'id, document_name, is_mandatory, status, file_path, file_name, uploaded_by, uploaded_at, verified_by, verified_at, verification_notes, kpr_bank_requirements(document_code)'
      )
      .eq('kpr_application_id', id)
      .order('is_mandatory', { ascending: false })
      .order('document_name', { ascending: true }),
    supabase
      .from('kpr_stage_histories')
      .select('id, from_stage, to_stage, notes, changed_by, changed_at')
      .eq('kpr_application_id', id)
      .order('changed_at', { ascending: false }),
    supabase
      .from('kpr_disbursements')
      .select(
        'id, tranche_type, sequence_number, disbursement_reference, disbursed_amount, disbursement_date, proof_file_path, recorded_by_admin_id, notes'
      )
      .eq('kpr_application_id', id)
      .order('sequence_number', { ascending: true }),
    supabase
      .from('follow_up_tasks')
      .select('id, title, description, due_at, priority, status, assigned_sales_id')
      .eq('related_kpr_application_id', id)
      .order('due_at', { ascending: true }),
    supabase.from('v_staff_directory').select('profile_id, full_name'),
  ]);

  const staffMap = new Map(
    (staffRes.data ?? []).map((s) => [s.profile_id, s.full_name])
  );

  const kpr: KprDetailDto = {
    id: kprRow.id,
    referenceNumber: kprRow.reference_number,
    bookingId: kprRow.booking_id,
    bookingReferenceNumber: bookingRel?.reference_number ?? '-',
    bookingStatus: (bookingRel?.status ?? 'ACTIVE') as BookingStatus,
    leadId: leadRel?.id ?? '',
    leadFullName: leadRel?.full_name ?? 'Konsumen FIM',
    leadPhone: leadRel?.phone ?? '-',
    unitId: unitRel?.id ?? '',
    unitCode: unitRel?.unit_code ?? '-',
    blockNumber: unitRel?.block_number ?? '-',
    unitStatus: (unitRel?.status ?? 'BOOKED') as UnitStatus,
    projectName: projectRel?.name ?? 'Proyek FIM',
    salesName: staffMap.get(kprRow.current_sales_id) ?? 'Sales FIM',
    teamCode: teamRel?.code ?? '-',
    teamName: teamRel?.name ?? '-',
    bankName: kprRow.bank_name,
    tenorYears: Number(kprRow.tenor_years),
    requestedLoanAmount: Number(kprRow.requested_loan_amount),
    approvedLoanAmount:
      kprRow.approved_loan_amount !== null
        ? Number(kprRow.approved_loan_amount)
        : null,
    currentStage: kprRow.current_stage as KprStage,
    applicationStatus: kprRow.application_status as KprApplicationStatus,
    disbursementStatus: kprRow.disbursement_status as KprDisbursementStatus,
    primaryDisbursedAmount: Number(kprRow.primary_disbursed_amount ?? 0),
    subsequentDisbursedAmount: Number(kprRow.subsequent_disbursed_amount ?? 0),
    remainingUndisbursedAmount: Number(kprRow.remaining_undisbursed_amount ?? 0),
    sp3kReferenceNumber: kprRow.sp3k_reference_number,
    submittedToBankAt: kprRow.submitted_to_bank_at,
    approvedAt: kprRow.approved_at,
    rejectedAt: kprRow.rejected_at,
    rejectionReason: kprRow.rejection_reason,
    cancelledAt: kprRow.cancelled_at,
    cancellationReason: kprRow.cancellation_reason,
    akadScheduledAt: kprRow.akad_scheduled_at,
    akadLocation: kprRow.akad_location,
    notaryName: kprRow.notary_name,
    akadCompletedAt: kprRow.akad_completed_at,
    akadDeedNumber: kprRow.akad_deed_number,
    firstDisbursedAt: kprRow.first_disbursed_at,
    fullyDisbursedAt: kprRow.fully_disbursed_at,
    notes: kprRow.notes,
  };

  const topupSchedule: KprTopupDpScheduleDto | null = topupSchedRes.data
    ? {
        id: topupSchedRes.data.id,
        title: topupSchedRes.data.title,
        scheduledAmount: Number(topupSchedRes.data.scheduled_amount),
        verifiedPaidAmount: Number(topupSchedRes.data.verified_paid_amount),
        remainingAmount: Number(topupSchedRes.data.remaining_amount),
        dueDate: topupSchedRes.data.due_date,
        status: topupSchedRes.data.status as ScheduleStatus,
      }
    : null;

  const documents: KprDocumentItemDto[] = (docsRes.data ?? []).map((doc) => {
    const reqRel = Array.isArray(doc.kpr_bank_requirements)
      ? doc.kpr_bank_requirements[0]
      : doc.kpr_bank_requirements;
    return {
      id: doc.id,
      documentName: doc.document_name,
      documentCode: reqRel?.document_code ?? 'DOC',
      isMandatory: Boolean(doc.is_mandatory),
      status: doc.status as KprDocStatus,
      filePath: doc.file_path,
      fileName: doc.file_name,
      uploadedByName: doc.uploaded_by
        ? (staffMap.get(doc.uploaded_by) ?? 'Staf FIM')
        : null,
      uploadedAt: doc.uploaded_at,
      verifiedByName: doc.verified_by
        ? (staffMap.get(doc.verified_by) ?? 'Admin FIM')
        : null,
      verifiedAt: doc.verified_at,
      verificationNotes: doc.verification_notes,
    };
  });

  const stageHistories: KprStageHistoryItemDto[] = (historiesRes.data ?? []).map(
    (h) => ({
      id: h.id,
      fromStage: (h.from_stage as KprStage | null) ?? null,
      toStage: h.to_stage as KprStage,
      notes: h.notes,
      changedByName: staffMap.get(h.changed_by) ?? 'Staf FIM',
      changedAt: h.changed_at,
    })
  );

  const disbursements: KprDisbursementItemDto[] = (disbRes.data ?? []).map(
    (d) => ({
      id: d.id,
      trancheType: d.tranche_type as DisbursementTranche,
      sequenceNumber: Number(d.sequence_number),
      disbursementReference: d.disbursement_reference,
      disbursedAmount: Number(d.disbursed_amount),
      disbursementDate: d.disbursement_date,
      proofFilePath: d.proof_file_path,
      recordedByName: staffMap.get(d.recorded_by_admin_id) ?? 'Admin FIM',
      notes: d.notes,
    })
  );

  const tasks: KprTaskItemDto[] = (tasksRes.data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    dueAt: t.due_at,
    priority: t.priority as TaskPriority,
    status: t.status as TaskStatus,
    assignedSalesName: staffMap.get(t.assigned_sales_id) ?? 'Sales FIM',
  }));

  const defaultTodayDateStr = getJakartaTodayDateString(nowMs);
  const defaultTopupDueDateStr = getJakartaTodayDateString(
    nowMs + 7 * 24 * 60 * 60 * 1000
  );
  const defaultAkadDateTimeLocal = getJakartaNowDateTimeLocalValue(
    nowMs + 3 * 24 * 60 * 60 * 1000
  );

  return (
    <KprDetailClient
      userRole={user.systemRole}
      kpr={kpr}
      topupSchedule={topupSchedule}
      documents={documents}
      stageHistories={stageHistories}
      disbursements={disbursements}
      tasks={tasks}
      defaultTodayDateStr={defaultTodayDateStr}
      defaultTopupDueDateStr={defaultTopupDueDateStr}
      defaultAkadDateTimeLocal={defaultAkadDateTimeLocal}
    />
  );
}
