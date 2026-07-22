import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reputation explorer",
  description:
    "Tools ranked by on-chain receipts, bonds, slashes, and refunds. Every score traces to real GOAT mainnet activity.",
};

export default function ExplorerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
