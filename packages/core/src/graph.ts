import type { CascadeHop, CascadeTree, Receipt } from "./models.js";

/** Reconstruct a cascade tree from receipts alone (no central coordinator). */
export function buildCascadeTree(cascadeId: string, budgetUsd: number, receipts: Receipt[]): CascadeTree {
  const hops: CascadeHop[] = receipts.map((r) => ({
    paymentId: r.paymentId,
    parentId: r.parentId,
    payee: r.payee,
    amountUsd: r.amountUsd,
    attributionBps: 0,
  }));
  const spentUsd = hops.reduce((sum, h) => sum + h.amountUsd, 0);
  const root = receipts.find((r) => r.parentId === null);
  return { cascadeId, rootId: root?.paymentId ?? "", budgetUsd, spentUsd, hops };
}

/** Direct children of a hop in the tree. */
export function childrenOf(tree: CascadeTree, paymentId: string): CascadeHop[] {
  return tree.hops.filter((h) => h.parentId === paymentId);
}

/** Remaining budget for a cascade — the cap the gateway enforces per hop. */
export function remainingBudget(tree: CascadeTree): number {
  return Math.max(0, tree.budgetUsd - tree.spentUsd);
}
