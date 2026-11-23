// Orquestación del panel: conecta la interfaz con HSSenas y HSVoz.

const $ = (id) => document.getElementById(id);
let textoArmado = '';
let camaraActiva = false;
let escuchando = false;

// ---------- Estado y errores ----------

// Muestra un mensaje en el área de estado. tipo: 'info' | 'error'. Vacío lo oculta.
function mostrarEstado(mensaje, tipo = 'info') {
  const caja = $('estado');
  caja.hidden = !mensaje;
  caja.textContent = mensaje;
  caja.className = tipo;
}

// Muestra u oculta el botón que abre la página de permisos.
function ofrecerPermisos(visible) {
  $('btn-permisos').hidden = !visible;
}

// Revisa si cámara y micrófono ya fueron concedidos.
async function verificarPermisos() {
  const consultar = async (nombre) => {
    try { return (await navigator.permissions.query({ name: nombre })).state; }
    catch { return 'prompt'; }
  };
  return { camara: await consultar('camera'), micro: await consultar('microphone') };
}

// ---------- Señas → Voz ----------

// Dibuja el texto armado.
function pintarTexto() {
  $('texto').textContent = textoArmado;
}

// Agrega una letra (o espacio) al texto armado.
function agregarLetra(letra) {
  textoArmado += letra;
  pintarTexto();
}

// Actualiza letra grande y barras con cada lectura del modelo.
function pintarPrediccion(r) {
  if (r.sinMuestras) mostrarEstado('Aún no hay señas guardadas. Usa "Enseñar señas" o "Importar fotos".', 'info');
  $('letra').textContent = r.prob >= HS_CONFIG.UMBRAL_CONFIANZA && r.letra !== HS_CONFIG.CLASE_VACIA ? r.letra : '—';
  $('confianza').value = Math.round(r.prob * 100);
  $('estabilidad').value = Math.round(r.progreso * 100);
}

// Traduce un error de cámara/modelo a un mensaje en español.
function mensajeErrorCamara(e) {
  if (e.message === 'MEDIAPIPE_FALTANTE') {
    ofrecerPermisos(false);
    return 'No se pudieron cargar los archivos de MediaPipe (carpeta lib/mediapipe/). Recarga la extensión y revisa la consola del panel.';
  }
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
    ofrecerPermisos(true);
    return 'Falta el permiso de la cámara. Pulsa "Dar permisos".';
  }
  if (e.name === 'NotReadableError') return 'La cámara está ocupada por otra aplicación o pestaña. Ciérrala o apaga la cámara allí.';
  if (e.name === 'NotFoundError') return 'No se encontró ninguna cámara.';
  console.error('HandSync cámara:', e);
  return 'No se pudo iniciar la cámara: ' + (e.message || e.name);
}

// Inicia o detiene la cámara.
async function alternarCamara() {
  const btn = $('btn-camara');
  if (camaraActiva) {
    HSSenas.detener($('video'));
    camaraActiva = false;
    btn.textContent = 'Iniciar cámara';
    btn.setAttribute('aria-label', 'Iniciar cámara');
    btn.classList.remove('activo');
    pintarPrediccion({ letra: '—', prob: 0, progreso: 0 });
    return;
  }
  mostrarEstado('Cargando modelo y cámara…');
  try {
    await HSSenas.iniciar($('video'), { onPrediccion: pintarPrediccion, onLetra: agregarLetra });
    camaraActiva = true;
    btn.textContent = 'Detener cámara';
    btn.setAttribute('aria-label', 'Detener cámara');
    btn.classList.add('activo');
    mostrarEstado('');
    ofrecerPermisos(false);
  } catch (e) {
    mostrarEstado(mensajeErrorCamara(e), 'error');
  }
}

// Lee el texto en voz alta.
function hablarTexto() {
  if (!textoArmado.trim()) return mostrarEstado('No hay texto para leer.', 'error');
  mostrarEstado('');
  HSVoz.hablar(textoArmado);
}

