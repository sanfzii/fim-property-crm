// Lokasi: src/modules/catalog/catalog.service.ts
// Level Topologis: L1-L4 (Service Layer untuk Modul D, E, F, dan G-Core)

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { translateDatabaseOrRpcError } from '@/lib/errors/app-error';
import { AuditSink } from '@/modules/shared/audit/audit.sink';
import type { AuthenticatedUserContext, UnitStatus } from '@/types/database.types';
import type { z } from 'zod';
import type {
  createDeveloperSchema,
  createProjectSchema,
  createPromotionSchema,
  createPropertyTypeSchema,
  createUnitSchema,
  updateProjectCommissionSchema,
} from './catalog.schemas';

export interface UnitHolderPrivacyInfo {
  currentHolderSalesFirstName: string | null;
  currentHolderTeamCode: string | null;
  currentHolderDisplayLabel: string | null;
}

export interface UnitCatalogDto {
  id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  project_city: string;
  developer_id: string;
  developer_name: string;
  property_type_id: string;
  property_type_code: string;
  property_type_name: string;
  unit_code: string;
  block_number: string;
  land_area: number;
  building_area: number;
  catalog_price: number;
  orientation: string | null;
  is_hook: boolean;
  status: UnitStatus;
  current_holder_sales_id: string | null;
  current_holder_team_id: string | null;
  current_holder_team_name: string | null;
  currentHolderSalesFirstName: string | null;
  currentHolderTeamCode: string | null;
  currentHolderDisplayLabel: string | null;
  status_updated_at: string;
}

interface RawUnitCatalogViewRow {
  id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  project_city: string;
  developer_id: string;
  developer_name: string;
  property_type_id: string;
  property_type_code: string;
  property_type_name: string;
  unit_code: string;
  block_number: string;
  land_area: number;
  building_area: number;
  catalog_price: number;
  orientation: string | null;
  is_hook: boolean;
  status: UnitStatus;
  current_holder_sales_id: string | null;
  current_holder_sales_name: string | null;
  current_holder_team_id: string | null;
  current_holder_team_name: string | null;
  status_updated_at: string;
}

/**
 * Fungsi murni pemformatan privasi pemegang unit sesuai OQ-05 & DESIGN.md Bagian 6.2:
 * - Jika unit berstatus 'AVAILABLE', seluruh informasi pemegang unit bernilai null.
 * - Jika unit berstatus 'HELD', 'BOOKED', atau 'SOLD', hanya mengekspos Nama Depan Sales
 *   dan Kode Tim (contoh: "Fariz • TIM-01") tanpa membocorkan nama lengkap staf, email, atau nomor HP.
 */
export function formatUnitHolderPrivacy(params: {
  status: UnitStatus;
  holderFullName?: string | null;
  holderTeamCode?: string | null;
}): UnitHolderPrivacyInfo {
  if (params.status === 'AVAILABLE') {
    return {
      currentHolderSalesFirstName: null,
      currentHolderTeamCode: null,
      currentHolderDisplayLabel: null,
    };
  }

  const trimmedName = (params.holderFullName ?? '').trim();
  const firstName = trimmedName.length > 0 ? (trimmedName.split(/\s+/)[0] ?? null) : null;
  const normalizedTeamCode = (params.holderTeamCode ?? '').trim().toUpperCase() || null;

  let displayLabel: string | null = null;
  if (firstName && normalizedTeamCode) {
    displayLabel = `${firstName} • ${normalizedTeamCode}`;
  } else if (firstName) {
    displayLabel = firstName;
  } else if (normalizedTeamCode) {
    displayLabel = normalizedTeamCode;
  }

  return {
    currentHolderSalesFirstName: firstName,
    currentHolderTeamCode: normalizedTeamCode,
    currentHolderDisplayLabel: displayLabel,
  };
}

