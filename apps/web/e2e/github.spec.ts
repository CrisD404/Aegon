import { expect, test, type Page } from '@playwright/test';
import { applyOp, type Op } from '@aegon/core';
import { parseWorkspace, serializeWorkspace } from '@aegon/format-yaml';
import { FakeGitHub } from '../../../packages/git/src/testing/fake-github.ts';

/** Intercepta la API de GitHub y la atiende con un repo en memoria (sin red). */
async function mockGitHub(page: Page) {
  const gh = new FakeGitHub('acme', 'arquitectura');
  gh.pushFiles('main', { 'README.md': '# Arquitectura\n' }, 'inicio');
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const res = await gh.fetch(req.url(), { method: req.method(), body: req.postData() ?? undefined });
    await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  });
  return gh;
}

/** Simula un push de otra persona sobre el repo remoto. */
function remoteEdit(gh: FakeGitHub, op: Op) {
  const files = gh.filesAt('main');
  const model = applyOp(parseWorkspace(files).model, op).model;
  gh.pushFiles('main', serializeWorkspace(model, { previous: files }), 'cambio remoto');
}

async function framed(page: Page, viewId: string) {
  await page.locator(`[data-testid="canvas"][data-framed="${viewId}"]`).waitFor();
}

async function publishDemo(page: Page) {
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: 'Publicar en GitHub…' }).click();
  await page.getByTestId('github-repo').fill('https://github.com/acme/arquitectura');
  await page.getByTestId('github-token').fill('github_pat_prueba');
  await page.getByTestId('github-submit').click();
  await expect(page.getByText('Publicado en GitHub: acme/arquitectura@main')).toBeVisible({ timeout: 15_000 });
  await framed(page, 'landscape');
}

async function rename(page: Page, nodeId: string, name: string) {
  await page.getByTestId(`node-${nodeId}`).click();
  const input = page.getByTestId('inspector-name');
  await input.fill(name);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await framed(page, 'landscape');
});

test('publicar el workspace en GitHub y hacer commit & push', async ({ page }) => {
  const gh = await mockGitHub(page);
  await publishDemo(page);
  expect(gh.filesAt('main').get('README.md')).toBe('# Arquitectura\n');
  expect(parseWorkspace(gh.filesAt('main')).model.elements['home-banking']).toBeDefined();
  await expect(page.getByTestId('sync-indicator')).toContainText('main');

  await rename(page, 'notificaciones', 'Mensajería');
  await page.getByTestId('tab-changes').click();
  await expect(page.getByTestId('commit-message')).toHaveValue(/Actualizar sistema Mensajería/);
  await page.getByTestId('commit-message').fill('Renombrar Notificaciones');
  await page.getByTestId('push-button').click();
  await expect(page.getByText(/Publicado · c/)).toBeVisible({ timeout: 15_000 });
  expect(parseWorkspace(gh.filesAt('main')).model.elements.notificaciones!.name).toBe('Mensajería');
  const head = gh.refs.get('main')!;
  expect(gh.commits.get(head)!.message).toBe('Renombrar Notificaciones');
  await expect(page.getByTestId('changes-badge')).toContainText('0');
});

test('combina cambios remotos en otras entidades sin preguntar', async ({ page }) => {
  const gh = await mockGitHub(page);
  await publishDemo(page);
  remoteEdit(gh, { type: 'element.update', id: 'core-bancario', patch: { owner: 'Equipo Core' } });

  await rename(page, 'notificaciones', 'Mensajería');
  await page.getByTestId('tab-changes').click();
  await page.getByTestId('push-button').click();
  await expect(page.getByText(/Publicado · c/)).toBeVisible({ timeout: 15_000 });
  const remote = parseWorkspace(gh.filesAt('main')).model;
  expect(remote.elements.notificaciones!.name).toBe('Mensajería');
  expect(remote.elements['core-bancario']!.owner).toBe('Equipo Core');
});

test('conflicto en el mismo campo: se elige la versión remota', async ({ page }) => {
  const gh = await mockGitHub(page);
  await publishDemo(page);
  remoteEdit(gh, { type: 'element.update', id: 'notificaciones', patch: { name: 'Notificaciones 2.0' } });

  await rename(page, 'notificaciones', 'Mensajería');
  await page.getByTestId('tab-changes').click();
  await page.getByTestId('push-button').click();
  const conflict = page.getByTestId('conflict-element:notificaciones');
  await expect(conflict).toContainText('Notificaciones 2.0');
  await expect(conflict).toContainText('Mensajería');
  await conflict.getByRole('radio', { name: 'Usar lo remoto' }).click();
  await page.getByTestId('resolve-button').click();
  await expect(page.getByText(/Publicado · c/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('node-notificaciones')).toContainText('Notificaciones 2.0');
  expect(parseWorkspace(gh.filesAt('main')).model.elements.notificaciones!.name).toBe('Notificaciones 2.0');
});

test('actualizar trae lo remoto y conserva el borrador', async ({ page }) => {
  const gh = await mockGitHub(page);
  await publishDemo(page);
  remoteEdit(gh, { type: 'element.update', id: 'core-bancario', patch: { name: 'Core v2' } });
  await rename(page, 'notificaciones', 'Mensajería');

  await page.getByTestId('tab-changes').click();
  await page.getByTestId('pull-button').click();
  await expect(page.getByText(/Actualizado a c/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('node-core-bancario')).toContainText('Core v2');
  await expect(page.getByTestId('node-notificaciones')).toContainText('Mensajería');
  // El borrador sigue pendiente de publicar, la base ya incluye lo remoto.
  await expect(page.getByTestId('change-element:notificaciones')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('change-element:core-bancario')).toHaveCount(0);
});
