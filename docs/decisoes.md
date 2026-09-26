# Decisões

> Registro das decisões do projeto (D-0xx). Não existe `docs/adr/`: decisão nova entra aqui, com o próximo número livre.
> Uma decisão só entra quando é **difícil de reverter**, **surpreendente sem contexto** e **resultado de um trade-off real**. O que é só esclarecimento vai direto para [arquitetura.md](arquitetura.md) ou para o [CONTEXT.md](../CONTEXT.md).
> Uma decisão mudada não é apagada: ela ganha a linha "Substituída por D-0yy", e a nova explica o porquê.
> As referências "§" apontam para seções de [arquitetura.md](arquitetura.md); V-xx e P-xx, para [verificacoes.md](verificacoes.md).

## Portas de mão única

Estas decisões são as mais caras de desfazer: mudar qualquer uma delas quebra quem já usa a extensão ou refaz boa parte do código. Nenhuma muda sem uma decisão nova.

- **D-001** Permissões pelas funções internas do Directus (regra de ouro)
- **D-002** PostGIS como referência, um adaptador por banco e a matriz de capacidades
- **D-004** Tiles vetoriais no banco, pedidos por consulta registrada
- **D-015** Dados da extensão em coleções do Directus
- **D-016** API em dois estilos, com contrato OpenAPI
- **D-019** Nome, prefixos e licença

---

## D-001 — Permissões pelas funções internas do Directus

- **Estado:** aceita em 23/09/2026. Porta de mão única.
- **Onde:** §5 · V-21, V-22, V-23, V-24.
- **Contexto:** o SQL espacial precisa respeitar as permissões do Directus. O fluxo do handoff (o SQL gera candidatos e o `ItemsService` filtra com `_in`) falha em tiles, agregações, ordenação por distância e mais próximos, porque a permissão fica fora do SQL.
- **Decisão:** a extensão pede às funções internas do Directus, a mesma cadeia do `ItemsService` até o `getDBQuery`, a query do que o usuário pode ver. Essa query é envolvida com a parte espacial, num SQL só. **Regra de ouro:** quem decide o que o usuário recebe é sempre a lógica de permissões do próprio Directus, e a extensão nunca escreve regra de permissão própria.
- **Alternativas descartadas:**
  - Só a API pública: permissões exatas e contrato estável, mas ficariam de fora tiles e agregações em zoom baixo, a ordenação de grandes resultados por distância, os focos em volume e os mais próximos exatos.
  - O fluxo do handoff com `_in`.
- **Consequências:**
  - Dependemos de API interna. Por isso: só um módulo toca nos internos, com um adaptador por versão; uma checagem na inicialização desliga as operações afetadas e avisa; testes de paridade com o `/items` rodam em v11 e v12; e um canário roda contra cada versão nova.
  - Perdas aceitas: os hooks `items.read` de outras extensões não rodam em tiles e agregações, e os valores saem crus do banco, sem o `PayloadService`.

## D-002 — PostGIS como referência, um adaptador por banco e a matriz de capacidades

- **Estado:** aceita em 23/09/2026. Porta de mão única.
- **Onde:** §7.4 · V-25, V-27, V-28, V-29, V-36, V-37 · P-04 a P-07.
- **Contexto:** a extensão deve atender todos os bancos do Directus, mas as capacidades espaciais deles variam muito. No MySQL, por exemplo, o Directus grava sem SRID, e nessas colunas o índice espacial é ignorado.
- **Decisão:**
  - Toda funcionalidade é pensada primeiro para o PostGIS.
  - Cada banco tem um adaptador, todos com a mesma interface.
  - O que o banco não faz, o Node completa sobre os itens já permitidos, com limite de volume e aviso.
  - O que nem o Node resolve não aparece para o usuário comum.
  - A matriz de capacidades é detectada na inicialização (banco, versão, extensões) e lida pela interface, pela API e pelos testes. O admin vê a matriz completa no painel de saúde, com o motivo de cada lacuna e como liberá-la.
- **Alternativas descartadas:**
  - Só Postgres.
  - Tudo no Node: sem índice, não escala.
  - Mostrar as operações indisponíveis desabilitadas para todos: polui a tela do operador, que não pode mudar o ambiente.
- **Consequências:** a matriz de testes cobre todos os bancos, e cada operação nova precisa declarar a capacidade em cada um.

## D-003 — Quatro superfícies: layout, módulo, painel e operação de Flow

- **Estado:** aceita em 23/09/2026.
- **Onde:** §4, §7.3 (grupo 1), §7.8 · V-01 a V-07, V-20.
- **Contexto:** o mapa nativo não pode ser estendido, e cada tipo de extensão do Directus tem vantagens e limites diferentes.
- **Decisão:** a extensão aparece em quatro superfícies, todas sobre o mesmo núcleo e todas com várias camadas:
  - o layout, que herda a busca, os filtros, os bookmarks e as ações em lote da página;
  - o módulo, com várias coleções e visões salvas;
  - o painel, para dashboards;
  - a operação de Flow, para automação.
- **Alternativas descartadas:**
  - Só o layout: ficaria sem várias coleções.
  - Só o módulo: perderia os recursos da página da coleção.
  - Começar por uma superfície e deixar as outras para depois: vai contra o princípio de extensão completa.
- **Consequências:** o layout aparece em toda coleção (com aviso quando não há geometria) e não consegue escrever no filtro da página. A extensão traz o próprio MapLibre.

## D-004 — Tiles vetoriais no banco, pedidos por consulta registrada

- **Estado:** aceita em 23/09/2026. Porta de mão única.
- **Onde:** §4.1, §7.1.
- **Contexto:** os volumes são grandes (500 mil itens num raio). A ideia do handoff era somar páginas de pontos no mapa.
- **Decisão:**
  - Tiles MVT montados com `ST_AsMVT` em volta da query permitida.
  - A interface registra a consulta uma vez, com um id que é o hash do conteúdo, e pede por esse id os tiles, as partes do resultado (D-022) e a exportação.
  - Um único pedido por tile traz todas as camadas (fontes compostas), com cache separado por camada.
- **Alternativas descartadas:**
  - Páginas de GeoJSON no mapa: memória, travadas, área errada e uma mancha em zoom baixo.
  - O meio-termo do mapa nativo: área visível mais 1000 itens por página.
- **Consequências:**
  - A permissão é aplicada em cada pedido, com a identidade de quem pede, então repassar o id não vaza nada.
  - O mesmo id serve para cache, consultas salvas e compartilhamento.
  - Um id temporário pode expirar; nesse caso, a interface registra a consulta de novo.

## D-005 — Agrupamento no servidor por células de tela

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.1.
- **Contexto:** em zoom baixo, um tile pode ter centenas de milhares de pontos.
- **Decisão:**
  - Uma grade de células medidas em pixels (por exemplo, 60 px), com a mesma regra em todos os tiles.
  - Uma célula com um item manda o próprio item. Uma célula com vários manda um grupo com a contagem, a posição média e o retângulo dos itens.
  - Cada camada configura se agrupa, o tamanho da célula e o zoom a partir do qual tudo aparece solto.
  - Linhas e polígonos não são agrupados, só simplificados conforme o zoom.
- **Alternativas descartadas:**
  - Zoom mínimo fixo por camada: não se adapta à densidade.
  - Agrupar no navegador (supercluster): fica limitado ao que chega ao navegador.
  - Amostragem: esconde itens.
- **Consequências:** as contagens respeitam as permissões. O item atual e os selecionados vão para uma camada de destaque, para aparecerem mesmo dentro de grupos.

## D-006 — Proteção do banco e cache pela query compilada

- **Estado:** aceita em 23/09/2026; esclarecida em 24/09/2026 (os valores dos parâmetros na chave).
- **Onde:** §7.1 · V-24 · P-08.
- **Contexto:** tiles e análises podem sobrecarregar o banco e travar o próprio Directus.
- **Decisão:**
  - Um pool de conexões próprio (bulkhead), que pode apontar para uma réplica de leitura.
  - Uma fila com prioridade e limite por usuário.
  - Um tempo máximo por tipo de consulta; o tile que estoura aparece hachurado.
  - Cancelamento de ponta a ponta, até o Postgres.
  - Chave de cache formada pelo SQL compilado pelo Directus, com os valores dos parâmetros, a versão da coleção e o tile. Os valores entram porque o filtro de permissão vai neles: a regra da Maria e a do João são o mesmo texto no SQL (`regiao = ?`), e só o valor muda.