export const CatalogService = {
  formatUnitHolderPrivacy,

  /**
   * Membaca katalog unit beserta nama depan Sales & kode Tim pemegang reservasi (OQ-05)
   * melalui View aman public.v_unit_catalog dengan pemetaan privasi sisi server.
   */
  async listUnitCatalog(filters?: {
    projectId?: string;
    propertyTypeId?: string;
    status?: UnitStatus;
  }): Promise<UnitCatalogDto[]> {
    const supabase = await createSupabaseServerClient();
    let query = supabase
      .from('v_unit_catalog')
      .select(
        'id, project_id, project_code, project_name, project_city, developer_id, developer_name, property_type_id, property_type_code, property_type_name, unit_code, block_number, land_area, building_area, catalog_price, orientation, is_hook, status, current_holder_sales_id, current_holder_sales_name, current_holder_team_id, current_holder_team_name, status_updated_at'
      )
      .order('project_name', { ascending: true })
      .order('unit_code', { ascending: true });

    if (filters?.projectId) {
      query = query.eq('project_id', filters.projectId);
    }
    if (filters?.propertyTypeId) {
      query = query.eq('property_type_id', filters.propertyTypeId);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) {
      throw translateDatabaseOrRpcError(error);
    }

    const rawRows = (data ?? []) as RawUnitCatalogViewRow[];
    if (rawRows.length === 0) {
      return [];
    }

    // Ambil kode tim (teams.code) untuk unit yang sedang dipegang (status !== 'AVAILABLE')
    const holderTeamIds = Array.from(
      new Set(
        rawRows
          .filter((r) => r.status !== 'AVAILABLE' && Boolean(r.current_holder_team_id))
          .map((r) => r.current_holder_team_id as string)
      )
    );

    const teamCodeById = new Map<string, string>();
    if (holderTeamIds.length > 0) {
      const { data: teamRows, error: teamError } = await supabase
        .from('teams')
        .select('id, code')
        .in('id', holderTeamIds);

      if (teamError) {
        throw translateDatabaseOrRpcError(teamError);
      }

      for (const team of teamRows ?? []) {
        teamCodeById.set(team.id, team.code);
      }
    }

    // Pemetaan DTO dengan stripping current_holder_sales_name (nama lengkap tidak diekspos)
    return rawRows.map((row): UnitCatalogDto => {
      const holderTeamCode = row.current_holder_team_id
        ? (teamCodeById.get(row.current_holder_team_id) ?? null)
        : null;

      const holderPrivacy = formatUnitHolderPrivacy({
        status: row.status,
        holderFullName: row.current_holder_sales_name,
        holderTeamCode,
      });

      const isAvailable = row.status === 'AVAILABLE';

      return {
        id: row.id,
        project_id: row.project_id,
        project_code: row.project_code,
        project_name: row.project_name,
        project_city: row.project_city,
        developer_id: row.developer_id,
        developer_name: row.developer_name,
        property_type_id: row.property_type_id,
        property_type_code: row.property_type_code,
        property_type_name: row.property_type_name,
        unit_code: row.unit_code,
        block_number: row.block_number,
        land_area: Number(row.land_area),
        building_area: Number(row.building_area),
        catalog_price: Number(row.catalog_price),
        orientation: row.orientation,
        is_hook: row.is_hook,
        status: row.status,
        current_holder_sales_id: isAvailable ? null : row.current_holder_sales_id,
        current_holder_team_id: isAvailable ? null : row.current_holder_team_id,
        current_holder_team_name: isAvailable ? null : row.current_holder_team_name,
        currentHolderSalesFirstName: holderPrivacy.currentHolderSalesFirstName,
        currentHolderTeamCode: holderPrivacy.currentHolderTeamCode,
        currentHolderDisplayLabel: holderPrivacy.currentHolderDisplayLabel,
        status_updated_at: row.status_updated_at,
      };
    });
  },

  async createDeveloper(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof createDeveloperSchema>
  ) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('developers')
      .insert({
        code: input.code,
        name: input.name,
        address: input.address,
        pic_name: input.picName,
        pic_phone: input.picPhone,
        pic_email: input.picEmail ?? null,
        policy_notes: input.policyNotes ?? null,
        created_by: actor.userId,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw translateDatabaseOrRpcError(error);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'DEVELOPER_CREATED',
      entityTable: 'developers',
      entityId: data.id,
      newValues: data,
    });

    return data;
  },

  async createProject(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof createProjectSchema>
  ) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('property_projects')
      .insert({
        developer_id: input.developerId,
        code: input.code,
        name: input.name,
        province: input.province,
        city: input.city,
        district: input.district,
        address: input.address,
        facilities: input.facilities ?? null,
        status: input.status,
        created_by: actor.userId,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw translateDatabaseOrRpcError(error);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'PROJECT_CREATED',
      entityTable: 'property_projects',
      entityId: data.id,
      newValues: data,
    });

    return data;
  },

  async updateProjectCommission(actor: AuthenticatedUserContext, input: z.infer<typeof updateProjectCommissionSchema>) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from('property_projects')
      .update({ developer_commission_rate: input.commissionRate }).eq('id', input.projectId)
      .select('id, developer_commission_rate').single();
    if (error || !data) throw translateDatabaseOrRpcError(error);
    await AuditSink.record({ actorUserId: actor.userId, actorRole: actor.systemRole, actionType: 'PROJECT_COMMISSION_RATE_UPDATED', entityTable: 'property_projects', entityId: data.id, newValues: data });
    return data;
  },

  async createPropertyType(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof createPropertyTypeSchema>
  ) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('property_types')
      .insert({
        project_id: input.projectId,
        code: input.code,
        name: input.name,
        standard_land_area: input.standardLandArea,
        standard_building_area: input.standardBuildingArea,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        electricity_watt: input.electricityWatt,
        specifications: input.specifications ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw translateDatabaseOrRpcError(error);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'PROPERTY_TYPE_CREATED',
      entityTable: 'property_types',
      entityId: data.id,
      newValues: data,
    });

    return data;
  },

  async createUnit(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof createUnitSchema>
  ) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('units')
      .insert({
        project_id: input.projectId,
        property_type_id: input.propertyTypeId,
        unit_code: input.unitCode,
        block_number: input.blockNumber,
        land_area: input.landArea,
        building_area: input.buildingArea,
        catalog_price: input.catalogPrice,
        orientation: input.orientation ?? null,
        is_hook: input.isHook,
        status: 'AVAILABLE',
      })
      .select('*')
      .single();

    if (error || !data) {
      throw translateDatabaseOrRpcError(error);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'UNIT_CREATED',
      entityTable: 'units',
      entityId: data.id,
      newValues: data,
    });

    return data;
  },

  async createPromotion(
    actor: AuthenticatedUserContext,
    input: z.infer<typeof createPromotionSchema>
  ) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('promotions')
      .insert({
        project_id: input.projectId,
        property_type_id: input.propertyTypeId ?? null,
        code: input.code,
        name: input.name,
        description: input.description,
        promo_type: input.promoType,
        discount_value: input.promoType === 'FREE_BENEFIT' ? 0 : input.discountValue,
        bonus_description: input.bonusDescription ?? null,
        start_date: input.startDate,
        end_date: input.endDate,
        is_active: true,
        created_by: actor.userId,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw translateDatabaseOrRpcError(error);
    }

    await AuditSink.record({
      actorUserId: actor.userId,
      actorRole: actor.systemRole,
      actionType: 'PROMOTION_CREATED',
      entityTable: 'promotions',
      entityId: data.id,
      newValues: data,
    });

    return data;
  },
};
