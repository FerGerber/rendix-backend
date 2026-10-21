"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStaffSession } from "@/lib/hooks/useStaffSession";
import { authenticatedFetch } from "@/lib/api/client";

type PreviewRow = {
  row_number: number;
  email: string;
  full_name: string;
  role: string | null;
  auth_provider: string | null;
  cost_center: string | null;
  supervisor: string | null;
  status: "ok" | "warning" | "error";
  errors: string[];
  warnings: string[];
};

type Preview = {
  summary: {
    total: number;
    valid: number;
    with_warnings: number;
    with_errors: number;
  };
  rows: PreviewRow[];
  creation_order: number[];
  unknown_columns: string[];
};

type ImportResult = {
  rowNumber: number;
  email: string;
  authProvider: string | null;
  status: "created" | "error";
  message: string;
};

const BATCH_SIZE = 10;

const ROLE_LABELS: Record<string, string> = {
  employee: "Colaborador",
  hr: "Recursos Humanos",
  finance: "Finanzas",
};

const STATUS_STYLES: Record<PreviewRow["status"], string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<PreviewRow["status"], string> = {
  ok: "OK",
  warning: "Aviso",
  error: "Error",
};

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function UsersUploadPage() {
  const params = useParams<{ id: string }>();
  const companyId = params.id as string;

  const { loading, accessDenied } = useStaffSession();

  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);

  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);

  const resetAll = () => {
    setFile(null);
    setPreview(null);
    setResults(null);
    setError("");
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    setError("");
    try {
      const response = await authenticatedFetch(
        `/api/companies/${companyId}/users/upload`
      );
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "No se pudo descargar la plantilla.");
      }
      downloadBlob(await response.blob(), "plantilla_usuarios.xlsx");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo descargar la plantilla."
      );
    } finally {
      setDownloadingTemplate(false);
    }
  };

  // Reporte de lo que no se pudo crear: filas con error de validación
  // (preview) + filas que fallaron al crearse (results), cada una con su
  // motivo en la columna "observaciones".
  const handleDownloadErrorReport = async () => {
    if (!file) return;

    const observations: Record<string, string> = {};
    for (const row of preview?.rows ?? []) {
      if (row.status === "error") {
        observations[String(row.row_number)] = row.errors.join(" | ");
      }
    }
    for (const row of results ?? []) {
      if (row.status === "error") {
        observations[String(row.rowNumber)] = row.message;
      }
    }

    if (Object.keys(observations).length === 0) return;

    setDownloadingReport(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "report");
      formData.append("observations", JSON.stringify(observations));

      const response = await authenticatedFetch(
        `/api/companies/${companyId}/users/upload`,
        { method: "POST", body: formData }
      );
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "No se pudo generar el reporte.");
      }
      downloadBlob(await response.blob(), "usuarios_no_creados.xlsx");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo generar el reporte."
      );
    } finally {
      setDownloadingReport(false);
    }
  };

  const handleValidate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;

    setValidating(true);
    setError("");
    setPreview(null);
    setResults(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "validate");

      const response = await authenticatedFetch(
        `/api/companies/${companyId}/users/upload`,
        { method: "POST", body: formData }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo procesar el archivo.");
      }
      setPreview(result as Preview);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo procesar el archivo."
      );
    } finally {
      setValidating(false);
    }
  };

  const handleImport = async () => {
    if (!file || !preview) return;

    const order = preview.creation_order;
    if (order.length === 0) return;

    setImporting(true);
    setError("");
    setProgress(0);

    const collected: ImportResult[] = [];

    try {
      for (let start = 0; start < order.length; start += BATCH_SIZE) {
        const batch = order.slice(start, start + BATCH_SIZE);

        const formData = new FormData();
        formData.append("file", file);
        formData.append("mode", "import");
        formData.append("rows", JSON.stringify(batch));
        formData.append("send_welcome_email", String(sendWelcomeEmail));

        const response = await authenticatedFetch(
          `/api/companies/${companyId}/users/upload`,
          { method: "POST", body: formData }
        );
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(
            result.error || "Se interrumpió la carga en una de las tandas."
          );
        }

        collected.push(...(result.results as ImportResult[]));
        setProgress(Math.min(start + batch.length, order.length));
      }
    } catch (err) {
      setError(
        `${
          err instanceof Error ? err.message : "Se interrumpió la carga."
        } Ya se crearon ${
          collected.filter((row) => row.status === "created").length
        } usuario(s) antes del corte: revisá el resultado abajo y no vuelvas a subir el mismo archivo sin validarlo de nuevo (los ya creados aparecerán como "ya existe").`
      );
    } finally {
      setResults(collected);
      setImporting(false);
    }
  };

  const handleDownloadResults = () => {
    if (!results) return;

    const header = ["fila", "email", "resultado", "metodo_acceso", "detalle"];
    const lines = [header.map(csvCell).join(";")];

    for (const row of results) {
      lines.push(
        [
          String(row.rowNumber),
          row.email,
          row.status === "created" ? "creado" : "error",
          row.authProvider || "",
          row.message,
        ]
          .map(csvCell)
          .join(";")
      );
    }

    // BOM para que Excel respete las tildes; ";" porque Excel en español
    // separa columnas por punto y coma.
    downloadBlob(
      new Blob(["﻿" + lines.join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
      "resultado_carga_usuarios.csv"
    );
  };

  if (loading) {
    return (
      <main className="flex h-dvh items-center justify-center bg-slate-50 text-slate-500">
        Cargando...
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="flex h-dvh items-center justify-center bg-slate-50 px-6 text-slate-900">
        <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold">Acceso no habilitado</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Tu cuenta de Google inició sesión correctamente, pero no está
            habilitada en <code>staff_users</code>. Pedile a un administrador
            que te dé de alta.
          </p>
        </div>
      </main>
    );
  }

  const createdCount =
    results?.filter((row) => row.status === "created").length ?? 0;
  const failedCount =
    results?.filter((row) => row.status === "error").length ?? 0;
  const willCreate = preview?.creation_order.length ?? 0;
  const localInPreview =
    preview?.rows.filter(
      (row) => row.status !== "error" && row.auth_provider === "local"
    ).length ?? 0;

  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <Link
          href={`/companies/${companyId}`}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Volver a la empresa
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Carga masiva de usuarios</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Subí un Excel (.xlsx) o CSV con las personas a dar de alta en la
              empresa, cada una con su rol, método de acceso, centro de
              costos y supervisor. Primero se valida el archivo sin crear
              nada; recién cuando confirmás se crean los usuarios.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={downloadingTemplate}
            className="shrink-0 rounded-xl border-2 border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50 disabled:opacity-50"
          >
            {downloadingTemplate ? "Descargando..." : "Descargar plantilla"}
          </button>
        </div>

        {!results && (
          <form
            onSubmit={handleValidate}
            className="mt-6 rounded-2xl bg-white p-6 shadow-sm"
          >
            <h2 className="text-base font-bold">1. Subir archivo</h2>
            <p className="mt-1 text-xs text-slate-500">
              La plantilla incluye las instrucciones de cada columna y la lista
              de centros de costo de esta empresa.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                disabled={importing}
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setPreview(null);
                  setError("");
                }}
                className="hidden"
              />
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border-2 border-dashed border-blue-400 bg-blue-50 px-5 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
              >
                {file ? "Cambiar archivo" : "Seleccionar archivo (.xlsx o .csv)"}
              </button>
              <span
                className={`text-sm ${
                  file ? "font-medium text-slate-800" : "text-slate-500"
                }`}
              >
                {file ? file.name : "Ningún archivo seleccionado"}
              </span>
              <button
                type="submit"
                disabled={!file || validating || importing}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {validating ? "Validando..." : "Validar archivo"}
              </button>
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={sendWelcomeEmail}
                disabled={importing}
                onChange={(event) => setSendWelcomeEmail(event.target.checked)}
              />
              Enviar email de bienvenida a cada usuario creado (los de acceso
              local lo reciben siempre, porque lleva su enlace de contraseña)
            </label>
          </form>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        {preview && !results && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold">2. Revisar y confirmar</h2>

            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg bg-slate-100 px-3 py-1.5">
                {preview.summary.total} filas
              </span>
              <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-700">
                {willCreate} se pueden crear
              </span>
              <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-700">
                {preview.summary.with_warnings} con avisos
              </span>
              <span className="rounded-lg bg-red-50 px-3 py-1.5 text-red-700">
                {preview.rows.length - willCreate} con errores (no se crean)
              </span>
            </div>

            {preview.unknown_columns.length > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                Columnas ignoradas por no ser reconocidas:{" "}
                {preview.unknown_columns.join(", ")}.
              </p>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Fila</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2 pr-3">Persona</th>
                    <th className="py-2 pr-3">Rol / acceso</th>
                    <th className="py-2 pr-3">Centro de costos</th>
                    <th className="py-2 pr-3">Supervisor</th>
                    <th className="py-2">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr
                      key={row.row_number}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="py-2 pr-3 text-slate-500">
                        {row.row_number}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[row.status]}`}
                        >
                          {STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{row.full_name || "—"}</div>
                        <div className="text-xs text-slate-500">{row.email}</div>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {(row.role && ROLE_LABELS[row.role]) || "—"} / {row.auth_provider || "—"}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {row.cost_center || "—"}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {row.supervisor || "—"}
                      </td>
                      <td className="py-2 text-xs">
                        {row.errors.map((message) => (
                          <div key={message} className="text-red-600">
                            {message}
                          </div>
                        ))}
                        {row.warnings.map((message) => (
                          <div key={message} className="text-amber-700">
                            {message}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {localInPreview > 0 && (
              <p className="mt-4 text-sm text-amber-700">
                {localInPreview} usuario(s) usan acceso &quot;local&quot;: cada
                uno recibe por email un enlace para crear su propia contraseña.
                Este email se envía siempre, aunque desmarques el de
                bienvenida.
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || willCreate === 0}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {importing
                  ? `Creando... ${progress} de ${willCreate}`
                  : `Confirmar y crear ${willCreate} usuario${willCreate === 1 ? "" : "s"}`}
              </button>
              {preview.rows.length - willCreate > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadErrorReport}
                  disabled={downloadingReport || importing}
                  className="rounded-xl border-2 border-red-300 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  {downloadingReport
                    ? "Generando..."
                    : "Descargar filas con error (Excel)"}
                </button>
              )}
              {!importing && (
                <button
                  type="button"
                  onClick={resetAll}
                  className="rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancelar
                </button>
              )}
            </div>
            {importing && (
              <p className="mt-2 text-xs text-slate-500">
                No cierres esta pantalla hasta que termine.
              </p>
            )}
          </div>
        )}

        {results && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold">3. Resultado</h2>

            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-700">
                {createdCount} creados
              </span>
              <span className="rounded-lg bg-red-50 px-3 py-1.5 text-red-700">
                {failedCount} con error
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDownloadResults}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Descargar resultado (CSV)
              </button>
              {(failedCount > 0 ||
                (preview?.rows.some((row) => row.status === "error") ??
                  false)) && (
                <button
                  type="button"
                  onClick={handleDownloadErrorReport}
                  disabled={downloadingReport}
                  className="rounded-xl border-2 border-red-300 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  {downloadingReport
                    ? "Generando..."
                    : "Descargar filas no creadas (Excel)"}
                </button>
              )}
              <Link
                href={`/companies/${companyId}`}
                className="rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Ir a la empresa
              </Link>
              <button
                type="button"
                onClick={resetAll}
                className="rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Nueva carga
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Fila</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Resultado</th>
                    <th className="py-2">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr
                      key={row.rowNumber}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="py-2 pr-3 text-slate-500">
                        {row.rowNumber}
                      </td>
                      <td className="py-2 pr-3">{row.email}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            row.status === "created"
                              ? STATUS_STYLES.ok
                              : STATUS_STYLES.error
                          }`}
                        >
                          {row.status === "created" ? "Creado" : "Error"}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-slate-600">
                        {row.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
