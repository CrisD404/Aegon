# Reparación

Cómo leer lo que devuelve la CLI y qué corregir. La regla: arreglá la causa en el YAML (o repetí bien el comando) y volvé a correr la compuerta completa.

```bash
node bin/aegon.mjs validate --strict --info -w <carpeta>
node bin/aegon.mjs lint -w <carpeta>
```

## Cómo se lee un diagnóstico

```text
✗ error views/contexto.yaml  El lienzo "Contexto" ubica "cache", que no existe [missing-node]
! aviso model/elements/suelto.yaml  El container "Suelto" no pertenece a ningún system [orphan-child]
· info  model/elements/notificador.yaml  "Notificador" no aparece en ningún lienzo [not-in-view]
```

Severidad, archivo (relativo al workspace), mensaje y código. Los **errores** siempre hacen fallar; los **avisos** hacen fallar a `validate --strict`; los **info** nunca, pero `[not-in-view]` hay que resolverlo igual. Cuando no hay archivo, aparece `element:<id>` o `relation:<id>`: el archivo es `model/elements/<id>.yaml` o `model/relations/<id>.yaml`.

Un archivo con YAML inválido o que no cumple el esquema **se omite entero**. Por eso un solo error de sintaxis suele traer otros en cadena (`missing-endpoint`, `missing-node`…): arreglá primero los `yaml-syntax` y `schema` y volvé a validar antes de tocar el resto.

## Errores de archivo

| Código | Qué pasó | Arreglo |
|---|---|---|
| `yaml-syntax` | El YAML no se puede leer | Revisá sangría, comillas y corchetes. Un texto con `:` o `#` va entre comillas |
| `schema` | Un campo tiene un valor que el formato no admite; el mensaje dice cuál y qué valores acepta | Usá uno de los valores listados. Si falta un campo obligatorio (`name`, `kind`, `nodes`, `store.engine`, `bus.broker`, `group.provider`, `node.type`, `infra.type`, `instance.of`), agregalo |
| `schema-version` | `aegon.yaml` no dice `schema: 2` | Corregilo; no es un workspace de otra versión que puedas migrar a mano |
| `duplicate-id` | Dos archivos declaran el mismo `id` | Dejá uno solo. Si son dos cosas distintas, el segundo necesita otro ID y otro nombre de archivo |
| `id-filename` (aviso) | El `id` de adentro no coincide con el nombre del archivo | Renombrá el archivo para que sea `<id>.yaml` |

## Referencias rotas

| Código | Qué pasó | Arreglo |
|---|---|---|
| `missing-parent` | `parent` apunta a un elemento que no existe | Corregí el ID o creá el padre |
| `missing-group` · `invalid-group` | `groups` nombra algo que no existe o que no es un `group` | Corregí el ID |
| `missing-endpoint` | El `from` o el `to` de una relación no existe | Corregí el ID. Si borraste el elemento a propósito, borrá también el archivo de la relación |
| `missing-node` | `nodes` de un lienzo nombra un elemento que no existe | Quitá esa entrada de `nodes` o corregí el ID |
| `missing-scope` | Un lienzo L2 o L3 no tiene `scope`, o apunta a algo que no existe | `scope` es el ID del sistema (L2) o del contenedor (L3) |
| `missing-instance-target` | `instance.of` apunta a algo que no existe | Corregí el ID |
| `missing-default-view` (aviso) | `defaultView` del manifiesto no existe | Apuntalo a un lienzo que exista (`contexto`) |
| `flow-missing-view` · `flow-missing-element` (avisos) | Un flujo nombra un lienzo, elemento, relación o flujo que no existe; el mensaje da el número de paso | Corregí el ID en `flows/<id>.yaml` |
| `comment-missing-view` (aviso) | Un comentario quedó en un lienzo que ya no existe | No borres comentarios ajenos: avisale a la persona |

## Reglas C4

| Código | Qué pasó | Arreglo |
|---|---|---|
| `invalid-parent` | El padre es de un tipo que no corresponde | `container` → `system`; `component` → `container`; `store` → `system` o `container`; `bus` → `system`; `group` → `group`; `node`, `infra`, `instance` → `node` |
| `parent-cycle` | Dos elementos son padre uno del otro | Corregí `parent` |
| `orphan-child` (aviso) | Un `container` o `component` sin `parent` | Agregá `parent` en su YAML. Suele pasar al hacer `add container` sin `--parent` y sin `--view` de un L2 |
| `group-relation` | Una relación toca un `group` | Los grupos no se conectan: conectá los elementos de adentro y borrá esa relación |
| `duplicate-relation` (aviso) | Dos archivos de relación unen el mismo par | Dejá una sola; si va en los dos sentidos, `direction: bidirectional` |
| `self-relation` (aviso) | `from` y `to` son el mismo elemento | Borrá la relación; si es un paso interno, va como `process` en un flujo |
| `invalid-scope` | El lienzo abre un elemento del tipo equivocado | L2 abre un `system`, L3 un `container`; en despliegue, `scope` es un `system` |
| `invalid-placement` (aviso) | Un elemento está ubicado donde no puede; el mensaje dice por qué | Quitalo de `nodes` de ese lienzo. Casos típicos: un contenedor directo en un lienzo de despliegue (va como `instance`), un `node` en un lienzo C4, el elemento de `scope` ubicado dentro de su propio lienzo |
| `level-mix` (aviso) | Solo con `strictC4: true` en `aegon.yaml`: un elemento no es del nivel de su lienzo (un componente en un lienzo de contexto) | Es una preferencia de quien armó el workspace: mové el elemento al lienzo de su nivel, o dejalo y contalo en la respuesta |
| `invalid-instance-target` | Una instancia despliega algo que no es `container`, `store`, `bus` ni `system` | Corregí `instance.of` |

