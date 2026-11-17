// Lokasi: src/app/(protected)/kpr/page.tsx
// Server Component Halaman Daftar Pengajuan KPR (/kpr — ADMIN, SUPERVISOR, SALES)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  KprApplicationStatus,
  KprDisbursementStatus,
  KprStage,
  UnitStatus,
} from '@/types/database.types';
import {
  KprWorkspaceClient,
  type KprListItemDto,
} from '@/components/kpr/KprWorkspaceClient';

export const dynamic = 'force-dynamic';

export default async function KprListPage() {
  await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const supabase = await createSupabaseServerClient();

  const [kprRes, staffRes] = await Promise.all([
    supabase
      .from('kpr_applications')
      .select(
        `
        id,
        reference_number,
        booking_id,
        current_sales_id,
        bank_name,
        tenor_years,
        requested_loan_amount,
        approved_loan_amount,
        current_stage,
        application_status,
        disbursement_status,
        primary_disbursed_amount,
        subsequent_disbursed_amount,
        remaining_undisbursed_amount,
        created_at,
        bookings!inner(
          id,
          reference_number,
          leads!inner(id, full_name),
          units!inner(unit_code, status, property_projects!inner(name))
        ),
        teams(code, name),
        kpr_documents(id, is_mandatory, status)
      `
      )
      .order('created_at', { ascending: false }),
    supabase.from('v_staff_directory').select('profile_id, full_name'),
  ]);

  const staffMap = new Map(
    (staffRes.data ?? []).map((s) => [s.profile_id, s.full_name])
  );

  const applications: KprListItemDto[] = (kprRes.data ?? []).map((row) => {
    const bookingRel = Array.isArray(row.bookings)
      ? row.bookings[0]
      : row.bookings;
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
    const teamRel = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    const docs = Array.isArray(row.kpr_documents) ? row.kpr_documents : [];
    const mandatoryDocs = docs.filter((d) => Boolean(d.is_mandatory));
    const verifiedMandatory = mandatoryDocs.filter(
      (d) => d.status === 'VERIFIED'
    ).length;

    return {
      id: row.id,
      referenceNumber: row.reference_number,
      bookingId: row.booking_id,
      bookingReferenceNumber: bookingRel?.reference_number ?? '-',
      leadId: leadRel?.id ?? '',
      leadFullName: leadRel?.full_name ?? 'Konsumen FIM',
      unitCode: unitRel?.unit_code ?? '-',
      unitStatus: (unitRel?.status ?? 'BOOKED') as UnitStatus,
      projectName: projectRel?.name ?? 'Proyek FIM',
      teamCode: teamRel?.code ?? '-',
      teamName: teamRel?.name ?? '-',
      salesName: staffMap.get(row.current_sales_id) ?? 'Sales FIM',
      bankName: row.bank_name,
      tenorYears: Number(row.tenor_years),
      requestedLoanAmount: Number(row.requested_loan_amount),
      approvedLoanAmount:
        row.approved_loan_amount !== null
          ? Number(row.approved_loan_amount)
          : null,
      currentStage: row.current_stage as KprStage,
      applicationStatus: row.application_status as KprApplicationStatus,
      disbursementStatus: row.disbursement_status as KprDisbursementStatus,
      primaryDisbursedAmount: Number(row.primary_disbursed_amount ?? 0),
      subsequentDisbursedAmount: Number(row.subsequent_disbursed_amount ?? 0),
      remainingUndisbursedAmount: Number(row.remaining_undisbursed_amount ?? 0),
      mandatoryDocsVerified: verifiedMandatory,
      mandatoryDocsTotal: mandatoryDocs.length,
    };
  });

  return <KprWorkspaceClient applications={applications} />;
}
