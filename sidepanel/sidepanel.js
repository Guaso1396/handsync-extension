// Orquestación del panel: conecta la interfaz con HSSenas y HSVoz.

const $ = (id) => document.getElementById(id);
let textoArmado = '';
let camaraActiva = false;
let escuchando = false;
let ultimaLetra = null;   // { letra, t } de la última letra agregada (para reemplazar N por Ñ)
let urlSena = null;       // URL del video de la seña mostrada (se libera al cambiar)
let urlsTarjetas = [];    // URLs de videos de las tarjetas de Voz → Señas
let grabando = false;
let capaEsqueleto = null; // <canvas> sobre el video

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
function agregarLetra(letra, t) {
  textoArmado += letra;
  ultimaLetra = letra === ' ' ? null : { letra, t: t != null ? t : performance.now() };
  pintarTexto();
  revisarPalabra();
}

// Si la última palabra del texto tiene seña guardada, muestra su video; si no, lo oculta.
function revisarPalabra() {
  const p = HSSecuencias.ultimaPalabra(textoArmado);
  if (p.length > 1 && HSBiblioteca.videoDe(p)) mostrarSena(p, 'Seña de ');
  else mostrarSena(null);
}

// Muestra (o oculta) la tarjeta con el video de una seña.
function mostrarSena(etiqueta, prefijo) {
  const caja = $('sena-palabra');
  if (urlSena) { URL.revokeObjectURL(urlSena); urlSena = null; }
  const blob = etiqueta ? HSBiblioteca.videoDe(etiqueta) : null;
  if (!blob) { caja.hidden = true; caja.replaceChildren(); return; }
  urlSena = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.src = urlSena; v.loop = true; v.muted = true; v.autoplay = true; v.playsInline = true;
  v.setAttribute('aria-label', 'Video de la seña ' + etiqueta);
  caja.replaceChildren(document.createTextNode((prefijo || '') + etiqueta), v);
  caja.hidden = false;
}

// Se reconoció una seña con movimiento (palabra).
function alSenaMovimiento(r) {
  if (r.tipo === 'letra') {
    textoArmado = HSSecuencias.aplicarLetraDinamica(
      textoArmado, r.etiqueta, r.t, ultimaLetra, HS_CONFIG.BASE_DINAMICA, HS_CONFIG.VENTANA_REEMPLAZO_MS);
    ultimaLetra = { letra: r.etiqueta, t: r.t };
    pintarTexto();
    revisarPalabra();
  } else {
    if (textoArmado && !textoArmado.endsWith(' ')) textoArmado += ' ';
    textoArmado += r.etiqueta + ' ';
    ultimaLetra = null;
    pintarTexto();
    mostrarSena(r.etiqueta, 'Seña de ');
  }
}

// Cada gesto con movimiento que termina: si no se aceptó, explica por qué en el panel
// (antes solo quedaba en la consola y parecía que la extensión no hacía nada).
function avisarGesto(g) {
  if (g.aceptado) { mostrarEstado(''); return; }
  const max = HS_CONFIG.DTW_DIST_MAX;
  // Si solo hay videos importados, el mejor arreglo es grabar tomas propias.
  const consejo = HSBiblioteca.hayPropias() ? ''
    : ' Consejo: graba 3 tomas tuyas de cada palabra con "Grabar toma" (pestaña Enseñar).';
  if (g.dist > max) {
    mostrarEstado('No reconocí la seña. Lo más parecido fue "' + g.etiqueta + '" (diferencia ' +
      g.dist.toFixed(2) + '; se acepta hasta ' + max + '). Hazla otra vez.' + consejo, 'info');
  } else {
    mostrarEstado('Dudé entre "' + g.etiqueta + '" y otra seña muy parecida. Hazla otra vez más marcada.' + consejo, 'info');
  }
}

