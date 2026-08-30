import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rendix — Backend interna",
  description: "Alta y gestión de empresas y usuarios de Rendix (solo staff).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="h-full bg-slate-50">{children}</body>
    </html>
  );
}
