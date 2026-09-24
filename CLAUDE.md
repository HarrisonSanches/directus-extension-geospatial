# directus-extension-geospatial

Extensão para o Directus que transforma o Studio num painel geoespacial operacional: operações espaciais no banco (PostGIS como referência), expostas no Studio (layout, módulo e painel), na API, no SDK e nos Flows, e relatórios de evidências em PDF. O desenho está em [docs/arquitetura.md](docs/arquitetura.md).

## Estado

- Planejamento concluído em 23/09/2026.
- Questionamento da documentação (skill `grill-with-docs`) concluído em 24/09/2026: decisões D-022 a D-034, fatos V-44 a V-58 e pendências P-12 a P-14.
- Próximo passo: escrever o plano de implementação em fases, em `docs/implementacao/`, e começar a implementar.

## Documentação

| Arquivo | Papel |
|---|---|
| [CONTEXT.md](CONTEXT.md) | Glossário do domínio, com o termo em português e o canônico em inglês |
| [docs/arquitetura.md](docs/arquitetura.md) | O desenho: o que a extensão faz e como |
| [docs/decisoes.md](docs/decisoes.md) | As decisões D-0xx; as portas de mão única ficam no topo. Não existe `docs/adr/` |
| [docs/verificacoes.md](docs/verificacoes.md) | Fatos verificados em ferramentas de terceiros (V-xx) e pendências (P-xx) |
| `docs/implementacao/` | Plano por fases, issues, especificações, achados e histórico (nasce com o plano de implementação) |
| `docs/padroes/` | Padrões de código e de testes, e o que "Pronto quer dizer" (nasce com o plano de implementação) |

## Idioma

- Conversa, documentação interna (`docs/`, `CONTEXT.md`) e skills: português do Brasil.
- Código, identificadores, mensagens de commit e documentação pública (README, site): inglês.

## Como trabalhar neste projeto

- Um passo de cada vez, uma decisão por vez, sempre com uma recomendação.
- Explicações didáticas e passo a passo na conversa, ao entregar algo novo ou quando o mantenedor pedir. Não existe guia didático em arquivo.
- O desenho é sempre o da extensão completa, sem recortes de "primeira versão". A ordem só aparece no plano de implementação.
- Pesquisas curtas e focadas. Uma afirmação sobre ferramenta de terceiros se confere no código-fonte ou na documentação oficial e vai para `docs/verificacoes.md`.

## Regras

- **Princípios** em [arquitetura §2](docs/arquitetura.md#2-princípios). A regra de ouro das permissões é a D-001, e uma porta de mão única nunca muda sem uma decisão nova.
- **Git:**
  - nunca adicione Claude ou qualquer IA como coautor; sem linha `Co-Authored-By`, em nenhum commit;
  - mensagens em inglês, no padrão Conventional Commits;
  - commit e push só quando o mantenedor pedir.
- **Comandos no ambiente** só com confirmação, dizendo o que o comando faz e como desfazer: instalar algo no sistema, Docker fora dos testes, bancos fora dos containers de teste, publicar no npm, push.
- **Skills** do projeto em `.claude/skills`.
