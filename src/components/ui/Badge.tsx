// Lokasi: src/components/ui/Badge.tsx
// Komponen Status Badge & Pemetaan Semantik sesuai DESIGN.md v2.1 Bagian 2.2 & 6.3

import React from 'react';
import {
  Flame,
  Sun,
  Snowflake,
  CheckCircle2,
  Clock,
  Lock,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  FileCheck2,
  FileWarning,
  CircleDot,
} from 'lucide-react';

export type BadgeTone =
  | 'emerald'
  | 'amber'
  | 'blue'
  | 'slate'
  | 'red'
  | 'forest'
  | 'orange';

export interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  icon?: React.ReactNode;
  className?: string;
}

const toneClasses: Record<BadgeTone, string> = {
  emerald: 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]',
  forest: 'bg-[#F0FDF4] text-[#14532D] border-[#BBF7D0]',
  amber: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]',
  orange: 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]',
  blue: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]',
  slate: 'bg-[#F1F5F9] text-[#334155] border-[#CBD5E1]',
  red: 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]',
};

export function Badge({ children, tone = 'slate', icon, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${toneClasses[tone]} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}

/**
 * Helper Badge khusus Lead Temperature (HOT / WARM / COLD) dengan ikon Lucide (tanpa emoji)
 */
export function LeadTemperatureBadge({
  temperature,
  score,
}: {
  temperature: 'HOT' | 'WARM' | 'COLD' | string;
  score?: number;
}) {
  if (temperature === 'HOT') {
    return (
      <Badge
        tone="red"
        icon={<Flame className="h-3.5 w-3.5 text-[#B91C1C]" strokeWidth={1.75} />}
      >
        HOT{typeof score === 'number' ? ` • ${score}` : ''}
      </Badge>
    );
  }
  if (temperature === 'WARM') {
    return (
      <Badge
        tone="orange"
        icon={<Sun className="h-3.5 w-3.5 text-[#C2410C]" strokeWidth={1.75} />}
      >
        WARM{typeof score === 'number' ? ` • ${score}` : ''}
      </Badge>
    );
  }
  return (
    <Badge
      tone="blue"
      icon={<Snowflake className="h-3.5 w-3.5 text-[#1D4ED8]" strokeWidth={1.75} />}
    >
      COLD{typeof score === 'number' ? ` • ${score}` : ''}
    </Badge>
  );
}

/**
 * Helper Badge khusus Status Unit (AVAILABLE / HELD / BOOKED / SOLD)
 */
export function UnitStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'AVAILABLE':
      return (
        <Badge
          tone="emerald"
          icon={<CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
        >
          AVAILABLE
        </Badge>
      );
    case 'HELD':
      return (
        <Badge tone="amber" icon={<Clock className="h-3.5 w-3.5" strokeWidth={1.75} />}>
          HELD (72J)
        </Badge>
      );
    case 'BOOKED':
      return (
        <Badge tone="blue" icon={<Lock className="h-3.5 w-3.5" strokeWidth={1.75} />}>
          BOOKED
        </Badge>
      );
    case 'SOLD':
      return (
        <Badge
          tone="slate"
          icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />}
        >
          SOLD (100%)
        </Badge>
      );
    default:
      return <Badge tone="slate">{status}</Badge>;
  }
}

/**
 * Helper Badge umum untuk memetakan nilai ENUM domain ke Badge Semantik
 */
export function DomainStatusBadge({ value }: { value: string }) {
  switch (value) {
    // Booking & Deal & Verification Positive
    case 'ACTIVE':
    case 'VERIFIED':
    case 'PAID':
    case 'COMPLETED':
    case 'CLOSED_WON':
    case 'FULLY_SETTLED':
    case 'CONTRACT_COMPLETED':
    case 'FULLY_DISBURSED':
    case 'APPROVED':
      return (
        <Badge
          tone="emerald"
          icon={<CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
        >
          {value.replace(/_/g, ' ')}
        </Badge>
      );

    // Warning / Waiting / Pending
    case 'PENDING_FEE':
    case 'PENDING_VERIFICATION':
    case 'PARTIALLY_PAID':
    case 'PENDING_REFUND':
    case 'UPLOADED':
    case 'PARTIALLY_DISBURSED':
    case 'DISBURSED_RETENTION_PENDING':
    case 'ADDITIONAL_REQUIREMENTS':
    case 'MEDIUM':
      return (
        <Badge tone="amber" icon={<Clock className="h-3.5 w-3.5" strokeWidth={1.75} />}>
          {value.replace(/_/g, ' ')}
        </Badge>
      );

    // Info / In-Progress
    case 'IN_PROGRESS':
    case 'UNDER_CONTRACT':
    case 'PRE_CONTRACT':
    case 'BOOKING_FEE_SETTLED':
    case 'DP_SETTLED_ONGOING':
    case 'SCHEDULED':
    case 'DOCUMENT_COLLECTION':
    case 'DOCUMENT_VERIFICATION':
    case 'SUBMITTED':
    case 'BANK_VERIFICATION':
    case 'APPRAISAL':
    case 'AKAD_SCHEDULED':
    case 'AKAD_COMPLETED':
    case 'DISBURSEMENT':
      return (
        <Badge
          tone="blue"
          icon={<CircleDot className="h-3.5 w-3.5" strokeWidth={1.75} />}
        >
          {value.replace(/_/g, ' ')}
        </Badge>
      );

    // Danger / Rejected / Overdue / Escalation
    case 'OVERDUE':
    case 'OVERDUE_IN_ARREARS':
    case 'REJECTED':
    case 'REVISION_REQUIRED':
    case 'MISSING':
    case 'EXPIRED':
    case 'CANCELLED':
    case 'CANCELLED_FAILED':
    case 'CONTRACT_TERMINATED':
    case 'TERMINATED':
    case 'REJECTED_BY_BANK':
    case 'CANCELLED_BY_CUSTOMER':
    case 'BOOKING_CANCELLED':
    case 'CLOSED_LOST':
    case 'HIGH':
      return (
        <Badge
          tone="red"
          icon={
            value === 'REVISION_REQUIRED' || value === 'MISSING' ? (
              <FileWarning className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : value === 'OVERDUE' || value === 'HIGH' ? (
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <XCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
            )
          }
        >
          {value.replace(/_/g, ' ')}
        </Badge>
      );

    default:
      return (
        <Badge
          tone="slate"
          icon={<FileCheck2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
        >
          {value.replace(/_/g, ' ')}
        </Badge>
      );
  }
}
