import { ArrowUpRight } from 'lucide-react';
import {
  INFRA_TYPES,
  INFRA_TYPE_LABEL,
  INSTANCE_OF_KINDS,
  NODE_PROVIDER_CATALOG,
  NODE_TYPES,
  NODE_TYPE_LABEL,
  canHaveParent,
  deploymentPath,
  sortedValues,
  type Element,
  type ElementPatch,
  type NodeDetails,
} from '@aegon/core';
import { useWorkspace } from '../store/workspace.ts';
import { revealElement } from '../lib/actions.ts';
import { Field, Select, TagInput, TextInput } from '../ui/primitives.tsx';

type Update = (patch: ElementPatch, field: string) => void;
type DeploymentElement = Extract<Element, { kind: 'node' | 'infra' | 'instance' }>;

/**
 * Campos de despliegue del inspector: qué es el nodo o la infraestructura, qué despliega una
 * instancia, dónde está (nodo padre) y sus datos de red (direcciones, ID del recurso).
 */
export function DeploymentFields({ el, update }: { el: DeploymentElement; update: Update }) {
  const model = useWorkspace((s) => s.model);
  const hosts = sortedValues(model.elements).filter((n) => n.kind === 'node' && n.id !== el.id && canHaveParent(el.kind, n.kind));
  const path = deploymentPath(model, el.id);

  return (
    <>
      {el.kind === 'node' ? <NodeFields el={el} update={update} /> : null}
      {el.kind === 'infra' ? (
        <Field label="Tipo de infraestructura">
          <Select value={el.infra.type} onChange={(v) => v && update({ infra: { type: v } }, 'infra')} options={INFRA_TYPES.map((t) => ({ value: t, label: INFRA_TYPE_LABEL[t] }))} />
        </Field>
      ) : null}
      {el.kind === 'instance' ? <InstanceFields el={el} update={update} /> : null}

      <Field label="Dentro de">
        <Select
          value={el.parent}
          onChange={(v) => update({ parent: v ?? null }, 'parent')}
          options={hosts.map((n) => ({ value: n.id, label: n.name }))}
          placeholder={el.kind === 'node' ? 'Nada (nodo raíz)' : 'Ningún nodo'}
        />
        {path ? <span className="mt-1 block truncate text-[11px] text-fg-subtle" title={path}>{path}</span> : null}
      </Field>

      <Field label="Direcciones" hint="IPs, CIDRs, hosts o URLs">
        <TagInput values={el.addresses ?? []} onChange={(v) => update({ addresses: v.length ? v : null }, 'addresses')} placeholder="10.0.0.12, app.example.com:8443…" renderChip={(v) => <span className="font-mono text-[11px]">{v}</span>} />
      </Field>
      <Field label="ID del recurso" hint="vpc-…, sg-…, i-…, ARN">
        <TextInput value={el.resource ?? ''} onChange={(e) => update({ resource: e.target.value.trim() ? e.target.value : null }, 'resource')} placeholder="Opcional" className="font-mono text-[12px]" />
      </Field>
    </>
  );
}

function NodeFields({ el, update }: { el: Extract<Element, { kind: 'node' }>; update: Update }) {
  const setNode = (patch: Partial<NodeDetails>) => {
    const next: Record<string, unknown> = { ...el.node, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || Number.isNaN(next[k])) delete next[k];
    update({ node: next as NodeDetails }, 'node');
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo de nodo">
          <Select value={el.node.type} onChange={(v) => v && setNode({ type: v })} options={NODE_TYPES.map((t) => ({ value: t, label: NODE_TYPE_LABEL[t] }))} />
        </Field>
        <Field label="Proveedor">
          <Select value={el.node.provider} onChange={(v) => setNode({ provider: v })} options={NODE_PROVIDER_CATALOG.map((p) => ({ value: p.id, label: p.name }))} placeholder="Sin especificar" />
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_88px] gap-3">
        <Field label="Tamaño / tipo de instancia">
          <TextInput value={el.node.size ?? ''} onChange={(e) => setNode({ size: e.target.value || undefined })} placeholder="m5.2xlarge" className="font-mono text-[12px]" />
        </Field>
        <Field label="Cantidad">
          <TextInput type="number" min={1} value={el.node.instances ?? ''} onChange={(e) => setNode({ instances: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined })} placeholder="1" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Región / sitio">
          <TextInput value={el.node.region ?? ''} onChange={(e) => setNode({ region: e.target.value || undefined })} placeholder="us-east-1" />
        </Field>
        <Field label="Cuenta / proyecto">
          <TextInput value={el.node.account ?? ''} onChange={(e) => setNode({ account: e.target.value || undefined })} placeholder="qa-123" />
        </Field>
      </div>
    </>
  );
}

function InstanceFields({ el, update }: { el: Extract<Element, { kind: 'instance' }>; update: Update }) {
  const model = useWorkspace((s) => s.model);
  const target = model.elements[el.instance.of];
  const candidates = sortedValues(model.elements).filter((c) => (INSTANCE_OF_KINDS as readonly string[]).includes(c.kind));
  const label = (c: Element) => {
    const sys = c.parent ? model.elements[c.parent] : undefined;
    return sys ? `${c.name} (${sys.name})` : c.name;
  };
  return (
    <>
      <Field label="Despliega">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <Select value={el.instance.of} onChange={(v) => v && update({ instance: { ...el.instance, of: v } }, 'instance')} options={candidates.map((c) => ({ value: c.id, label: label(c) }))} />
          </div>
          {target ? (
            <button type="button" title={`Ir a ${target.name}`} onClick={() => revealElement(target.id)} className="grid h-8 w-8 place-items-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg">
              <ArrowUpRight size={14} />
            </button>
          ) : null}
        </div>
      </Field>
      <Field label="Réplicas" hint="Pods, procesos o tareas iguales">
        <TextInput
          type="number"
          min={1}
          value={el.instance.replicas ?? ''}
          onChange={(e) => {
            const n = e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined;
            update({ instance: n && n > 1 ? { ...el.instance, replicas: n } : { of: el.instance.of } }, 'instance');
          }}
          placeholder="1"
        />
      </Field>
    </>
  );
}