- **Alternativas descartadas:**
  - Usar o pool do Directus.
  - Cache por usuário: desperdiça espaço.
  - Cache sem a permissão na chave: vaza dados.
  - Chave só com o texto do SQL: papéis com permissões diferentes teriam a mesma chave, porque a permissão fica nos valores.
- **Consequências:** quem tem exatamente as mesmas permissões compartilha o cache e os pulsos de tempo real. O SQL ser determinístico vira teste automatizado. Uma permissão com `$CURRENT_USER` põe o id do usuário nos valores, e o cache daquele papel fica por usuário.

## D-007 — Metros com filtro em dois estágios e suporte a qualquer SRID

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.6 · V-25, V-42.
- **Contexto:** em SRID 4326, `geometry` calcula em graus, e converter para `geography` impede o uso do índice. Além disso, o Directus não trata SRID.
- **Decisão:**
  - Primeiro uma caixa no SRID da coluna, que usa o índice; depois o teste exato em `geography`.
  - Os mais próximos usam `<->` e a ordem exata em `geography`.
  - As medições são sempre em `geography`.
  - A entrada é convertida para o SRID da coluna, e a saída sai em 4326.
- **Alternativas descartadas:**
  - Índice funcional em `geography`: exige DDL na tabela do usuário.
  - Projetar para um SRID em metros: distorce fora da zona de projeção.
- **Consequências:** a extensão funciona onde o mapa nativo falha, como com SIRGAS 2000 / UTM.

## D-008 — Mudanças no banco e nas permissões só por ação do admin

- **Estado:** aceita em 23/09/2026. Complementada pela D-039 (inventário e remoção).
- **Onde:** §2, §7.6, §7.8, §7.3 (grupo 5).
- **Contexto:** o Directus não cria índice espacial, e a extensão precisa de coleções próprias. Ela pode oferecer uma política pronta e gatilhos de detecção.
- **Decisão:**
  - Índices (GiST e BRIN), coleções da extensão, política pronta e gatilhos são criados por um botão do admin. O botão mostra o SQL, as coleções ou as permissões e pede confirmação.
  - Sem o índice, todos os usuários veem um aviso com o impacto.
  - O índice é criado em segundo plano, com progresso e detecção de índice inválido.
- **Alternativas descartadas:**
  - Criar tudo automaticamente ao instalar.
  - Só avisar e mostrar o SQL.
- **Consequências:** antes dessa configuração, o layout e o painel já funcionam; o módulo e o compartilhamento esperam.

## D-009 — Tabelas particionadas auxiliares não adotadas

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.6 · V-26 · P-10.
- **Contexto:** o Directus não enxerga tabelas particionadas. A ideia era a extensão manter uma cópia particionada só para as leituras espaciais.
- **Decisão:** não adotar como arquitetura. O BRIN nos campos de data cobre boa parte do ganho. A ideia fica como hipótese de benchmark e, se o ganho medido justificar, vira um acelerador opcional por coleção.
- **Alternativas descartadas:** adotar a cópia particionada, sincronizada por gatilhos ou por hooks.
- **Motivos:**
  - dobra o disco;
  - exige sincronização e manutenção de partições;
  - o Directus continua lento na tabela principal;
  - pela D-001, toda consulta na auxiliar voltaria à principal para conferir a permissão, e isso anula o ganho justamente nas consultas pesadas.

## D-010 — MapLibre com deck.gl intercalado, carregados sob demanda

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.1 (renderização) · V-07, V-08 · P-01, P-03.
- **Decisão:**
  - MapLibre na base.
  - deck.gl no mesmo canvas, pelo `MapboxOverlay`, para playback, tempo real, 3D e agregações na placa de vídeo.
  - As bibliotecas vêm com a extensão, independentes da versão usada pelo Studio.
  - Um build próprio mantém os imports dinâmicos, para as bibliotecas só serem baixadas quando o mapa abre.
- **Alternativas descartadas:**
  - Só MapLibre: fraco em playback e tempo real.
  - Só deck.gl: não desenha o mapa de fundo.
  - Leaflet: não usa WebGL para desenhar dados.
  - OpenLayers: sem ganho aqui, e diferente do mapa nativo.
  - Build padrão do SDK: junta tudo num arquivo e pesa o Studio de todos os usuários.
- **Consequências:** o requisito é WebGL2, e há um spike antes da implementação.

## D-011 — Mapas de fundo em três grupos, com OpenFreeMap como padrão

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.7 · V-31, V-32, V-33, V-38, V-39, V-40 · P-02.
- **Decisão:**
  - Três grupos: a lista do Directus (OpenStreetMap, Mapbox e os cadastrados), os estilos do OpenFreeMap sem chave (que seguem o tema) e o PMTiles guardado no próprio Directus.
  - O padrão é o OpenFreeMap claro ou escuro, e o admin pode trocá-lo.
  - O OpenStreetMap usa o endereço atual.
- **Alternativa descartada:** o OpenStreetMap raster como padrão, como faz o Directus. Os servidores são mantidos por voluntários, a política permite bloquear o acesso sem aviso, e a imagem fica borrada no zoom e não tem versão escura.
- **Consequências:** o OpenFreeMap vive de doações, então a documentação recomenda o PMTiles ou um provedor pago para produção crítica.

## D-012 — Terra Draw para desenho e GeographicLib para medições

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.3 (grupo 3), §7.4 · V-41, V-42 · P-09.
- **Decisão:**
  - Desenho com o Terra Draw: círculo geodésico, polígono, desenho livre, linha, retângulo, seleção e encaixe.
  - Medições no navegador e no Node com a GeographicLib, o mesmo cálculo do PostGIS.
- **Alternativas descartadas:**
  - mapbox-gl-draw: sem círculo, retângulo nem desenho livre.
  - Turf para medições: calcula sobre uma esfera e pode errar até cerca de 0,5%.
- **Consequências:** a versão escolhida do MapLibre precisa ser suportada pelo adaptador do Terra Draw.

## D-013 — Busca de endereço pelo endpoint, com Nominatim público como padrão

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.3 (grupo 3), §7.8 · V-43.
- **Decisão:**
  - Uma caixa de busca única, para coordenadas, itens das camadas e endereços, com provedores configuráveis.
  - Sem chave do Mapbox, o padrão é o Nominatim público no modo que a política permite: busca ao apertar Enter, no máximo 1 pedido por segundo para a instalação inteira, cache, identificação e atribuição.
  - Toda busca passa pelo endpoint da extensão.
- **Alternativas descartadas:**
  - Buscar direto do navegador: não controla o limite global, expõe as chaves, e a CSP bloqueia serviços em `http` da intranet.
  - Busca de endereços desligada por padrão.
- **Consequências:** uso intenso exige um serviço próprio ou pago.

## D-014 — Tempo real por SSE, em pulsos

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.3 (grupo 5) · V-16.
- **Decisão:**
  - Canal próprio por SSE, com uma conexão por mapa.
  - Pulsos (por exemplo, a cada 1 s), com uma consulta por query permitida.
  - Três formas de detectar mudanças: os hooks do Directus, um gatilho `LISTEN/NOTIFY` no Postgres (criado por ação do admin) e um campo de data de atualização nos outros bancos.
  - A mesma detecção invalida o cache.
- **Alternativa descartada:** o WebSocket do Directus. Vem desligado por padrão, relê cada evento para cada inscrito e não enxerga gravações feitas fora do Directus.
- **Consequências:** o gatilho existe só no Postgres (entra na matriz de capacidades), e o campo de data não enxerga exclusões. O mesmo canal serve à API e ao SDK (D-035).

## D-015 — Dados da extensão em coleções do Directus

- **Estado:** aceita em 23/09/2026. Porta de mão única.
- **Onde:** §7.8 (armazenamento) · V-30.
- **Decisão:**
  - Visões, consultas compartilhadas, configurações, histórico de índices, relatórios e capturas ficam em coleções do Directus, com prefixo `geospatial_`, numa pasta própria e ocultas na navegação.
  - As coleções são criadas por ação do admin, e as migrações têm trava.
  - Segredos ficam em variáveis de ambiente.
  - O estado temporário fica em memória ou no Redis, que é obrigatório com várias instâncias.
