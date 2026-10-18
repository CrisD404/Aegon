import { expect, test, type Page } from '@playwright/test';
import { changesCount, emptyPoint, framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
});

async function openContainers(page: Page) {
  await page.getByTestId('node-home-banking').dblclick();
  await framed(page, 'home-banking-containers');
}

test('crear un flujo con pasos desde la selección y reproducirlo', async ({ page }) => {
  await openContainers(page);
  await page.getByRole('button', { name: 'Flujos', exact: true }).click();
  await page.getByTestId('flow-new').click();
  await expect(page.getByTestId('flow-editor')).toBeVisible();
  await page.getByTestId('flow-name').fill('Consulta de saldo');

  // Una relación seleccionada → mensaje sobre esa relación.
  await page.getByTestId('edge-label-web-app--api-gateway').click();
  await page.getByTestId('add-step').click();
  await expect(page.getByTestId('step-0')).toContainText('Web App → API Gateway');
  // Un elemento → proceso.
  await page.getByTestId('node-cuentas-api').click();
  await page.getByTestId('add-step').click();
  await expect(page.getByTestId('step-1')).toContainText('Cuentas API');
  await expect(page.getByTestId('flow-marker-1')).toBeVisible();

  await page.getByTestId('flow-play').click();
  await expect(page.getByTestId('player-cover')).toContainText('Consulta de saldo');
  await expect(page.getByTestId('topbar')).toHaveCount(0);
  await page.getByTestId('player-start').click();
  await expect(page.getByTestId('player-title')).toHaveText('Llama');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('player-title')).toHaveText('Cuentas API procesa');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('player-outro')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('flow-player')).toHaveCount(0);
  await expect(page.getByTestId('topbar')).toBeVisible();
  expect(await changesCount(page)).toBe(1); // el flujo nuevo
});

test('elegir origen y destino de un mensaje tocando el lienzo', async ({ page }) => {
  await openContainers(page);
  await page.getByRole('button', { name: 'Flujos', exact: true }).click();
  await page.getByTestId('flow-new').click();
  await page.keyboard.press('Escape'); // sin selección
  await page.getByTestId('add-step').click();
  await expect(page.getByTestId('pick-banner')).toContainText('tocá el origen');
  await page.getByTestId('node-app-movil').click();
  await expect(page.getByTestId('pick-banner')).toContainText('App móvil');
  await page.getByTestId('node-api-gateway').click();
  await expect(page.getByTestId('pick-banner')).toHaveCount(0);
  await expect(page.getByTestId('step-0')).toContainText('App móvil → API Gateway');
});

test('el flujo de ejemplo baja a L3 y deja elegir el camino', async ({ page }) => {
  await page.getByRole('button', { name: 'Flujos', exact: true }).click();
  await page.getByTestId('flow-play-transferencia').click();
  await page.getByTestId('player-start').click();
  await expect(page.getByTestId('player-step-label')).toHaveText('1');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('player-title')).toHaveText('Evalúa el riesgo');
  await framed(page, 'pagos-api-components');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('player-title')).toHaveText('¿Se aprueba?');
  await page.getByTestId('player-path-1').click();
  await expect(page.getByTestId('player-step-label')).toHaveText('5B.1');
  await expect(page.getByTestId('player-title')).toHaveText('Publica pagos.rechazados');
  await framed(page, 'home-banking-containers');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('player-step-label')).toHaveText('6');
  await page.getByTestId('player-exit').click();
  await framed(page, 'landscape');
});

test('comentar, responder y resolver; el listado lleva al comentario', async ({ page }) => {
  await openContainers(page);
  const p = await emptyPoint(page);
  await page.keyboard.press('c');
  await expect(page.getByTestId('pick-banner')).toBeVisible();
  await page.mouse.click(p.x, p.y);
  const draft = page.getByTestId('comment-draft');
  await expect(draft).toBeVisible();
  await page.getByTestId('comment-author').fill('Ana');
  await page.getByTestId('comment-icon-idea').click();
  await page.getByTestId('comment-body').fill('Cachear saldos en Redis');
  await page.getByTestId('comment-submit').click();
  const card = page.getByTestId('comment-card');
  await expect(card).toContainText('Cachear saldos en Redis');
  await expect(card).toContainText('Ana');
  expect(await changesCount(page)).toBe(1);

  await page.getByTestId('comment-reply-input').fill('Medimos primero');
  await page.getByTestId('comment-reply-input').press('Enter');
  await expect(card.getByTestId('comment-reply')).toHaveCount(1);
  await card.getByTestId('comment-menu').click();
  await page.getByRole('menuitem', { name: 'Resolver' }).click();
  await expect(card).toHaveCount(0);

  await page.getByTestId('tab-comments').click();
  await expect(page.getByTestId('comments-panel')).toContainText('Resueltos 1');
  // Desde otro lienzo, tocar un comentario lo abre en su lienzo.
  await page.getByTestId('breadcrumbs').getByText('Landscape').click();
  await framed(page, 'landscape');
  await page.getByTestId('comments-item-c-migrar-aurora').click();
  await framed(page, 'home-banking-containers');
  await expect(page.getByTestId('comment-card')).toContainText('Aurora');
});

test('ampliar un comentario lo muestra en un modal con sus respuestas', async ({ page }) => {
  await page.getByTestId('tab-comments').click();
  await page.getByTestId('comments-item-c-migrar-aurora').click();
  const card = page.getByTestId('comment-card');
  await expect(card).toBeVisible();
  await card.getByTestId('comment-menu').click();
  await page.getByTestId('comment-expand').click();
  const dialog = page.getByTestId('comment-dialog');
  await expect(dialog).toContainText('Equipo Canales');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
