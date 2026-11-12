-- =========================================================================
-- Central de Serviços › Agendamento de Veículos: ajustes do modal da VIAGEM
-- pedidos pelo Senilton (12/11/2026).
--
-- PEDIDO (Frota / Senilton), sobre o modal "Viagem nº 240 · JEEP COMPAS":
--   1) KM inicial puxado da viagem anterior: o KM de chegada da última viagem
--      FECHADA daquele veículo, qualquer que seja o motorista;
--   2) KM de saída e de retorno OBRIGATÓRIOS para o responsável; a foto do
--      painel passa a ser OPCIONAL (antes o KM final exigia foto na tela);
--   3) no lugar das "Notas de abastecimento": "Houve abastecimento? Sim/Não".
--      Sim → a foto da nota passa a ser obrigatória;
--   4) fotos ou vídeo do estado do veículo, OPCIONAL (resguarda o motorista);
--   5) checklist INICIAL (saída) ganha a marcação obrigatória "revisão de
--      água e óleo OK";
--   6) um campo de texto livre para relatar algo sobre o agendamento.
--   Fora daqui: integração com os rastreadores ("assim que possível").
--
-- MUDANÇA DE REGRA (de propósito) sobre a 20261110220000:
--   • a prestação deixa de cobrar o "vídeo completo do veículo" (agora é
--     opcional, item 4) e a "verificação de água e óleo" da CHEGADA — a
--     marcação mudou para a SAÍDA (item 5), onde é cobrada no ato;
--   • a nota de combustível passa a depender da resposta: sem resposta,
--     falta "Responder se houve abastecimento"; Sim sem nota, falta a nota;
--     Não, nada. sem_abastecimento ("não abasteci", do checklist de
--     chegada) continua valendo como "Não" — as duas colunas andam juntas
--     pelo trg_cs_veic_abastecimento_resposta.
--   • concluir o agendamento passa a exigir a prestação completa (KM de
--     saída e retorno, resposta do abastecimento + nota se Sim, avaria) —
--     é isso que faz a obrigatoriedade valer no banco, não só na tela.
--   Tudo só para viagem com prestacao_exigida (as de 10/11/2026 em diante).
--
-- O QUE ESTA MIGRATION FAZ
--   1) cs_veiculo_agendamento ganha houve_abastecimento (NULL = sem
--      resposta) e relato/relato_em/relato_por_nome; CS_VEICULO_CHECKLIST
--      ganha agua_oleo_exigido (false no que já existia).
--   2) Triggers: resposta do abastecimento ↔ sem_abastecimento; nota anexada
--      → houve_abastecimento = true; saída sem água/óleo OK → recusa.
--   3) cs_veic_prestacao_faltando: régua nova (espelho em
--      src/lib/veiculos/rotaDoDia.ts › faltandoPrestacao).
--   4) cs_veiculo_km_inicial / cs_veiculo_km_final: KM obrigatório, foto
--      opcional. cs_veiculo_concluir: exige a prestação.
--   5) cs_veiculo_abastecimento_responder, tabela CS_VEICULO_VIAGEM_MIDIA +
--      cs_veiculo_midia_registrar/excluir, cs_veiculo_relato_salvar.
--   6) cs_veiculo_viagem devolve: km_sugerido (item 1), houve_abastecimento,
--      midias, relato, prestacao_exigida e prestacao_faltando.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- 1) Colunas -----------------------------------------------------------------
ALTER TABLE public.cs_veiculo_agendamento
  ADD COLUMN IF NOT EXISTS houve_abastecimento boolean,
  ADD COLUMN IF NOT EXISTS relato              text,
  ADD COLUMN IF NOT EXISTS relato_em           timestamptz,
  ADD COLUMN IF NOT EXISTS relato_por_nome     text;
COMMENT ON COLUMN public.cs_veiculo_agendamento.houve_abastecimento IS
  'Resposta de "Houve abastecimento?" no modal da viagem: true = Sim (nota obrigatória), false = Não, NULL = sem resposta. Anda junto com sem_abastecimento (trg_cs_veic_abastecimento_resposta).';
COMMENT ON COLUMN public.cs_veiculo_agendamento.relato IS
  'Observação livre do responsável sobre o agendamento/viagem (modal da viagem). Diferente de observacoes, que é do ato de agendar.';

