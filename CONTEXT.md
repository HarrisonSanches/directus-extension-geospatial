# Glossário

> A linguagem do domínio da extensão, em português e com o termo canônico em inglês, que é o usado no código, na API e na documentação pública.
> Só entram termos com significado para quem opera ou administra a extensão, sem detalhes de implementação. Termo resolvido entra aqui na hora (skill `grill-with-docs`).

## Mapa e camadas

| Termo | Em inglês | O que é |
|---|---|---|
| Superfície | Surface | Um dos lugares onde a extensão aparece para o usuário: layout, módulo, painel ou operação de Flow. A API e o SDK não são superfícies, e sim acesso por código ao mesmo motor. Não confundir com **forma**. |
| Camada | Layer | Uma fonte de dados no mapa: uma coleção (com o campo de geometria e o filtro dela), o resultado de uma operação ou as formas desenhadas pelo usuário. Tem estilo, agrupamento e contagem próprios. |
| Mapa de fundo | Basemap | O mapa por baixo das camadas (ruas, satélite, claro, escuro). |
| Grupo | Cluster | No mapa, o círculo com a contagem dos itens que caíram na mesma célula da tela. Não confundir com **foco**. |
| Agrupamento por células | Cell clustering | A regra que junta num grupo os itens que ficam muito perto na tela, conforme o zoom. As células são da tela e medidas em pixels. Não confundir com as **células da grade** de densidade. |
| Camada de destaque | Highlight layer | A camada, por cima de todas, que mostra sozinhos o item atual e os selecionados, mesmo quando eles estão dentro de um grupo. |
| Visão | View | Um conjunto salvo de camadas, filtros, mapa de fundo e enquadramento, no módulo. |
| Ao vivo | Live | Uma camada que recebe as mudanças em tempo real. |
| Pulso | Tick | O intervalo em que as mudanças ao vivo são juntadas e enviadas de uma vez. |
| Seguir | Follow | Manter no centro do mapa o item atual ou o objeto acompanhado, a cada passo da navegação ou a cada pulso do ao vivo. Arrastar o mapa desliga. |
| Rastro | Trail | O trecho recente do trajeto desenhado atrás de um objeto que se move, no ao vivo e no playback. No ao vivo, o padrão são os últimos 30 min. |
| Janela de tempo | Time window | O intervalo de datas que filtra as camadas que têm campo de data. Pode ser relativa ("últimas 24 h"), resolvida uma vez no registro da consulta, ou absoluta. A captura e o relatório guardam sempre a absoluta. |
| Hora de recebimento | Received time | A hora em que uma posição chegou ao servidor, que pode ser bem depois da hora da posição. É opcional na configuração da coleção e serve só para mostrar o atraso; as regras usam a hora da posição. |
| Fuso dos dados | Data time zone | O fuso em que foram gravados os horários de um campo sem fuso (`dateTime`), definido na configuração da coleção. |
| Playback | Playback | A animação que move a janela de tempo e mostra os itens e trajetos se deslocando. |

## Operações e resultados

