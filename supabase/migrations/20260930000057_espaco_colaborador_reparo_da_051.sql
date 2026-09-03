-- =====================================================================
-- ESPAÇO DO COLABORADOR — repara o que a 051 não conseguiu aplicar
--
-- O QUE ACONTECEU
--
--   A 051 abortou no SQL Editor com:
--     42P13: cannot change return type of existing function
--     HINT: Use DROP FUNCTION esp_col_colaboradores(uuid,text,integer) first.
--
--   A 052 e a 056 rodaram sem erro. Juntando as duas informações dá para
--   reconstruir o que houve: a 052 foi executada ANTES da 051. Ela derruba e
--   recria `esp_col_colaboradores(uuid,text,int)` com DUAS colunas a mais
--   (`local` e `nivel`); quando a 051 veio depois com o seu
--   `CREATE OR REPLACE` da versão antiga — 9 colunas, mesma assinatura de
--   argumentos — o Postgres recusou, porque REPLACE não muda tipo de retorno.
--
--   O ERRO É MEU, DE DUAS FORMAS. Primeiro por deixar a 051 dependente de
--   ordem sem dizer isso em lugar nenhum. Segundo, e pior: a 051 é um script
--   que NÃO PODE ser reexecutado depois da 052 — e migration que não é
--   reexecutável é uma armadilha num projeto onde ninguém aplica nada
--   automaticamente e todo mundo roda `.sql` à mão, às vezes fora de ordem,
--   às vezes duas vezes.
--
-- POR QUE ISSO QUEBROU MAIS DO QUE UMA FUNÇÃO
--
--   O SQL Editor do Supabase executa o script inteiro em UMA transação. Como
--   a 051 abortou no meio, TUDO que vinha antes foi desfeito junto:
--
--     • a linha em `app_menu` — sem ela a rota é negada para todo mundo;
--     • a permissão semeada no perfil `concede_tudo`;
--     • a policy `empregados_select_espaco_colaborador`;
--     • `esp_col_exige_acesso()` — a guarda que TODAS as RPCs chamam;
--     • `esp_col_historico()` e `esp_col_marcacoes()`, que só existem lá.
--
--   E o mais traiçoeiro: a 052 e a 056 "rodaram corretas" porque o corpo de
--   uma função plpgsql não é validado na criação. As funções delas existem e
--   chamam `esp_col_exige_acesso()`, que NÃO existe — então a tela inteira
--   falharia em runtime, não na aplicação da migration. Sucesso no SQL
--   Editor não significava sistema funcionando.
--
-- O QUE ESTA MIGRATION FAZ
--
--   Recria exatamente as cinco coisas da lista acima e NADA MAIS. Não toca em
--   `esp_col_arvore`, `esp_col_ficha` nem `esp_col_colaboradores`: as versões
--   boas dessas três são as da 052/056, que já estão no banco. Reaplicar a
--   051 agora reintroduziria as versões velhas — que é justamente o que o
--   erro impediu de acontecer.
--
--   É INTEIRAMENTE IDEMPOTENTE e não depende de ordem: pode rodar quantas
--   vezes quiser, antes ou depois de qualquer uma das outras. A conferência
--   no fim lista o que existe, para não haver de novo "rodou sem erro" sem
--   ninguém saber o que ficou de pé.
--
--   Se a 051 tiver aplicado alguma coisa (caso o SQL Editor não estivesse em
--   transação), nada aqui duplica: os INSERT têm ON CONFLICT e os CREATE são
--   OR REPLACE.
--
-- E A MESMA ARMADILHA PEGOU ESTE ARQUIVO NA PRIMEIRA TENTATIVA
--
--   A primeira versão desta 057 terminava chamando esp_col_arvore() como
--   "prova final". No SQL Editor não existe usuário autenticado: auth.uid()
--   é NULL e a guarda levanta 42501 "Não autenticado" — que é a resposta
--   CERTA dela. Só que exceção solta num script transacional aborta tudo, e
--   a minha própria conferência desfez a migration que ela deveria validar.
--
--   Escrevi 400 linhas explicando esse mecanismo e caí nele na linha
--   seguinte. A conferência agora é toda não-lançante: consultas de catálogo
--   e um bloco DO com EXCEPTION que informa por NOTICE. O teste que precisa
--   de sessão real ficou COMENTADO no fim, com o SET LOCAL de simulação —
--   fora do caminho da transação.
-- =====================================================================

