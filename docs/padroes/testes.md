# Testes

Muito teste, e do tipo certo. A meta não é um número de cobertura: é que nenhuma promessa da arquitetura fique
sem um teste que a quebraria se ela deixasse de ser verdade. A primeira dessas promessas é a regra de ouro.

## As camadas

| Camada                    | Pega                                                                   | Ferramentas                                                                   | Roda                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Unitário**              | Regra de domínio, cálculo, formato, montagem de SQL                    | Vitest, `it.each`, fast-check, arquivos dourados                              | A cada mudança, em segundos                                                                               |
| **Integração**            | O motor contra o Directus e o banco de verdade                         | Vitest, testcontainers, `@directus/sdk` para montar os dados                  | A cada push                                                                                               |
| **Paridade de permissão** | Resultado diferente do que o `/items` daria ao mesmo papel             | A suíte de integração, com os papéis de teste                                 | A cada push                                                                                               |
| **Contrato por banco**    | Banco que faz diferente do que a matriz declara                        | A mesma suíte, em cada banco da matriz                                        | PostGIS e SQLite a cada push; todos à noite                                                               |
| **Contrato da API**       | Rota respondendo fora do OpenAPI                                       | O `fetch` da suíte, com o Ajv, valida cada resposta contra o documento        | A cada push                                                                                               |
| **Ponta a ponta**         | O Studio montado: o mapa abre, os tiles chegam, o clique abre o drawer | Playwright com `@axe-core/playwright`                                         | O curto, em pull request que toca a interface, bloqueando o merge; o completo, à noite e antes da release |
| **Mutação**               | Teste que executa o código sem testar nada                             | StrykerJS com o executor do Vitest, no módulo de permissões                   | Toda noite                                                                                                |
| **Medição**               | Regressão de desempenho                                                | k6 nos tiles, `EXPLAIN ANALYZE` no SQL, `bench` do Vitest no que é JavaScript | Sob demanda, pelo `pnpm measure`; os números vão para `verificacoes.md` e para o histórico                |

Quanto mais baixa a camada, mais testes: muitos unitários, bons de integração, poucos e valiosos de ponta a
ponta.

## Regras

**Teste antes do código na regra de domínio** (skill `tdd`): a montagem da query espacial, o agrupamento por
células, o trajeto (trechos, lacunas, pontos suspeitos, paradas), as visitas às cercas, datas e fusos, a
validação da entrada e os hashes do relatório. Em código de ligação (rotas, adaptadores, telas), o teste pode vir
junto, mas vem.

**Nada de mock de banco nem de Directus** (D-017). O motor roda contra um Directus 11.17 e um 12 de verdade, com
os bancos em containers, nas mesmas imagens dos testes do Directus (V-28). Um mock do Knex não pega a diferença
entre dialetos, que é exatamente onde o risco mora.

**Cada teste de integração roda em todas as combinações** de versão do Directus e banco (`test/combinations.ts`),
um projeto do Vitest por combinação. O `pnpm test:integration` roda as do pull request, com o PostGIS mínimo, e a
variável `INTEGRATION` escolhe outras, como as `-postgis-newest`, que a noite acrescenta. O que difere entre as versões fica
no ajudante (`test/directus.ts`): o teste pergunta ao ajudante o que o Directus aceita, e nunca a versão. O
Directus 12 roda com a chave do Open Innovation Grant, ativada sempre no mesmo projeto (D-044), e, sem ela, no tier
Core, que recusa as regras próprias de permissão (V-114). Um teste que depende delas, como os da Maria, roda com
`it.runIf(hasCustomPermissionRules())` e aparece como pulado no Core. O SQLite roda dentro do Directus, numa imagem
construída sobre a oficial por `test/spatialite/Dockerfile`, que carrega a SpatiaLite em cada conexão (V-121), e o 12
com SQLite fica sempre no Core, porque a chave só vai ao banco do projeto dela (D-043, D-044).

**Um teste que derruba ou reinicia um container sobe o próprio ambiente,** com o `startEnvironment` de
`test/environment.ts`, para não quebrar os outros testes da combinação, que rodam em paralelo. O `restart` do ambiente
reinicia o Directus pelo Docker, com o tempo de parar que o `stop` dá, e devolve a URL nova, porque o Docker mapeia
outra porta. A cobertura do Directus dele entra na soma pela pasta de cobertura da rodada, que o setup global entrega a
todos os testes. Com o banco fora, o teste entra com um JWT, porque o Directus procura o token estático no banco antes
de qualquer rota (V-124).

