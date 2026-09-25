import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/notifications/email";
import { buildClientReplyEmail } from "@/lib/notifications/support-email";

type RouteParams = { params: Promise<{ id: string }> };

// Respuesta del staff (o nota interna) dentro del hilo de un ticket. Las
// notas internas no le avisan al cliente por mail — son para dejar
// contexto entre respuestas, nunca visibles del otro lado (ver la
// propuesta "Sistema de soporte" del 2026-09-18).
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const { data: ticket, error: ticketError } = await supabaseAdmin
    .from("support_tickets")
    .select("id, ticket_number, requester_email, requester_name")
    .eq("id", id)
    .single();

  if (ticketError || !ticket) {
    return NextResponse.json(
      { success: false, error: "No se encontró el ticket." },
      { status: 404 }
    );
  }

  let body: { body?: unknown; is_internal_note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 }
    );
  }

  const messageBody = typeof body.body === "string" ? body.body.trim() : "";
  const isInternalNote = body.is_internal_note === true;

  if (!messageBody) {
    return NextResponse.json(
      { success: false, error: "El mensaje no puede estar vacío." },
      { status: 400 }
    );
  }

  const senderName = auth.staff.full_name || auth.staff.email;

  const { data: message, error: messageError } = await supabaseAdmin
    .from("support_ticket_messages")
    .insert({
      ticket_id: id,
      sender_type: "staff",
      sender_staff_id: auth.staff.id,
      sender_name: senderName,
      body: messageBody,
      is_internal_note: isInternalNote,
    })
    .select(
      "id, sender_type, sender_name, body, is_internal_note, attachment_url, attachment_filename, created_at"
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

  await supabaseAdmin
    .from("support_tickets")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", id);

  let emailStatus: string = "skipped";
  if (!isInternalNote) {
    const clientEmail = buildClientReplyEmail({
      requesterName: ticket.requester_name,
      ticketNumber: ticket.ticket_number,
      messageBody,
    });

    const emailResult = await sendEmail({
      to: [ticket.requester_email],
      subject: clientEmail.subject,
      text: clientEmail.text,
      html: clientEmail.html,
      idempotencyKey: `support-reply:${message.id}`,
    });

    emailStatus = emailResult.status;
  }

  return NextResponse.json({
    success: true,
    message,
    email_status: emailStatus,
  });
}
