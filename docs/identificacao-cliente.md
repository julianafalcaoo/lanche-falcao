# Identificação por telefone

O endpoint `POST /api/clientes/identificar` valida o telefone e consulta o cadastro. Não cria clientes, sessão, cookies ou tokens e não envia códigos.

## Entrada

```json
{ "telefone": "(92) 99999-9999" }
```

A função server-only `normalizarTelefoneBrasileiro`, em `src/lib/telefone.ts`, usa `libphonenumber-js/max`: Brasil como país padrão, parsing estrito e validação completa dos metadados. Rejeita números de outros países, texto arbitrário e ramais. Aceita fixos e celulares válidos; não confirma posse ou atividade da linha.

As entradas `(92) 99999-9999`, `92 99999-9999`, `92999999999` e `+55 92 99999-9999` produzem `+5592999999999`. Futuras gravações devem utilizar essa mesma função antes de persistir o telefone.

## Respostas

- **200:** `{"telefone":"+5592999999999","podeProsseguirParaVerificacao":true}`
- **400:** `JSON_INVALIDO` para JSON inválido/ausente ou `TELEFONE_OBRIGATORIO` para corpo incompatível, campo ausente ou não textual.
- **422:** `TELEFONE_INVALIDO` para telefone vazio ou inválido.
- **503:** `SERVICO_INDISPONIVEL` para falha na consulta ao banco.

Erros usam `{ "erro": "CODIGO", "mensagem": "Mensagem pública" }`. As respostas possuem `Cache-Control: no-store`.

O retorno 200 é igual para cadastros existentes, ausentes ou com telefone anteriormente verificado. Não retorna nome, ID, existência do cadastro ou estado de verificação. A permissão para prosseguir apenas indica elegibilidade para uma futura prova de posse, ainda não implementada.

## Acesso ao banco e testes

`src/server/clientes/repository.ts` consulta por telefone canônico e seleciona somente o ID, reutilizando a instância de `src/lib/prisma.ts`.

`npm run test:identificacao` testa normalização, erros HTTP, consulta normalizada, resposta uniforme e falhas de banco. Os cenários de cadastro existente e falha são simulados no teste, sem inserir registros no PostgreSQL.

Referência da dependência: [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js). A biblioteca evita validação baseada apenas em comprimento ou remoção de caracteres.
