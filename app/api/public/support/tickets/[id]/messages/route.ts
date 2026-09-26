import { NextResponse } from "next/server";
import { requireSupportServiceSecret } from "@/lib/api/support-service-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  resolveClientCompanyByRemoteId,
  getActiveStaffEmails,
} from "@/lib/api/support";
import { sendEmail } from "@/lib/notifications/email";
import { buildStaffNotificationEmail } from "@/lib/notifications/support-email";
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

// Mensaje de seguimiento del cliente en un ticket propio, desde "Mis
// consultas" en rendi-platform. Si el ticket estaba "resuelto" vuelve a
// "abierto": un mensaje nuevo del cliente significa que hace falta
// mirarlo de nuevo.
export async function POST(request: Request, { params }: RouteParams) {
  const authError = requireSupportServiceSecret(request);
  if (authError) return authError.response;

  const { id } = await params;

  let body: {
    environment?: unknown;
    remote_company_id?: unknown;
    remote_profile_id?: unknown;
    body?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  const environment = body.environment;
  const remoteCompanyId =
    typeof body.remote_company_id === "string" ? body.remote_company_id : "";
  const remoteProfileId =
    typeof body.remote_profile_id === "string" ? body.remote_profile_id : "";
  const messageBody = typeof body.body === "string" ? body.body.trim() : "";

  if (!isValidEnvironment(environment) || !remoteCompanyId || !remoteProfileId) {
    return NextResponse.json(
      { success: false, error: "Faltan parámetros o son inválidos." },
      { status: 400 }
    );
  }

  if (!messageBody) {
    return NextResponse.json(
      { success: false, error: "El mensaje no puede estar vacío." },
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

  const { data: ticket, error: ticketError } = await supabaseAdmin
    .from("support_tickets")
    .select("id, ticket_number, status, requester_name")
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

  const { data: message, error: messageError } = await supabaseAdmin
    .from("support_ticket_messages")
    .insert({
      ticket_id: id,
      sender_type: "cliente",
      sender_name: ticket.requester_name,
      body: messageBody,
    })
    .select(
      "id, sender_type, sender_name, body, attachment_url, attachment_filename, created_at"
    )
    .single();

  if (messageError || !message) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo guardar el mensaje: ${
          messageError?.message || "error desconocido"
        }`,
      },
      { status: 500 }
    );
  }

  const updates: Record<string, unknown> = {
    last_activity_at: new Date().toISOString(),
  };
  if (ticket.status === "resuelto") {
    updates.status = "abierto";
  }

  await supabaseAdmin.from("support_tickets").update(updates).eq("id", id);

  // Se espera el envío (ver el comentario equivalente en
  // tickets/route.ts): en Vercel, una promesa sin awaitear puede cortarse
  // apenas se devuelve la respuesta y el mail nunca sale.
  const staffEmails = await getActiveStaffEmails();
  if (staffEmails.length > 0) {
    const notification = buildStaffNotificationEmail({
      kind: "new_message",
      ticketNumber: ticket.ticket_number,
      companyName: company.name,
      requesterName: ticket.requester_name,
      messageBody,
    });

    await sendEmail({
      to: staffEmails,
      subject: notification.subject,
      text: notification.text,
      html: notification.html,
      idempotencyKey: `support-new-message:${message.id}`,
    });
  }

  return NextResponse.json({ success: true, message });
}
