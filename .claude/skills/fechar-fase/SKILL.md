---
name: fechar-fase
description: Fecha uma fase do plano do directus-extension-geospatial. Confere o critério de saída e as issues, escreve o "Como terminou" e a entrada do histórico, atualiza o índice e detalha a próxima fase. Use quando todas as issues de uma fase estiverem feitas, ou quando o mantenedor pedir para fechar a fase.
argument-hint: '<fase, ex.: F00>'
---

# Fechar uma fase

Fase: **$ARGUMENTS**, ou a que está "em andamento" no índice `../directus-extension-geospatial-plan/README.md`.

O plano fica num repositório privado, clonado ao lado deste em `../directus-extension-geospatial-plan/`. Se a pasta não existir, pare e avise o mantenedor.

**Git pelas regras do `CLAUDE.md`:** você faz os commits do fechamento e o push no `main` do plano e, no produto, num ramo `chore/` com pull request para o `develop`, que o mantenedor mergeia antes da promoção. **A promoção para o `main` do produto e a tag são do mantenedor:** você só prepara o texto do pull request. As mensagens seguem o padrão de `docs/padroes/git-e-entrega.md`: no produto, os commits do ramo saem sem coautoria, e a descrição do pull request termina com ela; no repositório do plano, sem coautoria.

## 1. Conferir, e parar se algo faltar

- **Issues:** todas as de `../directus-extension-geospatial-plan/issues/fNN.md` estão "feitas"? Se alguma estiver aberta, pare e diga qual.
- **Critério de saída da fase:** confira cada item do arquivo da fase de verdade, rodando o comando ou o teste, sem confiar na caixa marcada. Reporte ✅ ❌ ⏸️.
- **Ensaios de falha da fase:** estão passando, e já automatizados quando `docs/padroes/testes.md` diz que deveriam estar.
- **"Pronto quer dizer"** (`docs/padroes/README.md`) vale para o conjunto:
  - verificação completa verde;
  - matriz de bancos verde no último pull request, nos bancos que a fase tocou;
  - cobertura dentro das regras da D-017.
- **Matriz de capacidades:** a linha de cada operação que a fase entregou está declarada para cada banco e coberta pelos testes de contrato (D-002).
- **Pendências:** as `P-xx` que a fase precisava resolver viraram `V-xx` em `docs/verificacoes.md`, ou têm consequência decidida.
- **Achados abertos** da fase: resolvidos, ou com consequência decidida.
- **Sugestões anotadas** nos achados abertos e nas issues que ainda não foram feitas (as linhas "Sugestão da Fxx-yy"): cada uma decidida pelo mantenedor, que a transforma em issue, a põe numa issue existente ou a descarta com o motivo, ou levada de propósito para a próxima fase.
- **Documentação pública:** o README e o site cobrem o que a fase mudou para quem usa.

Se houver ❌, **não feche**. Liste o que falta e pergunte se isso vira issue nova ou mudança de plano (achado).

## 2. Registrar

1. **Arquivo da fase:** estado "concluída" no cabeçalho e um bloco final `## Como terminou`, com até 10 linhas: o que ficou diferente do planejado (com os achados) e o que a próxima fase precisa saber.
2. **`../directus-extension-geospatial-plan/historico.md`:** uma entrada no topo, no modelo do arquivo, com até 15 linhas:
   - o que foi entregue;
   - o critério de saída e os ensaios;
   - as **medições, com números e unidades** (tempos de tile, benchmarks, tempo de criação de índice);
   - achados, decisões e commits.
3. **Índice** `../directus-extension-geospatial-plan/README.md`: estado da fase "concluída", a próxima "em andamento" e a seção "Estado atual". Atualize também a seção "Estado" do `CLAUDE.md`.
4. **Arquitetura e decisões:** se a fase mostrou que algo nelas deixou de ser verdade, aponte o trecho ao mantenedor, sem editar sem a aprovação dele.

## 3. Preparar a próxima

Pelo detalhamento progressivo, a fase seguinte à próxima ganha agora os passos detalhados. Proponha esses passos ao mantenedor, levando em conta o que esta fase ensinou, e escreva no arquivo dela depois do "ok".

## 4. Reportar

- O que a fase entregou, em cinco linhas, e os números.
- Os conceitos centrais da fase, explicados passo a passo na conversa, de forma didática e breve.
- Os commits do fechamento feitos e enviados, um em cada repositório que mudou (o do plano e o do produto).
- A promoção da fase (D-041), pronta para o mantenedor: o título do pull request do `develop` para o `main`, no padrão de commit (por exemplo, `chore: promote F00 to main`), a descrição, e a tag da fase (por exemplo, `f00-done`). Ele abre o pull request, faz o merge commit e cria a tag.
- O próximo comando: `/to-issues <próxima fase>`.