-- O que já existe: "não abasteci" vira Não; viagem com nota vira Sim.
UPDATE public.cs_veiculo_agendamento a
   SET houve_abastecimento = CASE WHEN a.sem_abastecimento THEN false ELSE true END
 WHERE a.houve_abastecimento IS NULL
   AND (a.sem_abastecimento
        OR EXISTS (SELECT 1 FROM public.cs_veiculo_abastecimento b WHERE b.agendamento_id = a.id));

ALTER TABLE public."CS_VEICULO_CHECKLIST"
  ADD COLUMN IF NOT EXISTS agua_oleo_exigido boolean NOT NULL DEFAULT false;
-- DEFAULT false no ADD preenche o que já existe; daqui para a frente, true.
ALTER TABLE public."CS_VEICULO_CHECKLIST" ALTER COLUMN agua_oleo_exigido SET DEFAULT true;
COMMENT ON COLUMN public."CS_VEICULO_CHECKLIST".agua_oleo_exigido IS
  'true = checklist de SAÍDA criado depois de 12/11/2026: exige a marcação "revisão de água e óleo OK" (trg_cs_veic_checklist_agua_oleo).';

-- 2a) Resposta do abastecimento ↔ "não abasteci" -----------------------------
-- Quem muda houve_abastecimento manda; se só sem_abastecimento mudou (o
-- checkbox do checklist de chegada), a resposta acompanha.
CREATE OR REPLACE FUNCTION public.cs_veic_abastecimento_resposta() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.houve_abastecimento IS DISTINCT FROM OLD.houve_abastecimento THEN
    NEW.sem_abastecimento := coalesce(NEW.houve_abastecimento = false, false);
  ELSIF NEW.sem_abastecimento IS DISTINCT FROM OLD.sem_abastecimento THEN
    NEW.houve_abastecimento := CASE WHEN NEW.sem_abastecimento THEN false
                                    WHEN OLD.houve_abastecimento = false THEN NULL
                                    ELSE OLD.houve_abastecimento END;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veic_abastecimento_resposta() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cs_veic_abastecimento_resposta ON public.cs_veiculo_agendamento;
CREATE TRIGGER trg_cs_veic_abastecimento_resposta
  BEFORE UPDATE OF houve_abastecimento, sem_abastecimento ON public.cs_veiculo_agendamento
  FOR EACH ROW EXECUTE FUNCTION public.cs_veic_abastecimento_resposta();

-- 2b) Nota anexada = houve abastecimento -------------------------------------
CREATE OR REPLACE FUNCTION public.cs_veic_abastecimento_nota_marca_sim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  BEGIN
    UPDATE public.cs_veiculo_agendamento
       SET houve_abastecimento = true, updated_at = now()
     WHERE id = NEW.agendamento_id AND houve_abastecimento IS DISTINCT FROM true;
  EXCEPTION WHEN others THEN
    -- Nunca derruba a nota (ex.: carro que entrou em manutenção depois).
    RAISE NOTICE 'cs_veic_abastecimento_nota_marca_sim: %', SQLERRM;
  END;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veic_abastecimento_nota_marca_sim() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cs_veic_abastecimento_nota_marca_sim ON public.cs_veiculo_abastecimento;
CREATE TRIGGER trg_cs_veic_abastecimento_nota_marca_sim
  AFTER INSERT ON public.cs_veiculo_abastecimento
  FOR EACH ROW EXECUTE FUNCTION public.cs_veic_abastecimento_nota_marca_sim();

-- 2c) Checklist de saída: revisão de água e óleo OK obrigatória ---------------
-- A RPC cs_veiculo_checklist_salvar cria a linha vazia e logo faz o UPDATE
-- com o conteúdo — é nesse UPDATE que a trava age (e o INSERT volta junto).
CREATE OR REPLACE FUNCTION public.cs_veic_checklist_agua_oleo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (coalesce(NEW.agua_verificada, false) AND coalesce(NEW.oleo_verificado, false))
     AND EXISTS (SELECT 1 FROM public.cs_veiculo_agendamento a
                  WHERE a.id = NEW.agendamento_id AND a.prestacao_exigida) THEN
    RAISE EXCEPTION 'Marque "Revisão de água e óleo OK" no checklist de saída.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veic_checklist_agua_oleo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cs_veic_checklist_agua_oleo ON public."CS_VEICULO_CHECKLIST";
