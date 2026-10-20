import type { Element, Id, Model, View } from '@aegon/core';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Texto donde se busca: nombre, ID, tecnología, tags, descripción, motor, broker, dueño y, en
 * despliegue, direcciones (IPs, hosts), ID del recurso, tamaño y lo que despliega una instancia.
 */
function haystack(el: Element): string {
  const parts: (string | undefined)[] = [el.name, el.id, el.description, el.owner, ...(el.tags ?? [])];
  if ('technology' in el) parts.push(...(el.technology ?? []));
  if ('store' in el) parts.push(el.store.engine, el.store.customEngine);
  if ('bus' in el) parts.push(el.bus.broker, el.bus.customBroker, ...(el.bus.topics ?? []));
  if ('role' in el) parts.push(el.role);
  if ('addresses' in el) parts.push(...(el.addresses ?? []));
  if ('resource' in el) parts.push(el.resource);
  if (el.kind === 'node') parts.push(el.node.size, el.node.region, el.node.account);
  if (el.kind === 'instance') parts.push(el.instance.of);
  return normalize(parts.filter(Boolean).join(' '));
}

/**
 * Elementos del lienzo que coinciden con la búsqueda (todas las palabras, sin importar acentos ni
 * mayúsculas), ordenados como se leen: de arriba hacia abajo y de izquierda a derecha.
 */
export function searchMatches(model: Model, view: View, query: string): Id[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return Object.keys(view.nodes)
    .filter((id) => {
      const el = model.elements[id];
      if (!el) return false;
      const text = haystack(el);
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => view.nodes[a]!.y - view.nodes[b]!.y || view.nodes[a]!.x - view.nodes[b]!.x);
}

/** Vecinos directos (dependencias entrantes y salientes) de la selección en las aristas del lienzo. */
export function focusSet(selected: readonly Id[], edges: readonly { id: string; source: string; target: string }[]) {
  const sel = new Set(selected);
  const nodes = new Set(selected);
  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (sel.has(e.source) || sel.has(e.target)) {
      nodes.add(e.source);
      nodes.add(e.target);
      edgeIds.add(e.id);
    }
  }
  return { nodes, edges: edgeIds };
}
