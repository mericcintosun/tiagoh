import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Seller dashboard",
  description:
    "Live revenue, settled receipts, and the cascade graph for your paid MCP tools, read straight from GOAT mainnet.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
