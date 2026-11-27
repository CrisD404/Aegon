import { expect, test, type Page } from '@playwright/test';
import { emptyPoint, framed } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-home-banking')).toBeVisible();
  await framed(page, 'landscape');
});

const selected = (page: Page) => page.locator('.react-flow__node.selected');
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);

/** Lienzo de despliegue vacío (desarrollo) desde el modo Desplegar. */
async function emptyDeployment(page: Page) {
  await page.getByTestId('mode-deploy').click();
  await framed(page, 'home-banking-despliegue-prod');
  await page.getByTestId('deploy-env-dev').click();
  await page.getByTestId('deploy-empty-dev').click();
  await expect(page.getByTestId('deploy-steps')).toBeVisible();
  // La bandeja de lo que falta desplegar se abre sola: se cierra para trabajar en el lienzo.
  await page.getByTestId('deploy-missing').click();
}

async function addFromGhost(page: Page, at: { x: number; y: number }, name: string, item?: string) {
  await page.mouse.dblclick(at.x, at.y);
  await page.getByTestId('ghost-input').fill(name);
  if (item) await page.getByTestId(item).click();
  else await page.keyboard.press('Enter');
  await expect(page.getByTestId('ghost-input')).toHaveCount(0);
}

const rect = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => {
    const node = el as HTMLElement;
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(node.style.transform) ?? [];
    return { x: Math.round(Number(m[1])), y: Math.round(Number(m[2])), w: Math.round(parseFloat(node.style.width)), h: Math.round(parseFloat(node.style.height)) };
  });

test('seleccionar un nodo no le roba el foco al lienzo: Supr, deshacer y copiar actúan sobre el nodo', async ({ page }) => {
  // Renombrar una vez (doble click) enfoca el nombre; Esc cancela.
  await page.getByTestId('node-cliente').dblclick();
  await expect.poll(() => focused(page)).toBe('inspector-name');
  await page.keyboard.type('Otro nombre');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('node-cliente')).toContainText('Cliente');

  // Después de eso, seleccionar otro nodo con un click deja el foco en el lienzo.
  await page.getByTestId('node-operador').click();
  await expect(page.getByTestId('inspector-name')).toHaveValue('Operador de soporte');
  expect(await focused(page)).not.toBe('inspector-name');

  // Supr lo elimina (solo estaba en este lienzo) y Ctrl+Z lo devuelve.
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('node-operador')).toHaveCount(0);
  await expect(page.getByText('Eliminado: Operador de soporte')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('node-operador')).toBeVisible();
  await expect(page.getByText('Deshecho: Eliminar Operador de soporte')).toBeVisible();

  // Ctrl+C y Ctrl+V duplican el nodo seleccionado, y la copia queda seleccionada.
  await page.getByTestId('node-operador').click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('node-operador-de-soporte-copia')).toBeVisible();
  await expect(selected(page)).toHaveCount(1);
  await expect(page.getByTestId('inspector-name')).toHaveValue('Operador de soporte (copia)');
});

test('la selección no guarda fantasmas: tras eliminar, el próximo click selecciona un solo elemento', async ({ page }) => {
  // Eliminar desde el inspector.
  await page.getByTestId('node-operador').click();
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.getByTestId('node-operador')).toHaveCount(0);
  await page.getByTestId('node-cliente').click();
  await expect(page.getByTestId('inspector-name')).toHaveValue('Cliente');

  // Shift suma a la selección; Supr borra lo que solo vive acá y saca del lienzo lo compartido.
  await page.getByTestId('node-pasarela-pagos').click({ modifiers: ['Shift'] });
  await expect(selected(page)).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(selected(page)).toHaveCount(0);
  await page.getByTestId('node-home-banking').click();
  await expect(selected(page)).toHaveCount(1);
  await expect(page.getByTestId('inspector-name')).toHaveValue('Home Banking');
});

test('la descripción entra apenas se agranda el nodo, con los renglones que quepan', async ({ page }) => {
  const desc = page.getByTestId('node-desc-home-banking');
  // En su tamaño compacto el nodo no lleva descripción.
  await expect(desc).toHaveCount(0);

  // Un paso de alto alcanza. El borde de abajo se agarra lejos del medio, donde está el punto para conectar.
  await page.getByTestId('node-home-banking').click();
  const edge = (await page.locator('.react-flow__node[data-id="home-banking"] .react-flow__resize-control.bottom.line').boundingBox())!;
  const x = edge.x + edge.width / 4;
  const y = edge.y + edge.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 3, { steps: 2 });
  await page.mouse.move(x, y + 12, { steps: 6 });
  await page.mouse.up();
  await expect(desc).toBeVisible();
  await expect(desc).toContainText('Consulta de cuentas');
  expect((await rect(page, 'home-banking')).h).toBeLessThan(104);

  // Lo que se ve son renglones enteros, adentro del nodo.
  const fit = await page.getByTestId('node-home-banking').evaluate((node) => {
    const el = node as HTMLElement;
    const text = el.querySelector('.c4-node__desc') as HTMLElement;
    return { lines: Number(text.dataset.lines), shown: text.offsetHeight / 16, gap: el.clientHeight - (text.offsetTop + text.offsetHeight) };
  });
  expect(fit.lines).toBeGreaterThanOrEqual(1);
  expect(Number.isInteger(fit.shown)).toBe(true);
  expect(fit.shown).toBeLessThanOrEqual(fit.lines);
  expect(fit.gap).toBeGreaterThanOrEqual(3);

  // Ctrl+Z devuelve el tamaño y la descripción se va.
  await page.keyboard.press('Control+z');
  await expect(desc).toHaveCount(0);
});

