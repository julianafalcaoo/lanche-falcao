import type { DeliveryAddress } from "./checkout";

export interface CheckoutOrder {
  id: string;
  tipo: "RETIRADA" | "ENTREGA";
  status: string;
  endereco?: DeliveryAddress;
  itens: { produtoId: string; nomeProduto: string; quantidade: number }[];
  formaPagamento: "PIX" | "DINHEIRO" | "CARTAO";
  statusPagamento: "PENDENTE" | "APROVADO" | "RECUSADO" | "CANCELADO" | "ESTORNADO" | "ESTORNADO_PARCIAL" | "CONTESTADO";
  totalCentavos: number;
  subtotalCentavos: number;
  taxaEntregaCentavos: number;
  trocoParaCentavos: number | null;
  liberadoParaPreparo?: boolean;
}
export interface PaymentView {
  desafio3dsUrl?: string;
  pedido: Pick<CheckoutOrder, "id" | "formaPagamento" | "statusPagamento" | "totalCentavos" | "liberadoParaPreparo">;
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
