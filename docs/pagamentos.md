# Formas de pagamento — preparação

Este documento registra a etapa de preparação. A evolução atual, com criação de Pedido e integração Orders em teste, está em [Mercado Pago](./mercado-pago.md). Pagamentos produtivos continuam fora do escopo.

## Implementado

O checkout permite selecionar PIX, Dinheiro ou Cartão. Dinheiro pergunta se precisa de troco; a opção Não começa selecionada. Sim exige "Troco para quanto?", em reais brasileiros (por exemplo, 20,00 ou 1.000,00). A conversão usa partes inteiras e persiste centavos, sem float monetário. O valor deve ser positivo, inteiro em centavos, no máximo 2147483647 e maior ou igual ao total.

O draft em sessionStorage guarda tipo de recebimento, endereço, formaPagamento, precisaTroco e trocoValor (texto em reais). Nenhum dado de cartão, sessão ou OTP é armazenado nele. Drafts anteriores continuam válidos, sem forma selecionada. Forma desconhecida e booleano inválido são descartados; valor de troco inválido é limpo. Sair de Dinheiro ou selecionar Não limpa o valor de troco.

Continuar exige autenticação, itens, tipo, endereço válido para entrega e pagamento válido. O checkout apenas prepara a seleção: não chama POST /api/pedidos, não confirma pagamento e não limpa o carrinho.

## API

POST /api/pedidos mantém autenticação, Origin, ownership e Idempotency-Key. Além de tipo, itens e endereco, exige formaPagamento.

- PIX/CARTAO: enviar somente formaPagamento; qualquer presença de precisaTroco ou trocoParaCentavos é rejeitada, inclusive false/null.
- DINHEIRO: precisaTroco é booleano obrigatório. Se false, omitir trocoParaCentavos ou enviar null (normalizados para null).
- DINHEIRO com precisaTroco true: trocoParaCentavos é inteiro positivo obrigatório e deve cobrir o total calculado pelo servidor a partir do catálogo.
- statusPagamento e quaisquer campos extras enviados pelo cliente são rejeitados.

Exemplo de pagamento em dinheiro:

    {
      "tipo": "RETIRADA",
      "itens": [{ "productId": "coxinha-frango", "quantity": 2 }],
      "formaPagamento": "DINHEIRO",
      "precisaTroco": true,
      "trocoParaCentavos": 2000
    }

O servidor grava statusPagamento PENDENTE. POST e GETs retornam formaPagamento, statusPagamento, precisaTroco e trocoParaCentavos. Para PIX/CARTAO, os dois campos de troco são null.

Pagamento e troco fazem parte do conteúdo normalizado da idempotência. Mesmo conteúdo retorna o snapshot existente; forma ou troco diferente com a mesma chave retorna 409. Retry não revalida o snapshot com preços atuais. DINHEIRO sem troco com valor omitido ou null é equivalente.

## Banco e compatibilidade

Migration: 20260929180000_formas_pagamento. Nenhuma migration anterior foi editada.

Enums:
- FormaPagamento: PIX, DINHEIRO, CARTAO.
- StatusPagamento: PENDENTE (sem aprovação), APROVADO, RECUSADO, CANCELADO.

Somente PENDENTE é usado na criação. Os demais estados são preparação de domínio; não há rota operacional ou webhook que os altere nesta etapa. PENDENTE não significa cobrança gerada, inclusive no caso de dinheiro.

Pedido recebe formaPagamento nullable, statusPagamento obrigatório com default PENDENTE, precisaTroco nullable e trocoParaCentavos nullable. A nulabilidade da forma preserva pedidos antigos sem inventar uma escolha. Novos pedidos via API exigem formaPagamento. Escritas diretas no banco ainda podem representar registros legados com forma nula.

Pedidos antigos preservam snapshots e chaves existentes; aparecem com formaPagamento null e statusPagamento PENDENTE. O contrato antigo de criação sem forma deixa de ser aceito. Uma chave antiga não pode ser reutilizada para acrescentar pagamento: o conteúdo mudou e gera conflito.

CHECK no banco protege combinações de forma/troco e valor mínimo em relação ao total. Não existe modelo Pagamento separado.

## Fora desta etapa

Mercado Pago, SDK, credenciais, QR Code, chave PIX, cobrança, dados/tokenização de cartão, webhook, aprovação automática e integração final checkout → criação de Pedido.

## Validação

- npm run test:pedidos: banco descartável, fetch bloqueado, testes de pagamento e regressão de pedidos.
- npm run test:checkout: respostas de autenticação simuladas, APIs externas bloqueadas, pagamento/draft e seis larguras de tela.
- npm run lint
- npm run build
- npm run db:check: metadados, enums, constraints e contagens; somente leitura.
- npx prisma migrate status

Nenhuma fixture deve ser inserida no banco principal.

