import { expect, test } from '@playwright/test';
import { changesCount, emptyPoint, framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
});

test('doble click crea un elemento con el componente fantasma', async ({ page }) => {
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  const input = page.getByTestId('ghost-input');
  await expect(input).toBeFocused();
  await input.fill('Pagos Online');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('node-pagos-online')).toBeVisible();
  await expect(page.getByTestId('inspector-name')).toHaveValue('Pagos Online');
  expect(await changesCount(page)).toBe(2); // elemento + ubicación en el lienzo
});

test('el fantasma sugiere motores de base de datos', async ({ page }) => {
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  await page.getByTestId('ghost-input').fill('mongo');
  await page.getByText('Base de datos MongoDB').click();
  const node = page.getByTestId('node-mongodb');
  await expect(node).toBeVisible();
  await expect(node).toContainText('MongoDB');
});

test('Alt + doble click abre el lienzo de detalle y los breadcrumbs suben', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick({ modifiers: ['Alt'] });
  await expect(page.getByTestId('node-pagos-api')).toBeVisible();
  await expect(page.getByTestId('breadcrumbs')).toContainText('Home Banking');
  await page.getByTestId('node-pagos-api').dblclick({ modifiers: ['Alt'] });
  await expect(page.getByTestId('node-transfer-controller')).toBeVisible();
  await expect(page.getByTestId('breadcrumbs')).toContainText('Pagos API');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByTestId('breadcrumbs')).not.toContainText('Pagos API');
  await expect(page.getByTestId('breadcrumbs')).toContainText('Home Banking');
  await page.getByTestId('breadcrumbs').getByText('Landscape').click();
  await expect(page.getByTestId('breadcrumbs')).not.toContainText('Home Banking');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
});

test('un elemento existente se linkea en otro lienzo, no se duplica', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick({ modifiers: ['Alt'] });
  await framed(page, 'home-banking-containers');
  await expect(page.getByTestId('node-web-app')).toBeVisible();
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  await page.getByTestId('ghost-input').fill('Operador');
  await page.getByTestId('ghost-existing-operador').click();
  await expect(page.getByTestId('node-operador')).toBeVisible();
  await expect(page.getByText('Aparece en 2 lienzos')).toBeVisible();
});

test('si lo escrito coincide con algo del modelo, Enter lo reutiliza en vez de duplicarlo', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick({ modifiers: ['Alt'] });
  await framed(page, 'home-banking-containers');
  await expect(page.getByTestId('node-web-app')).toBeVisible();
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  await page.getByTestId('ghost-input').fill('oper');
  // El existente va primero (antes que "Crear «oper» como…").
  const first = page.locator('[cmdk-item]').first();
  await expect(first).toHaveAttribute('data-testid', 'ghost-existing-operador');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('node-operador')).toBeVisible();
  await expect(page.getByText('Aparece en 2 lienzos')).toBeVisible();
  expect(await changesCount(page)).toBe(1); // solo la ubicación: no se creó un elemento nuevo
});

test('Agregar abre el fantasma con los tipos explicados y lo que ya está en el modelo', async ({ page }) => {
  await page.getByTestId('dock-add').click();
  await expect(page.getByTestId('ghost-input')).toBeFocused();
  const system = page.getByTestId('ghost-create-system');
  await expect(system).toContainText('Sistema');
  await expect(system).toContainText('Un software completo');
  await expect(system).toContainText('Ej.:');
  await expect(page.getByTestId('ghost-existing')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ghost-input')).toBeHidden();
});

test('cambios en borrador: persisten al recargar, se revierten y se guardan', async ({ page }) => {
  await page.getByTestId('node-notificaciones').click();
  const name = page.getByTestId('inspector-name');
  await name.fill('Mensajería');
  await name.press('Enter');
  await expect(page.getByTestId('node-notificaciones')).toContainText('Mensajería');
  expect(await changesCount(page)).toBe(1);

  await page.waitForTimeout(600); // autoguardado del borrador (debounce)
  await page.reload();
  await expect(page.getByTestId('node-notificaciones')).toContainText('Mensajería');
  expect(await changesCount(page)).toBe(1);

  await page.getByTestId('tab-changes').click();
  const row = page.getByTestId('change-element:notificaciones');
  await expect(row).toContainText('name');
  await row.hover();
  await row.getByRole('button', { name: 'Revertir este cambio' }).click();
  await expect(page.getByTestId('node-notificaciones')).toContainText('Notificaciones');
  expect(await changesCount(page)).toBe(0);

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('node-notificaciones')).toContainText('Mensajería');
  await expect(page.getByTestId('commit-message')).toContainText('Actualizar sistema Mensajería (name)');
  await page.getByTestId('save-button').click();
  expect(await changesCount(page)).toBe(0);
  await page.reload();
  await expect(page.getByTestId('node-notificaciones')).toContainText('Mensajería');
  expect(await changesCount(page)).toBe(0);
});

