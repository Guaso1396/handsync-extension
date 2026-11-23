// Configuración única de HandSync. Todo lo ajustable se cambia SOLO aquí.
const HS_CONFIG = {
  // Reglas de reconocimiento de señas
  UMBRAL_CONFIANZA: 0.85,   // confianza mínima para aceptar una letra
  TIEMPO_ESTABLE_MS: 1000,  // tiempo que la misma letra debe mantenerse
  CLASE_VACIA: 'Nada',      // "no hay seña": nunca se agrega al texto

  // Abecedario (27 letras)
  LETRAS: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','Ñ','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
  // Letras con movimiento: no se reconocen con fotos fijas (se omiten al importar; paso 2)
  LETRAS_DINAMICAS: ['J', 'Z', 'Ñ'],
  // Letras que tienen imagen de referencia en img/senas/<LETRA>.<EXT_SENAS>
  LETRAS_CON_IMAGEN: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','Ñ','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
  EXT_SENAS: 'jpg',

  // Clasificador de la mano (vecinos más cercanos)
  K_VECINOS: 5,             // cuántas muestras vecinas votan
  DISTANCIA_MAX: 2.0,       // si la mano se parece menos que esto a cualquier muestra → "Nada". AJUSTAR con pruebas
  MUESTRAS_POR_CAPTURA: 20, // muestras que guarda el botón "Capturar"

  // Voz: se intenta es-CO y, si no está disponible, es-ES
  IDIOMAS_VOZ: ['es-CO', 'es-ES'],
  // Motor de voz → texto: 'auto' (Google si funciona; si no, el local), 'local' (siempre el local)
  MOTOR_VOZ: 'auto',
  // Calidad de la voz local: 'rapida' (más veloz, menos precisa) o 'precisa' (más lenta). Se cambia desde el panel.
  CALIDAD_VOZ: 'precisa',
  MODELOS_VOZ: { rapida: 'whisper-base', precisa: 'whisper-small' }, // carpetas dentro de lib/modelos/
  VAD_UMBRAL: 0.012,                   // volumen mínimo para considerar que hay voz
  VAD_PAUSA_S: 0.6,                    // segundos de silencio que cierran una frase
  VAD_MIN_HABLA_S: 0.5,                // frases más cortas se descartan (ruidos)
  VAD_MAX_S: 8,                        // duración máxima de una frase

  // Rutas locales dentro de la extensión
  RUTA_MEDIAPIPE: 'lib/mediapipe/',
  MODELO_MANO: 'lib/mediapipe/hand_landmarker.task',
  RUTA_TRANSFORMERS: 'lib/transformers/',
  RUTA_MODELOS_VOZ: 'lib/modelos/',
  RUTA_SENAS: 'img/senas/',
  RUTA_PERMISOS: 'permisos/permisos.html',
  RUTA_IMPORTAR: 'importar/importar.html'
};
