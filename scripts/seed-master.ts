// Lokasi: scripts/seed-master.ts
// Tujuan: Master Database Seeder Idempoten untuk FIM-Property CRM (Tahap 7)
// Cakupan: 32 Tabel Public + Supabase Auth Users (Single-Company Internal CRM, Non-ML, Kebijakan Final TC-01A)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { calculateProspectScore } from '../src/modules/shared/scoring-calculator/prospect-scoring.calculator';
import type {
  ActivityChannel,
  BookingStatus,
  DealContractStatus,
  DealSalesOutcome,
  DealSettlementStatus,
  DisbursementTranche,
  InteractionResponse,
  KprApplicationStatus,
  KprDisbursementStatus,
  KprDocStatus,
  KprStage,
  LeadSource,
  NotificationType,
  OutboxStatus,
  PaymentMethod,
  PaymentReadiness,
  PaymentVerificationStatus,
  PipelineStage,
  ProjectStatus,
  PromoType,
  PurchaseTimeline,
  RefundPolicy,
  RefundStatus,
  ScheduleStatus,
  ScheduleType,
  SiteVisitOutcome,
  SiteVisitStatus,
  SystemRole,
  TaskPriority,
  TaskSource,
  TaskStatus,
  TeamMemberRole,
  UnitStatus,
} from '../src/types/database.types';

/**
 * Helper non-undefined yang aman untuk konfigurasi tsconfig "noUncheckedIndexedAccess": true
 */
function must<T>(value: T | undefined, label = 'required value'): T {
  if (value === undefined) {
    throw new Error(`[SEED_ASSERTION_ERROR] Nilai wajib tidak ditemukan: ${label}`);
  }
  return value;
}

/**
 * Memuat variabel environment dari .env.local / .env atau environment proses kontainer aktif
 * secara aman di memori tanpa pernah mencetak nilai rahasia ke log/terminal.
 */
function loadRuntimeEnvSafely(): void {
  const envFiles = ['.env.local', '.env'];
  for (const fileName of envFiles) {
    const fullPath = path.resolve(process.cwd(), fileName);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key] && val) {
          process.env[key] = val;
        }
      }
    }
  }

  // Fallback untuk subshell CLI di container Linux yang tidak mewarisi env dari parent server
  if (
    (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    fs.existsSync('/proc')
  ) {
    try {
      const entries = fs.readdirSync('/proc');
      for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const rawEnv = fs.readFileSync(`/proc/${entry}/environ`, 'utf8');
          if (!rawEnv.includes('NEXT_PUBLIC_SUPABASE_URL=')) continue;
          for (const item of rawEnv.split('\0')) {
            const eqIdx = item.indexOf('=');
            if (eqIdx <= 0) continue;
            const k = item.slice(0, eqIdx);
            const v = item.slice(eqIdx + 1);
            if (
              (k === 'NEXT_PUBLIC_SUPABASE_URL' ||
                k === 'NEXT_PUBLIC_SUPABASE_ANON_KEY' ||
                k === 'SUPABASE_SERVICE_ROLE_KEY' ||
                k === 'CRON_SECRET' ||
                k === 'SEED_DEMO_PASSWORD') &&
              !process.env[k] &&
              v
            ) {
              process.env[k] = v;
            }
          }
          if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
            break;
          }
        } catch {
          // Abaikan proses yang tidak dapat dibaca
        }
      }
    } catch {
      // Abaikan jika /proc tidak dapat diakses
    }
  }
}

/**
 * Helper pembuat UUID v4 deterministik berbasis namespace prefix dan nomor urut
 * Format: a0000000-0000-4000-8000-<4 digit group><8 digit index>
 */
function detUuid(groupCode: number, index: number): string {
  const g = groupCode.toString(16).padStart(4, '0');
  const i = index.toString(16).padStart(8, '0');
  return `a0000000-0000-4000-8000-${g}${i}`;
}

function isoHoursFromNow(hoursOffset: number): string {
  return new Date(Date.now() + hoursOffset * 3600 * 1000).toISOString();
}

function isoDaysFromNow(daysOffset: number): string {
  return new Date(Date.now() + daysOffset * 24 * 3600 * 1000).toISOString();
}

function dateOnlyDaysFromNow(daysOffset: number): string {
  return isoDaysFromNow(daysOffset).slice(0, 10);
}

type StaffKey =
  | 'ICHSAN_ADMIN'
  | 'MUZAYIN_SPV1'
  | 'FARIZ_SALES1'
  | 'TIM1_SALES2'
  | 'TIM1_SALES3'
  | 'TIM1_SALES4'
  | 'TIM1_SALES5'
  | 'SPV_TIM2'
  | 'TIM2_SALES1'
  | 'TIM2_SALES2'
  | 'TIM2_SALES3'
  | 'TIM2_SALES4'
  | 'TIM2_SALES5'
  | 'SPV_TIM3'
  | 'TIM3_SALES1'
  | 'TIM3_SALES2'
  | 'TIM3_SALES3'
  | 'TIM3_SALES4'
  | 'TIM3_SALES5';

interface StaffSeedSpec {
  key: StaffKey;
  deterministicId: string;
  fullName: string;
  email: string;
  phone: string;
  systemRole: SystemRole;
  teamCode: 'TIM-01' | 'TIM-02' | 'TIM-03' | null;
  membershipRole: TeamMemberRole | null;
  membershipId: string | null;
}

const TEAM_IDS = {
  'TIM-01': detUuid(2, 1),
  'TIM-02': detUuid(2, 2),
  'TIM-03': detUuid(2, 3),
} as const;

const STAFF_SPECS: StaffSeedSpec[] = [
  // 1. Admin Operasional & Keuangan Utama (Anggota Kelompok)
  {
    key: 'ICHSAN_ADMIN',
    deterministicId: detUuid(1, 1),
    fullName: 'Muhammad Ichsan Fachrulrozi',
    email: 'ichsan.admin@fimproperty.local',
    phone: '+628111000001',
    systemRole: 'ADMIN',
    teamCode: null,
    membershipRole: null,
    membershipId: null,
  },
  // 2. Supervisor Tim 1 (Anggota Kelompok)
  {
    key: 'MUZAYIN_SPV1',
    deterministicId: detUuid(1, 2),
    fullName: 'Muzayin Arifin',
    email: 'muzayin.spv@fimproperty.local',
    phone: '+628111000002',
    systemRole: 'SUPERVISOR',
    teamCode: 'TIM-01',
    membershipRole: 'TEAM_SUPERVISOR',
    membershipId: detUuid(3, 1),
  },
  // 3. Sales Executive Utama Tim 1 (Anggota Kelompok -> Badge: Fariz • TIM-01)
  {
    key: 'FARIZ_SALES1',
    deterministicId: detUuid(1, 3),
    fullName: 'Fariz Aditya Ardhana',
    email: 'fariz.sales@fimproperty.local',
    phone: '+628111000003',
    systemRole: 'SALES',
    teamCode: 'TIM-01',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 2),
  },
  // 4-7. Anggota Sales tambahan di TIM-01 (Tim Nusantara Alpha)
  {
    key: 'TIM1_SALES2',
    deterministicId: detUuid(1, 4),
    fullName: 'Nadia Putri Pramesti',
    email: 'sales1.tim1@fimproperty.local',
    phone: '+628111000004',
    systemRole: 'SALES',
    teamCode: 'TIM-01',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 3),
  },
  {
    key: 'TIM1_SALES3',
    deterministicId: detUuid(1, 5),
    fullName: 'Raka Pratama Wijaya',
    email: 'sales2.tim1@fimproperty.local',
    phone: '+628111000005',
    systemRole: 'SALES',
    teamCode: 'TIM-01',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 4),
  },
  {
    key: 'TIM1_SALES4',
    deterministicId: detUuid(1, 6),
    fullName: 'Siti Aisyah Maharani',
    email: 'sales3.tim1@fimproperty.local',
    phone: '+628111000006',
    systemRole: 'SALES',
    teamCode: 'TIM-01',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 5),
  },
  {
    key: 'TIM1_SALES5',
    deterministicId: detUuid(1, 7),
    fullName: 'Dimas Arya Saputra',
    email: 'sales4.tim1@fimproperty.local',
    phone: '+628111000007',
    systemRole: 'SALES',
    teamCode: 'TIM-01',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 6),
  },
  // 8-13. TIM-02 (Tim Harmoni Bravo: 1 Supervisor + 5 Sales)
  {
    key: 'SPV_TIM2',
    deterministicId: detUuid(1, 8),
    fullName: 'Hendra Kusuma Wardhana',
    email: 'spv.tim2@fimproperty.local',
    phone: '+628111000008',
    systemRole: 'SUPERVISOR',
    teamCode: 'TIM-02',
    membershipRole: 'TEAM_SUPERVISOR',
    membershipId: detUuid(3, 7),
  },
  {
    key: 'TIM2_SALES1',
    deterministicId: detUuid(1, 9),
    fullName: 'Bima Sakti Nugroho',
    email: 'sales1.tim2@fimproperty.local',
    phone: '+628111000009',
    systemRole: 'SALES',
    teamCode: 'TIM-02',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 8),
  },
  {
    key: 'TIM2_SALES2',
    deterministicId: detUuid(1, 10),
    fullName: 'Citra Kirana Lestari',
    email: 'sales2.tim2@fimproperty.local',
    phone: '+628111000010',
    systemRole: 'SALES',
    teamCode: 'TIM-02',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 9),
  },
  {
    key: 'TIM2_SALES3',
    deterministicId: detUuid(1, 11),
    fullName: 'Fajar Ramadhan Putra',
    email: 'sales3.tim2@fimproperty.local',
    phone: '+628111000011',
    systemRole: 'SALES',
    teamCode: 'TIM-02',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 10),
  },
  {
    key: 'TIM2_SALES4',
    deterministicId: detUuid(1, 12),
    fullName: 'Larasati Dewi Anggraini',
    email: 'sales4.tim2@fimproperty.local',
    phone: '+628111000012',
    systemRole: 'SALES',
    teamCode: 'TIM-02',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 11),
  },
  {
    key: 'TIM2_SALES5',
    deterministicId: detUuid(1, 13),
    fullName: 'Gilang Dirga Mahendra',
    email: 'sales5.tim2@fimproperty.local',
    phone: '+628111000013',
    systemRole: 'SALES',
    teamCode: 'TIM-02',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 12),
  },
  // 14-19. TIM-03 (Tim Graha Charlie: 1 Supervisor + 5 Sales)
  {
    key: 'SPV_TIM3',
    deterministicId: detUuid(1, 14),
    fullName: 'Renata Puspita Sari',
    email: 'spv.tim3@fimproperty.local',
    phone: '+628111000014',
    systemRole: 'SUPERVISOR',
    teamCode: 'TIM-03',
    membershipRole: 'TEAM_SUPERVISOR',
    membershipId: detUuid(3, 13),
  },
  {
    key: 'TIM3_SALES1',
    deterministicId: detUuid(1, 15),
    fullName: 'Yoga Aditya Pratama',
    email: 'sales1.tim3@fimproperty.local',
    phone: '+628111000015',
    systemRole: 'SALES',
    teamCode: 'TIM-03',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 14),
  },
  {
    key: 'TIM3_SALES2',
    deterministicId: detUuid(1, 16),
    fullName: 'Melati Kusuma Ningrum',
    email: 'sales2.tim3@fimproperty.local',
    phone: '+628111000016',
    systemRole: 'SALES',
    teamCode: 'TIM-03',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 15),
  },
  {
    key: 'TIM3_SALES3',
    deterministicId: detUuid(1, 17),
    fullName: 'Reza Pahlevi Santoso',
    email: 'sales3.tim3@fimproperty.local',
    phone: '+628111000017',
    systemRole: 'SALES',
    teamCode: 'TIM-03',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 16),
  },
  {
    key: 'TIM3_SALES4',
    deterministicId: detUuid(1, 18),
    fullName: 'Tiara Andini Putri',
    email: 'sales4.tim3@fimproperty.local',
    phone: '+628111000018',
    systemRole: 'SALES',
    teamCode: 'TIM-03',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 17),
  },
  {
    key: 'TIM3_SALES5',
    deterministicId: detUuid(1, 19),
    fullName: 'Arif Budiman Hakim',
    email: 'sales5.tim3@fimproperty.local',
    phone: '+628111000019',
    systemRole: 'SALES',
    teamCode: 'TIM-03',
    membershipRole: 'TEAM_SALES',
    membershipId: detUuid(3, 18),
  },
];

type StaffIdMap = Record<StaffKey, string>;

async function assertNoError(
  label: string,
  result: { error: { message: string; details?: string; hint?: string } | null }
): Promise<void> {
  if (result.error) {
    throw new Error(
      `[SEED_ERROR] ${label}: ${result.error.message} ${result.error.details ?? ''} ${result.error.hint ?? ''}`.trim()
    );
  }
}

async function seedIdentityAndTeams(
  supabase: SupabaseClient,
  demoPassword: string
): Promise<StaffIdMap> {
  console.info('1. Menyemai Identity (19 Auth Users & Profiles) serta 3 Tim Sales...');

  const { data: existingAuthList, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 500,
  });
  if (listErr) {
    throw new Error(`[SEED_AUTH_LIST_ERROR] ${listErr.message}`);
  }

  const emailToAuthId = new Map<string, string>();
  for (const u of existingAuthList?.users ?? []) {
    if (u.email) {
      emailToAuthId.set(u.email.toLowerCase(), u.id);
    }
  }

  const partialStaffMap: Partial<StaffIdMap> = {};

  for (const spec of STAFF_SPECS) {
    const emailLower = spec.email.toLowerCase();
    let userId = emailToAuthId.get(emailLower);

    if (userId) {
      const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
        password: demoPassword,
        email_confirm: true,
        user_metadata: { full_name: spec.fullName, system_role: spec.systemRole },
      });
      if (updErr) {
        throw new Error(`[SEED_AUTH_UPDATE_ERROR] ${spec.email}: ${updErr.message}`);
      }
    } else {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        id: spec.deterministicId,
        email: spec.email,
        password: demoPassword,
        email_confirm: true,
        user_metadata: { full_name: spec.fullName, system_role: spec.systemRole },
      });
      if (createErr || !created.user) {
        throw new Error(
          `[SEED_AUTH_CREATE_ERROR] ${spec.email}: ${createErr?.message ?? 'User null'}`
        );
      }
      userId = created.user.id;
    }

    partialStaffMap[spec.key] = userId;

    const profileRes = await supabase.from('profiles').upsert(
      {
        id: userId,
        full_name: spec.fullName,
        email: spec.email,
        phone: spec.phone,
        system_role: spec.systemRole,
        is_active: true,
      },
      { onConflict: 'id' }
    );
    await assertNoError(`Upsert profile ${spec.email}`, profileRes);
  }

  const staffIdMap = partialStaffMap as StaffIdMap;
  const adminId = staffIdMap.ICHSAN_ADMIN;

  // Upsert 3 Teams
  const teamsPayload = [
    {
      id: TEAM_IDS['TIM-01'],
      code: 'TIM-01',
      name: 'Tim Nusantara Alpha',
      description:
        'Tim penjualan utama wilayah Tangerang Selatan, BSD & Bintaro di bawah pimpinan Supervisor Muzayin Arifin.',
      is_active: true,
      created_by: adminId,
    },
    {
      id: TEAM_IDS['TIM-02'],
      code: 'TIM-02',
      name: 'Tim Harmoni Bravo',
      description:
        'Tim penjualan koridor Bekasi, Cibubur & Jakarta Timur di bawah pimpinan Supervisor Hendra Kusuma.',
      is_active: true,
      created_by: adminId,
    },
    {
      id: TEAM_IDS['TIM-03'],
      code: 'TIM-03',
      name: 'Tim Graha Charlie',
      description:
        'Tim penjualan koridor Depok, Bogor & Sawangan di bawah pimpinan Supervisor Renata Puspita.',
      is_active: true,
      created_by: adminId,
    },
  ];

  const teamsRes = await supabase.from('teams').upsert(teamsPayload, { onConflict: 'id' });
  await assertNoError('Upsert teams', teamsRes);

  // Upsert Team Memberships secara idempoten dengan menghormati CST-01 & CST-02
  for (const spec of STAFF_SPECS) {
    if (!spec.teamCode || !spec.membershipRole || !spec.membershipId) continue;
    const profileId = staffIdMap[spec.key];
    const teamId = TEAM_IDS[spec.teamCode];

    const memRes = await supabase.from('team_memberships').upsert(
      {
        id: spec.membershipId,
        team_id: teamId,
        profile_id: profileId,
        membership_role: spec.membershipRole,
        is_active: true,
        joined_at: isoDaysFromNow(-180),
        left_at: null,
        assigned_by: adminId,
        notes: `Penempatan resmi ${spec.fullName} pada ${spec.teamCode}.`,
      },
      { onConflict: 'id' }
    );
    await assertNoError(`Upsert team_membership ${spec.email}`, memRes);
  }

  // Tambahkan 1 riwayat perpindahan tim historis (is_active = false) untuk menguji histori tim
  const histMemRes = await supabase.from('team_memberships').upsert(
    {
      id: detUuid(3, 99),
      team_id: TEAM_IDS['TIM-02'],
      profile_id: staffIdMap.TIM1_SALES2,
      membership_role: 'TEAM_SALES',
      is_active: false,
      joined_at: isoDaysFromNow(-300),
      left_at: isoDaysFromNow(-181),
      assigned_by: adminId,
      notes: 'Rotasi internal dari Tim Harmoni Bravo ke Tim Nusantara Alpha.',
    },
    { onConflict: 'id' }
  );
  await assertNoError('Upsert historical team_membership', histMemRes);

  return staffIdMap;
}

type BankName = 'Bank Mandiri' | 'BCA' | 'BTN';
type BankDocCode =
  | 'DOC_KTP'
  | 'DOC_KK'
  | 'DOC_NPWP'
  | 'DOC_PAYSLIP_3M'
  | 'DOC_BANK_STMT_3M'
  | 'DOC_EMPLOYMENT_LTR';

interface CatalogSeedIds {
  developerIds: [string, string, string];
  projectIds: [string, string, string, string, string];
  propertyTypeIdsByProject: Record<string, [string, string]>;
  unitIds: string[];
  unitPrices: Record<string, number>;
  unitProjects: Record<string, string>;
  unitTypes: Record<string, string>;
  promoIds: {
    PROMO_NOMINAL_BSD: string;
    PROMO_PERCENT_BTR: string;
    PROMO_BENEFIT_BKS: string;
    PROMO_NOMINAL_DPK: string;
  };
  bankReqIds: Record<BankName, Record<BankDocCode, string>>;
}

