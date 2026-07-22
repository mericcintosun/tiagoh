import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pitch",
  description:
    "A two minute walk through tiagoh. Get paid every time an AI agent calls your tool, settled on Bitcoin through GOAT.",
  alternates: { canonical: "/pitch" },
};

export default function PitchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
