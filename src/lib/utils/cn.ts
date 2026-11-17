// Lokasi: src/lib/utils/cn.ts
// Level Topologis: L0 (Shared UI Utility)

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Menggabungkan class Tailwind CSS secara kondisional dan menyelesaikan
 * konflik class utilitas (contoh: 'px-2 px-4' menjadi 'px-4').
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
