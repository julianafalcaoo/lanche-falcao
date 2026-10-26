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

Aplicar as sete migrations existentes desde a inicial (incluindo 20261025020000_otp_rate_limit), sem db push, reset, migrate dev ou edição do histórico. Elas foram testadas em bancos PostgreSQL locais novos; a compatibilidade remota ainda exige validação autorizada. Migrate deploy só altera estrutura e backfills previstos; não importa o banco local. Repetir a aplicação posteriormente não deve gerar novas mudanças. Falha parcial exige investigação, não reset. O rollback do código Vercel não reverte a estrutura do banco: mudanças futuras devem ser compatíveis com a versão anterior.

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
| INFOBIP_ALLOWED_PHONES | Opcional: lista de telefones brasileiros permitidos, separados por vírgula. Ausente permite qualquer número brasileiro válido |
| OTP_RATE_LIMIT_SECRET | Obrigatório para solicitações OTP; segredo aleatório estável de pelo menos 32 caracteres, exclusivo por ambiente |
| MERCADO_PAGO_AMBIENTE | test; qualquer outro valor bloqueia integração |
| MERCADO_PAGO_ACCESS_TOKEN | Credencial de teste compatível com Orders, somente servidor |
| MERCADO_PAGO_PUBLIC_KEY | Credencial pública de teste; fornecida apenas pela rota autenticada |
| MERCADO_PAGO_WEBHOOK_SECRET | Assinatura secreta do webhook da aplicação de teste |
| MERCADO_PAGO_RECONCILIACAO_SECRET | Segredo independente para POST do agendador externo |
| CRON_SECRET | Obrigatório para o GET do Vercel Cron diário configurado; segredo aleatório independente |

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

A lista INFOBIP_ALLOWED_PHONES é opcional também na Vercel. Ausente ou vazia permite qualquer número brasileiro válido; preenchida continua restritiva e uma lista inválida bloqueia o envio. Isso abre o cadastro, mas SMS Infobip pode gerar custos reais mesmo em homologação.

Antes de publicar em um banco novo, aplicar a migration 20261025020000_otp_rate_limit usando prisma migrate deploy no ambiente correto, com a conexão direta. No Neon já configurado neste projeto, ela foi aplicada em etapa autorizada separada: as sete migrations ficaram atualizadas, sem diferenças de schema e com as tabelas anteriores preservadas. Esta é a sétima migration e cria somente LimiteOtp, sem alterar dados existentes. Não usar reset nem db push.

Configure OTP_RATE_LIMIT_SECRET no escopo Production do projeto de homologação. Gere localmente com node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))". Não reutilizar segredo de webhook/cron; manter estável entre instâncias e deployments. A troca muda as identidades dos contadores e reinicia as cotas efetivas: tratar rotação como operação controlada. Não usar NEXT_PUBLIC_. Sem segredo válido, tabela ou banco disponível, a solicitação falha com 503 antes de chamar a Infobip.

Limites conservadores, fixos no código src/server/auth/otp-rate-limit.ts:

| Escopo | Limite |
| --- | --- |
| Telefone normalizado | 1 solicitação por 60 segundos e 5 por 24 horas |
| IP (IPv6 agregado por /64) | 5 por 15 minutos e 20 por 24 horas |
| Aplicação/banco/segredo compartilhados | 10 por 60 segundos e 100 por 24 horas |

As janelas começam na primeira reserva e expiram pelo relógio do PostgreSQL; não são janelas deslizantes nem dias do calendário. Pode haver rajada na passagem entre janelas. A reserva atômica de todas as cotas ocorre antes da chamada externa, em transação curta com UPSERT condicional e locks de linha. Recusas revertem todas as cotas daquela solicitação. Falhas e timeouts após reserva consomem cota, sem retry automático nem devolução, pois o SMS pode ter sido enviado. Excesso retorna 429, no-store e Retry-After conservador correspondente à duração da janela.

