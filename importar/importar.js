// Importa fotos de señas (una carpeta por letra): detecta la mano y guarda sus puntos como muestras.

const registro = document.getElementById('registro');
const avance = document.getElementById('avance');

// Escribe una línea en el registro.
function anotar(texto, esError) {
  const linea = document.createElement('div');
  linea.textContent = texto;
  if (esError) linea.className = 'error';
  registro.append(linea);
}

// Carga un archivo de imagen como <img>.
function cargarImagen(archivo) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolver(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('imagen ilegible')); };
    img.src = url;
  });
}

// Letra (nombre de la carpeta) de un archivo, o null si no se debe importar.
function letraDeArchivo(archivo) {
  if (!/\.(jpe?g|png)$/i.test(archivo.name)) return null;
  const partes = archivo.webkitRelativePath.split('/');
  const letra = partes[partes.length - 2].normalize('NFC').toUpperCase();
  if (!HS_CONFIG.LETRAS.includes(letra) || HS_CONFIG.LETRAS_DINAMICAS.includes(letra)) return null;
  return letra;
}

// Procesa todas las fotos elegidas.
async function importar() {
  const archivos = [...document.getElementById('carpeta').files];
  registro.replaceChildren();
  if (!archivos.length) return anotar('Primero elige la carpeta de fotos.', true);

  let detector;
  try {
    anotar('Cargando MediaPipe…');
    detector = await HSSenas.crearDetector('IMAGE');
  } catch (e) {
    registro.replaceChildren(); // quita el mensaje "Cargando MediaPipe…"
    return anotar('No se pudo cargar MediaPipe. Revisar la consola (F12).', true);
  }

  const porLetra = {};
  const sinMano = {};
  const lista = archivos.filter((a) => letraDeArchivo(a));
  avance.max = lista.length || 1;
  for (const [i, archivo] of lista.entries()) {
    const letra = letraDeArchivo(archivo);
    try {
      const img = await cargarImagen(archivo);
      const res = detector.detect(img);
      if (res.landmarks.length) {
        const lado = res.handedness[0][0].categoryName;
        (porLetra[letra] = porLetra[letra] || []).push(
          HSSenas.vectorDeMano(res.landmarks[0], lado, img.naturalWidth, img.naturalHeight));
      } else {
        sinMano[letra] = (sinMano[letra] || 0) + 1;
      }
    } catch (e) {
      sinMano[letra] = (sinMano[letra] || 0) + 1;
    }
    avance.value = i + 1;
  }

  for (const [letra, vectores] of Object.entries(porLetra)) {
    await HSMuestras.reemplazarLetra(letra, vectores);
  }
  anotar('Listo. Muestras guardadas por letra:');
  for (const letra of HS_CONFIG.LETRAS) {
    if (porLetra[letra] || sinMano[letra]) {
      anotar(letra + ': ' + (porLetra[letra] || []).length + ' guardadas' +
             (sinMano[letra] ? ', ' + sinMano[letra] + ' sin mano detectada' : ''));
    }
  }
  anotar('Ya puedes cerrar esta pestaña y probar en el panel.');
}

document.getElementById('btn-importar').addEventListener('click', importar);


// ---------- Videos de señas con movimiento ----------

const registroV = document.getElementById('registro-v');
const avanceV = document.getElementById('avance-v');
let relojDeteccion = 0; // los tiempos que se dan a MediaPipe deben crecer siempre

function anotarV(texto, esError) {
  const linea = document.createElement('div');
  linea.textContent = texto;
  if (esError) linea.className = 'error';
  registroV.append(linea);
}

