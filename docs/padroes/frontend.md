# Frontend no Studio

## Base

- Vue 3 com Composition API e `<script setup lang="ts">`, como o Studio. O `vue-tsc` confere os tipos.
- As superfícies (layout, módulo, painel e as opções da operação de Flow) usam os composables do SDK de extensões
  (`useApi`, `useStores`, `useSdk`) e os componentes globais do Directus (`drawer-item`, o construtor de filtros),
  para parecer e se comportar como o Studio (V-04).
- O navegador só fala com o endpoint da extensão e com a API do Directus. A exceção são os mapas de fundo; a busca
  de endereço passa pelo endpoint (D-013).
- O lint dos `.vue` é o `eslint-plugin-vue` no `flat/recommended`, como no Directus (V-98), e entra com o primeiro
  componente, na F04. Os atributos do `<template>` seguem a ordem do guia de estilo do Vue (`vue/attributes-order`
  no padrão, V-102): primeiro o que decide se o elemento existe e se repete (`v-if`, `v-for`), depois os dados, e os
  eventos por último. A regra entra como erro, e não como o aviso do `recommended`.

## Onde fica a lógica

- A lógica mora em módulos TypeScript e composables que não desenham: o estado das ferramentas, os cálculos, a
  formatação e a máquina de estados da navegação pelo teclado. É isso que tem teste unitário e meta de 90%.
- O componente só liga a lógica à tela.
- A camada que desenha no WebGL (MapLibre e deck.gl) é a mais fina possível, e o ponta a ponta a cobre.

## O mapa

- O MapLibre e o deck.gl são carregados sob demanda (D-010, P-01). O arquivo inicial de extensões leva só o
  registro das superfícies, com um orçamento de peso medido na F01 e conferido na CI (`size-limit`).
- Os dados chegam em tiles (D-004), nunca em páginas de GeoJSON acumuladas no mapa.
- Todo pedido que pode ficar velho (tile, página, contagem) é cancelado quando deixa de importar.
- O item atual e os selecionados vão para a camada de destaque, com a geometria que veio na lista.
- Sem WebGL2, um aviso claro, e não uma tela quebrada.

## Tema

- Só as variáveis do Directus (`--theme--*`), nas duas versões suportadas (V-19). Nada de cor fixa, exceto as
  paletas dos dados.
- As paletas dos dados são testadas nos dois fundos, com contraste suficiente e seguras para daltonismo; as
  contagens usam paletas sequenciais de percepção uniforme.

## Tradução

- Nenhum texto fixo no código. Toda chave existe em inglês e em pt-BR, no sistema de traduções do Studio (V-18), e
  um teste falha se as duas línguas divergirem.
- Números, datas, distâncias e áreas pelo `Intl`, no idioma do usuário.

## Acessibilidade

- Meta: WCAG 2.2 nível AA (§7.3, grupo 6).
- A lista é a alternativa acessível do mapa, no padrão _listbox_ do WAI-ARIA, com a região ao vivo para o resumo.
- Toda operação pode ser feita sem desenhar.
- Foco sempre visível e controlado nos drawers e popups; seleção e destaque nunca só por cor; o "reduzir movimento"
  respeitado; alvos de toque de pelo menos 44 × 44 px.
- O axe roda no ponta a ponta, e nenhuma violação passa.
