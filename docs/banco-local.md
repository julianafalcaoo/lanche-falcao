# Banco de dados local

A infraestrutura usa PostgreSQL 17 em Docker Compose e Prisma 7.10.0. O Next.js continua sendo executado diretamente com npm. Utilize Node.js 24 LTS.

## Preparação

Com Docker Desktop iniciado e usando containers Linux, execute na raiz do projeto:

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d --wait
npm run db:migrate
npm run db:generate
npm run db:check
npm run dev
```

Copie o arquivo de ambiente somente se ainda não existir um `.env`. Esse arquivo está ignorado pelo Git.

## Conexão

- Serviço: `postgres`.
- Container padrão: `lanche-falcao-postgres-1`.
- Endereço: `127.0.0.1:5433`.
- Banco: `lanche_falcao`.
- Usuário e senha locais: `postgres` / `postgres`.
- Variável: `DATABASE_URL`, carregada de `.env` pela CLI do Prisma e pelo Next.js.

A porta 5433 evita conflito com o container existente que ocupa 5432. A publicação está limitada ao loopback. As credenciais são exclusivamente de desenvolvimento.

O volume nomeado `lanche-falcao_postgres_data` preserva os dados entre reinícios. `docker compose stop` para o banco sem apagar o volume; `docker compose start` o inicia novamente. Não use `down -v` se quiser preservar os dados.

## Prisma

O schema contém apenas `Cliente`: UUID gerado pelo PostgreSQL, nome obrigatório, telefone obrigatório e único, telefoneVerificado com default false e datas automáticas.

`criadoEm` e o valor inicial de `atualizadoEm` têm default no banco. A atualização de `atualizadoEm` é feita pelo Prisma com `@updatedAt`; alterações SQL diretas não executam essa automação.

Importe a instância central de `src/lib/prisma.ts` somente em código de servidor. Ela usa o adaptador PostgreSQL e reutiliza a instância durante hot reload em desenvolvimento.

- `npm run db:migrate`: aplica migrations existentes.
- `npm run db:migrate:dev -- --name nome_da_migration`: cria e aplica mudanças futuras em desenvolvimento.
- `npm run db:generate`: gera o Prisma Client.
- `npm run db:check`: consulta os metadados e conta clientes, sem inserir registros.
- `npm run build`: gera o client antes do build do Next.js.

Produtos continuam em `src/data/menu.ts`. Não há seed, APIs de clientes ou autenticação nesta etapa.