// Nombre del archivo → seña. "hola_2.mp4", "hola (2).mp4" y "hola-3.mp4" → HOLA. Conserva la Ñ.
function etiquetaDeVideo(nombre) {
  return nombre
    .replace(/\.[^.]+$/, '')
    .replace(/[\s_-]*\(?\d+\)?$/, '')
    .toUpperCase()
    .split('Ñ').map((t) => t.normalize('NFD')).join('Ñ') // conserva la Ñ; las tildes quedan separadas y el filtro siguiente las quita
    .replace(/[^A-ZÑ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Espera un evento de un elemento (con tiempo máximo).
function esperarEvento(el, evento, ms) {
  return new Promise((resolver, rechazar) => {
    const t = setTimeout(() => rechazar(new Error('tiempo agotado: ' + evento)), ms);
    el.addEventListener(evento, () => { clearTimeout(t); resolver(); }, { once: true });
  });
}

// Recorre un video a ~10 fotogramas por segundo y devuelve { frames, tiempos, conMano }.
async function leerVideo(archivo) {
  const url = URL.createObjectURL(archivo);
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true;
  v.src = url;
  try {
    await esperarEvento(v, 'loadeddata', 15000);
    const duracion = Math.min(v.duration || 0, 12);
    const frames = [], tiempos = [];
    let conMano = 0;
    for (let t = 0; t <= duracion; t += 0.1) {
      v.currentTime = t;
      await esperarEvento(v, 'seeked', 5000);
      relojDeteccion += 100;
      const lec = HSCuerpo.leer(v, relojDeteccion);
      frames.push(HSCuerpo.rasgos(lec));
      tiempos.push(t * 1000);
      if (lec.manos.length) conMano += 1;
    }
    return { frames, tiempos, conMano };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function importarVideos() {
  const archivos = [...document.getElementById('videos').files];
  registroV.replaceChildren();
  if (!archivos.length) return anotarV('Primero elige uno o más videos.', true);
  try {
    anotarV('Cargando MediaPipe…');
    const { hs_ajustes: aj } = await chrome.storage.local.get('hs_ajustes');
    if (aj) HSCuerpo.fijarAjustes({ cuerpo: !!aj.cuerpo, cara: !!aj.cara });
    await HSCuerpo.iniciar('VIDEO');
  } catch (e) {
    console.error(e);
    registroV.replaceChildren();
    return anotarV('No se pudo cargar MediaPipe. Revisar la consola (F12).', true);
  }
  await HSBiblioteca.cargar();
  avanceV.max = archivos.length;
  avanceV.value = 0;
  let guardados = 0;
  for (const [i, archivo] of archivos.entries()) {
    const etiqueta = etiquetaDeVideo(archivo.name);
    try {
      if (!etiqueta) throw new Error('el nombre del archivo no da una seña válida');
      if (etiqueta.length === 1 && !HS_CONFIG.LETRAS_DINAMICAS.includes(etiqueta)) {
        throw new Error('la ' + etiqueta + ' no lleva movimiento (usa la importación de fotos)');
      }
      const tipo = etiqueta.length === 1 ? 'letra' : 'palabra';
      const { frames, tiempos, conMano } = await leerVideo(archivo);
      const r = await HSSenas.guardarToma(etiqueta, tipo, frames, tiempos, conMano, archivo, 'archivo');
      if (r.ok) { guardados += 1; anotarV(archivo.name + ' → ' + etiqueta + ': guardado (' + r.frames + ' fotogramas)'); }
      else anotarV(archivo.name + ' → ' + etiqueta + ': ' + ({
        'sin-mano': 'no se detectaron manos', 'sin-movimiento': 'no se detectó movimiento'
      }[r.motivo] || 'no se pudo guardar'), true);
    } catch (e) {
      console.error(e);
      anotarV(archivo.name + ': ' + (e.message || 'error al leer el video'), true);
    }
    avanceV.value = i + 1;
  }
  anotarV('Listo: ' + guardados + ' de ' + archivos.length + ' videos guardados. Ya puedes cerrar esta pestaña.');
  new BroadcastChannel('handsync').postMessage('biblioteca');
}

document.getElementById('btn-importar-videos').addEventListener('click', importarVideos);
