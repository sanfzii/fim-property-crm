'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { executeSafeServerAction } from '@/lib/errors/app-error';
import { requireActionAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AuditSink } from '@/modules/shared/audit/audit.sink';

const settingsSchema = z.object({
  salesSplitRate: z.number().min(0).max(100),
  supervisorSplitRate: z.number().min(0).max(100),
  salesBaseSalary: z.number().min(0),
  supervisorBaseSalary: z.number().min(0),
}).refine((v) => v.salesSplitRate + v.supervisorSplitRate <= 100, { message: 'Bagian Sales dan Supervisor maksimal 100%.' });

const receiptSchema = z.object({ dealId: z.string().uuid(), amount: z.number().positive(), receivedOn: z.string().date(), transferReference: z.string().trim().min(3).max(120), notes: z.string().trim().max(500).optional().nullable() });
const backfillSchema = z.object({ dealId: z.string().uuid(), commissionRate: z.number().min(0).max(100) });

export async function backfillLegacyDealCommissionAction(raw: unknown) {
  return executeSafeServerAction({ module: 'finance', action: 'backfillLegacyDealCommissionAction' }, async () => {
    const actor = await requireActionAuth(['ADMIN']);
    const input = backfillSchema.parse(raw);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('backfill_legacy_deal_commission', {
      p_deal_id: input.dealId,
      p_commission_rate: input.commissionRate,
    });
    if (error || !data) throw new Error(error?.message ?? 'Snapshot komisi gagal disimpan.');
    await AuditSink.record({ actorUserId: actor.userId, actorRole: actor.systemRole, actionType: 'LEGACY_DEAL_COMMISSION_SNAPSHOTTED', entityTable: 'deals', entityId: input.dealId, newValues: data as Record<string, unknown> });
    revalidatePath('/dashboard'); revalidatePath('/reports'); revalidatePath('/admin/finance'); revalidatePath('/deals');
    return { message: 'Snapshot komisi Deal lama berhasil disimpan.', data };
  });
}

export async function updateFinanceSettingsAction(raw: unknown) {
  return executeSafeServerAction({ module: 'finance', action: 'updateFinanceSettingsAction' }, async () => {
    const actor = await requireActionAuth(['ADMIN']);
    const input = settingsSchema.parse(raw);
    const supabase = await createSupabaseServerClient();
    const { data: oldValues } = await supabase.from('finance_settings').select('*').eq('id', true).maybeSingle();
    const { data, error } = await supabase.from('finance_settings').upsert({ id: true, sales_split_rate: input.salesSplitRate, supervisor_split_rate: input.supervisorSplitRate, sales_base_salary: input.salesBaseSalary, supervisor_base_salary: input.supervisorBaseSalary, updated_by: actor.userId, updated_at: new Date().toISOString() }).select('*').single();
    if (error || !data) throw new Error(error?.message ?? 'Pengaturan keuangan gagal disimpan.');
    await AuditSink.record({ actorUserId: actor.userId, actorRole: actor.systemRole, actionType: 'FINANCE_SETTINGS_UPDATED', entityTable: 'finance_settings', entityId: actor.userId, oldValues: oldValues ?? undefined, newValues: data });
    revalidatePath('/dashboard'); revalidatePath('/reports'); revalidatePath('/admin/finance');
    return { message: 'Pengaturan keuangan berhasil disimpan.', data };
  });
}

export async function recordDeveloperCommissionReceiptAction(raw: unknown) {
  return executeSafeServerAction({ module: 'finance', action: 'recordDeveloperCommissionReceiptAction' }, async () => {
    const actor = await requireActionAuth(['ADMIN']);
    const input = receiptSchema.parse(raw);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from('developer_commission_receipts').insert({ deal_id: input.dealId, amount: input.amount, received_on: input.receivedOn, transfer_reference: input.transferReference, recorded_by: actor.userId, notes: input.notes ?? null }).select('*').single();
    if (error || !data) throw new Error(error?.message ?? 'Penerimaan komisi gagal dicatat.');
    await AuditSink.record({ actorUserId: actor.userId, actorRole: actor.systemRole, actionType: 'DEVELOPER_COMMISSION_RECEIPT_RECORDED', entityTable: 'developer_commission_receipts', entityId: data.id, newValues: data });
    revalidatePath('/dashboard'); revalidatePath('/reports'); revalidatePath('/admin/finance');
    return { message: 'Penerimaan komisi developer dicatat.', data };
  });
}
