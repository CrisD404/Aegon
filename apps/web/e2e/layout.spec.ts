import { expect, test, type Page } from '@playwright/test';
import { changesCount, framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
});

const wrapper = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** Posición y tamaño del nodo en coordenadas del lienzo (los de primer nivel no tienen marco). */
const flowRect = (page: Page, id: string) =>
  wrapper(page, id).evaluate((el) => {
    const node = el as HTMLElement;
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(node.style.transform) ?? [];
    return { x: Number(m[1]), y: Number(m[2]), w: parseFloat(node.style.width), h: parseFloat(node.style.height) };
  });

test('el recuadro de selección toma solo lo que queda entero adentro', async ({ page }) => {
  const box = (await wrapper(page, 'pasarela-pagos').boundingBox())!;
  const from = { x: box.x - 24, y: box.y - 24 };
  const marquee = async (to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  // Le faltan unos píxeles del borde derecho: no entra.
  await marquee({ x: box.x + box.width - 8, y: box.y + box.height + 24 });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  // Entero adentro: sí.
  await marquee({ x: box.x + box.width + 24, y: box.y + box.height + 24 });
  await expect(wrapper(page, 'pasarela-pagos')).toContainClass('selected');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
});

test('con Shift el nodo se acomoda entre sus vecinos y queda exactamente donde se lo vio', async ({ page }) => {
  const left = (await wrapper(page, 'cliente').boundingBox())!;
  const right = (await wrapper(page, 'operador').boundingBox())!;
  const box = (await wrapper(page, 'pasarela-pagos').boundingBox())!;
  const grab = { x: box.x + box.width / 2, y: box.y + 12 };
  // Destino: casi centrado entre los dos (a 1 px, más cerca que cualquier otra alineación) y casi a su altura.
  const dest = { x: (left.x + left.width + right.x) / 2 + 1, y: left.y + 12 + 3 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // El arrastre arranca con el segundo movimiento: ese primer paso no mueve el nodo.
  await page.mouse.move(grab.x + 3, grab.y + 3);
  await page.keyboard.down('Shift');
  await page.mouse.move(dest.x + 3, dest.y + 3, { steps: 12 });

  // Las dos separaciones son iguales y muestran su medida.
  const gaps = page.locator('.guide-gap[data-equal]');
  await expect(gaps).toHaveCount(2);
  const sizes = await gaps.allInnerTexts();
  expect(sizes[0]).toBe(sizes[1]);
  expect(Number(sizes[0])).toBeGreaterThan(0);
  await expect(page.locator('.guide-line').first()).toBeVisible();
  const shown = await flowRect(page, 'pasarela-pagos');

  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('.guide-gap, .guide-line')).toHaveCount(0);

  // Al soltar no se corre ni un píxel, y quedó centrado y a la altura de sus vecinos.
  const after = await flowRect(page, 'pasarela-pagos');
  expect(after).toEqual(shown);
  expect(Number.isInteger(after.x) && Number.isInteger(after.y)).toBe(true);
  const a = await flowRect(page, 'cliente');
  const b = await flowRect(page, 'operador');
  expect(after.y).toBe(a.y);
  expect(Math.abs(after.x - (a.x + a.w) - (b.x - (after.x + after.w)))).toBeLessThanOrEqual(1);
  expect(await changesCount(page)).toBe(1);
});

test('la etiqueta de una flecha se arrastra a lo largo del trazo y un doble click la devuelve', async ({ page }) => {
  const id = 'operador--core-bancario';
  const label = page.getByTestId(`edge-label-${id}`);
  const path = page.locator(`.react-flow__edge[data-id="${id}"] .c4-edge-path`);
  /** Punto de la pantalla a una fracción del trazo, y a qué fracción quedó la etiqueta. */
  const onPath = (fraction: number) =>
    path.evaluate((el, f) => {
      const p = el as SVGPathElement;
      const at = p.getPointAtLength(p.getTotalLength() * f);
      const m = p.getScreenCTM()!;
      return { x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f };
    }, fraction);
  const where = async () => {
    const box = (await label.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    return path.evaluate((el, c) => {
      const p = el as SVGPathElement;
      const m = p.getScreenCTM()!;
      const total = p.getTotalLength();
      let best = { fraction: 0, off: Infinity };
      for (let i = 0; i <= 200; i++) {
        const at = p.getPointAtLength((total * i) / 200);
        const off = Math.hypot(at.x * m.a + at.y * m.c + m.e - c.x, at.x * m.b + at.y * m.d + m.f - c.y);
        if (off < best.off) best = { fraction: i / 200, off };
      }
      return best;
    }, center);
  };
  const start = await where();
  expect(Math.abs(start.fraction - 0.5)).toBeLessThan(0.08);

  // Un click sin mover selecciona la flecha y la etiqueta no se corre.
  await label.click();
  await expect(page.getByTestId('relation-label')).toHaveValue('Consulta clientes');
  expect(await changesCount(page)).toBe(0);

  // Arrastrada hacia el origen, queda ahí, sobre su flecha.
  const from = (await label.boundingBox())!;
  const to = await onPath(0.2);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(label).toHaveAttribute('data-placed', /.*/);
  const moved = await where();
  expect(Math.abs(moved.fraction - 0.2)).toBeLessThan(0.08);
  expect(moved.off).toBeLessThan(4);
  expect(await changesCount(page)).toBe(1);

  // Doble click: vuelve al lugar que elige el lienzo.
  await label.dblclick();
  await expect(label).not.toHaveAttribute('data-placed', /.*/);
  expect(Math.abs((await where()).fraction - start.fraction)).toBeLessThan(0.05);
});

test('con Shift, al redimensionar el borde se alinea con el de otro y queda como se lo vio', async ({ page }) => {
  // El borde derecho de Cliente se estira hasta casi el borde derecho de la Pasarela, que está más abajo.
  await page.getByTestId('node-cliente').click();
  const target = (await wrapper(page, 'pasarela-pagos').boundingBox())!;
  const edge = (await wrapper(page, 'cliente').locator('.react-flow__resize-control.right.line').boundingBox())!;
  // Lejos del medio del borde, donde está el punto para conectar.
  const grab = { x: edge.x + edge.width / 2, y: edge.y + edge.height / 4 };
  await page.keyboard.down('Shift');
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 8, grab.y, { steps: 2 });
  await page.mouse.move(target.x + target.width + 2, grab.y, { steps: 10 });
  await expect(page.locator('.guide-line').first()).toBeVisible();
  const shown = await flowRect(page, 'cliente');

  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('.guide-gap, .guide-line')).toHaveCount(0);

  // Al soltar queda como se veía: en píxeles enteros y con el borde justo sobre el del otro.
  const after = await flowRect(page, 'cliente');
  const other = await flowRect(page, 'pasarela-pagos');
  expect(after).toEqual(shown);
  expect(Number.isInteger(after.w)).toBe(true);
  expect(after.x + after.w).toBe(other.x + other.w);
  expect(await changesCount(page)).toBe(1);
});

