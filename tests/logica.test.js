const test = require('node:test');
const assert = require('node:assert');
global.HS_CONFIG = {
  SEQ_LARGO: 32, DTW_BANDA: 8, MOV_UMBRAL: 0.035, MOV_QUIETO_MS: 400, SEQ_MIN_MS: 400, SEQ_MAX_MS: 4000
};
const S = require('../js/secuencias.js');

// Secuencia sintética: un punto que recorre una trayectoria (dim 4).
const traza = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
const onda = (n, fase = 0, amp = 1) => traza(n, (t) => [Math.sin(t * 6 + fase) * amp, t, 0, 0]);
const recta = (n) => traza(n, (t) => [t * 2, -t, 1, 0]);

test('remuestrear: largo y extremos', () => {
  const r = S.remuestrear(onda(20), 32);
  assert.strictEqual(r.length, 32);
  assert.deepStrictEqual(r[0], onda(20)[0]);
  assert.deepStrictEqual(r[31], onda(20)[19]);
});

test('dtw: idéntica = 0; desplazada < distinta', () => {
  const a = S.remuestrear(onda(30), 32);
  assert.strictEqual(S.dtw(a, a, 8), 0);
  const desplazada = S.remuestrear(onda(40), 32);
  const distinta = S.remuestrear(recta(30), 32);
  assert.ok(S.dtw(a, desplazada, 8) < S.dtw(a, distinta, 8));
});

test('predecirSecuencia: elige la etiqueta correcta y da margen', () => {
  const bib = [
    { etiqueta: 'HOLA', secuencia: onda(28) }, { etiqueta: 'HOLA', secuencia: onda(35, 0.1) },
    { etiqueta: 'GRACIAS', secuencia: recta(30) }, { etiqueta: 'GRACIAS', secuencia: recta(25) }
  ];
  const r = S.predecirSecuencia(onda(32, 0.05), bib, 3);
  assert.strictEqual(r.etiqueta, 'HOLA');
  assert.ok(r.margen > 0);
  assert.strictEqual(S.predecirSecuencia(onda(10), [], 3), null);
});

test('segmentador: quieto→mueve→quieto devuelve un gesto; solo quieto no', () => {
  const seg = S.crearSegmentador();
  let salida = null, t = 0;
  const quieto = [0, 0, 0, 0];
  for (let i = 0; i < 20; i++, t += 100) assert.strictEqual(seg.empujar(quieto, t), null);
  for (let i = 0; i < 12; i++, t += 100) { const r = seg.empujar([i * 0.5, 0, 0, 0], t); if (r) salida = r; }
  for (let i = 0; i < 12; i++, t += 100) { const r = seg.empujar([6, 0, 0, 0], t); if (r) salida = r; }
  assert.ok(salida, 'debe cerrar un gesto');
  assert.ok(salida.duracionMs >= 400 && salida.secuencia.length >= 5);
});

test('segmentador: un temblor corto (< mínimo) se descarta', () => {
  const seg = S.crearSegmentador();
  let t = 0, salida = null;
  for (let i = 0; i < 5; i++, t += 100) seg.empujar([0, 0, 0, 0], t);
  for (let i = 0; i < 2; i++, t += 100) seg.empujar([i + 1, 0, 0, 0], t);
  for (let i = 0; i < 15; i++, t += 100) { const r = seg.empujar([3, 0, 0, 0], t); if (r) salida = r; }
  assert.strictEqual(salida, null);
});

test('N→Ñ: reemplaza la N reciente; no reemplaza si pasó el tiempo', () => {
  const base = { 'Ñ': 'N' };
  assert.strictEqual(S.aplicarLetraDinamica('HOLAN', 'Ñ', 1000, { letra: 'N', t: 500 }, base, 1500), 'HOLAÑ');
  assert.strictEqual(S.aplicarLetraDinamica('HOLAN', 'Ñ', 5000, { letra: 'N', t: 500 }, base, 1500), 'HOLANÑ');
  assert.strictEqual(S.aplicarLetraDinamica('HOLA', 'Ñ', 1000, null, base, 1500), 'HOLAÑ');
});

test('ultimaPalabra', () => {
  assert.strictEqual(S.ultimaPalabra('YO QUIERO HOLA'), 'HOLA');
  assert.strictEqual(S.ultimaPalabra('HOLA '), 'HOLA');
  assert.strictEqual(S.ultimaPalabra(''), '');
});

// ---------- Letras estáticas (senas.js) ----------
Object.assign(global.HS_CONFIG, {
  UMBRAL_CONFIANZA: 0.85, TIEMPO_ESTABLE_MS: 1000, CLASE_VACIA: 'Nada', LETRAS_DINAMICAS: ['J', 'Z', 'Ñ'],
  DISTANCIA_MAX: 2.0, MARGEN_ESTATICO: 0.08, PESO_ANGULOS: 0.5
});
const SE = require('../js/senas.js');
const mano = (seed) => Array.from({ length: 63 }, (_, i) => Math.sin(i * 0.37 + seed) * 0.8);
const ruido = (v, e) => v.map((x, i) => x + Math.sin(i * 91.7) * e);

test('predecir: ignora J, Z y Ñ aunque tengan muestras', () => {
  const n = mano(1);
  const muestras = [
    { letra: 'Ñ', vec: n }, { letra: 'Ñ', vec: ruido(n, 0.001) },   // Ñ idéntica a la consulta
    { letra: 'N', vec: ruido(n, 0.15) }, { letra: 'N', vec: ruido(n, 0.16) },
    { letra: 'A', vec: mano(9) }
  ];
  const r = SE.predecir(n, muestras, 3);
  assert.notStrictEqual(r.clase, 'Ñ');
  assert.strictEqual(r.clase, 'N');
});

test('predecir: sin muestras estáticas devuelve null; lejos devuelve Nada', () => {
  assert.strictEqual(SE.predecir(mano(1), [{ letra: 'Ñ', vec: mano(1) }], 3), null);
  assert.strictEqual(SE.predecir(mano(1), [{ letra: 'A', vec: mano(50) }], 3).clase, 'Nada');
});

test('predecir: letras casi iguales marcan duda; letras distintas no', () => {
  const m = mano(2);
  const dudosa = SE.predecir(m, [
    { letra: 'N', vec: ruido(m, 0.10) }, { letra: 'M', vec: ruido(m, 0.101) }
  ], 3);
  assert.ok(dudosa.duda, 'N vs M casi iguales → duda');
  const clara = SE.predecir(m, [
    { letra: 'N', vec: ruido(m, 0.01) }, { letra: 'M', vec: ruido(m, 0.9) }
  ], 3);
  assert.ok(!clara.duda);
});

test('recortar: deja solo el tramo con movimiento (+margen)', () => {
  const frames = [], tiempos = [];
  for (let i = 0; i < 30; i++) { frames.push([i >= 10 && i < 20 ? i : (i < 10 ? 10 : 20), 0]); tiempos.push(i * 100); }
  const r = S.recortar(frames, tiempos, (a, b) => Math.abs(a[0] - b[0]), 0.5, 200);
  assert.ok(r.length >= 10 && r.length < 20);
  assert.strictEqual(S.recortar([[0, 0], [0, 0], [0, 0]], [0, 100, 200], (a, b) => Math.abs(a[0] - b[0]), 0.5, 200), null);
});
