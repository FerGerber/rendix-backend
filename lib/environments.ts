// Los entornos de la app CLIENTE de Rendix (Producción, Desarrollo, Testing,
// Presales) todavía no existen todos — hoy solo hay uno. Esta lista es el
// lugar donde, cuando armemos los otros 3, vamos a cargar las credenciales
// de servicio de cada proyecto de Supabase para que esta backend pueda
// elegir a qué entorno da de alta una empresa/usuario nuevo.
//
// A propósito, esto NO usa NEXT_PUBLIC_*: las credenciales de servicio de
// cada entorno cliente son secretas y solo se usan del lado del servidor
// (rutas /api de esta backend), nunca llegan al browser.
export const RENDIX_CLIENT_ENVIRONMENTS = [
  "production",
  "presales",
  "testing",
  "development",
] as const;

export type RendixClientEnvironment =
  (typeof RENDIX_CLIENT_ENVIRONMENTS)[number];

export const RENDIX_CLIENT_ENVIRONMENT_LABELS: Record<
  RendixClientEnvironment,
  string
> = {
  production: "Producción",
  presales: "Presales",
  testing: "Testing",
  development: "Desarrollo",
};
