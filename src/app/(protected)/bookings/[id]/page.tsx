// Lokasi: src/app/(protected)/bookings/[id]/page.tsx
// Server Component Halaman Detail Booking (/bookings/[id] — ADMIN, SUPERVISOR, SALES)

import React from 'react';
import { notFound } from 'next/navigation';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  BookingStatus,
  DealContractStatus,
  DealSalesOutcome,
  DealSettlementStatus,
  KprStage,
  PaymentMethod,
  PaymentVerificationStatus,
  RefundPolicy,
  RefundStatus,
  ScheduleStatus,
  ScheduleType,
} from '@/types/database.types';
import {
  BookingDetailClient,
  type BookingDealSummaryDto,
  type BookingDetailDto,
  type BookingExtensionDto,
  type BookingKprSummaryDto,
  type BookingPaymentRecordDto,
  type BookingRefundDto,
  type BookingScheduleDto,
} from '@/components/bookings/BookingDetailClient';

export const dynamic = 'force-dynamic';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getServerNowMs(): number {
  return Date.now();
}

export default async function BookingDetailPage({
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
  const referenceNowMs = getServerNowMs();

  // 1. Ambil baris booking utama (RLS memblokir jika user tidak punya akses)
  const { data: bookingRow, error: bookingErr } = await supabase
    .from('bookings')
    .select(
      'id, reference_number, lead_id, unit_id, current_sales_id, payment_method, catalog_price_snapshot, promo_discount_snapshot, agreed_final_price, booking_fee_amount, is_booking_fee_part_of_dp, agreed_dp_total_amount, status, booked_at, expires_at, confirmed_at, cancelled_at, cancellation_reason, refund_policy_type, agreed_refund_amount, forfeited_retained_amount, notes, leads(id, full_name, phone, email), units(id, unit_code, block_number, catalog_price, status, property_projects(id, name), property_types(id, name)), promotions(id, code, name), teams(id, code, name)'
    )
    .eq('id', id)
    .maybeSingle();

  if (bookingErr || !bookingRow) {
    notFound();
  }

  // 2. Ambil seluruh relasi pendukung secara paralel
  const [
    extensionsRes,
    schedulesRes,
    paymentsRes,
    refundsRes,
    kprRes,
    dealRes,
    staffDirRes,
  ] = await Promise.all([
    supabase
      .from('booking_extensions')
      .select('id, old_expires_at, new_expires_at, reason, extended_by, created_at')
      .eq('booking_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('payment_schedules')
      .select(
        'id, schedule_type, installment_number, title, scheduled_amount, verified_paid_amount, remaining_amount, due_date, status, paid_at'
      )
      .eq('booking_id', id)
      .order('installment_number', { ascending: true })
      .order('due_date', { ascending: true }),
    supabase
      .from('payment_records')
      .select(
        'id, reference_number, payment_schedule_id, submitted_by_sales_id, paid_amount, payment_date, payment_channel, proof_file_path, proof_file_name, replaces_payment_id, verification_status, submitted_at, verified_by_admin_id, verified_at, verification_notes, sales_notes'
      )
      .eq('booking_id', id)
      .order('submitted_at', { ascending: false }),
    supabase
      .from('refund_transactions')
      .select(
        'id, reference_number, refund_amount, refund_date, refund_method, proof_file_path, status, processed_by_admin_id, notes, created_at'
      )
      .eq('booking_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('kpr_applications')
      .select(
        'id, reference_number, bank_name, tenor_years, requested_loan_amount, approved_loan_amount, current_stage, application_status'
      )
      .eq('booking_id', id)
      .maybeSingle(),
    supabase
      .from('deals')
      .select(
        'id, reference_number, sales_outcome_status, contract_status, payment_settlement_status'
      )
      .eq('booking_id', id)
      .maybeSingle(),
    supabase.from('v_staff_directory').select('profile_id, full_name'),
  ]);

  const staffMap = new Map(
    (staffDirRes.data ?? []).map((s) => [s.profile_id, s.full_name])
  );

  const leadRel = Array.isArray(bookingRow.leads)
    ? bookingRow.leads[0]
    : bookingRow.leads;
  const unitRel = Array.isArray(bookingRow.units)
    ? bookingRow.units[0]
    : bookingRow.units;
  const projectRel = unitRel?.property_projects
    ? Array.isArray(unitRel.property_projects)
      ? unitRel.property_projects[0]
      : unitRel.property_projects
    : null;
  const propTypeRel = unitRel?.property_types
    ? Array.isArray(unitRel.property_types)
      ? unitRel.property_types[0]
      : unitRel.property_types
    : null;
  const promoRel = Array.isArray(bookingRow.promotions)
    ? bookingRow.promotions[0]
    : bookingRow.promotions;
  const teamRel = Array.isArray(bookingRow.teams)
    ? bookingRow.teams[0]
    : bookingRow.teams;

  const booking: BookingDetailDto = {
    id: bookingRow.id,
    referenceNumber: bookingRow.reference_number,
    leadId: bookingRow.lead_id,
    leadFullName: leadRel?.full_name ?? 'Konsumen FIM',
    leadPhone: leadRel?.phone ?? '-',
    leadEmail: leadRel?.email ?? null,
    unitId: bookingRow.unit_id,
    unitCode: unitRel?.unit_code ?? '-',
    blockNumber: unitRel?.block_number ?? '-',
    unitStatus: unitRel?.status ?? 'HELD',
    unitCurrentCatalogPrice: Number(
      unitRel?.catalog_price ?? bookingRow.catalog_price_snapshot
    ),
    projectName: projectRel?.name ?? 'Proyek FIM',
    propertyTypeName: propTypeRel?.name ?? '-',
    salesName: staffMap.get(bookingRow.current_sales_id) ?? 'Sales FIM',
    teamCode: teamRel?.code ?? '-',
    teamName: teamRel?.name ?? '-',
    paymentMethod: bookingRow.payment_method as PaymentMethod,
    promoLabel: promoRel ? `${promoRel.code} — ${promoRel.name}` : null,
    catalogPriceSnapshot: Number(bookingRow.catalog_price_snapshot),
    promoDiscountSnapshot: Number(bookingRow.promo_discount_snapshot),
    agreedFinalPrice: Number(bookingRow.agreed_final_price),
    bookingFeeAmount: Number(bookingRow.booking_fee_amount),
    isBookingFeePartOfDp: Boolean(bookingRow.is_booking_fee_part_of_dp),
    agreedDpTotalAmount: Number(bookingRow.agreed_dp_total_amount),
    status: bookingRow.status as BookingStatus,
    bookedAt: bookingRow.booked_at,
    expiresAt: bookingRow.expires_at,
    confirmedAt: bookingRow.confirmed_at,
    cancelledAt: bookingRow.cancelled_at,
    cancellationReason: bookingRow.cancellation_reason,
    refundPolicyType: bookingRow.refund_policy_type as RefundPolicy | null,
    agreedRefundAmount: Number(bookingRow.agreed_refund_amount ?? 0),
    forfeitedRetainedAmount: Number(bookingRow.forfeited_retained_amount ?? 0),
    notes: bookingRow.notes,
  };

  const schedules: BookingScheduleDto[] = (schedulesRes.data ?? []).map((s) => ({
    id: s.id,
    scheduleType: s.schedule_type as ScheduleType,
    installmentNumber: Number(s.installment_number),
    title: s.title,
    scheduledAmount: Number(s.scheduled_amount),
    verifiedPaidAmount: Number(s.verified_paid_amount),
    remainingAmount: Number(s.remaining_amount),
    dueDate: s.due_date,
    status: s.status as ScheduleStatus,
    paidAt: s.paid_at,
  }));

  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const rawPayments = paymentsRes.data ?? [];
  const paymentRefById = new Map(rawPayments.map((p) => [p.id, p.reference_number]));
  const replacedByMap = new Map<
    string,
    { ref: string; hasActiveOrVerified: boolean }
  >();

  for (const p of rawPayments) {
    if (p.replaces_payment_id) {
      const existing = replacedByMap.get(p.replaces_payment_id);
      const isActiveOrVerified =
        p.verification_status === 'PENDING_VERIFICATION' ||
        p.verification_status === 'VERIFIED';
      replacedByMap.set(p.replaces_payment_id, {
        ref: existing?.ref ?? p.reference_number,
        hasActiveOrVerified:
          Boolean(existing?.hasActiveOrVerified) || isActiveOrVerified,
      });
    }
  }

  const payments: BookingPaymentRecordDto[] = rawPayments.map((p) => {
    const sched = scheduleById.get(p.payment_schedule_id);
    const replacementInfo = replacedByMap.get(p.id);
    return {
      id: p.id,
      referenceNumber: p.reference_number,
      paymentScheduleId: p.payment_schedule_id,
      scheduleTitle: sched?.title ?? 'Jadwal Pembayaran',
      scheduleType: sched?.scheduleType ?? 'BOOKING_FEE',
      scheduledAmount: sched?.scheduledAmount ?? Number(p.paid_amount),
      scheduleRemainingAmount: sched?.remainingAmount ?? 0,
      scheduleStatus: sched?.status ?? 'UNPAID',
      paidAmount: Number(p.paid_amount),
      paymentDate: p.payment_date,
      paymentChannel: p.payment_channel,
      proofFilePath: p.proof_file_path,
      proofFileName: p.proof_file_name,
      replacesPaymentId: p.replaces_payment_id,
      replacesPaymentRef: p.replaces_payment_id
        ? (paymentRefById.get(p.replaces_payment_id) ?? 'Bukti Sebelumnya')
        : null,
      replacedByRef: replacementInfo?.ref ?? null,
      hasActiveOrVerifiedReplacement: Boolean(replacementInfo?.hasActiveOrVerified),
      verificationStatus: p.verification_status as PaymentVerificationStatus,
      submittedAt: p.submitted_at,
      submittedByName: staffMap.get(p.submitted_by_sales_id) ?? 'Sales FIM',
      salesNotes: p.sales_notes,
      verifiedByName: p.verified_by_admin_id
        ? (staffMap.get(p.verified_by_admin_id) ?? 'Admin FIM')
        : null,
      verifiedAt: p.verified_at,
      verificationNotes: p.verification_notes,
    };
  });

  const extensions: BookingExtensionDto[] = (extensionsRes.data ?? []).map(
    (ext) => ({
      id: ext.id,
      oldExpiresAt: ext.old_expires_at,
      newExpiresAt: ext.new_expires_at,
      reason: ext.reason,
      extendedByName: staffMap.get(ext.extended_by) ?? 'Admin FIM',
      createdAt: ext.created_at,
    })
  );

  const refunds: BookingRefundDto[] = (refundsRes.data ?? []).map((r) => ({
    id: r.id,
    referenceNumber: r.reference_number,
    refundAmount: Number(r.refund_amount),
    refundDate: r.refund_date,
    refundMethod: r.refund_method,
    proofFilePath: r.proof_file_path,
    status: r.status as RefundStatus,
    processedByName: staffMap.get(r.processed_by_admin_id) ?? 'Admin FIM',
    notes: r.notes,
    createdAt: r.created_at,
  }));

  const kprApplication: BookingKprSummaryDto | null = kprRes.data
    ? {
        id: kprRes.data.id,
        referenceNumber: kprRes.data.reference_number,
        bankName: kprRes.data.bank_name,
        tenorYears: Number(kprRes.data.tenor_years),
        requestedLoanAmount: Number(kprRes.data.requested_loan_amount),
        approvedLoanAmount:
          kprRes.data.approved_loan_amount !== null
            ? Number(kprRes.data.approved_loan_amount)
            : null,
        currentStage: kprRes.data.current_stage as KprStage,
        applicationStatus: kprRes.data.application_status,
      }
    : null;

  const deal: BookingDealSummaryDto | null = dealRes.data
    ? {
        id: dealRes.data.id,
        dealNumber: dealRes.data.reference_number,
        salesOutcomeStatus: dealRes.data.sales_outcome_status as DealSalesOutcome,
        contractStatus: dealRes.data.contract_status as DealContractStatus,
        settlementStatus: dealRes.data
          .payment_settlement_status as DealSettlementStatus,
      }
    : null;

  return (
    <BookingDetailClient
      userRole={user.systemRole}
      booking={booking}
      schedules={schedules}
      payments={payments}
      extensions={extensions}
      refunds={refunds}
      kprApplication={kprApplication}
      deal={deal}
      referenceNowMs={referenceNowMs}
    />
  );
}
