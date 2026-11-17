// Lokasi: src/modules/analytics/metrics.service.ts
// Level Topologis: L11 (Layanan Agregasi Akhir untuk Modul S [Dashboard] & Modul T [Reporting])

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { translateDatabaseOrRpcError } from '@/lib/errors/app-error';

export interface StandardizedExecutiveMetrics {
  // 1. Metrik Lead & Temperatur
  leads: {
    totalActiveLeads: number;
    hotLeadsCount: number;
    warmLeadsCount: number;
    coldLeadsCount: number;
  };
  // 2. Metrik Penjualan & Kontrak (Dipisahkan tegas sesuai Kamus Metrik Bagian 3.1)
  salesAndContracts: {
    salesClosingsCount: number; // Jumlah Deal dengan sales_outcome_status = 'CLOSED_WON'
    totalContractedSalesValue: number; // Sum(final_deal_value) dari Deal 'CLOSED_WON'
    activeUnderContractCount: number; // Deal dengan contract_status = 'UNDER_CONTRACT'
  };
  // 3. Metrik Realisasi Kas, Refund & Piutang
  finance: {
    estimatedDeveloperCommission: number;
    developerCommissionReceived: number;
    developerCommissionOutstanding: number;
    salesCommissionAllocation: number;
    supervisorCommissionAllocation: number;
    companyCommissionAllocation: number;
    consumerPaymentsVerified: number;
    closedDealsWithoutCommissionConfig: number;
    grossVerifiedCashInflow: number; // Sum(paid_amount) dari payment_records 'VERIFIED'
    totalRefundedOutflow: number; // Sum(refund_amount) dari refund_transactions 'COMPLETED'
    netVerifiedCashInflow: number; // Gross Verified - Total Refunded
    totalForfeitedRetainedFunds: number; // Sum(forfeited_retained_amount) dari bookings 'CANCELLED'
    outstandingReceivablesTotal: number; // Sum(remaining_amount) dari jadwal aktif belum 'PAID'
    overdueReceivablesAmount: number; // Sum(remaining_amount) dari jadwal berstatus 'OVERDUE'
    pendingVerificationCount: number; // Antrean bukti bayar 'PENDING_VERIFICATION'
  };
  // 4. Metrik Status Inventaris Unit (Ketetapan Final TC-01A: SOLD hanya saat lunas / 100% FULLY_DISBURSED)
  unitInventory: {
    availableUnitsCount: number; // status = 'AVAILABLE'
    heldUnitsCount: number; // status = 'HELD' (Ditahan sementara 72 jam)
    unitsUnderContractOrBookedCount: number; // status = 'BOOKED' (Termasuk Cash Bertahap Under Contract & KPR belum cair 100%)
    unitsFullySoldCount: number; // status = 'SOLD' (Lunas 100% / KPR FULLY_DISBURSED)
  };
  // 5. Metrik Pencairan KPR (Hanya pengajuan berstatus APPROVED / COMPLETED)
  kprDisbursementSummary: {
    totalApprovedLoanPlafond: number;
    totalPrimaryDisbursed: number;
    totalSubsequentDisbursed: number;
    totalRemainingUndisbursed: number;
  };
}