Na Vercel direta, usa-se apenas x-forwarded-for, sobrescrito pelo proxy da plataforma, exigindo um único IP válido. Não há fallback para headers enviados pelo cliente. Não hospedar este código fora da Vercel apenas definindo VERCEL=1; outro proxy exige uma política explícita de confiança. Atrás de proxy externo, o limite pode agrupar clientes pelo IP do proxy. Localmente, todos compartilham a identidade local, sem confiar em headers arbitrários. Ver [headers oficiais da Vercel](https://vercel.com/docs/headers/request-headers).

Os contadores guardam HMAC-SHA256 de escopo e identidade, quantidade e expiração; não armazenam IP ou telefone em claro nessa tabela. Desafios existentes continuam armazenando o telefone necessário ao login. Não há limpeza automática dos contadores vencidos: o índice expiraEm permite planejar retenção posterior, sem apagar dados nesta implementação. Contadores de identidades conhecidas são reutilizados.

Manter os limites Infobip documentados em docs/infobip-2fa.md, inclusive cinco tentativas, cinco minutos e uso único; os controles do provedor continuam necessários. Configurar quotas, alertas e limites de gastos no provedor e considerar Firewall/CAPTCHA para ataques distribuídos. O teto global reduz envios da aplicação, mas não é um teto monetário contratual e pode ser esgotado por um atacante, indisponibilizando OTP a clientes legítimos. Outros emissores que usem a mesma conta não passam por estes contadores. Nenhum SMS real foi enviado nesta implementação.

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

O vercel.json já configura um cron diário compatível com Hobby. Ele só será ativado após um deployment feito pelo responsável; esta preparação não faz deploy nem altera o banco remoto.

- Agendador externo: POST /api/interno/pagamentos/reconciliar, Authorization Bearer correspondente a MERCADO_PAGO_RECONCILIACAO_SECRET.
- Vercel Cron: GET da mesma rota, com CRON_SECRET. A plataforma envia esse segredo no header automaticamente. O segredo de POST não autoriza GET e vice-versa.

Nos dois casos, não usar cookie, Origin, query string ou User-Agent como autenticação. O endpoint retorna no-store e falha fechado sem segredo. Não usar um GET público de health check para disparar reconciliação.

O cron configurado roda uma vez por dia às 08:00 UTC, equivalente a 04:00 em Manaus (UTC−4). No Hobby, a precisão é por hora: pode ocorrer entre 04:00 e 04:59 em Manaus. Não há garantia de minuto exato. Cron nativo só roda em deployments Production da Vercel, não em Preview; isso independe de o projeto dedicado ser de homologação comercial. Ver [limites oficiais](https://vercel.com/docs/cron-jobs/usage-and-pricing) e [fuso UTC](https://vercel.com/docs/cron-jobs).

Configuração já incluída no arquivo (manter as demais opções de build):

```json
{
  "crons": [
    { "path": "/api/interno/pagamentos/reconciliar", "schedule": "0 8 * * *" }
  ]
}
```

Passos manuais na Vercel:

1. Gerar um segredo independente com node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" e cadastrar como CRON_SECRET no escopo Production. Não usar NEXT_PUBLIC_, segredo de webhook nem o segredo do POST.
2. Manter DATABASE_URL pooled/TLS do Neon, MERCADO_PAGO_AMBIENTE=test, MERCADO_PAGO_ACCESS_TOKEN e MERCADO_PAGO_PUBLIC_KEY de teste. DIRECT_URL não é usada pelo cron; MERCADO_PAGO_WEBHOOK_SECRET continua necessário para a rota de webhook. MERCADO_PAGO_RECONCILIACAO_SECRET só é necessário se também usar o agendador externo por POST.
3. Confirmar Fluid Compute e suporte aos 120s declarados na rota. Publicar manualmente a versão revisada; nenhuma migration é necessária para esta alteração.
4. Conferir no painel Cron Jobs o path e a expressão diária. A Vercel envia Authorization: Bearer com CRON_SECRET automaticamente. Verificar que Deployment Protection permite a execução pelo cron sem tornar a rota pública sem autenticação.
5. Acompanhar a primeira execução nos logs e seu retorno JSON. Uma execução manual pelo painel também executa reconciliação e pode atualizar estados; fazê-la conscientemente, apenas no ambiente de teste. Nunca publicar headers, segredos ou payloads completos nos logs.

Sem segredo, a rota retorna 503; Bearer ausente/incorreto retorna 401, incluindo cookies, query string e User-Agent tentando substituí-lo. Falha de infraestrutura retorna 503 sanitizado. Respostas têm Cache-Control: no-store. Não há endpoint público de diagnóstico que execute o lote.

O cron diário é uma recuperação complementar de baixíssimo volume; o webhook continua sendo o caminho principal. Não garante atualização imediata nem varredura completa de todos os pagamentos em um dia. Com lotes de duas tentativas e duas notificações, o atraso cresce conforme o histórico e a fila. Para maior volume/cadência, avaliar separadamente um agendador externo ou plano apropriado, sem adicionar cron por minuto ao Hobby.

O lote processa até duas tentativas e duas notificações. Busca de resposta perdida pode fazer duas consultas por tentativa; o limite foi reduzido para caber melhor nos 120s declarados. Respostas pagas também são consultadas para detectar estorno/contestação. Eventos com falha permanecem na fila com backoff; a plataforma não garante retries do cron. Monitorar falhas, atraso da fila, reservas vencidas e quotas. Sob carga, será necessário dimensionar lotes/filas; timers dentro de função não resolvem isso.

A seleção inclui tentativas pendentes e encerradas com Order vinculada. A consulta autenticada GET /v1/orders/{id}, validação de vínculo/valor/método e regras de transição existentes determinam o estado: pendente, aprovado, recusado, cancelado/expirado, estornado, estornado parcial e contestado. Nenhuma aprovação é inferida apenas de dados locais ou do corpo do webhook. Respostas perdidas são recuperadas por busca, sem criar cobrança. Locks, reservas, fencing, chaves de idempotência e índice de tentativa ativa foram preservados. Erros individuais ficam em codigoErro e podem coexistir com HTTP 200 do lote; isso significa que o lote terminou, não que todos os pagamentos foram reconciliados. Conferir esses erros e a fila, além do status HTTP.

## 8. Checklist antes de liberar homologação

- Node 24 e instalação reproduzível pelo lockfile.
- Auditoria de dependências sem bloqueios críticos conhecidos; repetir na data de publicação.
- Banco vazio de homologação com migrations aplicadas por conexão direta e schema conferido.
- DATABASE_URL pooled/TLS, role correta e pool pequeno; nenhum dado local importado.
- Migration de cotas OTP aplicada, OTP_RATE_LIMIT_SECRET estável e limites Infobip/abuso verificados; allowlist opcional conforme público desejado.
- Cookies seguros e Origin funcionando no domínio HTTPS.
- Webhook alcançável pelo provedor sem relaxar HMAC e sem segredos em URLs.
- Agendador autenticado e cadência compatível com o plano.
- Logs e backups privados; alertas de erros/custos configurados manualmente.
- Smoke test do cardápio, carrinho, checkout e recuperação; sandbox financeiro apenas após autorização.

## Bloqueios para produção comercial real

Não basta trocar MERCADO_PAGO_AMBIENTE: valores diferentes de test são recusados. Também permanecem fixtures de pagador, validação de e-mails de teste, rejeição de live_mode=true e falta de homologação real de cartão/3DS. Esses bloqueios não foram removidos.

Antes de produção, implementar/validar pagador real, política de credenciais/contas, 3DS, operação de estornos/contestações, tratamento de pagamentos excepcionais, suporte operacional e homologar os limites distribuídos de abuso e gastos sob carga. Planejar retenção e limpeza de desafios, sessões e fila, monitoramento, recuperação/backup e política de privacidade. A allowlist de SMS agora é opcional, com cotas persistentes obrigatórias antes dos envios.

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

## Validação da abertura de cadastro OTP

A nova migration foi testada em bancos descartáveis PostgreSQL locais e, posteriormente, aplicada no Neon em etapa autorizada separada, sem executar a suíte de testes no banco remoto. A suíte test:otp-rate-limit exercita persistência por outro Prisma Client, concorrência de telefone/IP, cotas globais/diárias, expiração, rollback de reservas recusadas, ausência de segredo/IP, falha de banco e timeout de envio. Fetch é simulado: nenhum SMS real. O runner mantém sua proteção contra destinos remotos; não executar npm test apontando para Neon. Usar ambiente local isolado para os testes de banco.

Validação desta alteração: 12 testes novos de cotas, 16 de autenticação e 41 de OTP/configuração aprovados (69 no total), além de ESLint, TypeScript e npm run build. Build com configuração sintética e credenciais externas vazias. Integração de rede com Vercel/Neon/Infobip e envio real de SMS não foram exercitados.
