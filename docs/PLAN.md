# PLAN DE IMPLEMENTACIÓN — HandSync v1 (Extensión de Chrome, Manifest V3)

> Fundamentos de Investigación para la Innovación · Docente: Luis Miguel Gonzalez Giraldo
> Grupo 2: Fabian Andres Valdez · Kevin Mauricio Roman · Diana Alejandra Botero
> Al aprobarse: se guarda en `handsync-extension/docs/PLAN.md` y se implementa por fases.

---

## 1. Resumen ejecutivo

HandSync es una extensión de Chrome (MV3, JavaScript vanilla, sin build) que acompaña videollamadas web desde un **panel lateral**. Traduce en dos sentidos: **señas → texto → voz** (cámara + modelo local de Teachable Machine; el texto se puede copiar al chat de la reunión) y **voz → texto → señas** (micrófono + Web Speech API; muestra la imagen de la seña de cada letra). Todo el código, las librerías y el modelo se empaquetan localmente; no se carga código remoto.

---

## 2. Alcance

| v1 (este prototipo) | v2 (fuera de alcance) |
|---|---|
| 5–8 letras **estáticas** + clase "Nada" | Frases y señas dinámicas (movimiento) |
| Modelo Teachable Machine (imagen) local | MediaPipe Hands / landmarks |
| Voz del **usuario local** → señas (micrófono propio) | Capturar el audio del **otro participante** (`tabCapture`) |
| Texto → voz por los **parlantes locales** | Inyectar la voz sintetizada **dentro** de la llamada |
| Copiar texto → pegar a mano en el chat de Meet | Escribir automáticamente en el chat (content script) |
| Imágenes de señas tomadas por el equipo | Diccionario completo del abecedario LSC |

**Limitaciones dentro de la videollamada (decirlas en el video):**
- La voz sintetizada suena en el computador del usuario, **no** la escucha el otro participante (salvo que el micrófono la capte).
- Voz → señas solo transcribe lo que capta **nuestro** micrófono; el audio remoto de Meet no se captura en v1.
- El texto llega a la reunión copiándolo y pegándolo en el chat (Ctrl+V).
- `webkitSpeechRecognition` requiere internet (usa el servicio de Google); el reconocimiento de señas funciona sin internet.

---

## 3. Arquitectura

| Componente | Rol |
|---|---|
| `background.js` (service worker) | Hace que el ícono abra el panel; abre `permisos.html` al instalar. Sin lógica de negocio. |
| Panel lateral (`sidepanel/`) | UI + orquestación. Usa `senas.js` y `voz.js`. |
| Página de permisos (`permisos/`) | Pestaña normal de la extensión: **aquí sí** aparece la solicitud de cámara/micrófono. El permiso queda concedido para el origen `chrome-extension://<id>` y el panel lo hereda. |
| Recursos locales | `lib/` (TF.js + TM), `model/`, `img/senas/`, `icons/` — todos leídos con `chrome.runtime.getURL()`. |

```
 [Instalar] ──onInstalled──► background.js ──tabs.create──► permisos/permisos.html
                                  │                         getUserMedia({video,audio})
 [Clic ícono] ──setPanelBehavior──┘                         → permiso concedido al origen
                                  ▼                           de la extensión
                     ┌──────────── PANEL LATERAL (sidepanel.html) ────────────┐
                     │ navigator.permissions.query → ¿falta? → botón "Dar     │
                     │ permisos" (abre permisos.html)                         │
                     │                                                        │
 Cámara ──► senas.js: tmImage.Webcam → model.predict() → filtro (0.85,        │
                     │  1000 ms, "Nada") → onLetra(L) → texto armado          │
                     │        └─► voz.js.hablar(texto) ──► parlantes          │
                     │        └─► navigator.clipboard ──► Ctrl+V en chat Meet │
                     │                                                        │
 Micrófono ─► voz.js: webkitSpeechRecognition(es-CO|es-ES) → transcripción    │
                     │  → normalizar() → tarjetas img/senas/<L>.png | respaldo│
                     └────────────────────────────────────────────────────────┘
```

Carga de scripts en `sidepanel.html` (scripts clásicos, sin módulos ni build), en este orden:
`lib/tf.min.js` → `lib/teachablemachine-image.min.js` → `js/config.js` → `js/voz.js` → `js/senas.js` → `sidepanel/sidepanel.js`. Cada módulo expone un único objeto global (`HS_CONFIG`, `HSVoz`, `HSSenas`) para evitar colisiones.

