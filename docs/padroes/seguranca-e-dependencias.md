# Segurança e dependências

Uma extensão fora do sandbox tem acesso total ao banco (§7.5). Quem instala precisa poder confiar nela, e essa
confiança se constrói no repositório.

## Segredos

- **Nunca no repositório nem no banco:** chaves e segredos só em variáveis de ambiente (§7.8). O `.env` fica no
  `.gitignore`, com um `.env.example` sem valores.
- `gitleaks` na integração contínua e, antes da abertura do repositório no fim da F00 (D-040), sobre o histórico
  inteiro. Depois da abertura, o secret scanning do GitHub também vigia o repositório (V-75).
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
    Renovate), para dar tempo de um pacote comprometido ser descoberto;
  - `pnpm audit` e OSV-Scanner na CI;
  - o Dependabot alerts ligado, para a vulnerabilidade nova aparecer mesmo sem push (V-75);
  - os workflows do GitHub Actions passam pelo zizmor (V-74).
- Atualizações pelo Renovate, agrupadas, com a integração contínua como filtro. As tags do Directus também, e o
  canário roda nelas.

## Publicação

- Pelo GitHub Actions, com a publicação confiável do npm (OIDC, sem token guardado) e provenance.
- SBOM (CycloneDX) em cada release; CHANGELOG e versionamento semântico.
- `SECURITY.md` com o canal para relatar falhas.
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