**A suíte carrega uma segunda extensão,** a de `test/hook/`, ao lado da extensão, em toda rodada. Os hooks dela no
`items.query` mudam a leitura de uma coleção própria, a `hooked_occurrences`, e registram o que recebem, para a
paridade com o `/items` alcançar também os hooks de outras extensões (V-144, V-174). A soma da cobertura lê só o bundle
da extensão, então o código dela fica de fora, e só uma rodada com pacotes além dos da suíte deixa de somar. A suíte
carrega também o observador de `test/measure/observer/`, para o teste do índice ler o SQL do raio.

**Uma coleção que um teste cria espera o Directus conhecê-la,** pelo `untilKnown` de `test/directus.ts`, antes do
primeiro uso. Com a suíte criando coleções ao mesmo tempo, o Directus pode guardar no cache um esquema preparado antes
da criação (V-184), e entre as tentativas o admin limpa o cache do sistema. Depois de reiniciar o Directus, o primeiro
pedido espera passar o limitador de pressão.

**Os dados de teste entram pela API do Directus,** com o `@directus/sdk`: o esquema, os papéis, as políticas e os
itens. Assim cada banco guarda a geometria do jeito que o Directus grava nele. O volume que a API não grava a tempo entra por
SQL, na coluna que o Directus criou: no Postgres, pelo `queryOn` de `test/postgres.ts`; no SQLite, pelo `runOnSqlite`
de `test/sqlite.ts`, dentro do container do Directus, em lotes curtos, porque o Directus espera só 1 s por uma trava do
arquivo, que as outras suítes da combinação usam ao mesmo tempo (V-180). Os papéis de sempre, em
`test/seed.ts`:

- **Maria, Operador Zona Sul:** só `regiao = sul`;
- um papel com **duas políticas**, para o OU entre elas (V-22);
- três papéis da zona sul com **campos sem permissão**: um sem a `category`, para o campo pedido pelo nome; um sem a
  geometria; e um que vê a geometria no sul e o norte sem ela, para o vazamento que um envelope sobre a coluna
  mostraria (V-143);
- o **público** e o **admin**.

**Paridade de permissão em tudo que devolve dado.** O teste chama a extensão como cada papel e compara com o
gabarito calculado, em todo banco (A-015):

- o gabarito são os itens que o `/items` dá ao mesmo papel, com a mesma página (o filtro, a busca e os campos),
  filtrados ou ordenados com a GeographicLib, com tolerância só nas distâncias. Um filtro espacial do Directus não
  serve de gabarito: o `_intersects` não vale num `geometry.Point` (V-123) e, no Oracle, não faz a mesma pergunta
  (V-154);
- o erro do `/items` (o público sem leitura, o campo sem permissão pedido pelo nome e a geometria sem permissão) se
  compara inteiro, com o código e a mensagem;
- o item que uma política deixa ver sem a geometria fica fora de toda operação, e o teste reprova um envelope que lê a
  coluna crua.

**Um SQL só, conferido.** O Postgres dos testes carrega o `pg_stat_statements` (V-172), e o teste que promete a query
permitida e a parte espacial num SQL só conta, pelo `callsOn` de `test/postgres.ts`, quantas vezes o banco rodou o que
lê uma coleção que só ele usa, porque os outros testes da combinação rodam ao mesmo tempo. É o que pega a query
permitida rodando sozinha antes do envelope (V-142).

**O laço de eventos conferido.** O observador da suíte mede, pelo `monitorEventLoopDelay` do Node, quanto o laço de
eventos do Directus atrasa, e o teste da operação que o servidor completa reprova se o atraso passar dos 500 ms em que
o limitador de pressão do Directus responde 503 a todo pedido (V-181). O atraso conta também o tempo em que a máquina
ocupada tira a CPU do Directus, então o teste faz três pedidos seguidos e confere o menor: o bloqueio do código aparece
nos três, e a máquina ocupada raramente pega os três. Com os Directus do teste do reinício subindo ao mesmo tempo, o
pior atraso de um pedido só passou de 220 a 323 ms para 347 a 519 ms, sem mudar o código (F02-13).

**Índice conferido, não suposto.** A operação que a matriz declara "no banco com índice" tem um teste que lê o
`EXPLAIN` e falha se o plano varrer a tabela. O plano é o do SQL que chegou ao banco: o observador de
`test/measure/observer/` o entrega com os valores, e o teste roda o `EXPLAIN` pelo psql do container. A coleção é só
do teste, com pontos bastantes para o Postgres pesar o índice, porque numa tabela pequena ele varre a tabela de
propósito, e com o GiST que a extensão oferece ao admin (§7.6). O mesmo teste confere que a caixa não perdeu nenhum
item que a distância sozinha manteria.

