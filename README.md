# Lanche Falcão

Base frontend da Home/Cardápio, pública e sem autenticação. Next.js App Router, TypeScript e Tailwind CSS 4 com estilos em `src/app/globals.css`.

## Executar

- `npm run dev`: desenvolvimento.
- `npm run lint`: ESLint.
- `npm run build`: build de produção e validação TypeScript.
- `npm start`: servir o build.

A tipografia usa fontes do sistema, sem download durante o build.

## Dados reais

`src/app/page.tsx` é o ponto de composição. Passe produtos e categorias reais ao `MenuHome`, respeitando `src/types/menu.ts`. As listas iniciais são vazias; não há fixtures ou dados comerciais fictícios.

`Category` recebe `id` e `name`, permitindo Salgados fritos, Salgados assados, Sucos, Refrigerantes e outras categorias quando cadastradas na fonte real. “Todos” é um controle da interface, não uma entidade. A pesquisa combina nome/descrição com a categoria selecionada, sem diferenciar maiúsculas ou acentos.

`Product` recebe imagem opcional, nome, descrição, preço em centavos e `categoryId`. Imagens locais podem ficar em `public`; para uma fonte externa real, configure seu domínio em `images.remotePatterns` no Next.js. Ausência de imagem tem placeholder neutro. `ProductGrid` e `ProductCard` aceitam `onAdd`; sem callback, o botão permanece desabilitado. O carrinho não está implementado.

`PromotionBanner` não renderiza sem `promotion`. O destaque institucional da Home não representa uma promoção. `whatsappNumber` é opcional, no formato internacional somente com dígitos. Sem configuração válida, o botão não abre links. Não há API ou credenciais.

## Layout e acessibilidade

Mobile-first, largura máxima de 1200px, grid de 1/2/3/4 colunas, categorias com rolagem horizontal no celular e quebra de linha em telas maiores. A navegação inferior aparece abaixo de 768px; acima disso as ações ficam no cabeçalho. Há espaço para navegação fixa e safe area, foco visível, labels e anúncio de resultados.

Sem produtos, a Home exibe um estado vazio. Quando existem produtos mas os filtros não encontram resultados, exibe uma orientação e permite limpar os filtros. Perfil e carrinho são controles indisponíveis nesta etapa e não exigem login.

## Limite desta etapa

Não há banco, APIs, autenticação, sessão, OTP, checkout, pedidos, pagamento, retirada ou fidelidade. A Home não depende de identidade do cliente. Essas funcionalidades poderão ser conectadas posteriormente; OTP e código de retirada devem continuar conceitos separados. As regras de fidelidade e pagamento não são simuladas nesta interface.
