"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStaffSession } from "@/lib/hooks/useStaffSession";
import { authenticatedFetch } from "@/lib/api/client";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
  type SupportTicketCategory,
  type SupportTicketStatus,
} from "@/lib/support/constants";

type TicketDetail = {
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

type TicketMessage = {
  id: string;
  sender_type: "cliente" | "staff";
  sender_name: string;
  body: string;
  is_internal_note: boolean;
  attachment_url: string | null;
  attachment_filename: string | null;
  created_at: string;
};

const STATUS_STYLES: Record<SupportTicketStatus, string> = {
  abierto: "bg-blue-100 text-blue-700",
  en_progreso: "bg-amber-100 text-amber-700",
  resuelto: "bg-emerald-100 text-emerald-700",
};

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

// Detalle de un ticket: hilo completo (incluidas las notas internas, esta
// pantalla es solo para el staff), caja de respuesta y cambio de estado —
// ver la propuesta "Sistema de soporte" del 2026-09-18.
export default function SupportTicketPage() {
  const params = useParams<{ id: string }>();
  const ticketId = params.id as string;

  const { loading, accessDenied } = useStaffSession();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const loadedOnceRef = useRef(false);

  const [statusSaving, setStatusSaving] = useState(false);

  const [replyBody, setReplyBody] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const loadDetail = async () => {
    if (!loadedOnceRef.current) {
      setDetailLoading(true);
    }
    setDetailError("");
    try {
      const response = await authenticatedFetch(
        `/api/support/tickets/${ticketId}`
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo cargar el ticket.");
      }
      setTicket(result.ticket);
      setMessages(result.messages);
      loadedOnceRef.current = true;
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "No se pudo cargar el ticket."
      );
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !accessDenied) {
      loadDetail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accessDenied, ticketId]);

  const changeStatus = async (status: SupportTicketStatus) => {
    if (!ticket || status === ticket.status) return;
    setStatusSaving(true);
    try {
      const response = await authenticatedFetch(
        `/api/support/tickets/${ticketId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo cambiar el estado.");
      }
      setTicket(result.ticket);
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "No se pudo cambiar el estado."
      );
    } finally {
      setStatusSaving(false);
    }
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!replyBody.trim()) return;

    setSending(true);
    setSendError("");
    try {
      const response = await authenticatedFetch(
        `/api/support/tickets/${ticketId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: replyBody,
            is_internal_note: isInternalNote,
          }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo enviar el mensaje.");
      }
      setReplyBody("");
      setIsInternalNote(false);
      await loadDetail();
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : "No se pudo enviar el mensaje."
      );
    } finally {
      setSending(false);
    }
  };

  if (loading || detailLoading) {
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

  if (detailError || !ticket) {
    return (
      <main className="min-h-dvh bg-slate-50 px-6 py-10 text-slate-900">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/support"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            ← Volver a Soporte
          </Link>
          <p className="mt-6 text-sm font-medium text-red-600">
            {detailError || "No se encontró el ticket."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/support"
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Volver a Soporte
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-blue-600">
              Ticket #{ticket.ticket_number}
            </p>
            <h1 className="mt-1 text-2xl font-bold">
              {ticket.company?.name ?? "—"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {ticket.requester_name} · {ticket.requester_email}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {categoryLabel(ticket.category)}
              {ticket.context_screen ? ` · ${ticket.context_screen}` : ""} ·
              Creado {formatDateTime(ticket.created_at)}
            </p>
          </div>

          <div className="shrink-0">
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[ticket.status]}`}
            >
              {SUPPORT_TICKET_STATUSES.find((s) => s.value === ticket.status)
                ?.label ?? ticket.status}
            </span>
            <select
              value={ticket.status}
              disabled={statusSaving}
              onChange={(event) =>
                changeStatus(event.target.value as SupportTicketStatus)
              }
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {SUPPORT_TICKET_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {messages.map((message) => {
            const isStaff = message.sender_type === "staff";
            const bubbleStyle = message.is_internal_note
              ? "bg-amber-50 border border-amber-200"
              : isStaff
                ? "bg-blue-600 text-white"
                : "bg-white shadow-sm";

            return (
              <div
                key={message.id}
                className={`max-w-[85%] rounded-2xl p-4 ${isStaff ? "ml-auto" : ""} ${bubbleStyle}`}
              >
                <div
                  className={`flex items-baseline justify-between gap-4 text-xs ${
                    isStaff && !message.is_internal_note
                      ? "text-blue-100"
                      : "text-slate-500"
                  }`}
                >
                  <span className="font-semibold">
                    {message.sender_name}
                    {message.is_internal_note ? " · Nota interna" : ""}
                  </span>
                  <span>{formatDateTime(message.created_at)}</span>
                </div>
                <p
                  className={`mt-1.5 whitespace-pre-wrap text-sm ${
                    message.is_internal_note ? "text-amber-900" : ""
                  }`}
                >
                  {message.body}
                </p>
                {message.attachment_url && (
                  <a
                    href={message.attachment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block w-fit"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={message.attachment_url}
                      alt={message.attachment_filename || "Adjunto"}
                      className="max-h-40 rounded-lg border border-black/10 object-cover"
                    />
                    <span
                      className={`mt-1 block truncate text-xs underline ${
                        isStaff && !message.is_internal_note
                          ? "text-blue-100"
                          : "text-slate-500"
                      }`}
                    >
                      {message.attachment_filename || "Ver adjunto"}
                    </span>
                  </a>
                )}
              </div>
            );
          })}
        </div>

        <form
          onSubmit={handleSend}
          className="mt-6 rounded-2xl bg-white p-4 shadow-sm"
        >
          <textarea
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            rows={4}
            placeholder={
              isInternalNote
                ? "Nota interna, no la ve el cliente..."
                : "Escribí tu respuesta..."
            }
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isInternalNote}
                onChange={(event) => setIsInternalNote(event.target.checked)}
              />
              Nota interna (no se envía al cliente)
            </label>

            <button
              type="submit"
              disabled={sending || !replyBody.trim()}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {sending
                ? "Enviando..."
                : isInternalNote
                  ? "Guardar nota"
                  : "Responder"}
            </button>
          </div>

          {sendError && (
            <p className="mt-3 text-sm font-medium text-red-600">
              {sendError}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
