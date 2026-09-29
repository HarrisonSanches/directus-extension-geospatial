# Segurança e dependências

Uma extensão fora do sandbox tem acesso total ao banco (§7.5). Quem instala precisa poder confiar nela, e essa
confiança se constrói no repositório.

## Segredos

- **Nunca no repositório nem no banco:** chaves e segredos só em variáveis de ambiente (§7.8). O `.env` fica no
  `.gitignore`, com um `.env.example` sem valores.
- No ambiente de desenvolvimento, o `pnpm dev` gera os segredos que estão vazios no `dev/.env`, com 32 bytes
  aleatórios, e mantém os que já têm valor. Cada clone fica com os seus, e nenhum vai para o repositório.
- A chave de licença do Directus 12 (D-043, D-044) fica no `test/.env` da máquina e, na CI, no segredo
  `DIRECTUS_LICENSE_KEY`. A suíte a manda só no corpo do pedido à rota `/license` do Directus do teste, nunca nas
  variáveis do container, e a tira das mensagens de erro. No `pnpm dev`, ela se aplica pelo Studio, e o Directus a
  guarda no banco do volume (V-119).
- `gitleaks` na integração contínua e, antes da abertura do repositório, na F00 (D-040), sobre o histórico
  inteiro. Depois da abertura, o secret scanning do GitHub também vigia o repositório, e a proteção de push recusa
  o push que traz um segredo conhecido (V-75, V-136).
- Segredo nunca em log, mensagem de erro, URL ou resposta da API.

## Dependências

- Cada dependência nova precisa de motivo: o que ela resolve que a plataforma, ou uma dependência que já temos, não
  resolve. No Studio, o peso também conta.
- **Licença conferida antes:** no que vai dentro do pacote, só licenças permissivas (MIT, BSD, ISC, Apache-2.0, e a
  OFL nas fontes do mapa), porque o pacote é MIT (D-019).
- **O build gera o aviso de licenças de terceiros,** junto do `dist`, como as licenças MIT e BSD exigem de quem
  redistribui.
- **Nenhum código do `@directus/api` dentro do pacote.** O núcleo do Directus tem licença própria, a MSCL-1.0-GPL,
  diferente da MIT dos pacotes de apoio (V-60). A extensão usa os internos do Directus que já está rodando, e uma
  conferência na CI garante que o build os deixou de fora.
- **Cadeia de suprimentos:**
  - lockfile versionado, e instalação com o lockfile congelado na CI;
  - scripts de instalação das dependências desligados, com cada exceção decidida no `allowBuilds`; a instalação
    falha quando aparece um script que ninguém revisou (`strictDepBuilds`, V-85);
  - dependência que não roda no Node em uso não instala (`engineStrict`, V-93);
  - versão recém-publicada só entra depois de 3 dias (`minimumReleaseAge` de 4320 minutos, no pnpm e no
    Renovate), para dar tempo de um pacote comprometido ser descoberto. A exceção é a correção de um alerta do
    Dependabot, que chega na hora (D-046);
  - `pnpm audit` e OSV-Scanner na CI. Uma vulnerabilidade com correção sai por atualização ou, quando quem a puxa
    prende a versão exata, por um `overrides` com a faixa vulnerável no nome. A que não tem correção vira exceção,
    com o motivo, no `auditConfig.ignoreGhsas` do `pnpm-workspace.yaml` e no `osv-scanner.toml`, este com a data de
    revisão (`ignoreUntil`): passada a data, o OSV-Scanner falha e as duas listas são revistas (V-128). O alerta
    dela no GitHub é dispensado com o mesmo motivo, senão o Renovate tenta a correção que não existe (V-140);
  - o Dependabot alerts ligado, para a vulnerabilidade nova aparecer mesmo sem push (V-75, V-140). O Dependabot
    security updates fica desligado, porque a correção vem pelo Renovate;
  - os workflows do GitHub Actions passam pelo zizmor (V-74).