- **Alternativa descartada:** tabelas soltas, fora do Directus. Exigiriam permissões próprias, contra a D-001.
- **Consequências:** as permissões do Directus decidem quem vê cada visão e cada relatório, e as coleções já entram no backup e já têm API.

## D-016 — API em dois estilos, com contrato OpenAPI

- **Estado:** aceita em 23/09/2026. Porta de mão única.
- **Onde:** §7.8 (API e SDK) · V-10 a V-13.
- **Decisão:**
  - **Dois estilos:**
    - o formato do `/items` (`GET` ou `SEARCH /geospatial/items/:coleção`, com o parâmetro `geo`);
    - a consulta registrada (`POST /geospatial/queries`, mais tiles, uma rota para cada parte do resultado e exportação; D-022).
  - **Convenções do Directus:** autenticação, formato de erro e valores calculados em `$geo`.
  - **OpenAPI** em `/geospatial/openapi.json`, como fonte dos tipos e da validação. A entrada é validada antes de chegar ao banco.
  - **SDK** `directus-geospatial-sdk`, com comandos usados em `client.request`.
- **Alternativas descartadas:**
  - Só a consulta registrada: difícil para quem integra.
  - Só o formato do `/items`: ruim para tiles e compartilhamento.
- **Consequências:** rotas e formatos são contrato público, e mudanças seguem o versionamento semântico.

## D-017 — Testes em ambiente real e cobertura mínima

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.4 (testes, cobertura).
- **Decisão:**
  - Uma suíte de contrato para todos os bancos, com os dados carregados pela API do Directus.
  - Paridade com o `/items` para um papel restrito: IDs idênticos, ou um gabarito calculado com a GeographicLib.
  - Directus v11 e v12 e bancos reais em containers, sem mock.
  - Camadas de CI: pull request, noite, release e canário.
  - Cobertura: pelo menos 90% no código novo; 90% de linhas e de ramificações no motor; relatórios somados entre os bancos.
  - Teste de mutação no módulo de permissões, com meta de 90%.
  - Testes de ponta a ponta com Playwright e axe-core.
- **Alternativas descartadas:**
  - Mock de banco: não pega as diferenças entre dialetos.
  - Só cobertura global: não garante o mínimo em cada funcionalidade.
- **Consequências:** uma CI mais pesada, com a matriz inteira à noite e antes de cada release.

## D-018 — Versões: a major atual e a última minor da anterior

- **Estado:** aceita em 23/09/2026. Substituída pela D-037 em 24/09/2026.
- **Onde:** §7.5 · V-29, V-34, V-35.
- **Decisão:**
  - Directus v12 e v11.17 (`host: ^11.17.0 || ^12.0.0`). O v11 sai quando o v13 chegar.
  - Bancos na política LTS: a mínima é a versão mais antiga que o fabricante suporta, e a matriz testa a mínima e a mais nova.
  - PostGIS: uma versão ainda mantida pelo projeto, e nunca abaixo da 3.1.
  - Navegador com WebGL2.
- **Alternativas descartadas:**
  - Todas as minors do v11: adaptadores demais.
  - Só o v12: perderia a base instalada.
- **Consequências:** o Marketplace só oferece a última versão de cada extensão, então todo release precisa valer para as duas majors enquanto o v11 estiver na política.

## D-019 — Nome, prefixos e licença

- **Estado:** aceita em 23/09/2026. Porta de mão única. Esclarecida em 24/09/2026 (a licença do núcleo do Directus).
- **Onde:** §7.5 · V-60.
- **Decisão:**
  - Pacote `directus-extension-geospatial`, sem escopo, que aparece como "Geospatial" no Marketplace.
  - Prefixos `/geospatial` na API e `geospatial_` nas coleções.
  - SDK `directus-geospatial-sdk`.
  - Licença MIT.
- **Alternativas descartadas:**
  - `directus-extension-geo`: já existe no npm, e o prefixo `/geo` poderia colidir.
  - Licença Apache-2.0 ou AGPL.
- **Consequências:**
  - Os prefixos são contrato público.
  - A licença MIT é a mesma das extensões da Directus Labs.
  - Uma versão paga no futuro seria um pacote separado.
  - O núcleo do Directus, inclusive o `@directus/api`, tem licença própria, a MSCL-1.0-GPL (V-60). A extensão continua MIT porque usa os internos do Directus que já está rodando e nunca os embute no pacote, o que a CI confere.

## D-020 — Um pacote fora do sandbox, com três caminhos de instalação

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.5 · V-34.
- **Decisão:**
  - Um bundle só, com endpoint, hooks, layout, módulo, painel e a operação de Flow.
  - Três caminhos de instalação: o Marketplace com `MARKETPLACE_TRUST=all`, a imagem Docker (o recomendado) ou a pasta de extensões.
  - Confiança: publicação com provenance, SBOM, `SECURITY.md`, CHANGELOG e a documentação de tudo o que a extensão acessa.
- **Alternativa descartada:** separar uma parte em sandbox para instalar com a configuração padrão. Sem o endpoint, ela não teria motor.
- **Consequências:** o público é quem hospeda o próprio Directus, ou quem tem o plano Enterprise no Cloud. A documentação explica o risco do `MARKETPLACE_TRUST=all`.

## D-021 — Relatório de evidências montado no servidor, com cadeia de custódia

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.9.
- **Decisão:**
  - Cada captura guarda a imagem (feita no navegador), os dados do momento e o contexto.
  - O PDF é montado no servidor, em Node, a partir dos dados guardados.
  - Cada captura e o relatório inteiro têm um hash SHA-256.
  - Depois de gerado, o relatório fica travado, e um ajuste gera uma nova versão.
  - Uma página de verificação, acessível por QR code, confere o PDF.
  - A assinatura PAdES é opcional.
  - O PDF leva anexos em GeoJSON.
- **Alternativas descartadas:**
  - PDF montado no navegador: o documento oficial não sairia dos dados guardados.
  - Só a imagem, sem os dados do momento: edições posteriores mudariam a evidência.
  - Chromium no servidor: pesado demais.
- **Consequências:** os cinco modelos de relatório usam a mesma estrutura, e a implementação começa pelo modelo de cerca virtual.

## D-022 — Resultado em três partes, com uma rota para cada parte

- **Estado:** aceita em 23/09/2026. Detalha a D-016.
- **Onde:** §7.3 (grupo 4), §7.8 (API e SDK, Flows), §7.9 · V-44, V-45.
- **Contexto:** o desenho dizia que cada operação produz um de três tipos (itens, formas ou resumos), mas quase todas produzem mais de um. O raio dá os itens de dentro e o círculo, e os focos dão o contorno e a contagem de cada um. A API só tinha rotas para os itens e para a contagem.
- **Decisão:**
  - Um resultado tem até três partes: itens, formas e resumos. Cada operação declara quais produz.
  - Na consulta registrada, uma rota para cada parte: `/items` e `/shapes`, por cursor, e `/summary`, que substitui a `/count` e traz o total em dois tempos e as medidas.
  - A rota `/items` aceita o id de uma região, célula da grade ou foco, para descer até os itens de dentro (§7.3, grupo 2).
  - O número que pertence a um elemento vai junto dele: a contagem da região no `$geo` do item, a da célula da grade ou do foco nas propriedades da forma, e o foco de cada ponto no `$geo` do ponto.
  - No formato do `/items`, `data` são os itens. Nas operações que agregam, `data` traz uma linha por região, célula da grade ou foco, como o `aggregate` com `groupBy` do Directus (V-44). As formas só saem pela consulta registrada.
  - A operação de Flow e o SDK devolvem as mesmas partes.
- **Alternativas descartadas:**
  - Um tipo por operação: não descreve o raio, o corredor, o trajeto nem os focos, e o encadeamento perderia o contorno dos focos como entrada.
  - Tudo numa resposta só: cada pedido esperaria a parte mais lenta, como a contagem exata, e as formas não teriam paginação.
  - Formas e resumos no `meta` do formato do `/items`: incha a resposta de quem só quer os itens, e uma grade com milhares de células não cabe ali.
- **Consequências:**
  - O mapa, a lista e o resumo carregam em paralelo, e cada parte tem o próprio tempo limite (7.1).
  - As rotas `/items`, `/shapes` e `/summary` entram no contrato público da D-016.

