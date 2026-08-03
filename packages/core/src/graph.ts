import type { CascadeHop, CascadeTree, Receipt } from "./models.js";
import { parseMinor, serializeMinor, type Minor } from "./money.js";

/**
 * Reconstruct a cascade tree from receipts alone (no central coordinator).
 *
 * Sums are `bigint` minor units: a tree of a thousand $0.01 hops must total exactly $10, and
 * float addition does not guarantee that.
 */
export function buildCascadeTree(
  cascadeId: string,
  budget: Minor | string,
  receipts: Receipt[],
): CascadeTree {
  const hops: CascadeHop[] = receipts.map((r) => ({
    paymentId: r.paymentId,
    parentId: r.parentId,
    payee: r.payee,
    amount: r.amount,
    attributionBps: 0,
  }));
  const spent = hops.reduce((sum, h) => sum + parseMinor(h.amount), 0n);
  const root = receipts.find((r) => r.parentId === null);
  return {
    cascadeId,
    rootId: root?.paymentId ?? "",
    budget: serializeMinor(parseMinor(budget)),
    spent: serializeMinor(spent),
    hops,
  };
}

/** Direct children of a hop in the tree. */
export function childrenOf(tree: CascadeTree, paymentId: string): CascadeHop[] {
  return tree.hops.filter((h) => h.parentId === paymentId);
}

/** Remaining budget for a cascade — the cap the gateway enforces per hop, in minor units. */
export function remainingBudget(tree: CascadeTree): Minor {
  const left = parseMinor(tree.budget) - parseMinor(tree.spent);
  return left > 0n ? left : 0n;
}
