import { expect, test } from '@playwright/test';
import { changesCount, emptyPoint, framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
});

async function openContainers(page: import('@playwright/test').Page) {
  await page.getByTestId('node-home-banking').dblclick();
  await framed(page, 'home-banking-containers');
}

test('el fantasma inserta un bloque de template con IDs nuevos', async ({ page }) => {
  await openContainers(page);
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  await page.getByTestId('ghost-input').fill('gateway');
  await page.getByTestId('ghost-template-builtin:api-gateway').click();
  // El demo ya tiene un "api-gateway": el del bloque recibe otro ID y el original no cambia.
  await expect(page.getByTestId('node-api-gateway-2')).toBeVisible();
  await expect(page.getByTestId('node-servicio-a')).toBeVisible();
  await expect(page.getByTestId('node-api-gateway')).toBeVisible();
  // Todo el bloque se deshace de una vez.
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByTestId('node-api-gateway-2')).toHaveCount(0);
  await expect(page.getByTestId('node-servicio-a')).toHaveCount(0);
  expect(await changesCount(page)).toBe(0);
});

test('la galería inserta bloques solo en el nivel que corresponde', async ({ page }) => {
  // En el lienzo de contexto (L1) un bloque de contenedores no se puede insertar.
  const p = await emptyPoint(page);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Insertar template…' }).click();
  const gallery = page.getByTestId('templates-dialog');
  await expect(gallery).toBeVisible();
  await expect(page.getByTestId('insert-builtin:event-driven')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(gallery).toBeHidden();

  await openContainers(page);
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('menu-templates').click();
  await page.getByTestId('insert-builtin:event-driven').click();
  await expect(gallery).toBeHidden();
  await expect(page.getByTestId('node-productor')).toBeVisible();
  await expect(page.getByTestId('node-proyeccion')).toBeVisible();
});

test('guardar un elemento como template y reutilizarlo', async ({ page }) => {
  await openContainers(page);
  await page.getByTestId('node-pagos-api').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Guardar como template…' }).click();
  const save = page.getByTestId('save-template-dialog');
  await expect(save).toBeVisible();
  await expect(save).toContainText('Guardar bloque como template');
  await page.getByTestId('save-template-name').fill('Servicio de pagos');
  await page.getByTestId('save-template-accept').click();
  await expect(save).toBeHidden();

  // Aparece en el fantasma de cualquier lienzo L2 y trae sus componentes y su lienzo L3.
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  await page.getByTestId('ghost-input').fill('servicio de pagos');
  await page.locator('[data-testid^="ghost-template-user:"]', { hasText: 'Servicio de pagos' }).click();
  await expect(page.getByTestId('node-pagos-api-2')).toBeVisible();
  await page.getByTestId('node-pagos-api-2').dblclick();
  await expect(page.getByTestId('breadcrumbs')).toContainText('Pagos API');
  await expect(page.getByTestId('node-transfer-controller-2')).toBeVisible();

  // Queda en la biblioteca del usuario después de recargar.
  await page.reload();
  await framed(page);
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('menu-templates').click();
  await expect(page.getByTestId('templates-dialog')).toContainText('Servicio de pagos');
});

test('crear un workspace desde un template', async ({ page }) => {
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('menu-new-workspace').click();
  const dialog = page.getByTestId('new-workspace-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('new-workspace-create').click();
  await expect(dialog).toContainText('Poné un nombre');
  await page.getByTestId('new-workspace-name').fill('Plataforma de pagos');
  await page.getByTestId('start-builtin:banca-digital').click();
  await page.getByTestId('new-workspace-create').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('workspace-switcher')).toContainText('Plataforma de pagos');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  expect(await changesCount(page)).toBe(0);

  // En blanco: un lienzo de contexto vacío.
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('menu-new-workspace').click();
  await page.getByTestId('new-workspace-name').fill('Vacío');
  await page.getByTestId('new-workspace-name').press('Enter');
  await expect(page.getByTestId('workspace-switcher')).toContainText('Vacío');
  await expect(page.getByTestId('node-home-banking')).toHaveCount(0);
});

test('descartar cambios confirma en un modal', async ({ page }) => {
  await page.getByTestId('node-notificaciones').click();
  const name = page.getByTestId('inspector-name');
  await name.fill('Mensajería');
  await name.press('Enter');
  expect(await changesCount(page)).toBe(1);

  await page.getByTestId('tab-changes').click();
  await page.getByTestId('discard-all').click();
  const confirm = page.getByTestId('confirm-dialog');
  await expect(confirm).toContainText('¿Descartar 1 cambio?');
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  expect(await changesCount(page)).toBe(1);

  await page.getByTestId('discard-all').click();
  await page.getByTestId('confirm-accept').click();
  await expect(confirm).toBeHidden();
  expect(await changesCount(page)).toBe(0);
  await expect(page.getByTestId('node-notificaciones')).toContainText('Notificaciones');
});

test('quitar un workspace de recientes confirma en un modal', async ({ page }) => {
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('menu-new-workspace').click();
  await page.getByTestId('new-workspace-name').fill('Otro');
  await page.getByTestId('new-workspace-name').press('Enter');
  await expect(page.getByTestId('workspace-switcher')).toContainText('Otro');

  await page.getByTestId('workspace-switcher').click();
  const row = page.getByRole('menuitem', { name: /Banca digital/ });
  await row.hover();
  await row.locator('[data-testid^="remove-recent-"]').click();
  const confirm = page.getByTestId('confirm-dialog');
  await expect(confirm).toContainText('¿Quitar "Banca digital" de recientes?');
  await expect(page.getByTestId('confirm-accept')).toHaveText('Eliminar workspace');
  await page.getByTestId('confirm-accept').click();
  await expect(confirm).toBeHidden();

  await page.getByTestId('workspace-switcher').click();
  await expect(page.getByRole('menuitem', { name: /Banca digital/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Otro/ })).toBeVisible();
});
