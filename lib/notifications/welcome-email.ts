import "server-only";

// Solo aplica a altas por Google/Microsoft: para "local" ya se manda una
// invitación real desde Supabase (auth.admin.inviteUserByEmail), que trae
// su propio link para poner contraseña. admin.createUser() (google/
// microsoft) no manda nada — este es el correo que llena ese hueco.
const APP_URL = (
  process.env.RENDIX_APP_URL?.trim() || "https://dev.rendixapp.com"
).replace(/\/$/, "");

export type WelcomeEmailProvider = "google" | "microsoft";

type WelcomeEmailInput = {
  email: string;
  fullName: string;
  companyName: string;
  provider: WelcomeEmailProvider;
};

const PROVIDER_LABEL: Record<WelcomeEmailProvider, string> = {
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
  const providerLabel = PROVIDER_LABEL[input.provider];
  const firstName = input.fullName.trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `Hola ${firstName},` : "Hola,";

  const subject = `Tu cuenta de Rendix está lista — ${input.companyName}`;

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
