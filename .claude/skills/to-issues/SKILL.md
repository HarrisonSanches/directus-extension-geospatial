---
name: to-issues
description: Quebra uma fase do plano do directus-extension-geospatial em issues pequenas, uma por pull request, salvas em issues/fNN.md, no repositório do plano. Use quando uma fase for começar, ou quando o mantenedor pedir para quebrar uma fase em tarefas.
argument-hint: "<fase, ex.: F00>"
---

# Quebrar uma fase em issues

Fase pedida: **$ARGUMENTS**. Se nada vier, use a fase marcada como "em andamento", ou a próxima "a fazer", no índice `../directus-extension-geospatial-plan/README.md`.

O plano fica num repositório privado, clonado ao lado deste em `../directus-extension-geospatial-plan/`. Se a pasta não existir, pare e avise o mantenedor.

**Não faça commit, não publique em rastreador de issues nenhum.** Só gere arquivos.

## 1. Ler, nesta ordem

1. `CLAUDE.md` e `CONTEXT.md`: regras e vocabulário. Os títulos e textos das issues usam os termos do glossário.
2. O arquivo da fase em `../directus-extension-geospatial-plan/fases/`.
3. As decisões e verificações que a fase cita em "Toca em", e as **portas de mão única** no topo de `docs/decisoes.md`.
4. `docs/padroes/README.md` ("Pronto quer dizer") e `docs/padroes/testes.md`.
5. O estado real do repositório: o que já existe e o que a fase anterior deixou.

**Se a fase ainda não tiver passos detalhados** (detalhamento progressivo), proponha os passos primeiro, peça aprovação ao mantenedor e só então quebre em issues. Registre os passos no arquivo da fase.

## 2. Esboçar as issues

Cada issue é **uma fatia fina que pode ser verificada sozinha**, do tamanho de um pull request que o mantenedor consiga revisar e entender de uma vez: tipicamente algumas centenas de linhas de diff, no máximo.

- **Fatia vertical quando houver camadas.** A issue atravessa tudo o que precisa para funcionar de ponta a ponta: contrato OpenAPI, motor no servidor, interface no Studio (quando houver), SDK, testes e documentação pública. Não vale separar "todos os tipos" numa issue e "toda a lógica" em outra.
- **Um banco por vez quando a fatia for de adaptador.** Primeiro o PostGIS, que é a referência (D-002); os outros bancos entram em issues próprias, cada uma com a linha da matriz de capacidades e os testes de contrato daquele banco.
- **Em fase de infraestrutura, a fatia é uma capacidade que dá para demonstrar.** "O Directus com a extensão sobe com um comando e responde em `/geospatial/capabilities`" é uma issue; "instalar o pnpm" não é.
- **Cada issue deixa o repositório melhor e verde**, nunca num estado quebrado esperando a próxima.
- **Muitas issues finas são melhores que poucas grossas.**
- **Tipo:**
  - **HITL** (com o mantenedor): pede decisão, revisão de design, ou um comando no ambiente que exige confirmação (instalar algo no sistema, Docker fora dos testes, publicar no npm).
  - **AFK** (autônoma): dá para implementar e deixar pronta para revisão sem interação.

  Prefira AFK. Toda issue que roda comando no ambiente é HITL.

## 3. Apresentar ao mantenedor

Mostre uma lista numerada com, para cada issue: identificador, título, tipo, bloqueios e uma linha do que ela entrega. Pergunte:

- A granularidade está boa, ou alguma issue deve ser dividida ou unida?
- As dependências estão certas?
- Os tipos HITL e AFK estão certos?

Itere até ele aprovar.

## 4. Salvar

Arquivo `../directus-extension-geospatial-plan/issues/fNN.md` (por exemplo, `f00.md`). Se ele já existir, acrescente sem apagar o que foi feito. Os identificadores são `F00-01`, `F00-02` e assim por diante, e nunca são renumerados.

No topo vai a tabela de estado; depois, uma seção por issue, no modelo abaixo.

```markdown
# Issues da F00 — Fundação

Fase: [F00](../fases/f00-fundacao.md). Implementar uma por vez com `/implement-issue F00-01`.

| Issue | Título | Tipo | Bloqueada por | Estado |
|---|---|---|---|---|
| F00-01 | ... | HITL | — | a fazer |

---

## F00-01 — Título curto, com o vocabulário do glossário

**Tipo:** HITL | AFK · **Bloqueada por:** — | F00-0x

### O que construir
O comportamento de ponta a ponta que passa a existir, em poucas linhas. Não é lista de arquivos.

### Critérios de aceite
- [ ] Verificável por comando ou teste, sem interpretação.
- [ ] ...

### Testes
Quais camadas de `docs/padroes/testes.md` esta issue exige, em quais bancos da matriz, e o que cada teste prova. Se a issue devolve dados, inclua a paridade de permissão com o `/items`.

### Toca em
D-0xx · V-xx · P-xx · §seção da arquitetura.

### Conceitos novos
Os conceitos que a explicação na conversa, na entrega, precisa cobrir.

### Perguntar antes
Comandos no ambiente que exigem confirmação do mantenedor, ou "nada".
```

Por fim, a seção "Passos" do arquivo da fase ganha uma linha apontando para o arquivo de issues. Os passos em si não são copiados. Depois, sugira ao mantenedor a mensagem do commit no repositório do plano.

## 5. Se o mantenedor quiser as issues no GitHub

Não publique. Gere os comandos `gh issue create --repo HarrisonSanches/directus-extension-geospatial-plan --title ... --body-file ...` para ele rodar, um por issue, e diga que ele pode colar o número da issue do GitHub na tabela depois. As issues do plano ficam no repositório do plano; as do produto são da comunidade.
