import { emitKeypressEvents } from "node:readline";
import { solicitarOtp, verificarOtp, validPinId, OtpError } from "../src/server/infobip/otp.ts";

function readPin() {
  if (!process.stdin.isTTY) throw new Error("Use um terminal interativo para digitar o PIN oculto.");
  return new Promise((resolve, reject) => {
    let pin = "";
    const previousRaw = process.stdin.isRaw;
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write("Digite o PIN recebido (entrada oculta) e pressione Enter: ");
    function finish() {
      process.stdin.removeListener("keypress", onKey);
      process.stdin.setRawMode(previousRaw);
      process.stdin.pause();
      process.stdout.write("\n");
    }
    function onKey(text, key) {
      if (key?.ctrl && key.name === "c") {
        pin = "";
        finish();
        reject(new Error("Verificação cancelada sem envio."));
      } else if (key?.name === "return") {
        finish();
        const value = pin;
        pin = "";
        resolve(value);
      } else if (key?.name === "backspace") {
        pin = pin.slice(0, -1);
      } else if (typeof text === "string" && /^[0-9]$/.test(text) && pin.length < 5) {
        pin += text;
      }
    }
    process.stdin.on("keypress", onKey);
  });
}

try {
  const [action, pinId, ...extra] = process.argv.slice(2);
  if (action === "enviar" && !pinId && !extra.length) {
    if (!process.env.INFOBIP_TEST_PHONE?.trim()) {
      throw new Error("Configure INFOBIP_TEST_PHONE no .env local com o telefone autorizado para teste. Nenhum SMS foi enviado.");
    }
    const result = await solicitarOtp(process.env.INFOBIP_TEST_PHONE);
    console.log(JSON.stringify(result));
    console.log("Infobip aceitou a solicitação. Aguarde o SMS; não há reenvio automático. Use o PIN recebido na etapa verificar.");
  } else if (action === "verificar" && validPinId(pinId) && !extra.length) {
    let pin = await readPin();
    try { console.log(JSON.stringify(await verificarOtp(pinId, pin))); } finally { pin = ""; }
  } else {
    throw new Error("Uso: enviar OU verificar <pinId>. O PIN nunca deve ser passado como argumento.");
  }
} catch (error) {
  if (error instanceof OtpError) {
    console.error(JSON.stringify({ erro: error.code, mensagem: error.message,
      statusInfobip: error.providerStatus, codigoInfobip: error.providerCode, mensagemInfobip: error.providerMessage }));
    console.error("Operação interrompida. Não reenvie automaticamente; confira as restrições da conta no portal Infobip.");
  } else {
    console.error(error instanceof Error ? error.message : "Não foi possível executar o teste.");
  }
  process.exitCode = 1;
}
