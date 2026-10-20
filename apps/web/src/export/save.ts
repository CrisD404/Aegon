import { isDesktop, saveFileDesktop } from '../lib/tauri.ts';

/**
 * Guarda un archivo generado (imagen, PDF, CSV). En el navegador lo descarga; en la app de
 * escritorio abre "Guardar como" y lo escribe con Rust (WebView2 no siempre deja descargar).
 * Devuelve false si el usuario canceló.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  if (isDesktop()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const ext = filename.split('.').pop() ?? '';
    const path = await save({ defaultPath: filename, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
    if (!path) return false;
    await saveFileDesktop(path, await blobToBase64(blob));
    return true;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Nombre de archivo seguro a partir de un título ("Home Banking · Despliegue QA" → "home-banking-despliegue-qa"). */
export function fileSlug(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'diagrama'
  );
}
