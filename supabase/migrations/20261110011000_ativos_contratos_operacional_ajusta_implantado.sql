-- =========================================================================
-- ATIVOS/CONTRATOS — o OPERACIONAL ajusta o IMPLANTADO (10/11/2026)
--
-- PEDIDO (Pablo): "o operacional está atualizando as informações em
-- Ativos/Contratos mas tá voltando tudo de novo, preciso que os ajustes
-- deles sejam FIXOS".
--
-- O QUE ACONTECIA
--   Ninguém desfazia nada: os "Mover para…", os vínculos de posto e as
--   justificativas estão todos gravados, e o sync da Senior não toca nessas
--   tabelas. O que o operacional queria mudar era o número IMPLANTADO do
--   posto (ex.: TRIUNFO COLETA, 10/11: "retirado [um coletor] e colocado
--   para o quadro de motorista"). Esse número só muda por um registro em
--   CONTRATO_POSTO_IMPLANTADO, e a única porta era contrato_implantacao_salvar,
--   que exigia Licitação › Implantação (alterar). Ninguém do operacional tinha
--   essa permissão, e a tabela estava VAZIA: sem registro, o implantado é
--   sempre igual ao previsto da Planilha de Custo, então o número "voltava".
--
-- O QUE MUDA
--   contrato_implantacao_salvar passa a aceitar TAMBÉM quem vincula postos
--   em Ativos/Contratos (menu fantasma rh_ativos_contratos_vincular, a mesma
--   régua de rh_ac_exige(true) usada no "Mover para…"). O resto é idêntico
--   à mig 20261027000020: mesma validação, mesma justificativa obrigatória
--   quando difere do previsto, histórico só de inclusão. O registro vale até
--   alguém registrar outro, e nenhuma integração escreve nessa tabela.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.contrato_implantacao_salvar(p_contrato_id uuid, p_vale_a_partir_de date, p_postos jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_item jsonb;
  v_base record;
  v_impl integer;
  v_just text;
  v_n    integer := 0;
BEGIN
  -- Licitação (aba Implantação) OU o operacional que vincula postos em
  -- Ativos/Contratos (mig 20261110011000).
  IF NOT (public.has_screen_access(v_uid, 'licitacoes_contratos_implantacao', 'alterar')
          OR public.has_screen_access(v_uid, 'rh_ativos_contratos_vincular', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão para registrar a implantação de postos.' USING ERRCODE = '42501';
  END IF;
  IF p_vale_a_partir_de IS NULL THEN
    RAISE EXCEPTION 'Informe a partir de quando vale.';
  END IF;
  IF jsonb_typeof(p_postos) IS DISTINCT FROM 'array' OR jsonb_array_length(p_postos) = 0 THEN
    RAISE EXCEPTION 'Nenhum posto enviado.';
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), u.email) INTO v_nome
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.id = v_uid;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_postos) LOOP
    SELECT * INTO v_base
      FROM public.contrato_postos_base(current_date) b
     WHERE b.contrato_id = p_contrato_id AND b.posto_norm = public.sup_norm_nome(v_item->>'posto') AND NOT b.rt;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O posto "%" não está na Planilha de Custo vigente deste contrato.', v_item->>'posto';
    END IF;

    v_impl := NULLIF(v_item->>'implantado', '')::integer;
    IF v_impl IS NULL OR v_impl < 0 THEN
      RAISE EXCEPTION 'Implantado inválido no posto "%".', v_base.posto;
    END IF;
    v_just := NULLIF(btrim(COALESCE(v_item->>'justificativa', '')), '');
    IF v_impl <> v_base.previsto AND length(COALESCE(v_just, '')) < 5 THEN
      RAISE EXCEPTION 'Justifique por que o posto "%" tem % implantado(s) e % previsto(s).', v_base.posto, v_impl, v_base.previsto;
    END IF;

    INSERT INTO public."CONTRATO_POSTO_IMPLANTADO"
      (contrato_id, posto, posto_norm, previsto_no_registro, implantado, vale_a_partir_de,
       justificativa, registrado_por, registrado_por_nome)
    VALUES
      (p_contrato_id, v_base.posto, v_base.posto_norm, v_base.previsto, v_impl, p_vale_a_partir_de,
       v_just, v_uid, v_nome);
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END $function$;

REVOKE EXECUTE ON FUNCTION public.contrato_implantacao_salvar(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_implantacao_salvar(uuid, date, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta a exigir só Licitação › Implantação):
--   trocar o IF de permissão por
--   IF NOT public.has_screen_access(v_uid, 'licitacoes_contratos_implantacao', 'alterar') THEN
--   e reexecutar o CREATE OR REPLACE acima.
