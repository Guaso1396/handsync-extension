# HandSync — Extensión de Chrome/Brave (v1)

Fundamentos de Investigación para la Innovación · Docente: Luis Miguel Gonzalez Giraldo
Grupo 2: Fabian Andres Valdez · Kevin Mauricio Roman · Diana Alejandra Botero

Panel lateral para videollamadas (Meet, Zoom web, WhatsApp Web):
- **Señas → Voz:** la cámara detecta la mano con **MediaPipe Hands**, reconoce la letra comparándola con las señas enseñadas, arma la palabra, la lee en voz alta y permite copiarla.
- **Voz → Señas:** el micrófono transcribe y se muestra la seña de cada letra.

> Cambio respecto al plan de Fase 2: el reconocimiento usa MediaPipe (puntos de la mano) en lugar de Teachable Machine, porque necesita muy pocas muestras y no depende del fondo. Todo sigue empaquetado localmente.

## Instalar
1. `chrome://extensions` (o `brave://extensions`) → activar **Modo de desarrollador**.
2. **Cargar descomprimida** → elegir esta carpeta (`handsync-extension/`).
3. En la pestaña que se abre, **permitir cámara y micrófono**.
4. Clic en el ícono de HandSync (si no aparece: 🧩 → 📌).

**Recargar tras un cambio:** botón ⟳ de la extensión y volver a abrir el panel. **Depurar:** clic derecho en el panel → Inspeccionar.

## Enseñar las señas
- **Con fotos ya hechas:** botón *Importar fotos (carpeta)* → elegir la carpeta con una subcarpeta por letra → *Importar*. Reemplaza las muestras de esas letras. Omite J, Z, Ñ (movimiento) y NADA.
- **Con la cámara:** *Iniciar cámara* → elegir la letra → hacer la seña → *Capturar* (20 muestras). Repetir con la mano en distintas posiciones mejora el reconocimiento.
- Las muestras se guardan en el navegador (`chrome.storage.local`).

## Navegadores
- **Chrome, Brave, Edge y Opera:** misma carpeta, se carga descomprimida. Si el navegador no tiene `sidePanel`, el ícono abre el panel en una ventana angosta.
- **Firefox:** copiar la carpeta, renombrar `manifest.firefox.json` a `manifest.json` y cargarla en `about:debugging` → Este Firefox → Cargar complemento temporal. (Sin probar.)
- **Voz → texto:** en Chrome usa el servicio de Google; si el navegador no lo tiene o lo bloquea (Brave, Firefox), usa el reconocedor **local** (Whisper, en `lib/modelos/`). Se puede forzar con `MOTOR_VOZ: 'local'` en `js/config.js`. Tiene un retraso de unos segundos y se equivoca más que el de Google.
- Las muestras de señas se guardan por navegador: hay que importarlas en cada uno.

## Archivos
| Archivo | Qué hace |
|---|---|
| `manifest.json` | MV3, panel lateral, permisos mínimos (`sidePanel`, `storage`). |
| `background.js` | El ícono abre el panel (o una ventana angosta si el navegador no soporta `sidePanel`); abre permisos al instalar. |
| `permisos/` | Pestaña que solicita cámara y micrófono. |
| `importar/` | Convierte una carpeta de fotos en muestras (detecta la mano en cada foto). |
| `js/config.js` | Umbral 0.85, 1000 ms, letras, vecinos, distancia máxima, rutas. |
| `js/muestras.js` | Guarda y lee las muestras en `chrome.storage.local`. |
| `js/senas.js` | MediaPipe + cámara + clasificador de vecinos + regla de estabilidad. |
| `js/voz_local.js`, `js/voz_worker.js` | Reconocedor de voz local (micrófono + pausas + Whisper en un Worker). |
| `js/voz.js` | `hablar`, `escuchar` (es-CO con respaldo es-ES) y `normalizar` (conserva Ñ). |
| `sidepanel/` | Interfaz y orquestación. |
| `lib/transformers/`, `lib/modelos/` | transformers.js 2.17.2 y modelo Whisper base (cuantizado), locales. |
| `lib/mediapipe/` | `@mediapipe/tasks-vision` 0.10.14 y `hand_landmarker.task`, locales. |
| `img/senas/` | Una foto de referencia por letra. |

## Limitaciones actuales
- Solo letras **estáticas** (J, Z, Ñ y las palabras con movimiento o dos manos son el paso 2).
- Una sola mano a la vez.
- La voz sintetizada suena en tu equipo; no entra a la llamada.
- Voz → Señas escucha **tu** micrófono, no el de los otros.
- Si el reconocimiento rechaza todo o acepta de más, ajusta `DISTANCIA_MAX` y `K_VECINOS` en `js/config.js`.
