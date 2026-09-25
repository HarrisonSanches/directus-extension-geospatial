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
- O documento passa pelo lint (Redocly CLI) na CI e é servido em `GET /geospatial/openapi.json`.
- Os testes de integração validam as respostas contra o documento.

## Convenções

- Tudo sob `/geospatial` (D-019), com os nomes das operações em camelCase: o termo canônico do glossário (D-024).
- Respostas no formato do Directus: `{ data, meta }`.
- Erros no formato do Directus, com códigos próprios em `UPPER_SNAKE_CASE`, todos listados no contrato: operação
  indisponível, geometria inválida, limite excedido, consulta desconhecida e tempo esgotado (§7.8).
- Valores calculados no campo reservado `$geo`; nas formas, nas propriedades do GeoJSON.
- Horários em ISO 8601 com deslocamento (D-031).
- Coordenadas sempre em `[longitude, latitude]`, como no GeoJSON.
- O canal ao vivo é SSE, em `/geospatial/live`, com a autenticação da API. O SDK manda o token no cabeçalho, e a
  documentação recomenda o cabeçalho, e não o `access_token` na URL, que costuma ficar gravado em log (D-035).

## Paginação

- Por `limit` e `cursor`. O cursor é opaco para o cliente: a chave da ordem mais a chave primária, codificadas.
- O estilo do `/items` também aceita `page` e `offset`, por compatibilidade, e a documentação diz que eles ficam
  lentos em páginas fundas.
- Todo `limit` tem máximo, declarado no contrato.

## Compatibilidade

- A versão da API sai em `/geospatial/capabilities`: é o `info.version` do documento, que um teste mantém igual à
  constante `apiVersion` do contrato. A rota recusa o pedido sem sessão, e só o admin vê o banco (D-042).
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
