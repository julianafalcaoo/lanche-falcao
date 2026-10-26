import { after } from "next/server";
import { receiveOrderWebhook } from "../../../../server/mercado-pago/webhook.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return receiveOrderWebhook(request, work => after(work));
}
