-- =========================================================================
-- Central de Serviços › Veículos: KM inicial + foto do painel deixam de ser
-- obrigatórios AO AGENDAR — dá para preencher depois, na própria viagem.
--
-- Pedido do Pablo (23/09/2026): quem agenda nem sempre está com o carro na
-- frente (agenda de véspera, de outra unidade...), e a 20260930000211 barrava
-- o INSERT sem KM inicial + foto (trigger trg_cs_veic_exige_km).
--
-- O problema de só soltar o trigger: até aqui "viagem legado" era deduzida
-- de km_inicial IS NULL (20260930000211 e 20260930000215). Com o KM inicial
-- opcional, uma viagem NOVA sem KM viraria "legado" sozinha — fecharia sem
-- KM final e escaparia da trava de pendência. Por isso o sinal vira coluna
-- própria: controle_km (true para tudo que nasce daqui pra frente; false só
-- para as viagens que já existiam sem KM quando a coluna foi criada).
--
-- Regras depois desta migration, para viagem com controle_km:
--   • agendar: KM inicial e foto opcionais (se vierem, gravam);
--   • cs_veiculo_km_inicial(): registra depois o KM inicial e/ou a foto —
--     cada um uma vez só (não sobrescreve, é trilha de auditoria);
--   • fechar (cs_veiculo_km_final): continua exigindo KM final + foto, e
--     passa a exigir que o KM inicial já esteja registrado (sem ele não há
--     "rodou X km");
--   • pendência: viagem terminada e não fechada trava o próximo agendamento
--     — agora olhando controle_km, não km_inicial.
-- Viagem legado (controle_km = false) segue como na 20260930000215.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- 1) Sinal explícito de "viagem do fluxo com controle de KM" ---------------
-- O backfill só roda na PRIMEIRA aplicação (quando a coluna ainda não
-- existe): reexecutar depois não pode rebaixar viagem nova sem KM a legado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'cs_veiculo_agendamento'
                    AND column_name = 'controle_km') THEN
    ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN controle_km boolean NOT NULL DEFAULT true;
    UPDATE public.cs_veiculo_agendamento SET controle_km = false WHERE km_inicial IS NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.cs_veiculo_agendamento.controle_km IS
  'false = viagem anterior ao controle de KM (legado): fechar é opcional e não trava agendamento. true = KM final + foto obrigatórios para fechar.';

-- 2) Agendar sem KM inicial: o trigger só guarda a trava de pendência --------
CREATE OR REPLACE FUNCTION public.cs_veiculo_agendamento_exige_km() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE p record;
BEGIN
  IF NEW.km_inicial IS NOT NULL AND NEW.km_inicial < 0 THEN
    RAISE EXCEPTION 'KM inicial inválido.';
  END IF;
  NEW.km_inicial_foto := nullif(btrim(coalesce(NEW.km_inicial_foto, '')), '');
  SELECT * INTO p FROM public.cs_veiculo_km_pendentes(NEW.solicitante_id) LIMIT 1;
  IF p.id IS NOT NULL THEN
    RAISE EXCEPTION 'Feche o KM final da viagem nº % (% · % a %) antes de agendar outro veículo.',
      p.numero, p.veiculo_nome, to_char(p.data_inicio, 'DD/MM'), to_char(p.data_fim, 'DD/MM');
  END IF;
  IF NEW.km_inicial IS NOT NULL OR NEW.km_inicial_foto IS NOT NULL THEN
    NEW.km_inicial_em := coalesce(NEW.km_inicial_em, now());
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_cs_veic_exige_km ON public.cs_veiculo_agendamento;
CREATE TRIGGER trg_cs_veic_exige_km BEFORE INSERT ON public.cs_veiculo_agendamento
  FOR EACH ROW EXECUTE FUNCTION public.cs_veiculo_agendamento_exige_km();

