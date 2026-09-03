-- =====================================================================
-- ESPAÇO DO COLABORADOR — a ficha única de uma pessoa
--
-- O QUE É
--
--   Uma tela que abre a operação como árvore — Contrato → Posto → Função →
--   Colaborador — e, ao clicar numa pessoa, mostra TUDO que o sistema já
--   sabe sobre ela num lugar só: ponto do mês, advertências, uniformes/EPI
--   recebidos e trocas de função. Cada item vem com O ID DA ORIGEM, porque
--   a pergunta que a ficha precisa responder nunca é "ele recebeu bota?" e
--   sim "ele recebeu bota em QUAL pedido, e quem aprovou".
--
--   Nasce também para o crachá: o QR Code impresso leva o técnico de
--   segurança do trabalho, já autenticado, direto em
--   /app/central-servicos/espaco-colaborador/<matrícula>.
--
-- POR QUE TUDO PASSA POR RPC, E NÃO POR SELECT DIRETO
--
--   "EMPREGADOS" guarda CPF, salário, chave PIX e conta bancária na MESMA
--   linha que o nome e o cargo. Uma tela que faz `select *` para montar uma
--   ficha entrega tudo isso ao navegador de quem só precisava ver o cargo —
--   e o RLS não protege COLUNA, só linha. As funções abaixo devolvem lista
--   fixa de campos, e nenhum é sensível.
--
-- O ELO QUE NÃO EXISTE: EMPREGADOS ↔ contratos
--
--   Já documentado em 20260830000001 (Solicitar Materiais) e continua
--   valendo: `contrato_responsavel_id` está vazio para os 2.4 mil na ativa,
--   e "Nome do Posto" não casa com sup_posto. O único elo real é
--   "Nome Filial" ↔ contratos.nome (94%), completado à mão pela
--   sup_empregado_contrato_depara. Esta migration REUSA esse mesmo de-para
--   em vez de inventar um segundo — dois mapeamentos divergentes para a
--   mesma pergunta é como a árvore e a tela de materiais passariam a
--   mostrar contratos diferentes para a mesma pessoa.
--
-- O PONTO AINDA NÃO EXISTE NO BANCO
--
--   As batidas moram em espelho."BiMarcacoes", cópia do MySQL da Hagg. Esse
--   espelho NUNCA rodou: o túnel SSH falha por IP não liberado desde
--   18/08/2026 (ver espelho-mysql/logs/). Então a função de marcações:
--
--     • não referencia a tabela estaticamente — se ela não existe, a
--       migration teria falhado ao criar a função;
--     • descobre as colunas EM TEMPO DE EXECUÇÃO, porque o espelho copia os
--       nomes do MySQL verbatim (espelho.mjs) e ninguém aqui viu esse
--       schema ainda;
--     • devolve `disponivel=false` com um motivo legível em vez de erro,
--       para a aba de ponto explicar a situação em vez de quebrar.
--
--   No dia em que o espelho sincronizar, a aba passa a mostrar dados
--   SOZINHA, sem migration nova.
-- =====================================================================


-- ── 1. A tela entra no catálogo de menus ─────────────────────────────
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


-- ── 2. EMPREGADOS passa a reconhecer o novo menu ─────────────────────
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


-- ── 3. Guarda única de permissão ─────────────────────────────────────
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


