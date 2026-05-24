import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magnate — Run a company of one. Command a team of hundreds.",
  description:
    "Magnate gives you Vera, an AI CEO who runs your one-person company — directing a team of specialized AI employees across engineering, growth, finance, research, and more.",
  applicationName: "Magnate",
  authors: [{ name: "Magnate" }],
  keywords: [
    "AI CEO",
    "AI employees",
    "one-person company",
    "AI agents",
    "solo founder",
    "AI automation",
  ],
  openGraph: {
    title: "Magnate — Your AI CEO and a team that builds the company",
    description:
      "Describe your vision. Vera, your AI CEO, breaks it into projects, directs a team of AI employees, tracks the numbers, and escalates only what needs you.",
    type: "website",
  },
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