## D-023 — "Dentro" quer dizer "toca", com as opções "inteiramente dentro" e "fora"

- **Estado:** aceita em 23/09/2026.
- **Onde:** §6, §7.4 (testes) · V-49, V-50, V-51 · P-12.
- **Contexto:** o desenho usava "itens dentro" com dois sentidos. A área desenhada tinha como referência o `ST_Within`, que exige o item inteiro dentro e deixa de fora o ponto na borda. O raio, o corredor e o entorno usam o `ST_DWithin`, que pega o item se qualquer parte dele estiver a até a distância. Em pontos, a diferença fica só na borda; em linhas e polígonos, uma rua que atravessa a área entra num sentido e fica de fora no outro.
- **Decisão:**
  - Em toda operação que pega itens por área ou distância, "dentro" quer dizer "toca" por padrão: qualquer parte do item na área ou a até a distância, com a borda incluída (`ST_Intersects`, `ST_DWithin`).
  - A opção "inteiramente dentro", para linhas e polígonos, usa o `ST_CoveredBy`, que conta a borda. No raio, no corredor e no entorno, compara com o polígono do entorno montado com mais segmentos (erro de cerca de 0,03% da distância), porque o `ST_DFullyWithin` não aceita `geography`.
  - A opção "fora" pega os itens que não tocam a área.
- **Alternativas descartadas:**
  - "Inteiro dentro" como padrão (`ST_Within`): diverge do `_intersects` do Directus e do `ST_DWithin` das outras operações, e deixa de fora o ponto na borda.
  - Um sentido para cada operação: a mesma palavra mudaria de significado de uma operação para outra.
  - Todos os predicados do padrão OGC (cruza, sobrepõe, encosta, contém): demais para um painel de operação. "Toca", "inteiramente dentro" e "fora" cobrem o catálogo e os relatórios.
- **Consequências:**
  - O teste de paridade compara "toca" com o `_intersects` e "fora" com o `_nintersects` do Directus. No Oracle, isso depende da P-12.
  - A opção escolhida faz parte da consulta registrada, então entra no id e na chave do cache.

## D-024 — Nomes públicos das operações: o termo canônico do glossário

- **Estado:** aceita em 23/09/2026. Detalha a D-016.
- **Onde:** §7.8 (API e SDK) · [CONTEXT.md](../CONTEXT.md).
- **Contexto:** o SDK usava `withinRadius()` e `countByPolygon()`, mas o termo canônico de "contagem por região" é _count by region_. A antiga "área desenhada" passou a receber qualquer forma, com as opções da D-023, e o nome não a descrevia mais.
- **Decisão:**
  - O id de cada operação na API é o termo canônico do glossário em camelCase, e o comando do SDK é o mesmo id com o prefixo `geo`: `radius` e `geoRadius()`, `byArea` e `geoByArea()`, `countByRegion` e `geoCountByRegion()`.
  - A operação de área se chama "Por área" (_By area_). "Área desenhada" fica como o nome da forma que o usuário desenha.
- **Alternativas descartadas:**
  - "Área" (_Area_): brigaria com a medida (a área de um polígono) e com expressões como "área visível".
  - Nomes livres no SDK, como `withinRadius()`: cada superfície acabaria com um vocabulário próprio.
  - Comandos sem prefixo: nomes genéricos como `center()` e `measure()` colidiriam com funções do código de quem usa e de outras extensões.
- **Consequências:** um termo novo no glossário define também o nome público da operação, e renomear depois é mudança incompatível (D-016).

## D-025 — Trajeto por objeto, com trechos, pontos suspeitos e várias origens

- **Estado:** aceita em 23/09/2026.
- **Onde:** §6, §7.3 (grupo 5), §7.6.
- **Contexto:** o catálogo dizia só "linha ordenada no tempo". Numa frota ou numa investigação por placa, isso liga pontos de objetos diferentes, atravessa prédios nas faltas de posição e transforma um erro de GPS num espigão de dezenas de quilômetros. Os números errados iriam para o relatório de frota e para a evidência. O caso que testou as regras foi o de uma placa lida numa câmera, vista de novo 30 min depois, seguida a cada 30 s numa perseguição e vista mais uma vez 15 min depois em outro lugar.
- **Decisão:**
  - A coleção com campo de data ganha configurações de trajeto, feitas pelo admin (D-027): o campo do objeto, comparado normalizado; o perfil (contínuo ou esparso, pelo ritmo em que as posições chegam), com o limite do trecho e o tratamento do ponto suspeito; a velocidade máxima; e o campo de velocidade, opcional.
  - Quando falta posição por mais tempo que o limite, a linha se quebra, e a lacuna aparece tracejada, com o tempo, a distância em linha reta e a velocidade mínima do salto. A distância da lacuna fica fora do total.
  - O ponto que exigiria velocidade acima da máxima é suspeito. No perfil contínuo, ele sai da linha; no esparso, fica na linha, porque pode ser um identificador duplicado, como uma placa clonada. Nos dois casos, fica marcado.
  - Um trajeto pode juntar várias camadas com o mesmo objeto, cada uma pela sua query permitida.
  - Na tela, a cor da linha mostra o tempo (uma cor por dia até 7 dias, e um gradiente acima disso), e o símbolo do ponto mostra a origem.
- **Alternativas descartadas:**
  - Ligar todos os pontos em ordem de tempo: soma distâncias que ninguém percorreu e sugere caminhos que ninguém viu.
  - Apagar os pontos suspeitos: esconderia a placa clonada e tiraria o ponto da evidência.
  - Quebrar a linha a cada dia: cortaria no meio uma perseguição que atravessa a meia-noite.
  - Um trajeto por coleção: a mesma placa vista por câmera, viatura e rastreador ficaria em três linhas separadas.
- **Consequências:**
  - O relatório de frota e o de cerca virtual usam as mesmas configurações de trajeto.
  - A saúde do índice passa a sugerir um B-tree em (objeto, data) nas camadas com trajeto.

## D-026 — Parada por raio e tempo, com a parada provável à parte

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.3 (grupo 5), §7.9 (modelo de frota).
- **Contexto:** o relatório de frota mostra paradas e tempo parado, mas o critério não estava definido. Parado, o GPS oscila alguns metros e a velocidade calculada nunca zera, nem toda coleção tem campo de velocidade, e muitos rastreadores não mandam a ignição. Além disso, um rastreador que dorme com o motor desligado deixa uma lacuna longa justamente onde o veículo ficou parado.
- **Decisão:**
  - O objeto está parado quando fica dentro de um raio por um tempo mínimo, com os valores no perfil de trajeto (no perfil contínuo, 50 m por 5 min).
  - A lacuna em que o objeto reaparece perto de onde sumiu é uma parada provável, mostrada à parte.
  - Com campo de ignição, a parada de motor ligado é ociosa.
  - No perfil esparso, a parada vem desligada: com posições de vez em quando, uma câmera que lê o carro na saída e na volta viraria uma "parada provável" de horas em frente a ela.
  - A parada é uma forma do resultado do trajeto: um ponto no centro das posições, com início, fim e duração.
- **Alternativas descartadas:**
  - Por velocidade: a oscilação do GPS impede a velocidade de zerar, e o campo nem sempre existe.
  - Só por ignição: muitos rastreadores não mandam.
  - Tratar a lacuna como parada certa: o veículo pode ter saído e voltado, e a evidência afirmaria o que ninguém viu.
- **Consequências:** as paradas entram no encadeamento, por exemplo "paradas → por área → cercas dos clientes" para provar uma entrega.

## D-027 — Configuração dos dados por coleção, feita pelo admin

- **Estado:** aceita em 24/09/2026.
- **Onde:** §7.3 (grupo 5), §7.6, §7.8 (configuração por coleção).
- **Contexto:** as configurações de trajeto e o campo de data de atualização estavam descritos "na camada". Uma camada existe em cada layout, visão e painel, então a mesma coleção seria configurada várias vezes, e dois relatórios poderiam dar números diferentes para o mesmo veículo.
- **Decisão:**
  - O que descreve os dados fica na coleção, configurado uma vez pelo admin: os campos padrão, o trajeto, a detecção de mudanças feitas fora do Directus e, na mesma tela, a saúde dos índices.
  - O que descreve a visão fica na camada: filtro, estilo, agrupamento e "ao vivo".
  - Uma análise pode ajustar os valores do trajeto para uma pergunta específica. O ajuste fica na consulta registrada, e o resultado e o relatório mostram os critérios usados.
