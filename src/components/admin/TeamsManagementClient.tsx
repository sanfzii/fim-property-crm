// Lokasi: src/components/admin/TeamsManagementClient.tsx
// Client Component Manajemen Tim Penjualan & Penugasan Anggota (DESIGN.md v2.1 Bagian 7.9)

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Network,
  UserPlus,
  Users,
  ShieldCheck,
  History,
} from 'lucide-react';
import type { SystemRole, TeamMemberRole } from '@/types/database.types';
import {
  createTeamAction,
  assignTeamMemberAction,
} from '@/modules/identity/teams/teams.actions';
import { formatDateID, formatDateTimeID } from '@/lib/utils/format';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';

export interface TeamActiveMemberDto {
  membershipId: string;
  profileId: string;
  fullName: string;
  email: string;
  phone: string;
  membershipRole: TeamMemberRole;
  joinedAt: string;
  notes: string | null;
}

export interface AdminTeamCardDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  supervisor: TeamActiveMemberDto | null;
  salesMembers: TeamActiveMemberDto[];
}

export interface AssignableStaffDto {
  id: string;
  fullName: string;
  email: string;
  systemRole: SystemRole;
  currentTeamCode: string | null;
  currentTeamName: string | null;
}

export interface TeamMembershipHistoryDto {
  id: string;
  teamCode: string;
  teamName: string;
  staffName: string;
  staffEmail: string;
  membershipRole: TeamMemberRole;
  isActive: boolean;
  joinedAt: string;
  leftAt: string | null;
  notes: string | null;
}

export interface TeamsManagementClientProps {
  teams: AdminTeamCardDto[];
  assignableStaff: AssignableStaffDto[];
  membershipHistory: TeamMembershipHistoryDto[];
}

