import "server-only";

// Cubre las 3 formas de alta. Google/Microsoft: admin.createUser() no manda
// nada — este correo llena ese hueco avisando cómo entrar. Local: antes se
// dependía de inviteUserByEmail (mail propio de Supabase Auth, terminaba en
// spam o no llegaba — ver caso testigo 2026-09-16); ahora rendix-backend le
// genera una contraseña temporal al crear el usuario y la devuelve en la
// respuesta del alta para pasarla por otro canal, así que este correo para
// "local" es solo un aviso de que la cuenta está lista — a propósito NO
// lleva ninguna contraseña en el cuerpo, por seguridad (no queremos
// contraseñas circulando por mail sin cifrar).
const APP_URL = (
  process.env.RENDIX_APP_URL?.trim() || "https://dev.rendixapp.com"
).replace(/\/$/, "");

export type WelcomeEmailProvider = "google" | "microsoft" | "local";

type WelcomeEmailInput = {
  email: string;
  fullName: string;
  companyName: string;
  provider: WelcomeEmailProvider;
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

export function buildWelcomeEmail(input: WelcomeEmailInput) {
  const firstName = input.fullName.trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `Hola ${firstName},` : "Hola,";
  const subject = `Tu cuenta de Rendix está lista — ${input.companyName}`;

  if (input.provider === "local") {
    const text = [
      greeting,
      "",
      `Ya tenés una cuenta creada en Rendix para gestionar tus rendiciones y adelantos en ${input.companyName}.`,
      "",
      `Para entrar por primera vez necesitás tu contraseña temporal. Por seguridad no va en este correo: pedísela a quien te dio de alta. Vas a poder elegir tu contraseña definitiva apenas ingreses.`,
      "",
      `Ingresá en ${APP_URL} con esta dirección: ${input.email}`,
      "",
      "— Rendix",
    ].join("\n");

    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; line-height: 1.6;">
        <p>${greeting}</p>
        <p>Ya tenés una cuenta creada en Rendix para gestionar tus rendiciones y adelantos en <strong>${escapeHtml(
          input.companyName
        )}</strong>.</p>
        <p>Para entrar por primera vez necesitás tu contraseña temporal. Por seguridad no va en este correo: pedísela a quien te dio de alta. Vas a poder elegir tu contraseña definitiva apenas ingreses.</p>
        <p>
          Ingresá en <a href="${APP_URL}" style="color:#2563eb;">${APP_URL}</a> con esta dirección:<br />
          <strong>${escapeHtml(input.email)}</strong>
        </p>
        <p>— Rendix</p>
      </div>
    `.trim();

    return { subject, text, html };
  }

  const providerLabel = PROVIDER_LABEL[input.provider];

  const text = [
    greeting,
    "",
    `Ya podés ingresar a Rendix para gestionar tus rendiciones y adelantos en ${input.companyName}.`,
    "",
    `Ingresá en ${APP_URL} y elegí "Continuar con ${providerLabel}" usando esta misma dirección: ${input.email}`,
    "",
    `No hace falta que crees ninguna contraseña: tu acceso queda vinculado directamente a tu cuenta de ${providerLabel}.`,
    "",
    "— Rendix",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; line-height: 1.6;">
      <p>${greeting}</p>
      <p>Ya podés ingresar a Rendix para gestionar tus rendiciones y adelantos en <strong>${escapeHtml(
        input.companyName
      )}</strong>.</p>
      <p>
        Ingresá en <a href="${APP_URL}" style="color:#2563eb;">${APP_URL}</a> y elegí
        <strong>"Continuar con ${providerLabel}"</strong> usando esta misma dirección:<br />
        <strong>${escapeHtml(input.email)}</strong>
      </p>
      <p>No hace falta que crees ninguna contraseña: tu acceso queda vinculado directamente a tu cuenta de ${providerLabel}.</p>
      <p>— Rendix</p>
    </div>
  `.trim();

  return { subject, text, html };
}
