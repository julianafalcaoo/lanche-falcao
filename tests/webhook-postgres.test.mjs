import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { beforeEach, after, test } from "node:test";
import { promisify } from "node:util";
import { prisma } from "../src/lib/prisma.ts";
import { criarPedido } from "../src/server/pedidos/service.ts";
import { processPayment, paymentView } from "../src/server/mercado-pago/service.ts";
import { reconcileAttempt, applyOrderSnapshot } from "../src/server/mercado-pago/reconciliation.ts";
import { receiveOrderWebhook, processOrderWebhook } from "../src/server/mercado-pago/webhook.ts";
import { reconciliationBatch } from "../src/server/mercado-pago/worker.ts";

const url=new URL(process.env.DATABASE_URL);
const database=url.pathname.slice(1);
if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.port!=="5433"||!/^lf_auth_test_[a-f0-9]{24}$/.test(database)||database!==process.env.AUTH_TEST_DATABASE) throw new Error("Exige banco local isolado criado pelo runner.");
let cliente, pedido, attempt, remote, calls, jobs, sequence=0;
const secret="isolated-webhook-secret";
beforeEach(async t=>{
  const fingerprint = createHash("sha256").update(JSON.stringify(["test", "isolated-access", "isolated-public"])).digest("hex");
  for(const [key,value] of Object.entries({MERCADO_PAGO_AMBIENTE:"test",MERCADO_PAGO_ACCESS_TOKEN:"isolated-access",MERCADO_PAGO_PUBLIC_KEY:"isolated-public",MERCADO_PAGO_WEBHOOK_SECRET:secret,MERCADO_PAGO_CREDENTIAL_PAIR_SHA256:fingerprint})) {
    const previous=process.env[key]; process.env[key]=value;
    t.after(()=>{if(previous===undefined) delete process.env[key]; else process.env[key]=previous;});
  }
  cliente=await prisma.cliente.create({data:{nome:"Fixture PostgreSQL",telefone:`+5592${String(++sequence).padStart(9,"0")}`,telefoneVerificado:true}});
  pedido=(await criarPedido(cliente.id,randomUUID(),{tipo:"RETIRADA",formaPagamento:"PIX",itens:[{productId:"coxinha-frango",quantity:2}]})).pedido;
  const orderId=`ORD${randomUUID().replaceAll("-","").toUpperCase()}`;
  attempt=await prisma.tentativaPagamento.create({data:{pedidoId:pedido.id,chaveCliente:randomUUID(),chaveProvedor:randomUUID(),requisicaoHash:"a".repeat(64),orderId,statusLocal:"PENDENTE",metodoExterno:"pix",tipoMetodoExterno:"bank_transfer",envios:1}});
  remote={id:orderId,type:"online",live_mode:false,external_reference:pedido.id,total_amount:"8.00",status:"processed",status_detail:"accredited",transactions:{payments:[{amount:"8.00",status:"processed",status_detail:"accredited",payment_method:{id:"pix",type:"bank_transfer"}}]}};
  calls=[];jobs=[];
  t.mock.method(globalThis,"fetch",async (url,init)=>{calls.push({url,init}); assert.equal(init.method,undefined,"Reconciliação não pode criar cobrança");return Response.json(remote);});
});
after(()=>prisma.$disconnect());
const order=()=>prisma.pedido.findUniqueOrThrow({where:{id:pedido.id}});
function notification({requestId=randomUUID(),orderId=attempt.orderId,hash,body}={}) {
  const ts=String(Math.floor(Date.now()/1000));
  const v1=hash??createHmac("sha256",secret).update(`id:${orderId};request-id:${requestId};ts:${ts};`).digest("hex");
  return new Request(`http://localhost/api/webhooks/mercado-pago?data.id=${orderId}&type=order`,{method:"POST",headers:{"content-type":"application/json","x-request-id":requestId,"x-signature":`ts=${ts},v1=${v1}`},body:JSON.stringify(body??{type:"order",data:{id:orderId}})});
}
const receive=req=>receiveOrderWebhook(req,job=>jobs.push(job));
const drain=async()=>{for(const job of jobs.splice(0)) await job();};
function state(status,detail){remote.status=status;remote.status_detail=detail;remote.transactions.payments[0].status=status;remote.transactions.payments[0].status_detail=detail;}

