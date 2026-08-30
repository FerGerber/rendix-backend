import { createClient } from "@supabase/supabase-js";

// Proyecto de Supabase PROPIO de esta backend interna, separado del/de los
// proyectos de Supabase que usan los clientes de Rendix. Nunca debe apuntar
// al mismo proyecto que la app cliente-facing: si algo se compromete acá,
// no tiene por qué comprometer los datos de ningún cliente, y viceversa.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
