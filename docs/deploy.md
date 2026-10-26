# Deploy de homologação: Vercel + Neon

Preparação de 25/10/2026. Este guia não habilita vendas reais. Nenhum serviço, deploy, migration remota ou cobrança foi executado pelo agente.

## Dependências e segurança

A auditoria inicial encontrou alertas críticos no Next.js 16.3.6. A preparação atualizou Next.js e eslint-config-next para 16.4.3, e Prisma CLI/Client/adapter-pg para 7.10.1. Foram atualizadas dentro das faixas compatíveis as dependências transitivas vulneráveis, incluindo fast-uri, source-map-js, mysql2 e zod. O lockfile foi atualizado; não há overrides forçando majors incompatíveis. A auditoria npm completa passou com zero vulnerabilidades conhecidas na data da validação. Repetir a auditoria antes de publicar, pois esse resultado não é permanente.

Referências das correções críticas: [Image Optimization](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) e [use cache](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr). A existência do alerta não significa que o projeto tenha sido explorado.

## Compatibilidade e limites

O App Router e as APIs usam Node.js, compatível com Vercel Functions. O Prisma 7 usa adapter-pg em JavaScript e PostgreSQL por TCP; não precisa de Edge Runtime, Docker na Vercel ou SDK Neon adicional. Neon suporta transações e locks de linha usados pelo projeto. Seus limites de conexão e PgBouncer exigem pool controlado; migrations usam conexão direta.

Node está padronizado em 24.x no package.json, .nvmrc e .node-version. O executável global da máquina não foi substituído. O Prisma Client é gerado em todo npm run build, antes de next build, evitando client antigo no cache. O build não aplica migrations nem executa seed. Instalar com npm ci incluindo devDependencies, pois Prisma CLI, TypeScript e ferramentas de build estão nelas. Não usar npm ci --omit=dev para o build.

Credenciais, sessões, desafios, idempotência e fila persistem no banco. Locks em memória não são usados como proteção financeira entre instâncias. Não escrever em disco nem manter cron em setInterval nas funções. after processa o webhook após a resposta, dentro da duração da função; sua execução não substitui a fila durável e o agendador.

## 1. Separar os ambientes

| Ambiente | Aplicação e banco | SMS e pagamentos |
| --- | --- | --- |
| Desenvolvimento | Docker local já existente | Configuração local preservada |
| Homologação | Projeto Vercel separado + banco/branch Neon vazio | Infobip de teste com destinatários autorizados; Mercado Pago test |
| Produção futura | Outro projeto/ambiente e banco isolado | Não habilitado pelo código atual |

Recomenda-se um projeto Vercel dedicado à homologação, com domínio estável. Ele pode usar o slot denominado Production pela Vercel, mas continua sendo homologação comercial: NODE_ENV=production significa build otimizado e cookies seguros, não autorização para cobrar. VERCEL_ENV também não seleciona o modo financeiro. MERCADO_PAGO_AMBIENTE=test continua obrigatório para pagamentos.

Previews de branches não devem receber credenciais de produção nem compartilhar banco de produção. Use um banco descartável vazio por preview ou desabilite esses deployments até existir configuração isolada. A aplicação requer DATABASE_URL para gerar/configurar o client no build; não apontar Preview para produção para contornar a ausência dessa variável. Não criar branch Neon derivado de produção com dados pessoais como atalho para testar. Não restaurar backups locais no Neon.

## 2. Criar/configurar Neon manualmente

1. Escolher um projeto/banco PostgreSQL vazio de homologação, avaliando limites e custos no painel antes de confirmar qualquer serviço. PostgreSQL 17 é a referência local.
2. Escolher região próxima à região das funções Vercel, segundo as opções disponíveis. Não selecionar regiões por suposição.
3. No painel Connect, obter a conexão pooled (hostname com -pooler) e a direct do mesmo banco/branch. Não colocá-las em tickets, screenshots ou repositório.
4. Usar TLS: manter sslmode=require ou verify-full na URL. Nunca usar rejectUnauthorized=false. O runtime na Vercel rejeita localhost e ausência de sslmode seguro.
5. Planejar permissões: role da aplicação para suas tabelas; migrations por role autorizada a alterar schema. Não usar role administrativa de teste em serviços públicos.

DATABASE_URL é a conexão pooled da aplicação. DIRECT_URL é lida somente pela CLI em prisma.config.ts, com fallback para DATABASE_URL no desenvolvimento. No remoto, configure DIRECT_URL explicitamente para migrations. Não é necessário cadastrar DIRECT_URL no runtime da Vercel se as migrations forem executadas fora do build.

