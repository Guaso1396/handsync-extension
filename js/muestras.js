// Almacén de muestras de señas (vectores de la mano) en chrome.storage.local.
// Formato: { A: [[63 números], ...], B: [...] }

const HSMuestras = (() => {
  const CLAVE = 'hs_muestras';
  let datos = {};

  // Carga las muestras guardadas.
  async function cargar() {
    const r = await chrome.storage.local.get(CLAVE);
    datos = r[CLAVE] || {};
    return datos;
  }

  // Guarda en disco el estado actual.
  function guardar() {
    return chrome.storage.local.set({ [CLAVE]: datos });
  }

  // Agrega varias muestras a una letra.
  async function agregarVarias(letra, vectores) {
    datos[letra] = (datos[letra] || []).concat(vectores);
    await guardar();
  }

  // Reemplaza todas las muestras de una letra.
  async function reemplazarLetra(letra, vectores) {
    datos[letra] = vectores;
    await guardar();
  }

  // Borra las muestras de una letra.
  async function borrarLetra(letra) {
    delete datos[letra];
    await guardar();
  }

  // Cuántas muestras tiene una letra.
  function contar(letra) {
    return (datos[letra] || []).length;
  }

  // Lista plana [{letra, vec}] para el clasificador.
  function todas() {
    return Object.entries(datos).flatMap(([letra, vecs]) => vecs.map((vec) => ({ letra, vec })));
  }

  // Mantiene la copia en memoria al día cuando otra página (p. ej. importar) guarda cambios.
  chrome.storage.onChanged.addListener((cambios, area) => {
    if (area === 'local' && cambios[CLAVE]) datos = cambios[CLAVE].newValue || {};
  });

  return { cargar, agregarVarias, reemplazarLetra, borrarLetra, contar, todas };
})();
