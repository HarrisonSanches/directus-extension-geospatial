# TypeScript e Node

## Base

- **Dois Nodes, cada um no seu papel:**
  - **nas ferramentas** (build, lint, testes, testcontainers), o Node 24, o LTS ativo, fixado em `.node-version`.
    Passa para o 26 quando ele virar LTS, em 28/10/2026 (V-79);
  - **no código da extensão,** o Node 22, porque ela roda dentro do Node do Directus, e as imagens oficiais do
    11.17 e do 12 usam o 22 (V-80). O `engines` da extensão pede `>=22`, e o `@types/node` fica na 22, pelo
    catálogo `node22`, para o TypeScript acusar a API que não existe lá; a suíte de integração, rodando nas imagens
    do Directus, pega o resto. Muda quando a imagem do Directus mudar.
- **TypeScript 7, estrito,** com `noUncheckedIndexedAccess`. `any` não entra: o que chega de fora é `unknown` até
  ser validado. A configuração base fica no `tsconfig.base.json`, que os pacotes herdam, e o `tsc` confere também
  os `.d.ts` das dependências, sem o `skipLibCheck`. Quando um pacote usa nos tipos uma dependência que não declara,
  o `packageExtensions` do `pnpm-workspace.yaml` declara por ele (V-101). A exceção é o pacote da extensão: os
  `.d.ts` do `@directus/types` importam sete pares opcionais, e ele usa o `skipLibCheck`, como o `@directus/tsconfig`
  e o template de extensão do Directus. O código dele continua conferido contra esses tipos, e o lint estrito recusa
  o tipo que não resolve (V-108).
- **Código gerado não passa pelo lint:** os tipos do contrato seguem o estilo do gerador, e um teste os mantém em
  dia com o documento. Eles passam pelo Prettier e pelo `tsc`.
- **Dois TypeScript lado a lado, até a P-25:** o 7.0 não traz a API que o lint usa (V-90), e o catálogo tem dois
  apelidos, como recomenda o anúncio do 7 (V-94). O `tsconfig` serve aos dois, e o `tsc` 7 manda quando eles
  discordam:
  - o `@typescript/native` é o TypeScript 7, dono do `tsc`, que decide os tipos no `pnpm typecheck`;
  - o `typescript` é o pacote da API do 6.0, que o `typescript-eslint` e o commitlint carregam, e o VS Code usa o
    6.0 embutido;
  - quando o `typescript-eslint` aceitar o 7, o `typescript` passa para o 7, e o apelido sai.
- **Só ESM.**
- **pnpm 12,** fixado no `packageManager`, que a CI e o Renovate leem. O pnpm não troca de versão sozinho
  (`pmOnFail: ignore`), porque a troca grava o próprio pnpm num primeiro documento do lockfile, e o dependency
  graph do GitHub só lê esse (V-93). No lugar dela, o `engines.pnpm` com o `engineStrict` recusa outra versão e
  diz qual usar. O Corepack não entra: o Node deixou de trazê-lo no 25 (V-84, V-85, V-87).
- **Workspaces e catálogos em modo estrito,** como no Directus: cada dependência tem uma versão só no repositório
  inteiro, declarada no `pnpm-workspace.yaml`, e o `pnpm add` recusa a versão que foge do catálogo.
- **O pnpm, e não o Bun:** o Bun tem as mesmas proteções, mas o dependency graph do GitHub não lê o `bun.lock`, e
  sem ele o Dependabot alerts não vê as dependências indiretas (V-81, V-82). O lockfile fica num documento só, o
  formato que o GitHub lê (V-86, V-93).
- **Formatação:** Prettier, com a configuração do Directus (V-98): 120 colunas, aspas simples e tab, que vem do
  `.editorconfig`, com o YAML em espaços. O tab deixa cada pessoa escolher a largura no editor e no GitHub (V-99). O
  Markdown também é formatado, sem mexer na quebra das linhas (`proseWrap: preserve`, o padrão do Prettier). O
  `pnpm format` corrige tudo, e o `pnpm check` só confere.
- **Lint:** ESLint com o `typescript-eslint` no `strictTypeChecked` e no `stylisticTypeChecked`, com as regras que
  usam os tipos, e o `eslint-plugin-import-x`, o `eslint-plugin-vue` (a partir da F04) e o `eslint-config-prettier`,
  a combinação do Directus (V-59), no nível estrito (V-96). O lint cuida do estilo e da direção das camadas, e a
  revisão, do resto. O `pnpm lint --fix` corrige o que tem correção automática.
  - **Nenhum comentário desliga regra:** o `noInlineConfig` faz o ESLint ignorar todo `eslint-disable` e avisar,
    e o lint roda com `--max-warnings 0`, então qualquer aviso reprova. O `ban-ts-comment` recusa `@ts-ignore`,
    `@ts-expect-error` e `@ts-nocheck`, e o `no-warning-comments` recusa `prettier-ignore` e os comentários que
    tiram código da cobertura (`v8 ignore`, `c8 ignore`, `istanbul ignore`).
  - **O `x!` também não entra** (`no-non-null-assertion`): ele cala o compilador como um `@ts-ignore`.
  - **A ordem dos imports é a do Directus** (V-98): primeiro o Node, depois os pacotes e por fim os arquivos do
    projeto, em ordem alfabética dentro de cada grupo e sem linha em branco entre eles, com os nomes dentro das
    chaves também em ordem.
  - **As chaves de objeto e os campos de tipo ficam na ordem do significado,** sem regra: o GeoJSON começa pelo
    `type`, e uma entrada lê "centro, raio, unidade".
  - O log é pelo `logger` do Directus (`no-console`), e ternário não se aninha (`no-nested-ternary`).
  - As regras de linha em branco do Directus não entram: estão obsoletas no ESLint (V-96), e a formatação é do
    Prettier.
