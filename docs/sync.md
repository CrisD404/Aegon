# Sincronización con git

Aegon guarda cada workspace como archivos YAML (ver [`format.md`](format.md)), así que un repo git
es su forma natural de compartirse. La sincronización vive en `@aegon/git` y tiene dos
proveedores con la misma interfaz (`GitSync`):

| Proveedor | Dónde | Cómo habla con el remoto |
|---|---|---|
| `CliGitSync` | App de escritorio (Rust ejecuta `git`) y Node (CLI, tests) | El `git` del sistema, con las credenciales y la configuración del usuario |
| `GitHubSync` | Navegador | Git Data API de GitHub con un token fine-grained del usuario |

## Estados que maneja la app

- **Borrador** (`model`): lo que estás editando. Se guarda solo en IndexedDB y sobrevive recargas.
- **Guardado** (`base`/`files`): lo que hay en la carpeta o en la copia local del navegador.
- **Sincronizado** (`synced`/`syncBase`): el commit del remoto sobre el que trabajás y su modelo.
  Es la base de los merges. La pestaña Cambios muestra la diferencia entre este modelo y el
  borrador: lo que falta publicar.

## Commit & push

1. `prepare`: trae el remoto (`git fetch` o la ref de GitHub). Si no avanzó, se publica directo.
2. Si avanzó, **merge semántico de tres vías** (`mergeModels` de `@aegon/core`):
   base = ancestro común, nuestro = borrador, de ellos = remoto.
   - Se compara entidad por entidad (elementos, relaciones, lienzos) y, dentro de cada una,
     campo por campo; los lienzos se mezclan nodo por nodo.
   - Conflicto solo si ambos lados cambiaron el mismo campo distinto, o uno borró y el otro
     modificó. La app los muestra (tuyo / remoto) y aplica lo elegido con `applyResolutions`.
   - `repairModel` limpia lo que quedó colgando (relaciones a elementos borrados, nodos de
     lienzos, relaciones repetidas para el mismo par).
3. `publish`:
   - **CLI**: escribe los YAML, `git commit` de los archivos de Aegon y, si el remoto avanzó,
     `git merge --no-ff -X ours` para el resto del repo (README, código) seguido de la
     reescritura de los archivos del modelo con el resultado semántico. Luego `git push`.
   - **GitHub**: arma un árbol nuevo sobre el del commit remoto (solo cambian los archivos de
     Aegon), crea el commit y mueve la rama con fast-forward. Si alguien publicó en el medio
     (`422`), se reintenta desde el paso 1.

## Actualizar (pull)

Mismo merge de tres vías, pero el resultado queda como **borrador** sobre la nueva base remota:
nada se publica hasta que hagas Commit & push. En la CLI, los cambios del modelo guardados sin
commitear se apartan (`git stash`) antes del fast-forward porque ya viven en el borrador.

## Cambios externos (escritorio)

La app observa la carpeta (`notify` en Rust). Si un editor, un agente de IA o un `git checkout`
cambian los YAML, la versión del disco pasa a ser la nueva base y el borrador se combina con ella
usando el mismo merge semántico. Mientras la app guarda o sincroniza, esos eventos se ignoran
porque son escrituras propias.

## Archivos que administra Aegon

`aegon.yaml`, `model/`, `views/`, `attachments/`, `AGENTS.md`, `.gitignore` y `.gitattributes`
(este último fuerza saltos de línea LF para que Windows no genere diffs falsos). Todo lo demás del
repo lo maneja git normalmente y Aegon nunca lo borra.

## Seguridad

- El token de GitHub se guarda solo en el navegador (IndexedDB) y se usa únicamente contra la API
  de GitHub. Conviene un token fine-grained limitado al repo con permiso *Contents: read and write*.
- En escritorio, los comandos de Rust validan que toda ruta quede dentro de la carpeta del
  workspace (nada de rutas absolutas ni `..`) y `git` corre con `GIT_TERMINAL_PROMPT=0` para no
  quedar esperando credenciales.
