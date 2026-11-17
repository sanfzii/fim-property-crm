// Lokasi: src/components/leads/LeadsWorkspaceClient.tsx
// Client Component Daftar Leads, Kanban Pipeline 9 Kolom & Modal Tambah Lead (DESIGN.md v2.1 Bag. 6.1)

'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  LayoutGrid,
  Table2,
  Lock,
  Phone,
  AlertCircle,
  ArrowUpRight,
  Building2,
  MessageSquare,
  Users,
  Flame,
  Sun,
} from 'lucide-react';
import type {
  LeadSource,
  LeadTemperature,
  PaymentMethod,
  PaymentReadiness,
  PipelineStage,
  PurchaseTimeline,
  SystemRole,
} from '@/types/database.types';
import {
  createLeadAction,
  transitionLeadPipelineAction,
} from '@/modules/crm/crm.actions';
import { formatRupiah, formatDateID } from '@/lib/utils/format';
import { KpiCard } from '@/components/ui/KpiCard';
import { Card, CardContent } from '@/components/ui/Card';
import {
  Badge,
  DomainStatusBadge,
  LeadTemperatureBadge,
} from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';

export interface LeadListItemDto {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  occupation: string | null;
  leadSource: LeadSource;
  assignedSalesId: string;
  assignedSalesName: string;
  teamId: string;
  teamCode: string;
  teamName: string;
  budgetAmount: number;
  preferredCity: string | null;
  preferredProjectId: string | null;
  preferredProjectName: string | null;
  preferredPropertyTypeId: string | null;
  preferredPropertyTypeName: string | null;
  preferredPaymentMethod: PaymentMethod | null;
  purchaseTimeline: PurchaseTimeline;
  paymentReadiness: PaymentReadiness;
  prospectScore: number;
  leadTemperature: LeadTemperature;
  pipelineStage: PipelineStage;
  lostReason: string | null;
  overdueTasksCount: number;
  lastInteractionAt: string | null;
  updatedAt: string;
}

export interface LeadProjectOption {
  id: string;
  code: string;
  name: string;
  city: string;
}

export interface LeadPropertyTypeOption {
  id: string;
  projectId: string;
  code: string;
  name: string;
}

export interface LeadTeamOption {
  id: string;
  code: string;
  name: string;
}

export interface LeadSalesOption {
  id: string;
  fullName: string;
  teamId: string;
  teamCode: string;
}

export interface LeadsWorkspaceClientProps {
  userRole: SystemRole;
  userId: string;
  userActiveTeamId: string | null;
  leads: LeadListItemDto[];
  projects: LeadProjectOption[];
  propertyTypes: LeadPropertyTypeOption[];
  teams: LeadTeamOption[];
  salesOptions: LeadSalesOption[];
}

interface PipelineColumnMeta {
  stage: PipelineStage;
  label: string;
  isTransactionLocked: boolean;
}

const PIPELINE_COLUMNS: PipelineColumnMeta[] = [
  { stage: 'NEW', label: 'NEW', isTransactionLocked: false },
  { stage: 'CONTACTED', label: 'CONTACTED', isTransactionLocked: false },
  { stage: 'QUALIFIED', label: 'QUALIFIED', isTransactionLocked: false },
  { stage: 'SITE_VISIT', label: 'SITE VISIT', isTransactionLocked: false },
  { stage: 'NEGOTIATION', label: 'NEGOTIATION', isTransactionLocked: false },
  { stage: 'BOOKING', label: 'BOOKING', isTransactionLocked: true },
  {
    stage: 'PAYMENT_KPR_PROCESS',
    label: 'PROSES BAYAR / KPR',
    isTransactionLocked: true,
  },
  { stage: 'CLOSED_WON', label: 'CLOSED WON', isTransactionLocked: true },
  { stage: 'CLOSED_LOST', label: 'CLOSED LOST', isTransactionLocked: false },
];

const PRE_TRANSACTION_TARGETS: {
  value: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'SITE_VISIT' | 'NEGOTIATION' | 'CLOSED_LOST';
  label: string;
}[] = [
  { value: 'NEW', label: 'NEW' },
  { value: 'CONTACTED', label: 'CONTACTED' },
  { value: 'QUALIFIED', label: 'QUALIFIED' },
  { value: 'SITE_VISIT', label: 'SITE VISIT' },
  { value: 'NEGOTIATION', label: 'NEGOTIATION' },
  { value: 'CLOSED_LOST', label: 'CLOSED LOST' },
];

