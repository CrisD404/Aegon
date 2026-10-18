import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  CornerUpRight,
  Pause,
  Play,
  RotateCcw,
  Split,
  X,
} from 'lucide-react';
import {
  flowFrames,
  frameElements,
  pathLetter,
  relationForStep,
  representativeInView,
  stepTitle,
  viewForFrame,
  type Flow,
  type FlowFrame,
  type Id,
  type LeafStep,
  type Model,
} from '@aegon/core';
import { Glyph } from '@aegon/icons';
import { useUi } from '../store/ui.ts';
import { useWorkspace } from '../store/workspace.ts';
import {
  playerChoose,
  playerGo,
  playerNext,
  playerPrev,
  playerSkip,
  stopPlayer,
} from '../lib/flow-actions.ts';
import { STEP_STYLE } from '../panels/FlowsPanel.tsx';
import { RichText } from '../ui/RichText.tsx';
import { Button, IconButton, Kbd, cn } from '../ui/primitives.tsx';
import { flowElementIds } from './FlowOverlay.tsx';
import { canvasApi } from './api.ts';

/** Espera a que el lienzo termine de encuadrar el lienzo abierto (lo marca con `data-framed`). */
function whenFramed(viewId: Id, run: () => void): () => void {
  const shell = () => document.querySelector<HTMLElement>('[data-testid="canvas"]');
  if (shell()?.dataset.framed === viewId) {
    run();
    return () => {};
  }
  let done = false;
  const observer = new MutationObserver(() => {
    if (!done && shell()?.dataset.framed === viewId) {
      done = true;
      observer.disconnect();
      run();
    }
  });
  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-framed'],
  });
  return () => observer.disconnect();
}

function frameDuration(frame: FlowFrame | undefined): number {
  if (!frame) return 4500;
  const text = `${frame.title ?? ''} ${frame.description ?? ''} ${frame.steps.map((s) => s.step.description ?? '').join(' ')}`;
  return Math.min(9000, Math.max(3500, 2500 + text.length * 40));
}

/**
 * Modo presentación de un flujo: la cámara viaja a los elementos de cada paso (cambiando de
 * lienzo si el paso es de otro nivel), el subtítulo cuenta qué pasa y los controles permiten
 * avanzar, volver, saltar a un paso, elegir caminos y reproducir solo.
 */
