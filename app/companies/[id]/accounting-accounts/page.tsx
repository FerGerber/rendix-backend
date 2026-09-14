"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStaffSession } from "@/lib/hooks/useStaffSession";
import { authenticatedFetch } from "@/lib/api/client";

type AccountingAccount = {
  id: string;
  numero_cuenta: string;
  denominacion: string;
  tipo_cuenta: string | null;
  criterio_asociacion: string | null;
  is_default: boolean;
  is_active: boolean;
};

type EditFormState = {
  denominacion: string;
  tipoCuenta: string;
  criterioAsociacion: string;
  isDefault: boolean;
  isActive: boolean;
};

function formFromAccount(account: AccountingAccount): EditFormState {
  return {
    denominacion: account.denominacion,
    tipoCuenta: account.tipo_cuenta || "",
    criterioAsociacion: account.criterio_asociacion || "",
    isDefault: account.is_default,
    isActive: account.is_active,
  };
}

type CreateFormState = {
  numeroCuenta: string;
  denominacion: string;
  tipoCuenta: string;
  criterioAsociacion: string;
  isDefault: boolean;
};

const EMPTY_CREATE_FORM: CreateFormState = {
  numeroCuenta: "",
  denominacion: "",
  tipoCuenta: "",
  criterioAsociacion: "",
  isDefault: false,
};