| Termo | Em inglês | O que é |
|---|---|---|
| Operação | Operation | Uma análise espacial do catálogo: raio, por área, medir, mais próximos, trajeto, corredor, contagem por região, cerca virtual, grade de densidade ou focos, além das operações de forma. |
| Operação de forma | Shape operation | Uma operação que recebe itens ou formas e produz só formas, para servir de entrada a outra operação ou virar um item novo: entorno, centro e simplificar. |
| Entorno | Buffer | A área a até uma distância de cada item ou forma. O raio e o corredor já trazem o entorno de um ponto e o de uma linha, junto com os itens de dentro. |
| Centro | Center | Um ponto em cada item ou forma: o centro geométrico ou, quando ele cai fora da forma, um ponto garantidamente dentro dela. |
| Simplificar | Simplify | Reduzir os vértices de uma forma, dentro de uma tolerância em metros, sem torná-la inválida. |
| Raio | Radius | Os itens a até uma distância de um ponto. |
| Por área | By area | Os itens que tocam, ficam inteiramente dentro ou ficam fora de uma área: uma área desenhada ou uma forma existente, como um entorno, o contorno de um foco, uma região ou uma célula da grade. |
| Área desenhada | Drawn area | A forma que o usuário desenha no mapa, com o polígono ou o desenho livre, para usar na operação por área. |
| Toca | Intersects | O sentido padrão de "dentro": qualquer parte do item está na área ou a até a distância, com a borda incluída. Não é o *touches* do padrão OGC, que é só encostar na borda. |
| Inteiramente dentro | Fully within | A opção em que o item inteiro precisa estar na área ou a até a distância, contando a borda. Só muda algo em linhas e polígonos. |
| Fora | Outside | A opção que pega os itens que não tocam a área. |
| Medir | Measure | A distância entre itens ou pontos, ou a área e o perímetro de um polígono. |
| Mais próximos | Nearest | Os N itens mais perto de um ponto ou de um item. |
| Trajeto | Trajectory | A linha que liga, em ordem de tempo, os pontos de um mesmo objeto, que podem vir de várias camadas. Quebra em trechos quando falta posição por mais tempo que o limite do trecho. |
| Objeto | Tracked object | Quem se move e deixa pontos com data: um veículo, uma placa, um aparelho. A configuração da coleção diz qual campo o identifica. |
| Origem | Origin | Cada coleção que traz pontos para o trajeto de um objeto, como uma câmera fixa, o leitor de uma viatura, um avistamento ou um rastreador. No mapa, cada origem tem um símbolo. |
| Trecho | Segment | Uma parte contínua do trajeto, sem lacuna. |
| Lacuna | Gap | O intervalo sem posição entre dois trechos. Aparece tracejada, com o tempo, a distância em linha reta e a velocidade mínima do salto, e a distância dela fica fora do total. |
| Ponto suspeito | Suspect point | Um ponto que exigiria velocidade acima da máxima, em relação ao último ponto válido. Também é suspeita a posição com hora no futuro. Pode ser erro de posição, erro de relógio, erro de leitura ou um identificador duplicado, como uma placa clonada. |
| Perfil de trajeto | Trajectory profile | Os valores prontos das configurações de trajeto, pelo ritmo em que as posições chegam: **contínuo** (*continuous*), para posições frequentes, e **esparso** (*sparse*), para posições de vez em quando. |
| Parada | Stop | Um período em que o objeto fica dentro de um raio pequeno por um tempo mínimo (no perfil contínuo, 50 m por 5 min). Aparece como um ponto no centro das posições, com início, fim e duração. |
| Parada provável | Probable stop | Uma lacuna em que o objeto reaparece perto de onde sumiu. Fica à parte das paradas vistas, porque ele pode ter saído e voltado. |
| Parada ociosa | Idle stop | Uma parada com o motor ligado, quando a camada tem campo de ignição. |
| Corredor | Corridor | A faixa de uma largura dada ao longo de uma linha, e os itens dentro dela. |
| Contagem por região | Count by region | Quantos itens caem em cada polígono de uma coleção de regiões (por exemplo, bairros). |
| Grade de densidade | Density grid | A contagem de itens em cada célula de uma grade (hexágonos ou quadrados). |
| Célula da grade | Grid cell | Um hexágono ou quadrado da grade de densidade, medido em metros no chão. Não confundir com as células da tela do **agrupamento por células**. |
| Foco | Hotspot | Um grupo de pontos próximos encontrado pela operação de focos, com o contorno dele. Não confundir com **grupo**. |
| Cerca virtual | Geofence | Uma área de uma coleção de cercas em que se registram as entradas e as saídas dos objetos. A operação de mesmo nome calcula essas visitas a partir do histórico de posições. |
| Visita | Visit | O período em que um objeto fica dentro de uma cerca virtual, da entrada à saída. No resultado, é o trecho do trajeto dentro da cerca. |
| Passagem estimada | Estimated pass | Uma visita deduzida da linha entre duas posições seguidas que atravessa a cerca sem nenhuma posição dentro. Só no perfil contínuo, e sempre marcada como estimada. |
| Vaivém | Flapping | Saídas e entradas rápidas na borda de uma cerca, causadas pela oscilação da posição. Uma saída seguida de nova entrada em menos de 1 min vira uma visita só. |
| Alerta de cerca | Geofence alert | O aviso na hora, pelo Flow, de que um objeto entrou numa cerca ou saiu dela. É o melhor que se sabia naquele momento; a versão definitiva é o cálculo sobre o histórico. |
| Resultado | Result | O que uma operação produz, em até três partes: **itens**, **formas** e **resumos**. Cada operação declara quais partes produz; o raio, por exemplo, produz os itens de dentro, o círculo e o total. |
| Resumo | Summary | A parte numérica de um resultado: contagens (total, por região, por célula da grade, por foco) e medidas (distância, área, perímetro, duração). |
| Forma | Shape | Uma geometria produzida por uma operação ou desenhada pelo usuário, como um círculo, uma faixa, um contorno de foco ou uma área desenhada. Não confundir com **superfície**. |
| Cadeia | Chain | Operações encadeadas, em que o resultado de uma é a entrada da próxima. |
| Descer | Drill down | Abrir uma região, uma célula da grade ou um foco para ver os itens de dentro. |
| Trilho | Breadcrumb | A linha no topo que mostra as etapas da cadeia e os níveis abertos ao descer. Clicar numa etapa volta a ela. |
| Consulta registrada | Registered query | A descrição completa de uma pergunta (coleções, filtros, busca, operação e geometria), registrada uma vez e identificada por um id curto. |
| Ordem natural | Natural order | A ordem da lista que faz sentido para cada operação: distância no raio, posição ao longo da linha no corredor, tempo no trajeto. |

