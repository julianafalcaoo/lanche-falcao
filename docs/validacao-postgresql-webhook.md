# Validação local do webhook com PostgreSQL — 25/10/2026

## Resultado

Migration 20261025010000_webhook_orders aplicada exclusivamente a lanche_falcao em 127.0.0.1:5433. PostgreSQL 17.10 no container existente lanche-falcao-postgres-1, preservando o volume existente. Docker Desktop e o container estavam parados e foram iniciados; nenhum container/volume foi recriado.

As cinco migrations anteriores tinham checksums compatíveis com os arquivos. Antes da aplicação havia somente a migration do webhook pendente. Depois: seis migrations concluídas, nenhuma pendência e prisma migrate diff sem diferenças entre banco e schema. Nenhuma migration antiga foi modificada.

## Backup e preservação

- Backup custom pg_dump: backups/lanche-falcao-pre-webhook-20261025.dump, 24.465 bytes.
- SHA-256 e metadados: backups/backup-webhook-20261025.json.
- Baseline de quantidades e fingerprints: backups/pre-webhook-20261025.json.
- O diretório backups está ignorado no Git. O dump contém dados privados e não deve ser publicado.

O backup foi restaurado em banco temporário aleatório. A migration foi aplicada primeiro nessa cópia; todos os campos anteriores foram comparados com o baseline e permaneceram idênticos. Apenas depois foi aplicado migrate deploy no banco original. O ensaio não utilizou clean, reset ou sobrescrita de banco existente.

No banco original, a verificação por fingerprints também confirmou todos os campos anteriores intactos. As colunas novas foram excluídas dessa comparação porque representam a alteração intencional. As duas tentativas existentes, ambas processed/accredited, receberam statusLocal APROVADO; métodos legados não foram inventados.

| Tabela | Antes | Depois |
| --- | --- | --- |
| Cliente | 1 | 1 |
| DesafioOtp | 2 | 2 |
| Sessao | 1 | 1 |
| Pedido | 6 | 6 |
| ItemPedido | 11 | 11 |
| TentativaPagamento | 2 | 2 |
| WebhookOrder | inexistente | 0 |

## Estrutura conferida

db:check validou as colunas de WebhookOrder, tipos, nulabilidade, defaults, chave primária e índice composto de processadoEm/proximaExecucaoEm. Também verificou metadados novos de TentativaPagamento, enum ampliado, índices únicos existentes, índice parcial de tentativa ativa e constraints/FKs de clientes, sessões, pedidos e itens. Constraints não representadas pelo Prisma foram verificadas separadamente da comparação de schema.

Os testes em PostgreSQL comprovaram rejeição por UNIQUE de tentativa ativa e orderId duplicado, deduplicação concorrente na fila e serialização entre consulta manual e webhook. Nenhuma estrutura foi corrigida manualmente no banco.

## Testes executados

| Suíte | Aprovados | Persistência |
| --- | --- | --- |
| Identificação | 9 | Consulta simulada |
| OTP | 30 | Provedor simulado |
| Autenticação | 16 | PostgreSQL isolado |
| Pedidos | 73 | PostgreSQL isolado |
| Mercado Pago | 46 | PostgreSQL isolado |
| Webhook unitário | 47 | Double transacional |
| Webhook PostgreSQL | 17 | PostgreSQL isolado |
| Total | 238 | 152 com PostgreSQL real |

Comandos: npm test; npm run test:mercado-pago; npm run test:webhook:postgres. As chamadas de SMS/Mercado Pago foram interceptadas. A nova suíte cobre assinatura inválida, ACK durável, duplicidade concorrente, reservas, índices, criação idempotente, duplo clique, pós-aprovação, revisões antigas, fencing, retry, referências/valores/métodos divergentes e varredura sem navegador.

Também aprovados: db:check, prisma migrate status, prisma migrate diff, prisma validate, lint, TypeScript sem emissão/incremental e build completo. Os testes de navegador da etapa anterior não foram repetidos: esta etapa não mudou a interface.

Cada banco de teste foi criado com nome aleatório e eliminado ao fim. Os runners restringem host, porta e banco de origem ao desenvolvimento local. Nenhuma fixture foi inserida no banco original. Não houve migrate reset, exclusão de registros originais, acesso produtivo, transação financeira, commit ou push.

## Arquivos desta etapa

- .gitignore: exclui backups do versionamento.
- scripts/check-migration-local.mjs: auditoria somente leitura e comparação de fingerprints/checksums.
- scripts/rehearse-webhook-migration.mjs: restauração e ensaio em banco temporário.
- scripts/test-auth.mjs: restrição ao PostgreSQL local e suporte à nova suíte.
- scripts/check-db.mjs: validação adicional de índices, tipos e defaults do webhook.
- tests/webhook-postgres.test.mjs: testes com PostgreSQL real.
- package.json: comando test:webhook:postgres.
- docs/webhook-orders.md e este relatório: estado local atualizado.

## Limites e próximos passos

A assinatura de uma entrega real e a infraestrutura pública continuam sem homologação. O endpoint ainda precisa de URL HTTPS, assinatura de teste configurada no painel e agendador autenticado para retries/varredura contínua. Produção permanece bloqueada. Nenhuma dessas configurações externas foi alterada.

O ambiente executa Node 26.7.0, enquanto package.json declara Node ^24.0.0. Todos os checks passaram, mas a reprodução na versão declarada continua recomendada. Não foi necessário alterar dependências ou código de pagamentos nesta validação.
