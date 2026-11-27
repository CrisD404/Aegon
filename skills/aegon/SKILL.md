---
name: aegon
description: "Diseña, edita y valida arquitectura de software en el modelo C4 como código con Aegon: un workspace de archivos YAML (contexto, contenedores, componentes, despliegue por ambiente y flujos paso a paso) que se abre en la app de Aegon y se exporta a Mermaid, C4-PlantUML o Structurizr. Usala cuando pidan diagramar, modelar o documentar la arquitectura de un sistema o de un repositorio; un diagrama C4, de contexto, de contenedores, de componentes o de despliegue; el flujo de un pedido entre servicios; o revisar, editar o validar una carpeta que tiene aegon.yaml. Use it when the user asks to diagram, model or document software architecture, C4 diagrams (context, container, component, deployment), architecture as code, a request flow across services, or to edit or validate an Aegon workspace (a folder with aegon.yaml). No es para modelos de datos (ERD), diagramas de clases ni gráficos."
license: MIT
metadata:
  version: "0.1.0"
---

# Aegon

Aegon guarda la arquitectura C4 de un sistema como código: una carpeta (el _workspace_) con un YAML por elemento, relación, lienzo y flujo. Vos la escribís y la validás con la CLI incluida; la persona la abre en la app de Aegon, donde la ve como diagramas navegables y la sigue editando.

Lo que entregás es **la carpeta validada**, no una imagen: la CLI no genera HTML, SVG ni PNG. Para una vista rápida en el chat o en un README está la exportación a Mermaid.

## Cómo correr la CLI

```bash
node bin/aegon.mjs <comando> -w <carpeta>
```

- Reemplazá `bin/aegon.mjs` por su ruta absoluta dentro de la carpeta de esta skill. Solo necesita Node (probada con Node 24; el archivo está armado para Node 20 o superior): no hay nada que instalar.
- Pasá siempre `-w <carpeta>` (menos en `init`, que recibe la carpeta como argumento). Sin `-w`, la CLI busca un `aegon.yaml` desde la carpeta actual hacia arriba y podés terminar editando otro workspace.
- Códigos de salida: `0` bien, `1` validación con errores u operación rechazada, `2` comando mal escrito. Cada error trae un código entre corchetes (`[not-found]`, `[invalid-parent]`).
- Si en la sesión están las herramientas `mcp__aegon__*` (el servidor MCP de Aegon), usalas para editar: cubren lo que la CLI no tiene. La compuerta es la misma.

## Elegí el modo

