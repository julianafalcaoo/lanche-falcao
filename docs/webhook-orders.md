# Webhook Orders e reconciliação — 25/10/2026

Estado local atualizado: migration aplicada com backup e ensaio de restauração; testes PostgreSQL reais aprovados. Consulte [Validação PostgreSQL](./validacao-postgresql-webhook.md). As observações de não aplicação abaixo registram a etapa inicial de implementação.

Preparação de hospedagem posterior: [Deploy Vercel/Neon](./deploy.md). O lote atual foi reduzido para duas tentativas e duas notificações; a rota interna aceita também GET com CRON_SECRET para Vercel Cron, preservando POST e seu segredo independente.

Implementação exclusivamente de teste. Não habilita pagamentos produtivos, não cria estornos nem envia contestações. Nenhuma transação financeira, migration no banco da aplicação ou configuração remota foi executada nesta etapa.

## Fontes oficiais consultadas

- [Notificações Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications)
- [SDK Node: algoritmo de assinatura](https://github.com/mercadopago/sdk-nodejs/blob/master/src/utils/webhook/index.ts)
- [SDK Node: processamento de webhooks](https://github.com/mercadopago/sdk-nodejs/blob/master/docs/webhooks.md)
- [Consulta de Order](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/get-order/get)
- [Estados de Order](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status)

Também foram lidos os guias locais do Next.js instalado: route.md e after.md em node_modules/next/dist/docs. Não foi adicionada dependência.

## Recepção e autenticação

POST `/api/webhooks/mercado-pago?data.id=<Order ID>&type=order`.

Não utiliza sessão, cookie ou Origin: é comunicação servidor-servidor. Exige JSON, tópico order, data.id do corpo igual ao parâmetro assinado e api_version v1 quando presente. Body limitado a 64 KiB. Não aceita Payments API, merchant_order, IPN ou tópicos independentes de chargeback. Contestações são observadas pelo estado da própria Order consultada.

`MERCADO_PAGO_WEBHOOK_SECRET` contém a assinatura secreta da aplicação, exclusivamente no servidor. Não é Access Token. HMAC-SHA256 sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, comparação em tempo constante, campos obrigatórios e rejeição de componentes duplicados/ambíguos. O ID conserva a caixa recebida, seguindo o código atual do SDK oficial Node, em vez de aplicar normalização de caixa de guias antigos.

Aceita ts em segundos (SDK) e milissegundos (exemplo atual de Orders). A representação original de ts entra no manifesto. Tolerância local de cinco minutos em relação à assinatura; date_created do evento não é usado para rejeitar eventos atrasados. É necessário relógio sincronizado. Reenvios com assinatura antiga fora da janela são recusados e precisam de novo envio assinado; a varredura periódica oferece recuperação independente.

O corpo integral não é coberto pelo manifesto. Por isso action, status, data.version, live_mode e ID da notificação no JSON não são autoridade nem chave de deduplicação. A chave persistida é SHA-256 do manifesto autenticado. Mesma entrega assinada é única; reenvio com novo request-id/ts pode gerar outra entrada, processada idempotentemente. Não se deduplica somente pelo ID da Order, pois ela pode mudar legitimamente.

Resposta 200 somente após upsert durável de WebhookOrder. Dados armazenados: hash de dedupe, ID da Order, datas, reserva, contagem e código seguro de erro. Sem payload bruto, assinatura completa, credenciais ou dados do pagador. Falha de banco não retorna sucesso. Assinatura inválida retorna 401; evento/JSON inválido 400, conteúdo 415, tamanho 413, configuração/infraestrutura 503.

Após o ACK, after do Next executa o processamento. Esse mecanismo não substitui fila durável/agendador: se o processo morrer, o registro permanece. Falhas guardam backoff exponencial limitado a uma hora, respeitando espera maior do provedor. Não há retries de criação de cobrança nesse processamento.

## Reconciliação e concorrência

`reconciliation.ts` é a lógica compartilhada. A criação aplica seu resultado com applyOrderSnapshot; verificação manual, webhook e varredura consultam via reconcileAttempt e usam a mesma aplicação.

1. Localizar a TentativaPagamento pelo orderId previamente vinculado.
2. Reservar a tentativa com bloqueio da linha de Pedido em transação curta.
3. Consultar GET /v1/orders/{id} fora da transação.
4. Validar ID externo, referência do pedido, valor da Order e da única transação, tipo online, método e ambiente.
5. Conferir a reserva novamente e atualizar tentativa e agregado do pedido na mesma transação.

Método de cartão compara id e type com o que foi reservado no início. Tentativas legadas sem esses campos os preenchem na primeira consulta validada; não é possível reconstruir retroativamente o método exato que não foi guardado. Snapshots sem transação única válida são recusados. live_mode=true continua recusado; a configuração test não comprova sozinha a natureza das credenciais.

Uma Order desconhecida não é ligada à tentativa somente pela referência externa. A entrada fica pendente, inclusive se a notificação chegou antes de a resposta da criação ser salva. A varredura pode recuperar respostas perdidas pela busca conservadora já existente: candidato único, exclusão de Orders anteriormente vinculadas e validação individual. Busca vazia/ambígua não libera outra cobrança.

Webhook e consulta manual respeitam a mesma reserva de tentativa. Outra execução aguarda retry; não consulta/cria cobrança concorrente. Aplicação de resposta usa a reserva como fencing: execução antiga ou expirada não sobrescreve a atual. A fila tem reserva própria com token UUID e validade de 90 segundos; queda do worker permite recuperação após expiração. O índice único parcial de tentativa ativa e as duas camadas de idempotência existentes são preservados.

last_updated_date obtido da API, quando presente, é guardado como ISO UTC canônico com nove casas decimais, preservando nanossegundos. Revisões antigas não substituem novas; mesma revisão com estados divergentes falha fechada. Após guardar revisão, uma resposta sem revisão não a substitui. Eventos não fornecem essa revisão: apenas a API consultada.

Sem revisão comparável, transições conservadoras impedem retorno de pago para pendente, recusado ou cancelado. Estorno total não retorna automaticamente a aprovação; parcial não retorna a aprovação. Contestação pode voltar a APROVADO somente com revisão remota estritamente posterior e confirmação autoritativa de crédito. Não há promessa de ordenar estados de um provedor que omita revisão: esses casos permanecem conservadores.

Cada tentativa guarda seu próprio statusLocal. O pedido agrega tentativas por precedência: CONTESTADO, APROVADO, ESTORNADO_PARCIAL, ESTORNADO; sem histórico financeiro, utiliza a tentativa mais recente. Uma recusa antiga não apaga aprovação de outra tentativa. Não há novo débito para compensar estorno/contestação e não existe reembolso automático. Casos excepcionais com mais de uma Order paga exigem análise operacional; nenhuma é apagada.

## Estados

| Order | Local | Nova cobrança |
| --- | --- | --- |
| processed/accredited + transação credited | APROVADO | Bloqueada |
| processed/partially_refunded | ESTORNADO_PARCIAL | Bloqueada |
| refunded/refunded | ESTORNADO | Bloqueada |
| charged_back/in_process, settled ou reimbursed | CONTESTADO | Bloqueada |
| failed/failed | RECUSADO | Permitida por ação explícita |
| canceled/canceled, canceled/expired, failed/expired | CANCELADO | Permitida por ação explícita |
| Estados não finais | PENDENTE | Não cria tentativa paralela |

Também mantém compatibilidade com expired/expired anteriormente tratado. Detalhes de contestação são preservados, sem inventar que settled significa um novo pagamento. Valor parcial do reembolso, documentos da contestação e ações administrativas não fazem parte desta etapa. Estado operacional do pedido não muda com o webhook.

## Reprocessamento automático

POST `/api/interno/pagamentos/reconciliar`, com Authorization Bearer definido por `MERCADO_PAGO_RECONCILIACAO_SECRET`, segredo independente. Cookie não autoriza o endpoint. Retorna apenas contagens ou erro seguro.

Configurar agendador externo para chamar a rota, por exemplo uma vez por minuto. Não foi criado cron em memória nem dependência de navegador. Cada lote considera até três tentativas e duas entradas de webhook. Prioriza tentativas nunca consultadas e depois as mais antigas, com intervalo mínimo local de um minuto. Também consulta Orders já aprovadas/encerradas para detectar mudanças posteriores, mesmo sem notificação. Consultas respeitam bloqueadaAte e timeout de rede. Não há prazo de retenção automática ou exclusão.

Reservas e consultas concorrentes não criam Orders; somente o checkout com payload/chave pode solicitar criação. Após qualquer estado financeiro confirmado, nova cobrança permanece bloqueada.

O limite de execução da rota é 120 segundos; a hospedagem precisa suportá-lo. A recepção declara 60 segundos e responde antes da rede externa. Dimensionar frequência/lote conforme volume e limites da API. Sem agendador, after processa a entrega inicial, mas retries após falhas e varredura contínua não ficam garantidos. A interface atual lê o estado local ao abrir/verificar; não há push/SSE nesta etapa.

## Migration e ativação em teste

Nova migration: `20261025010000_webhook_orders`. Adiciona três valores ao enum, metadados na tentativa e tabela de caixa de entrada. Faz backfill conservador dos estados históricos conhecidos. Não remove tabelas/colunas nem altera migrations anteriores. Revisar e aplicar no ambiente autorizado antes de executar a nova versão. O Prisma Client foi gerado localmente, sem aplicar a migration.

Passos no painel:

1. Disponibilizar a aplicação em URL HTTPS pública de teste. Localhost não recebe callbacks externos; nenhum túnel foi criado.
2. Em Suas integrações, escolher a aplicação usada por Orders e abrir Webhooks/Configurar notificações.
3. Selecionar Teste, informar a URL pública terminando em /api/webhooks/mercado-pago e selecionar o evento Orders. Não cadastrar a rota interna como webhook.
4. Salvar e obter a assinatura secreta; configurá-la no servidor em MERCADO_PAGO_WEBHOOK_SECRET, sem NEXT_PUBLIC_. Configurar também as credenciais corretas de teste e manter MERCADO_PAGO_AMBIENTE=test. Reiniciar/reimplantar para carregar o ambiente.
5. Definir outro segredo para MERCADO_PAGO_RECONCILIACAO_SECRET e configurar o agendador com Bearer. Não colocar segredos em URLs, logs ou repositório.
6. Verificar entregas/reenvios na aba Webhooks/Teste e acompanhar a fila e códigos seguros no banco. Simulador com Order fictícia pode ser recebido, mas não atualiza pedido real sem vínculo local e consulta válida.
7. Homologação com Order de sandbox real continua pendente e exige autorização específica. Não usar cartão pessoal ou credenciais produtivas. Produção segue bloqueada pelo código.

## Testes e limites de validação

`npm run test:webhook` executa handlers/serviços reais com fetch interceptado e Prisma substituído por double transacional em memória. Não carrega .env, usa URL local inválida defensiva, não envia SMS, não consulta Mercado Pago e não cria/remove banco. Cobre assinatura, timestamps, body, duplicidade, concorrência, recuperação, vínculo, estados e endpoints.

O double não comprova semântica de locks, constraints ou execução da migration no PostgreSQL. A suíte existente test:mercado-pago mantém testes com banco descartável, mas seu runner executa CREATE/DROP DATABASE e migrations; não foi executado sob a restrição desta tarefa. Validar posteriormente em ambiente isolado autorizado. A ativação real, assinatura recebida da conta, compatibilidade de after na hospedagem e agendador continuam dependências operacionais.

Validação local desta etapa: 47 testes novos de webhook/reconciliação, 50 testes Playwright existentes, 30 OTP e 9 identificação aprovados (136 no total). ESLint, TypeScript sem emissão, prisma validate e build completo aprovados. O primeiro build teve spawn EPERM no sandbox; repetido com permissão para subprocessos, concluiu normalmente. Sem teste financeiro remoto, sem alteração do banco da aplicação, sem commit ou push.
