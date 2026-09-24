# Verificações

> Fatos sobre ferramentas de terceiros, conferidos no código-fonte ou na documentação oficial. Cada um tem um número (V-xx) para ser citado nas decisões, na arquitetura e nas issues.
> Fato novo entra no fim da seção certa, com o próximo número livre. Um número nunca é reaproveitado; um fato que deixou de valer é riscado, com a data e o motivo.
> As pendências (P-xx) são confirmações a fazer antes ou durante a implementação. Confirmada, a pendência vira um V-xx e a linha dela aponta para ele.

## Fatos verificados

Conferidos em 23/09/2026 no código do Directus 12.4.1 (branch main) e na documentação oficial. Os caminhos se referem ao repositório `directus/directus`.

### Directus: Studio e extensões

- **V-01** **Mapa nativo** (`app/src/layouts/map/`):
  - usa MapLibre (MapLibre 6 e WebGL2 desde a 12.4);
  - busca pelo `/items`, 1000 itens por página, com tamanhos de até 100 mil;
  - junta ao filtro da página um `_intersects_bbox` com a área visível;
  - agrupa pontos no navegador.
- **V-02** Não há painel de mapa nativo nos dashboards (`app/src/panels/`).
- **V-03** **Layouts de extensão:**
  - o estado fica em `layout_options` e `layout_query` dos presets e bookmarks, e só o id do bookmark vai para a URL;
  - o layout é oferecido em toda coleção, sem filtro;
  - não consegue alterar o filtro nem a busca da página;
  - no v12, `smallHeader` não tem efeito, e `headerShadow` e `sidebarShadow` foram removidos.
- **V-04** **Componentes globais disponíveis para extensões:**
  - `drawer-item` (abre o item, mas não salva; quem salva é quem o usa);
  - `drawer-collection`;
  - o construtor de filtros (`interface-system-filter`).
- **V-05** **Módulos** começam desativados até o admin ativar e não recebem a busca, os filtros nem os bookmarks da página da coleção.
- **V-06** **Painéis** recebem os dados por GraphQL (`query`) e podem fazer as próprias buscas.
- **V-07** O MapLibre e o mapbox-gl-draw do Studio não são compartilhados com extensões.
- **V-08** **Carregamento das extensões:** o Studio carrega um arquivo único de extensões ao iniciar (`app/src/extensions.ts`). A API divide esse arquivo em pedaços servidos em `/extensions/sources/:chunk` (`api/src/extensions/manager.ts`). O build do SDK usa `inlineDynamicImports: true` (`packages/extensions-sdk/src/cli/commands/build.ts`).
- **V-09** **Cores nas opções dos campos:** as opções do `select-dropdown` e do display `labels` guardam cor.
- **V-10** O corpo de uma requisição tem limite padrão de 1 MB (`packages/env/src/constants/defaults.ts`).
- **V-11** O `/items` aceita o método `SEARCH`, com a consulta no corpo (`api/src/controllers/items.ts`).
- **V-12** O token pode ir no parâmetro `access_token` da URL (`api/src/middleware/extract-token.ts`).
- **V-13** O Directus usa campos com `$`, como o `$meta` do versionamento, para dados calculados por ele (`api/src/utils/versioning/handle-version.ts`).
- **V-14** A exportação para arquivo grava o resultado em Arquivos e manda uma notificação ao usuário quando termina ou falha (`api/src/services/export.ts`).
- **V-15** O drawer de edição em lote tem o modo `stageOnSave`, que devolve as mudanças sem salvar (`app/src/views/private/components/drawer-batch.vue`).
- **V-16** **WebSocket:**
  - vem desligado por padrão (`WEBSOCKETS_ENABLED: false`, em `packages/env/src/constants/defaults.ts`);
  - a cada evento, relê o item com a permissão de cada inscrito (`api/src/websocket/handlers/subscribe.ts`);
  - extensões podem escutar as mensagens recebidas (`websocket.message`).