// Actualiza letra grande y barras con cada lectura del modelo.
function pintarPrediccion(r) {
  if (r.sinMuestras) mostrarEstado('Aún no hay señas guardadas. Usa "Enseñar señas" o "Importar fotos".', 'info');
  const caja = $('letra');
  caja.classList.toggle('duda', !!r.duda);
  if (r.duda) caja.textContent = r.duda;
  else caja.textContent = r.prob >= HS_CONFIG.UMBRAL_CONFIANZA && r.letra !== HS_CONFIG.CLASE_VACIA ? r.letra : '—';
  $('confianza').value = Math.round(r.prob * 100);
  $('estabilidad').value = Math.round(r.progreso * 100);
  $('pct-confianza').textContent = Math.round(r.prob * 100) + ' %';
  $('pct-estabilidad').textContent = Math.round(r.progreso * 100) + ' %';
}

// Indicador "Cámara activa / apagada" de la tarjeta Señas → Voz.
function pintarEstadoCamara(activa) {
  const caja = $('estado-camara');
  caja.classList.toggle('on', activa);
  caja.querySelector('span').textContent = activa ? 'Cámara activa' : 'Cámara apagada';
  if (!activa) $('chip-mano').hidden = true;
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
    capaEsqueleto = null;
    $('mov').hidden = true;
    $('chk-cuerpo').disabled = false;
    $('chk-cara').disabled = false;
    camaraActiva = false;
    btn.textContent = 'Iniciar cámara';
    btn.setAttribute('aria-label', 'Iniciar cámara');
    btn.classList.remove('activo');
    pintarEstadoCamara(false);
    pintarPrediccion({ letra: '—', prob: 0, progreso: 0 });
    chrome.storage.local.set({ hs_camara_encendida: false }); // el usuario la apagó: no se reabre sola
    return;
  }
  mostrarEstado('Cargando modelo y cámara…');
  try {
    HSCuerpo.fijarAjustes({ cuerpo: $('chk-cuerpo').checked, cara: $('chk-cara').checked });
    await HSSenas.iniciar($('video'), {
      onPrediccion: pintarPrediccion,
      onLetra: agregarLetra,
      onSenaMovimiento: alSenaMovimiento,
      onGesto: avisarGesto,
      onLectura: (lec) => {
        if (capaEsqueleto) HSCuerpo.dibujar(capaEsqueleto, lec);
        $('chip-mano').hidden = !(lec && lec.manos && lec.manos.length);
      },
      onMov: (activo) => { $('mov').hidden = !activo; },
      onCamara: (estado, e) => {
        if (estado === 'reconectando') { pintarEstadoCamara(false); mostrarEstado('La cámara se interrumpió. Reconectando…'); }
        else if (estado === 'ocupada') mostrarEstado('La cámara está ocupada' + (e && e.name === 'NotAllowedError' ? ' o sin permiso' : ' por otra aplicación (¿WhatsApp, Zoom, Meet?)') + '. Reintentando…', 'error');
        else if (estado === 'activa') { pintarEstadoCamara(true); mostrarEstado(''); }
      }
    });
    ponerCapa();
    $('chk-cuerpo').disabled = true;
    $('chk-cara').disabled = true;
    camaraActiva = true;
    btn.textContent = 'Detener cámara';
    btn.setAttribute('aria-label', 'Detener cámara');
    btn.classList.add('activo');
    pintarEstadoCamara(true);
    mostrarEstado('');
    ofrecerPermisos(false);
    chrome.storage.local.set({ hs_camara_encendida: true }); // se vuelve a encender sola al abrir el panel
  } catch (e) {
    mostrarEstado(mensajeErrorCamara(e), 'error');
  }
}