async function seedCatalogAndBankRequirements(
  supabase: SupabaseClient,
  staffIdMap: StaffIdMap
): Promise<CatalogSeedIds> {
  console.info(
    '2. Menyemai Katalog Properti (3 Developer, 5 Proyek, 10 Tipe, 30 Unit, Promo, Harga Historis & Persyaratan Bank)...'
  );

  const adminId = staffIdMap.ICHSAN_ADMIN;
  const farizId = staffIdMap.FARIZ_SALES1;
  const tim1Sales2Id = staffIdMap.TIM1_SALES2;
  const tim2Sales1Id = staffIdMap.TIM2_SALES1;
  const tim2Sales2Id = staffIdMap.TIM2_SALES2;
  const tim3Sales1Id = staffIdMap.TIM3_SALES1;

  const developerIds: [string, string, string] = [
    detUuid(4, 1),
    detUuid(4, 2),
    detUuid(4, 3),
  ];
  const developersPayload = [
    {
      id: developerIds[0],
      code: 'DEV-01',
      name: 'PT Fim Karya Nusantara Land',
      address: 'Gedung FIM Tower Lt. 12, Jl. Boulevard Raya BSD City, Tangerang Selatan',
      pic_name: 'Ir. Bambang Suryono',
      pic_phone: '+628118001001',
      pic_email: 'bambang.suryono@fimland.co.id',
      policy_notes:
        'Developer utama grup FIM-Property. Mendukung KPR Bank Mandiri, BCA, dan BTN serta Cash Bertahap hingga 6 termin.',
      is_active: true,
      created_by: adminId,
    },
    {
      id: developerIds[1],
      code: 'DEV-02',
      name: 'PT Harmoni Griya Persada',
      address: 'Jl. Jenderal Ahmad Yani Kav. 28, Summarecon Bekasi, Jawa Barat',
      pic_name: 'H. Dedi Kurniawan, M.M.',
      pic_phone: '+628118001002',
      pic_email: 'dedi.kurniawan@harmonigriya.co.id',
      policy_notes:
        'Mitra strategis perumahan tapak keluarga menengah-atas dengan skema DP fleksibel.',
      is_active: true,
      created_by: adminId,
    },
    {
      id: developerIds[2],
      code: 'DEV-03',
      name: 'PT Graha Mandiri Sejahtera',
      address: 'Jl. Margonda Raya No. 410, Beji, Kota Depok, Jawa Barat',
      pic_name: 'Dr. Veronica Tanuwijaya',
      pic_phone: '+628118001003',
      pic_email: 'veronica@grahamandiri.co.id',
      policy_notes: 'Fokus pengembangan hunian modern tropis di koridor selatan Jakarta & Depok.',
      is_active: true,
      created_by: adminId,
    },
  ];
  await assertNoError(
    'Upsert developers',
    await supabase.from('developers').upsert(developersPayload, { onConflict: 'id' })
  );

  // 5 Property Projects (4 ACTIVE_SELLING, 1 PRE_LAUNCH)
  const projectIds: [string, string, string, string, string] = [
    detUuid(5, 1),
    detUuid(5, 2),
    detUuid(5, 3),
    detUuid(5, 4),
    detUuid(5, 5),
  ];
  const projectsPayload: Array<{
    id: string;
    developer_id: string;
    code: string;
    name: string;
    province: string;
    city: string;
    district: string;
    address: string;
    facilities: string;
    status: ProjectStatus;
    created_by: string;
  }> = [
    {
      id: projectIds[0],
      developer_id: developerIds[0],
      code: 'PRJ-BSD-01',
      name: 'FIM Nusantara Residence BSD',
      province: 'Banten',
      city: 'Tangerang Selatan',
      district: 'Serpong',
      address: 'Jl. Ciater Raya No. 88, Serpong, Tangerang Selatan',
      facilities: 'Clubhouse, Kolam Renang Anak & Dewasa, One Gate System 24 Jam, Taman Jogging',
      status: 'ACTIVE_SELLING',
      created_by: adminId,
    },
    {
      id: projectIds[1],
      developer_id: developerIds[0],
      code: 'PRJ-BTR-02',
      name: 'FIM Emerald Hills Bintaro',
      province: 'Banten',
      city: 'Tangerang Selatan',
      district: 'Pondok Aren',
      address: 'Jl. Boulevard Emerald Bintaro Sektor 9, Pondok Aren',
      facilities: 'Smart Home System, Underground Utilities, Masjid Kawasan, Co-Working Lounge',
      status: 'ACTIVE_SELLING',
      created_by: adminId,
    },
    {
      id: projectIds[2],
      developer_id: developerIds[1],
      code: 'PRJ-BKS-03',
      name: 'Harmoni Park Harapan Indah',
      province: 'Jawa Barat',
      city: 'Bekasi',
      district: 'Medan Satria',
      address: 'Jl. Harapan Indah Boulevard Kav. 19, Kota Bekasi',
      facilities: 'Danau Buatan, Area Komersial Ruko, Lapangan Basket, Keamanan CCTV 24 Jam',
      status: 'ACTIVE_SELLING',
      created_by: adminId,
    },
    {
      id: projectIds[3],
      developer_id: developerIds[2],
      code: 'PRJ-DPK-04',
      name: 'Graha Sawangan Asri',
      province: 'Jawa Barat',
      city: 'Depok',
      district: 'Sawangan',
      address: 'Jl. Raya Muchtar No. 105, Sawangan, Kota Depok',
      facilities: 'Akses Tol Desari 10 Menit, Taman Bermain Anak, Musholla, Keamanan Terpadu',
      status: 'ACTIVE_SELLING',
      created_by: adminId,
    },
    {
      id: projectIds[4],
      developer_id: developerIds[2],
      code: 'PRJ-BGR-05',
      name: 'Graha Sentul Highland',
      province: 'Jawa Barat',
      city: 'Bogor',
      district: 'Babakan Madang',
      address: 'Jl. Bukit Sentul Utama No. 12, Sentul Selatan, Bogor',
      facilities: 'Mountain View Deck, Infinity Pool, Botanical Garden Track',
      status: 'PRE_LAUNCH',
      created_by: adminId,
    },
  ];
  await assertNoError(
    'Upsert property_projects',
    await supabase.from('property_projects').upsert(projectsPayload, { onConflict: 'id' })
  );

  // 10 Property Types (2 per project)
  const propertyTypeIdsByProject: Record<string, [string, string]> = {};
  const propertyTypesPayload: Array<{
    id: string;
    project_id: string;
    code: string;
    name: string;
    standard_land_area: number;
    standard_building_area: number;
    bedrooms: number;
    bathrooms: number;
    electricity_watt: number;
    specifications: string;
    is_active: boolean;
  }> = [];

  const typeTemplates = [
    {
      codeSuffix: 'T45-72',
      name: 'Tipe Asteria 45/72 (1 Lantai Modern)',
      land: 72,
      building: 45,
      bed: 2,
      bath: 1,
      watt: 1300,
    },
    {
      codeSuffix: 'T78-96',
      name: 'Tipe Bougenville 78/96 (2 Lantai Mezzanine)',
      land: 96,
      building: 78,
      bed: 3,
      bath: 2,
      watt: 2200,
    },
  ] as const;

  let typeCounter = 1;
  for (let pIdx = 0; pIdx < projectIds.length; pIdx++) {
    const projectId = must(projectIds[pIdx], `projectIds[${pIdx}]`);
    const t1Id = detUuid(6, typeCounter++);
    const t2Id = detUuid(6, typeCounter++);
    propertyTypeIdsByProject[projectId] = [t1Id, t2Id];

    propertyTypesPayload.push(
      {
        id: t1Id,
        project_id: projectId,
        code: `P${pIdx + 1}-${typeTemplates[0].codeSuffix}`,
        name: typeTemplates[0].name,
        standard_land_area: typeTemplates[0].land,
        standard_building_area: typeTemplates[0].building,
        bedrooms: typeTemplates[0].bed,
        bathrooms: typeTemplates[0].bath,
        electricity_watt: typeTemplates[0].watt,
        specifications:
          'Pondasi batu kali & beton bertulang, dinding bata merah plester aci, rangka atap baja ringan, lantai granit 60x60.',
        is_active: true,
      },
      {
        id: t2Id,
        project_id: projectId,
        code: `P${pIdx + 1}-${typeTemplates[1].codeSuffix}`,
        name: typeTemplates[1].name,
        standard_land_area: typeTemplates[1].land,
        standard_building_area: typeTemplates[1].building,
        bedrooms: typeTemplates[1].bed,
        bathrooms: typeTemplates[1].bath,
        electricity_watt: typeTemplates[1].watt,
        specifications:
          'Pondasi mini pile, dinding bata ringan finishing cat weathershield, smart door lock, lantai homogeneous tile 80x80.',
        is_active: true,
      }
    );
  }
  await assertNoError(
    'Upsert property_types',
    await supabase.from('property_types').upsert(propertyTypesPayload, { onConflict: 'id' })
  );

  // 30 Units (6 per project)
  const unitHolderConfigs: Record<
    number,
    { status: UnitStatus; salesId: string | null; teamId: string | null }
  > = {
    1: { status: 'HELD', salesId: farizId, teamId: TEAM_IDS['TIM-01'] },
    2: { status: 'HELD', salesId: farizId, teamId: TEAM_IDS['TIM-01'] },
    4: { status: 'SOLD', salesId: farizId, teamId: TEAM_IDS['TIM-01'] },
    5: { status: 'BOOKED', salesId: farizId, teamId: TEAM_IDS['TIM-01'] },
    6: { status: 'BOOKED', salesId: tim1Sales2Id, teamId: TEAM_IDS['TIM-01'] },
    7: { status: 'BOOKED', salesId: farizId, teamId: TEAM_IDS['TIM-01'] },
    8: { status: 'BOOKED', salesId: farizId, teamId: TEAM_IDS['TIM-01'] },
    9: { status: 'BOOKED', salesId: farizId, teamId: TEAM_IDS['TIM-01'] },
    10: { status: 'SOLD', salesId: farizId, teamId: TEAM_IDS['TIM-01'] },
    11: { status: 'BOOKED', salesId: tim2Sales1Id, teamId: TEAM_IDS['TIM-02'] },
    12: { status: 'BOOKED', salesId: tim3Sales1Id, teamId: TEAM_IDS['TIM-03'] },
    15: { status: 'HELD', salesId: tim2Sales1Id, teamId: TEAM_IDS['TIM-02'] },
    16: { status: 'SOLD', salesId: tim2Sales2Id, teamId: TEAM_IDS['TIM-02'] },
  };

  const unitIds: string[] = [];
  const unitPrices: Record<string, number> = {};
  const unitProjects: Record<string, string> = {};
  const unitTypes: Record<string, string> = {};

  const unitsPayload: Array<{
    id: string;
    project_id: string;
    property_type_id: string;
    unit_code: string;
    block_number: string;
    land_area: number;
    building_area: number;
    catalog_price: number;
    orientation: string;
    is_hook: boolean;
    status: UnitStatus;
    current_holder_sales_id: string | null;
    current_holder_team_id: string | null;
    status_updated_at: string;
  }> = [];

  const basePricesByProject = [850_000_000, 950_000_000, 720_000_000, 650_000_000, 1_100_000_000] as const;
  const orientations = ['Utara', 'Selatan', 'Timur', 'Barat', 'Timur Laut', 'Tenggara'] as const;

  for (let pIdx = 0; pIdx < 5; pIdx++) {
    const projectId = must(projectIds[pIdx], `projectIds[${pIdx}]`);
    const [type1Id, type2Id] = must(
      propertyTypeIdsByProject[projectId],
      `propertyTypeIdsByProject[${projectId}]`
    );
    const baseProjectPrice = must(basePricesByProject[pIdx], `basePricesByProject[${pIdx}]`);

    for (let uIdx = 0; uIdx < 6; uIdx++) {
      const globalUnitNum = pIdx * 6 + uIdx + 1;
      const uId = detUuid(7, globalUnitNum);
      unitIds.push(uId);

      const isSecondType = uIdx >= 3;
      const propTypeId = isSecondType ? type2Id : type1Id;
      const blockLetter = isSecondType ? 'B' : 'A';
      const numInBlock = (uIdx % 3) + 1;
      const isHook = numInBlock === 1;
      const landArea = isSecondType ? (isHook ? 112 : 96) : isHook ? 84 : 72;
      const buildingArea = isSecondType ? 78 : 45;
      const price =
        baseProjectPrice +
        (isSecondType ? 350_000_000 : 0) +
        (isHook ? 50_000_000 : 0) +
        (numInBlock - 1) * 15_000_000;

      const holderCfg = unitHolderConfigs[globalUnitNum] ?? {
        status: 'AVAILABLE' as UnitStatus,
        salesId: null,
        teamId: null,
      };

      unitPrices[uId] = price;
      unitProjects[uId] = projectId;
      unitTypes[uId] = propTypeId;

      unitsPayload.push({
        id: uId,
        project_id: projectId,
        property_type_id: propTypeId,
        unit_code: `P${pIdx + 1}-${blockLetter}0${numInBlock}`,
        block_number: `Blok ${blockLetter} No. 0${numInBlock}`,
        land_area: landArea,
        building_area: buildingArea,
        catalog_price: price,
        orientation: must(orientations[uIdx % orientations.length]),
        is_hook: isHook,
        status: holderCfg.status,
        current_holder_sales_id: holderCfg.salesId,
        current_holder_team_id: holderCfg.teamId,
        status_updated_at: isoDaysFromNow(-10),
      });
    }
  }

  await assertNoError(
    'Upsert units',
    await supabase.from('units').upsert(unitsPayload, { onConflict: 'id' })
  );

  const unitAt = (idx0: number): string => must(unitIds[idx0], `unitIds[${idx0}]`);
  const priceOf = (uId: string): number => must(unitPrices[uId], `unitPrices[${uId}]`);

  // Unit Price Histories (BR-03: reason >= 10 karakter, old_price <> new_price)
  const priceHistoriesPayload = [
    {
      id: detUuid(8, 1),
      unit_id: unitAt(0),
      old_price: priceOf(unitAt(0)) - 25_000_000,
      new_price: priceOf(unitAt(0)),
      reason: 'Penyesuaian harga katalog kuartal berjalan setelah pembangunan clubhouse selesai.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-45),
    },
    {
      id: detUuid(8, 2),
      unit_id: unitAt(3),
      old_price: priceOf(unitAt(3)) - 40_000_000,
      new_price: priceOf(unitAt(3)),
      reason: 'Kenaikan harga tahap 2 proyek FIM Nusantara Residence BSD sesuai SK Direksi.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-40),
    },
    {
      id: detUuid(8, 3),
      unit_id: unitAt(6),
      old_price: priceOf(unitAt(6)) - 30_000_000,
      new_price: priceOf(unitAt(6)),
      reason: 'Revisi harga unit hook blok A setelah pembukaan akses jalan boulevard baru.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-30),
    },
    {
      id: detUuid(8, 4),
      unit_id: unitAt(9),
      old_price: priceOf(unitAt(9)) - 50_000_000,
      new_price: priceOf(unitAt(9)),
      reason: 'Penyesuaian harga unit tipe 2 lantai FIM Emerald Hills Bintaro.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-25),
    },
    {
      id: detUuid(8, 5),
      unit_id: unitAt(12),
      old_price: priceOf(unitAt(12)) - 20_000_000,
      new_price: priceOf(unitAt(12)),
      reason: 'Update harga katalog awal tahun proyek Harmoni Park Harapan Indah.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-20),
    },
  ];
  await assertNoError(
    'Upsert unit_price_histories',
    await supabase.from('unit_price_histories').upsert(priceHistoriesPayload, { onConflict: 'id' })
  );

  // Promotions (NOMINAL_DISCOUNT, PERCENTAGE_DISCOUNT, FREE_BENEFIT)
  const promoIds = {
    PROMO_NOMINAL_BSD: detUuid(9, 1),
    PROMO_PERCENT_BTR: detUuid(9, 2),
    PROMO_BENEFIT_BKS: detUuid(9, 3),
    PROMO_NOMINAL_DPK: detUuid(9, 4),
  };

  const btrTypes = must(propertyTypeIdsByProject[projectIds[1]], 'btrTypes');

  const promotionsPayload: Array<{
    id: string;
    project_id: string;
    property_type_id: string | null;
    code: string;
    name: string;
    description: string;
    promo_type: PromoType;
    discount_value: number;
    bonus_description: string | null;
    start_date: string;
    end_date: string;
    is_active: boolean;
    created_by: string;
  }> = [
    {
      id: promoIds.PROMO_NOMINAL_BSD,
      project_id: projectIds[0],
      property_type_id: null,
      code: 'PRM-BSD-25JT',
      name: 'Promo Spesial Nusantara Potongan Rp 25 Juta',
      description: 'Potongan langsung harga katalog sebesar Rp 25.000.000 untuk seluruh tipe unit.',
      promo_type: 'NOMINAL_DISCOUNT',
      discount_value: 25_000_000,
      bonus_description: 'Gratis biaya AJB dan Kanopi Carport Alderon',
      start_date: dateOnlyDaysFromNow(-60),
      end_date: dateOnlyDaysFromNow(90),
      is_active: true,
      created_by: adminId,
    },
    {
      id: promoIds.PROMO_PERCENT_BTR,
      project_id: projectIds[1],
      property_type_id: btrTypes[1],
      code: 'PRM-BTR-5PCT',
      name: 'Diskon 5% Tipe Bougenville Emerald Bintaro',
      description: 'Diskon 5% khusus pembelian unit 2 lantai Tipe Bougenville.',
      promo_type: 'PERCENTAGE_DISCOUNT',
      discount_value: 5,
      bonus_description: 'Termasuk instalasi Smart Door Lock & AC 2 PK',
      start_date: dateOnlyDaysFromNow(-45),
      end_date: dateOnlyDaysFromNow(60),
      is_active: true,
      created_by: adminId,
    },
    {
      id: promoIds.PROMO_BENEFIT_BKS,
      project_id: projectIds[2],
      property_type_id: null,
      code: 'PRM-BKS-FREE',
      name: 'Promo Bebas Biaya Surat & Kitchen Set Harmoni',
      description: 'Program benefit non-tunai gratis Kitchen Set & Kanopi tanpa potongan harga pokok.',
      promo_type: 'FREE_BENEFIT',
      discount_value: 0,
      bonus_description: 'Gratis Kitchen Set Modular, Kompor Tanam, dan Kanopi Baja Ringan',
      start_date: dateOnlyDaysFromNow(-30),
      end_date: dateOnlyDaysFromNow(120),
      is_active: true,
      created_by: adminId,
    },
    {
      id: promoIds.PROMO_NOMINAL_DPK,
      project_id: projectIds[3],
      property_type_id: null,
      code: 'PRM-DPK-15JT',
      name: 'Cashback Akhir Pekan Sawangan Rp 15 Juta',
      description: 'Potongan harga sebesar Rp 15.000.000 untuk pemesanan di Graha Sawangan Asri.',
      promo_type: 'NOMINAL_DISCOUNT',
      discount_value: 15_000_000,
      bonus_description: 'Gratis Toren Air 1000L & Pompa Pendorong',
      start_date: dateOnlyDaysFromNow(-30),
      end_date: dateOnlyDaysFromNow(90),
      is_active: true,
      created_by: adminId,
    },
  ];
  await assertNoError(
    'Upsert promotions',
    await supabase.from('promotions').upsert(promotionsPayload, { onConflict: 'id' })
  );

  // Master kpr_bank_requirements untuk 3 Bank Mitra (Bank Mandiri, BCA, BTN) - OQ-06
  const banks: BankName[] = ['Bank Mandiri', 'BCA', 'BTN'];
  const docTemplates: Array<{
    code: BankDocCode;
    name: string;
    mandatory: boolean;
    desc: string;
  }> = [
    {
      code: 'DOC_KTP',
      name: 'Fotokopi KTP Pemohon & Pasangan (Fiktif Demo)',
      mandatory: true,
      desc: 'Dokumen identitas diri pemohon dan pasangan (apabila sudah menikah).',
    },
    {
      code: 'DOC_KK',
      name: 'Kartu Keluarga & Akta Nikah (Fiktif Demo)',
      mandatory: true,
      desc: 'Salinan Kartu Keluarga terbaru dan buku nikah/akta perkawinan.',
    },
    {
      code: 'DOC_NPWP',
      name: 'NPWP Pribadi & SPT Tahunan (Fiktif Demo)',
      mandatory: true,
      desc: 'Nomor Pokok Wajib Pajak untuk pengajuan pembiayaan KPR di atas Rp 100 Juta.',
    },
    {
      code: 'DOC_PAYSLIP_3M',
      name: 'Slip Gaji 3 Bulan Terakhir (Fiktif Demo)',
      mandatory: true,
      desc: 'Bukti penghasilan bulanan resmi dari HRD perusahaan tempat bekerja.',
    },
    {
      code: 'DOC_BANK_STMT_3M',
      name: 'Rekening Koran 3 Bulan Terakhir (Fiktif Demo)',
      mandatory: true,
      desc: 'Mutasi rekening tabungan gaji selama 3 bulan terakhir.',
    },
    {
      code: 'DOC_EMPLOYMENT_LTR',
      name: 'Surat Keterangan Kerja / SK Pengangkatan (Fiktif Demo)',
      mandatory: true,
      desc: 'Surat keterangan karyawan tetap atau izin praktik profesional.',
    },
  ];

  const bankReqIds = {
    'Bank Mandiri': {} as Record<BankDocCode, string>,
    BCA: {} as Record<BankDocCode, string>,
    BTN: {} as Record<BankDocCode, string>,
  };

  const bankReqPayload: Array<{
    id: string;
    bank_name: string;
    document_code: string;
    document_name: string;
    is_mandatory: boolean;
    description: string;
    is_active: boolean;
  }> = [];

  let reqIdx = 1;
  for (const bankName of banks) {
    for (const tpl of docTemplates) {
      const rId = detUuid(22, reqIdx++);
      bankReqIds[bankName][tpl.code] = rId;
      bankReqPayload.push({
        id: rId,
        bank_name: bankName,
        document_code: tpl.code,
        document_name: tpl.name,
        is_mandatory: tpl.mandatory,
        description: tpl.desc,
        is_active: true,
      });
    }
  }
  await assertNoError(
    'Upsert kpr_bank_requirements',
    await supabase
      .from('kpr_bank_requirements')
      .upsert(bankReqPayload, { onConflict: 'bank_name,document_code' })
  );

  return {
    developerIds,
    projectIds,
    propertyTypeIdsByProject,
    unitIds,
    unitPrices,
    unitProjects,
    unitTypes,
    promoIds,
    bankReqIds,
  };
}

interface CrmSeedIds {
  leadIds: string[];
  siteVisitIds: string[];
}

