import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Investigation Intelligence Platform",
  description: "SHADOW / ECHO / SPECTRA platform shell",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
