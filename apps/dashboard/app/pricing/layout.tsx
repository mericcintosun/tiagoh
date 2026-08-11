import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "What tiagoh costs: wrapping is free, the protocol fee is a contract-capped percentage of settled volume, and every paid tool's price is listed in exact minor units. Numbers, not marketing.",
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