O pool padrão por instância em produção é 3, com conexão em até 10s, idle de 10s e renovação em 300s; DATABASE_POOL_MAX permite 1–20. Não aumentar sem medir. O limite é por instância, não global: várias funções somam conexões. O pooler Neon continua necessário. Reuso de módulo não garante reuso entre instâncias/congelamentos; acompanhar conexões, cold starts, latência e quotas. PgBouncer em transaction mode é compatível com os locks atuais dentro de transações; não adicionar locks advisory de sessão, LISTEN ou SET persistente no runtime.

### Aplicar migrations remotamente — somente como ação manual posterior

Esta preparação não executa os comandos abaixo no Neon. Num terminal confiável com Node 24 e o checkout revisado, criar arquivo privado .env.homologacao.local com DATABASE_URL e DIRECT_URL obtidas do banco de homologação. O arquivo é ignorado pelo Git. Não reutilizar .env local, não carregar dados de backup e não compartilhar credenciais.

Antes de executar, conferir visualmente no painel que endpoint, branch, database e role são de homologação. Não imprimir URLs. Executar somente após essa confirmação manual:

```powershell
node --env-file=.env.homologacao.local node_modules/prisma/build/index.js migrate status
node --env-file=.env.homologacao.local node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.homologacao.local node_modules/prisma/build/index.js migrate status
node --env-file=.env.homologacao.local node_modules/prisma/build/index.js migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Aplicar as seis migrations existentes desde a inicial, sem db push, reset, migrate dev ou edição do histórico. Elas foram testadas em bancos PostgreSQL locais novos; a compatibilidade remota ainda exige validação autorizada. Migrate deploy só altera estrutura e backfills previstos; não importa o banco local. Repetir a aplicação posteriormente não deve gerar novas mudanças. Falha parcial exige investigação, não reset. O rollback do código Vercel não reverte a estrutura do banco: mudanças futuras devem ser compatíveis com a versão anterior.

Os scripts test-auth, auditoria local e ensaio de backup são restritos ao PostgreSQL local e não devem ser apontados para Neon. Os runners sobrescrevem também DIRECT_URL no processo filho para não migrar acidentalmente outro banco.

## 3. Variáveis de ambiente

Cadastre valores no painel, por projeto/escopo. Nenhum segredo existente foi copiado ou alterado. Após mudanças, refazer o deployment para carregá-las. Não usar NEXT_PUBLIC_ nas variáveis abaixo.

| Variável | Uso e configuração |
| --- | --- |
| DATABASE_URL | Build/runtime Vercel: conexão pooled TLS de homologação |
| DIRECT_URL | Terminal/CI de migrations: conexão direta do mesmo banco; dispensável no runtime |
| DATABASE_POOL_MAX | Opcional; 3 é o padrão de produção por instância |
| INFOBIP_API_BASE_URL | Origem HTTPS da API da conta, validada pelo adaptador |
| INFOBIP_API_KEY | Chave exclusivamente server-side da conta de homologação |
| INFOBIP_2FA_APPLICATION_ID | Aplicação 2FA separada para homologação |
| INFOBIP_2FA_MESSAGE_ID | Template de quatro dígitos dessa aplicação |
| INFOBIP_ALLOWED_PHONES | Lista de telefones brasileiros de testadores, separados por vírgula; obrigatória na Vercel |
| MERCADO_PAGO_AMBIENTE | test; qualquer outro valor bloqueia integração |
| MERCADO_PAGO_ACCESS_TOKEN | Credencial de teste compatível com Orders, somente servidor |
| MERCADO_PAGO_PUBLIC_KEY | Credencial pública de teste; fornecida apenas pela rota autenticada |
| MERCADO_PAGO_WEBHOOK_SECRET | Assinatura secreta do webhook da aplicação de teste |
| MERCADO_PAGO_RECONCILIACAO_SECRET | Segredo independente para POST do agendador externo |
| CRON_SECRET | Segredo independente para GET do Vercel Cron, caso escolhido |

VERCEL, VERCEL_ENV e NODE_ENV são variáveis da plataforma: não cadastrar manualmente para forçar comportamento. Não definir NODE_ENV=development na hospedagem para tentar habilitar testes.

INFOBIP_TEST_PHONE é usado apenas pelo script diagnóstico manual local e não pertence à configuração de deploy. AUTH_TEST_DATABASE é exclusivo do runner isolado. Não publicar essas variáveis nem executar setup-infobip/test-infobip como parte de build.

## 4. Publicar na Vercel manualmente

1. Revisar as alterações e os arquivos novos. Não publicar apenas os arquivos já rastreados: parte da integração ainda estava fora de commits. Fazer o versionamento/publicação por iniciativa própria, sem incluir .env, backups ou .tools.
2. Importar o repositório no projeto exclusivo de homologação. Framework Next.js, raiz do projeto, Node 24.x. Manter Fluid Compute habilitado para suportar os limites de duração declarados.
3. Configurar as variáveis do escopo que será publicado. Não compartilhar automaticamente secrets entre Preview e Production. Preparar o banco antes de permitir checkout.
4. Manter Install Command npm ci e Build Command npm run build, conforme vercel.json. Não acrescentar migrations ao build e não executar npm test na Vercel: os testes de banco exigem PostgreSQL local isolado.
5. Escolher região de Functions próxima do Neon. Confirmar no plano suporte às durações: webhook 60s, reconciliação 120s. Planos sem Fluid Compute podem ter limites menores; não ignorar timeout do worker.
6. Disparar o deployment manual e conferir logs sem registrar headers, cookies, payloads de cartão, URLs de banco ou corpos de resposta externos.
7. Abrir somente HTTPS. Confirmar cookie __Host-lf_session com Secure, HttpOnly, SameSite=Lax, Path=/ e sem Domain. Confirmar login, refresh, logout e que /api/auth/me não é cacheado.
8. Testar requisições de checkout no domínio canônico. A proteção de mutações compara Origin com a URL da requisição; não adicionar wildcard nem confiar em headers encaminhados arbitrários para resolver falha de origem.

Cabeçalhos nosniff, Referrer-Policy e X-Frame-Options foram adicionados. Não se adicionou CSP restritiva sem homologar o Brick, pois bloquear domínios/scripts/frames do Mercado Pago quebraria cartão. Criar política CSP específica após medir os recursos reais; não usar curingas como suposta proteção.

## 5. OTP e proteção da homologação

O envio de SMS na Vercel falha fechado sem INFOBIP_ALLOWED_PHONES válido. Apenas números normalizados dessa lista podem receber desafios; no local a lista continua opcional. A verificação OTP e os cookies existentes foram preservados. A lista contém dados pessoais e deve ficar apenas no painel privado.

Isso não substitui rate limiting. Ainda não existe limitador distribuído próprio por IP/telefone. Não abrir cadastro irrestrito ao público. Configurar limites de aplicação/telefone/tentativas na Infobip conforme docs/infobip-2fa.md e avaliar regras de Firewall/rate limiting da Vercel disponíveis no plano. Autenticação por SMS pode gerar custos mesmo em homologação; o agente não enviou SMS e testes reais exigem sua decisão explícita.

Deployment Protection pode restringir a navegação aos testadores, mas também bloquear o webhook antes de chegar ao handler. Não declarar homologação completa enquanto o Mercado Pago receber a tela de autenticação da Vercel. Conferir opções de exceção por rota/domínio no plano; não desligar toda proteção sem avaliar a exposição. Se o plano não permitir disponibilizar o callback de forma apropriada, deixar essa etapa pendente. Não colocar segredo de bypass em URL de webhook: isso pode aparecer em logs e painéis. Para agendador que suporta headers, o bypass de plataforma e o Bearer da aplicação são autorizações distintas.

## 6. Mercado Pago Orders

No painel da aplicação de teste, configurar a URL estável:

```text
https://<dominio-de-homologacao>/api/webhooks/mercado-pago
```

O provedor acrescenta data.id e type=order à URL. Não definir webhook por deployment temporário que perderá o domínio. Selecionar Orders, obter assinatura de teste e cadastrá-la como MERCADO_PAGO_WEBHOOK_SECRET. Não apontar o webhook de produção para homologação ou vice-versa. Não usar a rota interna de reconciliação como callback.

HMAC usa node:crypto, compatível com Node serverless, sem arquivos locais ou IP fixo. Mantém tolerância de cinco minutos e valores assinados originais. O corpo não é autoridade: a Order é consultada pelo ID vinculado à tentativa. Duplicidade, reservas e fencing persistem no PostgreSQL. Validar uma entrega real assinada e o comportamento de after na hospedagem antes de considerar o callback homologado. O simulador com Order sem vínculo local pode receber ACK e permanecer pendente; isso não prova aprovação.

Pix usa fixture de pagador de teste; cartão usa Brick e dados oficiais de teste. Não usar cartão pessoal, pagar QR real ou trocar credenciais por suposição sobre prefixos. A Public Key pode chegar ao navegador; Access Token, assinatura e cookies não podem. O teste remoto de sandbox continua pendente de autorização específica.

## 7. Agendador de reconciliação

Nenhum cron foi ativado no vercel.json. Escolher uma das opções manualmente:

- Agendador externo: POST /api/interno/pagamentos/reconciliar, Authorization Bearer correspondente a MERCADO_PAGO_RECONCILIACAO_SECRET.
- Vercel Cron: GET da mesma rota, com CRON_SECRET. A plataforma envia esse segredo no header automaticamente. O segredo de POST não autoriza GET e vice-versa.

Nos dois casos, não usar cookie, Origin, query string ou User-Agent como autenticação. O endpoint retorna no-store e falha fechado sem segredo. Não usar um GET público de health check para disparar reconciliação.

A frequência recomendada para o lote atual é um minuto durante testes ativos, dimensionando conforme volume. Vercel Hobby permite apenas cron diário e não atende essa cadência. Avaliar um agendador externo existente com POST/headers, ou plano que suporte a frequência, sem contratar automaticamente. Cron nativo só roda em deployments Production da Vercel, não em Preview; isso independe de o projeto dedicado ser de homologação comercial.

Se o plano permitir, adicionar manualmente ao vercel.json depois da configuração do segredo:

```json
{
  "crons": [
    { "path": "/api/interno/pagamentos/reconciliar", "schedule": "* * * * *" }
  ]
}
```

Mesclar esse trecho com as opções existentes, sem sobrescrever o arquivo inteiro. Não aplicar esse cron minutely num plano Hobby. Cron diário pode servir para diagnóstico de baixíssimo volume, mas não é reconciliação contínua de pagamentos.

O lote processa até duas tentativas e duas notificações. Busca de resposta perdida pode fazer duas consultas por tentativa; o limite foi reduzido para caber melhor nos 120s declarados. Respostas pagas também são consultadas para detectar estorno/contestação. Eventos com falha permanecem na fila com backoff; a plataforma não garante retries do cron. Monitorar falhas, atraso da fila, reservas vencidas e quotas. Sob carga, será necessário dimensionar lotes/filas; timers dentro de função não resolvem isso.

## 8. Checklist antes de liberar homologação

- Node 24 e instalação reproduzível pelo lockfile.
- Auditoria de dependências sem bloqueios críticos conhecidos; repetir na data de publicação.
- Banco vazio de homologação com migrations aplicadas por conexão direta e schema conferido.
- DATABASE_URL pooled/TLS, role correta e pool pequeno; nenhum dado local importado.
- Somente destinatários autorizados no OTP, limites Infobip e controle de acesso/abuso verificados.
- Cookies seguros e Origin funcionando no domínio HTTPS.
- Webhook alcançável pelo provedor sem relaxar HMAC e sem segredos em URLs.
- Agendador autenticado e cadência compatível com o plano.
- Logs e backups privados; alertas de erros/custos configurados manualmente.
- Smoke test do cardápio, carrinho, checkout e recuperação; sandbox financeiro apenas após autorização.

## Bloqueios para produção comercial real

Não basta trocar MERCADO_PAGO_AMBIENTE: valores diferentes de test são recusados. Também permanecem fixtures de pagador, validação de e-mails de teste, rejeição de live_mode=true e falta de homologação real de cartão/3DS. Esses bloqueios não foram removidos.

Antes de produção, implementar/validar pagador real, política de credenciais/contas, 3DS, operação de estornos/contestações, tratamento de pagamentos excepcionais, suporte operacional e limites distribuídos de abuso. Planejar retenção e limpeza de desafios, sessões e fila, monitoramento, recuperação/backup e política de privacidade. A allowlist de SMS precisa ser substituída conscientemente por controles adequados de acesso público, não simplesmente apagada.

Vercel Hobby é para uso pessoal não comercial; validar elegibilidade/plano antes de operar uma lanchonete comercialmente. Avaliar também limites/custos Neon, SMS e agendador. Nenhum plano pago foi criado ou contratado.

## Referências oficiais consultadas

Validação desta preparação: Node 24.22.1 portátil local, 299 testes aprovados (249 backend/configuração, incluindo 152 com PostgreSQL isolado, e 50 Playwright), lint, TypeScript e build completo. O build foi executado com VERCEL=1, URL PostgreSQL sintética com TLS e credenciais externas vazias, demonstrando que a geração não precisa consultar banco remoto nem aplicar migrations. npm audit completo retornou zero vulnerabilidades conhecidas. As seis migrations foram reaplicadas pelos runners em bancos locais novos, nunca no Neon; os registros locais anteriores permaneceram idênticos ao baseline.

- [Node suportado pela Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Duração de funções](https://vercel.com/docs/functions/configuring-functions/duration)
- [Cron, autenticação e limites](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Plano Hobby](https://vercel.com/docs/plans/hobby)
- [Deployment Protection e automação](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
- [Prisma na Vercel](https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel)
- [Prisma e Neon](https://neon.com/docs/guides/prisma)
- [Pooling Neon](https://neon.com/docs/connect/connection-pooling)
- [Notificações Mercado Pago Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications)

Versões e limites foram consultados nesta preparação e devem ser reconferidos no painel antes de publicar. Os testes locais não comprovam conectividade, quotas, permissões ou entrega de callbacks no serviço remoto.
