// Manos (2) + cuerpo + cara con MediaPipe, y conversión a "rasgos" por fotograma para las señas con movimiento.
// Requiere js/config.js. La conversión de la mano usa HSSenas.vectorDeMano (js/senas.js).

const HSCuerpo = (() => {
  let modulo = null;
  let det = { manos: null, pose: null, cara: null };
  let modoActual = null;
  let tickCara = 0;
  let ultimaCara = null;
  const ajustes = { cuerpo: HS_CONFIG.USAR_CUERPO, cara: HS_CONFIG.USAR_CARA };

  const DIM_MANO = 63;
  const N_BLEND = HS_CONFIG.BLENDSHAPES.length;
  // Posición de cada grupo dentro del vector de rasgos: [manoIzq, manoDer, posición, cuerpo, cara]
  const SECCIONES = {
    manoI: [0, DIM_MANO],
    manoD: [DIM_MANO, DIM_MANO * 2],
    posicion: [DIM_MANO * 2, DIM_MANO * 2 + 4],
    cuerpo: [DIM_MANO * 2 + 4, DIM_MANO * 2 + 16],
    cara: [DIM_MANO * 2 + 16, DIM_MANO * 2 + 16 + N_BLEND]
  };
  const DIM_TOTAL = SECCIONES.cara[1];
  const FIN_MOVIMIENTO = SECCIONES.posicion[1]; // manos + posición cuentan para detectar movimiento

  const URL = (ruta) => chrome.runtime.getURL(ruta);

  // Configura cuerpo/cara (se puede cambiar con la cámara encendida).
  function fijarAjustes(a) {
    Object.assign(ajustes, a);
  }

  async function cargarModulo() {
    if (modulo) return modulo;
    try {
      modulo = await import(URL(HS_CONFIG.RUTA_MEDIAPIPE + 'vision_bundle.mjs'));
    } catch (e) {
      console.error('HandSync: no se pudo cargar MediaPipe', e);
      throw new Error('MEDIAPIPE_FALTANTE');
    }
    return modulo;
  }

  // Crea un detector con GPU y, si falla, con CPU.
  async function crearTarea(clase, archivos, ruta, extra) {
    const opciones = (delegate) => ({
      baseOptions: { modelAssetPath: URL(ruta), delegate },
      runningMode: modoActual,
      ...extra
    });
    try {
      return await modulo[clase].createFromOptions(archivos, opciones('GPU'));
    } catch (e) {
      console.warn('HandSync: GPU no disponible para ' + clase + ', usando CPU', e);
      return modulo[clase].createFromOptions(archivos, opciones('CPU'));
    }
  }

  // Prepara los detectores. modo: 'VIDEO'. Cuerpo y cara se crean solo si están activados.
  async function iniciar(modo = 'VIDEO') {
    await cargarModulo();
    if (modoActual && modoActual !== modo) cerrar();
    modoActual = modo;
    const archivos = await modulo.FilesetResolver.forVisionTasks(URL(HS_CONFIG.RUTA_MEDIAPIPE + 'wasm'));
    if (!det.manos) det.manos = await crearTarea('HandLandmarker', archivos, HS_CONFIG.MODELO_MANO, {
      numHands: 2,
      minHandDetectionConfidence: HS_CONFIG.MANO_CONFIANZA_MIN || 0.5,
      minHandPresenceConfidence: HS_CONFIG.MANO_CONFIANZA_MIN || 0.5
    });
    if (ajustes.cuerpo && !det.pose) {
      try { det.pose = await crearTarea('PoseLandmarker', archivos, HS_CONFIG.MODELO_POSE, { numPoses: 1 }); }
      catch (e) { console.error('HandSync: no se pudo cargar el cuerpo', e); ajustes.cuerpo = false; }
    }
    if (ajustes.cara && !det.cara) {
      try {
        det.cara = await crearTarea('FaceLandmarker', archivos, HS_CONFIG.MODELO_CARA,
          { numFaces: 1, outputFaceBlendshapes: true });
      } catch (e) { console.error('HandSync: no se pudo cargar la cara', e); ajustes.cara = false; }
    }
  }

  function cerrar() {
    for (const k of Object.keys(det)) { try { det[k] && det[k].close(); } catch {} det[k] = null; }
    modoActual = null; ultimaCara = null; tickCara = 0;
  }

  // Lee un fotograma. Devuelve { manos:[{puntos, lado}], pose, cara, blend, ancho, alto }.
  function leer(video, t) {
    const rm = det.manos.detectForVideo(video, t);
    const manos = rm.landmarks.map((puntos, i) => ({ puntos, lado: rm.handedness[i][0].categoryName }));
    let pose = null;
    if (ajustes.cuerpo && det.pose) {
      const rp = det.pose.detectForVideo(video, t);
      pose = rp.landmarks && rp.landmarks[0] ? rp.landmarks[0] : null;
    }
    let cara = null, blend = null;
    if (ajustes.cara && det.cara) {
      if (tickCara++ % (HS_CONFIG.CARA_CADA || 2) === 0) { // la cara se lee 1 de cada N fotogramas para ahorrar proceso
        const rc = det.cara.detectForVideo(video, t);
        ultimaCara = {
          cara: rc.faceLandmarks && rc.faceLandmarks[0] ? rc.faceLandmarks[0] : null,
          blend: rc.faceBlendshapes && rc.faceBlendshapes[0] ? mapaBlend(rc.faceBlendshapes[0].categories) : null
        };
      }
      if (ultimaCara) ({ cara, blend } = ultimaCara);
    }
    return { manos, pose, cara, blend, ancho: video.videoWidth, alto: video.videoHeight };
  }

  function mapaBlend(categorias) {
    const m = {};
    for (const c of categorias) m[c.categoryName] = c.score;
    return m;
  }

  const escalar = (arr, peso, dim) => arr.map((v) => (v * peso) / Math.sqrt(dim));

  // Convierte una lectura en el vector de rasgos (largo fijo DIM_TOTAL). Cada grupo se pondera por PESOS_RASGOS.
  function rasgos(lec) {
    const P = HS_CONFIG.PESOS_RASGOS;
    const manoI = new Array(DIM_MANO).fill(0);
    const manoD = new Array(DIM_MANO).fill(0);
    const posicion = [0, 0, 0, 0]; // muñeca izq (x,y), muñeca der (x,y)
    const pose = lec.pose;
    // Referencia: centro y ancho de hombros si hay cuerpo; si no, el centro de la imagen.
    let cx = 0.5, cy = 0.5, anchoRef = 0.5;
    if (pose) {
      cx = (pose[11].x + pose[12].x) / 2;
      cy = (pose[11].y + pose[12].y) / 2;
      anchoRef = Math.hypot(pose[11].x - pose[12].x, (pose[11].y - pose[12].y) * (lec.alto / lec.ancho)) || 0.3;
    }
    for (const m of lec.manos) {
      const v = HSSenas.vectorDeMano(m.puntos, m.lado, lec.ancho, lec.alto);
      const izq = m.lado === 'Left';
      (izq ? manoI : manoD).splice(0, DIM_MANO, ...v);
      const w = m.puntos[0];
      const off = izq ? 0 : 2;
      posicion[off] = (w.x - cx) / anchoRef;
      posicion[off + 1] = (w.y - cy) / anchoRef;
    }
    // Cuerpo: hombros, codos y muñecas (6 puntos × x,y) respecto al centro de hombros.
    const cuerpo = new Array(12).fill(0);
    if (pose) {
      [11, 12, 13, 14, 15, 16].forEach((idx, i) => {
        cuerpo[i * 2] = (pose[idx].x - cx) / anchoRef;
        cuerpo[i * 2 + 1] = (pose[idx].y - cy) / anchoRef;
      });
    }
    const cara = HS_CONFIG.BLENDSHAPES.map((n) => (lec.blend && lec.blend[n]) || 0);
    return [
      ...escalar(manoI, P.mano, DIM_MANO),
      ...escalar(manoD, P.mano, DIM_MANO),
      ...escalar(posicion, P.posicion, 4),
      ...escalar(cuerpo, P.cuerpo, 12),
      ...escalar(cara, P.cara, N_BLEND)
    ];
  }

  // Energía de movimiento entre dos vectores de rasgos: solo manos y posición (la cara y el cuerpo no disparan gestos).
  function energiaMov(a, b) {
    if (!a || !b) return 0;
    let s = 0;
    for (let i = 0; i < FIN_MOVIMIENTO; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s);
  }

  // ---------- Dibujo del esqueleto ----------

  const CONEXIONES_MANO = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  const CONEXIONES_CUERPO = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24]];

  function lineas(ctx, puntos, conexiones, w, h) {
    ctx.beginPath();
    for (const [a, b] of conexiones) {
      if (!puntos[a] || !puntos[b]) continue;
      ctx.moveTo(puntos[a].x * w, puntos[a].y * h);
      ctx.lineTo(puntos[b].x * w, puntos[b].y * h);
    }
    ctx.stroke();
  }

  function puntosSueltos(ctx, puntos, w, h, radio) {
    for (const p of puntos) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, radio, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Color de los puntos de la mano: lo toma de la variable CSS --pt del tema
  // (naranja en claro, verde menta en oscuro) y lo actualiza si cambia el tema.
  let colorPuntos = null;
  function colorMano() {
    if (colorPuntos) return colorPuntos;
    try {
      colorPuntos = getComputedStyle(document.documentElement).getPropertyValue('--pt').trim() || '#F97316';
    } catch { colorPuntos = '#F97316'; }
    return colorPuntos;
  }
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { colorPuntos = null; });
  } catch { /* sin matchMedia (pruebas) */ }

  // Dibuja manos, cuerpo y cara sobre un <canvas> del mismo tamaño que el video.
  function dibujar(canvas, lec) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!lec) return;
    ctx.lineWidth = 3;
    if (lec.pose) {
      ctx.strokeStyle = 'rgba(37,99,235,0.9)';
      lineas(ctx, lec.pose, CONEXIONES_CUERPO, w, h);
      ctx.fillStyle = 'rgba(37,99,235,0.9)';
      puntosSueltos(ctx, [11,12,13,14,15,16].map((i) => lec.pose[i]), w, h, 4);
    }
    if (lec.cara) {
      ctx.fillStyle = 'rgba(234,88,12,0.7)';
      puntosSueltos(ctx, lec.cara, w, h, 1);
    }
    for (const m of lec.manos) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      lineas(ctx, m.puntos, CONEXIONES_MANO, w, h);
      ctx.fillStyle = colorMano();
      puntosSueltos(ctx, m.puntos, w, h, 5);
    }
  }

  return { iniciar, cerrar, leer, rasgos, energiaMov, dibujar, fijarAjustes, ajustes, DIM_TOTAL, SECCIONES };
})();
