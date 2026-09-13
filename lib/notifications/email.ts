import "server-only";

type EmailMessage = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type EmailDeliveryResult =
  | { status: "sent"; providerId: string | null }
  | { status: "skipped"; reason: "not_configured" }
  | { status: "failed"; reason: string };

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

// Portado tal cual del patrón de rendi-platform (lib/notifications/email.ts)
// — misma lógica de logging y manejo de errores — pero esta backend es un
// proyecto de Vercel separado, así que necesita sus PROPIAS variables de
// entorno (RESEND_API_KEY / EMAIL_FROM); no hereda las de rendi-platform
// aunque ambas usen Resend.
export async function sendEmail(
  message: EmailMessage
): Promise<EmailDeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const testRecipient = process.env.EMAIL_TEST_RECIPIENT?.trim();

  if (!apiKey || !from) {
    return { status: "skipped", reason: "not_configured" };
  }

  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
        "User-Agent": "RendixBackend/0.1.0",
      },
      body: JSON.stringify({
        from,
        to: testRecipient ? [testRecipient] : message.to,
        subject: testRecipient ? `[PRUEBA] ${message.subject}` : message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let errorDetail = errorBody;
      try {
        const parsed = JSON.parse(errorBody) as {
          message?: unknown;
          name?: unknown;
        };
        if (typeof parsed?.message === "string") {
          errorDetail = parsed.name
            ? `${parsed.name}: ${parsed.message}`
            : parsed.message;
        }
      } catch {
        // No era JSON parseable, se usa el texto crudo tal cual.
      }

      console.error(
        `Resend rechazó el envío de correo con estado ${response.status}. Detalle: ${
          errorDetail || "(sin detalle en la respuesta)"
        }`,
        {
          to: message.to,
          subject: message.subject,
          idempotencyKey: message.idempotencyKey,
          status: response.status,
        }
      );
      return {
        status: "failed",
        reason: `provider_${response.status}${
          errorDetail ? `: ${errorDetail}` : ""
        }`,
      };
    }

    const responseBody = (await response.json().catch(() => null)) as {
      id?: unknown;
    } | null;

    return {
      status: "sent",
      providerId:
        typeof responseBody?.id === "string" ? responseBody.id : null,
    };
  } catch (error) {
    console.error("No se pudo enviar el correo de bienvenida:", {
      to: message.to,
      subject: message.subject,
      idempotencyKey: message.idempotencyKey,
      error,
    });
    return { status: "failed", reason: "provider_unavailable" };
  }
}
