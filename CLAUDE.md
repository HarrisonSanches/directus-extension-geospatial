# directus-extension-geospatial

Extensão para o Directus que transforma o Studio num painel geoespacial operacional: operações espaciais no banco (PostGIS como referência), expostas no Studio (layout, módulo e painel), na API, no SDK e nos Flows, e relatórios de evidências em PDF. O desenho está em [docs/arquitetura.md](docs/arquitetura.md).

## Estado

- Planejamento concluído em 23/09/2026.
- Questionamento da documentação (skill `grill-with-docs`) concluído em 24/09/2026: decisões D-022 a D-034, fatos V-44 a V-58 e pendências P-12 a P-14.
- Plano de implementação criado em 24/09/2026, com 18 fases (F00 a F17).
- Padrões de desenvolvimento criados em 24/09/2026, em [docs/padroes/](docs/padroes/README.md).
- Revisão geral em 24/09/2026: decisões D-035 a D-039 (a D-037 substitui a D-018) e fatos V-59 a V-61.
- Ferramentas de qualidade e segurança escolhidas em 25/09/2026: decisão D-040 (o repositório abre no fim da F00), achado A-001 e fatos V-66 a V-77.
- Plano de implementação movido em 25/09/2026 para o repositório privado `directus-extension-geospatial-plan`.
- F00 quebrada em 13 issues em 25/09/2026, no repositório do plano, com o Node 24 nas ferramentas e o pnpm mantido (V-79 a V-82).
- Fluxo de ramos com o `develop` em 25/09/2026 (D-041), e coautoria do agente nos commits do produto.
- F00-01 feita em 25/09/2026: o pnpm passou para o 12, sem o Corepack, o TypeScript 7 entrou na raiz, e as P-20,
  P-21 e P-24 viraram fato (V-84 a V-93, P-25). O lockfile ficou num documento só, e o GitHub lê as dependências.
- F00-02 feita em 25/09/2026: o `pnpm check` confere formatação, lint, tipos, Knip e testes. O lint é o ESLint, com
  a API do TypeScript 6 lado a lado até a P-25, no nível estrito, e nenhum comentário desliga regra (V-94 a V-102).
- F00-03 feita em 25/09/2026: o bundle responde em `/geospatial/capabilities`. Os pacotes `extension` e `contract`
  nasceram, com o contrato primeiro, e o `sdk` fica para a F02. Só quem tem sessão lê a rota, e só o admin vê o
  banco (D-042). As imagens oficiais do Directus não trazem a SpatiaLite (V-104, V-103 a V-108).
- F00-04 feita em 25/09/2026: o `pnpm dev` sobe o Directus 12, o PostGIS e o Redis de `dev/`, só em `127.0.0.1`, com a
  extensão em modo watch e recarregando sem reiniciar o container. O `dev/.env.example` deixa os segredos vazios, e o
  `pnpm dev` os gera. O `/server/health` do Directus 12 pede sessão, e o ambiente espera pelo ping (V-109 a V-112).
- F00-05 feita em 26/09/2026: o `pnpm test:integration` sobe o PostGIS 3.2 e o Directus 11.17.4 em containers e
  prova a Maria e a união das políticas, com a cobertura de dentro do Directus somada à dos unitários. O Directus 12
  sem chave não aceita regra por linha, e a chave do Open Innovation Grant entra na F00-06 (D-043, V-113 a V-118).
- F00-06 feita em 26/09/2026: a suíte roda também no Directus 12.4.1 licenciado, em paralelo com o 11.17, e a
  variável `INTEGRATION` escolhe a combinação. A ativação dos testes se prende a um `project_id` que o servidor de
  licenças escolheu, sem banco base, e o `pnpm dev` recebe a chave pelo Studio. Sem a chave, o 12 roda no Core
  (D-044, V-119, V-120).
- F00-07 feita em 26/09/2026: o SQLite com a SpatiaLite entra nas duas versões do Directus e fecha as quatro
  combinações da suíte. O Directus nunca carrega a SpatiaLite, e a imagem de teste a carrega em cada conexão, por uma
  pré-carga do Node. O 12 com SQLite roda no Core, e os filtros espaciais do Directus não valem num campo
  `geometry.Point` (V-121 a V-123).
