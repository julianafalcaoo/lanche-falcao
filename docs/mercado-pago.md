# Mercado Pago — Checkout Transparente com Orders, somente teste

Implementação consultada em 29/09/2026. API REST v1 e MercadoPago.js v2.
Não foi feita nenhuma chamada financeira real durante a implementação. Testes usam mocks.

Atualização de 25/10/2026: webhook Orders e reconciliação compartilhada implementados em código, ainda sem ativação remota. Configuração, fila, migration e limitações atuais: [Webhook Orders](./webhook-orders.md). Os resultados de validação de 29/09 abaixo são históricos, não evidência de validação desta atualização.

## Fontes oficiais

- [Modelo de integração](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-model)
- [Criar Order: contrato, headers e erros](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/create-order/post)
- [Integração PIX](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix)
- [Integração de cartões com Card Payment Brick](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/cards)
- [MercadoPago.js](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/development-environment)
- [Renderização e ciclo de vida do Brick](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/card-payment-brick/default-rendering)
- [Status da Order](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status)
- [Buscar Order](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/search-order/get)
- [Teste PIX](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix)
- [Teste com cartões e dados oficiais](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/cards)
- [Notificações de Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications)

As páginas não informam uma versão editorial fixa; a data acima registra a consulta. Nenhuma referência de Payments API foi usada para criar cobranças.

## Configuração e diferenças encontradas na documentação

MERCADO_PAGO_ACCESS_TOKEN é lido apenas em módulos server-only.
MERCADO_PAGO_PUBLIC_KEY é fornecida ao navegador pela rota autenticada GET /api/pagamentos/config, com no-store.
Não é necessário criar variável NEXT_PUBLIC nem alterar o .env local. .env permanece ignorado pelo Git.

MERCADO_PAGO_AMBIENTE é opcional; omitida, usa test. Qualquer valor diferente de test bloqueia a integração.
Configurar somente as duas credenciais da seção de TESTE da aplicação Orders. Nenhuma credencial foi trocada automaticamente.

A documentação atual de teste usa credenciais APP_USR; o prefixo não prova que sejam produtivas ou de teste. A referência de erros também fala em usuários de teste com credenciais próprias. Não substituir por credenciais reais de produção: confirmar a seção de teste da aplicação no painel antes de qualquer teste autorizado.

O checkout não pede dados técnicos de sandbox ao cliente. O módulo server-only sandbox.ts fornece os valores oficiais exclusivamente em modo test, sem modificar Cliente.
PIX automático recebe { iniciarPix: true } e o servidor usa payer.email=test_user_br@testuser.com e payer.first_name=APRO. Cartão inicializa o Brick com payer.email=test@testuser.com recebido da configuração autenticada; o Brick oculta o campo quando inicializado com e-mail válido. CPF, titular e cartão continuam no formulário oficial, preenchidos manualmente com os dados oficiais de teste. Produção permanece bloqueada: uma futura etapa deverá obter/validar pagador real e substituir a política sandbox, sem reutilizar estes valores.

No teste PIX, a documentação descreve uma requisição predefinida, não um pagamento real por transferência; ela pode retornar base64 vazio e aprovar automaticamente depois. O código exibe imagem apenas se fornecida pelo provedor e não altera o total real do catálogo para forçar o exemplo de teste.

A visão geral menciona /v1/orders/search, mas a referência detalhada de busca e seu cURL mostram GET /v1/orders com begin_date/end_date. A implementação segue a referência detalhada, recebe data[] e verifica a Order individualmente.
O texto PIX contém a grafia qr_code_based64 em um trecho, mas o JSON/referência usam qr_code_base64: este é o campo utilizado.

## Arquitetura e transações

Camada isolada src/server/mercado-pago:
- config.ts: credenciais privadas e modo de teste.
- validation.ts: lista explícita de campos permitidos do pagador/token.
- client.ts: REST fetch, timeout, erros sanitizados, criação/consulta/busca e normalização.
- service.ts: ownership, reserva de tentativa, idempotência, exclusão concorrente e reconciliação.

Não foi instalada dependência. REST server-side segue os exemplos oficiais; o navegador carrega https://sdk.mercadopago.com/js/v2 e usa Card Payment Brick.

