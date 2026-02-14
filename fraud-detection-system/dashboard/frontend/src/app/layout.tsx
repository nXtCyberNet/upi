import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fraud Intelligence Engine — Midnight Quantum",
  description: "Real-Time Mule & Collusive Fraud Intelligence Engine for UPI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-[#020617] text-[#f1f5f9]">
        {children}
      </body>
    </html>
  );
}