- **Alternativas descartadas:**
  - Tudo na camada: a configuração se repetiria em cada visão, e os números poderiam divergir.
  - Tudo na coleção, sem ajuste na análise: o gestor não conseguiria pedir, por exemplo, só as paradas longas.
- **Consequências:** a coleção de configurações da extensão (D-015) guarda uma entrada por coleção. Uma coleção sem configuração usa os padrões e só oferece o trajeto depois que o admin escolhe o objeto.

## D-028 — Cerca virtual calculada sobre o histórico, com o Flow só para o alerta

- **Estado:** aceita em 24/09/2026.
- **Onde:** §6, §7.3 (grupo 4), §7.8 (Flows), §7.9.
- **Contexto:** a ação de Flow guardava as áreas atuais num campo do item e as comparava com a posição nova. Numa coleção de posições, cada posição é um item novo, então não há item do objeto para guardar o estado. O Flow também não deixava histórico para o relatório, uma cerca criada depois não teria histórico nenhum, e posições atrasadas chegam fora de ordem e trocam entradas e saídas.
- **Decisão:**
  - A cerca virtual é uma operação do catálogo (`geofence`). Para um período, ela ordena as posições de cada objeto pela hora, marca cada uma como dentro ou fora de cada cerca e anota as mudanças: de fora para dentro é uma entrada, de dentro para fora é uma saída, e o que fica entre as duas é a visita.
  - O resultado tem as três partes: as posições dentro das cercas, as visitas e os resumos por cerca e por objeto.
  - O relatório de cerca virtual e qualquer consulta de entradas e saídas saem desse cálculo, que é a versão definitiva.
  - O Flow só dá o alerta na hora. O estado fica por objeto, em memória ou no Redis, e é refeito pelo histórico ao reiniciar. Uma posição mais antiga que a última processada não gera alerta.
- **Alternativas descartadas:**
  - Registrar as entradas e saídas no Flow e montar o relatório com esse registro: depende do Flow estar ligado, erra com posições atrasadas e não cobre cercas criadas depois.
  - Guardar o estado num campo do item: numa coleção de posições, não existe item do objeto.
- **Consequências:**
  - Com os mesmos dados, o relatório gerado de novo dá o mesmo resultado, o que sustenta o hash e a verificação (D-021).
  - O alerta pode faltar ou divergir do relatório quando há posições atrasadas, e a documentação avisa o usuário disso.

## D-029 — Hora de entrada e de saída como intervalo observado, mais uma estimativa

- **Estado:** aceita em 24/09/2026.
- **Onde:** §7.3 (grupo 5), §7.9.
- **Contexto:** a entrada real acontece entre a última posição fora e a primeira dentro. Uma cerca pequena pode ser atravessada sem nenhuma posição dentro, e a oscilação do GPS na borda faz um veículo parado entrar e sair dezenas de vezes.
- **Decisão:**
  - O relatório mostra o intervalo observado como fato e a hora estimada, pelo cruzamento da borda na linha entre as duas posições, como estimativa. A permanência traz o mínimo observado e a estimativa.
  - No perfil contínuo, a linha entre duas posições seguidas que atravessa a cerca registra uma passagem estimada, marcada como tal. Lacunas e o perfil esparso não geram passagem.
  - Uma saída seguida de nova entrada na mesma cerca em menos de 1 min vira uma visita só.
- **Alternativas descartadas:**
  - Só as posições: perderia as passagens rápidas por cercas pequenas.
  - Só a hora estimada: a evidência afirmaria um instante que ninguém observou.
  - Exigir um tempo mínimo dentro para contar a entrada: apagaria a passagem rápida de verdade.
- **Consequências:** o relatório de cerca virtual separa, em cada linha, o que foi observado do que foi estimado.

## D-030 — Saída do Flow com limite, e o resultado inteiro por id

- **Estado:** aceita em 24/09/2026.
- **Onde:** §7.8 (Flows) · V-53.
- **Contexto:** a saída da operação "Geo" vai para os dados do Flow. Um raio sobre 500 mil ocorrências poria tudo na memória do Directus a cada disparo. Além disso, todo Flow novo vem com o registro completo, que grava os dados de todos os passos numa revisão a cada execução.
- **Decisão:**
  - Itens e formas saem até um limite, de 100 por padrão, ajustável na operação até o máximo da instalação. O resumo vem sempre completo, com o total real, e a saída avisa quando cortou.
  - A saída traz só os campos pedidos, e o padrão é o id mais os valores de `$geo`.
  - A saída traz o id da consulta registrada, e a ação "Resultado inteiro" usa esse id para exportar ou para editar, arquivar e apagar em lotes, em segundo plano.
- **Alternativas descartadas:**
  - Saída completa: memória e revisões crescem com o volume, a cada disparo.
  - Só o resumo: o passo seguinte não teria os itens para agir, como no despacho da viatura mais próxima.
- **Consequências:** o limite e o máximo entram no contrato da operação (D-016), e a documentação orienta o registro "só atividade" nos Flows de alta frequência.

## D-031 — Datas e fusos: fuso dos dados na coleção, fuso gravado no relatório e janela resolvida no registro

- **Estado:** aceita em 24/09/2026.
- **Onde:** §7.1 (cache), §7.3 (grupo 5), §7.8 (configuração por coleção), §7.9 · V-54, V-55, V-56 · P-13.
- **Contexto:** o desenho só dizia que os horários aparecem como no Studio. Um campo `dateTime` não tem fuso, então juntar origens de tipos diferentes desloca uma delas em horas. O "dia" da cor, dos separadores e do "hoje" depende de onde cai a meia-noite. O relatório é montado no servidor, que não sabe o fuso de quem pediu. E o `$NOW` do Directus muda a cada pedido.
- **Decisão:**
  - A configuração da coleção diz o fuso dos dados dos campos sem fuso, com o fuso da instalação como padrão.
  - O filtro por período converte o parâmetro, nunca a coluna, para manter os índices.
  - No Studio, vale o fuso do navegador. O relatório guarda o próprio fuso, mostra-o na capa e escreve cada hora com o deslocamento. A API usa ISO 8601 com deslocamento e aceita um fuso no que agrupa por dia.
  - A janela relativa e o `$NOW` dos filtros do usuário são resolvidos uma vez, no registro da consulta, arredondados ao minuto. A visão guarda a janela relativa; a captura e o relatório, a absoluta.
  - A ordem é pela hora com desempate pelo id, a posição com hora no futuro é suspeita, e trajeto, parada e cerca exigem data e hora.
  - Um campo de hora de recebimento, opcional na configuração da coleção, mostra quando a posição chegou ao servidor. As regras usam só a hora da posição.
- **Alternativas descartadas:**
  - Tudo em UTC: o "dia" do usuário e o do relatório ficariam errados em qualquer fuso diferente de zero.
  - Converter a coluna no filtro: o banco deixaria de usar o BRIN e o B-tree (objeto, data).
  - Resolver a janela relativa a cada pedido: mapa, lista e resumo responderiam a janelas um pouco diferentes, e o cache nunca acertaria.
- **Consequências:**
  - Um papel com `$NOW` na permissão fica correto, mas sem cache.
  - Os testes de contrato cobrem o fuso em cada banco (P-13).

## D-032 — Relatório é documento: quem o lê vê tudo o que está nele

- **Estado:** aceita em 24/09/2026.
- **Onde:** §7.8 (armazenamento), §7.9 · V-58.
- **Contexto:** o relatório é uma cópia congelada dos dados. Compartilhado, ele mostra o que a Maria pôde ver a quem não poderia. O PDF em Arquivos fica ao alcance de quem lê a biblioteca inteira. E a página de verificação precisa ser pública, porque quem lê o QR code nem sempre tem conta no Directus.
- **Decisão:**
  - Quem pode ler o relatório lê tudo o que está nele. Quem decide é a permissão do Directus na coleção de relatórios.
  - A visibilidade começa em "só o dono", e abrir para o papel ou para todos pede confirmação com aviso.
  - PDF e imagens ficam numa pasta própria, fora do alcance dos papéis comuns por uma política pronta, e o download passa pelo endpoint da extensão, que confere a permissão no relatório.
  - A página de verificação é pública e só confirma: válido ou não, hash, data, versão e assinatura.
