import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";

const telefoneSchema = z
  .string({ error: "Informe um telefone válido com DDD." })
  .trim()
  .min(1, "Informe um telefone válido com DDD.")
  .max(40, "Informe um telefone válido com DDD.")
  .transform((value, context) => {
    const phone = /^[+\d\s().-]+$/.test(value)
      ? parsePhoneNumberFromString(value, { defaultCountry: "BR", extract: false })
      : undefined;

    if (!phone?.isValid() || phone.ext) {
      context.addIssue({ code: "custom", message: "Informe um telefone válido com DDD." });
      return z.NEVER;
    }

    return phone.number;
  });

export const cadastroLeadSchema = z.object({
  nome: z
    .string({ error: "Informe o nome." })
    .trim()
    .min(1, "Informe o nome.")
    .max(200, "O nome deve ter no máximo 200 caracteres.")
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Informe um nome válido."),
  telefone: telefoneSchema,
  endereco: z
    .string({ error: "Informe um endereço válido." })
    .trim()
    .min(1, "Informe o endereço.")
    .max(500, "O endereço deve ter no máximo 500 caracteres.")
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Informe um endereço válido."),
});
