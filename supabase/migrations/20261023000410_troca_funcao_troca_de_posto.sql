-- =========================================================================
-- Mudança de Função: troca de POSTO DE TRABALHO (23/10/2026)
--
-- PEDIDO (chamado colado pelo Pablo): registrar também a troca de posto,
-- junto com a de função e a de horário. Posto atual preenchido sozinho pelo
-- cadastro; posto novo escolhido entre os postos JÁ cadastrados (sem
-- digitação), mostrando contrato + unidade + nome do posto. Três tipos de
-- movimentação: alteração de função, só horário e só posto — e a troca só
-- de posto não pode obrigar cargo novo nem horário novo. O pedido tem que
-- deixar claro Cargo atual → novo, Posto atual → novo, Horário atual → novo
-- no fluxo, no detalhe, no histórico e no que chega ao RH/Operacional/SST.
--
-- QUE "POSTO" É ESTE
--   O posto de trabalho da Senior (PO-xxxxx, estrutura 003 "Hagg 2026"):
--   RH_POSTO_TRABALHO (mig 20261007000024), o mesmo código que o sync grava
--   em EMPREGADOS."Posto" (descrição em "Nome do Posto"). É nele que o RH
--   faz a alteração na Senior — por isso NÃO é o sup_posto do Catálogo de
--   Suprimentos (posto da Planilha de Custo, outra coisa). Nada é copiado:
--   o pedido guarda só o código e um retrato do nome/contrato do dia, para
--   o histórico não mudar se a Senior renomear o posto depois.
--
--   contrato = CONTRATOS."NOME CONTRATO" pela empresa+filial do posto;
--   unidade  = a "Descrição do Local" mais comum entre quem está no posto
--              hoje (EMPREGADOS, ao vivo) — é o nome que o encarregado
--              reconhece ("PALÁCIO DA POLÍCIA", "EMEF ...").
--
-- AS REGRAS (gatilho BEFORE INSERT, só pedido NOVO — mesmo motivo da 243:
-- pedido antigo não pode travar aprovar/concluir)
--   tipo 'funcao'  → cargo novo + horário novo; posto novo OPCIONAL
--                    (troca de função que também muda de posto).
--   tipo 'horario' → horário novo; posto NÃO muda (é "só horário").
--   tipo 'posto'   → posto novo obrigatório; cargo fica o atual (cargo_novo
--                    é NOT NULL e recebe o cargo atual, igual ao 'horario');
--                    horário novo OPCIONAL (vazio = continua o mesmo).
--   posto novo tem que existir em RH_POSTO_TRABALHO, ativo, e ser diferente
--   do atual. O posto ATUAL é lido do cadastro pelo colaborador_id — o que a
--   tela mandar é sobrescrito, igual ao "cargo atual travado" da tela.
--   Espelho em src/lib/trocaFuncao/solicitacao.ts (validarTroca), testado
--   em src/test/troca-funcao-posto.test.ts.
--
-- QUEM LISTA OS POSTOS: a leitura de RH_POSTO_TRABALHO é só de quem tem a
-- Hierarquia de Postos (rh_hier_pode). O encarregado não tem, então a lista
-- sai por RPC SECURITY DEFINER gateada pelas telas que pedem/decidem a troca.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Colunas ───────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  ADD COLUMN IF NOT EXISTS posto_atual_codigo   text,
  ADD COLUMN IF NOT EXISTS posto_atual_nome     text,
  ADD COLUMN IF NOT EXISTS posto_atual_contrato text,
  ADD COLUMN IF NOT EXISTS posto_novo_codigo    text,
  ADD COLUMN IF NOT EXISTS posto_novo_nome      text,
  ADD COLUMN IF NOT EXISTS posto_novo_contrato  text;

ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" DROP CONSTRAINT IF EXISTS stf_tipo_chk;
ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  ADD CONSTRAINT stf_tipo_chk CHECK (tipo IN ('funcao', 'horario', 'posto'));

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_TROCA_FUNCAO".tipo IS
  'funcao = troca de cargo (horário junto, posto opcional); horario = só carga horária; posto = só posto de trabalho (cargo_novo = cargo_atual, horário opcional).';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_TROCA_FUNCAO".posto_novo_codigo IS
  'Posto de trabalho da Senior (RH_POSTO_TRABALHO.codigo, PO-xxxxx). NULL = o posto não muda.';