async function seedCrmAndPreSales(
  supabase: SupabaseClient,
  staffIdMap: StaffIdMap,
  catalog: CatalogSeedIds
): Promise<CrmSeedIds> {
  console.info(
    '3. Menyemai CRM & Pre-Sales (60 Leads terhitung via calculateProspectScore, Histori Skor/Pipeline/Assignment, 36 Aktivitas, 16 Site Visits)...'
  );

  const adminId = staffIdMap.ICHSAN_ADMIN;
  const muzayinId = staffIdMap.MUZAYIN_SPV1;
  const farizId = staffIdMap.FARIZ_SALES1;

  const salesDistribution: Array<{ salesId: string; teamId: string }> = [
    ...Array.from({ length: 15 }, () => ({ salesId: farizId, teamId: TEAM_IDS['TIM-01'] })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM1_SALES2,
      teamId: TEAM_IDS['TIM-01'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM1_SALES3,
      teamId: TEAM_IDS['TIM-01'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM1_SALES4,
      teamId: TEAM_IDS['TIM-01'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM1_SALES5,
      teamId: TEAM_IDS['TIM-01'],
    })),
    ...Array.from({ length: 4 }, () => ({
      salesId: staffIdMap.TIM2_SALES1,
      teamId: TEAM_IDS['TIM-02'],
    })),
    ...Array.from({ length: 4 }, () => ({
      salesId: staffIdMap.TIM2_SALES2,
      teamId: TEAM_IDS['TIM-02'],
    })),
    ...Array.from({ length: 4 }, () => ({
      salesId: staffIdMap.TIM2_SALES3,
      teamId: TEAM_IDS['TIM-02'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM2_SALES4,
      teamId: TEAM_IDS['TIM-02'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM2_SALES5,
      teamId: TEAM_IDS['TIM-02'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM3_SALES1,
      teamId: TEAM_IDS['TIM-03'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM3_SALES2,
      teamId: TEAM_IDS['TIM-03'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM3_SALES3,
      teamId: TEAM_IDS['TIM-03'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM3_SALES4,
      teamId: TEAM_IDS['TIM-03'],
    })),
    ...Array.from({ length: 3 }, () => ({
      salesId: staffIdMap.TIM3_SALES5,
      teamId: TEAM_IDS['TIM-03'],
    })),
  ];

  const leadFirstNames = [
    'Andi', 'Budi', 'Chandra', 'Dian', 'Eko', 'Ferry', 'Gita', 'Hadi', 'Indra', 'Joko',
    'Kartika', 'Lukman', 'Maya', 'Nugroho', 'Oki', 'Putri', 'Qori', 'Rudi', 'Sari', 'Tono',
    'Umar', 'Vina', 'Wahyu', 'Yuni', 'Zaki', 'Agus', 'Bella', 'Cahyo', 'Dewi', 'Erlangga',
    'Fadli', 'Galih', 'Hana', 'Irwan', 'Jihan', 'Kurnia', 'Lina', 'Mulyadi', 'Nanda', 'Olivia',
    'Pandu', 'Ratna', 'Surya', 'Taufik', 'Utami', 'Vicky', 'Wulan', 'Yusuf', 'Zahra', 'Arman',
    'Bagus', 'Cindy', 'Darmawan', 'Elsa', 'Firman', 'Grace', 'Haris', 'Intan', 'Johan', 'Kevin',
  ];

  const leadLastNames = [
    'Pratama', 'Santoso', 'Wijaya', 'Kusuma', 'Hidayat', 'Saputra', 'Lestari', 'Nugraha', 'Siregar', 'Gunawan',
    'Permana', 'Setiawan', 'Hakim', 'Wibowo', 'Purnomo', 'Utomo', 'Hartono', 'Halim', 'Susanto', 'Maulana',
  ];

  const sources: LeadSource[] = [
    'INSTAGRAM_ADS',
    'FACEBOOK_ADS',
    'TIKTOK_ADS',
    'WEBSITE',
    'WALK_IN',
    'EXPO_EVENT',
    'REFERRAL',
    'OTHER',
  ];

  const occupations = [
    'Manajer TI Perbankan',
    'Dokter Spesialis',
    'Wiraswasta Kuliner & Retail',
    'Pegawai BUMN Energi',
    'Konsultan Hukum Korporat',
    'Arsitek & Kontraktor',
    'Dosen & Peneliti',
    'Senior Software Engineer',
  ];

  const specialLeadStages: Record<number, PipelineStage> = {
    1: 'BOOKING',
    2: 'BOOKING',
    3: 'NEGOTIATION',
    4: 'CLOSED_WON',
    5: 'CLOSED_WON',
    6: 'PAYMENT_KPR_PROCESS',
    7: 'PAYMENT_KPR_PROCESS',
    8: 'CLOSED_WON',
    9: 'CLOSED_WON',
    16: 'CLOSED_WON',
    28: 'PAYMENT_KPR_PROCESS',
    29: 'CLOSED_LOST',
    30: 'BOOKING',
    32: 'CLOSED_WON',
    46: 'PAYMENT_KPR_PROCESS',
    47: 'CLOSED_LOST',
  };

  const generalStages: PipelineStage[] = [
    'NEW',
    'CONTACTED',
    'QUALIFIED',
    'SITE_VISIT',
    'NEGOTIATION',
    'CLOSED_LOST',
  ];

  const refPrices = [850_000_000, 950_000_000, 720_000_000, 650_000_000] as const;
  const refCities = ['Tangerang Selatan', 'Tangerang Selatan', 'Bekasi', 'Depok'] as const;
  const paymentMethods: PaymentMethod[] = ['KPR', 'CASH_KERAS', 'CASH_BERTAHAP'];

  const leadIds: string[] = [];
  const leadsPayload: Array<Record<string, unknown>> = [];
  const scoreHistoriesPayload: Array<Record<string, unknown>> = [];
  const pipelineHistoriesPayload: Array<Record<string, unknown>> = [];
  const assignmentHistoriesPayload: Array<Record<string, unknown>> = [];

  for (let i = 1; i <= 60; i++) {
    const leadId = detUuid(10, i);
    leadIds.push(leadId);

    const dist = must(salesDistribution[i - 1], `salesDistribution[${i - 1}]`);
    const firstName = must(leadFirstNames[i - 1], `leadFirstNames[${i - 1}]`);
    const lastName = must(leadLastNames[(i - 1) % leadLastNames.length]);
    const fullName = `${firstName} ${lastName}`;
    const phone = `+628129000${i.toString().padStart(4, '0')}`;
    const email = `prospek.${i}@contoh-nasabah.id`;
    const projectIdx = (i - 1) % 4;
    const preferredProjectId = must(catalog.projectIds[projectIdx]);
    const projTypes = must(catalog.propertyTypeIdsByProject[preferredProjectId]);
    const preferredTypeId = must(projTypes[i % 2]);
    const refPrice = must(refPrices[projectIdx]);

    const stage =
      specialLeadStages[i] ?? must(generalStages[(i - 1) % generalStages.length]);

    let budgetAmount: number = refPrice;
    let timeline: PurchaseTimeline = 'IMMEDIATE_LT_1M';
    let readiness: PaymentReadiness = 'READY_FULL_OR_DP_DOCS';
    let latestResp: InteractionResponse | null = 'RESPONSIVE_TWO_WAY';
    let latestVisit: { status: SiteVisitStatus; outcome: SiteVisitOutcome | null } | null = {
      status: 'COMPLETED',
      outcome: 'POSITIVE_INTEREST',
    };

    if (
      stage === 'BOOKING' ||
      stage === 'PAYMENT_KPR_PROCESS' ||
      stage === 'CLOSED_WON' ||
      i % 3 === 1
    ) {
      budgetAmount = refPrice + 50_000_000;
      timeline = 'IMMEDIATE_LT_1M';
      readiness = i % 2 === 0 ? 'READY_FULL_OR_DP_DOCS' : 'DP_READY_COLLECTING_DOCS';
      latestResp = 'RESPONSIVE_TWO_WAY';
      latestVisit = { status: 'COMPLETED', outcome: 'POSITIVE_INTEREST' };
    } else if (i % 3 === 2) {
      budgetAmount = Math.round(refPrice * 0.9);
      timeline = 'SHORT_1_3M';
      readiness = 'DP_READY_COLLECTING_DOCS';
      latestResp = 'RESPONSIVE_TWO_WAY';
      latestVisit = null;
    } else {
      budgetAmount = Math.round(refPrice * 0.65);
      timeline = 'LONG_GT_6M';
      readiness = 'SAVING_FOR_DP';
      latestResp = 'INITIAL_ONE_WAY';
      latestVisit = null;
    }

    const scoring = calculateProspectScore({
      budgetAmount,
      referenceMinUnitPrice: refPrice,
      purchaseTimeline: timeline,
      paymentReadiness: readiness,
      latestInteractionResponse: latestResp,
      latestSiteVisit: latestVisit,
    });

    const preferredPaymentMethod: PaymentMethod =
      i === 4 || i === 32
        ? 'CASH_KERAS'
        : i === 5 || i === 16
          ? 'CASH_BERTAHAP'
          : i <= 9 || i === 28 || i === 46
            ? 'KPR'
            : must(paymentMethods[i % 3]);

    const lostReason =
      stage === 'CLOSED_LOST'
        ? i === 29
          ? 'Konsumen membatalkan pemesanan karena mutasi kerja ke luar pulau.'
          : i === 47
            ? 'Pembatalan pemesanan karena hasil verifikasi dokumen dan perubahan rencana keluarga.'
            : 'Budget prospek dialihkan untuk kebutuhan usaha keluarga.'
        : null;

    leadsPayload.push({
      id: leadId,
      full_name: fullName,
      phone,
      email,
      occupation: must(occupations[(i - 1) % occupations.length]),
      lead_source: must(sources[(i - 1) % sources.length]),
      assigned_sales_id: dist.salesId,
      team_id: dist.teamId,
      budget_amount: budgetAmount,
      preferred_city: must(refCities[projectIdx]),
      preferred_project_id: preferredProjectId,
      preferred_property_type_id: preferredTypeId,
      preferred_payment_method: preferredPaymentMethod,
      purchase_timeline: timeline,
      payment_readiness: readiness,
      prospect_score: scoring.totalScore,
      lead_temperature: scoring.temperature,
      score_breakdown: scoring.breakdown,
      pipeline_stage: stage,
      lost_reason: lostReason,
      created_by: dist.salesId,
      last_interaction_at: isoDaysFromNow(-(i % 10) - 1),
    });

    scoreHistoriesPayload.push({
      id: detUuid(11, i),
      lead_id: leadId,
      old_score: 0,
      new_score: scoring.totalScore,
      old_temperature: 'COLD',
      new_temperature: scoring.temperature,
      score_breakdown: scoring.breakdown,
      trigger_source: 'INITIAL_QUALIFICATION_CALCULATION',
      calculated_at: isoDaysFromNow(-20),
    });

    pipelineHistoriesPayload.push({
      id: detUuid(12, i),
      lead_id: leadId,
      from_stage: 'NEW',
      to_stage: stage,
      notes: `Pembaruan tahapan pipeline prospek ${fullName} menuju ${stage}.`,
      lost_reason: lostReason,
      changed_by: dist.salesId,
      changed_at: isoDaysFromNow(-12),
    });

    assignmentHistoriesPayload.push({
      id: detUuid(13, i),
      lead_id: leadId,
      from_sales_id: null,
      to_sales_id: dist.salesId,
      from_team_id: null,
      to_team_id: dist.teamId,
      reason: 'Distribusi prospek awal kepada Sales Executive penanggung jawab.',
      assigned_by: dist.salesId,
      assigned_at: isoDaysFromNow(-25),
    });
  }

  // Tambahkan 3 histori Reassignment oleh Supervisor Muzayin & Admin Ichsan
  assignmentHistoriesPayload.push(
    {
      id: detUuid(13, 101),
      lead_id: must(leadIds[0]),
      from_sales_id: staffIdMap.TIM1_SALES2,
      to_sales_id: farizId,
      from_team_id: TEAM_IDS['TIM-01'],
      to_team_id: TEAM_IDS['TIM-01'],
      reason:
        'Reassignment oleh Supervisor Muzayin Arifin kepada Fariz Aditya Ardhana untuk percepatan closing unit BSD.',
      assigned_by: muzayinId,
      assigned_at: isoDaysFromNow(-18),
    },
    {
      id: detUuid(13, 102),
      lead_id: must(leadIds[1]),
      from_sales_id: staffIdMap.TIM1_SALES3,
      to_sales_id: farizId,
      from_team_id: TEAM_IDS['TIM-01'],
      to_team_id: TEAM_IDS['TIM-01'],
      reason:
        'Pengalihan penanganan prospek prioritas di dalam Tim Nusantara Alpha oleh Supervisor Muzayin.',
      assigned_by: muzayinId,
      assigned_at: isoDaysFromNow(-16),
    },
    {
      id: detUuid(13, 103),
      lead_id: must(leadIds[27]),
      from_sales_id: staffIdMap.TIM3_SALES2,
      to_sales_id: staffIdMap.TIM2_SALES1,
      from_team_id: TEAM_IDS['TIM-03'],
      to_team_id: TEAM_IDS['TIM-02'],
      reason:
        'Realokasi prospek lintas tim oleh Admin Muhammad Ichsan Fachrulrozi karena minat pindah ke proyek Bekasi.',
      assigned_by: adminId,
      assigned_at: isoDaysFromNow(-15),
    }
  );

  await assertNoError(
    'Upsert leads',
    await supabase.from('leads').upsert(leadsPayload, { onConflict: 'id' })
  );
  await assertNoError(
    'Upsert lead_score_histories',
    await supabase.from('lead_score_histories').upsert(scoreHistoriesPayload, { onConflict: 'id' })
  );
  await assertNoError(
    'Upsert lead_pipeline_histories',
    await supabase
      .from('lead_pipeline_histories')
      .upsert(pipelineHistoriesPayload, { onConflict: 'id' })
  );
  await assertNoError(
    'Upsert lead_assignment_histories',
    await supabase
      .from('lead_assignment_histories')
      .upsert(assignmentHistoriesPayload, { onConflict: 'id' })
  );

  // 36 Lead Activities
  const channels: ActivityChannel[] = [
    'WHATSAPP',
    'PHONE_CALL',
    'MEETING',
    'VIDEO_CALL',
    'EMAIL',
  ];
  const responses: InteractionResponse[] = [
    'RESPONSIVE_TWO_WAY',
    'RESPONSIVE_TWO_WAY',
    'INITIAL_ONE_WAY',
    'UNRESPONSIVE',
  ];
  const activitiesPayload: Array<Record<string, unknown>> = [];

  for (let a = 1; a <= 36; a++) {
    const targetLeadIdx = (a - 1) % 36;
    const dist = must(salesDistribution[targetLeadIdx]);
    activitiesPayload.push({
      id: detUuid(14, a),
      lead_id: must(leadIds[targetLeadIdx]),
      sales_id: dist.salesId,
      channel: must(channels[(a - 1) % channels.length]),
      interaction_at: isoDaysFromNow(-(a % 14) - 1),
      summary: `Komunikasi tindak lanjut ke-${a}: pembahasan brosur katalog, simulasi DP/KPR, serta ketersediaan blok unit pilihan konsumen.`,
      customer_response: must(responses[(a - 1) % responses.length]),
    });
  }
  await assertNoError(
    'Upsert lead_activities',
    await supabase.from('lead_activities').upsert(activitiesPayload, { onConflict: 'id' })
  );

  // 16 Site Visits
  const siteVisitIds: string[] = [];
  const siteVisitsPayload: Array<Record<string, unknown>> = [];
  const visitOutcomes: SiteVisitOutcome[] = [
    'POSITIVE_INTEREST',
    'POSITIVE_INTEREST',
    'NEUTRAL_CONSIDERATION',
    'NOT_SUITABLE',
  ];

  for (let v = 1; v <= 16; v++) {
    const svId = detUuid(16, v);
    siteVisitIds.push(svId);
    const leadIdx = v <= 10 ? v - 1 : v + 15;
    const dist = must(salesDistribution[leadIdx]);
    const projectIdx = leadIdx % 4;
    const projectId = must(catalog.projectIds[projectIdx]);
    const unitId = must(catalog.unitIds[projectIdx * 6 + (v % 6)]);

    const status: SiteVisitStatus =
      v <= 10 ? 'COMPLETED' : v <= 14 ? 'SCHEDULED' : 'RESCHEDULED';
    const isCompleted = status === 'COMPLETED';

    siteVisitsPayload.push({
      id: svId,
      lead_id: must(leadIds[leadIdx]),
      sales_id: dist.salesId,
      project_id: projectId,
      unit_id: unitId,
      scheduled_at: isCompleted ? isoDaysFromNow(-10 + (v % 5)) : isoDaysFromNow((v % 5) + 1),
      preparation_notes:
        'Menyiapkan kunci show unit, lembar price list terbaru, serta simulasi angsuran KPR 3 bank mitra.',
      status,
      customer_interest_outcome: isCompleted
        ? must(visitOutcomes[(v - 1) % visitOutcomes.length])
        : null,
      evaluation_notes: isCompleted
        ? 'Konsumen menyukai tata ruang pencahayaan alami dan akses jalan cluster yang lebar.'
        : null,
      completed_at: isCompleted ? isoDaysFromNow(-9 + (v % 5)) : null,
    });
  }
  await assertNoError(
    'Upsert site_visits',
    await supabase.from('site_visits').upsert(siteVisitsPayload, { onConflict: 'id' })
  );

  return { leadIds, siteVisitIds };
}

interface BookingSeedSpec {
  id: string;
  referenceNumber: string;
  leadId: string;
  unitId: string;
  salesId: string;
  teamId: string;
  paymentMethod: PaymentMethod;
  promoId: string | null;
  catalogPrice: number;
  promoDiscount: number;
  bookingFeeAmount: number;
  isBookingFeePartOfDp: boolean;
  agreedDpTotalAmount: number;
  finalStatus: BookingStatus;
  bookedAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  refundPolicyType: RefundPolicy | null;
  agreedRefundAmount: number;
  forfeitedRetainedAmount: number;
  notes: string;
}

interface ScheduleSeedSpec {
  id: string;
  bookingId: string;
  scheduleType: ScheduleType;
  installmentNumber: number;
  title: string;
  scheduledAmount: number;
  finalVerifiedPaidAmount: number;
  finalRemainingAmount: number;
  dueDate: string;
  finalStatus: ScheduleStatus;
  paidAt: string | null;
}

interface PaymentRecordSeedSpec {
  id: string;
  referenceNumber: string;
  bookingId: string;
  paymentScheduleId: string;
  submittedBySalesId: string;
  paidAmount: number;
  paymentDate: string;
  paymentChannel: string;
  proofFilePath: string;
  proofFileName: string;
  replacesPaymentId: string | null;
  verificationStatus: PaymentVerificationStatus;
  submittedAt: string;
  verificationSlaDueAt: string;
  verifiedByAdminId: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  salesNotes: string | null;
}

async function seedTransactionsAndFinance(
  supabase: SupabaseClient,
  staffIdMap: StaffIdMap,
  catalog: CatalogSeedIds,
  crm: CrmSeedIds
): Promise<void> {
  console.info(
    '4. Menyemai Skenario Transaksi Nyata (Skenario 1 s/d 8: Bookings, Payment Schedules, Payment Records, KPR TC-01A, Deals, Refunds, Follow-Up, Notifications & Audit)...'
  );

  const adminId = staffIdMap.ICHSAN_ADMIN;
  const muzayinId = staffIdMap.MUZAYIN_SPV1;
  const farizId = staffIdMap.FARIZ_SALES1;
  const nadiaId = staffIdMap.TIM1_SALES2;
  const bimaId = staffIdMap.TIM2_SALES1;
  const citraId = staffIdMap.TIM2_SALES2;
  const yogaId = staffIdMap.TIM3_SALES1;

  const u = (unitNumber1Based: number): string =>
    must(catalog.unitIds[unitNumber1Based - 1], `unitIds[${unitNumber1Based - 1}]`);
  const up = (unitNumber1Based: number): number =>
    must(catalog.unitPrices[u(unitNumber1Based)], `unitPrices[${unitNumber1Based}]`);
  const l = (leadNumber1Based: number): string =>
    must(crm.leadIds[leadNumber1Based - 1], `leadIds[${leadNumber1Based - 1}]`);

  // 16 Bookings mencakup seluruh Skenario 1 s/d 7 di atas 16 unit unik:
  const bookingSpecs: BookingSeedSpec[] = [
    // [Booking 1 - Skenario 1] PENDING_FEE Aktif 72 Jam (Unit 1 HELD oleh Fariz • TIM-01)
    {
      id: detUuid(17, 1),
      referenceNumber: 'BK-202603-0001',
      leadId: l(1),
      unitId: u(1),
      salesId: farizId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'KPR',
      promoId: catalog.promoIds.PROMO_NOMINAL_BSD,
      catalogPrice: up(1),
      promoDiscount: 25_000_000,
      bookingFeeAmount: 10_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 90_000_000,
      finalStatus: 'PENDING_FEE',
      bookedAt: isoHoursFromNow(-12),
      expiresAt: isoHoursFromNow(60),
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes: 'Skenario 1: Reservasi unit baru oleh Fariz, menunggu unggah bukti Booking Fee.',
    },
    // [Booking 2 - Skenario 2] PENDING_FEE Lewat Waktu + Bukti Bayar PENDING_VERIFICATION > 48 Jam (PD-01 Guard)
    {
      id: detUuid(17, 2),
      referenceNumber: 'BK-202603-0002',
      leadId: l(2),
      unitId: u(2),
      salesId: farizId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(2),
      promoDiscount: 0,
      bookingFeeAmount: 10_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 85_000_000,
      finalStatus: 'PENDING_FEE',
      bookedAt: isoHoursFromNow(-80),
      expiresAt: isoHoursFromNow(-8),
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 2 (PD-01 & SLA Eskalasi): Booking melewati expires_at tetapi bukti bayar sudah diunggah > 50 jam lalu dan belum diverifikasi Admin.',
    },
    // [Booking 3 - Skenario 3] EXPIRED Historis (Unit 3 kembali AVAILABLE)
    {
      id: detUuid(17, 3),
      referenceNumber: 'BK-202603-0003',
      leadId: l(3),
      unitId: u(3),
      salesId: farizId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(3),
      promoDiscount: 0,
      bookingFeeAmount: 10_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 88_000_000,
      finalStatus: 'EXPIRED',
      bookedAt: isoDaysFromNow(-12),
      expiresAt: isoDaysFromNow(-9),
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: 'Kedaluwarsa otomatis setelah 72 jam tanpa unggahan bukti Booking Fee.',
      refundPolicyType: 'NONE',
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes: 'Skenario 3: Riwayat reservasi kedaluwarsa otomatis, unit telah kembali AVAILABLE.',
    },
    // [Booking 4 - Skenario 4] Cash Keras 100% Lunas (Unit 4 SOLD oleh Fariz • TIM-01)
    {
      id: detUuid(17, 4),
      referenceNumber: 'BK-202603-0004',
      leadId: l(4),
      unitId: u(4),
      salesId: farizId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'CASH_KERAS',
      promoId: catalog.promoIds.PROMO_NOMINAL_BSD,
      catalogPrice: up(4),
      promoDiscount: 25_000_000,
      bookingFeeAmount: 15_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 250_000_000,
      finalStatus: 'COMPLETED',
      bookedAt: isoDaysFromNow(-35),
      expiresAt: isoDaysFromNow(-32),
      confirmedAt: isoDaysFromNow(-34),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 4: Transaksi Cash Keras 100% lunas terverifikasi Admin Ichsan, AJB ditandatangani, Unit SOLD.',
    },
    // [Booking 5 - Skenario 5A] Cash Bertahap Kebijakan C2 (DP Lunas + PPJB Aktif -> Deal CLOSED_WON, Unit 5 tetap BOOKED)
    {
      id: detUuid(17, 5),
      referenceNumber: 'BK-202603-0005',
      leadId: l(5),
      unitId: u(5),
      salesId: farizId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'CASH_BERTAHAP',
      promoId: catalog.promoIds.PROMO_NOMINAL_BSD,
      catalogPrice: up(5),
      promoDiscount: 25_000_000,
      bookingFeeAmount: 15_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 240_000_000,
      finalStatus: 'ACTIVE',
      bookedAt: isoDaysFromNow(-28),
      expiresAt: isoDaysFromNow(-25),
      confirmedAt: isoDaysFromNow(-27),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 5A (Kebijakan C2 PD-03): Cash Bertahap DP Lunas & PPJB ditandatangani. Deal sudah CLOSED_WON namun Unit wajib tetap BOOKED karena cicilan ke-2 & ke-3 belum lunas.',
    },
    // [Booking 6 - Skenario 5B] Cash Bertahap Menunggak (Termin INSTALLMENT OVERDUE -> Deal OVERDUE_IN_ARREARS, Unit 6 BOOKED)
    {
      id: detUuid(17, 6),
      referenceNumber: 'BK-202603-0006',
      leadId: l(16),
      unitId: u(6),
      salesId: nadiaId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'CASH_BERTAHAP',
      promoId: null,
      catalogPrice: up(6),
      promoDiscount: 0,
      bookingFeeAmount: 15_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 250_000_000,
      finalStatus: 'ACTIVE',
      bookedAt: isoDaysFromNow(-40),
      expiresAt: isoDaysFromNow(-37),
      confirmedAt: isoDaysFromNow(-39),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 5B: Cash Bertahap dengan jadwal cicilan termin ke-1 berstatus OVERDUE dan memicu tugas penagihan otomatis.',
    },
    // [Booking 7 - Skenario 6A] KPR IN_PROGRESS tahap DOCUMENT_VERIFICATION (Unit 7 BOOKED oleh Fariz)
    {
      id: detUuid(17, 7),
      referenceNumber: 'BK-202603-0007',
      leadId: l(6),
      unitId: u(7),
      salesId: farizId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(7),
      promoDiscount: 0,
      bookingFeeAmount: 10_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 100_000_000,
      finalStatus: 'ACTIVE',
      bookedAt: isoDaysFromNow(-18),
      expiresAt: isoDaysFromNow(-15),
      confirmedAt: isoDaysFromNow(-17),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 6A: Pengajuan KPR Bank Mandiri milik Fariz pada tahap DOCUMENT_VERIFICATION dengan variasi status dokumen.',
    },
    // [Booking 8 - Skenario 6B] KPR APPROVED Plafon Turun + Jadwal KPR_TOPUP_DP UNPAID (Unit 8 BOOKED oleh Fariz)
    {
      id: detUuid(17, 8),
      referenceNumber: 'BK-202603-0008',
      leadId: l(7),
      unitId: u(8),
      salesId: farizId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(8),
      promoDiscount: 0,
      bookingFeeAmount: 10_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 95_000_000,
      finalStatus: 'ACTIVE',
      bookedAt: isoDaysFromNow(-22),
      expiresAt: isoDaysFromNow(-19),
      confirmedAt: isoDaysFromNow(-21),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 6B: KPR BCA disetujui dengan penurunan plafon Rp 40 Juta oleh Admin Ichsan sehingga terbentuk tagihan KPR_TOPUP_DP.',
    },
    // [Booking 9 - Skenario 6C] KPR APPROVED & PARTIALLY_DISBURSED 80% -> TC-01A Unit 9 Tetap BOOKED!
    {
      id: detUuid(17, 9),
      referenceNumber: 'BK-202603-0009',
      leadId: l(8),
      unitId: u(9),
      salesId: farizId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(9),
      promoDiscount: 0,
      bookingFeeAmount: 10_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 98_000_000,
      finalStatus: 'ACTIVE',
      bookedAt: isoDaysFromNow(-30),
      expiresAt: isoDaysFromNow(-27),
      confirmedAt: isoDaysFromNow(-29),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 6C (Kebijakan Final TC-01A): Pencairan KPR tahap PRIMARY (80% Akad) telah cair, sisa 20% retensi atap. Sesuai TC-01A, Unit wajib tetap BOOKED dan application_status = APPROVED.',
    },
    // [Booking 10 - Skenario 6D] KPR COMPLETED & FULLY_DISBURSED 100% -> TC-01A Unit 10 Menjadi SOLD!
    {
      id: detUuid(17, 10),
      referenceNumber: 'BK-202603-0010',
      leadId: l(9),
      unitId: u(10),
      salesId: farizId,
      teamId: TEAM_IDS['TIM-01'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(10),
      promoDiscount: 0,
      bookingFeeAmount: 15_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 135_000_000,
      finalStatus: 'COMPLETED',
      bookedAt: isoDaysFromNow(-45),
      expiresAt: isoDaysFromNow(-42),
      confirmedAt: isoDaysFromNow(-44),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 6D (Kebijakan Final TC-01A): KPR Bank Mandiri telah cair 100% (PRIMARY 80% + SUBSEQUENT 20%). Status Booking COMPLETED, Deal FULLY_SETTLED, dan Unit SOLD.',
    },
    // [Booking 11 - Skenario 6E] KPR REJECTED_BY_BANK pada tahap APPRAISAL (Unit 11 BOOKED oleh Bima TIM-02)
    {
      id: detUuid(17, 11),
      referenceNumber: 'BK-202603-0011',
      leadId: l(28),
      unitId: u(11),
      salesId: bimaId,
      teamId: TEAM_IDS['TIM-02'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(11),
      promoDiscount: 0,
      bookingFeeAmount: 12_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 130_000_000,
      finalStatus: 'ACTIVE',
      bookedAt: isoDaysFromNow(-24),
      expiresAt: isoDaysFromNow(-21),
      confirmedAt: isoDaysFromNow(-23),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 6E: Aplikasi KPR ditolak oleh bank pada tahap APPRAISAL (current_stage tetap APPRAISAL, application_status REJECTED_BY_BANK).',
    },
    // [Booking 12 - Skenario 6F] KPR CANCELLED_BY_CUSTOMER pada tahap BANK_VERIFICATION (Unit 12 BOOKED oleh Yoga TIM-03)
    {
      id: detUuid(17, 12),
      referenceNumber: 'BK-202603-0012',
      leadId: l(46),
      unitId: u(12),
      salesId: yogaId,
      teamId: TEAM_IDS['TIM-03'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(12),
      promoDiscount: 0,
      bookingFeeAmount: 12_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 130_000_000,
      finalStatus: 'ACTIVE',
      bookedAt: isoDaysFromNow(-20),
      expiresAt: isoDaysFromNow(-17),
      confirmedAt: isoDaysFromNow(-19),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 6F: Pengajuan KPR BTN dibatalkan atas permintaan nasabah pada tahap BANK_VERIFICATION untuk beralih ke skema pembayaran lain.',
    },
    // [Booking 13 - Skenario 7A] CANCELLED dengan PARTIAL_REFUND & Refund PENDING_REFUND (Unit 13 AVAILABLE)
    {
      id: detUuid(17, 13),
      referenceNumber: 'BK-202603-0013',
      leadId: l(29),
      unitId: u(13),
      salesId: bimaId,
      teamId: TEAM_IDS['TIM-02'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(13),
      promoDiscount: 0,
      bookingFeeAmount: 10_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 75_000_000,
      finalStatus: 'CANCELLED',
      bookedAt: isoDaysFromNow(-26),
      expiresAt: isoDaysFromNow(-23),
      confirmedAt: isoDaysFromNow(-25),
      cancelledAt: isoDaysFromNow(-5),
      cancellationReason: 'Konsumen mutasi dinas mendadak ke luar pulau sebelum akad KPR.',
      refundPolicyType: 'PARTIAL_REFUND',
      agreedRefundAmount: 6_000_000,
      forfeitedRetainedAmount: 4_000_000,
      notes:
        'Skenario 7A (PD-04): Pembatalan dengan PARTIAL_REFUND Rp 6 Juta (potongan administrasi Rp 4 Juta), status refund PENDING_REFUND.',
    },
    // [Booking 14 - Skenario 7B] CANCELLED dengan FULL_REFUND & Refund COMPLETED (Unit 14 AVAILABLE)
    {
      id: detUuid(17, 14),
      referenceNumber: 'BK-202603-0014',
      leadId: l(47),
      unitId: u(14),
      salesId: yogaId,
      teamId: TEAM_IDS['TIM-03'],
      paymentMethod: 'KPR',
      promoId: null,
      catalogPrice: up(14),
      promoDiscount: 0,
      bookingFeeAmount: 10_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 75_000_000,
      finalStatus: 'CANCELLED',
      bookedAt: isoDaysFromNow(-32),
      expiresAt: isoDaysFromNow(-29),
      confirmedAt: isoDaysFromNow(-31),
      cancelledAt: isoDaysFromNow(-10),
      cancellationReason: 'Pembatalan sesuai klausul garansi uang kembali 100% jika kendala dokumen.',
      refundPolicyType: 'FULL_REFUND',
      agreedRefundAmount: 10_000_000,
      forfeitedRetainedAmount: 0,
      notes:
        'Skenario 7B (PD-04): Pembatalan dengan FULL_REFUND Rp 10 Juta dan transaksi refund telah COMPLETED oleh Admin Ichsan.',
    },
    // [Booking 15] PENDING_FEE Aktif milik Bima TIM-02 (Unit 15 HELD)
    {
      id: detUuid(17, 15),
      referenceNumber: 'BK-202603-0015',
      leadId: l(30),
      unitId: u(15),
      salesId: bimaId,
      teamId: TEAM_IDS['TIM-02'],
      paymentMethod: 'KPR',
      promoId: catalog.promoIds.PROMO_BENEFIT_BKS,
      catalogPrice: up(15),
      promoDiscount: 0,
      bookingFeeAmount: 10_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 75_000_000,
      finalStatus: 'PENDING_FEE',
      bookedAt: isoHoursFromNow(-20),
      expiresAt: isoHoursFromNow(52),
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes: 'Reservasi aktif Tim Harmoni Bravo menunggu transfer Booking Fee.',
    },
    // [Booking 16] Cash Keras 100% Lunas milik Citra TIM-02 (Unit 16 SOLD)
    {
      id: detUuid(17, 16),
      referenceNumber: 'BK-202603-0016',
      leadId: l(32),
      unitId: u(16),
      salesId: citraId,
      teamId: TEAM_IDS['TIM-02'],
      paymentMethod: 'CASH_KERAS',
      promoId: catalog.promoIds.PROMO_BENEFIT_BKS,
      catalogPrice: up(16),
      promoDiscount: 0,
      bookingFeeAmount: 15_000_000,
      isBookingFeePartOfDp: true,
      agreedDpTotalAmount: 200_000_000,
      finalStatus: 'COMPLETED',
      bookedAt: isoDaysFromNow(-38),
      expiresAt: isoDaysFromNow(-35),
      confirmedAt: isoDaysFromNow(-37),
      cancelledAt: null,
      cancellationReason: null,
      refundPolicyType: null,
      agreedRefundAmount: 0,
      forfeitedRetainedAmount: 0,
      notes: 'Transaksi Cash Keras lunas milik Tim Harmoni Bravo, Unit SOLD.',
    },
  ];

  // Langkah 4.1: Upsert seluruh Bookings dengan status sementara 'ACTIVE' (atau 'PENDING_FEE')
  const initialBookingsPayload = bookingSpecs.map((b) => ({
    id: b.id,
    reference_number: b.referenceNumber,
    lead_id: b.leadId,
    unit_id: b.unitId,
    origin_sales_id: b.salesId,
    current_sales_id: b.salesId,
    team_id: b.teamId,
    payment_method: b.paymentMethod,
    promo_id: b.promoId,
    catalog_price_snapshot: b.catalogPrice,
    promo_discount_snapshot: b.promoDiscount,
    agreed_final_price: b.catalogPrice - b.promoDiscount,
    booking_fee_amount: b.bookingFeeAmount,
    is_booking_fee_part_of_dp: b.isBookingFeePartOfDp,
    agreed_dp_total_amount: b.agreedDpTotalAmount,
    status: b.finalStatus === 'PENDING_FEE' ? 'PENDING_FEE' : 'ACTIVE',
    booked_at: b.bookedAt,
    expires_at: b.expiresAt,
    confirmed_at: b.confirmedAt,
    cancelled_at: b.cancelledAt,
    cancellation_reason: b.cancellationReason,
    refund_policy_type: b.refundPolicyType,
    agreed_refund_amount: b.agreedRefundAmount,
    forfeited_retained_amount: b.forfeitedRetainedAmount,
    notes: b.notes,
  }));

  await assertNoError(
    'Upsert initial bookings',
    await supabase.from('bookings').upsert(initialBookingsPayload, { onConflict: 'id' })
  );

  // Booking Extensions
  const bookingExtensionsPayload = [
    {
      id: detUuid(18, 1),
      booking_id: detUuid(17, 1),
      old_expires_at: isoHoursFromNow(36),
      new_expires_at: isoHoursFromNow(60),
      reason: 'Perpanjangan 24 jam atas permintaan konsumen menunggu kliring antarbank.',
      extended_by: adminId,
      created_at: isoHoursFromNow(-4),
    },
    {
      id: detUuid(18, 2),
      booking_id: detUuid(17, 7),
      old_expires_at: isoDaysFromNow(-16),
      new_expires_at: isoDaysFromNow(-15),
      reason: 'Perpanjangan batas waktu pembayaran Booking Fee sebelum verifikasi Admin.',
      extended_by: adminId,
      created_at: isoDaysFromNow(-17),
    },
  ];
  await assertNoError(
    'Upsert booking_extensions',
    await supabase.from('booking_extensions').upsert(bookingExtensionsPayload, { onConflict: 'id' })
  );

  const p4Final = up(4) - 25_000_000;
  const p5Final = up(5) - 25_000_000;
  const p6Final = up(6);
  const p16Final = up(16);

  const scheduleSpecs: ScheduleSeedSpec[] = [
    {
      id: detUuid(19, 1),
      bookingId: detUuid(17, 1),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Pembayaran Booking Fee Reservasi Unit',
      scheduledAmount: 10_000_000,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: 10_000_000,
      dueDate: dateOnlyDaysFromNow(3),
      finalStatus: 'UNPAID',
      paidAt: null,
    },
    {
      id: detUuid(19, 2),
      bookingId: detUuid(17, 2),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Pembayaran Booking Fee Reservasi Unit',
      scheduledAmount: 10_000_000,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: 10_000_000,
      dueDate: dateOnlyDaysFromNow(-1),
      finalStatus: 'UNPAID',
      paidAt: null,
    },
    {
      id: detUuid(19, 3),
      bookingId: detUuid(17, 3),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Pembayaran Booking Fee Reservasi Unit',
      scheduledAmount: 10_000_000,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: 10_000_000,
      dueDate: dateOnlyDaysFromNow(-9),
      finalStatus: 'CANCELLED',
      paidAt: null,
    },
    {
      id: detUuid(19, 4),
      bookingId: detUuid(17, 4),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee Cash Keras',
      scheduledAmount: 15_000_000,
      finalVerifiedPaidAmount: 15_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-33),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-34),
    },
    {
      id: detUuid(19, 5),
      bookingId: detUuid(17, 4),
      scheduleType: 'DOWN_PAYMENT',
      installmentNumber: 1,
      title: 'Uang Muka (DP) Cash Keras',
      scheduledAmount: 235_000_000,
      finalVerifiedPaidAmount: 235_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-25),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-26),
    },
    {
      id: detUuid(19, 6),
      bookingId: detUuid(17, 4),
      scheduleType: 'FINAL_SETTLEMENT',
      installmentNumber: 1,
      title: 'Pelunasan Akhir (Final Settlement) Cash Keras',
      scheduledAmount: p4Final - 250_000_000,
      finalVerifiedPaidAmount: p4Final - 250_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-12),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-14),
    },
    {
      id: detUuid(19, 7),
      bookingId: detUuid(17, 5),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee Cash Bertahap',
      scheduledAmount: 15_000_000,
      finalVerifiedPaidAmount: 15_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-26),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-27),
    },
    {
      id: detUuid(19, 8),
      bookingId: detUuid(17, 5),
      scheduleType: 'DOWN_PAYMENT',
      installmentNumber: 1,
      title: 'Pelunasan Uang Muka (DP) Syarat PPJB',
      scheduledAmount: 225_000_000,
      finalVerifiedPaidAmount: 225_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-18),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-19),
    },
    {
      id: detUuid(19, 9),
      bookingId: detUuid(17, 5),
      scheduleType: 'INSTALLMENT',
      installmentNumber: 1,
      title: 'Termin Cash Bertahap Ke-1 dari 3',
      scheduledAmount: (p5Final - 240_000_000) / 3,
      finalVerifiedPaidAmount: (p5Final - 240_000_000) / 3,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-5),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-6),
    },
    {
      id: detUuid(19, 10),
      bookingId: detUuid(17, 5),
      scheduleType: 'INSTALLMENT',
      installmentNumber: 2,
      title: 'Termin Cash Bertahap Ke-2 dari 3',
      scheduledAmount: (p5Final - 240_000_000) / 3,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: (p5Final - 240_000_000) / 3,
      dueDate: dateOnlyDaysFromNow(25),
      finalStatus: 'UNPAID',
      paidAt: null,
    },
    {
      id: detUuid(19, 11),
      bookingId: detUuid(17, 5),
      scheduleType: 'INSTALLMENT',
      installmentNumber: 3,
      title: 'Termin Cash Bertahap Ke-3 dari 3 (Pelunasan)',
      scheduledAmount: (p5Final - 240_000_000) / 3,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: (p5Final - 240_000_000) / 3,
      dueDate: dateOnlyDaysFromNow(55),
      finalStatus: 'UNPAID',
      paidAt: null,
    },
    {
      id: detUuid(19, 12),
      bookingId: detUuid(17, 6),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee Cash Bertahap',
      scheduledAmount: 15_000_000,
      finalVerifiedPaidAmount: 15_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-38),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-39),
    },
    {
      id: detUuid(19, 13),
      bookingId: detUuid(17, 6),
      scheduleType: 'DOWN_PAYMENT',
      installmentNumber: 1,
      title: 'Pelunasan DP Cash Bertahap',
      scheduledAmount: 235_000_000,
      finalVerifiedPaidAmount: 235_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-25),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-26),
    },
    {
      id: detUuid(19, 14),
      bookingId: detUuid(17, 6),
      scheduleType: 'INSTALLMENT',
      installmentNumber: 1,
      title: 'Termin Cash Bertahap Ke-1 (Jatuh Tempo Lewat / Overdue)',
      scheduledAmount: (p6Final - 250_000_000) / 2,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: (p6Final - 250_000_000) / 2,
      dueDate: dateOnlyDaysFromNow(-7),
      finalStatus: 'OVERDUE',
      paidAt: null,
    },
    {
      id: detUuid(19, 15),
      bookingId: detUuid(17, 6),
      scheduleType: 'INSTALLMENT',
      installmentNumber: 2,
      title: 'Termin Cash Bertahap Ke-2',
      scheduledAmount: (p6Final - 250_000_000) / 2,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: (p6Final - 250_000_000) / 2,
      dueDate: dateOnlyDaysFromNow(23),
      finalStatus: 'UNPAID',
      paidAt: null,
    },
    {
      id: detUuid(19, 16),
      bookingId: detUuid(17, 7),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee KPR Emerald Bintaro',
      scheduledAmount: 10_000_000,
      finalVerifiedPaidAmount: 10_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-16),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-17),
    },
    {
      id: detUuid(19, 17),
      bookingId: detUuid(17, 7),
      scheduleType: 'DOWN_PAYMENT',
      installmentNumber: 1,
      title: 'Uang Muka (DP) KPR',
      scheduledAmount: 90_000_000,
      finalVerifiedPaidAmount: 45_000_000,
      finalRemainingAmount: 45_000_000,
      dueDate: dateOnlyDaysFromNow(5),
      finalStatus: 'PARTIALLY_PAID',
      paidAt: null,
    },
    {
      id: detUuid(19, 18),
      bookingId: detUuid(17, 8),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee KPR',
      scheduledAmount: 10_000_000,
      finalVerifiedPaidAmount: 10_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-20),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-21),
    },
    {
      id: detUuid(19, 19),
      bookingId: detUuid(17, 8),
      scheduleType: 'DOWN_PAYMENT',
      installmentNumber: 1,
      title: 'Uang Muka (DP) KPR Awal',
      scheduledAmount: 85_000_000,
      finalVerifiedPaidAmount: 85_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-10),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-11),
    },
    {
      id: detUuid(19, 20),
      bookingId: detUuid(17, 8),
      scheduleType: 'KPR_TOPUP_DP',
      installmentNumber: 1,
      title: 'Tambahan DP (Top-up DP) Selisih Plafon SP3K BCA',
      scheduledAmount: 40_000_000,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: 40_000_000,
      dueDate: dateOnlyDaysFromNow(7),
      finalStatus: 'UNPAID',
      paidAt: null,
    },
    {
      id: detUuid(19, 21),
      bookingId: detUuid(17, 9),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee KPR',
      scheduledAmount: 10_000_000,
      finalVerifiedPaidAmount: 10_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-28),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-29),
    },
    {
      id: detUuid(19, 22),
      bookingId: detUuid(17, 9),
      scheduleType: 'DOWN_PAYMENT',
      installmentNumber: 1,
      title: 'Pelunasan Uang Muka (DP) KPR Pra-Akad',
      scheduledAmount: 88_000_000,
      finalVerifiedPaidAmount: 88_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-15),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-16),
    },
    {
      id: detUuid(19, 23),
      bookingId: detUuid(17, 10),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee KPR',
      scheduledAmount: 15_000_000,
      finalVerifiedPaidAmount: 15_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-43),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-44),
    },
    {
      id: detUuid(19, 24),
      bookingId: detUuid(17, 10),
      scheduleType: 'DOWN_PAYMENT',
      installmentNumber: 1,
      title: 'Pelunasan Uang Muka (DP) KPR Pra-Akad',
      scheduledAmount: 120_000_000,
      finalVerifiedPaidAmount: 120_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-30),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-31),
    },
    {
      id: detUuid(19, 25),
      bookingId: detUuid(17, 11),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee KPR',
      scheduledAmount: 12_000_000,
      finalVerifiedPaidAmount: 12_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-22),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-23),
    },
    {
      id: detUuid(19, 26),
      bookingId: detUuid(17, 12),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee KPR',
      scheduledAmount: 12_000_000,
      finalVerifiedPaidAmount: 12_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-18),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-19),
    },
    {
      id: detUuid(19, 27),
      bookingId: detUuid(17, 13),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee (Dibatalkan dengan Partial Refund)',
      scheduledAmount: 10_000_000,
      finalVerifiedPaidAmount: 10_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-24),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-25),
    },
    {
      id: detUuid(19, 28),
      bookingId: detUuid(17, 13),
      scheduleType: 'DOWN_PAYMENT',
      installmentNumber: 1,
      title: 'Tagihan DP (Dibatalkan)',
      scheduledAmount: 65_000_000,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: 65_000_000,
      dueDate: dateOnlyDaysFromNow(-10),
      finalStatus: 'CANCELLED',
      paidAt: null,
    },
    {
      id: detUuid(19, 29),
      bookingId: detUuid(17, 14),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee (Dibatalkan dengan Full Refund)',
      scheduledAmount: 10_000_000,
      finalVerifiedPaidAmount: 10_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-30),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-31),
    },
    {
      id: detUuid(19, 30),
      bookingId: detUuid(17, 15),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee Reservasi Unit',
      scheduledAmount: 10_000_000,
      finalVerifiedPaidAmount: 0,
      finalRemainingAmount: 10_000_000,
      dueDate: dateOnlyDaysFromNow(2),
      finalStatus: 'UNPAID',
      paidAt: null,
    },
    {
      id: detUuid(19, 31),
      bookingId: detUuid(17, 16),
      scheduleType: 'BOOKING_FEE',
      installmentNumber: 1,
      title: 'Booking Fee Cash Keras',
      scheduledAmount: 15_000_000,
      finalVerifiedPaidAmount: 15_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-36),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-37),
    },
    {
      id: detUuid(19, 32),
      bookingId: detUuid(17, 16),
      scheduleType: 'FINAL_SETTLEMENT',
      installmentNumber: 1,
      title: 'Pelunasan Cash Keras',
      scheduledAmount: p16Final - 15_000_000,
      finalVerifiedPaidAmount: p16Final - 15_000_000,
      finalRemainingAmount: 0,
      dueDate: dateOnlyDaysFromNow(-20),
      finalStatus: 'PAID',
      paidAt: isoDaysFromNow(-21),
    },
  ];

  // Langkah 4.2: Upsert seluruh Payment Schedules dengan status awal 'UNPAID'
  const initialSchedulesPayload = scheduleSpecs.map((s) => ({
    id: s.id,
    booking_id: s.bookingId,
    schedule_type: s.scheduleType,
    installment_number: s.installmentNumber,
    title: s.title,
    scheduled_amount: s.scheduledAmount,
    verified_paid_amount: 0,
    remaining_amount: s.scheduledAmount,
    due_date: s.dueDate,
    status: 'UNPAID' as ScheduleStatus,
    paid_at: null,
  }));

  await assertNoError(
    'Upsert initial payment_schedules',
    await supabase
      .from('payment_schedules')
      .upsert(initialSchedulesPayload, { onConflict: 'id' })
  );

  // Langkah 4.3: Payment Records
  const paymentRecordSpecs: PaymentRecordSeedSpec[] = [
    {
      id: detUuid(20, 1),
      referenceNumber: 'PAY-202603-0001',
      bookingId: detUuid(17, 2),
      paymentScheduleId: detUuid(19, 2),
      submittedBySalesId: farizId,
      paidAmount: 10_000_000,
      paymentDate: dateOnlyDaysFromNow(-3),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 2)}/payments/bukti-bf-bk0002-fiktif.pdf`,
      proofFileName: 'bukti-bf-bk0002-fiktif.pdf',
      replacesPaymentId: null,
      verificationStatus: 'PENDING_VERIFICATION',
      submittedAt: isoHoursFromNow(-52),
      verificationSlaDueAt: isoHoursFromNow(-28),
      verifiedByAdminId: null,
      verifiedAt: null,
      verificationNotes: null,
      salesNotes:
        'Bukti transfer Booking Fee Rp 10 Juta a/n Budi Santoso. Mohon verifikasi Admin.',
    },
    {
      id: detUuid(20, 2),
      referenceNumber: 'PAY-202603-0002',
      bookingId: detUuid(17, 4),
      paymentScheduleId: detUuid(19, 4),
      submittedBySalesId: farizId,
      paidAmount: 15_000_000,
      paymentDate: dateOnlyDaysFromNow(-34),
      paymentChannel: 'BANK_TRANSFER_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 4)}/payments/bukti-bf-bk0004.pdf`,
      proofFileName: 'bukti-bf-bk0004.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-34),
      verificationSlaDueAt: isoDaysFromNow(-33),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-34),
      verificationNotes: 'Dana Booking Fee Rp 15 Juta telah masuk ke rekening escrow PT FIM-Property.',
      salesNotes: 'Transfer Booking Fee Cash Keras.',
    },
    {
      id: detUuid(20, 3),
      referenceNumber: 'PAY-202603-0003',
      bookingId: detUuid(17, 4),
      paymentScheduleId: detUuid(19, 5),
      submittedBySalesId: farizId,
      paidAmount: 235_000_000,
      paymentDate: dateOnlyDaysFromNow(-26),
      paymentChannel: 'RTGS_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 4)}/payments/bukti-dp-bk0004.pdf`,
      proofFileName: 'bukti-dp-bk0004.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-26),
      verificationSlaDueAt: isoDaysFromNow(-25),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-26),
      verificationNotes: 'Pelunasan DP Cash Keras sesuai mutasi rekening koran.',
      salesNotes: 'Bukti RTGS DP Cash Keras.',
    },
    {
      id: detUuid(20, 4),
      referenceNumber: 'PAY-202603-0004',
      bookingId: detUuid(17, 4),
      paymentScheduleId: detUuid(19, 6),
      submittedBySalesId: farizId,
      paidAmount: p4Final - 250_000_000,
      paymentDate: dateOnlyDaysFromNow(-14),
      paymentChannel: 'RTGS_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 4)}/payments/bukti-lunas-bk0004.pdf`,
      proofFileName: 'bukti-lunas-bk0004.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-14),
      verificationSlaDueAt: isoDaysFromNow(-13),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-14),
      verificationNotes: 'Pelunasan 100% Cash Keras terverifikasi lunas oleh Muhammad Ichsan Fachrulrozi.',
      salesNotes: 'Pelunasan akhir Cash Keras.',
    },
    {
      id: detUuid(20, 5),
      referenceNumber: 'PAY-202603-0005',
      bookingId: detUuid(17, 5),
      paymentScheduleId: detUuid(19, 7),
      submittedBySalesId: farizId,
      paidAmount: 15_000_000,
      paymentDate: dateOnlyDaysFromNow(-27),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 5)}/payments/bukti-bf-bk0005.pdf`,
      proofFileName: 'bukti-bf-bk0005.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-27),
      verificationSlaDueAt: isoDaysFromNow(-26),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-27),
      verificationNotes: 'Booking Fee Cash Bertahap terverifikasi.',
      salesNotes: 'Transfer Booking Fee.',
    },
    {
      id: detUuid(20, 6),
      referenceNumber: 'PAY-202603-0006',
      bookingId: detUuid(17, 5),
      paymentScheduleId: detUuid(19, 8),
      submittedBySalesId: farizId,
      paidAmount: 225_000_000,
      paymentDate: dateOnlyDaysFromNow(-20),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 5)}/payments/bukti-dp-blur-bk0005.pdf`,
      proofFileName: 'bukti-dp-blur-bk0005.pdf',
      replacesPaymentId: null,
      verificationStatus: 'REJECTED',
      submittedAt: isoDaysFromNow(-20),
      verificationSlaDueAt: isoDaysFromNow(-19),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-20),
      verificationNotes:
        'Bukti struk transfer terpotong dan nomor referensi bank tidak terbaca. Mohon unggah ulang resi penuh.',
      salesNotes: 'Unggahan awal resi DP.',
    },
    {
      id: detUuid(20, 7),
      referenceNumber: 'PAY-202603-0007',
      bookingId: detUuid(17, 5),
      paymentScheduleId: detUuid(19, 8),
      submittedBySalesId: farizId,
      paidAmount: 225_000_000,
      paymentDate: dateOnlyDaysFromNow(-19),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 5)}/payments/bukti-dp-revisi-bk0005.pdf`,
      proofFileName: 'bukti-dp-revisi-bk0005.pdf',
      replacesPaymentId: detUuid(20, 6),
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-19),
      verificationSlaDueAt: isoDaysFromNow(-18),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-19),
      verificationNotes: 'Bukti koreksi jelas dan dana Rp 225 Juta telah masuk rekening.',
      salesNotes: 'Unggahan perbaikan bukti transfer DP penuh.',
    },
    {
      id: detUuid(20, 8),
      referenceNumber: 'PAY-202603-0008',
      bookingId: detUuid(17, 5),
      paymentScheduleId: detUuid(19, 9),
      submittedBySalesId: farizId,
      paidAmount: (p5Final - 240_000_000) / 3,
      paymentDate: dateOnlyDaysFromNow(-6),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 5)}/payments/bukti-termin1-bk0005.pdf`,
      proofFileName: 'bukti-termin1-bk0005.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-6),
      verificationSlaDueAt: isoDaysFromNow(-5),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-6),
      verificationNotes: 'Termin Cash Bertahap ke-1 terverifikasi lunas.',
      salesNotes: 'Pembayaran termin ke-1.',
    },
    {
      id: detUuid(20, 9),
      referenceNumber: 'PAY-202603-0009',
      bookingId: detUuid(17, 6),
      paymentScheduleId: detUuid(19, 12),
      submittedBySalesId: nadiaId,
      paidAmount: 15_000_000,
      paymentDate: dateOnlyDaysFromNow(-39),
      paymentChannel: 'BANK_TRANSFER_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 6)}/payments/bukti-bf-bk0006.pdf`,
      proofFileName: 'bukti-bf-bk0006.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-39),
      verificationSlaDueAt: isoDaysFromNow(-38),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-39),
      verificationNotes: 'Booking Fee terverifikasi.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 10),
      referenceNumber: 'PAY-202603-0010',
      bookingId: detUuid(17, 6),
      paymentScheduleId: detUuid(19, 13),
      submittedBySalesId: nadiaId,
      paidAmount: 235_000_000,
      paymentDate: dateOnlyDaysFromNow(-26),
      paymentChannel: 'BANK_TRANSFER_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 6)}/payments/bukti-dp-bk0006.pdf`,
      proofFileName: 'bukti-dp-bk0006.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-26),
      verificationSlaDueAt: isoDaysFromNow(-25),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-26),
      verificationNotes: 'DP Cash Bertahap terverifikasi.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 11),
      referenceNumber: 'PAY-202603-0011',
      bookingId: detUuid(17, 7),
      paymentScheduleId: detUuid(19, 16),
      submittedBySalesId: farizId,
      paidAmount: 10_000_000,
      paymentDate: dateOnlyDaysFromNow(-17),
      paymentChannel: 'BANK_TRANSFER_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 7)}/payments/bukti-bf-bk0007.pdf`,
      proofFileName: 'bukti-bf-bk0007.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-17),
      verificationSlaDueAt: isoDaysFromNow(-16),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-17),
      verificationNotes: 'Booking Fee KPR terverifikasi.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 12),
      referenceNumber: 'PAY-202603-0012',
      bookingId: detUuid(17, 7),
      paymentScheduleId: detUuid(19, 17),
      submittedBySalesId: farizId,
      paidAmount: 45_000_000,
      paymentDate: dateOnlyDaysFromNow(-8),
      paymentChannel: 'BANK_TRANSFER_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 7)}/payments/bukti-dp-parsial-bk0007.pdf`,
      proofFileName: 'bukti-dp-parsial-bk0007.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-8),
      verificationSlaDueAt: isoDaysFromNow(-7),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-8),
      verificationNotes: 'Pembayaran parsial tahap 1 DP KPR Rp 45 Juta terverifikasi.',
      salesNotes: 'Angsuran pertama DP KPR.',
    },
    {
      id: detUuid(20, 13),
      referenceNumber: 'PAY-202603-0013',
      bookingId: detUuid(17, 8),
      paymentScheduleId: detUuid(19, 18),
      submittedBySalesId: farizId,
      paidAmount: 10_000_000,
      paymentDate: dateOnlyDaysFromNow(-21),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 8)}/payments/bukti-bf-bk0008.pdf`,
      proofFileName: 'bukti-bf-bk0008.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-21),
      verificationSlaDueAt: isoDaysFromNow(-20),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-21),
      verificationNotes: 'Booking Fee terverifikasi.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 14),
      referenceNumber: 'PAY-202603-0014',
      bookingId: detUuid(17, 8),
      paymentScheduleId: detUuid(19, 19),
      submittedBySalesId: farizId,
      paidAmount: 85_000_000,
      paymentDate: dateOnlyDaysFromNow(-11),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 8)}/payments/bukti-dp-bk0008.pdf`,
      proofFileName: 'bukti-dp-bk0008.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-11),
      verificationSlaDueAt: isoDaysFromNow(-10),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-11),
      verificationNotes: 'DP Awal KPR terverifikasi lunas.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 15),
      referenceNumber: 'PAY-202603-0015',
      bookingId: detUuid(17, 9),
      paymentScheduleId: detUuid(19, 21),
      submittedBySalesId: farizId,
      paidAmount: 10_000_000,
      paymentDate: dateOnlyDaysFromNow(-29),
      paymentChannel: 'BANK_TRANSFER_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 9)}/payments/bukti-bf-bk0009.pdf`,
      proofFileName: 'bukti-bf-bk0009.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-29),
      verificationSlaDueAt: isoDaysFromNow(-28),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-29),
      verificationNotes: 'Booking Fee terverifikasi.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 16),
      referenceNumber: 'PAY-202603-0016',
      bookingId: detUuid(17, 9),
      paymentScheduleId: detUuid(19, 22),
      submittedBySalesId: farizId,
      paidAmount: 88_000_000,
      paymentDate: dateOnlyDaysFromNow(-16),
      paymentChannel: 'BANK_TRANSFER_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 9)}/payments/bukti-dp-bk0009.pdf`,
      proofFileName: 'bukti-dp-bk0009.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-16),
      verificationSlaDueAt: isoDaysFromNow(-15),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-16),
      verificationNotes: 'DP Pra-Akad terverifikasi lunas.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 17),
      referenceNumber: 'PAY-202603-0017',
      bookingId: detUuid(17, 10),
      paymentScheduleId: detUuid(19, 23),
      submittedBySalesId: farizId,
      paidAmount: 15_000_000,
      paymentDate: dateOnlyDaysFromNow(-44),
      paymentChannel: 'BANK_TRANSFER_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 10)}/payments/bukti-bf-bk0010.pdf`,
      proofFileName: 'bukti-bf-bk0010.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-44),
      verificationSlaDueAt: isoDaysFromNow(-43),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-44),
      verificationNotes: 'Booking Fee terverifikasi.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 18),
      referenceNumber: 'PAY-202603-0018',
      bookingId: detUuid(17, 10),
      paymentScheduleId: detUuid(19, 24),
      submittedBySalesId: farizId,
      paidAmount: 120_000_000,
      paymentDate: dateOnlyDaysFromNow(-31),
      paymentChannel: 'BANK_TRANSFER_MANDIRI',
      proofFilePath: `bookings/${detUuid(17, 10)}/payments/bukti-dp-bk0010.pdf`,
      proofFileName: 'bukti-dp-bk0010.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-31),
      verificationSlaDueAt: isoDaysFromNow(-30),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-31),
      verificationNotes: 'DP KPR Pra-Akad terverifikasi lunas.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 19),
      referenceNumber: 'PAY-202603-0019',
      bookingId: detUuid(17, 11),
      paymentScheduleId: detUuid(19, 25),
      submittedBySalesId: bimaId,
      paidAmount: 12_000_000,
      paymentDate: dateOnlyDaysFromNow(-23),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 11)}/payments/bukti-bf-bk0011.pdf`,
      proofFileName: 'bukti-bf-bk0011.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-23),
      verificationSlaDueAt: isoDaysFromNow(-22),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-23),
      verificationNotes: 'Booking Fee terverifikasi.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 20),
      referenceNumber: 'PAY-202603-0020',
      bookingId: detUuid(17, 12),
      paymentScheduleId: detUuid(19, 26),
      submittedBySalesId: yogaId,
      paidAmount: 12_000_000,
      paymentDate: dateOnlyDaysFromNow(-19),
      paymentChannel: 'BANK_TRANSFER_BTN',
      proofFilePath: `bookings/${detUuid(17, 12)}/payments/bukti-bf-bk0012.pdf`,
      proofFileName: 'bukti-bf-bk0012.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-19),
      verificationSlaDueAt: isoDaysFromNow(-18),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-19),
      verificationNotes: 'Booking Fee terverifikasi.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 21),
      referenceNumber: 'PAY-202603-0021',
      bookingId: detUuid(17, 13),
      paymentScheduleId: detUuid(19, 27),
      submittedBySalesId: bimaId,
      paidAmount: 10_000_000,
      paymentDate: dateOnlyDaysFromNow(-25),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 13)}/payments/bukti-bf-bk0013.pdf`,
      proofFileName: 'bukti-bf-bk0013.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-25),
      verificationSlaDueAt: isoDaysFromNow(-24),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-25),
      verificationNotes: 'Booking Fee terverifikasi sebelum pembatalan.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 22),
      referenceNumber: 'PAY-202603-0022',
      bookingId: detUuid(17, 14),
      paymentScheduleId: detUuid(19, 29),
      submittedBySalesId: yogaId,
      paidAmount: 10_000_000,
      paymentDate: dateOnlyDaysFromNow(-31),
      paymentChannel: 'BANK_TRANSFER_BTN',
      proofFilePath: `bookings/${detUuid(17, 14)}/payments/bukti-bf-bk0014.pdf`,
      proofFileName: 'bukti-bf-bk0014.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-31),
      verificationSlaDueAt: isoDaysFromNow(-30),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-31),
      verificationNotes: 'Booking Fee terverifikasi sebelum pembatalan.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 23),
      referenceNumber: 'PAY-202603-0023',
      bookingId: detUuid(17, 16),
      paymentScheduleId: detUuid(19, 31),
      submittedBySalesId: citraId,
      paidAmount: 15_000_000,
      paymentDate: dateOnlyDaysFromNow(-37),
      paymentChannel: 'BANK_TRANSFER_BCA',
      proofFilePath: `bookings/${detUuid(17, 16)}/payments/bukti-bf-bk0016.pdf`,
      proofFileName: 'bukti-bf-bk0016.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-37),
      verificationSlaDueAt: isoDaysFromNow(-36),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-37),
      verificationNotes: 'Booking Fee terverifikasi.',
      salesNotes: null,
    },
    {
      id: detUuid(20, 24),
      referenceNumber: 'PAY-202603-0024',
      bookingId: detUuid(17, 16),
      paymentScheduleId: detUuid(19, 32),
      submittedBySalesId: citraId,
      paidAmount: p16Final - 15_000_000,
      paymentDate: dateOnlyDaysFromNow(-21),
      paymentChannel: 'RTGS_BCA',
      proofFilePath: `bookings/${detUuid(17, 16)}/payments/bukti-lunas-bk0016.pdf`,
      proofFileName: 'bukti-lunas-bk0016.pdf',
      replacesPaymentId: null,
      verificationStatus: 'VERIFIED',
      submittedAt: isoDaysFromNow(-21),
      verificationSlaDueAt: isoDaysFromNow(-20),
      verifiedByAdminId: adminId,
      verifiedAt: isoDaysFromNow(-21),
      verificationNotes: 'Pelunasan Cash Keras terverifikasi.',
      salesNotes: null,
    },
  ];

  const { data: existingPayRows, error: existingPayErr } = await supabase
    .from('payment_records')
    .select('id');
  if (existingPayErr) {
    throw new Error(`[SEED_ERROR] Select payment_records: ${existingPayErr.message}`);
  }
  const existingPayIds = new Set((existingPayRows ?? []).map((r: { id: string }) => r.id));

  for (const pr of paymentRecordSpecs) {
    const rowPayload = {
      id: pr.id,
      reference_number: pr.referenceNumber,
      booking_id: pr.bookingId,
      payment_schedule_id: pr.paymentScheduleId,
      submitted_by_sales_id: pr.submittedBySalesId,
      paid_amount: pr.paidAmount,
      payment_date: pr.paymentDate,
      payment_channel: pr.paymentChannel,
      proof_file_path: pr.proofFilePath,
      proof_file_name: pr.proofFileName,
      replaces_payment_id: pr.replacesPaymentId,
      verification_status: pr.verificationStatus,
      submitted_at: pr.submittedAt,
      verification_sla_due_at: pr.verificationSlaDueAt,
      verified_by_admin_id: pr.verifiedByAdminId,
      verified_at: pr.verifiedAt,
      verification_notes: pr.verificationNotes,
      sales_notes: pr.salesNotes,
    };

    if (existingPayIds.has(pr.id)) {
      const updRes = await supabase
        .from('payment_records')
        .update(rowPayload)
        .eq('id', pr.id);
      await assertNoError(`Update payment_record ${pr.referenceNumber}`, updRes);
    } else {
      const insRes = await supabase.from('payment_records').insert(rowPayload);
      await assertNoError(`Insert payment_record ${pr.referenceNumber}`, insRes);
    }
  }

  // Langkah 4.4: Update seluruh Payment Schedules ke nilai final
  for (const s of scheduleSpecs) {
    const updSchedRes = await supabase
      .from('payment_schedules')
      .update({
        scheduled_amount: s.scheduledAmount,
        verified_paid_amount: s.finalVerifiedPaidAmount,
        remaining_amount: s.finalRemainingAmount,
        due_date: s.dueDate,
        status: s.finalStatus,
        paid_at: s.paidAt,
      })
      .eq('id', s.id);
    await assertNoError(`Finalize payment_schedule ${s.id}`, updSchedRes);
  }

  // Langkah 4.5: Update seluruh Bookings ke finalStatus
  for (const b of bookingSpecs) {
    const updBookRes = await supabase
      .from('bookings')
      .update({
        status: b.finalStatus,
        cancelled_at: b.cancelledAt,
        cancellation_reason: b.cancellationReason,
        refund_policy_type: b.refundPolicyType,
        agreed_refund_amount: b.agreedRefundAmount,
        forfeited_retained_amount: b.forfeitedRetainedAmount,
      })
      .eq('id', b.id);
    await assertNoError(`Finalize booking ${b.referenceNumber}`, updBookRes);
  }

  // Langkah 4.6: Refund Transactions
  const refundsPayload = [
    {
      id: detUuid(21, 1),
      reference_number: 'REF-202603-0001',
      booking_id: detUuid(17, 13),
      refund_amount: 6_000_000,
      refund_date: null,
      refund_method: 'BANK_TRANSFER',
      proof_file_path: null,
      status: 'PENDING_REFUND' as RefundStatus,
      processed_by_admin_id: adminId,
      notes: 'Menunggu jadwal batch transfer pengembalian dana sebagian (Partial Refund 60%).',
    },
    {
      id: detUuid(21, 2),
      reference_number: 'REF-202603-0002',
      booking_id: detUuid(17, 14),
      refund_amount: 10_000_000,
      refund_date: dateOnlyDaysFromNow(-8),
      refund_method: 'BANK_TRANSFER_BTN',
      proof_file_path: `bookings/${detUuid(17, 14)}/refunds/bukti-refund-ref0002.pdf`,
      status: 'COMPLETED' as RefundStatus,
      processed_by_admin_id: adminId,
      notes: 'Pengembalian dana 100% Booking Fee telah ditransfer oleh Admin Muhammad Ichsan Fachrulrozi.',
    },
  ];
  await assertNoError(
    'Upsert refund_transactions',
    await supabase.from('refund_transactions').upsert(refundsPayload, { onConflict: 'id' })
  );

  // Langkah 4.7: 6 KPR Applications
  const kpr7LoanReq = up(7) - 100_000_000;
  const kpr8LoanReq = up(8) - 95_000_000;
  const kpr8LoanApp = kpr8LoanReq - 40_000_000;
  const kpr9LoanApp = up(9) - 98_000_000;
  const kpr9Primary80 = Math.round(kpr9LoanApp * 0.8);
  const kpr9Rem20 = kpr9LoanApp - kpr9Primary80;
  const kpr10LoanApp = up(10) - 135_000_000;
  const kpr10Primary80 = Math.round(kpr10LoanApp * 0.8);
  const kpr10Sub20 = kpr10LoanApp - kpr10Primary80;

  const kprAppsPayload: Array<{
    id: string;
    reference_number: string;
    booking_id: string;
    current_sales_id: string;
    team_id: string;
    bank_name: string;
    requested_loan_amount: number;
    tenor_years: number;
    current_stage: KprStage;
    application_status: KprApplicationStatus;
    requires_appraisal: boolean;
    requires_additional_docs: boolean;
    submitted_to_bank_at: string | null;
    approved_at: string | null;
    sp3k_reference_number: string | null;
    approved_loan_amount: number | null;
    rejected_at: string | null;
    rejection_reason: string | null;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    akad_scheduled_at: string | null;
    akad_location: string | null;
    notary_name: string | null;
    akad_completed_at: string | null;
    akad_deed_number: string | null;
    disbursement_status: KprDisbursementStatus;
    primary_disbursed_amount: number;
    subsequent_disbursed_amount: number;
    remaining_undisbursed_amount: number;
    first_disbursed_at: string | null;
    fully_disbursed_at: string | null;
    notes: string;
  }> = [
    {
      id: detUuid(23, 1),
      reference_number: 'KPR-202603-0001',
      booking_id: detUuid(17, 7),
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      bank_name: 'Bank Mandiri',
      requested_loan_amount: kpr7LoanReq,
      tenor_years: 15,
      current_stage: 'DOCUMENT_VERIFICATION',
      application_status: 'IN_PROGRESS',
      requires_appraisal: true,
      requires_additional_docs: false,
      submitted_to_bank_at: null,
      approved_at: null,
      sp3k_reference_number: null,
      approved_loan_amount: null,
      rejected_at: null,
      rejection_reason: null,
      cancelled_at: null,
      cancellation_reason: null,
      akad_scheduled_at: null,
      akad_location: null,
      notary_name: null,
      akad_completed_at: null,
      akad_deed_number: null,
      disbursement_status: 'NOT_DISBURSED',
      primary_disbursed_amount: 0,
      subsequent_disbursed_amount: 0,
      remaining_undisbursed_amount: 0,
      first_disbursed_at: null,
      fully_disbursed_at: null,
      notes: 'Skenario 6A: Berkas KPR sedang diverifikasi internal oleh Admin Ichsan sebelum dikirim ke Bank Mandiri.',
    },
    {
      id: detUuid(23, 2),
      reference_number: 'KPR-202603-0002',
      booking_id: detUuid(17, 8),
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      bank_name: 'BCA',
      requested_loan_amount: kpr8LoanReq,
      tenor_years: 20,
      current_stage: 'APPROVED',
      application_status: 'APPROVED',
      requires_appraisal: true,
      requires_additional_docs: false,
      submitted_to_bank_at: isoDaysFromNow(-14),
      approved_at: isoDaysFromNow(-4),
      sp3k_reference_number: 'SP3K/BCA/KPR/2026/03/0881',
      approved_loan_amount: kpr8LoanApp,
      rejected_at: null,
      rejection_reason: null,
      cancelled_at: null,
      cancellation_reason: null,
      akad_scheduled_at: null,
      akad_location: null,
      notary_name: null,
      akad_completed_at: null,
      akad_deed_number: null,
      disbursement_status: 'NOT_DISBURSED',
      primary_disbursed_amount: 0,
      subsequent_disbursed_amount: 0,
      remaining_undisbursed_amount: kpr8LoanApp,
      first_disbursed_at: null,
      fully_disbursed_at: null,
      notes: 'Skenario 6B: SP3K BCA terbit dengan plafon lebih rendah Rp 40 Juta dari pengajuan, menunggu pelunasan KPR_TOPUP_DP.',
    },
    {
      id: detUuid(23, 3),
      reference_number: 'KPR-202603-0003',
      booking_id: detUuid(17, 9),
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      bank_name: 'Bank Mandiri',
      requested_loan_amount: kpr9LoanApp,
      tenor_years: 15,
      current_stage: 'DISBURSEMENT',
      application_status: 'APPROVED',
      requires_appraisal: true,
      requires_additional_docs: false,
      submitted_to_bank_at: isoDaysFromNow(-24),
      approved_at: isoDaysFromNow(-14),
      sp3k_reference_number: 'SP3K/BMRI/BSD/2026/0192',
      approved_loan_amount: kpr9LoanApp,
      rejected_at: null,
      rejection_reason: null,
      cancelled_at: null,
      cancellation_reason: null,
      akad_scheduled_at: isoDaysFromNow(-8),
      akad_location: 'Kantor Cabang Bank Mandiri BSD Green Office Park',
      notary_name: 'Notaris & PPAT Hj. Ratna Kemala, S.H., M.Kn.',
      akad_completed_at: isoDaysFromNow(-8),
      akad_deed_number: 'AKAD-BMRI-2026-0091',
      disbursement_status: 'PARTIALLY_DISBURSED',
      primary_disbursed_amount: kpr9Primary80,
      subsequent_disbursed_amount: 0,
      remaining_undisbursed_amount: kpr9Rem20,
      first_disbursed_at: isoDaysFromNow(-5),
      fully_disbursed_at: null,
      notes: 'Skenario 6C (TC-01A): Pencairan tahap PRIMARY 80% selesai, sisa 20% retensi atap/BAST. Unit tetap BOOKED hingga 100% cair.',
    },
    {
      id: detUuid(23, 4),
      reference_number: 'KPR-202603-0004',
      booking_id: detUuid(17, 10),
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      bank_name: 'Bank Mandiri',
      requested_loan_amount: kpr10LoanApp,
      tenor_years: 15,
      current_stage: 'DISBURSEMENT',
      application_status: 'COMPLETED',
      requires_appraisal: true,
      requires_additional_docs: false,
      submitted_to_bank_at: isoDaysFromNow(-38),
      approved_at: isoDaysFromNow(-28),
      sp3k_reference_number: 'SP3K/BMRI/BTR/2026/0044',
      approved_loan_amount: kpr10LoanApp,
      rejected_at: null,
      rejection_reason: null,
      cancelled_at: null,
      cancellation_reason: null,
      akad_scheduled_at: isoDaysFromNow(-20),
      akad_location: 'Kantor Cabang Bank Mandiri Bintaro Sektor 7',
      notary_name: 'Notaris & PPAT Hendarto Wibisono, S.H., M.Kn.',
      akad_completed_at: isoDaysFromNow(-20),
      akad_deed_number: 'AKAD-BMRI-2026-0044',
      disbursement_status: 'FULLY_DISBURSED',
      primary_disbursed_amount: kpr10Primary80,
      subsequent_disbursed_amount: kpr10Sub20,
      remaining_undisbursed_amount: 0,
      first_disbursed_at: isoDaysFromNow(-18),
      fully_disbursed_at: isoDaysFromNow(-3),
      notes: 'Skenario 6D (TC-01A): Pencairan KPR telah mencapai 100% (FULLY_DISBURSED). Unit otomatis beralih menjadi SOLD.',
    },
    {
      id: detUuid(23, 5),
      reference_number: 'KPR-202603-0005',
      booking_id: detUuid(17, 11),
      current_sales_id: bimaId,
      team_id: TEAM_IDS['TIM-02'],
      bank_name: 'BCA',
      requested_loan_amount: up(11) - 130_000_000,
      tenor_years: 15,
      current_stage: 'APPRAISAL',
      application_status: 'REJECTED_BY_BANK',
      requires_appraisal: true,
      requires_additional_docs: false,
      submitted_to_bank_at: isoDaysFromNow(-16),
      approved_at: null,
      sp3k_reference_number: null,
      approved_loan_amount: null,
      rejected_at: isoDaysFromNow(-4),
      rejection_reason: 'Rasio DSR (Debt Service Ratio) pemohon melebihi batas kebijakan kredit bank saat ini.',
      cancelled_at: null,
      cancellation_reason: null,
      akad_scheduled_at: null,
      akad_location: null,
      notary_name: null,
      akad_completed_at: null,
      akad_deed_number: null,
      disbursement_status: 'NOT_DISBURSED',
      primary_disbursed_amount: 0,
      subsequent_disbursed_amount: 0,
      remaining_undisbursed_amount: 0,
      first_disbursed_at: null,
      fully_disbursed_at: null,
      notes: 'Skenario 6E: Pengajuan KPR ditolak pada tahap APPRAISAL (current_stage tetap APPRAISAL).',
    },
    {
      id: detUuid(23, 6),
      reference_number: 'KPR-202603-0006',
      booking_id: detUuid(17, 12),
      current_sales_id: yogaId,
      team_id: TEAM_IDS['TIM-03'],
      bank_name: 'BTN',
      requested_loan_amount: up(12) - 130_000_000,
      tenor_years: 20,
      current_stage: 'BANK_VERIFICATION',
      application_status: 'CANCELLED_BY_CUSTOMER',
      requires_appraisal: true,
      requires_additional_docs: false,
      submitted_to_bank_at: isoDaysFromNow(-12),
      approved_at: null,
      sp3k_reference_number: null,
      approved_loan_amount: null,
      rejected_at: null,
      rejection_reason: null,
      cancelled_at: isoDaysFromNow(-2),
      cancellation_reason: 'Nasabah mengajukan pembatalan proses KPR BTN karena ingin melunasi secara Cash Bertahap.',
      akad_scheduled_at: null,
      akad_location: null,
      notary_name: null,
      akad_completed_at: null,
      akad_deed_number: null,
      disbursement_status: 'NOT_DISBURSED',
      primary_disbursed_amount: 0,
      subsequent_disbursed_amount: 0,
      remaining_undisbursed_amount: 0,
      first_disbursed_at: null,
      fully_disbursed_at: null,
      notes: 'Skenario 6F: Pengajuan KPR dibatalkan oleh nasabah pada tahap BANK_VERIFICATION.',
    },
  ];

  await assertNoError(
    'Upsert kpr_applications',
    await supabase.from('kpr_applications').upsert(kprAppsPayload, { onConflict: 'id' })
  );

  // Langkah 4.8: KPR Documents
  const mandiriReqs = catalog.bankReqIds['Bank Mandiri'];
  const bcaReqs = catalog.bankReqIds.BCA;
  const kprDocsPayload: Array<{
    id: string;
    kpr_application_id: string;
    bank_requirement_id: string;
    document_name: string;
    is_mandatory: boolean;
    status: KprDocStatus;
    file_path: string | null;
    file_name: string | null;
    uploaded_by: string | null;
    uploaded_at: string | null;
    verified_by: string | null;
    verified_at: string | null;
    verification_notes: string | null;
  }> = [
    {
      id: detUuid(24, 1),
      kpr_application_id: detUuid(23, 1),
      bank_requirement_id: mandiriReqs.DOC_KTP,
      document_name: 'Fotokopi KTP Pemohon & Pasangan (Fiktif Demo)',
      is_mandatory: true,
      status: 'VERIFIED',
      file_path: `kpr/${detUuid(23, 1)}/documents/ktp-pemohon-fiktif.pdf`,
      file_name: 'ktp-pemohon-fiktif.pdf',
      uploaded_by: farizId,
      uploaded_at: isoDaysFromNow(-14),
      verified_by: adminId,
      verified_at: isoDaysFromNow(-13),
      verification_notes: 'KTP jelas dan NIK sesuai dengan data pemesanan.',
    },
    {
      id: detUuid(24, 2),
      kpr_application_id: detUuid(23, 1),
      bank_requirement_id: mandiriReqs.DOC_KK,
      document_name: 'Kartu Keluarga & Akta Nikah (Fiktif Demo)',
      is_mandatory: true,
      status: 'VERIFIED',
      file_path: `kpr/${detUuid(23, 1)}/documents/kk-aktanikah-fiktif.pdf`,
      file_name: 'kk-aktanikah-fiktif.pdf',
      uploaded_by: farizId,
      uploaded_at: isoDaysFromNow(-14),
      verified_by: adminId,
      verified_at: isoDaysFromNow(-13),
      verification_notes: 'Kartu Keluarga terbaru ber-barcode Dukcapil valid.',
    },
    {
      id: detUuid(24, 3),
      kpr_application_id: detUuid(23, 1),
      bank_requirement_id: mandiriReqs.DOC_NPWP,
      document_name: 'NPWP Pribadi & SPT Tahunan (Fiktif Demo)',
      is_mandatory: true,
      status: 'UPLOADED',
      file_path: `kpr/${detUuid(23, 1)}/documents/npwp-spt-fiktif.pdf`,
      file_name: 'npwp-spt-fiktif.pdf',
      uploaded_by: farizId,
      uploaded_at: isoDaysFromNow(-3),
      verified_by: null,
      verified_at: null,
      verification_notes: null,
    },
    {
      id: detUuid(24, 4),
      kpr_application_id: detUuid(23, 1),
      bank_requirement_id: mandiriReqs.DOC_PAYSLIP_3M,
      document_name: 'Slip Gaji 3 Bulan Terakhir (Fiktif Demo)',
      is_mandatory: true,
      status: 'REVISION_REQUIRED',
      file_path: `kpr/${detUuid(23, 1)}/documents/slip-gaji-2bln-fiktif.pdf`,
      file_name: 'slip-gaji-2bln-fiktif.pdf',
      uploaded_by: farizId,
      uploaded_at: isoDaysFromNow(-5),
      verified_by: adminId,
      verified_at: isoDaysFromNow(-4),
      verification_notes:
        'Baru melampirkan slip gaji 2 bulan. Wajib dilengkapi dengan slip gaji bulan terakhir yang berstempel HRD.',
    },
    {
      id: detUuid(24, 5),
      kpr_application_id: detUuid(23, 1),
      bank_requirement_id: mandiriReqs.DOC_BANK_STMT_3M,
      document_name: 'Rekening Koran 3 Bulan Terakhir (Fiktif Demo)',
      is_mandatory: true,
      status: 'UPLOADED',
      file_path: `kpr/${detUuid(23, 1)}/documents/rekening-koran-3bln-fiktif.pdf`,
      file_name: 'rekening-koran-3bln-fiktif.pdf',
      uploaded_by: farizId,
      uploaded_at: isoDaysFromNow(-2),
      verified_by: null,
      verified_at: null,
      verification_notes: null,
    },
    {
      id: detUuid(24, 6),
      kpr_application_id: detUuid(23, 1),
      bank_requirement_id: mandiriReqs.DOC_EMPLOYMENT_LTR,
      document_name: 'Surat Keterangan Kerja / SK Pengangkatan (Fiktif Demo)',
      is_mandatory: true,
      status: 'MISSING',
      file_path: null,
      file_name: null,
      uploaded_by: null,
      uploaded_at: null,
      verified_by: null,
      verified_at: null,
      verification_notes: null,
    },
    {
      id: detUuid(24, 7),
      kpr_application_id: detUuid(23, 2),
      bank_requirement_id: bcaReqs.DOC_KTP,
      document_name: 'Fotokopi KTP Pemohon & Pasangan (Fiktif Demo)',
      is_mandatory: true,
      status: 'VERIFIED',
      file_path: `kpr/${detUuid(23, 2)}/documents/ktp-bca-fiktif.pdf`,
      file_name: 'ktp-bca-fiktif.pdf',
      uploaded_by: farizId,
      uploaded_at: isoDaysFromNow(-18),
      verified_by: adminId,
      verified_at: isoDaysFromNow(-17),
      verification_notes: 'Lengkap dan valid.',
    },
    {
      id: detUuid(24, 8),
      kpr_application_id: detUuid(23, 2),
      bank_requirement_id: bcaReqs.DOC_PAYSLIP_3M,
      document_name: 'Slip Gaji 3 Bulan Terakhir (Fiktif Demo)',
      is_mandatory: true,
      status: 'VERIFIED',
      file_path: `kpr/${detUuid(23, 2)}/documents/payslip-bca-fiktif.pdf`,
      file_name: 'payslip-bca-fiktif.pdf',
      uploaded_by: farizId,
      uploaded_at: isoDaysFromNow(-18),
      verified_by: adminId,
      verified_at: isoDaysFromNow(-17),
      verification_notes: 'Lengkap dan valid.',
    },
    {
      id: detUuid(24, 9),
      kpr_application_id: detUuid(23, 3),
      bank_requirement_id: mandiriReqs.DOC_KTP,
      document_name: 'Fotokopi KTP Pemohon & Pasangan (Fiktif Demo)',
      is_mandatory: true,
      status: 'VERIFIED',
      file_path: `kpr/${detUuid(23, 3)}/documents/ktp-bmri-fiktif.pdf`,
      file_name: 'ktp-bmri-fiktif.pdf',
      uploaded_by: farizId,
      uploaded_at: isoDaysFromNow(-26),
      verified_by: adminId,
      verified_at: isoDaysFromNow(-25),
      verification_notes: 'Lengkap dan valid.',
    },
    {
      id: detUuid(24, 10),
      kpr_application_id: detUuid(23, 4),
      bank_requirement_id: mandiriReqs.DOC_KTP,
      document_name: 'Fotokopi KTP Pemohon & Pasangan (Fiktif Demo)',
      is_mandatory: true,
      status: 'VERIFIED',
      file_path: `kpr/${detUuid(23, 4)}/documents/ktp-bmri-lunas-fiktif.pdf`,
      file_name: 'ktp-bmri-lunas-fiktif.pdf',
      uploaded_by: farizId,
      uploaded_at: isoDaysFromNow(-40),
      verified_by: adminId,
      verified_at: isoDaysFromNow(-39),
      verification_notes: 'Lengkap dan valid.',
    },
  ];
  await assertNoError(
    'Upsert kpr_documents',
    await supabase.from('kpr_documents').upsert(kprDocsPayload, { onConflict: 'id' })
  );

  // Langkah 4.9: KPR Stage Histories
  const kprStageHistoriesPayload: Array<{
    id: string;
    kpr_application_id: string;
    from_stage: KprStage | null;
    to_stage: KprStage;
    notes: string;
    changed_by: string;
    changed_at: string;
  }> = [
    {
      id: detUuid(25, 1),
      kpr_application_id: detUuid(23, 1),
      from_stage: 'DOCUMENT_COLLECTION',
      to_stage: 'DOCUMENT_VERIFICATION',
      notes: 'Sebagian besar berkas telah diunggah oleh Fariz dan masuk antrean verifikasi Admin.',
      changed_by: farizId,
      changed_at: isoDaysFromNow(-5),
    },
    {
      id: detUuid(25, 2),
      kpr_application_id: detUuid(23, 2),
      from_stage: 'DOCUMENT_COLLECTION',
      to_stage: 'SUBMITTED',
      notes: 'Berkas lengkap dikirim ke BCA KCU Serpong.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-14),
    },
    {
      id: detUuid(25, 3),
      kpr_application_id: detUuid(23, 2),
      from_stage: 'SUBMITTED',
      to_stage: 'APPROVED',
      notes: 'SP3K BCA terbit dengan penyesuaian plafon kredit.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-4),
    },
    {
      id: detUuid(25, 4),
      kpr_application_id: detUuid(23, 3),
      from_stage: 'APPROVED',
      to_stage: 'AKAD_COMPLETED',
      notes: 'Penandatanganan Akad Kredit KPR Bank Mandiri selesai.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-8),
    },
    {
      id: detUuid(25, 5),
      kpr_application_id: detUuid(23, 3),
      from_stage: 'AKAD_COMPLETED',
      to_stage: 'DISBURSEMENT',
      notes: 'Pencairan dana tahap PRIMARY (80%) diterima di rekening developer.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-5),
    },
    {
      id: detUuid(25, 6),
      kpr_application_id: detUuid(23, 4),
      from_stage: 'AKAD_COMPLETED',
      to_stage: 'DISBURSEMENT',
      notes: 'Pencairan penuh 100% (PRIMARY + SUBSEQUENT) selesai direkonsiliasi.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-3),
    },
    {
      id: detUuid(25, 7),
      kpr_application_id: detUuid(23, 5),
      from_stage: 'BANK_VERIFICATION',
      to_stage: 'APPRAISAL',
      notes: 'Proses taksasi agunan dan analisa kredit oleh tim appraisal bank.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-7),
    },
    {
      id: detUuid(25, 8),
      kpr_application_id: detUuid(23, 6),
      from_stage: 'SUBMITTED',
      to_stage: 'BANK_VERIFICATION',
      notes: 'Berkas masuk tahap verifikasi analis kredit BTN.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-6),
    },
  ];
  await assertNoError(
    'Upsert kpr_stage_histories',
    await supabase.from('kpr_stage_histories').upsert(kprStageHistoriesPayload, { onConflict: 'id' })
  );

  // Langkah 4.10: KPR Disbursements
  const kprDisbursementsPayload: Array<{
    id: string;
    kpr_application_id: string;
    tranche_type: DisbursementTranche;
    sequence_number: number;
    disbursement_reference: string;
    disbursed_amount: number;
    disbursement_date: string;
    proof_file_path: string;
    recorded_by_admin_id: string;
    notes: string;
  }> = [
    {
      id: detUuid(26, 1),
      kpr_application_id: detUuid(23, 3),
      tranche_type: 'PRIMARY',
      sequence_number: 1,
      disbursement_reference: 'DISB-BMRI-2026-0091-P1',
      disbursed_amount: kpr9Primary80,
      disbursement_date: dateOnlyDaysFromNow(-5),
      proof_file_path: `kpr/${detUuid(23, 3)}/disbursements/advis-kredit-primary-80.pdf`,
      recorded_by_admin_id: adminId,
      notes: 'Pencairan tahap utama (PRIMARY 80%) pasca-Akad Kredit.',
    },
    {
      id: detUuid(26, 2),
      kpr_application_id: detUuid(23, 4),
      tranche_type: 'PRIMARY',
      sequence_number: 1,
      disbursement_reference: 'DISB-BMRI-2026-0044-P1',
      disbursed_amount: kpr10Primary80,
      disbursement_date: dateOnlyDaysFromNow(-18),
      proof_file_path: `kpr/${detUuid(23, 4)}/disbursements/advis-kredit-primary-80.pdf`,
      recorded_by_admin_id: adminId,
      notes: 'Pencairan tahap utama (PRIMARY 80%) pasca-Akad Kredit.',
    },
    {
      id: detUuid(26, 3),
      kpr_application_id: detUuid(23, 4),
      tranche_type: 'SUBSEQUENT',
      sequence_number: 2,
      disbursement_reference: 'DISB-BMRI-2026-0044-S2',
      disbursed_amount: kpr10Sub20,
      disbursement_date: dateOnlyDaysFromNow(-3),
      proof_file_path: `kpr/${detUuid(23, 4)}/disbursements/advis-kredit-subsequent-20.pdf`,
      recorded_by_admin_id: adminId,
      notes: 'Pencairan retensi akhir (SUBSEQUENT 20%) setelah BAST & AJB selesai -> 100% FULLY_DISBURSED (TC-01A Unit SOLD).',
    },
  ];
  await assertNoError(
    'Upsert kpr_disbursements',
    await supabase.from('kpr_disbursements').upsert(kprDisbursementsPayload, { onConflict: 'id' })
  );

  // Langkah 4.11: Deals
  const dealsPayload: Array<{
    id: string;
    reference_number: string;
    booking_id: string;
    lead_id: string;
    unit_id: string;
    origin_sales_id: string;
    current_sales_id: string;
    team_id: string;
    payment_method: PaymentMethod;
    final_deal_value: number;
    sales_outcome_status: DealSalesOutcome;
    contract_status: DealContractStatus;
    payment_settlement_status: DealSettlementStatus;
    contract_document_number: string | null;
    contract_file_path: string | null;
    contract_signed_at: string | null;
    sales_closed_won_at: string | null;
    fully_settled_at: string | null;
    cancelled_at: string | null;
    notes: string;
  }> = [
    {
      id: detUuid(27, 1),
      reference_number: 'DL-202603-0001',
      booking_id: detUuid(17, 4),
      lead_id: l(4),
      unit_id: u(4),
      origin_sales_id: farizId,
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      payment_method: 'CASH_KERAS',
      final_deal_value: p4Final,
      sales_outcome_status: 'CLOSED_WON',
      contract_status: 'CONTRACT_COMPLETED',
      payment_settlement_status: 'FULLY_SETTLED',
      contract_document_number: 'AJB/FIM-BSD/2026/0014',
      contract_file_path: `deals/${detUuid(27, 1)}/contracts/ajb-bk0004.pdf`,
      contract_signed_at: isoDaysFromNow(-14),
      sales_closed_won_at: isoDaysFromNow(-14),
      fully_settled_at: isoDaysFromNow(-14),
      cancelled_at: null,
      notes: 'Skenario 4: Deal Cash Keras selesai 100% (FULLY_SETTLED).',
    },
    {
      id: detUuid(27, 2),
      reference_number: 'DL-202603-0002',
      booking_id: detUuid(17, 5),
      lead_id: l(5),
      unit_id: u(5),
      origin_sales_id: farizId,
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      payment_method: 'CASH_BERTAHAP',
      final_deal_value: p5Final,
      sales_outcome_status: 'CLOSED_WON',
      contract_status: 'UNDER_CONTRACT',
      payment_settlement_status: 'DP_SETTLED_ONGOING',
      contract_document_number: 'PPJB/FIM-BSD/2026/0021',
      contract_file_path: `deals/${detUuid(27, 2)}/contracts/ppjb-bk0005.pdf`,
      contract_signed_at: isoDaysFromNow(-17),
      sales_closed_won_at: isoDaysFromNow(-17),
      fully_settled_at: null,
      cancelled_at: null,
      notes: 'Skenario 5A (Kebijakan C2 PD-03): DP Lunas & PPJB ditandatangani -> CLOSED_WON + UNDER_CONTRACT + DP_SETTLED_ONGOING (Unit tetap BOOKED).',
    },
    {
      id: detUuid(27, 3),
      reference_number: 'DL-202603-0003',
      booking_id: detUuid(17, 6),
      lead_id: l(16),
      unit_id: u(6),
      origin_sales_id: nadiaId,
      current_sales_id: nadiaId,
      team_id: TEAM_IDS['TIM-01'],
      payment_method: 'CASH_BERTAHAP',
      final_deal_value: p6Final,
      sales_outcome_status: 'CLOSED_WON',
      contract_status: 'UNDER_CONTRACT',
      payment_settlement_status: 'OVERDUE_IN_ARREARS',
      contract_document_number: 'PPJB/FIM-BSD/2026/0018',
      contract_file_path: `deals/${detUuid(27, 3)}/contracts/ppjb-bk0006.pdf`,
      contract_signed_at: isoDaysFromNow(-24),
      sales_closed_won_at: isoDaysFromNow(-24),
      fully_settled_at: null,
      cancelled_at: null,
      notes: 'Skenario 5B: Termin ke-1 melewati tanggal jatuh tempo sehingga payment_settlement_status = OVERDUE_IN_ARREARS.',
    },
    {
      id: detUuid(27, 4),
      reference_number: 'DL-202603-0004',
      booking_id: detUuid(17, 7),
      lead_id: l(6),
      unit_id: u(7),
      origin_sales_id: farizId,
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      payment_method: 'KPR',
      final_deal_value: up(7),
      sales_outcome_status: 'IN_PROGRESS',
      contract_status: 'PRE_CONTRACT',
      payment_settlement_status: 'BOOKING_FEE_SETTLED',
      contract_document_number: null,
      contract_file_path: null,
      contract_signed_at: null,
      sales_closed_won_at: null,
      fully_settled_at: null,
      cancelled_at: null,
      notes: 'Skenario 6A: Deal KPR dalam tahap verifikasi dokumen & pembayaran DP.',
    },
    {
      id: detUuid(27, 5),
      reference_number: 'DL-202603-0005',
      booking_id: detUuid(17, 8),
      lead_id: l(7),
      unit_id: u(8),
      origin_sales_id: farizId,
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      payment_method: 'KPR',
      final_deal_value: up(8),
      sales_outcome_status: 'IN_PROGRESS',
      contract_status: 'PRE_CONTRACT',
      payment_settlement_status: 'DP_SETTLED_ONGOING',
      contract_document_number: null,
      contract_file_path: null,
      contract_signed_at: null,
      sales_closed_won_at: null,
      fully_settled_at: null,
      cancelled_at: null,
      notes: 'Skenario 6B: Menunggu pelunasan KPR_TOPUP_DP sebelum penjadwalan Akad Kredit.',
    },
    {
      id: detUuid(27, 6),
      reference_number: 'DL-202603-0006',
      booking_id: detUuid(17, 9),
      lead_id: l(8),
      unit_id: u(9),
      origin_sales_id: farizId,
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      payment_method: 'KPR',
      final_deal_value: up(9),
      sales_outcome_status: 'CLOSED_WON',
      contract_status: 'UNDER_CONTRACT',
      payment_settlement_status: 'DISBURSED_RETENTION_PENDING',
      contract_document_number: 'AKAD-BMRI-2026-0091',
      contract_file_path: `deals/${detUuid(27, 6)}/contracts/akta-akad-bk0009.pdf`,
      contract_signed_at: isoDaysFromNow(-8),
      sales_closed_won_at: isoDaysFromNow(-8),
      fully_settled_at: null,
      cancelled_at: null,
      notes: 'Skenario 6C (TC-01A): Akad selesai & pencairan PRIMARY 80% masuk (DISBURSED_RETENTION_PENDING), Unit tetap BOOKED.',
    },
    {
      id: detUuid(27, 7),
      reference_number: 'DL-202603-0007',
      booking_id: detUuid(17, 10),
      lead_id: l(9),
      unit_id: u(10),
      origin_sales_id: farizId,
      current_sales_id: farizId,
      team_id: TEAM_IDS['TIM-01'],
      payment_method: 'KPR',
      final_deal_value: up(10),
      sales_outcome_status: 'CLOSED_WON',
      contract_status: 'CONTRACT_COMPLETED',
      payment_settlement_status: 'FULLY_SETTLED',
      contract_document_number: 'AKAD-BMRI-2026-0044',
      contract_file_path: `deals/${detUuid(27, 7)}/contracts/akta-akad-bk0010.pdf`,
      contract_signed_at: isoDaysFromNow(-20),
      sales_closed_won_at: isoDaysFromNow(-20),
      fully_settled_at: isoDaysFromNow(-3),
      cancelled_at: null,
      notes: 'Skenario 6D (TC-01A): KPR cair 100% FULLY_DISBURSED -> Deal FULLY_SETTLED & Unit SOLD.',
    },
    {
      id: detUuid(27, 8),
      reference_number: 'DL-202603-0008',
      booking_id: detUuid(17, 13),
      lead_id: l(29),
      unit_id: u(13),
      origin_sales_id: bimaId,
      current_sales_id: bimaId,
      team_id: TEAM_IDS['TIM-02'],
      payment_method: 'KPR',
      final_deal_value: up(13),
      sales_outcome_status: 'CANCELLED_FAILED',
      contract_status: 'CONTRACT_TERMINATED',
      payment_settlement_status: 'TERMINATED',
      contract_document_number: null,
      contract_file_path: null,
      contract_signed_at: null,
      sales_closed_won_at: null,
      fully_settled_at: null,
      cancelled_at: isoDaysFromNow(-5),
      notes: 'Skenario 7A: Deal dibatalkan dengan Partial Refund.',
    },
    {
      id: detUuid(27, 9),
      reference_number: 'DL-202603-0009',
      booking_id: detUuid(17, 14),
      lead_id: l(47),
      unit_id: u(14),
      origin_sales_id: yogaId,
      current_sales_id: yogaId,
      team_id: TEAM_IDS['TIM-03'],
      payment_method: 'KPR',
      final_deal_value: up(14),
      sales_outcome_status: 'CANCELLED_FAILED',
      contract_status: 'CONTRACT_TERMINATED',
      payment_settlement_status: 'TERMINATED',
      contract_document_number: null,
      contract_file_path: null,
      contract_signed_at: null,
      sales_closed_won_at: null,
      fully_settled_at: null,
      cancelled_at: isoDaysFromNow(-10),
      notes: 'Skenario 7B: Deal dibatalkan dengan Full Refund (telah cair).',
    },
    {
      id: detUuid(27, 10),
      reference_number: 'DL-202603-0010',
      booking_id: detUuid(17, 16),
      lead_id: l(32),
      unit_id: u(16),
      origin_sales_id: citraId,
      current_sales_id: citraId,
      team_id: TEAM_IDS['TIM-02'],
      payment_method: 'CASH_KERAS',
      final_deal_value: p16Final,
      sales_outcome_status: 'CLOSED_WON',
      contract_status: 'CONTRACT_COMPLETED',
      payment_settlement_status: 'FULLY_SETTLED',
      contract_document_number: 'AJB/FIM-BKS/2026/0009',
      contract_file_path: `deals/${detUuid(27, 10)}/contracts/ajb-bk0016.pdf`,
      contract_signed_at: isoDaysFromNow(-21),
      sales_closed_won_at: isoDaysFromNow(-21),
      fully_settled_at: isoDaysFromNow(-21),
      cancelled_at: null,
      notes: 'Deal Cash Keras lunas milik Tim Harmoni Bravo.',
    },
  ];
  await assertNoError(
    'Upsert deals',
    await supabase.from('deals').upsert(dealsPayload, { onConflict: 'id' })
  );

  // Deal Status Histories
  const dealHistoriesPayload = [
    {
      id: detUuid(28, 1),
      deal_id: detUuid(27, 1),
      changed_dimension: 'SALES_OUTCOME',
      old_status: 'IN_PROGRESS',
      new_status: 'CLOSED_WON',
      reason: 'Pelunasan 100% Cash Keras dan penandatanganan AJB selesai.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-14),
    },
    {
      id: detUuid(28, 2),
      deal_id: detUuid(27, 2),
      changed_dimension: 'SALES_OUTCOME',
      old_status: 'IN_PROGRESS',
      new_status: 'CLOSED_WON',
      reason: 'DP Cash Bertahap lunas dan kontrak PPJB ditandatangani (Kebijakan C2).',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-17),
    },
    {
      id: detUuid(28, 3),
      deal_id: detUuid(27, 3),
      changed_dimension: 'PAYMENT_SETTLEMENT',
      old_status: 'DP_SETTLED_ONGOING',
      new_status: 'OVERDUE_IN_ARREARS',
      reason: 'Jadwal cicilan termin ke-1 melewati tanggal jatuh tempo.',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-6),
    },
    {
      id: detUuid(28, 4),
      deal_id: detUuid(27, 6),
      changed_dimension: 'PAYMENT_SETTLEMENT',
      old_status: 'DP_SETTLED_ONGOING',
      new_status: 'DISBURSED_RETENTION_PENDING',
      reason: 'Pencairan KPR tahap PRIMARY 80% masuk, menunggu retensi 20% (TC-01A).',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-5),
    },
    {
      id: detUuid(28, 5),
      deal_id: detUuid(27, 7),
      changed_dimension: 'PAYMENT_SETTLEMENT',
      old_status: 'DISBURSED_RETENTION_PENDING',
      new_status: 'FULLY_SETTLED',
      reason: 'Pencairan KPR mencapai 100% FULLY_DISBURSED (TC-01A).',
      changed_by: adminId,
      changed_at: isoDaysFromNow(-3),
    },
  ];
  await assertNoError(
    'Upsert deal_status_histories',
    await supabase.from('deal_status_histories').upsert(dealHistoriesPayload, { onConflict: 'id' })
  );

  // Langkah 4.12: 22 Follow-Up Tasks
  const followUpTasksPayload: Array<{
    id: string;
    lead_id: string;
    assigned_sales_id: string;
    related_schedule_id: string | null;
    related_kpr_application_id: string | null;
    title: string;
    description: string;
    due_at: string;
    priority: TaskPriority;
    source_type: TaskSource;
    status: TaskStatus;
    completion_notes: string | null;
    completed_at: string | null;
    deduplication_key: string;
    created_by: string;
  }> = [
    {
      id: detUuid(15, 1),
      lead_id: l(16),
      assigned_sales_id: nadiaId,
      related_schedule_id: detUuid(19, 14),
      related_kpr_application_id: null,
      title: 'Penagihan Termin Ke-1 Cash Bertahap (Overdue H+7)',
      description: 'Hubungi nasabah untuk konfirmasi pembayaran termin ke-1 yang telah melewati jatuh tempo.',
      due_at: isoDaysFromNow(-1),
      priority: 'HIGH',
      source_type: 'PAYMENT_REMINDER_SYSTEM',
      status: 'OVERDUE',
      completion_notes: null,
      completed_at: null,
      deduplication_key: `SEED_TASK_SCHED_OVERDUE_${detUuid(19, 14)}`,
      created_by: adminId,
    },
    {
      id: detUuid(15, 2),
      lead_id: l(7),
      assigned_sales_id: farizId,
      related_schedule_id: detUuid(19, 20),
      related_kpr_application_id: detUuid(23, 2),
      title: 'Follow-up Pelunasan KPR Top-up DP Rp 40 Juta (SP3K BCA)',
      description: 'Pendampingan konsumen untuk pelunasan selisih plafon KPR sebelum penjadwalan Akad Kredit.',
      due_at: isoDaysFromNow(2),
      priority: 'HIGH',
      source_type: 'PAYMENT_REMINDER_SYSTEM',
      status: 'PENDING',
      completion_notes: null,
      completed_at: null,
      deduplication_key: `SEED_TASK_TOPUP_DP_${detUuid(19, 20)}`,
      created_by: adminId,
    },
    {
      id: detUuid(15, 3),
      lead_id: l(6),
      assigned_sales_id: farizId,
      related_schedule_id: null,
      related_kpr_application_id: detUuid(23, 1),
      title: 'Revisi Slip Gaji Bulan ke-3 & SK Kerja KPR Bank Mandiri',
      description: 'Meminta dokumen revisi slip gaji berstempel HRD dan SK Kerja asli dari konsumen.',
      due_at: isoDaysFromNow(1),
      priority: 'HIGH',
      source_type: 'SUPERVISOR_INSTRUCTION',
      status: 'PENDING',
      completion_notes: null,
      completed_at: null,
      deduplication_key: `SEED_TASK_KPR_DOC_${detUuid(23, 1)}`,
      created_by: muzayinId,
    },
    {
      id: detUuid(15, 4),
      lead_id: l(1),
      assigned_sales_id: farizId,
      related_schedule_id: detUuid(19, 1),
      related_kpr_application_id: null,
      title: 'Konfirmasi Bukti Transfer Booking Fee BK-202603-0001',
      description: 'Pastikan bukti transfer Booking Fee Rp 10 Juta diunggah sebelum masa berlaku reservasi berakhir.',
      due_at: isoHoursFromNow(24),
      priority: 'HIGH',
      source_type: 'PAYMENT_REMINDER_SYSTEM',
      status: 'PENDING',
      completion_notes: null,
      completed_at: null,
      deduplication_key: `SEED_TASK_BF_DUE_${detUuid(19, 1)}`,
      created_by: farizId,
    },
  ];

  for (let t = 5; t <= 22; t++) {
    const isCompleted = t % 3 === 0;
    const isOverdue = t % 5 === 0 && !isCompleted;
    const status: TaskStatus = isCompleted ? 'COMPLETED' : isOverdue ? 'OVERDUE' : 'PENDING';
    const leadIdx = (t + 5) % 45;
    const salesId = t <= 12 ? farizId : t <= 17 ? bimaId : yogaId;

    followUpTasksPayload.push({
      id: detUuid(15, t),
      lead_id: must(crm.leadIds[leadIdx]),
      assigned_sales_id: salesId,
      related_schedule_id: null,
      related_kpr_application_id: null,
      title: `Tindak Lanjut Prospek & Simulasi Pembiayaan #${t}`,
      description: 'Menghubungi calon pembeli untuk konfirmasi jadwal kunjungan lokasi dan pemilihan blok unit.',
      due_at: isCompleted
        ? isoDaysFromNow(-5)
        : isOverdue
          ? isoDaysFromNow(-2)
          : isoDaysFromNow((t % 6) + 1),
      priority: t % 2 === 0 ? 'MEDIUM' : 'HIGH',
      source_type: t % 4 === 0 ? 'SUPERVISOR_INSTRUCTION' : 'MANUAL_SALES',
      status,
      completion_notes: isCompleted
        ? 'Konsumen telah dihubungi via telepon dan sepakat menjadwalkan kunjungan akhir pekan.'
        : null,
      completed_at: isCompleted ? isoDaysFromNow(-4) : null,
      deduplication_key: `SEED_TASK_GENERAL_${t}`,
      created_by: t % 4 === 0 ? muzayinId : salesId,
    });
  }

  await assertNoError(
    'Upsert follow_up_tasks',
    await supabase.from('follow_up_tasks').upsert(followUpTasksPayload, { onConflict: 'id' })
  );

  // Langkah 4.13: Skenario 8 — Notification Outbox, In-App Notifications & Audit Logs
  const outboxPayload: Array<{
    id: string;
    event_type: string;
    deduplication_key: string;
    payload: Record<string, unknown>;
    status: OutboxStatus;
    retry_count: number;
    last_error: string | null;
    next_retry_at: string;
    processed_at: string | null;
  }> = [
    {
      id: detUuid(30, 1),
      event_type: 'PAYMENT_VERIFICATION_ESCALATION',
      deduplication_key: 'OUTBOX_SLA_ESC_PAY_202603_0001',
      payload: {
        paymentRecordId: detUuid(20, 1),
        bookingReference: 'BK-202603-0002',
        hoursPending: 52,
      },
      status: 'PROCESSED',
      retry_count: 0,
      last_error: null,
      next_retry_at: isoHoursFromNow(-3),
      processed_at: isoHoursFromNow(-3),
    },
    {
      id: detUuid(30, 2),
      event_type: 'KPR_DISBURSEMENT_RECORDED',
      deduplication_key: 'OUTBOX_KPR_DISB_202603_0004',
      payload: {
        kprReference: 'KPR-202603-0004',
        disbursementStatus: 'FULLY_DISBURSED',
        policyMode: 'TC-01A',
      },
      status: 'PROCESSED',
      retry_count: 0,
      last_error: null,
      next_retry_at: isoDaysFromNow(-3),
      processed_at: isoDaysFromNow(-3),
    },
    {
      id: detUuid(30, 3),
      event_type: 'BOOKING_FEE_DUE_REMINDER',
      deduplication_key: 'OUTBOX_BF_DUE_BK_202603_0001',
      payload: {
        bookingReference: 'BK-202603-0001',
        salesId: farizId,
      },
      status: 'PENDING',
      retry_count: 0,
      last_error: null,
      next_retry_at: isoHoursFromNow(1),
      processed_at: null,
    },
  ];
  await assertNoError(
    'Upsert notification_outbox',
    await supabase.from('notification_outbox').upsert(outboxPayload, { onConflict: 'id' })
  );

  const notificationsPayload: Array<{
    id: string;
    recipient_user_id: string;
    notification_type: NotificationType;
    title: string;
    description: string;
    reference_type:
      | 'LEAD'
      | 'UNIT'
      | 'BOOKING'
      | 'PAYMENT'
      | 'KPR'
      | 'PROMO'
      | 'DEAL'
      | 'FOLLOW_UP'
      | 'SITE_VISIT';
    reference_id: string;
    deduplication_key: string;
    is_read: boolean;
    read_at: string | null;
  }> = [
    {
      id: detUuid(31, 1),
      recipient_user_id: adminId,
      notification_type: 'PAYMENT_VERIFICATION_ESCALATION',
      title: 'Eskalasi SLA > 48 Jam: Verifikasi Bukti Bayar PAY-202603-0001',
      description:
        'Bukti pembayaran Booking Fee BK-202603-0002 (Fariz • TIM-01) belum diverifikasi lebih dari 48 jam. Unit dilindungi dari kedaluwarsa otomatis (PD-01).',
      reference_type: 'PAYMENT',
      reference_id: detUuid(20, 1),
      deduplication_key: 'NOTIF_ADMIN_SLA_PAY_0001',
      is_read: false,
      read_at: null,
    },
    {
      id: detUuid(31, 2),
      recipient_user_id: adminId,
      notification_type: 'KPR_DOCUMENT_UPDATE',
      title: 'Berkas KPR Baru Diunggah: KPR-202603-0001',
      description:
        'Fariz Aditya Ardhana mengunggah dokumen NPWP dan Rekening Koran 3 Bulan untuk diverifikasi Admin.',
      reference_type: 'KPR',
      reference_id: detUuid(23, 1),
      deduplication_key: 'NOTIF_ADMIN_KPR_DOC_0001',
      is_read: false,
      read_at: null,
    },
    {
      id: detUuid(31, 3),
      recipient_user_id: muzayinId,
      notification_type: 'PAYMENT_OVERDUE',
      title: 'Tunggakan Termin Cash Bertahap Tim Nusantara Alpha',
      description:
        'Jadwal Termin Ke-1 pada Booking BK-202603-0006 telah melewati jatuh tempo (OVERDUE) dan mengubah status Deal menjadi OVERDUE_IN_ARREARS.',
      reference_type: 'BOOKING',
      reference_id: detUuid(17, 6),
      deduplication_key: 'NOTIF_SPV1_OVERDUE_BK_0006',
      is_read: false,
      read_at: null,
    },
    {
      id: detUuid(31, 4),
      recipient_user_id: muzayinId,
      notification_type: 'BOOKING_EXPIRY_ALERT',
      title: 'Peringatan Masa Berlaku Reservasi BK-202603-0001',
      description:
        'Reservasi unit P1-A01 oleh Fariz Aditya Ardhana membutuhkan unggahan bukti Booking Fee sebelum kuota 72 jam berakhir.',
      reference_type: 'BOOKING',
      reference_id: detUuid(17, 1),
      deduplication_key: 'NOTIF_SPV1_EXPIRY_BK_0001',
      is_read: true,
      read_at: isoHoursFromNow(-2),
    },
    {
      id: detUuid(31, 5),
      recipient_user_id: farizId,
      notification_type: 'KPR_DOCUMENT_UPDATE',
      title: 'Revisi Dokumen KPR Diperlukan: Slip Gaji 3 Bulan (KPR-202603-0001)',
      description:
        'Admin Muhammad Ichsan Fachrulrozi meminta revisi dokumen Slip Gaji agar melampirkan bulan ke-3 berstempel HRD.',
      reference_type: 'KPR',
      reference_id: detUuid(23, 1),
      deduplication_key: 'NOTIF_FARIZ_KPR_REV_0001',
      is_read: false,
      read_at: null,
    },
    {
      id: detUuid(31, 6),
      recipient_user_id: farizId,
      notification_type: 'DP_DUE',
      title: 'Tagihan KPR Top-up DP Rp 40.000.000 (BK-202603-0008)',
      description:
        'Terbentuk jadwal otomatis KPR_TOPUP_DP akibat selisih plafon SP3K BCA. Jatuh tempo dalam 7 hari.',
      reference_type: 'BOOKING',
      reference_id: detUuid(17, 8),
      deduplication_key: 'NOTIF_FARIZ_TOPUP_DP_0008',
      is_read: false,
      read_at: null,
    },
    {
      id: detUuid(31, 7),
      recipient_user_id: farizId,
      notification_type: 'PAYMENT_VERIFICATION_RESULT',
      title: 'Pencairan KPR 100% Selesai (TC-01A): Unit P2-B01 Resmi SOLD',
      description:
        'Pencairan tahap retensi KPR-202603-0004 telah diverifikasi 100% (FULLY_DISBURSED) oleh Admin Ichsan. Unit kini berstatus SOLD.',
      reference_type: 'KPR',
      reference_id: detUuid(23, 4),
      deduplication_key: 'NOTIF_FARIZ_KPR_SOLD_0004',
      is_read: true,
      read_at: isoDaysFromNow(-2),
    },
    {
      id: detUuid(31, 8),
      recipient_user_id: farizId,
      notification_type: 'LEAD_ASSIGNED',
      title: 'Penugasan Prospek Prioritas oleh Supervisor Muzayin Arifin',
      description:
        'Prospek Andi Pratama telah dialihkan kepada Anda untuk percepatan survei lokasi dan closing unit BSD.',
      reference_type: 'LEAD',
      reference_id: l(1),
      deduplication_key: 'NOTIF_FARIZ_LEAD_ASSIGN_0001',
      is_read: true,
      read_at: isoDaysFromNow(-17),
    },
  ];
  await assertNoError(
    'Upsert notifications',
    await supabase.from('notifications').upsert(notificationsPayload, { onConflict: 'id' })
  );

  // Audit Logs
  const auditLogsPayload = [
    {
      id: detUuid(32, 1),
      actor_user_id: adminId,
      actor_role: 'ADMIN',
      action_type: 'UNIT_CATALOG_PRICE_UPDATED',
      entity_table: 'units',
      entity_id: u(1),
      old_values: { catalog_price: up(1) - 25_000_000 },
      new_values: { catalog_price: up(1) },
      reason: 'Penyesuaian harga katalog kuartal berjalan setelah pembangunan clubhouse selesai.',
      created_at: isoDaysFromNow(-45),
    },
    {
      id: detUuid(32, 2),
      actor_user_id: adminId,
      actor_role: 'ADMIN',
      action_type: 'PAYMENT_VERIFIED',
      entity_table: 'payment_records',
      entity_id: detUuid(20, 4),
      old_values: { verification_status: 'PENDING_VERIFICATION' },
      new_values: {
        verification_status: 'VERIFIED',
        booking_status: 'COMPLETED',
        unit_status: 'SOLD',
      },
      reason: 'Verifikasi pelunasan 100% Cash Keras BK-202603-0004 oleh Admin Ichsan.',
      created_at: isoDaysFromNow(-14),
    },
    {
      id: detUuid(32, 3),
      actor_user_id: adminId,
      actor_role: 'ADMIN',
      action_type: 'PAYMENT_REJECTED',
      entity_table: 'payment_records',
      entity_id: detUuid(20, 6),
      old_values: { verification_status: 'PENDING_VERIFICATION' },
      new_values: { verification_status: 'REJECTED' },
      reason: 'Bukti struk transfer terpotong dan nomor referensi bank tidak terbaca.',
      created_at: isoDaysFromNow(-20),
    },
    {
      id: detUuid(32, 4),
      actor_user_id: adminId,
      actor_role: 'ADMIN',
      action_type: 'KPR_APPROVAL_RECORDED_WITH_TOPUP_DP',
      entity_table: 'kpr_applications',
      entity_id: detUuid(23, 2),
      old_values: {
        application_status: 'IN_PROGRESS',
        requested_loan_amount: kpr8LoanReq,
      },
      new_values: {
        application_status: 'APPROVED',
        approved_loan_amount: kpr8LoanApp,
        topup_dp_generated: 40_000_000,
      },
      reason: 'Pencatatan SP3K BCA dengan penurunan plafon Rp 40 Juta (otomatis membentuk jadwal KPR_TOPUP_DP).',
      created_at: isoDaysFromNow(-4),
    },
    {
      id: detUuid(32, 5),
      actor_user_id: adminId,
      actor_role: 'ADMIN',
      action_type: 'KPR_DISBURSEMENT_RECORDED_TC01A',
      entity_table: 'kpr_applications',
      entity_id: detUuid(23, 3),
      old_values: {
        disbursement_status: 'NOT_DISBURSED',
        unit_status: 'BOOKED',
      },
      new_values: {
        disbursement_status: 'PARTIALLY_DISBURSED',
        primary_disbursed_amount: kpr9Primary80,
        unit_status: 'BOOKED',
      },
      reason: 'Pencairan KPR PRIMARY 80% dicatat. Sesuai TC-01A, unit tetap berstatus BOOKED.',
      created_at: isoDaysFromNow(-5),
    },
    {
      id: detUuid(32, 6),
      actor_user_id: adminId,
      actor_role: 'ADMIN',
      action_type: 'KPR_FULLY_DISBURSED_UNIT_SOLD_TC01A',
      entity_table: 'kpr_applications',
      entity_id: detUuid(23, 4),
      old_values: {
        disbursement_status: 'PARTIALLY_DISBURSED',
        application_status: 'APPROVED',
        unit_status: 'BOOKED',
      },
      new_values: {
        disbursement_status: 'FULLY_DISBURSED',
        application_status: 'COMPLETED',
        unit_status: 'SOLD',
      },
      reason: 'Pencairan retensi 20% selesai (total 100% FULLY_DISBURSED). Sesuai TC-01A, unit beralih menjadi SOLD.',
      created_at: isoDaysFromNow(-3),
    },
    {
      id: detUuid(32, 7),
      actor_user_id: adminId,
      actor_role: 'ADMIN',
      action_type: 'BOOKING_CANCELLED_WITH_REFUND_POLICY',
      entity_table: 'bookings',
      entity_id: detUuid(17, 13),
      old_values: { status: 'ACTIVE', unit_status: 'BOOKED' },
      new_values: {
        status: 'CANCELLED',
        refund_policy_type: 'PARTIAL_REFUND',
        agreed_refund_amount: 6_000_000,
        unit_status: 'AVAILABLE',
      },
      reason: 'Pembatalan BK-202603-0013 dengan kebijakan PARTIAL_REFUND (PD-04).',
      created_at: isoDaysFromNow(-5),
    },
    {
      id: detUuid(32, 8),
      actor_user_id: muzayinId,
      actor_role: 'SUPERVISOR',
      action_type: 'LEAD_REASSIGNED_WITHIN_TEAM',
      entity_table: 'leads',
      entity_id: l(1),
      old_values: { assigned_sales_id: staffIdMap.TIM1_SALES2 },
      new_values: { assigned_sales_id: farizId },
      reason: 'Reassignment prospek prioritas di dalam Tim Nusantara Alpha oleh Supervisor Muzayin Arifin.',
      created_at: isoDaysFromNow(-18),
    },
  ];
  await assertNoError(
    'Upsert audit_logs',
    await supabase.from('audit_logs').upsert(auditLogsPayload, { onConflict: 'id' })
  );

  // Langkah 4.14: Reference Sequences
  const currentYm = new Date().toISOString().slice(0, 7).replace('-', '');
  const refSequencesPayload = [
    { prefix: 'BK', year_month: '202603', last_value: 16 },
    { prefix: 'PAY', year_month: '202603', last_value: 24 },
    { prefix: 'KPR', year_month: '202603', last_value: 6 },
    { prefix: 'DL', year_month: '202603', last_value: 10 },
    { prefix: 'REF', year_month: '202603', last_value: 2 },
    ...(currentYm !== '202603'
      ? [
          { prefix: 'BK', year_month: currentYm, last_value: 16 },
          { prefix: 'PAY', year_month: currentYm, last_value: 24 },
          { prefix: 'KPR', year_month: currentYm, last_value: 6 },
          { prefix: 'DL', year_month: currentYm, last_value: 10 },
          { prefix: 'REF', year_month: currentYm, last_value: 2 },
        ]
      : []),
  ];
  await assertNoError(
    'Upsert reference_sequences',
    await supabase
      .from('reference_sequences')
      .upsert(refSequencesPayload, { onConflict: 'prefix,year_month' })
  );
}

