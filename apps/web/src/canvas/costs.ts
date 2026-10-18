import { create } from 'zustand';
import type { CostTotals, Id } from '@aegon/core';

/**
 * Costos que muestra el lienzo con la capa de costos activa. Cada nodo se suscribe a su propio
 * total: al editar, solo se re-renderizan los nodos cuyo costo cambió.
 */
interface CostOverlayState {
  totals: ReadonlyMap<Id, CostTotals> | null;
  currency: string;
  /** Mayor total entre los nodos del lienzo (escala de calor). */
  max: number;
}

export const useCostOverlay = create<CostOverlayState>(() => ({
  totals: null,
  currency: 'USD',
  max: 0,
}));

/** Total del nodo con la capa activa (`undefined` si está apagada o no tiene costo). */
export function useNodeCost(
  id: Id,
): { total: number; heat: 1 | 2 | 3; currency: string } | undefined {
  const total = useCostOverlay((s) => s.totals?.get(id)?.total);
  const heat = useCostOverlay((s) =>
    s.max && total ? (Math.min(3, Math.max(1, Math.ceil((3 * total) / s.max))) as 1 | 2 | 3) : 1,
  );
  const currency = useCostOverlay((s) => s.currency);
  return total ? { total, heat, currency } : undefined;
}