CREATE TRIGGER trg_cs_veic_checklist_agua_oleo
  BEFORE UPDATE ON public."CS_VEICULO_CHECKLIST"
  FOR EACH ROW WHEN (NEW.tipo = 'saida' AND NEW.agua_oleo_exigido)
  EXECUTE FUNCTION public.cs_veic_checklist_agua_oleo();

-- 3) A prestação da viagem (régua nova) --------------------------------------
-- Espelho de src/lib/veiculos/rotaDoDia.ts (faltandoPrestacao). Mudou aqui, muda lá.
CREATE OR REPLACE FUNCTION public.cs_veic_prestacao_faltando(p_agendamento uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN a.km_inicial IS NULL THEN 'KM de saída' END,
    CASE WHEN a.km_final IS NULL THEN 'KM de retorno' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.cs_veiculo_abastecimento ab WHERE ab.agendamento_id = a.id) THEN NULL
         WHEN a.houve_abastecimento = false OR a.sem_abastecimento THEN NULL
         WHEN a.houve_abastecimento THEN 'Foto da nota do combustível'
         ELSE 'Responder se houve abastecimento' END,
    CASE WHEN c.avaria IS NULL THEN 'Informar se há avaria'
         WHEN c.avaria AND nullif(btrim(coalesce(c.avaria_descricao, '')), '') IS NULL THEN 'Descrição da avaria' END
  ], NULL)
    FROM public.cs_veiculo_agendamento a
    LEFT JOIN public."CS_VEICULO_CHECKLIST" c ON c.agendamento_id = a.id AND c.tipo = 'chegada'
   WHERE a.id = p_agendamento;
$$;
REVOKE ALL ON FUNCTION public.cs_veic_prestacao_faltando(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veic_prestacao_faltando(uuid) TO authenticated;

-- 4a) KM inicial: o número é obrigatório, a foto não ---------------------------
-- Cópia da 20261110220000 com a regra "KM obrigatório" marcada.
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
  -- KM obrigatório (12/11/2026): a foto sozinha não registra a saída.
  IF p_km IS NULL AND a.km_inicial IS NULL AND a.prestacao_exigida THEN
    RAISE EXCEPTION 'Informe o KM de saída (número do painel). A foto é opcional.';
  END IF;
  -- prestação: começar a viagem pelo KM inicial também exige a anterior completa.
  IF a.km_inicial IS NULL AND a.prestacao_exigida
     AND NOT EXISTS (SELECT 1 FROM public."CS_VEICULO_CHECKLIST" s WHERE s.agendamento_id = a.id AND s.tipo = 'saida') THEN
    PERFORM public.cs_veic_exige_prestacao(p_agendamento);
  END IF;
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
  IF p_km IS NOT NULL THEN PERFORM public.cs_veic_registrar_km_anterior(p_agendamento, p_km, v_nome); END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_km_inicial(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_km_inicial(uuid, integer, text) TO authenticated;

-- 4b) KM final: o número é obrigatório para finalizar, a foto não --------------
-- Cópia da 20260930000286 com a regra "KM obrigatório" marcada.
CREATE OR REPLACE FUNCTION public.cs_veiculo_km_final(p_agendamento uuid, p_km integer, p_foto text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text; v_foto text := nullif(btrim(coalesce(p_foto, '')), '');
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou o Patrimônio) finaliza esta viagem.';
  END IF;
  -- KM obrigatório (12/11/2026): sem o número do painel, a viagem não finaliza.
  IF p_km IS NULL AND a.km_final IS NULL AND a.prestacao_exigida THEN
    RAISE EXCEPTION 'Informe o KM de retorno (número do painel) para finalizar a viagem. A foto é opcional.';
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

