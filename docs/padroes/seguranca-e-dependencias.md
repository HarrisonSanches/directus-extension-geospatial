# Segurança e dependências

Uma extensão fora do sandbox tem acesso total ao banco (§7.5). Quem instala precisa poder confiar nela, e essa
confiança se constrói no repositório.

## Segredos

- **Nunca no repositório nem no banco:** chaves e segredos só em variáveis de ambiente (§7.8). O `.env` fica no
  `.gitignore`, com um `.env.example` sem valores.
- `gitleaks` na integração contínua e, antes de tornar o repositório público, sobre o histórico inteiro.
- Segredo nunca em log, mensagem de erro, URL ou resposta da API.

## Dependências

- Cada dependência nova precisa de motivo: o que ela resolve que a plataforma, ou uma dependência que já temos, não
  resolve. No Studio, o peso também conta.
- **Licença conferida antes:** no que vai dentro do pacote, só licenças permissivas (MIT, BSD, ISC, Apache-2.0),
  porque o pacote é MIT (D-019).
- **Cadeia de suprimentos:**
  - lockfile versionado, e instalação com o lockfile congelado na CI;
  - scripts de instalação das dependências desligados, com a lista explícita das que podem rodar
    (`onlyBuiltDependencies`), como no Directus (V-59);
  - versão recém-publicada só entra depois de alguns dias (`minimumReleaseAge`, no pnpm e no Renovate), para dar
    tempo de um pacote comprometido ser descoberto;
  - `pnpm audit` e OSV-Scanner na CI.
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

## Páginas e rotas públicas

- A página de verificação e as rotas do papel público respondem igual para "não existe" e para erro interno, leem
  só as colunas de que precisam e têm limite de pedidos por IP (D-034).
- O PDF enviado para conferência não fica guardado.

## A demo pública

- Nunca um usuário admin. Os papéis de demonstração não sobem arquivo, não criam Flow e não mudam configuração
  (§7.5).
- A API pública da demo é só de leitura, com limite por IP, e o banco volta periodicamente a uma cópia limpa.
