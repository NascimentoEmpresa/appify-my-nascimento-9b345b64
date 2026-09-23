-- =========================================================================
-- Central de Serviços › Veículos: KM final + foto do painel deixam de ser
-- obrigatórios para fechar viagens LEGADO.
--
-- A 20260930000211 já trata "viagem legado" como a que nasceu sem
-- km_inicial (as ~148 anteriores ao controle, mais qualquer uma criada por
-- fora do fluxo novo) — é o mesmo sinal que cs_veiculo_km_pendentes() já usa
-- para não bloquear quem tem uma dessas em aberto. Só que
-- cs_veiculo_km_final() ficou exigindo KM final E foto de QUALQUER viagem,
-- inclusive essas — pedido do Pablo (22/09/2026): com muitas solicitações
-- antigas, preencher tudo retroativamente "torna impossível". A partir de
-- agora só quem tem km_inicial (viagem aberta já pelo fluxo novo) continua
-- com os dois campos obrigatórios; viagem legado aceita fechar com o que
-- tiver — mas não com os dois em branco, pra não gerar um "fechamento" sem
-- nenhuma informação.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

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

  IF a.km_inicial IS NOT NULL THEN
    -- Viagem do fluxo novo (já entrou com KM inicial + foto): continua
    -- exigindo os dois no fechamento.
    IF p_km IS NULL OR p_km < 0 THEN RAISE EXCEPTION 'Informe o KM final.'; END IF;
    IF p_km < a.km_inicial THEN
      RAISE EXCEPTION 'O KM final (%) não pode ser menor que o inicial (%).', p_km, a.km_inicial;
    END IF;
    IF nullif(btrim(coalesce(p_foto, '')), '') IS NULL THEN RAISE EXCEPTION 'Anexe a foto do painel com o KM final.'; END IF;
  ELSE
    -- Viagem legado (sem KM inicial): registro é opcional, mas não faz
    -- sentido "fechar" sem nada — exige ao menos o KM ou a foto.
    IF p_km IS NOT NULL AND p_km < 0 THEN RAISE EXCEPTION 'KM final inválido.'; END IF;
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

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- CREATE OR REPLACE FUNCTION public.cs_veiculo_km_final(p_agendamento uuid, p_km integer, p_foto text)
-- RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- DECLARE a record; v_nome text;
-- BEGIN
--   SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
--   IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
--   IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
--     RAISE EXCEPTION 'Só quem agendou (ou o Patrimônio) fecha o KM desta viagem.';
--   END IF;
--   IF a.km_final IS NOT NULL THEN RAISE EXCEPTION 'Esta viagem já foi fechada com % km.', a.km_final; END IF;
--   IF p_km IS NULL OR p_km < 0 THEN RAISE EXCEPTION 'Informe o KM final.'; END IF;
--   IF a.km_inicial IS NOT NULL AND p_km < a.km_inicial THEN
--     RAISE EXCEPTION 'O KM final (%) não pode ser menor que o inicial (%).', p_km, a.km_inicial;
--   END IF;
--   IF nullif(btrim(coalesce(p_foto, '')), '') IS NULL THEN RAISE EXCEPTION 'Anexe a foto do painel com o KM final.'; END IF;
--   UPDATE public.cs_veiculo_agendamento
--      SET km_final = p_km, km_final_foto = p_foto, km_final_em = now(), updated_at = now()
--    WHERE id = p_agendamento;
--   SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
--   INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
--   VALUES (p_agendamento, 'km_final',
--           'KM final ' || p_km || (CASE WHEN a.km_inicial IS NOT NULL THEN ' · rodou ' || (p_km - a.km_inicial) || ' km' ELSE '' END),
--           auth.uid(), v_nome);
-- END $fn$;
-- NOTIFY pgrst, 'reload schema';
