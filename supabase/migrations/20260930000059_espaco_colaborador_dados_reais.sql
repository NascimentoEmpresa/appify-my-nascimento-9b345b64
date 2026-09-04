-- =====================================================================
-- ESPAÇO DO COLABORADOR — o que a conferência no banco real revelou
--
-- Rodei as RPCs contra o banco de produção em 04/09/2026, com um usuário
-- autenticado de verdade. Três coisas que eu tinha ASSUMIDO estavam erradas,
-- e as duas primeiras eram premissas minhas que ninguém tinha checado.
--
-- =====================================================================
-- 1. O ESPELHO DO PONTO EXISTE — E TEM 3,65 MILHÕES DE MARCAÇÕES
-- =====================================================================
--
--   Eu escrevi na 051 que `espelho."BiMarcacoes"` "NUNCA rodou", baseado nos
--   logs de falha de SSH em espelho-mysql/logs/. Os logs estavam certos e a
--   conclusão errada: as falhas são das sincronizações RECENTES: a carga
--   inicial rodou. A tabela cobre 18/03/2024 a 03/09/2026 — dado de ontem.
--
--   E o formato é exatamente o que foi descrito no pedido original:
--
--     empresa  | matricula  | data_hora            | hora
--     1        | 100006983  | 2026-08-01 00:00:00  | 416
--
--   `data_hora` carrega só a DATA (hora zerada) e `hora` é O MINUTO DO DIA
--   (416 = 06:56). A conversão em src/lib/ponto.ts está certa, com teste.
--
--   POR QUE A DETECÇÃO AUTOMÁTICA FALHOU. A 051 descobria as colunas em
--   execução, com uma lista de nomes candidatos, porque ninguém tinha visto
--   o schema. Ela achou `matricula` e `hora`, e não achou a data — porque a
--   coluna se chama `data_hora`, que não estava na lista. Resultado: a aba
--   dizia "espelho não sincronizado" em cima de 3,6 milhões de linhas.
--
--   Agora o schema é conhecido, então some a adivinhação: as colunas são
--   referenciadas pelo nome. O SQL dinâmico continua, mas só para a tabela
--   poder não existir sem quebrar a função.
--
--   A CHAVE COM A PESSOA NÃO É DIRETA — e essa foi a parte que quase virou
--   outro bug silencioso. `BiMarcacoes.matricula` casa com
--   `EMPREGADOS."Cadastro"` em apenas 2 de 2.105 pessoas, porque o relógio
--   às vezes prefixa a matrícula com o código da empresa:
--
--     empresa=1, matricula=3997        → cadastro 3997   (sem prefixo)
--     empresa=1, matricula=100006983   → cadastro 6983   (prefixo 1 × 1e8)
--
--   `matricula % 100000000` normaliza os dois casos e casa 2.033 de 2.105
--   (96,6%). E a EMPRESA entra no casamento de propósito: "Cadastro" NÃO é
--   único (2.424 valores distintos para 2.446 ativos) — sem a empresa, duas
--   pessoas de filiais diferentes trocariam de cartão-ponto.
--
-- =====================================================================
-- 2. UNIFORMES/EPI: 1.443 PEDIDOS, NENHUM VINCULADO
-- =====================================================================
--
--   `sup_pedido.colaborador_empregado_id` — a coluna criada em
--   20260830000001 para ligar o pedido à pessoa — está NULL nas 1.443
--   linhas. A funcionalidade de escolher o colaborador na lista existe, mas
--   os pedidos em base são todos anteriores a ela.
--
--   Como o histórico só olhava essa coluna, a aba "Uniformes e EPI" estava
--   condenada a viver vazia. `matricula_colaborador` está preenchida em
--   1.442 delas e casa com o cadastro em 771 pedidos — então o histórico
--   passa a aceitar os dois caminhos, com o id continuando a ter prioridade
--   por ser a prova de que a pessoa foi ESCOLHIDA e não digitada.
--
--   As outras duas fontes (`SISTEMA_SOLICITACOES_ADVERTENCIA` e
--   `..._TROCA_FUNCAO`) têm ZERO linhas — os módulos ainda não foram usados.
--   Não há nada a corrigir ali: a aba vazia é a resposta certa, e passa a
--   dizer isso em vez de parecer defeito.
--
-- =====================================================================
-- 3. "LIDER" NÃO É NÍVEL HIERÁRQUICO — minha 052 piorou isto
-- =====================================================================
--
--   Na 052 eu troquei a identificação de chefia (que era pelo "Título do
--   Cargo") para a coluna "LIDER", citando o comentário do
--   EmpregadoDetalheModal que diz que ela guarda o NÍVEL. O comentário
--   descreve a INTENÇÃO; o dado real é outro:
--
--     'não' ................ 1.737     'SUPERVISOR' ............... 8
--     (vazio) ................. 642     'GERENTE' .................. 8
--     'APRENDIZ' ............... 13     'AUXILIAR ADMINISTRATIVO' .. 8
--
--   Ou seja: em 97% das linhas ela é um "sim/não" ou um cargo solto. Com a
--   regra da 052, a árvore inteira encontraria 8 supervisores e 0
--   encarregados. Pelo "Título do Cargo" são 68+ supervisores e 9
--   encarregados — e é assim que a operação enxerga.
--
--   A correção é no frontend (useEspacoColaborador.ts), não aqui: quem
--   decide isso é `ehSupervisor`/`ehEncarregado`. Esta migration só passa a
--   devolver as duas informações separadas, para a tela não ter que
--   escolher às cegas — `nivel` (o valor cru de LIDER) e o cargo.
-- =====================================================================


-- ── 1. Ponto: colunas reais e a chave com prefixo de empresa ─────────
CREATE OR REPLACE FUNCTION public.esp_col_marcacoes(
  p_empregado_id bigint,
  p_ano          int,
  p_mes          int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_cad    bigint;
  v_emp    int;
  v_de     date;
  v_ate    date;
  v_linhas jsonb;
BEGIN
  PERFORM public.esp_col_exige_acesso();

  IF to_regclass('espelho."BiMarcacoes"') IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
      'motivo', 'O espelho do relógio de ponto (espelho."BiMarcacoes") não está no banco.');
  END IF;

  -- Só converte o que for realmente numérico: o cadastro é texto livre e uma
  -- linha com letra derrubaria a ficha inteira num ::bigint.
  SELECT CASE WHEN btrim(e."Cadastro"::text) ~ '^[0-9]+$' THEN btrim(e."Cadastro"::text)::bigint END,
         CASE WHEN btrim(e."Empresa"::text)  ~ '^[0-9]+$' THEN btrim(e."Empresa"::text)::int    END
    INTO v_cad, v_emp
    FROM public."EMPREGADOS" e
   WHERE e."ID" = p_empregado_id;

  IF v_cad IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
      'motivo', 'Colaborador sem matrícula numérica no cadastro — não há como casar com o relógio de ponto.');
  END IF;

  v_de  := make_date(p_ano, p_mes, 1);
  v_ate := (v_de + interval '1 month')::date;

  -- `matricula % 100000000`: o relógio grava ora a matrícula pura (3997),
  -- ora prefixada pela empresa (100006983 = 1×1e8 + 6983). O módulo aceita
  -- as duas. A empresa entra no filtro porque "Cadastro" se repete entre
  -- filiais — sem ela, gente diferente compartilharia cartão-ponto.
  --
  -- EXECUTE porque a referência a espelho."BiMarcacoes" precisa ser tardia:
  -- referência estática impediria esta função de ser criada num banco onde
  -- o espelho ainda não existe (o de homologação, por exemplo).
  EXECUTE $q$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('data', d, 'minutos', h) ORDER BY d, h), '[]'::jsonb)
      FROM (
        SELECT DISTINCT m.data_hora::date AS d, m.hora AS h
          FROM espelho."BiMarcacoes" m
         WHERE (m.matricula % 100000000) = $1
           AND ($2 IS NULL OR m.empresa = $2)
           AND m.data_hora >= $3 AND m.data_hora < $4
      ) s
  $q$
  INTO v_linhas USING v_cad, v_emp, v_de, v_ate;

  RETURN jsonb_build_object(
    'disponivel', true,
    'matricula',  v_cad::text,
    'linhas',     COALESCE(v_linhas, '[]'::jsonb));

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('disponivel', false, 'linhas', '[]'::jsonb,
    'motivo', 'Falha ao ler o espelho do ponto: ' || SQLERRM);
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_marcacoes(bigint, int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_marcacoes(bigint, int, int) TO authenticated;


-- ── 2. Histórico: aceita o pedido casado por matrícula ───────────────
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
DECLARE v_cad text;
BEGIN
  PERFORM public.esp_col_exige_acesso();
  IF p_empregado_id IS NULL THEN RETURN; END IF;

  SELECT nullif(btrim(e."Cadastro"::text), '') INTO v_cad
    FROM public."EMPREGADOS" e WHERE e."ID" = p_empregado_id;

  RETURN QUERY
  SELECT 'advertencia'::text, a.id::text, a.id::text,
         COALESCE(a.data_ocorrido::timestamptz, a.created_at),
         COALESCE(a.tipo_advertencia, 'Advertência'),
         a.descricao_ocorrido, a.status,
         jsonb_build_object('grau', a.grau, 'resultado', a.resultado,
           'contrato', a.contrato, 'solicitante', a.solicitante_nome,
           'aprovado_por', a.aprovado_por_nome, 'parecer_juridico', a.parecer_juridico)
    FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
   WHERE a.colaborador_id = p_empregado_id

  UNION ALL
  SELECT 'troca_funcao'::text, t.id::text, t.id::text,
         COALESCE(t.data_pretendida::timestamptz, t.criado_em),
         COALESCE(t.cargo_atual, '—') || ' → ' || t.cargo_novo,
         t.motivo, t.status,
         jsonb_build_object('cargo_atual', t.cargo_atual, 'cargo_novo', t.cargo_novo,
           'posto', t.posto, 'filial', t.filial, 'solicitante', t.solicitante_nome,
           'aprovador', t.aprovador_nome, 'rh_em', t.rh_em)
    FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
   WHERE t.colaborador_id = p_empregado_id

  UNION ALL
  -- Dois caminhos até a pessoa. O id é a prova de que ela foi ESCOLHIDA na
  -- lista; a matrícula é o que existe nos 1.443 pedidos anteriores a essa
  -- funcionalidade. `vinculo` no extra diz por qual caminho veio, para
  -- ninguém tratar um casamento por texto como se fosse referência.
  SELECT 'material'::text, pd.id::text, pd.pedido_id, pd.created_at,
         'Uniformes / EPI'::text,
         (SELECT string_agg(i.quantidade || '× ' || i.nome_item
                            || COALESCE(' (' || i.tamanho || ')', ''), ', '
                            ORDER BY i.ordem, i.nome_item)
            FROM public.sup_pedido_item i WHERE i.pedido_id = pd.id),
         pd.status,
         jsonb_build_object('contrato', pd.contrato_nome, 'posto', pd.posto_nome,
           'funcao', pd.funcao_nome,
           'vinculo', CASE WHEN pd.colaborador_empregado_id = p_empregado_id
                           THEN 'colaborador escolhido na lista'
                           ELSE 'casado pela matrícula ' || COALESCE(v_cad,'?') END,
           'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                              'id', i.id, 'nome', i.nome_item, 'tipo', i.tipo_item,
                              'tamanho', i.tamanho, 'quantidade', i.quantidade)
                              ORDER BY i.ordem, i.nome_item), '[]'::jsonb)
                       FROM public.sup_pedido_item i WHERE i.pedido_id = pd.id))
    FROM public.sup_pedido pd
   WHERE pd.colaborador_empregado_id = p_empregado_id
      OR (pd.colaborador_empregado_id IS NULL
          AND v_cad IS NOT NULL
          AND btrim(pd.matricula_colaborador) = v_cad)

  ORDER BY 4 DESC NULLS LAST;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_historico(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_historico(bigint) TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ── Conferência (nada aqui pode lançar) ──────────────────────────────
DO $t$
DECLARE n int;
BEGIN
  EXECUTE 'SELECT count(*) FROM espelho."BiMarcacoes"' INTO n;
  RAISE NOTICE '[esp_col] espelho do ponto: % marcacoes', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[esp_col] espelho indisponivel: %', SQLERRM;
END $t$;

-- Cobertura do casamento ponto → cadastro (esperado ~96%).
SELECT count(DISTINCT p.matricula)                          AS matriculas_no_ponto,
       count(DISTINCT e."ID")                               AS pessoas_casadas
  FROM (SELECT DISTINCT empresa, matricula FROM espelho."BiMarcacoes"
         WHERE data_hora >= (now() - interval '60 days')) p
  LEFT JOIN public."EMPREGADOS" e
         ON btrim(e."Cadastro"::text) ~ '^[0-9]+$'
        AND btrim(e."Cadastro"::text)::bigint = (p.matricula % 100000000)
        AND btrim(e."Empresa"::text) = p.empresa::text;

-- Pedidos de material que passam a ser alcançáveis pelo histórico.
SELECT count(*) FILTER (WHERE colaborador_empregado_id IS NOT NULL) AS por_id,
       count(*) FILTER (WHERE colaborador_empregado_id IS NULL
                          AND matricula_colaborador IS NOT NULL)     AS por_matricula,
       count(*)                                                      AS total
  FROM public.sup_pedido;


-- =====================================================================
-- ROLLBACK
--   Reexecutar 20260930000051 devolve esp_col_marcacoes e esp_col_historico
--   às versões anteriores — que "funcionam" no sentido de não dar erro, e
--   devolvem vazio para todo mundo. NOTIFY pgrst, 'reload schema';
-- =====================================================================
