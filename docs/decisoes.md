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

## D-003 — Quatro formas: layout, módulo, painel e operação de Flow

- **Estado:** aceita em 23/09/2026.
- **Onde:** §4, §7.3 (grupo 1), §7.8 · V-01 a V-07, V-20.
- **Contexto:** o mapa nativo não pode ser estendido, e cada tipo de extensão do Directus tem vantagens e limites diferentes.
- **Decisão:** a extensão aparece em quatro formas, todas sobre o mesmo núcleo e todas com várias camadas:
  - o layout, que herda a busca, os filtros, os bookmarks e as ações em lote da página;
  - o módulo, com várias coleções e visões salvas;
  - o painel, para dashboards;
  - a operação de Flow, para automação.
- **Alternativas descartadas:**
  - Só o layout: ficaria sem várias coleções.
  - Só o módulo: perderia os recursos da página da coleção.
  - Começar por uma forma e deixar as outras para depois: vai contra o princípio de extensão completa.
- **Consequências:** o layout aparece em toda coleção (com aviso quando não há geometria) e não consegue escrever no filtro da página. A extensão traz o próprio MapLibre.

## D-004 — Tiles vetoriais no banco, pedidos por consulta registrada

- **Estado:** aceita em 23/09/2026. Porta de mão única.
- **Onde:** §4.1, §7.1.
- **Contexto:** os volumes são grandes (500 mil itens num raio). A ideia do handoff era somar páginas de pontos no mapa.
- **Decisão:**
  - Tiles MVT montados com `ST_AsMVT` em volta da query permitida.
  - A interface registra a consulta uma vez, com um id que é o hash do conteúdo, e pede por esse id os tiles, a lista, a contagem e a exportação.
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

- **Estado:** aceita em 23/09/2026.
- **Onde:** §7.1 · V-24 · P-08.
- **Contexto:** tiles e análises podem sobrecarregar o banco e travar o próprio Directus.
- **Decisão:**
  - Um pool de conexões próprio (bulkhead), que pode apontar para uma réplica de leitura.
  - Uma fila com prioridade e limite por usuário.
  - Um tempo máximo por tipo de consulta; o tile que estoura aparece hachurado.
  - Cancelamento de ponta a ponta, até o Postgres.
  - Chave de cache formada pelo SQL compilado pelo Directus, a versão da coleção e o tile.
- **Alternativas descartadas:**
  - Usar o pool do Directus.
  - Cache por usuário: desperdiça espaço.
  - Cache sem a permissão na chave: vaza dados.
- **Consequências:** quem tem exatamente as mesmas permissões compartilha o cache e os pulsos de tempo real. O SQL ser determinístico vira teste automatizado.

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

- **Estado:** aceita em 23/09/2026.
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
- **Consequências:** o gatilho existe só no Postgres (entra na matriz de capacidades), e o campo de data não enxerga exclusões.

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
    - a consulta registrada (`POST /geospatial/queries`, mais tiles, lista, contagem e exportação).
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

- **Estado:** aceita em 23/09/2026.
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

- **Estado:** aceita em 23/09/2026. Porta de mão única.
- **Onde:** §7.5.
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
