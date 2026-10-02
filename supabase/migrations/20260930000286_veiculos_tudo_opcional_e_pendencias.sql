-- =========================================================================
-- Central de Serviços › Veículos: KM e fotos TODOS opcionais, nada trava o
-- próximo agendamento, e as pendências viram um painel (02/10/2026).
--
-- Pedido do Pablo: "se tem algo pendente, tem que ter um painel só de coisas
-- pendentes [...] e deixa tudo opcional pra não travar ninguém de usar o
-- sistema" — e "mesmo anexando a nota e o km final não tá dando pra
-- finalizar". A causa do segundo: a 20260930000219 manteve, para viagem com
-- controle_km, KM inicial + KM final + foto obrigatórios para fechar. As 4
-- viagens abertas no banco do app em 02/10 estavam todas SEM KM inicial — a
-- tela dizia "registre o KM inicial antes de fechar" e a RPC recusava.
--
-- Depois desta migration:
--   • fechar ("Finalizar viagem") = coluna nova finalizada_em. KM final e
--     foto são opcionais; o que vier grava (cada um uma vez só, trilha de
--     auditoria), e dá para completar depois mesmo com a viagem finalizada;
--   • o trigger do INSERT não barra mais por pendência — só valida o KM;
--   • cs_veiculo_minhas_pendencias(): o que falta em cada viagem minha que
--     já começou e não foi finalizada, para o painel da tela (lembrete, não
--     trava). cs_veiculo_km_pendentes() continua existindo (mesma
--     assinatura), agora olhando finalizada_em.
--   • controle_km continua na tabela (relatório/dashboard), mas não muda
--     mais regra nenhuma.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- 1) Marca de viagem finalizada --------------------------------------------
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS finalizada_em timestamptz;
COMMENT ON COLUMN public.cs_veiculo_agendamento.finalizada_em IS
  'Quando a viagem foi finalizada (Finalizar viagem). KM final e foto são opcionais desde a mig 286 — a viagem fecha por esta coluna, não por km_final.';
UPDATE public.cs_veiculo_agendamento
   SET finalizada_em = coalesce(km_final_em, updated_at, now())
 WHERE finalizada_em IS NULL AND km_final IS NOT NULL;

-- 2) Agendar não trava mais por pendência -----------------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_agendamento_exige_km() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.km_inicial IS NOT NULL AND NEW.km_inicial < 0 THEN
    RAISE EXCEPTION 'KM inicial inválido.';
  END IF;
  NEW.km_inicial_foto := nullif(btrim(coalesce(NEW.km_inicial_foto, '')), '');
  IF NEW.km_inicial IS NOT NULL OR NEW.km_inicial_foto IS NOT NULL THEN
    NEW.km_inicial_em := coalesce(NEW.km_inicial_em, now());
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_cs_veic_exige_km ON public.cs_veiculo_agendamento;
CREATE TRIGGER trg_cs_veic_exige_km BEFORE INSERT ON public.cs_veiculo_agendamento
  FOR EACH ROW EXECUTE FUNCTION public.cs_veiculo_agendamento_exige_km();