- **Atualizações pelo Renovate** (D-046), com a configuração em `.github/renovate.json5`, que a CI valida:
  - os minor e patch num pull request por semana, na segunda-feira, e cada major à parte. Nenhum entra sozinho, e
    a integração contínua é o filtro. A descrição, que vira o commit do `develop`, leva a tabela das versões, com o
    link do diff de cada uma, e não as notas de versão;
  - as imagens do Directus a qualquer hora, com o patch separado da minor. O patch troca a versão da matriz, e a
    minor ou a major nova entra nela ao lado do piso (D-037). O canário roda nelas;
  - o que só anda junto vem num grupo: os pacotes do Directus, que o `@directus/extensions-sdk` prende em versões
    exatas, e, no major, o Vitest com as bibliotecas de cobertura;
  - o que segue outra coisa fica parado: o `knex` e o `pino`, peers exatos do `@directus/types`; o `vue`, que o
    `@directus/extensions-sdk` prende, e com outra versão os tipos dos layouts não batem; o `playwright-core`, que
    sobe à mão com a imagem do Playwright da mesma versão (D-047); o `@types/node` de cada catálogo, na linha do Node
    dele; o override, no major em que está, e abaixo do 1.0.0 também na minor; e o PostGIS mínimo, que segue a
    política de suporte;
  - uma versão fixada fora dos gerenciadores do Renovate ganha uma regra por regex ou um comentário `# renovate:`
    com a origem, senão fica parada sem aviso (V-139).
  - o lock file maintenance regenera o lockfile toda segunda-feira, com as dependências indiretas. Ele não tem data de
    publicação, e por isso não espera pelo status `renovate/stability-days`: os 3 dias vêm do pnpm, que recusa a versão
    mais nova ao resolver (V-150).

## Publicação

- Pelo GitHub Actions, com a publicação confiável do npm (OIDC, sem token guardado) e provenance.
- SBOM (CycloneDX) em cada release; CHANGELOG e versionamento semântico.
- O `SECURITY.md`, desde a abertura do repositório, com o relato privado do GitHub como canal (V-131).
- A documentação lista exatamente o que a extensão acessa: tabelas, funções internas do Directus e variáveis de
  ambiente.

## Código

- Toda entrada de fora é validada na borda, pelo contrato (D-016), antes de tocar o banco.
- SQL só com parâmetros, e identificadores só depois de conferidos contra o esquema
  ([`banco-e-sql.md`](banco-e-sql.md)).
- Na dúvida sobre permissão, negar: a checagem dos internos na inicialização desliga as operações, em vez de
  arriscar (D-001).
- Nada de recurso de fora no navegador sem necessidade: sem CDN, dentro da CSP padrão do Directus (V-33).
- O servidor só faz pedidos para endereços que o admin configurou (provedores de endereço, mapas de fundo), nunca
  para um endereço que veio no pedido do usuário.
- Desde a abertura do repositório, o CodeQL analisa o código, e o OpenSSF Scorecard mede as práticas de segurança
  do repositório, com o badge no README (V-75, V-76).

## Dados pessoais

- Tudo o que a extensão guarda está no mapa do §7.10, com o prazo de retenção, e todo dado novo que ela passe a
  guardar entra nele (D-038).
- O que sai da instalação (a busca de endereço e os tiles do mapa de fundo) fica documentado, junto com a
  alternativa que mantém tudo dentro: um provedor próprio e o PMTiles.

## Páginas e rotas públicas

- A página de verificação e as rotas do papel público respondem igual para "não existe" e para erro interno, leem
  só as colunas de que precisam e têm limite de pedidos por IP (D-034).
- O PDF enviado para conferência não fica guardado, e o servidor não o interpreta: só calcula o hash dos bytes.

## A demo pública

- Nunca um usuário admin. Os papéis de demonstração não sobem arquivo, não criam Flow e não mudam configuração
  (§7.5).
- A API pública da demo é só de leitura, com limite por IP, e o banco volta periodicamente a uma cópia limpa.
