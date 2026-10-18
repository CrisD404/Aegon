import { expect, test, type Page } from '@playwright/test';

/**
 * Benchmarks de escala (Fase 4). Miden, en el build de producción:
 * - cuánto tarda en abrir un workspace de ~5.300 elementos (desde la navegación hasta el lienzo encuadrado);
 * - cuánto tarda en abrir el lienzo L2 de 1.000 contenedores;
 * - los cuadros por segundo al desplazar y hacer zoom con los 1.000 nodos visibles, y a un zoom
 *   de trabajo con unos 200.
 *
 * Objetivos: abrir en menos de 1,5 s y mantener ~60 fps. Los resultados quedan en la salida y en
 * `bench/results.json`. Correr con `pnpm bench` (en Windows: `PLAYWRIGHT_CHANNEL=msedge`).
 */

test.describe.configure({ mode: 'serial' });

interface FrameStats {
  fps: number;
  p50: number;
  p95: number;
  max: number;
  long: number;
}

const results: Record<string, number | FrameStats> = {};

async function startFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__frames = [];
    w.__recording = true;
    const tick = (t: number) => {
      if (!w.__recording) return;
      w.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrames(page: Page): Promise<FrameStats> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__recording = false;
    const f = w.__frames;
    const d: number[] = [];
    for (let i = 1; i < f.length; i++) d.push(f[i]! - f[i - 1]!);
    d.sort((a, b) => a - b);
    const duration = f[f.length - 1]! - f[0]!;
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      fps: round((f.length - 1) / (duration / 1000)),
      p50: round(d[Math.floor(d.length * 0.5)] ?? 0),
      p95: round(d[Math.floor(d.length * 0.95)] ?? 0),
      max: round(d[d.length - 1] ?? 0),
      long: d.filter((x) => x > 50).length,
    };
  });
}

/** Desplaza (rueda) y hace zoom (Ctrl + rueda) durante ~2 s sobre el centro del lienzo. */
async function panAndZoom(page: Page): Promise<FrameStats> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await startFrames(page);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(i % 20 < 10 ? 60 : -60, i % 10 < 5 ? 40 : -40);
    await page.waitForTimeout(16);
  }
  await page.keyboard.down('Control');
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, i < 15 ? -40 : 40);
    await page.waitForTimeout(16);
  }
  await page.keyboard.up('Control');
  return stopFrames(page);
}

async function openPalette(page: Page, query: string) {
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill(query);
  await page.keyboard.press('Enter');
}

test('workspace de 5k elementos y lienzo de 1.000 nodos', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.locator('[data-testid="canvas"][data-framed]').waitFor();

  // Generar el workspace grande (queda guardado en el navegador como último abierto).
  await openPalette(page, 'workspace escala');
  await expect(page.getByTestId('workspace-switcher')).toContainText('Escala', { timeout: 60_000 });
  await page.locator('[data-testid="canvas"][data-framed="landscape"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200); // autoguardado del borrador y persistencia

  // Abrir en frío: navegación → workspace leído, parseado y lienzo encuadrado.
  await page.reload();
  await page.locator('[data-testid="canvas"][data-framed="landscape"]').waitFor({ timeout: 60_000 });
  // `data-framed` se marca 300 ms después de terminar el encuadre animado: se descuenta.
  results.openWorkspaceMs = Math.round((await page.evaluate(() => performance.now())) - 300);

  // Lienzo L2 con 1.000 contenedores.
  const t0 = await page.evaluate(() => performance.now());
  await openPalette(page, 'lienzo Sistema 1 Contenedores');
  await page.locator('[data-testid="canvas"][data-framed="sys-0-containers"]').waitFor({ timeout: 60_000 });
  results.openLargeViewMs = Math.round((await page.evaluate(() => performance.now())) - t0 - 300);
  await page.waitForTimeout(800);

  results.panZoomAll = await panAndZoom(page);

  // Zoom de trabajo (~0,5): unos 200 nodos en pantalla con más detalle.
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(600);
  results.zoomAtWork = await page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('.react-flow__viewport')!).transform;
    return Math.round(new DOMMatrix(t).a * 100) / 100;
  });
  results.nodesRendered = await page.locator('.react-flow__node').count();
  results.panZoomWork = await panAndZoom(page);

  console.table(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, typeof v === 'number' ? { value: v } : v])));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(new URL('./results.json', import.meta.url), `${JSON.stringify({ at: new Date().toISOString(), ...results }, null, 2)}\n`);

  // Regresiones groseras (los objetivos finos se leen en la tabla).
  expect(results.openWorkspaceMs as number).toBeLessThan(6000);
  expect((results.panZoomAll as FrameStats).fps).toBeGreaterThan(20);
});
