// Service worker de HandSync: abre el panel y la página de permisos.

const URL_PANEL = 'sidepanel/sidepanel.html';

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  // Chrome: el clic en el ícono abre el panel lateral.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.error('HandSync: no se pudo configurar el panel', e));
} else {
  // Respaldo (p. ej. Brave sin API sidePanel): abre el mismo panel en una ventana angosta.
  chrome.action.onClicked.addListener(() => {
    chrome.windows.create({
      url: chrome.runtime.getURL(URL_PANEL),
      type: 'popup',
      width: 380,
      height: 760
    });
  });
}

// Al instalar, abre la pestaña donde se piden cámara y micrófono
// (getUserMedia no puede mostrar la solicitud dentro del panel lateral).
chrome.runtime.onInstalled.addListener((detalles) => {
  if (detalles.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('permisos/permisos.html') });
  }
});
