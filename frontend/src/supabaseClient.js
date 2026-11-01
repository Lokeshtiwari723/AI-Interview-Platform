import { createClient } from "@supabase/supabase-js";

/*
  Supabase connection.
  The two values come from  frontend/.env  :

    VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key

  (the older name VITE_SUPABASE_ANON_KEY works too)
  Only the public "publishable / anon" key goes here, never the "service_role" key.
*/

const url =
    import.meta.env.VITE_SUPABASE_URL;
const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY;

// false when .env is missing, so the app can show a clear message
export const supabaseReady = Boolean(url && key);

export const supabase = createClient(
    url || "https://placeholder.supabase.co",
    key || "placeholder-key"
);