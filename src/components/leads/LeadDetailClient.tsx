// Lokasi: src/components/leads/LeadDetailClient.tsx
// Client Component Halaman Detail Lead, Skor OQ-04, Aktivitas, Follow-Up, Survei Lokasi, Riwayat & Ajukan Booking

'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  History,
  Lock,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Send,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import type {
  ActivityChannel,
  BookingStatus,
  InteractionResponse,
  KprApplicationStatus,
  KprStage,
  LeadSource,
  LeadTemperature,
  PaymentMethod,
  PaymentReadiness,
  PipelineStage,
  PromoType,
  PurchaseTimeline,
  ScheduleStatus,
  ScheduleType,
  SiteVisitOutcome,
  SiteVisitStatus,
  SystemRole,
  TaskPriority,
  TaskSource,
  TaskStatus,
} from '@/types/database.types';
import type { ScoreBreakdown } from '@/modules/shared/scoring-calculator/prospect-scoring.calculator';
import {
  completeFollowUpTaskAction,
  completeSiteVisitAction,
  createFollowUpTaskAction,
  logLeadActivityAction,
  reassignLeadAction,
  scheduleSiteVisitAction,
  transitionLeadPipelineAction,
  updateLeadQualificationAction,
} from '@/modules/crm/crm.actions';
import { createBookingAction } from '@/modules/transactions/transactions.actions';
import { formatDateID, formatDateTimeID, formatRupiah } from '@/lib/utils/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
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