**O caminho conferido no SQL.** Um caminho que só muda o desempenho, como a caixa do primeiro estágio, dá o resultado
certo também quando não é tomado. O teste dele confere o resultado e, no SQL que o observador entrega, que o caminho
estava lá, ou que não estava, onde ele não vale. Sem isso, a caixa em outro SRID passou nos testes sem nunca ter ido ao
banco (V-178).

**A coluna que o Directus não cria.** O Directus só cria `geometry` em 4326 (V-25). O teste da coluna em outro SRID ou
em `geography` cria a coleção pelo Directus e muda o tipo da coluna por SQL, no container da suíte, com os pontos
convertidos pelo próprio PostGIS.

**Toda resposta da extensão passa pelo contrato.** O `fetch` da suíte (`test/contract.ts`), que o cliente do SDK usa,
confere cada resposta de `/geospatial/*` contra o `openapi.yaml`: a rota, o método e o status precisam estar nele, e o
corpo, no schema que ele declara, pelo Ajv no JSON Schema 2020-12 do OpenAPI 3.2, no modo estrito (V-169). O `SEARCH`
se confere pelo `additionalOperations` da rota. Uma resposta
fora do documento reprova o pedido, com o lugar e o motivo. O teste que chama o `fetch` sozinho, como o do banco fora,
usa o `checkedFetch`. O núcleo do ajudante fica no pacote do contrato (`responses.ts`), com teste unitário.

**Fakes em vez de mocks.** Onde precisar de dublê (o provedor de endereço, o relógio, o gerador de tokens), uma
implementação simples em memória da interface que o consumidor definiu. O adaptador de um serviço HTTP de fora,
como o Nominatim, é testado contra um servidor falso local (MSW), nunca contra o serviço público.

**Relógio falso para tudo que depende de tempo.** `vi.useFakeTimers` e o relógio injetado. O pulso ao vivo, os
tempos máximos, a contagem em dois tempos, o limite de um pedido por segundo do Nominatim e a hora no futuro são
testados em milissegundos, sem espera real.

**Teste de propriedade onde entra dado de fora** (fast-check, com `@fast-check/vitest`): GeoJSON enviado, geometria
desenhada, coordenadas digitadas, filtros e o cursor, que volta do cliente e não pode trazer nada mudado. A paginação
também tem a sua: percorrer uma lista com empates por páginas de qualquer tamanho dá cada item uma vez. Casos que sempre
entram: polígono inválido, vértices demais, antimeridiano, polos e coordenada fora da faixa.

**Arquivos dourados para o que é gerado:** os tiles MVT (decodificados para GeoJSON antes de comparar), o
documento OpenAPI, o SQL montado de cada operação e o PDF (comparado pelo texto e pela estrutura, não pelos
bytes). Ficam em `testdata/`, com `toMatchFileSnapshot`, e são revisados no diff.

**Teste com nome que diz a regra,** em português: `it('mais próximos devolve N itens que a Maria pode ler')`, e
não `it('nearest 3')`. O código continua em inglês.

**Teste instável é bug.** Não se desliga nem se repete até passar. O ponta a ponta tem uma nova tentativa na CI,
com o rastro do Playwright guardado para investigar.

**O navegador roda num container,** na imagem oficial do Playwright, fixada pelo digest da mesma versão do
`playwright-core` do catálogo, e o Vitest o comanda do host, pelo `chromium.connect` (D-047).

## Cobertura e qualidade dos testes

- **Código novo ou alterado:** pelo menos 90% em todo pull request, medido sobre o diff pela cobertura do patch do
  Codecov, no status `codecov/patch` que o ruleset do `develop` exige (D-017, V-137). O SonarQube Cloud também mostra
  a cobertura no pull request, mas o quality gate dele é o _Sonar way_, com 80% no código novo (V-72), e quem decide
  os 90% é o Codecov.
- **A cobertura total é uma catraca:** pode subir, nunca cair. Os limites da cobertura somada, em linhas, trechos,
  funções e ramificações, ficam em `test/coverage-thresholds.json`, arredondados para baixo com uma casa. O
  `pnpm test:coverage`, que o `pnpm check` roda, falha quando a soma cai abaixo deles e os sobe quando ela sobe; na
  CI, o job de cobertura só confere. Com o `INTEGRATION`, a rodada não tem todas as combinações, e a catraca não é
  conferida. Ela não usa o `thresholds.autoUpdate` do Vitest (V-71), porque ele só enxerga os unitários.