test('despliegue: el tamaño que se le da a un nodo se conserva al crear otros', async ({ page }) => {
  await emptyDeployment(page);
  const p = await emptyPoint(page);
  await addFromGhost(page, { x: p.x + 280, y: p.y + 200 }, 'Servidor A');
  await page.keyboard.press('Escape');
  const before = await rect(page, 'servidor-a');

  // Agrandar desde la esquina inferior derecha.
  await page.getByTestId('deploy-servidor-a').locator('.c4-deploy__head').click();
  const box = (await page.locator('.react-flow__node[data-id="servidor-a"]').boundingBox())!;
  await page.mouse.move(box.x + box.width, box.y + box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 120, box.y + box.height + 90, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await rect(page, 'servidor-a')).w).toBeGreaterThan(before.w);
  const resized = await rect(page, 'servidor-a');
  await page.keyboard.press('Escape');

  // Un nodo creado adentro nace más chico y queda contenido; el de afuera no pierde su tamaño.
  const inner = (await page.locator('.react-flow__node[data-id="servidor-a"]').boundingBox())!;
  await addFromGhost(page, { x: inner.x + inner.width * 0.4, y: inner.y + inner.height * 0.55 }, 'VM interna');
  const vm = await rect(page, 'vm-interna');
  const host = await rect(page, 'servidor-a');
  expect(vm.w).toBeLessThan(host.w);
  expect(host.w).toBeGreaterThanOrEqual(resized.w);
  expect(host.h).toBeGreaterThanOrEqual(resized.h);
  expect(vm.x >= host.x && vm.y >= host.y && vm.x + vm.w <= host.x + host.w && vm.y + vm.h <= host.y + host.h).toBe(true);
});

test('despliegue: un servidor es un nodo con IP y lo que corre adentro nace desplegado', async ({ page }) => {
  await emptyDeployment(page);
  const p = await emptyPoint(page);

  // El menú de agregar habla de servidores y servicios, y no ofrece un sistema suelto.
  await page.mouse.dblclick(p.x + 280, p.y + 200);
  await expect(page.getByTestId('ghost-create-node')).toContainText('Lleva la IP');
  await expect(page.getByTestId('ghost-create-service')).toContainText('Servicio o aplicación');
  await expect(page.getByTestId('ghost-create-system')).toHaveCount(0);
  await page.getByTestId('ghost-input').fill('VM de dominio');
  await page.keyboard.press('Enter');
  const vm = page.getByTestId('deploy-vm-de-dominio');
  await expect(vm).toContainText('Máquina virtual');

  // La dirección va en el nodo.
  await page.getByTestId('section-red').click();
  await expect(page.getByTestId('section-red')).toBeVisible();

  // Adentro, un servicio del catálogo: se crea el servicio y su instancia en este ambiente.
  await page.keyboard.press('Escape');
  const box = (await vm.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.7);
  await page.getByTestId('ghost-input').fill('active dir');
  await page.getByTestId('ghost-tech-active-directory').click();
  const instance = page.locator('.react-flow__node[data-id="active-directory-dev"]');
  await expect(instance).toBeVisible();
  await expect(instance).toContainText('Active Directory');
  await expect(page.getByTestId('inspector-name')).toHaveValue('Active Directory');
  // En el lienzo de un sistema, el servicio nuevo es un contenedor suyo; lo que se ve acá es su instancia.
  await expect(page.getByText(/^Instancia · /)).toBeVisible();

  // Doble click en la instancia renombra: no saca del lienzo de despliegue.
  await instance.dblclick();
  await expect.poll(() => focused(page)).toBe('inspector-name');
  await expect(page.getByTestId('breadcrumbs')).toContainText('Desarrollo');
  await page.keyboard.press('Escape');

  // Copiar y pegar el servidor trae lo que tiene adentro.
  await vm.locator('.c4-deploy__head').click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('deploy-vm-de-dominio-copia')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="active-directory-copia"]')).toBeVisible();
});
