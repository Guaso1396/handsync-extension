// Reconocimiento de voz LOCAL (sin servicios de Google): funciona en Brave, Chrome, Edge, Opera y Firefox.
// Graba el micrófono, corta por pausas y transcribe cada frase con Whisper (en js/voz_worker.js).
// Escucha de forma continua hasta que se llame a detener(), todas las veces que se quiera.

const HSVozLocal = (() => {
  const TASA = 16000;            // Whisper necesita 16 kHz
  const TIEMPO_MAX_MS = 45000;   // si Whisper no responde en este tiempo, se reinicia
  const ALUCINACIONES = /amara\.org|subt[ií]tulos (realizados|por|en)/i;

  let worker = null;
  let listo = false;             // el modelo está cargado
  let calidad = HS_CONFIG.CALIDAD_VOZ; // 'rapida' o 'precisa'
  let inicioTranscripcion = 0;
  let cargando = false;          // se está cargando el modelo
  let cancelado = false;         // el usuario detuvo mientras cargaba
  let activo = false;            // el micrófono está grabando
  let flujo = null, ctx = null, fuente = null, nodo = null;
  let callbacks = null;
  let previo = [], frase = [];
  let hablaSeg = 0, silencioSeg = 0;
  let cola = [], ocupado = false, temporizador = null;
  let origenActual = 'microfono', segundosSinVoz = 0, avisoSilencio = false, ultimoNivel = 0;

  // Crea el worker y carga el modelo (solo si hace falta). Devuelve una promesa.
  function cargarModelo() {
    if (listo) return Promise.resolve();
    return new Promise((resolver, rechazar) => {
      worker = new Worker(chrome.runtime.getURL('js/voz_worker.js'), { type: 'module' });
      worker.onmessage = (ev) => {
        if (ev.data.tipo === 'listo') { listo = true; worker.onmessage = alRecibir; resolver(); }
        else if (ev.data.tipo === 'error') { descartarWorker(); rechazar(new Error(ev.data.mensaje)); }
      };
      worker.onerror = (e) => { descartarWorker(); rechazar(new Error(e.message || 'worker')); };
      worker.postMessage({
        tipo: 'cargar',
        base: chrome.runtime.getURL(''),
        rutaLib: HS_CONFIG.RUTA_TRANSFORMERS,
        rutaModelos: HS_CONFIG.RUTA_MODELOS_VOZ,
        modelo: HS_CONFIG.MODELOS_VOZ[calidad]
      });
    });
  }

  // Elimina el worker para que la próxima vez se cree uno nuevo.
  function descartarWorker() {
    if (worker) worker.terminate();
    worker = null;
    listo = false;
    ocupado = false;
    clearTimeout(temporizador);
  }

  // Convierte el audio del micrófono (p. ej. 48 kHz) a 16 kHz por interpolación lineal.
  function remuestrear(datos, tasaOrigen) {
    if (tasaOrigen === TASA) return Float32Array.from(datos);
    const razon = tasaOrigen / TASA;
    const salida = new Float32Array(Math.floor(datos.length / razon));
    for (let i = 0; i < salida.length; i++) {
      const pos = i * razon, base = Math.floor(pos), frac = pos - base;
      salida[i] = datos[base] * (1 - frac) + (datos[Math.min(base + 1, datos.length - 1)] || 0) * frac;
    }
    return salida;
  }

  // Volumen (RMS) de un bloque de audio.
  function volumen(bloque) {
    let suma = 0;
    for (let i = 0; i < bloque.length; i++) suma += bloque[i] * bloque[i];
    return Math.sqrt(suma / bloque.length);
  }

  // Une bloques en un solo arreglo.
  function unir(bloques) {
    const total = bloques.reduce((n, b) => n + b.length, 0);
    const audio = new Float32Array(total);
    let pos = 0;
    for (const b of bloques) { audio.set(b, pos); pos += b.length; }
    return audio;
  }

  // Cierra la frase actual y la manda a transcribir.
  function enviarFrase() {
    if (hablaSeg >= HS_CONFIG.VAD_MIN_HABLA_S) cola.push(unir(frase));
    frase = []; hablaSeg = 0; silencioSeg = 0;
    siguiente();
  }

  // Manda a Whisper la siguiente frase en cola (de una en una).
  function siguiente() {
    if (!listo || ocupado || !cola.length) return terminarSiCorresponde();
    ocupado = true;
    if (callbacks) callbacks.onEstado('Transcribiendo…');
    const audio = cola.shift();
    inicioTranscripcion = performance.now();
    temporizador = setTimeout(alExpirar, TIEMPO_MAX_MS);
    worker.postMessage({ tipo: 'transcribir', audio }, [audio.buffer]);
  }

  // Whisper no respondió a tiempo: se reinicia el worker y se sigue escuchando.
  function alExpirar() {
    console.error('HandSync voz local: Whisper no respondió, reiniciando');
    descartarWorker();
    if (!callbacks) return;
    callbacks.onError('modelo-local');
    if (!activo) return terminarSiCorresponde();
    callbacks.onEstado('Reiniciando reconocedor…');
    cargarModelo().then(() => { if (callbacks && activo) callbacks.onEstado('Escuchando…'); siguiente(); })
      .catch(() => { if (callbacks) callbacks.onError('modelo-local'); });
  }

  // Respuesta del worker con la transcripción de una frase.
  function alRecibir(ev) {
    clearTimeout(temporizador);
    ocupado = false;
    if (ev.data.tipo === 'texto') {
      const texto = ev.data.texto.trim();
      if (texto && !ALUCINACIONES.test(texto) && callbacks) callbacks.onFinal(texto);
    } else if (ev.data.tipo === 'error') {
      console.error('HandSync voz local:', ev.data.mensaje);
      if (callbacks) callbacks.onError('modelo-local');
    }
    const tardo = ((performance.now() - inicioTranscripcion) / 1000).toFixed(1);
    console.log('HandSync voz local: la frase tardó ' + tardo + ' s (' + HS_CONFIG.MODELOS_VOZ[calidad] + ')');
    if (activo && callbacks) callbacks.onEstado('Escuchando… (última frase tardó ' + tardo + ' s)');
    siguiente();
  }

  // Si ya no se escucha y no queda nada pendiente, avisa el fin una sola vez.
  function terminarSiCorresponde() {
    if (!activo && !cargando && !ocupado && !cola.length && callbacks) {
      const cb = callbacks;
      callbacks = null;
      cb.onFin();
    }
  }

  // Procesa cada bloque de audio: detecta si hay voz y corta por pausas.
  function procesarBloque(ev) {
    const bloque = remuestrear(ev.inputBuffer.getChannelData(0), ctx.sampleRate);
    const seg = bloque.length / TASA;
    const vol = volumen(bloque);
    const hayVoz = vol >= HS_CONFIG.VAD_UMBRAL;
    const ahora = performance.now();
    if (callbacks && callbacks.onNivel && ahora - ultimoNivel > 100) { ultimoNivel = ahora; callbacks.onNivel(vol, hayVoz); }
    segundosSinVoz = hayVoz ? 0 : segundosSinVoz + seg;
    if (!avisoSilencio && segundosSinVoz >= 10 && callbacks) {
      avisoSilencio = true; // se avisa una sola vez por escucha
      callbacks.onEstado(origenActual === 'pestana'
        ? 'No llega sonido de la llamada. Revisa que marcaste "Compartir audio". Si la llamada está en una aplicación (WhatsApp o Zoom de escritorio), detén y elige "Pantalla completa" con "Compartir audio del sistema".'
        : 'No llega sonido del micrófono. Revisa que el micrófono correcto esté activo en Windows y que Brave tenga permiso (botón "Dar permisos").');
    } else if (avisoSilencio && hayVoz && callbacks) {
      avisoSilencio = false; segundosSinVoz = -1e9; // ya llegó sonido: no se vuelve a avisar
      callbacks.onEstado('Escuchando…');
    }
    if (hayVoz) {
      if (!frase.length) frase = previo.splice(0); // incluye medio segundo previo
      frase.push(bloque);
      hablaSeg += seg;
      silencioSeg = 0;
    } else if (frase.length) {
      frase.push(bloque);
      silencioSeg += seg;
    } else {
      previo.push(bloque);
      if (previo.length > 2) previo.shift();
    }
    const duracion = frase.reduce((n, b) => n + b.length, 0) / TASA;
    if ((hablaSeg > 0 && silencioSeg >= HS_CONFIG.VAD_PAUSA_S) || duracion >= HS_CONFIG.VAD_MAX_S) enviarFrase();
  }

  // Libera el micrófono y el audio.
  function liberarAudio() {
    if (nodo) { nodo.onaudioprocess = null; nodo.disconnect(); }
    if (fuente) fuente.disconnect();
    if (flujo) flujo.getTracks().forEach((p) => p.stop());
    if (ctx && ctx.state !== 'closed') ctx.close();
    nodo = fuente = flujo = ctx = null;
  }

  // Obtiene el audio: del micrófono o de una pestaña/pantalla compartida (la llamada).
  // Para 'pestana' el navegador muestra un selector; hay que marcar "Compartir audio".
  async function obtenerFlujo(origen) {
    if (origen !== 'pestana') {
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    }
    const f = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',      // ofrece "Compartir audio del sistema" al elegir pantalla completa (Windows)
      selfBrowserSurface: 'exclude' // no ofrece la pestaña del propio panel
    });
    if (!f.getAudioTracks().length) {
      f.getTracks().forEach((p) => p.stop());
      const e = new Error('sin audio');
      e.name = 'SinAudio';
      throw e;
    }
    return f;
  }

  // Traduce un error de captura a un código que entiende el panel.
  function codigoError(e, origen) {
    if (e.name === 'SinAudio') return 'sin-audio';
    if (e.name === 'NotFoundError') return 'audio-capture';
    return origen === 'pestana' ? 'compartir-cancelado' : 'not-allowed';
  }

  // Empieza a escuchar. origen: 'microfono' (por defecto) o 'pestana' (audio de la llamada).
  // Callbacks: onEstado(msg), onFinal(texto), onError(codigo), onFin().
  async function escuchar(cb, origen = 'microfono') {
    if (activo || cargando) return;
    callbacks = cb;
    cancelado = false;
    cargando = true;
    try {
      flujo = await obtenerFlujo(origen); // primero: necesita el clic del usuario
    } catch (e) {
      cargando = false;
      callbacks = null;
      cb.onError(codigoError(e, origen));
      return cb.onFin();
    }
    try {
      cb.onEstado('Cargando reconocedor de voz local (la primera vez tarda unos segundos)…');
      try {
        await cargarModelo();
      } catch (e) {
        // El modelo "precisa" (whisper-small) no viene en GitHub: si falta, se usa el "rápido" (whisper-base).
        if (calidad === 'rapida') throw e;
        console.warn('HandSync voz local: no se pudo cargar ' + HS_CONFIG.MODELOS_VOZ[calidad] + ', se usa ' + HS_CONFIG.MODELOS_VOZ.rapida, e);
        calidad = 'rapida';
        await cargarModelo();
      }
    } catch (e) {
      console.error('HandSync voz local: no se pudo cargar', e);
      liberarAudio();
      cargando = false;
      callbacks = null;
      cb.onError('modelo-local');
      return cb.onFin();
    }
    cargando = false;
    if (cancelado) { liberarAudio(); callbacks = null; return cb.onFin(); }
    flujo.getAudioTracks()[0].onended = () => detener(); // el usuario dejó de compartir
    ctx = new AudioContext();
    await ctx.resume();
    fuente = ctx.createMediaStreamSource(flujo);
    nodo = ctx.createScriptProcessor(4096, 1, 1);
    nodo.onaudioprocess = procesarBloque;
    fuente.connect(nodo);
    nodo.connect(ctx.destination); // no suena: no se copia audio a la salida
    previo = []; frase = []; cola = []; hablaSeg = 0; silencioSeg = 0;
    origenActual = origen; segundosSinVoz = 0; avisoSilencio = false;
    activo = true;
    cb.onEstado('Escuchando… (pulsa Detener cuando termines)');
  }

  // Deja de escuchar, transcribe lo que falte y avisa el fin.
  function detener() {
    if (cargando) { cancelado = true; return; }
    if (!activo) return;
    activo = false;
    liberarAudio();
    enviarFrase();
  }

  // Cambia la calidad ('rapida' o 'precisa'). Se aplica en la próxima escucha.
  function fijarCalidad(nueva) {
    if (!HS_CONFIG.MODELOS_VOZ[nueva] || nueva === calidad || activo || cargando) return;
    calidad = nueva;
    descartarWorker(); // el modelo se vuelve a cargar al escuchar
  }

  return { escuchar, detener, fijarCalidad };
})();
