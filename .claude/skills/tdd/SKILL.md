---
name: tdd
description: Desenvolvimento orientado por testes no directus-extension-geospatial. Ciclo vermelho, verde, refatorar, um comportamento por vez, pela interface pública, com banco e Directus de verdade. Use ao construir regra de domínio ou corrigir bug com teste primeiro, ou quando o mantenedor mencionar TDD ou red-green-refactor.
---

# Desenvolvimento orientado por testes

**Não faça commit, não crie branch.** A estratégia completa está em `docs/padroes/testes.md` e na D-017.

## Princípio

O teste verifica **comportamento pela interface pública**, não detalhe de implementação. Um bom teste se lê como a regra do domínio: `it('raio devolve só as ocorrências que a Maria pode ler')` diz o que o sistema garante.

Sinal de alerta: refatorar sem mudar comportamento e ver um teste quebrar. Esse teste media implementação.

## Um teste por vez

```
ERRADO: escrever todos os testes, depois todo o código.
CERTO:  teste 1 → código 1 → teste 2 → código 2 → ...
```

Teste escrito em lote testa comportamento imaginado. Teste escrito um a um testa o que o código realmente precisa fazer.

## Fluxo

1. **Planejar com o mantenedor** a interface pública que muda ou nasce e a lista de **comportamentos** a provar, em ordem de prioridade. Não é uma lista de passos de implementação. Procure um módulo profundo: interface pequena, implementação rica por trás.
2. **Primeiro teste (vermelho):** o comportamento mais central. Rode e **veja falhar pelo motivo certo**. Erro de tipo ou de compilação não conta como vermelho.
3. **Verde:** o código mínimo para passar. Nada especulativo.
4. **Repetir** para o próximo comportamento.
5. **Refatorar** só com tudo verde: tirar duplicação e aprofundar o módulo, rodando os testes a cada passo.

## Neste projeto

- **TypeScript com Vitest:** `describe` e `it`, e `it.each` para tabelas de casos. Nomes de teste em português, como regras do domínio; o código fica em inglês.
- **Banco e Directus:** sempre os de verdade, em containers (testcontainers), com os bancos da matriz (D-017). Nunca mock. Os dados de teste entram pela API do Directus, para ficarem gravados como o Directus grava em cada banco.
- **Permissões:** toda funcionalidade que devolve dados tem um teste com papel restrito que compara o resultado com o `/items`. Quando o filtro nativo não consegue fazer a mesma pergunta, o gabarito é calculado com a GeographicLib.
- **Tempo:** relógio injetado, e relógio falso no teste (`vi.useFakeTimers`). Um pulso de 1 s ou um tempo máximo de consulta se testam avançando o relógio, nunca com espera real.
- **Dublê só quando precisar,** e como um fake em memória da interface que o consumidor definiu (por exemplo, o provedor de endereços).
- **Entrada de fora** (GeoJSON enviado, geometria desenhada, coordenadas digitadas, filtros): depois que o comportamento estiver coberto, um teste de propriedade com fast-check. Casos úteis: polígonos inválidos, vértices demais, antimeridiano e polos.
- **Saída gerada** (tiles MVT, PDF, documento OpenAPI): arquivo dourado em `testdata/`, comparado numa forma legível. Um tile, por exemplo, é decodificado para GeoJSON antes da comparação.
- **Interface:** a lógica (composables, stores, cálculos) é testada com Vitest. O que desenha no WebGL é coberto pelos testes de ponta a ponta com Playwright.

## Comandos

Os nomes exatos ficam em `docs/padroes/README.md`, quando a fase 0 criá-los. Até lá, a referência é:

```
pnpm vitest run <arquivo> -t "<nome do teste>"   # o ciclo, rápido
pnpm test                                         # unitários
pnpm check                                        # antes de dar por pronto
```

## A cada ciclo

- [ ] O teste descreve comportamento, não implementação.
- [ ] Usa só a interface pública.
- [ ] Sobreviveria a uma refatoração interna.
- [ ] O código é o mínimo para este teste.
- [ ] Nenhuma funcionalidade especulativa.

## Explicar

Ao fim, conte ao mantenedor na conversa, passo a passo, a sequência de comportamentos que os testes provaram e por que nessa ordem.
