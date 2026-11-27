// Configuración única de HandSync. Todo lo ajustable se cambia SOLO aquí.
const HS_CONFIG = {
  // Reglas de reconocimiento de señas
  UMBRAL_CONFIANZA: 0.85,   // confianza mínima para aceptar una letra
  TIEMPO_ESTABLE_MS: 180,   // lectura rápida: la letra se escribe a los 0,18 s de verse clara (antes 1000). Más alto = menos errores, más lento
  CLASE_VACIA: 'Nada',      // "no hay seña": nunca se agrega al texto

  // Abecedario (27 letras)
  LETRAS: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','Ñ','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
  // Letras con movimiento: no se reconocen con fotos fijas (se omiten al importar; paso 2)
  // Todas las letras del abecedario se enseñan como FOTO (letra quieta). Solo las palabras van con movimiento.
  // (Si algún día quieres una letra con movimiento, agrégala aquí, por ejemplo ['J'].)
  LETRAS_DINAMICAS: [],
  // Letras que tienen imagen de referencia en img/senas/<LETRA>.<EXT_SENAS>
  LETRAS_CON_IMAGEN: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','Ñ','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
  EXT_SENAS: 'jpg',

  // Clasificador de la mano (vecinos más cercanos)
  K_VECINOS: 5,             // cuántas muestras vecinas votan
  DISTANCIA_MAX: 2.0,       // si la mano se parece menos que esto a cualquier muestra → "Nada". AJUSTAR con pruebas
  MUESTRAS_POR_CAPTURA: 20, // muestras que guarda el botón "Capturar"

  // Margen entre la 1.ª y la 2.ª letra más parecida: si es menor, se duda ("N o M?") y no se agrega
  MARGEN_ESTATICO: 0.08,

  // Cuerpo y cara (MediaPipe Pose + Face). Se pueden apagar desde el panel por rendimiento.
  MODELO_POSE: 'lib/mediapipe/pose_landmarker_lite.task',
  MODELO_CARA: 'lib/mediapipe/face_landmarker.task',
  USAR_CUERPO: true,
  USAR_CARA: true,
  // Blendshapes de la cara que se usan como rasgos (expresión)
  BLENDSHAPES: ['browInnerUp', 'browDownLeft', 'browDownRight', 'browOuterUpLeft', 'browOuterUpRight',
    'jawOpen', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight', 'cheekPuff', 'eyeBlinkLeft', 'eyeBlinkRight'],
  // Peso de cada grupo en la comparación de secuencias
  PESOS_RASGOS: { mano: 1.0, posicion: 1.5, cuerpo: 0.8, cara: 1.2 },

  // Señas con movimiento (secuencias comparadas con DTW)
  MOV_UMBRAL: 0.035,        // energía de movimiento que inicia un gesto. AJUSTAR con la cámara real
  MOV_FACTOR_RUIDO: 3,      // el umbral de movimiento sube a (temblor medido de la cámara × este factor)
  MOV_VENTANA_RUIDO: 40,    // fotogramas recientes con los que se mide el temblor
  MOV_QUIETO_MS: 300,       // quietud que cierra un gesto (antes 400): pausa corta entre señas
  SEQ_MIN_MS: 400,          // gestos más cortos se descartan
  SEQ_MAX_MS: 4000,         // duración máxima de un gesto
  SEQ_LARGO: 32,            // fotogramas a los que se lleva cada secuencia para comparar
  DTW_BANDA: 8,             // tolerancia de desfase temporal (fotogramas)
  DTW_DIST_MAX: 0.9,        // distancia máxima para aceptar una seña. AJUSTAR (la consola muestra cada distancia)
  DTW_MARGEN: 0.05,         // diferencia mínima con la 2.ª seña más parecida
  K_SEQ: 3,                 // vecinos que votan al reconocer un gesto
  TOMA_MS: 3000,            // duración de cada toma grabada
  CUENTA_ATRAS_S: 3,        // cuenta atrás antes de grabar
  // Letra con movimiento → letra estática que se confunde con ella (se reemplaza si ya se agregó)
  BASE_DINAMICA: { 'Ñ': 'N', 'J': 'I', 'Z': 'D' },
  VENTANA_REEMPLAZO_MS: 1500,
  REPETICION_MIN_MS: 3000,  // la misma seña con movimiento no se repite antes de este tiempo
  BLOQUEO_TRAS_MOV_MS: 700, // (antes 1200) tras un gesto no se agregan letras estáticas (evita que la pose final cuente como letra)
  PESO_ANGULOS: 0.5,         // peso de los ángulos de los dedos al comparar letras (0 = solo los 63 puntos)

  // Velocidad de la cámara
  CICLO_MIN_MS: 50,         // lecturas de la cámara: hasta ~20 por segundo (antes ~10 con espera fija de 100 ms)
  PASO_MOV_MS: 90,          // cada cuánto se alimenta el detector de movimiento y las tomas (~10/s, igual que los videos importados)
  CARA_CADA: 3,             // la cara se lee 1 de cada N lecturas (es el modelo más pesado)
  MANO_CONFIANZA_MIN: 0.6,  // confianza mínima para aceptar una mano (evita manos "fantasma")
  // Zona de señas: solo se reconocen manos levantadas frente al cuerpo (no las que descansan abajo)
  ZONA_SENAS: true,
  ZONA_ABAJO: 1.6,          // límite inferior: hombros + N anchos de hombro hacia abajo (más grande = zona más baja)
  // Voz: se intenta es-CO y, si no está disponible, es-ES
  IDIOMAS_VOZ: ['es-CO', 'es-ES'],
  // Motor de voz → texto: 'auto' (Google si funciona; si no, el local), 'local' (siempre el local)
  MOTOR_VOZ: 'auto',
  // Calidad de la voz local: 'rapida' (más veloz, menos precisa) o 'precisa' (más lenta). Se cambia desde el panel.
  CALIDAD_VOZ: 'rapida', // 'rapida' viene incluida en GitHub; 'precisa' hay que agregarla aparte (ver README)
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
