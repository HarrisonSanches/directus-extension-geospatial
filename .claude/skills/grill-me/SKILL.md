---
name: grill-me
description: Interroga o mantenedor sem trégua sobre um plano, uma decisão ou uma ideia, até os dois chegarem a um entendimento comum. Use quando o mantenedor quiser pôr o próprio raciocínio à prova, ou usar uma frase com "grill".
---

Entreviste o mantenedor sem trégua até os dois chegarem a um entendimento comum. Mapeie a conversa como uma **árvore de
decisões**: cada decisão se abre nas decisões que dependem dela.

Percorra a árvore em **rodadas**. A **fronteira** são todas as decisões cujos pré-requisitos já estão resolvidos: as
perguntas que dá para fazer _agora_, sem adivinhar respostas que você ainda não ouviu. Faça a fronteira inteira numa
rodada só: numere cada pergunta e dê a sua resposta recomendada. Depois, espere as respostas do mantenedor antes da
próxima rodada.

Monte uma rodada assim:

```
❓ **P1** - **<título da pergunta>**: <corpo da pergunta, que pode ter vários parágrafos e várias opções>

➡️ <a sua resposta recomendada>

---

❓ **P2** - **<título da pergunta>**: <corpo da pergunta, que pode ter vários parágrafos e várias opções>

➡️ <a sua resposta recomendada>
```

Cada rodada respondida muda a árvore: as decisões resolvidas empurram a fronteira para fora e liberam as perguntas que
dependiam delas. Recalcule a fronteira e faça a próxima rodada. Uma pergunta cuja resposta depende de outra ainda aberta
na mesma rodada fica para uma rodada _seguinte_.

Achar _fatos_ é trabalho seu, nunca do mantenedor. Quando uma pergunta da fronteira precisar de um fato do ambiente (os
arquivos, as ferramentas e o resto), mande um subagente buscá-lo, e não pergunte ao mantenedor nada que você mesmo possa
descobrir. Não fique parado esperando: uma busca em andamento é um pré-requisito não resolvido, então só as perguntas que
dependem dela esperam o subagente responder, e o resto da fronteira vai agora. As _decisões_ são do mantenedor: leve
cada uma a ele e espere.

A sessão termina quando a fronteira fica vazia: todo ramo da árvore visitado, e nada pressuposto em silêncio. Não aja
sobre o resultado até o mantenedor confirmar que vocês chegaram a um entendimento comum.
