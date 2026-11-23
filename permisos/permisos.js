// Solicita cámara y micrófono en una pestaña normal de la extensión.
// El permiso concedido aquí también aplica al panel lateral (mismo origen).

const estado = document.getElementById('estado');

// Muestra un mensaje; esError cambia el color.
function mostrar(mensaje, esError) {
  estado.textContent = mensaje;
  estado.className = esError ? 'error' : '';
}

// Pide los permisos y libera los dispositivos inmediatamente.
async function solicitar() {
  try {
    const flujo = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    flujo.getTracks().forEach((pista) => pista.stop());
    mostrar('¡Listo! Ya puedes cerrar esta pestaña y abrir HandSync desde el ícono.', false);
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      mostrar('Permiso denegado. Haz clic en el candado de la barra de direcciones, elige "Permitir" para cámara y micrófono y vuelve a intentarlo.', true);
    } else if (e.name === 'NotFoundError') {
      mostrar('No se encontró una cámara o un micrófono conectado.', true);
    } else {
      mostrar('No se pudo acceder a los dispositivos: ' + e.name, true);
    }
  }
}

document.getElementById('btn-permitir').addEventListener('click', solicitar);
solicitar(); // al abrir la pestaña, lanza la solicitud automáticamente
