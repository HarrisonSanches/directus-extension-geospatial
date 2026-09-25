---
name: diagnose
description: Loop de diagnóstico disciplinado para bugs difíceis e regressões de performance no directus-extension-geospatial. Reproduzir → minimizar → hipotetisar → instrumentar → corrigir → teste de regressão. Use quando reportar um bug, algo está quebrando/falhando, ou descrever uma regressão de performance.
---

## Diagnose

Uma disciplina para bugs difíceis. Pule fases somente quando explicitamente justificado.

Ao explorar o codebase, use o glossário de domínio do projeto para ter um modelo mental claro dos módulos relevantes.

**Commits e ramos seguem as regras do `CLAUDE.md`:** a correção vai no ramo de uma issue, nunca direto no `develop` nem no `main`.

---

### Fase 1 — Construa um feedback loop

"Esta é a habilidade." Todo o resto é mecânico. Se você tiver um sinal de passa/falha rápido, determinístico e executável pelo agente para o bug, você encontrará a causa. Se não tiver, nenhuma quantidade de olhar para o código vai ajudar.

Gaste esforço desproporcional aqui. Seja agressivo. Seja criativo. Recuse-se a desistir.

#### Formas de construir um — tente nesta ordem aproximada

1. Teste falhando na seam que alcança o bug — unitário, integração, e2e.
2. Script CLI com input fixture, comparando stdout com snapshot conhecido.
3. Harness descartável. Suba um subconjunto mínimo do sistema que exercite o caminho do bug com uma única chamada de função.
4. Loop de propriedade/fuzz. Se o bug é "saída às vezes errada", rode 1000 inputs aleatórios e procure o modo de falha.
5. Loop diferencial. Rode o mesmo input pela versão antiga vs nova e compare outputs.
6. Script bash HITL. Último recurso. Se um humano precisa clicar, estruture o loop de qualquer forma.

Construa o feedback loop certo, e o bug está 90% corrigido.

#### Itere no próprio loop

- Posso torná-lo mais rápido? (Cache de setup, pule init não relacionado, estreite escopo do teste.)
- Posso tornar o sinal mais nítido? (Assert no sintoma específico, não em "não crashou".)
- Posso torná-lo mais determinístico? (Fixe tempo, seed RNG, isole filesystem, congele rede.)

Um loop instável de 30 segundos é mal melhor que nenhum loop. Um loop determinístico de 2 segundos é um superpoder de debugging.

#### Bugs não-determinísticos

O objetivo não é uma reprodução limpa mas uma "taxa de reprodução mais alta". Faça loop no trigger 100×, paralelize, adicione stress, estreite janelas de timing. Um bug com 50% de flake é debugável; 1% não é.

#### Quando genuinamente não conseguir construir um loop

Pare e diga explicitamente. Liste o que tentou. Peça ao usuário: (a) acesso ao ambiente que reproduz, (b) artefato capturado (log dump, screen recording com timestamps), ou (c) permissão para adicionar instrumentação temporária. **Não prossiga para hipotetisar sem um loop.**

---

### Fase 2 — Reproduza

Execute o loop. Observe o bug aparecer.

Confirme:
- O loop produz o modo de falha que o **usuário** descreveu — não uma falha diferente que acontece estar por perto.
- A falha é reproduzível através de múltiplas execuções.
- Você capturou o sintoma exato (mensagem de erro, saída errada, timing lento).

Não prossiga até reproduzir o bug.

---

### Fase 3 — Hipotetisar

Gere **3–5 hipóteses rankeadas** antes de testar qualquer uma.

Cada hipótese deve ser **falsificável**: declare a predição que faz.

Formato: "Se [X] for a causa, então [Y] fará o bug desaparecer / piorar."

Se não conseguir declarar a predição, a hipótese é um palpite — descarte ou afine.

**Mostre a lista rankeada ao usuário antes de testar.** Eles frequentemente têm conhecimento de domínio que re-rankeia instantaneamente.

---

### Fase 4 — Instrumente

Cada sonda deve mapear para uma predição específica da Fase 3. **Mude uma variável por vez.**

Preferência de ferramenta:
1. **Inspeção de debugger / REPL** se o ambiente suportar. Um breakpoint vale mais que dez logs.
2. **Logs direcionados** nas boundaries que distinguem hipóteses.
3. Nunca "logue tudo e faça grep".

**Marque todo log de debug** com um prefixo único, ex: `[DEBUG-a4f2]`. Limpeza no final vira um único grep.

**Branch de perf.** Para regressões de performance, logs geralmente são errados. Em vez disso: estabeleça uma medição baseline, depois bissecte. Meça primeiro, corrija depois.

---

### Fase 5 — Corrija + teste de regressão

Escreva o teste de regressão **antes da correção** — mas somente se houver uma **seam correta** para ele.

Uma seam correta é aquela onde o teste exercita o **padrão real do bug** como ocorre no call site.

Se nenhuma seam correta existir, isso em si é o achado. Anote. A arquitetura do codebase está impedindo o bug de ser travado.

Se uma seam correta existir:
1. Transforme a reprodução minimizada em um teste falhando nessa seam.
2. Observe falhar.
3. Aplique a correção.
4. Observe passar.
5. Re-execute o loop da Fase 1 contra o cenário original.

---

### Fase 6 — Limpeza + post-mortem

Obrigatório antes de declarar concluído:

- Reprodução original não reproduz mais (re-execute o loop da Fase 1)
- Teste de regressão passa (ou ausência de seam está documentada)
- Toda instrumentação `[DEBUG-...]` removida (`grep` o prefixo)
- Protótipos descartáveis deletados
- A hipótese que se mostrou correta está declarada no relatório final

**Então pergunte: o que teria prevenido este bug?**

---

### Neste projeto

- **Comandos do loop:**
  - o ciclo rápido: `pnpm vitest run <arquivo> -t "<nome>"`, com o comando exato em `docs/padroes/README.md`;
  - a suíte de contrato no banco onde o bug aparece, porque os adaptadores se comportam diferente em cada banco;
  - os testes de ponta a ponta, quando o bug está na interface.
- **Sinais que já existem, antes de instrumentar:**
  - os logs do Directus, com `LOG_LEVEL=debug`;
  - o painel de saúde da extensão: tempo dos tiles, fila, acerto do cache e as consultas lentas com o id da consulta;
  - pelo id da consulta, o SQL montado, e o `EXPLAIN (ANALYZE, BUFFERS)` dele no banco;
  - num bug de permissão, a comparação com o `/items` para o mesmo usuário, que é o gabarito da D-001.
- **Comando no ambiente** para reproduzir (Docker fora dos testes, banco fora dos containers de teste, instalar algo): só com confirmação do mantenedor.
- **Onde vai parar o que o bug ensinou:**
  - um comportamento de ferramenta de terceiros que surpreendeu vira um fato em `docs/verificacoes.md` (`V-xx`);
  - se o bug contrariou o plano ou a arquitetura, entra como achado em `../directus-extension-geospatial-plan/achados.md`, no repositório do plano;
  - a explicação do bug e da correção vai na conversa, junto com o teste de regressão que reproduz o bug antigo.
- **Explique ao mantenedor, passo a passo,** as hipóteses, qual se confirmou e por quê.
