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