// Copia el texto al portapapeles y confirma visualmente.
async function copiarTexto() {
  if (!textoArmado.trim()) return mostrarEstado('No hay texto para copiar.', 'error');
  try {
    await navigator.clipboard.writeText(textoArmado);
    const btn = $('btn-copiar');
    btn.textContent = '✔ ¡Copiado!';
    setTimeout(() => { btn.textContent = '📋 Copiar'; }, 2000);
    mostrarEstado('');
  } catch {
    mostrarEstado('No se pudo copiar al portapapeles.', 'error');
  }
}

// ---------- Enseñar señas ----------

// Llena la lista de letras.
function llenarLetras() {
  $('sel-letra').replaceChildren(...HS_CONFIG.LETRAS.map((l) => new Option(l, l)));
}

// Muestra cuántas muestras tiene la letra elegida.
function pintarCuenta() {
  const letra = $('sel-letra').value;
  $('cuenta-muestras').textContent = 'Muestras guardadas de ' + letra + ': ' + HSMuestras.contar(letra);
}

// Captura muestras de la letra elegida.
async function capturarLetra() {
  if (!camaraActiva) return mostrarEstado('Primero enciende la cámara.', 'error');
  const letra = $('sel-letra').value;
  const btn = $('btn-capturar');
  btn.disabled = true;
  mostrarEstado('Haz la seña de la ' + letra + ' y mantén la mano visible…');
  await HSSenas.capturar(letra, HS_CONFIG.MUESTRAS_POR_CAPTURA, (hechas, total) => {
    btn.textContent = 'Capturando ' + hechas + '/' + total;
  });
  btn.disabled = false;
  btn.textContent = 'Capturar';
  mostrarEstado('¡Listo! Muestras guardadas para la ' + letra + '.');
  pintarCuenta();
}

// Borra las muestras de la letra elegida.
async function borrarMuestras() {
  const letra = $('sel-letra').value;
  await HSMuestras.borrarLetra(letra);
  pintarCuenta();
  mostrarEstado('Se borraron las muestras de la ' + letra + '.');
}

// ---------- Voz → Señas ----------

// Crea la tarjeta de una letra: imagen o aviso "sin seña aún" si falta.
function crearTarjeta(letra) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta';
  const sinSena = () => {
    const aviso = document.createElement('div');
    aviso.className = 'sin-sena';
    aviso.textContent = 'sin seña aún';
    return aviso;
  };
  if (HS_CONFIG.LETRAS_CON_IMAGEN.includes(letra)) {
    const img = document.createElement('img');
    img.alt = 'Seña de la letra ' + letra;
    img.src = chrome.runtime.getURL(HS_CONFIG.RUTA_SENAS + encodeURIComponent(letra) + '.' + HS_CONFIG.EXT_SENAS);
    img.onerror = () => img.replaceWith(sinSena()); // imagen faltante
    tarjeta.append(img);
  } else {
    tarjeta.append(sinSena());
  }
  tarjeta.append(document.createTextNode(letra));
  return tarjeta;
}

// Muestra una tarjeta por letra del texto normalizado.
function pintarTarjetas(texto) {
  const normal = HSVoz.normalizar(texto);
  const nodos = [...normal].map((c) => {
    if (c === ' ') {
      const sep = document.createElement('div');
      sep.className = 'separador';
      return sep;
    }
    return crearTarjeta(c);
  });
  $('tarjetas').replaceChildren(...nodos);
}

// Mensajes de error del reconocimiento de voz.
function mensajeErrorVoz(codigo) {
  if (codigo === 'not-allowed' || codigo === 'service-not-allowed') {
    ofrecerPermisos(true);
    return 'Falta el permiso del micrófono. Pulsa "Dar permisos".';
  }
  if (codigo === 'sin-audio') return 'No se compartió audio. Vuelve a intentarlo, elige la pestaña de la llamada y marca "Compartir audio de la pestaña".';
  if (codigo === 'compartir-cancelado') return 'No se compartió ninguna pestaña. Pulsa el botón, elige la pestaña de la llamada y marca "Compartir audio".';
  if (codigo === 'modelo-local') return 'No se pudo cargar el reconocedor de voz local. Revisar la consola (F12). Usa el campo de texto de respaldo.';
  if (codigo === 'no-speech') return 'No se escuchó nada. Intenta de nuevo.';
  if (codigo === 'network') return 'El reconocimiento de voz necesita internet. Usa el campo de texto de respaldo.';
  if (codigo === 'audio-capture') return 'No se encontró un micrófono.';
  return 'Error de reconocimiento de voz: ' + codigo;
}