- **Alternativas descartadas:**
  - Refiltrar o conteúdo pela permissão de quem abre: o documento mudaria de leitor para leitor, e o hash deixaria de bater.
  - Só deixar compartilhar com quem tem as mesmas permissões: a extensão teria de comparar regras de permissão, contra a D-001.
  - Verificação com login: quem recebe o PDF impresso, como um juiz, não teria como conferir.
- **Consequências:** o painel de saúde avisa quando algum papel consegue ler a pasta dos relatórios.

## D-033 — Arquivos na evidência: cópia com hash, só do que a captura mostra

- **Estado:** aceita em 24/09/2026.
- **Onde:** §7.9 · V-52.
- **Contexto:** a captura congela os valores dos itens, mas o valor de um campo de arquivo é só o id, e o Directus permite trocar o conteúdo mantendo o mesmo id. A evidência mudaria sem ninguém perceber. A extensão não sabe o que o item representa: o arquivo pode ser a foto de uma ocorrência, a imagem de uma leitura ou um documento.
- **Decisão:**
  - Na hora da captura, a extensão copia para a pasta dos relatórios os arquivos dos campos que a camada mostra, e o SHA-256 de cada cópia entra no hash da captura. A captura aponta para a cópia.
  - No PDF, as imagens aparecem em miniatura, e todo arquivo aparece com nome e hash. Os arquivos inteiros ficam na pasta.
  - Um máximo de arquivos e de tamanho por relatório, na configuração da instalação, limita as cópias. Acima dele, fica só o hash, com aviso.
- **Alternativas descartadas:**
  - Só a referência: o arquivo pode ser trocado depois.
  - Só o hash: detecta a troca, mas não mostra o original.
  - Copiar todos os arquivos do item: traria arquivos que ninguém viu na tela e encheria o disco.
- **Consequências:** o espaço em disco dos relatórios cresce com as imagens, e o limite da instalação o controla.

## D-034 — Verificação do arquivo pelo upload, com dois hashes e ciclo de vida

- **Estado:** aceita em 24/09/2026. Complementa a D-021. O ciclo de vida ganha o estado "removido" pela D-038.
- **Onde:** §7.9.
- **Contexto:** a verificação conferia o registro e o QR, mas não o arquivo em si. O QR não pode carregar o hash do próprio PDF em que está impresso, porque escrevê-lo no arquivo muda o arquivo. As ideias vieram em parte de um relatório de acessos que o autor já fez: prévia sem autenticidade, token aleatório no QR, código legível, hash por subtração, ciclo de vida e rota pública sem vazamento.
- **Decisão:**
  - Dois hashes: o do conteúdo, por subtração e listado no PDF, e o do arquivo, calculado sobre os bytes do PDF final (depois da assinatura, quando há) e guardado no registro.
  - A página de verificação confere o estado pelo token aleatório do QR e o arquivo pelo upload do PDF, comparando o SHA-256 do que recebeu com o hash do arquivo. Sem o QR, acha o relatório pelo hash.
  - Cada relatório tem um código legível e único e um estado: válido, revogado ou substituído, sem apagar a trilha e sem ciclos.
  - A prévia não tem código, token, hash nem QR.
  - Token inexistente e erro interno recebem a mesma resposta, e a página lê só as colunas de que precisa.
- **Alternativas descartadas:**
  - Conferir só o conteúdo: um PDF alterado com os mesmos dados de cabeçalho passaria.
  - O id do relatório no QR: permitiria descobrir relatórios tentando ids.
  - Prévia com marca d'água sobre um documento com QR e hash de verdade: poderia ser apresentada como oficial.
- **Consequências:** um PDF salvo de novo, mesmo sem alteração visível, não confere, e a página explica o motivo.

## D-035 — Acompanhar um objeto ao vivo, com o canal ao vivo na API

- **Estado:** aceita em 24/09/2026. Detalha a D-014 e a D-016.
- **Onde:** §7.2, §7.3 (grupo 5), §7.8 (API e SDK) · V-12.
- **Contexto:** o tempo real mandava as posições novas ao mapa, e as configurações de trajeto valiam para a camada ao vivo, mas faltavam três coisas para rastrear um objeto: o "seguir" só existia no playback e na navegação pelo teclado; nada dizia como a linha do trajeto cresce a cada pulso; e o canal ao vivo não estava na API, então um app de fora não conseguia acompanhar um objeto em tempo real.
- **Decisão:**
  - O "seguir" vale também na camada ao vivo: o objeto fica no centro a cada pulso. Arrastar o mapa desliga o seguir, e um botão o religa.
  - Numa coleção com configurações de trajeto, a camada ao vivo desenha o rastro de cada objeto, por padrão os últimos 30 min, ajustável na camada. As regras do trajeto valem a cada pulso: o trecho cresce, a lacuna fica aberta enquanto o objeto está sumido ("sem posição há 12 min"), e o ponto suspeito é marcado na hora.
  - A ação "Acompanhar ao vivo", num item, cria a camada ao vivo filtrada no objeto dele, com o rastro e o seguir ligados.
  - O canal ao vivo entra na API, em `GET /geospatial/live?q=id1,id2`, por SSE e no contrato OpenAPI, e no SDK, como o iterador `geoLive()`. Há limite de conexões por usuário e, no papel público, por IP. O SDK manda o token no cabeçalho. O `access_token` na URL (V-12) também funciona, mas a documentação recomenda o cabeçalho, porque a URL costuma ficar gravada em log.
- **Alternativas descartadas:**
  - Uma tela própria de rastreamento: duplicaria o mapa, quando rastrear é uma camada.
  - O canal só no Studio: quem integra teria de pedir a posição a cada segundo pela rota de itens, multiplicando as consultas.
  - WebSocket: descartado na D-014.
- **Consequências:** a rota `/live` e o formato das mensagens entram no contrato público (D-016). A permissão é reaplicada a cada pulso também para quem integra, como no Studio.

## D-036 — Trabalhos em segundo plano num executor só, com retomada

- **Estado:** aceita em 24/09/2026.
- **Onde:** §7.3 (grupo 4), §7.6, §7.8 (trabalhos em segundo plano), §7.9 · V-30, V-53.
- **Contexto:** a criação de índice, a exportação grande, as ações sobre o resultado inteiro, o "Resultado inteiro" do Flow e a geração de relatórios, inclusive os agendados, rodam em segundo plano, e cada um estava descrito à parte. Nenhum dizia o que acontece se o Directus reiniciar no meio, ou se duas instâncias pegarem o mesmo trabalho.
- **Decisão:**
  - Um executor de trabalhos da extensão. Cada trabalho é um registro na coleção `geospatial_jobs`, com o tipo, o dono, o estado (na fila, rodando, concluído, falhou, cancelado ou interrompido), o progresso e o ponto de retomada.
  - Uma trava com prazo decide quem roda: a instância renova a trava enquanto trabalha e, se cair, outra retoma do último ponto salvo. A trava é um `UPDATE` condicional no próprio banco, o que funciona em todos os bancos, sem exigir Redis.
  - O trabalho anda em lotes que podem rodar de novo sem duplicar nada, com o ponto de retomada gravado a cada lote. O que não dá para retomar fica "interrompido", com notificação, como o índice criado com `CONCURRENTLY`, que fica inválido e é refeito.
  - Cada lote roda com a permissão de quem pediu, conferida de novo na retomada (D-001).
  - Progresso, cancelamento e notificação pela mesma rota e pela mesma tela, para todos os tipos. Os trabalhos usam o pool próprio, com a prioridade mais baixa da fila (D-006).
  - A coleção não registra atividade nem revisões, para o progresso não encher o histórico do Directus.
- **Alternativas descartadas:**
  - Cada funcionalidade com o próprio segundo plano: cinco formas de recuperar, e o reinício continuaria sem dono.
  - BullMQ, a fila sobre Redis: exigiria o Redis mesmo com uma instância só, e ele só é obrigatório com várias (D-015, V-30).
  - pg-boss, a fila sobre o Postgres: não serve aos outros bancos.
  - Flows agendados como executor: sem progresso nem retomada, e o registro dos Flows gravaria cada execução inteira (V-53).
