# Pedidos — base server-side

Esta etapa fornece persistência e APIs de pedidos autenticados. O checkout ainda não chama essas rotas. Não há pagamento, Mercado Pago, webhook, acompanhamento visual, código de retirada, fidelidade ou alteração do WhatsApp.

## Modelos e snapshots

- `Pedido`: UUID, relação com Cliente, tipo, status, subtotal/total inteiros em centavos, snapshot de endereço, datas, chave de idempotência e hash interno da requisição.
- `ItemPedido`: UUID, relação com Pedido, produtoId, nomeProduto, precoUnitarioCentavos, quantidade e subtotalCentavos. Não existe FK para Produto: o catálogo continua em `src/data/menu.ts`.
- `TipoPedido`: `RETIRADA`, `ENTREGA`.
- `StatusPedido`: `PEDIDO_RECEBIDO`, `EM_PREPARACAO`, `PRONTO`, `SAIU_PARA_ENTREGA`, `ENTREGUE`, `PRONTO_PARA_RETIRADA`, `RETIRADO`. Todo pedido nasce em `PEDIDO_RECEBIDO`. Não há rota de mudança de status. CANCELADO não foi adicionado.

O servidor busca nome e preço no catálogo real. Cada subtotal é preço × quantidade; o total do pedido é a soma, sem taxa, frete ou desconto. Valores são validados como inteiros e dentro do limite de INTEGER PostgreSQL. Snapshots preservam nomes, preços e endereço mesmo quando o catálogo ou dados futuros do cliente mudarem. Consultas nunca recalculam pedidos antigos.

Limite defensivo: **1 a 100 unidades por produto**, no máximo **100 produtos distintos por requisição**. Produtos repetidos são recusados; o consumidor deve enviar uma linha com a quantidade consolidada. O catálogo atual tem menos produtos que o limite. Campos extras, inclusive preço, nome de produto, clienteId, status e totais, são recusados com 422.

`Pedido` e seus itens são gravados em uma transação Prisma. Falha de qualquer item reverte toda a criação, incluindo a reserva da chave de idempotência. O banco reforça quantidade, subtotal de item, total igual ao subtotal, endereço coerente com o tipo e status coerente com Retirada/Entrega por CHECKs na migration. Cliente com pedidos tem exclusão restrita; itens pertencem ao pedido por FK.

## Sessão e acesso

Todas as rotas exigem o cookie de sessão existente. O backend reutiliza leitura do cookie e hash de token, consulta Sessao e exige validade e telefoneVerificado. O clienteId é obtido internamente. Nenhuma mudança foi feita na autenticação ou no contrato `/api/auth/me`.

Toda consulta filtra por clienteId. Pedido de outro cliente e pedido inexistente respondem com o mesmo 404. As respostas têm `Cache-Control: no-store`, não incluem clienteId, dados de sessão/Infobip, chave de idempotência ou hash. O ID público do pedido é retornado para permitir consulta.

## POST /api/pedidos

Cabeçalhos: cookie de sessão, `Content-Type: application/json`, `Origin` da própria aplicação e **`Idempotency-Key: <UUID>`**. Reutiliza a proteção de origem das mutações existentes. Futuramente o navegador poderá gerar a chave com `crypto.randomUUID()` uma vez por tentativa lógica, conservando-a em retries.

Retirada:

```json
{
  "tipo": "RETIRADA",
  "itens": [
    { "productId": "coxinha-frango", "quantity": 2 }
  ]
}
```

Entrega usa `tipo: "ENTREGA"` e `endereco` com os mesmos nomes de campos do checkout:

```json
{
  "tipo": "ENTREGA",
  "itens": [{ "productId": "coxinha-frango", "quantity": 2 }],
  "endereco": {
    "postalCode": "69000-000",
    "street": "Rua de exemplo",
    "number": "10",
    "neighborhood": "Centro",
    "city": "Manaus",
    "state": "AM",
    "complement": "",
    "reference": ""
  }
}
```