// Envuelve el video con un canvas donde se dibuja el esqueleto (manos, cuerpo y cara).
function ponerCapa() {
  const v = $('video').querySelector('video');
  if (!v) return;
  const envoltura = document.createElement('div');
  envoltura.className = 'vwrap';
  capaEsqueleto = document.createElement('canvas');
  capaEsqueleto.className = 'capa';
  capaEsqueleto.width = v.videoWidth || 640;
  capaEsqueleto.height = v.videoHeight || 480;
  capaEsqueleto.setAttribute('aria-hidden', 'true');
  v.replaceWith(envoltura);
  envoltura.append(v, capaEsqueleto);
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
    btn.textContent = '¡Copiado!';
    setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
    mostrarEstado('');
  } catch {
    mostrarEstado('No se pudo copiar al portapapeles.', 'error');
  }
}

// ---------- Enseñar señas ----------

// Llena la lista de letras.
function llenarLetras() {
  // "Nada": poses que NO son señas (mano en la cara, rascarse, sostener el celular…). Al enseñarlas,
  // el reconocedor aprende a ignorarlas en lugar de convertirlas en letras.
  $('sel-letra').replaceChildren(
    ...HS_CONFIG.LETRAS.map((l) => new Option(l, l)),
    new Option('Nada (no es seña)', HS_CONFIG.CLASE_VACIA)
  );
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
  const esNada = letra === HS_CONFIG.CLASE_VACIA;
  mostrarEstado(esNada
    ? 'Haz gestos que NO son señas (tocarte la cara, rascarte, apoyar la mano…) y muévela un poco…'
    : 'Haz la seña de la ' + letra + ' y mantén la mano visible…');
  await HSSenas.capturar(letra, HS_CONFIG.MUESTRAS_POR_CAPTURA, (hechas, total) => {
    btn.textContent = 'Capturando ' + hechas + '/' + total;
  });
  btn.disabled = false;
  btn.textContent = 'Capturar';
  mostrarEstado(esNada ? '¡Listo! Ahora esos gestos se ignoran.' : '¡Listo! Muestras guardadas para la ' + letra + '.');
  pintarCuenta();
}

// Borra las muestras de la letra elegida.
async function borrarMuestras() {
  const letra = $('sel-letra').value;
  await HSMuestras.borrarLetra(letra);
  pintarCuenta();
  mostrarEstado('Se borraron las muestras de la ' + letra + '.');
}

// ---------- Señas con movimiento y palabras ----------

// Dibuja la lista de señas guardadas.
function pintarListaMov() {
  const lista = HSBiblioteca.resumen();
  if (!lista.length) {
    const li = document.createElement('li');
    li.textContent = 'Aún no hay señas con movimiento guardadas.';
    li.style.fontWeight = '400';
    return $('mov-lista').replaceChildren(li);
  }
  $('mov-lista').replaceChildren(...lista.map((s) => {
    const li = document.createElement('li');
    const nombre = document.createElement('span');
    nombre.className = 'nombre';
    nombre.textContent = s.etiqueta + ' ';
    const tomas = document.createElement('span');
    tomas.className = 'tomas';
    tomas.textContent = '(' + s.tomas + (s.tomas === 1 ? ' toma' : ' tomas') + ')';
    nombre.append(tomas);
    li.append(nombre);
    if (HSBiblioteca.videoDe(s.etiqueta)) {
      const ver = document.createElement('button');
      ver.className = 'secundario ico ico-ver';
      ver.textContent = '';
      ver.setAttribute('aria-label', 'Ver el video de ' + s.etiqueta);
      ver.addEventListener('click', () => mostrarSena(s.etiqueta, 'Seña de '));
      li.append(ver);
    }
    const borrar = document.createElement('button');
    borrar.className = 'secundario ico ico-papelera';
    borrar.textContent = '';
    borrar.setAttribute('aria-label', 'Borrar la seña ' + s.etiqueta);
    borrar.addEventListener('click', async () => {
      if (!confirm('¿Borrar todas las tomas de ' + s.etiqueta + '?')) return;
      await HSBiblioteca.borrarEtiqueta(s.etiqueta);
      HSSenas.reiniciarMovimiento();
      pintarListaMov();
      revisarPalabra();
    });
    li.append(borrar);
    return li;
  }));
}

