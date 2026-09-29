import "server-only";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export type TelefoneBrasileiro = string & { readonly __telefoneBrasileiro: unique symbol };

/** Valida o plano de numeração; não comprova posse nem que a linha está ativa. */
export function normalizarTelefoneBrasileiro(value: unknown): TelefoneBrasileiro | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || input.length > 64 || !/^[+\d\s().-]+$/.test(input)) return null;
  const phone = parsePhoneNumberFromString(input, { defaultCountry: "BR", extract: false });
  if (!phone || phone.country !== "BR" || phone.ext || !phone.isValid()) return null;
  return phone.number as TelefoneBrasileiro;
}
