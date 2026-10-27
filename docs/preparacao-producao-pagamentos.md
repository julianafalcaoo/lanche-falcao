# Preparação comum de Pix e cartão — etapa 1

Esta etapa prepara o código para homologação. Não ativa pagamentos no provedor,
não altera Vercel/Neon, não faz deploy e não implementa 3DS. Nenhuma migration é
necessária: usa os campos existentes de Pedido e TentativaPagamento.

## Ambiente e credenciais

`MERCADO_PAGO_AMBIENTE` deve ser explicitamente `test` ou `production`.
O backend lê `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_PUBLIC_KEY` do ambiente
do deployment. A configuração pública autenticada devolve apenas Public Key,
ambiente e, exclusivamente em teste, o e-mail da fixture.

Em produção são rejeitados valores vazios, espaços, par idêntico e formatos sem
prefixo APP_USR. Isso é validação estrutural, não autenticação das credenciais:
Orders também pode usar APP_USR em teste. Confirmar no painel o ambiente e que as
duas chaves pertencem à mesma aplicação e conta vendedora. Nunca usar somente o
prefixo como prova de produção nem expor Access Token no frontend/logs.

Respostas de produção exigem `live_mode: true`; em teste aceitam `false` ou campo
ausente por compatibilidade com as respostas de teste existentes. Tipos inválidos
e respostas de ambiente incompatível são rejeitados. Moeda/país divergentes,
quando informados, são rejeitados. Uma resposta rejeitada nunca libera preparo
nem autoriza automaticamente outra cobrança.

## Dados do comprador

Cliente/Pedido atuais não possuem e-mail. No Pix de produção o checkout pede o
e-mail antes de iniciar a tentativa. No cartão o Brick coleta o e-mail, sem
preenchimento fictício. O servidor valida o dado e rejeita fixtures de teste em
produção. Nenhum nome, documento ou e-mail é inventado. Os dados são enviados
ao provedor; não se adicionou armazenamento de e-mail/CPF ao cadastro. O token
do cartão permanece só na memória da página para retry da mesma tentativa,
nunca em localStorage/sessionStorage ou banco.

## Order assíncrona e cobrança única

Uma resposta autenticada e validada com `processing/in_process` ou
`created/created`, sem pagamento disponível, guarda o orderId sob o mesmo lock
e lease usados nos demais snapshots. A tentativa continua ativa e pendente,
preservando o método reservado, a chave do provedor e o hash da requisição.
Consulta manual, webhook e worker consultam essa Order em vez de criar outra.
Resposta incompleta com estado de aprovação nunca é aceita como aprovação.
Índice de tentativa ativa e chaves de idempotência não foram alterados.

## Pedido recebido não significa preparo autorizado

`PEDIDO_RECEBIDO` é o registro de recebimento, mantido para compatibilidade sem
migration. Todas as respostas públicas de pedido/pagamento incluem
`liberadoParaPreparo`, calculado no servidor: somente Pix/cartão com
`statusPagamento=APROVADO`. Esse estado é gravado pelo caminho autenticado de
snapshots, após validação da Order e da transação. Estorno, contestação, recusa,
pendência e dinheiro não liberam por essa regra. Dinheiro continua permitindo
encerrar o checkout, sem simular quitação; sua confirmação operacional é futura.

Não existe endpoint de avanço de preparo nesta etapa. Qualquer implementação
futura deverá verificar a regra no servidor, dentro da transação, sem confiar em
flags do navegador, em PEDIDO_RECEBIDO ou em `hasPaid` (que somente bloqueia
recobrança, inclusive após estorno/contestação).

## Validação segura

Com Node 24, executar separadamente:

```sh
npm run test:payment-production
npm run test:webhook
npm run test:deploy
npm run test:otp
npm run test:checkout
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

Os novos testes usam banco inacessível, double em memória e fetch simulado.
Não juntar suítes que usam `--test-isolation=none` no mesmo processo: variáveis
globais/mocks podem interferir. `npm test` e runners de banco executam migrations
em bancos descartáveis locais; não executá-los no Neon nem sem autorização.
Executar build/testes de navegador com URLs de banco inacessíveis e credenciais
externas vazias no processo, sem editar .env. Build gera Prisma Client, não migra.

## Pendências para homologação/ativação

- Conferir credenciais/conta/chave Pix, HTTPS e webhook Order de produção.
- Comprovar live_mode e contratos reais sem enfraquecer validações.
- Homologar índices existentes no banco e concorrência em PostgreSQL isolado.
- Rever cron diário/lotes de dois, alertas de tentativa incerta e recuperação.
- Cartão: decidir/homologar 3DS e implementar seu fluxo completo caso habilitado
  ou exigido. Esta etapa não envia `validation: never` nem contorna autenticação.
  Um pending_challenge continua pendente; não há interface de Challenge.
- Autorizar separadamente publicação e qualquer compra/reembolso real.

Referências oficiais:
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/credentials
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/integrate-3ds