-- ── 2) Contrato e unidade de um posto ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stf_contrato_do_posto(_codigo text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c."NOME CONTRATO"
    FROM public."RH_POSTO_TRABALHO" p
    JOIN public."CONTRATOS" c ON c."Empresa" = p.empresa AND c."Filial" = p.filial
   WHERE p.codigo = _codigo
   ORDER BY (c."ATIVO" = 'SIM') DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.stf_contrato_do_posto(text) FROM PUBLIC, anon, authenticated;

-- ── 3) Postos para escolher ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stf_postos_trabalho()
RETURNS TABLE (codigo text, nome text, contrato text, unidade text, ocupantes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- Os nomes de saída (codigo, nome, contrato…) batem com colunas lidas abaixo.
#variable_conflict use_column
BEGIN
  IF NOT (public.can_access(auth.uid(), 'encarregados_troca_funcao', 'visualizar')
          OR public.can_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar')
          OR public.can_access(auth.uid(), 'operacional_troca_funcao', 'visualizar')
          OR public.can_access(auth.uid(), 'escritorio_troca_funcao', 'visualizar')
          OR public.can_access(auth.uid(), 'diretoria_troca_funcao', 'visualizar')
          OR public.can_access(auth.uid(), 'sst_troca_funcao', 'visualizar')
          OR public.can_access(auth.uid(), 'rh_troca_funcao', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso à Mudança de Função.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ocup AS (
    SELECT e."Posto" AS posto, btrim(e."Descrição do Local") AS lugar, count(*)::int AS n
      FROM public."EMPREGADOS" e
     WHERE COALESCE(e."Situação", '') <> 'Demitido'
       AND btrim(COALESCE(e."Posto", '')) <> ''
     GROUP BY 1, 2
  ), por_posto AS (
    SELECT o.posto,
           (array_agg(o.lugar ORDER BY o.n DESC) FILTER (WHERE COALESCE(o.lugar, '') <> ''))[1] AS unidade,
           sum(o.n)::int AS ocupantes
      FROM ocup o GROUP BY o.posto
  ), contrato_do_par AS (
    SELECT DISTINCT ON (c."Empresa", c."Filial") c."Empresa" AS empresa, c."Filial" AS filial, c."NOME CONTRATO" AS nome
      FROM public."CONTRATOS" c
     ORDER BY c."Empresa", c."Filial", (c."ATIVO" = 'SIM') DESC
  )
  SELECT p.codigo, p.descricao, ct.nome, pp.unidade, COALESCE(pp.ocupantes, 0)
    FROM public."RH_POSTO_TRABALHO" p
    LEFT JOIN contrato_do_par ct ON ct.empresa = p.empresa AND ct.filial = p.filial
    LEFT JOIN por_posto pp ON pp.posto = p.codigo
   WHERE p.ativo
   ORDER BY ct.nome NULLS LAST, p.descricao;
END $fn$;
REVOKE ALL ON FUNCTION public.stf_postos_trabalho() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stf_postos_trabalho() TO authenticated;

-- ── 4) As regras do pedido novo ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stf_valida_troca()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_posto text;
  v_nome  text;
  v_novo  public."RH_POSTO_TRABALHO"%ROWTYPE;
BEGIN
  NEW.tipo := COALESCE(NULLIF(btrim(NEW.tipo), ''), 'funcao');
  NEW.posto_novo_codigo := NULLIF(btrim(NEW.posto_novo_codigo), '');
  NEW.horario_novo      := NULLIF(btrim(NEW.horario_novo), '');

  -- Posto atual: do cadastro, não da tela.
  IF NEW.colaborador_id IS NOT NULL THEN
    SELECT NULLIF(btrim(e."Posto"), ''), NULLIF(btrim(e."Nome do Posto"), '')
      INTO v_posto, v_nome
      FROM public."EMPREGADOS" e WHERE e."ID" = NEW.colaborador_id;
    NEW.posto_atual_codigo   := v_posto;
    NEW.posto_atual_nome     := COALESCE((SELECT p.descricao FROM public."RH_POSTO_TRABALHO" p WHERE p.codigo = v_posto), v_nome);
    NEW.posto_atual_contrato := public.stf_contrato_do_posto(v_posto);
  END IF;

  IF NEW.tipo = 'posto' AND NEW.posto_novo_codigo IS NULL THEN
    RAISE EXCEPTION 'Escolha o posto novo (troca só de posto).';
  END IF;
  IF NEW.tipo = 'horario' AND NEW.posto_novo_codigo IS NOT NULL THEN
    RAISE EXCEPTION 'Troca só de horário não muda o posto — escolha "Só posto" ou "Alteração de função".';
  END IF;
  IF NEW.tipo IN ('funcao', 'horario') AND NEW.horario_novo IS NULL THEN
    RAISE EXCEPTION 'Informe o horário / carga horária nova.';
  END IF;
  IF NEW.tipo IN ('horario', 'posto') THEN
    NEW.cargo_novo := COALESCE(NEW.cargo_atual, '—');
  END IF;

  IF NEW.posto_novo_codigo IS NULL THEN
    NEW.posto_novo_nome := NULL;
    NEW.posto_novo_contrato := NULL;
  ELSE
    SELECT * INTO v_novo FROM public."RH_POSTO_TRABALHO" p WHERE p.codigo = NEW.posto_novo_codigo AND p.ativo;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O posto % não está entre os postos cadastrados.', NEW.posto_novo_codigo;
    END IF;
    IF NEW.posto_novo_codigo = NEW.posto_atual_codigo THEN
      RAISE EXCEPTION 'O posto novo é o mesmo em que a pessoa já está.';
    END IF;
    NEW.posto_novo_nome     := v_novo.descricao;
    NEW.posto_novo_contrato := public.stf_contrato_do_posto(v_novo.codigo);
  END IF;

  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.stf_valida_troca() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stf_valida_troca ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
CREATE TRIGGER trg_stf_valida_troca
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  FOR EACH ROW EXECUTE FUNCTION public.stf_valida_troca();

-- ── 5) O resumo "atual → novo" (mesma régua de resumoDaTroca no front) ───
CREATE OR REPLACE FUNCTION public.stf_resumo_troca(t public."SISTEMA_SOLICITACOES_TROCA_FUNCAO")
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(NULLIF(concat_ws(' · ',
    CASE WHEN COALESCE(t.tipo, 'funcao') = 'funcao'
         THEN 'Cargo: ' || COALESCE(t.cargo_atual, '—') || ' → ' || COALESCE(t.cargo_novo, '—') END,
    CASE WHEN t.posto_novo_codigo IS NOT NULL
         THEN 'Posto: ' || COALESCE(t.posto_atual_nome, t.posto_atual_codigo, '—') || ' → ' || COALESCE(t.posto_novo_nome, t.posto_novo_codigo) END,
    CASE WHEN NULLIF(btrim(t.horario_novo), '') IS NOT NULL
              AND upper(btrim(t.horario_novo)) IS DISTINCT FROM upper(btrim(COALESCE(t.horario_atual, '')))
         THEN 'Horário: ' || COALESCE(NULLIF(btrim(t.horario_atual), ''), '—') || ' → ' || btrim(t.horario_novo) END
  ), ''), COALESCE(t.cargo_atual, '—') || ' → ' || COALESCE(t.cargo_novo, '—'))
$$;
GRANT EXECUTE ON FUNCTION public.stf_resumo_troca(public."SISTEMA_SOLICITACOES_TROCA_FUNCAO") TO authenticated;

-- ── 6) Histórico: Espaço do Colaborador (corpo da 20261015000001, só a
--       linha da troca muda: título pelo resumo e posto/horário no extra) ──
CREATE OR REPLACE FUNCTION public.esp_col_historico(p_empregado_id bigint)
 RETURNS TABLE(origem text, origem_id text, protocolo text, data_ref timestamp with time zone, titulo text, detalhe text, status text, extra jsonb)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cad text;
