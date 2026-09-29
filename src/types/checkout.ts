export type OrderType = "pickup" | "delivery";
export interface DeliveryAddress {
  postalCode: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  complement: string;
  reference: string;
}
export type AddressErrors = Partial<Record<keyof DeliveryAddress, string>>;
export type CheckoutSelection =
  | { orderType: "pickup" }
  | { orderType: "delivery"; address: DeliveryAddress };