1. Checkout salva chave e snapshot da solicitação em sessionStorage ANTES de POST /api/pedidos.
2. O backend existente calcula os valores e cria Pedido de forma idempotente.
3. Dinheiro termina aqui, sem chamar Mercado Pago.
4. PIX/cartão iniciam pagamento em POST /api/pedidos/[id]/pagamento.
5. O servidor reserva TentativaPagamento em transação curta, bloqueando a linha do Pedido e impondo índice único parcial para uma tentativa ativa.
6. A chamada externa ocorre fora da transação, com chave do provedor UUID gerada e persistida pelo servidor.
7. Resultado validado e status local são gravados atomicamente. A reserva temporária de 60 segundos funciona também como proteção contra respostas antigas sobrescrevendo nova execução.

Não existe transação distribuída entre PostgreSQL e Mercado Pago. Um Pedido pendente e sua tentativa são registros intencionais de recuperação, não são apagados quando o provedor falha. Nunca se cria cobrança sem Pedido local previamente persistido.

## Modelagem

Migration da integração anterior: 20260929210000_mercado_pago_orders. A correção de intenção não altera schema nem cria migration.
Nenhuma migration anterior foi editada nesta etapa.

TentativaPagamento guarda relacionamento com Pedido, chave do cliente, chave do provedor, resumo criptográfico do payload, ID externo, status/detalhe externos, contador de envios, reserva temporal, erro sanitizado, dados PIX e datas. Não guarda payload completo, token de cartão, CPF/e-mail do pagador, número de cartão, CVV ou credenciais.
O ID do Pedido é enviado como external_reference. Não usa nome nem telefone.
Várias tentativas históricas são permitidas; apenas uma ativa por Pedido. Aprovação bloqueia novas cobranças.

## Contratos e segurança

- POST /api/pedidos conserva validação, Origin, sessão, preços do catálogo e idempotência existentes.
- GET /api/pedidos/[id]/pagamento retorna somente projeção segura do Pedido/tentativa.
- POST /api/pedidos/[id]/pagamento recebe payer e card quando aplicável, mais Idempotency-Key.
- POST com { "consultar": true } reconcilia com o provedor, sem criar nova tentativa.
- Todas as rotas exigem autenticação e ownership; mutações exigem Origin e JSON.
- Configuração retorna publicKey, ambiente e payerEmail oficial de sandbox; nunca Access Token.

Criação externa: POST https://api.mercadopago.com/v1/orders, Authorization Bearer, Content-Type JSON, X-Idempotency-Key.
Payload: type online, processing_mode automatic, external_reference local, total_amount decimal como string, payer e transactions.payments.
PIX usa id pix/type bank_transfer. Cartão usa ID/tipo/token/parcelas vindos do Brick. Total vem exclusivamente do Pedido server-side.
Não há POST /v1/payments.

Respostas precisam combinar referência local, valor, tipo, método e identificador válido. live_mode=true é recusado. HTTP 402 pode conter Order recusada e é interpretado; HTTP 200/201 isoladamente nunca aprova.
Erros não registram corpo, Authorization, dados do pagador ou cartão.

## Estados

- processed/accredited + transação processed/accredited: APROVADO.
- failed/failed: RECUSADO.
- canceled/canceled e expired/expired: CANCELADO.
- created, processing e action_required: PENDENTE.
- refunded/refunded: ESTORNADO; processed/partially_refunded: ESTORNADO_PARCIAL; charged_back/in_process, settled ou reimbursed: CONTESTADO. Todos bloqueiam nova cobrança. Estados desconhecidos continuam conservadores, sem regredir um pagamento confirmado.

Somente aprovação confirmada pelo servidor é apresentada como paga. QR gerado continua pendente.
Estado operacional de Pedido não é alterado.

## Retry e reload

### Intenção do checkout e imutabilidade

O bug do total antigo ocorria porque useCheckoutOrder restaurava qualquer solicitação em sessionStorage e start priorizava essa solicitação sem comparar o carrinho atual. A tela usava corretamente o total imutável do pedido errado para aquela compra.

checkoutIntent produz JSON canônico com productIds ordenados, quantidades, tipo, endereço normalizado somente na entrega, forma de pagamento e troco somente quando aplicável. Não inclui preço, total, horário ou identificadores aleatórios. O corpo já persistido permite comparar também fluxos salvos pela versão anterior, sem migração de storage.

