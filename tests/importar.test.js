const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Extrae etiquetaDeVideo de importar/importar.js (el archivo usa el DOM, así que no se puede cargar entero).
const codigo = fs.readFileSync(path.join(__dirname, '..', 'importar', 'importar.js'), 'utf8');
const trozo = codigo.match(/function etiquetaDeVideo[\s\S]*?\r?\n}\r?\n/)[0];
const etiquetaDeVideo = new Function(trozo + '; return etiquetaDeVideo;')();

test('etiquetaDeVideo: nombre de archivo → seña', () => {
  assert.strictEqual(etiquetaDeVideo('hola.mp4'), 'HOLA');
  assert.strictEqual(etiquetaDeVideo('Gracias_2.MP4'), 'GRACIAS');
  assert.strictEqual(etiquetaDeVideo('hola (2).mp4'), 'HOLA');
  assert.strictEqual(etiquetaDeVideo('hola-3.webm'), 'HOLA');
  assert.strictEqual(etiquetaDeVideo('ñ.mp4'), 'Ñ');
  assert.strictEqual(etiquetaDeVideo('Cómo-3.webm'), 'COMO');
  assert.strictEqual(etiquetaDeVideo('Ñandú.mp4'), 'ÑANDU');
  assert.strictEqual(etiquetaDeVideo('buenos dias 1.mp4'), 'BUENOS DIAS');
  assert.strictEqual(etiquetaDeVideo('12.mp4'), '');
});
