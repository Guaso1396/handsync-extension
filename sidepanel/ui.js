// Interfaz del panel: pestañas como atajos a cada sección.
// "Señas → Voz" siempre queda visible (tiene la cámara); las demás secciones
// son plegables (<details>). Al elegir una pestaña se abre su sección, se
// cierran las otras plegables y la vista baja hasta ella.

(() => {
  const pestanas = Array.from(document.querySelectorAll('.pestana'));
  const plegables = Array.from(document.querySelectorAll('details.plegable'));
  const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let aplicando = false;

  const objetivos = (tab) => tab.dataset.objetivo.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean);

  // Marca una pestaña como activa (sin mover la vista).
  function marcar(tab) {
    pestanas.forEach((t) => {
      const activa = t === tab;
      t.setAttribute('aria-selected', String(activa));
      t.tabIndex = activa ? 0 : -1;
    });
  }

  // Activa una pestaña: abre su sección y la muestra.
  function activar(tab, enfocar) {
    marcar(tab);
    const destino = objetivos(tab);
    aplicando = true;
    plegables.forEach((d) => { d.open = destino.includes(d); });
    aplicando = false;
    const primero = destino[0];
    if (primero) primero.scrollIntoView({ behavior: reducir ? 'auto' : 'smooth', block: 'start' });
    if (enfocar) tab.focus();
  }

  pestanas.forEach((tab, i) => {
    tab.addEventListener('click', () => activar(tab, false));
    tab.addEventListener('keydown', (e) => {
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % pestanas.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + pestanas.length) % pestanas.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = pestanas.length - 1;
      if (j === null) return;
      e.preventDefault();
      activar(pestanas[j], true);
    });
  });

  // Si el usuario abre una sección a mano, se marca su pestaña.
  plegables.forEach((d) => {
    d.addEventListener('toggle', () => {
      if (aplicando) return;
      if (d.open) {
        const tab = pestanas.find((t) => objetivos(t).includes(d));
        if (tab) marcar(tab);
      } else if (!plegables.some((x) => x.open)) {
        marcar(pestanas[0]);
      }
    });
  });
})();
