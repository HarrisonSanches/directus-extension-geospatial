# API e contrato

## Contrato primeiro

- O documento OpenAPI 3.2, em `packages/contract/openapi.yaml`, é a fonte da verdade (D-016). Rota nova ou mudada
  começa por ele. Um método que o OpenAPI não nomeia, como o `SEARCH`, vai no `additionalOperations` da rota, que o
  Redocly confere e o gerador de tipos pula, e o corpo e a resposta dele vão em `components`, de onde os tipos saem
  (V-181). O pacote `directus-geospatial-contract` é privado: a extensão e o SDK o usam no workspace, e o
  build de cada um embute o que precisa.
- Dele saem:
  - os tipos TypeScript, pelo `@hey-api/openapi-ts`, só com os tipos, e não pelo `openapi-typescript`, que não aceita
    o TypeScript 6 do lint (V-107). Ficam em `src/generated/`, no Git, gerados pelo
    `pnpm --filter directus-geospatial-contract generate`, e nunca editados à mão: um teste gera de novo e reprova
    quando o arquivo fica para trás do documento. São usados pelo motor e pelo SDK;
  - a validação da entrada (Ajv, pelo JSON Schema do próprio documento), feita antes de tocar o banco;
  - a referência da API no site de documentação.
- O documento passa pelo lint do Redocly CLI, com o `recommended-strict`, em que cada aviso é um erro, e nenhuma regra
  desligada. O `pnpm lint` o roda, e com ele o `pnpm check` e a CI. O `redocly.yaml` desliga a telemetria, que o
  Redocly CLI manda a cada comando (V-169).
- O `generate` escreve também o documento em JSON, em `src/generated/openapi.json`, que o build da extensão embute e
  que um teste mantém igual ao YAML. A extensão o serve em `GET /geospatial/openapi.json`, cru, sem o `{ data }`, como
  o Directus serve o dele (V-168), só a quem tem sessão, como o `capabilities` (D-042). O `servers` é a variável
  `{publicUrl}`, porque o mesmo documento serve a qualquer Directus.
- Os testes de integração validam cada resposta contra o documento (`docs/padroes/testes.md`).

## Convenções

- Tudo sob `/geospatial` (D-019), com os nomes das operações em camelCase: o termo canônico do glossário (D-024).
- Respostas no formato do Directus: `{ data, meta }`. O `meta` só traz o que vale para a resposta, como o `capped`, o
  aviso de que o Node completou a operação sobre um volume máximo e a lista ficou parcial (D-052).
- Erros no formato do Directus, com códigos próprios em `UPPER_SNAKE_CASE` e o prefixo `GEOSPATIAL_` (D-045), todos
  listados no schema `ErrorCode` do contrato: banco fora (`GEOSPATIAL_DATABASE_UNAVAILABLE`, 503), internos do Directus
  recusados (`GEOSPATIAL_INTERNALS_UNSUPPORTED`, 503), operação indisponível no banco
  (`GEOSPATIAL_OPERATION_UNAVAILABLE`, 501, com a operação e o motivo nas `extensions`, e o motivo nunca diz o banco,
  D-042), entrada fora do contrato (`GEOSPATIAL_INVALID_INPUT`, 400, com o lugar e a regra no motivo, e nunca os
  valores enviados), limite excedido (`GEOSPATIAL_LIMIT_EXCEEDED`, 413, com o limite nas `extensions`), geometria
  inválida (F05), consulta desconhecida (`GEOSPATIAL_UNKNOWN_QUERY`, 404, e o cliente registra de novo) e tempo
  esgotado (§7.8).
- **O `geo` do estilo do `/items`** vai em JSON, como o `filter` do Directus, que é como o SDK do Directus manda um
  parâmetro que não conhece (V-171), e não pelos colchetes do `qs`. É um objeto com a `operation`, o id da operação
  (D-024), e as entradas dela, que o contrato descreve num `oneOf` com o `discriminator` pela `operation`. O mesmo
  objeto vai no corpo do `SEARCH`, `{ geo, query }`, com a `query` do `/items` como o Directus a lê no corpo do `SEARCH`
  dele, no lugar da da URL (V-11, V-181), e no da consulta registrada. O `field` diz o campo de geometria que a operação lê, e sem
  ele vale o único da coleção; com dois ou mais, o pedido é recusado, até a configuração da coleção trazer o campo
  padrão (F06). A D-048 registra a escolha.
- **A consulta registrada** (D-004, D-053): o `POST /geospatial/queries` recebe a pergunta,
  `{ collection, geo, query }`, com o filtro, a busca e os campos do `/items` na `query`, e devolve `{ data: { id } }`.
  O id é o HMAC-SHA-256 da pergunta na forma canônica do JSON (RFC 8785), com a chave derivada do `SECRET` do Directus.
  O `$NOW` do filtro vira o minuto do registro, e a query passa pelo `sanitizeQuery` e pelo `validateQuery` do
  Directus, sem ler o esquema nem as permissões. Cada parte, como o `GET /geospatial/queries/:id/items`, aplica as
  permissões de quem pede e leva na URL só o `limit` e o `sort`.