test('una flecha se acomoda a mano arrastrando sus puntos y se endereza desde el inspector', async ({ page }) => {
  const id = 'operador--core-bancario';
  const path = page.locator(`.react-flow__edge[data-id="${id}"] .c4-edge-path`);
  const original = await path.getAttribute('d');
  await expect(path).not.toHaveAttribute('data-routed');

  // Seleccionada, ofrece dos puntos para llevarla por otro lado.
  await page.getByTestId(`edge-label-${id}`).click();
  await expect(page.getByTestId('route-hint')).toContainText('Los puntos de la flecha se arrastran');
  const add = page.getByTestId(`edge-add-${id}-0`);
  await expect(add).toBeVisible();
  await expect(page.locator('.c4-edge-point[data-add]')).toHaveCount(2);

  const handle = (await add.boundingBox())!;
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 150, start.y - 40, { steps: 10 });
  // Ya se dobla mientras se arrastra, antes de soltar.
  await expect(path).toHaveAttribute('data-routed');
  await page.mouse.up();

  // Queda un punto fijo, la flecha pasa por ahí y es un cambio del lienzo.
  await expect(page.getByTestId(`edge-point-${id}-0`)).toBeVisible();
  expect(await path.getAttribute('d')).not.toBe(original);
  expect(await changesCount(page)).toBe(1);
  // El foco sigue en el lienzo (no en la etiqueta de la relación): los atajos actúan sobre la flecha.
  await expect(page.getByTestId('relation-label')).not.toBeFocused();

  // Deshacer y rehacer lo tratan como un paso.
  await page.keyboard.press('Control+z');
  await expect(path).not.toHaveAttribute('data-routed');
  await page.keyboard.press('Control+y');
  await expect(path).toHaveAttribute('data-routed');

  // Doble click en el punto lo quita; el inspector también ofrece enderezar.
  await page.getByTestId(`edge-label-${id}`).click();
  await expect(page.getByTestId('route-reset')).toBeVisible();
  await page.getByTestId(`edge-point-${id}-0`).dblclick();
  await expect(path).not.toHaveAttribute('data-routed');
  expect(await path.getAttribute('d')).toBe(original);
});

