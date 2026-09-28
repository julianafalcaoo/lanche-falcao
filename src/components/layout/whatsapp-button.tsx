import { Icon } from "@/components/ui/icon";
export function WhatsAppButton({ phoneNumber }: { phoneNumber?: string }) {
  const configured = phoneNumber && /^[1-9]\d{7,14}$/.test(phoneNumber);
  if (!configured) return <button type="button" className="whatsapp-button" disabled aria-label="WhatsApp" title="WhatsApp"><Icon name="whatsapp" width={26} height={26} /></button>;
  return <a className="whatsapp-button" href={`https://wa.me/${phoneNumber}`} target="_blank" rel="noopener noreferrer" aria-label="Falar pelo WhatsApp (abre em nova aba)"><Icon name="whatsapp" width={26} height={26} /></a>;
}