const MOTIVOS_TOMA = {
  'sin-camara': 'Primero enciende la cámara.',
  'ocupado': 'Espera a que termine la captura actual.',
  'sin-mano': 'No se vio ninguna mano durante la toma. Colócate frente a la cámara y repite.',
  'sin-movimiento': 'No se detectó movimiento. Haz la seña con más amplitud o baja MOV_UMBRAL en js/config.js.'
};

// Graba una toma de la seña escrita.
async function grabarSena() {
  if (grabando) return;
  if (!camaraActiva) return mostrarEstado('Primero enciende la cámara.', 'error');
  const etiqueta = HSVoz.normalizar($('mov-etiqueta').value);
  if (!etiqueta) return mostrarEstado('Escribe el nombre de la seña (por ejemplo HOLA).', 'error');
  if (etiqueta.length === 1 && !HS_CONFIG.LETRAS_DINAMICAS.includes(etiqueta)) {
    return mostrarEstado('Las letras se enseñan como foto en "Enseñar señas" (elige la letra y pulsa Capturar). Aquí solo van palabras.', 'error');
  }
  const tipo = etiqueta.length === 1 ? 'letra' : 'palabra';
  const btn = $('btn-grabar');
  const info = $('mov-estado');
  grabando = true;
  btn.disabled = true;
  mostrarEstado('');
  const r = await HSSenas.grabarToma(etiqueta, tipo, {
    onCuenta: (s) => { info.textContent = s > 0 ? 'Prepárate… ' + s : '● Grabando: haz la seña'; },
    onProgreso: (ms) => { info.textContent = '● Grabando: ' + (ms / 1000).toFixed(1) + ' s'; }
  });
  grabando = false;
  btn.disabled = false;
  if (r.ok) {
    info.textContent = '¡Listo! Toma de ' + etiqueta + ' guardada. Repite 3 a 5 veces para que la reconozca mejor.';
  } else {
    info.textContent = '';
    mostrarEstado(MOTIVOS_TOMA[r.motivo] || 'No se pudo guardar la toma.', 'error');
  }
  pintarListaMov();
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
  urlsTarjetas.forEach((u) => URL.revokeObjectURL(u));
  urlsTarjetas = [];
  const normal = HSVoz.normalizar(texto);
  const nodos = [];
  normal.split(' ').filter(Boolean).forEach((palabra, i) => {
    if (i > 0) {
      const sep = document.createElement('div');
      sep.className = 'separador';
      nodos.push(sep);
    }
    // Palabra con seña guardada: un solo video. Si no, una tarjeta por letra.
    if (palabra.length > 1 && tarjetaVideo(palabra, nodos, true)) return;
    for (const c of palabra) {
      if (!tarjetaVideo(c, nodos, false)) nodos.push(crearTarjeta(c));
    }
  });
  $('tarjetas').replaceChildren(...nodos);
}

