"use client";

import { Broadcast } from "@phosphor-icons/react/dist/ssr";

import { useChainStatus } from "@/lib/chain-data";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Live chain badge — reads the current block number directly from the public RPC
 * (wagmi `useBlockNumber`). This is the visible proof that the dashboard's data
 * path is client-side, with no backend.
 */
export function ChainBadge() {
  const { blockNumber, isLive, chainId, usingStub } = useChainStatus();

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant={isLive ? "flow" : "warning"} className="gap-1.5">
              <Broadcast
                className={isLive ? "h-3 w-3 animate-pulse" : "h-3 w-3"}
                weight="fill"
              />
              <span className="num">
                {blockNumber !== null ? `#${blockNumber.toString()}` : "connecting…"}
              </span>
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium text-foreground">
            {isLive ? "Live from GOAT RPC" : "Awaiting first block"}
          </p>
          <p className="mt-1 text-muted-foreground">
            chain id <span className="num">{chainId}</span> · read-only via viem/wagmi,
            no backend.
            {usingStub && " Domain rows are typed stubs until contracts resolve."}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
