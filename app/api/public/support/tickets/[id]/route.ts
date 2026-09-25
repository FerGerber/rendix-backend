import { NextResponse } from "next/server";
import { requireSupportServiceSecret } from "@/lib/api/support-service-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveClientCompanyByRemoteId } from "@/lib/api/support";
import {
  RENDIX_CLIENT_ENVIRONMENTS,
  type RendixClientEnvironment,
} from "@/lib/environments";

type RouteParams = { params: Promise<{ id: string }> };

function isValidEnvironment(
  value: unknown
): value is RendixClientEnvironment {
  return (
    typeof value === "string" &&
    (RENDIX_CLIENT_ENVIRONMENTS as readonly string[]).includes(value)
  );
}

// Hilo completo de un ticket propio, para "Mis consultas" en
// rendi-platform. Las notas internas del staff nunca se incluyen acá —
// son solo para uso interno en rendix-backend.
export async function GET(request: Request, { params }: RouteParams) {
  const authError = requireSupportServiceSecret(request);
  if (authError) return authError.response;

  const { id } = await params;
  const url = new URL(request.url);
  const environment = url.searchParams.get("environment");
  const remoteCompanyId = url.searchParams.get("remote_company_id");
  const remoteProfileId = url.searchParams.get("remote_profile_id");

  if (!isValidEnvironment(environment) || !remoteCompanyId || !remoteProfileId) {
    return NextResponse.json(
      { success: false, error: "Faltan parámetros o son inválidos." },
      { status: 400 }
    );
  }

  const company = await resolveClientCompanyByRemoteId(
    environment,
    remoteCompanyId
  );
  if (!company) {
    return NextResponse.json(
      { success: false, error: "No se encontró el ticket." },
      { status: 404 }
    );
  }

  // El filtro por company_id + remote_profile_id es lo que impide leer el
  // ticket de otra persona: si no matchea alguno de los dos, single()
  // devuelve error y respondemos 404 sin distinguir el motivo.
  const { data: ticket, error: ticketError } = await supabaseAdmin
    .from("support_tickets")
    .select(
      "id, ticket_number, category, context_screen, status, last_activity_at, created_at"
    )
    .eq("id", id)
    .eq("company_id", company.id)
    .eq("remote_profile_id", remoteProfileId)
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
      "id, sender_type, sender_name, body, attachment_url, attachment_filename, created_at"
    )
    .eq("ticket_id", id)
    .eq("is_internal_note", false)
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
    messages: messages || [],
  });
}
