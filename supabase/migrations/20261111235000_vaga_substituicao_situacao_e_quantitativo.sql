-- =========================================================================
-- RECRUTAMENTO › SOLICITAR NOVA VAGA — Substituição pela SITUAÇÃO de quem
-- sai, e o quantitativo do contrato (chamado #0845, Fernanda, 11/11/2026)
--
-- PEDIDO (resumo do documento do chamado):
--   1. Substituição sempre pede o colaborador que será substituído — com
--      RT = Sim ou RT = Não.
--   2. Escolhido o colaborador, o sistema consulta a situação dele:
--        · demissão cadastrada  → libera ("Desligamento previsto para …");
--        · afastado             → libera ("afastado por motivo de: …"), para
--                                 QUALQUER motivo de afastamento;
--        · atestado vigente     → libera ("atestado lançado de X dias");
--        · ativo e trabalhando  → BLOQUEIA.
--   3. A falta de demissão deixa de barrar sozinha a Substituição (era o
--      gatilho rec_vaga_exige_demissao, mig 20260930000092).
--   4/5/6. Com o contrato carregado, mostrar ativos × cotado do contrato; se
--      ativos > cotado, Sim/Não — "Não" não prossegue, "Sim" exige a
--      JUSTIFICATIVA E QUEM AUTORIZOU. Vale com RT = Sim ou Não, e é uma
--      validação SEPARADA da situação do colaborador.
--
-- FONTES (nada novo é inventado — cada número é o de uma tela que já existe)
--   · Demissão: "SISTEMA_SOLICITACOES_DEMISSAO" (não Reprovada/Cancelada).
--     Desligamento previsto = dia da demissão da planilha de Rescisões
--     ("RH_RESCISAO".data_demissao, senão data_ultimo_dia); sem ela, o aviso
--     (+29 dias no Aviso Prévio Trabalhado). Senior com Situação "Demitido"
--     também conta (data = "Data Afastamento").
--   · Afastamento: a Situação da Senior ("EMPREGADOS"."Situação" ≠
--     Trabalhando, que não seja atestado nem demissão) — é ali que existem
--     TODOS os motivos (licença-maternidade, auxílio-doença, férias...) — e o
--     SST › Afastamentos ("SST_AFASTAMENTO" tipo auxilio_doenca /
--     acidente_trabalho / outros, vigente, não cancelado).
--   · Atestado: "SST_AFASTAMENTO" tipo atestado / atestado_acompanhante,
--     vigente hoje (sst_afa_fim, a mesma régua do Ativos/Contratos), não
--     cancelado e sem retorno registrado. Dias = dias_considerados (os do
--     atestado, ou os da telemedicina quando ela mudou). Senior em
--     "Atestado…" sem lançamento no SST também libera (dias em aberto).
--   · Quantitativo: a conta do RH › Ativos/Contratos —
--       cotado = Σ implantado vigente dos postos (contrato_postos_base: o
--                CONTRATO_POSTO_IMPLANTADO, ou o qt_postos da Planilha de
--                Custo EXECUTADA), sem RENDA TÉCNICA;
--       ativos = quem está ativo no contrato (rh_ac_pessoas_posto: inclui
--                afastados — continuam no quadro), sem RT e sem "fora da
--                conta".
--     Contrato sem Planilha de Custo → cotado NULL (a tela diz que não há
--     quantitativo cotado; nunca vira zero).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Colunas novas da vaga ─────────────────────────────────────────────
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS substituido_situacao        text,
  ADD COLUMN IF NOT EXISTS substituido_situacao_texto  text,
  ADD COLUMN IF NOT EXISTS quantitativo_ativos         integer,
  ADD COLUMN IF NOT EXISTS quantitativo_cotado         integer,
  ADD COLUMN IF NOT EXISTS quantitativo_justificativa  text;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".substituido_situacao IS
  'Substituição: situação de quem sai quando a vaga foi aberta — demissao | afastado | atestado (rec_substituido_situacao). #0845.';
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".substituido_situacao_texto IS
  'A frase que a tela mostrou (ex.: "Colaborador afastado por motivo de: licença-maternidade. Substituição permitida.").';
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".quantitativo_ativos IS
  'Ativos no contrato da vaga quando ela foi aberta (conta do Ativos/Contratos). #0845.';
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".quantitativo_cotado IS
  'Quantitativo cotado (implantado) do contrato quando a vaga foi aberta. NULL = contrato sem Planilha de Custo.';
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".quantitativo_justificativa IS
  'Contrato acima do cotado: motivo da contratação e nome de quem autorizou. Obrigatória quando ativos > cotado.';

-- ── 2. Situação de quem vai ser substituído ──────────────────────────────
-- Interna (sem EXECUTE para o client): a RPC da tela e o gatilho chamam.
CREATE OR REPLACE FUNCTION public.rec_substituido_situacao(p_empregado_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  e        record;
  d        record;
  v_tipo   text;
  v_dias   integer;
  v_sit    text;
  v_data   date;
  v_motivo text;
  hoje     date := current_date;
BEGIN
  SELECT x."ID", x."Nome", btrim(coalesce(x."Situação", '')) AS situacao,
         x."Empresa"::text AS empresa, x."Cadastro"::text AS cadastro,
         x."Data Afastamento"::text AS data_afastamento
    INTO e
    FROM public."EMPREGADOS" x WHERE x."ID" = p_empregado_id;
  IF e."ID" IS NULL THEN
    RETURN jsonb_build_object('situacao', 'nao_encontrado',
      'texto', 'Não achei o cadastro deste colaborador.', 'permite', false);
  END IF;
  v_sit := e.situacao;

  -- 1) Demissão cadastrada (a solicitação do ERP; senão, a Senior).
  SELECT s.id, s.data_aviso, s.modelo_aviso,
         coalesce(r.data_demissao, r.data_ultimo_dia) AS data_rescisao
    INTO d
    FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
    LEFT JOIN public."RH_RESCISAO" r ON r.solicitacao_id = s.id
   WHERE s.colaborador_id = p_empregado_id
     AND s.status NOT IN ('Reprovada', 'Cancelada')
   ORDER BY s.criado_em DESC
   LIMIT 1;
  IF d.id IS NOT NULL OR v_sit ~* '^(DEMIT|DESLIG|RESCIS)' THEN
    v_data := CASE
      WHEN d.id IS NULL THEN public.rh_data(e.data_afastamento)
      WHEN d.data_rescisao IS NOT NULL THEN d.data_rescisao
      WHEN d.data_aviso IS NOT NULL AND d.modelo_aviso = 'Aviso Prévio Trabalhado' THEN d.data_aviso + 29
      ELSE d.data_aviso END;
    RETURN jsonb_build_object(
      'situacao', 'demissao', 'permite', true,
      'demissao_id', d.id,
      'desligamento_previsto', v_data,
      'texto', 'Colaborador com demissão cadastrada.'
               || CASE WHEN v_data IS NOT NULL THEN ' Desligamento previsto para ' || to_char(v_data, 'DD/MM/YYYY') || '.' ELSE '' END
               || ' Vaga liberada para substituição.');
  END IF;

  -- Lançamentos do SST vigentes hoje (pessoa pelo id, ou empresa+cadastro:
  -- a carga da Senior recria o "ID").
  -- 2) Afastamento: Situação da Senior, senão o SST.
  IF v_sit <> '' AND v_sit <> 'Trabalhando' AND v_sit !~* '^atestado' THEN
    v_motivo := lower(v_sit);
  ELSE
    SELECT f.tipo INTO v_tipo
      FROM public."SST_AFASTAMENTO" f
     WHERE NOT f.cancelado
       AND f.tipo IN ('auxilio_doenca', 'acidente_trabalho', 'outros')
       AND (f.empregado_id = p_empregado_id
            OR (f.empresa::text = e.empresa AND f.cadastro::text = e.cadastro))
       AND f.data_inicio <= hoje
       AND public.sst_afa_fim(f.data_inicio, f.dias_considerados, f.retornou_em) >= hoje
       AND NOT (f.retornou_em IS NOT NULL AND f.retornou_em <= hoje)
     ORDER BY f.data_inicio DESC
     LIMIT 1;
    IF v_tipo IS NOT NULL THEN
      v_motivo := CASE v_tipo WHEN 'auxilio_doenca' THEN 'auxílio-doença'
                              WHEN 'acidente_trabalho' THEN 'acidente de trabalho'
                              ELSE 'outros afastamentos' END;
    END IF;
  END IF;
  IF v_motivo IS NOT NULL THEN
    RETURN jsonb_build_object(
      'situacao', 'afastado', 'permite', true, 'motivo', v_motivo,
      'texto', 'Colaborador afastado por motivo de: ' || v_motivo || '. Substituição permitida.');
  END IF;

  -- 3) Atestado vigente.
  SELECT f.dias_considerados INTO v_dias
    FROM public."SST_AFASTAMENTO" f
   WHERE NOT f.cancelado
     AND f.tipo IN ('atestado', 'atestado_acompanhante')
     AND (f.empregado_id = p_empregado_id
          OR (f.empresa::text = e.empresa AND f.cadastro::text = e.cadastro))
     AND f.data_inicio <= hoje
     AND public.sst_afa_fim(f.data_inicio, f.dias_considerados, f.retornou_em) >= hoje
     AND NOT (f.retornou_em IS NOT NULL AND f.retornou_em <= hoje)
   ORDER BY f.data_inicio DESC
   LIMIT 1;
  IF FOUND OR v_sit ~* '^atestado' THEN
    RETURN jsonb_build_object(
      'situacao', 'atestado', 'permite', true, 'dias', v_dias,
      'texto', 'Colaborador com atestado lançado'
               || CASE WHEN v_dias IS NOT NULL THEN ' de ' || v_dias || CASE WHEN v_dias = 1 THEN ' dia' ELSE ' dias' END ELSE '' END
               || '. Substituição permitida durante o atestado vigente.');
  END IF;

  -- 4) Ativo e trabalhando: bloqueia.
  RETURN jsonb_build_object(
    'situacao', 'trabalhando', 'permite', false,
    'texto', 'Colaborador ativo com status trabalhando. Não é possível prosseguir com a substituição.');
