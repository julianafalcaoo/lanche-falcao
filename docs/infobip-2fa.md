# Configuração Infobip 2FA

As credenciais e os IDs ficam somente no `.env` local:

- `INFOBIP_API_BASE_URL`: origem HTTPS da API da conta.
- `INFOBIP_API_KEY`: chave com permissão para configurar 2FA.
- `INFOBIP_2FA_APPLICATION_ID`: ID da aplicação.
- `INFOBIP_2FA_MESSAGE_ID`: ID do template.

Não use prefixo `NEXT_PUBLIC_` nessas variáveis.

## Comandos

```bash
node scripts/setup-infobip-2fa.mjs --check
node scripts/setup-infobip-2fa.mjs
```

O primeiro comando apenas consulta. O segundo reutiliza os IDs ou procura a aplicação pelo nome e o template pelo texto antes de criar recursos ausentes. Os IDs são gravados assim que cada criação é concluída; outras variáveis do arquivo são preservadas. Recursos ambíguos ou divergentes interrompem a configuração.

O script usa fetch do Node 24 e autenticação `Authorization: App`, sem SDK adicional. Não imprime a chave e não faz novas tentativas automáticas em caso de erro. Um lock local impede duas execuções simultâneas. Em falhas de rede após um POST, consulte os recursos existentes antes de repetir a operação.

## Configuração solicitada

Aplicação: **Lanche Falcao**, habilitada.

- `pinAttempts: 5`
- `pinTimeToLive: "5m"`
- `allowMultiplePinVerifications: false`
- `verifyPinLimit: "1/3s"`
- `sendPinPerApplicationLimit: "1000/1d"`
- `sendPinPerPhoneNumberLimit: "5/1d"`

Template:

- `pinType: "NUMERIC"`
- `pinLength: 4`
- `senderId: "ServiceSMS"`
- Texto: `Seu codigo de verificacao do Lanche Falcao e {{pin}}`

A aceitação do sender na criação do template não representa teste de entrega de SMS. Nenhum endpoint de envio ou verificação de PIN é chamado pelo script.

A configuração não altera banco, frontend ou autenticação de clientes.

Referência: [API oficial Infobip 2FA](https://www.infobip.com/docs/2fa-service/using-2fa-api).

## Fluxo atual de autenticação

As rotas públicas agora usam desafios persistidos no servidor e sessões seguras. Consulte [Autenticação do cliente](./autenticacao.md) para os contratos atuais, cookies, migrations e testes. O navegador recebe desafioId, nunca o pinId da Infobip.

O adaptador server-side continua usando os endpoints oficiais POST /2fa/2/pin e POST /2fa/2/pin/{pinId}/verify, sem retries. Os testes do adaptador usam fetch simulado.

O script test-infobip-otp.mjs permanece apenas como ferramenta técnica manual: não cria Cliente ou sessão e não deve ser usado como fluxo do navegador. Novo SMS real exige autorização explícita. O teste real de envio e verificação já foi comprovado; os testes de autenticação não precisam gastar SMS.