-- ── 4. A árvore: contratos → postos → funções ────────────────────────
--
-- Devolve a estrutura INTEIRA de uma vez, sem os colaboradores. É de
-- propósito: são ~50 contratos e algumas centenas de postos/funções (poucos
-- KB), contra 2.4 mil pessoas que ninguém abre todas. A árvore fica
-- instantânea ao expandir e as pessoas chegam só quando se clica no posto.
--
-- `colaboradores` em cada contrato é CONTAGEM, não lista — serve para o nó
-- mostrar "48 colaboradores" sem baixar os 48.
CREATE OR REPLACE FUNCTION public.esp_col_arvore()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.esp_col_exige_acesso();

  WITH emp AS (
    -- Mesma resolução de contrato da sup_ext_colaboradores: filial casada
    -- por nome normalizado, com o de-para cobrindo o que não casa.
    SELECT COALESCE(dp.contrato_id, ct.id) AS contrato_id
      FROM public."EMPREGADOS" e
      LEFT JOIN public.contratos ct
             ON public.sup_norm_nome(ct.nome) = public.sup_norm_nome(e."Nome Filial")
      LEFT JOIN public.sup_empregado_contrato_depara dp
             ON dp.filial_nome = e."Nome Filial"
     WHERE COALESCE(e."Situação", '') <> 'Demitido'
       AND COALESCE(btrim(e."Nome"), '') <> ''
  ),
  cont_qtd AS (
    SELECT emp.contrato_id, count(*)::int AS qtd FROM emp
     WHERE emp.contrato_id IS NOT NULL GROUP BY emp.contrato_id
  ),
  func AS (
    SELECT f.posto_id, jsonb_agg(
             jsonb_build_object('id', f.id, 'nome', f.nome)
             ORDER BY f.nome) AS itens
      FROM public.sup_funcao f
     WHERE f.ativo GROUP BY f.posto_id
  ),
  posto AS (
    SELECT p.contrato_id, jsonb_agg(
             jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'descricao', p.descricao,
               'funcoes', COALESCE(fn.itens, '[]'::jsonb))
             ORDER BY p.nome) AS itens
      FROM public.sup_posto p
      LEFT JOIN func fn ON fn.posto_id = p.id
     WHERE p.ativo GROUP BY p.contrato_id
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id', c.id, 'nome', c.nome, 'cliente', c.cliente, 'status', c.status,
             'colaboradores', COALESCE(cq.qtd, 0),
             'postos', COALESCE(pt.itens, '[]'::jsonb))
           ORDER BY c.nome), '[]'::jsonb)
    INTO v_out
    FROM public.contratos c
    LEFT JOIN posto    pt ON pt.contrato_id = c.id
    LEFT JOIN cont_qtd cq ON cq.contrato_id = c.id
   WHERE COALESCE(c.status, 'ativo') <> 'encerrado';

  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_arvore() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_arvore() TO authenticated;


-- ── 5. As pessoas de um contrato ─────────────────────────────────────
--
-- Sai do banco já agrupável por posto e por cargo, e NUNCA com CPF, salário
-- ou dado bancário — a árvore precisa de nome, matrícula, cargo e situação,
-- e nada além disso.
CREATE OR REPLACE FUNCTION public.esp_col_colaboradores(
  p_contrato_id uuid DEFAULT NULL,
  p_busca       text DEFAULT NULL,
  p_limite      int  DEFAULT 500)
