# Glossário

> A linguagem do domínio da extensão, em português e com o termo canônico em inglês, que é o usado no código, na API e na documentação pública.
> Só entram termos com significado para quem opera ou administra a extensão, sem detalhes de implementação. Termo resolvido entra aqui na hora (skill `grill-with-docs`).

## Mapa e camadas

| Termo | Em inglês | O que é |
|---|---|---|
| Camada | Layer | Uma fonte de dados no mapa: uma coleção (com o campo de geometria e o filtro dela), o resultado de uma operação ou as formas desenhadas pelo usuário. Tem estilo, agrupamento e contagem próprios. |
| Mapa de fundo | Basemap | O mapa por baixo das camadas (ruas, satélite, claro, escuro). |
| Grupo | Cluster | No mapa, o círculo com a contagem dos itens que caíram na mesma célula da tela. Não confundir com **foco**. |
| Agrupamento por células | Cell clustering | A regra que junta num grupo os itens que ficam muito perto na tela, conforme o zoom. |
| Camada de destaque | Highlight layer | A camada, por cima de todas, que mostra sozinhos o item atual e os selecionados, mesmo quando eles estão dentro de um grupo. |
| Visão | View | Um conjunto salvo de camadas, filtros, mapa de fundo e enquadramento, no módulo. |
| Ao vivo | Live | Uma camada que recebe as mudanças em tempo real. |
| Pulso | Tick | O intervalo em que as mudanças ao vivo são juntadas e enviadas de uma vez. |
| Janela de tempo | Time window | O intervalo de datas que filtra as camadas que têm campo de data. |
| Playback | Playback | A animação que move a janela de tempo e mostra os itens e trajetos se deslocando. |

## Operações e resultados

| Termo | Em inglês | O que é |
|---|---|---|
| Operação | Operation | Uma análise espacial do catálogo: raio, área desenhada, medir, mais próximos, trajeto, corredor, contagem por região, grade de densidade ou focos. |
| Raio | Radius | Os itens a até uma distância de um ponto. |
| Área desenhada | Drawn area | Os itens dentro de um polígono desenhado ou já existente. |
| Medir | Measure | A distância entre itens ou pontos, ou a área e o perímetro de um polígono. |
| Mais próximos | Nearest | Os N itens mais perto de um ponto ou de um item. |
| Trajeto | Trajectory | A linha que liga, em ordem de tempo, os pontos de um mesmo objeto (por exemplo, um veículo). |
| Corredor | Corridor | A faixa de uma largura dada ao longo de uma linha, e os itens dentro dela. |
| Contagem por região | Count by region | Quantos itens caem em cada polígono de uma coleção de regiões (por exemplo, bairros). |
| Grade de densidade | Density grid | A contagem de itens em cada célula de uma grade (hexágonos ou quadrados). |
| Foco | Hotspot | Um grupo de pontos próximos encontrado pela operação de focos, com o contorno dele. Não confundir com **grupo**. |
| Cerca virtual | Geofence | Uma área em que se registra quando um item entra e quando sai. |
| Resultado | Result | O que uma operação produz: **itens**, **formas** ou **resumos** (contagens por região, célula ou foco). |
| Cadeia | Chain | Operações encadeadas, em que o resultado de uma é a entrada da próxima. |
| Consulta registrada | Registered query | A descrição completa de uma pergunta (coleções, filtros, busca, operação e geometria), registrada uma vez e identificada por um id curto. |
| Ordem natural | Natural order | A ordem da lista que faz sentido para cada operação: distância no raio, posição ao longo da linha no corredor, tempo no trajeto. |

## Permissões e administração

| Termo | Em inglês | O que é |
|---|---|---|
| Regra de ouro | Golden rule | Quem decide o que o usuário recebe é sempre a lógica de permissões do próprio Directus; a extensão nunca escreve regra de permissão própria (D-001). |
| Query permitida | Permitted query | A consulta que o Directus monta com tudo o que um usuário pode ver numa coleção, e em volta da qual a extensão acrescenta a parte espacial. |
| Matriz de capacidades | Capability matrix | O que cada operação consegue fazer no banco em uso: no banco com índice, no banco sem índice, no servidor com limite ou indisponível. |
| Disponível com limite | Capped | O estado de uma operação que roda no servidor da extensão, e não no banco, sobre um volume máximo. O resultado avisa quando o limite foi atingido. |
| Painel de saúde | Health panel | A tela do admin com a matriz de capacidades, a saúde dos índices e os números da operação (tempo dos tiles, fila, cache, consultas lentas). |
| Saúde do índice | Index health | A checagem, feita em cada coluna de geometria e de data, de que existe o índice certo. |
| Ação do admin | Admin action | Uma mudança no banco ou nas permissões (índice, coleção da extensão, política pronta, gatilho) que só acontece por um botão do admin, depois de ele ver o que vai mudar e confirmar. |

## Relatórios

| Termo | Em inglês | O que é |
|---|---|---|
| Relatório de evidências | Evidence report | Um relatório montado aos poucos a partir de capturas e gerado em PDF, com hashes e verificação. |
| Captura | Capture | O registro de um estado da tela: a imagem do mapa, os dados daquele momento e o contexto (operação, filtros, janela de tempo, quem e quando). |
| Modelo de relatório | Report template | Um relatório que monta as seções sozinho a partir de parâmetros: cerca virtual, frota e trajeto, por região e período, focos, cobertura. |
| Parada | Stop | No relatório de frota, um período em que o veículo fica parado. O critério (velocidade e tempo mínimo) ainda não foi definido. |
| Cobertura | Coverage | A parte das ocorrências que fica a menos de uma distância dada de uma base ou de uma equipe. |

## Termos em aberto

- **"Forma" tem dois sentidos nos documentos.** Às vezes é o jeito de a extensão aparecer (layout, módulo, painel e operação de Flow) e às vezes é o tipo de resultado (círculo, faixa, contorno, área desenhada). Proposta: "forma de uso" (*surface*) para o primeiro e "forma" (*shape*) para o segundo. Falta resolver e ajustar o texto de [arquitetura.md](docs/arquitetura.md).