export function TeamsManagementClient({
  teams,
  assignableStaff,
  membershipHistory,
}: TeamsManagementClientProps) {
  const router = useRouter();
  const { showToast } = useToast();

  // Modal + Buat Tim Baru State
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [newTeamCode, setNewTeamCode] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [createTeamError, setCreateTeamError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  // Modal Tugaskan / Pindahkan Anggota State
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [assignTeamId, setAssignTeamId] = useState(teams[0]?.id ?? '');
  const [assignRole, setAssignRole] = useState<TeamMemberRole>('TEAM_SALES');
  const [assignProfileId, setAssignProfileId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);

  const eligibleStaffForRole = assignableStaff.filter((s) =>
    assignRole === 'TEAM_SUPERVISOR'
      ? s.systemRole === 'SUPERVISOR'
      : s.systemRole === 'SALES'
  );

  const openAssignModal = (preselectedTeamId?: string, role?: TeamMemberRole) => {
    const initialRole = role ?? 'TEAM_SALES';
    const matchingStaff = assignableStaff.filter((s) =>
      initialRole === 'TEAM_SUPERVISOR'
        ? s.systemRole === 'SUPERVISOR'
        : s.systemRole === 'SALES'
    );
    setAssignTeamId(preselectedTeamId ?? teams[0]?.id ?? '');
    setAssignRole(initialRole);
    setAssignProfileId(matchingStaff[0]?.id ?? '');
    setAssignNotes('');
    setAssignError(null);
    setIsAssignOpen(true);
  };

  const handleRoleChangeInModal = (nextRole: TeamMemberRole) => {
    setAssignRole(nextRole);
    const matching = assignableStaff.filter((s) =>
      nextRole === 'TEAM_SUPERVISOR'
        ? s.systemRole === 'SUPERVISOR'
        : s.systemRole === 'SALES'
    );
    setAssignProfileId(matching[0]?.id ?? '');
  };

  const handleCreateTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingTeam) return;
    setIsCreatingTeam(true);
    setCreateTeamError(null);

    try {
      const result = await createTeamAction({
        code: newTeamCode,
        name: newTeamName,
        description: newTeamDesc || null,
        isActive: true,
      });

      if (result.success) {
        showToast({
          title: 'Tim Penjualan Dibuat',
          description: result.message,
          tone: 'success',
        });
        setIsCreateTeamOpen(false);
        setNewTeamCode('');
        setNewTeamName('');
        setNewTeamDesc('');
        router.refresh();
      } else {
        setCreateTeamError({
          message: result.message,
          correlationId: result.correlationId,
        });
        showToast({
          title: 'Gagal Membuat Tim',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      setCreateTeamError({
        message: 'Terjadi gangguan jaringan saat membuat tim.',
      });
    } finally {
      setIsCreatingTeam(false);
    }
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAssigning) return;
    setIsAssigning(true);
    setAssignError(null);

    try {
      const result = await assignTeamMemberAction({
        teamId: assignTeamId,
        profileId: assignProfileId,
        membershipRole: assignRole,
        notes: assignNotes,
      });

      if (result.success) {
        showToast({
          title: 'Penugasan Tim Berhasil',
          description: result.message,
          tone: 'success',
        });
        setIsAssignOpen(false);
        router.refresh();
      } else {
        setAssignError({
          message: result.message,
          correlationId: result.correlationId,
        });
        showToast({
          title: 'Gagal Menugaskan Anggota',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      setAssignError({
        message: 'Terjadi gangguan jaringan saat menyimpan penugasan tim.',
      });
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Manajemen Tim
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            Struktur tim penjualan, supervisor aktif, dan penugasan anggota.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="secondary"
            onClick={() => openAssignModal()}
            leftIcon={<UserPlus className="h-4 w-4" strokeWidth={1.75} />}
          >
            Tugaskan Anggota
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setCreateTeamError(null);
              setIsCreateTeamOpen(true);
            }}
          >
            + Buat Tim
          </Button>
        </div>
      </div>

      {/* Grid Kartu Tim Penjualan (TIM-01, TIM-02, TIM-03, dst.) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {teams.map((team) => (
          <Card key={team.id} className="flex flex-col">
            <CardHeader>
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#14532D] px-2 py-0.5 font-mono text-xs font-bold text-white">
                    {team.code}
                  </span>
                  {team.isActive ? (
                    <Badge tone="emerald">AKTIF</Badge>
                  ) : (
                    <Badge tone="red">NONAKTIF</Badge>
                  )}
                </div>
                <CardTitle className="mt-1.5">{team.name}</CardTitle>
                {team.description && (
                  <CardDescription>{team.description}</CardDescription>
                )}
              </div>
              <Network
                className="h-5 w-5 shrink-0 text-[#14532D]"
                strokeWidth={1.75}
              />
            </CardHeader>

            <CardContent className="flex flex-1 flex-col justify-between space-y-4">
              <div className="space-y-4">
                {/* Supervisor Aktif */}
                <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF]/60 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#1D4ED8] uppercase">
                      <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Supervisor Tim
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        openAssignModal(team.id, 'TEAM_SUPERVISOR')
                      }
                      className="text-[11px] font-semibold text-[#1D4ED8] hover:underline"
                    >
                      Ganti Supervisor
                    </button>
                  </div>

                  {team.supervisor ? (
                    <div className="mt-2">
                      <p className="text-xs font-bold text-[#0F172A]">
                        {team.supervisor.fullName}
                      </p>
                      <p className="font-mono text-[11px] text-[#475569]">
                        {team.supervisor.email}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#64748B]">
                        Menjabat sejak {formatDateID(team.supervisor.joinedAt)}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[#B45309]">
                      Belum ada Supervisor aktif di tim ini.
                    </p>
                  )}
                </div>

                {/* Daftar Anggota Sales Aktif */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F172A]">
                      <Users
                        className="h-3.5 w-3.5 text-[#14532D]"
                        strokeWidth={1.75}
                      />
                      Anggota Sales Aktif ({team.salesMembers.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => openAssignModal(team.id, 'TEAM_SALES')}
                      className="text-xs font-semibold text-[#059669] hover:underline"
                    >
                      + Tambah Sales
                    </button>
                  </div>

                  {team.salesMembers.length === 0 ? (
                    <p className="mt-2 rounded-md border border-dashed border-[#CBD5E1] p-3 text-center text-xs text-[#64748B]">
                      Belum ada anggota Sales aktif.
                    </p>
                  ) : (
                    <ul className="mt-2 divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                      {team.salesMembers.map((member) => (
                        <li
                          key={member.membershipId}
                          className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[#0F172A]">
                              {member.fullName}
                            </p>
                            <p className="truncate font-mono text-[11px] text-[#64748B]">
                              {member.email}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-[#64748B] tabular-nums">
                            {formatDateID(member.joinedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="border-t border-[#E2E8F0] pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => openAssignModal(team.id, 'TEAM_SALES')}
                  leftIcon={<UserPlus className="h-3.5 w-3.5" strokeWidth={1.75} />}
                >
                  Tugaskan Anggota ke {team.code}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabel Riwayat Penugasan & Rotasi Tim */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[#14532D]" strokeWidth={1.75} />
            <CardTitle>
              Riwayat Penugasan Tim ({membershipHistory.length})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {membershipHistory.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Belum Ada Riwayat Penugasan Tim"
                description="Setiap penempatan dan perpindahan tim akan tercatat secara permanen di tabel ini."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                    <th className="px-4 py-3">Tim Penjualan</th>
                    <th className="px-4 py-3">Nama Staf</th>
                    <th className="px-4 py-3">Peran di Tim</th>
                    <th className="px-4 py-3">Mulai Bergabung</th>
                    <th className="px-4 py-3">Berakhir (left_at)</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Catatan Penugasan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {membershipHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-[#14532D]">
                          {item.teamCode}
                        </span>{' '}
                        <span className="font-medium text-[#0F172A]">
                          • {item.teamName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#0F172A]">
                          {item.staffName}
                        </p>
                        <p className="font-mono text-[11px] text-[#64748B]">
                          {item.staffEmail}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {item.membershipRole === 'TEAM_SUPERVISOR' ? (
                          <Badge tone="blue">TEAM_SUPERVISOR</Badge>
                        ) : (
                          <Badge tone="slate">TEAM_SALES</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#475569] tabular-nums">
                        {formatDateTimeID(item.joinedAt)}
                      </td>
                      <td className="px-4 py-3 text-[#475569] tabular-nums">
                        {item.leftAt ? (
                          formatDateTimeID(item.leftAt)
                        ) : (
                          <span className="text-[#059669] font-medium">
                            Masih Menjabat
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.isActive ? (
                          <Badge tone="emerald">AKTIF</Badge>
                        ) : (
                          <Badge tone="slate">HISTORI ROTASI</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[300px] text-[#475569]">
                        {item.notes ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal 1: + Buat Tim Baru */}
      <Modal
        isOpen={isCreateTeamOpen}
        onClose={() => setIsCreateTeamOpen(false)}
        title="Buat Tim Penjualan Baru"
        description="Tambahkan grup penjualan internal baru PT FIM-Property."
        isDismissDisabled={isCreatingTeam}
      >
        <form onSubmit={handleCreateTeamSubmit} className="space-y-4">
          {createTeamError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{createTeamError.message}</p>
              {createTeamError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  Ref: {createTeamError.correlationId}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Kode Tim (Unik)"
              required
              value={newTeamCode}
              onChange={(e) => setNewTeamCode(e.target.value.toUpperCase())}
              placeholder="Contoh: TIM-04"
              disabled={isCreatingTeam}
            />

            <Input
              label="Nama Tim Penjualan"
              required
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Contoh: Tim Kencana Delta"
              disabled={isCreatingTeam}
            />
          </div>

          <div>
            <label
              htmlFor="newTeamDesc"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Deskripsi Cakupan Tim (Opsional)
            </label>
            <textarea
              id="newTeamDesc"
              rows={3}
              value={newTeamDesc}
              onChange={(e) => setNewTeamDesc(e.target.value)}
              disabled={isCreatingTeam}
              placeholder="Fokus pemasaran proyek dan segmen prospek..."
              className="mt-1.5 block w-full rounded-md border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateTeamOpen(false)}
              disabled={isCreatingTeam}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" isLoading={isCreatingTeam}>
              Simpan Tim Baru
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Tugaskan / Pindahkan Anggota */}
      <Modal
        isOpen={isAssignOpen}
        onClose={() => setIsAssignOpen(false)}
        title="Tugaskan / Pindahkan Anggota Tim"
        description="Jika staf sudah berada di tim lain, keanggotaan lama otomatis ditutup (left_at terisi) sesuai aturan CST-01 & CST-02."
        isDismissDisabled={isAssigning}
      >
        <form onSubmit={handleAssignSubmit} className="space-y-4">
          {assignError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{assignError.message}</p>
              {assignError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  Ref: {assignError.correlationId}
                </p>
              )}
            </div>
          )}

          <Select
            label="Tim Tujuan"
            required
            value={assignTeamId}
            onChange={(e) => setAssignTeamId(e.target.value)}
            disabled={isAssigning}
            options={teams
              .filter((t) => t.isActive)
              .map((t) => ({
                value: t.id,
                label: `${t.code} — ${t.name}`,
              }))}
          />

          <Select
            label="Peran Keanggotaan dalam Tim"
            required
            value={assignRole}
            onChange={(e) =>
              handleRoleChangeInModal(e.target.value as TeamMemberRole)
            }
            disabled={isAssigning}
            options={[
              {
                value: 'TEAM_SALES',
                label: 'TEAM_SALES — Anggota Eksekutif Sales',
              },
              {
                value: 'TEAM_SUPERVISOR',
                label: 'TEAM_SUPERVISOR — Supervisor Koordinator Tim',
              },
            ]}
          />

          <Select
            label="Pilih Staf Aktif"
            required
            value={assignProfileId}
            onChange={(e) => setAssignProfileId(e.target.value)}
            disabled={isAssigning}
            options={eligibleStaffForRole.map((s) => ({
              value: s.id,
              label: `${s.fullName} (${s.email})${
                s.currentTeamCode ? ` — Saat ini: ${s.currentTeamCode}` : ' — Belum Ada Tim'
              }`,
            }))}
          />

          <div>
            <label
              htmlFor="assignNotes"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Catatan Penugasan / Alasan Rotasi (Wajib, min. 3 karakter)
            </label>
            <textarea
              id="assignNotes"
              required
              minLength={3}
              rows={3}
              value={assignNotes}
              onChange={(e) => setAssignNotes(e.target.value)}
              disabled={isAssigning}
              placeholder="Contoh: Penempatan anggota Sales baru atau penguatan kuota penjualan proyek."
              className="mt-1.5 block w-full rounded-md border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAssignOpen(false)}
              disabled={isAssigning}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" isLoading={isAssigning}>
              Simpan Penugasan
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
