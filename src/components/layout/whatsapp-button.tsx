import { Icon } from "@/components/ui/icon";
import { contactWhatsAppUrl } from "@/lib/whatsapp";

export function WhatsAppButton() {
  return <a className="whatsapp-button" href={contactWhatsAppUrl} target="_blank" rel="noopener noreferrer" aria-label="Falar pelo WhatsApp (abre em nova aba)"><Icon name="whatsapp" width={26} height={26} /></a>;
}
