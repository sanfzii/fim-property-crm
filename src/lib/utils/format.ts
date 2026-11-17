// Lokasi: src/lib/utils/format.ts
// Utilitas Pemformatan Deterministik (Aman di Server Components & Client Components)
// Diselaraskan dengan DESIGN.md v2.1 (Format Rupiah, Tanggal Indonesia, Inisial & Nama Depan)

const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/**
 * Memformat angka nominal ke format mata uang Rupiah Indonesia tanpa desimal.
 * Contoh: 850000000 -> "Rp 850.000.000"
 */
export function formatRupiah(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') {
    return 'Rp 0';
  }
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(numeric)) {
    return 'Rp 0';
  }
  // Normalisasi spasi non-breaking dari Intl menjadi spasi biasa yang konsisten
  const formatted = idrFormatter.format(Math.round(numeric)).replace(/\u00A0/g, ' ');
  return formatted.startsWith('Rp ') ? formatted : formatted.replace(/^Rp/, 'Rp ');
}

/**
 * Memformat input angka bulat dengan pemisah ribuan Indonesia.
 * Nilai yang dikembalikan tetap tanpa titik agar aman dipakai saat submit form.
 * Contoh: "15000000" -> "15.000.000" untuk tampilan.
 */
export function formatNumericInput(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const digits = String(value).replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  return Number(digits).toLocaleString('id-ID', {
    maximumFractionDigits: 0,
  });
}

const INDONESIAN_SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

/**
 * Memformat string tanggal ISO atau YYYY-MM-DD menjadi "16 Mar 2026" (WIB).
 */
export function formatDateID(dateInput: string | Date | null | undefined): string {
  if (!dateInput) {
    return '-';
  }

  // Jika input murni YYYY-MM-DD, parse tanpa pergeseran zona waktu
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const parts = dateInput.split('-');
    const year = Number(parts[0]);
    const monthIdx = Number(parts[1]) - 1;
    const day = Number(parts[2]);
    const monthName = INDONESIAN_SHORT_MONTHS[monthIdx];
    if (year && monthName && day) {
      return `${String(day).padStart(2, '0')} ${monthName} ${year}`;
    }
  }

  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) {
    return '-';
  }

  // Konversi deterministik ke zona waktu Asia/Jakarta (UTC+7)
  const wibTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const day = String(wibTime.getUTCDate()).padStart(2, '0');
  const monthName = INDONESIAN_SHORT_MONTHS[wibTime.getUTCMonth()] ?? 'Jan';
  const year = wibTime.getUTCFullYear();
  return `${day} ${monthName} ${year}`;
}

/**
 * Memformat string timestamp ISO menjadi "16 Mar 2026, 14:30 WIB".
 */
export function formatDateTimeID(dateInput: string | Date | null | undefined): string {
  if (!dateInput) {
    return '-';
  }
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) {
    return '-';
  }

  const wibTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const day = String(wibTime.getUTCDate()).padStart(2, '0');
  const monthName = INDONESIAN_SHORT_MONTHS[wibTime.getUTCMonth()] ?? 'Jan';
  const year = wibTime.getUTCFullYear();
  const hours = String(wibTime.getUTCHours()).padStart(2, '0');
  const minutes = String(wibTime.getUTCMinutes()).padStart(2, '0');
  return `${day} ${monthName} ${year}, ${hours}:${minutes} WIB`;
}

/**
 * Menghasilkan 2 huruf kapital inisial dari nama lengkap untuk Avatar Staf.
 * Contoh: "Muhammad Ichsan Fachrulrozi" -> "MI", "Fariz Aditya Ardhana" -> "FA"
 */
export function getInitials(fullName: string | null | undefined): string {
  if (!fullName || !fullName.trim()) {
    return 'FP';
  }
  const tokens = fullName
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return 'FP';
  }
  if (tokens.length === 1) {
    return (tokens[0] ?? 'FP').slice(0, 2).toUpperCase();
  }
  const firstChar = tokens[0]?.[0] ?? 'F';
  const secondChar = tokens[1]?.[0] ?? 'P';
  return `${firstChar}${secondChar}`.toUpperCase();
}

/**
 * Mengambil nama depan dari nama lengkap staf (untuk tampilan ringkas pemegang unit "Fariz • ALPHA").
 */
export function getFirstName(fullName: string | null | undefined): string {
  if (!fullName || !fullName.trim()) {
    return '-';
  }
  const firstToken = fullName.trim().split(/\s+/)[0];
  return firstToken ?? '-';
}

/**
 * Menghitung selisih jam yang telah berlalu sejak timestamp ISO tertentu hingga saat ini.
 */
export function getElapsedHoursSince(isoDate: string | null | undefined): number {
  if (!isoDate) return 0;
  const targetMs = new Date(isoDate).getTime();
  if (Number.isNaN(targetMs)) return 0;
  return Math.max(0, Math.round((Date.now() - targetMs) / (1000 * 60 * 60)));
}

/**
 * Menghitung sisa jam hingga timestamp batas waktu (expires_at) di masa depan.
 */
export function getRemainingHoursUntil(isoDate: string | null | undefined): number {
  if (!isoDate) return 0;
  const targetMs = new Date(isoDate).getTime();
  if (Number.isNaN(targetMs)) return 0;
  return Math.round((targetMs - Date.now()) / (1000 * 60 * 60));
}

