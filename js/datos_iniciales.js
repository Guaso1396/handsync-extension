// Datos iniciales: la primera vez que se abre el panel en un navegador, carga las letras y las
// señas con movimiento (con sus videos) que vienen dentro de la extensión, en la carpeta datos/.
// Solo carga lo que falta: nunca reemplaza ni duplica lo que el usuario ya tiene guardado.
//   datos/muestras_handsync.json          → { A: [[63 números], ...], ... }   (chrome.storage.local)
//   datos/senas_movimiento_handsync.json  → [{ etiqueta, tipo, secuencia, video: 'data:...', origen, fecha }]   (IndexedDB)

const HSDatosIniciales = (() => {
  const ARCHIVO_LETRAS = 'datos/muestras_handsync.json';
  const ARCHIVO_MOV = 'datos/senas_movimiento_handsync.json';
  const CLAVE_LETRAS = 'hs_muestras';
  const CLAVE_HECHO = 'hs_datos_iniciales'; // { letras: true, mov: true } cuando ya se cargaron

  async function leerJSON(ruta) {
    const r = await fetch(chrome.runtime.getURL(ruta));
    if (!r.ok) throw new Error('No se encontró ' + ruta);
    return r.json();
  }

  // 'data:video/webm;base64,....' → Blob
  function aBlob(d) {
    const coma = d.indexOf(',');
    const tipo = d.slice(5, coma).replace(/;base64$/, '');
    const bin = atob(d.slice(coma + 1));
    const u = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    return new Blob([u], { type: tipo });
  }

  // Misma base de datos y tabla que js/biblioteca.js.
  function abrirDB() {
    return new Promise((ok, err) => {
      const r = indexedDB.open('handsync', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('senas_mov', { keyPath: 'id', autoIncrement: true }).createIndex('etiqueta', 'etiqueta');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => err(r.error);
    });
  }

  async function cargarLetras() {
    const r = await chrome.storage.local.get(CLAVE_LETRAS);
    if (r[CLAVE_LETRAS] && Object.keys(r[CLAVE_LETRAS]).length) return 0; // ya tiene letras
    const datos = await leerJSON(ARCHIVO_LETRAS);
    await chrome.storage.local.set({ [CLAVE_LETRAS]: datos });
    return Object.keys(datos).length;
  }

  async function cargarMovimiento() {
    const db = await abrirDB();
    try {
      const hay = await new Promise((ok, err) => {
        const r = db.transaction('senas_mov').objectStore('senas_mov').count();
        r.onsuccess = () => ok(r.result);
        r.onerror = () => err(r.error);
      });
      if (hay > 0) return 0; // ya tiene señas con movimiento
      const tomas = await leerJSON(ARCHIVO_MOV);
      if (!Array.isArray(tomas)) throw new Error(ARCHIVO_MOV + ' no tiene el formato esperado');
      await new Promise((ok, err) => {
        const tx = db.transaction('senas_mov', 'readwrite');
        const s = tx.objectStore('senas_mov');
        for (const t of tomas) {
          const { id, ...resto } = t;
          s.add({ ...resto, video: t.video ? aBlob(t.video) : null });
        }
        tx.oncomplete = ok;
        tx.onerror = () => err(tx.error);
      });
      return tomas.length;
    } finally {
      db.close();
    }
  }

  // Llamar al iniciar el panel, antes de HSMuestras.cargar() y HSBiblioteca.cargar().
  // Cada parte se intenta una sola vez por navegador; un error no impide que el panel abra.
  async function cargarSiFaltan() {
    const { [CLAVE_HECHO]: hecho = {} } = await chrome.storage.local.get(CLAVE_HECHO);
    if (!hecho.letras) {
      try {
        const n = await cargarLetras();
        hecho.letras = true;
        if (n) console.log('HandSync: letras iniciales cargadas (' + n + ')');
      } catch (e) { console.error('HandSync: no se pudieron cargar las letras iniciales', e); }
    }
    if (!hecho.mov) {
      try {
        const n = await cargarMovimiento();
        hecho.mov = true;
        if (n) console.log('HandSync: señas con movimiento iniciales cargadas (' + n + ' tomas)');
      } catch (e) { console.error('HandSync: no se pudieron cargar las señas con movimiento iniciales', e); }
    }
    await chrome.storage.local.set({ [CLAVE_HECHO]: hecho });
  }

  return { cargarSiFaltan };
})();
