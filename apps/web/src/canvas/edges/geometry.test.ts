import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import { anchorPoint, edgeEnds, floatingEnds, longestSegment, nearestAnchor, routedPath, routedPointAt, segmentDistance, type Pt, type Rect } from './geometry.ts';

const a: Rect = { x: 0, y: 0, w: 100, h: 40 };
const b: Rect = { x: 400, y: 0, w: 100, h: 40 };

describe('flechas acomodadas a mano', () => {
  it('sin nada acomodado, los extremos son los de siempre', () => {
    expect(edgeEnds(a, b)).toEqual(floatingEnds(a, b));
  });

  it('cada punta mira al punto del recorrido que tiene más cerca, no al otro nodo', () => {
    // Sin recorrido las dos puntas salen por los costados; con un punto arriba, salen hacia arriba.
    const direct = edgeEnds(a, b);
    expect([direct.sourcePosition, direct.targetPosition]).toEqual([Position.Right, Position.Left]);
    const ends = edgeEnds(a, b, { points: [{ x: 50, y: -200 }, { x: 450, y: -200 }] });
    expect([ends.sourcePosition, ends.targetPosition]).toEqual([Position.Top, Position.Top]);
    expect(ends.sourceX).toBe(50);
    expect(ends.targetX).toBe(450);
  });

  it('el trazo pasa por todos los puntos, con cualquier forma', () => {
    const chain: Pt[] = [{ x: 0, y: 0 }, { x: 120, y: -80 }, { x: 300, y: -80 }, { x: 420, y: 0 }];
    const curved = routedPath('curved', chain);
    expect(curved.startsWith('M0,0 C')).toBe(true);
    expect(curved).toContain(' 120,-80 C');
    expect(curved.endsWith(' 420,0')).toBe(true);
    // Rectas y escalonadas: tramos derechos con el quiebre redondeado sobre cada punto.
    for (const shape of ['straight', 'step'] as const) {
      const d = routedPath(shape, chain);
      expect(d.startsWith('M0,0 L')).toBe(true);
      expect(d).toContain('Q120,-80 ');
      expect(d).toContain('Q300,-80 ');
      expect(d.endsWith('L420,0')).toBe(true);
    }
  });

  it('un punto sobre la recta entre sus vecinos no dobla nada', () => {
    expect(segmentDistance({ x: 50, y: 2 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(2);
    expect(segmentDistance({ x: 50, y: 40 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(40);
    // Más allá de la punta, la distancia es a la punta.
    expect(segmentDistance({ x: 130, y: 40 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(50);
  });

  it('la etiqueta va al medio del tramo más largo, sobre el trazo', () => {
    const chain: Pt[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 340, y: 0 }, { x: 360, y: 0 }];
    expect(longestSegment(chain)).toBe(1);
    expect(routedPointAt('straight', chain, 1, 0.5)).toEqual({ x: 190, y: 0 });
    // En una curva el punto sale de la curva, no de la cuerda: los extremos del tramo coinciden.
    expect(routedPointAt('curved', chain, 1, 0)).toEqual({ x: 40, y: 0 });
    expect(routedPointAt('curved', chain, 1, 1)).toEqual({ x: 340, y: 0 });
  });
});

describe('puntas fijas en un lado del componente', () => {
  it('el anclaje es un lado y una posición sobre ese lado; sin posición, el medio', () => {
    expect(anchorPoint(a, { side: 'top' }, 0)).toEqual({ point: { x: 50, y: 0 }, side: Position.Top });
    expect(anchorPoint(a, { side: 'bottom', at: 0.25 }, 0)).toEqual({ point: { x: 25, y: 40 }, side: Position.Bottom });
    expect(anchorPoint(a, { side: 'left', at: 0.75 }, 0)).toEqual({ point: { x: 0, y: 30 }, side: Position.Left });
    // Con separación, el punto queda afuera del borde.
    expect(anchorPoint(a, { side: 'right' }, 6).point).toEqual({ x: 106, y: 20 });
  });

  it('una punta fija no se mueve aunque el otro nodo esté para otro lado', () => {
    // El destino está a la derecha, pero la flecha sale por abajo y entra por arriba.
    const ends = edgeEnds(a, b, { from: { side: 'bottom' }, to: { side: 'top', at: 0.2 } });
    expect([ends.sourcePosition, ends.targetPosition]).toEqual([Position.Bottom, Position.Top]);
    expect({ x: ends.sourceX, y: ends.sourceY }).toEqual({ x: 50, y: 43 });
    expect({ x: ends.targetX, y: ends.targetY }).toEqual({ x: 420, y: -6 });
  });

  it('la punta libre apunta a la que está fija', () => {
    // Origen fijo arriba a la izquierda del destino: la punta libre del destino mira hacia ahí.
    const below: Rect = { x: 0, y: 300, w: 100, h: 40 };
    const free = edgeEnds(a, below);
    const fixed = edgeEnds(a, below, { from: { side: 'left' } });
    expect(free.targetPosition).toBe(Position.Top);
    expect(fixed.sourcePosition).toBe(Position.Left);
    // Mira al punto fijo (x = -3), no al centro del origen (x = 50): entra un poco más a la izquierda.
    expect(fixed.targetX).toBeLessThan(free.targetX);
  });

  it('al arrastrar una punta se queda con el lado más cercano', () => {
    expect(nearestAnchor(a, { x: 50, y: -30 }).side).toBe('top');
    expect(nearestAnchor(a, { x: 140, y: 20 }).side).toBe('right');
    expect(nearestAnchor(a, { x: 50, y: 90 }).side).toBe('bottom');
    expect(nearestAnchor(a, { x: -40, y: 10 }).side).toBe('left');
    // Desde adentro del nodo también: el borde que tiene más cerca.
    expect(nearestAnchor(a, { x: 90, y: 20 })).toEqual({ side: 'right' });
  });

  it('guarda la posición sobre el lado, lejos de las esquinas', () => {
    expect(nearestAnchor(a, { x: 25, y: -10 })).toEqual({ side: 'top', at: 0.25 });
    // Más allá de la esquina se queda a 12 px de ella.
    expect(nearestAnchor(a, { x: 1, y: -10 })).toEqual({ side: 'top', at: 0.12 });
    expect(nearestAnchor(a, { x: 99.5, y: -10 })).toEqual({ side: 'top', at: 0.88 });
  });

  it('se engancha en línea con el tramo que sigue y, si no, al medio del lado', () => {
    const tall: Rect = { x: 0, y: 0, w: 100, h: 200 };
    // El punto siguiente está a la altura 60: a 5 px de eso, la punta queda en 60 y el tramo sale horizontal.
    expect(nearestAnchor(tall, { x: 130, y: 65 }, { x: 400, y: 60 }, 7)).toEqual({ side: 'right', at: 0.3 });
    // Cerca del medio (100) y lejos de 60: al medio, que se guarda sin posición.
    expect(nearestAnchor(tall, { x: 130, y: 104 }, { x: 400, y: 60 }, 7)).toEqual({ side: 'right' });
    // Lejos de las dos cosas: donde está el mouse.
    expect(nearestAnchor(tall, { x: 130, y: 150 }, { x: 400, y: 60 }, 7)).toEqual({ side: 'right', at: 0.75 });
    // Lo que queda fuera del lado no engancha: no hay tramo derecho posible.
    expect(nearestAnchor(tall, { x: 130, y: 186 }, { x: 400, y: 192 }, 7)).toEqual({ side: 'right', at: 0.93 });
  });
});