- **Motor** (internos, adaptadores, operações, tiles, consulta registrada): 90% de linhas e de ramificações.
- **Somada entre os bancos:** o job de cobertura da CI soma os relatórios dos unitários e de cada combinação, e eles
  vão ao Codecov num envio só por push e por pull request; a noite confere a catraca e não envia. Um pull request
  que mexe num adaptador roda também o contrato daquele banco.
- **Interface:** a lógica (composables, stores, cálculos, estado das ferramentas) fica em módulos testáveis, com
  90%. A camada fina que desenha no WebGL fica com o ponta a ponta, sem meta de linhas.
- **Mutação:** 90% no módulo de permissões, toda noite. É o que mede se os testes testam, e não só executam.
- Cobertura vinda de teste escrito só para bater a meta não conta.
- O provedor de cobertura é o V8, pelo Vitest.
- **O código que roda dentro do Directus** (a rota, o endpoint e o hook) só é medido pela integração: o Directus do
  teste sobe com o `NODE_V8_COVERAGE`, para com tempo de gravar a cobertura, e ela é convertida pela mesma biblioteca
  do Vitest e somada à dos unitários no `pnpm test:coverage` (V-117). Como os dois lados dividem o código em trechos
  com posições um pouco diferentes, essa soma é um piso, e o critério de 90% se lê em linhas (V-118).

## A medição

**O `pnpm measure` mede sob demanda,** fora do `pnpm check` e da CI, pelo método da F01-16 (A-036):

- cada série começa com 3 aquecimentos, que deixam de fora os primeiros pedidos, os que carregam o esquema, as
  permissões e as páginas da tabela, e segue com 20 medidas, uma de cada vez, com a mediana e o p95 pelo posto mais
  próximo: das 20, o p95 é a 19ª em ordem;
- o volume entra por SQL, na coluna que o Directus criou, porque pela API um milhão levaria uns 30 min (V-164);
- uma combinação de cada vez, porque dois bancos medidos lado a lado dividem o processador;
- o Directus roda como numa instalação: com o build de produção, sem o `NODE_V8_COVERAGE`, que deixa o código mais
  lento, e sem a extensão de `test/hook/`.

**O tempo de dentro do Directus vem de uma extensão de teste,** a de `test/measure/observer/`, que a medição e a
suíte carregam. Ela marca o `items.query` de cada coleção e os eventos `query` e `query-response` da conexão do
Directus, e entrega ao admin, da coleção que o pedido nomear, o tempo de montar a query permitida, do hook até o SQL do
raio, o do banco, e o SQL com os valores, para o `EXPLAIN (ANALYZE, BUFFERS)`. Sem nomear, ela entrega a coleção da
medição. O produto não muda para ser medido.

**Os números ficam em `test-results/measure/`,** fora do Git, um arquivo por combinação, com os planos ao lado, e vão
para uma V-xx em `verificacoes.md` com a unidade, a máquina, as versões e a data. Com `MEASURE_QUICK=1`, cada série
roda no menor volume, com 1 aquecimento e 2 medidas, para conferir em poucos minutos que a medição funciona antes da
rodada longa, cujos números são os que valem.

## Os ensaios de falha viram testes

Cada ensaio de falha de uma fase vira teste automatizado quando a fase termina, na suíte de integração ou na de
ponta a ponta. Os que derrubam uma peça (o banco, o Redis, o processo do Directus) usam os próprios containers do
teste. Os que mudam o Directus montam a imagem na suíte, sobre a oficial, como a do módulo da cadeia fora do lugar
(`test/moved-module/`), e sobem um ambiente próprio, pelo `startEnvironment`.

## Quando cada teste roda

| Quando                              | O que roda                                                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cada push e pull request          | Unitários; integração, paridade e contrato no PostGIS (a versão mínima) e no SQLite, na versão mais antiga e na mais nova da faixa do Directus (hoje, 11.17 e 12.4, D-037); contrato da API; cobertura do código novo |
| Pull request que mexe num adaptador | Mais o contrato daquele banco                                                                                                                                                                                         |
| Pull request que mexe na interface  | Mais o ponta a ponta curto, que bloqueia o merge: o mapa abre no layout, um tile chega, o clique abre o drawer e o axe passa (§7.4)                                                                                   |
| Toda noite                          | A faixa inteira do Directus; o PostGIS na versão mais nova; a partir da F15, a matriz inteira de bancos, a mínima e a mais nova de cada; o ponta a ponta completo; a mutação                                          |
| Antes de cada release               | Tudo o que roda à noite, mais o teste manual com leitor de tela (NVDA e VoiceOver)                                                                                                                                    |
| Canário                             | A suíte de integração contra cada versão nova do Directus, assim que ela sai                                                                                                                                          |
