# Git e entrega

**O agente faz o commit, cria o ramo, dá o push e abre o pull request para o `develop`,** dentro das regras do
`CLAUDE.md`. **O merge e tudo o que chega ao `main` são do mantenedor.**

## Mensagens de commit

O padrão é o [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) (V-62), em inglês,
conferido pelo commitlint (V-63):

```
<tipo>(<escopo>): <assunto>

<corpo>

<rodapés>
```

**Tipo,** em minúsculas, um destes:

| Tipo       | Quando                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| `feat`     | Algo novo para quem usa a extensão, a API ou o SDK                         |
| `fix`      | Correção de um comportamento errado                                        |
| `perf`     | Mais rápido ou mais leve, sem mudar o comportamento                        |
| `refactor` | Mudança no código sem mudar o comportamento                                |
| `test`     | Só testes                                                                  |
| `docs`     | Só documentação: `docs/`, README, comentários                              |
| `build`    | Build, empacotamento e dependências                                        |
| `ci`       | Integração contínua                                                        |
| `style`    | Só formatação                                                              |
| `revert`   | Desfaz um commit anterior                                                  |
| `chore`    | Manutenção que não cabe em nenhum outro; se outro tipo servir, use o outro |

**Escopo,** opcional, em minúsculas com hífen: a parte do projeto que muda. Pode ser a operação (`radius`), o
módulo (`tiles`, `cache`, `queue`, `live`, `reports`, `internals`), o pacote (`sdk`, `contract`) ou o banco
(`postgis`, `sqlite`). Um commit que mexe em muita coisa fica sem escopo.

**Assunto:**

- no imperativo, completando a frase "If applied, this commit will…": `add`, `fix`, `remove`, e não `added` nem
  `adds`;
- começa em minúscula e não termina com ponto;
- o cabeçalho inteiro tem até 72 caracteres;
- diz o que muda para quem lê o histórico. Não valem `update files`, `fix bug`, `changes`, `wip`, `review` nem
  `misc`, e uma regra local do commitlint recusa esses assuntos (V-67).

**Corpo,** depois de uma linha em branco, quando o assunto não basta:

- explica o porquê e o que muda no comportamento, e não a lista de arquivos, que o diff já mostra;
- linhas de até 100 caracteres, o limite do lint; o ideal é quebrar perto de 72;
- vira lista com hífen quando são várias mudanças.

**Rodapés,** depois de outra linha em branco, no formato `Token: valor`:

- `Refs: F02-03`, com o identificador da issue do plano;
- `Closes #12`, quando houver issue no GitHub;
- `BREAKING CHANGE: <o que quebra e como migrar>`, junto com o `!` no cabeçalho (`fix(contract)!: ...`), quando
  a mudança quebra cliente. Isso só acontece em versão major, com o aviso de descontinuação antes
  ([`api-e-contrato.md`](api-e-contrato.md));
- `Co-Authored-By: <modelo> <noreply@anthropic.com>`, na última linha, quando um agente de IA trabalhou na
  mudança: nos commits dele direto no `develop` e no fim da descrição do pull request, que vira o commit do
  `develop` no squash. Os commits dos ramos das issues saem sem ela, porque, com a linha neles, o GitHub acrescenta
  na caixa do squash um bloco `---------` que repete o `Co-authored-by` (V-92). A mensagem do squash termina nos
  rodapés da descrição, com uma linha só de coautoria, e o agente confere isso pelo `viewerMergeBodyText` da API do
  GitHub antes de entregar o pull request.

**O tipo não decide a versão.** Quem decide é o changeset do pull request (veja Versões). O tipo e o `!` servem a
quem lê o histórico e a quem procura uma mudança.

**Um commit, uma ideia.** Refatoração fica separada de mudança de comportamento.

Exemplos:

```
feat(radius): order items by distance from the center
```

```
fix(queue): resume an interrupted job from the last saved batch

The lease expired while a batch was still writing, and the next worker
started the job from the beginning, duplicating rows.

Refs: F06-04
```

```
fix(contract)!: rename the error code MAX_ITEMS to LIMIT_EXCEEDED

BREAKING CHANGE: clients that check error.code for MAX_ITEMS must check
LIMIT_EXCEEDED. The old code was deprecated in 1.4.

Refs: F05-02
```

### Como o padrão é garantido

Nasce na primeira issue da F00, para todo commit de código já nascer no padrão:

- **commitlint** com a `@commitlint/config-conventional` (V-63) e quatro ajustes do projeto:
  - cabeçalho de até 72 caracteres, e não 100;
  - escopo em minúsculas com hífen (`scope-case: kebab-case`);
  - linha em branco antes do corpo e dos rodapés como erro, e não como aviso;
  - uma regra local que recusa os assuntos vagos da lista acima (V-67).
- **Hook `commit-msg` local,** com o husky, instalado pelo `prepare` no `pnpm install` (V-88). Uma mensagem fora do
  padrão nem vira commit. O hook se pula com `--no-verify`, e por isso a conferência da CI existe.
- **O título do pull request na CI,** pelo mesmo commitlint, bloqueando o merge. É a conferência que mais importa,
  porque no merge por squash o título vira o commit do `develop` (V-64, D-041). O próprio commitlint lê o título,
  sem action de terceiros. O bloqueio depende dos ramos protegidos, que no plano Free só existem em repositório
  público (V-66): até a abertura, na F00 (D-040), a falha aparece no pull request, mas não impede o merge.
- **O squash no GitHub** configurado para usar o título e a descrição do pull request (V-64). O título vira o
  cabeçalho do commit, e a descrição vira o corpo e os rodapés; o modelo do pull request termina com
  `Refs: Fxx-yy`. Por isso a descrição traz só o porquê e os rodapés, e nunca uma lista de conferência, que iria
  para o histórico.

## Ramos e pull requests

- **Dois ramos permanentes** (D-041): o `develop`, onde as issues se juntam, e o `main`, que recebe o `develop` no
  fim de cada fase. Os dois ficam sempre verdes, e os ramos das issues são curtos.
