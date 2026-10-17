import { useEffect, useRef } from 'react';
import { useStore } from '@xyflow/react';
import { useUi } from '../store/ui.ts';

const SIZE = 20;
const STEPS = [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

function pickStep(zoom: number) {
  return STEPS.find((s) => s * zoom >= 72) ?? STEPS[STEPS.length - 1]!;
}

// getComputedStyle fuerza un recálculo de estilos: se lee una sola vez por tema.
const colorCache = new Map<string, string>();
function color(name: string, theme: string) {
  const key = `${theme}:${name}`;
  let value = colorCache.get(key);
  if (!value) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
    colorCache.set(key, value);
  }
  return value;
}

/** Reglas superior e izquierda sincronizadas con el viewport (en unidades del lienzo). */
export function Rulers() {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const theme = useUi((s) => s.resolvedTheme);
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => paint());
    return () => cancelAnimationFrame(frame);
    function paint() {
    const dpr = window.devicePixelRatio || 1;
    const text = color('--fg-subtle', theme);
    const tick = color('--line-strong', theme);
    const step = pickStep(zoom);
    const minor = step / 4;

    const draw = (canvas: HTMLCanvasElement | null, length: number, offset: number, vertical: boolean) => {
      if (!canvas || length <= 0) return;
      canvas.width = (vertical ? SIZE : length) * dpr;
      canvas.height = (vertical ? length : SIZE) * dpr;
      canvas.style.width = `${vertical ? SIZE : length}px`;
      canvas.style.height = `${vertical ? length : SIZE}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '500 9.5px "JetBrains Mono Variable", ui-monospace, monospace';
      ctx.fillStyle = text;
      ctx.strokeStyle = tick;
      ctx.lineWidth = 1;
      // Rango visible en coordenadas del lienzo.
      const start = Math.floor((SIZE - offset) / zoom / minor) * minor;
      const end = (length - offset) / zoom;
      ctx.beginPath();
      for (let v = start; v <= end; v += minor) {
        const p = Math.round(v * zoom + offset) + 0.5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const len = major ? 8 : 4;
        if (vertical) {
          ctx.moveTo(SIZE - len, p);
          ctx.lineTo(SIZE, p);
        } else {
          ctx.moveTo(p, SIZE - len);
          ctx.lineTo(p, SIZE);
        }
        if (major) {
          const label = String(Math.round(v));
          if (vertical) {
            ctx.save();
            ctx.translate(9, p + 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          } else {
            ctx.fillText(label, p + 3, 10);
          }
        }
      }
      ctx.stroke();
    };
    draw(topRef.current, width, tx, false);
    draw(leftRef.current, height, ty, true);
    }
  }, [tx, ty, zoom, width, height, theme]);

  return (
    <>
      <div className="ruler top-0 right-0 left-0 overflow-hidden border-b border-line" style={{ height: SIZE }}>
        <canvas ref={topRef} />
      </div>
      <div className="ruler top-0 bottom-0 left-0 overflow-hidden border-r border-line" style={{ width: SIZE }}>
        <canvas ref={leftRef} />
      </div>
      <div className="ruler top-0 left-0 border-r border-b border-line" style={{ width: SIZE, height: SIZE }} />
    </>
  );
}