- **Consequências:** a coleção `geospatial_jobs` entra nas coleções da extensão (D-015). Um reinício nunca deixa um trabalho pela metade em silêncio: ele é retomado ou fica "interrompido", com aviso. O executor nasce na F06, com a criação de índice.

## D-037 — Versões: a major atual a partir do piso testado, e a última minor das majors anteriores

- **Estado:** aceita em 24/09/2026. Substitui a D-018.
- **Onde:** §7.4 (testes), §7.5 · V-29, V-34, V-35, V-60, V-61.
- **Contexto:** a D-018 prometia todo o 12 (`^12.0.0`), mas a matriz testava só a última minor, e os internos usados pela D-001 podem mudar entre minors. Ela também tirava o 11 quando o 13 chegasse. Só que o 11 e o 12 têm licenças diferentes (V-60, V-61), e muita gente fica no 11 por causa disso.
- **Decisão:**
  - A faixa é a major atual a partir do piso testado, mais a última minor de cada major anterior que continua na política. Hoje, `^11.17.0 || ^12.4.0`; quando sair o 13, `^11.17.0 || ^12.<última minor> || ^13.<piso>`.
  - O piso é a minor mais antiga que a matriz testa, e a matriz testa o piso e a mais nova, na última correção de cada minor. O piso só desce com teste, e o canário testa cada minor nova assim que ela sai.
  - Uma major anterior fica enquanto a matriz inteira passar nela. Tirá-la exige uma decisão nova e o aviso de descontinuação publicado numa minor antes, e a última versão compatível continua instalável pelo npm e pela imagem Docker.
  - O que depender de algo novo de uma major mais recente aparece como indisponível nas anteriores, com o motivo. A matriz de capacidades passa a considerar também a versão do Directus.
  - Na CI, o pull request roda a versão mais antiga e a mais nova da faixa, e a noite roda a faixa inteira.
  - Como na D-018: os bancos seguem a política LTS (a mínima é a mais antiga que o fabricante ainda suporta, e a matriz testa a mínima e a mais nova); o PostGIS é uma versão ainda mantida pelo projeto, nunca abaixo da 3.1; e o navegador precisa de WebGL2.
- **Alternativas descartadas:**
  - Manter `^12.0.0` sem testar o 12.0: promete o que ninguém conferiu.
  - Testar todas as minors: a matriz cresce todo mês, e cada minor antiga pede um caso no adaptador.
  - Tirar o 11 quando o 13 chegar, como na D-018: cortaria quem ficou no 11 por causa da licença.
  - Uma linha separada da extensão para o 11: o Marketplace só mostra a última versão de cada extensão (V-34), e duas linhas dobram o trabalho de cada correção.
- **Consequências:** todo release precisa valer para a faixa inteira, porque o Marketplace só oferece a última versão. O 11 parou de ganhar minors, e a última é a 11.17 (V-35), então o adaptador dele quase não muda: o custo de mantê-lo é a matriz, mais as alternativas para o que for novo.

## D-038 — Dados pessoais: retenção configurável, remoção com registro mínimo e o que sai da instalação à vista

- **Estado:** aceita em 24/09/2026. Acrescenta o estado "removido" ao ciclo de vida da D-034.
- **Onde:** §7.8, §7.9, §7.10.
- **Contexto:** placa, posição, trajeto e ocorrência são dado pessoal (LGPD, GDPR), e o desenho não tratava disso. A extensão cria lugares onde o dado fica guardado (capturas, relatórios, links compartilhados, consultas registradas, trabalhos e cache), e dois caminhos mandam dado para fora da instalação: a busca de endereço, que manda ao provedor o texto buscado ou a coordenada, e o mapa de fundo, que pede os tiles da área vista, com o IP de quem olha.
- **Decisão:**
  - A arquitetura mapeia o que a extensão guarda, onde, por quanto tempo e como apagar, e os caminhos que saem da instalação. Quem controla os dados é quem opera a instalação; a extensão não decide base legal.
  - Retenção configurável na instalação, com a limpeza periódica feita pelo executor de trabalhos (D-036). Os padrões: a captura que não entrou num relatório gerado, 90 dias; o link compartilhado, sem vencimento, com a opção de vencer; o trabalho concluído, 30 dias. As cópias de arquivos de uma captura descartada saem junto com ela.
  - O relatório gerado só sai por ação do admin. As capturas, o PDF e as cópias de arquivos são apagados, e fica um registro mínimo, com o código, as datas, o hash e o motivo. O relatório passa ao estado "removido", e a página de verificação responde "relatório removido".
  - O guia do admin traz o mapa do que é guardado, e recomenda um provedor de endereço próprio e o PMTiles onde o dado não pode sair da rede.
- **Alternativas descartadas:**
  - Deixar tudo com quem opera: a extensão cria esses lugares, e ninguém apaga o que não sabe que existe.
  - Anonimizar sozinho depois de um prazo: mudaria a evidência e quebraria o hash.
  - Apagar o relatório sem deixar registro: a verificação de um PDF que ainda circula responderia "não existe", como se ele fosse falso.
- **Consequências:** o ciclo de vida do relatório ganha o estado "removido". A retenção e a limpeza nascem na F06, a remoção do relatório vem na F13, e o capítulo do guia, na F16.

## D-039 — Inventário do que a extensão cria, e uma ação para remover

- **Estado:** aceita em 24/09/2026. Complementa a D-008.
- **Onde:** §7.3 (grupo 5), §7.8 (armazenamento) · V-25.
- **Contexto:** a extensão cria objetos fora das próprias coleções: a função e os gatilhos do `LISTEN/NOTIFY` e os índices nas tabelas do usuário, as políticas prontas e a pasta dos relatórios, além das coleções `geospatial_*`. Desinstalada, os gatilhos continuam disparando a cada gravação sem ninguém escutando, e as políticas continuam dando permissões. E nada listava o que tinha sido criado.
- **Decisão:**
  - Toda ação do admin que cria algo grava um registro no inventário da extensão, com o objeto, o SQL ou as permissões aplicadas e como desfazer. O inventário generaliza o histórico dos índices criados, e o painel de saúde o mostra.
  - A ação "Remover o que a extensão criou" mostra a lista e o que vai rodar. Por padrão, remove a função, os gatilhos e as políticas prontas. Os índices ficam, porque ajudam o próprio Directus (V-25) e custam caro para recriar, com a opção de removê-los. As coleções da extensão e a pasta dos relatórios só saem com confirmação digitada, porque guardam visões, relatórios e evidência.
  - O guia do admin traz o roteiro de desinstalação (rodar a ação antes de remover a extensão) e o SQL para quem já desinstalou sem rodá-la.
  - Os objetos criados no banco levam o prefixo `geospatial_`.
- **Alternativas descartadas:**
  - Só documentar o SQL de remoção: depende de o admin achar e rodar à mão, e nada diz o que foi criado naquela instalação.
  - Apagar tudo sozinho na desinstalação: depois de desinstalada, a extensão não roda mais código, e apagar relatório sem pedir destrói evidência.
  - Remover os índices por padrão: tiraria desempenho do próprio Directus.
- **Consequências:** o inventário e a ação nascem na F06, com a primeira ação do admin, e cada ação das fases seguintes entra neles. O roteiro de desinstalação vai para o guia na F16.

## D-040 — Repositório aberto no fim da F00, antes da publicação

- **Estado:** aceita em 25/09/2026. Complementada pela D-041: a proteção vale para o `develop` e para o `main`.
- **Onde:** plano de implementação (F00, F16 e portões) · V-66, V-70, V-72, V-75, V-76, V-77 · A-001.
- **Contexto:** o plano mantinha o repositório privado até a F16, para abrir junto com a publicação no npm. Num repositório privado de conta pessoal no plano Free, o `main` não tem proteção nem CI obrigatória (V-66), não existem CodeQL, secret scanning nem Scorecard (V-75, V-76), o SonarQube Cloud e o Codecov têm limites (V-70, V-72), e os minutos do Actions são uma cota que a matriz de testes consome rápido (V-77). O projeto também vai para o portfólio público do autor, e o processo (decisões, verificações e pull requests com CI) é parte do que ele mostra.
- **Decisão:**
  - O repositório fica público no fim da F00, depois do portão de abertura do índice do plano.
  - Na abertura, o `main` ganha a proteção (sem push direto, com a CI e o título do pull request obrigatórios), e ligam-se o CodeQL, o secret scanning e o Scorecard.
  - A publicação no npm e no Marketplace continua na F16, com a extensão completa (princípio 1). Até lá, o README diz o estado real do projeto.
