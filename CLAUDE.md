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
- F00-01 feita em 25/09/2026: o pnpm passou para o 12, sem o Corepack, o TypeScript 7 entrou na raiz, e as P-20,
  P-21 e P-24 viraram fato (V-84 a V-93, P-25). O lockfile ficou num documento só, e o GitHub lê as dependências.
- F00-02 feita em 25/09/2026: o `pnpm check` confere formatação, lint, tipos, Knip e testes. O lint é o ESLint, com
  a API do TypeScript 6 lado a lado até a P-25, no nível estrito, e nenhum comentário desliga regra (V-94 a V-102).
- F00-03 feita em 25/09/2026: o bundle responde em `/geospatial/capabilities`. Os pacotes `extension` e `contract`
  nasceram, com o contrato primeiro, e o `sdk` fica para a F02. Só quem tem sessão lê a rota, e só o admin vê o
  banco (D-042). As imagens oficiais do Directus não trazem a SpatiaLite (V-104, V-103 a V-108).
- F00-04 feita em 25/09/2026: o `pnpm dev` sobe o Directus 12, o PostGIS e o Redis de `dev/`, só em `127.0.0.1`, com a
  extensão em modo watch e recarregando sem reiniciar o container. O `dev/.env.example` deixa os segredos vazios, e o
  `pnpm dev` os gera. O `/server/health` do Directus 12 pede sessão, e o ambiente espera pelo ping (V-109 a V-112).
- F00-05 feita em 26/09/2026: o `pnpm test:integration` sobe o PostGIS 3.2 e o Directus 11.17.4 em containers e
  prova a Maria e a união das políticas, com a cobertura de dentro do Directus somada à dos unitários. O Directus 12
  sem chave não aceita regra por linha, e a chave do Open Innovation Grant entra na F00-06 (D-043, V-113 a V-118).
- F00-06 feita em 26/09/2026: a suíte roda também no Directus 12.4.1 licenciado, em paralelo com o 11.17, e a
  variável `INTEGRATION` escolhe a combinação. A ativação dos testes se prende a um `project_id` que o servidor de
  licenças escolheu, sem banco base, e o `pnpm dev` recebe a chave pelo Studio. Sem a chave, o 12 roda no Core
  (D-044, V-119, V-120).
- F00-07 feita em 26/09/2026: o SQLite com a SpatiaLite entra nas duas versões do Directus e fecha as quatro
  combinações da suíte. O Directus nunca carrega a SpatiaLite, e a imagem de teste a carrega em cada conexão, por uma
  pré-carga do Node. O 12 com SQLite roda no Core, e os filtros espaciais do Directus não valem num campo
  `geometry.Point` (V-121 a V-123).
- F00-08 feita em 26/09/2026: com o banco fora, o `capabilities` falha fechado, com o `GEOSPATIAL_DATABASE_UNAVAILABLE`
  e a causa só no log, e volta quando o banco volta. Os códigos da extensão levam o prefixo `GEOSPATIAL_` (D-045). O
  Directus mostra ao admin a mensagem de um erro que não é dele e carrega uma extensão fora do `host` sem aviso
  (V-124, V-125).
- F00-09 feita em 26/09/2026: o GitHub Actions confere cada push e pull request do `develop` e do `main`, com a
  integração num job por combinação, o gitleaks, o `pnpm audit`, o OSV-Scanner e o zizmor, e o título do pull
  request pelo commitlint. A noite acrescenta o PostGIS mais novo e roda pela primeira vez depois do merge, porque o
  GitHub só agenda o que está no ramo padrão. A chave do 12 ativa no runner, e o gitleaks passava sem varrer nada
  (V-126 a V-130).
- F00-12 feita em 27/09/2026: o repositório passou pelo portão de abertura, com o `SECURITY.md`, o `CONTRIBUTING.md`,
  o código de conduta (Contributor Covenant 3.0) e os modelos de issue, e o README diz que a extensão está em
  desenvolvimento. As denúncias de conduta vão pelo relato privado do GitHub até existir o e-mail do projeto, antes
  da F16. A abertura passou para antes da cobertura e das dependências (D-040), e o relato privado de
  vulnerabilidade do GitHub só existe no repositório público (V-131 a V-133).
