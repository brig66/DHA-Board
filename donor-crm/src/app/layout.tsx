import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DHA Donor CRM",
  description: "Dental Health Arlington donor records, gifts, and email",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body min-h-screen">{children}</body>
    </html>
  );
}