- Um parâmetro do `/items` fora do lugar, como o `limit` acima do máximo, ou que a operação ainda não trata, volta com
  o `INVALID_QUERY` do Directus, em vez de ficar de fora calado. O `geo`, o corpo do `SEARCH` e o campo que não é de
  geometria, que são da extensão, voltam com o `GEOSPATIAL_INVALID_INPUT`, e o corpo acima de 256 KB, abaixo do 1 MB
  do Directus (V-10), com o `GEOSPATIAL_LIMIT_EXCEEDED`. Na URL de uma parte da consulta registrada, um parâmetro do
  `/items` além do `limit` e do `sort` volta com o `INVALID_QUERY`, porque vai no registro. Os limites ficam num lugar
  só, em `limits.ts`.
- A coleção que o esquema não tem responde `FORBIDDEN`, como a que o usuário não lê, como o `/items` faz. Um problema
  do campo de geometria só aparece depois de a cadeia do Directus conferir que o usuário lê a coleção.
- Toda operação que devolve itens responde como o `/items` também fora das permissões (V-173): a coleção do sistema,
  pelo prefixo `directus_`, responde `FORBIDDEN`, também ao admin; a inativa do 12, o `COLLECTION_INACTIVE`, que a
  própria cadeia lança; e os valores saem pelo `PayloadService` do Directus, como o `/items` os dá, com a geometria
  convertida por ele do texto da query permitida. Cada item leva só os campos da árvore que o Directus montou, o `*`
  pelo que o usuário pode ler, sem a chave primária que ele lê para si (V-183).
- Valores calculados no campo reservado `$geo`; nas formas, nas propriedades do GeoJSON. No raio, a `distance`, em
  metros, até o centro, e no círculo, o `center` e a `distance` da pergunta.
- **As formas** (D-022, D-055):
  - o `GET /geospatial/queries/:id/shapes` devolve `{ data, meta }`, com o `data` numa `FeatureCollection` do GeoJSON
    e o `meta.next` como nas listas de itens;
  - cada forma é uma `Feature` em WGS 84, com os valores da operação nas propriedades;
  - os anéis seguem a RFC 7946: o de fora no anti-horário e o furo no horário, e a forma que cruza o antimeridiano sai
    cortada nele, num `MultiPolygon`;
  - a URL leva só o `limit` e o `cursor`;
  - as formas não leem item nenhum, mas a query permitida é montada, sem rodar: quem não lê o que os itens da mesma
    pergunta leem recebe o erro do `/items`;
  - o círculo do raio sai do servidor, pela GeographicLib, com 128 lados, igual em todo banco.
- A lista de itens segue a ordem natural da operação, ou o `sort` da página, sempre terminando pela chave primária. A
  ordem lê os valores que a query permitida expõe, e não a coluna crua, como o `/items` faz (D-051, V-179). O `sort` por
  um campo de relação ou por uma função volta com o `INVALID_QUERY`, por enquanto.
- Horários em ISO 8601 com deslocamento (D-031).
- Coordenadas sempre em `[longitude, latitude]`, como no GeoJSON.
- O canal ao vivo é SSE, em `/geospatial/live`, com a autenticação da API. O SDK manda o token no cabeçalho, e a
  documentação recomenda o cabeçalho, e não o `access_token` na URL, que costuma ficar gravado em log (D-035).

## Paginação

- Por `limit` e `cursor` (D-054). Cada lista traz no `meta.next` o cursor da página seguinte, que falta na última. O
  cursor vai na URL do `GET` e das partes da consulta registrada, e no corpo do `SEARCH`. A página começa logo depois do
  último item da anterior, pela chave da ordem, a distância ou os campos do `sort`, e pela chave primária (_keyset_).
- O cursor é opaco e cifrado: AES-256-GCM, com a chave derivada do `SECRET` e a lista (a coleção, o `geo` e o `sort`)
  como dado associado. Ele guarda os valores da ordem como o banco os escreve, o texto no Postgres (V-185). Um cursor
  mudado ou de outra lista volta com o `GEOSPATIAL_INVALID_INPUT`, antes do banco, e junto do `offset` ou do `page`,
  com o `INVALID_QUERY`.
- O estilo do `/items` também aceita `page` e `offset`, por compatibilidade, e a documentação diz que eles ficam
  lentos em páginas fundas.
- Todo `limit` tem máximo, declarado no contrato. Nas listas de itens, de 1 a 1.000, o schema `Limit`, e o `-1` do
  `/items`, que traz todos, volta com o `INVALID_QUERY`. Sem o `limit`, vale a página padrão do Directus, o
  `QUERY_LIMIT_DEFAULT` (D-051).

## Compatibilidade

- A versão da API sai em `/geospatial/capabilities`: é o `info.version` do documento, que um teste mantém igual à
  constante `apiVersion` do contrato. A rota recusa o pedido sem sessão, e só o admin vê o banco e o resultado da
  checagem dos internos (D-042).
- Mudança que quebra cliente só em versão major, com o aviso de descontinuação publicado antes, numa minor.
- Acrescentar um campo na resposta não quebra; tirar um campo, ou mudar o sentido dele, quebra.

## SDK

- O pacote `directus-geospatial-sdk`, com o `@directus/sdk` como dependência de par (_peer_).
- Um comando por rota, no estilo do SDK oficial, usado em `client.request(...)`, com o prefixo `geo` (D-024).
- Os tipos saem do contrato, e os campos se completam pelo esquema do usuário.
- A paginação é um iterador (`for await`); os erros são tipados, com os códigos da API; e o `geoCapabilities()`
  serve para checar antes de chamar.
- Nenhuma dependência de execução além do par.
- O build é com o tsdown, como em pacotes do Directus (V-59), e o pacote passa pelo `publint` e pelo
  `@arethetypeswrong/cli` antes de publicar.