- **Código morto:** o Knip, no `pnpm check`, recusa arquivo, export e dependência sem uso (V-69, V-100), com o
  compilador do Vue ligado para enxergar os `.vue`, a partir da F04.
- **As regras do Sonar** vêm do SonarQube Cloud (V-72), e não do `eslint-plugin-sonarjs`, cuja licença real não é
  de código aberto (V-73).

## Organização do motor

```
packages/extension/src/
  internals/    o único lugar que importa do @directus/api, com um adaptador por versão (D-001)
  capabilities/ a matriz de capacidades: a detecção do ambiente e o que cada um vê (D-002, D-042)
  db/           a interface do adaptador e um adaptador por banco (D-002)
  operations/   uma pasta por operação: entrada, partes do resultado, nível em cada banco e SQL
  query/        a consulta registrada: registro, id, partes e cursor
  tiles/  cache/  queue/  live/  reports/
  routes/       as rotas HTTP, finas: validam, chamam o motor e respondem
  app/          layout, módulo, painel e as opções da operação de Flow
```

Confirmada na F02-01. O `endpoint.ts` e o `hook.ts` registram as superfícies no Directus, e o `errors.ts` e o
contrato servem a todas as camadas.

- **A dependência anda num sentido só:** rotas → operações → adaptadores → internos. As operações e os outros
  módulos do motor (`query/`, `capabilities/`, `tiles/`, `cache/`, `queue/`, `live/`, `reports/`) ficam na mesma
  camada, acima de `db/`. Uma camada pode pular as de baixo, como a rota que lê um adaptador, e nunca importar as de
  cima.
- **O lint garante a direção,** também nos testes, que moram ao lado do código: as zonas do `no-restricted-paths` do
  `import-x` (V-68), com o `no-cycle` contra ciclos. Nada importa uma rota, fora o `endpoint.ts`, que as registra.
- **Nada fora de `internals/` importa o `@directus/api`,** em nenhum arquivo do repositório: o `no-restricted-imports`
  recusa o import estático e a reexportação, e o `no-restricted-syntax`, o `import()` e o `typeof import()`, que o
  primeiro não vê (V-167). O `eslint.config.test.ts` passa cada direção proibida e cada permitida pelas mesmas
  regras.
- **Os internos entram na hora, e são conferidos ao subir.** O `@directus/api` é declarado em
  `internals/directus-api.d.ts`, sem instalar (V-141), e cada módulo entra por um `import()` com o nome dele, no
  carregador de `internals/modules.ts`: um import estático do que uma versão não tem derrubaria a extensão ao carregar
  (V-146). A checagem recebe o carregador, e o teste unitário passa um falso. A forma do que cada passo da cadeia
  devolve é conferida, e o resto do tipo vem das declarações, que a paridade com o `/items` confirma.
- **A query permitida segue a ordem do `readByQuery`:** o que a versão faz antes dos hooks, que é o único passo de cada
  adaptador, o `items.query` pelo emissor dos eventos do núcleo, e a cadeia sobre a query que os hooks devolveram
  (V-144, V-174). A operação lê a página que voltou dos hooks. A checagem ao subir monta a cadeia sem emitir, para
  nenhum hook de outra extensão rodar numa leitura que ninguém pediu.
- **Uma operação é um módulo profundo:** a interface é pequena (entrada validada, partes do resultado, nível em
  cada banco), e a implementação rica fica atrás dela.
- **Exportações nomeadas.** `export default` só onde o Directus exige, no registro das superfícies.

## Erros

- Erros de domínio tipados, com o código do contrato, convertidos para o formato do Directus só na borda, pelo
  `createError` do `@directus/errors`.
- Nada de `throw` com texto solto, e nada de erro engolido: um `catch` que não sabe o que fazer propaga.
- Mensagem de erro nunca leva SQL, a geometria enviada, token ou dado de outro usuário. O Directus devolve ao admin
  a mensagem de um erro que não é dele (V-124), então a leitura do banco de uma rota passa pelo `failClosed`, que
  troca a falha pelo erro próprio e manda a causa para o log.

## Tempo, aleatoriedade e cancelamento

- **Relógio injetado** (`Clock`) em tudo que depende de tempo. `Date.now()` e `new Date()` sem argumento ficam
  proibidos no domínio, por uma regra de lint.
- **Aleatoriedade injetada:** tokens e códigos saem do `crypto` do Node, por uma interface que o teste troca.
- **Fuso sempre pelo nome IANA,** nunca por deslocamento fixo (D-031). A biblioteca de datas é decisão da F09.
- **Todo trabalho assíncrono recebe um `AbortSignal`,** da requisição até a consulta no banco. O pedido cancelado
  cancela o que estiver rodando.

## Configuração

- As variáveis de ambiente são lidas e validadas uma vez, na inicialização, num módulo só, e viram um objeto
  tipado. Segredo só em variável de ambiente (§7.8).
- Configuração que não é segredo mora na coleção de configurações da extensão, com o padrão no código.

## Logs

- O `logger` do Directus, num filho com `extension: 'geospatial'` e o id da consulta, quando houver.
- A consulta lenta vai para o log com o id da consulta, o tempo e a operação, nunca com os valores dos parâmetros.
- Nada de geometria inteira, token, senha ou dado de item no log.

## Volume

- Resultado grande anda em fluxo (o `stream` do Knex, cursores), nunca inteiro na memória.
- O que roda no Node sobre os itens permitidos tem limite de volume e avisa quando chega nele (D-002).
- O que demora mais que uma requisição vira um trabalho do executor (D-036), em lotes que podem rodar de novo sem
  duplicar nada, com o ponto de retomada gravado a cada lote.
