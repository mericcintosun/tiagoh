import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import "./globals.css";
import { Providers } from "@/lib/providers";
import { Toaster } from "@/components/ui/sonner";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "tiagoh — insured settlement for the agent economy",
    template: "%s · tiagoh",
  },
  description:
    "tiagoh is the insured settlement layer for MCP on GOAT — pay per call over x402, cascade through insured, reputation-ranked supply chains, settled with Bitcoin finality.",
  keywords: [
    "tiagoh",
    "x402",
    "MCP",
    "GOAT Network",
    "agent economy",
    "cascade payments",
    "quality bonds",
    "ERC-8004",
    "Bitcoin settlement",
  ],
  metadataBase: new URL("https://tiagoh.vercel.app"),
  openGraph: {
    title: "tiagoh — insured settlement for the agent economy",
    description:
      "Payments that cascade. Trust that settles. Insured, reputation-ranked MCP tools on GOAT.",
    type: "website",
    images: ["/logo.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f0" },
    { media: "(prefers-color-scheme: dark)", color: "#141210" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable}`}
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}