-- ── 1. O menu e a permissão que o torna “configurado” ──────────────
--
-- Uma linha só cobre as DUAS rotas: matchMenuCode casa por prefixo, então
-- /app/central-servicos/espaco-colaborador/:id herda a permissão da lista.
-- Cadastrar a ficha separado daria a chance de alguém abrir a lista e tomar
-- "Acesso negado" ao clicar num nome.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'central_servicos_espaco_colaborador', 'Espaço do Colaborador',
       '/app/central-servicos/espaco-colaborador', 70, true
  FROM public.app_modulo m
 WHERE m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- E a permissão do Administrador Geral entra JUNTO, na mesma migration.
--
-- Parece redundante — `has_screen_access` já devolve true para o perfil
-- `concede_tudo` no passo 2, sem consultar `perfil_acesso_permissao`. A linha
-- não existe para conceder nada: existe para o menu ser CONFIGURADO.
--
-- O motivo está em useAccessibleMenus: menu sem NENHUMA linha em
-- perfil_acesso_permissao/screen_permission_user não entra em
-- `list_configured_menu_codes`, e o front trata "ninguém nunca mexeu no
-- gerenciamento de acesso disto" como FORA DO ENFORCEMENT. Ou seja: um menu
-- sem regra nenhuma não nasce fechado — nasce aparecendo na sidebar de todo
-- mundo. A rota abriria, o AcessoGate e as RPCs negariam (as duas pontas
-- checam has_screen_access, então não há vazamento de dado), mas a tela
-- ficaria listada para os 2.4 mil como um item que só sabe dizer "você não
-- tem acesso".
--
-- Uma linha basta para o menu virar "configurado" e passar a valer o
-- deny-by-default de verdade. Semeia só `visualizar`, que é tudo o que esta
-- tela faz — ela não inclui, não altera e não exclui nada.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'central_servicos_espaco_colaborador', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Fora o Administrador Geral, ninguém enxerga até alguém ligar o toggle em
-- Administração → Acesso por Usuário. A ficha mostra a vida inteira de uma
-- pessoa — abrir por padrão seria a decisão errada para tomar dentro de um
-- .sql.

-- ── 2. A policy aditiva de leitura de EMPREGADOS ─────────────────
--
-- A leitura de EMPREGADOS é liberada por uma lista explícita de telas dentro
-- de `erp_auth_read_empregados` (20260717190010): self-read pelo
-- auth_user_id, mais nove menus. O caminho óbvio aqui seria DROP + CREATE
-- daquela policy acrescentando o décimo — e é justamente o que NÃO se faz.
--
-- Duas razões, e a segunda é a que dói:
--
--   1. Migration neste projeto não se auto-aplica: o .sql é rodado à mão no
--      SQL Editor, às vezes semanas depois do merge. A policy que está viva
--      no banco pode já ter divergido do último .sql do repositório, e um
--      DROP + CREATE reescrito daqui apagaria silenciosamente as cláusulas
--      que eu não sabia que existiam.
--
--   2. Reescrever a lista inteira para acrescentar UM item significa digitar
--      de novo as outras dez cláusulas. Errar uma — trocar
--      `auth_user_id = auth.uid()` por outra coisa, esquecer 'patrimonios' —
--      não dá erro nenhum: dá gente perdendo acesso em telas que ninguém
--      tocou nesta task, e a causa some no meio de um arquivo de outra
--      feature.
--
-- Policy PERMISSIVE se soma com OR às demais. Então uma policy separada e
-- pequena é estritamente aditiva: concede exatamente ao novo menu e é
-- incapaz, por construção, de tirar o acesso de alguém.
DROP POLICY IF EXISTS empregados_select_espaco_colaborador ON public."EMPREGADOS";
CREATE POLICY empregados_select_espaco_colaborador ON public."EMPREGADOS"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'central_servicos_espaco_colaborador', 'visualizar'::app_acao));

