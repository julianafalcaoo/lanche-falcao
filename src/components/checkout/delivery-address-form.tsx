import type { AddressErrors, DeliveryAddress } from "@/types/checkout";
import styles from "./checkout-page.module.css";
import { usePostalCode } from "./use-postal-code";

const fields: { name: keyof DeliveryAddress; label: string; required?: boolean; autoComplete?: string }[] = [
  { name: "postalCode", label: "CEP", required: true, autoComplete: "postal-code" },
  { name: "street", label: "Rua", required: true, autoComplete: "address-line1" },
  { name: "number", label: "Número", required: true },
  { name: "neighborhood", label: "Bairro", required: true },
  { name: "city", label: "Cidade", required: true, autoComplete: "address-level2" },
  { name: "state", label: "UF", required: true, autoComplete: "address-level1" },
  { name: "complement", label: "Complemento" },
  { name: "reference", label: "Ponto de referência" },
];

export function validateAddress(address: DeliveryAddress): AddressErrors {
  const errors: AddressErrors = {};
  for (const field of fields) {
    if (field.required && !address[field.name].trim()) errors[field.name] = `Preencha o campo ${field.label}.`;
  }
  if (address.postalCode.trim() && !/^\d{5}-?\d{3}$/.test(address.postalCode.trim())) errors.postalCode = "Informe um CEP com 8 dígitos.";
  if (address.state.trim() && !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(address.state.trim().toUpperCase())) errors.state = "Informe uma UF válida com duas letras.";
  return errors;
}

export function DeliveryAddressForm({ address, errors, onChange }: {
  address: DeliveryAddress;
  errors: AddressErrors;
  onChange: (field: keyof DeliveryAddress, value: string) => void;
}) {
  const { status, retry, change, lookup } = usePostalCode(address, onChange);
  return <fieldset className={styles.address}>
    <legend>Endereço de entrega</legend>
    <p className={styles.hint}>Campos marcados com * são obrigatórios.</p>
    <div className={styles.fields}>{fields.map((field) => <div className={styles.field} key={field.name}>
      <label htmlFor={field.name}>{field.label}{field.required ? " *" : " (opcional)"}</label>
      <input
        id={field.name}
        name={field.name}
        value={address[field.name]}
        onChange={(event) => change(field.name, event.target.value)}
        onBlur={field.name === "postalCode" ? () => void lookup() : undefined}
        required={field.required}
        autoComplete={field.autoComplete ?? "off"}
        inputMode={field.name === "postalCode" ? "numeric" : "text"}
        maxLength={field.name === "postalCode" ? 9 : field.name === "state" ? 2 : 200}
        aria-invalid={Boolean(errors[field.name])}
        aria-describedby={[errors[field.name] ? `${field.name}-error` : "", field.name === "postalCode" ? "postal-code-status" : ""].filter(Boolean).join(" ") || undefined}
      />
      {errors[field.name] && <p id={`${field.name}-error`} className={styles.error}>{errors[field.name]}</p>}
      {field.name === "postalCode" && <><p id="postal-code-status" className={styles.hint} role="status">{status}</p>{retry && <button type="button" className={styles.retry} onClick={() => void lookup(true)}>Tentar consultar novamente</button>}</>}
    </div>)}</div>
  </fieldset>;
}
