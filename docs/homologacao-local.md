# Ambiente local de homologação

Use Node.js 24.x. No workspace Windows, o binário local está em `.tools/node24.exe`. Confirme com `node --version` antes de usar um Node do PATH.

O projeto Docker `lanche-falcao-homologacao` usa PostgreSQL 17 em `127.0.0.1:5543`, banco `lanche_falcao_homologacao`, role `lanche_homologacao` e volume dedicado `lanche-falcao-homologacao_postgres_homologacao`. O contêiner usa uma rede bridge própria com comunicação entre contêineres e mascaramento IP desativados. A autenticação do banco usa confiança local sem senha. Use somente dados sintéticos, pois processos locais podem acessar essa porta.

O launcher valida o contexto do Docker Desktop, a configuração, a rede e o volume. Antes de chamar o Prisma, compara a identidade do PostgreSQL consultada dentro do contêiner e pela porta TCP. O destino das duas URLs é fixado no processo filho. Uma URL herdada ou configurada para outro destino interrompe a execução sem imprimir o valor.

## Subir, verificar e preparar

Execute na raiz do projeto. Para usar o Node do PATH, confirme primeiro que ele é da série 24.x.

```powershell
& './.tools/node24.exe' scripts/homologacao.mjs up
& './.tools/node24.exe' scripts/homologacao.mjs check
& './.tools/node24.exe' scripts/homologacao.mjs migrate
& './.tools/node24.exe' scripts/homologacao.mjs test
& './.tools/node24.exe' scripts/homologacao.mjs build
& './.tools/node24.exe' scripts/homologacao.mjs start
```

`up` usa a imagem PostgreSQL 17 já disponível localmente. `migrate` aplica o histórico no banco confirmado, verifica o status e compara o schema Prisma. `test` executa OTP, contratos de pagamento, webhook e deploy com serviços simulados, em processos separados. As suítes existentes que criam bancos descartáveis na porta 5433 têm outro runner.

A aplicação escuta em `http://127.0.0.1:3106`. O launcher usa o build local do Next.js, valida o banco antes de iniciar e mantém Mercado Pago e Infobip desativados por padrão. Se o launcher bloquear URLs herdadas, abra um terminal dedicado ou remova apenas essas duas variáveis da sessão antes de repetir.

```powershell
Remove-Item Env:DATABASE_URL, Env:DIRECT_URL -ErrorAction SilentlyContinue
```

## Conectar somente serviços de teste

Depois da autorização para homologar, use `.env.homologacao.example` como modelo para criar `.env.homologacao.local`, ignorado pelo Git. Preserve os arquivos existentes e as URLs locais do modelo.

- Confira no painel do Mercado Pago que Public Key, Access Token e segredo de webhook pertencem à aplicação de teste configurada para Orders. O código não consegue comprovar essa origem a partir do formato das chaves. Use cartões oficiais de teste.
- Na aba de teste dessa aplicação, use um endpoint HTTPS dedicado que encaminhe somente o webhook de homologação a `/api/webhooks/mercado-pago`. A porta local da aplicação permanece em loopback. Confira a notificação associada a uma Order do sandbox e o processamento da fila após a consulta autenticada.
- Para testar OTP, preencha as variáveis Infobip, o segredo de rate limit e a lista `INFOBIP_ALLOWED_PHONES` exclusivamente com destinatários autorizados. Deixe todos os campos de OTP vazios enquanto o envio não estiver autorizado.

Após conferir a origem das credenciais, inicie explicitamente o perfil de serviços de teste.

```powershell
& './.tools/node24.exe' scripts/homologacao.mjs start --servicos-de-teste
```

Para parar apenas o banco de homologação, preservando o volume:

```powershell
docker --context desktop-linux compose --file compose.homologacao.yaml --env-file .env.homologacao.example --project-name lanche-falcao-homologacao stop postgres
```