- **V-17** Cada usuário tem uma aparência (automática, clara ou escura) e um tema para cada modo, com ajustes próprios (`packages/types/src/users.ts`).
- **V-18** O Studio junta traduções num sistema de idiomas global (`app/src/stores/translations.ts`), e as traduções da extensão entram nesse mesmo sistema.
- **V-19** O mapa nativo usa as variáveis de tema do Directus (`--theme--*`).
- **V-20** **Flows:** a operação nativa "Ler dados" tem a opção "Permissões" (do gatilho, o padrão; papel público; acesso total) (`app/src/operations/item-read/index.ts`). As operações de extensão recebem os serviços do Directus, os dados do Flow e a identidade de quem disparou (`packages/types/src/extensions/operations.ts`).
- **V-45** **Flows:** a saída de cada operação entra nos dados do Flow com a chave da operação e também em `$last`, ao lado de `$trigger`, `$accountability` e `$env` (`api/src/flows.ts`).
- **V-53** **Registro dos Flows:** o padrão é `all` (migração `20220429A-add-flows.ts`). Com `all`, cada execução grava uma revisão com os dados de todos os passos, e só alguns campos sensíveis são redigidos, como `authorization`, `cookie`, `password` e `token` (`api/src/flows.ts`).

### Directus: leitura de dados e permissões

- **V-21** **Cadeia de leitura do `ItemsService`:** hook `items.query` → `getAstFromQuery` → `processAst` (barra campos sem permissão e injeta as regras de cada política) → `runAst` → `getDBQuery`. O `getDBQuery` devolve um `Knex.QueryBuilder` sem executar (`api/src/services/items.ts`, `api/src/database/run-ast/`).
- **V-22** **Permissão por linha:** o filtro da página, E (OU das regras das políticas) (`join-filter-with-cases`).
- **V-23** O pacote `@directus/api` exporta os módulos internos (`"./*": "./dist/*.js"`).
- **V-24** Os apelidos das queries são determinísticos (`api/src/database/run-ast/utils/generate-alias.ts`).
- **V-44** **`aggregate` com `groupBy`:** o `/items` troca os itens por uma linha para cada combinação de valores do `groupBy`. O banco devolve apelidos como `count->id`, e o `PayloadService` os aninha por função, no formato `{ count: { id: 5 }, regiao: 'sul' }` (`api/src/database/run-ast/lib/apply-query/aggregate.ts`, `api/src/services/payload.ts`).
- **V-52** **Arquivos:** um `PATCH /files/:id` com upload troca o conteúdo do arquivo e mantém o mesmo id. Todo item que aponta para ele passa a mostrar o conteúdo novo (`api/src/controllers/files.ts`).
- **V-55** **`$NOW` nos filtros e nas permissões:** `$NOW` e `$NOW(-7 days)` viram o instante do relógio, com `new Date()`, toda vez que o Directus processa o filtro, e as permissões passam pelo mesmo `parseFilter`. Uma permissão com `$NOW` muda o SQL a cada pedido (`packages/utils/shared/parse-filter.ts`, `parse-now.ts`, `api/src/permissions/utils/process-permissions.ts`).
- **V-56** **Horários no MySQL:** ao ler e gravar um `timestamp`, o Directus ajusta o valor pelo fuso do processo Node (`getTimezoneOffset`) (`api/src/database/helpers/date/dialects/mysql.ts`).
- **V-57** **Campos especiais de data:** o `date-created` é preenchido pelo Directus quando o item é criado pela API, e o `date-updated`, só quando o item é atualizado por ele. Gravações feitas direto no banco não passam por aí (`api/src/services/payload.ts`).
- **V-58** **Permissões em Arquivos:** o `FilesService` estende o `ItemsService`, então os arquivos passam pelas mesmas permissões das coleções. A `directus_files` tem `folder` e `uploaded_by`, que uma política pode usar no filtro (`api/src/services/files.ts`, `packages/system-data/src/fields/files.yaml`).

### Directus: geometria e bancos

