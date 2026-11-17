// Lokasi: src/components/catalog/CatalogWorkspaceClient.tsx
// Client Component Katalog Properti, Matriks Unit (OQ-05), Riwayat Harga (BR-03) & Promo (DESIGN.md v2.1 Bag. 6.2 & 7.5)

'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  LayoutGrid,
  Table2,
  Search,
  History,
  Tag,
  Landmark,
  Layers,
  TrendingUp,
  TrendingDown,
  Lock,
  UserCheck,
} from 'lucide-react';
import type {
  ProjectStatus,
  PromoType,
  SystemRole,
  UnitStatus,
} from '@/types/database.types';
import type { UnitCatalogDto } from '@/modules/catalog/catalog.service';
import {
  createDeveloperAction,
  createProjectAction,
  createPropertyTypeAction,
  createUnitAction,
  updateUnitCatalogPriceAction,
  createPromotionAction,
  updateProjectCommissionAction,
} from '@/modules/catalog/catalog.actions';
import {
  formatRupiah,
  formatDateID,
  formatDateTimeID,
} from '@/lib/utils/format';
import { KpiCard } from '@/components/ui/KpiCard';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/Card';
import {
  Badge,
  DomainStatusBadge,
  UnitStatusBadge,
} from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';

export interface CatalogDeveloperDto {
  id: string;
  code: string;
  name: string;
  address: string;
  picName: string;
  picPhone: string;
  picEmail: string | null;
  policyNotes: string | null;
  isActive: boolean;
}

export interface CatalogProjectDto {
  id: string;
  developerId: string;
  developerName: string;
  code: string;
  name: string;
  province: string;
  city: string;
  district: string;
  address: string;
  facilities: string | null;
  status: ProjectStatus;
  commissionRate: number | null;
  commissionHistory: Array<{ id: string; oldRate: number | null; newRate: number | null; changedAt: string; changedBy: string }>;
}

export interface CatalogPropertyTypeDto {
  id: string;
  projectId: string;
  projectName: string;
  code: string;
  name: string;
  standardLandArea: number;
  standardBuildingArea: number;
  bedrooms: number;
  bathrooms: number;
  electricityWatt: number;
  specifications: string | null;
  isActive: boolean;
}