**Estructura:** se valida la propuesta tal cual. Único ajuste: `img/senas/` contendrá solo las imágenes reales; la tarjeta "sin seña aún" se genera con CSS (no requiere archivo, nunca se rompe).

---

## 4. `manifest.json` propuesto

```json
{
  "manifest_version": 3,
  "name": "HandSync",
  "version": "1.0.0",
  "description": "Traduce lengua de señas a texto y voz, y voz a señas, en tus videollamadas.",
  "permissions": ["sidePanel", "storage"],
  "background": { "service_worker": "background.js" },
  "side_panel": { "default_path": "sidepanel/sidepanel.html" },
  "action": {
    "default_title": "Abrir HandSync",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

| Permiso | Justificación |
|---|---|
| `sidePanel` | Obligatorio para `side_panel` y `chrome.sidePanel.setPanelBehavior`. |
| `storage` | Guardar el texto armado y la última transcripción para que no se pierdan al cerrar/reabrir el panel (`chrome.storage.local`). |
| *(no se pide)* `tabs` | `chrome.tabs.create` funciona sin él. |
| *(no se pide)* `host_permissions` | No leemos ni modificamos páginas (Meet, Zoom, WhatsApp). |
| *(no se pide)* `clipboardWrite` | `navigator.clipboard.writeText` funciona con el clic del usuario. **Solo** se añade si la prueba del caso 6 falla. |
| CSP | Se usa la predeterminada de MV3 (`script-src 'self' 'wasm-unsafe-eval'`). No se puede añadir `unsafe-eval` en MV3 (ver Riesgos). |

---

## 5. Responsabilidad de cada archivo

| Archivo | Responsabilidad | Funciones principales (entrada → salida) |
|---|---|---|
| `background.js` | Comportamiento del ícono y bienvenida. | `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`; `onInstalled(reason==='install') → tabs.create(permisos.html)` |
| `js/config.js` | Única fuente de valores ajustables y dependientes del modelo. | `HS_CONFIG = { UMBRAL_CONFIANZA: 0.85, TIEMPO_ESTABLE_MS: 1000, CLASE_VACIA: 'Nada', LETRAS_CON_IMAGEN: [...], IDIOMAS_VOZ: ['es-CO','es-ES'], RUTA_MODELO: 'model/', RUTA_SENAS: 'img/senas/' }` |
| `js/senas.js` | Cámara + modelo + estabilidad. Sin DOM salvo el `<canvas>` que recibe. | `cargarModelo() → Promise<clases[]>` (error claro si falta archivo) · `iniciar(contenedor, callbacks) → Promise` · `detener() → void` · `evaluar(prediccion, ahora) → {letra, prob, progreso, agregar}` (función **pura**: reglas 0.85 / 1000 ms / "Nada" / agregar una sola vez hasta que cambie la letra) |
| `js/voz.js` | Síntesis y reconocimiento. | `hablar(texto) → void` (elige voz `es-CO`, si no `es-*`) · `soportaReconocimiento() → bool` · `escuchar({onParcial, onFinal, onError, onFin}) → void` (intenta `es-CO`; ante `language-not-supported` reintenta `es-ES`) · `detenerEscucha()` · `normalizar(texto) → 'HOLA MAMA'` (mayúsculas, sin tildes, **conserva Ñ**, quita signos) |
| `sidepanel/sidepanel.html` | Estructura semántica: `<header>`, dos `<section>` con `aria-labelledby`, área `role="status" aria-live="polite"`. | — |
| `sidepanel/sidepanel.js` | Orquestación: conecta botones con `HSSenas`/`HSVoz`, actualiza UI, estado, almacenamiento. | `verificarPermisos() → {camara, micro}` (`navigator.permissions.query`) · `mostrarEstado(msg, tipo)` · `agregarLetra(L)` · `copiarTexto()` (confirma "¡Copiado!" 2 s) · `pintarTarjetas(textoNormalizado)` (img con `onerror` → tarjeta "sin seña aún") |
| `sidepanel/sidepanel.css` | Paleta, layout de columna única para ~360 px, foco visible, estados. | Variables CSS: `--naranja:#EA580C; --verde-osc:#166534; --verde:#15803D; --fondo-n:#FFF7ED; --fondo-v:#F0FDF4` |
| `permisos/permisos.html` + `.js` | Pedir cámara y micrófono en pestaña, mostrar resultado y cómo corregirlo si se negó. | `solicitar() → getUserMedia({video:true,audio:true})` → detiene las pistas de inmediato y muestra "Listo, ya puedes cerrar esta pestaña" o instrucciones (ícono de candado → Permitir). |
| `README.md` | Instalación, uso, estructura, cómo reemplazar el modelo, limitaciones. | — |