- F00-08 feita em 26/09/2026: com o banco fora, o `capabilities` falha fechado, com o `GEOSPATIAL_DATABASE_UNAVAILABLE`
  e a causa só no log, e volta quando o banco volta. Os códigos da extensão levam o prefixo `GEOSPATIAL_` (D-045). O
  Directus mostra ao admin a mensagem de um erro que não é dele e carrega uma extensão fora do `host` sem aviso
  (V-124, V-125).
- F00-09 feita em 26/09/2026: o GitHub Actions confere cada push e pull request do `develop` e do `main`, com a
  integração num job por combinação, o gitleaks, o `pnpm audit`, o OSV-Scanner e o zizmor, e o título do pull
  request pelo commitlint. A noite acrescenta o PostGIS mais novo e roda pela primeira vez depois do merge, porque o
  GitHub só agenda o que está no ramo padrão. A chave do 12 ativa no runner, e o gitleaks passava sem varrer nada
  (V-126 a V-130).
- F00-12 feita em 27/09/2026: o repositório passou pelo portão de abertura, com o `SECURITY.md`, o `CONTRIBUTING.md`,
  o código de conduta (Contributor Covenant 3.0) e os modelos de issue, e o README diz que a extensão está em
  desenvolvimento. As denúncias de conduta vão pelo relato privado do GitHub até existir o e-mail do projeto, antes
  da F16. A abertura passou para antes da cobertura e das dependências (D-040), e o relato privado de
  vulnerabilidade do GitHub só existe no repositório público (V-131 a V-133).
- F00-13 feita em 27/09/2026: o repositório está público. O `develop` e o `main` têm rulesets, versionados em
  `.github/rulesets/`: sem push direto nem forçado, com os jobs da CI e o título obrigatórios, só squash no `develop`
  e só merge commit no `main`, e ninguém na exceção, então toda mudança, também a só de docs, entra por pull request.
  O CodeQL, o secret scanning com a proteção de push e o relato privado estão ligados, e o Scorecard publica a nota
  no README, ao lado do badge de CI (V-134 a V-136).
- F00-10 feita em 27/09/2026: a cobertura decide o merge. Um job da CI soma a dos unitários e a de cada combinação e
  a confere contra a catraca de `test/coverage-thresholds.json`, que o `pnpm check` sobe na máquina, e não contra o
  Vitest (A-020). O Codecov recebe um envio por push, por OIDC, e exige 90% do patch; o SonarQube Cloud, no plano
  Free, analisa os pull requests para o `develop`, com o quality gate. Os dois status são obrigatórios no `develop`,
  e o pull request de fork vem para um ramo do repositório (V-137, V-138).
- F00-11 feita em 27/09/2026: o Renovate abre os pull requests das dependências contra o `develop`, com os 3 dias do
  pnpm, os minor e patch numa rodada por semana e as imagens do Directus a qualquer hora, com o patch separado da
  minor nova, que entra na matriz ao lado do piso. A CI valida a configuração, e a correção de um alerta do
  Dependabot chega na hora. O Renovate não lê a idade mínima do pnpm, e sem a data da versão a espera seria eterna
  (D-046, V-139, V-140).
- F00 concluída em 27/09/2026: o critério de saída foi conferido de novo, com o `pnpm check` num clone limpo, sem a
  chave, em 186 s, e o `pnpm dev` só em `127.0.0.1`. A CI leva uns 3 min por push, e o Scorecard está em 6,2. Os passos
  da F02 esperam o resultado das provas da F01, e o Scorecard fica como está até a F16 (A-019, A-022, no plano).
- O `develop` foi para o `main` em 27/09/2026, no pull request #20, com a tag `f00-done`.
- F01 quebrada em 16 issues em 27/09/2026, no repositório do plano. As provas ficam em `spikes/`, fora do pacote da
  extensão, e rodam sob demanda pelo `pnpm spike`, fora da CI; a pasta sai no fechamento da fase.
- F01-01 feita em 27/09/2026: a extensão de prova importa do `@directus/api` o Directus em execução, e não uma cópia.
  O `ItemsService`, a conexão e o `getSchema` que ela importa são os do `context`, nas quatro combinações. O pacote
  vem de `/directus/node_modules`, fica fora do bundle e se declara num `.d.ts` próprio, sem instalar (V-141).