test('con Espacio, arrastrar sobre un nodo mueve la vista y no el nodo', async ({ page }) => {
  const node = page.locator('.react-flow__node[data-id="home-banking"]');
  const viewport = page.locator('.react-flow__viewport');
  const before = { node: await node.getAttribute('style'), view: await viewport.getAttribute('style') };
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await node.getAttribute('style')).toBe(before.node);
  expect(await viewport.getAttribute('style')).not.toBe(before.view);
  expect(await changesCount(page)).toBe(0);
});

test('el fantasma muestra la opción resaltada: tipo con ejemplos, motor o nombre escrito', async ({ page }) => {
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  const preview = page.getByTestId('ghost-preview');
  await expect(preview).toHaveAttribute('data-preview', 'create:system');
  await expect(preview).toContainText('Nuevo · Sistema');
  await page.getByTestId('ghost-create-store').hover();
  await expect(preview).toHaveAttribute('data-preview', 'create:store');
  await expect(preview).toContainText('Base de datos');
  await page.getByTestId('ghost-input').fill('Pagos Online');
  await expect(preview).toContainText('Pagos Online');
  await page.getByTestId('ghost-input').fill('mongo');
  await expect(preview).toHaveAttribute('data-preview', 'engine:mongodb');
  await expect(preview).toContainText('MongoDB');
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
});

test('Shift al arrastrar muestra guías de alineación', async ({ page }) => {
  const box = (await page.getByTestId('node-pasarela-pagos').boundingBox())!;
  const target = (await page.getByTestId('node-notificaciones').boundingBox())!;
  const grabY = 12;
  await page.mouse.move(box.x + box.width / 2, box.y + grabY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + grabY - 10, { steps: 3 });
  await page.keyboard.down('Shift');
  // Centro casi alineado (3px) con "Notificaciones": la guía vertical debe aparecer y hacer snap.
  await page.mouse.move(target.x + target.width / 2 + 3, box.y + grabY - 40, { steps: 10 });
  await expect(page.locator('.guide-line').first()).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('.guide-line')).toHaveCount(0);
  const after = (await page.getByTestId('node-pasarela-pagos').boundingBox())!;
  expect(Math.abs(after.x + after.width / 2 - (target.x + target.width / 2))).toBeLessThan(1.5);
  expect(await changesCount(page)).toBe(1);
});

test('soltar un nodo dentro de un grupo lo suma como miembro', async ({ page }) => {
  const node = page.getByTestId('node-pasarela-pagos');
  const group = page.getByTestId('group-datacenter');
  const nb = (await node.boundingBox())!;
  const gb = (await group.boundingBox())!;
  // Se toma el nodo a 12px del borde superior: su centro queda (alto/2 - 12) más abajo del cursor.
  const grab = { x: nb.width / 2, y: 12 };
  const targetCenter = { x: gb.x + gb.width / 2, y: gb.y + gb.height * 0.82 };
  await page.mouse.move(nb.x + grab.x, nb.y + grab.y);
  await page.mouse.down();
  await page.mouse.move(targetCenter.x, targetCenter.y - (nb.height / 2 - grab.y), { steps: 12 });
  await page.mouse.up();
  await page.getByTestId('tab-changes').click();
  await page.getByTestId('change-element:pasarela-pagos').getByRole('button', { name: 'Ver detalle' }).click();
  await expect(page.getByTestId('change-element:pasarela-pagos')).toContainText('datacenter');
});

test('el tema se puede cambiar', async ({ page }) => {
  await page.getByRole('button', { name: 'Tema', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Tema', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('la paleta de comandos encuentra elementos de otros lienzos', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('Motor antifraude');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('node-fraude')).toBeVisible();
  await expect(page.getByTestId('breadcrumbs')).toContainText('Pagos API');
});

test('conectar arrastrando desde el punto del borde, sin duplicar relaciones', async ({ page }) => {
  const from = page.getByTestId('node-notificaciones');
  const fb = (await from.boundingBox())!;
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  const handle = page.locator('[data-id="notificaciones"] .react-flow__handle-right');
  await expect(handle).toHaveCSS('opacity', '1');
  const hb = (await handle.boundingBox())!;
  const tb = (await page.getByTestId('node-core-bancario').boundingBox())!;
  // Click inmediato sobre el punto: no se mueve al hacer hover.
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="change-relation:notificaciones--core-bancario"], [data-id="notificaciones--core-bancario"]').first()).toBeAttached();
  expect(await changesCount(page)).toBe(1);

  // Segunda vez: no se crea otra relación, se selecciona la existente.
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText('Ya están conectados')).toBeVisible();
  expect(await changesCount(page)).toBe(1);
});

test('al seleccionar un elemento se animan las flechas hacia sus dependencias', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick({ modifiers: ['Alt'] });
  await framed(page, 'home-banking-containers');
  await page.getByTestId('node-api-gateway').click();
  const out = page.locator('.c4-edge-path[data-flow="out"]');
  await expect(out).toHaveCount(3);
  await expect(out.first()).toHaveCSS('animation-name', 'aegon-flow');
  await expect(page.locator('.c4-edge-path[data-flow="in"]')).toHaveCount(2);
});