- **V-25** **Postgres** (`api/src/database/helpers/geometry/`, `api/src/database/helpers/schema/`):
  - a coluna é criada como `geometry(tipo, 4326)`;
  - o `_intersects_bbox` usa `&&`, e a entrada usa `st_geomfromtext(?, 4326)`;
  - não há tratamento de SRID nem `ST_Transform` em lugar nenhum;
  - a opção "Index" do campo cria um B-tree, e nenhum índice espacial é criado.
- **V-26** A leitura do esquema do Postgres só enxerga tabelas com `relkind = 'r'` (`packages/schema/src/dialects/postgres.ts`). A tabela-mãe particionada fica invisível, e cada partição aparece como tabela solta.
- **V-27** **Outros bancos:**
  - o CockroachDB usa o helper do Postgres;
  - MySQL e MariaDB usam o helper `mysql`, que grava sem SRID, e a coluna é criada sem o atributo SRID;
  - no SQL Server, a coluna é `geometry` com SRID 4326;
  - no Oracle, a coluna é `sdo_geometry` com SRID 4326, e o filtro usa `sdo_overlapbdyintersect`;
  - no SQLite, só há geometria com a SpatiaLite carregada, porque o Directus apenas verifica se ela existe.
- **V-49** **O filtro `_intersects`** é `st_intersects(coluna, geometria)` na classe base, usada por Postgres, MySQL e SQLite. O SQL Server usa `STIntersects`, e o Oracle, `sdo_overlapbdyintersect` (`api/src/database/helpers/geometry/types.ts` e `dialects/`).
- **V-54** **Tipos de data no Postgres:** `timestamp with time zone` vira o tipo `timestamp` do Directus, e `timestamp without time zone` vira `dateTime` (`api/src/utils/get-local-type.ts`).
- **V-28** Os testes do próprio Directus rodam com PostGIS 3.6 (Postgres 18), MySQL 9.7, MariaDB 12.3, SQL Server 2025, Oracle 23 Free e CockroachDB 25.4 (`docker-compose.yml`).
- **V-29** A documentação diz que o Directus suporta as versões LTS de PostgreSQL, MySQL, SQLite, SQL Server, MariaDB, CockroachDB e OracleDB.
- **V-30** A documentação diz que o Redis é obrigatório para escalar o Directus horizontalmente.

### Directus: mapas de fundo, rede e publicação

- **V-31** **Mapas de fundo** (`app/src/utils/geometry/basemap.ts`):
  - o padrão é o OpenStreetMap raster em `{a-c}.tile.openstreetmap.org`;
  - o Mapbox entra quando há chave;
  - os mapas cadastrados podem ser dos tipos `raster`, `tile` e `style`.

  Desde a 12.2, as políticas de acesso ao app podem ler os campos `basemaps` e `mapbox_key`.
- **V-32** O `/assets` aceita leitura por faixas (Range) (`api/src/controllers/assets.ts`).
- **V-33** **CSP padrão** (`api/src/app.ts`): `connect-src 'self' https://* wss://*` e `worker-src 'self' blob:`. O Directus não altera a política de Referer do Studio.
- **V-34** **Publicação:**
  - o `MARKETPLACE_TRUST` padrão é `sandbox`;
  - o sandbox não tem banco nem serviços e limita cada chamada a 1000 ms e 100 MB;
  - a imagem Docker do v12 não tem npm;
  - no Directus Cloud, extensões customizadas só existem no plano Enterprise;
  - com `MARKETPLACE_TRUST=sandbox`, o Studio pede ao registro só as extensões em sandbox, na lista e no download; com `all`, não há esse filtro (`api/src/controllers/extensions.ts`, `api/src/extensions/lib/installation/manager.ts`);
  - o registro do Marketplace espelha o npm e oferece só a última versão de cada extensão (documentação de publicação).
