// Lokasi: src/app/(protected)/deals/page.tsx
// Server Component Halaman Deals & Kontrak 3 Dimensi (/deals — ADMIN, SUPERVISOR, SALES)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  BookingStatus,
  DealContractStatus,
  DealSalesOutcome,
  DealSettlementStatus,
  KprApplicationStatus,
  KprDisbursementStatus,
  KprStage,
  PaymentMethod,
  UnitStatus,
} from '@/types/database.types';
import { translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import {
  DealsWorkspaceClient,
  type DealHistoryItemDto,
  type DealListItemDto,
} from '@/components/deals/DealsWorkspaceClient';

export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const supabase = await createSupabaseServerClient();

  const [
    dealsRes,
    historiesRes,
    bookingsRes,
    leadsRes,
    unitsRes,
    projectsRes,
    teamsRes,
    kprRes,
    staffRes,
  ] = await Promise.all([
    supabase
      .from('deals')
      .select(
        'id, reference_number, booking_id, lead_id, unit_id, team_id, current_sales_id, payment_method, final_deal_value, sales_outcome_status, contract_status, payment_settlement_status, contract_document_number, contract_file_path, contract_signed_at, fully_settled_at, created_at'
      )
      .order('created_at', { ascending: false }),
    supabase
      .from('deal_status_histories')
      .select('id, deal_id, changed_dimension, old_status, new_status, reason, changed_by, changed_at')
      .order('changed_at', { ascending: false }),
    supabase.from('bookings').select('id, reference_number, status'),
    supabase.from('leads').select('id, full_name'),
    supabase.from('units').select('id, unit_code, status, project_id'),
    supabase.from('property_projects').select('id, name'),
    supabase.from('teams').select('id, code'),
    supabase
      .from('kpr_applications')
      .select('id, booking_id, current_stage, application_status, disbursement_status'),
    supabase.from('v_staff_directory').select('profile_id, full_name'),
  ]);

  if (dealsRes.error) throw translateDatabaseOrRpcError(dealsRes.error);
  if (historiesRes.error) throw translateDatabaseOrRpcError(historiesRes.error);
  if (bookingsRes.error) throw translateDatabaseOrRpcError(bookingsRes.error);
  if (leadsRes.error) throw translateDatabaseOrRpcError(leadsRes.error);
  if (unitsRes.error) throw translateDatabaseOrRpcError(unitsRes.error);
  if (projectsRes.error) throw translateDatabaseOrRpcError(projectsRes.error);
  if (teamsRes.error) throw translateDatabaseOrRpcError(teamsRes.error);
  if (kprRes.error) throw translateDatabaseOrRpcError(kprRes.error);
  if (staffRes.error) throw translateDatabaseOrRpcError(staffRes.error);

  const staffMap = new Map(
    (staffRes.data ?? []).map((s) => [s.profile_id, s.full_name])
  );
  const bookingMap = new Map(
    (bookingsRes.data ?? []).map((b) => [b.id, b])
  );
  const leadMap = new Map((leadsRes.data ?? []).map((l) => [l.id, l]));
  const unitMap = new Map((unitsRes.data ?? []).map((u) => [u.id, u]));
  const projectMap = new Map((projectsRes.data ?? []).map((p) => [p.id, p]));
  const teamMap = new Map((teamsRes.data ?? []).map((t) => [t.id, t]));
  const kprByBookingId = new Map(
    (kprRes.data ?? []).map((k) => [k.booking_id, k])
  );

  const historiesByDealId = new Map<string, DealHistoryItemDto[]>();
  for (const h of historiesRes.data ?? []) {
    const arr = historiesByDealId.get(h.deal_id) ?? [];
    arr.push({
      id: h.id,
      changedDimension: h.changed_dimension,
      oldStatus: h.old_status ?? '-',
      newStatus: h.new_status,
      reason: h.reason,
      changedByName: h.changed_by
        ? (staffMap.get(h.changed_by) ?? 'Admin FIM')
        : 'Sistem',
      changedAt: h.changed_at,
    });
    historiesByDealId.set(h.deal_id, arr);
  }

  const deals: DealListItemDto[] = (dealsRes.data ?? []).map((row) => {
    const bookingRel = bookingMap.get(row.booking_id);
    const leadRel = leadMap.get(row.lead_id);
    const unitRel = unitMap.get(row.unit_id);
    const projectRel = unitRel ? projectMap.get(unitRel.project_id) : undefined;
    const teamRel = teamMap.get(row.team_id);
    const kprRel = kprByBookingId.get(row.booking_id) ?? null;

    return {
      id: row.id,
      referenceNumber: row.reference_number,
      bookingId: row.booking_id,
      bookingReferenceNumber: bookingRel?.reference_number ?? '-',
      bookingStatus: (bookingRel?.status ?? 'ACTIVE') as BookingStatus,
      leadId: row.lead_id,
      leadFullName: leadRel?.full_name ?? 'Konsumen FIM',
      unitCode: unitRel?.unit_code ?? '-',
      unitStatus: (unitRel?.status ?? 'BOOKED') as UnitStatus,
      projectName: projectRel?.name ?? 'Proyek FIM',
      salesName: staffMap.get(row.current_sales_id) ?? 'Sales FIM',
      teamCode: teamRel?.code ?? '-',
      paymentMethod: row.payment_method as PaymentMethod,
      finalDealValue: Number(row.final_deal_value),
      salesOutcomeStatus: row.sales_outcome_status as DealSalesOutcome,
      contractStatus: row.contract_status as DealContractStatus,
      paymentSettlementStatus: row.payment_settlement_status as DealSettlementStatus,
      contractDocumentNumber: row.contract_document_number,
      contractFilePath: row.contract_file_path,
      contractSignedAt: row.contract_signed_at,
      fullySettledAt: row.fully_settled_at,
      kprApplicationId: kprRel?.id ?? null,
      kprApplicationStatus:
        (kprRel?.application_status as KprApplicationStatus | undefined) ?? null,
      kprCurrentStage: (kprRel?.current_stage as KprStage | undefined) ?? null,
      kprDisbursementStatus:
        (kprRel?.disbursement_status as KprDisbursementStatus | undefined) ??
        null,
      histories: historiesByDealId.get(row.id) ?? [],
    };
  });

  return <DealsWorkspaceClient userRole={user.systemRole} deals={deals} />;
}
