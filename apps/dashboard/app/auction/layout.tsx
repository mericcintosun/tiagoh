import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reverse auctions",
  description:
    "Post a capability request and watch bonded, reputation-ranked tools bid on price and quality. Best value wins and settles on-chain.",
};

export default function AuctionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
