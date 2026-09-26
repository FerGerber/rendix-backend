import { NextResponse } from "next/server";
import { requireSupportServiceSecret } from "@/lib/api/support-service-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  resolveClientCompanyByRemoteId,
  getActiveStaffEmails,
  uploadSupportAttachment,
} from "@/lib/api/support";
import { sendEmail } from "@/lib/notifications/email";
import {
  buildStaffNotificationEmail,
  buildClientTicketConfirmationEmail,
} from "@/lib/notifications/support-email";
import {
  SUPPORT_TICKET_CATEGORIES,
  type SupportTicketCategory,
} from "@/lib/support/constants";
import {
  RENDIX_CLIENT_ENVIRONMENTS,
  type RendixClientEnvironment,
} from "@/lib/environments";

function isValidEnvironment(
  value: unknown
): value is RendixClientEnvironment {
  return (
    typeof value === "string" &&
    (RENDIX_CLIENT_ENVIRONMENTS as readonly string[]).includes(value)
  );
}

function isValidCategory(value: unknown): value is SupportTicketCategory {
  return (
    typeof value === "string" &&
    SUPPORT_TICKET_CATEGORIES.some((c) => c.value === value)
  );
}

function categoryLabel(value: SupportTicketCategory) {
  return (
    SUPPORT_TICKET_CATEGORIES.find((c) => c.value === value)?.label ?? value
  );
}

// Endpoint público (servicio-a-servicio) para que rendi-platform liste
// los tickets propios de un usuario — nunca lo llama el browser directo,
// ver lib/api/support-service-auth.ts.
export async function GET(request: Request) {
  const authError = requireSupportServiceSecret(request);
  if (authError) return authError.response;

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
      { success: false, error: "No se encontró la empresa." },
      { status: 404 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("support_tickets")
    .select(
      "id, ticket_number, category, context_screen, status, last_activity_at, created_at"
    )
    .eq("company_id", company.id)
    .eq("remote_profile_id", remoteProfileId)
    .order("last_activity_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: `Error cargando tickets: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, tickets: data || [] });
}

// Crea un ticket nuevo + su mensaje inicial, y avisa por mail al staff
// activo (Resend, propio de esta backend).
export async function POST(request: Request) {
  const authError = requireSupportServiceSecret(request);
  if (authError) return authError.response;

  let body: {
    environment?: unknown;
    remote_company_id?: unknown;
    remote_profile_id?: unknown;
    requester_name?: unknown;
    requester_email?: unknown;
    category?: unknown;
    message?: unknown;
    context_screen?: unknown;
    attachment?: unknown;
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
  const requesterName =
    typeof body.requester_name === "string" ? body.requester_name.trim() : "";
  const requesterEmail =
    typeof body.requester_email === "string"
      ? body.requester_email.trim()
      : "";
  const category = body.category;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const attachmentInput = body.attachment;
  const contextScreen =
    typeof body.context_screen === "string" && body.context_screen.trim()
      ? body.context_screen.trim()
      : null;

  if (!isValidEnvironment(environment)) {
    return NextResponse.json(
      { success: false, error: "El entorno indicado no es válido." },
      { status: 400 }
    );
  }

  if (
    !remoteCompanyId ||
    !remoteProfileId ||
    !requesterName ||
    !requesterEmail
  ) {
    return NextResponse.json(
      { success: false, error: "Faltan datos del usuario o la empresa." },
      { status: 400 }
    );
  }

  if (!isValidCategory(category)) {
    return NextResponse.json(
      { success: false, error: "La categoría indicada no es válida." },
      { status: 400 }
    );
  }

  if (!message) {
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
      { success: false, error: "No se encontró la empresa." },
      { status: 404 }
    );
  }

  const { data: ticket, error: ticketError } = await supabaseAdmin
    .from("support_tickets")
    .insert({
      company_id: company.id,
      remote_profile_id: remoteProfileId,
      requester_name: requesterName,
      requester_email: requesterEmail,
      category,
      context_screen: contextScreen,
    })
    .select(
      "id, ticket_number, category, context_screen, status, last_activity_at, created_at"
    )
    .single();

  if (ticketError || !ticket) {
    return NextResponse.json(
      {
        success: false,
        error: `No se pudo crear el ticket: ${
          ticketError?.message || "error desconocido"
        }`,
      },
      { status: 500 }
    );
  }

  // El adjunto (si vino) se sube ANTES de insertar el mensaje, para poder
  // grabar attachment_url/attachment_filename en la misma fila — si la
  // subida falla, no se rompe la creación del ticket: se guarda el mensaje
  // sin adjunto y se avisa con attachment_warning en la respuesta (mismo
  // criterio que sendEmail: un adjunto que falla no debería tirar abajo el
  // resto de la operación).
  const uploadResult = await uploadSupportAttachment(ticket.id, attachmentInput);

  const { error: messageError } = await supabaseAdmin
    .from("support_ticket_messages")
    .insert({
      ticket_id: ticket.id,
      sender_type: "cliente",
      sender_name: requesterName,
      body: message,
      attachment_url: uploadResult.attachment?.attachment_url ?? null,
      attachment_filename: uploadResult.attachment?.attachment_filename ?? null,
    });

  if (messageError) {
    return NextResponse.json(
      {
        success: false,
        error: `El ticket #${ticket.ticket_number} se creó pero no se pudo guardar el mensaje: ${messageError.message}`,
      },
      { status: 500 }
    );
  }

  // Se esperan los dos mails (no "fire-and-forget"): en un runtime
  // serverless como Vercel, una promesa que se deja correr sin awaitear
  // puede cortarse a mitad de camino en cuanto la función devuelve la
  // respuesta, y el mail nunca termina de salir. Si igual falla, no rompe
  // la creación del ticket (sendEmail nunca tira excepción, devuelve un
  // resultado) — el ticket ya quedó creado y visible en la bandeja.
  const clientConfirmation = buildClientTicketConfirmationEmail({
    requesterName,
    ticketNumber: ticket.ticket_number,
    categoryLabel: categoryLabel(category),
    messageBody: message,
  });

  const emailTasks: Promise<unknown>[] = [
    sendEmail({
      to: [requesterEmail],
      subject: clientConfirmation.subject,
      text: clientConfirmation.text,
      html: clientConfirmation.html,
      idempotencyKey: `support-confirmation:${ticket.id}`,
    }),
  ];

  const staffEmails = await getActiveStaffEmails();
  if (staffEmails.length > 0) {
    const notification = buildStaffNotificationEmail({
      kind: "new_ticket",
      ticketNumber: ticket.ticket_number,
      companyName: company.name,
      categoryLabel: categoryLabel(category),
      requesterName,
      messageBody: message,
    });

    emailTasks.push(
      sendEmail({
        to: staffEmails,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
        idempotencyKey: `support-new-ticket:${ticket.id}`,
      })
    );
  }

  await Promise.all(emailTasks);

  return NextResponse.json({
    success: true,
    ticket,
    attachment_warning: uploadResult.error,
  });
}