A comparação ocorre apenas após hidratar carrinho e draft. Mesma intenção conserva a chave local e recupera o mesmo Pedido; reload/remontagem não cria pedido. Intenção diferente deixa de renderizar o fluxo anterior imediatamente e remove somente sua referência local. Não altera nem exclui Pedido, ItemPedido ou TentativaPagamento. Novo UUID só nasce ao clicar em Finalizar pedido. Respostas atrasadas só atualizam o fluxo se a chave ainda for a mesma no storage.

PIX pendente de A continua exclusivamente em A. B monta uma nova etapa com seu próprio pedido, consulta seu próprio endpoint e usa chave de pagamento separada por pedido. QR anterior não aparece em B. Nenhuma tentativa externa é cancelada ou transformada automaticamente; pedidos abandonados permanecem históricos, sem tela de histórico nesta etapa.

Concluir pedido fica disponível em dinheiro ou após aprovação confirmada. Antes de limpar, compara a intenção do pedido com a intenção atual e também os itens mais recentes do localStorage. Carrinho novo, armazenamento indisponível, erro, timeout, recusa e pagamento pendente preservam os itens. A assinatura é proteção de UX; autorização, idempotência e preços continuam sob controle do backend.

### Interface e teste manual posterior

O cliente vê Finalizar pedido, Pagamento via Pix, Copiar código Pix e Verificar pagamento. UUID, campos de cenário/e-mail técnico e avisos de sandbox foram retirados da apresentação. Verificar pagamento reconcilia no servidor; QR e HTTP 200/201 nunca significam aprovação.

O preenchimento interno do e-mail do Brick segue [Inicializar dados nos Bricks](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/card-payment-brick/advanced-features/initialize-data-on-the-bricks). Nenhum CPF é criado pelo aplicativo. Em teste manual autorizado, preencher no Brick somente cartão, titular e documento indicados na documentação oficial de Orders. Reiniciar o servidor local para carregar a versão atual; não é necessário limpar o banco, apagar pedidos ou limpar sessionStorage.

Os testes automatizados bloqueiam rede externa e usam respostas simuladas. O comportamento remoto do sandbox, incluindo aprovação automática do cenário APRO e eventual ausência de imagem base64, ainda depende do teste manual posterior. Nenhuma compra real ou de teste foi enviada ao Mercado Pago durante esta correção.

- Chaves separadas para criação local e tentativa externa.
- Duplo clique no navegador é bloqueado por ref síncrona; concorrência backend é serializada na reserva.
- Falha de criação local: reenvia snapshot e chave salvos, inclusive após reload.
- Timeout/5xx/resposta inválida: tentativa externa continua ativa; não gera outra chave.
- Reenvio usa o mesmo token/payload apenas enquanto disponível em memória. Token não vai para storage.
- Após reload, consulta ID externo conhecido. Se a resposta original se perdeu, busca por external_reference/data e exclui Orders já vinculadas a tentativas anteriores.
- Busca vazia, múltiplas candidatas ou lote possivelmente incompleto não liberam nova cobrança.
- Após 24 horas não reenvia criação: apenas reconcilia. Essa é uma janela defensiva local, não uma afirmação de prazo de idempotência garantido pelo provedor.
- 409 externo nunca faz rotação automática de chave.
- 429 respeita espera informada (limitada a 24h); demais falhas impõem espera mínima antes de retry. Não há loop automático de chamadas.
- Erro de dados/credencial na primeira chamada pode encerrar a tentativa; depois de uma resposta incerta, o mesmo erro não prova ausência de cobrança e não libera nova tentativa.
- Recusa/cancelamento definitivo permite ação explícita de nova tentativa, no mesmo Pedido.
- A consulta manual compartilha a aplicação de snapshots com webhook e worker. O webhook agenda processamento com after; o endpoint interno permite reprocessamento durável e varredura periódica. É necessário configurar um agendador externo, conforme webhook-orders.md.

## Checkout, PIX, cartão e carrinho

