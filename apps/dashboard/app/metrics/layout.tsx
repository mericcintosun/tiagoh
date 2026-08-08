import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Transaction metrics",
  description:
    "tiagoh's honest counters on GOAT mainnet: settlements as a share of chain transactions, gas contributed, unique payers, median value, cascade depth — and the traffic we exclude ourselves.",
};

export default function MetricsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