## Permissões e administração

| Termo | Em inglês | O que é |
|---|---|---|
| Regra de ouro | Golden rule | Quem decide o que o usuário recebe é sempre a lógica de permissões do próprio Directus; a extensão nunca escreve regra de permissão própria (D-001). |
| Query permitida | Permitted query | A consulta que o Directus monta com tudo o que um usuário pode ver numa coleção, e em volta da qual a extensão acrescenta a parte espacial. |
| Matriz de capacidades | Capability matrix | O que cada operação consegue fazer no banco em uso: no banco com índice, no banco sem índice, no servidor com limite ou indisponível. |
| Disponível com limite | Capped | O estado de uma operação que roda no servidor da extensão, e não no banco, sobre um volume máximo. O resultado avisa quando o limite foi atingido. |
| Painel de saúde | Health panel | A tela do admin com a matriz de capacidades, a saúde dos índices, o inventário do que a extensão criou, os números da operação (tempo dos tiles, fila, cache, consultas lentas) e os avisos de segurança, como a pasta dos relatórios legível por outros papéis. |
| Saúde do índice | Index health | A checagem, feita em cada coluna de geometria e de data, e no par (objeto, data) das coleções com trajeto, de que existe o índice certo. |
| Configuração da coleção | Collection settings | O que descreve os dados de uma coleção, feito uma vez pelo admin e herdado por todas as camadas, visões, painéis, relatórios e Flows: campos padrão, trajeto, detecção de mudanças feitas fora do Directus e saúde dos índices. |
| Ação do admin | Admin action | Uma mudança no banco ou nas permissões (índice, coleção da extensão, política pronta, gatilho) que só acontece por um botão do admin, depois de ele ver o que vai mudar e confirmar. |
| Trabalho em segundo plano | Background job | Uma tarefa que demora mais que uma requisição, como criar um índice, exportar, editar ou apagar o resultado inteiro, ou gerar um relatório. Tem progresso e cancelamento, e retoma de onde parou se o Directus reiniciar. |
| Retenção | Retention | Por quanto tempo a extensão guarda o que ela mesma cria, como capturas soltas, links compartilhados e trabalhos concluídos, antes da limpeza periódica. É configurada na instalação. |
| Inventário | Inventory | A lista do que a extensão criou no banco e nas permissões (índices, gatilhos, políticas prontas, a pasta dos relatórios), com como desfazer cada item. A ação do admin "Remover o que a extensão criou" parte dela. |

## Relatórios

| Termo | Em inglês | O que é |
|---|---|---|
| Relatório de evidências | Evidence report | Um relatório montado aos poucos a partir de capturas e gerado em PDF, com hashes e verificação. |
| Página de verificação | Verification page | A página pública, aberta pelo QR code do PDF, que confere um relatório em duas etapas: o estado, pelo token do QR, e o arquivo, pelo upload do PDF. Não mostra dado das capturas nem nome de pessoa. |
| Hash do conteúdo | Content hash | O SHA-256 de tudo o que o relatório afirma, menos o bloco de autenticidade. Aparece no PDF. |
| Hash do arquivo | File hash | O SHA-256 dos bytes do PDF final. Fica no registro, e não no PDF, e é com ele que o upload é conferido. |
| Código do relatório | Report code | O código legível e único do relatório, como GEO-EVD-20260924-00017, para citação. |
| Estado do relatório | Report status | Válido, revogado (com quem, quando e por quê), substituído (apontando para a versão nova) ou removido (o admin apagou o conteúdo, e ficou só o registro mínimo, com o código, as datas, o hash e o motivo). |
| Prévia | Preview | A visualização do relatório antes de gerar, com a marca "PRÉVIA" e sem nenhum elemento de autenticidade. |
| Captura | Capture | O registro de um estado da tela: a imagem do mapa, os dados daquele momento, cópias com hash dos arquivos que ela mostra e o contexto (operação, filtros, janela de tempo, quem e quando). |
| Modelo de relatório | Report template | Um relatório que monta as seções sozinho a partir de parâmetros: cerca virtual, frota e trajeto, por região e período, focos, cobertura. |
| Cobertura | Coverage | A parte das ocorrências que fica a menos de uma distância dada de uma base ou de uma equipe. |

## Termos em aberto

- Nenhum no momento.