DINHEIRO confirma o Pedido e mantém pagamento presencial pendente.
PIX inicia automaticamente após Finalizar pedido, recuperando primeiro eventual tentativa existente. Exibe qr_code, qr_code_base64 PNG e ticket_url oficial quando retornados. Sem QR fictício ou contador inventado.
CARTAO monta o Brick com valor do Pedido, encaminha somente token/metadados permitidos e desmonta o Brick ao sair. Nenhum input próprio de PAN/CVV.

Carrinho não é apagado na criação do Pedido, geração do QR, erro ou recusa. Em dinheiro ou após aprovação online, o botão Concluir pedido limpa o carrinho somente se ele ainda corresponde exatamente aos itens pedidos; se foi alterado, preserva-o. O draft de seleção permanece. A referência de fluxo é removida ao concluir.

O estado da tentativa é recuperável; uma falha incerta pode exigir reconciliação posterior se o provedor não retornar resultado unívoco. Não há confirmação fictícia para contornar essa situação.

## Webhook — implementação atual

POST /api/webhooks/mercado-pago autentica, persiste e agenda a reconciliação de Orders. POST /api/interno/pagamentos/reconciliar processa um lote protegido por Bearer independente. Ver [Webhook Orders](./webhook-orders.md).

Nenhum túnel, deploy, agendador ou URL pública foi configurado. A migration nova não foi aplicada ao banco da aplicação nesta atualização. Produção permanece bloqueada.

## Testes

npm run test:mercado-pago usa banco descartável e fetch mockado, nunca credenciais reais.
npm test executa regressão de identificação, OTP, autenticação e Pedidos.
npm run test:checkout inclui simulação local do Brick e das APIs, com toda rede externa bloqueada.
Validar também npm run lint, npm run build, npm run db:check e npx prisma migrate status.

Teste remoto controlado NÃO foi executado. Antes de fazê-lo, obter aprovação explícita: informar que criará uma Order de teste e quais dados oficiais serão usados. Para PIX seguir o cenário oficial; para cartão usar somente os cartões, titular e documento de teste indicados na documentação. Nunca cartão pessoal ou pagamento produtivo.

## Resultado da validação desta etapa

Arquivos modificados nesta correção (incluindo arquivos ainda não commitados da integração anterior):
- src/components/checkout/checkout-page.tsx
- src/components/checkout/use-checkout-order.ts
- src/components/checkout/payment-stage.tsx
- src/components/checkout/payment-options.tsx
- src/components/checkout/card-payment.tsx
- src/server/mercado-pago/service.ts
- src/server/mercado-pago/config.ts
- src/server/mercado-pago/validation.ts
- src/app/api/pagamentos/config/route.ts
- tests/browser/checkout.spec.ts
- tests/browser/mercado-pago.spec.ts
- tests/mercado-pago.test.mjs
- docs/mercado-pago.md
- docs/pedidos.md
- docs/checkout-identificacao.md

Arquivos criados nesta correção:
- src/lib/checkout-intent.ts
- src/server/mercado-pago/sandbox.ts
- tests/browser/checkout-intent.spec.ts

Playwright validado contra o build local na porta 3100 com configuração temporária de next start, removida após a execução. A configuração permanente permanece intacta. Foram adicionados 13 testes: 3 de backend e 10 no Playwright; cenários existentes também foram atualizados. Larguras verificadas: 320, 375, 430, 768, 1024 e 1440 pixels.

- Identificação: 9 testes.
- OTP: 30 testes.
- Autenticação: 16 testes.
- Pedidos/formas: 73 testes.
- Mercado Pago backend: 46 testes.
- Playwright: 50 testes, incluindo 3 verificações da assinatura e 47 cenários de navegador.
- Total: 224 testes passando.
- Lint, build e db:check aprovados. Nenhuma migration nova nesta correção.
- Cinco migrations aplicadas.
- Banco principal (consulta somente leitura): 1 cliente, 1 pedido, 4 itens, 1 tentativa. Registros preservados.
- Access Token ausente nos assets públicos do build; .env ignorado.
- Nenhuma chamada financeira real, SMS real, instalação de pacote, commit ou push.

A validação visual automatizada cobre layout local e Brick simulado, não uma sessão real do SDK com as credenciais da conta. Cenários adicionais de autenticação de cartão/3DS não foram exercitados; uma resposta action_required não será apresentada como aprovada e exigirá tratamento específico conforme o provedor. Teste remoto controlado e ativação/homologação remota do webhook permanecem pendentes.
