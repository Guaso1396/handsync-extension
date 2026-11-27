// Lógica pura de señas con movimiento: remuestreo, DTW, clasificador de secuencias y segmentador.
// Sin dependencias del navegador (se prueba con `node --test tests/`).

const HSSecuencias = (() => {
  const CFG = () => (typeof HS_CONFIG !== 'undefined' ? HS_CONFIG : {});

  // Distancia euclídea entre dos fotogramas (vectores).
  function distFotograma(a, b) {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s);
  }

  // Lleva una secuencia a `n` fotogramas por interpolación lineal.
  function remuestrear(seq, n) {
    if (!seq.length) return [];
    if (seq.length === 1) return Array.from({ length: n }, () => seq[0].slice());
    const salida = [];
    for (let i = 0; i < n; i++) {
      const pos = (i * (seq.length - 1)) / (n - 1);
      const a = Math.floor(pos);
      const b = Math.min(a + 1, seq.length - 1);
      const f = pos - a;
      salida.push(seq[a].map((v, j) => v + (seq[b][j] - v) * f));
    }
    return salida;
  }

  // DTW con banda Sakoe-Chiba. Devuelve el costo medio por paso del camino.
  function dtw(a, b, banda) {
    const n = a.length, m = b.length;
    if (!n || !m) return Infinity;
    const w = Math.max(banda == null ? Math.max(n, m) : banda, Math.abs(n - m));
    const INF = Infinity;
    let prev = new Array(m + 1).fill(INF);
    prev[0] = 0;
    for (let i = 1; i <= n; i++) {
      const cur = new Array(m + 1).fill(INF);
      const j0 = Math.max(1, i - w), j1 = Math.min(m, i + w);
      for (let j = j0; j <= j1; j++) {
        const c = distFotograma(a[i - 1], b[j - 1]);
        cur[j] = c + Math.min(prev[j], cur[j - 1], prev[j - 1]);
      }
      prev = cur;
    }
    return prev[m] / (n + m);
  }

  // Compara una secuencia con la biblioteca [{etiqueta, secuencia}] por vecinos (k) y DTW.
  // Devuelve {etiqueta, dist, margen} o null si no hay biblioteca.
  // `margen` = diferencia entre la mejor etiqueta y la segunda (Infinity si solo hay una).
  function predecirSecuencia(seq, biblioteca, k, opciones = {}) {
    if (!biblioteca.length || !seq.length) return null;
    const N = opciones.largo || CFG().SEQ_LARGO || 32;
    const banda = opciones.banda != null ? opciones.banda : CFG().DTW_BANDA;
    const q = remuestrear(seq, N);
    const mejorPorEtiqueta = {};
    const lista = biblioteca.map((m) => ({
      etiqueta: m.etiqueta,
      d: dtw(q, remuestrear(m.secuencia, N), banda)
    }));
    lista.sort((x, y) => x.d - y.d);
    for (const v of lista.slice(0, Math.max(k || 3, 1))) {
      (mejorPorEtiqueta[v.etiqueta] = mejorPorEtiqueta[v.etiqueta] || []).push(v.d);
    }
    // Puntaje por etiqueta: promedio de sus distancias entre los vecinos; menos votos = penalización.
    const ranking = Object.entries(mejorPorEtiqueta)
      .map(([etiqueta, ds]) => ({ etiqueta, dist: ds.reduce((s, x) => s + x, 0) / ds.length, votos: ds.length }))
      .sort((x, y) => (y.votos - x.votos) || (x.dist - y.dist));
    const mejor = ranking[0];
    // Distancia mínima real de la etiqueta ganadora (la mejor toma), para el umbral.
    const dmin = Math.min(...mejorPorEtiqueta[mejor.etiqueta]);
    const segunda = lista.find((v) => v.etiqueta !== mejor.etiqueta);
    const margen = segunda ? segunda.d - dmin : Infinity;
    return { etiqueta: mejor.etiqueta, dist: dmin, margen };
  }

  // Energía de movimiento entre dos fotogramas de rasgos (solo la parte indicada).
  function energia(a, b) {
    if (!a || !b) return 0;
    return distFotograma(a, b) / Math.sqrt(Math.max(Math.min(a.length, b.length), 1));
  }

  // Segmentador: recibe fotogramas con su energía y marca inicio/fin de un gesto.
  // Uso: const s = crearSegmentador(opts); s.empujar(rasgos, tMs) → null | {secuencia, duracionMs}
  function crearSegmentador(opts = {}) {
    const c = CFG();
    const umbral = opts.umbral != null ? opts.umbral : c.MOV_UMBRAL;
    const quietoMs = opts.quietoMs != null ? opts.quietoMs : c.MOV_QUIETO_MS;
    const minMs = opts.minMs != null ? opts.minMs : c.SEQ_MIN_MS;
    const maxMs = opts.maxMs != null ? opts.maxMs : c.SEQ_MAX_MS;
    const preMs = opts.preMs != null ? opts.preMs : 300;
    const inicioFrames = opts.inicioFrames != null ? opts.inicioFrames : 2;
    const fnEnergia = opts.energia || energia; // función (prev, actual) → número

    let previo = null;
    let pre = []; // [{r, t}] fotogramas recientes (pre-roll)
    let activo = false;
    let seq = []; // [{r, t}]
    let sobre = 0; // fotogramas seguidos sobre el umbral antes de empezar
    let ultimoMov = 0;
    let primerMov = 0; // instante del primer fotograma con movimiento (sin pre-roll)

    function cerrar() {
      const duracion = ultimoMov - primerMov;
      const salida = duracion >= minMs ? { secuencia: seq.map((x) => x.r), duracionMs: duracion } : null;
      activo = false; seq = []; sobre = 0;
      return salida;
    }

    return {
      get activo() { return activo; },
      empujar(rasgos, t) {
        const e = fnEnergia(previo, rasgos);
        previo = rasgos;
        if (!activo) {
          pre.push({ r: rasgos, t });
          while (pre.length && t - pre[0].t > preMs) pre.shift();
          if (e > umbral) { if (sobre === 0) primerMov = t; sobre += 1; } else sobre = 0;
          if (sobre >= inicioFrames) {
            activo = true;
            seq = pre.slice();
            ultimoMov = t;
            pre = [];
          }
          return null;
        }
        seq.push({ r: rasgos, t });
        if (e > umbral) ultimoMov = t;
        if (t - ultimoMov >= quietoMs) {
          // recorta la cola quieta
          while (seq.length > 1 && seq[seq.length - 1].t > ultimoMov + 100) seq.pop();
          return cerrar();
        }
        if (seq[seq.length - 1].t - seq[0].t >= maxMs) return cerrar();
        return null;
      },
      reiniciar() { previo = null; pre = []; activo = false; seq = []; sobre = 0; }
    };
  }

  // Recorta una toma al tramo con movimiento (+ margen en ms a cada lado). null si no hay movimiento.
  function recortar(frames, tiempos, energiaFn, umbral, margenMs) {
    let i0 = -1, i1 = -1;
    for (let i = 1; i < frames.length; i++) {
      if (energiaFn(frames[i - 1], frames[i]) > umbral) { if (i0 < 0) i0 = i - 1; i1 = i; }
    }
    if (i0 < 0) return null;
    const t0 = tiempos[i0] - margenMs, t1 = tiempos[i1] + margenMs;
    return frames.filter((_, i) => tiempos[i] >= t0 && tiempos[i] <= t1);
  }

  // ---------- Reglas de texto (puras) ----------

  // Dado el texto y la letra con movimiento reconocida, decide si reemplaza la última letra base.
  // Devuelve el nuevo texto. `ultima` = { letra, t } de la última letra agregada por el clasificador.
  function aplicarLetraDinamica(texto, etiqueta, ahora, ultima, base, ventanaMs) {
    const b = base[etiqueta];
    if (b && ultima && ultima.letra === b && ahora - ultima.t <= ventanaMs && texto.endsWith(b)) {
      return texto.slice(0, -1) + etiqueta;
    }
    return texto + etiqueta;
  }

  // Última palabra deletreada del texto (tras el último espacio).
  function ultimaPalabra(texto) {
    const t = texto.replace(/\s+$/, '');
    const i = t.lastIndexOf(' ');
    return t.slice(i + 1);
  }

  return {
    distFotograma, remuestrear, dtw, predecirSecuencia, energia, crearSegmentador, recortar,
    aplicarLetraDinamica, ultimaPalabra
  };
})();

if (typeof module !== 'undefined') module.exports = HSSecuencias;