- **V-35** **Versões mais recentes em 23/09/2026:** 11.17.4 (último v11) e 12.4.1 (tags do repositório).
- **V-59** **Ferramentas do repositório do Directus** (`main`, conferido em 24/09/2026 no `package.json` e no `pnpm-workspace.yaml` da raiz): Node 22 e pnpm 10 (`packageManager` 10.27.0), com catálogos em modo estrito e a lista `onlyBuiltDependencies`; ESLint 10, com `typescript-eslint`, `eslint-plugin-vue`, `eslint-plugin-import-x` e `eslint-config-prettier`; Prettier 3; Stylelint; TypeScript 5.9; Vitest 4.1; Vite 8; `vue-tsc` 3; tsdown; e Changesets para as versões. O SDK de extensões exporta os composables `useApi`, `useSdk` e `useStores`, entre outros, e o `@directus/errors` exporta o `createError`.
- **V-60** **Licenças do Directus** (`main`, conferido em 24/09/2026): o núcleo, inclusive o `@directus/api`, está sob a Monospace Sustainable Core License 1.0 (MSCL-1.0-GPL). Ela permite usar, modificar e redistribuir para qualquer finalidade que não seja concorrer com a oferta comercial do próprio Directus, exige a licença junto de cópias e derivados, e vira GPL-3.0 quatro anos depois de cada versão. Os pacotes de apoio que a extensão usa são MIT: `@directus/sdk`, `@directus/extensions-sdk`, `@directus/extensions`, `@directus/composables`, `@directus/errors`, `@directus/types` e `@directus/utils`.
- **V-61** **Licença do Directus 11** (tag `v11.17.4`, conferida em 24/09/2026): Business Source License 1.1. O uso em produção é livre enquanto o faturamento, o orçamento ou a captação anual não passar de US$ 5 milhões, e cada versão vira GPL-3.0 três anos depois de lançada. A MSCL-1.0-GPL (V-60) vale desde o `v12.0.0`: sem teto de faturamento, mas com funcionalidades protegidas por chave de licença.

### Outras ferramentas

- **V-36** **MySQL:** "o otimizador ignora índices espaciais em colunas sem atributo SRID"; o índice espacial exige `NOT NULL`.
- **V-37** **MariaDB:** as colunas de índice espacial precisam ser `NOT NULL`.
- **V-38** **Política de tiles do OpenStreetMap:** o acesso pode ser bloqueado sem aviso se o uso degradar o serviço. Pede atribuição, identificação e cache, e indica outro serviço baseado no OSM a quem não cumprir. Outros endereços e subdomínios podem ficar lentos ou ser desativados sem aviso.
- **V-39** **OpenFreeMap:** gratuito, sem limites, sem cadastro e sem chave, com uso comercial permitido e mantido por doações. Estilos Positron, Bright, Liberty, Dark e Fiord3D.
- **V-40** **Protomaps:** estilos light, dark, white, black e grayscale; no MapLibre, usa o protocolo `pmtiles://`.
- **V-41** **Terra Draw:** licença MIT, com adaptadores para MapLibre GL JS (o README cita v4/5), Leaflet, OpenLayers, Google Maps, Mapbox e ArcGIS.
  - Modos: círculo (em web mercator ou geodésico), desenho livre, linha livre, linha, ponto, polígono, retângulo, retângulo inclinado, setor, sensor, polilinha e marcador.
  - Linha e polígono têm encaixe, inclusive com regra própria.
  - O modo de seleção move vértices, arrasta, redimensiona e cria ou apaga vértices.
  - O desenho livre não funciona em telas de toque.
  - Há validação de área mínima e máxima em m².
