---
name: implement-issue
description: Implementa uma issue do directus-extension-geospatial (ex.: F00-03) a partir das issues do repositório do plano, com testes primeiro, explicação passo a passo na conversa e os critérios de aceite conferidos um a um. Use quando o mantenedor pedir para implementar uma issue.
argument-hint: "<issue, ex.: F00-03>"
---

# Implementar uma issue

Issue pedida: **$ARGUMENTS** (ex.: `F00-03`). O arquivo é `../directus-extension-geospatial-plan/issues/fNN.md`, com o número da fase da própria issue.

O plano fica num repositório privado, clonado ao lado deste em `../directus-extension-geospatial-plan/`. Se a pasta não existir, pare e avise o mantenedor.

**Git pelas regras do `CLAUDE.md`:** você cria o ramo da issue, faz os commits, dá push no ramo e abre o pull request para o `develop`. O merge é do mantenedor, e o `main` do produto nunca é tocado. As mensagens seguem `docs/padroes/git-e-entrega.md`. A coautoria, `Co-Authored-By: <modelo> <noreply@anthropic.com>`, com o nome do modelo desta sessão, é a última linha da descrição do pull request, e os commits do ramo saem sem ela: com a linha neles, o GitHub repete o `Co-authored-by` na caixa do squash (V-92).

## Ler antes (uma vez)

1. `CLAUDE.md` e `CONTEXT.md`.
2. A issue inteira: o que construir, critérios de aceite, testes, "toca em", conceitos novos e "perguntar antes".
3. O arquivo da fase: objetivo, escopo e o que ele diz sobre esta parte. Das fases anteriores, só títulos e objetivos. Das posteriores, nada.
4. As decisões, verificações e pendências citadas em "toca em", e as seções da `docs/arquitetura.md` que elas indicam.
5. Os padrões que a issue toca, em `docs/padroes/`.

## Antes de editar

- **Ramo primeiro.** Confira em que ramo o repositório está (`git branch --show-current`). Se não for o ramo desta issue, **pare antes de qualquer edição**:
  - recomende o nome no padrão de mercado de `docs/padroes/git-e-entrega.md` (Conventional Branch, `<tipo>/<id>-<descrição>`, como `feat/f02-03-radius-order`);
  - crie o ramo a partir do `develop` atualizado, `git switch develop && git pull && git switch -c <ramo>`, e diga o nome ao mantenedor;
  - nunca edite no `develop` nem no `main`.
- **Já está feita?** Se todos os critérios de aceite já valem no repositório, reporte com ✅ em cada um e pare.
- **Pré-requisitos:** as issues de "bloqueada por" estão feitas no repositório? Se não, **pare e pergunte**. Não conserte issue anterior por conta própria.
- **Contradição** entre issue, fase, arquitetura, decisão ou código: **pare e pergunte**. Não improvise design. Uma porta de mão única nunca muda sem uma decisão nova.
- Mostre ao mantenedor um plano curto, em passos pequenos, antes de começar. Numa issue HITL, espere o "ok".
- Marque a issue como "em andamento" na tabela do arquivo de issues.

## Durante

- **Contrato primeiro:** o OpenAPI da rota (D-016), os tipos, as mudanças nas coleções da extensão e a linha da matriz de capacidades de cada banco (D-002). Depois, o código.
- **Teste primeiro na regra de domínio**, no ciclo da skill `tdd`: um teste, o código mínimo, o próximo teste.
  - Nada de mock de banco nem de Directus: eles rodam de verdade em containers.
  - O relógio é injetado em tudo o que depende de tempo.
- **A regra de ouro (D-001) não se negocia.** Todo dado devolvido sai da query permitida montada pelo Directus. Se a issue devolve dados, ela tem teste de paridade de permissão com o `/items`.
- **Comandos no ambiente** (instalar algo no sistema, Docker fora dos testes, bancos fora dos containers de teste, publicar no npm) só com confirmação explícita do mantenedor, pedida na hora, dizendo o que o comando faz e como desfazer.
- **Siga o que o repositório já faz** (nomes, organização, estilo) e o que está em `docs/padroes/`.
- **Afirmação sobre ferramenta de terceiros** (Directus, PostGIS, MapLibre, bancos, bibliotecas) se confere no código-fonte ou na documentação oficial. O fato relevante vai para `docs/verificacoes.md` como `V-xx`; uma pendência confirmada deixa de ser `P-xx` e vira `V-xx`.
- **Fora do escopo da issue, não mexa**, mesmo que veja algo errado. Anote em "sugestões".

## Explicar na conversa (parte da entrega, não opcional)

Ao entregar, explique passo a passo, de forma didática e breve:

- o que foi feito;
- os conceitos novos da issue, do zero;
- como o código funciona, com links para arquivo e linha;
- por que foi feito assim, com as decisões que isso segue;
- **veja você mesmo:** como ver funcionando e como quebrar de propósito para o teste falhar.

Não existe guia didático em arquivo. A documentação pública (README, site) só muda quando a issue muda algo que o usuário vê.

## Conferir

- A verificação completa do projeto, definida em `docs/padroes/README.md` (formatação, lint, tipos, testes unitários e de integração). Mais o que a issue exigir: testes de ponta a ponta, um banco específico da matriz.
- A cobertura do código novo ou alterado, com o mínimo de 90% (D-017).
- Cada critério de aceite: ✅ passou · ❌ falhou · ⏸️ não dá para testar agora (e por quê).
- Com algum ❌, a issue **não** está feita.

## Registrar

- Estado da issue na tabela: "feita" só com todos os critérios ✅ e a lista "Pronto quer dizer" de `docs/padroes/README.md` valendo.
- Surpresa, inviabilidade ou mudança no que a issue pedia viram uma entrada em `../directus-extension-geospatial-plan/achados.md`. Se a mudança alterar o plano, pergunte antes ao mantenedor e edite a fase junto com o achado.
- Decisão nova: pergunte ao mantenedor. Se ele aprovar, ela vira uma `D-0xx` em `docs/decisoes.md`.
- Não mexa em `historico.md`: ele é atualizado no fechamento da fase (skill `fechar-fase`).

## Reportar no fim

1. **Arquivos** criados e alterados, agrupados por pacote (extensão, SDK, documentação).
2. **Critérios de aceite**, um a um, com ✅ ❌ ⏸️ e uma nota.
3. **Resultado resumido** da verificação: passou ou falhou, contagens, cobertura do código novo e as primeiras linhas de erro.
4. **O que aprender aqui:** os conceitos novos em três ou quatro linhas.
5. **Decisões tomadas fora da issue**, se houve, e por quê.
6. **Sugestões** para a issue, a fase ou os padrões, sem editar por conta própria.
7. **O versionamento feito:** os commits no ramo, no padrão de `docs/padroes/git-e-entrega.md` e sem a linha de coautoria; o push, depois de ler o diff inteiro; e o pull request para o `develop`, com o título no mesmo padrão e a descrição terminando nos rodapés `Refs: <issue>` e `Co-Authored-By:`. Confira pelo `viewerMergeBodyText` da API do GitHub que a caixa do squash termina nesses dois rodapés, com uma linha só de coautoria. Dê o link dele. Se o plano mudou (o estado da issue, um achado), também o commit e o push no repositório do plano, sem coautoria.

**Não avance para a próxima issue nem faça o merge.** Espere o mantenedor revisar e pedir.