END $fn$;
REVOKE ALL ON FUNCTION public.rec_substituido_situacao(bigint) FROM PUBLIC, anon, authenticated;

-- ── 3. Quantitativo do contrato: ativos × cotado ─────────────────────────
-- Contrato pelo colaborador (o mesmo do Ativos/Contratos) ou, quando a vaga
-- trocou de contrato (RT pode alterar), pelo nome — mesma normalização.
CREATE OR REPLACE FUNCTION public.rec_contrato_quantitativo(p_empregado_id bigint, p_contrato text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id     uuid;
  v_nome   text;
  v_ativos integer;
  v_cotado numeric;
BEGIN
  IF p_empregado_id IS NOT NULL THEN
    SELECT a.contrato_id INTO v_id FROM public.rh_ac_ativos() a WHERE a.empregado_id = p_empregado_id LIMIT 1;
  END IF;
  IF v_id IS NULL AND public.rh_norm_contrato(p_contrato) IS NOT NULL THEN
    SELECT c.id INTO v_id
      FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) = public.rh_norm_contrato(p_contrato)
     ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
     LIMIT 1;
    IF v_id IS NULL THEN
      SELECT d.contrato_id INTO v_id
        FROM public.sup_empregado_contrato_depara d
       WHERE public.rh_norm_contrato(d.filial_nome) = public.rh_norm_contrato(p_contrato)
       ORDER BY d.contrato_id LIMIT 1;
    END IF;
  END IF;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('contrato_id', NULL);
  END IF;

  SELECT c.nome INTO v_nome FROM public.contratos c WHERE c.id = v_id;
  SELECT count(*) INTO v_ativos
    FROM public.rh_ac_pessoas_posto() p
   WHERE p.contrato_id = v_id AND NOT p.rt AND NOT p.fora;
  SELECT sum(b.implantado) INTO v_cotado
    FROM public.contrato_postos_base(current_date) b
   WHERE b.contrato_id = v_id AND NOT b.rt;

  RETURN jsonb_build_object(
    'contrato_id', v_id, 'contrato_nome', v_nome,
    'ativos', v_ativos,
    'cotado', CASE WHEN v_cotado IS NULL THEN NULL ELSE round(v_cotado)::int END);