export default function AccountingAccountsPage() {
  const params = useParams<{ id: string }>();
  const companyId = params.id as string;

  const { loading, accessDenied } = useStaffSession();

  const [accounts, setAccounts] = useState<AccountingAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const loadedOnceRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadDetails, setUploadDetails] = useState<string[]>([]);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const loadAccounts = async () => {
    if (!loadedOnceRef.current) setAccountsLoading(true);
    setAccountsError("");
    try {
      const response = await authenticatedFetch(
        `/api/companies/${companyId}/accounting-accounts`
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(
          result.error || "No se pudieron cargar las cuentas contables."
        );
      }
      setAccounts(result.accounts);
      loadedOnceRef.current = true;
    } catch (error) {
      setAccountsError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar las cuentas contables."
      );
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !accessDenied && companyId) {
      loadAccounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accessDenied, companyId]);

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;

    setUploading(true);
    setUploadError("");
    setUploadDetails([]);
    setUploadMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await authenticatedFetch(
        `/api/companies/${companyId}/accounting-accounts/upload`,
        { method: "POST", body: formData }
      );
      const result = await response.json();

      if (!response.ok || !result.success) {
        setUploadError(result.error || "No se pudo procesar el archivo.");
        setUploadDetails(result.details || []);
        return;
      }

      setUploadMessage(result.message);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadAccounts();
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "No se pudo subir el archivo."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setCreateError("");

    try {
      const response = await authenticatedFetch(
        `/api/companies/${companyId}/accounting-accounts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            numero_cuenta: createForm.numeroCuenta,
            denominacion: createForm.denominacion,
            tipo_cuenta: createForm.tipoCuenta || null,
            criterio_asociacion: createForm.criterioAsociacion || null,
            is_default: createForm.isDefault,
          }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo crear la cuenta.");
      }
      setCreateForm(EMPTY_CREATE_FORM);
      setShowCreate(false);
      await loadAccounts();
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "No se pudo crear la cuenta."
      );
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (account: AccountingAccount) => {
    setEditingId(account.id);
    setEditForm(formFromAccount(account));
    setEditError("");
  };

  const handleSaveEdit = async (accountId: string) => {
    if (!editForm) return;
    setSavingEdit(true);
    setEditError("");

    try {
      const response = await authenticatedFetch(
        `/api/companies/${companyId}/accounting-accounts/${accountId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            denominacion: editForm.denominacion,
            tipo_cuenta: editForm.tipoCuenta || null,
            criterio_asociacion: editForm.criterioAsociacion || null,
            is_default: editForm.isDefault,
            is_active: editForm.isActive,
          }),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo guardar la cuenta.");
      }
      setEditingId(null);
      setEditForm(null);
      await loadAccounts();
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "No se pudo guardar la cuenta."
      );
    } finally {
      setSavingEdit(false);
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
          href={`/companies/${companyId}`}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Volver a la empresa
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Cuentas contables</h1>
            <p className="mt-1 text-sm text-slate-500">
              Carga masiva por archivo. Actualiza las cuentas que coinciden
              por número, agrega las nuevas y deja intactas las que no
              aparecen en el archivo — nunca desactiva nada por omisión.
              Para ajustes puntuales, usá "Editar" en cada fila.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((value) => !value)}
            className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            {showCreate ? "Cancelar" : "+ Nueva cuenta"}
          </button>
        </div>

        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mt-4 rounded-2xl bg-white p-6 shadow-sm"
          >
            <h2 className="text-base font-bold">Nueva cuenta contable</h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  Número de cuenta *
                </span>
                <input
                  type="text"
                  required
                  value={createForm.numeroCuenta}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      numeroCuenta: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  Denominación *
                </span>
                <input
                  type="text"
                  required
                  value={createForm.denominacion}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      denominacion: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  Tipo de cuenta
                </span>
                <input
                  type="text"
                  value={createForm.tipoCuenta}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      tipoCuenta: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">
                  Criterio de asociación
                </span>
                <input
                  type="text"
                  value={createForm.criterioAsociacion}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      criterioAsociacion: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={createForm.isDefault}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      isDefault: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                Cuenta por defecto
              </label>
            </div>

            {createError && (
              <p className="mt-4 text-sm font-medium text-red-600">
                {createError}
              </p>
            )}

            <button
              type="submit"
              disabled={creating}
              className="mt-6 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? "Creando..." : "Crear cuenta"}
            </button>
          </form>
        )}

        <form
          onSubmit={handleUpload}
          className="mt-6 rounded-2xl bg-white p-6 shadow-sm"
        >
          <h2 className="text-base font-bold">Subir archivo (CSV o Excel)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Columnas: <code>numero_cuenta</code>, <code>denominacion</code>,{" "}
            <code>tipo_cuenta</code> (opcional),{" "}
            <code>criterio_asociacion</code> (opcional, palabras clave
            separadas por coma), <code>is_default</code> (opcional, como
            mucho una fila en TRUE).
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="mt-4 block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
          />

          {uploadError && (
            <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <p className="font-medium">{uploadError}</p>
              {uploadDetails.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5">
                  {uploadDetails.map((detail, index) => (
                    <li key={index}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {uploadMessage && (
            <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {uploadMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={!file || uploading}
            className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Subiendo..." : "Subir archivo"}
          </button>
        </form>

        <div className="mt-6 rounded-2xl bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-800">
              Catálogo actual ({accounts.length})
            </p>
          </div>

          {accountsLoading ? (
            <p className="p-6 text-sm text-slate-500">Cargando...</p>
          ) : accountsError ? (
            <p className="p-6 text-sm font-medium text-red-600">
              {accountsError}
            </p>
          ) : accounts.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              Todavía no hay cuentas contables cargadas.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {accounts.map((account) => (
                <div key={account.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {account.numero_cuenta} — {account.denominacion}
                        {account.is_default && (
                          <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            Default
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {account.tipo_cuenta || "Sin tipo"}
                        {account.criterio_asociacion
                          ? ` · ${account.criterio_asociacion}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          account.is_active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {account.is_active ? "Activa" : "Inactiva"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          editingId === account.id
                            ? setEditingId(null)
                            : startEdit(account)
                        }
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        {editingId === account.id ? "Cerrar" : "Editar"}
                      </button>
                    </div>
                  </div>

                  {editingId === account.id && editForm && (
                    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <p className="text-xs text-slate-400">
                        Número de cuenta: <strong>{account.numero_cuenta}</strong>{" "}
                        (no editable — se gestiona por archivo)
                      </p>

                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm sm:col-span-2">
                          <span className="font-medium text-slate-700">
                            Denominación
                          </span>
                          <input
                            type="text"
                            value={editForm.denominacion}
                            onChange={(event) =>
                              setEditForm((form) =>
                                form
                                  ? { ...form, denominacion: event.target.value }
                                  : form
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="block text-sm">
                          <span className="font-medium text-slate-700">
                            Tipo de cuenta
                          </span>
                          <input
                            type="text"
                            value={editForm.tipoCuenta}
                            onChange={(event) =>
                              setEditForm((form) =>
                                form
                                  ? { ...form, tipoCuenta: event.target.value }
                                  : form
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="block text-sm">
                          <span className="font-medium text-slate-700">
                            Criterio de asociación
                          </span>
                          <input
                            type="text"
                            value={editForm.criterioAsociacion}
                            onChange={(event) =>
                              setEditForm((form) =>
                                form
                                  ? {
                                      ...form,
                                      criterioAsociacion: event.target.value,
                                    }
                                  : form
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={editForm.isDefault}
                            onChange={(event) =>
                              setEditForm((form) =>
                                form
                                  ? { ...form, isDefault: event.target.checked }
                                  : form
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Cuenta por defecto
                        </label>

                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={editForm.isActive}
                            onChange={(event) =>
                              setEditForm((form) =>
                                form
                                  ? { ...form, isActive: event.target.checked }
                                  : form
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Cuenta activa
                        </label>
                      </div>

                      {editError && (
                        <p className="mt-4 text-sm font-medium text-red-600">
                          {editError}
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => handleSaveEdit(account.id)}
                        disabled={savingEdit}
                        className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingEdit ? "Guardando..." : "Guardar cambios"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
