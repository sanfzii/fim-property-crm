import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FIM-Property CRM",
  description:
    "Aplikasi CRM dan manajemen transaksi penjualan properti internal untuk PT FIM-Property.",
  icons: {
    icon: "/fim-logo.png",
    apple: "/fim-logo.png",
  },
  openGraph: {
    title: "FIM-Property CRM",
    description:
      "Aplikasi CRM dan manajemen transaksi penjualan properti internal untuk PT FIM-Property.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className="h-full"
    >
      <body className="min-h-full flex flex-col bg-[#F8FAFC] text-[#0F172A] font-sans antialiased">
        {children}
      </body>
    </html>
  );
}