-- 4c) Concluir exige a prestação completa -------------------------------------
-- Cópia da 20261110003700 com o bloco "prestação" acrescentado.
CREATE OR REPLACE FUNCTION public.cs_veiculo_concluir(p_agendamento uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_falta text[];
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) conclui este agendamento.';
  END IF;
  IF a.status = 'concluido' THEN RAISE EXCEPTION 'Este agendamento já está concluído.'; END IF;
  IF a.status <> 'confirmado' THEN RAISE EXCEPTION 'Este agendamento está %.', a.status; END IF;
  IF a.finalizada_em IS NULL THEN
    RAISE EXCEPTION 'Finalize a viagem (registre o KM final) antes de concluir o agendamento.';
  END IF;
  -- prestação (12/11/2026): KM de saída e retorno, resposta do abastecimento
  -- (+ nota se Sim) e avaria. "Não usei o carro" não tem prestação.
  IF a.prestacao_exigida AND a.nao_utilizado_em IS NULL THEN
    v_falta := public.cs_veic_prestacao_faltando(p_agendamento);
    IF cardinality(v_falta) > 0 THEN
      RAISE EXCEPTION 'Antes de concluir, falta: %.', array_to_string(v_falta, ', ') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.cs_veiculo_agendamento
     SET status = 'concluido', updated_at = now()
   WHERE id = p_agendamento;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_concluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_concluir(uuid) TO authenticated;

-- 5a) "Houve abastecimento?" ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_abastecimento_responder(p_agendamento uuid, p_houve boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text; v_notas int;
BEGIN
  IF p_houve IS NULL THEN RAISE EXCEPTION 'Responda Sim ou Não.'; END IF;
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) responde pelo abastecimento.';
  END IF;
  IF a.status = 'cancelado' THEN RAISE EXCEPTION 'Agendamento cancelado.'; END IF;
  SELECT count(*) INTO v_notas FROM public.cs_veiculo_abastecimento WHERE agendamento_id = p_agendamento;
  IF NOT p_houve AND v_notas > 0 THEN
    RAISE EXCEPTION 'Esta viagem já tem % nota(s) de abastecimento anexada(s) — a resposta é Sim.', v_notas;
  END IF;
  IF a.houve_abastecimento IS NOT DISTINCT FROM p_houve THEN RETURN; END IF;

  UPDATE public.cs_veiculo_agendamento SET houve_abastecimento = p_houve, updated_at = now() WHERE id = p_agendamento;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'abastecimento',
          CASE WHEN p_houve THEN 'Houve abastecimento: Sim' || CASE WHEN v_notas = 0 THEN ' — falta anexar a foto da nota' ELSE '' END
               ELSE 'Houve abastecimento: Não' END,
          auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_abastecimento_responder(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_abastecimento_responder(uuid, boolean) TO authenticated;

-- 5b) Fotos/vídeo do estado do veículo (opcional) -------------------------------
-- Arquivos no bucket cs-veiculos-checklist (aceita vídeo de até 200 MB), na
-- pasta <agendamento_id>/midia/ — a policy do bucket já exige esse prefixo.
CREATE TABLE IF NOT EXISTS public."CS_VEICULO_VIAGEM_MIDIA" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id  uuid NOT NULL REFERENCES public.cs_veiculo_agendamento(id) ON DELETE CASCADE,
  storage_path    text NOT NULL,
  nome_arquivo    text NOT NULL,
  tipo            text,
  tamanho         bigint,
  criado_por      uuid DEFAULT auth.uid(),
  criado_por_nome text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cs_veic_viagem_midia_agend ON public."CS_VEICULO_VIAGEM_MIDIA"(agendamento_id, created_at);
COMMENT ON TABLE public."CS_VEICULO_VIAGEM_MIDIA" IS
  'Fotos/vídeos do estado do veículo anexados na viagem (opcional, resguarda o motorista). Escrita e leitura só pelas RPCs cs_veiculo_midia_* e cs_veiculo_viagem.';
