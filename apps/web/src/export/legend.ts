import { allViewEdges, isDeploymentKind, type Element, type Model, type View } from '@aegon/core';

/**
 * Leyenda de un lienzo exportado: solo lo que el diagrama usa (tipos de elemento y estilos de
 * línea), en el orden en que conviene leerlo.
 */

export type LegendShape = 'person' | 'box' | 'store' | 'bus' | 'frame' | 'group' | 'boundary' | 'infra' | 'instance';
export type LineStyle = 'solid' | 'implied' | 'network' | 'planned';

export interface LegendItem {
  key: string;
  label: string;
  /** Color (variable CSS de la hoja, ej. `--kind-container`). */
  color: string;
  shape: LegendShape;
  external?: boolean;
  hint?: string;
}

export interface LegendLine {
  key: LineStyle | 'bidirectional';
  label: string;
  style: LineStyle;
  both?: boolean;
}

const ORDER = ['actor', 'actor-ext', 'system', 'system-ext', 'container', 'component', 'store', 'bus', 'boundary', 'group', 'node', 'infra', 'instance', 'instance-replicas'];

export function legendFor(model: Model, view: View): { items: LegendItem[]; lines: LegendLine[] } {
  const items = new Map<string, LegendItem>();
  const add = (item: LegendItem) => items.set(item.key, item);
  const placed = Object.keys(view.nodes)
    .map((id) => model.elements[id])
    .filter((e): e is Element => !!e);
  for (const el of placed) {
    const ext = el.scope === 'external';
    switch (el.kind) {
      case 'actor':
        add({ key: ext ? 'actor-ext' : 'actor', label: ext ? 'Persona externa' : 'Persona', color: '--kind-actor', shape: 'person', external: ext });
        break;
      case 'system':
        add({ key: ext ? 'system-ext' : 'system', label: ext ? 'Sistema externo' : 'Sistema', color: '--kind-system', shape: 'box', external: ext });
        break;
      case 'container':
        add({ key: 'container', label: 'Contenedor', color: '--kind-container', shape: 'box' });
        break;
      case 'component':
        add({ key: 'component', label: 'Componente', color: '--kind-component', shape: 'box' });
        break;
      case 'store':
        add({ key: 'store', label: 'Base de datos', color: '--kind-store', shape: 'store' });
        break;
      case 'bus':
        add({ key: 'bus', label: 'Bus de mensajería', color: '--kind-bus', shape: 'bus' });
        break;
      case 'group':
        add({ key: 'group', label: 'Grupo (nube, red, plataforma)', color: '--kind-group', shape: 'group' });
        break;
      case 'node':
        add({ key: 'node', label: 'Nodo de despliegue', color: '--kind-node', shape: 'frame', hint: 'datacenter, VPC, clúster, namespace…' });
        break;
      case 'infra':
        add({ key: 'infra', label: 'Infraestructura', color: '--kind-infra', shape: 'infra', hint: 'firewall, DNS, balanceador, ingress/egress…' });
        break;
      case 'instance': {
        const replicas = (el.instance.replicas ?? 1) > 1;
        add({ key: replicas ? 'instance-replicas' : 'instance', label: replicas ? 'Instancia con réplicas' : 'Instancia de un contenedor', color: '--kind-container', shape: 'instance' });
        break;
      }
    }
  }
  if (view.scope && view.level !== 'deployment' && model.elements[view.scope]) {
    const scope = model.elements[view.scope]!;
    add({ key: 'boundary', label: scope.kind === 'container' ? 'Límite del contenedor' : 'Límite del sistema', color: scope.kind === 'container' ? '--kind-container' : '--kind-system', shape: 'boundary' });
  }

  const lines = new Map<string, LegendLine>();
  for (const edge of allViewEdges(model, view)) {
    const network = view.level === 'deployment' && !edge.projected && edge.relations.some((r) => [r.from, r.to].some((id) => { const e = model.elements[id]; return !!e && isDeploymentKind(e.kind); }));
    if (edge.implied) lines.set('implied', { key: 'implied', label: 'Relación implícita (entre elementos internos)', style: 'implied' });
    else if (network) lines.set('network', { key: 'network', label: 'Tramo de red', style: 'network' });
    else lines.set('solid', { key: 'solid', label: view.level === 'deployment' ? 'Relación entre contenedores' : 'Relación', style: 'solid' });
    if (!edge.implied && edge.relations.some((r) => r.status === 'planned')) lines.set('planned', { key: 'planned', label: 'Planificada', style: 'planned' });
    if (edge.bidirectional) lines.set('bidirectional', { key: 'bidirectional', label: 'Bidireccional', style: network ? 'network' : 'solid', both: true });
  }
  const sortedItems = [...items.values()].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const lineOrder = ['solid', 'network', 'implied', 'planned', 'bidirectional'];
  return { items: sortedItems, lines: [...lines.values()].sort((a, b) => lineOrder.indexOf(a.key) - lineOrder.indexOf(b.key)) };
}
