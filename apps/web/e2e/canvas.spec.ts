import { expect, test, type Page } from '@playwright/test';

/** Busca un punto vacío del lienzo (donde el elemento bajo el cursor es el pane). */
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas"]')!.getBoundingClientRect();
    for (let y = canvas.top + 60; y < canvas.bottom - 120; y += 40) {
      for (let x = canvas.left + 60; x < canvas.right - 60; x += 40) {
        const el = document.elementFromPoint(x, y);
        if (el?.classList.contains('react-flow__pane')) {
          // Margen: que alrededor también esté vacío (el fantasma ocupa ~240x120).
          const ok = [[-140, -70], [140, -70], [-140, 70], [140, 70]].every(([dx, dy]) => document.elementFromPoint(x + dx!, y + dy!)?.classList.contains('react-flow__pane'));
          if (ok) return { x, y };
        }
      }
    }
    return null;
  });
  if (!point) throw new Error('No hay espacio vacío en el lienzo');
  return point;
}

/** Espera a que el lienzo termine de encuadrar el lienzo activo (y su animación de entrada). */
async function framed(page: Page, viewId?: string) {
  await page.locator(viewId ? `[data-testid="canvas"][data-framed="${viewId}"]` : '[data-testid="canvas"][data-framed]').waitFor();
}

async function changesCount(page: Page) {
  return Number(await page.getByTestId('changes-badge').locator('span').innerText());
}

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

test('doble click baja de nivel y los breadcrumbs suben', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick();
  await expect(page.getByTestId('node-pagos-api')).toBeVisible();
  await expect(page.getByTestId('breadcrumbs')).toContainText('Home Banking');
  await page.getByTestId('node-pagos-api').dblclick();
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
  await page.getByTestId('node-home-banking').dblclick();
  await expect(page.getByTestId('node-web-app')).toBeVisible();
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  await page.getByTestId('ghost-input').fill('Operador');
  await page.getByTestId('ghost-existing-operador').click();
  await expect(page.getByTestId('node-operador')).toBeVisible();
  await expect(page.getByText('Aparece en 2 lienzos')).toBeVisible();
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
  await page.getByTestId('node-home-banking').dblclick();
  await framed(page, 'home-banking-containers');
  await page.getByTestId('node-api-gateway').click();
  const out = page.locator('.c4-edge-path[data-flow="out"]');
  await expect(out).toHaveCount(3);
  await expect(out.first()).toHaveCSS('animation-name', 'aegon-flow');
  await expect(page.locator('.c4-edge-path[data-flow="in"]')).toHaveCount(2);
});

test('el bus de mensajería es un tipo propio y sugiere su protocolo', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick();
  await framed(page, 'home-banking-containers');
  await expect(page.getByTestId('node-eventos')).toContainText('Apache Kafka');
  await page.getByTestId('edge-label-pagos-api--eventos').click();
  await expect(page.getByText('Sugeridos para stream')).toBeVisible();
});

