export interface Env {
  // Supabase (solo lo usa el Worker; nunca llega al navegador).
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  // Clerk.
  CLERK_PUBLISHABLE_KEY: string; // pk_... -> publica, va al frontend
  CLERK_SECRET_KEY: string; // sk_... -> secreta, verifica tokens y consulta usuarios
  // URL publica del propio Worker.
  APP_BASE_URL: string;
}

export interface IcalEvent {
  uid: string;
  summary: string;
  course: string | null;
  due: Date | null;
  url: string | null;
  lastModified: Date | null;
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
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  user_id: string;
  uid: string;
  summary: string;
  course: string | null;
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
