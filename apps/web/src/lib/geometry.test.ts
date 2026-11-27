import { describe, expect, it } from 'vitest';
import { computeGuides, computeResizeGuides, type Rect } from './geometry.ts';

const box = (x: number, y: number, w = 100, h = 40): Rect => ({ x, y, w, h });

describe('guías al arrastrar', () => {
  it('deja el nodo en píxeles enteros aunque no haya nada con qué alinearse', () => {
    const { dx, dy, lines, gaps } = computeGuides({ x: 10.4, y: 20.6, w: 100, h: 40 }, [box(900, 900)], 6);
    expect(10.4 + dx).toBe(10);
    expect(20.6 + dy).toBe(21);
    expect(lines).toEqual([]);
    expect(gaps).toEqual([]);
  });

  it('alinear centros de anchos distintos también termina en un píxel entero', () => {
    // El centro del otro está en 150,5: el ajuste exacto dejaría al nodo en una coordenada con medio píxel.
    const moving = { x: 98, y: 300, w: 100, h: 40 };
    const { dx, lines } = computeGuides(moving, [box(100, 0, 101)], 6);
    expect(Number.isInteger(moving.x + dx)).toBe(true);
    expect(Math.abs(moving.x + dx + 50 - 150.5)).toBeLessThanOrEqual(0.5);
    expect(lines.some((l) => l.orientation === 'v')).toBe(true);
  });

  it('alinea borde con borde y centro con centro, nunca un centro contra un borde ajeno', () => {
    // El centro del que se mueve (150) cae a 2 px del borde derecho del otro (152): no es una alineación.
    const { dx, lines } = computeGuides(box(100, 300), [box(52, 0)], 6);
    expect(dx).toBe(0);
    expect(lines).toEqual([]);
  });

  it('con los dos bordes alineados no dibuja también el centro', () => {
    const { lines } = computeGuides(box(101, 200), [box(100, 0)], 6);
    expect(lines.filter((l) => l.orientation === 'v').map((l) => l.at)).toEqual([100, 200]);
  });

  it('fila: se acomoda a la misma distancia que ya hay entre sus vecinos', () => {
    // A y B separados por 60; C llega a 64 de B y un poco torcido.
    const others = [box(0, 0), box(160, 0)];
    const { dx, dy, gaps } = computeGuides(box(324, 3), others, 6);
    expect({ x: 324 + dx, y: 3 + dy }).toEqual({ x: 320, y: 0 });
    expect(gaps.filter((g) => g.axis === 'h')).toEqual([
      { axis: 'h', from: 260, to: 320, at: 20, size: 60, equal: true },
      { axis: 'h', from: 100, to: 160, at: 20, size: 60, equal: true },
    ]);
  });

  it('columna: lo mismo hacia abajo', () => {
    const others = [box(0, 0), box(0, 70)];
    const { dy, gaps } = computeGuides(box(2, 137), others, 6);
    expect(137 + dy).toBe(140);
    expect(gaps.filter((g) => g.axis === 'v' && g.equal)).toHaveLength(2);
  });

  it('entre dos vecinos queda centrado', () => {
    const others = [box(0, 0), box(400, 0)];
    // Entre 100 y 400 hay 300; el nodo mide 100: centrado queda en 200, a 100 de cada lado.
    const { dx, gaps } = computeGuides(box(204, 0), others, 6);
    expect(204 + dx).toBe(200);
    expect(gaps.filter((g) => g.axis === 'h').map((g) => [g.size, g.equal])).toEqual([[100, true], [100, true]]);
  });

  it('con un solo vecino mide la distancia sin marcarla como repetida', () => {
    const { dx, gaps } = computeGuides(box(137, 0), [box(0, 0)], 6);
    expect(dx).toBe(0);
    expect(gaps).toEqual([{ axis: 'h', from: 100, to: 137, at: 20, size: 37, equal: false }]);
  });

  it('las distancias se miden solo con los que comparten marco', () => {
    const others = [box(0, 0), box(160, 0)];
    // Sin vecinos de marco no hay ajuste por distancia: queda donde está (alineado arriba).
    const { dx, gaps } = computeGuides(box(324, 0), others, 6, []);
    expect(dx).toBe(0);
    expect(gaps).toEqual([]);
  });

  it('ante un empate, alinearse gana a igualar la distancia', () => {
    // A 3 px a la izquierda está el borde de otro nodo de más abajo; a 3 px a la derecha, la distancia igual.
    const others = [box(0, 0), box(160, 0), box(317, 400)];
    const { dx } = computeGuides(box(320 - 0, 0), [...others], 6, [others[0]!, others[1]!]);
    expect(dx).toBe(0); // ya cumple las dos
    const tie = computeGuides({ x: 318.5, y: 0, w: 100, h: 40 }, others, 6, [others[0]!, others[1]!]);
    expect(318.5 + tie.dx).toBe(317);
  });
});

