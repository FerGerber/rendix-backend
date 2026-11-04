"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStaffSession } from "@/lib/hooks/useStaffSession";
import { authenticatedFetch } from "@/lib/api/client";
import {
  RENDIX_CLIENT_ENVIRONMENTS,
  RENDIX_CLIENT_ENVIRONMENT_LABELS,
  type RendixClientEnvironment,
} from "@/lib/environments";

type AttemptRow = {
  id: string;
  created_at: string;
  email: string | null;
  method: "password" | "google" | "azure";
  reason: "invalid_credentials" | "email_not_confirmed" | "oauth_error" | "other";
  account_status: "exists_active" | "exists_inactive" | "not_found" | "unknown";
  company_id: string | null;
  company_name: string | null;
  ip: string | null;
  user_agent: string | null;
};

const METHOD_LABELS: Record<AttemptRow["method"], string> = {
  password: "Email y contraseña",
  google: "Google",
  azure: "Microsoft",
};

const REASON_LABELS: Record<AttemptRow["reason"], string> = {
  invalid_credentials: "Email o contraseña incorrectos",
  email_not_confirmed: "Email sin confirmar",
  oauth_error: "Rechazo de Google/Microsoft",
  other: "Otro motivo",
};

const ACCOUNT_STATUS_LABELS: Record<AttemptRow["account_status"], string> = {
  exists_active: "Usuario activo",
  exists_inactive: "Usuario inactivo",
  not_found: "No existe en Rendix",
  unknown: "No se pudo determinar",
};

const ACCOUNT_STATUS_STYLES: Record<AttemptRow["account_status"], string> = {
  exists_active: "bg-emerald-100 text-emerald-700",
  exists_inactive: "bg-amber-100 text-amber-700",
  not_found: "bg-red-100 text-red-700",
  unknown: "bg-slate-100 text-slate-600",
};

const DAYS_OPTIONS = [
  { value: "1", label: "Último día" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Intentos de ingreso fallidos de un entorno cliente. Existe porque Supabase
// Auth no deja el mail en sus logs: sin esto, ante un "no puedo entrar" no hay
// manera de saber qué cuenta se probó ni por qué falló.
export default function LoginAttemptsPage() {
  const { loading, accessDenied, staff } = useStaffSession();

  const [environment, setEnvironment] =
    useState<RendixClientEnvironment>("production");
  const [days, setDays] = useState("7");
  const [accountStatus, setAccountStatus] = useState("");
  const [method, setMethod] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [emailFilter, setEmailFilter] = useState("");

  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [attemptsLoading, setAttemptsLoading] = useState(true);
  const [attemptsError, setAttemptsError] = useState("");
  const loadedOnceRef = useRef(false);

  const canView = !loading && !accessDenied && !!staff?.can_manage_staff;

  useEffect(() => {
    if (!canView) return;

    let cancelled = false;

    (async () => {
      if (!loadedOnceRef.current) setAttemptsLoading(true);
      setAttemptsError("");
      try {
        const params = new URLSearchParams({ environment, days });
        if (accountStatus) params.set("account_status", accountStatus);
        if (method) params.set("method", method);
        if (emailFilter) params.set("email", emailFilter);

        const response = await authenticatedFetch(
          `/api/login-attempts?${params.toString()}`
        );
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(
            result.error || "No se pudieron cargar los intentos de ingreso."
          );
        }
        if (cancelled) return;
        setAttempts(result.attempts);
        setTruncated(!!result.truncated);
        loadedOnceRef.current = true;
      } catch (error) {
        if (cancelled) return;
        setAttempts([]);
        setAttemptsError(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los intentos de ingreso."
        );
      } finally {
        if (!cancelled) setAttemptsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canView, environment, days, accountStatus, method, emailFilter]);

  if (loading) {
    return (
      <main className="flex h-dvh items-center justify-center bg-slate-50 text-slate-500">
        Cargando...
      </main>
    );
  }

  if (accessDenied || !staff?.can_manage_staff) {
    return (
      <main className="flex h-dvh items-center justify-center bg-slate-50 px-6 text-slate-900">
        <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold">Acceso no habilitado</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Este informe incluye mails de usuarios de todas las empresas y solo
            lo ven quienes gestionan el equipo.
          </p>
          <Link
            href="/dashboard"
            className="mt-5 inline-block text-sm font-medium text-blue-600 hover:underline"
          >
            Volver
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Volver
        </Link>

        <div className="mt-3">
          <p className="text-sm font-bold uppercase tracking-wide text-blue-600">
            Backend interna
          </p>
          <h1 className="mt-1 text-3xl font-bold">Intentos de ingreso fallidos</h1>
          <p className="mt-1 text-sm text-slate-500">
            Qué mail se probó, con qué método y por qué falló. Los horarios
            están en hora de Argentina.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <select
            value={environment}
            onChange={(event) =>
              setEnvironment(event.target.value as RendixClientEnvironment)
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {RENDIX_CLIENT_ENVIRONMENTS.map((value) => (
              <option key={value} value={value}>
                {RENDIX_CLIENT_ENVIRONMENT_LABELS[value]}
              </option>
            ))}
          </select>

          <select
            value={days}
            onChange={(event) => setDays(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {DAYS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={accountStatus}
            onChange={(event) => setAccountStatus(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todas las cuentas</option>
            {(
              Object.keys(ACCOUNT_STATUS_LABELS) as AttemptRow["account_status"][]
            ).map((value) => (
              <option key={value} value={value}>
                {ACCOUNT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>

          <select
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos los métodos</option>
            {(Object.keys(METHOD_LABELS) as AttemptRow["method"][]).map(
              (value) => (
                <option key={value} value={value}>
                  {METHOD_LABELS[value]}
                </option>
              )
            )}
          </select>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setEmailFilter(emailInput.trim().toLowerCase());
            }}
          >
            <input
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="Buscar por mail"
              className="w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Buscar
            </button>
          </form>
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm">
          {attemptsLoading ? (
            <p className="p-6 text-sm text-slate-500">Cargando intentos...</p>
          ) : attemptsError ? (
            <p className="p-6 text-sm font-medium text-red-600">
              {attemptsError}
            </p>
          ) : attempts.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No hay intentos fallidos con estos filtros.
            </p>
          ) : (
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Mail</th>
                  <th className="px-4 py-3 font-semibold">Cuenta</th>
                  <th className="px-4 py-3 font-semibold">Empresa</th>
                  <th className="px-4 py-3 font-semibold">Método y motivo</th>
                  <th className="px-4 py-3 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attempts.map((attempt) => (
                  <tr key={attempt.id} title={attempt.user_agent ?? undefined}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {formatDateTime(attempt.created_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {attempt.email ?? (
                        <span className="font-normal text-slate-400">
                          No informado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${ACCOUNT_STATUS_STYLES[attempt.account_status]}`}
                      >
                        {ACCOUNT_STATUS_LABELS[attempt.account_status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {attempt.company_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <p>{METHOD_LABELS[attempt.method]}</p>
                      <p className="text-xs text-slate-400">
                        {REASON_LABELS[attempt.reason]}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                      {attempt.ip ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {truncated && (
          <p className="mt-3 text-xs text-slate-400">
            Se muestran los 200 intentos más recientes. Acotá el período o
            buscá por mail para ver el resto.
          </p>
        )}

        <p className="mt-6 text-xs leading-5 text-slate-400">
          Es un registro informativo: lo envía el navegador cuando falla un
          ingreso, así que no prueba por sí solo quién intentó entrar. Nunca se
          guarda la contraseña ingresada.
        </p>
      </div>
    </main>
  );
}
