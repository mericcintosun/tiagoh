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

const SITE_DESCRIPTION =
  "tiagoh turns any MCP server into a paid tool. Agents pay per call over x402, payments cascade across multi-hop tool chains, and quality bonds refund the buyer when output is bad. Fifteen Solidity contracts run live on GOAT mainnet.";

export const metadata: Metadata = {
  title: {
    default: "tiagoh: paid MCP tools with x402 payments on GOAT",
    template: "%s · tiagoh",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "tiagoh",
    "x402",
    "MCP",
    "Model Context Protocol",
    "paid MCP tools",
    "GOAT Network",
    "agent payments",
    "cascade payments",
    "quality bonds",
    "on-chain reputation",
    "ERC-8004",
    "Bitcoin L2",
  ],
  metadataBase: new URL("https://tiagoh.vercel.app"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "tiagoh: paid MCP tools with x402 payments on GOAT",
    description:
      "Sell your MCP tools and get paid per call over x402. Payments cascade across tool chains, and quality bonds refund bad output. Live on GOAT mainnet.",
    url: "https://tiagoh.vercel.app",
    siteName: "tiagoh",
    type: "website",
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "tiagoh: paid MCP tools with x402 payments on GOAT",
    description:
      "Sell your MCP tools and get paid per call over x402. Payments cascade across tool chains, and quality bonds refund bad output. Live on GOAT mainnet.",
    images: ["/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "tiagoh",
      url: "https://tiagoh.vercel.app",
      description: SITE_DESCRIPTION,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Any",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      author: {
        "@type": "Organization",
        name: "tiagoh",
        url: "https://github.com/mericcintosun/tiagoh",
      },
      codeRepository: "https://github.com/mericcintosun/tiagoh",
    },
    {
      "@type": "WebSite",
      name: "tiagoh",
      url: "https://tiagoh.vercel.app",
      description: SITE_DESCRIPTION,
    },
  ],
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Providers>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}
