// Señas → texto. Letras estáticas: MediaPipe Hands (21 puntos) + vecinos más cercanos.
// Señas con movimiento y palabras: manos + cuerpo + cara por fotograma, segmentador y DTW.
// Requiere js/config.js, js/muestras.js, js/secuencias.js, js/cuerpo.js y js/biblioteca.js (en el navegador).

const HSSenas = (() => {
  let detector = null; // solo para importar fotos (modo IMAGE)
  let flujo = null;
  let video = null;
  let corriendo = false;
  let captura = null; // captura de letra en curso: { letra, n, vectores, onProgreso, resolver }
  let toma = null;    // toma de seña con movimiento en curso: { frames, tiempos, hasta, resolver }
  let estado = { candidato: null, desde: 0, agregada: false };
  let segmentador = null;
  let ultimosRasgos = null;
  let bloqueadoHasta = 0;
  let movActivo = false;
  let ultimoGesto = null;     // última seña con movimiento aceptada { etiqueta, t }
  let ultimoPaso = 0;         // último momento en que se alimentó el detector de movimiento
  let ultimoCiclo = 0;        // último momento en que se leyó la cámara
  let generacion = 0;         // cambia al reiniciar la cámara: evita dos ciclos a la vez
  let energiasRecientes = []; // energía de movimiento de los últimos fotogramas (para medir el temblor)

  // ---------- Movimiento: umbral que se adapta al temblor de la cámara ----------
  // Los puntos de MediaPipe tiemblan aunque la mano esté quieta. Si ese temblor supera MOV_UMBRAL,
  // el segmentador cree que siempre hay movimiento: nunca cierra el gesto y bloquea las letras.
  // Por eso el umbral real es el mayor entre MOV_UMBRAL y (temblor medido × MOV_FACTOR_RUIDO).
  function umbralAdaptado(energias, percentil) {
    const base = HS_CONFIG.MOV_UMBRAL;
    if (energias.length < 10) return base;
    const orden = [...energias].sort((x, y) => x - y);
    const piso = orden[Math.floor(orden.length * (percentil == null ? 0.25 : percentil))];
    return Math.max(base, piso * (HS_CONFIG.MOV_FACTOR_RUIDO || 3));
  }

  // Energía escalada: el segmentador compara contra MOV_UMBRAL, así que se escala la energía
  // en lugar de cambiar el umbral del segmentador.
  function energiaEnVivo(a, b) {
    const e = HSCuerpo.energiaMov(a, b);
    if (!a || !b) return e;
    energiasRecientes.push(e);
    if (energiasRecientes.length > (HS_CONFIG.MOV_VENTANA_RUIDO || 40)) energiasRecientes.shift();
    if (energiasRecientes.length < 10) return 0; // ~1 s midiendo el temblor antes de detectar gestos
    return (e * HS_CONFIG.MOV_UMBRAL) / umbralAdaptado(energiasRecientes);
  }

  // Fotogramas sin ninguna mano: se repite el anterior (igual que en vivo) y se quitan los del inicio.
  // Antes se guardaban en cero, y eso hacía que el video importado no se pareciera a la seña en vivo.
  function rellenarSinMano(frames, tiempos) {
    const fin = HSCuerpo.SECCIONES.manoD[1];
    const f2 = [], t2 = [];
    let previo = null;
    frames.forEach((f, i) => {
      const sinMano = f.slice(0, fin).every((v) => v === 0);
      if (sinMano) {
        if (previo) { f2.push(previo); t2.push(tiempos[i]); }
        return;
      }
      previo = f;
      f2.push(f); t2.push(tiempos[i]);
    });
    return { frames: f2, tiempos: t2 };
  }

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

  // Rasgos extra para separar letras parecidas (N/M, U/V…): 15 ángulos de los dedos y 4 separaciones
  // entre puntas, calculados desde el vector de 63 números ya guardado (no hace falta regrabar).
  const cacheExtras = new WeakMap();
  function extras(vec) {
    const hit = cacheExtras.get(vec);
    if (hit) return hit;
    const P = (i) => [vec[i * 3], vec[i * 3 + 1], vec[i * 3 + 2]];
    const cosAngulo = (a, b, c) => { // ángulo en b entre a-b y c-b
      const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const w = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const nu = Math.hypot(...u) || 1, nw = Math.hypot(...w) || 1;
      return (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (nu * nw);
    };
    const peso = HS_CONFIG.PESO_ANGULOS != null ? HS_CONFIG.PESO_ANGULOS : 0.5;
    const out = [];
    for (const s of [1, 5, 9, 13, 17]) {
      out.push(cosAngulo(P(0), P(s), P(s + 1)), cosAngulo(P(s), P(s + 1), P(s + 2)), cosAngulo(P(s + 1), P(s + 2), P(s + 3)));
    }
    for (const [a, b] of [[4, 8], [8, 12], [12, 16], [16, 20]]) {
      const pa = P(a), pb = P(b);
      out.push(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
    }
    const r = out.map((v) => v * peso);
    cacheExtras.set(vec, r);
    return r;
  }

  // Clasifica un vector comparándolo con las muestras (todas las letras se enseñan como foto).
  // Salida: { clase, prob, duda? } o null si no hay muestras. `duda` = letra con la que se confunde.
  function predecir(vec, muestras, k) {
    const dinamicas = HS_CONFIG.LETRAS_DINAMICAS;
    const ex = extras(vec);
    const lista = [];
    for (const m of muestras) {
      if (dinamicas.includes(m.letra)) continue;
      const d = distancia(vec, m.vec);
      lista.push({ letra: m.letra, d, t: Math.hypot(d, distancia(ex, extras(m.vec))) });
    }
    if (!lista.length) return null;
    lista.sort((a, b) => a.t - b.t);
    if (lista[0].d > HS_CONFIG.DISTANCIA_MAX) return { clase: HS_CONFIG.CLASE_VACIA, prob: 1 };
    const votos = {};
    let total = 0;
    for (const v of lista.slice(0, k)) {
      const peso = 1 / (v.t + 0.05);
      votos[v.letra] = (votos[v.letra] || 0) + peso;
      total += peso;
    }
    const [clase, peso] = Object.entries(votos).sort((a, b) => b[1] - a[1])[0];
    const res = { clase, prob: peso / total };
    // Duda: la letra más cercana de otra clase está casi igual de cerca que la mejor de la ganadora.
    const margen = HS_CONFIG.MARGEN_ESTATICO || 0;
    const mejor = lista.find((v) => v.letra === clase);
    const otra = lista.find((v) => v.letra !== clase);
    if (margen > 0 && mejor && otra && otra.t > 0 && (otra.t - mejor.t) / otra.t < margen) res.duda = otra.letra;
    return res;
  }

  // ---------- MediaPipe, cámara y bucle ----------

  // Crea el detector de manos para FOTOS (modo IMAGE). Lo usa la página de importar.
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

  // ---------- Zona de señas ----------
  // Una mano cuenta solo si está levantada frente al cuerpo (de la cabeza hasta la parte baja del pecho).
  // Así no se leen las manos que descansan en la mesa, en las piernas o que se mueven haciendo otra cosa.
  function enZona(mano, lec) {
    const p = lec.pose;
    if (!p || !p[11] || !p[12]) return true;                       // sin cuerpo: no se filtra
    if ((p[11].visibility ?? 1) < 0.5 || (p[12].visibility ?? 1) < 0.5) return true;
    const W = lec.ancho || 640, H = lec.alto || 480;
    const anchoHombros = Math.hypot((p[11].x - p[12].x) * W, (p[11].y - p[12].y) * H);
    if (anchoHombros < 20) return true;                           // hombros poco confiables
    const yHombros = ((p[11].y + p[12].y) / 2) * H;
    const yMano = ((mano.puntos[0].y + mano.puntos[9].y) / 2) * H; // entre la muñeca y el nudillo medio
    return yMano <= yHombros + anchoHombros * (HS_CONFIG.ZONA_ABAJO || 1.6);
  }

  function filtrarZona(lec) {
    if (!HS_CONFIG.ZONA_SENAS || !lec.manos.length) return lec;
    const manos = lec.manos.filter((m) => enZona(m, lec));
    return manos.length === lec.manos.length ? lec : { ...lec, manos };
  }

  // Un fotograma: toma de seña, captura de letra, gesto con movimiento o letra estática.
  function procesar(lecCamara, ahora, callbacks) {
    const lec = filtrarZona(lecCamara);
    const hayMano = lec.manos.length > 0;
    const vec = hayMano ? vectorDeMano(lec.manos[0].puntos, lec.manos[0].lado, lec.ancho, lec.alto) : null;

    if (toma) { avanzarToma(lec, ahora, callbacks); return; }
    if (captura) { if (vec) avanzarCaptura(vec); return; }

    // Gestos con movimiento: solo si hay señas con movimiento guardadas.
    const biblioteca = HSBiblioteca.paraReconocer();
    if (biblioteca.length) {
      if (!segmentador) {
        segmentador = HSSecuencias.crearSegmentador({ energia: energiaEnVivo });
      }
      let r = null;
      if (hayMano) { ultimosRasgos = HSCuerpo.rasgos(lec); r = ultimosRasgos; }
      else if (ultimosRasgos) r = ultimosRasgos; // sin mano = quieto
      // Ritmo fijo (~10/s) aunque la cámara se lea más rápido: así el movimiento se mide igual que en las tomas.
      if (r && ahora - ultimoPaso >= (HS_CONFIG.PASO_MOV_MS || 0)) {
        ultimoPaso = ahora;
        const seg = segmentador.empujar(r, ahora);
        if (segmentador.activo !== movActivo) {
          movActivo = segmentador.activo;
          if (callbacks.onMov) callbacks.onMov(movActivo);
        }
        if (seg) cerrarGesto(seg, biblioteca, ahora, callbacks);
      }
      if (movActivo || ahora < bloqueadoHasta) {
        reiniciarEstado();
        return callbacks.onPrediccion({ letra: '—', prob: 0, progreso: 0, agregar: false, mano: hayMano, movimiento: movActivo });
      }
    }

    // Letras estáticas.
    if (!hayMano) {
      const r = evaluar(HS_CONFIG.CLASE_VACIA, 1, ahora);
      return callbacks.onPrediccion({ ...r, mano: false });
    }
    const pred = predecir(vec, HSMuestras.todas(), HS_CONFIG.K_VECINOS);
    if (!pred) return callbacks.onPrediccion({ letra: '—', prob: 0, progreso: 0, agregar: false, mano: true, sinMuestras: true });
    if (pred.duda) {
      reiniciarEstado();
      return callbacks.onPrediccion({ letra: pred.clase, prob: 0, progreso: 0, agregar: false, mano: true, duda: pred.clase + ' o ' + pred.duda + '?' });
    }
    const r = evaluar(pred.clase, pred.prob, ahora);
    callbacks.onPrediccion({ ...r, mano: true });
    if (r.agregar) callbacks.onLetra(r.letra, ahora);
  }

  // Un gesto terminó: compararlo con la biblioteca y avisar si se reconoce.
  function cerrarGesto(seg, biblioteca, ahora, callbacks) {
    bloqueadoHasta = ahora + (HS_CONFIG.BLOQUEO_TRAS_MOV_MS || 0);
    const pred = HSSecuencias.predecirSecuencia(seg.secuencia, biblioteca, HS_CONFIG.K_SEQ);
    if (!pred) return;
    const ok = pred.dist <= HS_CONFIG.DTW_DIST_MAX && pred.margen >= HS_CONFIG.DTW_MARGEN;
    console.log('HandSync gesto: ' + pred.etiqueta + ' dist=' + pred.dist.toFixed(3) + ' margen=' +
      (isFinite(pred.margen) ? pred.margen.toFixed(3) : '∞') + ' (' + seg.duracionMs + ' ms) ' + (ok ? 'ACEPTADO' : 'rechazado') +
      ' | umbral de movimiento=' + umbralAdaptado(energiasRecientes).toFixed(3));
    if (callbacks.onGesto) callbacks.onGesto({ ...pred, aceptado: ok });
    if (!ok) return;
    // La misma seña otra vez enseguida suele ser la mano bajando a descansar (p. ej. "ABAJO ABAJO ABAJO").
    if (ultimoGesto && ultimoGesto.etiqueta === pred.etiqueta && ahora - ultimoGesto.t < (HS_CONFIG.REPETICION_MIN_MS || 0)) {
      console.log('HandSync gesto: ' + pred.etiqueta + ' repetido muy rápido, se ignora');
      return;
    }
    ultimoGesto = { etiqueta: pred.etiqueta, t: ahora };
    const tipo = (biblioteca.find((b) => b.etiqueta === pred.etiqueta) || {}).tipo || 'palabra';
    callbacks.onSenaMovimiento({ etiqueta: pred.etiqueta, tipo, dist: pred.dist, t: ahora });
  }

  // Programa la siguiente lectura: con cada fotograma nuevo de la cámara (si el navegador lo permite).
  function programar(callbacks) {
    if (!corriendo) return;
    const gen = generacion;
    const siguiente = () => { if (gen === generacion) ciclo(callbacks); };
    if (video && typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(siguiente);
    } else {
      setTimeout(siguiente, HS_CONFIG.CICLO_MIN_MS || 50);
    }
  }

  // Un ciclo de lectura (hasta ~20 por segundo; antes esperaba 100 ms fijos después de cada lectura).
  function ciclo(callbacks) {
    if (!corriendo) return;
    const ahoraCiclo = performance.now();
    if (ahoraCiclo - ultimoCiclo < (HS_CONFIG.CICLO_MIN_MS || 0)) return programar(callbacks);
    ultimoCiclo = ahoraCiclo;
    if (video.readyState >= 2) {
      try {
        const t = performance.now();
        const lec = HSCuerpo.leer(video, t);
        if (callbacks.onLectura) callbacks.onLectura(lec);
        procesar(lec, t, callbacks);
      } catch (e) {
        console.error('HandSync: error en el ciclo de lectura', e);
      }
    }
    programar(callbacks);
  }

  // Inicia cámara y reconocimiento. `contenedor` recibe el <video>.
  async function iniciar(contenedor, callbacks) {
    if (corriendo) return;
    await HSBiblioteca.cargar();
    await HSCuerpo.iniciar('VIDEO');
    flujo = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    video = document.createElement('video');
    video.srcObject = flujo;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-label', 'Vista de tu cámara');
    await video.play();
    contenedor.replaceChildren(video);
    reiniciarEstado();
    segmentador = null; ultimosRasgos = null; bloqueadoHasta = 0; movActivo = false; energiasRecientes = [];
    ultimoPaso = 0; ultimoCiclo = 0; generacion++;
    corriendo = true;
    ciclo(callbacks);
  }

  // Detiene el reconocimiento y libera la cámara.
  function detener(contenedor) {
    corriendo = false;
    generacion++;
    captura = null;
    if (toma && toma.resolver) toma.resolver();
    toma = null;
    if (flujo) flujo.getTracks().forEach((pista) => pista.stop());
    flujo = null;
    video = null;
    if (contenedor) contenedor.replaceChildren();
    reiniciarEstado();
    segmentador = null; movActivo = false;
  }

  // El segmentador debe recrearse al cambiar la biblioteca o los ajustes.
  function reiniciarMovimiento() {
    segmentador = null; ultimosRasgos = null; movActivo = false;
  }

  // ---------- Enseñar letras estáticas ----------

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

  // ---------- Enseñar señas con movimiento ----------

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  // Acumula rasgos de la toma hasta que se cumple el tiempo.
  function avanzarToma(lec, ahora, callbacks) {
    const ultimo = toma.tiempos[toma.tiempos.length - 1];
    if (ultimo == null || ahora - ultimo >= (HS_CONFIG.PASO_MOV_MS || 0)) { // mismo ritmo que en vivo
      toma.frames.push(HSCuerpo.rasgos(lec));
      toma.tiempos.push(ahora);
      toma.conMano += lec.manos.length ? 1 : 0;
    }
    if (toma.onProgreso) toma.onProgreso(Math.max(toma.hasta - ahora, 0));
    if (ahora >= toma.hasta) toma.resolver();
  }

  // Graba una toma de `etiqueta` (cuenta atrás → TOMA_MS de rasgos + video WebM) y la guarda en la biblioteca.
  // opciones: { onCuenta(s), onProgreso(msRestantes) }. Devuelve { ok, motivo?, frames? }.
  async function grabarToma(etiqueta, tipo, opciones = {}) {
    if (!corriendo || !flujo) return { ok: false, motivo: 'sin-camara' };
    if (toma || captura) return { ok: false, motivo: 'ocupado' };
    for (let s = HS_CONFIG.CUENTA_ATRAS_S; s > 0; s--) {
      if (opciones.onCuenta) opciones.onCuenta(s);
      await esperar(1000);
      if (!corriendo) return { ok: false, motivo: 'sin-camara' };
    }
    if (opciones.onCuenta) opciones.onCuenta(0);

    const trozos = [];
    let grabador = null;
    try {
      grabador = new MediaRecorder(flujo, { mimeType: MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '' });
      grabador.ondataavailable = (e) => { if (e.data && e.data.size) trozos.push(e.data); };
    } catch (e) {
      console.warn('HandSync: no se pudo grabar el video de la toma', e);
      grabador = null;
    }
    const finGrabador = grabador ? new Promise((r) => { grabador.onstop = r; }) : Promise.resolve();

    const terminada = new Promise((resolver) => {
      toma = { frames: [], tiempos: [], conMano: 0, hasta: performance.now() + HS_CONFIG.TOMA_MS, resolver, onProgreso: opciones.onProgreso };
    });
    if (grabador) grabador.start();
    await terminada;
    const { frames, tiempos, conMano } = toma;
    toma = null;
    if (grabador && grabador.state !== 'inactive') grabador.stop();
    await finGrabador;
    if (!corriendo) return { ok: false, motivo: 'sin-camara' };

    return guardarToma(etiqueta, tipo, frames, tiempos, conMano, trozos.length ? new Blob(trozos, { type: 'video/webm' }) : null, 'camara');
  }

  // Recorta la parte con movimiento y la guarda. Se usa también al importar videos.
  async function guardarToma(etiqueta, tipo, frames, tiempos, conMano, videoBlob, origen) {
    if (conMano < 3) return { ok: false, motivo: 'sin-mano' };
    ({ frames, tiempos } = rellenarSinMano(frames, tiempos));
    // Mismo criterio de movimiento que en vivo: umbral adaptado al temblor de esta toma.
    const energias = [];
    for (let i = 1; i < frames.length; i++) energias.push(HSCuerpo.energiaMov(frames[i - 1], frames[i]));
    let recorte = HSSecuencias.recortar(frames, tiempos, HSCuerpo.energiaMov, umbralAdaptado(energias, 0.15), 250);
    if (!recorte || recorte.length < 4) {
      recorte = HSSecuencias.recortar(frames, tiempos, HSCuerpo.energiaMov, HS_CONFIG.MOV_UMBRAL, 250);
    }
    if (!recorte || recorte.length < 4) return { ok: false, motivo: 'sin-movimiento' };
    await HSBiblioteca.agregar({ etiqueta, tipo, secuencia: recorte, video: videoBlob, origen });
    reiniciarMovimiento();
    return { ok: true, frames: recorte.length };
  }

  return {
    crearDetector, iniciar, detener, capturar, cancelarCaptura, evaluar, vectorDeMano, predecir,
    grabarToma, guardarToma, reiniciarMovimiento
  };
})();

if (typeof module !== 'undefined') module.exports = HSSenas;
