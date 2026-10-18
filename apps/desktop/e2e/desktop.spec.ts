import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { applyOp } from '@aegon/core';
import { parseWorkspace, serializeWorkspace } from '@aegon/format-yaml';
import { demoModel } from '../../web/src/lib/demo.ts';

/**
 * E2E de la app de escritorio real (Tauri + WebView2): se lanza el ejecutable con el puerto de
 * depuración de WebView2 abierto y Playwright se conecta por CDP. Usa repos git reales.
 */

const EXE = fileURLToPath(new URL('../src-tauri/target/release/aegon.exe', import.meta.url));
const PORT = 9333;

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

let tmp: string;
let app: ChildProcess;
let browser: Browser;
let page: Page;
let work: string;
let other: string;

test.beforeAll(async () => {
  test.skip(!existsSync(EXE), 'Falta compilar la app: pnpm --filter @aegon/desktop build:exe');
  tmp = mkdtempSync(join(tmpdir(), 'aegon-desktop-e2e-'));
  const remote = join(tmp, 'remote.git');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
  work = join(tmp, 'arquitectura');
  git(tmp, 'clone', '-q', remote, work);
  for (const dir of [work]) {
    git(dir, 'config', 'user.name', 'Ana');
    git(dir, 'config', 'user.email', 'ana@aegon.test');
  }
  git(work, 'checkout', '-q', '-b', 'main');
  for (const [path, content] of serializeWorkspace(demoModel())) {
    const full = join(work, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'inicio');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  other = join(tmp, 'beto');
  git(tmp, 'clone', '-q', remote, other);
  git(other, 'config', 'user.name', 'Beto');
  git(other, 'config', 'user.email', 'beto@aegon.test');

  app = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const context = browser.contexts()[0]!;
  page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await page.locator('[data-testid="canvas"]').waitFor({ timeout: 30_000 });
});

test.afterAll(async () => {
  await browser?.close().catch(() => undefined);
  app?.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('abre un repo, publica, detecta cambios externos y actualiza', async () => {
  test.setTimeout(120_000);
  // Abrir la carpeta por ruta (paleta → modal).
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('Abrir carpeta por ruta');
  await page.keyboard.press('Enter');
  await page.getByTestId('prompt-input').fill(work);
  await page.getByTestId('prompt-accept').click();
  await expect(page.getByTestId('sync-indicator')).toContainText('main', { timeout: 20_000 });
  await page.locator('[data-testid="canvas"][data-framed="landscape"]').waitFor();

  // Editar y publicar.
  await page.getByTestId('node-notificaciones').click();
  await page.getByTestId('inspector-name').fill('Mensajería');
  await page.getByTestId('inspector-name').press('Enter');
  await page.getByTestId('tab-changes').click();
  await page.getByTestId('commit-message').fill('Renombrar desde la app de escritorio');
  await page.getByTestId('push-button').click();
  await expect(page.getByText(/Publicado · /)).toBeVisible({ timeout: 20_000 });
  git(other, 'pull', '-q');
  expect(git(other, 'log', '-1', '--format=%s')).toBe('Renombrar desde la app de escritorio');
  expect(readFileSync(join(other, 'model/elements/notificaciones.yaml'), 'utf8')).toContain('name: Mensajería');

  // Un agente (o un editor) cambia un YAML en el disco: la app lo toma solo.
  const file = join(work, 'model/elements/core-bancario.yaml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('name: Core bancario', 'name: Core bancario (editado por IA)'));
  await expect(page.getByTestId('node-core-bancario')).toContainText('editado por IA', { timeout: 15_000 });

  // Otra persona publica: la app se actualiza con "Actualizar".
  const files = new Map<string, string>();
  for (const p of git(other, 'ls-files').split('\n')) files.set(p, readFileSync(join(other, p), 'utf8'));
  const next = applyOp(parseWorkspace(files).model, { type: 'element.update', id: 'pasarela-pagos', patch: { name: 'Pasarela v2' } }).model;
  for (const [p, c] of serializeWorkspace(next, { previous: files })) writeFileSync(join(other, p), c);
  git(other, 'commit', '-qam', 'Pasarela v2');
  git(other, 'push', '-q');
  await page.getByTestId('pull-button').click();
  await expect(page.getByText(/Actualizado a /)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('node-pasarela-pagos')).toContainText('Pasarela v2');
  await expect(page.getByTestId('node-core-bancario')).toContainText('editado por IA');
});
