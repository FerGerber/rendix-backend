import { createClient } from "@supabase/supabase-js";

// Cliente server-only para el proyecto de Supabase PROPIO de esta backend,
// usando la service role key (bypassa RLS). Se usa para validar staff_users
// en cada request y para leer/escribir el registro interno
// client_companies. Nunca importar este archivo desde código que corra en
// el browser: la service role key no debe llegar nunca al cliente.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
