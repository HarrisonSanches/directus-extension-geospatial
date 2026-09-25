# Arquitetura

> O desenho da extensão `directus-extension-geospatial`: o que ela faz e como.
> Os motivos das escolhas estão em [decisoes.md](decisoes.md) (D-0xx), os fatos conferidos em ferramentas de terceiros em [verificacoes.md](verificacoes.md) (V-xx, e as pendências P-xx), e os termos em [CONTEXT.md](../CONTEXT.md).
> Os levantamentos de mercado são de setembro de 2026. Os fatos sobre o Directus foram conferidos no código da versão 12.4.1.

## 1. Objetivo

Criar uma extensão para o Directus, publicada para a comunidade, que transforme o Studio num **painel operacional para visualizar e analisar dados geométricos**. As operações espaciais rodam no banco de dados (PostGIS como implementação de referência) e ficam disponíveis pela interface no Studio (layout, módulo e painel), pela API, pelo SDK e pelos Flows do Directus. O que o usuário analisa também pode virar um relatório em PDF, com valor de evidência (7.9).

Não é um playground nem um console de SQL. É um painel de operação com um catálogo rico de funcionalidades geoespaciais, acionadas por interações simples: clicar no mapa, desenhar um polígono, informar uma distância.

## 2. Princípios

- **Extensão completa e viável.** Não há recorte de "primeira versão": se uma funcionalidade pode atender vários contextos, ela entra. A ordem de construção só aparece no plano de implementação.
- **Otimização e melhores práticas de mercado** em cada decisão de arquitetura.
- **PostGIS é a referência.** Toda funcionalidade é pensada primeiro para o PostGIS. Os outros bancos oferecem o que conseguirem (7.4).
- **Permissões do Directus acima de tudo** (regra de ouro, seção 5).
- **Resultado honesto.** Resultado parcial ou limitado sempre avisa que é parcial.
- **Nada muda no banco nem nas permissões sem o admin ver e confirmar.** Índices, coleções da extensão e políticas prontas são criados por ação do admin, que vê antes o que vai mudar (o SQL, as coleções ou as permissões).

## 3. Origem da ideia

### Ideias avaliadas e descartadas

| Ideia                                                                                                     | Por que ficou de fora                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeline dos dados de uma coleção                                                                         | Já existem: painel estilo Gantt da Directus Labs, layout de timeline da Devix e layout de calendário nativo.                                                                                                                          |
| "Time Machine" (histórico de revisões, viagem no tempo, desfazer em lote)                                 | Nenhum pedido direto encontrado. O core vem melhorando a tela de revisões (modal de comparação em nov/2025, comparação com a revisão anterior em fev/2026) e o roadmap tem "histórico de revisões persistente" em fase de descoberta. |
| Mapa genérico com deck.gl                                                                                 | O autor avaliou que esse espaço já está atendido (extensão directus-map-grid).                                                                                                                                                        |
| Operação de Flow para WhatsApp; gerador de códigos únicos                                                 | Simples demais para o objetivo.                                                                                                                                                                                                       |
| Tree view para itens aninhados                                                                            | Já resolvido por um layout da Directus Labs.                                                                                                                                                                                          |
| Pedidos mais votados do roadmap (renomear coleções e campos, views do banco, busca em campos relacionais) | Exigem mudança no core; não cabem numa extensão.                                                                                                                                                                                      |

### Por que geoespacial

