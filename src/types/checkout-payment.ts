export interface CheckoutOrder {
  id: string;
  formaPagamento: "PIX" | "DINHEIRO" | "CARTAO";
  statusPagamento: "PENDENTE" | "APROVADO" | "RECUSADO" | "CANCELADO" | "ESTORNADO" | "ESTORNADO_PARCIAL" | "CONTESTADO";
  totalCentavos: number;
}
export interface PaymentView {
  pedido: CheckoutOrder;
  tentativa: null | {
    id: string; statusExterno: string | null; detalheExterno: string | null; codigoErro: string | null;
    podeTentarNovamente: boolean; aguardando: boolean;
    qrCode: string | null; qrCodeBase64: string | null; ticketUrl: string | null;
  };
}
export interface CardData {
  token: string; payment_method_id: string; installments: number;
  payer: { email: string; identification?: { type: string; number: string } };
}
