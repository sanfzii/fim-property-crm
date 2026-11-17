// Lokasi: src/app/(protected)/bookings/page.tsx
// Server Component Halaman Daftar Booking & Reservasi (/bookings — ADMIN, SUPERVISOR, SALES)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { BookingStatus, PaymentMethod } from '@/types/database.types';
import {
  BookingsWorkspaceClient,
  type BookingListItemDto,
} from '@/components/bookings/BookingsWorkspaceClient';

export const dynamic = 'force-dynamic';

function getServerNowMs(): number {
  return Date.now();
}

export default async function BookingsPage() {
  await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const supabase = await createSupabaseServerClient();
  const referenceNowMs = getServerNowMs();

  const [bookingsRes, teamsRes, staffDirRes, pendingPaymentsRes] =
    await Promise.all([
      supabase
        .from('bookings')
        .select(
          'id, reference_number, lead_id, unit_id, current_sales_id, team_id, payment_method, agreed_final_price, booking_fee_amount, status, booked_at, expires_at, leads(id, full_name, phone), units(id, unit_code, block_number, property_projects(name))'
        )
        .order('booked_at', { ascending: false }),
      supabase.from('teams').select('id, code, name'),
      supabase.from('v_staff_directory').select('profile_id, full_name'),
      supabase
        .from('payment_records')
        .select('booking_id')
        .eq('verification_status', 'PENDING_VERIFICATION'),
    ]);

  const teamMap = new Map((teamsRes.data ?? []).map((t) => [t.id, t]));
  const staffMap = new Map(
    (staffDirRes.data ?? []).map((s) => [s.profile_id, s.full_name])
  );
  const pendingBookingIds = new Set(
    (pendingPaymentsRes.data ?? []).map((p) => p.booking_id)
  );

  const bookings: BookingListItemDto[] = (bookingsRes.data ?? []).map((row) => {
    const leadRel = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    const unitRel = Array.isArray(row.units) ? row.units[0] : row.units;
    const projectRel = unitRel?.property_projects
      ? Array.isArray(unitRel.property_projects)
        ? unitRel.property_projects[0]
        : unitRel.property_projects
      : null;

    return {
      id: row.id,
      referenceNumber: row.reference_number,
      leadId: row.lead_id,
      leadFullName: leadRel?.full_name ?? 'Konsumen FIM',
      leadPhone: leadRel?.phone ?? '-',
      unitId: row.unit_id,
      unitCode: unitRel?.unit_code ?? '-',
      blockNumber: unitRel?.block_number ?? '-',
      projectName: projectRel?.name ?? 'Proyek FIM',
      salesName: staffMap.get(row.current_sales_id) ?? 'Sales FIM',
      teamCode: teamMap.get(row.team_id)?.code ?? '-',
      paymentMethod: row.payment_method as PaymentMethod,
      agreedFinalPrice: Number(row.agreed_final_price),
      bookingFeeAmount: Number(row.booking_fee_amount),
      status: row.status as BookingStatus,
      bookedAt: row.booked_at,
      expiresAt: row.expires_at,
      hasPendingVerificationPayment: pendingBookingIds.has(row.id),
    };
  });

  return (
    <BookingsWorkspaceClient
      bookings={bookings}
      referenceNowMs={referenceNowMs}
    />
  );
}
