import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cascade playground",
  description:
    "Open a root budget, tune each hop, and watch the contract reject any hop that would exceed the cap, then refund the remainder on close.",
};

export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
