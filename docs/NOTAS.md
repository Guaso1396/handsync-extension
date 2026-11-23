# HandSync — Notas del proyecto (resumen de la conversación)

## Estado actual
- Extensión MV3 (Chrome, Brave, Edge, Opera; Firefox con `manifest.firefox.json`, sin probar).
- **Señas → texto → voz:** MediaPipe Hands (local, `lib/mediapipe/`) + clasificador de vecinos más cercanos con muestras guardadas en `chrome.storage.local`. Reglas: umbral 0.85, misma letra 1000 ms, "Nada" nunca se agrega.
- **Enseñar señas:** botón *Capturar* (20 muestras) e *Importar fotos (carpeta)* (una subcarpeta por letra; omite J, Z, Ñ y NADA).
- **Voz → señas:** Google (Chrome) o reconocedor local Whisper (`lib/modelos/`) si el navegador no lo soporta. Tarjetas con la foto de cada letra (`img/senas/`).
- **Escuchar la llamada:** botón que transcribe el audio de una pestaña compartida (Meet, etc.) con el reconocedor local.
- Selector de calidad de voz: Rápida (whisper-base) / Precisa (whisper-small).

## Decisiones tomadas
- Se cambió Teachable Machine por MediaPipe: necesita pocas muestras y no depende del fondo (avisar al profesor, el documento de Fase 2 decía Teachable Machine).
- El manifest declara `'wasm-unsafe-eval'` en la CSP (necesario para MediaPipe y Whisper).
- Todo empaquetado localmente, sin cargar código remoto.
- Fotos de señas de INSOR: solo como referencia visual; las muestras son propias. Citar la fuente.

## Pendiente
- Probar y ajustar `DISTANCIA_MAX` y `K_VECINOS` en `js/config.js` con la cámara real.
- Reforzar con *Capturar* las letras con pocas muestras (K, Q, T, etc.).
- **Paso 2:** J, Z, Ñ y palabras con movimiento o dos manos (secuencias de puntos). No está hecho.
- Velocidad de la voz local: medir el tiempo por frase (la consola F12 lo muestra). Opciones si es lenta: WebGPU (experimento) o servicio en la nube.
- Subtítulos sobre Meet (opción B del chat): no hecho.
- Prueba con Meet, README final y video de 2 minutos.

## Limitaciones a decir en el video
- Solo letras estáticas por ahora y una mano a la vez.
- La voz sintetizada suena en el equipo; no entra a la llamada.
- Los subtítulos y señas solo los ve quien usa la extensión.
- El reconocedor local es más lento y menos preciso que el de Google.

## Cómo cargar y recargar
1. `brave://extensions` o `chrome://extensions` → Modo de desarrollador → Cargar descomprimida → carpeta `handsync-extension/`.
2. Después de cada cambio: botón ⟳ y volver a abrir el panel.
3. Errores: clic derecho en el panel → Inspeccionar → Console (o F12 en la pestaña de importar).