- F00-13 feita em 27/09/2026: o repositório está público. O `develop` e o `main` têm rulesets, versionados em
  `.github/rulesets/`: sem push direto nem forçado, com os jobs da CI e o título obrigatórios, só squash no `develop`
  e só merge commit no `main`, e ninguém na exceção, então toda mudança, também a só de docs, entra por pull request.
  O CodeQL, o secret scanning com a proteção de push e o relato privado estão ligados, e o Scorecard publica a nota
  no README, ao lado do badge de CI (V-134 a V-136).
- Próximo passo: `/implement-issue F00-10`, a cobertura do diff e o quality gate, já com o repositório público.

## Documentação

| Arquivo                                      | Papel                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [CONTEXT.md](CONTEXT.md)                     | Glossário do domínio, com o termo em português e o canônico em inglês                               |
| [docs/arquitetura.md](docs/arquitetura.md)   | O desenho: o que a extensão faz e como                                                              |
| [docs/decisoes.md](docs/decisoes.md)         | As decisões D-0xx; as portas de mão única ficam no topo. Não existe `docs/adr/`                     |
| [docs/verificacoes.md](docs/verificacoes.md) | Fatos verificados em ferramentas de terceiros (V-xx) e pendências (P-xx)                            |
| `../directus-extension-geospatial-plan/`     | Plano por fases, issues, especificações, achados e histórico, num repositório privado do mantenedor |
| [docs/padroes/](docs/padroes/README.md)      | Padrões de código e de testes, e o que "Pronto quer dizer"                                          |

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
  - a coautoria do agente, `Co-Authored-By: <modelo> <noreply@anthropic.com>`, com o nome do modelo da sessão, é a última linha da descrição do pull request, que vira o commit do `develop` no squash. Os commits dos ramos das issues saem sem ela: com a linha neles, o GitHub acrescenta na caixa do squash um bloco `---------` que repete o `Co-authored-by` (V-92). A mensagem do squash termina nos rodapés da descrição, `Refs:` e `Co-Authored-By:`, com uma linha só de coautoria, e o agente confere isso pelo `viewerMergeBodyText` da API do GitHub antes de entregar o pull request. No repositório do plano, sem coautoria;
  - ramos (D-041): cada issue num ramo a partir do `develop` atualizado, criado **antes da primeira edição**, com o nome no padrão de mercado de [docs/padroes/git-e-entrega.md](docs/padroes/git-e-entrega.md) (`<tipo>/<id>-<descrição>`); o pull request volta para o `develop` com squash, e o `develop` vai para o `main` no fim de cada fase;
  - mensagens em inglês, no padrão Conventional Commits, com as regras de [docs/padroes/git-e-entrega.md](docs/padroes/git-e-entrega.md);
  - **o que o agente faz sozinho:** commit nos dois repositórios; criar o ramo de cada issue; push no ramo da issue e no `main` do plano; abrir o pull request para o `develop`. Tudo entra no `develop` por pull request, também a mudança só de docs ou de processo, que vai num ramo `chore/`: desde a abertura, o ruleset recusa o push direto de qualquer um (D-041);
  - **o que fica com o mantenedor:** o merge dos pull requests no `develop`, depois da revisão, e tudo o que vai para o `main` do produto. O agente nunca toca o `main` do produto: nem push, nem pull request, nem tag;
  - nunca push forçado nem reescrita de histórico (V-78);
  - antes de cada push, o agente lê o diff inteiro, procurando segredo, dado pessoal e arquivo que não devia ir.
- **Comandos no ambiente** só com confirmação, dizendo o que o comando faz e como desfazer: instalar algo no sistema, Docker fora dos testes, bancos fora dos containers de teste, publicar no npm.
- **Skills** do projeto em `.claude/skills`.
