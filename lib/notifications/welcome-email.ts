import "server-only";

import type { RendixClientEnvironment } from "@/lib/environments";
import { getAppUrl } from "@/lib/notifications/app-url";

// Cubre las 3 formas de alta. Google/Microsoft: admin.createUser() no manda
// nada — este correo llena ese hueco avisando cómo entrar. Local: antes se
// dependía de inviteUserByEmail (mail propio de Supabase Auth, terminaba en
// spam o no llegaba — ver caso testigo 2026-09-16); ahora rendix-backend le
// genera una contraseña temporal al crear el usuario y la devuelve en la
// respuesta del alta para pasarla por otro canal, así que este correo para
// "local" es solo un aviso de que la cuenta está lista — a propósito NO
// lleva ninguna contraseña en el cuerpo, por seguridad (no queremos
// contraseñas circulando por mail sin cifrar).
//
// Caso testigo 2026-10-02: el primer usuario real de Producción recibió
// este correo con el link apuntando a dev.rendixapp.com — la URL salía de
// una única variable global (RENDIX_APP_URL) que nunca se cargó para esta
// backend, así que siempre caía al default de desarrollo sin importar en
// qué entorno se estuviera dando de alta al usuario. Ahora la URL se
// resuelve por entorno (ver lib/notifications/app-url.ts), igual que ya
// se hace con las credenciales de Supabase de cada entorno cliente.
export type WelcomeEmailProvider = "google" | "microsoft" | "local";

type WelcomeEmailInput = {
  email: string;
  fullName: string;
  companyName: string;
  provider: WelcomeEmailProvider;
  environment: RendixClientEnvironment;
};

const PROVIDER_LABEL: Record<"google" | "microsoft", string> = {
  google: "Google",
  microsoft: "Microsoft",
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Pequeño wrapper compartido entre las dos variantes para que el correo se
// vea como algo que una empresa manda a sus clientes y no como un aviso de
// sistema: encabezado con la marca, el contenido en una tarjeta blanca y
// un botón para el llamado a la acción principal en vez de un link pelado.
function renderEmailShell(bodyHtml: string, ctaUrl: string, ctaLabel: string) {
  return `
    <div style="background:#f1f5f9; padding:32px 16px; font-family: -apple-system, Segoe UI, Roboto, sans-serif;">
      <div style="max-width:480px; margin:0 auto;">
        <div style="text-align:center; padding-bottom:20px;">
          <span style="font-size:22px; font-weight:700; color:#2563eb; letter-spacing:0.5px;">Rendix</span>
        </div>
        <div style="background:#ffffff; border-radius:12px; padding:32px; color:#0f172a; line-height:1.6;">
          ${bodyHtml}
          <div style="text-align:center; margin:28px 0 8px;">
            <a href="${ctaUrl}" style="display:inline-block; background:#2563eb; color:#ffffff; text-decoration:none; font-weight:600; padding:12px 28px; border-radius:8px;">${ctaLabel}</a>
          </div>
        </div>
        <p style="text-align:center; color:#94a3b8; font-size:12px; margin-top:20px;">Rendix · Gestión de rendiciones y adelantos</p>
      </div>
    </div>
  `.trim();
}

export function buildWelcomeEmail(input: WelcomeEmailInput) {
  const APP_URL = getAppUrl(input.environment);
  const firstName = input.fullName.trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `¡Hola ${firstName}!` : "¡Hola!";
  const companyNameSafe = escapeHtml(input.companyName);

  if (input.provider === "local") {
    const subject = `¡Bienvenido a Rendix! Tu cuenta en ${input.companyName} ya está lista`;

    const text = [
      greeting,
      "",
      `Ya tenés una cuenta en Rendix para gestionar tus rendiciones de gastos y adelantos en ${input.companyName}, todo en un solo lugar y sin planillas sueltas.`,
      "",
      "Para entrar por primera vez necesitás tu contraseña temporal. Por seguridad no va en este correo: pedísela a quien te dio de alta. Vas a poder elegir tu contraseña definitiva apenas ingreses.",
      "",
      `Ingresá en ${APP_URL} con esta dirección: ${input.email}`,
      "",
      "¡Te damos la bienvenida!",
      "El equipo de Rendix",
    ].join("\n");

    const bodyHtml = `
      <p style="margin-top:0;">${greeting}</p>
      <p>Ya tenés una cuenta en Rendix para gestionar tus rendiciones de gastos y adelantos en <strong>${companyNameSafe}</strong>, todo en un solo lugar y sin planillas sueltas.</p>
      <p>Para entrar por primera vez necesitás tu contraseña temporal. Por seguridad no va en este correo: pedísela a quien te dio de alta. Vas a poder elegir tu contraseña definitiva apenas ingreses.</p>
      <p style="margin-bottom:0;">Vas a entrar con esta dirección: <strong>${escapeHtml(input.email)}</strong></p>
    `;

    const html = renderEmailShell(bodyHtml, APP_URL, "Ingresar a Rendix") +
      `<p style="text-align:center; color:#94a3b8; font-size:12px;">¡Te damos la bienvenida!</p>`;

    return { subject, text, html };
  }

  const providerLabel = PROVIDER_LABEL[input.provider];
  const subject = `¡Bienvenido a Rendix! Tu cuenta en ${input.companyName} ya está lista`;

  const text = [
    greeting,
    "",
    `Ya podés ingresar a Rendix para gestionar tus rendiciones de gastos y adelantos en ${input.companyName}, todo en un solo lugar y sin planillas sueltas.`,
    "",
    `Ingresá en ${APP_URL} y elegí "Continuar con ${providerLabel}" usando esta misma dirección: ${input.email}`,
    "",
    `No hace falta que crees ninguna contraseña: tu acceso queda vinculado directamente a tu cuenta de ${providerLabel}.`,
    "",
    "¡Te damos la bienvenida!",
    "El equipo de Rendix",
  ].join("\n");

  const bodyHtml = `
    <p style="margin-top:0;">${greeting}</p>
    <p>Ya podés ingresar a Rendix para gestionar tus rendiciones de gastos y adelantos en <strong>${companyNameSafe}</strong>, todo en un solo lugar y sin planillas sueltas.</p>
    <p>Elegí <strong>"Continuar con ${providerLabel}"</strong> usando esta misma dirección: <strong>${escapeHtml(input.email)}</strong></p>
    <p style="margin-bottom:0;">No hace falta que crees ninguna contraseña: tu acceso queda vinculado directamente a tu cuenta de ${providerLabel}.</p>
  `;

  const html = renderEmailShell(bodyHtml, APP_URL, "Ingresar a Rendix") +
    `<p style="text-align:center; color:#94a3b8; font-size:12px;">¡Te damos la bienvenida!</p>`;

  return { subject, text, html };
}