export function FlowPlayer() {
  const player = useUi((s) => s.player);
  const activeViewId = useUi((s) => s.activeViewId);
  const model = useWorkspace((s) => s.model);
  const flow = player ? model.flows?.[player.flow] : undefined;
  const frames = useMemo(
    () => (flow && player ? flowFrames(flow, player.choices) : []),
    [flow, player],
  );
  // Tamaño del lienzo: al entrar en modo presentación los paneles se cierran animados y el
  // lienzo crece; se vuelve a encuadrar cuando termina de cambiar.
  const [size, setSize] = useState('');
  useEffect(() => {
    if (!player) return;
    const shell = document.querySelector<HTMLElement>('[data-testid="canvas"]');
    if (!shell) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setSize(`${shell.clientWidth}x${shell.clientHeight}`), 140);
    });
    observer.observe(shell);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [!!player, activeViewId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si el flujo desaparece (deshacer, otro cambio), se sale.
  useEffect(() => {
    if (player && !flow) stopPlayer();
  }, [player, flow]);

  // Cámara: lienzo del paso + encuadre de sus elementos.
  useEffect(() => {
    if (!player || !flow) return;
    const intro = player.index < 0 || player.index >= frames.length;
    let target: Id | null = null;
    let ids: Id[] = [];
    if (intro) {
      target = flow.view && model.views[flow.view] ? flow.view : activeViewId;
      ids = flowElementIds(flow);
    } else {
      const frame = frames[player.index]!;
      target = viewForFrame(model, flow, frame);
      ids = frameElements(frame);
      if (!target) {
        // Notas y saltos: se quedan en el lienzo del último paso con elementos.
        for (let i = player.index - 1; i >= 0 && !target; i--)
          target = viewForFrame(model, flow, frames[i]!);
        target ??= activeViewId;
        ids = [];
      }
    }
    if (!target) return;
    if (target !== activeViewId) {
      useUi.getState().openView(target, { transition: 'fade' });
      return;
    }
    const view = model.views[target];
    if (!view) return;
    const nodes = [
      ...new Set(
        ids.map((id) => representativeInView(model, view, id)).filter((x): x is Id => !!x),
      ),
    ];
    if (!nodes.length) return;
    // La portada ocupa la izquierda; el subtítulo y los controles, abajo: se encuadra en el resto.
    const atEnd = player.index >= frames.length;
    const insets =
      player.index < 0
        ? { left: 540, top: 56, bottom: 80, right: 24 }
        : atEnd
          ? { top: 56, bottom: 300 }
          : { top: 56, bottom: 270, left: 24, right: 24 };
    return whenFramed(target, () =>
      canvasApi.focusArea(nodes, {
        insets,
        padding: intro ? 0.12 : 0.35,
        maxZoom: intro ? 1 : 1.3,
        duration: 700,
      }),
    );
  }, [player?.flow, player?.index, player?.choices, activeViewId, flow, frames, model, size]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reproducción automática.
  useEffect(() => {
    if (!player?.autoplay) return;
    if (player.index >= frames.length && !player.stack.length) return;
    const timer = setTimeout(
      playerNext,
      player.index < 0 ? 4000 : frameDuration(frames[player.index]),
    );
    return () => clearTimeout(timer);
  }, [player?.autoplay, player?.index, player?.flow, player?.stack.length, frames]); // eslint-disable-line react-hooks/exhaustive-deps

  // Teclado: flechas, espacio, inicio/fin, números para elegir camino, Esc para salir.
  useEffect(() => {
    if (!player) return;
    const onKey = (e: KeyboardEvent) => {
      const p = useUi.getState().player;
      if (!p || e.ctrlKey || e.metaKey || e.altKey) return;
      const frame = frames[p.index];
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        handled();
        playerNext();
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        handled();
        playerPrev();
      } else if (e.key === 'Home') {
        handled();
        playerGo(-1);
      } else if (e.key === 'End') {
        handled();
        playerGo(frames.length);
      } else if (e.key === 'Escape') {
        handled();
        stopPlayer();
      } else if (e.key.toLowerCase() === 'a') {
        handled();
        useUi.getState().setPlayer({ ...p, autoplay: !p.autoplay });
      } else if (/^[1-9]$/.test(e.key) && frame?.paths?.mode === 'alternate') {
        const n = Number(e.key) - 1;
        if (n < frame.paths.names.length) {
          handled();
          playerChoose(frame.top, n);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [player, frames]);

  if (!player || !flow) return null;
  const parent = player.stack[player.stack.length - 1];
  const parentFlow = parent ? model.flows?.[parent.flow] : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 z-40" data-testid="flow-player">
      {/* Cabecera */}
      <div className="pointer-events-auto absolute top-3 left-3 flex items-center gap-2 rounded-full border border-line bg-panel/90 py-1 pr-3 pl-1.5 shadow-pop backdrop-blur">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-white">
          <Play size={11} />
        </span>
        {player.stack.map((s) => (
          <span
            key={`${s.flow}:${s.index}`}
            className="flex items-center gap-1 text-[12px] text-fg-subtle"
          >
            {model.flows?.[s.flow]?.name ?? s.flow}
            <ChevronRight size={12} />
          </span>
        ))}
        <span className="text-[12.5px] font-semibold text-fg" data-testid="player-flow-name">
          {flow.name}
        </span>
      </div>
      <div className="pointer-events-auto absolute top-3 right-3">
        <Button size="sm" onClick={stopPlayer} className="shadow-pop" data-testid="player-exit">
          <X size={13} /> Salir <Kbd>Esc</Kbd>
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {player.index < 0 ? (
          <Cover key="intro" flow={flow} model={model} frames={frames} />
        ) : player.index >= frames.length ? (
          <Outro key="outro" flow={flow} frames={frames} parentName={parentFlow?.name} />
        ) : (
          <Caption
            key={`${player.flow}:${frames[player.index]!.key}`}
            frame={frames[player.index]!}
            model={model}
            flowId={flow.id}
          />
        )}
      </AnimatePresence>

      <Controls frames={frames} model={model} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Card({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'pointer-events-auto rounded-xl border border-line bg-panel/95 shadow-pop backdrop-blur',
        className,
      )}
      data-testid={testId}
    >
      {children}
    </motion.div>
  );
}

function Cover({ flow, model, frames }: { flow: Flow; model: Model; frames: FlowFrame[] }) {
  return (
    <div className="absolute top-16 bottom-24 left-4 flex w-[min(500px,calc(100%-32px))] items-start">
      <Card className="flex max-h-full w-full flex-col p-6" testId="player-cover">
        <p className="m-0 text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">
          Flujo · {frames.length} pasos
        </p>
        <h2 className="m-0 mt-1.5 text-[22px] leading-tight font-semibold tracking-[-0.01em] text-fg">
          {flow.name}
        </h2>
        {flow.description ? (
          <RichText
            text={flow.description}
            className="mt-2 text-[13.5px] leading-relaxed text-fg-muted"
          />
        ) : null}
        <ol className="m-0 mt-4 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-auto p-0">
          {frames.map((f, i) =>
            f.kind === 'paths' ? (
              <li
                key={f.key}
                className="flex items-center gap-2 px-1 pt-1.5 text-[11.5px] font-semibold text-ok"
              >
                <Split size={12} /> {f.label}.{' '}
                {f.title ??
                  (f.paths?.mode === 'alternate' ? 'Caminos alternativos' : 'En paralelo')}
              </li>
            ) : (
              <li key={f.key}>
                <button
                  type="button"
                  onClick={() => playerGo(i)}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-[12.5px] text-fg-muted hover:bg-hover hover:text-fg"
                >
                  <span className="w-10 shrink-0 font-mono text-[11px] text-fg-subtle">
                    {f.label}
                  </span>
                  <span className="truncate">
                    {f.title ?? f.steps.map((s) => stepTitle(model, s.step)).join(' · ')}
                  </span>
                </button>
              </li>
            ),
          )}
        </ol>
        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" onClick={() => playerGo(0)} data-testid="player-start">
            <Play size={13} /> Comenzar
          </Button>
          <span className="text-[11.5px] text-fg-subtle">
            <Kbd>→</Kbd> avanzar · <Kbd>A</Kbd> reproducir solo
          </span>
        </div>
      </Card>
    </div>
  );
}

function Outro({
  flow,
  frames,
  parentName,
}: {
  flow: Flow;
  frames: FlowFrame[];
  parentName?: string;
}) {
  return (
    <div className="absolute inset-x-0 top-16 flex justify-center px-4">
      <Card className="w-[min(440px,100%)] p-6 text-center" testId="player-outro">
        <p className="m-0 text-[11px] font-semibold tracking-[0.06em] text-ok uppercase">Fin</p>
        <h2 className="m-0 mt-1.5 text-[20px] font-semibold text-fg">{flow.name}</h2>
        <p className="m-0 mt-1 text-[12.5px] text-fg-subtle">
          {frames.filter((f) => f.kind === 'step').length} pasos recorridos
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => playerGo(0)}>
            <RotateCcw size={13} /> Repetir
          </Button>
          {parentName ? (
            <Button variant="primary" onClick={playerNext}>
              <CornerUpRight size={13} /> Volver a {parentName}
            </Button>
          ) : (
            <Button variant="primary" onClick={stopPlayer}>
              Salir
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function StepLine({ step, model }: { step: LeafStep; model: Model }) {
  const el = (id: Id) => model.elements[id];
  const chip = (id: Id) => {
    const e = el(id);
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 font-medium',
          e ? 'text-fg' : 'text-danger line-through',
        )}
      >
        {e ? <Glyph name={e.kind} size={12} style={{ color: `var(--kind-${e.kind})` }} /> : null}
        {e?.name ?? id}
      </span>
    );
  };
  if (step.type === 'message') {
    const rel = relationForStep(model, step);
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-fg-muted">
        {chip(step.from)}
        <ChevronRight size={13} className="text-accent" />
        {chip(step.to)}
        {rel?.protocols?.length ? (
          <span className="font-mono text-[11px] text-fg-subtle">[{rel.protocols.join(', ')}]</span>
        ) : null}
        {!rel ? <span className="text-[11px] text-warn">sin relación en el modelo</span> : null}
      </span>
    );
  }
  if (step.type === 'process')
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        {chip(step.element)}
      </span>
    );
  if (step.type === 'goto')
    return (
      <span className="text-[12.5px] text-fg-muted">
        Continúa en «{model.flows?.[step.flow]?.name ?? step.flow}»
      </span>
    );
  return null;
}

function Caption({ frame, model, flowId }: { frame: FlowFrame; model: Model; flowId: Id }) {
  const single = frame.steps.length === 1 ? frame.steps[0]! : null;
  const type = frame.kind === 'paths' ? 'paths' : (single?.step.type ?? 'message');
  const style = STEP_STYLE[type];
  const title =
    frame.kind === 'paths'
      ? (frame.title ??
        (frame.paths?.mode === 'alternate' ? '¿Qué camino sigue?' : 'Ocurre en paralelo'))
      : single
        ? stepTitle(model, single.step)
        : 'En paralelo';
  const description = frame.kind === 'paths' ? frame.description : single?.step.description;
  const goto = single?.step.type === 'goto' ? single.step : undefined;
  const flow = model.flows?.[flowId];
  return (
    <div className="absolute inset-x-0 bottom-[84px] flex justify-center px-4">
      <Card className="w-[min(620px,100%)] px-5 py-4" testId="player-caption">
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 min-w-[28px] items-center justify-center rounded-full px-2 font-mono text-[11.5px] font-bold text-white"
            style={{ background: style.color }}
            data-testid="player-step-label"
          >
            {frame.label}
          </span>
          {single?.path ? (
            <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-semibold text-ok">
              Camino {pathLetter(single.path.index)} · {single.path.name}
            </span>
          ) : null}
          <span className="flex-1" />
          <span className="text-[11px] text-fg-subtle">{flow?.name}</span>
        </div>
        <h3
          className="m-0 mt-2 text-[18px] leading-snug font-semibold tracking-[-0.01em] text-fg"
          data-testid="player-title"
        >
          {title}
        </h3>
        {single ? (
          <div className="mt-1.5">
            <StepLine step={single.step} model={model} />
          </div>
        ) : frame.kind === 'step' ? (
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {frame.steps.map((s) => (
              <li key={s.label} className="flex flex-col gap-0.5">
                <span className="text-[12px] font-semibold text-fg">
                  <span className="font-mono text-ok">{s.label}</span> {stepTitle(model, s.step)}
                </span>
                <StepLine step={s.step} model={model} />
              </li>
            ))}
          </ul>
        ) : null}
        {description ? (
          <RichText
            text={description}
            className="mt-2.5 text-[13px] leading-relaxed text-fg-muted"
          />
        ) : null}
        {frame.paths ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {frame.paths.names.map((name, i) =>
              frame.paths!.mode === 'alternate' ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => playerChoose(frame.top, i)}
                  className={cn(
                    'flex h-8 items-center gap-2 rounded-md border px-3 text-[12.5px] font-medium transition-colors',
                    i === frame.paths!.chosen
                      ? 'border-ok bg-ok/12 text-fg'
                      : 'border-line text-fg-muted hover:border-ok hover:text-fg',
                  )}
                  data-testid={`player-path-${i}`}
                >
                  <span className="font-mono text-[11px] text-ok">{pathLetter(i)}</span>
                  {name}
                  <Kbd>{i + 1}</Kbd>
                </button>
              ) : (
                <span
                  key={i}
                  className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-fg-muted"
                >
                  <span className="font-mono text-[11px] text-ok">{pathLetter(i)}</span>
                  {name}
                </span>
              ),
            )}
          </div>
        ) : null}
        {goto && model.flows?.[goto.flow] ? (
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={playerNext} data-testid="player-goto">
              <CornerUpRight size={13} /> Ir a «{model.flows[goto.flow]!.name}»
            </Button>
            <Button size="sm" onClick={playerSkip}>
              Saltar
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Controls({ frames, model }: { frames: FlowFrame[]; model: Model }) {
  const player = useUi((s) => s.player)!;
  const total = frames.length;
  const atEnd = player.index >= total;
  const current = frames[player.index];
  return (
    <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div
        className="pointer-events-auto flex max-w-[min(760px,100%)] items-center gap-1 rounded-xl border border-line bg-panel/95 p-1 shadow-pop backdrop-blur"
        data-testid="player-controls"
      >
        <IconButton
          label="Anterior"
          shortcut="←"
          onClick={playerPrev}
          disabled={player.index < 0 && !player.stack.length}
          data-testid="player-prev"
        >
          <ChevronLeft size={17} />
        </IconButton>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-1.5">
          <Dot
            active={player.index < 0}
            done={player.index >= 0}
            onClick={() => playerGo(-1)}
            title="Portada"
          />
          {frames.map((f, i) => (
            <Dot
              key={f.key}
              active={i === player.index}
              done={i < player.index}
              branch={f.kind === 'paths'}
              onClick={() => playerGo(i)}
              title={`${f.label}. ${f.title ?? f.steps.map((s) => stepTitle(model, s.step)).join(' · ')}`}
            />
          ))}
          <Dot active={atEnd} done={false} onClick={() => playerGo(total)} title="Fin" />
        </div>
        <IconButton
          label={current?.steps[0]?.step.type === 'goto' ? 'Ir al flujo' : 'Siguiente'}
          shortcut="→"
          onClick={playerNext}
          disabled={atEnd && !player.stack.length}
          data-testid="player-next"
        >
          <ChevronRight size={17} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton
          label={player.autoplay ? 'Pausar' : 'Reproducir solo'}
          shortcut="A"
          active={player.autoplay}
          onClick={() => useUi.getState().setPlayer({ ...player, autoplay: !player.autoplay })}
          data-testid="player-autoplay"
        >
          {player.autoplay ? <Pause size={15} /> : <Play size={15} />}
        </IconButton>
        <span
          className="min-w-[52px] px-1.5 text-center font-mono text-[11.5px] text-fg-subtle tabular-nums"
          data-testid="player-position"
        >
          {player.index < 0 ? 'Portada' : atEnd ? 'Fin' : `${player.index + 1}/${total}`}
        </span>
        {player.autoplay && !atEnd ? (
          <span
            key={`${player.flow}:${player.index}`}
            className="player-progress"
            style={{ animationDuration: `${player.index < 0 ? 4000 : frameDuration(current)}ms` }}
          />
        ) : null}
      </div>
    </div>
  );
}

function Dot({
  active,
  done,
  branch,
  onClick,
  title,
}: {
  active: boolean;
  done: boolean;
  branch?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'h-2.5 shrink-0 rounded-full transition-all duration-200',
        active
          ? 'w-6 bg-accent'
          : done
            ? 'w-2.5 bg-accent/45 hover:bg-accent/70'
            : 'w-2.5 bg-line-strong hover:bg-fg-subtle',
        branch && !active && 'rounded-[3px] bg-ok/60',
      )}
    />
  );
}
