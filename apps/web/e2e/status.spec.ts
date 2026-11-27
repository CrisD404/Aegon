import { expect, test, type Page } from '@playwright/test';
import { framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
});

const opacity = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => Number(getComputedStyle(el).opacity));

test('despliegue: lo nuevo se marca con click derecho y se ve en el nodo, en lo que contiene y en la leyenda', async ({ page }) => {
  await page.getByTestId('mode-deploy').click();
  await framed(page, 'home-banking-despliegue-prod');
  // Sin nada marcado no hay leyenda: el lienzo no suma ruido.
  await expect(page.getByTestId('status-legend')).toHaveCount(0);

  const phone = page.getByTestId('deploy-celular');
  await phone.locator('.c4-deploy__head').click({ button: 'right' });
  await page.getByTestId('ctx-status').hover();
  await page.getByTestId('ctx-status-planned').click();
  // Sin selección: el modo foco no atenúa nada y lo que se mide abajo es solo la leyenda.
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);

  // El nodo lleva la etiqueta; lo que corre adentro toma el color sin repetirla.
  await expect(phone).toHaveAttribute('data-status', 'planned');
  await expect(phone.locator('.c4-status')).toHaveText('Nuevo');
  const inside = page.locator('.c4-node[data-status="planned"]');
  await expect(inside).toHaveCount(1);
  await expect(inside.locator('.c4-status')).toHaveCount(0);
  // Las flechas que llegan a algo nuevo también son nuevas.
  await expect(page.locator('.c4-edge-path[data-status="planned"]').first()).toBeAttached();

  // La leyenda cuenta lo marcado y, con un click, deja a la vista solo eso.
  const legend = page.getByTestId('status-legend-planned');
  await expect(legend).toContainText('Nuevo');
  await legend.click();
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => opacity(page, 'alb-prod')).toBeLessThan(0.5);
  expect(await opacity(page, 'celular')).toBe(1);
  await legend.click();
  await expect.poll(() => opacity(page, 'alb-prod')).toBe(1);

  // Deshacer quita la marca y, con ella, la leyenda.
  await page.keyboard.press('Control+z');
  await expect(phone).not.toHaveAttribute('data-status', 'planned');
  await expect(page.getByTestId('status-legend')).toHaveCount(0);
});

test('el estado se elige bajo el nombre y se puede marcar a varios a la vez', async ({ page }) => {
  // Desde el inspector: la pastilla bajo el nombre.
  await page.getByTestId('node-operador').click();
  await expect(page.getByTestId('status-picker')).toContainText('Existente');
  await page.getByTestId('status-picker').click();
  await page.getByTestId('status-option-changing').click();
  await expect(page.getByTestId('status-picker')).toContainText('Se modifica');
  await expect(page.getByTestId('node-operador')).toHaveAttribute('data-status', 'changing');
  await expect(page.getByTestId('node-operador').locator('.c4-status')).toHaveText('Se modifica');

  // Varios seleccionados: un click los marca a todos y un Ctrl+Z los desmarca.
  await page.getByTestId('node-cliente').click();
  await page.getByTestId('node-pasarela-pagos').click({ modifiers: ['Shift'] });
  await page.getByTestId('multi-status-deprecated').click();
  await expect(page.getByTestId('node-cliente').locator('.c4-status')).toHaveText('Baja');
  await expect(page.getByTestId('node-pasarela-pagos').locator('.c4-status')).toHaveText('Baja');
  await expect(page.getByTestId('status-legend-deprecated')).toBeVisible();
  await expect(page.getByTestId('status-legend-changing')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('node-cliente')).not.toHaveAttribute('data-status', 'deprecated');
  await expect(page.getByTestId('node-pasarela-pagos')).not.toHaveAttribute('data-status', 'deprecated');

  // Volver a «existente» quita la marca.
  await page.getByTestId('node-operador').click();
  await page.getByTestId('status-picker').click();
  await page.getByTestId('status-option-live').click();
  await expect(page.getByTestId('node-operador').locator('.c4-status')).toHaveCount(0);
  await expect(page.getByTestId('status-legend')).toHaveCount(0);
});
