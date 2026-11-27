import { expect, test } from '@playwright/test';
import { changesCount, framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
});

test('el modo Simular dice cuánto aguanta, marca lo que satura y usa la capacidad que se cargue', async ({ page }) => {
  await page.getByTestId('node-home-banking').dblclick({ modifiers: ['Alt'] });
  await framed(page, 'home-banking-containers');
  await page.keyboard.press('Escape');

  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('mode-simulate')).toHaveAttribute('aria-pressed', 'true');
  // Con 200 por segundo aguanta: lo primero en ceder es Notificaciones, que recibe todo por el bus.
  await expect(page.getByTestId('sim-rps')).toHaveValue('200');
  await expect(page.getByTestId('sim-verdict')).toContainText('Aguanta hasta 300');
  await expect(page.getByTestId('sim-verdict')).toContainText('se atrasa Notificaciones');
  // Pagos API: 6 réplicas en producción × 300 = 1.800.
  await expect(page.getByTestId('load-pagos-api')).toHaveText('11%');
  await expect(page.getByTestId('load-row-pagos-api')).toContainText('200 de 1.800');

  // Más tráfico: la base satura y frena a quienes la llaman en línea.
  await page.getByTestId('sim-rps').fill('1500');
  await expect(page.getByTestId('sim-verdict')).toContainText('Satura Banking DB');
  await expect(page.getByTestId('load-banking-db')).toHaveAttribute('data-heat', '3');
  await expect(page.getByTestId('load-row-pagos-api')).toContainText('lo frena Banking DB');
  await expect(page.getByTestId('load-row-notificaciones')).toContainText('se acumulan');

  // La capacidad real de la base (el único dato que se carga) cambia el veredicto y es un cambio del modelo.
  const capacity = page.getByTestId('load-capacity-banking-db');
  await capacity.fill('4000');
  await capacity.press('Enter');
  await expect(page.getByTestId('sim-verdict')).toContainText('Satura Cuentas API');
  await expect(page.getByTestId('load-banking-db')).toHaveAttribute('data-heat', '1');
  expect(await changesCount(page)).toBe(1);

  // Al volver a Diseñar el lienzo queda limpio.
  await page.getByTestId('mode-design').click();
  await expect(page.getByTestId('sim-bar')).toHaveCount(0);
  await expect(page.getByTestId('load-banking-db')).toHaveCount(0);
});

test('en el despliegue se simula su ambiente y las instancias muestran la carga', async ({ page }) => {
  await page.getByTestId('mode-deploy').click();
  await framed(page, 'home-banking-despliegue-prod');
  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('sim-bar')).toContainText('Producción');
  await expect(page.getByTestId('load-pagos-api-prod')).toHaveText('11%');
  // La barra de ambientes vuelve al salir de Simular.
  await expect(page.getByTestId('deploy-bar')).toHaveCount(0);
  await page.getByTestId('mode-deploy').click();
  await expect(page.getByTestId('deploy-bar')).toBeVisible();
});