## Ambientes y despliegue

| Código | Qué pasó | Arreglo |
|---|---|---|
| `missing-environment` | Un lienzo `level: deployment` sin `environment` | Agregá `environment: <id>` |
| `unknown-environment` (aviso) | Se usa un ambiente que no está en `aegon.yaml` | Agregalo a `environments` del manifiesto o corregí el ID |
| `duplicate-environment` | El mismo ID dos veces en `environments` | Dejá uno |
| `environment-on-c4-view` (aviso) | Un lienzo L1, L2 o L3 tiene `environment` | Quitá el campo |
| `orphan-instance` (aviso) | Una instancia sin `parent` | Ponela dentro de un `node` |
| `environment-mismatch` (aviso) | Un elemento vale en un ambiente donde su nodo no existe | Alineá `environments` del elemento con los del nodo |
| `cross-environment-relation` (aviso) | Los extremos de una relación no comparten ningún ambiente | Conectá instancias del mismo ambiente |
| `actor-cost` (aviso) | Un actor con costos | Quitá `finops.costs` del actor |

## Lo que solo aparece con `--info` o en `lint`

No hacen fallar la compuerta, pero se resuelven o se informan.

| Código | Qué significa | Qué hacer |
|---|---|---|
| `not-in-view` | El elemento existe pero ningún lienzo lo muestra | Agregá `<id>: { x: 0, y: 0 }` en `nodes` del lienzo que corresponde y corré `layout`. Si quedó de un `add` equivocado, borrá su archivo |
| Huérfanos | Elementos sin ninguna relación, ni propia ni de sus hijos | Si se comunica con algo, falta un `connect`. Si de verdad está aislado, decilo; no inventes una relación |
| Ciclos | `A → B → C → A` | Revisá el sentido de cada relación (`from` es quien inicia). Si el ciclo es real, informalo |
| Relaciones sin protocolo | Falta `protocols` | `connect <desde> <hasta> -p <protocolo>` con uno de los sugeridos, si sabés cuál es. Si no lo sabés, dejalo así y decilo |
| `ancestor-relation` | Un elemento conectado con su padre o con un hijo | Conectá con el elemento específico de adentro, o borrá la relación |
| `actor-to-store` | Una persona conectada directo a una base de datos | Pasá por el contenedor que usa esa base |
| `plaintext` | Tráfico sin cifrar: protocolo `http` o puerto 80 | Si en la realidad es HTTPS, corregilo; si no, es un hallazgo: informalo |
| `not-deployed` | Hay un lienzo de despliegue para un ambiente y un contenedor, base o bus del sistema no tiene instancia ahí | `add instance --of <id> --parent <nodo> --view <lienzo> --env <ambiente>`, o informá que el despliegue es parcial |
| Hotspots de riesgo | Elementos con `risk` alto y varios dependientes | Es información para la persona, no un error |

## Cuando lo que falla es un comando

Los comandos que escriben (`add`, `connect`, `layout`) validan antes de tocar el disco: si salen con `1`, no cambiaron nada.

| Código | Causa | Arreglo |
|---|---|---|
| `not-a-workspace` | La carpeta no tiene `aegon.yaml` | Revisá `-w`. Si el workspace es nuevo, `init <carpeta>` |
| `exists` | `init` sobre una carpeta que ya es un workspace | No vuelvas a inicializar: editá el que está |
| `not-found` | No existe ese elemento, lienzo o flujo; el mensaje sugiere IDs parecidos | Usá el ID exacto. Si es un lienzo de detalle, primero hay que escribir su YAML |
| `ambiguous` | Varios elementos se llaman igual | Usá el ID |
| `invalid-kind` | Tipo de elemento desconocido | Uno de los diez `kind` |
| `invalid-parent` | `--parent` es de un tipo que no corresponde | Mirá la tabla de padres de arriba |
| `invalid-placement` | El elemento no se puede ubicar en ese lienzo | Elegí el lienzo que corresponde o sacá `--view` |
| `invalid-field` | Un valor fuera de la lista (`--container-type`, `--provider`, `--node-type`, `--infra-type`, `--ports`) o una instancia sin `--of` | El mensaje lista los valores válidos |
| `invalid-endpoint` · `self-relation` | `connect` con un grupo, o de un elemento consigo mismo | Conectá elementos distintos que no sean grupos |
| `duplicate-id` | `--id` repite uno existente | Elegí otro o no pases `--id` |
| `not-a-repo` · `bad-ref` | `diff` fuera de un repo git o con una referencia que no existe | `diff` es opcional: seguí sin él |
| Código de salida `2` | Opción desconocida, argumentos de más o de menos | `node bin/aegon.mjs <comando> --help` |

## Deshacer un error tuyo

- **Elemento duplicado** (`web-2` por repetir un `add`): borrá `model/elements/web-2.yaml` y su entrada en `nodes` del lienzo donde quedó.
- **Relación al revés** que quedó bidireccional: en `model/relations/<id>.yaml`, quitá `direction: bidirectional` y dejá `from` y `to` en el sentido correcto.
- **Elemento en el lienzo equivocado**: quitá su entrada de `nodes` en ese lienzo y agregala en el correcto.
- **Borraste un elemento** y quedaron referencias: `validate` lista cada una (`missing-endpoint`, `missing-node`, `flow-missing-element`); corregilas una por una.

Si después de tres rondas la compuerta sigue fallando, pará: mostrale a la persona los diagnósticos que quedan, tal cual salen, y qué intentaste.
