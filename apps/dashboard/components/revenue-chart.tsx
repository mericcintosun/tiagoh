"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatUsd, formatUsdCompact, formatNumber } from "@/lib/format";
import type { RevenuePoint } from "@/lib/mock";

/**
 * Revenue over time — single-series area (change-over-time → magnitude). Gold is
 * value, so the fill is `primary`; grid + axes are recessive; numbers are tabular.
 * One series ⇒ no legend (the card title names it). Hover crosshair + tooltip.
 */
export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="hsl(var(--border))"
            strokeOpacity={0.6}
          />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            minTickGap={28}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickFormatter={(v: number) => formatUsdCompact(v)}
          />
          <Tooltip
            cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={<RevenueTooltip />}
          />
          <Area
            type="monotone"
            dataKey="revenueUsd"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#revFill)"
            activeDot={{ r: 4, fill: "hsl(var(--primary))", stroke: "hsl(var(--card))", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: RevenuePoint }>;
  label?: string;
}

function RevenueTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-md">
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="num mt-1 text-sm font-semibold text-primary">
        {formatUsd(point.revenueUsd)}
      </p>
      <p className="num text-xs text-muted-foreground">
        {formatNumber(point.calls)} settled calls
      </p>
    </div>
  );
}