**Reglas de estabilidad (en `evaluar`)**
1. Si `prob < 0.85` o `clase === 'Nada'` → reinicia el candidato, no agrega.
2. Si la letra es distinta al candidato → nuevo candidato, `desde = ahora`, `yaAgregada = false`.
3. Si `ahora - desde >= 1000` y `!yaAgregada` → `agregar = true`, `yaAgregada = true`.
4. Para repetir la misma letra (p. ej., "LL") se debe pasar por "Nada" o por otra letra.

**Paleta y contraste (verificados con WCAG):** texto `#166534` sobre `#F0FDF4` y blanco sobre `#15803D` / `#166534` cumplen AA. Blanco sobre `#EA580C` ≈ 3.6:1 → se usa solo en botones con texto **grande/negrita** (AA grande) o el naranja como borde/acento; los textos pequeños van en verde oscuro.

---

## 6. Tareas por fases (≈45 min de programación)

| Fase | Tareas | Tiempo | Depende de |
|---|---|---|---|
| **F1** Estructura + manifest + librerías | Carpetas, `manifest.json`, `background.js`, `config.js`, descargar `lib/`, íconos generados con PowerShell (System.Drawing, sin dependencias). Cargar en Chrome y abrir consola del panel para detectar CSP **ya**. | 6 min | — |
| **F2** Permisos | `permisos.html/js`; detección en el panel + botón "Dar permisos". | 5 min | F1 |
| **F3** Señas → Voz + Copiar | `senas.js` (modelo, webcam, `evaluar`), UI de letra/confianza/progreso, Espacio, Borrar, Limpiar, Hablar, Copiar. | 13 min | F1, F2, **modelo** (puede probarse con el modelo de un integrante aunque sea preliminar) |
| **F4** Voz → Señas + respaldo | `voz.js` (síntesis, reconocimiento, `normalizar`), tarjetas, campo de texto de respaldo. | 8 min | F1, F2 |
| **F5** Errores | Mensajes en español: sin permiso, modelo faltante/inválido, sin SpeechRecognition, sin red, imagen faltante, cámara ocupada. | 4 min | F3, F4 |
| **F6** Estilos y accesibilidad | CSS final, `aria-label`, `:focus-visible`, `aria-live`, orden de tabulación. | 5 min | F3, F4 |
| **F7** README y pruebas | README; casos 1–10 de la sección 10. | 4 min + pruebas del equipo | Todas |
| *Opcional* | Persistencia con `storage`; reintento automático es-ES; atajo de teclado. | si sobra tiempo | — |

---

## 7. División del trabajo (en paralelo)

| Integrante | 0–20 min | 20–40 min | 40–60 min |
|---|---|---|---|
| **Kevin** (programación con Claude Code) | F1–F2, descarga de librerías | F3–F4 | F5–F7, integración final |
| **Fabian** (modelo) | Entrenar en Teachable Machine (Imagen): 5–8 letras + "Nada" (fondo, manos fuera), ≥150 muestras/clase, varias luces y fondos | "Exportar → TensorFlow.js → Descargar mi modelo"; pasar zip a Kevin y **nombres exactos** de clases | Pruebas de precisión en el panel; reentrenar si una letra falla |
| **Diana** (imágenes + video) | Fotos de cada seña, fondo liso, recorte cuadrado, `A.png`, `B.png`… (≤100 KB c/u) | Guion final, preparar reunión de Meet de prueba (2 cuentas/dispositivos) | Ejecutar pruebas manuales; grabar y editar el video (≤2 min) |

---

## 8. Cómo cargar y recargar la extensión

1. Abrir `chrome://extensions`.
2. Activar **Modo de desarrollador** (arriba a la derecha).
3. **Cargar descomprimida** → seleccionar la carpeta `handsync-extension/`.
4. Se abre la pestaña de permisos → **Permitir** cámara y micrófono.
5. Fijar el ícono (🧩 → 📌) y hacer clic para abrir el panel.

