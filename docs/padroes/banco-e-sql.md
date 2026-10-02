# Banco e SQL

## A query permitida vem primeiro

- Todo SQL que devolve dado de uma coleção começa pela query permitida que o Directus montou (D-001), e a parte
  espacial vai em volta dela. Não existe atalho: nem para o admin, nem para "só uma contagem".
- O filtro que usa o índice entra como mais condições do `WHERE` da query permitida, sobre a coluna, porque o Directus
  a ordena e o Postgres não achata uma subconsulta ordenada (D-049). Uma condição a mais só descarta linhas, e o
  `WHERE` das políticas e os `CASE WHEN` não mudam. Em volta fica a guarda: o que sai é decidido pelo valor que a query
  permitida expõe, nulo onde uma política esconde o campo.
- Juntar duas coleções é juntar duas queries permitidas.

## SQL seguro

- Os valores vão sempre como parâmetros (o `?` do Knex). Nenhum valor vindo do usuário é concatenado.
- Nome de coleção e de campo só entra no SQL depois de conferido contra o esquema do Directus, e como
  identificador (o `??` do Knex), nunca como texto vindo do pedido (§7.8).
- O SQL espacial de cada dialeto fica no adaptador daquele banco. Operação não escreve dialeto.

## Metros, SRID e índices

- Distância, área, perímetro e comprimento sempre em `geography` (D-007).
- Filtro em dois estágios: a caixa no SRID da coluna, que usa o índice, e o teste exato em metros no que sobrou.
- O SRID é lido da coluna: a entrada chega em 4326 e é convertida para ele, e a saída volta em 4326.
  - O tipo e o SRID de uma coluna espacial vêm do catálogo, a cada pedido, porque o esquema do Directus não os tem
    (V-178).
  - No estágio que o índice responde, converte-se o que entra, nunca a coluna. A caixa vai com a borda cortada em
    trechos curtos, e só onde o PROJ a traz de volta ao mesmo lugar.
  - Um SRID que vai como parâmetro leva `::integer`: sem o tipo, o Postgres escolhe a sobrecarga de texto do
    `ST_Transform`, que o lê como um texto do PROJ (V-178).
- Nas datas, converter o parâmetro, nunca a coluna (D-031), para o banco continuar usando o índice.
- A operação que promete índice tem teste com `EXPLAIN` ([`testes.md`](testes.md)).

## Ordem, tempo máximo e cancelamento

- Toda ordenação termina pela chave primária, para o cursor não pular nem repetir itens e para o relatório gerado
  de novo sair igual.
- Toda consulta tem um tempo máximo pelo tipo: tile, página, contagem ou análise. No Postgres, é o
  `SET LOCAL statement_timeout` dentro da transação; nos outros bancos, o equivalente de cada um, registrado como
  V-xx.
- O pedido cancelado cancela a consulta no banco.
- As consultas da extensão usam o pool próprio (D-006), nunca o do Directus.

## A matriz de capacidades

- Cada operação declara, num lugar só, o nível dela em cada banco: no banco com índice, no banco sem índice, no
  Node com limite ou indisponível (D-002).
- A declaração é lida pela interface, pela API e pelos testes de contrato. Pelo tipo, uma operação sem o nível de
  algum banco não compila.
- Um banco novo começa com tudo indisponível, e cada operação entra nele numa issue própria.

## Coleções da extensão e mudanças no banco

- As coleções `geospatial_*` são criadas pelos serviços do Directus (coleções, campos e relações), e nunca por DDL
  solto, para serem coleções de verdade, com permissões, backup e API (D-015).
- A migração da extensão é versionada, idempotente, travada contra duas instâncias, e só roda por ação do admin,
  que vê antes a lista do que muda (D-008).
- Índice, gatilho e política pronta só por ação do admin, com o SQL ou as permissões à vista. O índice é criado sem
  travar a tabela (`CONCURRENTLY`, no Postgres), em segundo plano e com progresso.
- A extensão nunca muda uma coleção do usuário: nem coluna, nem tipo, nem valor padrão.