Exemplo meramente estrutural, sem envio ou inserção automática. CEP exige oito dígitos, com hífen opcional; UF válida é normalizada para maiúsculas; textos obrigatórios são aparados e limitados a 200 caracteres, sem caracteres de controle. Complemento e referência são opcionais. Não há consulta ViaCEP no backend. Retirada não exige nem aceita endereço preenchido; omissão ou null é permitido. Endereço fica em Pedido, sem associação permanente a Cliente.

Sucesso: **201** na criação, **200** na repetição idempotente, ambos com `{ "pedido": { ... } }`. Pedido contém id, tipo, status, subtotalCentavos, totalCentavos, criadoEm, atualizadoEm e itens; somente Entrega inclui endereco. Itens expõem produtoId, nomeProduto, precoUnitarioCentavos, quantidade e subtotalCentavos. Exemplo de duas coxinhas: 2 × 400 = 800 centavos, total 800.

### Idempotência persistente

A chave UUID fica em Pedido, com UNIQUE composto `(clienteId, chaveIdempotencia)`: clientes distintos podem usar a mesma chave. SHA-256 do conteúdo normalizado detecta reutilização incompatível (409). Ordenação dos itens, espaços aparados, CEP com/sem hífen e caixa da UF são normalizados. O hash não inclui preço atual do catálogo; retry devolve o snapshot original mesmo se o produto for alterado ou removido posteriormente.

Em corrida entre processos, apenas uma transação vence a UNIQUE; a outra recupera o pedido vencedor e compara o hash. Chave e conteúdo iguais retornam o mesmo pedido, sem novos itens. Não existe cache em memória ou prazo de expiração da chave: vale enquanto o pedido existir. Uma nova chave representa uma nova tentativa lógica e pode criar outro pedido; o consumidor não deve gerar nova chave a cada retry. Não há retries automáticos neste backend.

## GET /api/pedidos/[id]

Retorna **200** com `{ "pedido": { ... } }` somente ao proprietário autenticado. UUID malformado, inexistente ou de outro cliente retorna **404** com a mesma mensagem. Não inclui campos internos.

## GET /api/pedidos

Retorna `{ "pedidos": [...], "proximoCursor": "<UUID ou null>" }`. Ordenação por criadoEm decrescente, com UUID decrescente para desempate. Parâmetros opcionais: `limite` (padrão 20, entre 1 e 50) e `cursor` (ID retornado em proximoCursor). Exemplo: `/api/pedidos?limite=20&cursor=<UUID>`. O cursor também deve pertencer ao cliente. A paginação usa comparação de data/UUID, sem retornar quantidade ilimitada ou expor pedidos alheios.

## Erros

Formato `{ "erro": "CODIGO", "mensagem": "texto seguro" }`: 400 JSON/chave/paginação inválidos; 401 sessão ausente/inválida/expirada; 403 origem recusada; 404 pedido não encontrado; 409 chave já usada com outro conteúdo; 415 Content-Type inadequado; 422 conteúdo, produto, quantidade ou endereço inválido; 503 falha interna. Sem stack trace, SQL, credenciais ou dados pessoais em logs.

## Migration e validação

Migration nova: `20260929120000_pedidos`. Cria duas tabelas, dois enums, índices, FKs e CHECKs. As migrations anteriores são preservadas. CHECKs adicionais são SQL explícito porque não são representados pelo schema Prisma.

```bash
npm run db:migrate
npm run db:check
npm run test:pedidos
npm test
npm run test:checkout
npm run lint
npm run build
```

`test:pedidos` reutiliza o runner de banco descartável (`scripts/test-auth.mjs pedidos`), aplica todas as migrations e remove o banco ao terminar. As fixtures e alterações de catálogo em memória são exclusivas dos testes. Fetch é bloqueado e nenhum SMS, pagamento ou API externa é chamado. O banco principal não recebe dados fictícios. `db:check` apenas consulta metadados e contagens.
