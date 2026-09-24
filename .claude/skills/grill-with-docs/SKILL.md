---
name: grill-with-docs
description: Sessão de interrogatório que desafia o plano do directus-extension-geospatial contra o modelo de domínio e as decisões documentadas, afina a terminologia e atualiza a documentação (CONTEXT.md, docs/arquitetura.md, docs/decisoes.md, docs/verificacoes.md) conforme as decisões se cristalizam. Use quando o mantenedor quiser pôr o plano à prova contra a linguagem e as decisões do projeto.
---

Me interrogue implacavelmente sobre cada aspecto deste plano até chegarmos a um entendimento compartilhado. Percorra cada ramo da árvore de design, resolvendo as dependências entre decisões uma a uma. Para cada pergunta, dê a sua resposta recomendada.

Faça as perguntas uma de cada vez e espere a resposta de cada uma antes de continuar.

Se uma pergunta puder ser respondida explorando o repositório, explore em vez de perguntar. Se ela depender de como uma ferramenta de terceiros funciona (Directus, PostGIS, MapLibre, os bancos), confira no código-fonte ou na documentação oficial. O clone do Directus pode ser feito numa pasta temporária.

**Não faça commit nem push.**

---

## A documentação que esta sessão desafia e atualiza

| Arquivo | Papel |
|---|---|
| `CONTEXT.md` | Glossário do domínio, bilíngue: o termo em português e o canônico em inglês |
| `docs/arquitetura.md` | O desenho |
| `docs/decisoes.md` | As decisões `D-0xx`. É o registro de decisões do projeto; **não crie `docs/adr/`**. As portas de mão única ficam no topo |
| `docs/verificacoes.md` | Fatos verificados em ferramentas de terceiros (`V-xx`) e pendências (`P-xx`) |
| `docs/implementacao/` | O plano por fases, os achados e o histórico, quando existir |

- Um termo resolvido vai para o `CONTEXT.md` na hora, nos dois idiomas.
- Uma decisão que passa no teste dos três critérios abaixo vira uma `D-0xx` nova em `docs/decisoes.md`, com a numeração continuada. As seções da arquitetura que ela muda são ajustadas junto.
- Um fato conferido vira `V-xx`, e uma confirmação que ficou para depois vira `P-xx`.

---

## Durante a sessão

### Desafie contra os princípios e as portas de mão única

Todo o plano obedece aos princípios de `docs/arquitetura.md` §2 e às portas de mão única do topo de `docs/decisoes.md`. Quando uma resposta contrariar um deles, aponte na hora:

> "A D-001 diz que a extensão nunca escreve regra de permissão própria, mas esse filtro que você propôs refaz o `regiao = sul` na mão. Qual dos dois vale?"

Uma porta de mão única só muda com uma decisão nova e registrada.

### Desafie contra o glossário

Quando o usuário usar um termo que conflita com a linguagem do `CONTEXT.md`, aponte imediatamente:

> "O glossário define 'grupo' como o círculo de contagem na tela, mas você parece estar falando de um foco da análise. Qual dos dois?"

Resolva também os termos listados em "Termos em aberto" no fim do `CONTEXT.md`.

### Afine linguagem vaga

Quando o usuário usar termos vagos ou sobrecarregados, proponha um termo canônico preciso:

> "Você disse 'resultado'. Está falando dos itens, das formas ou dos resumos? A cadeia trata cada um de um jeito."

### Discuta cenários concretos

Teste as relações do domínio com cenários específicos. Invente casos extremos que obriguem a precisão nos limites entre os conceitos. Cenários úteis neste projeto:

- a usuária Maria, com papel restrito à zona sul, diante de cada operação, cache, pulso ao vivo, relatório e link compartilhado;
- o mesmo pedido em PostGIS, MySQL e SQLite, olhando a matriz de capacidades;
- 500 mil itens num raio, 100 milhões de pontos de GPS, um polígono desenhado com 50 mil vértices;
- Directus v11 e v12, e uma versão nova que muda as funções internas;
- gravações feitas fora do Directus, colunas em SRID diferente de 4326, bancos sem índice espacial.

### Confira com o código e com os fatos

Quando o usuário afirmar como algo funciona, confira se o código (o do projeto ou o do Directus) e `docs/verificacoes.md` concordam. Se encontrar contradição, traga à superfície:

> "A V-16 diz que o WebSocket do Directus vem desligado por padrão, mas o plano conta com ele ligado. Qual está certo?"

### Atualize o `CONTEXT.md` na hora

Quando um termo for resolvido, atualize o `CONTEXT.md` naquele momento, em português e em inglês. Não acumule essas atualizações para o fim.

Não acople o `CONTEXT.md` a detalhes de implementação. Inclua só termos que tenham significado para quem opera ou administra a extensão.

### Ofereça decisões novas com parcimônia

Só ofereça registrar uma `D-0xx` quando **os três** critérios forem verdadeiros:

1. **Difícil de reverter:** mudar de ideia depois custa caro.
2. **Surpreendente sem contexto:** um leitor futuro vai se perguntar "por que fizeram assim?".
3. **Resultado de um trade-off real:** havia alternativas genuínas, e uma foi escolhida por motivos específicos.

Se qualquer um dos três faltar, não registre como decisão. O que for só esclarecimento vai direto para a arquitetura ou para o glossário.
