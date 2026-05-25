import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magnate · Avaratak",
  description:
    "Magnate workspace for Avaratak — Vera, your AI CEO, directs a team of AI employees and runs the company.",
  applicationName: "Magnate",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#08080C",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
