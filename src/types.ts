export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_ANON_KEY: string;
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
  ical_url: string | null;
  created_at: string;
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