test('la punta de una flecha se desliza por el borde para elegir de qué lado toca', async ({ page }) => {
  const id = 'operador--core-bancario';
  const path = page.locator(`.react-flow__edge[data-id="${id}"] .c4-edge-path`);
  const original = await path.getAttribute('d');
  await page.getByTestId(`edge-label-${id}`).click();

  // Las dos puntas se pueden agarrar; ninguna está fija todavía.
  const end = page.getByTestId(`edge-end-${id}-to`);
  await expect(end).toBeVisible();
  await expect(page.getByTestId(`edge-end-${id}-from`)).toBeVisible();
  await expect(end).not.toHaveAttribute('data-fixed');

  // Llevarla al lado de abajo del destino, cerca del medio: se engancha al medio de ese lado.
  const node = page.locator('.react-flow__node[data-id="core-bancario"]');
  const target = (await node.boundingBox())!;
  const handle = (await end.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2 + 2, target.y + target.height + 10, { steps: 10 });
  // Mientras se arrastra, la flecha ya llega por ahí.
  await expect(path).toHaveAttribute('data-anchored', 'to');
  await page.mouse.up();

  await expect(end).toHaveAttribute('data-fixed');
  const moved = (await end.boundingBox())!;
  expect(Math.abs(moved.x + moved.width / 2 - (target.x + target.width / 2))).toBeLessThan(1.5);
  expect(moved.y + moved.height / 2).toBeGreaterThan(target.y + target.height);
  expect(await path.getAttribute('d')).not.toBe(original);
  expect(await changesCount(page)).toBe(1);
  await expect(page.getByTestId('route-reset')).toBeVisible();

  // Doble click en la punta la devuelve al lugar que elige el lienzo.
  await end.dblclick();
  await expect(path).not.toHaveAttribute('data-anchored');
  await expect(end).not.toHaveAttribute('data-fixed');
  expect(await path.getAttribute('d')).toBe(original);
});

