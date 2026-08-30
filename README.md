# Rendix — Backend interna

Herramienta de uso exclusivo del equipo de Rendix para dar de alta empresas
clientes y sus usuarios. **No es parte de la app que usan los clientes** —
vive en un repo y un deploy separados a propósito, para que un problema acá
nunca pueda comprometer los datos de un cliente, y viceversa.

## Qué hace (v1)

- Login del staff con Google, restringido al dominio de Workspace de Rendix.
- Alta de empresas cliente.
- Alta de usuarios dentro de una empresa (nombre, apellido editable, rol,
  permisos, método de acceso), incluida la invitación por mail para cuentas
  de email/contraseña.
- Activar/desactivar usuarios.

Los puntos de alta/edición de usuarios todavía no están construidos en este
scaffold inicial — el login y el esqueleto del dashboard ya están andando.

## Cómo está armado

Esta app tiene **su propio proyecto de Supabase**, separado de los 4
entornos de Rendix (Producción/Desarrollo/Testing/Presales). Ese Supabase
propio solo guarda una tabla, `staff_users` — quién del equipo puede entrar.

Para dar de alta empresas/usuarios en un entorno cliente, esta backend se
conecta *hacia afuera* a ese Supabase (con su service role key, ver
`lib/environments.ts` y `.env.example`) — no hay datos de clientes
guardados acá.

## Setup para levantarlo por primera vez

1. **Creá un proyecto de Supabase nuevo**, solo para esta backend (Project
   Settings → API te da la URL y las keys).
2. Corré la migración `supabase/migrations/00000000000000_staff_users.sql`
   en el SQL Editor de ese proyecto.
3. Insertá tu propio usuario en `staff_users` una vez que hagas el primer
   login (necesitás tu `id` de `auth.users`, igual que hicimos con Rendix).
4. **Creá una app de Google Cloud nueva** (recomendado: separada de la que
   usa Rendix cliente, por el mismo motivo de aislamiento) y configurala
   como proveedor `google` en Authentication → Providers de este Supabase.
5. Copiá `.env.example` a `.env.local` y completá los valores.
6. `npm install && npm run dev`.

## Stack

Next.js (App Router) + TypeScript + Tailwind + Supabase — misma base que
`rendi-platform`, a propósito, para que resulte familiar.