// Inicia o detiene la escucha. origen: 'microfono' (tu voz) o 'pestana' (audio de la llamada).
function alternarEscucha(origen) {
  const llamada = origen === 'pestana';
  const btn = $(llamada ? 'btn-llamada' : 'btn-escuchar');
  const otro = $(llamada ? 'btn-escuchar' : 'btn-llamada');
  const textoInicial = llamada ? '🔊 Escuchar la llamada' : '🎤 Escuchar';
  if (escuchando) return HSVoz.detenerEscucha();
  escuchando = true;
  btn.textContent = '⏹ Detener';
  btn.classList.add('activo');
  otro.disabled = true;
  mostrarEstado('');
  const callbacks = {
    onParcial: (t) => { $('transcripcion').textContent = t; pintarTarjetas(t); },
    onFinal: (t) => { $('transcripcion').textContent = t; pintarTarjetas(t); },
    onEstado: (mensaje) => mostrarEstado(mensaje),
    onError: (codigo) => mostrarEstado(mensajeErrorVoz(codigo), 'error'),
    onFin: () => {
      escuchando = false;
      btn.textContent = textoInicial;
      btn.classList.remove('activo');
      otro.disabled = false;
    }
  };
  if (llamada) HSVoz.escucharPestana(callbacks);
  else HSVoz.escuchar(callbacks);
}

// ---------- Inicio ----------

async function iniciar() {
  $('btn-camara').addEventListener('click', alternarCamara);
  $('btn-espacio').addEventListener('click', () => agregarLetra(' '));
  $('btn-borrar').addEventListener('click', () => { textoArmado = textoArmado.slice(0, -1); pintarTexto(); });
  $('btn-limpiar').addEventListener('click', () => { textoArmado = ''; pintarTexto(); });
  $('btn-hablar').addEventListener('click', hablarTexto);
  $('btn-copiar').addEventListener('click', copiarTexto);
  $('btn-escuchar').addEventListener('click', () => alternarEscucha('microfono'));
  $('btn-llamada').addEventListener('click', () => alternarEscucha('pestana'));
  $('btn-capturar').addEventListener('click', capturarLetra);
  $('btn-borrar-muestras').addEventListener('click', borrarMuestras);
  $('sel-letra').addEventListener('change', pintarCuenta);
  $('btn-importar').addEventListener('click', () =>
    chrome.tabs.create({ url: chrome.runtime.getURL(HS_CONFIG.RUTA_IMPORTAR) }));
  const { hs_calidad_voz: guardada } = await chrome.storage.local.get('hs_calidad_voz');
  $('sel-calidad').value = guardada || HS_CONFIG.CALIDAD_VOZ;
  HSVozLocal.fijarCalidad($('sel-calidad').value);
  $('sel-calidad').addEventListener('change', (e) => {
    chrome.storage.local.set({ hs_calidad_voz: e.target.value });
    HSVozLocal.fijarCalidad(e.target.value);
  });
  llenarLetras();
  await HSMuestras.cargar();
  pintarCuenta();
  chrome.storage.onChanged.addListener(pintarCuenta);
  $('respaldo').addEventListener('input', (e) => pintarTarjetas(e.target.value));
  $('btn-permisos').addEventListener('click', () =>
    chrome.tabs.create({ url: chrome.runtime.getURL(HS_CONFIG.RUTA_PERMISOS) }));

  const permisos = await verificarPermisos();
  if (permisos.camara === 'denied' || permisos.micro === 'denied' ||
      permisos.camara === 'prompt' || permisos.micro === 'prompt') {
    mostrarEstado('Faltan permisos de cámara o micrófono. Pulsa "Dar permisos".', 'error');
    ofrecerPermisos(true);
  }
}

iniciar();