- F01-02 feita em 27/09/2026: a extensão de prova monta a query permitida da Maria pela cadeia do `ItemsService`, sem
  executar, e a envolve num `ST_DWithin`, num SQL só, com os ids da GeographicLib no 11.17 e no 12. A cadeia é a
  mesma nas duas versões, e montar a query custa uns 10 ms. A geometria sai como texto, dentro de um `CASE WHEN`, e
  o envelope a lê assim, sem o índice (V-142, A-023, no plano). O builder do Knex roda se sair de uma função `async`.
- F01-03 feita em 27/09/2026: o raio lê o `req.sanitizedQuery`, a mesma query do `/items`, e bate com ele no filtro e na
  busca da página, no papel com duas políticas e no admin, e dá os mesmos erros ao público e ao campo sem permissão.
  A geometria vai pelo nome, e o item que uma política deixa ver sem ela fica fora do raio: lendo a coluna, seis itens
  do norte vazariam (V-143).
- F01-04 feita em 27/09/2026: o raio emite o `items.query` como o `ItemsService`, sobre a query da página e antes da
  cadeia, e o hook de outra extensão recebe dele o mesmo que recebe do `/items`. O `emitter` do `context` só leva
  eventos entre extensões, e o emissor dos hooks vem do `@directus/api` (V-144).
- F01-05 feita em 27/09/2026: o mesmo pedido da Maria gera o mesmo SQL e os mesmos valores em chamadas seguidas,
  depois de reiniciar o Directus e em duas instâncias, no 11.17 e no 12. A regra vai nos valores, e o `$NOW` muda os
  valores a cada pedido, o que a chave do cache reconhece pelas regras cruas das políticas (V-145, resolve a P-08).
- F01-06 feita em 27/09/2026: a cadeia da prova fica num adaptador por versão, que importa os internos na hora e é
  conferido antes de montar a query, pelo que existe e não pela versão. O do 11.17 no 12 e o contrário são recusados
  com o `GEOSPATIAL_INTERNALS_UNSUPPORTED`, sem query no banco. A checagem vê o módulo, a função, a aridade e a forma
  do retorno, e não vê os campos das opções nem o comportamento (V-146).
- F01-07 feita em 28/09/2026: o raio no SQLite envolve a query permitida com o `PtDistWithin` da SpatiaLite, sobre o
  elipsoide, num SQL só, e bate com a GeographicLib na Maria do 11.17 e no admin e no público do 12, no Core. O Directus
  não cria os metadados espaciais, então não há índice nem `ST_Distance` em metros, e o `st_astext` da query permitida
  tem 6 casas, o que limita o raio a uns 7,5 cm (V-147, A-026, no plano).
- F01-08 feita em 28/09/2026: o `pnpm spike:dialects` sobe o Directus 11.17 sobre um banco de fora da suíte e derruba
  tudo sozinho. No CockroachDB 25.4, o envelope do PostGIS serve sem mudança: a contagem e os ids da Maria batem com o
  gabarito, também com o `LIMIT` da página dentro da subconsulta. Faltam o `ST_AsMVT` e os mais próximos sem um raio.
  Os testes de ponta a ponta do Directus usam o 25.3, que parou em janeiro, e a V-28 foi corrigida (V-148, P-06 em parte).
- F01-09 feita em 28/09/2026: no MySQL 9.7, o envelope do CockroachDB serve no plano, com o polígono também sem SRID,
  porque o Directus grava a geometria com SRID 0 e um predicado entre SRIDs falha. No SRID 4326, o MySQL lê a latitude
  primeiro. Com a coluna `NOT NULL SRID 0`, o índice espacial passa a valer e o Directus segue gravando, mas recusa o
  item sem geometria (V-151, resolve a P-04).
- F01-10 feita em 28/09/2026: no MariaDB 12.3, o envelope do MySQL serve sem mudança. O Directus o trata como MySQL,
  pelo mesmo cliente, e a extensão vai reconhecê-lo pelo `version()`. Ele ignora o SRID e não troca os eixos, o índice
  espacial vale só com o `NOT NULL`, e o `ST_Distance_Sphere` só mede entre pontos, na esfera (V-152, resolve a P-07).
