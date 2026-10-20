/**
 * Escritor de PDF mínimo: una página con una imagen RGB comprimida sin pérdida (FlateDecode) y
 * los metadatos del documento. Alcanza para exportar un diagrama sin sumar una biblioteca de PDF
 * de cientos de KB; la compresión usa `CompressionStream` del navegador.
 */

export type PageSize = 'fit' | 'a4' | 'a3';

export interface PdfMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

/** Tamaños ISO en puntos (apaisado). */
const ISO: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [841.89, 595.28],
  a3: [1190.55, 841.89],
};

const PX_TO_PT = 0.75; // 96 px = 72 pt

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Texto de PDF en UTF-16BE (acepta acentos y cualquier carácter). */
function pdfText(s: string): string {
  let hex = 'FEFF';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += code.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

function pdfDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `(D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())})`;
}

/**
 * Arma el PDF a partir de un canvas. `cssWidth`/`cssHeight` es el tamaño lógico de la imagen (el
 * canvas puede tener más píxeles por la densidad); con `fit` la página mide eso.
 */
export async function canvasToPdf(canvas: HTMLCanvasElement, opts: { cssWidth: number; cssHeight: number; page: PageSize; meta: PdfMeta; background?: string }): Promise<Blob> {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d')!;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    // Sin canal alfa en el PDF: lo transparente se compone sobre blanco.
    const a = rgba[i + 3]! / 255;
    rgb[j] = Math.round(rgba[i]! * a + 255 * (1 - a));
    rgb[j + 1] = Math.round(rgba[i + 1]! * a + 255 * (1 - a));
    rgb[j + 2] = Math.round(rgba[i + 2]! * a + 255 * (1 - a));
  }
  const image = await deflate(rgb);

  const imgW = opts.cssWidth * PX_TO_PT;
  const imgH = opts.cssHeight * PX_TO_PT;
  let pageW: number;
  let pageH: number;
  let drawW = imgW;
  let drawH = imgH;
  let x = 0;
  let y = 0;
  if (opts.page === 'fit') {
    pageW = imgW;
    pageH = imgH;
  } else {
    const [long, short] = ISO[opts.page];
    const landscape = imgW >= imgH;
    pageW = landscape ? long : short;
    pageH = landscape ? short : long;
    const margin = 24;
    const scale = Math.min((pageW - margin * 2) / imgW, (pageH - margin * 2) / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
    x = (pageW - drawW) / 2;
    y = (pageH - drawH) / 2;
  }
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  const content = `q\n${f(drawW)} 0 0 ${f(drawH)} ${f(x)} ${f(y)} cm\n/Im0 Do\nQ\n`;

  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string | Uint8Array[], dict?: string) => {
    offsets[n] = length;
    if (typeof body === 'string') push(`${n} 0 obj\n${body}\nendobj\n`);
    else {
      push(`${n} 0 obj\n${dict}\nstream\n`);
      for (const b of body) push(b);
      push('\nendstream\nendobj\n');
    }
  };

  // Encabezado con bytes binarios (así los visores no lo tratan como texto).
  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pageW)} ${f(pageH)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, [image], `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>`);
  const contentBytes = enc.encode(content);
  object(5, [contentBytes], `<< /Length ${contentBytes.length} >>`);
  const info = [
    opts.meta.title ? `/Title ${pdfText(opts.meta.title)}` : '',
    opts.meta.author ? `/Author ${pdfText(opts.meta.author)}` : '',
    opts.meta.subject ? `/Subject ${pdfText(opts.meta.subject)}` : '',
    opts.meta.keywords ? `/Keywords ${pdfText(opts.meta.keywords)}` : '',
    `/Creator ${pdfText('Aegon')}`,
    `/Producer ${pdfText('Aegon')}`,
    `/CreationDate ${pdfDate()}`,
  ]
    .filter(Boolean)
    .join(' ');
  object(6, `<< ${info} >>`);

  const xref = length;
  push(`xref\n0 7\n0000000000 65535 f \n`);
  for (let n = 1; n <= 6; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
