// Lokasi: src/app/page.tsx
// Root Route Entry — Mengarahkan pengguna secara otomatis ke /dashboard

import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard');
}