BEGIN
  PERFORM public.esp_col_exige_acesso(p_empregado_id);
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
         public.stf_resumo_troca(t),
         t.motivo, t.status,
         jsonb_strip_nulls(jsonb_build_object('cargo_atual', t.cargo_atual, 'cargo_novo', t.cargo_novo,
           'posto', t.posto, 'filial', t.filial, 'solicitante', t.solicitante_nome,
           'aprovador', t.aprovador_nome, 'rh_em', t.rh_em,
           'horario_atual', t.horario_atual, 'horario_novo', t.horario_novo,
           'posto_atual', t.posto_atual_nome, 'posto_novo', t.posto_novo_nome,
           'contrato_do_posto_novo', t.posto_novo_contrato))
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
END $function$;

-- ── 7) Histórico: Portal do Colaborador (corpo da 20260930000196; a troca
--       ganha `resumo`, `tipo` e os postos) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.col_historico(p_emp bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cpf text; v_fer jsonb; v_tro jsonb; v_adv jsonb;
BEGIN
  SELECT public.col_digitos(e."CPF") INTO v_cpf FROM public."EMPREGADOS" e WHERE e."ID" = p_emp;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'saida', f.data_saida, 'retorno', f.data_retorno, 'dias', f.dias_ferias,
           'vendidos', f.dias_vendidos, 'status', f.status, 'criado_em', f.criado_em,
           'motivo_reprovacao', f.motivo_reprovacao) ORDER BY f.criado_em DESC), '[]'::jsonb)
    INTO v_fer
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f
   WHERE f.colaborador_id = p_emp OR (v_cpf <> '' AND public.col_digitos(f.colaborador_cpf) = v_cpf);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'cargo_atual', t.cargo_atual, 'cargo_novo', t.cargo_novo, 'posto', t.posto,
           'tipo', t.tipo, 'resumo', public.stf_resumo_troca(t),
           'posto_atual', t.posto_atual_nome, 'posto_novo', t.posto_novo_nome,
           'data_pretendida', t.data_pretendida, 'status', t.status, 'criado_em', t.criado_em) ORDER BY t.criado_em DESC), '[]'::jsonb)
    INTO v_tro
    FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
   WHERE t.colaborador_id = p_emp;

  -- Só o que já foi decidido: uma solicitação ainda em análise não é
  -- advertência, e o texto livre do encarregado fica de fora.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'tipo', a.tipo_advertencia, 'grau', a.grau, 'data', a.data_ocorrido,
           'status', a.status, 'resultado', a.resultado, 'criado_em', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO v_adv
    FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
   WHERE (a.colaborador_id = p_emp OR (v_cpf <> '' AND public.col_digitos(a.colaborador_cpf) = v_cpf))
     AND a.resultado IS NOT NULL;

  RETURN jsonb_build_object('ferias', v_fer, 'trocas_funcao', v_tro, 'advertencias', v_adv);
