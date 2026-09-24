# directus-extension-geospatial

Extensão para o Directus que transforma o Studio num painel geoespacial operacional: operações espaciais no banco (PostGIS como referência), expostas no Studio (layout, módulo e painel), na API, no SDK e nos Flows, e relatórios de evidências em PDF. O desenho está em [docs/arquitetura.md](docs/arquitetura.md).

## Estado

- Planejamento concluído em 23/09/2026.
- Questionamento da documentação (skill `grill-with-docs`) concluído em 24/09/2026: decisões D-022 a D-034, fatos V-44 a V-58 e pendências P-12 a P-14.
- Plano de implementação criado em 24/09/2026, com 18 fases (F00 a F17), em [docs/implementacao/](docs/implementacao/README.md).
- Padrões de desenvolvimento criados em 24/09/2026, em [docs/padroes/](docs/padroes/README.md).
- Revisão geral em 24/09/2026: decisões D-035 a D-039 (a D-037 substitui a D-018) e fatos V-59 a V-61.
- Próximo passo: `/to-issues F00`.

## Documentação

| Arquivo | Papel |
|---|---|
| [CONTEXT.md](CONTEXT.md) | Glossário do domínio, com o termo em português e o canônico em inglês |
| [docs/arquitetura.md](docs/arquitetura.md) | O desenho: o que a extensão faz e como |
| [docs/decisoes.md](docs/decisoes.md) | As decisões D-0xx; as portas de mão única ficam no topo. Não existe `docs/adr/` |
| [docs/verificacoes.md](docs/verificacoes.md) | Fatos verificados em ferramentas de terceiros (V-xx) e pendências (P-xx) |
| [docs/implementacao/](docs/implementacao/README.md) | Plano por fases, issues, especificações, achados e histórico |
| [docs/padroes/](docs/padroes/README.md) | Padrões de código e de testes, e o que "Pronto quer dizer" |

## Idioma

- Conversa, documentação interna (`docs/`, `CONTEXT.md`) e skills: português do Brasil.
- Código, identificadores, mensagens de commit e documentação pública (README, site): inglês.

## Como trabalhar neste projeto

- **O mantenedor** é quem conduz o trabalho com o agente: aprova, decide e faz commit e push. É o nome usado nas skills e nos docs.
- Preferências pessoais de quem trabalha no projeto ficam no `CLAUDE.local.md`, que não vai para o Git.
- Um passo de cada vez, uma decisão por vez, sempre com uma recomendação.
- Explicações didáticas e passo a passo na conversa, ao entregar algo novo ou quando o mantenedor pedir. Não existe guia didático em arquivo.
- O desenho é sempre o da extensão completa, sem recortes de "primeira versão". A ordem só aparece no plano de implementação.
- Cada proposta traz a prática consagrada do mercado, pelo nome e com o porquê.
- Pesquisas curtas e focadas: poucas perguntas por agente, com resposta em minutos. Uma afirmação sobre ferramenta de terceiros se confere no código-fonte ou na documentação oficial e vai para `docs/verificacoes.md`.
- Texto comercial (frase de impacto, landing, topo do README) vende o que a pessoa ganha e nunca fala de banco nem do funcionamento interno, que ficam no corpo do texto. Numa frase de impacto, ofereça três ou quatro opções com uma recomendação, e o mantenedor escolhe.

## Regras

- **Princípios** em [arquitetura §2](docs/arquitetura.md#2-princípios). A regra de ouro das permissões é a D-001, e uma porta de mão única nunca muda sem uma decisão nova.
- **Git:**
  - nunca adicione Claude ou qualquer IA como coautor; sem linha `Co-Authored-By`, em nenhum commit;
  - mensagens em inglês, no padrão Conventional Commits;
  - commit e push só quando o mantenedor pedir.
- **Comandos no ambiente** só com confirmação, dizendo o que o comando faz e como desfazer: instalar algo no sistema, Docker fora dos testes, bancos fora dos containers de teste, publicar no npm, push.
- **Skills** do projeto em `.claude/skills`.
