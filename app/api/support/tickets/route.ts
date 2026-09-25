import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
  type SupportTicketCategory,
  type SupportTicketStatus,
} from "@/lib/support/constants";

function isValidStatus(value: unknown): value is SupportTicketStatus {
  return (
    typeof value === "string" &&
    SUPPORT_TICKET_STATUSES.some((s) => s.value === value)
  );
}

function isValidCategory(value: unknown): value is SupportTicketCategory {
  return (
    typeof value === "string" &&
    SUPPORT_TICKET_CATEGORIES.some((c) => c.value === value)
  );
}

// Bandeja única de tickets de todas las empresas, ordenada por última
// actividad — mismo modelo mental que una bandeja compartida tipo
// Front/Intercom, no un ticket por página (ver la propuesta "Sistema de
// soporte" del 2026-09-18).
export async function GET(request: Request) {
  const auth = await requireActiveStaff(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const companyFilter = url.searchParams.get("company_id");
  const categoryFilter = url.searchParams.get("category");

  if (statusFilter && !isValidStatus(statusFilter)) {
    return NextResponse.json(
      { success: false, error: "El estado indicado no es válido." },
      { status: 400 }
    );
  }

  if (categoryFilter && !isValidCategory(categoryFilter)) {
    return NextResponse.json(
      { success: false, error: "La categoría indicada no es válida." },
      { status: 400 }
    );
  }

  let query = supabaseAdmin
    .from("support_tickets")
    .select(
      "id, ticket_number, company_id, requester_name, requester_email, category, context_screen, status, last_activity_at, created_at, company:client_companies(name)"
    )
    .order("last_activity_at", { ascending: false });

  if (statusFilter) query = query.eq("status", statusFilter);
  if (categoryFilter) query = query.eq("category", categoryFilter);
  if (companyFilter) query = query.eq("company_id", companyFilter);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { success: false, error: `Error cargando tickets: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, tickets: data || [] });
}