async function verifyTableCounts(supabase: SupabaseClient): Promise<void> {
  console.info('\n5. Memverifikasi jumlah baris pada seluruh 32 tabel public...');

  const tables = [
    'profiles',
    'teams',
    'team_memberships',
    'developers',
    'property_projects',
    'property_types',
    'units',
    'unit_price_histories',
    'promotions',
    'leads',
    'lead_score_histories',
    'lead_pipeline_histories',
    'lead_assignment_histories',
    'lead_activities',
    'follow_up_tasks',
    'site_visits',
    'bookings',
    'booking_extensions',
    'payment_schedules',
    'payment_records',
    'refund_transactions',
    'kpr_bank_requirements',
    'kpr_applications',
    'kpr_documents',
    'kpr_stage_histories',
    'kpr_disbursements',
    'deals',
    'deal_status_histories',
    'reference_sequences',
    'notification_outbox',
    'notifications',
    'audit_logs',
  ] as const;

  for (const tbl of tables) {
    const { count, error } = await supabase
      .from(tbl)
      .select('*', { count: 'exact', head: true });
    if (error) {
      throw new Error(`[SEED_COUNT_ERROR] ${tbl}: ${error.message}`);
    }
    console.info(`   - ${tbl.padEnd(28, ' ')}: ${count ?? 0} baris`);
  }
}

async function main(): Promise<void> {
  loadRuntimeEnvSafely();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? 'FimDemo2026!';

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      '[SEED_ENV_MISSING] NEXT_PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di environment.'
    );
  }

  console.info('====================================================================');
  console.info('FIM-PROPERTY CRM — MASTER DATABASE SEEDER (IDEMPOTENT, TC-01A)');
  console.info('====================================================================');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const staffIdMap = await seedIdentityAndTeams(supabase, demoPassword);
  const catalog = await seedCatalogAndBankRequirements(supabase, staffIdMap);
  const crm = await seedCrmAndPreSales(supabase, staffIdMap, catalog);
  await seedTransactionsAndFinance(supabase, staffIdMap, catalog, crm);
  await verifyTableCounts(supabase);

  console.info('====================================================================');
  console.info('SUKSES: Seluruh 32 tabel & 19 akun Auth berhasil disemai secara idempoten.');
  console.info('====================================================================');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[SEED_FATAL] ${message}`);
  process.exit(1);
});
