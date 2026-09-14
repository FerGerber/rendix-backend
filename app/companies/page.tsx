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

// Hoy solo "development" tiene credenciales de servicio cargadas (ver
// .env.local / .env.example). Los otros 3 entornos se habilitan acá recién
// cuando se carguen sus credenciales — hasta entonces se muestran
// deshabilitados para no ofrecer una opción que va a fallar al crear.
const CONFIGURED_ENVIRONMENTS: RendixClientEnvironment[] = ["development"];

type ClientCompany = {
  id: string;
  environment: RendixClientEnvironment;
  remote_company_id: string;
  name: string;
  tax_id: string | null;
  base_currency: string;
  is_active: boolean;
  created_at: string;
};

type UnregisteredCompany = {
  id: string;
  name: string;
  tax_id: string | null;
  base_currency: string;
  is_active: boolean;
};

export default function CompaniesPage() {
  const { loading, accessDenied, staff } = useStaffSession();
  const [companies, setCompanies] = useState<ClientCompany[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState("");
  // Igual que en /companies/[id]: después de la primera carga, un refresh
  // (tras crear, importar o activar/desactivar) no debe volver a tapar la
  // lista con "Cargando empresas..." — eso es lo que hacía que la
  // pantalla pareciera "reiniciarse" con cada acción.
  const companiesLoadedOnceRef = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("ARS");
  const [environment, setEnvironment] =
    useState<RendixClientEnvironment>("development");

  const [showImport, setShowImport] = useState(false);
  const [importEnvironment, setImportEnvironment] =
    useState<RendixClientEnvironment>(CONFIGURED_ENVIRONMENTS[0]);
  const [unregistered, setUnregistered] = useState<UnregisteredCompany[]>([]);
  const [unregisteredLoading, setUnregisteredLoading] = useState(false);
  const [unregisteredError, setUnregisteredError] = useState("");
  const unregisteredLoadedOnceRef = useRef(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  const loadCompanies = async () => {
    if (!companiesLoadedOnceRef.current) {
      setCompaniesLoading(true);
    }
    setCompaniesError("");
    try {
      const response = await authenticatedFetch("/api/companies");
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudieron cargar las empresas.");
      }
      setCompanies(result.companies);
      companiesLoadedOnceRef.current = true;
    } catch (error) {
      setCompaniesError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar las empresas."
      );
    } finally {
      setCompaniesLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !accessDenied) {
      loadCompanies();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accessDenied]);

  const loadUnregistered = async (targetEnvironment: RendixClientEnvironment) => {
    if (!unregisteredLoadedOnceRef.current) {
      setUnregisteredLoading(true);
    }
    setUnregisteredError("");
    try {
      const response = await authenticatedFetch(
        `/api/companies/unregistered?environment=${targetEnvironment}`
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(
          result.error || "No se pudieron cargar las empresas sin importar."
        );
      }
      setUnregistered(result.companies);
      unregisteredLoadedOnceRef.current = true;
    } catch (error) {
      setUnregisteredError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar las empresas sin importar."
      );
    } finally {
      setUnregisteredLoading(false);
    }
  };

  useEffect(() => {
    // Cambiar de entorno es una consulta distinta — ahí sí conviene
    // mostrar "Buscando empresas..." en vez de dejar la lista del entorno
    // anterior a la vista mientras carga la nueva.
    unregisteredLoadedOnceRef.current = false;
    if (showImport) {
      loadUnregistered(importEnvironment);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showImport, importEnvironment]);

  const handleImport = async (company: UnregisteredCompany) => {
    setImportingId(company.id);
    setUnregisteredError("");
    try {
      const response = await authenticatedFetch("/api/companies/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environment: importEnvironment,
          remote_company_id: company.id,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo importar la empresa.");
      }
      await Promise.all([loadCompanies(), loadUnregistered(importEnvironment)]);
    } catch (error) {
      setUnregisteredError(
        error instanceof Error ? error.message : "No se pudo importar la empresa."
      );
    } finally {
      setImportingId(null);
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const response = await authenticatedFetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          tax_id: taxId || null,
          base_currency: baseCurrency,
          environment,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo crear la empresa.");
      }
      setName("");
      setTaxId("");
      setBaseCurrency("ARS");
      setShowForm(false);
      await loadCompanies();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "No se pudo crear la empresa."
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (company: ClientCompany) => {
    try {
      const response = await authenticatedFetch(
        `/api/companies/${company.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !company.is_active }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo actualizar la empresa.");
      }
      await loadCompanies();
    } catch (error) {
      setCompaniesError(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la empresa."
      );
    }
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

  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Volver
        </Link>

        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-blue-600">
              Backend interna
            </p>
            <h1 className="mt-1 text-3xl font-bold">Empresas</h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setShowImport((value) => !value)}
              className="rounded-xl border-2 border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
            >
              {showImport ? "Cancelar" : "Importar existente"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              {showForm ? "Cancelar" : "+ Nueva empresa"}
            </button>
          </div>
        </div>

        {showImport && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold">Importar empresa existente</h2>
            <p className="mt-1 text-sm text-slate-500">
              Empresas que ya existen en el entorno elegido pero todavía no
              tienen ficha en este registro (por ejemplo, porque se
              crearon antes de esta pantalla).
            </p>

            <label className="mt-4 block max-w-xs text-sm">
              <span className="font-medium text-slate-700">Entorno</span>
              <select
                value={importEnvironment}
                onChange={(event) =>
                  setImportEnvironment(
                    event.target.value as RendixClientEnvironment
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {CONFIGURED_ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>
                    {RENDIX_CLIENT_ENVIRONMENT_LABELS[env]}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-4">
              {unregisteredLoading ? (
                <p className="text-sm text-slate-500">Buscando empresas...</p>
              ) : unregisteredError ? (
                <p className="text-sm font-medium text-red-600">
                  {unregisteredError}
                </p>
              ) : unregistered.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No hay empresas sin importar en este entorno.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {unregistered.map((company) => (
                    <div
                      key={company.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {company.name}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {company.tax_id ? `${company.tax_id} · ` : ""}
                          {company.base_currency}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleImport(company)}
                        disabled={importingId === company.id}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
                      >
                        {importingId === company.id
                          ? "Importando..."
                          : "Importar"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {showForm && (
          <form
            onSubmit={handleCreate}
            className="mt-6 rounded-2xl bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-bold">Nueva empresa</h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Nombre *</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  CUIT / Tax ID
                </span>
                <input
                  type="text"
                  value={taxId}
                  onChange={(event) => setTaxId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  Moneda base
                </span>
                <input
                  type="text"
                  value={baseCurrency}
                  onChange={(event) => setBaseCurrency(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="ARS"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">Entorno</span>
                <select
                  value={environment}
                  onChange={(event) =>
                    setEnvironment(
                      event.target.value as RendixClientEnvironment
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {RENDIX_CLIENT_ENVIRONMENTS.map((env) => (
                    <option
                      key={env}
                      value={env}
                      disabled={!CONFIGURED_ENVIRONMENTS.includes(env)}
                    >
                      {RENDIX_CLIENT_ENVIRONMENT_LABELS[env]}
                      {!CONFIGURED_ENVIRONMENTS.includes(env)
                        ? " (no configurado)"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {formError && (
              <p className="mt-4 text-sm font-medium text-red-600">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="mt-6 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Creando..." : "Crear empresa"}
            </button>
          </form>
        )}

        <div className="mt-6 rounded-2xl bg-white shadow-sm">
          {companiesLoading ? (
            <p className="p-6 text-sm text-slate-500">Cargando empresas...</p>
          ) : companiesError ? (
            <p className="p-6 text-sm font-medium text-red-600">
              {companiesError}
            </p>
          ) : companies.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              Todavía no hay empresas cargadas.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {companies.map((company) => (
                <div
                  key={company.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {company.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {RENDIX_CLIENT_ENVIRONMENT_LABELS[company.environment]}
                      {company.tax_id ? ` · ${company.tax_id}` : ""} ·{" "}
                      {company.base_currency}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        company.is_active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {company.is_active ? "Activa" : "Inactiva"}
                    </span>
                    <Link
                      href={`/companies/${company.id}`}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Gestionar
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleActive(company)}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      {company.is_active ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {staff && (
          <p className="mt-6 text-xs text-slate-400">
            Conectado como {staff.email}
          </p>
        )}
      </div>
    </main>
  );
}