describe('guías al redimensionar', () => {
  const refs = (others: Rect[], siblings: Rect[] = others, peers: Rect[] = others) => ({ others, siblings, peers });

  it('sin guías solo redondea el borde que se arrastra', () => {
    const { rect, lines, gaps } = computeResizeGuides(box(10, 20), { x: 10, y: 20, w: 133.4, h: 61.6 }, 0);
    expect(rect).toEqual({ x: 10, y: 20, w: 133, h: 62 });
    expect(lines).toEqual([]);
    expect(gaps).toEqual([]);
  });

  it('lo que no se arrastra queda exactamente como estaba', () => {
    // Solo se estira hacia abajo: el ancho (con decimales de antes) no se toca.
    const { rect } = computeResizeGuides({ x: 10.5, y: 20, w: 100.25, h: 40 }, { x: 10.5, y: 20, w: 100.25, h: 57.8 }, 0);
    expect(rect).toEqual({ x: 10.5, y: 20, w: 100.25, h: 58 });
  });

  it('el borde derecho se alinea con el de otro y el izquierdo no se mueve', () => {
    // El otro termina en x = 250; el que se agranda llega a 247.
    const { rect, lines } = computeResizeGuides(box(0, 0), { x: 0, y: 0, w: 247, h: 40 }, 6, refs([box(150, 200)], [], []));
    expect(rect).toEqual({ x: 0, y: 0, w: 250, h: 40 });
    expect(lines).toEqual([{ orientation: 'v', at: 250, from: -12, to: 252 }]);
  });

  it('desde la esquina de arriba a la izquierda, el borde opuesto queda fijo', () => {
    // El otro termina en x = 40: el borde izquierdo (43,2) se le alinea; arriba no hay con qué.
    const { rect, lines } = computeResizeGuides(box(100, 100), { x: 43.2, y: 77.7, w: 156.8, h: 62.3 }, 6, refs([box(-60, -200)], [], []));
    expect(rect).toEqual({ x: 40, y: 78, w: 160, h: 62 });
    expect(lines.map((l) => [l.orientation, l.at])).toEqual([['v', 40]]);
  });

  it('iguala el ancho de otro de su misma clase y lo mide en los dos', () => {
    const { rect, gaps } = computeResizeGuides(box(0, 0), { x: 0, y: 0, w: 177, h: 40 }, 6, refs([], [], [box(500, 300, 180)]));
    expect(rect.w).toBe(180);
    expect(gaps).toEqual([
      { axis: 'h', from: 0, to: 180, at: 52, size: 180, equal: true },
      { axis: 'h', from: 500, to: 680, at: 352, size: 180, equal: true },
    ]);
  });

  it('iguala el alto al achicar desde arriba', () => {
    // Alto 40 → 58 pedido; el otro mide 60: el borde de arriba sube hasta dejarlo en 60.
    const { rect, gaps } = computeResizeGuides(box(0, 100), { x: 0, y: 82, w: 100, h: 58 }, 6, refs([], [], [box(400, 0, 100, 60)]));
    expect(rect).toEqual({ x: 0, y: 80, w: 100, h: 60 });
    expect(gaps.map((g) => [g.axis, g.size])).toEqual([['v', 60], ['v', 60]]);
  });

  it('repite la distancia que ya hay entre sus vecinos', () => {
    // A y B están a 60; el que se estira hacia A queda también a 60.
    const row = [box(200, 0), box(360, 0)];
    const { rect, gaps } = computeResizeGuides(box(0, 0), { x: 0, y: 0, w: 137, h: 40 }, 6, refs(row, row, []));
    expect(rect.w).toBe(140);
    expect(gaps.filter((g) => g.equal).map((g) => [g.from, g.to, g.size])).toEqual([[140, 200, 60], [300, 360, 60]]);
  });

  it('entre dos vecinos, deja la misma distancia de los dos lados', () => {
    // A la izquierda hay 50; a la derecha el vecino empieza en 400: el borde va a 350.
    const row = [box(-150, 0), box(400, 0)];
    const { rect } = computeResizeGuides(box(0, 0), { x: 0, y: 0, w: 346, h: 40 }, 6, refs(row, row, []));
    expect(rect.w).toBe(350);
  });

  it('ante un empate, alinear el borde gana a igualar el tamaño', () => {
    // A 3 px a la derecha, el borde de otro (203); a 3 px a la izquierda, el ancho de un par (197).
    const { rect } = computeResizeGuides(box(0, 0), { x: 0, y: 0, w: 200, h: 40 }, 6, refs([box(103, 300)], [], [box(900, 900, 197)]));
    expect(rect.w).toBe(203);
  });

  it('la guía no achica por debajo del mínimo', () => {
    // Alinearse con el borde ajeno (156) dejaría el ancho por debajo de 160.
    const { rect } = computeResizeGuides(box(0, 0, 220), { x: 0, y: 0, w: 160, h: 40 }, 6, refs([box(56, 300)], [], []), { w: 160, h: 40 });
    expect(rect.w).toBe(160);
  });
});
