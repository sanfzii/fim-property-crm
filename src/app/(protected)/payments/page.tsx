// Lokasi: src/app/(protected)/payments/page.tsx
// Server Component Halaman Pusat Pembayaran, Verifikasi SLA & Refund (/payments)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  BookingStatus,
  PaymentMethod,
  PaymentVerificationStatus,
  RefundStatus,
  ScheduleStatus,
  ScheduleType,
} from '@/types/database.types';
import {
  PaymentsWorkspaceClient,
  type PaymentsWorkspaceRecordDto,
  type PaymentsWorkspaceRefundDto,
  type PaymentsWorkspaceScheduleDto,
} from '@/components/payments/PaymentsWorkspaceClient';

export const dynamic = 'force-dynamic';

function getServerNowMs(): number {
  return Date.now();
}

export default async function PaymentsPage() {
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const supabase = await createSupabaseServerClient();
  const referenceNowMs = getServerNowMs();

  const [recordsRes, schedulesRes, refundsRes, staffDirRes] = await Promise.all([
    supabase
      .from('payment_records')
      .select(
        'id, reference_number, booking_id, payment_schedule_id, submitted_by_sales_id, paid_amount, payment_date, payment_channel, proof_file_path, proof_file_name, replaces_payment_id, verification_status, submitted_at, verified_by_admin_id, verified_at, verification_notes, sales_notes, payment_schedules(id, title, schedule_type, scheduled_amount, remaining_amount), bookings(id, reference_number, status, expires_at, payment_method, leads(id, full_name), units(unit_code, property_projects(name)))'
      )
      .order('submitted_at', { ascending: false }),
    supabase
      .from('payment_schedules')
      .select(
        'id, booking_id, schedule_type, installment_number, title, scheduled_amount, verified_paid_amount, remaining_amount, due_date, status, bookings(id, reference_number, status, leads(id, full_name), units(unit_code, property_projects(name)))'
      )
      .neq('status', 'CANCELLED')
      .order('due_date', { ascending: true }),
    supabase
      .from('refund_transactions')
      .select(
        'id, reference_number, booking_id, refund_amount, refund_date, refund_method, proof_file_path, status, processed_by_admin_id, notes, created_at, bookings(id, reference_number, leads(id, full_name), units(unit_code))'
      )
      .order('created_at', { ascending: false }),
    supabase.from('v_staff_directory').select('profile_id, full_name'),
  ]);

  const staffMap = new Map(
    (staffDirRes.data ?? []).map((s) => [s.profile_id, s.full_name])
  );

  const rawRecords = recordsRes.data ?? [];
  const recordRefById = new Map(
    rawRecords.map((r) => [r.id, r.reference_number])
  );

  const mappedRecords: PaymentsWorkspaceRecordDto[] = rawRecords.map((r) => {
    const schedRel = Array.isArray(r.payment_schedules)
      ? r.payment_schedules[0]
      : r.payment_schedules;
    const bookingRel = Array.isArray(r.bookings) ? r.bookings[0] : r.bookings;
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

    return {
      id: r.id,
      referenceNumber: r.reference_number,
      bookingId: r.booking_id,
      bookingReference: bookingRel?.reference_number ?? '-',
      bookingStatus: (bookingRel?.status ?? 'PENDING_FEE') as BookingStatus,
      bookingExpiresAt: bookingRel?.expires_at ?? r.submitted_at,
      paymentMethod: (bookingRel?.payment_method ?? 'KPR') as PaymentMethod,
      prospectName: leadRel?.full_name ?? 'Konsumen FIM',
      unitCode: unitRel?.unit_code ?? '-',
      projectName: projectRel?.name ?? 'Proyek FIM',
      scheduleId: r.payment_schedule_id,
      scheduleTitle: schedRel?.title ?? 'Termin Pembayaran',
      scheduleType: (schedRel?.schedule_type ?? 'BOOKING_FEE') as ScheduleType,
      scheduledAmount: Number(schedRel?.scheduled_amount ?? r.paid_amount),
      scheduleRemainingAmount: Number(schedRel?.remaining_amount ?? 0),
      paidAmount: Number(r.paid_amount),
      paymentDate: r.payment_date,
      paymentChannel: r.payment_channel,
      proofFilePath: r.proof_file_path,
      proofFileName: r.proof_file_name,
      replacesPaymentRef: r.replaces_payment_id
        ? (recordRefById.get(r.replaces_payment_id) ?? 'Bukti Sebelumnya')
        : null,
      verificationStatus: r.verification_status as PaymentVerificationStatus,
      submittedAt: r.submitted_at,
      submittedByName: staffMap.get(r.submitted_by_sales_id) ?? 'Sales FIM',
      salesNotes: r.sales_notes,
      verifiedByName: r.verified_by_admin_id
        ? (staffMap.get(r.verified_by_admin_id) ?? 'Admin FIM')
        : null,
      verifiedAt: r.verified_at,
      verificationNotes: r.verification_notes,
    };
  });

  // Urutkan PENDING_VERIFICATION paling lama di atas (submitted_at ASC), sisanya terbaru di atas
  const pendingRecords = mappedRecords
    .filter((r) => r.verificationStatus === 'PENDING_VERIFICATION')
    .sort(
      (a, b) =>
        new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    );
  const completedRecords = mappedRecords
    .filter((r) => r.verificationStatus !== 'PENDING_VERIFICATION')
    .sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );

  const schedules: PaymentsWorkspaceScheduleDto[] = (schedulesRes.data ?? []).map(
    (s) => {
      const bookingRel = Array.isArray(s.bookings) ? s.bookings[0] : s.bookings;
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

      return {
        id: s.id,
        bookingId: s.booking_id,
        bookingReference: bookingRel?.reference_number ?? '-',
        bookingStatus: (bookingRel?.status ?? 'PENDING_FEE') as BookingStatus,
        prospectName: leadRel?.full_name ?? 'Konsumen FIM',
        unitCode: unitRel?.unit_code ?? '-',
        projectName: projectRel?.name ?? 'Proyek FIM',
        scheduleType: s.schedule_type as ScheduleType,
        installmentNumber: Number(s.installment_number),
        title: s.title,
        scheduledAmount: Number(s.scheduled_amount),
        verifiedPaidAmount: Number(s.verified_paid_amount),
        remainingAmount: Number(s.remaining_amount),
        dueDate: s.due_date,
        status: s.status as ScheduleStatus,
      };
    }
  );

  const refunds: PaymentsWorkspaceRefundDto[] = (refundsRes.data ?? []).map(
    (rf) => {
      const bookingRel = Array.isArray(rf.bookings)
        ? rf.bookings[0]
        : rf.bookings;
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

      return {
        id: rf.id,
        referenceNumber: rf.reference_number,
        bookingId: rf.booking_id,
        bookingReference: bookingRel?.reference_number ?? '-',
        prospectName: leadRel?.full_name ?? 'Konsumen FIM',
        unitCode: unitRel?.unit_code ?? '-',
        refundAmount: Number(rf.refund_amount),
        refundDate: rf.refund_date,
        refundMethod: rf.refund_method,
        proofFilePath: rf.proof_file_path,
        status: rf.status as RefundStatus,
        processedByName:
          staffMap.get(rf.processed_by_admin_id) ?? 'Admin FIM',
        notes: rf.notes,
        createdAt: rf.created_at,
      };
    }
  );

  return (
    <PaymentsWorkspaceClient
      userRole={user.systemRole}
      records={[...pendingRecords, ...completedRecords]}
      schedules={schedules}
      refunds={refunds}
      referenceNowMs={referenceNowMs}
    />
  );
}
