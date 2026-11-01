// Países habilitados para dar de alta una empresa. El país define cómo
// Rendix interpreta los comprobantes de esa empresa (reglas fiscales,
// etiquetas y moneda), por eso solo lo fija el personal de Rendix y se
// limita a esta lista. Se agregan países a medida que haya clientes que los
// necesiten. `currency` es solo la moneda base sugerida (se puede cambiar).

export const DEFAULT_COUNTRY_CODE = "AR";

export const SUPPORTED_COUNTRIES = [
  { code: "AR", name: "Argentina", currency: "ARS" },
  { code: "UY", name: "Uruguay", currency: "UYU" },
  { code: "CL", name: "Chile", currency: "CLP" },
  { code: "BR", name: "Brasil", currency: "BRL" },
  { code: "MX", name: "México", currency: "MXN" },
  { code: "CO", name: "Colombia", currency: "COP" },
  { code: "PE", name: "Perú", currency: "PEN" },
] as const;

export type SupportedCountryCode = (typeof SUPPORTED_COUNTRIES)[number]["code"];

export function isSupportedCountryCode(
  value: unknown
): value is SupportedCountryCode {
  return (
    typeof value === "string" &&
    SUPPORTED_COUNTRIES.some((country) => country.code === value)
  );
}

export function getCountryName(code: string | null | undefined) {
  return (
    SUPPORTED_COUNTRIES.find((country) => country.code === code)?.name ||
    code ||
    ""
  );
}

export function getSuggestedCurrency(code: string | null | undefined) {
  return (
    SUPPORTED_COUNTRIES.find((country) => country.code === code)?.currency ||
    "ARS"
  );
}
