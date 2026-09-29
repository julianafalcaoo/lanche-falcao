# Lanche Falcão

Sistema de pedidos do Lanche Falcão, em desenvolvimento como parte da disciplina Projeto Integrador. A aplicação permite consultar os produtos da lanchonete, visualizar imagens, descrições e preços e encontrar opções por categoria ou pesquisa, além de realizar pedidos.

A interface é responsiva, adaptada para celulares, tablets e computadores, e utiliza a identidade visual do Lanche Falcão, localizado na ilha da magia (Parintins/AM).

## Funcionalidades

- Cardápio com 26 produtos, incluindo salgados, sucos, vitamina de abacate e refrigerantes.
- Filtros por categoria: Tudo, Salgados fritos, Salgados assados, Sucos e Refrigerantes.
- Pesquisa por nome ou descrição, sem diferenciar maiúsculas, minúsculas ou acentos.

## Tecnologias utilizadas

- **Next.js 16** — framework React com App Router.
- **React 19** — construção da interface em componentes.
- **TypeScript 5** — tipagem estática.
- **Tailwind CSS 4 e CSS** — estilização e layout responsivo.
- **ESLint 9** — análise estática do código.
- **npm** — gerenciamento de dependências e execução de scripts.
## APIS USADAS
- SMS -> INFOBIP
- PROCURAR END POR CEP -> VIACEP
- PAGAMENTOS -> MERCADO PAGO
- GPS ->
## Executar localmente

Com Node.js e npm instalados, execute na pasta do projeto:

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000` no navegador.

## Estrutura do projeto

```text
src/
├── app/                 # Páginas, layout e estilos globais
├── components/          # Componentes de interface e do cardápio
├── data/                # Dados locais do cardápio
└── types/               # Tipos dos produtos e categorias
public/
└── images/              # Logo e imagens dos produtos e categorias
```

Ao final será feito deploy do site.