- **Alternativas descartadas:**
  - Abrir só na F16: o `main` ficaria sem proteção e o repositório sem as ferramentas de segurança durante todo o desenvolvimento, e a CI disputaria minutos.
  - Assinar o GitHub Pro: resolveria só a proteção do `main`, porque CodeQL e secret scanning em repositório privado exigem uma organização paga (V-75).
  - Abrir antes da F00: o portão de abertura e a CI ainda não existem.
- **Consequências:**
  - O desenvolvimento acontece em público, e o `CONTRIBUTING.md` diz o que se aceita de fora enquanto a extensão não fica pronta.
  - O critério da F00 que pede o pull request bloqueado na CI é conferido depois da abertura, no fim da própria fase.
  - Abrir não se desfaz: o que ficou público pode ter sido copiado. Por isso o `gitleaks` roda sobre o histórico inteiro antes.

## D-041 — Ramos com o `develop`: as issues voltam para ele, e ele vai para o `main` no fim de cada fase

- **Estado:** aceita em 25/09/2026. Muda o fluxo de ramos do `git-e-entrega.md`, que era baseado no tronco.
- **Onde:** `docs/padroes/git-e-entrega.md` · V-64 · V-72 · V-83 · P-22 · P-23.
- **Contexto:** o padrão previa o desenvolvimento no tronco: cada issue num ramo curto, com pull request direto para o `main`. O mantenedor preferiu um ramo de integração, o `develop`, criado em 25/09/2026, para as issues se juntarem nele antes de chegar ao `main`.
- **Decisão:**
  - Cada issue nasce num ramo a partir do `develop` atualizado, antes da primeira edição, com o nome no padrão Conventional Branch (V-83), e volta para o `develop` por pull request, com squash. O `develop` fica com um commit por issue.
  - O `develop` vai para o `main` no fim de cada fase, por um pull request com merge commit, e o `main` recebe a tag da fase (por exemplo, `f00-done`). É o único merge commit do projeto, porque o squash e o rebase fariam o `develop` e o `main` divergirem.
  - Os dois ramos são protegidos desde a abertura (D-040), sem push direto nem forçado.
- **Alternativa descartada:** o tronco só com o `main`, que era o padrão. É mais simples, mas o `main` receberia cada issue assim que ela entrasse, sem um ponto de fechamento por fase.
- **Consequências:**
  - O `develop` passa a ser o ramo padrão do GitHub, para os pull requests nascerem apontando para ele.
  - O SonarQube Cloud gratuito só analisa o pull request cujo destino é o branch principal do projeto (V-72), então o branch principal dele passa a ser o `develop` (P-22).
  - O tipo de merge fica fixado por ramo, só squash no `develop` e só merge commit no `main`, pelos rulesets depois da abertura (P-23). Até lá, vale a disciplina.
  - A CI roda nos pushes e nos pull requests dos dois ramos, a noite roda no `develop`, e o Renovate abre os pull requests contra o `develop`.
  - Na F16, a publicação decide como o Changesets anda entre os dois ramos, inclusive a volta do `main` para o `develop` depois do commit de versão.

## D-042 — O `capabilities` só para quem tem sessão, e o banco só para o admin

- **Estado:** aceita em 25/09/2026.
- **Onde:** §7.4 (API e SDK) · `docs/padroes/api-e-contrato.md` · V-103.
- **Contexto:** o `GET /geospatial/capabilities` devolve a matriz de capacidades, que o Studio usa para esconder a operação indisponível, e as versões do banco, da extensão espacial e do Directus, que o admin usa no painel de saúde e o suporte usa para diagnosticar. Para quem ataca, as versões são uma impressão digital: com a versão exata, ele procura a falha conhecida dela. O próprio Directus mostra a versão dele só para quem tem sessão, e o banco em uso só para o admin (V-103).
- **Decisão:**
  - O pedido sem usuário recebe o `FORBIDDEN` do Directus, antes de a extensão consultar o banco.
  - O usuário com sessão vê a matriz e as versões da API, da extensão e do Directus.
  - Só o admin vê também o banco e a extensão espacial, com as versões.
  - A resposta do usuário que não é admin lista o que leva, e não o que tira, para um campo novo só de admin não vazar por esquecimento.
- **Alternativas descartadas:**
  - Qualquer usuário com sessão vê tudo: entregaria a versão do banco e do PostGIS a todo papel, o que o Directus evita.
  - A matriz pública, para um mapa público saber o que pode chamar: fechar depois quebraria quem passasse a depender dela. Começar fechado deixa a abertura compatível.
- **Consequências:**
  - Um front-end público não consegue ler a matriz. Se esse caso aparecer, liberar a matriz para o anônimo é mudança compatível, com decisão própria.
  - O critério da F00-04 confere o banco e o PostGIS com o token de um admin.
  - O painel de saúde (admin) e o `geoCapabilities()` do SDK leem a mesma rota, e o SDK trata o `FORBIDDEN` como erro tipado.

## D-043 — O Directus 12 nos testes com a chave do Open Innovation Grant

- **Estado:** aceita em 26/09/2026.
- **Onde:** §7.4 (testes), §7.5 · V-114, V-115, V-116 · P-26 · D-017, D-037.
- **Contexto:** sem chave, o Directus 12 roda no tier Core, que não aceita regra de permissão própria (V-114). A Maria, que só lê a zona sul, não existe num 12 sem chave, então a paridade com filtro por linha (D-017) e a prova dos internos do 12 com a Maria, na F01 e na F02, não rodariam nele. A chave do Open Innovation Grant libera essas regras, mas cada banco novo que a recebe gasta uma das 5 ativações dela (V-115), e a suíte de integração cria um banco por rodada.
- **Decisão:**
  - O mantenedor tem uma chave do OIG, pedida em 26/09/2026, guardada no gerenciador de senhas dele e no segredo `DIRECTUS_LICENSE_KEY` do GitHub. A chave nunca vai para o repositório nem para um log.
  - O Directus 12 licenciado nos testes sobe sempre sobre o mesmo banco base, já ativado, com a mesma `PUBLIC_URL`, e assim todas as rodadas usam uma ativação só. O banco base é criado uma vez, por um script, e a P-26 decide onde ele fica.
  - Uma trava no código: o Directus 12 só recebe a chave depois de restaurar o banco base. Um banco novo nunca a recebe.
  - Sem a chave, o 12 roda no Core: tudo menos as regras próprias, mais um teste que prova que o Core as recusa e que falha quando o Directus mudar isso. É o caso dos pull requests de fora, que não recebem os segredos, e de quem clona o projeto.
  - As 5 ativações: uma para os testes com PostGIS, uma para o `pnpm dev`, uma para a demo pública e duas de reserva. O SQLite no 12 roda no Core, a menos que uma decisão use uma reserva.
  - Antes de apagar um Directus licenciado, a licença é desativada.
- **Alternativas descartadas:**
  - Só o Core no 12: a paridade com filtro por linha e a prova dos internos do 12 ficariam sem teste, e o 12 é a major atual.
  - Tirar o 12 dos testes até a licença para CI descartável sair: a faixa da D-037 prometeria uma versão sem teste, e o adaptador do 12 ficaria para o fim, com todas as diferenças de uma vez.
  - Uma instância licenciada fixa para os testes: tira os testes dos containers (D-017) e exige um servidor sempre de pé.
  - Uma licença comercial: paga, quando o OIG cobre o projeto.
- **Consequências:**
  - Os testes licenciados dependem do `licensing.directus.com`. Com ele fora do ar, o job do 12 licenciado falha, e o do Core continua.
  - Pull requests de fora não rodam as regras próprias no 12; os do mantenedor e a rodada da noite rodam.
  - A documentação de quem instala diz que a regra por linha no Directus 12 depende da licença do Directus, e que a extensão obedece ao que o Directus aplicar, com ou sem ela.
  - As coleções da extensão contam no limite de 25 coleções do Core (V-114), e o desenho delas leva isso em conta.
  - Quando o Directus lançar a licença para CI descartável, o banco base pode sair, com uma decisão nova.
