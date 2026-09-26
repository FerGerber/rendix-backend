import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { withSupportAttachmentUrls } from "@/lib/api/support";
import {
  SUPPORT_TICKET_STATUSES,
  type SupportTicketStatus,
} from "@/lib/support/constants";

type RouteParams = { params: Promise<{ id: string }> };

function isValidStatus(value: unknown): value is SupportTicketStatus {
  return (
    typeof value === "string" &&
    SUPPORT_TICKET_STATUSES.some((s) => s.value === value)
  );
}

// Detalle de un ticket: el hilo completo (incluidas las notas internas,
// esta ruta es solo para el staff) + caja de respuesta + estado, ver la
// propuesta "Sistema de soporte" del 2026-09-18.
export async function GET(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const { data: ticket, error: ticketError } = await supabaseAdmin
    .from("support_tickets")
    .select(
      "id, ticket_number, company_id, requester_name, requester_email, category, context_screen, status, last_activity_at, created_at, company:client_companies(name)"
    )
    .eq("id", id)
    .single();

  if (ticketError || !ticket) {
    return NextResponse.json(
      { success: false, error: "No se encontró el ticket." },
      { status: 404 }
    );
  }

  const { data: messages, error: messagesError } = await supabaseAdmin
    .from("support_ticket_messages")
    .select(
      "id, sender_type, sender_name, body, is_internal_note, attachment_url, attachment_filename, created_at"
    )
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json(
      {
        success: false,
        error: `Error cargando el hilo: ${messagesError.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    ticket,
    messages: await withSupportAttachmentUrls(messages || []),
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  if (!isValidStatus(body.status)) {
    return NextResponse.json(
      { success: false, error: "El estado indicado no es válido." },
      { status: 400 }
    );
  }

  const { data: updated, error } = await supabaseAdmin
    .from("support_tickets")
    .update({
      status: body.status,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(
      "id, ticket_number, company_id, requester_name, requester_email, category, context_screen, status, last_activity_at, created_at"
    )
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { success: false, error: "No se encontró el ticket." },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, ticket: updated });
}