- O Directus oferece só quatro operadores geoespaciais de filtro: `_intersects`, `_nintersects`, `_intersects_bbox` e `_nintersects_bbox`. Não há consulta por distância ou raio, medição, agregação espacial nem análise.
- Uma discussão no GitHub de 2025 (directus/directus#25123), pedindo um operador `_within`, aponta que quem precisa de proximidade acaba escrevendo endpoints próprios ou SQL cru.
- O pedido de suporte a PostGIS no roadmap oficial tem poucos votos (8), mas não encontramos nenhuma extensão cobrindo o tema. Existe um template público de Directus + PostGIS mantido e atualizado (Railway), sinal de que a combinação é usada.
- É o nicho de maior domínio do autor, o que torna a extensão difícil de copiar.

## 4. Arquitetura geral

### 4.1 Visão geral

```mermaid
flowchart LR
  UI["Studio: layout, módulo, painel"] -->|"consulta registrada (id)"| EP["Endpoint da extensão"]
  SDK["SDK e API"] --> EP
  EP -->|"pede a query permitida"| DX["Funções internas do Directus: permissões, filtro, busca"]
  DX --> AD["Adaptador do banco: parte espacial em volta"]
  AD --> DB[("Banco: PostGIS e outros")]
  AD -.->|"o que o banco não faz"| NODE["Node, com limite"]
  EP -->|"tiles, itens, formas, resumo"| UI
```

1. **Motor no servidor.** Extensão de API (endpoint) que roda fora do sandbox e executa as operações no banco. Tem um adaptador por banco e usa o Node para completar o que o banco não faz (7.4). Usa conexões, fila e cache próprios (7.1).
2. **Interface no Studio.** São três superfícies com o mesmo núcleo (mapa, ferramentas de desenho e lista de resultados), todas com várias camadas (7.3):
   - **Layout de coleção:** aparece no seletor de layouts da página da coleção. Aproveita a busca, os filtros, os bookmarks, as ações em lote e a exportação da página, e guarda o próprio estado nas opções do layout.
   - **Módulo:** tem um item próprio na barra lateral, que o admin ativa. É o painel operacional com várias coleções ao mesmo tempo.
   - **Painel** para os dashboards (Insights).
3. **SDK.** Pacote separado (`directus-geospatial-sdk`), tipado e no estilo do SDK oficial, com comandos como `geoRadius()` e `geoCountByRegion()` (7.8).
4. **Operação de Flow e relatórios.** Uma operação "Geo" para as automações (7.8) e os relatórios em PDF (7.9), sobre o mesmo motor.

**Consulta registrada.** A interface registra a consulta uma vez (filtro, busca, operação e geometria desenhada) e recebe um id curto. Os tiles e as três partes do resultado (itens, formas e resumo, 7.3 grupo 4) são pedidos por esse id. A permissão é aplicada em cada pedido com a identidade de quem pede, então repassar o id a outra pessoa não vaza nada. O mesmo id serve para cache, consultas salvas e compartilhamento. O registro fica em memória ou no Redis (7.8).

**Resposta no formato do `/items`.** A ideia continua: aceitar os mesmos parâmetros (filter, fields, sort, limit etc.) mais os geoespaciais, e devolver no mesmo formato. Entra no desenho da API (7.8).

Uma extensão não consegue adicionar operadores novos ao sistema de filtros nativo. A integração de verdade ao ItemsService seria um PR no core (como a proposta do `_within`), um possível passo futuro fora do escopo da extensão.

### 4.2 Relação com o mapa nativo

- O Directus já tem um layout de mapa, feito com MapLibre. Ele busca pelo `/items`, 1000 itens por página. Filtra pela área visível com `_intersects_bbox`, agrupa pontos no navegador, seleciona por retângulo, abre o item com um clique e busca endereços quando há chave do Mapbox. Não faz raio, medição nem mais próximos, não deixa desenhar um polígono para filtrar e não agrega nada.
- **Posicionamento:** o nativo mostra, a extensão analisa.
- **Não dá para estender o nativo.** O componente dele é interno, e o MapLibre do Studio não é compartilhado com extensões. Por isso a extensão traz a própria base (carregar pela área visível, agrupar, clicar, selecionar) e o próprio MapLibre.
- **Limites de um layout de extensão, e como lidamos com eles:**
  - Ele aparece em toda coleção, inclusive Files, Users e seletores de relação, e não há como escondê-lo. Quando a coleção não tem campo de geometria, mostramos um aviso.
  - Ele não escreve no filtro da página. A geometria desenhada não chega à exportação nem às ações em lote nativas; ela passa pela seleção ou por um download próprio.
  - Só o dono atualiza um bookmark, e o preset comum é salvo a cada movimento do mapa, como no nativo.

## 5. Modelo de permissões

**Regra de ouro:** quem decide o que o usuário recebe é sempre a lógica de permissões do próprio Directus. A extensão nunca escreve regra de permissão própria.

### Como funciona

1. O Studio ou o SDK chama o endpoint com a sessão ou o token do usuário, sem privilégio extra.
2. A extensão pede às funções internas do Directus, que são a mesma cadeia usada pelo `ItemsService`, a query do que esse usuário pode ver na coleção. Essa query já vem com o filtro de permissão (o item passa se bater com pelo menos uma política), o filtro da página, a busca e as regras por campo. O Directus a monta sem executar.
3. O adaptador do banco envolve essa query com a parte espacial (tile, distância, mais próximos, agrupamento, junção com outra coleção) e executa tudo num SQL só.

### Exemplo

A usuária Maria tem o papel "Operador Zona Sul" e só pode ler ocorrências com `regiao = sul`. Ela pede as 10 ocorrências mais próximas de um ponto. O Directus monta a query "ocorrências com `regiao = sul`", a extensão a ordena pela distância até o ponto e pega as 10 primeiras. As 10 vêm completas, e todas são visíveis para a Maria.

No fluxo do handoff, o SQL rodava primeiro e o `ItemsService` filtrava depois com `_in`. Se 4 das 10 fossem da zona norte, a Maria receberia 6, e não as 10 mais próximas que ela pode ver.

### Por que esta opção

A alternativa era usar só a API pública, ou seja, traduzir cada operação em filtros nativos e chamadas ao `ItemsService`. As permissões ficariam exatas e o contrato estável, mas parte do catálogo ficaria de fora:

- Tiles e agregações em zoom baixo exigiriam colunas pré-calculadas na coleção do usuário.
- Ordenar um resultado grande por distância não escalaria.
- Focos sobre grandes volumes seriam inviáveis.
- Os mais próximos exigiriam várias consultas.

### Proteções

1. Só um módulo da extensão toca nos internos do Directus, com um adaptador por versão.
2. Ao subir, a extensão confere se os internos são os esperados. Se não forem, ela desliga as operações afetadas e avisa, para não arriscar vazar dados.
3. Testes de integração com Directus v11 e v12 reais e um papel restrito provam que a extensão devolve os mesmos itens que o `/items` (7.4).
4. Um canário roda os testes contra cada nova versão do Directus (7.4).

### Perdas aceitas

- Os hooks `items.read` de outras extensões não rodam sobre tiles e agregações. O `items.query` é respeitado.
- Os valores saem crus do banco, sem a formatação do `PayloadService`.

### O que esta opção resolveu do handoff

- **"Mais próximos" com menos de N itens:** os N vêm completos, porque a ordenação roda sobre a query já filtrada.
- **Listas `_in` enormes:** não existem mais.
- **Sem permissão no campo de geometria:** a extensão devolve erro de permissão, como o `/items`.
- **Operações entre duas coleções:** basta juntar as duas queries permitidas.
- **Atalho para admin:** não precisa ser escrito, porque a query do admin já vem sem filtro de permissão.

## 6. Catálogo de operações

As referências PostGIS são a implementação de referência. Nos outros bancos, cada operação roda no banco, roda no Node com limite, ou não aparece (7.4). As medições são sempre em metros (7.6).

**O que é "dentro" (D-023).** Em toda operação que pega itens por área ou por distância (por área, raio, corredor e entorno encadeado), "dentro" quer dizer **toca**: basta qualquer parte do item estar na área ou a até a distância, e o ponto na borda entra. É o mesmo sentido do `_intersects` do Directus (V-49). Duas opções mudam isso:

- **inteiramente dentro**, para camadas de linhas e polígonos: o item inteiro, contando a borda (`ST_CoveredBy`, V-50). No raio, no corredor e no entorno, a comparação é com o polígono do entorno montado com mais segmentos, e o erro fica em cerca de 0,03% da distância, porque o `ST_DFullyWithin` não aceita `geography` (V-51);
- **fora**: os itens que não tocam a área, como o `_nintersects` do Directus.

### Básico

| #   | Operação      | O que o usuário faz                         | O que aparece no mapa                                                           | Referência PostGIS                                       |
| --- | ------------- | ------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Raio          | Clica num ponto e informa a distância       | Círculo desenhado, itens de dentro destacados, lista com a distância de cada um | `ST_Buffer` (desenho), `ST_DWithin` (seleção)            |
| 2   | Por área      | Desenha uma área ou usa uma forma existente | Os itens que tocam a área, ficam inteiramente dentro ou ficam fora              | `ST_Intersects`; `ST_CoveredBy` em "inteiramente dentro" |
| 3   | Medir         | Seleciona dois itens, ou um polígono        | Linha entre os itens com a distância; área e perímetro do polígono              | `ST_Distance`, `ST_MakeLine`, `ST_Area`, `ST_Perimeter`  |
| 4   | Mais próximos | Clica num ponto e escolhe N                 | Os N itens mais próximos ligados ao ponto por linhas                            | Operador `<->` (KNN)                                     |

### Intermediário

| #   | Operação            | O que o usuário faz                                                          | O que aparece no mapa                                                                              | Referência PostGIS                                                                              |
| --- | ------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 5   | Trajeto             | Escolhe uma ou mais camadas com data e o objeto (ex.: uma placa, um veículo) | Uma linha por objeto, em ordem de tempo, com os trechos, as lacunas tracejadas e a distância total | Funções de janela por objeto, `ST_MakeLine` por trecho, `ST_Length`                             |
| 6   | Corredor            | Escolhe uma linha (ex.: rodovia) e uma largura                               | Faixa ao longo da linha e os itens dentro dela                                                     | `ST_Buffer` em linha (desenho), `ST_DWithin` (seleção), `ST_LineLocatePoint` (posição na linha) |
| 7   | Contagem por região | Escolhe uma coleção de polígonos (ex.: bairros)                              | Mapa colorido pela quantidade de itens em cada região                                              | Junção espacial + contagem                                                                      |
| 8   | Cerca virtual       | Escolhe coleções com trajeto, uma coleção de cercas e o período              | As visitas de cada objeto em cada cerca, com entrada, saída e permanência                          | Funções de janela por objeto, em ordem de tempo, sobre `ST_Intersects` com as cercas            |

### Avançado

| #   | Operação           | O que o usuário faz                             | O que aparece no mapa                               | Referência PostGIS                               |
| --- | ------------------ | ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| 9   | Grade de densidade | Escolhe o tamanho da célula da grade, em metros | Hexágonos coloridos pela concentração de pontos     | `ST_HexagonGrid`, `ST_SquareGrid` (PostGIS 3.1+) |
| 10  | Focos              | Define os parâmetros de agrupamento             | Grupos de pontos próximos com o contorno de cada um | `ST_ClusterDBSCAN`, `ST_ConcaveHull`             |

### Operações de forma

Recebem itens ou formas e produzem só formas. Servem de entrada para outra operação (7.3, grupo 4), viram itens novos ou rodam num Flow (7.8).

| #   | Operação    | O que o usuário faz                        | O que aparece no mapa            | Referência PostGIS                                           |
| --- | ----------- | ------------------------------------------ | -------------------------------- | ------------------------------------------------------------ |
| 11  | Entorno     | Escolhe itens ou formas e uma distância    | A área em volta de cada um       | `ST_Buffer` em `geography` (desenho), `ST_DWithin` (seleção) |
| 12  | Centro      | Escolhe itens ou formas                    | Um ponto em cada um              | `ST_Centroid`; `ST_PointOnSurface` quando o centro cai fora  |
| 13  | Simplificar | Escolhe uma forma e a tolerância em metros | A mesma forma com menos vértices | `ST_SimplifyPreserveTopology`                                |

- **Seleção exata no entorno.** Numa cadeia, "entorno → itens dentro" vira um `ST_DWithin`, como no raio e no corredor: exato sobre o elipsoide e pelo índice. O polígono do `ST_Buffer` só é montado para desenhar e para salvar, porque é uma aproximação: o PostGIS calcula num sistema plano e fecha o círculo com 32 segmentos (V-46), o que dá até uns 2,4 m de diferença na borda de um entorno de 500 m.
- **Centro dentro da forma.** O centro geométrico de um polígono pode cair fora dele (V-47), como num bairro em forma de U. Nesse caso, a extensão usa um ponto garantidamente dentro, para que "em qual região fica" dê a resposta certa.
- **Tolerância em metros.** O `ST_SimplifyPreserveTopology` trabalha na unidade do SRID da coluna (V-48), então a extensão converte para um sistema métrico antes de simplificar, como nas outras medidas (7.6).

**Fora de escopo por ora:** rotas por ruas reais e isócronas (dependem do pgRouting) e diagramas de Voronoi (pouco usados em operação).

**Outras funções para expandir o catálogo no futuro:** `ST_Union`, `ST_Intersection`, `ST_Difference`, `ST_ConvexHull`, `ST_Extent`, `ST_ClusterKMeans`.

## 7. Desenho por tema

### 7.1 Grandes volumes de dados

#### Como os dados chegam ao mapa: tiles vetoriais

- O mapa é dividido em quadrados, com uma grade para cada zoom, e pede só os quadrados visíveis no zoom atual.
- O endpoint monta cada quadrado no banco com `ST_AsMVT`, em volta da query permitida (seção 5). O quadrado traz só o que cai nele, recortado e simplificado para aquele zoom, num formato binário compacto.
- Cada quadrado aparece assim que chega, então o carregamento é progressivo por área. Quando o usuário move o mapa, só os quadrados novos são pedidos.
- Os tiles são pedidos pelo id da consulta registrada (4.1).
- Um único pedido por tile traz todas as camadas visíveis (7.3, grupo 1).

**Por que não somar páginas no mapa**, que era a ideia do handoff:

- Com 500 mil resultados, o navegador acabaria guardando dezenas de MB de GeoJSON.
- O mapa reprocessaria tudo o que acumulou a cada nova página.
- As páginas não acompanham a área que o usuário está olhando.
- Em zoom baixo, 500 mil pontos empilhados viram uma mancha.

#### Zoom baixo: agrupamento no servidor

- Dentro de cada tile, o servidor divide o quadrado em células de tamanho fixo na tela (por exemplo, 60 × 60 px), e a mesma regra vale em todos os tiles.
- Uma célula com um item manda o próprio item, que continua clicável. Uma célula com vários manda um grupo com a contagem, na posição média dos itens, junto com o retângulo que os envolve. Clicar no grupo aproxima o mapa até esse retângulo.
- Não existe zoom mínimo fixo: a regra se ajusta à densidade. No mesmo zoom, o centro da cidade aparece em grupos e a zona rural, em itens soltos. É o comportamento do supercluster, só que no servidor e para qualquer volume.
- Há dois estilos a partir dos mesmos tiles: círculos com o número ou mapa de calor, com o peso dado pela contagem.
- As contagens vêm da query permitida, então cada usuário só conta o que pode ver.
- Linhas e polígonos nunca são agrupados, só simplificados conforme o zoom (tolerância de cerca de 1 pixel). Um trajeto mantém a forma e, no zoom de rua, mostra exatamente as ruas percorridas.
- Cada camada configura três coisas: se agrupa ou não, o tamanho da célula da tela e o zoom a partir do qual tudo aparece solto (como o `clusterMaxZoom` do supercluster). Esse último é necessário para pontos de GPS densos.

#### Lista e contagem

- A lista segue a ordem natural da operação, e o usuário pode trocá-la:

  | Operação                          | Ordem natural                   |
  | --------------------------------- | ------------------------------- |
  | Raio, mais próximos               | Distância até o centro          |
  | Corredor                          | Posição ao longo da linha       |
  | Trajeto                           | Tempo, com desempate pelo id    |
  | Cerca virtual                     | Hora da entrada                 |
  | Por área                          | A ordenação escolhida na página |
  | Contagem por região, grade, focos | Maior contagem primeiro         |

- **Paginação por cursor**, e não por número de página. Com número de página, o banco lê e descarta tudo o que vem antes, e a lista se desloca quando entram itens novos. Com cursor, o banco vai direto ao ponto pelo índice, na mesma velocidade em qualquer profundidade.
- **Rolagem virtual.** A lista desenha só as linhas visíveis e busca as próximas pelo cursor conforme o usuário rola.
- **Contagem em dois tempos.** Primeiro, uma contagem rápida que para em 10.001 e mostra "10.000+" (o limite é configurável). Depois, a contagem exata roda em segundo plano, com tempo limite; se ele estourar, fica o "10.000+". A lista e o mapa não esperam pela contagem.
- **Durante o carregamento**, aparecem um resumo no topo ("Raio de 2 km · 10.000+ itens" e depois "512.340 itens"), linhas provisórias na lista e uma barra fina de progresso no mapa.
- Mapa, lista e resumo usam o mesmo id de consulta, então respondem à mesma pergunta. A contagem é parte do resumo (7.8).

#### Proteção do banco

1. **Tempo máximo para toda consulta**, configurável por tipo (tile, página da lista, contagem exata e análise).
   - Um tile que estoura o tempo volta marcado, e o mapa o mostra hachurado com "área pesada: aproxime ou filtre".
   - Acima do zoom em que tudo aparece solto, um tile com itens demais (por exemplo, mais de 50 mil) volta agrupado mesmo assim.
2. **Cancelamento de ponta a ponta.** O MapLibre cancela os tiles que saíram da tela, e a interface cancela a lista e a contagem quando a operação muda. No servidor, um pedido cancelado também cancela a consulta no banco.
3. **Conexões próprias e fila (padrão bulkhead).** A extensão tem um pool de conexões separado do pool do Directus, para que uma carga pesada de tiles não trave o login e a edição.
   - Uma fila com prioridade: tiles da tela, depois páginas da lista, depois contagens e análises.
   - Um limite por usuário.
   - Opcionalmente, o pool pode apontar para uma réplica de leitura.
4. **Cache.**
   - A chave junta o SQL montado pelo Directus, com os valores dos parâmetros, a versão da coleção e o tile. Os valores fazem parte da chave porque o filtro de permissão vai neles: no SQL, a regra da Maria e a do João são o mesmo texto (`regiao = ?`), e só o valor muda. Assim, quem tem exatamente as mesmas permissões compartilha o cache, e quem tem permissões diferentes nunca recebe o dado do outro.
   - Uma permissão com `$CURRENT_USER` põe o id do usuário nos valores, e o cache daquele papel fica por usuário.
   - O Directus gera o SQL de forma determinística. Se um dia ele variar, o efeito é só perder o cache, nunca vazar dado. Um teste automatizado cobre isso.
   - O `$NOW` muda o SQL a cada pedido (V-55). Nos filtros do usuário, a extensão o resolve uma vez, no registro da consulta, arredondado ao minuto. Numa permissão com `$NOW`, o resultado continua correto, mas aquele papel fica sem cache.
   - Toda gravação feita pelo Directus muda a versão da coleção. As gravações feitas fora dele são detectadas como no grupo 5 do 7.3 (gatilho no Postgres ou campo de data de atualização), e um tempo de vida curto fica como rede de segurança.
   - O cache fica em memória ou no Redis, quando o Directus usa Redis. No navegador, `Cache-Control: private`.
5. **Painel de saúde para o admin**, o mesmo do índice (7.6): tempo dos tiles, tamanho da fila, taxa de acerto do cache e consultas lentas, cada uma com o id da consulta. Ele também mostra o inventário do que a extensão criou e os trabalhos em segundo plano (7.8).

#### Renderização

- **MapLibre na base:** mapas de fundo, tiles vetoriais, estilos por dado, grupos, mapa de calor e destaque.
- **deck.gl intercalado** no mesmo canvas, pelo `MapboxOverlay`: trajeto animado (`TripsLayer`), muitos objetos se movendo em tempo real, 3D e agregações na placa de vídeo. Os nomes de ruas continuam por cima dos dados.
- **Leaflet e OpenLayers ficaram de fora.** O Leaflet não usa WebGL para desenhar dados, e o OpenLayers não traria ganho aqui e ficaria diferente do mapa nativo.
- **A extensão traz as próprias bibliotecas.** Isso a deixa independente da versão do MapLibre que o Directus usa. O requisito é WebGL2, o mesmo do nativo.
- **Carregamento sob demanda.** O Studio baixa um arquivo único com todas as extensões ao iniciar. Para não pesar para quem nunca abre um mapa, o MapLibre só é baixado quando um mapa abre, e o deck.gl só quando uma camada precisa dele. Isso exige um build próprio, porque o build padrão do SDK junta tudo num arquivo só. A viabilidade será confirmada num teste ([pendências em verificacoes.md](verificacoes.md#pendências)).

### 7.2 Navegação item a item pelo teclado

- **Ordem.** A seta segue a ordem da lista, que é a ordem natural da operação (7.1): no corredor, a posição ao longo da linha; no trajeto, o tempo; no raio, a distância.
- **Carregamento.** Quando o usuário chega a uns 10 itens do fim do que já foi carregado, a próxima página é pedida pelo cursor. Na prática, a seta não espera o servidor, e é possível percorrer resultados enormes. A rolagem virtual mantém visível na lista o item atual.
- **Onde as setas navegam.** Só quando a lista de resultados está em foco. Com o foco no mapa, as setas continuam movendo o mapa (padrão do MapLibre, importante para acessibilidade), e a extensão não toma as teclas do Studio.
- **Teclas:**

  | Tecla      | Ação                                                                                               |
  | ---------- | -------------------------------------------------------------------------------------------------- |
  | ↓ ou →     | Próximo item                                                                                       |
  | ↑ ou ←     | Item anterior                                                                                      |
  | Home / End | Primeiro / último                                                                                  |
  | Enter      | Abre o drawer do item, ou desce até os itens de uma região, célula da grade ou foco (7.3, grupo 2) |
  | Espaço     | Marca ou desmarca na seleção; numa região, célula da grade ou foco, marca todos os itens de dentro |
  | Backspace  | Volta um nível depois de descer                                                                    |
  | Esc        | Sai da navegação                                                                                   |
  | ?          | Mostra os atalhos                                                                                  |

- **O mapa a cada passo:**
  - O item atual é desenhado numa camada de destaque, por cima dos tiles, com a geometria que veio na lista. Ele aparece sozinho mesmo dentro de um grupo.
  - A câmera só se move quando o item sai da área central da tela, com um deslize curto. Com a tecla segurada, ela pula sem animação, para não acumular movimentos.
  - A opção "seguir" mantém o item sempre no centro, o que é útil no trajeto e no ao vivo (7.3, grupo 5).
  - O zoom não muda.
- **Detalhes no painel lateral.** O template de exibição do item, mais os dados da operação:
  - no raio e nos mais próximos, a distância;
  - no corredor, a posição ao longo da linha ("km 12,4 de 38");
  - no trajeto, o horário, a velocidade e o tempo desde o ponto anterior.

  No trajeto e no corredor, o trecho da linha já percorrido muda de cor.

- **No trajeto**, os pontos por onde a seta passa vêm da lista, com posição e horário exatos. A simplificação da linha não interfere.
- **Acessibilidade do teclado:**
  - A lista segue o padrão _listbox_ do WAI-ARIA, e o leitor de tela anuncia cada item.
  - O resumo é anunciado numa região ao vivo.
  - O foco fica sempre visível.
  - Seleção e destaque não dependem só de cor: usam também contorno e símbolo.
  - Com "reduzir movimento" ligado no sistema, a câmera pula sem animar.

  O resto da acessibilidade fica no grupo 6 do 7.3.

### 7.3 Interações

#### Grupo 1: camadas

- **O que é uma camada:** uma coleção (com o campo de geometria e o filtro dela), o resultado de uma operação ou as formas desenhadas pelo usuário. Cada camada tem estilo, agrupamento e contagem próprios.
- **Em cada superfície:**
  - **Layout:** a primeira camada é a coleção da página, presa aos filtros, à busca e à seleção da página. O usuário pode adicionar outras coleções como camadas extras (por exemplo, bairros por baixo das ocorrências), cada uma com o seu filtro. Tudo fica nas opções do layout, e o bookmark restaura.
  - **Módulo:** as camadas são livres. A visão (camadas, filtros, mapa de fundo e enquadramento) é salva numa coleção da própria extensão, e as permissões do Directus nessa coleção decidem quem vê e quem edita cada visão. As coleções da extensão estão no 7.8.
  - **Painel:** as camadas ficam nas opções do painel, e as variáveis globais do dashboard podem alimentar os filtros. Uma variável "região", por exemplo, filtra todas as camadas.
- **O filtro de cada camada é o construtor de filtros nativo do Directus.** Assim a operação espacial se combina com status, datas e o resto.
- **Painel de camadas (legenda).**
  - Ligar e desligar, reordenar arrastando e ajustar a opacidade.
  - Estilo: cor por campo, tamanho por campo numérico, ícone.
  - As três configurações de agrupamento (7.1) e a contagem de cada camada.
  - Quando o campo já tem cores configuradas no Directus, como nas opções de um status, a camada usa as mesmas cores e a legenda sai pronta.
- **Permissão por camada.** Cada camada usa a permissão do usuário naquela coleção. Numa visão compartilhada com uma coleção que o usuário não pode ler, essa camada aparece com o aviso "sem acesso" e o resto funciona.
- **Um pedido por tile para todas as camadas.** Com uma requisição por camada, 5 camadas × 12 tiles dariam 60 pedidos, e em HTTP/1.1 o navegador só faz umas 6 conexões simultâneas por servidor. Por isso o mapa pede um tile por quadrado com todas as camadas visíveis. O servidor monta e guarda no cache cada camada separadamente e junta tudo num só tile, já que o MVT aceita várias camadas. Ligar ou desligar uma camada não invalida o cache das outras. É a ideia de fontes compostas do servidor de tiles Martin.

#### Grupo 2: seleção e item

**Seleção sincronizada**

- **Uma seleção só.** Mapa e lista compartilham a mesma seleção. No layout, ela é a própria seleção da página da coleção, então as ações em lote nativas (editar, arquivar, apagar) funcionam sobre o que foi selecionado no mapa.
- **Formas de selecionar:** clique com Shift ou Ctrl para acrescentar ou tirar um item; retângulo ou laço (polígono livre) para uma área; e "selecionar todo o resultado".
- **A seleção por área é uma consulta ao servidor**, não o que está desenhado na tela. Por isso inclui os itens que estão dentro de grupos.
- **Hover sincronizado** entre lista e mapa. A lista só rola sozinha no clique, nunca no hover.
- **Destaque.** Os itens selecionados vão para a camada de destaque e aparecem mesmo dentro de um grupo. O grupo que contém itens selecionados ganha um anel.
- **Limite.** A seleção é uma lista de ids enviada no corpo das ações em lote do Directus, e esse corpo tem limite padrão de 1 MB. Acima de um limite (por exemplo, 10 mil itens), a extensão avisa e não seleciona tudo. As ações sobre o resultado inteiro estão no grupo 4.

**Abrir o item**

- **Clique.** O clique num item, no mapa ou na lista, abre o drawer de edição nativo por cima do mapa, sem sair da tela. Ctrl/Cmd + clique abre a página do item numa nova aba, como no nativo. O comportamento do clique é configurável por visão.
- **Salvar.** O drawer nativo não salva sozinho: a extensão grava pela API, com a permissão do usuário. Sem permissão de edição, o drawer abre só para leitura.
- **Atualização.** Depois de salvar, o item aparece atualizado na hora: a gravação muda a versão da coleção, e o tile antigo sai do cache. Se a posição foi mudada no mapa do drawer, o item já aparece no lugar novo.
- **Hover** mostra um cartão pequeno com o template de exibição da coleção, usando o mesmo componente do Directus.
- **Vários itens no mesmo lugar:** o clique abre uma lista curta para escolher qual abrir.
- A navegação pelo teclado está no 7.2.

**Descer até os itens de uma região, célula da grade ou foco**

- **Quando.** Na contagem por região, na grade e nos focos, a lista mostra regiões, células da grade ou focos (7.1). Célula e foco não são itens, e a região é item de outra coleção. Por isso, abrir um deles desce até os itens de dentro, em vez de abrir o drawer.
- **Como.** O clique, no mapa ou na lista, ou o Enter enquadram a forma no mapa, e a lista passa a mostrar os itens de dentro, na ordem da página. O trilho ganha a etapa ("Focos → Foco 3 · 412 pontos"), e o trilho ou o Backspace voltam.
- **Seleção.** O Espaço marca todos os itens de dentro, por consulta ao servidor, com o limite da seleção.
- **Nos focos, "dentro" quer dizer "do foco":** os pontos que o DBSCAN juntou nele, pelo id do foco no `$geo`. O contorno côncavo pode envolver pontos soltos ou de outro foco, então o filtro não usa o contorno.
- **A região em si.** Ctrl/Cmd + clique abre a página da região numa nova aba, como em qualquer item.
- **Permissão.** Descer é a mesma consulta com mais um filtro, então a Maria só vê as ocorrências da zona sul dentro do foco. Pela API, é a rota dos itens com o id da região, da célula ou do foco (7.8).

#### Grupo 3: desenho, medição e busca

**Desenho: Terra Draw**

- **Por que ele.** Tem licença MIT, adaptador oficial para o MapLibre e não depende de um motor de mapa específico. Como a extensão traz o próprio MapLibre, a versão escolhida precisa ser uma que o adaptador suporte ([pendências em verificacoes.md](verificacoes.md#pendências)).
- **Os modos cobrem o catálogo:**
  - círculo geodésico para o raio;
  - polígono e desenho livre para a área desenhada e o laço (em tela de toque, só polígono);
  - linha para o corredor e para a medição;
  - retângulo para a seleção;
  - modo de seleção para editar depois de desenhar: mover vértices, arrastar, redimensionar, acrescentar ou tirar vértices.
- **Encaixe.** Linha e polígono encaixam em vértices e trechos de outras formas, e uma regra própria encaixa nos itens das camadas visíveis.
- **O mapbox-gl-draw, que o Directus usa, ficou de fora:** foi feito para o Mapbox e não tem círculo, retângulo nem desenho livre sem plugins de terceiros.

**Medição ao vivo**

- **Enquanto desenha, o usuário vê:**
  - numa linha, o trecho atual e o total;
  - num polígono, a área e o perímetro;
  - num círculo, o raio e a área.

  Os valores aparecem como rótulos junto da forma e num resumo no painel.

- **O mesmo cálculo do servidor.** O navegador usa a GeographicLib, a mesma biblioteca que o PostGIS usa para medir `geography` sobre o elipsoide, então o número ao vivo bate com o número final do servidor. O Turf, que calcula sobre uma esfera, poderia errar até cerca de 0,5%.
- **Unidades:** métricas por padrão, trocando conforme a grandeza, com opção de unidades imperiais. A formatação segue o idioma.
- **Validação.** A interface barra formas grandes demais já no desenho, com a validação de área do Terra Draw. A proteção de verdade fica no servidor (7.8).

**Busca**

- **Uma caixa, três tipos de resultado:**
  - coordenadas (graus decimais, graus/minutos/segundos, UTM), sempre disponíveis;
  - itens das camadas visíveis, pela busca nativa do Directus, com as permissões de cada coleção;
  - endereços, pelo provedor configurado.
- **Provedores de endereço:** Mapbox, quando o Directus tem chave; Nominatim público, dentro da política; serviço próprio (Nominatim, Photon, Pelias); provedores comerciais com chave.
- **Padrão sem chave do Mapbox: Nominatim público no modo permitido.**
  - A busca roda ao apertar Enter; buscar enquanto se digita é proibido.
  - No máximo 1 pedido por segundo para a instalação inteira.
  - Resultados em cache, aplicação identificada e atribuição visível.

  A documentação indica um serviço próprio ou pago para uso intenso, e o admin pode trocar o provedor ou desligar a busca de endereços.

- **Toda busca de endereço passa pelo endpoint da extensão.** Assim a extensão aplica a política de cada provedor para a instalação inteira, guarda no servidor as chaves que não podem ir ao navegador, alcança serviços em `http` na intranet e identifica a aplicação.

#### Grupo 4: encadear e salvar

**Encadear operações**

- **As partes de um resultado.** Um resultado tem até três partes: itens, formas e resumos. Cada operação declara quais produz:

  | Operação            | Itens                                                  | Formas                                                                             | Resumos                                             |
  | ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
  | Raio                | itens dentro, com a distância                          | círculo                                                                            | total                                               |
  | Por área            | os itens, conforme a opção                             | a área                                                                             | total                                               |
  | Medir               | —                                                      | a linha ou o polígono medido                                                       | distância, área, perímetro                          |
  | Mais próximos       | os N, com a distância                                  | —                                                                                  | —                                                   |
  | Trajeto             | os pontos em ordem de tempo, com os suspeitos marcados | uma linha por trecho de cada objeto, e as paradas                                  | distância, duração, lacunas, paradas e tempo parado |
  | Corredor            | itens dentro, com a posição na linha                   | faixa                                                                              | total                                               |
  | Contagem por região | as regiões                                             | —                                                                                  | contagem por região                                 |
  | Grade de densidade  | —                                                      | as células da grade                                                                | contagem por célula                                 |
  | Focos               | os pontos de cada foco                                 | contorno de cada foco                                                              | contagem por foco                                   |
  | Cerca virtual       | as posições dentro das cercas                          | cada visita: o trecho do trajeto dentro da cerca, com entrada, saída e permanência | entradas e permanência por cerca e por objeto       |
  | Entorno             | —                                                      | a área em volta de cada item ou forma                                              | —                                                   |
  | Centro              | —                                                      | um ponto por item ou forma                                                         | —                                                   |
  | Simplificar         | —                                                      | a forma simplificada                                                               | vértices antes e depois                             |

  Nos mais próximos, as linhas que ligam os itens ao ponto são só desenho: não são forma e não podem ser salvas. A resposta da API e do SDK segue as mesmas partes (7.8).

- **Encadear é usar uma parte de um resultado como entrada da próxima operação.** Exemplos:
  - escolas → entorno de 500 m → ocorrências dentro do entorno;
  - focos de ocorrências → câmeras dentro de cada foco;
  - raio de 5 km → contagem por bairro só dentro do raio.
- **A cadeia inteira vira uma consulta só.** As etapas são compostas num único SQL, e cada coleção entra pela sua query permitida (seção 5). Nenhuma lista de ids é guardada no meio do caminho, por isso funciona com qualquer volume. O id da consulta cobre a cadeia toda.
- **Na interface:**
  - cada resultado tem a ação "usar como entrada", que pergunta qual parte segue adiante (os itens ou as formas) e oferece as operações que fazem sentido para ela;
  - um trilho no topo mostra a cadeia ("Escolas → Entorno 500 m → Ocorrências") e os níveis abertos ao descer (grupo 2);
  - cada etapa pode ser editada ou removida, e o resto é recalculado.
- **Limites:**
  - profundidade máxima configurável (por exemplo, 5 etapas);
  - a cadeia só é oferecida se todas as etapas estiverem disponíveis no banco;
  - se alguma etapa rodar no Node com limite, o resultado final avisa.

**Salvar um resultado como item**

- **O que pode ser salvo:** uma forma (por exemplo, um entorno, uma faixa, um contorno de foco, uma área desenhada, a linha do trajeto ou um centro) vira um item novo de uma coleção.
- **Coleções oferecidas:** só as coleções em que o usuário pode criar itens e que têm campo de geometria compatível (polígono para áreas, linha para trajetos, ponto para centros).
- **Como salva:** abre o drawer nativo de criação com a geometria preenchida, e o usuário completa os outros campos. Salvar passa pela API com a permissão dele, então validações, campos obrigatórios, hooks e Flows funcionam como em qualquer criação.
- **Conversão:** a geometria é convertida para o tipo e o SRID do campo. Formas com vértices demais passam antes pela operação Simplificar, e o usuário vê o resultado.
- **Vários de uma vez** (por exemplo, todos os focos): tem limite, e a confirmação mostra quantos itens serão criados.

**Ações sobre o resultado inteiro**

- **O que dá para fazer:** editar, arquivar ou apagar todo o resultado de uma consulta, sem o limite de 10 mil da seleção.
- **Confirmação:**
  - mostra a contagem exata ("isto vai editar 512.340 itens");
  - para apagar acima de um limite, o usuário digita o número para confirmar;
  - a edição reaproveita o drawer de edição em lote do Directus, no modo `stageOnSave`, que devolve as mudanças sem salvar.
- **Execução:** roda em segundo plano, em lotes, pelo `ItemsService` com a permissão do usuário, e cada lote passa pelas mesmas regras, validações e hooks de uma ação normal. Tem progresso e cancelamento, e o usuário recebe uma notificação do Directus no fim. É um trabalho do executor da extensão (7.8), que retoma de onde parou se o Directus reiniciar.
- **Permissão:** só aparecem as ações que o usuário pode fazer na coleção.

**Consultas salvas e compartilhamento**

- **Layout:** os bookmarks nativos guardam tudo.
- **Módulo:** as visões ficam na coleção da extensão, com dono e visibilidade.
- **Posição do mapa na URL,** como faz o OpenStreetMap (zoom, latitude, longitude). Colar o endereço abre o mapa no mesmo lugar, sem salvar nada.
- **Botão "Compartilhar":** grava o conteúdo da consulta na coleção da extensão e gera um link curto. Assim o link não expira quando o id temporário sai do cache, e o dono pode revogá-lo apagando o registro.
- **Um link nunca dá acesso a nada:** quem abre vê só o que as próprias permissões deixam.

**Exportação**

- **Formatos, cada um para um público:**
  - GeoJSON, para desenvolvedores e ferramentas web;
  - CSV, para planilhas: pontos em colunas de latitude e longitude, outras geometrias em WKT;
  - KML, para Google Earth e Google My Maps;
  - GeoPackage, o padrão aberto (OGC) para QGIS e ArcGIS.
- **Sistema de coordenadas:** 4326 por padrão, ou o SRID da coluna (por exemplo, SIRGAS 2000 / UTM).
- **Partes:** os itens, por padrão, ou as formas. No GeoPackage, as duas vão juntas, cada uma numa camada.
- **Colunas:** os campos escolhidos na camada, mais os valores calculados (distância, posição na linha, tempo desde o ponto anterior).
- **Streaming:** o banco entrega as linhas aos poucos, sem encher a memória do servidor.
- **Tamanho:** uma exportação pequena baixa na hora. A grande segue o padrão do Directus: roda em segundo plano, como um trabalho do executor da extensão (7.8), o arquivo vai para Arquivos e o usuário recebe uma notificação quando fica pronta ou quando falha.

#### Grupo 5: tempo

**Linha do tempo** (para camadas com campo de data)

- **Janela de tempo.** Um controle deslizante com início e fim filtra as camadas pelo campo de data.
  - Acima dele, um histograma mostra quantos itens há em cada intervalo, calculado no servidor sobre a query permitida.
  - Mudar a janela muda a consulta e atualiza os tiles; com o BRIN no campo de data (7.6), isso é rápido.
  - Há atalhos (última hora, 24 h, 7 dias) e um intervalo livre.
- **Playback.** O botão play move a janela no tempo, com velocidade ajustável e repetição.
  - Pedir tiles a cada quadro seria pesado demais. Por isso a extensão carrega uma única vez os dados do intervalo e da área visível, num formato compacto, e a animação roda na placa de vídeo com o deck.gl, como no Kepler.gl.
  - Há um limite de volume (por exemplo, 2 milhões de pontos), com aviso.
- **Trajetos.** A `TripsLayer` anima cada veículo com um rastro que se apaga, com um relógio do instante e a opção "seguir". Ao pausar, o usuário navega ponto a ponto pelo teclado (7.2).
- **Fuso horário.** Os horários aparecem como no Studio, respeitando o tipo do campo (com ou sem fuso).

**Datas e fusos** (D-031)

- **Tipos de campo.** O `timestamp` tem fuso e fica guardado em UTC; o `dateTime` não tem fuso (V-54); o `date` não tem hora. O `date` serve para a janela de tempo, mas trajeto, parada e cerca exigem data e hora. Sem isso, o admin vê o motivo, e o usuário comum não vê a operação.
- **Fuso dos dados.** Num campo `dateTime`, a configuração da coleção diz em que fuso os horários foram gravados, e o padrão é o fuso da instalação. Assim, todas as origens de um trajeto entram na mesma linha do tempo.
- **Converter o parâmetro, nunca a coluna.** O filtro por período converte os limites da janela para o horário local dos dados e compara com a coluna crua, para o banco continuar usando o BRIN e o B-tree (objeto, data). A conversão da coluna só acontece para ordenar e mostrar, como no filtro em dois estágios do 7.6.
- **O dia.** No Studio, vale o fuso do navegador, como o Directus faz ao mostrar horários. Na API, os horários saem em ISO 8601 com deslocamento, e o que agrupa por dia aceita um parâmetro de fuso. Quando a consulta agrupa por dia, o fuso faz parte dela, e portanto do id e do cache.
- **Janela relativa, resolvida uma vez.** "Hoje", "últimas 24 h" e o `$NOW` dos filtros do usuário viram horários fixos no registro da consulta, arredondados ao minuto. Mapa, lista e resumo respondem à mesma janela, e o cache funciona. A visão e o bookmark guardam a janela relativa; a captura e o relatório guardam a absoluta ("24/09 00:00 a 23:59, −03:00").
- **Ordem estável.** Posições com a mesma hora são desempatadas pelo id, para o cursor não pular nem repetir itens e para o relatório gerado de novo sair igual.
- **Hora no futuro.** Uma posição mais de 5 min à frente do relógio do servidor é suspeita, com o motivo "hora no futuro".
- **Hora de recebimento, opcional.** Muitos sistemas guardam, além da hora da posição, a hora em que ela chegou ao servidor. Quando a configuração da coleção aponta esse campo, a lista, o alerta e o relatório mostram "posição às 10:02 · recebida às 10:47 (45 min depois)", porque numa operação importa saber quando o sistema ficou sabendo. As regras continuam usando só a hora da posição.
  - A tela de configuração sugere um campo `date-created`, que o Directus preenche quando o item é criado pela API (V-57), ou um campo com nome de recebimento.
  - Se o sistema de rastreamento grava direto no banco, o `date-created` fica vazio, a não ser que a coluna tenha um valor padrão no banco. A tela avisa quando o campo escolhido está vazio nas posições recentes.
- **Fuso pelo nome.** O fuso é sempre um nome, como America/Sao_Paulo, que conhece o horário de verão antigo. Num campo sem fuso, a hora que se repete na volta do horário de verão é ambígua, e a extensão usa a primeira ocorrência.

**Trajeto** (D-025)

- **Configurações de trajeto da coleção,** feitas pelo admin (7.8, configuração por coleção). Valem para a operação trajeto, o playback, a camada ao vivo e os relatórios de frota e de cerca virtual:
  - **campo do objeto:** o que identifica quem se move (veículo, placa, aparelho), ou "um objeto só". A interface sugere os campos candidatos, e o valor é comparado normalizado (maiúsculas, sem hífen e sem espaço);
  - **perfil**, com valores prontos que o admin pode mudar:

    | Perfil   | Quando usar                                                           | Limite do trecho | Ponto suspeito                                                                                               | Parada         |
    | -------- | --------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ | -------------- |
    | Contínuo | posições frequentes, como as de um rastreador ou de um app            | 10 min           | sai da linha e fica marcado na lista                                                                         | 50 m por 5 min |
    | Esparso  | posições de vez em quando, como as de câmeras ou de registros manuais | 2 min            | fica na linha, marcado, porque pode ser um identificador duplicado (uma placa clonada) ou um erro de leitura | desligada      |

  - **velocidade máxima** (por padrão, 200 km/h): o ponto que exigiria velocidade maior, em relação ao último ponto válido, é suspeito. Uma posição com hora no futuro também é suspeita (datas e fusos, acima);
  - **campo de velocidade**, opcional: quando existe, é a velocidade usada; senão, ela é calculada pela distância e pelo tempo.
- **Trechos e lacunas.** Quando falta posição por mais tempo que o limite do trecho, a linha se quebra, e a lacuna aparece tracejada, com o salto: "30 min · 12 km em linha reta · ao menos 24 km/h".
  - A velocidade em linha reta é a menor possível. Se nem ela cabe na velocidade máxima, o salto é suspeito.
  - A distância da lacuna fica fora do total e é informada à parte.
  - A linha não quebra à meia-noite, só por lacuna.
- **Paradas** (D-026). O objeto está parado quando fica dentro de um raio por um tempo mínimo (no perfil contínuo, 50 m por 5 min). A parada é uma forma do resultado: um ponto no centro das posições, com início, fim e duração.
  - **Parada provável:** a lacuna em que o objeto reaparece perto de onde sumiu, como o caminhão que dorme na garagem com o rastreador desligado. Aparece à parte ("parada provável · 12 h sem posição"), porque ele pode ter saído e voltado.
  - **Parada ociosa:** a parada com o motor ligado, quando a camada tem campo de ignição.
  - **No perfil esparso, a parada vem desligada.** Com posições de vez em quando, as regras inventariam paradas: uma câmera que lê o carro às 07:00, na saída, e às 19:00, na volta, viraria uma "parada provável de 12 h" em frente à câmera. O relatório omite a seção em vez de mostrar esse número. O admin pode ligar a parada, se os dados da coleção permitirem.
  - **Encadeamento:** "paradas do caminhão → por área → cercas dos clientes" dá a prova de entrega.
  - **Detecção:** percorre os pontos de cada objeto em ordem de tempo, em fluxo, sem carregar tudo na memória.
- **Várias origens para o mesmo objeto.** O trajeto aceita várias camadas, como câmeras fixas, o leitor da viatura, avistamentos e o rastreador do veículo. Cada coleção entra com as suas configurações de trajeto e pela sua query permitida. A que o usuário não pode ler fica de fora, com o aviso "sem acesso".
- **Leitura na tela:**
  - a cor da linha mostra o tempo: uma cor por dia até 7 dias, com os dias na legenda, e um gradiente do mais antigo ao mais recente acima disso;
  - o símbolo do ponto mostra a origem, definido na coleção e trocável na camada, e o ponto suspeito ganha um anel de alerta;
  - setas de sentido ao longo da linha;
  - na lista, cada lacuna é uma linha própria entre dois itens ("30 min sem posição · 12 km"), e cada dia tem um separador. A navegação pelas setas passa pelos dois.
- **No SQL:** funções de janela, por objeto e em ordem de tempo, calculam o intervalo e a velocidade de cada passo, e cada trecho vira uma linha. As várias origens entram juntas, cada uma pela sua query permitida.

**Cerca virtual** (D-028, D-029)

- **A regra.** As posições de cada objeto são ordenadas pela hora e marcadas como dentro ou fora de cada cerca, com o "toca" da D-023. De fora para dentro é uma entrada, de dentro para fora é uma saída, e o que fica entre as duas é a visita.
- **A hora é um intervalo observado, mais uma estimativa.**
  - "Entrou entre 10:01:30 e 10:02:00" é o fato.
  - "Estimado 10:01:48" é o ponto em que a linha entre as duas posições cruza a borda, supondo velocidade constante.
  - A permanência traz o mínimo observado, da primeira à última posição dentro, e a estimativa.
- **Passagem estimada.** No perfil contínuo, a linha entre duas posições seguidas também é testada. Se ela atravessa a cerca sem nenhuma posição dentro, fica registrada uma passagem estimada, marcada como tal. Não vale para lacunas nem para o perfil esparso, porque ali a linha não é um caminho observado.
- **Vaivém.** Uma saída seguida de nova entrada na mesma cerca em menos de 1 min junta as duas visitas, para que a oscilação do GPS na borda não vire dezenas de entradas. O tempo é ajustável na análise, e uma passagem rápida de verdade continua contando.
- **Critérios à vista.** O resultado e o relatório mostram os critérios usados (D-027).

**Tempo real**

- **Opção "ao vivo" por camada,** com a hora da última atualização e um aviso quando os dados param de chegar.
- **O WebSocket do Directus não é o caminho principal**, por três motivos:
  - vem desligado por padrão;
  - lê cada evento de novo, com a permissão, para cada inscrito: 1.000 veículos por segundo com 50 pessoas olhando dariam 50 mil leituras por segundo;
  - só enxerga gravações feitas pelo Directus.
- **Canal próprio por SSE (Server-Sent Events).** É uma conexão HTTP comum por onde o servidor envia as atualizações. Não depende de configuração, usa a mesma autenticação e passa por proxies. Uma conexão por mapa leva todas as camadas ao vivo.
- **Atualização em pulsos.** A cada pulso (por exemplo, 1 s), o servidor junta o que mudou e envia de uma vez, com uma consulta por query permitida. Quem tem as mesmas permissões compartilha a mesma consulta.
- **Permissão a cada pulso.** O lote sai da query permitida de cada usuário. Uma viatura que entra na zona norte some do mapa da Maria.
- **Movimento suave.** O deck.gl leva cada objeto da posição antiga até a nova ao longo do pulso.

**Acompanhar um objeto** (D-035)

- **Seguir.** O objeto fica no centro do mapa a cada pulso. Arrastar o mapa desliga o seguir, e um botão o religa.
- **Rastro.** Numa coleção com configurações de trajeto, a camada ao vivo desenha atrás de cada objeto o trecho recente, por padrão os últimos 30 min, ajustável na camada. As regras do trajeto valem a cada pulso: o trecho cresce, a lacuna fica aberta enquanto o objeto está sumido ("sem posição há 12 min"), e o ponto suspeito é marcado na hora.
- **Atalho.** A ação "Acompanhar ao vivo", num item, cria a camada ao vivo filtrada no objeto dele, com o rastro e o seguir ligados. Vale no layout, no módulo e no painel.
- **Fora do Studio.** O mesmo canal está na API e no SDK (7.8), para o app da equipe em campo ou para o portal que mostra onde está uma entrega.

**Gravações feitas fora do Directus** (por exemplo, o serviço que recebe os GPS gravando direto no banco)

1. **Pelo Directus:** os hooks da extensão avisam o cache e o tempo real, para tudo o que passa pelo Directus.
2. **Gatilho no banco (Postgres):** avisa a extensão a cada gravação, venha de onde vier (`LISTEN/NOTIFY`). É criado por ação do admin, com o SQL à vista. São uma função, criada uma vez, e os gatilhos das tabelas escolhidas, com o prefixo `geospatial_`. Eles não mudam colunas nem dados, e entram no inventário da extensão (7.8, D-039).
3. **Campo de data de atualização (qualquer banco):** a extensão verifica periodicamente o que mudou desde o último pulso, usando um campo escolhido na configuração da coleção (7.8). O campo precisa ser preenchido por quem grava, na criação e na atualização: o `date-updated` do Directus sozinho não serve, porque só é preenchido nas atualizações feitas pelo próprio Directus (V-57). Não enxerga exclusões, e a extensão sugere um índice no campo.

A mesma detecção invalida o cache (7.1). Ela também entra na matriz de capacidades: o gatilho existe só no Postgres, e nos outros bancos vale o campo de data.

#### Grupo 6: acabamento

**Tema**

- **Variáveis de tema.** A extensão usa as variáveis de tema do Directus (`--theme--*`), como o mapa nativo. Assim segue o modo claro ou escuro de cada usuário e os temas personalizados. As variáveis que mudaram de nome entre v11 e v12 funcionam nas duas versões.
- **Mapa de fundo.** Acompanha o tema (7.7).
- **Cores dos dados:**
  - paletas testadas nos dois fundos, com contraste suficiente e seguras para daltonismo;
  - contagens (mapa de calor, contagem por região, grade) com paletas sequenciais de percepção uniforme, como a viridis;
  - as cores configuradas nos campos têm prioridade.

**Responsividade**

- **Telas pequenas:** a lista lateral vira uma gaveta que sobe da parte de baixo da tela, e a barra de ferramentas vira um menu compacto.
- **Toque:**
  - pinça para zoom;
  - o primeiro toque abre o cartão e o segundo abre o item;
  - toque longo abre as ações;
  - no lugar do desenho livre entra o polígono;
  - alvos de toque de pelo menos 44 × 44 px.
- **Painel pequeno no dashboard:** modo compacto (mapa e legenda, sem ferramentas), com o botão "abrir no módulo", que leva a mesma visão para a tela cheia.

**Idiomas**

- **pt-BR e inglês,** com arquivos de tradução separados e abertos a contribuições da comunidade.
- **O idioma segue o do usuário no Directus.** Os textos da extensão entram no mesmo sistema de tradução do Studio.
- **Nomes de coleções e campos** aparecem com as traduções configuradas pelo admin.
- **Números, datas, distâncias e áreas** são formatados conforme o idioma.

**Acessibilidade**

- **Meta: WCAG 2.2 nível AA,** o padrão de mercado e a referência de leis como a LBI e o European Accessibility Act.
- **O mapa sempre tem uma alternativa acessível: a lista.** Tudo o que aparece no mapa está na lista de resultados, que o leitor de tela lê (7.2). A legenda é texto, não só cor.
- **Toda operação pode ser feita sem desenhar:**
  - o centro do raio pode vir de um endereço buscado, de coordenadas digitadas ou de um item selecionado, e a distância é digitada;
  - a área pode ser um polígono que já existe, como um bairro.

  Isso serve a quem usa teclado ou leitor de tela e também a quem precisa de precisão.

- **Requisitos gerais:**
  - contraste mínimo de 4,5:1 para textos e de 3:1 para controles;
  - rótulo em todo botão de ferramenta;
  - foco controlado nos drawers e popups;
  - interface funcionando com zoom de 200% no navegador.
- **Verificação:** o axe-core roda nos testes de ponta a ponta (Playwright), e antes de cada release há um teste manual com leitor de tela (NVDA e VoiceOver).
- **Teclado, região ao vivo e "reduzir movimento"** estão no 7.2.

### 7.4 Suporte a vários bancos

#### Arquitetura

- **Um adaptador por banco, todos com a mesma interface.** Cada operação é implementada no SQL do banco sempre que ele permitir.
- **A permissão continua vindo do Directus** (seção 5). O Directus monta a query permitida no dialeto do banco, e o adaptador só escreve a parte espacial em volta. A regra de ouro vale em todos os bancos.
- **O que o banco não faz, o Node completa**, sempre sobre os itens já permitidos, com um limite de volume (por exemplo, 50 mil itens) e um aviso quando o limite for atingido:
  - distâncias e áreas com a GeographicLib, o mesmo cálculo do PostGIS, e as outras operações geométricas com Turf;
  - tiles montados a partir das linhas nos bancos sem `ST_AsMVT`, com `geojson-vt` e `vt-pbf`;
  - focos (DBSCAN) em JavaScript.

  O agrupamento por células é aritmética sobre as coordenadas e roda em SQL em qualquer banco.

- **Matriz de capacidades.** Na inicialização, a extensão detecta o banco, a versão e as extensões instaladas (por exemplo, a versão do PostGIS ou a presença da SpatiaLite). Para cada operação, registra um de quatro níveis: no banco com índice, no banco sem índice, no Node com limite ou indisponível. A interface, a API e os testes leem dessa matriz.
- **A saúde do índice (7.6) vale para todos os bancos**, com o índice de cada um: GiST no Postgres, `SPATIAL INDEX` no MySQL e no MariaDB, índice com caixa limite no SQL Server, metadados mais índice espacial no Oracle.

#### O que cada banco oferece hoje (fatos em [verificacoes.md](verificacoes.md); lacunas confirmadas nos testes)

- **PostgreSQL + PostGIS:** tudo, pois é a referência.
- **CockroachDB:** o Directus usa o mesmo helper do Postgres. Tem os tipos e boa parte das funções do PostGIS. As lacunas para o nosso catálogo, como `ST_AsMVT` e os mais próximos usando o índice, serão confirmadas.
- **MySQL:** o Directus grava a geometria sem SRID, e a coluna fica sem o atributo SRID. Nessa situação, o otimizador ignora os índices espaciais, e o índice ainda exige `NOT NULL`. A correção a testar é marcar a coluna como `NOT NULL SRID 0` e criar o índice.
- **MariaDB:** passa pelo mesmo helper do MySQL. O índice espacial exige `NOT NULL`. As distâncias são planas, e metros só com `ST_Distance_Sphere`.
- **SQL Server:** a coluna é `geometry` (plano) com SRID 4326. Para medir em metros, os itens são convertidos para `geography` depois do filtro por caixa.
- **Oracle:** a coluna é `sdo_geometry` com SRID 4326 (geodésico, em metros), e há busca de mais próximos com índice (`SDO_NN`). O filtro nativo do Directus usa um operador que provavelmente exige índice espacial; isso será confirmado.
- **SQLite:** só tem geometria se a SpatiaLite já estiver carregada. Na prática, é banco de desenvolvimento e de testes.

#### Como lidar com as diferenças

- **A matriz varia por banco e por versão,** inclusive a do Directus (D-037). Mesmo no Postgres, a grade hexagonal exige PostGIS 3.1 ou mais novo.
- **O usuário comum vê cada operação em um de três estados:**
  - disponível;
  - disponível com limite: roda no Node, e quando o limite afeta um resultado, o resultado avisa;
  - indisponível: a operação não aparece.
- **O admin vê a matriz completa no painel de saúde**, com o motivo de cada item indisponível ou limitado e como liberá-lo (instalar o PostGIS, atualizar a versão, criar o índice).
- **Visões salvas que usam algo indisponível** (bookmark, painel de dashboard, link compartilhado) abrem com um aviso, e o resto delas funciona.
- **API e SDK.** `GET /geospatial/capabilities` devolve a matriz. Chamar uma operação indisponível devolve um erro com código próprio e o motivo, no formato de erro do Directus. O SDK expõe as duas coisas.
- **Detectar de novo.** Um botão no painel de saúde refaz a matriz sem reiniciar, por exemplo depois de instalar o PostGIS.

#### Testes

1. **Testes de contrato:** a mesma suíte para todos os bancos.
   - Um conjunto fixo de dados é carregado pela API do Directus, para que fique gravado do jeito que o Directus grava em cada banco.
   - Cada operação declarada na matriz tem um resultado esperado, com tolerância para distâncias.
   - Uma operação não declarada precisa devolver o erro de indisponível.
2. **Paridade de permissão com o `/items`**, usando um papel restrito.
   - Quando um filtro nativo faz a mesma pergunta (a operação por área com "toca" equivale ao `_intersects`, e com "fora", ao `_nintersects`), os IDs precisam ser idênticos. No Oracle, isso depende da P-12.
   - Quando não faz, como no raio, o teste calcula a resposta certa: busca os itens permitidos pelo `/items` e calcula com a GeographicLib.
3. **Ambiente real, sem mock de banco.** Directus v11 e v12 de verdade e bancos em containers, com as mesmas imagens dos testes do Directus. Cada banco roda na versão mínima suportada e na mais nova; as mínimas serão definidas no 7.5.

**Quando cada teste roda:**

- Em todo pull request: PostGIS e SQLite na versão mais antiga e na mais nova da faixa do Directus (D-037), mais os testes unitários.
- Em todo pull request que mexe na interface, também um ponta a ponta curto, que bloqueia o merge: o mapa abre no layout, um tile chega, o clique abre o drawer, e o axe-core não aponta violações. Roda com PostGIS e o Directus mais novo.
- Toda noite e antes de cada release: a matriz inteira.
- Um canário roda contra cada nova versão do Directus.

**Fora dos testes que bloqueiam:**

- Os benchmarks rodam sob demanda, e os números vão para [verificacoes.md](verificacoes.md).
- A suíte completa de ponta a ponta (Playwright), com PostGIS, nas três superfícies do Studio: o mapa abre, os tiles chegam e o clique abre o drawer, com a verificação de acessibilidade do axe-core. Roda toda noite e antes de cada release.
- Antes de cada release, há um teste manual com leitor de tela (NVDA e VoiceOver).

#### Cobertura

- **Código novo ou alterado:** pelo menos 90% em todo pull request. A cobertura total funciona como uma catraca: pode subir, nunca cair.
- **Motor** (adaptadores, permissões, tiles, consulta registrada): 90% de linhas e 90% de ramificações.
- **Cobertura somada entre os bancos.** Os relatórios de todos os bancos são somados, e um pull request que mexe num adaptador também roda o teste daquele banco.
- **Interface.** A lógica (composables, stores, cálculos, estado das ferramentas) fica em módulos testáveis, com 90%. A camada fina que só desenha no WebGL é coberta pelos testes de ponta a ponta, sem meta de linhas.
- **Teste de mutação** (Stryker) no módulo de permissões, toda noite, com meta de 90%.
- A cobertura precisa vir de testes de comportamento. Teste escrito só para bater a meta não conta.

### 7.5 Publicação e compatibilidade

#### Checagem de mercado (23/09/2026)

- **npm:** nenhuma extensão faz análise espacial no servidor. As de mapa são de visualização:
  - `@devix-tecnologia/directus-extension-mapgrid`, um layout com mapa e grade (o "map-grid" citado na seção 3), com última versão em março de 2025;
  - uma interface de mapa para relações (`o2m-map`);
  - um mapa L7 de 2023.
- **O nome `directus-extension-geo` já existe no npm,** numa extensão de dados de países, estados e cidades.
- **Directus Cloud:** não há confirmação oficial de PostGIS. A documentação da Supabase diz que o Cloud ainda não permite ligar um banco externo, e extensões customizadas só existem no Enterprise. O público é quem hospeda o próprio Directus; no Cloud, só o Enterprise, depois de confirmar o PostGIS com a Directus.

#### Versões suportadas

- **Directus** (D-037): a major atual a partir do piso testado, mais a última minor de cada major anterior que continua na política. Hoje, `host: ^11.17.0 || ^12.4.0`; quando sair o v13, `^11.17.0 || ^12.<última minor> || ^13.<piso>`.
  - O piso é a minor mais antiga que a matriz testa, e a matriz testa o piso e a mais nova. O piso só desce com teste, porque as funções internas usadas pela D-001 podem mudar entre minors. O canário testa cada versão nova.
  - Uma major anterior fica enquanto a matriz inteira passar nela, e só sai por decisão nova, com o aviso publicado uma minor antes. O v11 e o v12 têm licenças diferentes (V-60, V-61), e muita gente fica no v11 por causa disso.
  - O que depender de algo novo de uma major mais recente aparece como indisponível nas anteriores, pela matriz de capacidades.
  - O Marketplace só oferece a última versão de cada extensão, então todo release precisa valer para a faixa inteira; do contrário, quem está numa major anterior perderia a instalação pelo Marketplace.
  - O CLI do SDK ainda gera `host: ^10.10.0`, então o valor é ajustado à mão.
- **Bancos:** a mesma política do Directus, que é suportar as versões LTS. A mínima de cada banco é a mais antiga que o fabricante ainda suporta na data do release. A matriz de testes roda a mínima e a mais nova, e a lista concreta é revista a cada release.
- **PostGIS:** a mais antiga que o projeto PostGIS ainda mantém, nunca abaixo da 3.1 (a primeira com a grade hexagonal).
- **Navegador:** WebGL2, como o mapa nativo.

#### Instalação

- **Por que não é um clique com a configuração padrão:** o endpoint acessa o banco e não pode rodar em sandbox, e o Marketplace, por padrão (`MARKETPLACE_TRUST=sandbox`), só lista e instala extensões de API em sandbox.
- **Três caminhos documentados:**
  1. **Marketplace:** o admin define `MARKETPLACE_TRUST=all`, e a extensão aparece e instala pelo Studio. É o mais simples, mas libera qualquer extensão fora do sandbox, e a documentação explica esse risco.
  2. **Imagem Docker:** um Dockerfile pronto, em etapas porque a imagem do v12 não tem npm, que acrescenta a extensão à imagem oficial. É o caminho recomendado para produção, porque é versionado e reproduzível.
  3. **Pasta de extensões:** o build da release no GitHub, montado em `EXTENSIONS_PATH`.
- **Exemplo completo com `docker compose`:** Directus, PostGIS, Redis e a extensão. É o mesmo usado na demo.
- **Um pacote só.** Uma parte em sandbox não teria motor sem o endpoint, então não vale separar.
- **Formato do pacote:** um bundle com endpoint, hooks (cache e tempo real), layout, módulo, painel e a operação de Flow. O SDK é publicado como pacote separado, para quem o usa nos próprios front-ends.
- **Requisitos do Marketplace:** publicar no npm com a palavra-chave `directus-extension`, preencher `name`, `version`, `directus:extension.type` e `directus:extension.host`, e incluir a pasta `dist`. O README vira a página da extensão, e as imagens só carregam de `raw.githubusercontent.com`.

#### Confiança

Uma extensão fora do sandbox tem acesso total ao banco. Para quem instala poder confiar nela:

- publicação no npm com _provenance_ (assinada pelo GitHub Actions);
- SBOM (lista de dependências) a cada release;
- `SECURITY.md` com canal para reportar falhas;
- CHANGELOG e versionamento semântico;
- documentação que lista exatamente o que a extensão acessa: tabelas, funções internas do Directus e variáveis de ambiente.

#### Nome e licença

- **Pacote:** `directus-extension-geospatial`, sem escopo, que aparece no Marketplace como "Geospatial". O nome descreve o assunto (dados geoespaciais), então cobre também os relatórios (7.9).
- **Prefixos:** `/geospatial` na API e `geospatial_` nas coleções da extensão. Um prefixo genérico como `/geo` poderia colidir com a extensão `directus-extension-geo`, que já existe.
- **SDK:** pacote separado, `directus-geospatial-sdk`, sem o prefixo `directus-extension-`, porque não é uma extensão: ele roda nos front-ends de quem usa.
- **Licença:** MIT, a mesma das extensões da Directus Labs e do mapgrid. Se um dia houver suporte pago ou uma versão "pro", isso funciona como um pacote separado.

#### Documentação

- **Idiomas:** inglês como principal (o Marketplace é global) e o guia do usuário também em pt-BR.
- **README:** vira a página no Marketplace, com o que a extensão faz, GIFs, os três caminhos de instalação e um início rápido.
- **Site de documentação**, com uma versão por release:
  - guia do usuário;
  - guia do admin (instalação, índices, permissões, Redis, CSP, provedores, variáveis de ambiente, tudo o que a extensão acessa, os dados pessoais (7.10) e o roteiro de desinstalação (7.8));
  - referências da API (gerada do OpenAPI) e do SDK (gerada dos tipos);
  - a operação de Flow e os relatórios;
  - a matriz de capacidades por banco, gerada a partir dos testes de contrato;
  - contribuição, CHANGELOG e SECURITY.
- **Capturas de tela** geradas automaticamente a partir da demo.

#### Demo e dataset

- **Demo local:** um `docker compose` sobe Directus, PostGIS, Redis, a extensão e os dados.
- **Dataset**, criado por um gerador que carrega os dados pela API do Directus, como nos testes:
  - uma frota com trajetos de GPS sobre ruas reais, mais um simulador de posições ao vivo;
  - ocorrências com categoria, status e data, num volume configurável (10 mil na demo, 100 milhões no benchmark);
  - bairros e vias de dados abertos, com as atribuições exigidas pelas licenças (a ODbL do OpenStreetMap, por exemplo).
- **Cidade:** São Paulo, com uma coleção em SIRGAS 2000 / UTM 23S, para mostrar o suporte a SRID que o mapa nativo não tem.

#### Demo pública

Fica num servidor próprio do autor, com volume moderado (alguns milhões de pontos). A estimativa, a confirmar medindo, é de 4 GB de RAM e 2 vCPUs. O benchmark de 100 milhões roda em outra máquina.

- **O Studio exige login.** O papel público do Directus vale para a API, não para o Studio.
- **Studio com usuários de demonstração**, cujas senhas ficam publicadas na tela de login:
  - "Operador": usa o layout, o módulo e o painel e edita itens da demo, sem acesso a configurações, Flows, usuários ou upload;
  - "Maria, Operador Zona Sul": igual ao Operador, mas só vê a zona sul, para mostrar a regra de ouro na prática.
- **Nunca um admin.** Um admin permitiria instalar extensões, mudar configurações, criar Flows que fazem requisições externas e subir arquivos. As funções de admin aparecem na documentação.
- **API pública só de leitura,** com limite por IP. Os exemplos da documentação apontam para ela e funcionam de verdade.
- **Proteções:**
  - o banco é restaurado a partir de uma cópia limpa periodicamente;
  - HTTPS com Let's Encrypt;
  - limitador de pedidos do Directus ligado, além dos limites da extensão;
  - cadastro público, e-mails e upload desligados para os papéis da demo.
- **Instalação pela imagem Docker,** para a demo testar a própria receita.
- **O simulador ao vivo** roda sem parar.
- **Aviso na tela de login:** dados fictícios, apagados periodicamente, com as atribuições dos mapas.

### 7.6 Metros, SRID e índices

**O problema.** Em SRID 4326, as coordenadas estão em graus, e as funções sobre `geometry` calculam em graus. Converter para `geography` dá o resultado em metros, mas impede o uso do índice espacial da coluna.

- **Metros sem perder o índice: filtro em dois estágios.** Primeiro, uma caixa no SRID da coluna, que usa o índice e descarta quase tudo. Depois, o teste exato em metros com `geography`, só no que sobrou. O tamanho da caixa é calculado a partir do raio e da latitude, para ela sempre conter o círculo. O resultado é exato e o esquema não muda.
- **Mais próximos:** o `<->` acha os candidatos pelo índice, e o `geography` dá a ordem exata.
- **Medições** (distância, área, perímetro, comprimento) sempre em `geography`.
- **Qualquer SRID.** O motor lê o SRID da coluna, converte a entrada do usuário (que chega em 4326) para esse SRID, para usar o índice, e devolve o resultado em 4326 para o mapa. Colunas `geography` também são suportadas. O Directus não trata SRID, então a extensão funciona onde o mapa nativo falha, por exemplo com SIRGAS 2000 / UTM 23S (EPSG:31983).
- **Saúde do índice.**
  - O Directus nunca cria índice espacial: a opção "Index" do campo cria um B-tree. A extensão detecta quando falta um índice espacial em cada coluna de geometria.
  - Sem o índice, todos os usuários veem um aviso que explica o impacto: cada operação e cada movimento do mapa varrem a tabela inteira, o que pode levar segundos e pesa o banco para todos.
  - O admin tem um botão que mostra o SQL exato (`CREATE INDEX CONCURRENTLY ... USING gist`) e pede confirmação. A confirmação mostra o tamanho da tabela e, quando ela é grande, sugere rodar fora do horário de pico.
  - A criação roda em segundo plano, fora da requisição HTTP, com barra de progresso (`pg_stat_progress_create_index`). É um trabalho do executor da extensão (7.8).
  - Se falhar, a extensão detecta o índice inválido e oferece apagar e tentar de novo.
  - Os tempos reais de criação serão medidos no dataset de demonstração.
- **BRIN nos campos de data.** Ele guarda o menor e o maior valor de cada bloco da tabela. Com dados que chegam em ordem de tempo (GPS, telemetria), um filtro por período pula quase toda a tabela, e o índice ocupa poucos MB. A extensão o sugere quando a correlação do campo é alta (`pg_stats.correlation`), no mesmo fluxo do GiST.
- **B-tree em (objeto, data) nas coleções com trajeto.** O trajeto busca os pontos de um objeto num período, e o B-tree no par vai direto a eles, sem varrer o período de todos os objetos. A extensão o sugere no mesmo fluxo, quando a coleção tem configurações de trajeto (7.3, grupo 5).
- **Polígonos pesados.** Um polígono salvo com dezenas de milhares de vértices, como o limite de um município do IBGE, usado como área (por área, contagem por região, cerca virtual), deixa a consulta lenta: a caixa dele pega muitos pontos de fora, e cada ponto que sobra é testado contra o polígono inteiro.
  - Acima de um número de vértices (por exemplo, 256), o SQL divide o polígono em pedaços pequenos com `ST_Subdivide` e testa os pontos contra os pedaços. O resultado é idêntico, só mais rápido, e nada muda no banco, porque tudo acontece dentro da consulta.
  - Nos bancos sem essa função, o adaptador faz o teste direto, mais lento e igualmente certo.
  - O ganho será medido com municípios do IBGE ([pendências em verificacoes.md](verificacoes.md#pendências)).
- **Tabelas particionadas auxiliares: avaliadas e não adotadas como arquitetura.**
  - O Directus não enxerga tabelas particionadas, por isso a ideia era a extensão manter uma cópia particionada só para as leituras espaciais.
  - Motivos para não adotar: dobra o disco, exige sincronização e manutenção de partições, e o Directus continua lento na tabela principal. O principal: pela seção 5, toda consulta na auxiliar precisaria voltar à principal para conferir a permissão, e isso anula o ganho justamente nas consultas pesadas.
  - A ideia fica como hipótese para o benchmark ([pendências em verificacoes.md](verificacoes.md#pendências)). Se o ganho medido justificar, ela vira um acelerador opcional por coleção, ligado pelo admin.

### 7.7 Mapas de fundo

O mapa tem vários mapas de fundo, com um seletor, organizado em três grupos:

1. **Do Directus.** A mesma lista do mapa nativo, com os mesmos nomes: OpenStreetMap (sempre), Mapbox (quando há chave) e os mapas cadastrados pelo admin nas configurações (tipos `raster`, `tile` e `style`). Satélite, Esri, MapTiler e Google entram por aqui, com a chave de cada provedor e respeitando os termos de cada um. O OpenStreetMap usa o endereço atual (`tile.openstreetmap.org`) e mostra sempre a atribuição.
2. **Da extensão, sem chave: OpenFreeMap.** Estilos Positron (claro), Dark (escuro), Liberty e Bright. É gratuito, sem limite de acessos, sem cadastro e com uso comercial permitido. Os estilos claro e escuro acompanham o tema do Studio.
3. **PMTiles no próprio Directus.** O admin guarda em Arquivos um arquivo `.pmtiles` com a região, e o mapa o lê pelo `/assets`, aos pedaços. Os estilos claro e escuro vêm do Protomaps, e a extensão serve as fontes e os ícones do mapa. Funciona sem internet, o que importa para centrais de operação em redes fechadas.

- **Padrão de fábrica:** OpenFreeMap, claro ou escuro conforme o tema. O admin pode definir outro padrão, inclusive o OpenStreetMap, e cada visão guarda o mapa escolhido.
- **Por que o padrão não é o OpenStreetMap:** os servidores de tiles do OSM são mantidos por voluntários, e a política de uso permite bloquear o acesso sem aviso se o uso prejudicar o serviço. Além disso, uma imagem raster fica borrada no zoom e não tem versão escura.
- **Riscos:** o OpenFreeMap vive de doações. Por isso a documentação recomenda o PMTiles ou um provedor pago para produção crítica.
- **Rede:** a CSP padrão do Directus libera os endereços `https` e os workers que o mapa usa. Servidores de tiles em `http` simples, comuns em intranet, ficam bloqueados; o PMTiles evita esse problema.

### 7.8 Pontos que surgiram na discussão

#### Armazenamento da extensão

| O quê                                                                                                                                                                                                         | Onde                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Estado do layout                                                                                                                                                                                              | Presets e bookmarks do Directus                                                                     |
| Configuração de cada painel                                                                                                                                                                                   | Opções do painel no dashboard                                                                       |
| Arquivos PMTiles, imagens das capturas e PDFs dos relatórios                                                                                                                                                  | Arquivos do Directus; os dos relatórios numa pasta própria, fora do alcance dos papéis comuns (7.9) |
| Visões do módulo, consultas salvas e compartilhadas, configurações do admin, o inventário do que a extensão criou no banco e nas permissões (D-039), relatórios e capturas (7.9) e trabalhos em segundo plano | Coleções da própria extensão                                                                        |
| Registro das consultas por id, progresso dos índices, versão das coleções para o cache, cache da busca de endereço, limites de pedidos, estado das cercas por objeto para os alertas                          | Memória, ou Redis quando o Directus usa Redis                                                       |

- **Coleções do Directus, e não tabelas soltas.** Assim as permissões do Directus decidem quem vê e quem edita cada visão (regra de ouro), as coleções entram no backup e já têm API. Ficam numa pasta própria, ocultas na navegação de conteúdo, e os nomes usam o prefixo `geospatial_` (7.5).
- **Criação e atualização por ação do admin**, como no índice.
  - O admin vê a lista do que será criado ou mudado e confirma.
  - As migrações têm uma trava contra duas instâncias rodando ao mesmo tempo.
  - Antes disso, o layout e o painel já funcionam; só o módulo e o compartilhamento de consultas esperam.
- **Permissões prontas, opcionais.** Cada visão tem dono e visibilidade: só o dono, o papel dele ou todos. A extensão oferece ao admin criar uma política pronta com essas regras e mostra as permissões antes de confirmar.
- **Inventário e remoção** (D-039). Toda ação do admin que cria algo fica no inventário, com como desfazer, e o painel de saúde o mostra. A ação "Remover o que a extensão criou" desfaz o que estiver lá: por padrão, a função, os gatilhos e as políticas prontas; os índices ficam, com a opção de removê-los, porque ajudam o próprio Directus; as coleções da extensão e a pasta dos relatórios só saem com confirmação digitada. O guia do admin traz o roteiro de desinstalação.
- **Chaves e segredos em variáveis de ambiente**, nunca no banco. As configurações que não são segredo ficam na coleção de configurações, editáveis pela interface.
- **Estado temporário em memória ou Redis.**
  - O id de uma consulta é o hash do conteúdo dela. Se o servidor esquecer um id, a interface registra de novo sem o usuário perceber.
  - Com várias instâncias, esse estado vai para o Redis, que o Directus já exige para escalar horizontalmente.
  - Salvar ou compartilhar uma consulta copia o conteúdo dela para a coleção da extensão.

#### Trabalhos em segundo plano (D-036)

O que demora mais que uma requisição roda num executor de trabalhos da própria extensão: a criação de índice (7.6), a exportação grande e as ações sobre o resultado inteiro (7.3, grupo 4), a ação "Resultado inteiro" dos Flows e a geração de relatórios, inclusive os agendados (7.9).

- **Um registro por trabalho,** na coleção `geospatial_jobs`, com o tipo, o dono, o estado (na fila, rodando, concluído, falhou, cancelado ou interrompido), o progresso e o ponto de retomada. A coleção não registra atividade nem revisões, para o progresso não encher o histórico do Directus.
- **Uma trava com prazo:** a instância que pega o trabalho renova a trava enquanto trabalha. Se ela cair, a trava vence, e outra instância retoma do último ponto salvo. A trava é um `UPDATE` condicional no banco, então funciona em todos os bancos, sem exigir Redis.
- **Lotes que podem rodar de novo sem duplicar nada,** com o ponto de retomada gravado a cada lote. O que não dá para retomar fica "interrompido", com notificação. É o caso do índice, que fica inválido e é refeito.
- **A permissão de quem pediu,** conferida de novo em cada lote e na retomada (seção 5).
- **Progresso, cancelamento e notificação** pela mesma rota e pela mesma tela, para todos os tipos. Os trabalhos usam o pool próprio, com a prioridade mais baixa da fila (7.1).

#### Configuração por coleção (D-027)

O admin configura cada coleção uma vez, numa tela do módulo. Todas as camadas, visões, painéis, relatórios e Flows daquela coleção herdam essa configuração.

| Seção                            | O que se configura                                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campos                           | a geometria padrão, quando há mais de uma, a data padrão, usada pela janela de tempo e pelo playback, o fuso dos dados, nos campos sem fuso, e a hora de recebimento, opcional (7.3, grupo 5) |
| Trajeto                          | o objeto, o perfil (contínuo ou esparso) e os valores dele, os campos de velocidade e de ignição, e o símbolo da origem (7.3, grupo 5)                                                        |
| Mudanças feitas fora do Directus | como detectar: só pelo Directus, pelo gatilho no Postgres ou por um campo de data de atualização (7.3, grupo 5)                                                                               |
| Índices                          | a saúde dos índices da coleção, com as ações do admin (7.6)                                                                                                                                   |

- **O que continua na camada:** o filtro, o estilo, o agrupamento, a opacidade, a ordem, a opção "ao vivo" e, se preciso, outro símbolo para a origem.
- **O que é da instalação:** o fuso da instalação, o provedor de endereço, os mapas de fundo e o padrão deles, os limites (seleção, vértices, profundidade da cadeia, volume no Node, máximo de itens na saída do Flow, máximo de arquivos e de tamanho por relatório), a retenção (7.10), os tempos máximos, a fila, o cache e o pulso ao vivo.
- **Ajuste na análise:** uma análise pode mudar os valores do trajeto para uma pergunta específica, como "só paradas de pelo menos 15 min". O ajuste fica na consulta registrada, e o resultado e o relatório mostram os critérios usados.
- **Sem configuração,** a coleção usa os padrões. O trajeto só aparece depois que o admin escolhe o objeto; até lá, o admin vê o motivo e o usuário comum não vê a operação, como na matriz de capacidades (7.4).
- **Onde fica guardada:** na coleção de configurações da extensão. Só o admin edita.

#### API e SDK

**Por que existem e quem usa**

- **O próprio Studio depende da API.** O layout, o módulo e o painel rodam no navegador e fazem toda operação pelo endpoint da extensão. A interface é o primeiro cliente da API.
- **Para quem usa fora do Studio.** O Directus é _headless_, e a maioria dos projetos tem front-ends próprios. Exemplos de uso:
  - "lojas perto de mim" num site;
  - o app da equipe em campo pedindo as ocorrências num raio;
  - o sistema de despacho perguntando qual viatura está mais próxima;
  - um mapa público no site da empresa, com os tiles da extensão e o papel público do Directus;
  - as automações por Flow.

  Esse uso responde à dor que motivou o projeto, a de quem hoje escreve endpoint próprio ou SQL cru para ter proximidade. Dá para usar a extensão só pela API, sem a interface.

- **O SDK** é uma camada fina sobre a API para quem usa JavaScript ou TypeScript com o SDK oficial. Outras linguagens usam a API REST direto e podem gerar um cliente a partir do OpenAPI.
- **Abrir a API é seguro pela regra de ouro:** cada token recebe exatamente o que o papel dele permite.

**Dois jeitos de usar a API**

1. **No formato do `/items`, para quem integra.** `GET` ou `SEARCH /geospatial/items/:coleção` recebe os mesmos parâmetros do Directus (fields, filter, search, sort, limit) mais o parâmetro `geo`, com a operação. A resposta é `{ data, meta }`, como no `/items`. O `SEARCH`, que leva a consulta no corpo, é o mesmo que o `/items` aceita.
   - `data` são os itens. Nas operações que agregam (contagem por região, grade e focos), `data` traz uma linha por região, célula da grade ou foco, com a contagem, como o Directus faz com `aggregate` e `groupBy` (V-44).
   - As formas só saem pela consulta registrada. Quem integra por aqui já conhece a geometria que mandou.
2. **Consulta registrada, para o Studio, os dashboards e o compartilhamento.** `POST /geospatial/queries` registra a consulta e devolve o id, que os tiles, as três partes do resultado e a exportação usam. Cada parte tem a sua rota, e o mapa, a lista e o resumo carregam em paralelo (D-022).

**O que a API não cobre**

- **GraphQL:** a extensão expõe a API REST, e o SDK por cima dela. O GraphQL do Directus não ganha as operações espaciais.
- **Versionamento de conteúdo:** as operações leem a versão principal dos itens, como o `/items` sem o parâmetro `version`.

**Rotas**

| Rota                                           | O que faz                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /geospatial/capabilities`                 | Matriz de capacidades e versão da API                                                  |
| `GET` ou `SEARCH /geospatial/items/:coleção`   | Formato do `/items`, com a operação espacial                                           |
| `POST /geospatial/queries`                     | Registra a consulta e devolve o id                                                     |
| `GET /geospatial/queries/:id/items`            | Os itens, por cursor; com o id de uma região, célula da grade ou foco, só os de dentro |
| `GET /geospatial/queries/:id/shapes`           | As formas, em GeoJSON e por cursor                                                     |
| `GET /geospatial/queries/:id/summary`          | O resumo: total rápido ou exato (7.1) e medidas                                        |
| `GET /geospatial/tiles/:z/:x/:y.mvt?q=id1,id2` | Um tile com várias camadas                                                             |
| `GET /geospatial/live?q=id1,id2`               | O canal ao vivo, por SSE, com várias camadas (D-035)                                   |
| `GET /geospatial/queries/:id/export`           | Exportação (grupo 4 do 7.3)                                                            |
| `POST /geospatial/measure`                     | Medições entre itens ou formas                                                         |
| `GET /geospatial/geocode`                      | Busca de endereço, pelo endpoint                                                       |
| `/geospatial/reports/...`                      | Relatórios: capturas, geração e verificação (7.9)                                      |
| `/geospatial/admin/...`                        | Saúde, índices, coleções da extensão e "detectar de novo", só admin                    |
| `/geospatial/jobs/...`                         | Os trabalhos em segundo plano de quem pede: progresso e cancelamento (D-036)           |

O prefixo `/geospatial` vem do nome do pacote (7.5). As rotas de relatório estão no 7.9.

**Convenções do Directus**

- **Autenticação:** a do Directus (sessão, token ou `access_token`). O papel público também vale: se ele pode ler uma coleção, a extensão atende anônimos, com limite de pedidos por IP.
- **Erros:** no formato do Directus, com códigos próprios para operação indisponível, geometria inválida, limite excedido, consulta desconhecida (a interface registra de novo) e tempo esgotado.
- **Paginação:** por `limit` e `cursor`. O formato do `/items` também aceita `page` e `offset`, por compatibilidade, mas fica mais lento em páginas fundas.
- **Nomes das operações** (D-024): o id de cada uma é o termo canônico do glossário em camelCase: `radius`, `byArea`, `measure`, `nearest`, `trajectory`, `corridor`, `countByRegion`, `geofence`, `densityGrid`, `hotspots`, `buffer`, `center` e `simplify`.
- **Valores calculados** (distância, posição ao longo da linha, tempo desde o ponto anterior, contagem da região, foco do ponto) vêm num campo reservado, `$geo`, na mesma convenção do `$meta` do Directus. Nas formas, os números de cada uma (a contagem da célula da grade ou do foco) vão nas propriedades do GeoJSON.
- **Contrato primeiro:** um documento OpenAPI publicado em `GET /geospatial/openapi.json`. Os tipos do SDK e a validação saem desse mesmo contrato.
- **Tiles fora do Studio:** um app próprio com MapLibre ou Leaflet consome a mesma URL, com token.

**Validação da entrada, antes de tocar o banco**

- **Contrato:** tipos, faixas (distância, N, limit) e tamanho da consulta, por exemplo 256 KB, abaixo do limite de 1 MB do Directus.
- **Geometria:** máximo de vértices (por exemplo, 10 mil), área máxima, coordenadas dentro dos limites, geometria válida e tipos aceitos em cada operação.
  Acima do limite de vértices, a interface não só recusa: oferece a operação Simplificar, com a tolerância que cabe no limite, e mostra o antes e o depois ("de 50.000 para 8.200 vértices, tolerância de 2 m"). A API continua recusando o que passa do limite.
- **Nomes de coleções e campos** são conferidos contra o esquema do Directus e nunca entram no SQL como texto vindo do usuário. Os valores vão sempre como parâmetros.
- **Os limites** são configuráveis pelo admin.

**SDK**

- **Estilo:** o mesmo do SDK oficial, com comandos usados em `client.request(...)`, como o `readItems`. Por exemplo, `client.request(geoRadius('ocorrencias', { center, distance, fields }))`.
- **Comandos:** o id da operação com o prefixo `geo` (`geoRadius()`, `geoByArea()`, `geoCountByRegion()`), como o `geoCapabilities()`. O prefixo evita colisão de nomes genéricos, como `center()` e `measure()`, com o código de quem usa e com outras extensões, e agrupa tudo no autocompletar (D-024).
- **Tipos:** usa o esquema do usuário, com autocompletar de campos.
- **Paginação:** por cursor, como iterador (`for await`).
- **Partes do resultado:** na consulta registrada, um comando para cada parte (itens, formas e resumo).
- **Erros e capacidades:** erros tipados com os códigos da API, e `geoCapabilities()` para checar antes de chamar.
- **Mapas externos:** um ajudante monta a URL dos tiles.
- **Tempo real:** `geoLive()`, um iterador sobre o canal ao vivo, com o token no cabeçalho (D-035).

#### Flows: a quarta superfície

- **Por que.** Os Flows são a automação sem código do Directus, onde mora boa parte do valor operacional: despacho, alertas e enriquecimento de dados. A operação funciona com qualquer gatilho: evento, agendamento, webhook, manual (itens selecionados no Studio) e outro Flow.
- **Uma operação "Geo", com a ação escolhida nas opções:**
  1. **Mais próximos:** os N itens de uma coleção mais perto de um ponto ou de um item. Exemplo: ocorrência criada → viatura disponível mais próxima → "Atualizar dados" atribui a viatura.
  2. **Em qual região fica:** as áreas de uma coleção de polígonos que contêm um ponto. Exemplo: preencher o campo `bairro` de uma ocorrência nova.
  3. **Raio, por área ou corredor:** os itens, para os próximos passos. Exemplo: avisar todas as equipes num raio de 5 km.
  4. **Medir:** distância entre pontos ou itens, área e perímetro.
  5. **Endereço:** de endereço para ponto e de ponto para endereço, pelo mesmo provedor da busca (7.3). O limite do Nominatim público vale aqui também; para automação em volume, a documentação indica serviço próprio.
  6. **Alerta de cerca virtual:** avisa na hora que um objeto entrou numa cerca ou saiu dela (D-028). O estado fica por objeto, em memória ou no Redis, e a posição nova é comparada com ele. Depois de reiniciar, o estado é refeito pela última posição de cada objeto no histórico, então não sai alerta falso. Uma posição mais antiga que a última processada não gera alerta, mas entra no histórico. As entradas e saídas definitivas saem da operação cerca virtual (seção 6), e não dos alertas.
  7. **Operações de forma:** entorno, centro e simplificar (seção 6). Exemplo: cliente novo cadastrado → entorno de 200 m → "Criar dados" grava a cerca virtual dele.
  8. **Gerar relatório:** a partir de um modelo (7.9), inclusive com agendamento.
  9. **Resultado inteiro:** pelo id da consulta registrada, exporta (o arquivo vai para Arquivos) ou edita, arquiva e apaga em lotes, em segundo plano, como as ações sobre o resultado inteiro do Studio (7.3, grupo 4). Usa a permissão escolhida no Flow.
- **Permissões iguais às das operações nativas.** A mesma opção "Permissões" da operação "Ler dados" (do gatilho, papel público ou acesso total). A query permitida (seção 5) é montada com a identidade escolhida.
- **Saída:** vai para os dados do Flow com as mesmas partes da API (`items`, `shapes` e `summary`) e os valores calculados em `$geo`. Os passos seguintes a leem pela chave da operação ou por `$last` (V-45), por exemplo `{{ $last.summary.total }}` numa condição. Endereço, alerta de cerca e relatório têm saída própria.
  - **Limite (D-030):** itens e formas vêm até 100 por padrão, ajustável na operação até o máximo da instalação (por exemplo, 1.000). O resumo vem sempre completo, com o total real, e a saída avisa quando cortou.
  - **Campos:** só os pedidos, como na "Ler dados" nativa. O padrão é o id mais os valores de `$geo`.
  - **O resultado inteiro vai por id:** a saída traz o id da consulta registrada, que a ação "Resultado inteiro" usa.
- **Matriz e erros.** As ações indisponíveis no banco não aparecem nas opções. Um Flow salvo que use uma ação indisponível falha com o código de "indisponível" e segue pelo caminho de erro.
- **Volume.** Um Flow disparado a cada atualização de posição faz uma consulta espacial por disparo. Com índice, cada uma leva milissegundos, e o pool próprio e a fila (7.1) protegem o banco. Todo Flow novo vem com o registro completo, que grava os dados de todos os passos a cada execução (V-53); por isso a documentação recomenda o registro "só atividade" nos Flows de alta frequência.
- **Pacote.** A operação entra no mesmo bundle, com uma parte de interface (as opções) e uma parte de API (a execução).

### 7.9 Relatórios

#### Relatório de evidências

O usuário monta o relatório aos poucos, registrando estados da tela, e no fim tudo vira um PDF. Serve como evidência de rastreamento, de ocorrências e de análises.

**Fluxo**

1. O usuário monta a visualização (camadas, operação, filtros, janela de tempo) e clica em "Adicionar ao relatório".
2. A extensão registra uma **captura** desse estado no relatório em andamento. O usuário pode ter mais de um relatório em andamento e escolhe em qual a captura entra.
3. Num painel do relatório, ele vê as capturas em miniatura, reordena arrastando, dá título e observação a cada uma e apaga as que não quer.
4. "Gerar relatório" monta o PDF no servidor, como um trabalho em segundo plano (7.8). O arquivo vai para Arquivos, e o usuário recebe uma notificação quando fica pronto.

**O que cada captura guarda**

- **A imagem do mapa como estava,** em resolução de impressão, com legenda, escala, norte e atribuição. É capturada no navegador, porque é o que o usuário viu.
- **Os dados daquele momento:** as três partes do resultado, com valores e posições da hora da captura: os itens envolvidos (no trajeto, os pontos com horário), as formas e os resumos. Se um item for editado depois, o relatório continua mostrando o estado de então.
- **O contexto:** a operação e os filtros em linguagem legível, a janela de tempo, as camadas e o mapa de fundo, quem capturou, quando (hora do servidor, com fuso) e as versões do Directus e da extensão.
- **Só o que o usuário pode ver** (regra de ouro).
- **Os arquivos que a captura mostra, copiados com hash** (D-033). A extensão não sabe o que o item é, e o valor de um campo de arquivo é só o id, cujo conteúdo o Directus deixa trocar (V-52).
  - Entram só os campos de arquivo que a camada mostra, os mesmos da lista e da exportação. Sem campo de arquivo, nada muda.
  - A cópia é feita na hora da captura e vai para a pasta dos relatórios. A captura aponta para a cópia, e o SHA-256 de cada uma entra no hash da captura.
  - No PDF, as imagens aparecem em miniatura na tabela, e todo arquivo aparece com nome e hash. Os arquivos inteiros ficam na pasta, para baixar pelo relatório.
  - Há um máximo de arquivos e de tamanho por relatório, na configuração da instalação (por exemplo, 200 arquivos e 200 MB). Acima dele, os arquivos que sobram ficam só com o hash, e a captura avisa.

**O PDF**

- **Fuso do relatório:** vem do navegador do autor quando o relatório é criado; no relatório agendado por Flow, é uma opção da ação, com o fuso da instalação como padrão. A capa mostra o fuso ("horários em America/Sao_Paulo, UTC−03:00"), cada hora sai com o deslocamento, e o relatório gerado de novo usa o mesmo fuso (D-031).
- **Estrutura:** capa (título, autor, data, finalidade e fuso), índice e uma seção por captura, com o mapa, o contexto, as medições, a tabela dos itens e a observação.
- **Anexos:** os dados completos de cada captura vão dentro do PDF, em GeoJSON, para a evidência não ficar limitada ao que coube na tabela.
- **Montagem no servidor,** em Node, com uma biblioteca que gera PDF sem navegador (sem Chromium no servidor). O documento oficial sai dos dados guardados, e não do que o navegador enviou.

**Valor como evidência (cadeia de custódia)**

- **Dois hashes** (D-034):
  - **hash do conteúdo:** cada captura recebe um SHA-256 dos dados, da imagem e das cópias dos arquivos, calculado no servidor quando ela chega, e o relatório tem o hash do conjunto. O recorte é por subtração: entra tudo o que o documento afirma, menos o bloco de autenticidade, que carrega o próprio hash. Assim um bloco novo nunca fica de fora por esquecimento. O PDF lista esses hashes;
  - **hash do arquivo:** o SHA-256 dos bytes do PDF final, calculado depois de montado e, quando há assinatura, depois de assinado. Fica guardado no registro, e não no PDF, porque escrevê-lo no arquivo mudaria o arquivo.
- **Código do relatório:** um código legível e único, como `GEO-EVD-20260924-00017`, para ser citado num processo ou num ofício. É o maior do dia mais um, com nova tentativa quando dois relatórios colidem.
- **Travamento e ciclo de vida:** depois de gerado, o relatório não muda. O estado é **válido**, **revogado** (com quem, quando e por quê) , **substituído** (apontando para a versão nova) ou **removido**, quando o admin apaga o conteúdo e fica só o registro mínimo (7.10). Um ajuste gera uma nova versão, e a anterior passa a substituída. Revogar e substituir só partem de um relatório válido, a versão nova precisa estar válida, e a trilha nunca é sobrescrita, o que impede ciclos.
- **Prévia sem autenticidade:** antes de gerar, o usuário vê uma prévia com a marca "PRÉVIA" e sem código, token, hash ou QR. Não é uma marca d'água sobre um documento falso; é um documento que não tem o que falsificar.
- **Verificação em duas conferências:**
  1. **O estado, pelo QR.** O QR leva à página de verificação com um token aleatório, e não com o id, para que ninguém descubra relatórios tentando ids. A página mostra o código, a data de geração, o estado, se há assinatura e o hash do arquivo esperado.
  2. **O arquivo, pelo upload.** A pessoa envia o PDF (só PDF, com tamanho máximo), e o servidor compara o SHA-256 do que recebeu com o hash do arquivo. Se bater: "este arquivo é idêntico ao emitido". Se não: "este arquivo não é o original", com a explicação de que alterar o documento ou salvá-lo de novo, até por "imprimir como PDF", muda os bytes. Sem o QR, a página aceita só o upload e acha o relatório pelo hash do arquivo. Quem preferir pode conferir com `sha256sum`.
- **Assinatura digital opcional** (PAdES), com um certificado configurado pelo admin. No Brasil, uma assinatura ICP-Brasil dá presunção de autenticidade.
- **Histórico:** o histórico do Directus registra quem criou o relatório, adicionou capturas e gerou o PDF.

**Limites e armazenamento**

- Relatórios e capturas ficam em coleções da extensão, com dono e visibilidade, como as visões do módulo. Imagens e PDFs ficam em Arquivos.

**Quem vê o relatório** (D-032)

- **Relatório é documento.** Quem pode ler o relatório lê tudo o que está nele, como num arquivo exportado. Quem decide é a permissão do Directus na coleção de relatórios, pela regra de ouro. A extensão não refiltra o conteúdo para quem abre, porque isso mudaria a evidência e quebraria o hash.
- **Compartilhar pede confirmação.** A visibilidade começa em "só o dono". Ao abrir para o papel ou para todos, a confirmação avisa: "quem receber verá todos os dados das capturas, inclusive o que não pode ver no mapa". Um relatório da Maria, da zona sul, aberto para todos mostra a zona sul ao João, da zona norte.
- **PDF e imagens numa pasta própria.** A política pronta, criada por ação do admin, tira essa pasta do alcance dos papéis comuns. Os arquivos passam pelas mesmas permissões das coleções (V-58), e o download passa pelo endpoint da extensão, que confere se o usuário pode ler aquele relatório. O painel de saúde avisa quando algum papel consegue ler a pasta.
- **A verificação só confirma.** A página pública mostra o código, a data de geração, o estado, se há assinatura e o hash do arquivo, sem nenhum dado das capturas nem nome de pessoa. Token inexistente e erro interno recebem a mesma resposta, e a página lê só as poucas colunas de que precisa. O PDF enviado para conferência não fica guardado, e a página tem limite de pedidos por IP.
- Há um máximo de capturas por relatório e de linhas por tabela (por exemplo, 50 e 1.000). Os dados completos vão no anexo.

#### Modelos de relatório

Os modelos montam as seções sozinhos, a partir de parâmetros. **Os cinco fazem parte da extensão.** A implementação começa pelo da cerca virtual, e os outros quatro vêm depois, na ordem do plano de implementação.

1. **Cerca virtual (o primeiro a ser implementado):** o registro de entradas e saídas por área e por veículo, com o tempo de permanência. Sai da operação cerca virtual, calculada sobre o histórico de posições (D-028), e não depende dos alertas.
2. **Frota e trajeto:** para cada veículo e período, a distância percorrida, as paradas e o tempo parado (com as paradas prováveis à parte e, se houver campo de ignição, as ociosas), as velocidades média e máxima, as entradas e saídas de cercas, e o mapa do trajeto com as paradas.
3. **Por região e período:** a contagem por região comparada ao período anterior (variação em %), ranking, mapa colorido e gráfico de tendência.
4. **Focos:** focos do período classificados em novos, persistentes e extintos em relação ao período anterior.
5. **Cobertura:** a porcentagem de ocorrências a menos de X km de uma base ou de uma equipe, e quais ficaram de fora. É o entorno das bases encadeado com as ocorrências de dentro e de fora.

#### Como os relatórios se conectam ao resto

- **Flows:** a operação ganha a ação "Gerar relatório", que usa um modelo e aceita agendamento (7.8). O relatório gerado dispara um evento, e um Flow pode enviá-lo por e-mail.
- **API:** rotas `/geospatial/reports/...` para capturas, geração, download do PDF (com a permissão do relatório) e verificação (pública).
- **Permissões:** o relatório agendado usa a permissão escolhida na operação de Flow. A documentação alerta que, ao enviar um PDF, os dados saem do controle de permissões do Directus.

### 7.10 Dados pessoais

Placa, posição, trajeto e ocorrência são dado pessoal (LGPD, GDPR). Quem controla os dados é quem opera a instalação, e a extensão não decide base legal. O que ela faz é deixar à vista tudo o que guarda e tudo o que sai, e oferecer como apagar (D-038).

**O que a extensão guarda**

| O quê                                                                     | Onde                                          | Por quanto tempo                      |
| ------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| Consultas registradas, cache e estado dos alertas de cerca                | Memória ou Redis                              | Temporário: expira sozinho            |
| Visões e consultas salvas                                                 | Coleções da extensão                          | Até o dono apagar                     |
| Links compartilhados                                                      | Coleção da extensão                           | Sem vencimento, com a opção de vencer |
| Capturas que não entraram num relatório gerado, com as cópias de arquivos | Coleção da extensão e a pasta dos relatórios  | 90 dias, ajustável                    |
| Relatórios gerados, com as capturas, o PDF e as cópias de arquivos        | Coleções da extensão e a pasta dos relatórios | Até o admin remover                   |
| Trabalhos concluídos                                                      | Coleção da extensão                           | 30 dias, ajustável                    |

- A limpeza periódica é um trabalho do executor (7.8).
- Os logs não levam dado de item, geometria nem token.

**O que sai da instalação**

- **A busca de endereço** manda ao provedor o texto buscado, ou a coordenada, na busca reversa (7.3, grupo 3). Com um provedor próprio, nada sai.
- **O mapa de fundo** pede ao servidor de mapas os tiles da área vista, com o IP de quem olha (7.7). Com o PMTiles, nada sai.

**Remover um relatório**

- Só o admin remove um relatório gerado. As capturas, o PDF e as cópias de arquivos são apagados, e fica um registro mínimo, com o código, as datas, o hash e o motivo.
- O relatório passa ao estado "removido", e a página de verificação responde "relatório removido", em vez de "não existe". A cadeia de custódia continua explicável, sem guardar dado pessoal.

## 8. Guardado para depois

- **Busca semântica com pgvector:** 19 votos no roadmap e nenhuma extensão pronta encontrada; um mantenedor comentou numa discussão antiga que isso poderia ser feito como extensão. Reaproveita a mesma arquitetura (extensão do Postgres + endpoint que respeita permissões).
- **Validação entre campos:** 25 votos no roadmap; foi o plano B avaliado.
- **PR no core** com operadores geoespaciais nativos.
- **Métricas para ferramentas de monitoramento** (Prometheus, OpenTelemetry): os números do painel de saúde expostos fora do Studio.

## 9. Em aberto

Pontos levantados no questionamento da documentação que ainda precisam de uma análise própria.

- Nenhum no momento.