export interface LeadDetailDto {
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
  scoreBreakdown: Partial<ScoreBreakdown>;
  pipelineStage: PipelineStage;
  lostReason: string | null;
  lastInteractionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivityDto {
  id: string;
  salesId: string;
  salesName: string;
  channel: ActivityChannel;
  interactionAt: string;
  summary: string;
  customerResponse: InteractionResponse;
}

export interface FollowUpTaskDto {
  id: string;
  assignedSalesId: string;
  assignedSalesName: string;
  relatedScheduleId: string | null;
  relatedScheduleLabel: string | null;
  relatedKprApplicationId: string | null;
  relatedKprLabel: string | null;
  title: string;
  description: string | null;
  dueAt: string;
  priority: TaskPriority;
  sourceType: TaskSource;
  status: TaskStatus;
  completionNotes: string | null;
  completedAt: string | null;
}

export interface LeadSiteVisitDto {
  id: string;
  projectId: string;
  projectName: string;
  unitId: string | null;
  unitCode: string | null;
  salesName: string;
  scheduledAt: string;
  preparationNotes: string | null;
  status: SiteVisitStatus;
  outcome: SiteVisitOutcome | null;
  evaluationNotes: string | null;
  completedAt: string | null;
}

export interface LeadScoreHistoryDto {
  id: string;
  oldScore: number;
  newScore: number;
  oldTemperature: LeadTemperature;
  newTemperature: LeadTemperature;
  triggerSource: string;
  calculatedAt: string;
}

export interface LeadPipelineHistoryDto {
  id: string;
  fromStage: PipelineStage | null;
  toStage: PipelineStage;
  notes: string | null;
  lostReason: string | null;
  changedByName: string;
  changedAt: string;
}

export interface LeadAssignmentHistoryDto {
  id: string;
  fromSalesName: string | null;
  toSalesName: string;
  fromTeamCode: string | null;
  toTeamCode: string;
  reason: string;
  assignedByName: string;
  assignedAt: string;
}

export interface LeadBookingSummaryDto {
  id: string;
  referenceNumber: string;
  unitId: string;
  unitCode: string;
  projectName: string;
  paymentMethod: PaymentMethod;
  agreedFinalPrice: number;
  bookingFeeAmount: number;
  agreedDpTotalAmount: number;
  status: BookingStatus;
  bookedAt: string;
  expiresAt: string;
}

export interface LeadScheduleOptionDto {
  id: string;
  bookingId: string;
  bookingRef: string;
  scheduleType: ScheduleType;
  installmentNumber: number;
  title: string;
  scheduledAmount: number;
  dueDate: string;
  status: ScheduleStatus;
}

export interface LeadKprSummaryDto {
  id: string;
  referenceNumber: string;
  bookingId: string;
  bookingRef: string;
  bankName: string;
  requestedLoanAmount: number;
  approvedLoanAmount: number | null;
  currentStage: KprStage;
  applicationStatus: KprApplicationStatus;
}

export interface AvailableUnitOptionDto {
  id: string;
  projectId: string;
  projectName: string;
  propertyTypeId: string;
  propertyTypeName: string;
  unitCode: string;
  blockNumber: string;
  catalogPrice: number;
}

export interface ActivePromoOptionDto {
  id: string;
  projectId: string;
  propertyTypeId: string | null;
  code: string;
  name: string;
  promoType: PromoType;
  discountValue: number;
  bonusDescription: string | null;
  startDate: string;
  endDate: string;
}

export interface LeadDetailProjectOption {
  id: string;
  code: string;
  name: string;
  city: string;
}

export interface LeadDetailPropertyTypeOption {
  id: string;
  projectId: string;
  code: string;
  name: string;
}

export interface ReassignSalesOptionDto {
  id: string;
  fullName: string;
  teamId: string;
  teamCode: string;
  teamName: string;
}

export interface LeadDetailClientProps {
  userRole: SystemRole;
  lead: LeadDetailDto;
  activities: LeadActivityDto[];
  tasks: FollowUpTaskDto[];
  siteVisits: LeadSiteVisitDto[];
  scoreHistories: LeadScoreHistoryDto[];
  pipelineHistories: LeadPipelineHistoryDto[];
  assignmentHistories: LeadAssignmentHistoryDto[];
  bookings: LeadBookingSummaryDto[];
  scheduleOptions: LeadScheduleOptionDto[];
  kprApplications: LeadKprSummaryDto[];
  availableUnits: AvailableUnitOptionDto[];
  activePromos: ActivePromoOptionDto[];
  projects: LeadDetailProjectOption[];
  propertyTypes: LeadDetailPropertyTypeOption[];
  reassignSalesOptions: ReassignSalesOptionDto[];
}

type LeftTabKey = 'activities' | 'tasks' | 'siteVisits' | 'histories';

const LOCKED_PIPELINE_STAGES = new Set<PipelineStage>([
  'BOOKING',
  'PAYMENT_KPR_PROCESS',
  'CLOSED_WON',
]);

const CHANNEL_LABELS: Record<ActivityChannel, string> = {
  WHATSAPP: 'WhatsApp',
  PHONE_CALL: 'Telepon',
  MEETING: 'Tatap Muka',
  VIDEO_CALL: 'Video Call',
  EMAIL: 'Email',
};

const RESPONSE_LABELS: Record<InteractionResponse, string> = {
  RESPONSIVE_TWO_WAY: 'Responsif Dua Arah',
  INITIAL_ONE_WAY: 'Komunikasi Awal Satu Arah',
  UNRESPONSIVE: 'Belum Merespons',
};

const TASK_SOURCE_LABELS: Record<TaskSource, string> = {
  MANUAL_SALES: 'Manual Sales',
  SUPERVISOR_INSTRUCTION: 'Instruksi Supervisor',
  PAYMENT_REMINDER_SYSTEM: 'Pengingat Sistem',
};

const SITE_VISIT_OUTCOME_LABELS: Record<SiteVisitOutcome, string> = {
  POSITIVE_INTEREST: 'Tertarik Positif',
  NEUTRAL_CONSIDERATION: 'Pertimbangan Netral',
  NOT_SUITABLE: 'Kurang Cocok',
};

const TRIGGER_SOURCE_LABELS: Record<string, string> = {
  INITIAL_QUALIFICATION_CALCULATION: 'Kalkulasi Kualifikasi Awal',
  INITIAL_LEAD_CREATION: 'Pembuatan Lead Awal',
  MANUAL_RECALCULATION: 'Kalkulasi Ulang Manual',
  PROFILE_UPDATE: 'Pembaruan Kualifikasi',
  ACTIVITY_ADDED: 'Catatan Komunikasi',
  SITE_VISIT_UPDATE: 'Update Survei Lokasi',
};

function buildWhatsAppUrl(phone: string, fullName: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  const normalized = digits.startsWith('0')
    ? `62${digits.slice(1)}`
    : digits.startsWith('62')
      ? digits
      : `62${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(
    `Halo Bapak/Ibu ${fullName}, saya dari tim pemasaran PT FIM-Property. Apakah ada waktu untuk diskusi kelanjutan minat unit properti Anda?`
  )}`;
}

function getDefaultLocalDateTime(hoursOffset = 24): string {
  const d = new Date(Date.now() + hoursOffset * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeadDetailClient({
  userRole,
  lead,
  activities,
  tasks,
  siteVisits,
  scoreHistories,
  pipelineHistories,
  assignmentHistories,
  bookings,
  scheduleOptions,
  kprApplications,
  availableUnits,
  activePromos,
  projects,
  propertyTypes,
  reassignSalesOptions,
}: LeadDetailClientProps) {
  const router = useRouter();
  const { showToast } = useToast();

  // Tabs & History filter
  const [activeTab, setActiveTab] = useState<LeftTabKey>('activities');
  const [historySubTab, setHistorySubTab] = useState<'score' | 'pipeline' | 'assignment'>('score');

  // Form Log Aktivitas Komunikasi
  const [actChannel, setActChannel] = useState<ActivityChannel>('WHATSAPP');
  const [actResponse, setActResponse] = useState<InteractionResponse>('RESPONSIVE_TWO_WAY');
  const [actSummary, setActSummary] = useState('');
  const [isLoggingActivity, setIsLoggingActivity] = useState(false);

  // Form Edit Kualifikasi (Kanan)
  const [qualFullName, setQualFullName] = useState(lead.fullName);
  const [qualEmail, setQualEmail] = useState(lead.email ?? '');
  const [qualOccupation, setQualOccupation] = useState(lead.occupation ?? '');
  const [qualBudget, setQualBudget] = useState(String(lead.budgetAmount));
  const [qualCity, setQualCity] = useState(lead.preferredCity ?? '');
  const [qualProjectId, setQualProjectId] = useState(lead.preferredProjectId ?? '');
  const [qualPropertyTypeId, setQualPropertyTypeId] = useState(lead.preferredPropertyTypeId ?? '');
  const [qualPaymentMethod, setQualPaymentMethod] = useState<string>(
    lead.preferredPaymentMethod ?? 'KPR'
  );
  const [qualTimeline, setQualTimeline] = useState<PurchaseTimeline>(lead.purchaseTimeline);
  const [qualReadiness, setQualReadiness] = useState<PaymentReadiness>(lead.paymentReadiness);
  const [isUpdatingQual, setIsUpdatingQual] = useState(false);

  // Modal Ubah Tahap Pipeline
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [targetStage, setTargetStage] = useState<
    'NEW' | 'CONTACTED' | 'QUALIFIED' | 'SITE_VISIT' | 'NEGOTIATION' | 'CLOSED_LOST'
  >(
    LOCKED_PIPELINE_STAGES.has(lead.pipelineStage)
      ? 'NEGOTIATION'
      : (lead.pipelineStage as
          | 'NEW'
          | 'CONTACTED'
          | 'QUALIFIED'
          | 'SITE_VISIT'
          | 'NEGOTIATION'
          | 'CLOSED_LOST')
  );
  const [stageNotes, setStageNotes] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [stageError, setStageError] = useState<{ message: string; correlationId?: string } | null>(
    null
  );
  const [isTransitioningStage, setIsTransitioningStage] = useState(false);

  // Modal Alihkan Lead (TX-07 — ADMIN & SUPERVISOR ONLY)
  const [isReassignOpen, setIsReassignOpen] = useState(false);
  const [targetSalesId, setTargetSalesId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassignError, setReassignError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);
  const [isReassigning, setIsReassigning] = useState(false);

  // Modal Tambah Tugas Follow-Up
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('MEDIUM');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskScheduleId, setTaskScheduleId] = useState('');
  const [taskKprId, setTaskKprId] = useState('');
  const [taskError, setTaskError] = useState<{ message: string; correlationId?: string } | null>(
    null
  );
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  // Modal Selesaikan Tugas Follow-Up
  const [completingTask, setCompletingTask] = useState<FollowUpTaskDto | null>(null);
  const [completionNotes, setCompletionNotes] = useState('');
  const [completeTaskError, setCompleteTaskError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);
  const [isCompletingTask, setIsCompletingTask] = useState(false);

  // Modal Jadwalkan Site Visit
  const [isVisitModalOpen, setIsVisitModalOpen] = useState(false);
  const [visitProjectId, setVisitProjectId] = useState('');
  const [visitUnitId, setVisitUnitId] = useState('');
  const [visitScheduledAt, setVisitScheduledAt] = useState('');
  const [visitPrepNotes, setVisitPrepNotes] = useState('');
  const [visitError, setVisitError] = useState<{ message: string; correlationId?: string } | null>(
    null
  );
  const [isSchedulingVisit, setIsSchedulingVisit] = useState(false);

  // Modal Catat Hasil Site Visit
  const [completingVisit, setCompletingVisit] = useState<LeadSiteVisitDto | null>(null);
  const [visitOutcome, setVisitOutcome] = useState<SiteVisitOutcome>('POSITIVE_INTEREST');
  const [visitEvalNotes, setVisitEvalNotes] = useState('');
  const [completeVisitError, setCompleteVisitError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);
  const [isCompletingVisit, setIsCompletingVisit] = useState(false);

  // Modal Ajukan Booking (TX-01)
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingUnitId, setBookingUnitId] = useState('');
  const [bookingPaymentMethod, setBookingPaymentMethod] = useState<PaymentMethod>('KPR');
  const [bookingPromoId, setBookingPromoId] = useState('');
  const [bookingFeeAmount, setBookingFeeAmount] = useState('5000000');
  const [bookingFeePartOfDp, setBookingFeePartOfDp] = useState(true);
  const [bookingDpTotal, setBookingDpTotal] = useState('50000000');
  const [bookingNotes, setBookingNotes] = useState('');
  const [bookingError, setBookingError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);
  const [isCreatingBooking, setIsCreatingBooking] = useState(false);

  // Permissions & State Flags
  const canReassign = userRole === 'ADMIN' || userRole === 'SUPERVISOR';
  const isPipelineLocked = LOCKED_PIPELINE_STAGES.has(lead.pipelineStage);
  const canCreateBooking = !['NEW', 'CLOSED_WON', 'CLOSED_LOST'].includes(lead.pipelineStage);

  const filteredQualPropertyTypes = useMemo(() => {
    if (!qualProjectId) return [];
    return propertyTypes.filter((pt) => pt.projectId === qualProjectId);
  }, [propertyTypes, qualProjectId]);

  const filteredVisitUnits = useMemo(() => {
    if (!visitProjectId) return [];
    return availableUnits.filter((u) => u.projectId === visitProjectId);
  }, [availableUnits, visitProjectId]);

  const selectedBookingUnit = useMemo(
    () => availableUnits.find((u) => u.id === bookingUnitId) ?? null,
    [availableUnits, bookingUnitId]
  );

  const eligiblePromosForBookingUnit = useMemo(() => {
    if (!selectedBookingUnit) return [];
    return activePromos.filter(
      (pr) =>
        pr.projectId === selectedBookingUnit.projectId &&
        (pr.propertyTypeId === null || pr.propertyTypeId === selectedBookingUnit.propertyTypeId)
    );
  }, [activePromos, selectedBookingUnit]);

  const selectedBookingPromo = useMemo(
    () => eligiblePromosForBookingUnit.find((pr) => pr.id === bookingPromoId) ?? null,
    [eligiblePromosForBookingUnit, bookingPromoId]
  );

  const bookingEstimate = useMemo(() => {
    if (!selectedBookingUnit) return null;
    const catalogPrice = selectedBookingUnit.catalogPrice;
    let discount = 0;
    if (selectedBookingPromo) {
      if (selectedBookingPromo.promoType === 'NOMINAL_DISCOUNT') {
        discount = selectedBookingPromo.discountValue;
      } else if (selectedBookingPromo.promoType === 'PERCENTAGE_DISCOUNT') {
        discount = Math.round((catalogPrice * selectedBookingPromo.discountValue) / 100);
      }
    }
    const agreedFinalPrice = Math.max(0, catalogPrice - discount);
    const fee = Number(bookingFeeAmount) || 0;
    const dp = bookingPaymentMethod === 'CASH_KERAS' ? 0 : Number(bookingDpTotal) || 0;
    const upfrontCash =
      bookingPaymentMethod === 'CASH_KERAS'
        ? fee
        : bookingFeePartOfDp
          ? Math.max(dp, fee)
          : dp + fee;
    const estimatedKprPrincipal =
      bookingPaymentMethod === 'KPR' ? Math.max(0, agreedFinalPrice - upfrontCash) : 0;

    return {
      catalogPrice,
      discount,
      agreedFinalPrice,
      upfrontCash,
      estimatedKprPrincipal,
    };
  }, [
    selectedBookingUnit,
    selectedBookingPromo,
    bookingFeeAmount,
    bookingPaymentMethod,
    bookingDpTotal,
    bookingFeePartOfDp,
  ]);

  // Score Breakdown Safe Access (Strictly Server-Persisted OQ-04)
  const budgetBreak = lead.scoreBreakdown?.budgetCompatibility;
  const timelineBreak = lead.scoreBreakdown?.purchaseTimeline;
  const readinessBreak = lead.scoreBreakdown?.paymentReadiness;
  const interactionBreak = lead.scoreBreakdown?.interactionAndSiteVisit;

  const scoreIndicators = [
    {
      label: 'Kompatibilitas Budget',
      score: budgetBreak?.score ?? 0,
      maxScore: 30,
      extra:
        typeof budgetBreak?.ratioPercentage === 'number'
          ? `Rasio ${budgetBreak.ratioPercentage}%`
          : null,
      reason: budgetBreak?.reason ?? 'Belum ada data perbandingan harga acuan.',
    },
    {
      label: 'Target Waktu Pembelian',
      score: timelineBreak?.score ?? 0,
      maxScore: 25,
      extra: null,
      reason: timelineBreak?.reason ?? 'Target waktu pembelian belum ditentukan.',
    },
    {
      label: 'Kesiapan Pembayaran & Dokumen',
      score: readinessBreak?.score ?? 0,
      maxScore: 20,
      extra: null,
      reason: readinessBreak?.reason ?? 'Kesiapan metode pembayaran belum jelas.',
    },
    {
      label: 'Interaksi & Survei Lokasi',
      score: interactionBreak?.score ?? 0,
      maxScore: 25,
      extra: null,
      reason: interactionBreak?.reason ?? 'Belum ada interaksi atau kunjungan lokasi.',
    },
  ];

  // Handlers
  const handleLogActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingActivity) return;
    setIsLoggingActivity(true);
    try {
      const result = await logLeadActivityAction({
        leadId: lead.id,
        channel: actChannel,
        customerResponse: actResponse,
        summary: actSummary,
      });

      if (result.success) {
        showToast({
          title: 'Aktivitas Dicatat',
          description: result.message,
          tone: 'success',
        });
        setActSummary('');
        router.refresh();
      } else {
        showToast({
          title: 'Gagal Menyimpan Aktivitas',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      showToast({
        title: 'Gangguan Jaringan',
        description: 'Gagal menghubungi server saat mencatat komunikasi.',
        tone: 'error',
      });
    } finally {
      setIsLoggingActivity(false);
    }
  };

  const handleQualificationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUpdatingQual) return;
    setIsUpdatingQual(true);
    try {
      const result = await updateLeadQualificationAction({
        leadId: lead.id,
        fullName: qualFullName,
        email: qualEmail.trim() ? qualEmail.trim() : null,
        occupation: qualOccupation.trim() ? qualOccupation.trim() : null,
        budgetAmount: Number(qualBudget) || 0,
        preferredCity: qualCity.trim() ? qualCity.trim() : null,
        preferredProjectId: qualProjectId || null,
        preferredPropertyTypeId: qualPropertyTypeId || null,
        preferredPaymentMethod: qualPaymentMethod || null,
        purchaseTimeline: qualTimeline,
        paymentReadiness: qualReadiness,
      });

      if (result.success) {
        showToast({
          title: 'Kualifikasi Diperbarui',
          description: result.message,
          tone: 'success',
        });
        router.refresh();
      } else {
        showToast({
          title: 'Gagal Memperbarui Kualifikasi',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      showToast({
        title: 'Gangguan Jaringan',
        description: 'Gagal menghubungi server saat memperbarui kualifikasi.',
        tone: 'error',
      });
    } finally {
      setIsUpdatingQual(false);
    }
  };

  const openStageModal = () => {
    setTargetStage(
      LOCKED_PIPELINE_STAGES.has(lead.pipelineStage)
        ? 'NEGOTIATION'
        : (lead.pipelineStage as
            | 'NEW'
            | 'CONTACTED'
            | 'QUALIFIED'
            | 'SITE_VISIT'
            | 'NEGOTIATION'
            | 'CLOSED_LOST')
    );
    setStageNotes('');
    setLostReason(lead.lostReason ?? '');
    setStageError(null);
    setIsStageModalOpen(true);
  };

  const handleStageTransitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isTransitioningStage) return;
    setIsTransitioningStage(true);
    setStageError(null);
    try {
      const result = await transitionLeadPipelineAction({
        leadId: lead.id,
        targetStage,
        notes: stageNotes.trim() || null,
        lostReason: targetStage === 'CLOSED_LOST' ? lostReason.trim() : null,
      });
      if (result.success) {
        showToast({
          title: 'Tahap Pipeline Diperbarui',
          description: result.message,
          tone: 'success',
        });
        setIsStageModalOpen(false);
        router.refresh();
      } else {
        setStageError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setStageError({
        message: 'Terjadi gangguan jaringan saat mengubah tahap pipeline.',
      });
    } finally {
      setIsTransitioningStage(false);
    }
  };

  const openReassignModal = () => {
    setTargetSalesId(reassignSalesOptions[0]?.id ?? '');
    setReassignReason('');
    setReassignError(null);
    setIsReassignOpen(true);
  };

  const handleReassignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReassigning || !targetSalesId) return;
    setIsReassigning(true);
    setReassignError(null);
    try {
      const result = await reassignLeadAction({
        leadId: lead.id,
        targetSalesId,
        reason: reassignReason,
      });
      if (result.success) {
        showToast({
          title: 'Lead Berhasil Dialihkan',
          description: result.message,
          tone: 'success',
        });
        setIsReassignOpen(false);
        router.refresh();
      } else {
        setReassignError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setReassignError({
        message: 'Terjadi gangguan jaringan saat mengalihkan kepemilikan Lead.',
      });
    } finally {
      setIsReassigning(false);
    }
  };

  const openTaskModal = () => {
    setTaskTitle('');
    setTaskDescription('');
    setTaskPriority('MEDIUM');
    setTaskDueAt(getDefaultLocalDateTime(24));
    setTaskScheduleId('');
    setTaskKprId('');
    setTaskError(null);
    setIsTaskModalOpen(true);
  };

  const handleCreateTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingTask) return;
    setIsCreatingTask(true);
    setTaskError(null);
    try {
      const isoDueAt = taskDueAt ? new Date(taskDueAt).toISOString() : '';
      const result = await createFollowUpTaskAction({
        leadId: lead.id,
        assignedSalesId: lead.assignedSalesId,
        relatedScheduleId: taskScheduleId || null,
        relatedKprApplicationId: taskKprId || null,
        title: taskTitle,
        description: taskDescription.trim() || null,
        dueAt: isoDueAt,
        priority: taskPriority,
      });
      if (result.success) {
        showToast({
          title: 'Tugas Follow-Up Dibuat',
          description: result.message,
          tone: 'success',
        });
        setIsTaskModalOpen(false);
        router.refresh();
      } else {
        setTaskError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setTaskError({
        message: 'Terjadi gangguan jaringan saat membuat tugas follow-up.',
      });
    } finally {
      setIsCreatingTask(false);
    }
  };

