# API e contrato

## Contrato primeiro

- O documento OpenAPI 3.1, em `packages/contract/openapi.yaml`, é a fonte da verdade (D-016). Rota nova ou mudada
  começa por ele. O pacote `directus-geospatial-contract` é privado: a extensão e o SDK o usam no workspace, e o
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
- Respostas no formato do Directus: `{ data, meta }`.
- Erros no formato do Directus, com códigos próprios em `UPPER_SNAKE_CASE` e o prefixo `GEOSPATIAL_` (D-045), todos
  listados no schema `ErrorCode` do contrato: banco fora (`GEOSPATIAL_DATABASE_UNAVAILABLE`, 503), internos do Directus
  recusados (`GEOSPATIAL_INTERNALS_UNSUPPORTED`, 503), operação indisponível no banco
  (`GEOSPATIAL_OPERATION_UNAVAILABLE`, 501, com a operação e o motivo nas `extensions`, e o motivo nunca diz o banco,
  D-042), geometria inválida, limite excedido, consulta desconhecida e tempo esgotado (§7.8).
- **O `geo` do estilo do `/items`** vai em JSON, como o `filter` do Directus, que é como o SDK do Directus manda um
  parâmetro que não conhece (V-171), e não pelos colchetes do `qs`. É um objeto com a `operation`, o id da operação
  (D-024), e as entradas dela, que o contrato descreve num `oneOf` com o `discriminator` pela `operation`. O mesmo
  objeto vai no corpo do `SEARCH` e da consulta registrada. O `field` diz o campo de geometria que a operação lê, e sem
  ele vale o único da coleção; com dois ou mais, o pedido é recusado, até a configuração da coleção trazer o campo
  padrão (F06). A D-048 registra a escolha.
- Um parâmetro do `/items` que a operação ainda não trata, como o `sort`, volta com o `INVALID_QUERY` do Directus, em
  vez de ficar de fora calado, e o `geo` fora do contrato também, até os códigos próprios de entrada.
- A coleção que o esquema não tem responde `FORBIDDEN`, como a que o usuário não lê, como o `/items` faz. Um problema
  do campo de geometria só aparece depois de a cadeia do Directus conferir que o usuário lê a coleção.
- Toda operação que devolve itens responde como o `/items` também fora das permissões (V-173): a coleção do sistema,
  pelo prefixo `directus_`, responde `FORBIDDEN`, também ao admin; a inativa do 12, o `COLLECTION_INACTIVE`, que a
  própria cadeia lança; e os valores saem pelo `PayloadService` do Directus, como o `/items` os dá, com a geometria
  convertida por ele do texto da query permitida.
- Valores calculados no campo reservado `$geo`; nas formas, nas propriedades do GeoJSON. No raio, a `distance`, em
  metros, até o centro.
- A lista de itens segue a ordem natural da operação, ou o `sort` da página, sempre terminando pela chave primária. A
  ordem lê os valores que a query permitida expõe, e não a coluna crua, como o `/items` faz (D-051, V-179). O `sort` por
  um campo de relação ou por uma função volta com o `INVALID_QUERY`, por enquanto.
- Horários em ISO 8601 com deslocamento (D-031).
- Coordenadas sempre em `[longitude, latitude]`, como no GeoJSON.
- O canal ao vivo é SSE, em `/geospatial/live`, com a autenticação da API. O SDK manda o token no cabeçalho, e a
  documentação recomenda o cabeçalho, e não o `access_token` na URL, que costuma ficar gravado em log (D-035).

## Paginação

- Por `limit` e `cursor`. O cursor é opaco para o cliente: a chave da ordem mais a chave primária, codificadas.
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
