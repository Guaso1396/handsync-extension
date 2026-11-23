// Señas → texto con MediaPipe Hands (21 puntos de la mano) + clasificador de vecinos más cercanos.
// Requiere js/config.js y js/muestras.js.

const HSSenas = (() => {
  let detector = null;
  let flujo = null;
  let video = null;
  let corriendo = false;
  let captura = null; // captura en curso: { letra, n, vectores, onProgreso, resolver }
  let estado = { candidato: null, desde: 0, agregada: false };

  // ---------- Lógica pura (se puede probar sin navegador) ----------

  // Reinicia el seguimiento de la letra candidata.
  function reiniciarEstado() {
    estado = { candidato: null, desde: 0, agregada: false };
  }

  // Regla de estabilidad: umbral, "Nada" nunca se agrega, misma letra 1000 ms, una sola vez.
  // Salida: { letra, prob, progreso (0-1), agregar (bool) }.
  function evaluar(clase, prob, ahora) {
    const valida = prob >= HS_CONFIG.UMBRAL_CONFIANZA && clase !== HS_CONFIG.CLASE_VACIA;
    if (!valida) {
      reiniciarEstado();
      return { letra: clase, prob, progreso: 0, agregar: false };
    }
    if (clase !== estado.candidato) {
      estado = { candidato: clase, desde: ahora, agregada: false };
    }
    const progreso = Math.min((ahora - estado.desde) / HS_CONFIG.TIEMPO_ESTABLE_MS, 1);
    let agregar = false;
    if (progreso >= 1 && !estado.agregada) {
      estado.agregada = true;
      agregar = true;
    }
    return { letra: clase, prob, progreso, agregar };
  }

  const redondear = (n) => Math.round(n * 10000) / 10000;

  // Convierte los 21 puntos de una mano en un vector de 63 números que no depende de
  // la posición, el tamaño ni la mano (izquierda/derecha) ni del formato de la imagen.
  function vectorDeMano(puntos, lado, ancho, alto) {
    const signo = lado === 'Left' ? -1 : 1; // espeja la mano izquierda para que parezca derecha
    const px = puntos.map((p) => ({ x: p.x * ancho, y: p.y * alto, z: p.z * ancho }));
    const base = px[0]; // muñeca
    const medio = px[9]; // base del dedo medio
    const escala = Math.hypot(medio.x - base.x, medio.y - base.y, medio.z - base.z) || 1;
    const v = [];
    for (const p of px) {
      v.push(
        redondear((signo * (p.x - base.x)) / escala),
        redondear((p.y - base.y) / escala),
        redondear((p.z - base.z) / escala)
      );
    }
    return v;
  }

  // Distancia entre dos vectores.
  function distancia(a, b) {
    let suma = 0;
    for (let i = 0; i < a.length; i++) suma += (a[i] - b[i]) ** 2;
    return Math.sqrt(suma);
  }

  // Clasifica un vector comparándolo con las muestras. Salida: { clase, prob } o null si no hay muestras.
  function predecir(vec, muestras, k) {
    if (!muestras.length) return null;
    const vecinos = muestras
      .map((m) => ({ letra: m.letra, d: distancia(vec, m.vec) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    if (vecinos[0].d > HS_CONFIG.DISTANCIA_MAX) return { clase: HS_CONFIG.CLASE_VACIA, prob: 1 };
    const votos = {};
    let total = 0;
    for (const v of vecinos) {
      const peso = 1 / (v.d + 0.05);
      votos[v.letra] = (votos[v.letra] || 0) + peso;
      total += peso;
    }
    const [clase, peso] = Object.entries(votos).sort((a, b) => b[1] - a[1])[0];
    return { clase, prob: peso / total };
  }

  // ---------- MediaPipe, cámara y bucle ----------

  // Crea el detector de manos. modo: 'VIDEO' (cámara) o 'IMAGE' (fotos).
  // Lanza Error('MEDIAPIPE_FALTANTE') si faltan los archivos de lib/mediapipe/.
  async function crearDetector(modo) {
    let modulo;
    try {
      modulo = await import(chrome.runtime.getURL(HS_CONFIG.RUTA_MEDIAPIPE + 'vision_bundle.mjs'));
    } catch (e) {
      console.error('HandSync: no se pudo cargar MediaPipe', e);
      throw new Error('MEDIAPIPE_FALTANTE');
    }
    const archivos = await modulo.FilesetResolver.forVisionTasks(
      chrome.runtime.getURL(HS_CONFIG.RUTA_MEDIAPIPE + 'wasm')
    );
    const opciones = (delegate) => ({
      baseOptions: { modelAssetPath: chrome.runtime.getURL(HS_CONFIG.MODELO_MANO), delegate },
      runningMode: modo,
      numHands: 1
    });
    try {
      return await modulo.HandLandmarker.createFromOptions(archivos, opciones('GPU'));
    } catch (e) {
      console.warn('HandSync: GPU no disponible, usando CPU', e);
      return modulo.HandLandmarker.createFromOptions(archivos, opciones('CPU'));
    }
  }

  // Procesa un resultado del detector: captura muestras o clasifica.
  function procesar(resultado, ahora, callbacks) {
    if (!resultado.landmarks.length) {
      const r = evaluar(HS_CONFIG.CLASE_VACIA, 1, ahora);
      return callbacks.onPrediccion({ ...r, mano: false });
    }
    const lado = resultado.handedness[0][0].categoryName;
    const vec = vectorDeMano(resultado.landmarks[0], lado, video.videoWidth, video.videoHeight);
    if (captura) return avanzarCaptura(vec);
    const pred = predecir(vec, HSMuestras.todas(), HS_CONFIG.K_VECINOS);
    if (!pred) return callbacks.onPrediccion({ letra: '—', prob: 0, progreso: 0, agregar: false, mano: true, sinMuestras: true });
    const r = evaluar(pred.clase, pred.prob, ahora);
    callbacks.onPrediccion({ ...r, mano: true });
    if (r.agregar) callbacks.onLetra(r.letra);
  }

  // Un ciclo de lectura (~10 por segundo).
  function ciclo(callbacks) {
    if (!corriendo) return;
    if (video.readyState >= 2) {
      procesar(detector.detectForVideo(video, performance.now()), performance.now(), callbacks);
    }
    setTimeout(() => ciclo(callbacks), 100);
  }

  // Inicia cámara y reconocimiento. `contenedor` recibe el <video>.
  async function iniciar(contenedor, callbacks) {
    if (corriendo) return;
    detector = detector || (await crearDetector('VIDEO'));
    flujo = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    video = document.createElement('video');
    video.srcObject = flujo;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-label', 'Vista de tu cámara');
    await video.play();
    contenedor.replaceChildren(video);
    reiniciarEstado();
    corriendo = true;
    ciclo(callbacks);
  }

  // Detiene el reconocimiento y libera la cámara.
  function detener(contenedor) {
    corriendo = false;
    captura = null;
    if (flujo) flujo.getTracks().forEach((pista) => pista.stop());
    flujo = null;
    video = null;
    if (contenedor) contenedor.replaceChildren();
    reiniciarEstado();
  }

  // ---------- Enseñar señas ----------

  // Suma una muestra a la captura en curso y la termina cuando se completa.
  function avanzarCaptura(vec) {
    captura.vectores.push(vec);
    captura.onProgreso(captura.vectores.length, captura.n);
    if (captura.vectores.length >= captura.n) {
      const { letra, vectores, resolver } = captura;
      captura = null;
      HSMuestras.agregarVarias(letra, vectores).then(resolver);
    }
  }

  // Guarda `n` muestras de la letra mientras se ve la mano. Requiere la cámara activa.
  function capturar(letra, n, onProgreso) {
    return new Promise((resolver) => {
      captura = { letra, n, vectores: [], onProgreso, resolver };
    });
  }

  // Cancela la captura en curso.
  function cancelarCaptura() {
    captura = null;
  }

  return { crearDetector, iniciar, detener, capturar, cancelarCaptura, evaluar, vectorDeMano, predecir };
})();