RETURNS TABLE (
  empregado_id bigint,
  matricula    text,
  nome         text,
  cargo        text,
  posto        text,
  filial       text,
  situacao     text,
  admissao     date,
  contrato_id  uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_lim    int := least(greatest(COALESCE(p_limite, 500), 1), 2000);
  v_termos text[];
BEGIN
  PERFORM public.esp_col_exige_acesso();

  -- Uma palavra = um filtro que precisa bater, para "jose avila" achar
  -- "JOSE DA CONCEICAO AVILA".
  v_termos := array_remove(string_to_array(public.sup_norm_busca(COALESCE(p_busca, '')), ' '), '');

  RETURN QUERY
  SELECT e."ID"::bigint,
         nullif(btrim(e."Cadastro"::text), ''),
         e."Nome",
         e."Título do Cargo",
         e."Nome do Posto",
         e."Nome Filial",
         e."Situação",
         public.rh_data(e."Admissão"::text),
         COALESCE(dp.contrato_id, ct.id)
    FROM public."EMPREGADOS" e
    LEFT JOIN public.contratos ct
           ON public.sup_norm_nome(ct.nome) = public.sup_norm_nome(e."Nome Filial")
    LEFT JOIN public.sup_empregado_contrato_depara dp
           ON dp.filial_nome = e."Nome Filial"
   WHERE COALESCE(e."Situação", '') <> 'Demitido'
     AND COALESCE(btrim(e."Nome"), '') <> ''
     AND (p_contrato_id IS NULL OR COALESCE(dp.contrato_id, ct.id) = p_contrato_id)
     AND (cardinality(v_termos) = 0 OR NOT EXISTS (
            SELECT 1 FROM unnest(v_termos) t
             WHERE public.sup_norm_busca(e."Nome") NOT LIKE '%' || t || '%'))
   ORDER BY e."Nome"
   LIMIT v_lim;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_colaboradores(uuid, text, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_colaboradores(uuid, text, int) TO authenticated;


-- ── 6. A ficha de UMA pessoa ─────────────────────────────────────────
--
-- Aceita ID do cadastro OU matrícula, e é por causa do crachá: o QR Code
-- impresso carrega a MATRÍCULA (o número que já está no crachá hoje), não
-- uma chave interna que ninguém consegue conferir a olho. Resolver os dois
-- aqui evita a tela ter que adivinhar qual é qual.
--
-- A matrícula ganha prioridade sobre o ID quando o texto casa com os dois:
-- quem chegou pelo QR veio de uma matrícula, e é essa a pessoa certa.
CREATE OR REPLACE FUNCTION public.esp_col_ficha(p_ref text)
RETURNS TABLE (
  empregado_id  bigint,
  matricula     text,
  nome          text,
  cargo         text,
  posto         text,
  filial        text,
  empresa       text,
  setor         text,
  situacao      text,
  admissao      date,
  escala        text,
  lider         text,
  contrato_id   uuid,
  contrato_nome text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_num bigint;
BEGIN
  PERFORM public.esp_col_exige_acesso();
  IF v_ref = '' THEN RETURN; END IF;

  -- Só vira número se for SÓ dígitos: '12A'::bigint levantaria exceção e
  -- derrubaria a ficha inteira em vez de simplesmente não achar ninguém.
  v_num := CASE WHEN v_ref ~ '^[0-9]+$' THEN v_ref::bigint ELSE NULL END;

  RETURN QUERY
  SELECT e."ID"::bigint,
         nullif(btrim(e."Cadastro"::text), ''),
         e."Nome",
         e."Título do Cargo",
         e."Nome do Posto",
         e."Nome Filial",
         e."Nome da Empresa",
         e."Setor_ERP",
         e."Situação",
         public.rh_data(e."Admissão"::text),
         e."Escala",
         e."LIDER",
         COALESCE(dp.contrato_id, ct.id),
         COALESCE(ctd.nome, ct.nome)
    FROM public."EMPREGADOS" e
    LEFT JOIN public.contratos ct
           ON public.sup_norm_nome(ct.nome) = public.sup_norm_nome(e."Nome Filial")
    LEFT JOIN public.sup_empregado_contrato_depara dp
           ON dp.filial_nome = e."Nome Filial"
    LEFT JOIN public.contratos ctd ON ctd.id = dp.contrato_id
   WHERE btrim(e."Cadastro"::text) = v_ref
      OR (v_num IS NOT NULL AND e."ID" = v_num)
   ORDER BY (btrim(e."Cadastro"::text) = v_ref) DESC
   LIMIT 1;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_ficha(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_ficha(text) TO authenticated;


-- ── 7. O histórico, tudo com o ID da origem ──────────────────────────
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


-- ── 8. As batidas de ponto do mês ────────────────────────────────────
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


-- ── Conferência ──────────────────────────────────────────────────────
-- Espera: 1 linha, módulo central_servicos, e permissoes = 1 por perfil
-- concede_tudo ativo (normalmente 1). ZERO aqui seria o bug: menu nao
-- configurado fica fora do enforcement e aparece para todo mundo.
SELECT mo.codigo AS modulo, m.codigo, m.rota,
       (SELECT count(*) FROM public.perfil_acesso_permissao p WHERE p.menu_codigo = m.codigo)
     + (SELECT count(*) FROM public.screen_permission_user s WHERE s.menu_codigo = m.codigo) AS permissoes
  FROM public.app_menu m
  JOIN public.app_modulo mo ON mo.id = m.modulo_id
 WHERE m.codigo = 'central_servicos_espaco_colaborador';

-- Espera: as 5 funções esp_col_* + a guarda.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'esp\_col\_%' ORDER BY 1;


-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.esp_col_marcacoes(bigint, int, int);
--   DROP FUNCTION IF EXISTS public.esp_col_historico(bigint);
--   DROP FUNCTION IF EXISTS public.esp_col_ficha(text);
--   DROP FUNCTION IF EXISTS public.esp_col_colaboradores(uuid, text, int);
--   DROP FUNCTION IF EXISTS public.esp_col_arvore();
--   DROP FUNCTION IF EXISTS public.esp_col_exige_acesso();
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'central_servicos_espaco_colaborador';
--   DELETE FROM public.app_menu WHERE codigo = 'central_servicos_espaco_colaborador';
--   DROP POLICY IF EXISTS empregados_select_espaco_colaborador ON public."EMPREGADOS";
--   NOTIFY pgrst, 'reload schema';
--
-- (o rollback da policy é só o DROP — ela nasceu separada justamente para
--  não haver nada de outra feature para restaurar aqui)
-- =====================================================================
