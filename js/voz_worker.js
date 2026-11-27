// Worker (módulo) que ejecuta Whisper localmente con transformers.js.
// Mensajes de entrada:  { tipo:'cargar', base, rutaLib, rutaModelos, modelo }  |  { tipo:'transcribir', audio:Float32Array }
// Mensajes de salida:   { tipo:'listo' } | { tipo:'texto', texto } | { tipo:'error', mensaje }

let transcriptor = null;

// Carga la librería y el modelo desde archivos locales de la extensión.
async function cargar(m) {
  const { pipeline, env } = await import(m.base + m.rutaLib + 'transformers.min.js');
  env.allowRemoteModels = false;        // nunca descarga nada de internet
  env.allowLocalModels = true;
  env.useBrowserCache = false;          // la Cache API no admite chrome-extension://
  env.localModelPath = m.base + m.rutaModelos;
  env.backends.onnx.wasm.wasmPaths = m.base + m.rutaLib;
  env.backends.onnx.wasm.numThreads = 1; // evita SharedArrayBuffer (no disponible en extensiones)
  env.backends.onnx.wasm.proxy = false;
  transcriptor = await pipeline('automatic-speech-recognition', m.modelo, { quantized: true });
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.tipo === 'cargar') {
      await cargar(m);
      self.postMessage({ tipo: 'listo' });
    } else if (m.tipo === 'transcribir') {
      const r = await transcriptor(m.audio, { language: 'spanish', task: 'transcribe', chunk_length_s: 30 });
      self.postMessage({ tipo: 'texto', texto: r.text });
    }
  } catch (e) {
    self.postMessage({ tipo: 'error', mensaje: String((e && e.message) || e) });
  }
};