END $fn$;
REVOKE ALL ON FUNCTION public.rec_contrato_quantitativo(bigint, text) FROM PUBLIC, anon, authenticated;

-- ── 4. RPC da tela: as duas validações de uma vez ────────────────────────
-- São duas respostas SEPARADAS (pedido do chamado, item 6): a situação diz
-- se a pessoa pode ser substituída; o quantitativo, como está o contrato.
CREATE OR REPLACE FUNCTION public.rec_vaga_substituicao_checar(p_empregado_id bigint, p_contrato text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'situacao', CASE WHEN p_empregado_id IS NULL THEN NULL ELSE public.rec_substituido_situacao(p_empregado_id) END,
    -- Contrato informado (trocado à mão) manda; senão, o da pessoa.
    'quantitativo', public.rec_contrato_quantitativo(CASE WHEN p_contrato IS NULL THEN p_empregado_id END, p_contrato));
END $fn$;
REVOKE ALL ON FUNCTION public.rec_vaga_substituicao_checar(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_vaga_substituicao_checar(bigint, text) TO authenticated;

-- ── 5. O gatilho deixa de exigir a demissão ──────────────────────────────
-- Antes: Substituição sem demissao_id → erro. Agora: sem demissão, vale a
-- situação de quem sai (afastado / atestado vigente libera; trabalhando
-- barra). Achou demissão em aberto e a vaga veio sem ela → vincula sozinho,
-- como a tela fazia. Com demissao_id, as conferências antigas continuam.
CREATE OR REPLACE FUNCTION public.rec_vaga_exige_demissao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d   record;
  sit jsonb;
BEGIN
  -- Só cobra quando o vínculo muda: editar o salário de uma vaga antiga de
  -- Substituição continua livre.
  IF TG_OP = 'UPDATE'
     AND NEW.motivo_vaga IS NOT DISTINCT FROM OLD.motivo_vaga
     AND NEW.substituido_id IS NOT DISTINCT FROM OLD.substituido_id
     AND NEW.demissao_id IS NOT DISTINCT FROM OLD.demissao_id THEN
    RETURN NEW;
  END IF;

  IF btrim(coalesce(NEW.motivo_vaga, '')) <> 'Substituição' THEN
    NEW.demissao_id := NULL;          -- só a substituição carrega o vínculo
    RETURN NEW;
  END IF;

  IF NEW.demissao_id IS NULL THEN
    IF NEW.substituido_id IS NULL THEN
      RAISE EXCEPTION 'Vaga de Substituição precisa do colaborador que será substituído.';
    END IF;
    sit := public.rec_substituido_situacao(NEW.substituido_id);
    IF NOT coalesce((sit->>'permite')::boolean, false) THEN
      RAISE EXCEPTION '%', sit->>'texto';
    END IF;
    IF sit->>'demissao_id' IS NOT NULL THEN
      NEW.demissao_id := (sit->>'demissao_id')::bigint;
    ELSE
      RETURN NEW;                     -- afastado / atestado: sem demissão mesmo
    END IF;
  END IF;

  SELECT id, colaborador_id, colaborador_nome, status INTO d
    FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = NEW.demissao_id;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'A solicitação de demissão #% não existe.', NEW.demissao_id;
  END IF;
  IF d.status = 'Reprovada' THEN
    RAISE EXCEPTION 'A solicitação de demissão #% foi reprovada — não abre vaga de substituição.', NEW.demissao_id;
  END IF;
  IF NEW.substituido_id IS DISTINCT FROM d.colaborador_id THEN
    RAISE EXCEPTION 'A demissão #% é de % — a vaga de substituição tem que repor essa mesma pessoa.', NEW.demissao_id, d.colaborador_nome;
  END IF;
  RETURN NEW;
END $fn$;

-- ── 6. Acima do cotado só com justificativa ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_vaga_exige_justificativa_quantitativo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.quantitativo_ativos IS NOT NULL AND NEW.quantitativo_cotado IS NOT NULL
     AND NEW.quantitativo_ativos > NEW.quantitativo_cotado
     AND coalesce(btrim(NEW.quantitativo_justificativa), '') = '' THEN
    RAISE EXCEPTION 'O contrato está acima do quantitativo cotado (% ativos para % cotados): informe a justificativa e quem autorizou a contratação.',
      NEW.quantitativo_ativos, NEW.quantitativo_cotado;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_rec_vaga_exige_justificativa_quantitativo ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_vaga_exige_justificativa_quantitativo
  BEFORE INSERT OR UPDATE OF quantitativo_ativos, quantitativo_cotado, quantitativo_justificativa
  ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_vaga_exige_justificativa_quantitativo();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_rec_vaga_exige_justificativa_quantitativo ON public."SISTEMA_RECRUTAMENTO";
--   DROP FUNCTION IF EXISTS public.rec_vaga_exige_justificativa_quantitativo();
--   DROP FUNCTION IF EXISTS public.rec_vaga_substituicao_checar(bigint, text);
--   DROP FUNCTION IF EXISTS public.rec_contrato_quantitativo(bigint, text);
--   DROP FUNCTION IF EXISTS public.rec_substituido_situacao(bigint);
--   Reaplicar rec_vaga_exige_demissao da mig 20260930000092 (exige demissao_id).
--   ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN IF EXISTS substituido_situacao,
--     DROP COLUMN IF EXISTS substituido_situacao_texto, DROP COLUMN IF EXISTS quantitativo_ativos,
--     DROP COLUMN IF EXISTS quantitativo_cotado, DROP COLUMN IF EXISTS quantitativo_justificativa;
