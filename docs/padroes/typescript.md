# TypeScript e Node

## Base

- **Node 22**, a versão do Directus (V-59), fixada em `.node-version` e em `engines`. Muda quando o Directus
  mudar.
- **TypeScript estrito,** com `noUncheckedIndexedAccess`. `any` não entra: o que chega de fora é `unknown` até ser
  validado.
- **Só ESM.**
- **pnpm 10,** com workspaces e catálogos em modo estrito, como no Directus: cada dependência tem uma versão só no
  repositório inteiro, declarada no `pnpm-workspace.yaml`.
- **Formatação e lint:** Prettier, e ESLint com `typescript-eslint` (com as regras que usam os tipos),
  `eslint-plugin-vue`, `eslint-plugin-import-x` e `eslint-config-prettier`, a mesma combinação do Directus (V-59). O
  lint cuida do estilo e da direção das camadas, e a revisão, do resto.
- **Código morto:** o Knip, no `pnpm check`, recusa arquivo, export e dependência sem uso (V-69), com o compilador
  do Vue ligado para enxergar os `.vue`.
- **As regras do Sonar** vêm do SonarQube Cloud (V-72), e não do `eslint-plugin-sonarjs`, cuja licença real não é
  de código aberto (V-73).

## Organização do motor

```
packages/extension/src/
  internals/    o único lugar que importa do @directus/api, com um adaptador por versão (D-001)
  db/           a interface do adaptador e um adaptador por banco (D-002)
  operations/   uma pasta por operação: entrada, partes do resultado, nível em cada banco e SQL
  query/        a consulta registrada: registro, id, partes e cursor
  tiles/  cache/  queue/  live/  reports/
  routes/       as rotas HTTP, finas: validam, chamam o motor e respondem
  app/          layout, módulo, painel e as opções da operação de Flow
```

É o ponto de partida; a F02 confirma.

- **A dependência anda num sentido só:** rotas → operações → adaptadores → internos. Nada importa uma rota, e nada
  fora de `internals/` importa o `@directus/api`. O lint garante as duas coisas: as zonas do `no-restricted-paths`
  do `import-x` para a direção das camadas, com o `no-cycle` contra ciclos (V-68), e uma regra
  `no-restricted-imports` para o `@directus/api`.
- **Uma operação é um módulo profundo:** a interface é pequena (entrada validada, partes do resultado, nível em
  cada banco), e a implementação rica fica atrás dela.
- **Exportações nomeadas.** `export default` só onde o Directus exige, no registro das superfícies.

## Erros

- Erros de domínio tipados, com o código do contrato, convertidos para o formato do Directus só na borda, pelo
  `createError` do `@directus/errors`.
- Nada de `throw` com texto solto, e nada de erro engolido: um `catch` que não sabe o que fazer propaga.
- Mensagem de erro nunca leva SQL, a geometria enviada, token ou dado de outro usuário.

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