- F01-11 feita em 28/09/2026: no SQL Server 2025, o envelope serve com o `STIntersects`, no plano. O SQL Server recusa o
  `ORDER BY` numa subconsulta sem `TOP`, e o Directus dá um a toda query, menos à de fora que monta num filtro por uma
  relação a vários: dela o envelope tira a ordem, que não muda as linhas, como o EF Core faz. O `geography` mede no
  elipsoide, como a GeographicLib, e o Directus não cria um campo `geometry.Point` sem `meta` no SQL Server (V-153).
- F01-12 feita em 28/09/2026: no Oracle 23.26, o envelope compara no plano, com o `sdo_geom.relate` e o texto sem
  SRID, porque o Oracle trata o SRID 4326 como geodésico, com as arestas pelas geodésicas. O `_intersects` do Directus
  é o `sdo_overlapbdyintersect`, que responde sem índice (P-05) e deixa de fora o ponto dentro do polígono (P-12), então
  a paridade no Oracle compara com o resultado calculado. As imagens slim dos testes do Directus não têm o Oracle
  Spatial, e a prova roda na regular (V-154).
- F01-13 feita em 28/09/2026: o tile da Maria sai de um `ST_AsMVT` só em volta da query permitida, com o agrupamento
  por células de uma grade do mundo inteiro. O MapLibre desenha todo tile vetorial em 512 px, e a célula de 60 px vira
  9 de 56,9 px, então nenhuma célula atravessa a borda, e nenhum grupo se repete no tile vizinho. O tile decodificado é
  o mesmo no 11.17 e no 12, com o PostGIS 3.2 e o 3.6. Um ponto a menos de meia unidade da borda sul ou leste fica na
  borda, onde o MapLibre não põe o rótulo (V-155).
- F01-14 feita em 28/09/2026: um build que mantém os imports dinâmicos faz a API servir o MapLibre e o deck.gl em
  pedaços próprios, baixados só quando o layout abre e quando a camada liga, e o arquivo inicial de extensões cai de
  2.169,6 KB para 1,5 KB. O worker do MapLibre 6 vem de uma rota da extensão, e o do loaders.gl de um `blob:`, dentro
  da CSP padrão. O navegador dos testes roda na imagem do Playwright (D-047), e o deck.gl 9.4 ainda não desenha
  intercalado no MapLibre 6 (V-156 a V-159, resolve a P-01 e a P-03).
- F01-15 feita em 28/09/2026: o MapLibre fica no 6.11.2, escolha do mantenedor. O Terra Draw desenha nele pelo
  adaptador, só com a API pública, e o deck.gl entra pelo `MapLibreOverlay` do `@deck.gl/maplibre`, intercalado no
  mesmo canvas, abaixo dos nomes de ruas do OpenFreeMap. O círculo do Terra Draw fica numa esfera, 0,56% aquém do
  raio no elipsoide em São Paulo, e o polígono volta no anti-horário. A prova fecha os diálogos da licença pelo cookie
  que o botão de lembrar depois grava, sem pedido ao servidor (V-160 a V-162, resolve a P-09).
- F01-16 feita em 29/09/2026: com 1 milhão de pontos, o tile da Maria sai em 74 a 81 ms no p95 no z12 e em 17 a
  18 ms no z16, com o pré-filtro pela caixa do tile e o índice GiST, e em 3 a 7 s no z4 e no z8, com ou sem ele, pela
  query permitida inteira, o texto da geometria, a ordenação em disco e o JIT. Montar a query custa 5,5 ms. O Studio
  baixa 1,3 KB de extensões ao iniciar, com gzip, que o Directus não faz. As metas, escolhidas pelo mantenedor, estão
  na F03 e na F04: o tile em até 100 ms do z12 para cima e em até 1 s do z8 para baixo, o primeiro tile em até 0,5 s
  depois de o layout montar, ou 3 s no perfil desktop, e o arquivo inicial em até 5 KB com gzip (V-163 a V-166).
- F01 concluída em 30/09/2026: o critério de saída foi conferido de novo, com o `pnpm check`, o `pnpm spike` nas
  quatro combinações e o `pnpm spike:dialects` nos cinco bancos. Nenhuma premissa das portas de mão única caiu. A
  pasta `spikes/` sai do `develop` depois da tag `f01-done`, que a guarda para a F02 consultar, e os passos da F02
  foram escritos com o resultado das provas (A-022, no plano).
