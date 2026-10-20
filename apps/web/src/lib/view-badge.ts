import type { View } from '@aegon/core';

/** Insignia corta de un lienzo: su nivel (L1–L3) o, en despliegue, el ambiente (QA, PROD). */
export function viewBadge(view: Pick<View, 'level' | 'environment'>): string {
  return view.level === 'deployment' ? (view.environment ?? 'dep').toUpperCase().slice(0, 5) : `L${view.level}`;
}
