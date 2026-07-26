/**
 * Spanish language pack.
 */

export const STOPWORDS: readonly string[] = [
  // artículos / pronombres / determinantes
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella',
  'yo', 'tú', 'él', 'ella', 'nosotros', 'vosotros', 'ellos', 'ellas',
  'mi', 'tu', 'su', 'mis', 'tus', 'sus', 'nuestro', 'nuestra', 'vuestro', 'vuestra',
  // conjunciones / preposiciones
  'y', 'o', 'pero', 'sino', 'porque', 'pues', 'que', 'como', 'si',
  'de', 'del', 'a', 'al', 'en', 'con', 'sin', 'por', 'para', 'entre', 'sobre', 'bajo',
  'desde', 'hasta', 'hacia', 'según', 'durante', 'mediante',
  // adverbios / sentence starters
  'muy', 'bien', 'mal', 'mejor', 'peor', 'más', 'menos', 'mucho', 'poco', 'demasiado',
  'ahora', 'entonces', 'luego', 'después', 'antes', 'finalmente', 'ya', 'todavía', 'aún',
  'siempre', 'nunca', 'jamás', 'veces', 'quizás', 'acaso', 'casi', 'aproximadamente',
  'todo', 'toda', 'todos', 'todas', 'cada', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma',
  'aquí', 'ahí', 'allí', 'allá', 'dónde', 'cuándo', 'cómo', 'cuánto', 'cuál', 'cuáles',
  'pues', 'así', 'también', 'tampoco', 'además', 'incluso', 'sin', 'embargo',
  'sí', 'no', 'ok', 'gracias', 'hola', 'vale',
  'perfecto', 'exacto', 'correcto', 'justo', 'incorrecto', 'verdadero', 'falso', 'cierto',
  'excelente', 'genial', 'estupendo', 'interesante', 'notable',
  // verbos comunes
  'es', 'son', 'era', 'eran', 'ser', 'sido', 'siendo', 'sea', 'sean', 'fue', 'fueron',
  'ha', 'han', 'había', 'haber', 'habido', 'hay',
  'hace', 'hacen', 'hacer', 'hecho', 'haciendo', 'hice',
  'puede', 'pueden', 'poder', 'podría', 'podrían', 'debe', 'deben', 'deber', 'debería',
  'quiere', 'quieren', 'querer', 'quería', 'querría', 'quisiera',
  've', 'ven', 'ver', 'visto', 'mira', 'mirar',
  'intenta', 'intentan', 'intentar', 'intentado', 'usa', 'usan', 'usar', 'usado', 'usando',
  'empieza', 'empiezan', 'empezar', 'empezado', 'comienza', 'comenzar', 'termina', 'terminado',
  'verifica', 'verificar', 'comprueba', 'comprobar', 'revisa', 'revisar',
  'necesita', 'necesitan', 'necesario', 'necesaria', 'hace', 'falta',
  'parece', 'parecen', 'resulta', 'funciona', 'funcionan', 'va', 'van', 'ir',
  // números / varios
  'uno', 'dos', 'tres', 'primero', 'primera', 'segundo', 'segunda', 'tercero', 'último', 'última',
  'número', 'parte', 'partes', 'modo', 'modos', 'manera', 'maneras', 'forma', 'formas', 'cosa', 'cosas',
  'algo', 'nada', 'alguien', 'nadie', 'cualquiera', 'varios', 'varias',
  'ejemplo', 'ejemplos', 'caso', 'casos', 'tipo', 'tipos', 'clase', 'clases',
  'vs', 'etc', 'ej', 'pág',
];

export const COMMON_WORDS: readonly string[] = [
  'tiempo', 'tiempos', 'día', 'días', 'semana', 'semanas', 'mes', 'meses', 'año', 'años',
  'hoy', 'mañana', 'ayer', 'tarde', 'noche', 'hora', 'horas', 'minuto', 'momento', 'momentos',
  'persona', 'personas', 'hombre', 'mujer', 'gente', 'usuario', 'usuarios', 'cliente', 'clientes',
  'mundo', 'vida', 'mano', 'manos', 'ojo', 'ojos', 'cabeza', 'cara',
  'lugar', 'lugares', 'sitio', 'sitios', 'casa', 'lado', 'lados', 'fin', 'final', 'principio',
  'punto', 'puntos', 'línea', 'líneas', 'zona', 'zonas', 'área', 'áreas', 'nivel', 'niveles',
  'problema', 'problemas', 'cuestión', 'cuestiones', 'razón', 'razones', 'motivo', 'motivos',
  'pregunta', 'preguntas', 'respuesta', 'respuestas', 'idea', 'ideas',
  'nombre', 'nombres', 'palabra', 'palabras', 'texto', 'textos', 'documento', 'documentos',
  'dato', 'datos', 'información', 'valor', 'valores', 'resultado', 'resultados',
  'estado', 'estados', 'situación', 'situaciones', 'forma', 'formas',
  'paso', 'pasos', 'fase', 'fases', 'etapa', 'etapas', 'proceso', 'procesos', 'procedimiento',
  'sistema', 'sistemas', 'modelo', 'modelos', 'modo', 'modos', 'versión', 'versiones',
  'trabajo', 'trabajos', 'tarea', 'tareas', 'proyecto', 'proyectos', 'actividad', 'actividades',
  'cambio', 'cambios', 'modificación', 'modificaciones',
  'error', 'errores', 'aviso', 'avisos', 'advertencia', 'advertencias', 'mensaje', 'mensajes',
  'lista', 'listas', 'elemento', 'elementos', 'entrada', 'entradas', 'ítem', 'ítems',
  'opción', 'opciones', 'ajuste', 'ajustes', 'configuración',
  'prueba', 'pruebas', 'test', 'tests', 'verificación', 'control', 'controles',
  'código', 'códigos', 'fuente', 'fuentes', 'contenido', 'contenidos', 'contexto', 'contextos',
  'memoria', 'memorias', 'búsqueda', 'búsquedas', 'solicitud', 'solicitudes', 'consulta', 'consultas',
  'hecho', 'hechos', 'curso', 'sentido', 'resto', 'arriba', 'abajo', 'dentro', 'fuera',
  'izquierda', 'derecha', 'centro', 'medio', 'mitad', 'entero', 'entera', 'total', 'lleno', 'vacío',
  'abierto', 'cerrado', 'público', 'privado', 'local', 'remoto',
  'defecto', 'actual', 'anterior', 'próximo', 'próxima', 'siguiente', 'siguientes', 'reciente',
];