- F02 quebrada em 21 issues em 30/09/2026, no repositório do plano, com a A-015 resolvida: a paridade compara com a
  resposta calculada em todo banco.
- F02-01 feita em 30/09/2026: o lint garante a direção das camadas do motor, rotas → operações → adaptadores →
  internos, também nos testes, e nada fora de `internals/` importa o `@directus/api`. O `no-restricted-imports` não vê
  o `import()`, e o `no-restricted-paths` pula o que não resolve e parte do `process.cwd()`, então o `import()` e o
  `typeof import()` vão pelo `no-restricted-syntax`, e as zonas pela raiz do repositório (V-167).
- F02-02 feita em 30/09/2026: o documento do contrato é servido em `GET /geospatial/openapi.json`, cru, como o Directus
  serve o dele, a quem tem sessão, do JSON que o `generate` escreve a partir do YAML e o build embute. O Redocly CLI,
  no `recommended-strict` e sem a telemetria dele, passa no `pnpm lint` e na CI, e a suíte confere cada resposta da
  extensão contra o documento, pelo Ajv: a rota, o status, o tipo e o schema (V-168, V-169).
- F02-03 feita em 30/09/2026: a pasta `internals/` é a única que importa o `@directus/api`, declarado num `.d.ts` e
  importado na hora, módulo a módulo, e um adaptador para o 11.17 e outro para o 12 montam a cadeia até o `getDBQuery`.
  Ao subir, a checagem confere o módulo, a função, a aridade e a forma de cada passo, sobre a `directus_collections`, e
  o resultado sai no log e no `capabilities` do admin. O próprio Directus importa cada módulo da cadeia, então o ensaio
  move um deles para outro arquivo, em vez de apagá-lo, e a suíte confere pelo mapa do código que nenhum arquivo do
  `@directus/api` entrou no bundle (V-170, A-039, no plano).
- F02-04 feita em 01/10/2026: `GET /geospatial/items/:coleção` devolve o raio no formato do `/items`, sobre a query
  permitida do `req.sanitizedQuery`, num SQL só, com o `ST_DWithin` em `geography` sobre o texto da geometria, e a
  geometria em GeoJSON, igual à do `/items`. O `geo` vai em JSON, com a `operation`, como o SDK do Directus manda um
  parâmetro que não conhece (D-048, V-171). A matriz declara o raio e o envelope de cada banco num lugar
  só: no PostGIS, sem índice; nos outros, indisponível, com o `GEOSPATIAL_OPERATION_UNAVAILABLE`. A suíte conta as
  queries pelo `pg_stat_statements` (V-172).
- F02-05 feita em 01/10/2026: o raio passa pela paridade inteira da F01-03. O papel com duas políticas e o filtro, a
  busca e os campos da Maria batem com o gabarito sobre o `/items` de cada um, e o público, o campo sem permissão pedido
  pelo nome e a geometria sem permissão recebem o erro do `/items`, inteiro. O seed ganhou três papéis com campos sem
  permissão. O item que uma política deixa ver sem a geometria fica fora do raio, e um envelope sobre a coluna crua
  devolveu seis itens do norte, e o teste reprovou. O `/items` recusa as coleções do sistema e as inativas e processa
  os valores lidos, e o raio ainda não (V-173, A-041, no plano).
- F02-22 feita em 01/10/2026: o raio responde como o `/items` também fora das permissões. A coleção do sistema, pelo
  prefixo `directus_`, volta com o `FORBIDDEN`, também ao admin, e as linhas passam pelo `PayloadService` do Directus,
  que esconde o `conceal`, converte as datas, o CSV e o resto e faz o GeoJSON do texto da query permitida, então o
  `ST_AsGeoJSON` saiu do envelope. A coleção inativa do 12 a própria cadeia já recusava, pelo `processAst` (V-173,
  A-042, no plano).
