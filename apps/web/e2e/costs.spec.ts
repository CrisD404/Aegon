import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { changesCount, framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
});

test('la capa de costos muestra totales por nodo y por ambiente', async ({ page }) => {
  await page.getByTestId('dock-costs').click();
  const total = page.getByTestId('cost-chip-total');
  await expect(total).toContainText('10.840');
  await expect(page.getByTestId('cost-home-banking')).toContainText('9,5k');
  await page.getByTestId('cost-chip-env').click();
  await page.getByRole('menuitem', { name: 'Producción', exact: true }).click();
  await expect(total).toContainText('7.670');
  await expect(page.getByTestId('cost-home-banking')).toContainText('6,7k');
  // En L2, la caché no está en desarrollo: queda atenuada con ese ambiente.
  await page.getByTestId('cost-chip-env').click();
  await page.getByRole('menuitem', { name: 'Desarrollo', exact: true }).click();
  await page.getByTestId('node-home-banking').dblclick();
  await framed(page, 'home-banking-containers');
  await expect
    .poll(() => page.locator('.react-flow__node[data-id="cache"]').evaluate((el) => Number(getComputedStyle(el).opacity)))
    .toBeLessThan(0.5);
});

test('el inspector carga costos y despliegue por ambiente', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick();
  await framed(page, 'home-banking-containers');
  await page.getByTestId('node-web-app').click();
  const totalOwn = page.getByTestId('finops-total');
  await expect(totalOwn).toContainText('480');
  await page.getByTestId('cost-prod').fill('400');
  await expect(totalOwn).toContainText('560');
  await page.getByTestId('env-toggle-dev').click();
  await expect(totalOwn).toContainText('520');
  expect(await changesCount(page)).toBe(1);

  await page.getByTestId('tab-costs').click();
  await page.getByTestId('costs-env-prod').click();
  await expect(page.getByTestId('costs-total')).toContainText('7.750');
  await expect(page.getByTestId('costs-budget')).toContainText('86% del presupuesto');
});

test('configurar ambientes: agregar uno y quitar otro confirma en un modal', async ({ page }) => {
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('menu-finops-settings').click();
  const dialog = page.getByTestId('finops-settings');
  await expect(dialog).toBeVisible();
  await page.getByTestId('new-env-name').fill('Staging');
  await page.getByTestId('new-env-name').press('Enter');
  await expect(page.getByTestId('env-row-staging')).toBeVisible();
  await page.getByTestId('env-row-pre').getByRole('button', { name: /Quitar/ }).click();
  await page.getByTestId('finops-settings-save').click();

  const confirm = page.getByTestId('confirm-dialog');
  await expect(confirm).toContainText('¿Quitar "Preproducción"?');
  await page.getByTestId('confirm-accept').click();
  await expect(dialog).toBeHidden();

  await page.getByTestId('tab-costs').click();
  await expect(page.getByTestId('costs-env-staging')).toBeVisible();
  await expect(page.getByTestId('costs-env-pre')).toHaveCount(0);
  await expect(page.getByTestId('costs-total')).toContainText('8.920'); // 10.840 − 1.920 de preproducción
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('costs-env-pre')).toBeVisible();
});

test('exporta los costos como CSV', async ({ page }) => {
  await page.getByTestId('tab-costs').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('costs-export').click()]);
  expect(download.suggestedFilename()).toBe('banca-digital-costos.csv');
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('costo_mensual');
  expect(csv).toContain('pagos-api,Pagos API,container,home-banking,home-banking,prod,Producción,1450,USD,6,c6i.xlarge');
});
