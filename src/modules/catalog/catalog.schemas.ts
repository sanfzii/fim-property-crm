// Lokasi: src/modules/catalog/catalog.schemas.ts
// Level Topologis: L1-L4 (Validasi Input Katalog Properti, Harga & Promo)

import { z } from 'zod';

export const createDeveloperSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(20),
  name: z.string().trim().min(2).max(150),
  address: z.string().trim().min(5).max(500),
  picName: z.string().trim().min(2).max(120),
  picPhone: z.string().trim().regex(/^[0-9+()-\s]{8,30}$/),
  picEmail: z.string().trim().email().max(150).optional().nullable(),
  policyNotes: z.string().trim().max(1000).optional().nullable(),
});

export const createProjectSchema = z.object({
  developerId: z.string().uuid(),
  code: z.string().trim().toUpperCase().min(2).max(30),
  name: z.string().trim().min(2).max(150),
  province: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  district: z.string().trim().min(2).max(100),
  address: z.string().trim().min(5).max(500),
  facilities: z.string().trim().max(1000).optional().nullable(),
  status: z
    .enum(['PRE_LAUNCH', 'ACTIVE_SELLING', 'SOLD_OUT', 'CLOSED'])
    .default('ACTIVE_SELLING'),
});

export const updateProjectCommissionSchema = z.object({
  projectId: z.string().uuid(),
  commissionRate: z.number().min(0).max(100).nullable(),
});

export const createPropertyTypeSchema = z.object({
  projectId: z.string().uuid(),
  code: z.string().trim().toUpperCase().min(2).max(30),
  name: z.string().trim().min(2).max(120),
  standardLandArea: z.number().positive('Luas tanah standar harus > 0.'),
  standardBuildingArea: z.number().positive('Luas bangunan standar harus > 0.'),
  bedrooms: z.number().int().min(0).max(20).default(2),
  bathrooms: z.number().int().min(0).max(20).default(1),
  electricityWatt: z.number().int().positive().default(1300),
  specifications: z.string().trim().max(1500).optional().nullable(),
});

export const createUnitSchema = z.object({
  projectId: z.string().uuid(),
  propertyTypeId: z.string().uuid(),
  unitCode: z.string().trim().toUpperCase().min(1).max(30),
  blockNumber: z.string().trim().min(1).max(20),
  landArea: z.number().positive('Luas tanah aktual harus > 0.'),
  buildingArea: z.number().positive('Luas bangunan aktual harus > 0.'),
  catalogPrice: z.number().positive('Harga katalog harus > Rp 0.'),
  orientation: z.string().trim().max(50).optional().nullable(),
  isHook: z.boolean().default(false),
});

export const updateUnitCatalogPriceSchema = z.object({
  unitId: z.string().uuid('ID Unit tidak valid.'),
  newPrice: z.number().positive('Harga terbaru wajib lebih besar dari Rp 0.'),
  reason: z
    .string({ error: 'Alasan perubahan harga wajib diisi.' })
    .trim()
    .min(10, 'Alasan perubahan harga wajib diisi minimal 10 karakter (BR-03).')
    .max(500),
});

export const createPromotionSchema = z
  .object({
    projectId: z.string().uuid(),
    propertyTypeId: z.string().uuid().optional().nullable(),
    code: z.string().trim().toUpperCase().min(2).max(30),
    name: z.string().trim().min(3).max(150),
    description: z.string().trim().min(5).max(1000),
    promoType: z.enum(['NOMINAL_DISCOUNT', 'PERCENTAGE_DISCOUNT', 'FREE_BENEFIT']),
    discountValue: z.number().min(0).default(0),
    bonusDescription: z.string().trim().max(500).optional().nullable(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD.'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD.'),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'Tanggal berakhir promo harus sama atau setelah tanggal mulai.',
    path: ['endDate'],
  })
  .refine(
    (data) =>
      data.promoType !== 'PERCENTAGE_DISCOUNT' ||
      (data.discountValue > 0 && data.discountValue <= 100),
    {
      message: 'Diskon persentase harus berada di antara 0.01% hingga 100%.',
      path: ['discountValue'],
    }
  );