export interface CatalogPromotionDto {
  id: string;
  projectId: string;
  projectName: string;
  propertyTypeId: string | null;
  propertyTypeName: string | null;
  code: string;
  name: string;
  description: string;
  promoType: PromoType;
  discountValue: number;
  bonusDescription: string | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface CatalogPriceHistoryDto {
  id: string;
  unitId: string;
  unitCode: string;
  projectName: string;
  oldPrice: number;
  newPrice: number;
  deltaAmount: number;
  reason: string;
  changedByLabel: string;
  changedAt: string;
}

export interface CatalogWorkspaceClientProps {
  userRole: SystemRole;
  units: UnitCatalogDto[];
  developers: CatalogDeveloperDto[];
  projects: CatalogProjectDto[];
  propertyTypes: CatalogPropertyTypeDto[];
  promotions: CatalogPromotionDto[];
  priceHistories: CatalogPriceHistoryDto[];
}

type CatalogTabKey = 'units' | 'projects' | 'developers' | 'promotions';

export function CatalogWorkspaceClient({
  userRole,
  units,
  developers,
  projects,
  propertyTypes,
  promotions,
  priceHistories,
}: CatalogWorkspaceClientProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const isAdmin = userRole === 'ADMIN';

  // Active Tab & Unit Matrix View Mode
  const [activeTab, setActiveTab] = useState<CatalogTabKey>('units');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [commissionRateInputs, setCommissionRateInputs] = useState<Record<string, string>>({});

  // Unit Matrix Filters
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL');
  const [selectedTypeId, setSelectedTypeId] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | UnitStatus>(
    'ALL'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Modal: Riwayat Harga Unit (Tersedia untuk semua role)
  const [historyModalUnit, setHistoryModalUnit] =
    useState<UnitCatalogDto | null>(null);

  // Modal Khusus ADMIN: Ubah Harga Unit (BR-03 & BR-07)
  const [priceModalUnit, setPriceModalUnit] = useState<UnitCatalogDto | null>(
    null
  );
  const [newCatalogPrice, setNewCatalogPrice] = useState('');
  const [priceChangeReason, setPriceChangeReason] = useState('');
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);
  const [priceUpdateError, setPriceUpdateError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  // Modal Khusus ADMIN: + Tambah Unit
  const [isCreateUnitOpen, setIsCreateUnitOpen] = useState(false);
  const [unitProjectId, setUnitProjectId] = useState(projects[0]?.id ?? '');
  const [unitTypeId, setUnitTypeId] = useState('');
  const [unitCodeInput, setUnitCodeInput] = useState('');
  const [unitBlockInput, setUnitBlockInput] = useState('');
  const [unitLandInput, setUnitLandInput] = useState('72');
  const [unitBuildingInput, setUnitBuildingInput] = useState('45');
  const [unitPriceInput, setUnitPriceInput] = useState('850000000');
  const [unitOrientationInput, setUnitOrientationInput] = useState('Utara');
  const [unitIsHookInput, setUnitIsHookInput] = useState(false);
  const [isCreatingUnit, setIsCreatingUnit] = useState(false);
  const [createUnitError, setCreateUnitError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  // Modal Khusus ADMIN: + Tambah Proyek
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [projDeveloperId, setProjDeveloperId] = useState(
    developers[0]?.id ?? ''
  );
  const [projCode, setProjCode] = useState('');
  const [projName, setProjName] = useState('');
  const [projProvince, setProjProvince] = useState('Jawa Barat');
  const [projCity, setProjCity] = useState('Bekasi');
  const [projDistrict, setProjDistrict] = useState('');
  const [projAddress, setProjAddress] = useState('');
  const [projFacilities, setProjFacilities] = useState('');
  const [projStatus, setProjStatus] =
    useState<ProjectStatus>('ACTIVE_SELLING');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  // Modal Khusus ADMIN: + Tambah Tipe Properti
  const [isCreateTypeOpen, setIsCreateTypeOpen] = useState(false);
  const [typeProjectId, setTypeProjectId] = useState(projects[0]?.id ?? '');
  const [typeCode, setTypeCode] = useState('');
  const [typeName, setTypeName] = useState('');
  const [typeLandArea, setTypeLandArea] = useState('72');
  const [typeBuildingArea, setTypeBuildingArea] = useState('45');
  const [typeBedrooms, setTypeBedrooms] = useState('2');
  const [typeBathrooms, setTypeBathrooms] = useState('1');
  const [typeWatt, setTypeWatt] = useState('2200');
  const [typeSpecs, setTypeSpecs] = useState('');
  const [isCreatingType, setIsCreatingType] = useState(false);
  const [createTypeError, setCreateTypeError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  // Modal Khusus ADMIN: + Tambah Developer
  const [isCreateDevOpen, setIsCreateDevOpen] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [devName, setDevName] = useState('');
  const [devAddress, setDevAddress] = useState('');
  const [devPicName, setDevPicName] = useState('');
  const [devPicPhone, setDevPicPhone] = useState('');
  const [devPicEmail, setDevPicEmail] = useState('');
  const [devPolicyNotes, setDevPolicyNotes] = useState('');
  const [isCreatingDev, setIsCreatingDev] = useState(false);
  const [createDevError, setCreateDevError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  // Modal Khusus ADMIN: + Tambah Promo
  const [isCreatePromoOpen, setIsCreatePromoOpen] = useState(false);
  const [promoProjectId, setPromoProjectId] = useState(projects[0]?.id ?? '');
  const [promoTypeId, setPromoTypeId] = useState<string>('');
  const [promoCode, setPromoCode] = useState('');
  const [promoName, setPromoName] = useState('');
  const [promoDescription, setPromoDescription] = useState('');
  const [promoKind, setPromoKind] = useState<PromoType>('NOMINAL_DISCOUNT');
  const [promoDiscountVal, setPromoDiscountVal] = useState('15000000');
  const [promoBonusDesc, setPromoBonusDesc] = useState('');
  const [promoStartDate, setPromoStartDate] = useState('2026-03-01');
  const [promoEndDate, setPromoEndDate] = useState('2026-12-31');
  const [isCreatingPromo, setIsCreatingPromo] = useState(false);
  const [createPromoError, setCreatePromoError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  // Latest price change map per unit
  const latestHistoryByUnitId = useMemo(() => {
    const map = new Map<string, CatalogPriceHistoryDto>();
    for (const h of priceHistories) {
      if (!map.has(h.unitId)) {
        map.set(h.unitId, h);
      }
    }
    return map;
  }, [priceHistories]);

  const filterableTypes = useMemo(() => {
    if (selectedProjectId === 'ALL') return propertyTypes;
    return propertyTypes.filter((pt) => pt.projectId === selectedProjectId);
  }, [propertyTypes, selectedProjectId]);

  const filteredUnits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return units.filter((u) => {
      if (selectedProjectId !== 'ALL' && u.project_id !== selectedProjectId) {
        return false;
      }
      if (selectedTypeId !== 'ALL' && u.property_type_id !== selectedTypeId) {
        return false;
      }
      if (selectedStatus !== 'ALL' && u.status !== selectedStatus) {
        return false;
      }
      if (!q) return true;
      return (
        u.unit_code.toLowerCase().includes(q) ||
        u.block_number.toLowerCase().includes(q) ||
        u.project_name.toLowerCase().includes(q) ||
        u.property_type_name.toLowerCase().includes(q) ||
        (u.currentHolderDisplayLabel?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [units, selectedProjectId, selectedTypeId, selectedStatus, searchQuery]);

  const availableCount = units.filter((u) => u.status === 'AVAILABLE').length;
  const heldCount = units.filter((u) => u.status === 'HELD').length;
  const bookedCount = units.filter((u) => u.status === 'BOOKED').length;
  const soldCount = units.filter((u) => u.status === 'SOLD').length;

  const selectedUnitHistories = useMemo(() => {
    if (!historyModalUnit) return [];
    return priceHistories.filter((h) => h.unitId === historyModalUnit.id);
  }, [historyModalUnit, priceHistories]);

  const openPriceModal = (unit: UnitCatalogDto) => {
    setPriceModalUnit(unit);
    setNewCatalogPrice(String(unit.catalog_price));
    setPriceChangeReason('');
    setPriceUpdateError(null);
  };

  const openCreateUnitModal = () => {
    const firstProjId = projects[0]?.id ?? '';
    const matchingTypes = propertyTypes.filter(
      (pt) => pt.projectId === firstProjId
    );
    setUnitProjectId(firstProjId);
    setUnitTypeId(matchingTypes[0]?.id ?? '');
    setUnitCodeInput('');
    setUnitBlockInput('');
    setCreateUnitError(null);
    setIsCreateUnitOpen(true);
  };

  // Handlers
  const handlePriceUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!priceModalUnit || isUpdatingPrice) return;
    setIsUpdatingPrice(true);
    setPriceUpdateError(null);

    try {
      const result = await updateUnitCatalogPriceAction({
        unitId: priceModalUnit.id,
        newPrice: Number(newCatalogPrice),
        reason: priceChangeReason,
      });

      if (result.success) {
        showToast({
          title: 'Harga Katalog Diperbarui',
          description: result.message,
          tone: 'success',
        });
        setPriceModalUnit(null);
        router.refresh();
      } else {
        setPriceUpdateError({
          message: result.message,
          correlationId: result.correlationId,
        });
        showToast({
          title: 'Gagal Memperbarui Harga',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      setPriceUpdateError({
        message: 'Terjadi gangguan jaringan saat memperbarui harga unit.',
      });
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  const handleCreateUnitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingUnit) return;
    setIsCreatingUnit(true);
    setCreateUnitError(null);

    try {
      const result = await createUnitAction({
        projectId: unitProjectId,
        propertyTypeId: unitTypeId,
        unitCode: unitCodeInput,
        blockNumber: unitBlockInput,
        landArea: Number(unitLandInput),
        buildingArea: Number(unitBuildingInput),
        catalogPrice: Number(unitPriceInput),
        orientation: unitOrientationInput || null,
        isHook: unitIsHookInput,
      });

      if (result.success) {
        showToast({
          title: 'Unit Baru Ditambahkan',
          description: result.message,
          tone: 'success',
        });
        setIsCreateUnitOpen(false);
        router.refresh();
      } else {
        setCreateUnitError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setCreateUnitError({
        message: 'Terjadi gangguan jaringan saat menambahkan unit.',
      });
    } finally {
      setIsCreatingUnit(false);
    }
  };

  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingProject) return;
    setIsCreatingProject(true);
    setCreateProjectError(null);

    try {
      const result = await createProjectAction({
        developerId: projDeveloperId,
        code: projCode,
        name: projName,
        province: projProvince,
        city: projCity,
        district: projDistrict,
        address: projAddress,
        facilities: projFacilities || null,
        status: projStatus,
      });

      if (result.success) {
        showToast({
          title: 'Proyek Ditambahkan',
          description: result.message,
          tone: 'success',
        });
        setIsCreateProjectOpen(false);
        router.refresh();
      } else {
        setCreateProjectError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setCreateProjectError({
        message: 'Terjadi gangguan jaringan saat menambahkan proyek.',
      });
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleCreateTypeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingType) return;
    setIsCreatingType(true);
    setCreateTypeError(null);

    try {
      const result = await createPropertyTypeAction({
        projectId: typeProjectId,
        code: typeCode,
        name: typeName,
        standardLandArea: Number(typeLandArea),
        standardBuildingArea: Number(typeBuildingArea),
        bedrooms: Number(typeBedrooms),
        bathrooms: Number(typeBathrooms),
        electricityWatt: Number(typeWatt),
        specifications: typeSpecs || null,
      });

      if (result.success) {
        showToast({
          title: 'Tipe Properti Ditambahkan',
          description: result.message,
          tone: 'success',
        });
        setIsCreateTypeOpen(false);
        router.refresh();
      } else {
        setCreateTypeError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setCreateTypeError({
        message: 'Terjadi gangguan jaringan saat menambahkan tipe properti.',
      });
    } finally {
      setIsCreatingType(false);
    }
  };

  const handleCreateDeveloperSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingDev) return;
    setIsCreatingDev(true);
    setCreateDevError(null);

    try {
      const result = await createDeveloperAction({
        code: devCode,
        name: devName,
        address: devAddress,
        picName: devPicName,
        picPhone: devPicPhone,
        picEmail: devPicEmail || null,
        policyNotes: devPolicyNotes || null,
      });

      if (result.success) {
        showToast({
          title: 'Mitra Developer Ditambahkan',
          description: result.message,
          tone: 'success',
        });
        setIsCreateDevOpen(false);
        router.refresh();
      } else {
        setCreateDevError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setCreateDevError({
        message: 'Terjadi gangguan jaringan saat menyimpan developer.',
      });
    } finally {
      setIsCreatingDev(false);
    }
  };

  const handleCreatePromoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingPromo) return;
    setIsCreatingPromo(true);
    setCreatePromoError(null);

    try {
      const result = await createPromotionAction({
        projectId: promoProjectId,
        propertyTypeId: promoTypeId || null,
        code: promoCode,
        name: promoName,
        description: promoDescription,
        promoType: promoKind,
        discountValue:
          promoKind === 'FREE_BENEFIT' ? 0 : Number(promoDiscountVal),
        bonusDescription: promoBonusDesc || null,
        startDate: promoStartDate,
        endDate: promoEndDate,
      });

      if (result.success) {
        showToast({
          title: 'Program Promo Diterbitkan',
          description: result.message,
          tone: 'success',
        });
        setIsCreatePromoOpen(false);
        router.refresh();
      } else {
        setCreatePromoError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setCreatePromoError({
        message: 'Terjadi gangguan jaringan saat menerbitkan promo.',
      });
    } finally {
      setIsCreatingPromo(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Katalog &amp; Unit
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            Ketersediaan unit, harga katalog, proyek, dan program promo.
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setCreatePromoError(null);
                setIsCreatePromoOpen(true);
              }}
              leftIcon={<Tag className="h-3.5 w-3.5" strokeWidth={1.75} />}
            >
              + Tambah Promo
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={openCreateUnitModal}
            >
              + Tambah Unit
            </Button>
          </div>
        )}
      </div>

      {/* 4 Kartu KPI Ketersediaan Unit */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="AVAILABLE"
          value={`${availableCount} Unit`}
          subtext={`Dari total ${units.length} unit`}
          icon={<Building2 className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
        />
        <KpiCard
          label="HELD (72 Jam)"
          value={`${heldCount} Unit`}
          subtext="Menunggu Booking Fee"
          icon={<Lock className="h-4 w-4" strokeWidth={1.75} />}
          tone={heldCount > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="BOOKED"
          value={`${bookedCount} Unit`}
          subtext="Kontrak / KPR < 100%"
          icon={<Landmark className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="SOLD"
          value={`${soldCount} Unit`}
          subtext={`${projects.length} Proyek • ${promotions.length} Promo`}
          icon={<Layers className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
      </div>

      {/* 4 Tab Navigasi Katalog (DESIGN.md Bag. 7.5) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] bg-white px-4 py-2.5 rounded-t-lg">
        <div
          role="tablist"
          aria-label="Navigasi Katalog Properti"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'units'}
            onClick={() => setActiveTab('units')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'units'
                ? 'bg-[#14532D] text-white'
                : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Matriks Unit ({units.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'projects'}
            onClick={() => setActiveTab('projects')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'projects'
                ? 'bg-[#14532D] text-white'
                : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
            }`}
          >
            <Layers className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>
              Proyek &amp; Tipe ({projects.length} / {propertyTypes.length})
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'developers'}
            onClick={() => setActiveTab('developers')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'developers'
                ? 'bg-[#14532D] text-white'
                : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
            }`}
          >
            <Landmark className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Developer ({developers.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'promotions'}
            onClick={() => setActiveTab('promotions')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'promotions'
                ? 'bg-[#14532D] text-white'
                : 'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
            }`}
          >
            <Tag className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Program Promo ({promotions.length})</span>
          </button>
        </div>

        {activeTab === 'units' && (
          <div className="flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-1">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white text-[#14532D] shadow-2xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Grid Kartu</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === 'table'
                  ? 'bg-white text-[#14532D] shadow-2xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Tabel</span>
            </button>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: MATRIKS UNIT */}
      {/* ===================================================================== */}
      {activeTab === 'units' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[#94A3B8]"
                    strokeWidth={1.75}
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari kode unit (P1-A01), blok, tim..."
                    aria-label="Cari kode unit atau blok"
                    className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white pr-3 pl-9 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                  />
                </div>

                <select
                  aria-label="Filter Proyek Properti"
                  value={selectedProjectId}
                  onChange={(e) => {
                    setSelectedProjectId(e.target.value);
                    setSelectedTypeId('ALL');
                  }}
                  className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                >
                  <option value="ALL">Semua Proyek ({projects.length})</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Tipe Rumah"
                  value={selectedTypeId}
                  onChange={(e) => setSelectedTypeId(e.target.value)}
                  className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                >
                  <option value="ALL">
                    Semua Tipe Properti ({filterableTypes.length})
                  </option>
                  {filterableTypes.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.code} — {pt.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Status Unit"
                  value={selectedStatus}
                  onChange={(e) =>
                    setSelectedStatus(e.target.value as 'ALL' | UnitStatus)
                  }
                  className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                >
                  <option value="ALL">Semua Status Unit</option>
                  <option value="AVAILABLE">AVAILABLE ({availableCount})</option>
                  <option value="HELD">HELD ({heldCount})</option>
                  <option value="BOOKED">BOOKED ({bookedCount})</option>
                  <option value="SOLD">SOLD ({soldCount})</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {filteredUnits.length === 0 ? (
            <Card>
              <CardContent className="p-6">
                <EmptyState
                  title="Unit Tidak Ditemukan"
                  description="Tidak ada unit properti yang sesuai dengan filter proyek, tipe, atau status yang dipilih."
                />
              </CardContent>
            </Card>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredUnits.map((unit) => {
                const latestHistory = latestHistoryByUnitId.get(unit.id);
                const unitHistoryCount = priceHistories.filter(
                  (h) => h.unitId === unit.id
                ).length;

                return (
                  <Card key={unit.id} className="flex flex-col justify-between">
                    <div className="p-4">
                      {/* Card Top Row: Unit Code + Status Badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-base font-bold text-[#0F172A]">
                              {unit.unit_code}
                            </span>
                            {unit.is_hook && (
                              <Badge tone="amber">HOOK</Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs font-medium text-[#475569]">
                            {unit.project_name} •{' '}
                            {unit.block_number.toLowerCase().startsWith('blok')
                              ? unit.block_number
                              : `Blok ${unit.block_number}`}
                          </p>
                        </div>
                        <UnitStatusBadge status={unit.status} />
                      </div>

                      {/* Specs & Price */}
                      <div className="mt-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] font-medium text-[#64748B]">
                            Harga Katalog
                          </span>
                          <span className="font-mono text-sm font-bold text-[#14532D] tabular-nums">
                            {formatRupiah(unit.catalog_price)}
                          </span>
                        </div>

                        {latestHistory && (
                          <div className="mt-1.5 flex items-center justify-between border-t border-[#E2E8F0] pt-1.5 text-[11px]">
                            <span className="text-[#64748B]">
                              Delta Harga Terakhir:
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 font-mono font-semibold tabular-nums ${
                                latestHistory.deltaAmount > 0
                                  ? 'text-[#B45309]'
                                  : 'text-[#047857]'
                              }`}
                            >
                              {latestHistory.deltaAmount > 0 ? (
                                <TrendingUp
                                  className="h-3 w-3"
                                  strokeWidth={1.75}
                                />
                              ) : (
                                <TrendingDown
                                  className="h-3 w-3"
                                  strokeWidth={1.75}
                                />
                              )}
                              {latestHistory.deltaAmount > 0 ? '+' : ''}
                              {formatRupiah(latestHistory.deltaAmount)}
                            </span>
                          </div>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#475569] tabular-nums">
                          <span>Tipe: {unit.property_type_name}</span>
                          <span>•</span>
                          <span>
                            LT/LB: {unit.land_area}/{unit.building_area} m²
                          </span>
                          {unit.orientation && (
                            <>
                              <span>•</span>
                              <span>Hadap {unit.orientation}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Holder Privacy Display (OQ-05: Nama Depan • Kode Tim) */}
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-[#64748B]">Pemegang Unit:</span>
                        {unit.status === 'AVAILABLE' ||
                        !unit.currentHolderDisplayLabel ? (
                          <span className="font-medium text-[#047857]">
                            Tersedia Bebas
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-2.5 py-0.5 font-mono text-xs font-semibold text-[#14532D]">
                            <UserCheck
                              className="h-3.5 w-3.5"
                              strokeWidth={1.75}
                            />
                            {unit.currentHolderDisplayLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card Footer Actions */}
                    <div className="flex items-center justify-between gap-2 border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5 rounded-b-lg">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setHistoryModalUnit(unit)}
                        leftIcon={
                          <History
                            className="h-3.5 w-3.5"
                            strokeWidth={1.75}
                          />
                        }
                      >
                        Riwayat Harga ({unitHistoryCount})
                      </Button>

                      {isAdmin && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => openPriceModal(unit)}
                        >
                          Ubah Harga
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                        <th className="px-4 py-3">Kode Unit</th>
                        <th className="px-4 py-3">Proyek &amp; Tipe</th>
                        <th className="px-4 py-3 text-right">LT / LB (m²)</th>
                        <th className="px-4 py-3 text-right">Harga Katalog</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Pemegang Unit</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {filteredUnits.map((unit) => {
                        const unitHistoryCount = priceHistories.filter(
                          (h) => h.unitId === unit.id
                        ).length;
                        return (
                          <tr key={unit.id} className="hover:bg-[#F8FAFC]">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-[#0F172A]">
                                  {unit.unit_code}
                                </span>
                                {unit.is_hook && (
                                  <Badge tone="amber">HOOK</Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-[#64748B]">
                                {unit.block_number
                                  .toLowerCase()
                                  .startsWith('blok')
                                  ? unit.block_number
                                  : `Blok ${unit.block_number}`}
                                {unit.orientation
                                  ? ` • ${unit.orientation}`
                                  : ''}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-[#0F172A]">
                                {unit.project_name}
                              </p>
                              <p className="text-[11px] text-[#64748B]">
                                {unit.property_type_name} (
                                {unit.property_type_code})
                              </p>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-[#475569] tabular-nums">
                              {unit.land_area} / {unit.building_area}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-[#14532D] tabular-nums">
                              {formatRupiah(unit.catalog_price)}
                            </td>
                            <td className="px-4 py-3">
                              <UnitStatusBadge status={unit.status} />
                            </td>
                            <td className="px-4 py-3">
                              {unit.status === 'AVAILABLE' ||
                              !unit.currentHolderDisplayLabel ? (
                                <span className="text-[#64748B]">—</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded border border-[#BBF7D0] bg-[#F0FDF4] px-2 py-0.5 font-mono text-xs font-semibold text-[#14532D]">
                                  {unit.currentHolderDisplayLabel}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setHistoryModalUnit(unit)}
                                >
                                  Riwayat Harga ({unitHistoryCount})
                                </Button>
                                {isAdmin && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => openPriceModal(unit)}
                                  >
                                    Ubah Harga
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: PROYEK & TIPE */}
      {/* ===================================================================== */}
      {activeTab === 'projects' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Proyek Perumahan ({projects.length})</CardTitle>
              {isAdmin && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setCreateProjectError(null);
                    setIsCreateProjectOpen(true);
                  }}
                >
                  + Tambah Proyek
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                      <th className="px-4 py-3">Kode &amp; Nama Proyek</th>
                      <th className="px-4 py-3">Mitra Developer</th>
                      <th className="px-4 py-3">Lokasi</th>
                      <th className="px-4 py-3">Fasilitas Utama</th>
                      <th className="px-4 py-3">Status Proyek</th>
                      {isAdmin && <th className="px-4 py-3">Komisi Developer (%)</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {projects.map((proj) => (
                      <tr key={proj.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-[#14532D]">
                            {proj.code}
                          </span>
                          <p className="font-semibold text-[#0F172A]">
                            {proj.name}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-[#475569]">
                          {proj.developerName}
                        </td>
                        <td className="px-4 py-3 text-[#475569]">
                          <p className="font-medium text-[#0F172A]">
                            {proj.district}, {proj.city}
                          </p>
                          <p className="text-[11px] text-[#64748B]">
                            {proj.province}
                          </p>
                        </td>
                        <td className="px-4 py-3 max-w-[280px] text-[#475569]">
                          {proj.facilities ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <DomainStatusBadge value={proj.status} />
                        </td>
                        {isAdmin && <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Input aria-label={`Persentase komisi ${proj.name}`} type="number" min="0" max="100" step="0.01" className="w-24" placeholder="Belum diatur" value={commissionRateInputs[proj.id] ?? (proj.commissionRate === null ? '' : String(proj.commissionRate))} onChange={(e) => setCommissionRateInputs((prev) => ({ ...prev, [proj.id]: e.target.value }))} />
                            <Button type="button" size="sm" variant="secondary" onClick={async () => {
                              const raw = commissionRateInputs[proj.id] ?? (proj.commissionRate === null ? '' : String(proj.commissionRate));
                              const result = await updateProjectCommissionAction({ projectId: proj.id, commissionRate: raw.trim() === '' ? null : Number(raw) });
                              if (result.success) { showToast({ title: 'Persentase komisi proyek tersimpan.', tone: 'success' }); router.refresh(); }
                              else showToast({ title: result.message, tone: 'error', correlationId: result.correlationId });
                            }}>Simpan</Button>
                          </div>
                          {proj.commissionRate === null && <p className="mt-1 text-[10px] text-[#B45309]">Belum dikonfigurasi</p>}
                          {proj.commissionHistory.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-[10px] text-[#14532D]">Riwayat perubahan ({proj.commissionHistory.length})</summary><ul className="mt-1 space-y-1 text-[10px] text-[#64748B]">{proj.commissionHistory.slice(0, 5).map((h) => <li key={h.id}>{h.oldRate === null ? 'Belum diatur' : `${h.oldRate}%`} → {h.newRate === null ? 'Belum diatur' : `${h.newRate}%`} · {new Date(h.changedAt).toLocaleString('id-ID')} · {h.changedBy}</li>)}</ul></details>}
                        </td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tipe Properti ({propertyTypes.length})</CardTitle>
              {isAdmin && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCreateTypeError(null);
                    setIsCreateTypeOpen(true);
                  }}
                >
                  + Tambah Tipe
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                      <th className="px-4 py-3">Kode &amp; Nama Tipe</th>
                      <th className="px-4 py-3">Proyek</th>
                      <th className="px-4 py-3 text-right">LT / LB Standar</th>
                      <th className="px-4 py-3 text-right">Kamar (KT / KM)</th>
                      <th className="px-4 py-3 text-right">Listrik</th>
                      <th className="px-4 py-3">Spesifikasi Teknis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {propertyTypes.map((pt) => (
                      <tr key={pt.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-[#14532D]">
                            {pt.code}
                          </span>
                          <p className="font-semibold text-[#0F172A]">
                            {pt.name}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-medium text-[#0F172A]">
                          {pt.projectName}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[#475569] tabular-nums">
                          {pt.standardLandArea} m² / {pt.standardBuildingArea}{' '}
                          m²
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {pt.bedrooms} KT • {pt.bathrooms} KM
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {pt.electricityWatt} VA
                        </td>
                        <td className="px-4 py-3 max-w-[300px] text-[#475569]">
                          {pt.specifications ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: DEVELOPER */}
      {/* ===================================================================== */}
      {activeTab === 'developers' && (
        <Card>
          <CardHeader>
            <CardTitle>Developer ({developers.length})</CardTitle>
            {isAdmin && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  setCreateDevError(null);
                  setIsCreateDevOpen(true);
                }}
              >
                + Tambah Developer
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                    <th className="px-4 py-3">Kode &amp; Nama Developer</th>
                    <th className="px-4 py-3">Alamat Kantor</th>
                    <th className="px-4 py-3">PIC Developer</th>
                    <th className="px-4 py-3">Catatan Kebijakan Kerja Sama</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {developers.map((dev) => (
                    <tr key={dev.id} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-[#14532D]">
                          {dev.code}
                        </span>
                        <p className="font-semibold text-[#0F172A]">
                          {dev.name}
                        </p>
                      </td>
                      <td className="px-4 py-3 max-w-[260px] text-[#475569]">
                        {dev.address}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#0F172A]">
                          {dev.picName}
                        </p>
                        <p className="font-mono text-[11px] text-[#64748B]">
                          {dev.picPhone}
                          {dev.picEmail ? ` • ${dev.picEmail}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 max-w-[280px] text-[#475569]">
                        {dev.policyNotes ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {dev.isActive ? (
                          <Badge tone="emerald">AKTIF</Badge>
                        ) : (
                          <Badge tone="red">NONAKTIF</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: PROGRAM PROMO */}
      {/* ===================================================================== */}
      {activeTab === 'promotions' && (
        <Card>
          <CardHeader>
            <CardTitle>Program Promo ({promotions.length})</CardTitle>
            {isAdmin && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  setCreatePromoError(null);
                  setIsCreatePromoOpen(true);
                }}
              >
                + Tambah Promo
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                    <th className="px-4 py-3">Kode &amp; Nama Promo</th>
                    <th className="px-4 py-3">Cakupan Proyek / Tipe</th>
                    <th className="px-4 py-3">Jenis &amp; Nilai Benefit</th>
                    <th className="px-4 py-3">Periode Berlaku</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {promotions.map((promo) => (
                    <tr key={promo.id} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-[#14532D]">
                          {promo.code}
                        </span>
                        <p className="font-semibold text-[#0F172A]">
                          {promo.name}
                        </p>
                        <p className="mt-0.5 max-w-[280px] text-[11px] text-[#64748B]">
                          {promo.description}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#0F172A]">
                          {promo.projectName}
                        </p>
                        <p className="text-[11px] text-[#64748B]">
                          {promo.propertyTypeName ?? 'Seluruh Tipe di Proyek Ini'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="forest">{promo.promoType}</Badge>
                        <p className="mt-1 font-mono font-bold text-[#0F172A] tabular-nums">
                          {promo.promoType === 'NOMINAL_DISCOUNT'
                            ? `Diskon ${formatRupiah(promo.discountValue)}`
                            : promo.promoType === 'PERCENTAGE_DISCOUNT'
                              ? `Diskon ${promo.discountValue}%`
                              : promo.bonusDescription ?? 'Benefit Non-Tunai'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-[#475569] tabular-nums">
                        {formatDateID(promo.startDate)} —{' '}
                        {formatDateID(promo.endDate)}
                      </td>
                      <td className="px-4 py-3">
                        {promo.isActive ? (
                          <Badge tone="emerald">AKTIF</Badge>
                        ) : (
                          <Badge tone="slate">BERAKHIR</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===================================================================== */}
      {/* MODAL RIWAYAT HARGA UNIT (Untuk Semua Role: ADMIN, SUPERVISOR, SALES) */}
      {/* ===================================================================== */}
      <Modal
        isOpen={Boolean(historyModalUnit)}
        onClose={() => setHistoryModalUnit(null)}
        title={
          historyModalUnit
            ? `Riwayat Perubahan Harga Unit ${historyModalUnit.unit_code}`
            : 'Riwayat Harga Unit'
        }
        description={
          historyModalUnit
            ? `${historyModalUnit.project_name} • Tipe ${historyModalUnit.property_type_name} • Harga Katalog Saat Ini: ${formatRupiah(historyModalUnit.catalog_price)}`
            : undefined
        }
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-xs text-[#64748B]">
            Perubahan harga katalog tidak mengubah nilai kesepakatan transaksi aktif (BR-07).
          </p>

          {selectedUnitHistories.length === 0 ? (
            <EmptyState
              title="Belum Ada Riwayat Perubahan Harga pada Unit Ini"
              description="Unit ini masih menggunakan harga katalog awal sejak pertama kali didaftarkan."
            />
          ) : (
            <div className="space-y-2.5">
              {selectedUnitHistories.map((hist) => {
                const isUp = hist.deltaAmount > 0;
                return (
                  <div
                    key={hist.id}
                    className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                        <span className="text-[#64748B] line-through">
                          {formatRupiah(hist.oldPrice)}
                        </span>
                        <span>→</span>
                        <span className="font-bold text-[#0F172A]">
                          {formatRupiah(hist.newPrice)}
                        </span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                          isUp
                            ? 'bg-[#FFFBEB] text-[#B45309]'
                            : 'bg-[#ECFDF5] text-[#047857]'
                        }`}
                      >
                        {isUp ? '+' : ''}
                        {formatRupiah(hist.deltaAmount)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-[#0F172A]">
                      Alasan: {hist.reason}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#64748B] tabular-nums">
                      Dicatat pada {formatDateTimeID(hist.changedAt)} • Oleh:{' '}
                      {hist.changedByLabel}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL KHUSUS ADMIN: UBAH HARGA KATALOG UNIT (BR-03 & BR-07) */}
      {/* ===================================================================== */}
      {isAdmin && (
        <Modal
          isOpen={Boolean(priceModalUnit)}
          onClose={() => setPriceModalUnit(null)}
          title={
            priceModalUnit
              ? `Ubah Harga Katalog Unit ${priceModalUnit.unit_code}`
              : 'Ubah Harga Katalog Unit'
          }
          description="Perubahan harga akan menghitung ulang skor Budget Compatibility prospek aktif pada proyek ini dan mengirim notifikasi ke Sales terkait."
          isDismissDisabled={isUpdatingPrice}
        >
          {priceModalUnit && (
            <form onSubmit={handlePriceUpdateSubmit} className="space-y-4">
              {priceUpdateError && (
                <div
                  role="alert"
                  className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
                >
                  <p className="font-semibold">{priceUpdateError.message}</p>
                  {priceUpdateError.correlationId && (
                    <p className="mt-1 font-mono text-[11px]">
                      Ref: {priceUpdateError.correlationId}
                    </p>
                  )}
                </div>
              )}

              <p className="text-xs text-[#64748B]">
                Harga saat ini:{' '}
                <strong className="font-mono text-[#0F172A]">
                  {formatRupiah(priceModalUnit.catalog_price)}
                </strong>{' '}
                • Transaksi aktif tetap terkunci pada harga kesepakatan awal (Price Freeze BR-07).
              </p>

              <CurrencyInput
                label="Harga Katalog Baru (Rp)"
                required
                min={1}
                value={newCatalogPrice}
                onValueChange={setNewCatalogPrice}
                disabled={isUpdatingPrice}
              />

              <div>
                <label
                  htmlFor="priceChangeReasonInput"
                  className="block text-xs font-semibold text-[#0F172A]"
                >
                  Alasan Penyesuaian Harga (Wajib BR-03, min. 10 karakter)
                </label>
                <textarea
                  id="priceChangeReasonInput"
                  required
                  minLength={10}
                  rows={3}
                  value={priceChangeReason}
                  onChange={(e) => setPriceChangeReason(e.target.value)}
                  disabled={isUpdatingPrice}
                  placeholder="Contoh: Penyesuaian harga kuartal baru pasca penyelesaian infrastruktur jalan boulevard utama."
                  className="mt-1.5 block w-full rounded-md border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPriceModalUnit(null)}
                  disabled={isUpdatingPrice}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={isUpdatingPrice}
                >
                  Simpan Harga Baru
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* ===================================================================== */}
      {/* MODAL KHUSUS ADMIN: + TAMBAH UNIT BARU */}
      {/* ===================================================================== */}
      {isAdmin && (
        <Modal
          isOpen={isCreateUnitOpen}
          onClose={() => setIsCreateUnitOpen(false)}
          title="Tambah Unit Properti Baru ke Katalog"
          description="Unit baru akan terdaftar dengan status awal AVAILABLE."
          isDismissDisabled={isCreatingUnit}
        >
          <form onSubmit={handleCreateUnitSubmit} className="space-y-4">
            {createUnitError && (
              <div
                role="alert"
                className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
              >
                <p className="font-semibold">{createUnitError.message}</p>
                {createUnitError.correlationId && (
                  <p className="mt-1 font-mono text-[11px]">
                    Ref: {createUnitError.correlationId}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Proyek Perumahan"
                required
                value={unitProjectId}
                onChange={(e) => {
                  const nextProj = e.target.value;
                  setUnitProjectId(nextProj);
                  const matching = propertyTypes.filter(
                    (pt) => pt.projectId === nextProj
                  );
                  setUnitTypeId(matching[0]?.id ?? '');
                }}
                disabled={isCreatingUnit}
                options={projects.map((p) => ({
                  value: p.id,
                  label: `${p.code} — ${p.name}`,
                }))}
              />

              <Select
                label="Tipe Properti (Sesuai Proyek CST-04)"
                required
                value={unitTypeId}
                onChange={(e) => setUnitTypeId(e.target.value)}
                disabled={isCreatingUnit}
                options={propertyTypes
                  .filter((pt) => pt.projectId === unitProjectId)
                  .map((pt) => ({
                    value: pt.id,
                    label: `${pt.code} — ${pt.name}`,
                  }))}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Kode Unit (Unik di Proyek)"
                required
                value={unitCodeInput}
                onChange={(e) => setUnitCodeInput(e.target.value.toUpperCase())}
                placeholder="Contoh: P1-C05"
                disabled={isCreatingUnit}
              />

              <Input
                label="Nomor Blok"
                required
                value={unitBlockInput}
                onChange={(e) => setUnitBlockInput(e.target.value)}
                placeholder="Contoh: C-05"
                disabled={isCreatingUnit}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Luas Tanah (m²)"
                type="number"
                required
                value={unitLandInput}
                onChange={(e) => setUnitLandInput(e.target.value)}
                disabled={isCreatingUnit}
              />

              <Input
                label="Luas Bangunan (m²)"
                type="number"
                required
                value={unitBuildingInput}
                onChange={(e) => setUnitBuildingInput(e.target.value)}
                disabled={isCreatingUnit}
              />

              <Input
                label="Orientasi Hadap"
                value={unitOrientationInput}
                onChange={(e) => setUnitOrientationInput(e.target.value)}
                placeholder="Utara / Selatan"
                disabled={isCreatingUnit}
              />
            </div>

            <CurrencyInput
              label="Harga Katalog Awal (Rp)"
              required
              min={1}
              value={unitPriceInput}
              onValueChange={setUnitPriceInput}
              disabled={isCreatingUnit}
            />

            <label className="flex items-center gap-2 text-xs font-medium text-[#0F172A]">
              <input
                type="checkbox"
                checked={unitIsHookInput}
                onChange={(e) => setUnitIsHookInput(e.target.checked)}
                disabled={isCreatingUnit}
                className="h-4 w-4 rounded border-[#CBD5E1] text-[#14532D] focus:ring-[#14532D]"
              />
              <span>Unit berada di posisi Sudut / Hook (is_hook)</span>
            </label>

            <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateUnitOpen(false)}
                disabled={isCreatingUnit}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isCreatingUnit}
              >
                Simpan Unit Baru
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================================================================== */}
      {/* MODAL KHUSUS ADMIN: + TAMBAH PROYEK */}
      {/* ===================================================================== */}
      {isAdmin && (
        <Modal
          isOpen={isCreateProjectOpen}
          onClose={() => setIsCreateProjectOpen(false)}
          title="Tambah Proyek Perumahan Baru"
          isDismissDisabled={isCreatingProject}
        >
          <form onSubmit={handleCreateProjectSubmit} className="space-y-4">
            {createProjectError && (
              <div
                role="alert"
                className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
              >
                <p className="font-semibold">{createProjectError.message}</p>
              </div>
            )}

            <Select
              label="Mitra Developer"
              required
              value={projDeveloperId}
              onChange={(e) => setProjDeveloperId(e.target.value)}
              disabled={isCreatingProject}
              options={developers.map((d) => ({
                value: d.id,
                label: `${d.code} — ${d.name}`,
              }))}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Kode Proyek"
                required
                value={projCode}
                onChange={(e) => setProjCode(e.target.value.toUpperCase())}
                placeholder="PRJ-FIM-04"
                disabled={isCreatingProject}
              />
              <Input
                label="Nama Proyek"
                required
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                placeholder="Grand FIM Valley"
                disabled={isCreatingProject}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Provinsi"
                required
                value={projProvince}
                onChange={(e) => setProjProvince(e.target.value)}
                disabled={isCreatingProject}
              />
              <Input
                label="Kota / Kabupaten"
                required
                value={projCity}
                onChange={(e) => setProjCity(e.target.value)}
                disabled={isCreatingProject}
              />
              <Input
                label="Kecamatan"
                required
                value={projDistrict}
                onChange={(e) => setProjDistrict(e.target.value)}
                disabled={isCreatingProject}
              />
            </div>

            <Input
              label="Alamat Lengkap Proyek"
              required
              value={projAddress}
              onChange={(e) => setProjAddress(e.target.value)}
              disabled={isCreatingProject}
            />

            <Input
              label="Fasilitas Utama"
              value={projFacilities}
              onChange={(e) => setProjFacilities(e.target.value)}
              placeholder="One Gate System, Clubhouse, Taman Bermain"
              disabled={isCreatingProject}
            />

            <Select
              label="Status Pemasaran Proyek"
              value={projStatus}
              onChange={(e) => setProjStatus(e.target.value as ProjectStatus)}
              disabled={isCreatingProject}
              options={[
                { value: 'ACTIVE_SELLING', label: 'ACTIVE_SELLING' },
                { value: 'PRE_LAUNCH', label: 'PRE_LAUNCH' },
                { value: 'SOLD_OUT', label: 'SOLD_OUT' },
                { value: 'CLOSED', label: 'CLOSED' },
              ]}
            />

            <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateProjectOpen(false)}
                disabled={isCreatingProject}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isCreatingProject}
              >
                Simpan Proyek
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================================================================== */}
      {/* MODAL KHUSUS ADMIN: + TAMBAH TIPE PROPERTI */}
      {/* ===================================================================== */}
      {isAdmin && (
        <Modal
          isOpen={isCreateTypeOpen}
          onClose={() => setIsCreateTypeOpen(false)}
          title="Tambah Tipe Properti Baru"
          isDismissDisabled={isCreatingType}
        >
          <form onSubmit={handleCreateTypeSubmit} className="space-y-4">
            {createTypeError && (
              <div
                role="alert"
                className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
              >
                <p className="font-semibold">{createTypeError.message}</p>
              </div>
            )}

            <Select
              label="Proyek Perumahan"
              required
              value={typeProjectId}
              onChange={(e) => setTypeProjectId(e.target.value)}
              disabled={isCreatingType}
              options={projects.map((p) => ({
                value: p.id,
                label: `${p.code} — ${p.name}`,
              }))}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Kode Tipe"
                required
                value={typeCode}
                onChange={(e) => setTypeCode(e.target.value.toUpperCase())}
                placeholder="T-45/72"
                disabled={isCreatingType}
              />
              <Input
                label="Nama Tipe Rumah"
                required
                value={typeName}
                onChange={(e) => setTypeName(e.target.value)}
                placeholder="Tipe Emerald 45/72"
                disabled={isCreatingType}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Input
                label="LT Standar (m²)"
                type="number"
                required
                value={typeLandArea}
                onChange={(e) => setTypeLandArea(e.target.value)}
                disabled={isCreatingType}
              />
              <Input
                label="LB Standar (m²)"
                type="number"
                required
                value={typeBuildingArea}
                onChange={(e) => setTypeBuildingArea(e.target.value)}
                disabled={isCreatingType}
              />
              <Input
                label="Kamar Tidur"
                type="number"
                required
                value={typeBedrooms}
                onChange={(e) => setTypeBedrooms(e.target.value)}
                disabled={isCreatingType}
              />
              <Input
                label="Kamar Mandi"
                type="number"
                required
                value={typeBathrooms}
                onChange={(e) => setTypeBathrooms(e.target.value)}
                disabled={isCreatingType}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Daya Listrik (VA)"
                type="number"
                required
                value={typeWatt}
                onChange={(e) => setTypeWatt(e.target.value)}
                disabled={isCreatingType}
              />
              <Input
                label="Spesifikasi Bangunan"
                value={typeSpecs}
                onChange={(e) => setTypeSpecs(e.target.value)}
                placeholder="Bata merah, rangka baja ringan, granit 60x60"
                disabled={isCreatingType}
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateTypeOpen(false)}
                disabled={isCreatingType}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isCreatingType}
              >
                Simpan Tipe Properti
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================================================================== */}
      {/* MODAL KHUSUS ADMIN: + TAMBAH DEVELOPER */}
      {/* ===================================================================== */}
      {isAdmin && (
        <Modal
          isOpen={isCreateDevOpen}
          onClose={() => setIsCreateDevOpen(false)}
          title="Tambah Mitra Developer Baru"
          isDismissDisabled={isCreatingDev}
        >
          <form onSubmit={handleCreateDeveloperSubmit} className="space-y-4">
            {createDevError && (
              <div
                role="alert"
                className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
              >
                <p className="font-semibold">{createDevError.message}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Kode Developer"
                required
                value={devCode}
                onChange={(e) => setDevCode(e.target.value.toUpperCase())}
                placeholder="DEV-04"
                disabled={isCreatingDev}
              />
              <Input
                label="Nama Perusahaan Developer"
                required
                value={devName}
                onChange={(e) => setDevName(e.target.value)}
                placeholder="PT Mitra Karya Propertindo"
                disabled={isCreatingDev}
              />
            </div>

            <Input
              label="Alamat Kantor Developer"
              required
              value={devAddress}
              onChange={(e) => setDevAddress(e.target.value)}
              disabled={isCreatingDev}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Nama PIC"
                required
                value={devPicName}
                onChange={(e) => setDevPicName(e.target.value)}
                disabled={isCreatingDev}
              />
              <Input
                label="Telepon PIC"
                required
                value={devPicPhone}
                onChange={(e) => setDevPicPhone(e.target.value)}
                disabled={isCreatingDev}
              />
              <Input
                label="Email PIC"
                type="email"
                value={devPicEmail}
                onChange={(e) => setDevPicEmail(e.target.value)}
                disabled={isCreatingDev}
              />
            </div>

            <Input
              label="Catatan Kebijakan Kerja Sama"
              value={devPolicyNotes}
              onChange={(e) => setDevPolicyNotes(e.target.value)}
              disabled={isCreatingDev}
            />

            <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateDevOpen(false)}
                disabled={isCreatingDev}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isCreatingDev}
              >
                Simpan Developer
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================================================================== */}
      {/* MODAL KHUSUS ADMIN: + TAMBAH PROMO */}
      {/* ===================================================================== */}
      {isAdmin && (
        <Modal
          isOpen={isCreatePromoOpen}
          onClose={() => setIsCreatePromoOpen(false)}
          title="Terbitkan Program Promo Baru"
          isDismissDisabled={isCreatingPromo}
        >
          <form onSubmit={handleCreatePromoSubmit} className="space-y-4">
            {createPromoError && (
              <div
                role="alert"
                className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
              >
                <p className="font-semibold">{createPromoError.message}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Proyek Perumahan"
                required
                value={promoProjectId}
                onChange={(e) => {
                  setPromoProjectId(e.target.value);
                  setPromoTypeId('');
                }}
                disabled={isCreatingPromo}
                options={projects.map((p) => ({
                  value: p.id,
                  label: `${p.code} — ${p.name}`,
                }))}
              />

              <Select
                label="Tipe Properti (Opsional)"
                value={promoTypeId}
                onChange={(e) => setPromoTypeId(e.target.value)}
                disabled={isCreatingPromo}
                options={[
                  { value: '', label: 'Semua Tipe di Proyek Ini' },
                  ...propertyTypes
                    .filter((pt) => pt.projectId === promoProjectId)
                    .map((pt) => ({
                      value: pt.id,
                      label: `${pt.code} — ${pt.name}`,
                    })),
                ]}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Kode Promo"
                required
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="PROMO-Q4-2026"
                disabled={isCreatingPromo}
              />
              <Input
                label="Nama Program Promo"
                required
                value={promoName}
                onChange={(e) => setPromoName(e.target.value)}
                placeholder="Subsidi Biaya Akad & Diskon Tunai"
                disabled={isCreatingPromo}
              />
            </div>

            <Input
              label="Deskripsi Ketentuan Promo"
              required
              value={promoDescription}
              onChange={(e) => setPromoDescription(e.target.value)}
              disabled={isCreatingPromo}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Jenis Skema Promo"
                value={promoKind}
                onChange={(e) => setPromoKind(e.target.value as PromoType)}
                disabled={isCreatingPromo}
                options={[
                  {
                    value: 'NOMINAL_DISCOUNT',
                    label: 'NOMINAL_DISCOUNT (Potongan Rupiah)',
                  },
                  {
                    value: 'PERCENTAGE_DISCOUNT',
                    label: 'PERCENTAGE_DISCOUNT (Potongan %)',
                  },
                  {
                    value: 'FREE_BENEFIT',
                    label: 'FREE_BENEFIT (Bonus Non-Tunai)',
                  },
                ]}
              />

              {promoKind === 'NOMINAL_DISCOUNT' ? (
                <CurrencyInput
                  label="Nilai Diskon (Rp)"
                  required
                  value={promoDiscountVal}
                  onValueChange={setPromoDiscountVal}
                  disabled={isCreatingPromo}
                />
              ) : promoKind !== 'FREE_BENEFIT' ? (
                <Input
                  label="Persentase Diskon (%)"
                  type="number"
                  required
                  value={promoDiscountVal}
                  onChange={(e) => setPromoDiscountVal(e.target.value)}
                  disabled={isCreatingPromo}
                />
              ) : (
                <Input
                  label="Rincian Bonus Non-Tunai"
                  required
                  value={promoBonusDesc}
                  onChange={(e) => setPromoBonusDesc(e.target.value)}
                  placeholder="Gratis Kanopi & AC 2 Unit"
                  disabled={isCreatingPromo}
                />
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Tanggal Mulai"
                type="date"
                required
                value={promoStartDate}
                onChange={(e) => setPromoStartDate(e.target.value)}
                disabled={isCreatingPromo}
              />
              <Input
                label="Tanggal Berakhir"
                type="date"
                required
                value={promoEndDate}
                onChange={(e) => setPromoEndDate(e.target.value)}
                disabled={isCreatingPromo}
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreatePromoOpen(false)}
                disabled={isCreatingPromo}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isCreatingPromo}
              >
                Terbitkan Promo
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
