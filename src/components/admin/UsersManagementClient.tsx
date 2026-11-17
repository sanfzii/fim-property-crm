// Lokasi: src/components/admin/UsersManagementClient.tsx
// Client Component Manajemen Pengguna & Hak Akses Role Staf (DESIGN.md v2.1 Bagian 7.9)

'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserCog,
  UserPlus,
  Search,
  ShieldCheck,
  Users,
  Edit3,
  AlertTriangle,
} from 'lucide-react';
import type { SystemRole } from '@/types/database.types';
import {
  createStaffUserAction,
  updateStaffStatusOrRoleAction,
} from '@/modules/identity/profiles/profiles.actions';
import { formatDateID, getInitials } from '@/lib/utils/format';
import { KpiCard } from '@/components/ui/KpiCard';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';

export interface AdminStaffListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  systemRole: SystemRole;
  isActive: boolean;
  activeTeamId: string | null;
  activeTeamCode: string | null;
  activeTeamName: string | null;
  membershipRole: string | null;
  activeLeadsCount: number;
  activeBookingsCount: number;
  createdAt: string;
}

export interface UsersManagementClientProps {
  currentAdminId: string;
  staffList: AdminStaffListItem[];
}

export function UsersManagementClient({
  currentAdminId,
  staffList,
}: UsersManagementClientProps) {
  const router = useRouter();
  const { showToast } = useToast();

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | SystemRole>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>(
    'ALL'
  );

  // Modal + Tambah Staf State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createFullName, setCreateFullName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<SystemRole>('SALES');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<{
    message: string;
    correlationId?: string;
    fieldErrors?: Record<string, string[]>;
  } | null>(null);

  // Modal Ubah Role / Status Staf State
  const [editingStaff, setEditingStaff] = useState<AdminStaffListItem | null>(
    null
  );
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<SystemRole>('SALES');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editReason, setEditReason] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [editError, setEditError] = useState<{
    message: string;
    correlationId?: string;
    fieldErrors?: Record<string, string[]>;
  } | null>(null);

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return staffList.filter((item) => {
      if (roleFilter !== 'ALL' && item.systemRole !== roleFilter) {
        return false;
      }
      if (statusFilter === 'ACTIVE' && !item.isActive) {
        return false;
      }
      if (statusFilter === 'INACTIVE' && item.isActive) {
        return false;
      }
      if (!q) return true;
      return (
        item.fullName.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.phone.toLowerCase().includes(q) ||
        (item.activeTeamCode?.toLowerCase().includes(q) ?? false) ||
        (item.activeTeamName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [staffList, searchQuery, roleFilter, statusFilter]);

  const totalActiveCount = staffList.filter((s) => s.isActive).length;
  const adminCount = staffList.filter((s) => s.systemRole === 'ADMIN').length;
  const supervisorCount = staffList.filter(
    (s) => s.systemRole === 'SUPERVISOR'
  ).length;
  const salesCount = staffList.filter((s) => s.systemRole === 'SALES').length;

  const openCreateModal = () => {
    setCreateFullName('');
    setCreateEmail('');
    setCreatePhone('');
    setCreatePassword('');
    setCreateRole('SALES');
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const openEditModal = (staff: AdminStaffListItem) => {
    setEditingStaff(staff);
    setEditFullName(staff.fullName);
    setEditPhone(staff.phone);
    setEditRole(staff.systemRole);
    setEditIsActive(staff.isActive);
    setEditReason('');
    setEditError(null);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;
    setIsCreating(true);
    setCreateError(null);

    try {
      const result = await createStaffUserAction({
        fullName: createFullName,
        email: createEmail,
        phone: createPhone,
        initialPassword: createPassword,
        systemRole: createRole,
      });

      if (result.success) {
        showToast({
          title: 'Staf Baru Ditambahkan',
          description: result.message,
          tone: 'success',
        });
        setIsCreateOpen(false);
        router.refresh();
      } else {
        setCreateError({
          message: result.message,
          correlationId: result.correlationId,
          fieldErrors: result.fieldErrors,
        });
        showToast({
          title: 'Gagal Membuat Akun Staf',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      setCreateError({
        message: 'Terjadi gangguan jaringan saat menghubungi server.',
      });
        showToast({
          title: 'Gagal Membuat Akun Staf',
          description: 'Terjadi gangguan jaringan saat menghubungi server.',
          tone: 'error',
        });
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff || isUpdating) return;
    setIsUpdating(true);
    setEditError(null);

    try {
      const result = await updateStaffStatusOrRoleAction({
        profileId: editingStaff.id,
        fullName: editFullName,
        phone: editPhone,
        systemRole: editRole,
        isActive: editIsActive,
        reason: editReason,
      });

      if (result.success) {
        showToast({
          title: 'Profil Staf Diperbarui',
          description: result.message,
          tone: 'success',
        });
        setEditingStaff(null);
        router.refresh();
      } else {
        setEditError({
          message: result.message,
          correlationId: result.correlationId,
          fieldErrors: result.fieldErrors,
        });
        showToast({
          title: 'Perubahan Profil Ditolak',
          description: result.message,
          correlationId: result.correlationId,
          tone: 'error',
        });
      }
    } catch {
      setEditError({
        message: 'Terjadi gangguan jaringan saat menghubungi server.',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const renderRoleBadge = (role: SystemRole) => {
    if (role === 'ADMIN') return <Badge tone="forest">ADMIN</Badge>;
    if (role === 'SUPERVISOR') return <Badge tone="blue">SUPERVISOR</Badge>;
    return <Badge tone="slate">SALES</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-2xs sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Manajemen Pengguna
          </h1>
          <p className="mt-0.5 text-xs text-[#64748B]">
            Kelola akun staf, role sistem, dan status aktif.
          </p>
        </div>

        <div className="shrink-0">
          <Button
            type="button"
            variant="primary"
            onClick={openCreateModal}
            leftIcon={<UserPlus className="h-4 w-4" strokeWidth={1.75} />}
          >
            + Tambah Staf
          </Button>
        </div>
      </div>

      {/* 4 Kartu KPI Direktori Staf */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Staf"
          value={`${staffList.length} Akun`}
          subtext={`${totalActiveCount} Aktif • ${staffList.length - totalActiveCount} Nonaktif`}
          icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="Administrator (ADMIN)"
          value={`${adminCount} Staf`}
          subtext="Verifikasi & konfigurasi"
          icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />}
          tone="success"
        />
        <KpiCard
          label="Supervisor Tim"
          value={`${supervisorCount} Staf`}
          subtext="Koordinator tim aktif"
          icon={<UserCog className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
        <KpiCard
          label="Sales Eksekutif"
          value={`${salesCount} Staf`}
          subtext="Pipeline & transaksi"
          icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
          tone="default"
        />
      </div>

      {/* Filter Bar & Tabel Daftar Staf */}
      <Card>
        <CardHeader className="flex-col items-stretch gap-4 lg:flex-row lg:items-center">
          <CardTitle className="min-w-0 flex-1">
            Daftar Staf ({filteredStaff.length})
          </CardTitle>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 lg:w-[580px]">
            <div className="relative sm:col-span-1">
              <Search
                className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[#94A3B8]"
                strokeWidth={1.75}
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama, email, tim..."
                aria-label="Cari staf berdasarkan nama, email, atau tim"
                className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white pr-3 pl-9 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
              />
            </div>

            <select
              aria-label="Filter Role Sistem"
              value={roleFilter}
              onChange={(e) =>
                setRoleFilter(e.target.value as 'ALL' | SystemRole)
              }
              className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            >
              <option value="ALL">Semua Role Sistem</option>
              <option value="ADMIN">Role: ADMIN</option>
              <option value="SUPERVISOR">Role: SUPERVISOR</option>
              <option value="SALES">Role: SALES</option>
            </select>

            <select
              aria-label="Filter Status Akun"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE'
                )
              }
              className="block h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
            >
              <option value="ALL">Semua Status Akun</option>
              <option value="ACTIVE">Status: Aktif</option>
              <option value="INACTIVE">Status: Nonaktif</option>
            </select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filteredStaff.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Staf Tidak Ditemukan"
                description="Tidak ada profil staf yang cocok dengan kata kunci pencarian atau filter yang dipilih."
              />
            </div>
          ) : (
            <>
              {/* Desktop & Tablet Table View */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold tracking-wider text-[#64748B] uppercase">
                      <th className="px-4 py-3">Staf Internal</th>
                      <th className="px-4 py-3">Kontak Kerja</th>
                      <th className="px-4 py-3">Role Sistem</th>
                      <th className="px-4 py-3">Tim Aktif</th>
                      <th className="px-4 py-3 text-right">Beban Aktif</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Terdaftar</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {filteredStaff.map((staff) => {
                      const isSelf = staff.id === currentAdminId;
                      return (
                        <tr key={staff.id} className="hover:bg-[#F8FAFC]">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#BBF7D0] bg-[#F0FDF4] text-xs font-bold text-[#14532D]">
                                {getInitials(staff.fullName)}
                              </div>
                              <div>
                                <p className="font-semibold text-[#0F172A]">
                                  {staff.fullName}
                                  {isSelf && (
                                    <span className="ml-1.5 rounded bg-[#F0FDF4] px-1.5 py-0.5 text-[10px] font-semibold text-[#14532D]">
                                      Anda
                                    </span>
                                  )}
                                </p>
                                <p className="font-mono text-[11px] text-[#64748B]">
                                  {staff.email}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-[#475569] tabular-nums">
                            {staff.phone}
                          </td>
                          <td className="px-4 py-3">
                            {renderRoleBadge(staff.systemRole)}
                          </td>
                          <td className="px-4 py-3">
                            {staff.activeTeamCode ? (
                              <div>
                                <p className="font-medium text-[#0F172A]">
                                  {staff.activeTeamName}
                                </p>
                                <p className="font-mono text-[11px] text-[#64748B]">
                                  {staff.activeTeamCode} • {staff.membershipRole}
                                </p>
                              </div>
                            ) : staff.systemRole === 'ADMIN' ? (
                              <span className="text-[11px] font-medium text-[#059669]">
                                Pusat / Lintas Tim
                              </span>
                            ) : (
                              <span className="text-[11px] text-[#94A3B8]">
                                Belum Ditugaskan
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {staff.systemRole === 'SALES' ? (
                              <span className="text-[#475569]">
                                <strong className="text-[#0F172A]">
                                  {staff.activeLeadsCount}
                                </strong>{' '}
                                Lead •{' '}
                                <strong className="text-[#1D4ED8]">
                                  {staff.activeBookingsCount}
                                </strong>{' '}
                                Booking
                              </span>
                            ) : (
                              <span className="text-[#94A3B8]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {staff.isActive ? (
                              <Badge tone="emerald">AKTIF</Badge>
                            ) : (
                              <Badge tone="red">NONAKTIF</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#64748B] tabular-nums">
                            {formatDateID(staff.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openEditModal(staff)}
                              leftIcon={
                                <Edit3
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.75}
                                />
                              }
                            >
                              Ubah Role / Status
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Table-to-Card Transformation (< 768px) */}
              <div className="divide-y divide-[#E2E8F0] md:hidden">
                {filteredStaff.map((staff) => (
                  <div key={staff.id} className="space-y-2.5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[#0F172A]">
                          {staff.fullName}
                        </p>
                        <p className="font-mono text-xs text-[#64748B]">
                          {staff.email}
                        </p>
                        <p className="font-mono text-xs text-[#475569] tabular-nums">
                          {staff.phone}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {renderRoleBadge(staff.systemRole)}
                        {staff.isActive ? (
                          <Badge tone="emerald">AKTIF</Badge>
                        ) : (
                          <Badge tone="red">NONAKTIF</Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-md bg-[#F8FAFC] px-3 py-2 text-xs text-[#475569]">
                      <span>
                        Tim:{' '}
                        <strong className="text-[#0F172A]">
                          {staff.activeTeamCode
                            ? `${staff.activeTeamName} (${staff.activeTeamCode})`
                            : staff.systemRole === 'ADMIN'
                              ? 'Pusat'
                              : 'Belum Ada'}
                        </strong>
                      </span>
                      {staff.systemRole === 'SALES' && (
                        <span className="tabular-nums">
                          {staff.activeLeadsCount} Lead •{' '}
                          {staff.activeBookingsCount} Booking
                        </span>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => openEditModal(staff)}
                      leftIcon={
                        <Edit3 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      }
                    >
                      Ubah Role / Status Staf
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Modal 1: + Tambah Staf Baru */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Tambah Akun Staf Internal Baru"
        description="Akun akan didaftarkan ke Supabase Auth (email terkonfirmasi otomatis) dan dicatat ke Audit Log."
        isDismissDisabled={isCreating}
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {createError && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
            >
              <p className="font-semibold">{createError.message}</p>
              {createError.fieldErrors && (
                <p className="mt-1">
                  Periksa kembali field yang ditandai merah, lalu coba lagi.
                </p>
              )}
              {createError.correlationId && (
                <p className="mt-1 font-mono text-[11px]">
                  Ref: {createError.correlationId}
                </p>
              )}
            </div>
          )}

          <Input
            id="createStaffFullName"
            label="Nama Lengkap Staf"
            required
            value={createFullName}
            onChange={(e) => setCreateFullName(e.target.value)}
            placeholder="Contoh: Raka Pratama"
            disabled={isCreating}
            error={createError?.fieldErrors?.fullName?.[0]}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              id="createStaffEmail"
              label="Email Kerja FIM-Property"
              type="email"
              autoComplete="email"
              required
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              placeholder="nama.sales@fimproperty.local"
              disabled={isCreating}
              error={createError?.fieldErrors?.email?.[0]}
            />

            <Input
              id="createStaffPhone"
              label="Nomor Telepon / WhatsApp"
              type="tel"
              autoComplete="tel"
              required
              value={createPhone}
              onChange={(e) => setCreatePhone(e.target.value)}
              placeholder="081234567890"
              disabled={isCreating}
              error={createError?.fieldErrors?.phone?.[0]}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              id="createStaffRole"
              label="Role Sistem Utama"
              required
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value as SystemRole)}
              disabled={isCreating}
              options={[
                { value: 'SALES', label: 'SALES — Eksekutif Penjualan' },
                { value: 'SUPERVISOR', label: 'SUPERVISOR — Koordinator Tim' },
                { value: 'ADMIN', label: 'ADMIN — Administrator Perusahaan' },
              ]}
            />

            <Input
              id="createStaffPassword"
              label="Password Awal (Min. 8 Karakter)"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              disabled={isCreating}
              error={createError?.fieldErrors?.initialPassword?.[0]}
            />
          </div>

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
              Buat Akun Staf
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Ubah Role / Status Staf */}
      <Modal
        isOpen={Boolean(editingStaff)}
        onClose={() => setEditingStaff(null)}
        title={
          editingStaff
            ? `Ubah Role / Status Staf: ${editingStaff.fullName}`
            : 'Ubah Role / Status Staf'
        }
        description="Perubahan role atau status keaktifan wajib menyertakan alasan audit minimal 5 karakter."
        isDismissDisabled={isUpdating}
      >
        {editingStaff && (
          <form onSubmit={handleUpdateSubmit} className="space-y-4">
            {editError && (
              <div
                role="alert"
                className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
              >
                <p className="font-semibold">{editError.message}</p>
                {editError.correlationId && (
                  <p className="mt-1 font-mono text-[11px]">
                    Ref: {editError.correlationId}
                  </p>
                )}
              </div>
            )}

            {(editingStaff.activeLeadsCount > 0 ||
              editingStaff.activeBookingsCount > 0) && (
              <div className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#B45309]">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  strokeWidth={1.75}
                />
                <div>
                  <p className="font-semibold">
                    Peringatan Kepemilikan Data Aktif
                  </p>
                  <p className="mt-0.5">
                    Staf ini sedang memegang{' '}
                    <strong>{editingStaff.activeLeadsCount} Lead aktif</strong>{' '}
                    dan{' '}
                    <strong>
                      {editingStaff.activeBookingsCount} Booking aktif
                    </strong>
                    . Penonaktifan akun akan ditolak oleh sistem hingga seluruh
                    Lead/Booking dialihkan (Reassign).
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Nama Lengkap Staf"
                required
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                disabled={isUpdating}
              />

              <Input
                label="Nomor Telepon"
                required
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                disabled={isUpdating}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Role Sistem"
                required
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as SystemRole)}
                disabled={isUpdating}
                options={[
                  { value: 'SALES', label: 'SALES' },
                  { value: 'SUPERVISOR', label: 'SUPERVISOR' },
                  { value: 'ADMIN', label: 'ADMIN' },
                ]}
              />

              <Select
                label="Status Keaktifan Akun"
                required
                value={editIsActive ? 'ACTIVE' : 'INACTIVE'}
                onChange={(e) => setEditIsActive(e.target.value === 'ACTIVE')}
                disabled={isUpdating}
                options={[
                  { value: 'ACTIVE', label: 'AKTIF (Dapat Login)' },
                  {
                    value: 'INACTIVE',
                    label: 'NONAKTIF (Cabut Sesi & Auth Ban)',
                  },
                ]}
              />
            </div>

            <div>
              <label
                htmlFor="staffUpdateReason"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Alasan Perubahan Role / Status (Wajib, min. 5 karakter)
              </label>
              <textarea
                id="staffUpdateReason"
                required
                minLength={5}
                rows={3}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                disabled={isUpdating}
                placeholder="Contoh: Rotasi jabatan tahunan atau penyesuaian struktur tim penjualan."
                className="mt-1.5 block w-full rounded-md border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A] focus:border-[#059669] focus:ring-2 focus:ring-[#10B981]/20 focus:outline-none"
              />
              {editError?.fieldErrors?.reason?.[0] && (
                <p className="mt-1 text-xs font-medium text-[#DC2626]">
                  {editError.fieldErrors.reason[0]}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-[#E2E8F0] pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingStaff(null)}
                disabled={isUpdating}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant={editIsActive ? 'primary' : 'destructive'}
                isLoading={isUpdating}
              >
                Simpan Perubahan
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
