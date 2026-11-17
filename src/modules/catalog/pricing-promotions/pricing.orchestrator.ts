// Lokasi: src/modules/catalog/pricing-promotions/pricing.orchestrator.ts
// Level Topologis: L10 (Use-Case Orchestrator — Mengoordinasikan F[L3], G-Core[L4], I-UseCase[L7], Q-Sink[L0], U-Sink[L0])

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AppError, translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { AuditSink } from '@/modules/shared/audit/audit.sink';
import { NotificationSink } from '@/modules/shared/notifications/notification.sink';
import { ProspectScoringUseCase } from '@/modules/crm/scoring-usecase/scoring.usecase';
import type { AuthenticatedUserContext } from '@/types/database.types';
import type { z } from 'zod';
import type { updateUnitCatalogPriceSchema } from '../catalog.schemas';

export const PricingUpdateOrchestrator = {
  async updateUnitPriceAndNotify(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof updateUnitCatalogPriceSchema>
  ) {
    const supabase = await createSupabaseServerClient();

    // 1. Ambil data unit saat ini
    const { data: unit, error: unitErr } = await supabase
      .from('units')
      .select('id, project_id, property_type_id, unit_code, catalog_price, status')
      .eq('id', input.unitId)
      .single();

    if (unitErr || !unit) {
      throw translateDatabaseOrRpcError(unitErr);
    }

    const oldPrice = Number(unit.catalog_price);
    if (oldPrice === input.newPrice) {
      throw new AppError({
        message: 'Harga katalog baru tidak boleh sama persis dengan harga katalog sebelumnya.',
        category: 'VALIDATION_ERROR',
        code: 'UNCHANGED_CATALOG_PRICE',
        statusCode: 400,
      });
    }

    // 2. Perbarui harga katalog pada tabel units (Catatan: Tabel bookings TIDAK disentuh — BR-07 Price Freeze!)
    const { error: updateErr } = await supabase
      .from('units')
      .update({ catalog_price: input.newPrice })
      .eq('id', unit.id);

    if (updateErr) {
      throw translateDatabaseOrRpcError(updateErr);
    }

    // 3. Catat ke tabel riwayat unit_price_histories (BR-03)
    const { data: history, error: histErr } = await supabase
      .from('unit_price_histories')
      .insert({
        unit_id: unit.id,
        old_price: oldPrice,
        new_price: input.newPrice,
        reason: input.reason,
        changed_by: actor.userId,
      })
      .select('*')
      .single();

    if (histErr || !history) {
      // Compensating restore harga katalog agar tidak ada perubahan harga tanpa riwayat BR-03
      await supabase
        .from('units')
        .update({ catalog_price: oldPrice })
        .eq('id', unit.id);
      throw translateDatabaseOrRpcError(histErr);
    }

    // 4. Catat ke Audit Log
    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'UNIT_PRICE_UPDATED',
      entityTable: 'units',
      entityId: unit.id,
      oldValues: { catalog_price: oldPrice },
      newValues: { catalog_price: input.newPrice, price_history_id: history.id },
      reason: input.reason,
    });

    // 5. Cari Lead aktif (yang belum masuk tahap Booking/Closed) yang meminati proyek ini
    const { data: interestedLeads, error: leadsErr } = await supabase
      .from('leads')
      .select('id, full_name, assigned_sales_id')
      .eq('preferred_project_id', unit.project_id)
      .not('pipeline_stage', 'in', '("BOOKING","PAYMENT_KPR_PROCESS","CLOSED_WON","CLOSED_LOST")');

    if (leadsErr) {
      throw translateDatabaseOrRpcError(leadsErr);
    }

    if (interestedLeads && interestedLeads.length > 0) {
      // 5a. Hitung ulang skor Budget Compatibility untuk masing-masing Lead
      for (const lead of interestedLeads) {
        await ProspectScoringUseCase.recalculateAndPersistForLead(
          lead.id,
          'CATALOG_PRICE_CHANGE'
        );
      }

      // 5b. Kirim notifikasi perubahan harga ke Sales penanggung jawab (Idempotent via CST-12)
      const uniqueSalesIds = Array.from(
        new Set(interestedLeads.map((l) => l.assigned_sales_id))
      );

      await NotificationSink.publishDirectSafe(
        uniqueSalesIds.map((salesId) => ({
          recipientUserId: salesId,
          notificationType: 'UNIT_PRICE_CHANGED' as const,
          title: `Perubahan Harga Unit ${unit.unit_code}`,
          description: `Harga katalog Unit ${unit.unit_code} berubah dari Rp ${oldPrice.toLocaleString('id-ID')} menjadi Rp ${input.newPrice.toLocaleString('id-ID')}. Alasan: ${input.reason}`,
          referenceType: 'UNIT' as const,
          referenceId: unit.id,
          deduplicationKey: `PRICE_CHANGED:${history.id}`,
        }))
      );
    }

    return {
      unitId: unit.id,
      unitCode: unit.unit_code,
      oldPrice,
      newPrice: input.newPrice,
      priceHistoryId: history.id,
    };
  },
};
