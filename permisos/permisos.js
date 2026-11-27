// HandSync · Página de permisos (modelo A)
// Pide cámara y micrófono, muestra el estado de cada uno y explica qué hacer si Chrome los bloquea.

(() => {
  const $ = (id) => document.getElementById(id);

  const ui = {
    estadoCamara: $('estado-camara'),
    estadoMicro: $('estado-microfono'),
    btnPermitir: $('btn-permitir'),
    btnPermitirTexto: $('btn-permitir-texto'),
    msgOk: $('msg-ok'),
    msgError: $('msg-error'),
    msgErrorTitulo: $('msg-error-titulo'),
    msgErrorTexto: $('msg-error-texto'),
    pasos: $('pasos-desbloqueo'),
    btnAjustes: $('btn-ajustes'),
    btnCerrar: $('btn-cerrar'),
  };

  const ICONO_OK =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  // ---------- Etiquetas de estado ----------
  // estado: 'granted' | 'denied' | 'prompt'
  function pintarEstado(badge, estado) {
    badge.dataset.state = estado;
    badge.className = 'badge';
    if (estado === 'granted') {
      badge.classList.add('badge--ok');
      badge.innerHTML = ICONO_OK + 'Permitido';
    } else if (estado === 'denied') {
      badge.classList.add('badge--error');
      badge.textContent = 'Bloqueado';
    } else {
      badge.classList.add('badge--pending');
      badge.textContent = 'Pendiente';
    }
  }

  // Consulta el estado actual sin abrir el aviso de Chrome.
  async function consultar(nombre) {
    try {
      const r = await navigator.permissions.query({ name: nombre });
      return r;
    } catch {
      return null; // El navegador no soporta consultar este permiso
    }
  }

  async function refrescarEstados() {
    const [cam, mic] = await Promise.all([consultar('camera'), consultar('microphone')]);
    const estCam = cam ? cam.state : 'prompt';
    const estMic = mic ? mic.state : 'prompt';

    pintarEstado(ui.estadoCamara, estCam);
    pintarEstado(ui.estadoMicro, estMic);

    if (estCam === 'granted' && estMic === 'granted') {
      mostrarExito();
    } else if (estCam === 'denied' || estMic === 'denied') {
      mostrarBloqueado(estCam === 'denied', estMic === 'denied');
    } else {
      ocultarMensajes();
      ui.btnPermitir.hidden = false;
      ui.btnPermitirTexto.textContent = 'Permitir cámara y micrófono';
    }
    return { estCam, estMic };
  }

  // ---------- Mensajes ----------
  function ocultarMensajes() {
    ui.msgOk.hidden = true;
    ui.msgError.hidden = true;
  }

  function mostrarExito() {
    ui.msgError.hidden = true;
    ui.btnPermitir.hidden = true;
    ui.msgOk.hidden = false;
    avisarAlPanel();
  }

  function mostrarError(titulo, texto, conPasos) {
    ui.msgOk.hidden = true;
    ui.msgError.hidden = false;
    ui.msgErrorTitulo.textContent = titulo;
    ui.msgErrorTexto.textContent = texto;
    ui.pasos.hidden = !conPasos;
    ui.btnAjustes.hidden = !conPasos;
    ui.btnPermitir.hidden = false;
    ui.btnPermitirTexto.textContent = 'Reintentar';
  }

  function mostrarBloqueado(camBloq, micBloq) {
    let quien = 'La cámara y el micrófono están bloqueados';
    if (camBloq && !micBloq) quien = 'La cámara está bloqueada';
    if (!camBloq && micBloq) quien = 'El micrófono está bloqueado';
    mostrarError(quien, 'Chrome no deja que HandSync los use. Sigue estos pasos para activarlos:', true);
  }

  function setCargando(cargando) {
    ui.btnPermitir.disabled = cargando;
    const spinner = ui.btnPermitir.querySelector('.spinner');
    if (cargando && !spinner) {
      const s = document.createElement('span');
      s.className = 'spinner';
      s.setAttribute('aria-hidden', 'true');
      ui.btnPermitir.prepend(s);
      ui.btnPermitirTexto.textContent = 'Esperando tu respuesta en Chrome…';
    } else if (!cargando && spinner) {
      spinner.remove();
    }
  }

  // ---------- Pedir permisos ----------
  async function pedirPermisos() {
    ocultarMensajes();
    setCargando(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      // Solo queríamos el permiso: apagamos la cámara y el micrófono de inmediato.
      stream.getTracks().forEach((t) => t.stop());
      setCargando(false);
      pintarEstado(ui.estadoCamara, 'granted');
      pintarEstado(ui.estadoMicro, 'granted');
      mostrarExito();
    } catch (err) {
      setCargando(false);
      manejarError(err);
    }
  }

  async function manejarError(err) {
    const nombre = err && err.name;
    console.warn('[HandSync] getUserMedia falló:', nombre, err);

    if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
      const { estCam, estMic } = await refrescarEstados();
      if (estCam !== 'denied' && estMic !== 'denied') {
        // Cerró el aviso sin elegir: no queda bloqueado, solo hay que volver a intentarlo.
        mostrarError('No se concedió el permiso', 'Cerraste el aviso de Chrome. Pulsa «Reintentar» y elige «Permitir».', false);
      }
    } else if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') {
      mostrarError('No encontramos cámara o micrófono', 'Revisa que estén conectados y que el computador los reconozca, luego pulsa «Reintentar».', false);
    } else if (nombre === 'NotReadableError' || nombre === 'AbortError') {
      mostrarError('La cámara está ocupada', 'Otra aplicación (Zoom, Meet, Teams…) la está usando. Ciérrala y pulsa «Reintentar».', false);
    } else {
      mostrarError('Algo salió mal', 'No pudimos acceder a la cámara o al micrófono. Pulsa «Reintentar».', false);
    }
  }

  // ---------- Comunicación con el resto de la extensión ----------
  function avisarAlPanel() {
    try {
      if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ tipo: 'HANDSYNC_PERMISOS_OK' }, () => {
          // Ignora el error si el panel no está abierto para recibir el mensaje
          void chrome.runtime.lastError;
        });
      }
    } catch { /* sin panel abierto: no pasa nada */ }
  }

  function cerrarPestana() {
    try {
      if (window.chrome && chrome.tabs && chrome.tabs.getCurrent) {
        chrome.tabs.getCurrent((tab) => {
          if (tab && tab.id !== undefined) chrome.tabs.remove(tab.id);
          else window.close();
        });
        return;
      }
    } catch { /* usa el plan B */ }
    window.close();
  }

  function abrirAjustes() {
    const url = 'chrome://settings/content/siteDetails?site=' + encodeURIComponent(location.origin);
    try {
      if (window.chrome && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url });
        return;
      }
    } catch { /* si Chrome no lo permite, quedan los pasos escritos */ }
    ui.msgErrorTexto.textContent = 'Abre esta dirección en una pestaña nueva: ' + url;
  }

  // ---------- Inicio ----------
  ui.btnPermitir.addEventListener('click', pedirPermisos);
  ui.btnCerrar.addEventListener('click', cerrarPestana);
  ui.btnAjustes.addEventListener('click', abrirAjustes);

  // Si el usuario cambia el permiso desde los ajustes de Chrome, la página se actualiza sola.
  Promise.all([consultar('camera'), consultar('microphone')]).then((estados) => {
    estados.forEach((st) => { if (st) st.onchange = refrescarEstados; });
  });

  refrescarEstados();
})();
