# Manual Oficial — Ciclo de Liberação de Acessos e Permissões

Guia completo do fluxo correto para liberar (ou revogar) acesso ao ERP Grupo Nascimento, desde a criação do perfil até a habilitação das telas, ações e exceções individuais.

Tudo é feito em **Configurações do ERP** (`/app/administracao`).

---

## Visão geral do ciclo

O ciclo de liberação obedece **sempre** a esta ordem. Pular etapas é a principal causa de "não consigo acessar".

1. **Perfil (cargo)** — define o molde de permissões.
2. **Módulos e Menus** — define o que existe no sistema.
3. **Permissões do Perfil** — liga o molde às telas e ações.
4. **Empresa(s)** — define em quais CNPJs a pessoa opera.
5. **Usuário** — cria a conta de login.
6. **Vínculo Perfil ↔ Usuário** — aplica o cargo à pessoa.
7. **Vínculo Empresa ↔ Usuário** — define empresa padrão e adicionais.
8. **Exceções Individuais (Override)** — ajustes finos por pessoa.
9. **Validação e Auditoria** — conferir e registrar.

> 🔒 **Regra de Ouro:** Exceção Individual **sempre** vence o Perfil. O Perfil é o "crachá do cargo"; a Exceção é uma "ordem nominal" que libera ou bloqueia algo só para aquela pessoa.

---

## Etapa 1 — Criar/Revisar o Perfil

**Onde:** Configurações do ERP → aba **Perfis**.

**O que fazer:**
- Verifique se já existe um perfil que represente o cargo (ex.: Financeiro, Comercial, Controladoria, Almoxarife). Reutilize sempre que possível.
- Se não existir, crie um novo perfil com nome claro e descrição do escopo.

**O que esperar:**
- O perfil aparece na lista, **sem nenhuma permissão ainda**. Ele é só um molde vazio.
- Nenhum usuário é afetado nessa etapa.

---

## Etapa 2 — Conferir Módulos e Menus

**Onde:** Configurações do ERP → aba **Módulos e Menus**.

**O que fazer:**
- Confirme que o módulo (Financeiro, Suprimentos, BI, etc.) e a tela alvo (ex.: `financeiro:contas-pagar`) estão cadastrados e **ativos**.
- A chave única de uma tela é sempre **módulo + menu** (ex.: `comercial:aprovacoes` é diferente de `suprimentos:aprovacoes`).

**O que esperar:**
- Telas ativas ficam disponíveis para receber permissões. Telas inativas **não aparecem** em nenhum perfil, mesmo que o código exista.

---

## Etapa 3 — Liberar Permissões no Perfil

**Onde:** Configurações do ERP → aba **Permissões** → selecionar o Perfil.

**O que fazer:**
Para cada tela do módulo, marque as ações que o cargo pode executar:
- **Visualizar** — abrir a tela e ver os dados.
- **Incluir** — criar novos registros.
- **Alterar** — editar registros existentes.
- **Excluir** — apagar registros.
- **Aprovar** — aprovar/rejeitar (alçadas, pedidos, pareceres).
- **Exportar** — gerar planilhas/PDFs com os dados.
- **Executar IA** — usar copilotos e análises automatizadas.
- **Alterar DRE** — reclassificar lançamentos contábeis sensíveis.

**O que esperar:**
- Salvou → a permissão vale **para todos os usuários** que tiverem esse perfil.
- O menu passa a aparecer na sidebar dessas pessoas no próximo login (ou refresh da sessão).

> ⚠️ Sem **Visualizar**, nenhuma outra ação funciona — o menu nem aparece.

---

## Etapa 4 — Cadastrar/Confirmar a Empresa

**Onde:** Controladoria → **Empresas**.

**O que fazer:**
- Confirme que o CNPJ em que o usuário vai trabalhar está cadastrado e ativo.

**O que esperar:**
- Empresas inativas não aparecem no seletor de empresa ativa do usuário.

---

## Etapa 5 — Criar o Usuário

**Onde:** Configurações do ERP → aba **Usuários** → **Novo Usuário**.

**O que fazer:**
- Informe **e-mail corporativo**, **nome de exibição**, **senha provisória** e **empresa padrão**.
- Selecione **ao menos um Perfil** (pode marcar mais de um, mas evite empilhar perfis conflitantes).

**O que esperar:**
- Conta criada no Auth + linha em `profiles` + vínculo em `user_roles` + vínculo em `user_empresa` (empresa padrão), tudo em uma transação.
- O usuário recebe a flag **"trocar senha no primeiro login"** automaticamente.
- Se algo falhar no meio, o sistema faz **rollback** e o usuário **não** fica criado pela metade.

---

## Etapa 6 — Vincular Perfis adicionais (se necessário)

**Onde:** Ficha do usuário → aba **Perfis**.

**O que fazer:**
- Adicione ou remova perfis. A soma das permissões dos perfis é o que o usuário **herda**.

**O que esperar:**
- Mudança vale imediatamente após o próximo refresh de sessão do usuário.

---

## Etapa 7 — Vincular Empresas adicionais (multiempresa)

**Onde:** Ficha do usuário → aba **Empresas**.

**O que fazer:**
- Marque todas as empresas em que a pessoa pode operar.
- Defina **uma única empresa padrão** (`is_default = true`).

**O que esperar:**
- O usuário verá o seletor de empresa no topo do ERP.
- Os dados (contas a pagar, BI, contratos, etc.) são **sempre filtrados pela empresa ativa**. Trocar de empresa recarrega o contexto inteiro.

---

## Etapa 8 — Exceções Individuais (Override)

**Onde:** Ficha do usuário → aba **Exceções Individuais**.

