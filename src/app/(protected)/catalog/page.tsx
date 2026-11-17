// Lokasi: src/app/(protected)/catalog/page.tsx
// Server Component Halaman Katalog Properti, Matriks Unit & Promo (/catalog — ADMIN, SUPERVISOR, SALES)

import React from 'react';
import { requirePageAuth } from '@/modules/identity/auth/auth.guards';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CatalogService } from '@/modules/catalog/catalog.service';
import {
  CatalogWorkspaceClient,
  type CatalogDeveloperDto,
  type CatalogProjectDto,
  type CatalogPropertyTypeDto,
  type CatalogPromotionDto,
  type CatalogPriceHistoryDto,
} from '@/components/catalog/CatalogWorkspaceClient';

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const user = await requirePageAuth(['ADMIN', 'SUPERVISOR', 'SALES']);
  const [units, supabase] = await Promise.all([
    CatalogService.listUnitCatalog(),
    createSupabaseServerClient(),
  ]);

  const [
    developersRes,
    projectsRes,
    propertyTypesRes,
    promotionsRes,
    priceHistoriesRes,
    staffDirRes,
    commissionHistoryRes,
  ] = await Promise.all([
    supabase
      .from('developers')
      .select(
        'id, code, name, address, pic_name, pic_phone, pic_email, policy_notes, is_active'
      )
      .order('code', { ascending: true }),
    supabase
      .from('property_projects')
      .select(
        'id, developer_id, code, name, province, city, district, address, facilities, status, developer_commission_rate'
      )
      .order('code', { ascending: true }),
    supabase
      .from('property_types')
      .select(
        'id, project_id, code, name, standard_land_area, standard_building_area, bedrooms, bathrooms, electricity_watt, specifications, is_active'
      )
      .order('code', { ascending: true }),
    supabase
      .from('promotions')
      .select(
        'id, project_id, property_type_id, code, name, description, promo_type, discount_value, bonus_description, start_date, end_date, is_active'
      )
      .order('start_date', { ascending: false }),
    supabase
      .from('unit_price_histories')
      .select('id, unit_id, old_price, new_price, reason, changed_by, changed_at')
      .order('changed_at', { ascending: false }),
    supabase
      .from('v_staff_directory')
      .select('profile_id, full_name, system_role'),
    supabase.from('project_commission_rate_histories').select('id, project_id, old_rate, new_rate, changed_at, changed_by').order('changed_at', { ascending: false }),
  ]);

  const developerNameById = new Map(
    (developersRes.data ?? []).map((d) => [d.id, d.name])
  );
  const projectNameById = new Map(
    (projectsRes.data ?? []).map((p) => [p.id, p.name])
  );
  const propertyTypeNameById = new Map(
    (propertyTypesRes.data ?? []).map((pt) => [pt.id, pt.name])
  );
  const unitById = new Map(units.map((u) => [u.id, u]));

  // Privasi OQ-05: hanya gunakan nama depan + role untuk label pencatat perubahan harga
  const staffFirstNameById = new Map(
    (staffDirRes.data ?? []).map((s) => {
      const firstName = (s.full_name ?? '').trim().split(/\s+/)[0] || 'Admin';
      return [s.profile_id, `${firstName} (${s.system_role})`];
    })
  );

  const developers: CatalogDeveloperDto[] = (developersRes.data ?? []).map(
    (d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      address: d.address,
      picName: d.pic_name,
      picPhone: d.pic_phone,
      picEmail: d.pic_email,
      policyNotes: d.policy_notes,
      isActive: d.is_active,
    })
  );

  const projects: CatalogProjectDto[] = (projectsRes.data ?? []).map((p) => ({
    id: p.id,
    developerId: p.developer_id,
    developerName: developerNameById.get(p.developer_id) ?? 'Developer Mitra',
    code: p.code,
    name: p.name,
    province: p.province,
    city: p.city,
    district: p.district,
    address: p.address,
    facilities: p.facilities,
    status: p.status,
    commissionRate: user.systemRole === 'ADMIN' && p.developer_commission_rate !== null ? Number(p.developer_commission_rate) : null,
    commissionHistory: user.systemRole === 'ADMIN' ? (commissionHistoryRes.data ?? []).filter((h) => h.project_id === p.id).map((h) => ({ id: h.id, oldRate: h.old_rate === null ? null : Number(h.old_rate), newRate: h.new_rate === null ? null : Number(h.new_rate), changedAt: h.changed_at, changedBy: h.changed_by ? (staffFirstNameById.get(h.changed_by) ?? 'Admin') : 'Sistem' })) : [],
  }));

  const propertyTypes: CatalogPropertyTypeDto[] = (
    propertyTypesRes.data ?? []
  ).map((pt) => ({
    id: pt.id,
    projectId: pt.project_id,
    projectName: projectNameById.get(pt.project_id) ?? 'Proyek FIM',
    code: pt.code,
    name: pt.name,
    standardLandArea: Number(pt.standard_land_area),
    standardBuildingArea: Number(pt.standard_building_area),
    bedrooms: Number(pt.bedrooms),
    bathrooms: Number(pt.bathrooms),
    electricityWatt: Number(pt.electricity_watt),
    specifications: pt.specifications,
    isActive: pt.is_active,
  }));

  const promotions: CatalogPromotionDto[] = (promotionsRes.data ?? []).map(
    (pr) => ({
      id: pr.id,
      projectId: pr.project_id,
      projectName: projectNameById.get(pr.project_id) ?? 'Proyek FIM',
      propertyTypeId: pr.property_type_id,
      propertyTypeName: pr.property_type_id
        ? (propertyTypeNameById.get(pr.property_type_id) ?? null)
        : null,
      code: pr.code,
      name: pr.name,
      description: pr.description,
      promoType: pr.promo_type,
      discountValue: Number(pr.discount_value),
      bonusDescription: pr.bonus_description,
      startDate: pr.start_date,
      endDate: pr.end_date,
      isActive: pr.is_active,
    })
  );

  const priceHistories: CatalogPriceHistoryDto[] = (
    priceHistoriesRes.data ?? []
  ).map((ph) => {
    const unit = unitById.get(ph.unit_id);
    const oldPrice = Number(ph.old_price);
    const newPrice = Number(ph.new_price);
    return {
      id: ph.id,
      unitId: ph.unit_id,
      unitCode: unit?.unit_code ?? '-',
      projectName: unit?.project_name ?? 'Proyek FIM',
      oldPrice,
      newPrice,
      deltaAmount: newPrice - oldPrice,
      reason: ph.reason,
      changedByLabel: staffFirstNameById.get(ph.changed_by) ?? 'Admin FIM',
      changedAt: ph.changed_at,
    };
  });

  return (
    <CatalogWorkspaceClient
      userRole={user.systemRole}
      units={units}
      developers={developers}
      projects={projects}
      propertyTypes={propertyTypes}
      promotions={promotions}
      priceHistories={priceHistories}
    />
  );
}
