// Lokasi: src/components/site-visits/SiteVisitsWorkspaceClient.tsx
// Client Component Halaman Survei Lokasi (/site-visits)

'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MapPin,
  Search,
  CalendarClock,
  CheckCircle2,
  ArrowUpRight,
} from 'lucide-react';
import type {
  SiteVisitOutcome,
  SiteVisitStatus,
  SystemRole,
} from '@/types/database.types';
import {
  scheduleSiteVisitAction,
  completeSiteVisitAction,
} from '@/modules/crm/crm.actions';
import { formatDateTimeID } from '@/lib/utils/format';
import { KpiCard } from '@/components/ui/KpiCard';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge, DomainStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';

export interface SiteVisitRowDto {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  salesId: string;
  salesName: string;
  teamCode: string;
  projectId: string;
  projectName: string;
  unitId: string | null;
  unitCode: string | null;
  scheduledAt: string;
  preparationNotes: string | null;
  status: SiteVisitStatus;
  outcome: SiteVisitOutcome | null;
  evaluationNotes: string | null;
  completedAt: string | null;
}

export interface SiteVisitLeadOption {
  id: string;
  fullName: string;
  phone: string;
  preferredProjectId: string | null;
}

export interface SiteVisitProjectOption {
  id: string;
  code: string;
  name: string;
}

export interface SiteVisitUnitOption {
  id: string;
  projectId: string;
  unitCode: string;
  blockNumber: string;
}

export interface SiteVisitsWorkspaceClientProps {
  userRole: SystemRole;
  siteVisits: SiteVisitRowDto[];
  leads: SiteVisitLeadOption[];
  projects: SiteVisitProjectOption[];
  availableUnits: SiteVisitUnitOption[];
}

