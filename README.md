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

## Señas con movimiento y palabras (v2)
Sección **"Señas con movimiento y palabras"** del panel. Sirve para J, Z, Ñ y palabras (HOLA, GRACIAS…), con **dos manos, cuerpo y expresión de la cara** (MediaPipe Hands + Pose + Face).
- **Grabar con la cámara:** *Iniciar cámara* → escribir el nombre (HOLA, Ñ…) → *Grabar toma* → cuenta atrás 3-2-1 → hacer la seña (3 s). **Repetir 3 a 5 veces** por seña, con pequeñas variaciones. Se guardan los puntos y un video de referencia.
- **Importar videos:** *Importar videos de señas* → elegir `.mp4`/`.webm`, uno por seña. El nombre del archivo es la seña (`hola.mp4`, `hola_2.mp4`, `ñ.mp4`).
- **Reconocer:** al hacer una seña grabada aparece en el texto (`HOLA `). Para J, Z y Ñ la letra reemplaza a la N/I/D que se acaba de agregar (`BASE_DINAMICA`). Si **deletreas** una palabra que tiene seña guardada, aparece su video. En **Voz → Señas**, las palabras con seña muestran su video; si no, las letras.
- **N/Ñ:** la Ñ ya no sale como letra fija; N quieta da N y N con movimiento da Ñ (grabar 3 a 5 tomas de Ñ).
- **Letras parecidas:** se comparan también los ángulos de los dedos, y si dos letras quedan casi empatadas el panel muestra "N o M?" y no agrega nada (`MARGEN_ESTATICO`, `PESO_ANGULOS`).
- **Cuerpo y cara:** casillas *Usar cuerpo / Usar cara* (con la cámara apagada). Graba y reconoce con la misma configuración; si va lento, desactívalas y vuelve a grabar.
- **Ajustar:** la consola del panel (F12) muestra la distancia de cada gesto (`ACEPTADO`/`rechazado`). Si rechaza gestos buenos, sube `DTW_DIST_MAX`; si confunde señas, baja `DTW_DIST_MAX` o sube `DTW_MARGEN`; si no detecta el inicio del gesto, baja `MOV_UMBRAL`.
- Las señas con movimiento se guardan en IndexedDB del navegador (permiso `unlimitedStorage`), no en `chrome.storage`.
- Pruebas de lógica: `node --test tests/logica.test.js tests/importar.test.js`.

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
| `js/cuerpo.js` | Manos (2), cuerpo y cara con MediaPipe; rasgos por fotograma y dibujo del esqueleto. |
| `js/secuencias.js` | DTW, segmentador de gestos y reglas de texto (lógica pura, con pruebas). |
| `js/biblioteca.js` | Señas con movimiento y sus videos en IndexedDB. |
| `sidepanel/` | Interfaz y orquestación. |
| `lib/transformers/`, `lib/modelos/` | transformers.js 2.17.2 y modelo Whisper base (cuantizado), locales. |
| `lib/mediapipe/` | `@mediapipe/tasks-vision` 0.10.14 y `hand_landmarker.task`, locales. |
| `img/senas/` | Una foto de referencia por letra. |

## Limitaciones actuales
- Las palabras **solo se reconocen si se grabaron antes** (3 a 5 tomas cada una); no es un diccionario completo de LSC.
- Las letras estáticas usan una sola mano; las señas con movimiento usan ambas.
- La voz sintetizada suena en tu equipo; no entra a la llamada.
- Voz → Señas escucha **tu** micrófono, no el de los otros.
- Si el reconocimiento rechaza todo o acepta de más, ajusta `DISTANCIA_MAX` y `K_VECINOS` en `js/config.js`.
