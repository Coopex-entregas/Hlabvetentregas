# HLabVet Entregas

Sistema móvel para o cooperado registrar as entregas e acompanhar o valor fixo semanal, as entregas extras e os fechamentos. O administrador cadastra os cooperados, locais, valores e regras e acompanha a produção diária.

## O que já está incluído

- Login separado para administrador e cooperado.
- Senha provisória criada pelo administrador e troca obrigatória no primeiro acesso.
- Cooperado visualiza e altera somente os próprios lançamentos.
- Administrador acompanha quantas entregas e quantos extras cada cooperado fez por dia.
- Cadastro de locais e valores diferentes para segunda a sexta e sábado.
- Valor fixo semanal editável para cada cooperado; padrão de R$ 663,33.
- Fechamento semanal automático de segunda a sábado.
- Fechamento mensal automático do dia 1º ao último dia do mês.
- Consulta livre entre duas datas e exportação CSV.
- Banco Cloudflare D1; os dados não ficam presos a um único celular.
- Layout lilás e branco, responsivo e instalável no celular.

## Regras iniciais configuradas

- Segunda a sexta: as 6 primeiras entregas ficam incluídas; a partir da 7ª, cada entrega usa o valor do local.
- A entrega de qualquer local conta para completar as 6 incluídas. Exemplo: 6 em Natal + 1 na Zona Norte faz a Zona Norte ser a 7ª e cobrar R$ 20,00.
- Sábado: as 2 primeiras entregas de Natal ficam incluídas; as demais entregas de Natal são extras.
- Sábado fora de Natal: todas são cobradas como extras.
- Valores iniciais: Natal R$ 20,00; Zona Norte R$ 20,00; Parnamirim R$ 20,00; Macaíba R$ 30,00; São José de Mipibu R$ 50,00; Cajupiranga R$ 30,00.
- O administrador pode mudar limites, valores, classificação dos locais e o valor semanal sem editar o código.

## Publicar no Cloudflare

### 1. Enviar para o GitHub

Crie um repositório e envie todo o conteúdo desta pasta.

### 2. Criar o banco D1

No terminal, dentro da pasta do projeto:

```bash
npm install
npx wrangler login
npx wrangler d1 create hlabvet-entregas
```

O Cloudflare mostrará um `database_id`. Abra `wrangler.toml` e substitua:

```toml
database_id = "COLE_AQUI_O_ID_DO_SEU_D1"
```

pelo ID recebido.

### 3. Publicar

```bash
npm run deploy
```

O próprio sistema cria as tabelas e os locais iniciais no primeiro acesso. Não é necessário importar o SQL manualmente. O arquivo `schema.sql` foi incluído como cópia da estrutura e também pode ser usado para manutenção.

### 4. Criar o primeiro administrador

Abra o endereço fornecido pelo Cloudflare. A primeira tela pedirá nome, login e senha do administrador. Depois, acesse **Cadastros → Cooperados** para criar os acessos dos cooperados.

## Publicação automática pelo GitHub

No painel Cloudflare, acesse **Workers & Pages**, importe o repositório do GitHub e use:

- Comando de implantação: `npm run deploy`
- Versão do Node: 20 ou superior

O arquivo `wrangler.toml` já contém a ligação com o D1 e os agendamentos automáticos:

- domingo às 00:05, horário de Fortaleza: registra o fechamento da semana encerrada no sábado;
- dia 1º às 00:10, horário de Fortaleza: registra o fechamento do mês anterior.

## Testar no computador

Depois de colocar o ID do D1 no `wrangler.toml`:

```bash
npm install
npm run dev
```

Para testar as regras de cálculo:

```bash
npm test
```

## Segurança

As senhas são armazenadas com PBKDF2 e sal individual, e a sessão usa cookie protegido. Nunca coloque senhas dentro do GitHub ou do `wrangler.toml`.