**Después de cada cambio:** en `chrome://extensions`, botón ⟳ de HandSync; luego cerrar y volver a abrir el panel. (Cambios solo en HTML/CSS/JS del panel: basta cerrar y reabrir el panel; cambios en `manifest.json` o `background.js`: siempre ⟳.)
**Depurar el panel:** clic derecho dentro del panel → **Inspeccionar**. **Service worker:** enlace "service worker" en la tarjeta de la extensión.

---

## 9. Criterios de aceptación

1. La extensión carga sin errores en `chrome://extensions` y en la consola del panel (incluida CSP).
2. Ningún `<script>` ni `fetch` apunta a dominios externos (verificable: `grep -r "http" js sidepanel permisos` solo muestra comentarios/README).
3. Al instalar se abre `permisos.html`; tras permitir, el panel usa cámara y micrófono sin pedir de nuevo.
4. Si falta el permiso, el panel muestra un mensaje claro y un botón que abre la página de permisos.
5. Con confianza ≥ 0.85 sostenida 1000 ms, la letra se agrega **una sola vez**; "Nada" nunca se agrega.
6. Hablar lee el texto en español; Copiar lo deja en el portapapeles y muestra confirmación; se pega en el chat de Meet.
7. Escuchar muestra transcripción parcial en vivo y, al final, una tarjeta por letra (imagen o "sin seña aún"); los espacios separan palabras.
8. `normalizar("Mañana, ¿Ácido?")` → `"MAÑANA ACIDO"`.
9. El campo de respaldo produce las mismas tarjetas sin micrófono.
10. Todos los botones tienen nombre accesible, foco visible y son usables solo con teclado; el panel no tiene scroll horizontal a 360 px.

---

## 10. Plan de pruebas manuales

| # | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Instalación | Cargar descomprimida | Se abre `permisos.html`; sin errores en consola |
| 2 | Permiso negado | Bloquear cámara en permisos, abrir panel, Iniciar cámara | Mensaje "Falta permiso de cámara" + botón que abre permisos |
| 3 | Modelo faltante | Renombrar `model/model.json`, recargar, Iniciar | Mensaje "No se encontró el modelo…"; la sección de voz sigue funcionando |
| 4 | Estabilidad | Mostrar letra A 3 s fijos | Barra de progreso llena; se agrega **una** A |
| 5 | Nada / umbral | Mano fuera de cámara; luego seña ambigua | No se agrega nada; confianza baja visible |
| 6 | Copiar | Armar "HOLA", Copiar, pegar en un bloc de notas | Texto exacto; aviso "¡Copiado!" |
| 7 | Hablar | Botón Hablar con texto y sin texto | Lee el texto en español / mensaje "No hay texto para leer" |
| 8 | Voz → señas | Escuchar, decir "hola Ana" | Transcripción en vivo; tarjetas H O L A · A N A (imagen o respaldo) |
| 9 | Respaldo y Ñ | Escribir "niño" en el campo | Tarjetas N I Ñ O; Ñ conservada |
| 10 | **Con Google Meet** | Meet abierto con cámara encendida en otra pestaña; abrir panel; Iniciar cámara; armar palabra; Copiar; pegar en el chat de Meet | Ambas usan la cámara (o se documenta el conflicto y se aplica mitigación); el mensaje llega al chat |
| 11 | Accesibilidad | Recorrer el panel con Tab/Enter/Espacio | Foco visible en todo; los anuncios de estado se leen (`aria-live`) |

---

