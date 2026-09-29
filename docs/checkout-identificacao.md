# Identificação no checkout

O checkout consulta `GET /api/auth/me` ao entrar, sem exibir o formulário enquanto a sessão é desconhecida. Falhas mostram uma ação de tentar novamente; 401 abre Nome/Celular; sessão válida mostra o cliente identificado.

O hook `use-current-customer` cuida apenas da sessão. `customer-identification` controla Nome/Celular e mantém `desafioId` somente em memória. `otp-verification` recebe quatro dígitos em campo com autofill `one-time-code`; o código não é persistido. O navegador só chama APIs internas, nunca recebe pinId, credenciais Infobip ou token no JSON.

Envio usa `{nome, telefone}`; verificação usa `{desafioId, codigo}`. Após sucesso, o desafio é descartado e uma nova consulta `/me` define o cliente exibido. O cookie HttpOnly continua sob responsabilidade do backend. Não há flags de login nem autenticação em localStorage/sessionStorage.

Há bloqueio imediato de submissões duplicadas e mensagens amigáveis para códigos incorretos, expirados, limites e falhas. Reenvio é sempre manual, sem contagem regressiva inventada: usa solicitar, limpa o campo e substitui o desafio. Resultado ambíguo não mantém o desafio anterior disponível. Alterar celular limpa desafio/código, preserva Nome/Celular e não envia SMS. Refresh durante o OTP perde o desafio e permite iniciar novamente.

`useCheckoutDraft` permanece separado e preserva Retirada/Entrega e endereço em sessionStorage. Carrinho mantém a persistência existente. Sair chama logout e não apaga nenhum desses dados.

Continuar exige cliente identificado, carrinho com itens, tipo escolhido e endereço válido para Entrega. Por enquanto mostra apenas que a próxima etapa será pagamento; não cria pedido, navega para pagamento ou limpa dados.

Estilos em `customer-identification.module.css`, com um ajuste de botão desabilitado no módulo existente do checkout. Nenhum estilo adicionado ao globals.css.

## Testes no navegador

```bash
npx playwright install chromium
npm run test:checkout
```

Playwright inicia um servidor exclusivo em `127.0.0.1:3100`, intercepta todas as APIs e bloqueia requisições externas. As quatro configurações Infobip são desabilitadas nesse processo como proteção adicional. Não reutiliza um servidor existente. Os dados são fictícios, apenas no contexto isolado do navegador; não cria Cliente no banco e não envia SMS.

Testes cobrem sessão/carregamento/erro, validação e foco, duplo clique, OTP e erros, novo código, troca de celular, refresh, logout, persistência, Retirada/Entrega e ausência de overflow em 320, 375, 430, 768, 1024 e 1440 px. Consulte também `npm test` para as suítes do backend.

O teste de navegador usa respostas controladas; o envio real já comprovado não é repetido. Qualquer novo SMS real exige autorização explícita. Pagamento, pedidos, fidelidade e código de retirada não fazem parte desta etapa.
