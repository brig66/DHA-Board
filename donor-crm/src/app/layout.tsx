import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DHA Donor CRM",
  description: "Dental Health Arlington donor records, gifts, and email",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body flex min-h-screen flex-col">
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t border-black/10 px-4 py-4 text-center text-xs text-[#5c584d]">
          Created by Advanced Integrated Marketing Inc. | &copy;2026 Dental Health Arlington
        </footer>
      </body>
    </html>
  );
}
