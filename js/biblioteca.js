// Biblioteca de señas con movimiento (letras J/Z/Ñ y palabras) en IndexedDB.
// Cada toma: { id, etiqueta, tipo: 'letra'|'palabra', secuencia: [[rasgos]...], video: Blob|null, origen, fecha }

const HSBiblioteca = (() => {
  const NOMBRE = 'handsync';
  const TABLA = 'senas_mov';
  let db = null;
  let cache = null; // lista de tomas en memoria (sin tocar el disco en cada fotograma)
  let cacheReconocer = null; // copia lista para reconocer (se rehace solo cuando cambia la biblioteca)

  function abrir() {
    if (db) return Promise.resolve(db);
    return new Promise((resolver, rechazar) => {
      const req = indexedDB.open(NOMBRE, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(TABLA, { keyPath: 'id', autoIncrement: true });
        s.createIndex('etiqueta', 'etiqueta');
      };
      req.onsuccess = () => { db = req.result; resolver(db); };
      req.onerror = () => rechazar(req.error);
    });
  }

  function tx(modo, fn) {
    return abrir().then((d) => new Promise((resolver, rechazar) => {
      const t = d.transaction(TABLA, modo);
      const r = fn(t.objectStore(TABLA));
      t.oncomplete = () => resolver(r && r.result);
      t.onerror = () => rechazar(t.error);
    }));
  }

  // Carga todas las tomas en memoria. Llamar al iniciar.
  async function cargar() {
    cache = (await tx('readonly', (s) => s.getAll())) || [];
    cacheReconocer = null;
    return cache;
  }

  async function asegurar() {
    if (!cache) await cargar();
    return cache;
  }

  // Guarda una toma nueva y devuelve su id.
  async function agregar(toma) {
    await asegurar();
    const nueva = { video: null, origen: 'camara', fecha: Date.now(), ...toma };
    const id = await tx('readwrite', (s) => s.add(nueva));
    nueva.id = id;
    cache.push(nueva);
    cacheReconocer = null;
    return id;
  }

  async function borrarToma(id) {
    await asegurar();
    await tx('readwrite', (s) => s.delete(id));
    cache = cache.filter((t) => t.id !== id);
    cacheReconocer = null;
  }

  // Borra todas las tomas de una etiqueta.
  async function borrarEtiqueta(etiqueta) {
    await asegurar();
    const ids = cache.filter((t) => t.etiqueta === etiqueta).map((t) => t.id);
    await tx('readwrite', (s) => ids.forEach((id) => s.delete(id)));
    cache = cache.filter((t) => t.etiqueta !== etiqueta);
    cacheReconocer = null;
  }

  // Tomas listas para comparar: [{etiqueta, tipo, secuencia}]
  function todas() {
    return (cache || []).map((t) => ({ etiqueta: t.etiqueta, tipo: t.tipo, secuencia: t.secuencia }));
  }

  // Tomas que se usan para RECONOCER. Si ya grabaste tomas propias con la cámara ("Grabar toma"),
  // solo se usan esas: los videos importados (otra persona, otro encuadre, una sola toma) se parecen
  // poco a tu seña en vivo y confunden al reconocedor. Siguen sirviendo para mostrar la seña.
  function paraReconocer() {
    if (cacheReconocer) return cacheReconocer;
    const propias = (cache || []).filter((t) => t.origen !== 'archivo');
    // Solo palabras: las tomas de letras o de "NADA" grabadas con versiones anteriores no se usan.
    const sirve = (t) => (t.tipo !== 'letra' || HS_CONFIG.LETRAS_DINAMICAS.includes(t.etiqueta)) && t.tipo !== 'nada';
    const fuente = (propias.length ? propias : (cache || [])).filter(sirve);
    cacheReconocer = fuente.map((t) => ({ etiqueta: t.etiqueta, tipo: t.tipo, secuencia: t.secuencia }));
    return cacheReconocer;
  }

  // ¿Hay al menos una toma grabada con la cámara?
  function hayPropias() {
    return (cache || []).some((t) => t.origen !== 'archivo');
  }

  // Resumen por etiqueta: [{etiqueta, tipo, tomas}]
  function resumen() {
    const m = new Map();
    for (const t of cache || []) {
      const x = m.get(t.etiqueta) || { etiqueta: t.etiqueta, tipo: t.tipo, tomas: 0 };
      x.tomas += 1;
      m.set(t.etiqueta, x);
    }
    return [...m.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
  }

  // ¿Existe una seña con esa etiqueta? (síncrono, usa la memoria)
  function existe(etiqueta) {
    return (cache || []).some((t) => t.etiqueta === etiqueta);
  }

  // Video de referencia de una etiqueta (el de la toma más reciente que lo tenga) o null.
  function videoDe(etiqueta) {
    const con = (cache || []).filter((t) => t.etiqueta === etiqueta && t.video);
    return con.length ? con[con.length - 1].video : null;
  }

  return { cargar, agregar, borrarToma, borrarEtiqueta, todas, paraReconocer, hayPropias, resumen, existe, videoDe };
})();