  const openCompleteTaskModal = (task: FollowUpTaskDto) => {
    setCompletingTask(task);
    setCompletionNotes('');
    setCompleteTaskError(null);
  };

  const handleCompleteTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingTask || isCompletingTask) return;
    setIsCompletingTask(true);
    setCompleteTaskError(null);
    try {
      const result = await completeFollowUpTaskAction({
        taskId: completingTask.id,
        completionNotes,
      });
      if (result.success) {
        showToast({
          title: 'Tugas Diselesaikan',
          description: result.message,
          tone: 'success',
        });
        setCompletingTask(null);
        router.refresh();
      } else {
        setCompleteTaskError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setCompleteTaskError({
        message: 'Terjadi gangguan jaringan saat menyelesaikan tugas.',
      });
    } finally {
      setIsCompletingTask(false);
    }
  };

  const openVisitModal = () => {
    const defaultProj = lead.preferredProjectId ?? projects[0]?.id ?? '';
    setVisitProjectId(defaultProj);
    setVisitUnitId('');
    setVisitScheduledAt(getDefaultLocalDateTime(24));
    setVisitPrepNotes('');
    setVisitError(null);
    setIsVisitModalOpen(true);
  };

  const handleScheduleVisitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSchedulingVisit) return;
    setIsSchedulingVisit(true);
    setVisitError(null);
    try {
      const isoScheduled = visitScheduledAt ? new Date(visitScheduledAt).toISOString() : '';
      const result = await scheduleSiteVisitAction({
        leadId: lead.id,
        projectId: visitProjectId,
        unitId: visitUnitId || null,
        scheduledAt: isoScheduled,
        preparationNotes: visitPrepNotes.trim() || null,
      });
      if (result.success) {
        showToast({
          title: 'Survei Lokasi Dijadwalkan',
          description: result.message,
          tone: 'success',
        });
        setIsVisitModalOpen(false);
        router.refresh();
      } else {
        setVisitError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setVisitError({
        message: 'Terjadi gangguan jaringan saat menjadwalkan survei lokasi.',
      });
    } finally {
      setIsSchedulingVisit(false);
    }
  };

  const openCompleteVisitModal = (visit: LeadSiteVisitDto) => {
    setCompletingVisit(visit);
    setVisitOutcome('POSITIVE_INTEREST');
    setVisitEvalNotes('');
    setCompleteVisitError(null);
  };

  const handleCompleteVisitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingVisit || isCompletingVisit) return;
    setIsCompletingVisit(true);
    setCompleteVisitError(null);
    try {
      const result = await completeSiteVisitAction({
        siteVisitId: completingVisit.id,
        customerInterestOutcome: visitOutcome,
        evaluationNotes: visitEvalNotes,
      });
      if (result.success) {
        showToast({
          title: 'Hasil Survei Disimpan',
          description: result.message,
          tone: 'success',
        });
        setCompletingVisit(null);
        router.refresh();
      } else {
        setCompleteVisitError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setCompleteVisitError({
        message: 'Terjadi gangguan jaringan saat menyimpan hasil survei.',
      });
    } finally {
      setIsCompletingVisit(false);
    }
  };

  const openBookingModal = () => {
    const preferredUnit =
      (lead.preferredProjectId
        ? availableUnits.find((u) => u.projectId === lead.preferredProjectId)
        : undefined) ?? availableUnits[0];

    setBookingUnitId(preferredUnit?.id ?? '');
    const method: PaymentMethod = lead.preferredPaymentMethod ?? 'KPR';
    setBookingPaymentMethod(method);
    setBookingPromoId('');
    setBookingFeeAmount('5000000');
    setBookingFeePartOfDp(true);
    setBookingDpTotal(method === 'CASH_KERAS' ? '0' : '50000000');
    setBookingNotes('');
    setBookingError(null);
    setIsBookingModalOpen(true);
  };

  const handleCreateBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingBooking || !bookingUnitId) return;
    setIsCreatingBooking(true);
    setBookingError(null);
    try {
      const result = await createBookingAction({
        leadId: lead.id,
        unitId: bookingUnitId,
        paymentMethod: bookingPaymentMethod,
        promoId: bookingPromoId || null,
        bookingFeeAmount: Number(bookingFeeAmount) || 0,
        isBookingFeePartOfDp: bookingPaymentMethod === 'CASH_KERAS' ? false : bookingFeePartOfDp,
        agreedDpTotalAmount:
          bookingPaymentMethod === 'CASH_KERAS' ? 0 : Number(bookingDpTotal) || 0,
        notes: bookingNotes.trim() || null,
      });
      if (result.success) {
        showToast({
          title: 'Booking Berhasil Diajukan',
          description: result.message,
          tone: 'success',
        });
        setIsBookingModalOpen(false);
        router.refresh();
      } else {
        setBookingError({
          message: result.message,
          correlationId: result.correlationId,
        });
      }
    } catch {
      setBookingError({
        message: 'Terjadi gangguan jaringan saat mengajukan Booking.',
      });
    } finally {
      setIsCreatingBooking(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      {/* Header Navigasi Kembali & Ringkasan Identitas Lead */}
      <div className="rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/leads"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#475569] transition-colors hover:text-[#14532D]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Kembali ke Daftar Leads &amp; Pipeline</span>
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={buildWhatsAppUrl(lead.phone, lead.fullName)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-semibold text-[#047857] transition-colors hover:bg-[#D1FAE5]"
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Hubungi via WhatsApp</span>
            </a>

            {canReassign && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<ArrowRightLeft className="h-3.5 w-3.5" strokeWidth={1.75} />}
                onClick={openReassignModal}
              >
                Alihkan Lead
              </Button>
            )}

            {isPipelineLocked ? (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-[#F1F5F9] px-3 text-xs font-semibold text-[#475569]">
                <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Tahap Terkunci Sistem</span>
              </span>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={openStageModal}>
                Ubah Tahap
              </Button>
            )}

            {canCreateBooking && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                leftIcon={<Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                onClick={openBookingModal}
              >
                Ajukan Booking
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col justify-between gap-4 border-t border-[#F1F5F9] pt-4 lg:flex-row lg:items-center">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
                {lead.fullName}
              </h1>
              <LeadTemperatureBadge
                temperature={lead.leadTemperature}
                score={lead.prospectScore}
              />
              <span className="rounded-md bg-[#F1F5F9] px-2 py-0.5 font-mono text-xs font-bold text-[#0F172A] tabular-nums">
                {lead.prospectScore}/100
              </span>
              <DomainStatusBadge value={lead.pipelineStage} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#475569]">
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Phone className="h-3.5 w-3.5 text-[#94A3B8]" strokeWidth={1.75} />
                {lead.phone}
              </span>
              {lead.email && <span>{lead.email}</span>}
              {lead.occupation && <span>Pekerjaan: {lead.occupation}</span>}
              <span>Sumber: {lead.leadSource.replace(/_/g, ' ')}</span>
            </div>

            {lead.pipelineStage === 'CLOSED_LOST' && lead.lostReason && (
              <p className="inline-flex items-center gap-1.5 rounded bg-[#FEF2F2] px-2.5 py-1 text-xs font-medium text-[#B91C1C]">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span>Alasan Gagal: {lead.lostReason}</span>
              </p>
            )}
          </div>

          <div className="grid shrink-0 grid-cols-1 gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5 text-xs sm:grid-cols-2 sm:gap-4">
            <div>
              <p className="text-[11px] text-[#64748B]">Sales Penanggung Jawab</p>
              <p className="mt-0.5 inline-flex flex-wrap items-center gap-1.5 font-semibold text-[#0F172A]">
                <UserCheck className="h-3.5 w-3.5 shrink-0 text-[#059669]" strokeWidth={1.75} />
                <span>{lead.assignedSalesName}</span>
                <Badge tone="slate">{lead.teamCode}</Badge>
              </p>
            </div>
            <div className="sm:border-l sm:border-[#E2E8F0] sm:pl-4">
              <p className="text-[11px] text-[#64748B]">Interaksi Terakhir</p>
              <p className="mt-0.5 font-mono font-semibold text-[#0F172A] tabular-nums">
                {formatDateTimeID(lead.lastInteractionAt)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Layout 2 Kolom Desktop 7:5 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* KOLOM KIRI (7 Kolom): 4 Tab Aktivitas, Tugas Follow-Up, Survei Lokasi, Riwayat */}
        <div className="space-y-4 lg:col-span-7">
          {/* Tab Strip */}
          <div
            role="tablist"
            aria-label="Detail aktivitas prospek"
            className="flex flex-wrap gap-1 rounded-lg border border-[#E2E8F0] bg-white p-1.5 shadow-2xs"
          >
            {(
              [
                {
                  key: 'activities',
                  label: `Aktivitas Komunikasi (${activities.length})`,
                  icon: MessageSquare,
                },
                {
                  key: 'tasks',
                  label: `Tugas Follow-Up (${tasks.length})`,
                  icon: ClipboardList,
                },
                {
                  key: 'siteVisits',
                  label: `Survei Lokasi (${siteVisits.length})`,
                  icon: MapPin,
                },
                {
                  key: 'histories',
                  label: 'Riwayat',
                  icon: History,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-[#14532D] text-white'
                      : 'text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: Aktivitas Komunikasi */}
          {activeTab === 'activities' && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Catat Aktivitas Komunikasi</CardTitle>
                    <CardDescription>
                      Catatan bersifat permanen (append-only) dan otomatis memperbarui skor interaksi OQ-04.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleLogActivitySubmit} className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Select
                        label="Kanal Komunikasi"
                        value={actChannel}
                        onChange={(e) => setActChannel(e.target.value as ActivityChannel)}
                        options={[
                          { value: 'WHATSAPP', label: 'WhatsApp' },
                          { value: 'PHONE_CALL', label: 'Telepon' },
                          { value: 'MEETING', label: 'Tatap Muka' },
                          { value: 'VIDEO_CALL', label: 'Video Call' },
                          { value: 'EMAIL', label: 'Email' },
                        ]}
                      />

                      <Select
                        label="Respons Calon Pembeli"
                        value={actResponse}
                        onChange={(e) => setActResponse(e.target.value as InteractionResponse)}
                        options={[
                          { value: 'RESPONSIVE_TWO_WAY', label: 'Responsif Dua Arah' },
                          { value: 'INITIAL_ONE_WAY', label: 'Komunikasi Awal Satu Arah' },
                          { value: 'UNRESPONSIVE', label: 'Belum Merespons' },
                        ]}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="activity-summary"
                        className="mb-1.5 block text-xs font-medium text-[#475569]"
                      >
                        Ringkasan Komunikasi <span className="text-[#DC2626]">*</span>
                      </label>
                      <textarea
                        id="activity-summary"
                        required
                        minLength={5}
                        rows={3}
                        value={actSummary}
                        onChange={(e) => setActSummary(e.target.value)}
                        placeholder="Tuliskan inti diskusi, pertanyaan calon pembeli, dan rencana tindak lanjut..."
                        className="block w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                      />
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        isLoading={isLoggingActivity}
                        leftIcon={<Send className="h-3.5 w-3.5" strokeWidth={1.75} />}
                      >
                        Simpan Catatan Komunikasi
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Timeline Komunikasi ({activities.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {activities.length === 0 ? (
                    <EmptyState
                      title="Belum Ada Catatan Komunikasi"
                      description="Catat interaksi WhatsApp, telepon, atau pertemuan pertama Anda dengan prospek."
                    />
                  ) : (
                    <div className="space-y-3">
                      {activities.map((act) => (
                        <div
                          key={act.id}
                          className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone="forest">{CHANNEL_LABELS[act.channel]}</Badge>
                              <Badge
                                tone={
                                  act.customerResponse === 'RESPONSIVE_TWO_WAY'
                                    ? 'emerald'
                                    : act.customerResponse === 'INITIAL_ONE_WAY'
                                      ? 'amber'
                                      : 'slate'
                                }
                              >
                                {RESPONSE_LABELS[act.customerResponse]}
                              </Badge>
                            </div>
                            <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                              {formatDateTimeID(act.interactionAt)}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-[#0F172A]">
                            {act.summary}
                          </p>
                          <p className="mt-1.5 text-[11px] text-[#64748B]">
                            Dicatat oleh {act.salesName}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* TAB 2: Tugas Follow-Up */}
          {activeTab === 'tasks' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Tugas Follow-Up ({tasks.length})</CardTitle>
                  <CardDescription>
                    Agenda tindak lanjut prospek, penagihan termin, maupun pengajuan KPR terkait.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  onClick={openTaskModal}
                >
                  Tambah Tugas
                </Button>
              </CardHeader>
              <CardContent>
                {tasks.length === 0 ? (
                  <EmptyState
                    title="Belum Ada Tugas Follow-Up"
                    description="Buat jadwal tugas tindak lanjut agar komunikasi dengan calon pembeli tetap terpantau."
                  />
                ) : (
                  <div className="space-y-3">
                    {tasks.map((task) => {
                      const canComplete = task.status === 'PENDING' || task.status === 'OVERDUE';
                      return (
                        <div
                          key={task.id}
                          className="rounded-lg border border-[#E2E8F0] bg-white p-4"
                        >
                          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-xs font-bold text-[#0F172A]">{task.title}</h3>
                                <DomainStatusBadge value={task.status} />
                                <DomainStatusBadge value={task.priority} />
                              </div>

                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#64748B]">
                                <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                                  <Clock className="h-3 w-3" strokeWidth={1.75} />
                                  Jatuh tempo: {formatDateTimeID(task.dueAt)}
                                </span>
                                <span>•</span>
                                <Badge tone="slate">{TASK_SOURCE_LABELS[task.sourceType]}</Badge>
                                <span>•</span>
                                <span>PIC: {task.assignedSalesName}</span>
                              </div>
                            </div>

                            {canComplete && (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                leftIcon={<CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                                onClick={() => openCompleteTaskModal(task)}
                              >
                                Selesaikan
                              </Button>
                            )}
                          </div>

                          {(task.relatedScheduleLabel || task.relatedKprLabel) && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {task.relatedScheduleLabel && (
                                <Badge tone="amber">{task.relatedScheduleLabel}</Badge>
                              )}
                              {task.relatedKprLabel && (
                                <Badge tone="blue">{task.relatedKprLabel}</Badge>
                              )}
                            </div>
                          )}

                          {task.description && (
                            <p className="mt-2 text-xs text-[#475569]">{task.description}</p>
                          )}

                          {task.status === 'COMPLETED' && task.completionNotes && (
                            <div className="mt-2.5 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-xs text-[#047857]">
                              <p className="font-semibold">
                                Hasil Tindak Lanjut ({formatDateTimeID(task.completedAt)}):
                              </p>
                              <p className="mt-0.5">{task.completionNotes}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* TAB 3: Survei Lokasi */}
          {activeTab === 'siteVisits' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Survei Lokasi ({siteVisits.length})</CardTitle>
                  <CardDescription>
                    Jadwal kunjungan proyek &amp; evaluasi ketertarikan calon pembeli.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leftIcon={<CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  onClick={openVisitModal}
                >
                  Jadwalkan Survei
                </Button>
              </CardHeader>
              <CardContent>
                {siteVisits.length === 0 ? (
                  <EmptyState
                    title="Belum Ada Jadwal Survei Lokasi"
                    description="Jadwalkan kunjungan ke lokasi perumahan untuk meningkatkan skor prospek."
                  />
                ) : (
                  <div className="space-y-3">
                    {siteVisits.map((visit) => {
                      const canComplete =
                        visit.status === 'SCHEDULED' || visit.status === 'RESCHEDULED';
                      return (
                        <div
                          key={visit.id}
                          className="rounded-lg border border-[#E2E8F0] bg-white p-4"
                        >
                          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-bold text-[#0F172A]">
                                  {visit.projectName}
                                  {visit.unitCode ? ` • Unit ${visit.unitCode}` : ''}
                                </span>
                                <DomainStatusBadge value={visit.status} />
                              </div>
                              <p className="font-mono text-[11px] text-[#64748B] tabular-nums">
                                Jadwal: {formatDateTimeID(visit.scheduledAt)} • Pendamping:{' '}
                                {visit.salesName}
                              </p>
                            </div>

                            {canComplete && (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => openCompleteVisitModal(visit)}
                              >
                                Catat Hasil
                              </Button>
                            )}
                          </div>

                          {visit.preparationNotes && (
                            <p className="mt-2 text-xs text-[#475569]">
                              Persiapan: {visit.preparationNotes}
                            </p>
                          )}

                          {visit.status === 'COMPLETED' && (
                            <div className="mt-2.5 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
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
                                    {SITE_VISIT_OUTCOME_LABELS[visit.outcome]}
                                  </Badge>
                                )}
                                <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                                  Selesai: {formatDateTimeID(visit.completedAt)}
                                </span>
                              </div>
                              {visit.evaluationNotes && (
                                <p className="mt-1.5 text-[#0F172A]">{visit.evaluationNotes}</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* TAB 4: Riwayat Audit (Skor, Pipeline, Penugasan) */}
          {activeTab === 'histories' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Jejak Riwayat Prospek</CardTitle>
                  <CardDescription>
                    Log perubahan skor OQ-04, perpindahan tahap pipeline, dan pengalihan Sales.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-1 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-1">
                  <button
                    type="button"
                    onClick={() => setHistorySubTab('score')}
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                      historySubTab === 'score'
                        ? 'bg-white text-[#14532D] shadow-2xs'
                        : 'text-[#64748B]'
                    }`}
                  >
                    Skor ({scoreHistories.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistorySubTab('pipeline')}
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                      historySubTab === 'pipeline'
                        ? 'bg-white text-[#14532D] shadow-2xs'
                        : 'text-[#64748B]'
                    }`}
                  >
                    Pipeline ({pipelineHistories.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistorySubTab('assignment')}
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                      historySubTab === 'assignment'
                        ? 'bg-white text-[#14532D] shadow-2xs'
                        : 'text-[#64748B]'
                    }`}
                  >
                    Penugasan ({assignmentHistories.length})
                  </button>
                </div>
              </CardHeader>

              <CardContent>
                {historySubTab === 'score' &&
                  (scoreHistories.length === 0 ? (
                    <EmptyState
                      title="Belum Ada Riwayat Skor"
                      description="Perubahan skor prospek akan tercatat otomatis saat kualifikasi, komunikasi, atau survei diperbarui."
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {scoreHistories.map((h) => (
                        <div
                          key={h.id}
                          className="flex flex-col justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 sm:flex-row sm:items-center"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono font-bold text-[#0F172A] tabular-nums">
                                {h.oldScore} → {h.newScore}
                              </span>
                              <Badge tone="slate">
                                {h.oldTemperature} → {h.newTemperature}
                              </Badge>
                              <Badge tone="forest">
                                {TRIGGER_SOURCE_LABELS[h.triggerSource] ??
                                  h.triggerSource.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                          </div>
                          <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                            {formatDateTimeID(h.calculatedAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}

                {historySubTab === 'pipeline' &&
                  (pipelineHistories.length === 0 ? (
                    <EmptyState
                      title="Belum Ada Riwayat Pipeline"
                      description="Perpindahan tahap pipeline akan tercatat di sini."
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {pipelineHistories.map((h) => (
                        <div
                          key={h.id}
                          className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#0F172A]">
                              <span>{h.fromStage ? h.fromStage.replace(/_/g, ' ') : 'AWAL'}</span>
                              <span>→</span>
                              <DomainStatusBadge value={h.toStage} />
                            </div>
                            <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                              {formatDateTimeID(h.changedAt)}
                            </span>
                          </div>
                          {h.notes && <p className="mt-1.5 text-xs text-[#475569]">{h.notes}</p>}
                          {h.lostReason && (
                            <p className="mt-1 text-xs font-medium text-[#B91C1C]">
                              Alasan gagal: {h.lostReason}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-[#64748B]">Oleh: {h.changedByName}</p>
                        </div>
                      ))}
                    </div>
                  ))}

                {historySubTab === 'assignment' &&
                  (assignmentHistories.length === 0 ? (
                    <EmptyState
                      title="Belum Ada Riwayat Penugasan"
                      description="Catatan penugasan dan pengalihan kepemilikan Lead tampil di sini."
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {assignmentHistories.map((h) => (
                        <div
                          key={h.id}
                          className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-[#0F172A]">
                              {h.fromSalesName
                                ? `${h.fromSalesName} (${h.fromTeamCode ?? '-'}) → ${h.toSalesName} (${h.toTeamCode})`
                                : `Ditugaskan ke ${h.toSalesName} (${h.toTeamCode})`}
                            </p>
                            <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                              {formatDateTimeID(h.assignedAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[#475569]">Alasan: {h.reason}</p>
                          <p className="mt-1 text-[11px] text-[#64748B]">Oleh: {h.assignedByName}</p>
                        </div>
                      ))}
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* KOLOM KANAN (5 Kolom): Kartu Skor OQ-04, Form Edit Kualifikasi, Ringkasan Booking/KPR */}
        <div className="space-y-6 lg:col-span-5">
          {/* 1. Kartu Skor Prospek (OQ-04, Non-ML) */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Skor Prospek (OQ-04, Non-ML)</CardTitle>
                <CardDescription>
                  Dihitung deterministik oleh server dari 4 indikator aturan bisnis.
                </CardDescription>
              </div>
              <LeadTemperatureBadge
                temperature={lead.leadTemperature}
                score={lead.prospectScore}
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
                <span className="text-xs font-medium text-[#475569]">Total Skor Prospek</span>
                <span className="font-mono text-2xl font-bold text-[#14532D] tabular-nums">
                  {lead.prospectScore}
                  <span className="text-sm font-semibold text-[#64748B]">/100</span>
                </span>
              </div>

              <div className="space-y-3">
                {scoreIndicators.map((ind) => {
                  const pct = Math.min(100, Math.max(0, Math.round((ind.score / ind.maxScore) * 100)));
                  return (
                    <div key={ind.label} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#0F172A]">{ind.label}</span>
                        <span className="font-mono font-bold text-[#14532D] tabular-nums">
                          {ind.score}/{ind.maxScore}
                          {ind.extra ? ` (${ind.extra})` : ''}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                        <div
                          className="h-full rounded-full bg-[#059669]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[11px] leading-snug text-[#64748B]">{ind.reason}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 2. Form Edit Kualifikasi */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Kualifikasi &amp; Minat Prospek</CardTitle>
                <CardDescription>
                  Memperbarui kualifikasi akan menghitung ulang skor OQ-04 di server.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleQualificationSubmit} className="space-y-3.5">
                <Input
                  label="Nama Lengkap Calon Pembeli"
                  required
                  value={qualFullName}
                  onChange={(e) => setQualFullName(e.target.value)}
                />

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    label="Email"
                    type="email"
                    value={qualEmail}
                    onChange={(e) => setQualEmail(e.target.value)}
                    placeholder="opsional@email.com"
                  />
                  <Input
                    label="Pekerjaan / Profesi"
                    value={qualOccupation}
                    onChange={(e) => setQualOccupation(e.target.value)}
                    placeholder="Karyawan / Pengusaha"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <CurrencyInput
                    label="Estimasi Budget (Rp)"
                    min={0}
                    step={1000000}
                    required
                    value={qualBudget}
                    onValueChange={setQualBudget}
                    className="font-mono tabular-nums"
                  />
                  <Input
                    label="Kota Minat"
                    value={qualCity}
                    onChange={(e) => setQualCity(e.target.value)}
                    placeholder="Kota Bekasi"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select
                    label="Proyek Minat"
                    value={qualProjectId}
                    onChange={(e) => {
                      setQualProjectId(e.target.value);
                      setQualPropertyTypeId('');
                    }}
                    options={[
                      { value: '', label: '-- Belum Ditentukan --' },
                      ...projects.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />

                  <Select
                    label="Tipe Properti Minat"
                    value={qualPropertyTypeId}
                    onChange={(e) => setQualPropertyTypeId(e.target.value)}
                    disabled={!qualProjectId}
                    options={[
                      { value: '', label: '-- Belum Ditentukan --' },
                      ...filteredQualPropertyTypes.map((pt) => ({
                        value: pt.id,
                        label: `${pt.name} (${pt.code})`,
                      })),
                    ]}
                  />
                </div>

                <Select
                  label="Preferensi Metode Bayar"
                  value={qualPaymentMethod}
                  onChange={(e) => setQualPaymentMethod(e.target.value)}
                  options={[
                    { value: 'KPR', label: 'KPR Bank' },
                    { value: 'CASH_BERTAHAP', label: 'Cash Bertahap' },
                    { value: 'CASH_KERAS', label: 'Cash Keras' },
                  ]}
                />

                <Select
                  label="Target Waktu Pembelian (OQ-04)"
                  value={qualTimeline}
                  onChange={(e) => setQualTimeline(e.target.value as PurchaseTimeline)}
                  options={[
                    { value: 'IMMEDIATE_LT_1M', label: 'Segera (< 1 Bulan) — 25 Poin' },
                    { value: 'SHORT_1_3M', label: 'Jangka Pendek (1–3 Bulan) — 18 Poin' },
                    { value: 'MEDIUM_3_6M', label: 'Jangka Menengah (3–6 Bulan) — 10 Poin' },
                    { value: 'LONG_GT_6M', label: 'Jangka Panjang (> 6 Bulan) — 5 Poin' },
                    { value: 'UNSPECIFIED', label: 'Belum Ditentukan — 0 Poin' },
                  ]}
                />

                <Select
                  label="Kesiapan Pembayaran & Dokumen (OQ-04)"
                  value={qualReadiness}
                  onChange={(e) => setQualReadiness(e.target.value as PaymentReadiness)}
                  options={[
                    {
                      value: 'READY_FULL_OR_DP_DOCS',
                      label: 'Dana Cash / DP & Dokumen KPR Siap — 20 Poin',
                    },
                    {
                      value: 'DP_READY_COLLECTING_DOCS',
                      label: 'Dana DP Siap, Dokumen Proses — 15 Poin',
                    },
                    { value: 'SAVING_FOR_DP', label: 'Menyiapkan Dana DP — 8 Poin' },
                    { value: 'UNDECIDED', label: 'Belum Jelas — 0 Poin' },
                  ]}
                />

                <div className="pt-1">
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    isLoading={isUpdatingQual}
                    className="w-full"
                  >
                    Simpan Kualifikasi &amp; Hitung Skor
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* 3. Ringkasan Booking & KPR Terkait */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Ringkasan Booking &amp; KPR Terkait</CardTitle>
                <CardDescription>
                  Catatan reservasi unit dan pengajuan KPR yang terhubung dengan Lead ini.
                </CardDescription>
              </div>
              <FileSpreadsheet className="h-4 w-4 text-[#64748B]" strokeWidth={1.75} />
            </CardHeader>
            <CardContent className="space-y-4">
              {bookings.length === 0 ? (
                <EmptyState
                  title="Belum Ada Booking"
                  description={
                    canCreateBooking
                      ? 'Gunakan tombol Ajukan Booking di bagian atas untuk mereservasi unit AVAILABLE.'
                      : 'Booking hanya dapat diajukan jika Lead sudah melewati tahap NEW.'
                  }
                />
              ) : (
                <div className="space-y-3">
                  {bookings.map((bk) => (
                    <div
                      key={bk.id}
                      className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`/bookings/${bk.id}`}
                          className="font-mono font-bold text-[#14532D] tabular-nums hover:underline"
                        >
                          {bk.referenceNumber}
                        </Link>
                        <DomainStatusBadge value={bk.status} />
                      </div>
                      <p className="mt-1.5 font-semibold text-[#0F172A]">
                        {bk.projectName} • Unit {bk.unitCode}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[#E2E8F0] pt-2 text-[11px]">
                        <div>
                          <span className="text-[#64748B]">Harga Final</span>
                          <p className="font-mono font-bold text-[#0F172A] tabular-nums">
                            {formatRupiah(bk.agreedFinalPrice)}
                          </p>
                        </div>
                        <div>
                          <span className="text-[#64748B]">Booking Fee ({bk.paymentMethod.replace(/_/g, ' ')})</span>
                          <p className="font-mono font-semibold text-[#0F172A] tabular-nums">
                            {formatRupiah(bk.bookingFeeAmount)}
                          </p>
                        </div>
                      </div>
                      <p className="mt-1.5 font-mono text-[11px] text-[#64748B] tabular-nums">
                        Dibuat: {formatDateID(bk.bookedAt)} • Batas HOLD:{' '}
                        {formatDateTimeID(bk.expiresAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {kprApplications.length > 0 && (
                <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
                  <p className="text-xs font-bold text-[#0F172A]">Pengajuan KPR Bank</p>
                  {kprApplications.map((kpr) => (
                    <div
                      key={kpr.id}
                      className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF]/60 p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`/kpr/${kpr.id}`}
                          className="font-mono font-bold text-[#1D4ED8] tabular-nums hover:underline"
                        >
                          {kpr.referenceNumber}
                        </Link>
                        <DomainStatusBadge value={kpr.applicationStatus} />
                      </div>
                      <p className="mt-1 font-semibold text-[#0F172A]">
                        {kpr.bankName} • Tahap: {kpr.currentStage.replace(/_/g, ' ')}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-[#475569] tabular-nums">
                        Pengajuan: {formatRupiah(kpr.requestedLoanAmount)}
                        {kpr.approvedLoanAmount
                          ? ` • Disetujui: ${formatRupiah(kpr.approvedLoanAmount)}`
                          : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* MODAL 1: Alihkan Lead (TX-07 — ADMIN / SUPERVISOR ONLY) */}
      {canReassign && (
        <Modal
          isOpen={isReassignOpen}
          onClose={() => setIsReassignOpen(false)}
          title="Alihkan Kepemilikan Lead (TX-07)"
          description="Memindahkan Lead beserta tugas aktif dan transaksi berjalan ke Sales aktif lain secara atomik."
          isDismissDisabled={isReassigning}
        >
          <form onSubmit={handleReassignSubmit} className="space-y-4">
            {reassignError && (
              <div
                role="alert"
                className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
              >
                <p className="font-semibold">{reassignError.message}</p>
                {reassignError.correlationId && (
                  <p className="mt-1 font-mono text-[11px]">
                    ID Korelasi: {reassignError.correlationId}
                  </p>
                )}
              </div>
            )}

            {reassignSalesOptions.length === 0 ? (
              <p className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#B45309]">
                Tidak ada Sales aktif lain yang tersedia untuk pengalihan saat ini.
              </p>
            ) : (
              <>
                <Select
                  label="Sales Tujuan"
                  required
                  value={targetSalesId}
                  onChange={(e) => setTargetSalesId(e.target.value)}
                  options={reassignSalesOptions.map((s) => ({
                    value: s.id,
                    label: `${s.fullName} (${s.teamCode} • ${s.teamName})`,
                  }))}
                />

                <div>
                  <label
                    htmlFor="reassign-reason"
                    className="mb-1.5 block text-xs font-medium text-[#475569]"
                  >
                    Alasan Pengalihan (min. 5 karakter){' '}
                    <span className="text-[#DC2626]">*</span>
                  </label>
                  <textarea
                    id="reassign-reason"
                    required
                    minLength={5}
                    rows={3}
                    value={reassignReason}
                    onChange={(e) => setReassignReason(e.target.value)}
                    placeholder="Contoh: Pemerataan beban prospek atau Sales sebelumnya sedang cuti..."
                    className="block w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 border-t border-[#E2E8F0] pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isReassigning}
                onClick={() => setIsReassignOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={reassignSalesOptions.length === 0}
                isLoading={isReassigning}
              >
                Konfirmasi Pengalihan
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 2: Ubah Tahap Pipeline Pra-Transaksi */}
      <Modal
        isOpen={isStageModalOpen}
        onClose={() => setIsStageModalOpen(false)}
        title="Ubah Tahap Pipeline Lead"
        description="Tahap BOOKING, PROSES BAYAR/KPR, dan CLOSED WON dikendalikan otomatis oleh sistem transaksi."
        isDismissDisabled={isTransitioningStage}
      >
        <form onSubmit={handleStageTransitionSubmit} className="space-y-4">
          {stageError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{stageError.message}</p>
              {stageError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  ID Korelasi: {stageError.correlationId}
                </p>
              )}
            </div>
          )}

          <Select
            label="Tahap Pipeline Tujuan"
            value={targetStage}
            onChange={(e) =>
              setTargetStage(
                e.target.value as
                  | 'NEW'
                  | 'CONTACTED'
                  | 'QUALIFIED'
                  | 'SITE_VISIT'
                  | 'NEGOTIATION'
                  | 'CLOSED_LOST'
              )
            }
            options={[
              { value: 'NEW', label: 'NEW' },
              { value: 'CONTACTED', label: 'CONTACTED' },
              { value: 'QUALIFIED', label: 'QUALIFIED (Budget & Timeline wajib terisi)' },
              { value: 'SITE_VISIT', label: 'SITE VISIT' },
              { value: 'NEGOTIATION', label: 'NEGOTIATION' },
              { value: 'CLOSED_LOST', label: 'CLOSED LOST' },
            ]}
          />

          {targetStage === 'CLOSED_LOST' && (
            <Input
              label="Alasan Gagal (Lost Reason, min. 3 karakter)"
              required
              minLength={3}
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="Contoh: Memilih lokasi lain / Budget belum mencukupi"
            />
          )}

          <div>
            <label
              htmlFor="stage-notes"
              className="mb-1.5 block text-xs font-medium text-[#475569]"
            >
              Catatan Transisi (Opsional)
            </label>
            <textarea
              id="stage-notes"
              rows={2}
              value={stageNotes}
              onChange={(e) => setStageNotes(e.target.value)}
              className="block w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isTransitioningStage}
              onClick={() => setIsStageModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant={targetStage === 'CLOSED_LOST' ? 'destructive' : 'primary'}
              size="sm"
              isLoading={isTransitioningStage}
            >
              Simpan Perubahan Tahap
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 3: Tambah Tugas Follow-Up */}
      <Modal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        title="Tambah Tugas Follow-Up"
        description="Buat jadwal tindak lanjut prospek atau kaitkan dengan tagihan/pengajuan KPR aktif."
        isDismissDisabled={isCreatingTask}
      >
        <form onSubmit={handleCreateTaskSubmit} className="space-y-4">
          {taskError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{taskError.message}</p>
              {taskError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  ID Korelasi: {taskError.correlationId}
                </p>
              )}
            </div>
          )}

          <Input
            label="Judul Tugas Follow-Up"
            required
            minLength={3}
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Contoh: Follow-up kelengkapan slip gaji & NPWP"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Batas Waktu (Due Date)"
              type="datetime-local"
              required
              value={taskDueAt}
              onChange={(e) => setTaskDueAt(e.target.value)}
            />
            <Select
              label="Prioritas"
              value={taskPriority}
              onChange={(e) => setTaskPriority(e.target.value as TaskPriority)}
              options={[
                { value: 'LOW', label: 'LOW' },
                { value: 'MEDIUM', label: 'MEDIUM' },
                { value: 'HIGH', label: 'HIGH' },
              ]}
            />
          </div>

          {(scheduleOptions.length > 0 || kprApplications.length > 0) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {scheduleOptions.length > 0 && (
                <Select
                  label="Tautkan Jadwal Tagihan (Opsional)"
                  value={taskScheduleId}
                  onChange={(e) => setTaskScheduleId(e.target.value)}
                  options={[
                    { value: '', label: '-- Tidak Ditautkan --' },
                    ...scheduleOptions.map((s) => ({
                      value: s.id,
                      label: `${s.bookingRef} • ${s.title} (${formatRupiah(s.scheduledAmount)})`,
                    })),
                  ]}
                />
              )}

              {kprApplications.length > 0 && (
                <Select
                  label="Tautkan Pengajuan KPR (Opsional)"
                  value={taskKprId}
                  onChange={(e) => setTaskKprId(e.target.value)}
                  options={[
                    { value: '', label: '-- Tidak Ditautkan --' },
                    ...kprApplications.map((k) => ({
                      value: k.id,
                      label: `${k.referenceNumber} (${k.bankName})`,
                    })),
                  ]}
                />
              )}
            </div>
          )}

          <div>
            <label
              htmlFor="task-desc"
              className="mb-1.5 block text-xs font-medium text-[#475569]"
            >
              Deskripsi / Instruksi (Opsional)
            </label>
            <textarea
              id="task-desc"
              rows={2}
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              className="block w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isCreatingTask}
              onClick={() => setIsTaskModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isCreatingTask}>
              Simpan Tugas
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 4: Selesaikan Tugas Follow-Up */}
      <Modal
        isOpen={Boolean(completingTask)}
        onClose={() => setCompletingTask(null)}
        title="Selesaikan Tugas Follow-Up"
        description={completingTask ? completingTask.title : undefined}
        isDismissDisabled={isCompletingTask}
      >
        <form onSubmit={handleCompleteTaskSubmit} className="space-y-4">
          {completeTaskError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{completeTaskError.message}</p>
              {completeTaskError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  ID Korelasi: {completeTaskError.correlationId}
                </p>
              )}
            </div>
          )}

          <div>
            <label
              htmlFor="completion-notes"
              className="mb-1.5 block text-xs font-medium text-[#475569]"
            >
              Catatan Hasil Tindak Lanjut (min. 5 karakter){' '}
              <span className="text-[#DC2626]">*</span>
            </label>
            <textarea
              id="completion-notes"
              required
              minLength={5}
              rows={3}
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="Tuliskan hasil tindak lanjut yang telah dilakukan..."
              className="block w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isCompletingTask}
              onClick={() => setCompletingTask(null)}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isCompletingTask}>
              Tandai Selesai
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 5: Jadwalkan Survei Lokasi */}
      <Modal
        isOpen={isVisitModalOpen}
        onClose={() => setIsVisitModalOpen(false)}
        title="Jadwalkan Survei Lokasi (Site Visit)"
        description="Penjadwalan survei otomatis memajukan tahap pra-transaksi ke SITE VISIT dan memperbarui skor prospek."
        isDismissDisabled={isSchedulingVisit}
      >
        <form onSubmit={handleScheduleVisitSubmit} className="space-y-4">
          {visitError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{visitError.message}</p>
              {visitError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  ID Korelasi: {visitError.correlationId}
                </p>
              )}
            </div>
          )}

          <Select
            label="Proyek Lokasi Survei"
            required
            value={visitProjectId}
            onChange={(e) => {
              setVisitProjectId(e.target.value);
              setVisitUnitId('');
            }}
            options={projects.map((p) => ({
              value: p.id,
              label: `${p.name} (${p.city})`,
            }))}
          />

          <Select
            label="Unit Spesifik yang Ditinjau (Opsional)"
            value={visitUnitId}
            onChange={(e) => setVisitUnitId(e.target.value)}
            options={[
              { value: '', label: '-- Kunjungan Proyek / Show Unit Umum --' },
              ...filteredVisitUnits.map((u) => ({
                value: u.id,
                label: `${u.unitCode} (Blok ${u.blockNumber}) — ${formatRupiah(u.catalogPrice)}`,
              })),
            ]}
          />

          <Input
            label="Tanggal & Waktu Kunjungan"
            type="datetime-local"
            required
            value={visitScheduledAt}
            onChange={(e) => setVisitScheduledAt(e.target.value)}
          />

          <div>
            <label
              htmlFor="visit-prep-notes"
              className="mb-1.5 block text-xs font-medium text-[#475569]"
            >
              Catatan Persiapan (Opsional)
            </label>
            <textarea
              id="visit-prep-notes"
              rows={2}
              value={visitPrepNotes}
              onChange={(e) => setVisitPrepNotes(e.target.value)}
              className="block w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSchedulingVisit}
              onClick={() => setIsVisitModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isSchedulingVisit}>
              Jadwalkan Survei
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 6: Catat Hasil Survei Lokasi */}
      <Modal
        isOpen={Boolean(completingVisit)}
        onClose={() => setCompletingVisit(null)}
        title="Catat Hasil Survei Lokasi"
        description={
          completingVisit
            ? `${completingVisit.projectName}${completingVisit.unitCode ? ` • Unit ${completingVisit.unitCode}` : ''}`
            : undefined
        }
        isDismissDisabled={isCompletingVisit}
      >
        <form onSubmit={handleCompleteVisitSubmit} className="space-y-4">
          {completeVisitError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{completeVisitError.message}</p>
              {completeVisitError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  ID Korelasi: {completeVisitError.correlationId}
                </p>
              )}
            </div>
          )}

          <Select
            label="Hasil Evaluasi Ketertarikan Konsumen"
            value={visitOutcome}
            onChange={(e) => setVisitOutcome(e.target.value as SiteVisitOutcome)}
            options={[
              { value: 'POSITIVE_INTEREST', label: 'Tertarik Positif (+25 Poin Interaksi)' },
              { value: 'NEUTRAL_CONSIDERATION', label: 'Pertimbangan Netral (+20 Poin)' },
              { value: 'NOT_SUITABLE', label: 'Kurang Cocok (+12 Poin)' },
            ]}
          />

          <div>
            <label
              htmlFor="visit-eval-notes"
              className="mb-1.5 block text-xs font-medium text-[#475569]"
            >
              Evaluasi Hasil Kunjungan (min. 5 karakter){' '}
              <span className="text-[#DC2626]">*</span>
            </label>
            <textarea
              id="visit-eval-notes"
              required
              minLength={5}
              rows={3}
              value={visitEvalNotes}
              onChange={(e) => setVisitEvalNotes(e.target.value)}
              placeholder="Catat kesan calon pembeli terhadap unit, akses, dan rencana lanjut..."
              className="block w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isCompletingVisit}
              onClick={() => setCompletingVisit(null)}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isCompletingVisit}>
              Simpan Hasil Survei
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 7: Ajukan Booking (TX-01) */}
      <Modal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        title="Ajukan Booking Unit (TX-01)"
        description="Unit berstatus AVAILABLE akan ditahan sementara (HELD) selama 72 jam dengan penguncian harga (Price Freeze)."
        size="lg"
        isDismissDisabled={isCreatingBooking}
      >
        <form onSubmit={handleCreateBookingSubmit} className="space-y-4">
          {bookingError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{bookingError.message}</p>
              {bookingError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  ID Korelasi: {bookingError.correlationId}
                </p>
              )}
            </div>
          )}

          {availableUnits.length === 0 ? (
            <p className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#B45309]">
              Saat ini tidak ada unit AVAILABLE pada proyek yang aktif dijual.
            </p>
          ) : (
            <>
              <Select
                label="Pilih Unit Properti (AVAILABLE)"
                required
                value={bookingUnitId}
                onChange={(e) => {
                  setBookingUnitId(e.target.value);
                  setBookingPromoId('');
                }}
                options={availableUnits.map((u) => ({
                  value: u.id,
                  label: `${u.projectName} • ${u.unitCode} (Blok ${u.blockNumber}) — ${formatRupiah(u.catalogPrice)}`,
                }))}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select
                  label="Metode Pembayaran"
                  value={bookingPaymentMethod}
                  onChange={(e) => {
                    const nextMethod = e.target.value as PaymentMethod;
                    setBookingPaymentMethod(nextMethod);
                    if (nextMethod === 'CASH_KERAS') {
                      setBookingDpTotal('0');
                    }
                  }}
                  options={[
                    { value: 'KPR', label: 'KPR Bank' },
                    { value: 'CASH_BERTAHAP', label: 'Cash Bertahap' },
                    { value: 'CASH_KERAS', label: 'Cash Keras' },
                  ]}
                />

                <Select
                  label="Program Promo Berlaku (Opsional)"
                  value={bookingPromoId}
                  onChange={(e) => setBookingPromoId(e.target.value)}
                  options={[
                    { value: '', label: '-- Tanpa Promo --' },
                    ...eligiblePromosForBookingUnit.map((pr) => ({
                      value: pr.id,
                      label: `${pr.code} — ${pr.name}`,
                    })),
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <CurrencyInput
                  label="Nominal Booking Fee (Rp)"
                  min={100000}
                  step={100000}
                  required
                  value={bookingFeeAmount}
                  onValueChange={setBookingFeeAmount}
                  className="font-mono tabular-nums"
                />

                {bookingPaymentMethod !== 'CASH_KERAS' ? (
                  <CurrencyInput
                    label="Total Kesepakatan DP (Rp)"
                    min={0}
                    step={500000}
                    required
                    value={bookingDpTotal}
                    onValueChange={setBookingDpTotal}
                    className="font-mono tabular-nums"
                  />
                ) : (
                  <Input
                    label="Total Kesepakatan DP (Rp)"
                    value="0 (Cash Keras tanpa DP)"
                    disabled
                    className="font-mono tabular-nums"
                  />
                )}
              </div>

              {bookingPaymentMethod !== 'CASH_KERAS' && (
                <label className="flex items-center gap-2 text-xs font-medium text-[#334155]">
                  <input
                    type="checkbox"
                    checked={bookingFeePartOfDp}
                    onChange={(e) => setBookingFeePartOfDp(e.target.checked)}
                    className="h-4 w-4 rounded border-[#CBD5E1] text-[#14532D] focus:ring-[#059669]"
                  />
                  <span>Booking Fee termasuk bagian pengurang total kesepakatan DP</span>
                </label>
              )}

              {bookingEstimate && (
                <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3.5 text-xs">
                  <p className="font-bold text-[#14532D]">Pratinjau Perhitungan Harga (Price Freeze)</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <span className="text-[11px] text-[#475569]">Harga Katalog</span>
                      <p className="font-mono font-semibold text-[#0F172A] tabular-nums">
                        {formatRupiah(bookingEstimate.catalogPrice)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#475569]">Diskon Promo</span>
                      <p className="font-mono font-semibold text-[#047857] tabular-nums">
                        - {formatRupiah(bookingEstimate.discount)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#475569]">Harga Kesepakatan Final</span>
                      <p className="font-mono font-bold text-[#14532D] tabular-nums">
                        {formatRupiah(bookingEstimate.agreedFinalPrice)}
                      </p>
                    </div>
                    {bookingPaymentMethod === 'KPR' && (
                      <div>
                        <span className="text-[11px] text-[#475569]">Estimasi Plafon KPR</span>
                        <p className="font-mono font-semibold text-[#1D4ED8] tabular-nums">
                          {formatRupiah(bookingEstimate.estimatedKprPrincipal)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="booking-notes"
                  className="mb-1.5 block text-xs font-medium text-[#475569]"
                >
                  Catatan Pengajuan Booking (Opsional)
                </label>
                <textarea
                  id="booking-notes"
                  rows={2}
                  value={bookingNotes}
                  onChange={(e) => setBookingNotes(e.target.value)}
                  className="block w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isCreatingBooking}
              onClick={() => setIsBookingModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={availableUnits.length === 0}
              isLoading={isCreatingBooking}
            >
              Kunci Unit &amp; Buat Booking
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
