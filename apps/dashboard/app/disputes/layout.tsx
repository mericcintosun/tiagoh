import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dispute center",
  description:
    "See how a failed tool call rolls a cascade back atomically: bond slashed, buyer refunded, revenue splits reversed, reputation updated.",
};

export default function DisputesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