- **V-42** **PostGIS:** para `geography`, o `ST_Distance` calcula sobre o elipsoide com a GeographicLib desde a 2.2 (com PROJ 4.9 ou mais novo).
- **V-46** **PostGIS, `ST_Buffer` em `geography`:** é um invólucro da versão plana. Escolhe o sistema plano que melhor cobre a caixa da geometria (UTM, Lambert azimutal polar ou Mercator), calcula nele e volta para o WGS84. Cada quarto de círculo tem 8 segmentos por padrão (`quad_segs`) ([documentação](https://postgis.net/docs/ST_Buffer.html)).
- **V-47** **PostGIS, `ST_Centroid`:** aceita `geography` desde a 2.4.0, com `use_spheroid` ligado por padrão. Num polígono, o centro pode cair fora dele; para um ponto garantidamente dentro, a documentação indica o `ST_PointOnSurface` ([documentação](https://postgis.net/docs/ST_Centroid.html)).
- **V-48** **PostGIS, `ST_SimplifyPreserveTopology`:** o resultado é válido e simples se a entrada for, e a tolerância está na unidade do SRID da entrada. A documentação só cita `geometry` ([documentação](https://postgis.net/docs/ST_SimplifyPreserveTopology.html)).
- **V-50** **PostGIS, `ST_CoveredBy`:** verdadeiro quando todo ponto de A está no interior ou na borda de B, e aceita `geography`. A documentação o recomenda no lugar do `ST_Within`, que tem a peculiaridade de a borda não estar "dentro" da própria geometria ([documentação](https://postgis.net/docs/ST_CoveredBy.html)).
- **V-51** **PostGIS, `ST_DFullyWithin`:** testa se uma geometria está inteira a até uma distância de outra e usa o índice, mas só aceita `geometry` ([documentação](https://postgis.net/docs/ST_DFullyWithin.html)).
- **V-43** **Política do Nominatim público:**
  - no máximo 1 pedido por segundo;
  - busca enquanto se digita proibida no cliente;
  - identificação da aplicação (Referer ou User-Agent);
  - cache obrigatório e atribuição.

  Para uso maior, a política indica provedores comerciais ou uma instância própria.

## Pendências

Confirmações rápidas antes da implementação:
- **P-01** O build próprio carrega MapLibre e deck.gl sob demanda, usando os pedaços servidos pela API.
- **P-02** O PMTiles funciona lido pelo `/assets` de ponta a ponta.
- **P-03** Os workers do loaders.gl (usados pelo deck.gl) carregam localmente, e não de CDN, o que a CSP bloquearia.
- **P-04** No MySQL, a coluna `NOT NULL SRID 0` com índice espacial não quebra a gravação do Directus.
- **P-05** No Oracle, o filtro nativo do Directus falha ou não sem índice espacial.
- **P-06** As lacunas do CockroachDB para o catálogo.
- **P-07** Se o `ST_Distance_Sphere` do MariaDB vale só para pontos.
- **P-08** O SQL montado pelo Directus é o mesmo para o mesmo pedido (base do cache).
- **P-09** O adaptador do Terra Draw funciona com a versão do MapLibre que escolhermos. O README cita v4/5, e o Studio já usa a v6.
- **P-12** No Oracle, o `_intersects` do Directus usa `sdo_overlapbdyintersect` (V-49). Pela máscara, ele pode não devolver um ponto que está dentro de um polígono. Confirmar no container; se confirmar, a paridade no Oracle compara com o resultado calculado, e não com o filtro nativo.
- **P-13** Como os horários `timestamp` e `dateTime` chegam ao SQL da extensão em cada banco. No MySQL, o Directus ajusta pelo fuso do processo Node (V-56), e no SQL Server a conexão usa `useUTC: false`. Os testes de contrato precisam cobrir o fuso em cada banco.
- **P-15** A coleção de trabalhos fica sem registro de atividade e de revisões pela opção da própria coleção, com as gravações de progresso passando pelo `ItemsService` (D-036).
- **P-16** O filtro de arquivados da página chega ao layout de extensão, para item arquivado não aparecer no mapa (V-03).
- **P-17** O cancelamento de uma consulta em andamento no SQLite, pelo driver que o Directus usa.
- **P-18** A imagem oficial do Directus traz a SpatiaLite. Se não trouxer, os testes com SQLite usam uma imagem própria (V-27).
- **P-19** A versão do Node que o Directus 11.17 exige; no `main`, é a 22 (V-59).

Benchmarks:
- **P-10** Tabela principal com GiST + BRIN contra tabela auxiliar particionada, num dataset de rastreamento com cerca de 100 milhões de pontos.
- **P-11** Tempos de criação dos índices no dataset de demonstração.
- **P-14** Ganho do `ST_Subdivide` na operação por área e na contagem por região com polígonos pesados, usando os limites de municípios do IBGE, e o número de vértices a partir do qual vale subdividir.
