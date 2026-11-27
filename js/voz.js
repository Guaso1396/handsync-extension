// Voz: síntesis (texto → voz) y reconocimiento (voz → texto).

const HSVoz = (() => {
  let reconocedor = null;
  let usandoLocal = false;
  let parar = false; // el usuario pidió detener

  // Lee el texto en voz alta con una voz en español (es-CO si existe).
  function hablar(texto) {
    window.speechSynthesis.cancel();
    const frase = new SpeechSynthesisUtterance(texto);
    const voces = window.speechSynthesis.getVoices();
    const voz = voces.find((v) => v.lang === 'es-CO') ||
                voces.find((v) => v.lang.toLowerCase().startsWith('es'));
    frase.lang = voz ? voz.lang : 'es-ES';
    if (voz) frase.voice = voz;
    window.speechSynthesis.speak(frase);
  }

  // Siempre hay reconocimiento: Google (si el navegador lo trae) o el reconocedor local.
  function soportaReconocimiento() {
    return true;
  }

  // Escucha el micrófono de forma continua hasta que se llame a detenerEscucha().
  // Callbacks: onParcial(texto), onFinal(texto), onError(codigo), onFin() y onEstado(msg).
  function escuchar(callbacks) {
    parar = false;
    iniciarGoogle(callbacks, 0);
  }

  // Usa el reconocimiento de Google (es-CO, con respaldo es-ES) y lo reinicia solo si se corta.
  // Si el navegador no lo trae o lo bloquea (Brave, Firefox…), usa el reconocedor local.
  function iniciarGoogle(callbacks, indiceIdioma) {
    // Brave (navigator.brave) trae webkitSpeechRecognition pero no lo deja funcionar: se usa el local de una vez.
    if (HS_CONFIG.MOTOR_VOZ === 'local' || navigator.brave || !('webkitSpeechRecognition' in window)) return escucharLocal(callbacks);
    const r = new webkitSpeechRecognition();
    reconocedor = r;
    r.lang = HS_CONFIG.IDIOMAS_VOZ[indiceIdioma];
    r.interimResults = true;
    r.continuous = true;
    // Algunos navegadores traen el reconocedor de Google pero nunca arranca (ni da error):
    // si no empieza a recibir audio en 4 s, se usa el reconocedor local.
    let arranco = false;
    r.onaudiostart = () => { arranco = true; };
    const vigia = setTimeout(() => {
      if (arranco || reconocedor !== r || parar) return;
      console.warn('HandSync: el reconocimiento de Google no arrancó, se usa el reconocedor local');
      r.onend = null; r.onerror = null;
      try { r.abort(); } catch (e) { /* ya estaba detenido */ }
      escucharLocal(callbacks);
    }, 4000);

    r.onresult = (ev) => {
      let parcial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) callbacks.onFinal(res[0].transcript);
        else parcial += res[0].transcript;
      }
      if (parcial) callbacks.onParcial(parcial);
    };
    r.onerror = (ev) => {
      clearTimeout(vigia);
      const siguiente = indiceIdioma + 1;
      if (ev.error === 'language-not-supported' && siguiente < HS_CONFIG.IDIOMAS_VOZ.length) {
        r.onend = null;
        return iniciarGoogle(callbacks, siguiente);
      }
      if (ev.error === 'no-speech' || ev.error === 'aborted') return; // onend lo reinicia
      if (ev.error === 'not-allowed') { // sin permiso de micrófono: el local tampoco podría
        parar = true;
        return callbacks.onError(ev.error);
      }
      // Cualquier otro fallo del servicio de Google (network, service-not-allowed, audio-capture,
      // language-not-supported…): se pasa al reconocedor local en vez de quedarse sin voz.
      console.warn('HandSync: el reconocimiento de Google falló (' + ev.error + '), se usa el reconocedor local');
      r.onend = null;
      escucharLocal(callbacks);
    };
    r.onend = () => {
      if (!parar && reconocedor === r) iniciarGoogle(callbacks, indiceIdioma); // sigue escuchando
      else callbacks.onFin();
    };
    r.start();
  }

  // Escucha con el reconocedor local y recuerda que se está usando.
  function escucharLocal(callbacks, origen = 'microfono') {
    reconocedor = null;
    usandoLocal = true;
    const fin = callbacks.onFin;
    HSVozLocal.escuchar({ ...callbacks, onFin: () => { usandoLocal = false; fin(); } }, origen);
  }

  // Transcribe el audio de la llamada (pestaña compartida). Siempre usa el reconocedor local.
  function escucharPestana(callbacks) {
    parar = false;
    escucharLocal(callbacks, 'pestana');
  }

  // Detiene la escucha en curso.
  function detenerEscucha() {
    parar = true;
    if (usandoLocal) HSVozLocal.detener();
    else if (reconocedor) reconocedor.stop();
  }

  // Normaliza: mayúsculas, sin tildes, conserva Ñ, solo letras y espacios.
  function normalizar(texto) {
    return texto
      .toUpperCase()
      .replace(/Ñ/g, '\u0001')            // protege la Ñ antes de quitar tildes
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')     // quita tildes y diéresis
      .replace(/\u0001/g, 'Ñ')
      .replace(/[^A-ZÑ\s]/g, '')           // quita signos y números
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { hablar, soportaReconocimiento, escuchar, escucharPestana, detenerEscucha, normalizar };
})();
