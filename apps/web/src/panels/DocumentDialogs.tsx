import { useMemo, useState, type FormEvent } from 'react';
import { FileText, Plus, Server } from 'lucide-react';
import {
  SUGGESTED_ENVIRONMENTS,
  deploymentViewName,
  environmentsOf,
  slugify,
  sortedValues,
  type Environment,
  type Id,
  type Model,
  type WorkspaceMeta,
} from '@aegon/core';
import { Modal } from '../ui/Modal.tsx';
import { Button, Field, Select, TextArea, TextInput, cn } from '../ui/primitives.tsx';

/** Datos del documento: lo que identifica al diagrama cuando se comparte o se exporta. */
export type DocumentDraft = Pick<WorkspaceMeta, 'name' | 'description' | 'organization' | 'architect' | 'code' | 'version' | 'date'>;

export function DocumentDialog({ model, close }: { model: Model; close: (draft: DocumentDraft | null) => void }) {
  const ws = model.workspace;
  const [draft, setDraft] = useState<DocumentDraft>({
    name: ws.name,
    description: ws.description,
    organization: ws.organization,
    architect: ws.architect,
    code: ws.code,
    version: ws.version,
    date: ws.date,
  });
  const set = (key: keyof DocumentDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.name?.trim()) return;
    close(draft);
  };
  return (
    <Modal
      open
      onClose={() => close(null)}
      title="Datos del documento"
      description="Identifican al diagrama: aparecen en el cartel de las exportaciones (PNG, SVG, PDF) y en el YAML del workspace."
      icon={<FileText size={17} />}
      size="md"
      testId="document-dialog"
      footer={
        <>
          <span className="flex-1" />
          <Button size="sm" onClick={() => close(null)}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" onClick={() => submit()} data-testid="document-save">
            Guardar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <div className="grid grid-cols-[1fr_150px] gap-3">
          <Field label="Nombre">
            <TextInput value={draft.name ?? ''} onChange={(e) => set('name')(e.target.value)} autoFocus data-testid="document-name" />
          </Field>
          <Field label="Código" hint="MASTER, ticket">
            <TextInput value={draft.code ?? ''} onChange={(e) => set('code')(e.target.value)} placeholder="ARQ-1024" data-testid="document-code" />
          </Field>
        </div>
        <Field label="Descripción">
          <TextArea rows={2} value={draft.description ?? ''} onChange={(e) => set('description')(e.target.value)} placeholder="Qué cubre este workspace" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Versión">
            <TextInput value={draft.version ?? ''} onChange={(e) => set('version')(e.target.value)} placeholder="v1.0" data-testid="document-version" />
          </Field>
          <Field label="Fecha de la versión">
            <TextInput type="date" value={draft.date ?? ''} onChange={(e) => set('date')(e.target.value)} data-testid="document-date" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Autor">
            <TextInput value={draft.architect ?? ''} onChange={(e) => set('architect')(e.target.value)} placeholder="Arquitecto responsable" data-testid="document-author" />
          </Field>
          <Field label="Unidad / organización">
            <TextInput value={draft.organization ?? ''} onChange={(e) => set('organization')(e.target.value)} placeholder="Dirección de sistemas" data-testid="document-unit" />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export interface NewDeploymentDraft {
  name: string;
  environment: Id;
  /** Ambiente nuevo que hay que agregar al workspace (si se creó en el diálogo). */
  newEnvironment?: Environment;
  scope?: Id;
}

/** Nuevo lienzo de despliegue: elegir (o crear) el ambiente y, opcionalmente, el sistema. */
export function NewDeploymentDialog({ model, scope: initialScope, close }: { model: Model; scope?: Id; close: (draft: NewDeploymentDraft | null) => void }) {
  const environments = environmentsOf(model);
  const systems = useMemo(() => sortedValues(model.elements).filter((e) => e.kind === 'system' && e.scope !== 'external'), [model.elements]);
  const [environment, setEnvironment] = useState<Id | undefined>(environments[0]?.id);
  const [scope, setScope] = useState<Id | undefined>(initialScope ?? (systems.length === 1 ? systems[0]!.id : undefined));
  const [newEnv, setNewEnv] = useState('');
  const [created, setCreated] = useState<Environment | null>(null);
  const [name, setName] = useState<string | null>(null);

  const envList = created ? [...environments, created] : environments;
  const withEnv = (id: Id | undefined): Model => (id && created?.id === id ? { ...model, workspace: { ...model.workspace, environments: [...envList] } } : model);
  const suggested = environment ? deploymentViewName(withEnv(environment), environment, scope) : '';
  const finalName = name ?? suggested;

  const addEnv = (label: string) => {
    const value = label.trim();
    if (!value) return;
    const taken = new Set(envList.map((e) => e.id));
    let id = slugify(value, 'ambiente');
    for (let i = 2; taken.has(id); i++) id = `${slugify(value, 'ambiente')}-${i}`;
    const env = { id, name: value };
    setCreated(env);
    setEnvironment(id);
    setNewEnv('');
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!environment || !finalName.trim()) return;
    close({ name: finalName.trim(), environment, scope, ...(created && created.id === environment ? { newEnvironment: created } : {}) });
  };

  return (
    <Modal
      open
      onClose={() => close(null)}
      title="Nuevo lienzo de despliegue"
      description="Muestra dónde corre cada contenedor en un ambiente: nodos (datacenter, VPC, clúster), infraestructura (firewall, DNS, balanceadores) e instancias."
      icon={<Server size={17} />}
      size="md"
      testId="deployment-dialog"
      footer={
        <>
          <span className="flex-1" />
          <Button size="sm" onClick={() => close(null)}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" disabled={!environment || !finalName.trim()} onClick={() => submit()} data-testid="deployment-create">
            Crear lienzo
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Ambiente">
          <div className="flex flex-wrap gap-1.5">
            {envList.map((env) => (
              <button
                key={env.id}
                type="button"
                onClick={() => setEnvironment(env.id)}
                className={cn('h-8 rounded-sm border px-3 text-[12.5px] transition-colors', environment === env.id ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted hover:bg-hover')}
                data-testid={`deployment-env-${env.id}`}
              >
                {env.name}
              </button>
            ))}
          </div>
          {!envList.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {SUGGESTED_ENVIRONMENTS.map((s) => (
                <Button key={s.id} size="sm" variant="ghost" onClick={() => addEnv(s.name)}>
                  <Plus size={12} /> {s.name}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex gap-1.5">
            <TextInput value={newEnv} onChange={(e) => setNewEnv(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEnv(newEnv))} placeholder="Otro ambiente (QA, Pre, Producción…)" className="h-8 flex-1 text-[12.5px]" data-testid="deployment-new-env" />
            <Button size="sm" onClick={() => addEnv(newEnv)} disabled={!newEnv.trim()}>
              Agregar
            </Button>
          </div>
        </Field>
        <Field label="Sistema" hint="Opcional: el que se despliega">
          <Select value={scope} onChange={setScope} options={systems.map((s) => ({ value: s.id, label: s.name }))} placeholder="Todos los sistemas" />
        </Field>
        <Field label="Nombre">
          <TextInput value={finalName} onChange={(e) => setName(e.target.value)} placeholder="Despliegue QA" data-testid="deployment-name" />
        </Field>
      </form>
    </Modal>
  );
}
