# Preparação para ativar Pix e cartão

O checkout usa Orders API, Card Payment Brick e 3DS sob demanda. A preparação usa
os campos de Pedido e TentativaPagamento existentes e dispensa migration adicional.

## Ambiente e credenciais

`MERCADO_PAGO_AMBIENTE` deve ser explicitamente `test` ou `production`.
O backend lê `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_PUBLIC_KEY` do ambiente
do deployment. A configuração pública autenticada devolve apenas Public Key,
ambiente e, exclusivamente em teste, o e-mail da fixture.

Em cada ambiente, aprove o par da mesma aplicação e conta vendedora a partir da
aba correspondente no painel. Configure `MERCADO_PAGO_CREDENTIAL_PAIR_SHA256`
com o SHA-256 em hexadecimal do JSON compacto
`[ambiente, accessToken, publicKey]`, com as chaves sem espaços nas extremidades.
O serviço valida a impressão digital antes de acessar o provedor. A origem do par
depende da conferência independente no painel, pois Orders pode usar `APP_USR`
nos dois ambientes. O launcher exige a impressão digital em
`.env.homologacao.local` para iniciar o perfil conectado de teste.

Para gerar a impressão digital no PowerShell 7, use as chaves conferidas
diretamente no painel. Somente o hash é exibido:

```powershell
$mpMode = Read-Host 'Ambiente aprovado no painel (test ou production)'
$mpAccess = Read-Host 'Access Token aprovado' -MaskInput
$mpPublic = Read-Host 'Public Key aprovada' -MaskInput
try {
  $mpPair = ConvertTo-Json -InputObject @($mpMode.Trim(), $mpAccess.Trim(), $mpPublic.Trim()) -Compress
  [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($mpPair))).ToLowerInvariant()
} finally {
  Remove-Variable mpAccess, mpPublic, mpPair -ErrorAction SilentlyContinue
}
```

Na Vercel, habilite a exposição das variáveis de sistema. O modo `production`
exige `VERCEL=1` e `VERCEL_ENV=production`, ambos definidos pela plataforma.
Preview e homologação usam par e impressão digital de teste. A configuração
autenticada do Brick e o envio de novas Orders de produção só ficam disponíveis
com `MERCADO_PAGO_PRODUCTION_CHARGES_ENABLED=true`, o segredo de webhook
presente e `CRON_SECRET` com pelo menos 16 caracteres.

Orders Pix aceitam ausência de `live_mode`, conforme o contrato de criação/consulta.
Se informado, deve ser `true` em produção e `false` em teste. A ausência não prova
o ambiente: as consultas continuam autenticadas com as credenciais configuradas,
e a conta/aplicação correspondente precisa ser conferida na homologação.
Cartão também admite ausência quando o identificador atende à validação de
formato exigida em produção. O ID é um filtro adicional. Ambiente, credenciais
aprovadas, consulta autenticada, referência, valor e estado continuam sendo
validados. Tipos inválidos e respostas de ambiente incompatível são rejeitados. Moeda/país divergentes,
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
- Comprovar ambiente/conta e contratos reais, sem exigir live_mode ausente nas Orders Pix.
- Homologar índices existentes no banco e concorrência em PostgreSQL isolado.
- Rever cron diário/lotes de dois, alertas de tentativa incerta e recuperação.
- O iframe de 3DS abre em `action_required/pending_challenge` com URL validada.
  O cenário sandbox APRO-CHOK aprovado sem iframe continua sem comprovar desafio.
  Webhook real e desafio real seguem como riscos de homologação.
- Autorizar separadamente publicação e qualquer compra/reembolso real.

## Checklist na Vercel

1. Em Production, configurar `MERCADO_PAGO_AMBIENTE=production`,
   `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PUBLIC_KEY`,
   `MERCADO_PAGO_CREDENTIAL_PAIR_SHA256`, `MERCADO_PAGO_WEBHOOK_SECRET`
   e `CRON_SECRET`. Se usar agendador externo, configurar também
   `MERCADO_PAGO_RECONCILIACAO_SECRET` separado. Manter o flag de cobranças
   desligado neste momento.
2. Conferir as variáveis já exigidas pelo runtime e pelo OTP
   (`DATABASE_URL`, `DIRECT_URL` para Prisma, `INFOBIP_API_BASE_URL`,
   `INFOBIP_API_KEY`, `INFOBIP_2FA_APPLICATION_ID`, `INFOBIP_2FA_MESSAGE_ID`,
   `OTP_RATE_LIMIT_SECRET`). Manter os bancos e as credenciais de Preview
   separados. Conferir o estado das migrations já existentes no banco autorizado.
3. No painel de produção do Mercado Pago, cadastrar o endpoint HTTPS
   `/api/webhooks/mercado-pago` para o tópico Order. Conferir assinatura, ACK,
   persistência e recuperação de fila. Verificar execução do Vercel Cron e
   observar pendências e erros. O cron atual roda diariamente às 08:00 UTC,
   em lote pequeno. Avaliar a frequência antes da ativação.
4. Após autorização e aceitação explícita dos riscos restantes, configurar
   `MERCADO_PAGO_PRODUCTION_CHARGES_ENABLED=true` para o deployment autorizado.
   Para pausar novos envios, retornar o flag a `false` em novo deployment,
   preservando credenciais, webhook e cron para continuar a reconciliação.

Referências oficiais:
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/credentials
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/integrate-3ds
