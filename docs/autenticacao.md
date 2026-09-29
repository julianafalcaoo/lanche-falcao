# Autenticação do cliente

O backend usa Infobip 2FA para provar posse do telefone e PostgreSQL para persistir desafios e sessões. O frontend ainda não está conectado. Não há pedidos ou pagamentos nesta etapa.

## Contrato HTTP

Todas as respostas usam `Cache-Control: no-store`. As mutações exigem `Content-Type: application/json` e `Origin` exatamente igual à origem da URL da requisição. Origem externa, ausente ou `null` é recusada com 403; `Sec-Fetch-Site` externo também é recusado. Isso protege inclusive contra login CSRF. Clientes técnicos precisam enviar Origin. Ao publicar atrás de proxy, garantir que a URL percebida pelo Next corresponda à origem pública; não confiar em headers encaminhados arbitrários.

| Rota | Entrada | Resposta |
| --- | --- | --- |
| POST `/api/auth/otp/solicitar` | `{ "nome": "Maria", "telefone": "<telefone com DDD>" }` | 200 `{ "enviado": true, "desafioId": "<id opaco>" }` |
| POST `/api/auth/otp/verificar` | `{ "desafioId": "<id opaco>", "codigo": "<4 dígitos>" }` | 200 `{ "verificado": true, "autenticado": true }` e cookie |
| GET `/api/auth/me` | Cookie de sessão | 200 `{ "autenticado": true, "cliente": { "nome": "...", "telefone": "..." } }`; sem sessão válida: 401 `{ "autenticado": false }` |
| POST `/api/auth/logout` | Cookie, cabeçalhos de mutação, corpo `{}` | 200 `{ "autenticado": false }`, revogação no banco e limpeza do cookie |

O nome é texto obrigatório, com trim, entre 1 e 100 caracteres, sem caracteres de controle. O telefone usa o helper brasileiro existente e formato E.164. Não se consulta nem revela a existência do Cliente antes da prova de posse. O endpoint antigo de identificação continua sem autenticar ou expor existência de cadastro.

## Desafio persistente

`DesafioOtp` guarda ID aleatório de 256 bits, nome, telefone, pinId, criação, expiração, estado e consumo. Não possui coluna para código OTP. O pinId da Infobip nunca é retornado pelas rotas públicas; a verificação usa exclusivamente o vínculo salvo no banco, ignorando qualquer telefone/nome/pinId extra no body.

Validade de cinco minutos, contada antes da chamada de envio. Cada solicitação faz no máximo um envio, sem retries. A resposta indica aceitação, não entrega do SMS. Se a gravação do desafio falhar depois de a Infobip aceitar o SMS, a rota falha e não reenvia automaticamente.

Estados: `PENDENTE → PROCESSANDO → CONSUMIDO`. Uma atualização condicional atômica reserva o desafio antes da chamada externa, sem manter transação de banco aberta durante a rede. Submissões concorrentes/repetidas recebem 409 e não fazem outra verificação. Código incorreto e rate limit inequívoco reabrem o desafio; expiração, tentativas esgotadas ou falha ambígua invalidam-no. Os limites de tentativas continuam na Infobip.

Após aprovação, uma transação consome o desafio, faz upsert nativo do Cliente e cria a sessão. A restrição UNIQUE do telefone impede duplicados; o upsert só atualiza `telefoneVerificado`, preservando o nome existente. O nome do desafio só é utilizado para Cliente novo.

Não existe transação distribuída entre Infobip e PostgreSQL. Se o processo cair após a reserva, ou o commit falhar depois da aprovação externa, o desafio fica bloqueado (`PROCESSANDO`) e exige novo desafio: nunca presumimos aprovação nem repetimos automaticamente a consulta externa. A transação local impede Cliente criado parcialmente ou sessão sem consumo. Se a resposta com cookie se perder após commit, também é necessário novo desafio; não se reemite o token pelo mesmo desafio.

Erros locais: 400 entrada inválida, 403 origem recusada, 415 conteúdo inválido, 422 nome/telefone/código incorretos, 404 desafio inexistente, 410 expiração, 409 desafio indisponível, 429 limite/tentativas, 502 resposta/rejeição do provedor, 503 indisponibilidade/configuração. Respostas não contêm detalhes de banco, stack, OTP, credenciais ou tokens.

## Sessão

`Sessao` armazena hash SHA-256 de token aleatório de 256 bits (`crypto.randomBytes`), Cliente e datas. O token bruto só existe em memória até ser enviado no cookie; não é persistido no banco, JSON ou logs. SHA-256 é adequado para esse segredo de alta entropia; não se trata de senha humana. A consulta usa o hash, índice UNIQUE e expiração server-side; não há comparação de token bruto no banco.

Cookie em desenvolvimento: `lf_session`. Em produção: `__Host-lf_session`, com `Secure`. Ambos: `HttpOnly`, `SameSite=Lax`, `Path=/`, sem Domain, `Max-Age=2592000` e Expires. Duração absoluta de **30 dias**, sem renovação silenciosa ou refresh token. A persistência no cookie e banco permite refresh, navegação e reabertura do navegador enquanto válido. Produção requer HTTPS.

Novo login gera token novo e revoga a sessão apresentada anteriormente. Logout remove a sessão atual e apaga o cookie, sem alterar Cliente ou telefoneVerificado. Outras sessões de dispositivos distintos permanecem válidas. GET `/me` só expõe nome e telefone após validar sessão e telefoneVerificado.

## Banco e testes

Migration: `20260929040000_auth_desafio_sessao`. Adiciona DesafioOtp, Sessao, enum, índices e FK para Cliente. Não modifica a migration inicial nem adiciona colunas de autenticação ao Cliente.

```bash
npm run db:migrate
npm test
npm run lint
npm run build
npm run db:check
```

`test:auth` cria um banco descartável de nome aleatório no mesmo PostgreSQL, aplica migrations, executa handlers reais com fetch interceptado e remove o banco no finally. Exige permissão de criação/remoção de banco no ambiente de desenvolvimento. O teste se recusa a usar o banco da aplicação. Nenhum SMS real é enviado. As suítes anteriores de identificação e adaptador OTP continuam executáveis.

As datas são verificadas em cada acesso; expiração não depende de limpeza física. Um job operacional de remoção de desafios/sessões expirados ainda não foi implementado. Antes de disponibilizar o serviço publicamente, definir retenção desses metadados pessoais e agendar a limpeza.

`.env` permanece local e ignorado; valores reais não devem ser copiados para documentação, testes ou `.env.example`. O script técnico `test-infobip-otp.mjs` continua exclusivo para diagnóstico manual e não cria sessão/Cliente. Não o executar para testes automatizados ou sem autorização para SMS real.

Referências: [Infobip 2FA](https://www.infobip.com/docs/2fa-service/using-2fa-api) e [OWASP — gerenciamento de sessão](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