ALTER TABLE public."CS_VEICULO_VIAGEM_MIDIA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_VEICULO_VIAGEM_MIDIA" FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cs_veiculo_midia_registrar(p_agendamento uuid, p_arquivos jsonb)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text; f jsonb; n int := 0; v_path text; v_videos int := 0;
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) anexa fotos/vídeo nesta viagem.';
  END IF;
  IF a.status = 'cancelado' THEN RAISE EXCEPTION 'Agendamento cancelado.'; END IF;
  IF jsonb_typeof(p_arquivos) <> 'array' OR jsonb_array_length(p_arquivos) = 0 THEN
    RAISE EXCEPTION 'Nenhum arquivo enviado.';
  END IF;
  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  FOR f IN SELECT * FROM jsonb_array_elements(p_arquivos) LOOP
    v_path := nullif(btrim(coalesce(f->>'path', '')), '');
    IF v_path IS NULL OR left(v_path, length(p_agendamento::text || '/midia/')) <> p_agendamento::text || '/midia/' THEN
      RAISE EXCEPTION 'Arquivo fora da pasta do agendamento: %', coalesce(v_path, '(vazio)');
    END IF;
    INSERT INTO public."CS_VEICULO_VIAGEM_MIDIA"(agendamento_id, storage_path, nome_arquivo, tipo, tamanho, criado_por, criado_por_nome)
    VALUES (p_agendamento, v_path, coalesce(nullif(btrim(f->>'nome'), ''), v_path), nullif(f->>'tipo', ''),
            nullif(f->>'tamanho', '')::bigint, auth.uid(), v_nome);
    n := n + 1;
    IF coalesce(f->>'tipo', '') LIKE 'video/%' THEN v_videos := v_videos + 1; END IF;
  END LOOP;
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'midia',
          concat_ws(' e ',
            CASE WHEN n - v_videos > 0 THEN (n - v_videos) || ' foto(s)' END,
            CASE WHEN v_videos > 0 THEN v_videos || ' vídeo(s)' END) || ' do estado do veículo anexado(s)',
          auth.uid(), v_nome);
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_midia_registrar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_midia_registrar(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cs_veiculo_midia_excluir(p_midia uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE m record; a record; v_nome text;
BEGIN
  SELECT * INTO m FROM public."CS_VEICULO_VIAGEM_MIDIA" WHERE id = p_midia;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Arquivo não encontrado.'; END IF;
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = m.agendamento_id;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) tira arquivos desta viagem.';
  END IF;
  DELETE FROM public."CS_VEICULO_VIAGEM_MIDIA" WHERE id = p_midia;
  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (m.agendamento_id, 'midia', 'Arquivo do estado do veículo retirado: ' || m.nome_arquivo, auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_midia_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_midia_excluir(uuid) TO authenticated;

-- 5c) Observação livre ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_relato_salvar(p_agendamento uuid, p_texto text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text; v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) escreve a observação desta viagem.';
  END IF;
  IF length(v_texto) > 4000 THEN RAISE EXCEPTION 'A observação passa de 4.000 caracteres.'; END IF;
  IF a.relato IS NOT DISTINCT FROM v_texto THEN RETURN; END IF;
  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();

  UPDATE public.cs_veiculo_agendamento
     SET relato = v_texto, relato_em = now(), relato_por_nome = v_nome, updated_at = now()
   WHERE id = p_agendamento;

  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'relato',
          CASE WHEN v_texto IS NULL THEN 'Observação apagada'
               ELSE left(v_texto, 300) || CASE WHEN length(v_texto) > 300 THEN '…' ELSE '' END END,
          auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_relato_salvar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_relato_salvar(uuid, text) TO authenticated;

-- 6) A viagem devolve o que o modal novo precisa --------------------------------
-- Cópia da 20260930000286 com os campos novos marcados "12/11".
CREATE OR REPLACE FUNCTION public.cs_veiculo_viagem(p_agendamento uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_notas int;
BEGIN
  IF NOT tem_acesso_menu('central_servicos_veiculos') THEN RAISE EXCEPTION 'Sem acesso a Veículos.'; END IF;
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  SELECT count(*) INTO v_notas FROM public.cs_veiculo_abastecimento WHERE agendamento_id = a.id;
  RETURN jsonb_build_object(
    'id', a.id, 'numero', a.numero, 'veiculo_nome', a.veiculo_nome, 'veiculo_identificador', a.veiculo_identificador,
    'data_inicio', a.data_inicio, 'data_fim', a.data_fim, 'turno', a.turno, 'status', a.status,
    'solicitante_nome', a.solicitante_nome, 'solicitante_id', a.solicitante_id,
    'destino', a.destino, 'motivo', a.motivo, 'observacoes', a.observacoes,
    'controle_km', a.controle_km, 'finalizada_em', a.finalizada_em,
    'km_inicial', a.km_inicial, 'km_inicial_foto', a.km_inicial_foto, 'km_inicial_em', a.km_inicial_em,
    'km_final', a.km_final, 'km_final_foto', a.km_final_foto, 'km_final_em', a.km_final_em,
    'rodados', CASE WHEN a.km_final IS NOT NULL AND a.km_inicial IS NOT NULL THEN a.km_final - a.km_inicial END,
    -- 12/11: KM de chegada da última viagem FECHADA do veículo (qualquer motorista).
    'km_sugerido', (SELECT jsonb_build_object('km', u.km_final, 'numero', u.numero, 'condutor', u.solicitante_nome,
                                              'em', coalesce(u.km_final_em, u.finalizada_em))
                      FROM public.cs_veiculo_agendamento u
                     WHERE u.patrimonio_id = a.patrimonio_id AND u.id <> a.id
                       AND u.status <> 'cancelado' AND u.finalizada_em IS NOT NULL AND u.km_final IS NOT NULL
                     ORDER BY coalesce(u.km_final_em, u.finalizada_em) DESC, u.km_final DESC
                     LIMIT 1),
    -- 12/11: resposta do abastecimento (NULL = sem resposta; nota anexada vale Sim).
    'houve_abastecimento', CASE WHEN v_notas > 0 THEN true
                                WHEN a.houve_abastecimento IS NOT NULL THEN a.houve_abastecimento
                                WHEN a.sem_abastecimento THEN false END,
    'prestacao_exigida', a.prestacao_exigida,
    'prestacao_faltando', CASE WHEN a.prestacao_exigida AND a.nao_utilizado_em IS NULL
                               THEN to_jsonb(public.cs_veic_prestacao_faltando(a.id)) ELSE '[]'::jsonb END,
    'relato', a.relato, 'relato_em', a.relato_em, 'relato_por_nome', a.relato_por_nome,
    'midias', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'storage_path', m.storage_path, 'nome_arquivo', m.nome_arquivo,
                                                            'tipo', m.tipo, 'tamanho', m.tamanho, 'criado_por_nome', m.criado_por_nome,
                                                            'created_at', m.created_at) ORDER BY m.created_at)
                          FROM public."CS_VEICULO_VIAGEM_MIDIA" m WHERE m.agendamento_id = a.id), '[]'::jsonb),
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