END $$;

-- ── 8) Sino de Operacional/Diretoria/SST/RH (corpo da 20260930000240; o
--       texto troca "cargo → cargo" pelo resumo — na troca só de posto
--       saía "RECEPCIONISTA → RECEPCIONISTA") ─────────────────────────────
CREATE OR REPLACE FUNCTION public.sino_troca_funcao_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_quem text := '#' || NEW.id || ' · ' || coalesce(NEW.colaborador_nome, '—')
                 || coalesce(' — ' || public.stf_resumo_troca(NEW), '');
  v_dir  uuid[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'Pendente Operacional' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('operacional_troca_funcao', 'visualizar'),
      'Nova solicitação de mudança de função', v_quem, 'info', '/app/operacional/troca-funcao');
  ELSIF NEW.status = 'Pendente Escritório' THEN
    -- Duas portas para a mesma fila; quem tem as duas recebe um aviso só.
    v_dir := public.sino_quem_tem_setor('diretoria_troca_funcao', 'visualizar', NEW.setor);
    PERFORM public.jur_notificar(v_dir,
      'Nova solicitação de mudança de função', v_quem || ' (escritório)', 'info', '/app/diretoria/troca-funcao-escritorio');
    PERFORM public.jur_notificar(
      ARRAY(SELECT u FROM unnest(public.sino_quem_tem_setor('escritorio_troca_funcao', 'visualizar', NEW.setor)) AS u
             WHERE u <> ALL (v_dir)),
      'Nova solicitação de mudança de função', v_quem || ' (escritório)', 'info', '/app/rh/troca-funcao-escritorio');
  ELSIF NEW.status = 'Pendente SST' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('sst_troca_funcao', 'visualizar'),
      'Mudança de função — ASO a tratar', v_quem, 'info', '/app/sst/troca-funcao');
  ELSIF NEW.status = 'Pendente RH' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('rh_troca_funcao', 'visualizar'),
      'Mudança de função aguardando o RH', v_quem, 'info', '/app/rh/troca-funcao');
  END IF;
  RETURN NEW;
END $fn$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reexecutar esp_col_historico da 20261015000001, col_historico da 20260930000196
-- e sino_troca_funcao_notificar da 20260930000240 (antes do DROP de stf_resumo_troca);
-- DROP TRIGGER IF EXISTS trg_stf_valida_troca ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
-- DROP FUNCTION IF EXISTS public.stf_valida_troca(), public.stf_postos_trabalho(),
--   public.stf_contrato_do_posto(text), public.stf_resumo_troca(public."SISTEMA_SOLICITACOES_TROCA_FUNCAO");
-- DELETE FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" WHERE tipo = 'posto';  -- só se ninguém usou
-- ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" DROP CONSTRAINT IF EXISTS stf_tipo_chk;
-- ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
--   ADD CONSTRAINT stf_tipo_chk CHECK (tipo IN ('funcao', 'horario'));
-- ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
--   DROP COLUMN IF EXISTS posto_atual_codigo, DROP COLUMN IF EXISTS posto_atual_nome,
--   DROP COLUMN IF EXISTS posto_atual_contrato, DROP COLUMN IF EXISTS posto_novo_codigo,
--   DROP COLUMN IF EXISTS posto_novo_nome, DROP COLUMN IF EXISTS posto_novo_contrato;
-- NOTIFY pgrst, 'reload schema';
