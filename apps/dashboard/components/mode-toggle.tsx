"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";

export function ModeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {/* Avoid hydration mismatch: render a stable icon until mounted. */}
      {mounted && !isDark ? (
        <Sun className="h-[1.15rem] w-[1.15rem]" weight="fill" />
      ) : (
        <Moon className="h-[1.15rem] w-[1.15rem]" weight="fill" />
      )}
    </Button>
  );
}
