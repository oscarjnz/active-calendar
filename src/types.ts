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
}

export interface IcalEvent {
  uid: string;
  summary: string;
  course: string | null; // nombre legible del curso si se pudo derivar
  courseCode: string | null; // código normalizado (ej. "TI3631") si se pudo derivar
  isSession: boolean; // true = clase/sesión (trae curso), false = tarea/entrega
  due: Date | null;
  url: string | null;
  lastModified: Date | null;
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
  notify_dow: number; // día de la semana elegido para el envío (1=Lun..7=Dom)
  notify_time: string; // hora local SDQ "HH:MM" elegida por el usuario para el envío
  last_emailed: string | null; // ISO del último correo enviado (anti-duplicados)
  telegram_chat_id: string | null; // chat de Telegram vinculado (null = sin vincular)
  telegram_notify: boolean; // recibir el recordatorio semanal por Telegram
  telegram_link_code: string | null; // código temporal de un solo uso para vincular
  last_telegram: string | null; // ISO del último mensaje de Telegram (anti-duplicados)
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
