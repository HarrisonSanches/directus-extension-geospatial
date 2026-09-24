# Git e entrega

**Commits e pushes são sempre do mantenedor.** Agentes sugerem a mensagem; não executam.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/), em inglês: `feat(radius): order items by
  distance`, `fix(tiles): ...`, `test(permissions): ...`, `docs: ...`.
- Assunto no imperativo, com até ~72 caracteres; o corpo explica o porquê.
- **Nunca** uma linha de coautoria de Claude ou de qualquer IA (`Co-Authored-By`), em nenhum commit.
- Um commit, uma ideia. Refatoração fica separada de mudança de comportamento.

## Ramos e pull requests

- Desenvolvimento baseado no tronco: o `main` sempre verde, e ramos curtos.
- **Uma issue, um ramo, um pull request.** O ramo leva o identificador da issue (`f02-03/radius-order`), e o título
  do pull request começa por ele (`F02-03: radius natural order`).
- Pull request mesmo trabalhando sozinho: é onde a integração contínua roda e onde fica o registro da mudança. O
  modelo do pull request traz a lista "Pronto quer dizer" do [`README.md`](README.md).
- Merge por squash, com a mensagem no padrão Conventional Commits, para o `main` ficar com um commit por issue.
- O `main` é protegido: sem push direto, e com a integração contínua obrigatória.

## Integração contínua

GitHub Actions desde a F00, crescendo com as fases:

| Etapa | Entra na | Roda |
|---|---|---|
| Formatação, lint, tipos, unitários, cobertura do código novo | F00 | A cada push |
| `gitleaks`, `pnpm audit`, OSV-Scanner | F00 | A cada push |
| Integração no PostGIS e no SQLite, no Directus 11.17 e no 12, um job por combinação | F00 | A cada push |
| Paridade de permissão, contrato da API, lint do OpenAPI | F02 | A cada push |
| Mutação no módulo de permissões; canário | F02 | Toda noite; a cada versão nova do Directus |
| Peso do arquivo inicial de extensões (`size-limit`) | F04 | A cada push |
| Ponta a ponta com Playwright e axe | F04 | Em pull request que toca a interface, sem bloquear; toda noite |
| Matriz inteira de bancos | F15 | Toda noite e antes da release |
| Publicação no npm com provenance, e o SBOM | F16 | Na release |

## Revisão

- Antes de pedir revisão (do mantenedor, de um agente ou de si mesmo), ler o próprio diff inteiro.
- A revisão procura, nesta ordem: dado escapando da regra de ouro, comportamento errado, falta de teste, promessa da
  arquitetura quebrada e legibilidade. Estilo é trabalho do lint.

## Versões

- Versionamento semântico com Changesets, como no Directus (V-59). Cada pull request que muda o que o usuário vê
  leva um changeset, e a release gera o CHANGELOG e as versões dos dois pacotes: a extensão e o SDK.
- O `host` do pacote acompanha a D-018, e todo release precisa valer para as duas majors suportadas, porque o
  Marketplace só oferece a última versão (V-34).
- A primeira publicação é a da F16, com a extensão completa.
