import "server-only";

// Correo al cliente cuando el staff responde su ticket en la ticketera de
// rendix-backend (ver la propuesta "Sistema de soporte" del 2026-09-18).
// No lleva el cuerpo completo del hilo, solo el mensaje nuevo — el link
// lleva a "Mis consultas" en rendi-platform para ver el hilo completo.
const APP_URL = (
  process.env.RENDIX_APP_URL?.trim() || "https://dev.rendixapp.com"
).replace(/\/$/, "");

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type ClientReplyEmailInput = {
  requesterName: string;
  ticketNumber: number;
  messageBody: string;
};

export function buildClientReplyEmail(input: ClientReplyEmailInput) {
  const firstName = input.requesterName.trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `Hola ${firstName},` : "Hola,";
  const subject = `Nueva respuesta en tu consulta #${input.ticketNumber} — Rendix`;

  const text = [
    greeting,
    "",
    `Hay una respuesta nueva en tu consulta #${input.ticketNumber}:`,
    "",
    input.messageBody,
    "",
    `Podés ver el hilo completo y responder en ${APP_URL}, dentro de "Mis consultas".`,
    "",
    "— Rendix",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; line-height: 1.6;">
      <p>${greeting}</p>
      <p>Hay una respuesta nueva en tu consulta <strong>#${input.ticketNumber}</strong>:</p>
      <blockquote style="margin: 12px 0; padding: 12px 16px; border-left: 3px solid #2563eb; background: #f8fafc;">
        ${escapeHtml(input.messageBody).replace(/\n/g, "<br />")}
      </blockquote>
      <p>
        Podés ver el hilo completo y responder en
        <a href="${APP_URL}" style="color:#2563eb;">${APP_URL}</a>, dentro de "Mis consultas".
      </p>
      <p>— Rendix</p>
    </div>
  `.trim();

  return { subject, text, html };
}

// Aviso al staff activo cuando entra un ticket nuevo o un mensaje de
// seguimiento del cliente — para no tener que estar mirando el backend
// todo el día (ver la propuesta "Sistema de soporte" del 2026-09-18).
type StaffNotificationInput = {
  kind: "new_ticket" | "new_message";
  ticketNumber: number;
  companyName: string;
  categoryLabel?: string;
  requesterName: string;
  messageBody: string;
};

export function buildStaffNotificationEmail(input: StaffNotificationInput) {
  const subject =
    input.kind === "new_ticket"
      ? `Nuevo ticket #${input.ticketNumber} — ${input.companyName}`
      : `Nuevo mensaje en el ticket #${input.ticketNumber} — ${input.companyName}`;

  const intro =
    input.kind === "new_ticket"
      ? `Nuevo ticket de soporte de ${input.companyName}.`
      : `Nuevo mensaje de ${input.requesterName} (${input.companyName}) en el ticket #${input.ticketNumber}.`;

  const lines = [intro];
  if (input.kind === "new_ticket") {
    lines.push(`De: ${input.requesterName}`);
    if (input.categoryLabel) lines.push(`Categoría: ${input.categoryLabel}`);
  }
  lines.push(
    "",
    input.messageBody,
    "",
    "Se ve y se responde desde rendix-backend, sección Soporte."
  );
  const text = lines.join("\n");

  const senderLine =
    input.kind === "new_ticket"
      ? `<p>De: ${escapeHtml(input.requesterName)}${
          input.categoryLabel
            ? `<br />Categoría: ${escapeHtml(input.categoryLabel)}`
            : ""
        }</p>`
      : "";

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; line-height: 1.6;">
      <p>${escapeHtml(intro)}</p>
      ${senderLine}
      <blockquote style="margin: 12px 0; padding: 12px 16px; border-left: 3px solid #2563eb; background: #f8fafc;">
        ${escapeHtml(input.messageBody).replace(/\n/g, "<br />")}
      </blockquote>
      <p>Se ve y se responde desde rendix-backend, sección Soporte.</p>
    </div>
  `.trim();

  return { subject, text, html };
}