-- =========================================================================
-- ROLLBACK
--   (reaplicar cs_veic_prestacao_faltando e cs_veiculo_km_inicial da 20261110220000,
--    cs_veiculo_km_final e cs_veiculo_viagem da 20260930000286 e
--    cs_veiculo_concluir da 20261110003700)
--   DROP TRIGGER IF EXISTS trg_cs_veic_checklist_agua_oleo ON public."CS_VEICULO_CHECKLIST";
--   DROP TRIGGER IF EXISTS trg_cs_veic_abastecimento_nota_marca_sim ON public.cs_veiculo_abastecimento;
--   DROP TRIGGER IF EXISTS trg_cs_veic_abastecimento_resposta ON public.cs_veiculo_agendamento;
--   DROP FUNCTION IF EXISTS public.cs_veic_checklist_agua_oleo(), public.cs_veic_abastecimento_nota_marca_sim(),
--     public.cs_veic_abastecimento_resposta(), public.cs_veiculo_abastecimento_responder(uuid, boolean),
--     public.cs_veiculo_midia_registrar(uuid, jsonb), public.cs_veiculo_midia_excluir(uuid),
--     public.cs_veiculo_relato_salvar(uuid, text);
--   (CS_VEICULO_VIAGEM_MIDIA fica: tem arquivos de motorista; apagar só depois de exportar)
--   ALTER TABLE public."CS_VEICULO_CHECKLIST" DROP COLUMN IF EXISTS agua_oleo_exigido;
--   ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN IF EXISTS houve_abastecimento,
--     DROP COLUMN IF EXISTS relato, DROP COLUMN IF EXISTS relato_em, DROP COLUMN IF EXISTS relato_por_nome;
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
