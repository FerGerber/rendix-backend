// Categorías y estados del sistema de soporte — compartidos por la
// ticketera de rendix-backend (staff) y usados también como referencia
// para el formulario en rendi-platform (ese repo no puede importar este
// archivo directamente, así que sus propias constantes tienen que
// mantenerse iguales a mano). Ver la propuesta "Sistema de soporte" del
// 2026-09-18.
export const SUPPORT_TICKET_CATEGORIES = [
  { value: "rendicion", label: "Problema con una rendición" },
  { value: "adelanto", label: "Problema con un adelanto" },
  { value: "acceso", label: "No puedo ingresar" },
  { value: "otro", label: "Otro" },
] as const;

export type SupportTicketCategory =
  (typeof SUPPORT_TICKET_CATEGORIES)[number]["value"];

export const SUPPORT_TICKET_STATUSES = [
  { value: "abierto", label: "Abierto" },
  { value: "en_progreso", label: "En progreso" },
  { value: "resuelto", label: "Resuelto" },
] as const;

export type SupportTicketStatus =
  (typeof SUPPORT_TICKET_STATUSES)[number]["value"];