- F02-06 feita em 01/10/2026: o raio emite o `items.query` como o `readByQuery`, pelo emissor dos eventos do núcleo,
  depois do que a versão faz antes dos hooks e antes da cadeia, e lê a página que os hooks devolveram. O `emitFilter` é
  um método da instância que o módulo exporta, e a checagem o confere pela aridade, 3, sem emitir na partida. A suíte
  carrega em toda rodada uma segunda extensão, a de `test/hook/`, cujos hooks mudam uma coleção própria, e a cobertura
  continua somada pela catraca (V-174).
- F02-07 feita em 02/10/2026: o `pnpm measure` mede sob demanda, fora da CI, pelo método da F01-16. Ele sobe o 11.17
  com o PostGIS 3.2 e o 3.6 e o 12, carrega o volume por SQL, mede e derruba tudo em uns 8 min, e o `MEASURE_QUICK=1`
  confere em 1 min que ele funciona. A extensão de `test/measure/observer/`, que só a medição carrega, mede dentro do
  Directus a montagem da query permitida e o banco, sem mudar o produto. A query permitida custa de 3 a 4 ms, e o raio
  da Maria com 1 milhão, de 1,8 a 2,0 s, com ou sem o GiST, porque o envelope lê o texto da geometria, e o JIT leva
  0,7 s disso. A medição rodou fora da máquina de referência, e o raio sem `limit` devolve o círculo inteiro, onde o
  `/items` devolve 100 (V-175, V-176, A-043, A-044, no plano).
- F02-08 feita em 02/10/2026: o raio usa o índice. A caixa e o `ST_DWithin` leem a coluna e entram como mais condições
  da query permitida, porque o Directus a ordena e o Postgres não achata uma subconsulta ordenada, e a guarda do nulo,
  em volta, deixa fora o que uma política esconde (D-049, a opção da A-026, escolha do mantenedor). Com 1 milhão de
  pontos e o GiST, o pedido da Maria caiu de 0,9 s para 50 a 64 ms na primeira página, na máquina de referência. Um
  teste lê o `EXPLAIN` do SQL que chegou ao banco, que o observador da medição, agora também na suíte, entrega (V-177).
- F02-09 feita em 02/10/2026: o raio mede em metros numa coluna em qualquer SRID e numa `geography`, e a geometria sai
  em 4326. O esquema do Directus lê as duas como `geometry.Point` e não guarda o SRID, então o motor os lê do catálogo,
  a cada pedido. A caixa vai para o SRID da coluna com a borda cortada em trechos curtos, e só onde o PROJ a traz de
  volta ao mesmo lugar, e na `geography` o próprio `ST_DWithin` usa o índice. Com o SRID sem tipo, o `ST_Transform`
  lia o número como um texto do PROJ, e a caixa ficava de fora com o resultado certo: só o `EXPLAIN` reprovou (D-050,
  V-178).
- F02-10 feita em 02/10/2026: cada item do raio traz no `$geo` a distância até o centro, em metros, do texto que a
  query permitida expõe, e a lista vem pela distância, com o empate pela chave. Com o `sort`, vem a ordem da página,
  pelo valor exposto, e não pela coluna crua, como o `/items` faz, então o item cujo campo de ordem uma política esconde
  não revela o valor pela posição. O `limit` vai de 1 a 1.000, o `-1` volta com erro, e sem o `limit` vale a página
  padrão do Directus, e não o círculo inteiro. A ordem custa uns 20 ms na primeira página da Maria com 1 milhão de
  pontos (D-051, V-179, resolve a A-044).
- Próximo passo: `/implement-issue F02-11`, o raio no SQLite, que é HITL.

## Documentação

| Arquivo                                      | Papel                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [CONTEXT.md](CONTEXT.md)                     | Glossário do domínio, com o termo em português e o canônico em inglês                               |
| [docs/arquitetura.md](docs/arquitetura.md)   | O desenho: o que a extensão faz e como                                                              |
| [docs/decisoes.md](docs/decisoes.md)         | As decisões D-0xx; as portas de mão única ficam no topo. Não existe `docs/adr/`                     |
| [docs/verificacoes.md](docs/verificacoes.md) | Fatos verificados em ferramentas de terceiros (V-xx) e pendências (P-xx)                            |
| `../directus-extension-geospatial-plan/`     | Plano por fases, issues, especificações, achados e histórico, num repositório privado do mantenedor |
| [docs/padroes/](docs/padroes/README.md)      | Padrões de código e de testes, e o que "Pronto quer dizer"                                          |

