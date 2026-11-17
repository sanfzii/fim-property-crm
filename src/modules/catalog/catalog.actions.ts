// Lokasi: src/modules/catalog/catalog.actions.ts
// Layer 3: Server Actions untuk Modul D, E, F, dan G

'use server';

import { revalidatePath } from 'next/cache';
import { executeSafeServerAction } from '@/lib/errors/app-error';
import { requireActionAuth } from '@/modules/identity/auth/auth.guards';
import {
  createDeveloperSchema,
  createProjectSchema,
  createPromotionSchema,
  createPropertyTypeSchema,
  createUnitSchema,
  updateUnitCatalogPriceSchema,
  updateProjectCommissionSchema,
} from './catalog.schemas';
import { CatalogService } from './catalog.service';
import { PricingUpdateOrchestrator } from './pricing-promotions/pricing.orchestrator';

export async function createDeveloperAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'catalog', action: 'createDeveloperAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = createDeveloperSchema.parse(rawInput);
      const data = await CatalogService.createDeveloper(actor, validated);
      revalidatePath('/catalog');
      return { message: `Developer ${data.name} berhasil ditambahkan.`, data };
    }
  );
}

export async function createProjectAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'catalog', action: 'createProjectAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = createProjectSchema.parse(rawInput);
      const data = await CatalogService.createProject(actor, validated);
      revalidatePath('/catalog');
      return { message: `Proyek ${data.name} berhasil ditambahkan.`, data };
    }
  );
}

export async function createPropertyTypeAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'catalog', action: 'createPropertyTypeAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = createPropertyTypeSchema.parse(rawInput);
      const data = await CatalogService.createPropertyType(actor, validated);
      revalidatePath('/catalog');
      return { message: `Tipe properti ${data.name} berhasil ditambahkan.`, data };
    }
  );
}

export async function updateProjectCommissionAction(rawInput: unknown) {
  return executeSafeServerAction({ module: 'catalog', action: 'updateProjectCommissionAction' }, async () => {
    const actor = await requireActionAuth(['ADMIN']);
    const validated = updateProjectCommissionSchema.parse(rawInput);
    const data = await CatalogService.updateProjectCommission(actor, validated);
    revalidatePath('/catalog');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    return { message: 'Persentase komisi proyek diperbarui.', data };
  });
}

export async function createUnitAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'catalog', action: 'createUnitAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = createUnitSchema.parse(rawInput);
      const data = await CatalogService.createUnit(actor, validated);
      revalidatePath('/catalog');
      return { message: `Unit ${data.unit_code} berhasil ditambahkan ke katalog.`, data };
    }
  );
}

export async function updateUnitCatalogPriceAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'catalog', action: 'updateUnitCatalogPriceAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = updateUnitCatalogPriceSchema.parse(rawInput);
      const data = await PricingUpdateOrchestrator.updateUnitPriceAndNotify(actor, validated);
      revalidatePath('/catalog');
      revalidatePath('/leads');
      return {
        message: `Harga katalog Unit ${data.unitCode} berhasil diperbarui dan riwayat perubahan telah dicatat.`,
        data,
      };
    }
  );
}

export async function createPromotionAction(rawInput: unknown) {
  return executeSafeServerAction(
    { module: 'catalog', action: 'createPromotionAction' },
    async () => {
      const actor = await requireActionAuth(['ADMIN']);
      const validated = createPromotionSchema.parse(rawInput);
      const data = await CatalogService.createPromotion(actor, validated);
      revalidatePath('/catalog');
      return { message: `Program promo ${data.name} berhasil diterbitkan.`, data };
    }
  );
}