const LEAD_SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'INSTAGRAM_ADS', label: 'Instagram Ads' },
  { value: 'FACEBOOK_ADS', label: 'Facebook Ads' },
  { value: 'TIKTOK_ADS', label: 'TikTok Ads' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'WALK_IN', label: 'Walk-In' },
  { value: 'EXPO_EVENT', label: 'Expo / Event' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'OTHER', label: 'Lainnya' },
];

function buildWhatsAppQuickUrl(phone: string, leadName: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  const normalized = digits.startsWith('0')
    ? `62${digits.slice(1)}`
    : digits.startsWith('62')
      ? digits
      : `62${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(
    `Halo Bapak/Ibu ${leadName}, saya dari tim pemasaran PT FIM-Property.`
  )}`;
}

export function LeadsWorkspaceClient({
  userRole,
  userActiveTeamId,
  leads,
  projects,
  propertyTypes,
  teams,
  salesOptions,
}: LeadsWorkspaceClientProps) {
  const router = useRouter();
  const { showToast } = useToast();

  // View & Filter State
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [tempFilter, setTempFilter] = useState<'ALL' | LeadTemperature>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | LeadSource>('ALL');
  const [stageFilter, setStageFilter] = useState<'ALL' | PipelineStage>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [salesFilter, setSalesFilter] = useState<string>('ALL');

  // Pipeline Transition State
  const [transitioningLeadId, setTransitioningLeadId] = useState<string | null>(
    null
  );
  const [lostModalLead, setLostModalLead] = useState<LeadListItemDto | null>(
    null
  );
  const [lostReasonInput, setLostReasonInput] = useState('');
  const [lostNotesInput, setLostNotesInput] = useState('');
  const [lostError, setLostError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  // Modal + Tambah Lead
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [occupation, setOccupation] = useState('');
  const [leadSource, setLeadSource] = useState<LeadSource>('INSTAGRAM_ADS');
  const [createTeamId, setCreateTeamId] = useState(
    userActiveTeamId ?? teams[0]?.id ?? ''
  );
  const [createSalesId, setCreateSalesId] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('0');
  const [preferredCity, setPreferredCity] = useState('');
  const [preferredProjectId, setPreferredProjectId] = useState('');
  const [preferredPropertyTypeId, setPreferredPropertyTypeId] = useState('');
  const [preferredPaymentMethod, setPreferredPaymentMethod] =
    useState<string>('KPR');
  const [purchaseTimeline, setPurchaseTimeline] =
    useState<PurchaseTimeline>('UNSPECIFIED');
  const [paymentReadiness, setPaymentReadiness] =
    useState<PaymentReadiness>('UNDECIDED');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  const canFilterBySales = userRole === 'ADMIN' || userRole === 'SUPERVISOR';

  const filterableSales = useMemo(() => {
    if (userRole === 'ADMIN' && teamFilter !== 'ALL') {
      return salesOptions.filter((s) => s.teamId === teamFilter);
    }
    return salesOptions;
  }, [salesOptions, teamFilter, userRole]);

  const modalSalesOptions = useMemo(() => {
    if (userRole === 'SUPERVISOR') {
      return salesOptions.filter((s) => s.teamId === userActiveTeamId);
    }
    if (userRole === 'ADMIN') {
      return salesOptions.filter((s) => s.teamId === createTeamId);
    }
    return [];
  }, [salesOptions, userRole, userActiveTeamId, createTeamId]);

  const modalPropertyTypes = useMemo(() => {
    if (!preferredProjectId) return [];
    return propertyTypes.filter((pt) => pt.projectId === preferredProjectId);
  }, [propertyTypes, preferredProjectId]);

  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return leads.filter((l) => {
      if (tempFilter !== 'ALL' && l.leadTemperature !== tempFilter) return false;
      if (sourceFilter !== 'ALL' && l.leadSource !== sourceFilter) return false;
      if (stageFilter !== 'ALL' && l.pipelineStage !== stageFilter) return false;
      if (userRole === 'ADMIN' && teamFilter !== 'ALL' && l.teamId !== teamFilter) {
        return false;
      }
      if (
        canFilterBySales &&
        salesFilter !== 'ALL' &&
        l.assignedSalesId !== salesFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        l.fullName.toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q) ||
        (l.preferredProjectName?.toLowerCase().includes(q) ?? false) ||
        l.assignedSalesName.toLowerCase().includes(q)
      );
    });
  }, [
    leads,
    searchQuery,
    tempFilter,
    sourceFilter,
    stageFilter,
    teamFilter,
    salesFilter,
    userRole,
    canFilterBySales,
  ]);

  const hotCount = leads.filter((l) => l.leadTemperature === 'HOT').length;
  const warmCount = leads.filter((l) => l.leadTemperature === 'WARM').length;
  const coldCount = leads.filter((l) => l.leadTemperature === 'COLD').length;
  const overdueLeadCount = leads.filter((l) => l.overdueTasksCount > 0).length;

  const openCreateModal = () => {
    const defaultTeam = userActiveTeamId ?? teams[0]?.id ?? '';
    const defaultSalesList =
      userRole === 'SUPERVISOR'
        ? salesOptions.filter((s) => s.teamId === userActiveTeamId)
        : salesOptions.filter((s) => s.teamId === defaultTeam);
    setFullName('');
    setPhone('');
    setEmail('');
    setOccupation('');
    setLeadSource('INSTAGRAM_ADS');
    setCreateTeamId(defaultTeam);
    setCreateSalesId(defaultSalesList[0]?.id ?? '');
    setBudgetAmount('0');
    setPreferredCity('');
    setPreferredProjectId('');
    setPreferredPropertyTypeId('');
    setPreferredPaymentMethod('KPR');
    setPurchaseTimeline('UNSPECIFIED');
    setPaymentReadiness('UNDECIDED');
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleCreateLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;
    setIsCreating(true);
    setCreateError(null);

    try {
      const payload: Record<string, unknown> = {
        fullName,
        phone,
        email: email.trim() ? email.trim() : null,
        occupation: occupation.trim() ? occupation.trim() : null,
        leadSource,
        budgetAmount: Number(budgetAmount) || 0,
        preferredCity: preferredCity.trim() ? preferredCity.trim() : null,
        preferredProjectId: preferredProjectId || null,
        preferredPropertyTypeId: preferredPropertyTypeId || null,
        preferredPaymentMethod: preferredPaymentMethod || null,
        purchaseTimeline,
        paymentReadiness,
      };

      if (userRole === 'ADMIN') {
        payload.teamId = createTeamId;
        payload.assignedSalesId = createSalesId;
      } else if (userRole === 'SUPERVISOR' && createSalesId) {
        payload.assignedSalesId = createSalesId;
      }

      const result = await createLeadAction(payload);
      if (result.success) {
        showToast({
          title: 'Lead Baru Tersimpan',
          description: result.message,
          tone: 'success',
        });
        setIsCreateOpen(false);
        router.refresh();
      } else {
        setCreateError({
          message: result.message,
          correlationId: result.correlationId,
        });
        showToast({
          title: 'Gagal Menambahkan Lead',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      setCreateError({
        message: 'Terjadi gangguan jaringan saat menyimpan Lead baru.',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleStageSelectChange = async (
    lead: LeadListItemDto,
    targetStage: string
  ) => {
    if (!targetStage || targetStage === lead.pipelineStage) return;

    if (targetStage === 'CLOSED_LOST') {
      setLostModalLead(lead);
      setLostReasonInput('');
      setLostNotesInput('');
      setLostError(null);
      return;
    }

    setTransitioningLeadId(lead.id);
    try {
      const result = await transitionLeadPipelineAction({
        leadId: lead.id,
        targetStage,
      });

      if (result.success) {
        showToast({
          title: 'Tahap Pipeline Diperbarui',
          description: result.message,
          tone: 'success',
        });
        router.refresh();
      } else {
        showToast({
          title: 'Transisi Tahap Ditolak',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      showToast({
        title: 'Gangguan Jaringan',
        description: 'Gagal menghubungi server untuk mengubah tahap pipeline.',
        tone: 'error',
      });
    } finally {
      setTransitioningLeadId(null);
    }
  };

  const handleClosedLostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lostModalLead || transitioningLeadId) return;
    setTransitioningLeadId(lostModalLead.id);
    setLostError(null);

    try {
      const result = await transitionLeadPipelineAction({
        leadId: lostModalLead.id,
        targetStage: 'CLOSED_LOST',
        lostReason: lostReasonInput,
        notes: lostNotesInput.trim() || null,
      });

      if (result.success) {
        showToast({
          title: 'Status Lead Diperbarui',
          description: result.message,
          tone: 'info',
        });
        setLostModalLead(null);
        router.refresh();
      } else {
        setLostError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setLostError({
        message: 'Terjadi gangguan jaringan saat memperbarui status Lead.',
      });
    } finally {
      setTransitioningLeadId(null);
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      {/* Header Ringkas */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Leads &amp; Pipeline
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            Prospek aktif, skor deterministik, dan tahapan pipeline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-1">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-white text-[#14532D] shadow-2xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Kanban Pipeline</span>
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
              <span>Tabel Daftar</span>
            </button>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={openCreateModal}
          >
            + Tambah Lead
          </Button>
        </div>
      </div>

      {/* 4 Kartu Ringkasan Skor OQ-04 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Leads"
          value={`${leads.length} Prospek`}
          subtext={`${filteredLeads.length} sesuai filter`}
          icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="HOT (Skor 75–100)"
          value={`${hotCount} Prospek`}
          subtext="Siap survei / negosiasi"
          icon={<Flame className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
        />
        <KpiCard
          label="WARM (Skor 45–74)"
          value={`${warmCount} Prospek`}
          subtext={`COLD (Skor 0–44): ${coldCount}`}
          icon={<Sun className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="Perlu Tindak Lanjut"
          value={`${overdueLeadCount} Lead`}
          subtext="Memiliki tugas overdue"
          icon={<AlertCircle className="h-4 w-4" strokeWidth={1.75} />}
          tone={overdueLeadCount > 0 ? 'error' : 'default'}
        />
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4">
          <div
            className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${
              userRole === 'ADMIN'
                ? 'lg:grid-cols-7'
                : canFilterBySales
                  ? 'lg:grid-cols-6'
                  : 'lg:grid-cols-5'
            }`}
          >
            <div className="relative lg:col-span-2">
              <Search
                className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[#94A3B8]"
                strokeWidth={1.75}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama prospek, no. HP, proyek..."
                aria-label="Cari prospek atau nomor HP"
                className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white pr-3 pl-9 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
              />
            </div>

            <select
              aria-label="Filter Temperatur Lead"
              value={tempFilter}
              onChange={(e) =>
                setTempFilter(e.target.value as 'ALL' | LeadTemperature)
              }
              className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            >
              <option value="ALL">Semua Temperatur</option>
              <option value="HOT">HOT (75–100)</option>
              <option value="WARM">WARM (45–74)</option>
              <option value="COLD">COLD (0–44)</option>
            </select>

            <select
              aria-label="Filter Sumber Lead"
              value={sourceFilter}
              onChange={(e) =>
                setSourceFilter(e.target.value as 'ALL' | LeadSource)
              }
              className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            >
              <option value="ALL">Semua Sumber</option>
              {LEAD_SOURCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter Tahap Pipeline"
              value={stageFilter}
              onChange={(e) =>
                setStageFilter(e.target.value as 'ALL' | PipelineStage)
              }
              className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            >
              <option value="ALL">Semua Tahap</option>
              {PIPELINE_COLUMNS.map((col) => (
                <option key={col.stage} value={col.stage}>
                  {col.label}
                </option>
              ))}
            </select>

            {canFilterBySales && (
              <div
                className={
                  userRole === 'ADMIN'
                    ? 'grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2'
                    : 'flex gap-2'
                }
              >
                {userRole === 'ADMIN' && (
                  <select
                    aria-label="Filter Tim"
                    value={teamFilter}
                    onChange={(e) => {
                      setTeamFilter(e.target.value);
                      setSalesFilter('ALL');
                    }}
                    className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                  >
                    <option value="ALL">Semua Tim</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  aria-label="Filter Sales"
                  value={salesFilter}
                  onChange={(e) => setSalesFilter(e.target.value)}
                  className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                >
                  <option value="ALL">Semua Sales</option>
                  {filterableSales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Konten Utama: Kanban 9 Kolom vs Tabel Daftar */}
      {filteredLeads.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              title="Prospek Tidak Ditemukan"
              description="Tidak ada data Lead yang sesuai dengan filter pencarian saat ini."
            />
          </CardContent>
        </Card>
      ) : viewMode === 'kanban' ? (
        <>
          {/* Mobile (< 768px): Daftar Kartu Kanban Ringkas Ramah Sentuh */}
          <div className="space-y-4 md:hidden">
            {PIPELINE_COLUMNS.map((col) => {
              const colLeads = filteredLeads.filter(
                (l) => l.pipelineStage === col.stage
              );
              if (stageFilter !== 'ALL' && stageFilter !== col.stage) {
                return null;
              }
              return (
                <Card key={col.stage}>
                  <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 rounded-t-lg">
                    <div className="flex items-center gap-2">
                      {col.isTransactionLocked && (
                        <Lock
                          className="h-3.5 w-3.5 text-[#64748B]"
                          strokeWidth={1.75}
                        />
                      )}
                      <span className="text-xs font-bold tracking-wide text-[#0F172A]">
                        {col.label}
                      </span>
                      {col.isTransactionLocked && (
                        <span className="rounded bg-[#E2E8F0] px-1.5 py-0.5 text-[10px] font-medium text-[#475569]">
                          Otomatis Sistem
                        </span>
                      )}
                    </div>
                    <Badge tone="slate">{colLeads.length}</Badge>
                  </div>

                  <div className="divide-y divide-[#E2E8F0]">
                    {colLeads.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-[#94A3B8]">
                        Tidak ada prospek.
                      </p>
                    ) : (
                      colLeads.map((lead) => (
                        <div key={lead.id} className="space-y-2.5 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <Link
                              href={`/leads/${lead.id}`}
                              className="text-sm font-semibold text-[#14532D] hover:underline"
                            >
                              {lead.fullName}
                            </Link>
                            <LeadTemperatureBadge
                              temperature={lead.leadTemperature}
                              score={lead.prospectScore}
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#475569]">
                            <span className="font-mono tabular-nums">
                              {lead.phone}
                            </span>
                            <span>•</span>
                            <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                              {formatRupiah(lead.budgetAmount)}
                            </span>
                          </div>

                          {lead.preferredProjectName && (
                            <p className="text-xs text-[#64748B]">
                              {lead.preferredProjectName}
                              {lead.preferredPropertyTypeName
                                ? ` • ${lead.preferredPropertyTypeName}`
                                : ''}
                            </p>
                          )}

                          <div className="flex items-center justify-between gap-2 pt-1">
                            <Link
                              href={`/leads/${lead.id}`}
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 text-xs font-semibold text-[#0F172A]"
                            >
                              <span>Detail</span>
                              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </Link>

                            {!col.isTransactionLocked && (
                              <select
                                aria-label={`Pindah tahap ${lead.fullName}`}
                                value={lead.pipelineStage}
                                disabled={transitioningLeadId === lead.id}
                                onChange={(e) =>
                                  handleStageSelectChange(lead, e.target.value)
                                }
                                className="h-8 rounded-md border border-[#CBD5E1] bg-white px-2 text-xs font-medium text-[#0F172A]"
                              >
                                {PRE_TRANSACTION_TARGETS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Desktop & Tablet (>= 768px): Kanban Horizontal 9 Kolom */}
          <div className="hidden w-full overflow-x-auto pb-4 md:block">
            <div className="flex min-w-max items-start gap-3.5">
              {PIPELINE_COLUMNS.map((col) => {
                const colLeads = filteredLeads.filter(
                  (l) => l.pipelineStage === col.stage
                );
                return (
                  <div
                    key={col.stage}
                    data-pipeline-column={col.stage}
                    className={`flex w-[280px] shrink-0 flex-col rounded-lg border ${
                      col.isTransactionLocked
                        ? 'border-[#CBD5E1] bg-[#F1F5F9]/80'
                        : 'border-[#E2E8F0] bg-[#F8FAFC]'
                    }`}
                  >
                    {/* Column Header */}
                    <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] bg-white px-3.5 py-3 rounded-t-lg">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {col.isTransactionLocked && (
                            <Lock
                              className="h-3.5 w-3.5 shrink-0 text-[#64748B]"
                              strokeWidth={1.75}
                            />
                          )}
                          <h2 className="truncate text-xs font-bold tracking-wide text-[#0F172A]">
                            {col.label}
                          </h2>
                        </div>
                        {col.isTransactionLocked && (
                          <p className="mt-0.5 text-[10px] font-medium text-[#64748B]">
                            Otomatis Sistem
                          </p>
                        )}
                      </div>
                      <span className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full bg-[#F1F5F9] px-1.5 font-mono text-[11px] font-bold text-[#334155] tabular-nums">
                        {colLeads.length}
                      </span>
                    </div>

                    {/* Column Cards */}
                    <div className="max-h-[640px] space-y-2.5 overflow-y-auto p-2.5">
                      {colLeads.length === 0 ? (
                        <div className="rounded-md border border-dashed border-[#CBD5E1] p-4 text-center text-[11px] text-[#94A3B8]">
                          Kosong
                        </div>
                      ) : (
                        colLeads.map((lead) => (
                          <div
                            key={lead.id}
                            className="rounded-lg border border-[#E2E8F0] bg-white p-3 shadow-2xs transition-colors hover:border-[#CBD5E1]"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <Link
                                href={`/leads/${lead.id}`}
                                className="line-clamp-1 text-xs font-bold text-[#14532D] hover:underline"
                              >
                                {lead.fullName}
                              </Link>
                              <LeadTemperatureBadge
                                temperature={lead.leadTemperature}
                                score={lead.prospectScore}
                              />
                            </div>

                            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#475569] tabular-nums">
                              <Phone
                                className="h-3 w-3 shrink-0 text-[#94A3B8]"
                                strokeWidth={1.75}
                              />
                              <span className="font-mono">{lead.phone}</span>
                            </div>

                            {lead.preferredProjectName && (
                              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#64748B]">
                                <Building2
                                  className="h-3 w-3 shrink-0 text-[#94A3B8]"
                                  strokeWidth={1.75}
                                />
                                <span className="truncate">
                                  {lead.preferredProjectName}
                                </span>
                              </div>
                            )}

                            <div className="mt-2 flex items-center justify-between border-t border-[#F1F5F9] pt-2 text-[11px]">
                              <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                                {formatRupiah(lead.budgetAmount)}
                              </span>
                              {lead.overdueTasksCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-semibold text-[#B91C1C]">
                                  <AlertCircle
                                    className="h-3 w-3"
                                    strokeWidth={1.75}
                                  />
                                  {lead.overdueTasksCount} Overdue
                                </span>
                              )}
                            </div>

                            {canFilterBySales && (
                              <p className="mt-1.5 truncate text-[10px] font-medium text-[#64748B]">
                                {lead.assignedSalesName} • {lead.teamCode}
                              </p>
                            )}

                            {/* Action Row */}
                            <div className="mt-2.5 flex items-center justify-between gap-1.5 border-t border-[#F1F5F9] pt-2">
                              <Link
                                href={`/leads/${lead.id}`}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#059669] hover:underline"
                              >
                                <span>Detail</span>
                                <ArrowUpRight
                                  className="h-3 w-3"
                                  strokeWidth={1.75}
                                />
                              </Link>

                              {col.isTransactionLocked ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#64748B]">
                                  <Lock className="h-3 w-3" strokeWidth={1.75} />
                                  Terkunci
                                </span>
                              ) : (
                                <select
                                  aria-label={`Pindah tahap ${lead.fullName}`}
                                  value={lead.pipelineStage}
                                  disabled={transitioningLeadId === lead.id}
                                  onChange={(e) =>
                                    handleStageSelectChange(lead, e.target.value)
                                  }
                                  className="h-7 max-w-[140px] rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 text-[10px] font-semibold text-[#0F172A] focus:border-[#059669] focus:outline-none"
                                >
                                  {PRE_TRANSACTION_TARGETS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      → {opt.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* Mode Tabel Daftar */
        <Card>
          <CardContent className="p-0">
            {/* Desktop Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                    <th className="px-4 py-3">Calon Pembeli</th>
                    <th className="px-4 py-3">Skor &amp; Temperatur</th>
                    <th className="px-4 py-3">Tahap Pipeline</th>
                    <th className="px-4 py-3">Minat Proyek &amp; Budget</th>
                    {canFilterBySales && <th className="px-4 py-3">Sales &amp; Tim</th>}
                    <th className="px-4 py-3">Kontak Terakhir</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {filteredLeads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="font-bold text-[#14532D] hover:underline"
                        >
                          {lead.fullName}
                        </Link>
                        <p className="font-mono text-[11px] text-[#64748B] tabular-nums">
                          {lead.phone} • {lead.leadSource.replace(/_/g, ' ')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <LeadTemperatureBadge
                            temperature={lead.leadTemperature}
                            score={lead.prospectScore}
                          />
                          {lead.overdueTasksCount > 0 && (
                            <Badge tone="red">
                              {lead.overdueTasksCount} Overdue
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <DomainStatusBadge value={lead.pipelineStage} />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#0F172A]">
                          {lead.preferredProjectName ?? 'Belum ditentukan'}
                        </p>
                        <p className="font-mono text-[11px] text-[#475569] tabular-nums">
                          Budget: {formatRupiah(lead.budgetAmount)}
                        </p>
                      </td>
                      {canFilterBySales && (
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#0F172A]">
                            {lead.assignedSalesName}
                          </p>
                          <p className="font-mono text-[11px] text-[#64748B]">
                            {lead.teamCode}
                          </p>
                        </td>
                      )}
                      <td className="px-4 py-3 text-[#64748B] tabular-nums">
                        {formatDateID(lead.lastInteractionAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <a
                            href={buildWhatsAppQuickUrl(lead.phone, lead.fullName)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-7 items-center gap-1 rounded border border-[#A7F3D0] bg-[#ECFDF5] px-2 text-[11px] font-semibold text-[#047857] hover:bg-[#D1FAE5]"
                          >
                            <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
                            <span>WA</span>
                          </a>
                          <Link
                            href={`/leads/${lead.id}`}
                            className="inline-flex h-7 items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 text-[11px] font-semibold text-[#0F172A] hover:bg-[#F8FAFC]"
                          >
                            <span>Detail</span>
                            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards (< 768px) */}
            <div className="divide-y divide-[#E2E8F0] md:hidden">
              {filteredLeads.map((lead) => (
                <div key={lead.id} className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-sm font-bold text-[#14532D]"
                    >
                      {lead.fullName}
                    </Link>
                    <LeadTemperatureBadge
                      temperature={lead.leadTemperature}
                      score={lead.prospectScore}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <DomainStatusBadge value={lead.pipelineStage} />
                    {lead.overdueTasksCount > 0 && (
                      <Badge tone="red">{lead.overdueTasksCount} Overdue</Badge>
                    )}
                  </div>
                  <p className="font-mono text-xs text-[#475569] tabular-nums">
                    {lead.phone} • {formatRupiah(lead.budgetAmount)}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-[#CBD5E1] bg-white text-xs font-semibold text-[#0F172A]"
                    >
                      <span>Buka Detail</span>
                      <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal 1: + Tambah Lead */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Tambah Lead Baru"
        description="Skor prospek awal dihitung otomatis di server berdasarkan kualifikasi OQ-04."
        size="lg"
        isDismissDisabled={isCreating}
      >
        <form onSubmit={handleCreateLeadSubmit} className="space-y-4">
          {createError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{createError.message}</p>
              {createError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  Ref: {createError.correlationId}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Nama Lengkap Calon Pembeli"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Contoh: Budi Santoso"
              disabled={isCreating}
            />
            <Input
              label="Nomor Telepon / WhatsApp"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="081234567890"
              disabled={isCreating}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Email (Opsional)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="budi@email.com"
              disabled={isCreating}
            />
            <Input
              label="Pekerjaan / Profesi"
              value={occupation}
              onChange={(e) => setOccupation(e.target.value)}
              placeholder="Karyawan Swasta"
              disabled={isCreating}
            />
            <Select
              label="Sumber Lead"
              required
              value={leadSource}
              onChange={(e) => setLeadSource(e.target.value as LeadSource)}
              disabled={isCreating}
              options={LEAD_SOURCE_OPTIONS}
            />
          </div>

          {/* Penugasan OQ-01: Hanya ADMIN & SUPERVISOR yang memilih Sales */}
          {userRole === 'ADMIN' && (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 sm:grid-cols-2">
              <Select
                label="Tim Penjualan"
                required
                value={createTeamId}
                onChange={(e) => {
                  const nextTeam = e.target.value;
                  setCreateTeamId(nextTeam);
                  const matching = salesOptions.filter(
                    (s) => s.teamId === nextTeam
                  );
                  setCreateSalesId(matching[0]?.id ?? '');
                }}
                disabled={isCreating}
                options={teams.map((t) => ({
                  value: t.id,
                  label: `${t.code} — ${t.name}`,
                }))}
              />
              <Select
                label="Sales Penanggung Jawab"
                required
                value={createSalesId}
                onChange={(e) => setCreateSalesId(e.target.value)}
                disabled={isCreating}
                options={modalSalesOptions.map((s) => ({
                  value: s.id,
                  label: s.fullName,
                }))}
              />
            </div>
          )}

          {userRole === 'SUPERVISOR' && (
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
              <Select
                label="Sales Penanggung Jawab (Tim Aktif)"
                required
                value={createSalesId}
                onChange={(e) => setCreateSalesId(e.target.value)}
                disabled={isCreating}
                options={modalSalesOptions.map((s) => ({
                  value: s.id,
                  label: `${s.fullName} (${s.teamCode})`,
                }))}
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CurrencyInput
              label="Estimasi Budget (Rp)"
              min={0}
              required
              value={budgetAmount}
              onValueChange={setBudgetAmount}
              disabled={isCreating}
            />
            <Select
              label="Minat Proyek"
              value={preferredProjectId}
              onChange={(e) => {
                setPreferredProjectId(e.target.value);
                setPreferredPropertyTypeId('');
              }}
              disabled={isCreating}
              options={[
                { value: '', label: 'Belum Dipilih' },
                ...projects.map((p) => ({
                  value: p.id,
                  label: `${p.code} — ${p.name}`,
                })),
              ]}
            />
            <Select
              label="Minat Tipe Properti"
              value={preferredPropertyTypeId}
              onChange={(e) => setPreferredPropertyTypeId(e.target.value)}
              disabled={isCreating || !preferredProjectId}
              options={[
                { value: '', label: 'Semua Tipe' },
                ...modalPropertyTypes.map((pt) => ({
                  value: pt.id,
                  label: `${pt.code} — ${pt.name}`,
                })),
              ]}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Target Waktu Beli"
              value={purchaseTimeline}
              onChange={(e) =>
                setPurchaseTimeline(e.target.value as PurchaseTimeline)
              }
              disabled={isCreating}
              options={[
                { value: 'UNSPECIFIED', label: 'Belum Ditentukan' },
                { value: 'IMMEDIATE_LT_1M', label: 'Segera (< 1 Bulan)' },
                { value: 'SHORT_1_3M', label: 'Jangka Pendek (1–3 Bulan)' },
                { value: 'MEDIUM_3_6M', label: 'Menengah (3–6 Bulan)' },
                { value: 'LONG_GT_6M', label: 'Jangka Panjang (> 6 Bulan)' },
              ]}
            />
            <Select
              label="Kesiapan Pembayaran"
              value={paymentReadiness}
              onChange={(e) =>
                setPaymentReadiness(e.target.value as PaymentReadiness)
              }
              disabled={isCreating}
              options={[
                { value: 'UNDECIDED', label: 'Belum Jelas' },
                {
                  value: 'READY_FULL_OR_DP_DOCS',
                  label: 'Dana Cash / DP + Dokumen Siap',
                },
                {
                  value: 'DP_READY_COLLECTING_DOCS',
                  label: 'DP Siap, Kumpul Dokumen',
                },
                { value: 'SAVING_FOR_DP', label: 'Menyiapkan Dana DP' },
              ]}
            />
            <Select
              label="Rencana Metode Bayar"
              value={preferredPaymentMethod}
              onChange={(e) => setPreferredPaymentMethod(e.target.value)}
              disabled={isCreating}
              options={[
                { value: 'KPR', label: 'KPR Bank' },
                { value: 'CASH_KERAS', label: 'Cash Keras' },
                { value: 'CASH_BERTAHAP', label: 'Cash Bertahap' },
                { value: '', label: 'Belum Dipilih' },
              ]}
            />
          </div>

          <Input
            label="Preferensi Kota / Area (Opsional)"
            value={preferredCity}
            onChange={(e) => setPreferredCity(e.target.value)}
            placeholder="Contoh: Tangerang Selatan / Bekasi"
            disabled={isCreating}
          />

          <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
              disabled={isCreating}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" isLoading={isCreating}>
              Simpan Lead Baru
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Alasan Gagal (CLOSED_LOST) */}
      <Modal
        isOpen={Boolean(lostModalLead)}
        onClose={() => setLostModalLead(null)}
        title={
          lostModalLead
            ? `Tutup Lead: ${lostModalLead.fullName}`
            : 'Tutup Lead (CLOSED_LOST)'
        }
        description="Wajib mengisi alasan gagal (minimal 3 karakter) untuk menutup Lead ke tahap CLOSED_LOST."
        isDismissDisabled={Boolean(transitioningLeadId)}
      >
        <form onSubmit={handleClosedLostSubmit} className="space-y-4">
          {lostError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{lostError.message}</p>
              {lostError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  Ref: {lostError.correlationId}
                </p>
              )}
            </div>
          )}

          <Input
            label="Alasan Gagal (Lost Reason)"
            required
            minLength={3}
            value={lostReasonInput}
            onChange={(e) => setLostReasonInput(e.target.value)}
            placeholder="Contoh: Budget belum sesuai atau membeli unit di lokasi lain"
            disabled={Boolean(transitioningLeadId)}
          />

          <div>
            <label
              htmlFor="lostNotes"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Catatan Tambahan (Opsional)
            </label>
            <textarea
              id="lostNotes"
              rows={3}
              value={lostNotesInput}
              onChange={(e) => setLostNotesInput(e.target.value)}
              disabled={Boolean(transitioningLeadId)}
              className="mt-1.5 block w-full rounded-md border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLostModalLead(null)}
              disabled={Boolean(transitioningLeadId)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="destructive"
              isLoading={Boolean(transitioningLeadId)}
            >
              Tandai CLOSED_LOST
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