## Idioma

- Conversa, documentação interna (`docs/`, `CONTEXT.md`) e skills: português do Brasil.
- Código, identificadores, mensagens de commit e documentação pública (README, site): inglês.

## Como trabalhar neste projeto

- **O mantenedor** é quem conduz o trabalho com o agente: aprova, decide, revisa os pull requests e faz o merge. É o nome usado nas skills e nos docs.
- Preferências pessoais de quem trabalha no projeto ficam no `CLAUDE.local.md`, que não vai para o Git.
- **O plano** mora num repositório privado, clonado ao lado deste, na mesma pasta. O Claude Code chega nele pelo `permissions.additionalDirectories` do `.claude/settings.local.json`, e as mudanças no plano viram commits lá, separados dos do produto.
- Um passo de cada vez, uma decisão por vez, sempre com uma recomendação.
- Explicações didáticas e passo a passo na conversa, ao entregar algo novo ou quando o mantenedor pedir. Não existe guia didático em arquivo.
- O desenho é sempre o da extensão completa, sem recortes de "primeira versão". A ordem só aparece no plano de implementação.
- Cada proposta traz a prática consagrada do mercado, pelo nome e com o porquê.
- Pesquisas curtas e focadas: poucas perguntas por agente, com resposta em minutos. Uma afirmação sobre ferramenta de terceiros se confere no código-fonte ou na documentação oficial e vai para `docs/verificacoes.md`.
- Texto comercial (frase de impacto, landing, topo do README) vende o que a pessoa ganha e nunca fala de banco nem do funcionamento interno, que ficam no corpo do texto. Numa frase de impacto, ofereça três ou quatro opções com uma recomendação, e o mantenedor escolhe.

## Regras

- **Princípios** em [arquitetura §2](docs/arquitetura.md#2-princípios). A regra de ouro das permissões é a D-001, e uma porta de mão única nunca muda sem uma decisão nova.
- **Git:**
  - a coautoria do agente, `Co-Authored-By: <modelo> <noreply@anthropic.com>`, com o nome do modelo da sessão, é a última linha da descrição do pull request, que vira o commit do `develop` no squash. Os commits dos ramos das issues saem sem ela: com a linha neles, o GitHub acrescenta na caixa do squash um bloco `---------` que repete o `Co-authored-by` (V-92). A mensagem do squash termina nos rodapés da descrição, `Refs:` e `Co-Authored-By:`, com uma linha só de coautoria, e o agente confere isso pelo `viewerMergeBodyText` da API do GitHub antes de entregar o pull request. No repositório do plano, sem coautoria;
  - ramos (D-041): cada issue num ramo a partir do `develop` atualizado, criado **antes da primeira edição**, com o nome no padrão de mercado de [docs/padroes/git-e-entrega.md](docs/padroes/git-e-entrega.md) (`<tipo>/<id>-<descrição>`); o pull request volta para o `develop` com squash, e o `develop` vai para o `main` no fim de cada fase;
  - mensagens em inglês, no padrão Conventional Commits, com as regras de [docs/padroes/git-e-entrega.md](docs/padroes/git-e-entrega.md);
  - **o que o agente faz sozinho:** commit nos dois repositórios; criar o ramo de cada issue; push no ramo da issue e no `main` do plano; abrir o pull request para o `develop`. Tudo entra no `develop` por pull request, também a mudança só de docs ou de processo, que vai num ramo `chore/`: desde a abertura, o ruleset recusa o push direto de qualquer um (D-041);
  - **o que fica com o mantenedor:** o merge dos pull requests no `develop`, depois da revisão, e tudo o que vai para o `main` do produto. O agente nunca toca o `main` do produto: nem push, nem pull request, nem tag;
  - nunca push forçado nem reescrita de histórico (V-78);
  - antes de cada push, o agente lê o diff inteiro, procurando segredo, dado pessoal e arquivo que não devia ir.
- **Comandos no ambiente** só com confirmação, dizendo o que o comando faz e como desfazer: instalar algo no sistema, Docker fora dos testes, bancos fora dos containers de teste, publicar no npm.
- **Skills** do projeto em `.claude/skills`.