test('soltar la punta sobre otro componente lleva la flecha a ese', async ({ page }) => {
  const id = 'operador--core-bancario';
  await page.getByTestId(`edge-label-${id}`).click();
  await expect(page.getByText('Operador de soporte → Core bancario')).toBeVisible();

  const end = page.getByTestId(`edge-end-${id}-to`);
  const handle = (await end.boundingBox())!;
  const other = page.locator('.react-flow__node[data-id="pasarela-pagos"]');
  const box = (await other.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  // El componente al que iría queda resaltado mientras la punta está encima.
  await expect(other).toHaveAttribute('data-connect-target');
  await page.mouse.up();
  await expect(other).not.toHaveAttribute('data-connect-target');

  // La misma relación (mismo ID, misma etiqueta) ahora llega al otro componente.
  await expect(page.getByText('Operador de soporte → Pasarela de pagos')).toBeVisible();
  await expect(page.getByTestId(`edge-label-${id}`)).toContainText('Consulta clientes');
  await expect(page.getByText('Deshecho')).toHaveCount(0);

  // Un Ctrl+Z la devuelve.
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Operador de soporte → Core bancario')).toBeVisible();
});

test('una relación bidireccional muestra los protocolos de cada sentido por separado', async ({ page }) => {
  const id = 'operador--core-bancario';
  await page.getByTestId(`edge-label-${id}`).click();
  const add = async (field: string, text: string) => {
    const input = page.getByTestId(field).locator('input').last();
    await input.fill(text);
    await input.press('Enter');
  };
  const ports = async (field: string, protocol: string, text: string) => {
    const input = page.getByTestId(field).getByTestId(`protocol-ports-${protocol}`);
    await input.fill(text);
    await input.press('Enter');
  };
  // De un solo sentido no hay vuelta que cargar, ni flechita en la etiqueta.
  await expect(page.getByTestId('relation-back')).toHaveCount(0);
  await add('relation-protocols', 'https');
  await ports('relation-protocols', 'https', '443');
  await expect(page.locator(`[data-edge-label="${id}"] .c4-edge-dir`)).toHaveCount(0);

  // Bidireccional: aparece el bloque de la vuelta, y lo que se carga ahí no toca la ida.
  await page.getByText('Bidireccional', { exact: true }).click();
  await expect(page.getByText('De vuelta, hacia Operador de soporte')).toBeVisible();
  await expect(page.getByText('Protocolos y puertos hacia Core bancario')).toBeVisible();
  await add('relation-back-protocols', 'amqp');
  await ports('relation-back-protocols', 'amqp', '5672');
  await page.getByTestId('relation-back-label').fill('Avisa cambios');

  // En el lienzo, una etiqueta por sentido, cada una con su flechita.
  const main = page.getByTestId(`edge-label-${id}`);
  const back = page.getByTestId(`edge-label-back-${id}`);
  await expect(main).toContainText('Consulta clientes');
  await expect(main.locator('.tech')).toHaveText(['[HTTPS :443]']);
  await expect(back).toContainText('Avisa cambios');
  await expect(back.locator('.tech')).toHaveText(['[AMQP :5672]']);
  await expect(page.locator(`[data-edge-label="${id}"] .c4-edge-dir`)).toHaveCount(2);
  // Las dos flechitas apuntan en sentidos opuestos.
  const angles = await page.locator(`[data-edge-label="${id}"] .c4-edge-dir`).evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.angle)));
  expect(Math.abs(((angles[0]! - angles[1]! + 540) % 360) - 180)).toBeGreaterThan(150);

  // Volver a un solo sentido descarta la vuelta.
  await page.getByText('Unidireccional', { exact: true }).click();
  await expect(back).toHaveCount(0);
  await expect(page.getByTestId('relation-back')).toHaveCount(0);
  await expect(main.locator('.tech')).toHaveText(['[HTTPS :443]']);
});

test('una relación lleva varios protocolos, cada uno con sus puertos, y la flecha los muestra por renglón', async ({ page }) => {
  const id = 'operador--core-bancario';
  await page.getByTestId(`edge-label-${id}`).click();
  const field = page.getByTestId('relation-protocols');
  const tech = page.locator(`[data-testid="edge-label-${id}"] .tech`);
  const add = async (text: string) => {
    const input = field.locator('input').last();
    await input.fill(text);
    await input.press('Enter');
  };
  const ports = async (protocol: string, text: string) => {
    const input = page.getByTestId(`protocol-ports-${protocol}`);
    await input.fill(text);
    await input.press('Enter');
  };

  // El protocolo entra solo; su renglón ofrece el puerto habitual como referencia.
  await add('dns');
  await expect(page.getByTestId('protocol-row-dns')).toContainText('DNS');
  await expect(page.getByTestId('protocol-ports-dns')).toHaveAttribute('placeholder', '53');
  await expect(tech).toHaveText(['[DNS]']);

  await ports('dns', '53');
  await add('ntp');
  await ports('ntp', '123');
  await add('ldap');
  await ports('ldap', '389, 636');
  // Un renglón por protocolo: no se mezclan puertos de uno con otro.
  await expect(tech).toHaveText(['[DNS :53]', '[NTP :123]', '[LDAP :389, :636]']);

  // Quitar uno no toca a los demás, y deshacer lo devuelve en un paso.
  await page.getByTestId('protocol-remove-ntp').click();
  await expect(tech).toHaveText(['[DNS :53]', '[LDAP :389, :636]']);
  await page.keyboard.press('Control+z');
  await expect(tech).toHaveText(['[DNS :53]', '[NTP :123]', '[LDAP :389, :636]']);
  await expect(page.getByTestId('protocol-ports-ntp')).toHaveValue('123');
});
