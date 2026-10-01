# Padrões de desenvolvimento

Como o código da extensão é escrito, testado e entregue. Vale para o mantenedor e para qualquer agente que trabalhe
no repositório. A arquitetura diz **o quê**; as decisões dizem **por quê**; estes arquivos dizem **como**.

A referência de mercado mais próxima é o próprio repositório do Directus (V-59). A extensão usa as mesmas
ferramentas do host, para o código dela ler como o dele e para uma mudança no Directus aparecer nos nossos
testes ao mesmo tempo, e não depois.

As fases (F00 a F17), as issues (como a F00-06) e os achados (A-0xx) citados aqui são do plano de implementação,
que o mantenedor guarda num repositório privado.

| Arquivo                                                      | Trata de                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [`testes.md`](testes.md)                                     | A estratégia de testes, a mais importante daqui                                   |
| [`typescript.md`](typescript.md)                             | TypeScript e Node: organização, erros, tempo, cancelamento, configuração e logs   |
| [`banco-e-sql.md`](banco-e-sql.md)                           | A query permitida, o SQL espacial, os índices, a matriz e as coleções da extensão |
| [`api-e-contrato.md`](api-e-contrato.md)                     | O contrato OpenAPI, os erros, a paginação, a compatibilidade e o SDK              |
| [`frontend.md`](frontend.md)                                 | Vue no Studio, o mapa, o tema, a tradução e a acessibilidade                      |
| [`seguranca-e-dependencias.md`](seguranca-e-dependencias.md) | Segredos, cadeia de suprimentos, publicação, páginas públicas e a demo            |
| [`git-e-entrega.md`](git-e-entrega.md)                       | Commits, ramos, integração contínua, revisão e versões                            |

## Princípios

1. **Teste é parte da entrega, não etapa depois dela.** Código sem teste não está pronto.
2. **A regra de ouro também no código** (D-001). Nenhum dado sai sem passar pela query permitida, e só o módulo
   dos internos importa o `@directus/api`, o que o lint garante.
3. **A fonte da verdade fica no formato nativo:** o OpenAPI para a API (D-016), a matriz de capacidades declarada
   num lugar só por operação (D-002) e as coleções da extensão criadas pelos serviços do Directus (D-015). O
   resto é gerado ou conferido a partir deles.
4. **Tempo, aleatoriedade e cancelamento são injetados.** Nenhum código de domínio chama `Date.now()` nem
   `Math.random()` direto, e todo trabalho assíncrono recebe um `AbortSignal`.
5. **Falhar fechado e ser honesto.** Na dúvida sobre permissão, negar e avisar; resultado parcial ou limitado
   sempre diz que é (arquitetura, §2).
6. **Simples antes de esperto.** Plataforma antes de dependência; dependência antes de framework. No Studio, cada
   dependência pesa para todos os usuários, inclusive para quem nunca abre um mapa.
7. **Código em inglês; documentação interna em português; documentação pública em inglês.**

## Pronto quer dizer

Toda mudança, de qualquer tamanho, só está pronta quando:

- [ ] tem testes no nível certo ([`testes.md`](testes.md)), escritos antes do código na regra de domínio;
- [ ] `pnpm check` passa: formatação, lint, tipos, Knip, testes unitários e de integração no PostGIS e no SQLite,
      no Directus 11.17 e no 12;
- [ ] nenhum erro nem aviso do TypeScript, do lint ou do editor, e nenhum comentário que desliga uma regra
      (`@ts-ignore`, `@ts-expect-error`, `eslint-disable` e parecidos);
- [ ] se devolve dado, tem o teste de paridade de permissão com o `/items`;
- [ ] o contrato mudou primeiro: o OpenAPI, os tipos, o nível da operação em cada banco da matriz e as coleções
      da extensão;
- [ ] o que a mudança cria no banco ou nas permissões entra no inventário, com como desfazer (D-039), e o que ela
      passa a guardar tem prazo de retenção e está no mapa do §7.10 (D-038);
- [ ] o código novo tem pelo menos 90% de cobertura; no motor, 90% de linhas e de ramificações (D-017);
- [ ] texto novo de interface existe em inglês e em pt-BR, funciona pelo teclado e passa no axe;
- [ ] a documentação pública mudou junto, se mudou o que o usuário vê ou o que a extensão acessa;
- [ ] surpresa virou achado, decisão virou `D-0xx`, e fato de ferramenta de terceiros virou `V-xx`;
- [ ] a integração contínua está verde.

Nenhuma fase do plano termina sem esta lista valendo para tudo o que ela entregou.

## Comandos

Os nomes são estes, e a F00 os cria.

| Comando                                               | Faz                                                                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                        | Instala as dependências; na CI, com o lockfile congelado                                                                                                                         |
| `pnpm dev`                                            | Sobe Directus 12, PostGIS e Redis em `127.0.0.1`, com a extensão em watch, e gera os segredos. Antes, copie o `dev/.env.example` para `dev/.env`. A chave do 12 vai no Studio    |
| `pnpm dev:down`                                       | Derruba o ambiente e guarda os dados; com `--volumes`, apaga o banco e os uploads, e antes a licença do 12, se aplicada, é desativada em Settings → License (D-044)              |
| `pnpm dev:logs`                                       | Os logs do ambiente de desenvolvimento; com o nome de um serviço, como `directus`, só os dele                                                                                    |
| `pnpm test`                                           | Testes unitários, em segundos                                                                                                                                                    |
| `pnpm test:coverage`                                  | Os unitários e a integração, com a cobertura do V8 somada, inclusive a de dentro do Directus (V-117); o portão e o Codecov entram na F00-10                                      |
| `pnpm typecheck`                                      | Os tipos, com o `tsc` do TypeScript 7                                                                                                                                            |
| `pnpm format`                                         | Formata o repositório inteiro com o Prettier                                                                                                                                     |
| `pnpm lint`                                           | O ESLint, que reprova com qualquer aviso; com `--fix`, corrige o que tem correção automática                                                                                     |
| `pnpm knip`                                           | Código morto: arquivo, export e dependência sem uso                                                                                                                              |
| `pnpm --filter directus-geospatial-contract generate` | Gera os tipos do contrato a partir do `openapi.yaml`                                                                                                                             |
| `pnpm test:integration`                               | Directus e bancos de verdade em containers, uma combinação por projeto; `INTEGRATION=12-sqlite` roda uma só. O 12 com PostGIS usa a chave do `test/.env` ou fica no Core         |
| `pnpm test:bind-license`                              | Uma vez só, com a chave no `test/.env`: prende a chave do 12 a um projeto que o servidor escolhe, para o `test/license.ts` (D-044). Gasta uma ativação                           |
| `pnpm test:e2e`                                       | Playwright com axe, no Studio de verdade                                                                                                                                         |
| `pnpm check`                                          | Formatação, lint, tipos, Knip, `test` e `test:integration`: o que a CI roda no pull request, menos as análises que só existem nela (cobertura do diff, SonarQube Cloud e zizmor) |
| `pnpm vitest run <arquivo> -t "<nome>"`               | Um teste só: o ciclo do TDD                                                                                                                                                      |
