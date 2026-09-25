---
name: to-prd
description: Transforma o contexto da conversa numa especificação de funcionalidade para uma fase complexa do directus-extension-geospatial, salva em specs/, no repositório do plano. Use quando uma fase precisar de especificação antes de virar issues, como o motor de tiles com agrupamento, a matriz de capacidades por banco ou o relatório de evidências.
---

Transforme o contexto da conversa numa especificação e salve no repositório. Use só quando a fase for complexa demais para ir direto do arquivo da fase para as issues. Na maioria das fases, o arquivo da fase já basta.

Não entreviste o usuário: sintetize o que você já sabe. **Não faça commit nem push.**

## Processo

### 1. Explore o repositório

Entenda o estado atual do repositório, se ainda não o fez.
- Use o vocabulário do `CONTEXT.md` em toda a especificação.
- Respeite as decisões de `docs/decisoes.md`: as portas de mão única do topo não mudam sem uma decisão nova.
- Parta do desenho em `docs/arquitetura.md` e dos fatos em `docs/verificacoes.md`.

### 2. Esboce os módulos

Identifique os módulos principais que precisarão ser construídos ou modificados. Procure ativamente oportunidades de extrair módulos profundos que possam ser testados isoladamente.

> Um módulo profundo (ao contrário de um módulo raso) encapsula muita funcionalidade atrás de uma interface simples e testável, que raramente muda.

Candidatos naturais neste projeto: o módulo que monta a query permitida (o único que toca nos internos do Directus, D-001), cada adaptador de banco (D-002), o montador de tiles, o registro de consultas e o gerador de PDF.

Confirme com o usuário se esses módulos batem com o que ele espera, e pergunte para quais deles ele quer testes.

### 3. Escreva o PRD e salve no repositório

Use o modelo abaixo. Salve em `../directus-extension-geospatial-plan/specs/fNN-<tema>.md` e aponte para ele na seção "Passos" do arquivo da fase. O plano fica num repositório privado, clonado ao lado deste; se a pasta não existir, pare e avise o mantenedor. Depois, a skill `to-issues` quebra a especificação em issues.

**Não publique em nenhum rastreador de issues.**

---

## Modelo do PRD

### Problema

O problema que o usuário enfrenta, do ponto de vista dele.

### Solução

A solução do problema, do ponto de vista do usuário.

### Histórias de usuário

Uma lista numerada LONGA de histórias de usuário, cada uma neste formato:

> Como um `<ator>`, quero `<funcionalidade>`, para que `<benefício>`.

Exemplo:
1. Como uma operadora com papel restrito à zona sul, quero ver no raio só as ocorrências que posso ler, para que o mapa nunca me mostre dados de outra região.

A lista deve ser extensa e cobrir todos os aspectos da funcionalidade. Atores comuns: operador, operador com papel restrito, admin, desenvolvedor que integra pela API ou pelo SDK, autor de Flow e leitor de um relatório.

### Decisões de implementação

As decisões de implementação tomadas. Podem incluir:

- os módulos que serão construídos ou modificados;
- as interfaces desses módulos;
- esclarecimentos técnicos;
- decisões de arquitetura (com as `D-0xx` que elas seguem);
- mudanças nas coleções da extensão;
- contratos da API (o OpenAPI é a fonte, D-016);
- a linha da matriz de capacidades de cada banco (D-002);
- interações específicas.

**NÃO inclua caminhos de arquivo nem trechos de código.** Eles ficam desatualizados rapidamente.

### Decisões de teste

As decisões de teste tomadas, incluindo:

- o que é um bom teste: só comportamento externo, nunca detalhe de implementação;
- quais módulos serão testados, e em quais bancos da matriz (D-017);
- os testes de paridade de permissão com o `/items`, quando a funcionalidade devolve dados;
- testes parecidos que já existem no repositório e servem de referência.

### Fora de escopo

O que fica fora do escopo deste PRD.

### Notas adicionais

Qualquer outra observação sobre a funcionalidade.