-- 3) Pendência passa a olhar controle_km -------------------------------------
-- km_inicial pode vir nulo agora (a assinatura de retorno não muda).
CREATE OR REPLACE FUNCTION public.cs_veiculo_km_pendentes(p_usuario uuid DEFAULT NULL)
RETURNS TABLE (id uuid, numero bigint, veiculo_nome text, data_inicio date, data_fim date, km_inicial integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.numero, a.veiculo_nome, a.data_inicio, a.data_fim, a.km_inicial
    FROM public.cs_veiculo_agendamento a
   WHERE a.solicitante_id = coalesce(p_usuario, auth.uid())
     AND a.status = 'confirmado'
     AND a.controle_km
     AND a.km_final IS NULL
     AND a.data_fim < (now() AT TIME ZONE 'America/Sao_Paulo')::date
   ORDER BY a.data_fim;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculo_km_pendentes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_km_pendentes(uuid) TO authenticated;

-- 4) Registrar o KM inicial / a foto depois ----------------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_km_inicial(p_agendamento uuid, p_km integer, p_foto text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text; v_foto text := nullif(btrim(coalesce(p_foto, '')), '');
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou o Patrimônio) registra o KM desta viagem.';
  END IF;
  IF p_km IS NULL AND v_foto IS NULL THEN RAISE EXCEPTION 'Informe o KM inicial ou a foto do painel.'; END IF;
  IF p_km IS NOT NULL THEN
    IF a.km_inicial IS NOT NULL THEN RAISE EXCEPTION 'O KM inicial desta viagem já foi registrado (% km).', a.km_inicial; END IF;
    IF p_km < 0 THEN RAISE EXCEPTION 'KM inicial inválido.'; END IF;
    IF a.km_final IS NOT NULL AND p_km > a.km_final THEN
      RAISE EXCEPTION 'O KM inicial (%) não pode ser maior que o final (%).', p_km, a.km_final;
    END IF;
  END IF;
  IF v_foto IS NOT NULL AND a.km_inicial_foto IS NOT NULL THEN
    RAISE EXCEPTION 'A foto do KM inicial desta viagem já foi anexada.';
  END IF;

  UPDATE public.cs_veiculo_agendamento
     SET km_inicial      = coalesce(p_km, km_inicial),
         km_inicial_foto = coalesce(v_foto, km_inicial_foto),
         km_inicial_em   = coalesce(km_inicial_em, now()),
         updated_at      = now()
   WHERE id = p_agendamento;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'km_inicial',
          concat_ws(' · ',
            CASE WHEN p_km IS NOT NULL THEN 'KM inicial ' || p_km END,
            CASE WHEN v_foto IS NOT NULL THEN 'foto do painel anexada' END) || ' (registrado depois)',
          auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_km_inicial(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_km_inicial(uuid, integer, text) TO authenticated;

-- 5) Fechar a viagem: legado decidido por controle_km --------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_km_final(p_agendamento uuid, p_km integer, p_foto text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text;
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou o Patrimônio) fecha o KM desta viagem.';
  END IF;
  IF a.km_final IS NOT NULL THEN RAISE EXCEPTION 'Esta viagem já foi fechada com % km.', a.km_final; END IF;

  IF a.controle_km THEN
    -- Viagem do fluxo novo: KM inicial já registrado (na hora ou depois),
    -- e KM final + foto obrigatórios.
    IF a.km_inicial IS NULL THEN RAISE EXCEPTION 'Registre o KM inicial da viagem antes de fechar com o KM final.'; END IF;
    IF p_km IS NULL OR p_km < 0 THEN RAISE EXCEPTION 'Informe o KM final.'; END IF;
    IF p_km < a.km_inicial THEN
      RAISE EXCEPTION 'O KM final (%) não pode ser menor que o inicial (%).', p_km, a.km_inicial;
    END IF;
    IF nullif(btrim(coalesce(p_foto, '')), '') IS NULL THEN RAISE EXCEPTION 'Anexe a foto do painel com o KM final.'; END IF;
  ELSE
    -- Viagem legado: registro opcional, mas ao menos o KM ou a foto.
    IF p_km IS NOT NULL AND p_km < 0 THEN RAISE EXCEPTION 'KM final inválido.'; END IF;
    IF p_km IS NOT NULL AND a.km_inicial IS NOT NULL AND p_km < a.km_inicial THEN
      RAISE EXCEPTION 'O KM final (%) não pode ser menor que o inicial (%).', p_km, a.km_inicial;
    END IF;
    IF p_km IS NULL AND nullif(btrim(coalesce(p_foto, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Informe ao menos o KM final ou a foto do painel.';
    END IF;
  END IF;

  UPDATE public.cs_veiculo_agendamento
     SET km_final = p_km, km_final_foto = nullif(btrim(coalesce(p_foto, '')), ''), km_final_em = now(), updated_at = now()
   WHERE id = p_agendamento;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'km_final',
          'KM final ' || coalesce(p_km::text, '(não informado)') ||
          (CASE WHEN a.km_inicial IS NOT NULL AND p_km IS NOT NULL THEN ' · rodou ' || (p_km - a.km_inicial) || ' km' ELSE '' END),
          auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_km_final(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_km_final(uuid, integer, text) TO authenticated;

-- 6) A viagem devolve controle_km (a tela decide legado por ele) -------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_viagem(p_agendamento uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record;
BEGIN
  IF NOT tem_acesso_menu('central_servicos_veiculos') THEN RAISE EXCEPTION 'Sem acesso a Veículos.'; END IF;
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  RETURN jsonb_build_object(
    'id', a.id, 'numero', a.numero, 'veiculo_nome', a.veiculo_nome, 'veiculo_identificador', a.veiculo_identificador,
    'data_inicio', a.data_inicio, 'data_fim', a.data_fim, 'turno', a.turno, 'status', a.status,
    'solicitante_nome', a.solicitante_nome, 'solicitante_id', a.solicitante_id,
    'destino', a.destino, 'motivo', a.motivo, 'observacoes', a.observacoes,
    'controle_km', a.controle_km,
    'km_inicial', a.km_inicial, 'km_inicial_foto', a.km_inicial_foto, 'km_inicial_em', a.km_inicial_em,
    'km_final', a.km_final, 'km_final_foto', a.km_final_foto, 'km_final_em', a.km_final_em,
    'rodados', CASE WHEN a.km_final IS NOT NULL AND a.km_inicial IS NOT NULL THEN a.km_final - a.km_inicial END,
    'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object('codigo', c.contrato_codigo, 'nome', c.contrato_nome, 'administrativo', c.administrativo) ORDER BY c.contrato_nome)
                             FROM public.cs_veiculo_agendamento_contrato c WHERE c.agendamento_id = a.id), '[]'::jsonb),
    'abastecimentos', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                 'id', b.id, 'data', b.data, 'descricao', b.descricao, 'valor', b.valor, 'litros', b.litros, 'km', b.km,
                                 'storage_path', b.storage_path, 'nome_arquivo', b.nome_arquivo, 'criado_por_nome', b.criado_por_nome,
                                 'created_at', b.created_at,
                                 'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object('codigo', bc.contrato_codigo, 'nome', bc.contrato_nome, 'administrativo', bc.administrativo) ORDER BY bc.contrato_nome)
                                                          FROM public.cs_veiculo_abastecimento_contrato bc WHERE bc.abastecimento_id = b.id), '[]'::jsonb))
                                 ORDER BY b.data DESC, b.created_at DESC)
                                FROM public.cs_veiculo_abastecimento b WHERE b.agendamento_id = a.id), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_viagem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_viagem(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (volta a exigir KM inicial + foto ao agendar e o legado por km_inicial IS NULL)
-- Reaplicar os blocos 4) e 8) da 20260930000211 (trigger cs_veiculo_agendamento_exige_km,
-- cs_veiculo_km_pendentes e cs_veiculo_viagem) e a 20260930000215 inteira (cs_veiculo_km_final); depois:
-- DROP FUNCTION IF EXISTS public.cs_veiculo_km_inicial(uuid, integer, text);
-- ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN IF EXISTS controle_km;
-- NOTIFY pgrst, 'reload schema';