- **Uma issue, um ramo, um pull request.** O ramo nasce do `develop` atualizado **antes da primeira edição** e
  segue o [Conventional Branch 1.1.0](https://conventionalbranch.org/) (V-83): `<tipo>/<id>-<descrição>`, em
  minúsculas, com hífen entre as palavras e sem hífen repetido, no começo ou no fim.

  | Tipo       | Quando                                                         |
  | ---------- | -------------------------------------------------------------- |
  | `feat/`    | A issue entrega comportamento novo; é a maioria                |
  | `fix/`     | Corrige um comportamento errado                                |
  | `chore/`   | Tarefa sem código do produto: ferramentas, CI, documentação    |
  | `hotfix/`  | Correção urgente sobre o `main`, depois da primeira publicação |
  | `release/` | Preparação de uma versão, da F16 em diante                     |

  Exemplos: `feat/f02-03-radius-order`, `chore/f00-01-toolchain-and-commit-standard`.

- O título do pull request segue o padrão de commit (`feat(radius): order items by distance`), porque vira o
  commit do `develop`, e o identificador vai no rodapé `Refs: F02-03` da descrição. O pull request de quem vem de
  fora cita a issue do GitHub, `Refs: #12`, como diz o [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
- Pull request mesmo trabalhando sozinho: é onde a integração contínua roda e onde fica o registro da mudança. O
  modelo do pull request pede o porquê e o `Refs:`; a lista "Pronto quer dizer" do [`README.md`](README.md) é
  conferida pela CI e pela revisão, e não entra na descrição.
- **Merge por squash no `develop`,** com a mensagem no padrão Conventional Commits, para ele ficar com um commit
  por issue.
- **Do `develop` para o `main`, merge commit,** num pull request no fim da fase, com a tag da fase no `main`
  (`f00-done`). É o único merge commit do projeto: o squash e o rebase fariam os dois ramos divergirem.
- Os dois ramos são protegidos desde a abertura do repositório, na F00 (D-040): sem push direto, com a
  integração contínua e o título do pull request obrigatórios, e com o tipo de merge fixado em cada um (P-23).
- **Nenhum dos dois recebe push forçado.** No GitHub, o histórico reescrito continua visível pelo hash e na página
  Activity (V-78); o que entrou se corrige com um commit novo, ou com `revert`.

## Integração contínua

GitHub Actions desde a F00, crescendo com as fases:

| Etapa                                                                                                 | Entra na         | Roda                                                                            |
| ----------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| Formatação, lint (com o `no-cycle` do `import-x`), tipos, Knip e unitários                            | F00              | A cada push                                                                     |
| Cobertura: a do diff pelo Codecov, e a catraca da total pelo Vitest                                   | F00              | A cada push                                                                     |
| Análise do SonarQube Cloud, com o quality gate no pull request                                        | F00              | A cada push                                                                     |
| `gitleaks`, `pnpm audit`, OSV-Scanner e o zizmor nos workflows                                        | F00              | A cada push                                                                     |
| Título do pull request no padrão de commit (commitlint)                                               | F00              | Em pull request, bloqueando o merge desde a abertura                            |
| Integração no PostGIS (a versão mínima) e no SQLite, no Directus 11.17 e no 12, um job por combinação | F00              | A cada push                                                                     |
| O PostGIS na versão mais nova                                                                         | F00              | Toda noite                                                                      |
| CodeQL, secret scanning e Scorecard                                                                   | F00, na abertura | Pelo GitHub, e o Scorecard num workflow a cada push no ramo padrão, o `develop` |
| Paridade de permissão, contrato da API, lint do OpenAPI                                               | F02              | A cada push                                                                     |
| As camadas do motor no lint (zonas do `import-x`)                                                     | F02              | A cada push                                                                     |
| Build sem código do `@directus/api`, e o aviso de licenças de terceiros gerado                        | F02              | A cada push                                                                     |
| Mutação no módulo de permissões; canário                                                              | F02              | Toda noite; a cada versão nova do Directus                                      |
| Peso do arquivo inicial de extensões (`size-limit`)                                                   | F04              | A cada push                                                                     |
| Ponta a ponta curto: o mapa abre, o tile chega, o drawer abre, o axe passa                            | F04              | Em pull request que toca a interface, bloqueando o merge                        |
| Ponta a ponta completo, com Playwright e axe                                                          | F04              | Toda noite e antes da release                                                   |
| Matriz inteira de bancos                                                                              | F15              | Toda noite e antes da release                                                   |
| Publicação no npm com provenance, e o SBOM                                                            | F16              | Na release                                                                      |

Até a abertura, os minutos das Actions são uma cota (V-77), e o Codecov aceita 250 envios por mês (V-70); por
isso o pull request roda o conjunto mínimo, com a cobertura num envio só, e a noite, o resto. Depois da abertura,
os runners padrão são grátis, e a divisão entre pull request e noite fica pelo tempo de espera.

Os workflows ficam em `.github/workflows/`:

- **`ci.yml`**, a cada push e pull request do `develop` e do `main`: a verificação do `pnpm check`, sem a integração;
  a integração, com um job por combinação, na lista que o `node test/combinations.ts` imprime; o `gitleaks` sobre o
  histórico inteiro; o `pnpm audit` e o OSV-Scanner; e o zizmor. Um push novo num pull request cancela a rodada
  anterior.
- **`pr-title.yml`**, em pull request: o título pelo commitlint, de novo a cada edição, sem rodar o resto.
- **`nightly.yml`**, às 03:00 de São Paulo e à mão (`workflow_dispatch`): chama o `ci.yml` com as combinações da
  noite, que acrescentam o PostGIS mais novo.

As regras dos workflows:

- Toda action fixada pelo commit da tag, com a tag num comentário, e toda imagem pelo digest; o workflow do próprio
  repositório pelo `$/`, que o GitHub trata como fixado (V-129).
- `permissions: contents: read` no workflow, e o checkout sem guardar a credencial (`persist-credentials: false`).
- Um valor de fora, como o título do pull request, entra no script só por variável de ambiente, nunca por `${{ }}`.
- O segredo `DIRECTUS_LICENSE_KEY` vai só para o job do Directus 12 com PostGIS (D-044), e um pull request de fork,
  que não recebe segredos, roda o 12 no Core.
- Uma ferramenta que pode passar sem ter olhado nada falha fechada: o passo do `gitleaks` reprova o job com um erro
  no log ou nenhum commit varrido (V-127).
- O zizmor não aponta nada em nenhuma persona; para conferir antes do push, ele roda pela imagem fixada.

## Revisão

- Antes de pedir revisão (do mantenedor, de um agente ou de si mesmo), ler o próprio diff inteiro.
- A revisão procura, nesta ordem: dado escapando da regra de ouro, comportamento errado, falta de teste, promessa da
  arquitetura quebrada e legibilidade. Estilo é trabalho do lint.

## Versões

- Versionamento semântico com Changesets, como no Directus (V-59). Cada pull request que muda o que o usuário vê
  leva um changeset, e a release gera o CHANGELOG e as versões dos dois pacotes: a extensão e o SDK.
- O `host` do pacote segue a D-037, e todo release precisa valer para a faixa inteira, porque o Marketplace só
  oferece a última versão (V-34).
- A primeira publicação é a da F16, com a extensão completa.