test('el bus de mensajería es un tipo propio y sugiere su protocolo', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick({ modifiers: ['Alt'] });
  await framed(page, 'home-banking-containers');
  await expect(page.getByTestId('node-eventos')).toContainText('Apache Kafka');
  await page.getByTestId('edge-label-pagos-api--eventos').click();
  await expect(page.getByText('Sugeridos para stream')).toBeVisible();
});

test('doble click abre un sistema en el lugar, con sus contenedores adentro, y se cierra igual', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick();
  // Sigue en el mismo lienzo: el sistema es un marco y sus contenedores están adentro.
  const frame = page.getByTestId('open-home-banking');
  await expect(frame).toBeVisible();
  await expect(frame).toContainText('8 contenedores');
  await expect(page.getByTestId('breadcrumbs')).not.toContainText('Home Banking');
  // Todas las medidas en el mismo instante: el lienzo todavía puede estar encuadrando el marco.
  const outside = await page.evaluate(() => {
    const box = (testId: string) => document.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect();
    const outer = box('open-home-banking');
    return ['web-app', 'api-gateway', 'pagos-api', 'banking-db'].filter((id) => {
      const inner = box(`node-${id}`);
      return !(inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom);
    });
  });
  expect(outside).toEqual([]);
  expect(await changesCount(page)).toBeGreaterThan(0);

  // Se cierra desde el encabezado y el lienzo vuelve a estar como antes.
  await page.getByTestId('collapse-home-banking').click();
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await expect(page.getByTestId('node-web-app')).toHaveCount(0);
  // Abrir y cerrar son un paso de deshacer cada uno.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('open-home-banking')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  expect(await changesCount(page)).toBe(0);
});

test('la profundidad lleva todo el lienzo a componentes y de vuelta a contexto', async ({ page }) => {
  await expect(page.getByTestId('depth-1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('depth-3').click();
  await expect(page.getByTestId('open-home-banking')).toBeVisible();
  await expect(page.getByTestId('open-pagos-api')).toBeVisible();
  await expect(page.getByTestId('node-transfer-controller')).toBeVisible();
  await expect(page.getByTestId('depth-3')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('depth-1').click();
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await expect(page.getByTestId('node-web-app')).toHaveCount(0);
  await expect(page.getByTestId('depth-1')).toHaveAttribute('aria-pressed', 'true');
});

test('doble click dentro de un sistema abierto crea un contenedor suyo', async ({ page }) => {
  await page.getByTestId('expand-notificaciones').click();
  const frame = page.getByTestId('open-notificaciones');
  await expect(frame).toContainText('vacío');
  const box = (await frame.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.65);
  // Adentro de un sistema se ofrece lo que un sistema contiene.
  await expect(page.locator('[cmdk-item]').first()).toContainText('Contenedor');
  await page.getByTestId('ghost-input').fill('Envío de mails');
  await page.keyboard.press('Enter');
  const node = page.getByTestId('node-envio-de-mails');
  await expect(node).toBeVisible();
  await expect(frame).toContainText('1 contenedor');
  // Es hijo del sistema en el modelo: aparece bajo Notificaciones en el explorador.
  await page.getByTestId('tree-notificaciones').getByRole('button', { name: 'Expandir' }).click();
  await expect(page.getByTestId('tree-envio-de-mails')).toBeVisible();
});

test('la pestaña Lienzos muestra cómo crear un lienzo de despliegue', async ({ page }) => {
  await page.getByRole('button', { name: 'Lienzos', exact: true }).click();
  const button = page.getByTestId('new-deployment-view');
  await expect(button).toBeInViewport({ ratio: 1 });
  await button.click();
  await expect(page.getByTestId('deployment-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  // La demo ya trae un despliegue para ver cómo queda.
  await page.getByTestId('view-row-home-banking-despliegue-prod').click();
  await framed(page, 'home-banking-despliegue-prod');
  await expect(page.getByTestId('deploy-vpc-prod')).toBeVisible();
  await expect(page.getByTestId('node-pagos-api-prod')).toBeVisible();
});

test('el panel Salud lista lo que conviene revisar y lleva al elemento', async ({ page }) => {
  // La demo no tiene errores ni avisos: el indicador de la barra no aparece.
  await expect(page.getByTestId('health-indicator')).toHaveCount(0);
  await page.getByTestId('tab-health').click();
  await expect(page.getByTestId('health-summary')).toHaveText('Sin problemas');
  await page.getByTestId('health-panel').getByText('Motor antifraude').click();
  await framed(page, 'pagos-api-components');
  await expect(page.getByTestId('breadcrumbs')).toContainText('Pagos API');

  // Un contenedor nuevo de un sistema que ya tiene despliegue es un aviso (todavía no se desplegó):
  // aparece el indicador en la barra y el hallazgo en el panel.
  await page.getByTestId('breadcrumbs').getByText('Home Banking').click();
  await framed(page, 'home-banking-containers');
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  await page.getByTestId('ghost-input').fill('Conciliación');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('node-conciliacion')).toBeVisible();
  await expect(page.getByTestId('health-indicator')).toBeVisible();
  await page.getByTestId('health-indicator').click();
  await expect(page.getByTestId('health-panel')).toContainText('Conciliación');
});