| Pedido | Qué hacés |
|---|---|
| Describen un sistema ("diagramame…", "modelá…") | Workspace nuevo a partir de la descripción |
| "Documentá la arquitectura de este repo" | Workspace nuevo leyendo el código; antes leé [Desde un repositorio](references/modeling.md#desde-un-repositorio) |
| La carpeta ya tiene `aegon.yaml` | Edición: no corras `init`; primero leé lo que hay |

Salvo que te indiquen otra carpeta, un workspace nuevo va en `./arquitectura` (o en `docs/arquitectura` si el repo ya tiene `docs/`). Los nombres del modelo van en el idioma de la persona.

## Elegí el nivel

- **Contexto (L1)**, siempre: personas, el sistema y los sistemas externos con los que habla.
- **Contenedores (L2)** del sistema en foco: aplicaciones, APIs, workers, bases de datos y buses.
- **Componentes (L3)**, solo si lo piden o si un contenedor concentra la pregunta.
- **Despliegue**, solo si lo piden o hay evidencia (IaC, manifiestos): nodos, infraestructura e instancias de un ambiente.
- **Flujo**, cuando preguntan "qué pasa cuando…": pasos numerados sobre elementos ya modelados.

Modelá lo que piden y lo que la evidencia sostiene: no hay cantidad mínima ni máxima de elementos.

## Autoría

1. **Workspace.** `node bin/aegon.mjs init <carpeta> --name "<Nombre>"` crea el manifiesto, un `AGENTS.md` con el formato y el lienzo `contexto` (L1). En edición, en cambio, `export json -w <carpeta>` muestra los IDs, relaciones y lienzos que ya existen.
2. **Contexto.** Cada elemento se crea ya ubicado en su lienzo:

   ```bash
   node bin/aegon.mjs add actor "Cliente" --role "Compra productos" --external --view contexto -w <carpeta>
   node bin/aegon.mjs add system "Tienda Online" -d "Venta por internet" --view contexto -w <carpeta>
   node bin/aegon.mjs add system "Pasarela de pagos" --external --view contexto -w <carpeta>
   ```

3. **Lienzos de detalle.** La CLI no crea lienzos: escribí `views/<id>.yaml` (L2, L3 o despliegue) con la forma de [Lienzos](references/modeling.md#lienzos), y poné en `nodes` los actores y sistemas externos que ya existen y van a aparecer ahí. Después, `add container|store|bus "<Nombre>" --view <lienzo-L2>` deja cada elemento ubicado y con el sistema como padre.
4. **Relaciones.** Conectá los elementos más específicos (contenedor con contenedor), con etiqueta y protocolo; las flechas entre sistemas que se ven en el contexto las deriva Aegon.

   ```bash
   node bin/aegon.mjs connect web "API de pedidos" -l "Crea pedidos" -p rest,https -w <carpeta>
   ```

5. **Despliegue y flujos**, si corresponden: [Despliegue](references/modeling.md#despliegue) y [Flujos](references/modeling.md#flujos). Los ambientes y los flujos se escriben en YAML.
6. **Orden automático** y **compuerta**: las dos secciones que siguen.

Lo que más errores evita:

- Cada `add` responde con el ID que quedó (`✓ Contenedor "Web" agregado (web)`); después podés nombrar el elemento por ID o por nombre. Un nombre repetido **no falla**: crea `web-2`. Si te equivocaste, no repitas el `add`: corregí el YAML.
- Hay una sola relación por par. `connect b a` cuando ya existe `a → b` la vuelve bidireccional (y lo que indiques queda como la vuelta); repetir `connect a b` con más opciones completa la que hay.
- Sin `--view`, el elemento existe pero no se ve en ningún lienzo. Para ubicar uno que ya existe, agregá `<id>: { x: 0, y: 0 }` en `nodes` del lienzo y corré `layout`.
- La CLI no modifica ni borra. Editá o borrá el YAML de la entidad (el nombre del archivo es el ID, y el ID no se cambia); al borrar un elemento, borrá también sus relaciones y sus entradas en `nodes`.
- Copiá los nombres de campo de la referencia: un campo mal escrito no da error y se pierde en la siguiente escritura.
- `-t`, `--engine`, `--broker` y `-p` aceptan nombres comunes ("Node.js", "postgres") y los llevan al catálogo; lo que no reconocen se guarda igual, con un aviso.

## Orden automático

```bash
node bin/aegon.mjs layout <lienzo> -w <carpeta>
```

Correlo en cada lienzo que creaste, cuando ya están todas las relaciones (es el mismo orden que `Shift+L` en la app). En un workspace que ya existía no reordenes lienzos enteros: la persona puede haberlos acomodado a mano. Ahí usá `--ids a,b,c` para ordenar solo lo que agregaste, o dejá el lugar libre que eligió `add`.

## Compuerta: antes de decir que terminaste

```bash
node bin/aegon.mjs validate --strict --info -w <carpeta>
node bin/aegon.mjs lint -w <carpeta>
```

Terminaste cuando los dos salen con código `0` y `validate` no lista ningún `[not-in-view]` que no hayas decidido a propósito. **Un código distinto de cero nunca es éxito**: no entregues, no exportes y no lo resumas como listo.

Para reparar:

1. Cada diagnóstico nombra el archivo y un código (`✗ error views/contexto.yaml … [missing-node]`). Buscá el código en [Reparación](references/repair.md).
2. Corregí ese YAML, o repetí bien el comando, y volvé a correr **los dos** comandos.
3. No borres elementos ni relaciones reales para callar un diagnóstico, ni inventes relaciones para que algo deje de figurar como huérfano.
4. Si después de tres rondas sigue fallando, pará y mostrá los diagnósticos que quedan, tal cual salen.

`lint` además describe el modelo sin fallar: huérfanos, ciclos, relaciones sin protocolo, tráfico sin cifrar, contenedores sin desplegar, hotspots de riesgo. Corregí lo que sea un descuido tuyo (un protocolo que falta: `connect a b -p <protocolo>`) y contá en la respuesta lo que sea un hecho de la arquitectura.

En un workspace que ya existía, corré la compuerta **antes** de editar: lo que ya fallaba no es tuyo, pero tu trabajo no puede sumar diagnósticos.

## Entrega

- El entregable es la carpeta del workspace. Decí su ruta absoluta.
- Para verla como diagramas: <https://crisd404.github.io/Aegon/> en Chrome o Edge → **Abrir carpeta** → elegir esa carpeta. O la app de escritorio (<https://github.com/CrisD404/Aegon/releases/latest>), que además muestra en vivo cada cambio que escribas.
- Vista rápida en el chat, opcional: `export mermaid --view <lienzo> -w <carpeta>` y pegá la salida en un bloque `mermaid`. Es un resumen sin las posiciones del lienzo, no una captura de Aegon.
- Para documentación: `export mermaid -o <archivo.md>` (todos los lienzos), `export plantuml-c4`, `export structurizr`, `export json`, y `export flow <id> mermaid|text` para un flujo.
- PNG y PDF se exportan desde la app, no desde la CLI. No prometas una imagen ni una página HTML.
- No hagas commit ni push salvo que te lo pidan.

## Respuesta

Respondé en el idioma de la persona y en pocas líneas: el workspace lleva el contenido.

1. Primero, la ruta del workspace (y la del archivo exportado, si lo hay) y cómo abrirlo.
2. Qué niveles modelaste: contexto, contenedores de qué sistema, componentes, despliegue de qué ambiente, flujos.
3. Qué omitiste o supusiste: lo que no encontraste en el código, protocolos inferidos, nombres que pusiste vos, partes que quedaron fuera de alcance.
4. Lo que `lint` dejó marcado y no corregiste, en una línea.

No pegues los YAML ni narres los comandos. No digas "validado" si no corriste la compuerta en esta sesión.

## Referencias

Leelas solo cuando el paso las pide:

- [Modelado](references/modeling.md): tipos de elemento, jerarquía, relaciones, lienzos, despliegue, flujos, catálogos y cómo leer un repositorio.
- [CLI](references/cli.md): todos los comandos y opciones, salida `--json` y lo que hay que hacer en YAML.
- [Reparación](references/repair.md): cada código de diagnóstico y cómo se arregla.
- [Ejemplo](examples/tienda-online.mjs): el ciclo completo (contexto, contenedores, despliegue, flujo, compuerta) sobre un sistema ficticio. `node examples/tienda-online.mjs <carpeta-nueva>` lo genera.
- `node bin/aegon.mjs init <carpeta-nueva> --demo` crea un workspace de ejemplo más grande (banca digital ficticia, con L1 a L3, el despliegue de producción, un flujo y comentarios) para mirar YAML real.