test("assinatura inválida não persiste eventos nem consulta provedor",async()=>{
  const count=await prisma.webhookOrder.count();
  assert.equal((await receive(notification({hash:"0".repeat(64)}))).status,401);
  assert.equal(await prisma.webhookOrder.count(),count);assert.equal(calls.length,0);
});
test("webhook persiste antes do ACK e aplica consulta autoritativa em transação",async()=>{
  assert.equal((await receive(notification())).status,200);assert.equal((await order()).statusPagamento,"PENDENTE");
  await drain();assert.equal((await order()).statusPagamento,"APROVADO");
  assert.equal(await prisma.webhookOrder.count({where:{orderId:attempt.orderId,processadoEm:{not:null}}}),1);
});
for (const batchSize of [8, 24]) test(`${batchSize} entregas e workers concorrentes deduplicam o recibo`,async()=>{
  const req=notification();
  const responses=await Promise.all(Array.from({length:batchSize},()=>receive(req.clone())));
  assert.deepEqual(responses.map(response=>response.status),Array(batchSize).fill(200));
  assert.equal(await prisma.webhookOrder.count({where:{orderId:attempt.orderId}}),1);
  assert.equal((await order()).statusPagamento,"PENDENTE");
  assert.equal(calls.length,0);
  await Promise.all(jobs.splice(0).map(job=>job()));
  const receipt=await prisma.webhookOrder.findFirstOrThrow({where:{orderId:attempt.orderId}});
  assert.ok(receipt.processadoEm);
  assert.equal(receipt.tentativas,1);
  assert.equal(calls.length,1);
  assert.equal((await order()).statusPagamento,"APROVADO");
  assert.equal(await prisma.tentativaPagamento.count({where:{pedidoId:pedido.id}}),1);
  assert.equal((await receive(req.clone())).status,200);
  await drain();
  assert.deepEqual(await prisma.webhookOrder.findUniqueOrThrow({where:{id:receipt.id}}),receipt);
  assert.equal(calls.length,1);
});
test("24 entregas em dois processos persistem um recibo recuperável pela fila",async()=>{
  const req=notification();
  const fixture=JSON.stringify({url:req.url,headers:[...req.headers],body:await req.text()});
  const worker=`
    import { receiveOrderWebhook } from "./src/server/mercado-pago/webhook.ts";
    import { prisma } from "./src/lib/prisma.ts";
    const { url, headers, body } = JSON.parse(process.env.WEBHOOK_TEST_FIXTURE);
    try {
      const deliveries = Array.from({ length: 12 }, () =>
        receiveOrderWebhook(new Request(url, { method: "POST", headers, body }), () => {}));
      console.log(JSON.stringify((await Promise.all(deliveries)).map(response => response.status)));
    } finally {
      await prisma.$disconnect();
    }
  `;
  const run=()=>promisify(execFile)(process.execPath,["--conditions=react-server","--input-type=module","-e",worker],{
    env:{...process.env,WEBHOOK_TEST_FIXTURE:fixture,DATABASE_POOL_MAX:"3"},timeout:30000,
  });
  const results=await Promise.all([run(),run()]);
  assert.deepEqual(results.flatMap(({stdout})=>JSON.parse(stdout)),Array(24).fill(200));
  assert.equal(await prisma.webhookOrder.count({where:{orderId:attempt.orderId,processadoEm:null}}),1);
  assert.equal((await order()).statusPagamento,"PENDENTE");
  assert.equal(calls.length,0);
  await prisma.tentativaPagamento.updateMany({data:{reconciliadaEm:new Date()}});
  assert.deepEqual(await reconciliationBatch(),{tentativasConsultadas:0,notificacoesSelecionadas:1});
  assert.equal(await prisma.webhookOrder.count({where:{orderId:attempt.orderId,processadoEm:{not:null},tentativas:1}}),1);
  assert.equal((await order()).statusPagamento,"APROVADO");
  assert.equal(await prisma.tentativaPagamento.count({where:{pedidoId:pedido.id}}),1);
  assert.equal(calls.length,1);
});
test("eventos assinados diferentes preservam recibos distintos por Order",async t=>{
  const other=(await criarPedido(cliente.id,randomUUID(),{tipo:"RETIRADA",formaPagamento:"PIX",itens:[{productId:"coxinha-frango",quantity:2}]})).pedido;
  const otherOrderId=`ORD${randomUUID().replaceAll("-","")}`;
  await prisma.tentativaPagamento.create({data:{
    pedidoId:other.id,chaveCliente:randomUUID(),chaveProvedor:randomUUID(),requisicaoHash:"c".repeat(64),
    orderId:otherOrderId,statusLocal:"PENDENTE",metodoExterno:"pix",tipoMetodoExterno:"bank_transfer",envios:1,
  }});
  const otherRemote={...remote,id:otherOrderId,external_reference:other.id};
  t.mock.method(globalThis,"fetch",async (url,init)=>{
    assert.equal(init.method,undefined);
    const requested=new URL(url).pathname.split("/").at(-1);
    calls.push(requested);
    assert.ok([attempt.orderId,otherOrderId].includes(requested));
    return Response.json(requested===otherOrderId?otherRemote:remote);
  });
  const responses=await Promise.all([receive(notification()),receive(notification()),receive(notification({orderId:otherOrderId}))]);
  assert.deepEqual(responses.map(response=>response.status),[200,200,200]);
  assert.equal(await prisma.webhookOrder.count({where:{orderId:attempt.orderId,processadoEm:null}}),2);
  assert.equal(await prisma.webhookOrder.count({where:{orderId:otherOrderId,processadoEm:null}}),1);
  assert.equal((await order()).statusPagamento,"PENDENTE");
  assert.equal(calls.length,0);
  await drain();
  for (const [orderId,pedidoId,receipts] of [[attempt.orderId,pedido.id,2],[otherOrderId,other.id,1]]) {
    assert.equal(await prisma.webhookOrder.count({where:{orderId,processadoEm:{not:null}}}),receipts);
    assert.equal(await prisma.tentativaPagamento.count({where:{pedidoId}}),1);
    assert.equal((await prisma.pedido.findUniqueOrThrow({where:{id:pedidoId}})).statusPagamento,"APROVADO");
    assert.ok(calls.includes(orderId));
  }
});
test("rejeição de inserção no PostgreSQL devolve 503 e a mesma entrega pode ser repetida",async()=>{
  const req=notification();
  await prisma.$executeRaw`ALTER TABLE "WebhookOrder" ADD CONSTRAINT "fixture_receipt_write_failure" CHECK ("tentativas" > 0) NOT VALID`;
  try {
    const response=await receive(req.clone());
    assert.equal(response.status,503);
    assert.equal((await response.json()).erro,"SERVICO_INDISPONIVEL");
    assert.equal(await prisma.webhookOrder.count({where:{orderId:attempt.orderId}}),0);
    assert.equal(jobs.length,0);
    assert.equal(calls.length,0);
    assert.equal((await order()).statusPagamento,"PENDENTE");
  } finally {
    await prisma.$executeRaw`ALTER TABLE "WebhookOrder" DROP CONSTRAINT "fixture_receipt_write_failure"`;
  }
  assert.equal((await receive(req.clone())).status,200);
  assert.equal(await prisma.webhookOrder.count({where:{orderId:attempt.orderId,processadoEm:null}}),1);
  await drain();
  assert.equal(await prisma.webhookOrder.count({where:{orderId:attempt.orderId,processadoEm:{not:null}}}),1);
  assert.equal((await order()).statusPagamento,"APROVADO");
});
test("reserva real serializa webhook e consulta manual sem manter lock na rede",async t=>{
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});
  t.mock.method(globalThis,"fetch",async()=>{calls.push({});entered();await gate;return Response.json(remote);});
  const manual=processPayment(cliente.id,pedido.id);await started;
  try {
    await receive(notification());await drain();
    const event=await prisma.webhookOrder.findFirstOrThrow({where:{orderId:attempt.orderId}});
    assert.equal(event.codigoErro,"RECONCILIACAO_OCUPADA");assert.equal(calls.length,1);
  } finally {release();}
  await manual;assert.equal((await order()).statusPagamento,"APROVADO");
});
test("índice parcial impede segunda tentativa ativa; UNIQUE protege orderId",async()=>{
  const data={pedidoId:pedido.id,chaveCliente:randomUUID(),chaveProvedor:randomUUID(),requisicaoHash:"b".repeat(64)};
  await assert.rejects(prisma.tentativaPagamento.create({data}),{code:"P2002"});
  await assert.rejects(prisma.tentativaPagamento.create({data:{...data,encerrada:true,orderId:attempt.orderId}}),{code:"P2002"});
});
test("criação concorrente do pedido com mesma chave e payload preserva snapshot único",async()=>{
  const key=randomUUID(),body={tipo:"RETIRADA",formaPagamento:"PIX",itens:[{productId:"coxinha-frango",quantity:3}]};
  const results=await Promise.all(Array.from({length:8},()=>criarPedido(cliente.id,key,body)));
  assert.equal(new Set(results.map(result=>result.pedido.id)).size,1);
  assert.equal(await prisma.pedido.count({where:{clienteId:cliente.id,chaveIdempotencia:key}}),1);
  await assert.rejects(criarPedido(cliente.id,key,{...body,formaPagamento:"CARTAO"}),{status:409});
});
test("duplo clique no pagamento não cria duas Orders nem gira chave",async t=>{
  const next=(await criarPedido(cliente.id,randomUUID(),{tipo:"RETIRADA",formaPagamento:"PIX",itens:[{productId:"coxinha-frango",quantity:2}]})).pedido;
  const response=structuredClone(remote);response.id=`ORD${randomUUID().replaceAll("-","")}`;response.external_reference=next.id;
  t.mock.method(globalThis,"fetch",async(url,init)=>{calls.push({url,init});return Response.json(response);});
  const key=randomUUID();await Promise.all(Array.from({length:8},()=>processPayment(cliente.id,next.id,{iniciarPix:true},key)));
  assert.equal(calls.filter(call=>call.init.method==="POST").length,1);
  assert.equal(await prisma.tentativaPagamento.count({where:{pedidoId:next.id}}),1);
});
for(const [status,detail,expected] of [["refunded","refunded","ESTORNADO"],["processed","partially_refunded","ESTORNADO_PARCIAL"],["charged_back","in_process","CONTESTADO"]]) test(`reconciliação após aprovação: ${expected}`,async()=>{
  await reconcileAttempt(attempt.id);state(status,detail);await processPayment(cliente.id,pedido.id);
  assert.equal((await order()).statusPagamento,expected);assert.equal((await paymentView(cliente.id,pedido.id)).tentativa.podeTentarNovamente,false);
  const count=calls.length;await processPayment(cliente.id,pedido.id,{iniciarPix:true},randomUUID());assert.equal(calls.length,count);
});
test("evento atrasado e revisão antiga não revertem pagamento confirmado",async()=>{
  remote.last_updated_date="2026-10-25T10:00:00.123456789Z";await reconcileAttempt(attempt.id);
  state("processing","in_process");remote.last_updated_date="2026-10-25T10:00:00.123456788Z";
  await receive(notification({body:{type:"order",action:"order.created",data:{id:attempt.orderId,status:"created"}}}));await drain();
  assert.equal((await order()).statusPagamento,"APROVADO");
});
test("resposta com fencing antigo não sobrescreve outra reserva",async()=>{
  const lease=new Date(Date.now()+60000);await prisma.tentativaPagamento.update({where:{id:attempt.id},data:{bloqueadaAte:new Date(lease.getTime()+1)}});
  await assert.rejects(applyOrderSnapshot(attempt.id,lease,remote),{code:"RESERVA_EXPIRADA"});assert.equal((await order()).statusPagamento,"PENDENTE");
});
test("erro remoto preserva estado e fila; retry posterior conclui",async t=>{
  t.mock.method(globalThis,"fetch",async()=>Response.json({private:"never expose"},{status:500}));
  await receive(notification());await drain();const event=await prisma.webhookOrder.findFirstOrThrow({where:{orderId:attempt.orderId}});
  assert.equal(event.processadoEm,null);assert.equal(event.codigoErro,"PROVEDOR_INDISPONIVEL");
  await prisma.webhookOrder.update({where:{id:event.id},data:{proximaExecucaoEm:new Date(0)}});
  await prisma.tentativaPagamento.update({where:{id:attempt.id},data:{bloqueadaAte:null}});
  t.mock.method(globalThis,"fetch",async()=>Response.json(remote));await processOrderWebhook(event.id);
  assert.equal((await order()).statusPagamento,"APROVADO");
});
for (const mutation of ["referencia", "valor", "metodo"]) test(`Order com ${mutation} divergente não modifica pagamento`,async()=>{
  if(mutation==="referencia") remote.external_reference=randomUUID();
  if(mutation==="valor") remote.total_amount="1.00";
  if(mutation==="metodo") remote.transactions.payments[0].payment_method={id:"visa",type:"credit_card"};
  await assert.rejects(reconcileAttempt(attempt.id),{code:"RESPOSTA_INVALIDA"});
  assert.equal((await order()).statusPagamento,"PENDENTE");
});
test("worker consulta PostgreSQL e detecta estorno sem navegador",async()=>{
  await reconcileAttempt(attempt.id);state("refunded","refunded");
  // Apenas fixtures desta suíte: prioriza esta tentativa sem tocar dados do banco original.
  await prisma.tentativaPagamento.updateMany({where:{id:{not:attempt.id}},data:{reconciliadaEm:new Date()}});
  await prisma.tentativaPagamento.update({where:{id:attempt.id},data:{reconciliadaEm:new Date(0)}});
  await reconciliationBatch();assert.equal((await order()).statusPagamento,"ESTORNADO");
});