// Agrega a `nodos` una tarjeta con el video de la seña `etiqueta`. Devuelve false si no hay video.
function tarjetaVideo(etiqueta, nodos, ancha) {
  const blob = HSBiblioteca.videoDe(etiqueta);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  urlsTarjetas.push(url);
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta' + (ancha ? ' tarjeta-palabra' : '');
  const v = document.createElement('video');
  v.src = url; v.loop = true; v.muted = true; v.autoplay = true; v.playsInline = true;
  v.setAttribute('aria-label', 'Video de la seña ' + etiqueta);
  tarjeta.append(v, document.createTextNode(etiqueta));
  nodos.push(tarjeta);
  return true;
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

// Estado de la voz junto a sus botones (el cuadro #estado de arriba no se ve si el panel está abajo).
function estadoVoz(mensaje, tipo = 'info') {
  mostrarEstado(mensaje, tipo);
  const p = $('voz-estado');
  p.hidden = !mensaje;
  p.textContent = mensaje;
  p.className = 'voz-estado' + (tipo === 'error' ? ' error' : '');
}

// Medidor del volumen que llega (micrófono o llamada). nivel: RMS 0..1; null oculta el medidor.
function nivelVoz(nivel, hayVoz) {
  const caja = $('voz-nivel');
  if (nivel === null) { caja.hidden = true; return; }
  caja.hidden = false;
  const relleno = $('voz-nivel-relleno');
  relleno.style.width = Math.min(100, Math.round(nivel * 800)) + '%';
  relleno.classList.toggle('voz', !!hayVoz);
}

// Inicia o detiene la escucha. origen: 'microfono' (tu voz) o 'pestana' (audio de la llamada).
function alternarEscucha(origen) {
  const llamada = origen === 'pestana';
  const btn = $(llamada ? 'btn-llamada' : 'btn-escuchar');
  const otro = $(llamada ? 'btn-escuchar' : 'btn-llamada');
  const textoInicial = llamada ? 'Escuchar la llamada' : 'Escuchar';
  if (escuchando) return HSVoz.detenerEscucha();
  escuchando = true;
  btn.textContent = 'Detener';
  btn.classList.add('activo');
  otro.disabled = true;
  estadoVoz(llamada ? 'Elige qué compartir en la ventana que se abre…' : 'Iniciando…');
  const callbacks = {
    onParcial: (t) => { $('transcripcion').textContent = t; pintarTarjetas(t); },
    onFinal: (t) => { $('transcripcion').textContent = t; pintarTarjetas(t); },
    onEstado: (mensaje) => estadoVoz(mensaje),
    onError: (codigo) => estadoVoz(mensajeErrorVoz(codigo), 'error'),
    onNivel: (nivel, hayVoz) => nivelVoz(nivel, hayVoz),
    onFin: () => {
      nivelVoz(null);
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
  $('btn-borrar').addEventListener('click', () => { textoArmado = textoArmado.slice(0, -1); ultimaLetra = null; pintarTexto(); revisarPalabra(); });
  $('btn-limpiar').addEventListener('click', () => { textoArmado = ''; ultimaLetra = null; pintarTexto(); revisarPalabra(); });
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
  await HSDatosIniciales.cargarSiFaltan(); // letras y videos que vienen en datos/ (solo la primera vez)
  await HSMuestras.cargar();
  await HSBiblioteca.cargar();
  pintarCuenta();
  pintarListaMov();
  $('btn-grabar').addEventListener('click', grabarSena);
  $('btn-importar-videos').addEventListener('click', () =>
    chrome.tabs.create({ url: chrome.runtime.getURL(HS_CONFIG.RUTA_IMPORTAR) }));
  const { hs_ajustes: aj } = await chrome.storage.local.get('hs_ajustes');
  if (aj) { $('chk-cuerpo').checked = !!aj.cuerpo; $('chk-cara').checked = !!aj.cara; }
  const guardarAjustes = () => chrome.storage.local.set({ hs_ajustes: { cuerpo: $('chk-cuerpo').checked, cara: $('chk-cara').checked } });
  $('chk-cuerpo').addEventListener('change', guardarAjustes);
  $('chk-cara').addEventListener('change', guardarAjustes);
  // La página de importar avisa cuando agrega señas: recargar la biblioteca.
  new BroadcastChannel('handsync').onmessage = async () => {
    await HSBiblioteca.cargar();
    HSSenas.reiniciarMovimiento();
    pintarListaMov();
  };
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
  // Si la cámara estaba encendida la última vez, se vuelve a encender al abrir el panel.
  const { hs_camara_encendida: encendida } = await chrome.storage.local.get('hs_camara_encendida');
  if (encendida && permisos.camara === 'granted' && !camaraActiva) alternarCamara();
}

iniciar();
