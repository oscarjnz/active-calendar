export interface Env {
  // Supabase (solo lo usa el Worker; nunca llega al navegador).
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  // Clerk.
  CLERK_PUBLISHABLE_KEY: string; // pk_... -> publica, va al frontend
  CLERK_SECRET_KEY: string; // sk_... -> secreta, verifica tokens y consulta usuarios
  // URL publica del propio Worker.
  APP_BASE_URL: string;
  // Resend (correo). RESEND_API_KEY es secreta; RESEND_FROM es opcional.
  RESEND_API_KEY: string; // re_... -> secreta, autentica el envío de correos
  RESEND_FROM?: string; // remitente, ej. "Active Calendar <recordatorios@activecalendar.site>"
  // Telegram (bot). TOKEN y WEBHOOK_SECRET son secretos; BOT_USERNAME es público.
  TELEGRAM_BOT_TOKEN?: string; // secreto: autentica las llamadas a la Bot API
  TELEGRAM_WEBHOOK_SECRET?: string; // secreto: valida que el webhook viene de Telegram
  TELEGRAM_BOT_USERNAME?: string; // público: usuario del bot para el enlace t.me (sin @)
  // Fuente académica externa: JSON con host, rutas y campos (ver academic.ts). SECRETO:
  // el repo es público, nada de esto puede vivir en el código.
  ACADEMIC_SOURCE?: string;
}

export interface IcalEvent {
  uid: string;
  summary: string;
  course: string | null; // nombre legible del curso si se pudo derivar
  courseCode: string | null; // código normalizado (ej. "TI3631") si se pudo derivar
  isSession: boolean; // true = clase/sesión (trae curso), false = tarea/entrega
  start: Date | null; // DTSTART: solo se usa en las sesiones, para armar el horario semanal
  due: Date | null;
  url: string | null;
  lastModified: Date | null;
}

/**
 * Un bloque de clase del horario semanal. Puede venir de dos sitios: de las sesiones del
 * iCal (solo materia, día y hora) o de la fuente académica, que además trae profesor y
 * sección. Por eso `teacher` y `section` son opcionales: nunca asumir que están.
 */
export interface ClassSlot {
  code: string; // código normalizado de la materia
  name: string; // nombre legible
  day: number; // 0=Lun .. 6=Dom, en hora de Santo Domingo
  start: string; // "HH:MM" SDQ
  end: string; // "HH:MM" SDQ
  teacher?: string; // solo de la fuente académica
  room?: string; // aula; solo de la fuente académica, y no siempre viene completa
  section?: string; // solo de la fuente académica
  // De dónde salió. Hace falta al fusionar: la fuente académica se consulta con throttle de
  // 12 h y el iCal en cada sync, así que sin esta marca un tick sin consulta académica
  // borraría los bloques buenos y los sustituiría por los del feed. Las filas viejas no la
  // traen y se tratan como 'ical'.
  src?: 'academic' | 'ical';
}

/** Materia matriculada por el estudiante (código + nombre legible). */
export interface Course {
  code: string; // normalizado, ej. "TI3631"
  name: string; // nombre legible, ej. "Proyecto Integrador II"
}

export interface Profile {
  user_id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
  ical_url: string | null;
  accent: string;
  term: number | null; // cuatrimestre/semestre actual (1-12)
  courses: Course[]; // materias seleccionadas + autodescubiertas
  email_notify: boolean; // recibir el recordatorio semanal por correo
  new_task_alerts: boolean; // avisar al instante cuando hay tareas nuevas (además del resumen semanal)
  notify_dow: number; // día de la semana elegido para el envío (1=Lun..7=Dom)
  notify_time: string; // hora local SDQ "HH:MM" elegida por el usuario para el envío
  last_emailed: string | null; // ISO del último correo enviado (anti-duplicados)
  telegram_chat_id: string | null; // chat de Telegram vinculado (null = sin vincular)
  telegram_notify: boolean; // recibir el recordatorio semanal por Telegram
  telegram_link_code: string | null; // código temporal de un solo uso para vincular
  last_telegram: string | null; // ISO del último mensaje de Telegram (anti-duplicados)
  completed_courses: string[]; // códigos de materias ya aprobadas (acumulado entre cuatrimestres)
  term_block_id: string | null; // id de bloque ("YYYY-B") para el que term/courses ya está al día
  weeks_ahead: number; // cuántas semanas (incl. la actual) mostrar/sincronizar (1-15)
  rhythm_chart: string; // estilo del gráfico "Ritmo de entregas": 'bars' | 'heatmap' | 'stacked' | 'chips'
  student_id: string | null; // matrícula; se fija una sola vez en el onboarding y no se puede cambiar
  student_email: string | null; // correo institucional verificado al fijar la matrícula
  academic_synced_at: string | null; // ISO de la última consulta a la fuente académica (throttle)
  schedule: ClassSlot[]; // horario semanal (fuente académica si la hay, iCal de respaldo)
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  user_id: string;
  uid: string;
  summary: string;
  course: string | null;
  course_code: string | null; // materia asignada (manual o derivada), normalizada
  due: string | null;
  url: string | null;
  status: 'pending' | 'done';
  last_modified: string | null;
  first_seen: string;
  last_seen: string;
}

export interface Delta {
  created: IcalEvent[];
  modified: IcalEvent[];
  unchanged: IcalEvent[];
}
