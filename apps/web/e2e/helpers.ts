import type { Page } from '@playwright/test';

/** Busca un punto vacío del lienzo (donde el elemento bajo el cursor es el pane). */
export async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
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
export async function framed(page: Page, viewId?: string) {
  await page.locator(viewId ? `[data-testid="canvas"][data-framed="${viewId}"]` : '[data-testid="canvas"][data-framed]').waitFor();
}

export async function changesCount(page: Page) {
  return Number(await page.getByTestId('changes-badge').locator('span').innerText());
}
