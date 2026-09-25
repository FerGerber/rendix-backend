"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStaffSession } from "@/lib/hooks/useStaffSession";
import { authenticatedFetch } from "@/lib/api/client";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
  type SupportTicketCategory,
  type SupportTicketStatus,
} from "@/lib/support/constants";

type TicketRow = {
  id: string;
  ticket_number: number;
  company_id: string;
  requester_name: string;
  requester_email: string;
  category: SupportTicketCategory;
  context_screen: string | null;
  status: SupportTicketStatus;
  last_activity_at: string;
  created_at: string;
  company: { name: string } | null;
};

type CompanyOption = { id: string; name: string };

const STATUS_STYLES: Record<SupportTicketStatus, string> = {
  abierto: "bg-blue-100 text-blue-700",
  en_progreso: "bg-amber-100 text-amber-700",
  resuelto: "bg-emerald-100 text-emerald-700",
};

function statusLabel(value: SupportTicketStatus) {
  return SUPPORT_TICKET_STATUSES.find((s) => s.value === value)?.label ?? value;
}

function categoryLabel(value: SupportTicketCategory) {
  return (
    SUPPORT_TICKET_CATEGORIES.find((c) => c.value === value)?.label ?? value
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Bandeja única de tickets de todas las empresas, ordenada por última
// actividad — mismo modelo mental que Front/Intercom, no un ticket por
// página (ver la propuesta "Sistema de soporte" del 2026-09-18).
export default function SupportPage() {
  const { loading, accessDenied } = useStaffSession();

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState("");
  const loadedOnceRef = useRef(false);

  const [companies, setCompanies] = useState<CompanyOption[]>([]);

  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | "">(
    ""
  );
  const [categoryFilter, setCategoryFilter] = useState<
    SupportTicketCategory | ""
  >("");
  const [companyFilter, setCompanyFilter] = useState("");

  useEffect(() => {
    if (loading || accessDenied) return;

    (async () => {
      try {
        const response = await authenticatedFetch("/api/companies");
        const result = await response.json();
        if (response.ok && result.success) {
          setCompanies(result.companies);
        }
      } catch {
        // La lista de empresas es solo para el filtro — si falla, se
        // sigue pudiendo usar la bandeja sin ese filtro.
      }
    })();
  }, [loading, accessDenied]);

  const loadTickets = async () => {
    if (!loadedOnceRef.current) {
      setTicketsLoading(true);
    }
    setTicketsError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      if (companyFilter) params.set("company_id", companyFilter);

      const response = await authenticatedFetch(
        `/api/support/tickets?${params.toString()}`
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudieron cargar los tickets.");
      }
      setTickets(result.tickets);
      loadedOnceRef.current = true;
    } catch (error) {
      setTicketsError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los tickets."
      );
    } finally {
      setTicketsLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !accessDenied) {
      loadTickets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accessDenied, statusFilter, categoryFilter, companyFilter]);

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

  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-4xl">
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
          <h1 className="mt-1 text-3xl font-bold">Soporte</h1>
          <p className="mt-1 text-sm text-slate-500">
            Consultas de todas las empresas, ordenadas por última actividad.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as SupportTicketStatus | "")
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos los estados</option>
            {SUPPORT_TICKET_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(event) =>
              setCategoryFilter(
                event.target.value as SupportTicketCategory | ""
              )
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todas las categorías</option>
            {SUPPORT_TICKET_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          <select
            value={companyFilter}
            onChange={(event) => setCompanyFilter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todas las empresas</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-6 rounded-2xl bg-white shadow-sm">
          {ticketsLoading ? (
            <p className="p-6 text-sm text-slate-500">Cargando tickets...</p>
          ) : ticketsError ? (
            <p className="p-6 text-sm font-medium text-red-600">
              {ticketsError}
            </p>
          ) : tickets.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No hay tickets con estos filtros.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {tickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/support/${ticket.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:bg-slate-50"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      #{ticket.ticket_number} · {ticket.company?.name ?? "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {ticket.requester_name} · {categoryLabel(ticket.category)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">
                      {formatDateTime(ticket.last_activity_at)}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[ticket.status]}`}
                    >
                      {statusLabel(ticket.status)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
