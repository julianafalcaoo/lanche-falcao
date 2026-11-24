export const contactWhatsAppUrl = "https://wa.me/5592994093977";

export function orderWhatsAppUrl(orderId: string) {
  const message = `Olá! Fiz um pedido pelo site Lanche Falcão. Meu pedido é o #${orderId} e gostaria de entrar em contato com a lanchonete.`;
  return `${contactWhatsAppUrl}?text=${encodeURIComponent(message)}`;
}
