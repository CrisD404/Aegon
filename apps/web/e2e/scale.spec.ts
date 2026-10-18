import { expect, test, type Page } from '@playwright/test';
import { changesCount, emptyPoint, framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
  await page.getByTestId('node-home-banking').dblclick();
  await framed(page, 'home-banking-containers');
});

const opacityOf = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => Number(getComputedStyle(el).opacity));

test('Ctrl+F busca en el lienzo y recorre las coincidencias', async ({ page }) => {
  await page.keyboard.press('Control+f');
  const input = page.getByTestId('canvas-search-input');
  await expect(input).toBeFocused();
  await input.fill('api');
  const count = page.getByTestId('canvas-search-count');
  await expect(count).toHaveText('1 de 3');
  await expect(page.getByTestId('inspector-name')).toHaveValue('API Gateway');
  await input.press('Enter');
  await expect(count).toHaveText('2 de 3');
  await expect(page.getByTestId('inspector-name')).toHaveValue('Cuentas API');
  await input.press('Shift+Enter');
  await expect(count).toHaveText('1 de 3');
  await input.fill('kafka');
  await expect(count).toHaveText('1 de 1');
  await input.press('Escape');
  await expect(page.getByTestId('canvas-search')).toBeHidden();
});

test('el modo foco atenúa lo que no es dependencia directa', async ({ page }) => {
  await page.getByTestId('node-api-gateway').click();
  await page.getByTestId('dock-focus').click();
  await expect.poll(() => opacityOf(page, 'banking-db')).toBeLessThan(0.5);
  expect(await opacityOf(page, 'cuentas-api')).toBe(1);
  expect(await opacityOf(page, 'web-app')).toBe(1);
  await page.getByTestId('dock-focus').click();
  await expect.poll(() => opacityOf(page, 'banking-db')).toBe(1);
});

test('Shift+L ordena el lienzo con ELK y se deshace en un paso', async ({ page }) => {
  const before = await page.locator('.react-flow__node[data-id="cliente"]').getAttribute('style');
  const p = await emptyPoint(page);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Shift+L');
  // El primer orden carga el worker de ELK (puede tardar con la máquina cargada).
  await expect.poll(() => changesCount(page), { timeout: 20_000 }).toBe(1);
  expect(await page.locator('.react-flow__node[data-id="cliente"]').getAttribute('style')).not.toBe(before);
  await page.keyboard.press('Control+z');
  await expect.poll(() => changesCount(page)).toBe(0);
});

test('el minimapa se muestra y se oculta con M', async ({ page }) => {
  await page.keyboard.press('m');
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
});