## 11. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| **CSP de MV3 bloquea TF.js 1.3.1** (p. ej., `EvalError: Refused to evaluate a string as JavaScript… 'unsafe-eval'`, típico de polyfills que usan `Function('return this')`) | Media | Alto | Detectar en F1 con la consola del panel (no ocultar). Corrección 1: si el error es solo de `regeneratorRuntime`/`globalThis`, definir el global en un script local previo (`js/compat.js`) antes de `tf.min.js`. Corrección 2 (compatible MV3): mover el reconocimiento a una **página sandbox** declarada en `"sandbox": {"pages": [...]}` (allí `unsafe-eval` está permitido), embebida en un `<iframe allow="camera">` y comunicada con `postMessage`. `unsafe-eval` en `extension_pages` **no** es posible en MV3. |
| getUserMedia no muestra solicitud en el panel | Alta (conocido) | Alto | `permisos.html` en pestaña al instalar + botón en el panel. |
| Cámara compartida con Meet | Media | Alto | En Chrome el mismo dispositivo suele poder abrirse desde varias pestañas; probarlo en el caso 10 temprano. Si falla: **Plan B** = reconocimiento en una pestaña de la extensión, o apagar la cámara de Meet mientras se deletrea, o usar una segunda cámara (celular como webcam). |
| `webkitSpeechRecognition` falla en el panel (`not-allowed`, `network`) | Media | Medio | Mensaje claro; campo de texto de respaldo; Plan B: ejecutar la escucha en la pestaña de la extensión. |
| Voz `es-CO` no instalada | Media | Bajo | Elegir cualquier voz `es-*`; si no hay, la predeterminada con `lang='es-ES'`. |
| Modelo poco preciso | Media | Alto | Clase "Nada" robusta, fondos variados, umbral ajustable en `config.js`; reentrenar en paralelo. |
| Nombres de clases ≠ nombres de imágenes | Media | Medio | Se usan **los nombres exactos** de `metadata.json`; `LETRAS_CON_IMAGEN` en `config.js`; tarjeta de respaldo si falta imagen. |
| Rendimiento de TF.js en equipos lentos | Baja | Medio | Predicción con `requestAnimationFrame` limitada a ~10 fps; detener cámara al cerrar el panel. |
| Se acaban los 45 min | Media | Alto | Opcionales marcados; orden F1→F3 primero (núcleo del video). |
| PowerShell: `curl` es alias de `Invoke-WebRequest` | Alta | Bajo | Usar `curl.exe` explícitamente. |

---

## 12. Guion del video (máx. 2:00)

| Tiempo | Escena | Narración / acción |
|---|---|---|
| 0:00–0:15 | Presentación | Nombres del grupo, curso y problema: "personas sordas en videollamadas". Logo/panel HandSync. |
| 0:15–1:00 | Señas → voz | Meet abierto + panel lateral. Iniciar cámara; deletrear una palabra (p. ej., "HOLA"); se ven confianza y progreso; 🔊 Hablar; 📋 Copiar → Ctrl+V en el chat de Meet → enviar. |
| 1:00–1:40 | Voz → señas | 🎤 Escuchar; un integrante dice una palabra; transcripción en vivo; tarjetas con las señas; mostrar el campo de respaldo con "niño" (Ñ). |
| 1:40–2:00 | Cierre | Limitaciones v1 (letras estáticas, voz no entra en la llamada, solo nuestro micrófono) y v2 (audio remoto, MediaPipe, frases dinámicas). |

---

## 13. Lo que necesito antes de implementar

1. **Archivos del modelo**: `model.json`, `metadata.json`, `weights.bin` (Teachable Machine → Exportar → TensorFlow.js → "Descargar mi modelo"). *Si aún no están, implemento todo y el panel mostrará "modelo faltante" hasta copiarlos en `model/`.*
2. **Nombres exactos de las clases** tal como aparecen en `metadata.json` (mayúsculas/minúsculas incluidas), y cuál es la clase vacía (por defecto `Nada`).
3. **Fotos de las señas** nombradas igual que las letras (`A.png`…). *Si faltan, se ve la tarjeta de respaldo.*
4. Confirmación de que la carpeta del proyecto será `handsync-extension/` dentro de `HandSync/`.

### Comandos de descarga (PowerShell, dentro de `handsync-extension/`)

```powershell
curl.exe -L -o lib/tf.min.js https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js
curl.exe -L -o lib/teachablemachine-image.min.js https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.3/dist/teachablemachine-image.min.js
```
(Se verifica que cada archivo pese > 100 KB y empiece con JavaScript, no con una página de error.)

---

## Verificación al implementar
- Tras F1: cargar la extensión y revisar la consola del panel (CSP) y del service worker.
- Tras cada fase: recargar (⟳) y ejecutar los casos de prueba correspondientes; `evaluar()` y `normalizar()` se prueban además desde la consola del panel con valores de ejemplo.
- Reporte final: casos superados, fallidos y no ejecutados (p. ej., el caso 10 requiere Meet con dos participantes, lo ejecuta el equipo).
- Cada archivo se resumirá en 2–3 líneas en el README para el equipo.