-- 3) Viagens terminadas e não finalizadas (mesma assinatura) ----------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_km_pendentes(p_usuario uuid DEFAULT NULL)
RETURNS TABLE (id uuid, numero bigint, veiculo_nome text, data_inicio date, data_fim date, km_inicial integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.numero, a.veiculo_nome, a.data_inicio, a.data_fim, a.km_inicial
    FROM public.cs_veiculo_agendamento a
   WHERE a.solicitante_id = coalesce(p_usuario, auth.uid())
     AND a.status = 'confirmado'
     AND a.controle_km
     AND a.finalizada_em IS NULL
     AND a.data_fim < (now() AT TIME ZONE 'America/Sao_Paulo')::date
   ORDER BY a.data_fim;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculo_km_pendentes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_km_pendentes(uuid) TO authenticated;

-- 4) O painel de pendências ------------------------------------------------
-- Viagens minhas que já começaram e não foram finalizadas, com o que falta.
CREATE OR REPLACE FUNCTION public.cs_veiculo_minhas_pendencias()
RETURNS TABLE (
  id uuid, numero bigint, veiculo_nome text, data_inicio date, data_fim date, terminou boolean,
  falta_km_inicial boolean, falta_foto_inicial boolean, falta_km_final boolean, falta_foto_final boolean, notas integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.numero, a.veiculo_nome, a.data_inicio, a.data_fim,
         a.data_fim < (now() AT TIME ZONE 'America/Sao_Paulo')::date,
         a.km_inicial IS NULL, a.km_inicial_foto IS NULL, a.km_final IS NULL, a.km_final_foto IS NULL,
         (SELECT count(*)::int FROM public.cs_veiculo_abastecimento b WHERE b.agendamento_id = a.id)
    FROM public.cs_veiculo_agendamento a
   WHERE a.solicitante_id = auth.uid()
     AND a.status = 'confirmado'
     AND a.controle_km
     AND a.finalizada_em IS NULL
     AND a.data_inicio <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
   ORDER BY a.data_fim, a.numero;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculo_minhas_pendencias() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_minhas_pendencias() TO authenticated;

-- 5) Finalizar / completar o KM final: tudo opcional -------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_km_final(p_agendamento uuid, p_km integer, p_foto text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text; v_foto text := nullif(btrim(coalesce(p_foto, '')), '');
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou o Patrimônio) finaliza esta viagem.';
  END IF;
  IF p_km IS NOT NULL THEN
    IF a.km_final IS NOT NULL THEN RAISE EXCEPTION 'O KM final desta viagem já foi registrado (% km).', a.km_final; END IF;
    IF p_km < 0 THEN RAISE EXCEPTION 'KM final inválido.'; END IF;
    IF a.km_inicial IS NOT NULL AND p_km < a.km_inicial THEN
      RAISE EXCEPTION 'O KM final (%) não pode ser menor que o inicial (%).', p_km, a.km_inicial;
    END IF;
  END IF;
  IF v_foto IS NOT NULL AND a.km_final_foto IS NOT NULL THEN
    RAISE EXCEPTION 'A foto do KM final desta viagem já foi anexada.';
  END IF;
  IF a.finalizada_em IS NOT NULL AND p_km IS NULL AND v_foto IS NULL THEN
    RAISE EXCEPTION 'Esta viagem já foi finalizada.';
  END IF;

  UPDATE public.cs_veiculo_agendamento
     SET km_final      = coalesce(p_km, km_final),
         km_final_foto = coalesce(v_foto, km_final_foto),
         km_final_em   = CASE WHEN p_km IS NOT NULL OR v_foto IS NOT NULL THEN coalesce(km_final_em, now()) ELSE km_final_em END,
         finalizada_em = coalesce(finalizada_em, now()),
         updated_at    = now()
   WHERE id = p_agendamento;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'km_final',
          concat_ws(' · ',
            CASE WHEN a.finalizada_em IS NULL THEN 'Viagem finalizada' ELSE 'KM final completado' END,
            CASE WHEN p_km IS NOT NULL THEN 'KM final ' || p_km END,
            CASE WHEN p_km IS NOT NULL AND a.km_inicial IS NOT NULL THEN 'rodou ' || (p_km - a.km_inicial) || ' km' END,
            CASE WHEN v_foto IS NOT NULL THEN 'foto do painel anexada' END),
          auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_km_final(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_km_final(uuid, integer, text) TO authenticated;

-- 6) A viagem devolve finalizada_em ----------------------------------------
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
    'controle_km', a.controle_km, 'finalizada_em', a.finalizada_em,
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
-- Reaplicar os blocos 2), 3), 5) e 6) da 20260930000219 (trava por pendência no
-- trigger, km_pendentes por km_final, fechar exigindo KM inicial + final + foto); depois:
-- DROP FUNCTION IF EXISTS public.cs_veiculo_minhas_pendencias();
-- ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN IF EXISTS finalizada_em;
-- NOTIFY pgrst, 'reload schema';
