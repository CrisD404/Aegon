import { SCHEMA_VERSION, type Element, type Id, type Model, type NodeLayout, type Relation, type View } from '@aegon/core';

/**
 * Workspace sintético para medir rendimiento: ~150 sistemas en el landscape, un "monolito" con
 * 1.000 contenedores en un solo lienzo L2 y miles de relaciones. Se arma directo (sin ops) para
 * que generar 5k elementos sea instantáneo; el resultado es un modelo válido.
 */
export function largeModel(opts: { systems?: number; monolith?: number; containersPerSystem?: number } = {}): Model {
  const systems = opts.systems ?? 150;
  const monolith = opts.monolith ?? 1000;
  const perSystem = opts.containersPerSystem ?? 10;
  const elements: Record<Id, Element> = {};
  const relations: Record<Id, Relation> = {};
  const techs = ['java', 'go', 'nodejs', 'python', 'dotnet', 'react', 'kotlin'];
  const engines = ['postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rel = (from: Id, to: Id, label: string) => {
    const id = `${from}--${to}`;
    if (!relations[id] && from !== to) relations[id] = { id, from, to, label };
  };

  for (let a = 0; a < 12; a++) elements[`actor-${a}`] = { id: `actor-${a}`, kind: 'actor', name: `Actor ${a + 1}`, scope: a % 3 === 0 ? 'external' : undefined } as Element;
  for (let s = 0; s < systems; s++) {
    const sys = `sys-${s}`;
    elements[sys] = { id: sys, kind: 'system', name: `Sistema ${s + 1}`, technology: [techs[s % techs.length]!], risk: (['low', 'medium', 'high', 'critical'] as const)[s % 4] } as Element;
    const count = s === 0 ? monolith : perSystem;
    for (let c = 0; c < count; c++) {
      const id = `${sys}-c${c}`;
      const isStore = c % 7 === 6;
      elements[id] = isStore
        ? ({ id, kind: 'store', name: `DB ${s + 1}.${c + 1}`, parent: sys, store: { engine: engines[c % engines.length]! } } as Element)
        : ({ id, kind: 'container', name: `Servicio ${s + 1}.${c + 1}`, parent: sys, technology: [techs[(s + c) % techs.length]!], description: 'Servicio generado para pruebas de escala.' } as Element);
      if (s !== 0 && !isStore) {
        for (let k = 0; k < 2; k++) {
          const comp = `${id}-k${k}`;
          elements[comp] = { id: comp, kind: 'component', name: `Componente ${k + 1}`, parent: id } as Element;
        }
      }
    }
  }
  // Relaciones: dentro de cada sistema y entre sistemas (vía contenedores).
  for (let s = 0; s < systems; s++) {
    const count = s === 0 ? monolith : perSystem;
    for (let c = 1; c < count; c++) {
      rel(`sys-${s}-c${Math.floor(rnd() * c)}`, `sys-${s}-c${c}`, 'Llama');
      if (s === 0 && c > 10) {
        rel(`sys-0-c${c}`, `sys-0-c${Math.floor(rnd() * c)}`, 'Consulta');
        rel(`sys-0-c${c}`, `sys-0-c${Math.floor(rnd() * c)}`, 'Publica');
      }
      if (s !== 0 && elements[`sys-${s}-c${c}-k0`]) rel(`sys-${s}-c${c}-k0`, `sys-${s}-c${c}-k1`, 'Usa');
    }
    for (let k = 0; k < 3; k++) {
      const other = Math.floor(rnd() * systems);
      if (other !== s) rel(`sys-${s}-c${Math.floor(rnd() * perSystem)}`, `sys-${other}-c${Math.floor(rnd() * perSystem)}`, 'Integra');
    }
  }
  for (let a = 0; a < 12; a++) for (let k = 0; k < 4; k++) rel(`actor-${a}`, `sys-${Math.floor(rnd() * systems)}-c0`, 'Usa');

  const grid = (ids: Id[], cols: number, origin = { x: 0, y: 0 }) => {
    const nodes: Record<Id, NodeLayout> = {};
    ids.forEach((id, i) => (nodes[id] = { x: origin.x + (i % cols) * 320, y: origin.y + Math.floor(i / cols) * 220 }));
    return nodes;
  };
  const landscapeIds = Object.keys(elements).filter((id) => elements[id]!.kind === 'system');
  const actorIds = Object.keys(elements).filter((id) => elements[id]!.kind === 'actor');
  const landscape: View = { id: 'landscape', name: 'Landscape', level: 1, nodes: { ...grid(actorIds, 12, { x: 0, y: -300 }), ...grid(landscapeIds, 15) } };
  const monoIds = Object.keys(elements).filter((id) => elements[id]!.parent === 'sys-0');
  const mono: View = { id: 'sys-0-containers', name: 'Sistema 1 · Contenedores (1.000)', level: 2, scope: 'sys-0', nodes: grid(monoIds, 40) };

  return {
    workspace: { schema: SCHEMA_VERSION, id: 'escala', name: `Escala (${Object.keys(elements).length} elementos)`, defaultView: 'landscape' },
    elements,
    relations,
    views: { landscape, [mono.id]: mono },
  };
}
