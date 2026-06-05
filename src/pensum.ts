// Catálogo del pensum de Ingeniería en Tecnologías Computacionales (UNIBE).
// Mapea el código normalizado (sin guion, mayúsculas) -> { name, sem }.
// Sirve para: (1) mostrar nombres bonitos de materia, (2) poblar el selector de
// materias en onboarding/ajustes. Las electivas concretas (ej. TI3712 Criptografía)
// NO están aquí; esas se autodescubren del feed (eventos de clase traen código+nombre).

export interface PensumCourse {
  code: string;
  name: string;
  sem: number; // semestre/cuatrimestre sugerido (1-12)
  elective?: boolean; // true = electiva (no es materia obligatoria del cuatrimestre)
  concentration?: string; // etiqueta de la concentración (solo electivas)
}

// Nombres en Title Case para una UI más cuidada.
const RAW: Array<[string, string, number, boolean?, string?]> = [
  // Semestre 1
  ['EGC153', 'Pre-Cálculo', 1],
  ['EGC160', 'Química General I', 1],
  ['EGL122', 'Taller de Comunicación', 1],
  ['EGL301', 'Inglés I', 1],
  ['EGS110', 'Procesos Históricos y Construcción del Colectivo Social', 1],
  ['EGV130', 'Taller Calidad de Vida', 1],
  ['TI3120', 'Introducción a la Ingeniería y Tecnologías Computacionales', 1],
  ['UNB100', 'Orientación Universitaria', 1],
  ['AD8110', 'Gestión Empresarial', 1],
  // Semestre 2
  ['EGC154', 'Cálculo I', 2],
  ['EGL120', 'Comunicación I', 2],
  ['EGL302', 'Inglés II', 2],
  ['EGS111', 'Análisis de la Realidad Dominicana en un Mundo Global', 2],
  ['EGV131', 'Ambiente y Sustentabilidad', 2],
  ['TI3110', 'Matemáticas Discretas', 2],
  ['TI3121', 'Comunicación de Datos', 2],
  ['UNB101', 'Pensamiento y Acción Emprendedora', 2],
  // Semestre 3
  ['EGC155', 'Cálculo II', 3],
  ['EGC156', 'Álgebra Lineal y Matricial', 3],
  ['EGC170', 'Física General I', 3],
  ['EGL121', 'Comunicación II', 3],
  ['EGL303', 'Inglés III', 3],
  ['TI3111', 'Fundamentos de Programación', 3],
  // Semestre 4
  ['EGC252', 'Cálculo Vectorial', 4],
  ['EGC270', 'Física General II', 4],
  ['EGL304', 'Inglés IV', 4],
  ['TI3210', 'Lógica Matemática', 4],
  ['TI3211', 'Estructura de Datos', 4],
  ['UNB200', 'Metodología de la Investigación', 4],
  ['UNB202', 'Estadística', 4],
  // Semestre 5
  ['EGC253', 'Ecuaciones Diferenciales', 5],
  ['EGC255', 'Inferencia Estadística', 5],
  ['EGC271', 'Física General III', 5],
  ['EGL220', 'Electiva Comunicación, Lengua y Cultura', 5],
  ['TI3212', 'Análisis y Diseño de Algoritmos', 5],
  ['TI3213', 'Programación I', 5],
  ['TI3630', 'Proyecto Integrador I', 5],
  // Semestre 6
  ['EGC254', 'Métodos Matemáticos', 6],
  ['EGH140', 'Bloque de Artes y Humanidades', 6],
  ['IG1330', 'Ingeniería Económica', 6],
  ['TI3214', 'Programación II', 6],
  ['TI3215', 'Diseño y Administración de Bases de Datos', 6],
  ['TI3220', 'Electrónica', 6],
  ['TI3600', 'Práctica Estudiantil', 6],
  ['UNB102', 'Liderazgo y Acción Social', 6],
  // Semestre 7
  ['II4212', 'Investigación de Operaciones I', 7],
  ['II4440', 'Formulación y Evaluación de Proyectos', 7],
  ['TI3310', 'Teoría de Autómatas y Compiladores', 7],
  ['TI3311', 'Análisis y Diseño de Sistemas', 7],
  ['TI3320', 'Circuitos Digitales', 7],
  ['TI3321', 'Fundamentos de Ciberseguridad', 7],
  ['TI3322', 'Conmutación y Enrutamiento', 7],
  // Semestre 8
  ['AD8120', 'Taller de Creatividad e Innovación', 8],
  ['AD8130', 'Contabilidad Financiera I', 8],
  ['TI3312', 'Aseguramiento de la Calidad del Software', 8],
  ['TI3313', 'Ingeniería de Software', 8],
  ['TI3314', 'Inteligencia Artificial', 8],
  ['TI3323', 'Arquitectura del Computador', 8],
  ['TI3324', 'Leyes y Regulaciones de TI', 8],
  // Semestre 9
  ['TI3315', 'Arquitectura de Software', 9],
  ['TI3316', 'Minería y Análisis de Datos', 9],
  ['TI3325', 'Diseño y Planificación de Redes', 9],
  ['TI3326', 'Sistemas Operativos', 9],
  ['TI3631', 'Proyecto Integrador II', 9],
  // Semestre 10
  ['TI3410', 'Ingeniería de Factores Humanos', 10],
  ['TI3420', 'Infraestructura Tecnológica', 10],
  ['TI3430', 'Administración de Riesgos y Controles de TI', 10],
  // Semestre 11
  ['AD8220', 'Taller de Creatividad e Innovación para los Negocios', 11],
  ['TI3610', 'Pasantía', 11],
  ['TI3620', 'Proyecto Final I', 11],
  ['UNB201', 'Ética', 11],
  // Semestre 12
  ['TI3431', 'Negocios Electrónicos', 12],
  ['TI3432', 'Gestión de Proyectos de TI', 12],
  ['TI3433', 'Auditoría de TI', 12],
  ['TI3621', 'Proyecto Final II', 12],
  // ─── Electivas por concentración (pensum TI3, periodo 2026-3) ───
  // No están atadas a un solo cuatrimestre: se agrupan por concentración en el
  // selector. El sem es el sugerido por el pensum; se marcan elective:true.
  // Concentración: Gestión de Software
  ['TI3701', 'Desarrollo de Aplicaciones de Dispositivos Móviles', 9, true, 'Gestión de Software'],
  ['TI3711', 'Programación Paralela y Distribuida', 9, true, 'Gestión de Software'],
  ['TI3501', 'Tendencias en Desarrollo de Software', 10, true, 'Gestión de Software'],
  ['TI3511', 'Inteligencia en Ciencia de Datos', 10, true, 'Gestión de Software'],
  ['TI3521', 'Ingeniería de Software en Tiempo Real', 11, true, 'Gestión de Software'],
  ['TI3531', 'Seguridad en Sistemas de Desarrollo de Software', 11, true, 'Gestión de Software'],
  // Concentración: Gestión de Ciberseguridad
  ['TI3702', 'Malware y Vulnerabilidades', 9, true, 'Gestión de Ciberseguridad'],
  ['TI3712', 'Criptografía', 9, true, 'Gestión de Ciberseguridad'],
  ['TI3502', 'Gestión Estratégica de Ciberseguridad', 10, true, 'Gestión de Ciberseguridad'],
  ['TI3512', 'Ethical Hacking', 10, true, 'Gestión de Ciberseguridad'],
  ['TI3522', 'Recuperación de Desastres y Manejo de Incidentes', 11, true, 'Gestión de Ciberseguridad'],
  ['TI3532', 'Análisis Forense', 11, true, 'Gestión de Ciberseguridad'],
  // Concentración en Emprendimiento (abierta a todas las carreras)
  ['UNBE01', 'Pensamiento y Acción Emprendedora', 9, true, 'Emprendimiento'],
  ['UNBE02', 'Taller de Creatividad e Innovación para los Negocios', 9, true, 'Emprendimiento'],
  ['UNB303', 'Emprendimiento para la Creación de Nuevos Negocios', 9, true, 'Emprendimiento'],
  ['UNB304', 'Gestión de Nuevos Negocios (Startups)', 9, true, 'Emprendimiento'],
  ['UNB305', 'Intraemprendimiento (Emprendimiento Corporativo)', 9, true, 'Emprendimiento'],
  // Electiva profesional común con otras carreras
  ['IC4525', 'Seminario de Preparación al CAPM-PMI', 9, true, 'Electiva profesional'],
];

export const PENSUM: PensumCourse[] = RAW.map(([code, name, sem, elective, concentration]) => ({ code, name, sem, elective: elective ?? false, concentration: concentration ?? '' }));

const BY_CODE = new Map<string, PensumCourse>(PENSUM.map((c) => [c.code, c]));

/** Normaliza un código: mayúsculas, sin guiones ni espacios. "TI3-631" -> "TI3631". */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Nombre del pensum para un código, o null si no está catalogado. */
export function pensumName(code: string): string | null {
  return BY_CODE.get(normalizeCode(code))?.name ?? null;
}