export const ExecutiveMetricsService = {
  /**
   * Mengambil seluruh metrik standar sesuai cakupan RLS pengguna yang sedang login
   * (Sales = Pribadi, Supervisor = Timnya, Admin = Seluruh Perusahaan).
   * Side effect system sweep dijadwalkan oleh page layer dengan `after()` agar
   * tidak memblokir response metrik.
   */
  async getStandardizedMetrics(): Promise<StandardizedExecutiveMetrics> {
    const supabase = await createSupabaseServerClient();

    const [
      leadsRes,
      dealsRes,
      verifiedPaymentsRes,
      pendingPaymentsRes,
      completedRefundsRes,
      cancelledBookingsRes,
      activeSchedulesRes,
      unitsRes,
      kprAppsRes,
    ] = await Promise.all([
      supabase
        .from('leads')
        .select('id, lead_temperature, pipeline_stage')
        .not('pipeline_stage', 'in', '("CLOSED_WON","CLOSED_LOST")'),
      supabase
        .from('deals')
        .select(
          'id, final_deal_value, sales_outcome_status, contract_status, payment_settlement_status, commission_rate_snapshot, commission_total_snapshot, commission_received_amount, sales_commission_snapshot, supervisor_commission_snapshot, company_commission_snapshot'
        ),
      supabase
        .from('payment_records')
        .select('paid_amount')
        .eq('verification_status', 'VERIFIED'),
      supabase
        .from('payment_records')
        .select('id', { count: 'exact', head: true })
        .eq('verification_status', 'PENDING_VERIFICATION'),
      supabase
        .from('refund_transactions')
        .select('refund_amount')
        .eq('status', 'COMPLETED'),
      supabase
        .from('bookings')
        .select('forfeited_retained_amount')
        .eq('status', 'CANCELLED'),
      supabase
        .from('payment_schedules')
        .select('remaining_amount, status')
        .in('status', ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE']),
      supabase.from('units').select('status'),
      supabase
        .from('kpr_applications')
        .select(
          'approved_loan_amount, primary_disbursed_amount, subsequent_disbursed_amount, remaining_undisbursed_amount'
        )
        .in('application_status', ['APPROVED', 'COMPLETED'])
        .not('approved_loan_amount', 'is', null),
    ]);

    if (leadsRes.error) throw translateDatabaseOrRpcError(leadsRes.error);
    if (dealsRes.error) throw translateDatabaseOrRpcError(dealsRes.error);
    if (verifiedPaymentsRes.error) throw translateDatabaseOrRpcError(verifiedPaymentsRes.error);
    if (pendingPaymentsRes.error) throw translateDatabaseOrRpcError(pendingPaymentsRes.error);
    if (completedRefundsRes.error) throw translateDatabaseOrRpcError(completedRefundsRes.error);
    if (cancelledBookingsRes.error) throw translateDatabaseOrRpcError(cancelledBookingsRes.error);
    if (activeSchedulesRes.error) throw translateDatabaseOrRpcError(activeSchedulesRes.error);
    if (unitsRes.error) throw translateDatabaseOrRpcError(unitsRes.error);
    if (kprAppsRes.error) throw translateDatabaseOrRpcError(kprAppsRes.error);

    const leads = leadsRes.data ?? [];
    const deals = dealsRes.data ?? [];
    const verifiedPayments = verifiedPaymentsRes.data ?? [];
    const completedRefunds = completedRefundsRes.data ?? [];
    const cancelledBookings = cancelledBookingsRes.data ?? [];
    const activeSchedules = activeSchedulesRes.data ?? [];
    const units = unitsRes.data ?? [];
    const kprApps = kprAppsRes.data ?? [];
    const commissionDeals = deals.filter((d) => d.commission_total_snapshot !== null);

    const closedWonDeals = deals.filter((d) => d.sales_outcome_status === 'CLOSED_WON');
    const underContractDeals = deals.filter(
      (d) => d.contract_status === 'UNDER_CONTRACT'
    );

    const grossVerifiedCashInflow = verifiedPayments.reduce(
      (sum, r) => sum + Number(r.paid_amount),
      0
    );
    const totalRefundedOutflow = completedRefunds.reduce(
      (sum, r) => sum + Number(r.refund_amount),
      0
    );
    const totalForfeitedRetainedFunds = cancelledBookings.reduce(
      (sum, b) => sum + Number(b.forfeited_retained_amount),
      0
    );

    const outstandingReceivablesTotal = activeSchedules.reduce(
      (sum, s) => sum + Number(s.remaining_amount),
      0
    );
    const overdueReceivablesAmount = activeSchedules
      .filter((s) => s.status === 'OVERDUE')
      .reduce((sum, s) => sum + Number(s.remaining_amount), 0);

    return {
      leads: {
        totalActiveLeads: leads.length,
        hotLeadsCount: leads.filter((l) => l.lead_temperature === 'HOT').length,
        warmLeadsCount: leads.filter((l) => l.lead_temperature === 'WARM').length,
        coldLeadsCount: leads.filter((l) => l.lead_temperature === 'COLD').length,
      },
      salesAndContracts: {
        salesClosingsCount: closedWonDeals.length,
        totalContractedSalesValue: closedWonDeals.reduce(
          (sum, d) => sum + Number(d.final_deal_value),
          0
        ),
        activeUnderContractCount: underContractDeals.length,
      },
      finance: {
        estimatedDeveloperCommission: commissionDeals.reduce((sum, d) => sum + Number(d.commission_total_snapshot ?? 0), 0),
        developerCommissionReceived: commissionDeals.reduce((sum, d) => sum + Number(d.commission_received_amount ?? 0), 0),
        developerCommissionOutstanding: commissionDeals.reduce((sum, d) => sum + Math.max(0, Number(d.commission_total_snapshot ?? 0) - Number(d.commission_received_amount ?? 0)), 0),
        salesCommissionAllocation: commissionDeals.reduce((sum, d) => sum + Number(d.sales_commission_snapshot ?? 0), 0),
        supervisorCommissionAllocation: commissionDeals.reduce((sum, d) => sum + Number(d.supervisor_commission_snapshot ?? 0), 0),
        companyCommissionAllocation: commissionDeals.reduce((sum, d) => sum + Number(d.company_commission_snapshot ?? 0), 0),
        consumerPaymentsVerified: grossVerifiedCashInflow,
        closedDealsWithoutCommissionConfig: deals.filter((d) => d.sales_outcome_status === 'CLOSED_WON' && d.commission_rate_snapshot === null).length,
        grossVerifiedCashInflow,
        totalRefundedOutflow,
        netVerifiedCashInflow: grossVerifiedCashInflow - totalRefundedOutflow,
        totalForfeitedRetainedFunds,
        outstandingReceivablesTotal,
        overdueReceivablesAmount,
        pendingVerificationCount: pendingPaymentsRes.count ?? 0,
      },
      unitInventory: {
        availableUnitsCount: units.filter((u) => u.status === 'AVAILABLE').length,
        heldUnitsCount: units.filter((u) => u.status === 'HELD').length,
        unitsUnderContractOrBookedCount: units.filter((u) => u.status === 'BOOKED')
          .length,
        unitsFullySoldCount: units.filter((u) => u.status === 'SOLD').length,
      },
      kprDisbursementSummary: {
        totalApprovedLoanPlafond: kprApps.reduce(
          (sum, k) => sum + Number(k.approved_loan_amount ?? 0),
          0
        ),
        totalPrimaryDisbursed: kprApps.reduce(
          (sum, k) => sum + Number(k.primary_disbursed_amount ?? 0),
          0
        ),
        totalSubsequentDisbursed: kprApps.reduce(
          (sum, k) => sum + Number(k.subsequent_disbursed_amount ?? 0),
          0
        ),
        totalRemainingUndisbursed: kprApps.reduce(
          (sum, k) => sum + Number(k.remaining_undisbursed_amount ?? 0),
          0
        ),
      },
    };
  },
};