-- ── 3. A guarda que TODAS as RPCs chamam ───────────────────────
--
-- As RPCs seguintes são SECURITY DEFINER: elas ATRAVESSAM o RLS. A checagem
-- de permissão não é decorativa — é a única coisa entre um authenticated
-- qualquer e a ficha inteira de 2.4 mil pessoas. Fica numa função só para
-- não existir a versão que esqueceu de checar.
CREATE OR REPLACE FUNCTION public.esp_col_exige_acesso()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_screen_access(v_uid, 'central_servicos_espaco_colaborador', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Espaço do Colaborador' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_exige_acesso() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_exige_acesso() TO authenticated;

-- ── 4. O histórico (advertências + trocas + uniformes/EPI) ──────────

--
-- Três fontes já existentes, unidas numa linha do tempo só. Cada linha
-- carrega `origem` (qual tabela) e `origem_id` (a chave lá), porque o pedido
-- foi explícito: "o uniforme que ele recebeu veio da solicitação ID XXXXX".
-- Sem isso a ficha vira boato — mostra que houve advertência e não diz qual.
--
-- `protocolo` é o número que o usuário reconhece (sup_pedido.pedido_id); nas
-- outras duas o próprio id é o protocolo.
CREATE OR REPLACE FUNCTION public.esp_col_historico(p_empregado_id bigint)
RETURNS TABLE (
  origem     text,
  origem_id  text,
  protocolo  text,
  data_ref   timestamptz,
  titulo     text,
  detalhe    text,
  status     text,
  extra      jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.esp_col_exige_acesso();
  IF p_empregado_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  -- Advertências
  SELECT 'advertencia'::text,
         a.id::text,
         a.id::text,
         COALESCE(a.data_ocorrido::timestamptz, a.created_at),
         COALESCE(a.tipo_advertencia, 'Advertência'),
         a.descricao_ocorrido,
         a.status,
         jsonb_build_object(
           'grau', a.grau, 'resultado', a.resultado,
           'contrato', a.contrato, 'solicitante', a.solicitante_nome,
           'aprovado_por', a.aprovado_por_nome, 'parecer_juridico', a.parecer_juridico)
    FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
   WHERE a.colaborador_id = p_empregado_id

  UNION ALL
  -- Trocas de função
  SELECT 'troca_funcao'::text,
         t.id::text,
         t.id::text,
         COALESCE(t.data_pretendida::timestamptz, t.criado_em),
         COALESCE(t.cargo_atual, '—') || ' → ' || t.cargo_novo,
         t.motivo,
         t.status,
         jsonb_build_object(
           'cargo_atual', t.cargo_atual, 'cargo_novo', t.cargo_novo,
           'posto', t.posto, 'filial', t.filial,
           'solicitante', t.solicitante_nome, 'aprovador', t.aprovador_nome,
           'rh_em', t.rh_em)
    FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
   WHERE t.colaborador_id = p_empregado_id

  UNION ALL
  -- Uniformes e EPI (Solicitar Materiais). Os itens vêm agregados na mesma
  -- linha: a pergunta da ficha é "o que ele recebeu neste pedido", e uma
  -- linha por item transformaria um pedido de 8 peças em 8 eventos.
  SELECT 'material'::text,
         pd.id::text,
         pd.pedido_id,
         pd.created_at,
         'Uniformes / EPI'::text,
         (SELECT string_agg(i.quantidade || '× ' || i.nome_item
                            || COALESCE(' (' || i.tamanho || ')', ''), ', '
                            ORDER BY i.ordem, i.nome_item)
            FROM public.sup_pedido_item i WHERE i.pedido_id = pd.id),
         pd.status,
         jsonb_build_object(
           'contrato', pd.contrato_nome, 'posto', pd.posto_nome,
           'funcao', pd.funcao_nome,
           'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                              'id', i.id, 'nome', i.nome_item, 'tipo', i.tipo_item,
                              'tamanho', i.tamanho, 'quantidade', i.quantidade)
                              ORDER BY i.ordem, i.nome_item), '[]'::jsonb)
                       FROM public.sup_pedido_item i WHERE i.pedido_id = pd.id))
    FROM public.sup_pedido pd
   WHERE pd.colaborador_empregado_id = p_empregado_id

  ORDER BY 4 DESC NULLS LAST;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_historico(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_historico(bigint) TO authenticated;

-- ── 5. As batidas de ponto ────────────────────────────────
--
-- Lê espelho."BiMarcacoes" — que HOJE NÃO EXISTE (ver cabeçalho). Daí as
-- três decisões incomuns desta função:
--
--   a) SQL dinâmico. Referência estática a uma tabela ausente faria esta
--      migration falhar na criação da função, e ela precisa poder ser
--      aplicada antes do espelho existir.
--
--   b) Colunas descobertas em execução. O espelho copia os nomes do MySQL
--      verbatim (espelho.mjs) e ninguém aqui viu esse schema. Chutar um
--      nome só significaria uma migration nova no dia do sync; a lista de
--      candidatos abaixo cobre as grafias plausíveis e o dia do sync não
--      exige nada de ninguém.
--
--   c) Devolve status em vez de erro. `disponivel=false` + motivo deixa a
--      aba de ponto escrever "espelho ainda não sincronizado" — que é a
--      verdade — em vez de um toast vermelho de falha.
--
-- A CONVERSÃO MINUTO→HORA NÃO ACONTECE AQUI. Sai o minuto cru e o frontend
-- converte (src/lib/ponto.ts, com teste). Dois conversores, um em cada
-- ponta, é como as duas metades passam a discordar sobre o turno da
-- meia-noite.
CREATE OR REPLACE FUNCTION public.esp_col_marcacoes(
  p_empregado_id bigint,
  p_ano          int,
  p_mes          int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tab     regclass;
  v_cad     text;
  v_col_cad text; v_col_data text; v_col_min text;
  v_de      date; v_ate date;
  v_linhas  jsonb;
BEGIN
  PERFORM public.esp_col_exige_acesso();

  v_tab := to_regclass('espelho."BiMarcacoes"');
  IF v_tab IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
      'motivo', 'O espelho do relógio de ponto (espelho."BiMarcacoes") ainda não foi sincronizado.');
  END IF;

  -- O elo com a pessoa é a MATRÍCULA: o relógio de ponto é do sistema
  -- antigo e não conhece o "ID" do nosso cadastro.
  SELECT nullif(btrim(e."Cadastro"::text), '') INTO v_cad
    FROM public."EMPREGADOS" e WHERE e."ID" = p_empregado_id;
  IF v_cad IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
      'motivo', 'Colaborador sem matrícula no cadastro — não há como casar com o relógio de ponto.');
  END IF;

  SELECT c.column_name INTO v_col_cad FROM information_schema.columns c
   WHERE c.table_schema = 'espelho' AND c.table_name = 'BiMarcacoes'
     AND lower(c.column_name::text) = ANY (ARRAY['cadastro','matricula','numcad','chapa','empregadoid','empregado','codemp'])
   ORDER BY array_position(ARRAY['cadastro','matricula','numcad','chapa','empregadoid','empregado','codemp'], lower(c.column_name::text))
   LIMIT 1;

  SELECT c.column_name INTO v_col_data FROM information_schema.columns c
   WHERE c.table_schema = 'espelho' AND c.table_name = 'BiMarcacoes'
     AND lower(c.column_name::text) = ANY (ARRAY['data','datamarcacao','dtmarcacao','dataponto','dia'])
   ORDER BY array_position(ARRAY['data','datamarcacao','dtmarcacao','dataponto','dia'], lower(c.column_name::text))
   LIMIT 1;

  SELECT c.column_name INTO v_col_min FROM information_schema.columns c
   WHERE c.table_schema = 'espelho' AND c.table_name = 'BiMarcacoes'
     AND lower(c.column_name::text) = ANY (ARRAY['marcacao','minutos','minuto','batida','horario','hora'])
   ORDER BY array_position(ARRAY['marcacao','minutos','minuto','batida','horario','hora'], lower(c.column_name::text))
   LIMIT 1;

  IF v_col_cad IS NULL OR v_col_data IS NULL OR v_col_min IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
      'motivo', format('O espelho existe, mas as colunas esperadas não foram reconhecidas (matrícula=%s, data=%s, minutos=%s). Ajuste a lista de candidatos em esp_col_marcacoes.',
                       COALESCE(v_col_cad, '?'), COALESCE(v_col_data, '?'), COALESCE(v_col_min, '?')));
  END IF;

  v_de  := make_date(p_ano, p_mes, 1);
  v_ate := (v_de + interval '1 month')::date;

  -- format() com %I escapa os identificadores descobertos; os valores vão
  -- por USING, nunca concatenados. Nome de coluna vindo do catálogo do
  -- próprio banco + bind dos parâmetros é o que mantém isto fora do alcance
  -- de injeção.
  EXECUTE format($q$
    -- Ordena só por DATA. Ordenar também pelo minuto exigiria um cast que a
    -- coluna do espelho pode não aceitar (o tipo vem do MySQL e ninguém o
    -- viu ainda), e ordenar como texto colocaria 1000 antes de 420. Quem
    -- ordena as batidas dentro do dia é normalizarMarcacoesDoDia, no
    -- frontend, que ordena pelo minuto cru e tem teste para o turno noturno.
    SELECT COALESCE(jsonb_agg(s.x ORDER BY s.x->>'data'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('data', m.%1$I::date, 'minutos', m.%2$I) AS x
          FROM espelho."BiMarcacoes" m
         WHERE btrim(m.%3$I::text) = $1
           AND m.%1$I::date >= $2 AND m.%1$I::date < $3
      ) s
  $q$, v_col_data, v_col_min, v_col_cad)
  INTO v_linhas USING v_cad, v_de, v_ate;

  RETURN jsonb_build_object(
    'disponivel', true,
    'matricula',  v_cad,
    'colunas',    jsonb_build_object('matricula', v_col_cad, 'data', v_col_data, 'minutos', v_col_min),
    'linhas',     COALESCE(v_linhas, '[]'::jsonb));

EXCEPTION WHEN OTHERS THEN
  -- Espelho é cópia de banco legado: tipo inesperado numa coluna não pode
  -- derrubar a ficha inteira, só a aba de ponto.
  RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
    'motivo', 'Falha ao ler o espelho do ponto: ' || SQLERRM);
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_marcacoes(bigint, int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_marcacoes(bigint, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência — rode e LEIA o resultado ────────────────────────────
--
-- "Rodou sem erro" já enganou uma vez nesta feature: a 052 e a 056 aplicaram
-- limpo enquanto a guarda que elas chamam não existia. Corpo de função
-- plpgsql não é validado na criação, então só a listagem abaixo diz se o
-- sistema está de pé.

-- (a) As OITO funções têm que aparecer.
--     esp_col_arvore, esp_col_colaboradores, esp_col_contrato_id,
--     esp_col_esta_ativo, esp_col_exige_acesso, esp_col_ficha,
--     esp_col_historico, esp_col_marcacoes  → 8 linhas.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'esp\_col\_%'
 ORDER BY 1, 2;

-- (b) O menu tem que existir, ativo, com pelo menos 1 permissão.
--     permissoes = 0 aqui significa menu FORA do enforcement, isto é,
--     aparecendo na sidebar de todo mundo.
SELECT mo.codigo AS modulo, m.codigo, m.rota, m.ativo,
       (SELECT count(*) FROM public.perfil_acesso_permissao p WHERE p.menu_codigo = m.codigo)
     + (SELECT count(*) FROM public.screen_permission_user s WHERE s.menu_codigo = m.codigo) AS permissoes
  FROM public.app_menu m
  JOIN public.app_modulo mo ON mo.id = m.modulo_id
 WHERE m.codigo = 'central_servicos_espaco_colaborador';

-- (c) A policy aditiva de EMPREGADOS.
-- to_regclass em vez do cast direto: '...'::regclass LANÇA quando a tabela
-- não existe, e nada nesta conferência pode abortar a transação.
SELECT polname FROM pg_policy
 WHERE polrelid = to_regclass('public."EMPREGADOS"')
   AND polname = 'empregados_select_espaco_colaborador';

-- (d) As tabelas de que as funções dependem. Estático, não executa nada:
--     se alguma linha vier `false`, a RPC correspondente estoura na tela.
SELECT t.nome,
       to_regclass(t.nome) IS NOT NULL AS existe
  FROM (VALUES
    ('public."EMPREGADOS"'),
    ('public.contratos'),
    ('public.planilha_custo'),
    ('public.planilha_posto_localizacao'),
    ('public."RH_CONTRATO_ENCARREGADO"'),
    ('public.sup_empregado_contrato_depara'),
    ('public.sup_pedido'),
    ('public.sup_pedido_item'),
    ('public."SISTEMA_SOLICITACOES_ADVERTENCIA"'),
    ('public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"')
  ) AS t(nome)
 ORDER BY 2, 1;

-- (e) Chamada real da árvore — SEM poder derrubar este script.
--
--     ATENÇÃO, e esta é a lição que custou uma rodada: no SQL Editor NÃO
--     EXISTE usuário autenticado. `auth.uid()` é NULL, então
--     esp_col_exige_acesso() levanta 42501 "Não autenticado" — resposta
--     CORRETA da guarda, não defeito. Só que uma exceção solta aqui aborta a
--     transação inteira e desfaz toda a migration acima, que foi exatamente
--     o que aconteceu na primeira tentativa desta 057.
--
--     Por isso o teste vive dentro de um DO com EXCEPTION: ele informa por
--     NOTICE e nunca aborta. Leia a mensagem na aba de resultado.
DO $teste$
BEGIN
  PERFORM public.esp_col_arvore();
  RAISE NOTICE '[esp_col] arvore executou completa (havia sessão autenticada).';
EXCEPTION
  WHEN insufficient_privilege THEN
    -- Chegou até a guarda: prova que esp_col_arvore e esp_col_exige_acesso
    -- existem e se enxergam. É o resultado ESPERADO no SQL Editor.
    RAISE NOTICE '[esp_col] OK — parou na guarda de acesso (esperado no SQL Editor, sem usuário logado).';
  WHEN undefined_function THEN
    RAISE NOTICE '[esp_col] FALTA FUNÇÃO -> %', SQLERRM;
  WHEN undefined_table THEN
    RAISE NOTICE '[esp_col] FALTA TABELA -> %', SQLERRM;
  WHEN OTHERS THEN
    RAISE NOTICE '[esp_col] ERRO INESPERADO (%) -> %', SQLSTATE, SQLERRM;
END
$teste$;


-- ── Teste de ponta a ponta, OPCIONAL e fora desta migration ──────────
--
-- O DO acima prova que as peças existem, mas para na guarda — o corpo da
-- árvore (planilha_custo, o de-para, EMPREGADOS) só é exercitado com um
-- usuário de verdade. Para rodar como gente, cole isto SEPARADO, depois de
-- aplicar a migration, trocando o UUID pelo seu:
--
--   SELECT id, email FROM auth.users WHERE email = 'voce@empresa.com';
--
--   BEGIN;
--     SET LOCAL role = authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"COLE-O-UUID-AQUI","role":"authenticated"}';
--     SELECT public.esp_col_arvore() -> 'total_ativos'  AS total_ativos,
--            public.esp_col_arvore() -> 'sem_contrato'  AS sem_contrato;
--   ROLLBACK;
--
-- O ROLLBACK no fim é de propósito: o teste não deixa nada para trás, e o
-- SET LOCAL morre junto com a transação.



-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.esp_col_marcacoes(bigint, int, int);
--   DROP FUNCTION IF EXISTS public.esp_col_historico(bigint);
--   DROP FUNCTION IF EXISTS public.esp_col_exige_acesso();
--   DROP POLICY IF EXISTS empregados_select_espaco_colaborador ON public."EMPREGADOS";
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'central_servicos_espaco_colaborador';
--   DELETE FROM public.app_menu WHERE codigo = 'central_servicos_espaco_colaborador';
--   NOTIFY pgrst, 'reload schema';
--
--   (derrubar esp_col_exige_acesso deixa arvore/ficha/colaboradores/historico
--    /marcacoes inúteis — elas chamam a guarda. É o rollback da feature
--    inteira, não de um pedaço.)
-- =====================================================================
