import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { emptyPoint, framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
});

/** Crea el lienzo de despliegue QA de Home Banking desde la paleta. */
async function newDeploymentView(page: Page) {
  await page.getByTestId('node-home-banking').click();
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('lienzo de despliegue');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('deployment-dialog')).toBeVisible();
  await page.getByTestId('deployment-env-qa').click();
  await expect(page.getByTestId('deployment-name')).toHaveValue('Home Banking · Despliegue QA');
  await page.getByTestId('deployment-create').click();
  await framed(page, 'home-banking-despliegue-qa');
  await expect(page.getByTestId('breadcrumbs')).toContainText('QA');
}

test('lienzo de despliegue: nodos desde el fantasma e instancias de contenedores dentro', async ({ page }) => {
  await newDeploymentView(page);

  // "vpc" sugiere un nodo de red.
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  await page.getByTestId('ghost-input').fill('VPC QA');
  await page.locator('[cmdk-item]', { hasText: 'Red / VPC' }).click();
  const vpc = page.getByTestId('deploy-vpc-qa');
  await expect(vpc).toBeVisible();
  await expect(vpc).toContainText('Red / VPC');

  // Desplegar un contenedor dentro del nodo: doble click en su interior.
  const box = (await vpc.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.getByTestId('ghost-input').fill('web');
  await page.getByTestId('ghost-deploy-web-app').click();
  const instance = page.getByTestId('node-web-app-qa');
  await expect(instance).toBeVisible();
  await expect(instance).toHaveAttribute('data-instance', 'true');
  await expect(instance).toContainText('Aplicación web');

  // El inspector muestra que está dentro de la VPC y acepta direcciones.
  await expect(page.getByTestId('inspector-name')).toHaveValue('Web App');
  // Quedó dentro de la VPC (es su padre: el marco la envuelve) y es del ambiente del lienzo.
  const inner = (await instance.boundingBox())!;
  const outer = (await vpc.boundingBox())!;
  expect(inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height).toBe(true);
  await expect(page.getByRole('button', { name: 'QA', pressed: true })).toBeVisible();

  // Las relaciones de Web App se proyectan sobre la instancia si su destino también está desplegado.
  await page.mouse.dblclick(box.x + box.width * 0.88, box.y + box.height * 0.85);
  await page.getByTestId('ghost-input').fill('gateway');
  await page.getByTestId('ghost-deploy-api-gateway').click();
  await expect(page.getByTestId('node-api-gateway-qa')).toBeVisible();
  await expect(page.locator('.react-flow__edge[data-id^="projected:"]').first()).toBeAttached();
});

test('exportar el lienzo a PNG y PDF con cartel y leyenda', async ({ page }) => {
  // Datos del documento para el cartel.
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('datos del documento');
  await page.keyboard.press('Enter');
  await page.getByTestId('document-code').fill('MASTER 1234');
  await page.getByTestId('document-version').fill('v2.0');
  await page.getByTestId('document-author').fill('Arquitectura');
  await page.getByTestId('document-save').click();

  // Desde el botón de la barra superior; la captura no toca el tema ni el lienzo de la app.
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.evaluate(() => {
    const w = window as unknown as { __themes: string[] };
    w.__themes = [];
    new MutationObserver(() => w.__themes.push(document.documentElement.dataset.theme ?? '')).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
  await page.getByTestId('topbar-export').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.locator('[data-testid="export-preview"][data-status="ready"]')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __themes: string[] }).__themes)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  const cartel = page.getByTestId('export-cartel');
  await expect(cartel).toContainText('MASTER 1234');
  await expect(cartel).toContainText('v2.0');
  await expect(cartel).toContainText('Contexto (C4 · nivel 1)');

  const [png] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const pngBytes = readFileSync((await png.path())!);
  expect([...pngBytes.subarray(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG');
  expect(pngBytes.length).toBeGreaterThan(20_000);

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-pdf').click()]);
  expect(pdf.suggestedFilename()).toMatch(/^master-1234-.*\.pdf$/);
  const pdfText = readFileSync((await pdf.path())!).toString('latin1');
  expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
  expect(pdfText).toContain('/Subtype /Image');
  expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true);
});
