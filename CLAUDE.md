# directus-extension-geospatial

Extensão para o Directus que transforma o Studio num painel geoespacial operacional: operações espaciais no banco (PostGIS como referência), expostas no Studio (layout, módulo e painel), na API, no SDK e nos Flows, e relatórios de evidências em PDF. O desenho está em [docs/arquitetura.md](docs/arquitetura.md).

## Estado

- Planejamento concluído em 23/09/2026.
- Questionamento da documentação (skill `grill-with-docs`) concluído em 24/09/2026: decisões D-022 a D-034, fatos V-44 a V-58 e pendências P-12 a P-14.
- Plano de implementação criado em 24/09/2026, com 18 fases (F00 a F17).
- Padrões de desenvolvimento criados em 24/09/2026, em [docs/padroes/](docs/padroes/README.md).
- Revisão geral em 24/09/2026: decisões D-035 a D-039 (a D-037 substitui a D-018) e fatos V-59 a V-61.
- Ferramentas de qualidade e segurança escolhidas em 25/09/2026: decisão D-040 (o repositório abre no fim da F00), achado A-001 e fatos V-66 a V-77.
- Plano de implementação movido em 25/09/2026 para o repositório privado `directus-extension-geospatial-plan`.
- F00 quebrada em 13 issues em 25/09/2026, no repositório do plano, com o Node 24 nas ferramentas e o pnpm mantido (V-79 a V-82).
- Fluxo de ramos com o `develop` em 25/09/2026 (D-041), e coautoria do agente nos commits do produto.
- F00-01 no `develop` em 25/09/2026: o pnpm passou para o 12, sem o Corepack, o TypeScript 7 entrou na raiz, e as
  P-20, P-21 e P-24 viraram fato (V-84 a V-93, P-25). O lockfile ficou num documento só, para o GitHub ler as
  dependências.
- Próximo passo: o merge da correção do lockfile, a conferência do SBOM no `develop`, e depois
  `/implement-issue F00-02`.

## Documentação

| Arquivo | Papel |
|---|---|
| [CONTEXT.md](CONTEXT.md) | Glossário do domínio, com o termo em português e o canônico em inglês |
| [docs/arquitetura.md](docs/arquitetura.md) | O desenho: o que a extensão faz e como |
| [docs/decisoes.md](docs/decisoes.md) | As decisões D-0xx; as portas de mão única ficam no topo. Não existe `docs/adr/` |
| [docs/verificacoes.md](docs/verificacoes.md) | Fatos verificados em ferramentas de terceiros (V-xx) e pendências (P-xx) |
| `../directus-extension-geospatial-plan/` | Plano por fases, issues, especificações, achados e histórico, num repositório privado do mantenedor |
| [docs/padroes/](docs/padroes/README.md) | Padrões de código e de testes, e o que "Pronto quer dizer" |

## Idioma

- Conversa, documentação interna (`docs/`, `CONTEXT.md`) e skills: português do Brasil.
- Código, identificadores, mensagens de commit e documentação pública (README, site): inglês.

## Como trabalhar neste projeto

- **O mantenedor** é quem conduz o trabalho com o agente: aprova, decide, revisa os pull requests e faz o merge. É o nome usado nas skills e nos docs.
- Preferências pessoais de quem trabalha no projeto ficam no `CLAUDE.local.md`, que não vai para o Git.
- **O plano** mora num repositório privado, clonado ao lado deste, na mesma pasta. O Claude Code chega nele pelo `permissions.additionalDirectories` do `.claude/settings.local.json`, e as mudanças no plano viram commits lá, separados dos do produto.
- Um passo de cada vez, uma decisão por vez, sempre com uma recomendação.
- Explicações didáticas e passo a passo na conversa, ao entregar algo novo ou quando o mantenedor pedir. Não existe guia didático em arquivo.
- O desenho é sempre o da extensão completa, sem recortes de "primeira versão". A ordem só aparece no plano de implementação.
- Cada proposta traz a prática consagrada do mercado, pelo nome e com o porquê.
- Pesquisas curtas e focadas: poucas perguntas por agente, com resposta em minutos. Uma afirmação sobre ferramenta de terceiros se confere no código-fonte ou na documentação oficial e vai para `docs/verificacoes.md`.
- Texto comercial (frase de impacto, landing, topo do README) vende o que a pessoa ganha e nunca fala de banco nem do funcionamento interno, que ficam no corpo do texto. Numa frase de impacto, ofereça três ou quatro opções com uma recomendação, e o mantenedor escolhe.

## Regras

- **Princípios** em [arquitetura §2](docs/arquitetura.md#2-princípios). A regra de ouro das permissões é a D-001, e uma porta de mão única nunca muda sem uma decisão nova.
- **Git:**
  - nos commits do produto em que o agente trabalhou, a última linha é a coautoria dele, `Co-Authored-By: <modelo> <noreply@anthropic.com>`, com o nome do modelo da sessão, e ela vai também no fim da descrição do pull request, que vira o commit do `develop` no squash; no repositório do plano, sem coautoria;
  - ramos (D-041): cada issue num ramo a partir do `develop` atualizado, criado **antes da primeira edição**, com o nome no padrão de mercado de [docs/padroes/git-e-entrega.md](docs/padroes/git-e-entrega.md) (`<tipo>/<id>-<descrição>`); o pull request volta para o `develop` com squash, e o `develop` vai para o `main` no fim de cada fase;
  - mensagens em inglês, no padrão Conventional Commits, com as regras de [docs/padroes/git-e-entrega.md](docs/padroes/git-e-entrega.md);
  - **o que o agente faz sozinho:** commit nos dois repositórios; criar o ramo de cada issue; push no ramo da issue, no `develop` do produto e no `main` do plano; abrir o pull request para o `develop`. O código de uma issue entra no `develop` só pelo pull request; o push direto no `develop` é para mudança de docs e de processo;
  - **o que fica com o mantenedor:** o merge dos pull requests no `develop`, depois da revisão, e tudo o que vai para o `main` do produto. O agente nunca toca o `main` do produto: nem push, nem pull request, nem tag;
  - nunca push forçado nem reescrita de histórico (V-78);
  - antes de cada push, o agente lê o diff inteiro, procurando segredo, dado pessoal e arquivo que não devia ir.
- **Comandos no ambiente** só com confirmação, dizendo o que o comando faz e como desfazer: instalar algo no sistema, Docker fora dos testes, bancos fora dos containers de teste, publicar no npm.
- **Skills** do projeto em `.claude/skills`.
