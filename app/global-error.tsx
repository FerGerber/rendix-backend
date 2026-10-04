"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Última red de seguridad: se muestra si falla el layout raíz o cualquier
// error no atajado por una pantalla. Reemplaza al layout, por eso define su
// propio <html>/<body> y no depende de los estilos globales.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>Algo salió mal</h1>
          <p style={{ margin: "0 0 24px", color: "#475569", lineHeight: 1.6 }}>
            Tuvimos un problema inesperado y ya quedó registrado. Probá de
            nuevo.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              border: 0,
              borderRadius: 12,
              background: "#0f172a",
              color: "#fff",
              padding: "12px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