function getDefaultLocalDatetime(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function SiteVisitsWorkspaceClient({
  userRole,
  siteVisits,
  leads,
  projects,
  availableUnits,
}: SiteVisitsWorkspaceClientProps) {
  const router = useRouter();
  const { showToast } = useToast();

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | SiteVisitStatus>(
    'ALL'
  );
  const [projectFilter, setProjectFilter] = useState<string>('ALL');

  // Modal + Jadwalkan Survei
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [visitLeadId, setVisitLeadId] = useState(leads[0]?.id ?? '');
  const [visitProjectId, setVisitProjectId] = useState(projects[0]?.id ?? '');
  const [visitUnitId, setVisitUnitId] = useState('');
  const [visitScheduledAt, setVisitScheduledAt] = useState('');
  const [visitPrepNotes, setVisitPrepNotes] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  // Modal Catat Hasil Survei
  const [completingVisit, setCompletingVisit] =
    useState<SiteVisitRowDto | null>(null);
  const [outcomeInput, setOutcomeInput] =
    useState<SiteVisitOutcome>('POSITIVE_INTEREST');
  const [evaluationNotesInput, setEvaluationNotesInput] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  const canSeeSalesColumn = userRole === 'ADMIN' || userRole === 'SUPERVISOR';

  const filteredVisits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return siteVisits.filter((v) => {
      if (statusFilter !== 'ALL' && v.status !== statusFilter) return false;
      if (projectFilter !== 'ALL' && v.projectId !== projectFilter) return false;
      if (!q) return true;
      return (
        v.leadName.toLowerCase().includes(q) ||
        v.projectName.toLowerCase().includes(q) ||
        (v.unitCode?.toLowerCase().includes(q) ?? false) ||
        v.salesName.toLowerCase().includes(q)
      );
    });
  }, [siteVisits, searchQuery, statusFilter, projectFilter]);

  const scheduledCount = siteVisits.filter(
    (v) => v.status === 'SCHEDULED' || v.status === 'RESCHEDULED'
  ).length;
  const completedCount = siteVisits.filter(
    (v) => v.status === 'COMPLETED'
  ).length;
  const positiveCount = siteVisits.filter(
    (v) => v.status === 'COMPLETED' && v.outcome === 'POSITIVE_INTEREST'
  ).length;

  const projectUnits = useMemo(
    () => availableUnits.filter((u) => u.projectId === visitProjectId),
    [availableUnits, visitProjectId]
  );

  const openScheduleModal = () => {
    const firstLead = leads[0];
    const defaultProjId =
      firstLead?.preferredProjectId ?? projects[0]?.id ?? '';
    setVisitLeadId(firstLead?.id ?? '');
    setVisitProjectId(defaultProjId);
    setVisitUnitId('');
    setVisitScheduledAt(getDefaultLocalDatetime());
    setVisitPrepNotes('');
    setScheduleError(null);
    setIsScheduleOpen(true);
  };

  const openCompleteModal = (visit: SiteVisitRowDto) => {
    setCompletingVisit(visit);
    setOutcomeInput('POSITIVE_INTEREST');
    setEvaluationNotesInput('');
    setCompleteError(null);
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isScheduling || !visitLeadId || !visitProjectId) return;
    setIsScheduling(true);
    setScheduleError(null);

    try {
      const isoTime = new Date(visitScheduledAt).toISOString();
      const result = await scheduleSiteVisitAction({
        leadId: visitLeadId,
        projectId: visitProjectId,
        unitId: visitUnitId || null,
        scheduledAt: isoTime,
        preparationNotes: visitPrepNotes.trim() || null,
      });

      if (result.success) {
        showToast({
          title: 'Survei Lokasi Dijadwalkan',
          description: result.message,
          tone: 'success',
        });
        setIsScheduleOpen(false);
        router.refresh();
      } else {
        setScheduleError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setScheduleError({
        message: 'Terjadi gangguan jaringan atau format tanggal tidak valid.',
      });
    } finally {
      setIsScheduling(false);
    }
  };

  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingVisit || isCompleting) return;
    setIsCompleting(true);
    setCompleteError(null);

    try {
      const result = await completeSiteVisitAction({
        siteVisitId: completingVisit.id,
        customerInterestOutcome: outcomeInput,
        evaluationNotes: evaluationNotesInput,
      });

      if (result.success) {
        showToast({
          title: 'Hasil Survei Dicatat',
          description: result.message,
          tone: 'success',
        });
        setCompletingVisit(null);
        router.refresh();
      } else {
        setCompleteError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setCompleteError({
        message: 'Terjadi gangguan jaringan saat mencatat hasil survei.',
      });
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Ringkas */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Survei Lokasi
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            Jadwal kunjungan lokasi perumahan dan evaluasi minat prospek.
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={openScheduleModal}
          disabled={leads.length === 0 || projects.length === 0}
        >
          + Jadwalkan Survei
        </Button>
      </div>

      {/* 3 Kartu KPI Survei */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total Agenda"
          value={`${siteVisits.length} Survei`}
          subtext={`${scheduledCount} Terjadwal / Reschedule`}
          icon={<CalendarClock className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="Survei Selesai"
          value={`${completedCount} Selesai`}
          subtext="Evaluasi tercatat"
          icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="Minat Positif"
          value={`${positiveCount} Prospek`}
          subtext="Skor Interaksi +25"
          icon={<MapPin className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
        />
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[#94A3B8]"
                strokeWidth={1.75}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari prospek, proyek, unit..."
                aria-label="Cari jadwal survei lokasi"
                className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white pr-3 pl-9 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
              />
            </div>

            <select
              aria-label="Filter Status Survei"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'ALL' | SiteVisitStatus)
              }
              className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            >
              <option value="ALL">Semua Status ({siteVisits.length})</option>
              <option value="SCHEDULED">SCHEDULED</option>
              <option value="RESCHEDULED">RESCHEDULED</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>

            <select
              aria-label="Filter Proyek Survei"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            >
              <option value="ALL">Semua Proyek ({projects.length})</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Tabel & Kartu Responsif */}
      <Card>
        <CardContent className="p-0">
          {filteredVisits.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Belum Ada Jadwal Survei"
                description="Jadwalkan kunjungan survei lokasi dari tombol di atas atau dari halaman detail Lead."
              />
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                      <th className="px-4 py-3">Calon Pembeli</th>
                      <th className="px-4 py-3">Proyek &amp; Unit</th>
                      <th className="px-4 py-3">Jadwal Survei</th>
                      {canSeeSalesColumn && <th className="px-4 py-3">Sales</th>}
                      <th className="px-4 py-3">Status &amp; Hasil</th>
                      <th className="px-4 py-3">Catatan</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {filteredVisits.map((visit) => {
                      const canComplete =
                        visit.status === 'SCHEDULED' ||
                        visit.status === 'RESCHEDULED';
                      return (
                        <tr key={visit.id} className="hover:bg-[#F8FAFC]">
                          <td className="px-4 py-3">
                            <Link
                              href={`/leads/${visit.leadId}`}
                              className="inline-flex items-center gap-1 font-bold text-[#14532D] hover:underline"
                            >
                              <span>{visit.leadName}</span>
                              <ArrowUpRight className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                            </Link>
                            <p className="font-mono text-[11px] text-[#64748B] tabular-nums">
                              {visit.leadPhone}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-[#0F172A]">
                              {visit.projectName}
                            </p>
                            <p className="font-mono text-[11px] text-[#64748B]">
                              {visit.unitCode
                                ? `Unit ${visit.unitCode}`
                                : 'Umum / Show Unit'}
                            </p>
                          </td>
                          <td className="px-4 py-3 font-medium text-[#0F172A] tabular-nums">
                            {formatDateTimeID(visit.scheduledAt)}
                          </td>
                          {canSeeSalesColumn && (
                            <td className="px-4 py-3">
                              <p className="font-medium text-[#0F172A]">
                                {visit.salesName}
                              </p>
                              <p className="font-mono text-[11px] text-[#64748B]">
                                {visit.teamCode}
                              </p>
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <div className="flex flex-col items-start gap-1">
                              <DomainStatusBadge value={visit.status} />
                              {visit.outcome && (
                                <Badge
                                  tone={
                                    visit.outcome === 'POSITIVE_INTEREST'
                                      ? 'emerald'
                                      : visit.outcome === 'NEUTRAL_CONSIDERATION'
                                        ? 'amber'
                                        : 'red'
                                  }
                                >
                                  {visit.outcome.replace(/_/g, ' ')}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 max-w-[260px] text-[#475569]">
                            {visit.status === 'COMPLETED'
                              ? (visit.evaluationNotes ?? '—')
                              : (visit.preparationNotes ?? '—')}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {canComplete ? (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="whitespace-nowrap"
                                onClick={() => openCompleteModal(visit)}
                              >
                                Catat Hasil
                              </Button>
                            ) : (
                              <Link
                                href={`/leads/${visit.leadId}`}
                                className="inline-flex h-8 items-center rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium whitespace-nowrap text-[#0F172A] hover:bg-[#F8FAFC]"
                              >
                                Buka Lead
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Table-to-Card (< 768px) */}
              <div className="divide-y divide-[#E2E8F0] md:hidden">
                {filteredVisits.map((visit) => {
                  const canComplete =
                    visit.status === 'SCHEDULED' ||
                    visit.status === 'RESCHEDULED';
                  return (
                    <div key={visit.id} className="space-y-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/leads/${visit.leadId}`}
                          className="text-sm font-bold text-[#14532D]"
                        >
                          {visit.leadName}
                        </Link>
                        <DomainStatusBadge value={visit.status} />
                      </div>
                      <p className="text-xs font-medium text-[#0F172A]">
                        {visit.projectName}
                        {visit.unitCode ? ` • Unit ${visit.unitCode}` : ''}
                      </p>
                      <p className="text-xs text-[#64748B] tabular-nums">
                        {formatDateTimeID(visit.scheduledAt)}
                      </p>
                      {visit.outcome && (
                        <Badge
                          tone={
                            visit.outcome === 'POSITIVE_INTEREST'
                              ? 'emerald'
                              : visit.outcome === 'NEUTRAL_CONSIDERATION'
                                ? 'amber'
                                : 'red'
                          }
                        >
                          {visit.outcome.replace(/_/g, ' ')}
                        </Badge>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <Link
                          href={`/leads/${visit.leadId}`}
                          className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-[#CBD5E1] bg-white text-xs font-semibold text-[#0F172A]"
                        >
                          Detail Lead
                        </Link>
                        {canComplete && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="flex-1"
                            onClick={() => openCompleteModal(visit)}
                          >
                            Catat Hasil
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Modal 1: + Jadwalkan Survei */}
      <Modal
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        title="Jadwalkan Survei Lokasi"
        description="Penjadwalan Site Visit otomatis memajukan tahap Lead pra-survei ke SITE_VISIT dan memperbarui skor prospek."
        isDismissDisabled={isScheduling}
      >
        <form onSubmit={handleScheduleSubmit} className="space-y-4">
          {scheduleError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{scheduleError.message}</p>
              {scheduleError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  Ref: {scheduleError.correlationId}
                </p>
              )}
            </div>
          )}

          <Select
            label="Pilih Lead Calon Pembeli"
            required
            value={visitLeadId}
            onChange={(e) => {
              const nextLeadId = e.target.value;
              setVisitLeadId(nextLeadId);
              const found = leads.find((l) => l.id === nextLeadId);
              if (found?.preferredProjectId) {
                setVisitProjectId(found.preferredProjectId);
                setVisitUnitId('');
              }
            }}
            disabled={isScheduling}
            options={leads.map((l) => ({
              value: l.id,
              label: `${l.fullName} (${l.phone})`,
            }))}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Proyek Perumahan"
              required
              value={visitProjectId}
              onChange={(e) => {
                setVisitProjectId(e.target.value);
                setVisitUnitId('');
              }}
              disabled={isScheduling}
              options={projects.map((p) => ({
                value: p.id,
                label: `${p.code} — ${p.name}`,
              }))}
            />

            <Select
              label="Unit Spesifik (Opsional)"
              value={visitUnitId}
              onChange={(e) => setVisitUnitId(e.target.value)}
              disabled={isScheduling}
              options={[
                { value: '', label: 'Show Unit / Umum' },
                ...projectUnits.map((u) => ({
                  value: u.id,
                  label: `${u.unitCode} (${u.blockNumber})`,
                })),
              ]}
            />
          </div>

          <div>
            <label
              htmlFor="siteVisitScheduledAt"
              className="mb-1.5 block text-xs font-semibold text-[#0F172A]"
            >
              Tanggal &amp; Waktu Survei
            </label>
            <input
              id="siteVisitScheduledAt"
              type="datetime-local"
              required
              value={visitScheduledAt}
              onChange={(e) => setVisitScheduledAt(e.target.value)}
              disabled={isScheduling}
              className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="siteVisitPrepNotes"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Catatan Persiapan (Opsional)
            </label>
            <textarea
              id="siteVisitPrepNotes"
              rows={3}
              value={visitPrepNotes}
              onChange={(e) => setVisitPrepNotes(e.target.value)}
              disabled={isScheduling}
              placeholder="Contoh: Siapkan kunci show unit dan brosur simulasi KPR."
              className="mt-1.5 block w-full rounded-md border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsScheduleOpen(false)}
              disabled={isScheduling}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" isLoading={isScheduling}>
              Simpan Jadwal Survei
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Catat Hasil Survei */}
      <Modal
        isOpen={Boolean(completingVisit)}
        onClose={() => setCompletingVisit(null)}
        title={
          completingVisit
            ? `Catat Hasil Survei: ${completingVisit.leadName}`
            : 'Catat Hasil Survei'
        }
        description="Evaluasi hasil survei akan langsung memperbarui skor OQ-04 pada indikator Interaksi & Site Visit."
        isDismissDisabled={isCompleting}
      >
        <form onSubmit={handleCompleteSubmit} className="space-y-4">
          {completeError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{completeError.message}</p>
              {completeError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  Ref: {completeError.correlationId}
                </p>
              )}
            </div>
          )}

          <Select
            label="Hasil Minat Calon Pembeli"
            required
            value={outcomeInput}
            onChange={(e) =>
              setOutcomeInput(e.target.value as SiteVisitOutcome)
            }
            disabled={isCompleting}
            options={[
              {
                value: 'POSITIVE_INTEREST',
                label: 'POSITIVE_INTEREST (Tertarik & Lanjut — +25 Poin)',
              },
              {
                value: 'NEUTRAL_CONSIDERATION',
                label: 'NEUTRAL_CONSIDERATION (Masih Mempertimbangkan — +20 Poin)',
              },
              {
                value: 'NOT_SUITABLE',
                label: 'NOT_SUITABLE (Unit Tidak Cocok — +12 Poin)',
              },
            ]}
          />

          <div>
            <label
              htmlFor="siteVisitEvalNotes"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Catatan Evaluasi Kunjungan (Wajib, min. 5 karakter)
            </label>
            <textarea
              id="siteVisitEvalNotes"
              required
              minLength={5}
              rows={3}
              value={evaluationNotesInput}
              onChange={(e) => setEvaluationNotesInput(e.target.value)}
              disabled={isCompleting}
              placeholder="Contoh: Prospek menyukai tata ruang tipe 45/72 dan berencana diskusi DP dengan pasangan."
              className="mt-1.5 block w-full rounded-md border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCompletingVisit(null)}
              disabled={isCompleting}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" isLoading={isCompleting}>
              Simpan Hasil Survei
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