**Use quando:** apenas **uma** pessoa precisa de um ajuste diferente do cargo (ex.: o coordenador do Financeiro pode excluir; o trainee do Comercial **não** pode aprovar ainda).

**Como funciona cada coluna:**
- **Herdar** — segue 100% o que o perfil diz. É o padrão.
- **Permitir** — libera só para essa pessoa, mesmo que o perfil negue.
- **Negar** — bloqueia só para essa pessoa, mesmo que o perfil libere.

**O que esperar:**
- A exceção tem **precedência absoluta** sobre o perfil.
- Vale por tela (módulo + menu) e por ação.
- Fica registrada na auditoria com autor, data e motivo (quando preenchido).

---

## Liberação em massa por Setor / Cargo

**Onde:** Configurações do ERP → **Módulos & Menus** → **Por Setor / Cargo**. Os cargos ficam em Configurações do ERP → **Cargos**.

**Use quando:** várias pessoas do mesmo setor (ou do mesmo nível de cargo dentro dele) devem ter as mesmas telas.

**Como fazer:**
1. Escolha o **Setor** e, se quiser, o **Nível do cargo** (Presidente, Diretor, Gerente, Supervisor, ADM, Aprendiz). "Todos os níveis" pega o setor inteiro.
2. Marque as telas do grupo — ou use **Copiar de…** (outro grupo, ou as telas que uma pessoa vê hoje) — e clique em **Salvar modelo**. Salvar não muda o acesso de ninguém.
3. Clique em **Aplicar às N pessoas**. A prévia mostra quem ganha cada tela, quem já tinha e as telas **fora do modelo** — só saem as que você marcar.
4. Confirme. A gravação é tudo ou nada e fica em **Últimas aplicações**.

**O que esperar:**
- O grupo de um nível recebe também as telas de "Setor · Todos os níveis" (as duas listas **somam**).
- Grava o mesmo que o switch de "Acesso por Usuário", pessoa a pessoa: depois de aplicar, ajustes individuais continuam valendo e podem ser feitos normalmente.
- Quem já via a tela não é tocado (as ações finas dela ficam como estão).
- **Administrador Geral** recebe liberações, mas nunca remoção em massa.
- Quem **entrar no setor depois não ganha sozinho**: ao criar o usuário, a tela de credenciais oferece **Aplicar o acesso do grupo**.
- Telas com ajuste por pessoa (setores do Malote, papéis de Formulários, Reembolso, Troca de Função) têm a tela liberada pelo modelo; o ajuste fino continua em "Acesso por Usuário".

**Cargos:** o cargo do usuário é escolhido da lista (não se digita mais). Cada cargo tem um **nível**, que é o que agrupa as pessoas acima. Só a administração troca o cargo de alguém. Os cargos marcados **usado pelo Malote** decidem quem aprova despesas pelo nome — renomear ou juntar um deles muda quem aprova.

---

## Etapa 9 — Validar e Auditar

**Onde:**
- Configurações do ERP → aba **Auditoria** / **Logs**.
- Ficha do usuário → botão **Simular acesso** (quando disponível).

**O que fazer:**
- Peça ao usuário para deslogar/logar e abrir a tela liberada.
- Confirme nos logs que a verificação (`has_screen_access`) retornou **true** para a ação testada.
- Para acessos sensíveis (BI, DRE, Aprovações, Administração), revise periodicamente.

**O que esperar:**
- Sidebar exibe apenas os menus permitidos.
- Acessar uma rota direta sem permissão (ex.: digitar `/app/bi` na URL) é **bloqueado** pelo guard de rota e devolve "Acesso negado".
- Cada alteração de perfil, vínculo ou exceção gera registro de auditoria com **quem alterou, quando, o quê e por quê**.

---

## Resumo prático (checklist)

- [ ] Perfil existe e tem descrição clara
- [ ] Tela alvo está ativa em Módulos e Menus
- [ ] Permissões do perfil marcadas (mínimo: Visualizar)
- [ ] Empresa cadastrada e ativa
- [ ] Usuário criado com e-mail, senha provisória e empresa padrão
- [ ] Perfis vinculados ao usuário
- [ ] Empresas adicionais vinculadas (se multiempresa)
- [ ] Exceções individuais aplicadas (somente se fugir da regra)
- [ ] Usuário testou e auditoria confirmou o acesso

---

## Erros mais comuns e como evitar

| Sintoma | Causa provável | Correção |
|---|---|---|
| "Não vejo o menu" | Perfil sem **Visualizar** na tela | Etapa 3 |
| "Vejo o menu mas não consigo salvar" | Falta **Incluir/Alterar** no perfil | Etapa 3 |
| "Não aparece nenhuma empresa" | Sem vínculo em `user_empresa` | Etapa 7 |
| "Vejo dados da empresa errada" | Empresa ativa trocada — conferir seletor | Topbar |
| "Um usuário acessa algo que não devia" | Exceção Individual em **Permitir** esquecida | Etapa 8 |
| "Tirei do perfil mas continua acessando" | Existe **Exceção Permitir** sobrescrevendo | Etapa 8 |
| Rota direta abre mesmo sem menu | Cache de sessão — pedir logout/login | Etapa 9 |

---

## Princípios que nunca mudam

1. **Composto sempre:** toda permissão é a dupla **módulo + menu + ação**. Nunca só o menu.
2. **Exceção vence Perfil.** Sem exceção, vale o perfil.
3. **Empresa ativa filtra tudo.** Multiempresa nunca mistura dados.
4. **Tudo é auditado.** Cada liberação tem autor e data.
5. **Menos é mais.** Prefira ajustar o perfil ao invés de criar dezenas de exceções.
