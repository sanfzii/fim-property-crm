'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatRupiah } from '@/lib/utils/format';
import { useToast } from '@/components/ui/ToastProvider';
import { backfillLegacyDealCommissionAction, recordDeveloperCommissionReceiptAction, updateFinanceSettingsAction } from '@/modules/analytics/finance.actions';

interface Settings { salesSplitRate: number; supervisorSplitRate: number; salesBaseSalary: number; supervisorBaseSalary: number; }
interface Deal { id: string; label: string; total: number; received: number; status: string; }
interface LegacyDeal { id: string; label: string; finalValue: number; projectName: string; projectRate: number | null }

export function FinanceSettingsClient({ settings, salaryEstimate, deals, missingCommissionDeals }: { settings: Settings; salaryEstimate: number; deals: Deal[]; missingCommissionDeals: LegacyDeal[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [form, setForm] = useState(settings);
  const [dealId, setDealId] = useState(deals[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [transferReference, setTransferReference] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [legacyRates, setLegacyRates] = useState<Record<string, string>>({});
  const companyRate = 100 - form.salesSplitRate - form.supervisorSplitRate;
  return <div className="space-y-6">
    <div><h1 className="text-xl font-bold text-[#0F172A]">Pengaturan Keuangan</h1><p className="mt-1 text-xs text-[#64748B]">Pengaturan alokasi komisi, estimasi gaji pokok, dan penerimaan komisi dari developer.</p></div>
    <Card><CardHeader><CardTitle>Pembagian Komisi dan Gaji Pokok</CardTitle></CardHeader><CardContent>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await updateFinanceSettingsAction(form); setBusy(false); if (r.success) { showToast({ title: 'Pengaturan keuangan disimpan.', tone: 'success' }); router.refresh(); } else showToast({ title: r.message, tone: 'error', correlationId: r.correlationId }); }}>
        <label className="space-y-1 text-xs text-[#475569]">Bagian Sales (%)<Input type="number" min="0" max="100" step="0.01" value={form.salesSplitRate} onChange={(e) => setForm({ ...form, salesSplitRate: Number(e.target.value) })} /></label>
        <label className="space-y-1 text-xs text-[#475569]">Bagian Supervisor (%)<Input type="number" min="0" max="100" step="0.01" value={form.supervisorSplitRate} onChange={(e) => setForm({ ...form, supervisorSplitRate: Number(e.target.value) })} /></label>
        <p className="text-xs text-[#475569] sm:col-span-2">Bagian perusahaan dihitung sebagai sisa: <strong>{companyRate.toFixed(2)}%</strong>. Total selalu 100%.</p>
        <label className="space-y-1 text-xs text-[#475569]">Gaji Pokok Sales / bulan<Input type="number" min="0" value={form.salesBaseSalary} onChange={(e) => setForm({ ...form, salesBaseSalary: Number(e.target.value) })} /></label>
        <label className="space-y-1 text-xs text-[#475569]">Gaji Pokok Supervisor / bulan<Input type="number" min="0" value={form.supervisorBaseSalary} onChange={(e) => setForm({ ...form, supervisorBaseSalary: Number(e.target.value) })} /></label>
        <div className="sm:col-span-2"><Button type="submit" isLoading={busy}>Simpan Pengaturan</Button></div>
      </form>
      <p className="mt-4 rounded-md bg-[#F8FAFC] p-3 text-xs text-[#475569]">Estimasi Beban Gaji Bulanan berdasarkan jumlah staf aktif: <strong>{formatRupiah(salaryEstimate)}</strong></p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Snapshot Komisi untuk Deal Closing Lama</CardTitle></CardHeader><CardContent>
      <p className="mb-4 text-xs text-[#64748B]">Periksa tarif yang berlaku saat Deal closing. Tarif proyek saat ini hanya nilai awal; sistem tidak menganggapnya sebagai tarif historis tanpa konfirmasi Admin.</p>
      {missingCommissionDeals.length === 0 ? <p className="text-xs text-[#047857]">Semua Deal closing sudah memiliki snapshot atau tidak ada Deal yang perlu dikonfigurasi.</p> : <div className="space-y-4">{missingCommissionDeals.map((deal) => {
        const rawRate = legacyRates[deal.id] ?? (deal.projectRate === null ? '' : String(deal.projectRate));
        const rate = rawRate === '' ? null : Number(rawRate);
        const total = rate === null ? 0 : Math.round(deal.finalValue * rate) / 100;
        const salesAmount = Math.round(total * form.salesSplitRate) / 100;
        const supervisorAmount = Math.round(total * form.supervisorSplitRate) / 100;
        const companyAmount = total - salesAmount - supervisorAmount;
        return <div key={deal.id} className="rounded-lg border border-[#E2E8F0] p-4">
          <div className="mb-3 flex flex-wrap justify-between gap-2 text-xs"><strong>{deal.label} · {deal.projectName}</strong><span>Nilai transaksi {formatRupiah(deal.finalValue)}</span></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-[#475569]">Tarif historis developer (%)<Input type="number" min="0" max="100" step="0.01" value={rawRate} placeholder="Wajib ditentukan" onChange={(e) => setLegacyRates((prev) => ({ ...prev, [deal.id]: e.target.value }))} /></label>
          </div>
          {rate !== null && <div className="mt-3 rounded-md bg-[#F8FAFC] p-3 text-xs text-[#475569]">Pratinjau: komisi {formatRupiah(total)} · Sales {formatRupiah(salesAmount)} · Supervisor {formatRupiah(supervisorAmount)} · Perusahaan {formatRupiah(companyAmount)}{rate === 0 ? ' · Tidak ada komisi' : ''}</div>}
          <p className="mt-2 text-[11px] text-[#64748B]">Alokasi Supervisor dihitung sebagai porsi tim tanpa menetapkan penerima individu.</p>
          <div className="mt-3"><Button type="button" size="sm" variant="secondary" disabled={busy || rate === null} isLoading={busy} onClick={async () => {
            setBusy(true); const result = await backfillLegacyDealCommissionAction({ dealId: deal.id, commissionRate: rate }); setBusy(false);
            if (result.success) { showToast({ title: `Snapshot ${deal.label} tersimpan.`, tone: 'success' }); router.refresh(); }
            else showToast({ title: result.message, tone: 'error', correlationId: result.correlationId });
          }}>Terapkan Snapshot Deal Ini</Button></div>
        </div>;
      })}</div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Pencatatan Komisi Diterima dari Developer</CardTitle></CardHeader><CardContent>
      {deals.length === 0 ? <p className="text-xs text-[#64748B]">Belum ada Deal closing dengan persentase komisi yang dikonfigurasi.</p> : <form className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await recordDeveloperCommissionReceiptAction({ dealId, amount: Number(amount), receivedOn, transferReference, notes: receiptNotes }); setBusy(false); if (r.success) { showToast({ title: 'Komisi diterima berhasil dicatat.', tone: 'success' }); setAmount(''); setTransferReference(''); setReceiptNotes(''); router.refresh(); } else showToast({ title: r.message, tone: 'error', correlationId: r.correlationId }); }}>
        <label className="space-y-1 text-xs text-[#475569] sm:col-span-2">Deal<select className="h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-xs" value={dealId} onChange={(e) => setDealId(e.target.value)}>{deals.map((d) => <option key={d.id} value={d.id}>{d.label} · Komisi {formatRupiah(d.total)} · Diterima {formatRupiah(d.received)} · {d.status}</option>)}</select></label>
        <label className="space-y-1 text-xs text-[#475569]">Jumlah penerimaan baru<Input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="space-y-1 text-xs text-[#475569]">Tanggal dana diterima<Input type="date" required value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></label>
        <label className="space-y-1 text-xs text-[#475569] sm:col-span-2">Referensi transfer / mutasi bank<Input required minLength={3} maxLength={120} placeholder="Nomor referensi transaksi bank" value={transferReference} onChange={(e) => setTransferReference(e.target.value)} /></label>
        <label className="space-y-1 text-xs text-[#475569] sm:col-span-2">Catatan pemeriksaan (opsional)<Input maxLength={500} placeholder="Contoh: cocok dengan mutasi rekening tanggal ..." value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} /></label>
        <div className="flex items-end"><Button type="submit" isLoading={busy} disabled={!dealId || !amount}>Catat Penerimaan</Button></div>
      </form>}
      <p className="mt-3 text-[11px] text-[#64748B]">Catat setelah mencocokkan dana dengan mutasi rekening. Simpan tanggal dan referensi transfer sebagai bukti pemeriksaan. Pencatatan akumulatif, dibatasi total komisi, dan memiliki jejak audit.</p>
    </CardContent></Card>
  </div>;
}
