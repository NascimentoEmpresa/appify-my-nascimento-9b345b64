-- =========================================================================
-- Central de Serviços › Veículos: KM com foto do painel e nota de
-- abastecimento por contrato
--
-- Chamado (22/09/2026): "quando o funcionário usa o carro precisa deixar
-- registrado motorista, veículo, contrato atendido, dia, e anexar a notinha
-- do abastecimento — o mesmo veículo pode atender vários contratos na mesma
-- viagem". Antes isso vivia num grupo de WhatsApp que foi apagado, e as
-- auditorias de nota fiscal ficaram sem rastro.
--
-- Decisão do Pablo: prender no AGENDAMENTO que já existe.
--   • KM inicial + foto do painel obrigatórios ao agendar;
--   • KM final + foto obrigatórios depois da viagem — quem deixar pendente
--     não consegue agendar outro veículo (trigger, não só a tela);
--   • nota de abastecimento anexada na viagem, com descrição, data, valor e
--     OS CONTRATOS que aquele abastecimento atende (vêm marcados os da
--     viagem; dá pra tirar, acrescentar e o que entrar aqui também entra na
--     viagem).
--
-- Legado: os 148 agendamentos anteriores ficam sem KM (nada é exigido de
-- quem já fechou), e a trava só olha viagem que NASCEU com KM inicial.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- 1) KM no agendamento --------------------------------------------------
ALTER TABLE public.cs_veiculo_agendamento
  ADD COLUMN IF NOT EXISTS km_inicial      integer,
  ADD COLUMN IF NOT EXISTS km_inicial_foto text,
  ADD COLUMN IF NOT EXISTS km_inicial_em   timestamptz,
  ADD COLUMN IF NOT EXISTS km_final        integer,
  ADD COLUMN IF NOT EXISTS km_final_foto   text,
  ADD COLUMN IF NOT EXISTS km_final_em     timestamptz;

ALTER TABLE public.cs_veiculo_agendamento DROP CONSTRAINT IF EXISTS cs_veic_km_coerente;
ALTER TABLE public.cs_veiculo_agendamento ADD CONSTRAINT cs_veic_km_coerente
  CHECK (km_inicial IS NULL OR km_inicial >= 0)
  NOT VALID;
ALTER TABLE public.cs_veiculo_agendamento DROP CONSTRAINT IF EXISTS cs_veic_km_final_maior;
ALTER TABLE public.cs_veiculo_agendamento ADD CONSTRAINT cs_veic_km_final_maior
  CHECK (km_final IS NULL OR km_inicial IS NULL OR km_final >= km_inicial)
  NOT VALID;

COMMENT ON COLUMN public.cs_veiculo_agendamento.km_inicial_foto IS 'Caminho no bucket cs-veiculos (foto do painel na retirada).';

-- 2) Nota de abastecimento ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_veiculo_abastecimento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id uuid NOT NULL REFERENCES public.cs_veiculo_agendamento(id) ON DELETE CASCADE,
  data           date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  descricao      text,
  valor          numeric(12,2) CHECK (valor IS NULL OR valor >= 0),
  litros         numeric(10,3) CHECK (litros IS NULL OR litros >= 0),
  km             integer CHECK (km IS NULL OR km >= 0),
  -- a notinha
  storage_path   text NOT NULL,
  nome_arquivo   text NOT NULL,
  tipo           text,
  tamanho        bigint,
  criado_por     uuid DEFAULT auth.uid(),
  criado_por_nome text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cs_veic_abast_agend ON public.cs_veiculo_abastecimento(agendamento_id, data DESC);

-- Um abastecimento pode ser rateado entre vários contratos da mesma viagem.
CREATE TABLE IF NOT EXISTS public.cs_veiculo_abastecimento_contrato (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abastecimento_id  uuid NOT NULL REFERENCES public.cs_veiculo_abastecimento(id) ON DELETE CASCADE,
  contrato_codigo   bigint,
  contrato_nome     text NOT NULL,
  administrativo    boolean NOT NULL DEFAULT false,
  UNIQUE (abastecimento_id, contrato_nome)
);
CREATE INDEX IF NOT EXISTS idx_cs_veic_abast_ctr ON public.cs_veiculo_abastecimento_contrato(contrato_codigo);

-- RLS: mesma porta do agendamento (menu central_servicos_veiculos).
ALTER TABLE public.cs_veiculo_abastecimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_veiculo_abastecimento_contrato ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cs_veiculo_abastecimento FROM PUBLIC, anon;
REVOKE ALL ON public.cs_veiculo_abastecimento_contrato FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cs_veiculo_abastecimento TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cs_veiculo_abastecimento_contrato TO authenticated;

DROP POLICY IF EXISTS cs_veic_abast_select ON public.cs_veiculo_abastecimento;
CREATE POLICY cs_veic_abast_select ON public.cs_veiculo_abastecimento
  FOR SELECT TO authenticated USING (tem_acesso_menu('central_servicos_veiculos'));
DROP POLICY IF EXISTS cs_veic_abast_write ON public.cs_veiculo_abastecimento;
CREATE POLICY cs_veic_abast_write ON public.cs_veiculo_abastecimento
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cs_veiculo_agendamento a
                  WHERE a.id = cs_veiculo_abastecimento.agendamento_id
                    AND (a.solicitante_id = auth.uid() OR can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cs_veiculo_agendamento a
                  WHERE a.id = cs_veiculo_abastecimento.agendamento_id
                    AND (a.solicitante_id = auth.uid() OR can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao))));

DROP POLICY IF EXISTS cs_veic_abast_ctr_select ON public.cs_veiculo_abastecimento_contrato;
CREATE POLICY cs_veic_abast_ctr_select ON public.cs_veiculo_abastecimento_contrato
  FOR SELECT TO authenticated USING (tem_acesso_menu('central_servicos_veiculos'));
DROP POLICY IF EXISTS cs_veic_abast_ctr_write ON public.cs_veiculo_abastecimento_contrato;
CREATE POLICY cs_veic_abast_ctr_write ON public.cs_veiculo_abastecimento_contrato
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cs_veiculo_abastecimento b JOIN public.cs_veiculo_agendamento a ON a.id = b.agendamento_id
                  WHERE b.id = cs_veiculo_abastecimento_contrato.abastecimento_id
                    AND (a.solicitante_id = auth.uid() OR can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cs_veiculo_abastecimento b JOIN public.cs_veiculo_agendamento a ON a.id = b.agendamento_id
                  WHERE b.id = cs_veiculo_abastecimento_contrato.abastecimento_id
                    AND (a.solicitante_id = auth.uid() OR can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao))));

-- 3) Bucket das fotos/notas ---------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cs-veiculos', 'cs-veiculos', false, 26214400)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS cs_veiculos_select ON storage.objects;
CREATE POLICY cs_veiculos_select ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'cs-veiculos' AND tem_acesso_menu('central_servicos_veiculos'));
DROP POLICY IF EXISTS cs_veiculos_insert ON storage.objects;
CREATE POLICY cs_veiculos_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'cs-veiculos' AND tem_acesso_menu('central_servicos_veiculos', 'incluir'));
DROP POLICY IF EXISTS cs_veiculos_delete ON storage.objects;
CREATE POLICY cs_veiculos_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'cs-veiculos' AND tem_acesso_menu('central_servicos_veiculos', 'incluir'));

-- 4) Pendência de KM final ----------------------------------------------
-- O que impede agendar outro carro: viagem JÁ TERMINADA (data_fim < hoje),
-- confirmada, que começou com KM e não foi fechada.
CREATE OR REPLACE FUNCTION public.cs_veiculo_km_pendentes(p_usuario uuid DEFAULT NULL)
RETURNS TABLE (id uuid, numero bigint, veiculo_nome text, data_inicio date, data_fim date, km_inicial integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.numero, a.veiculo_nome, a.data_inicio, a.data_fim, a.km_inicial
    FROM public.cs_veiculo_agendamento a
   WHERE a.solicitante_id = coalesce(p_usuario, auth.uid())
     AND a.status = 'confirmado'
     AND a.km_inicial IS NOT NULL
     AND a.km_final IS NULL
     AND a.data_fim < (now() AT TIME ZONE 'America/Sao_Paulo')::date
   ORDER BY a.data_fim;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculo_km_pendentes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_km_pendentes(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cs_veiculo_agendamento_exige_km() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE p record;
BEGIN
  IF NEW.km_inicial IS NULL THEN
    RAISE EXCEPTION 'Informe o KM inicial e a foto do painel para agendar o veículo.';
  END IF;
  IF nullif(btrim(coalesce(NEW.km_inicial_foto, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Anexe a foto do painel com o KM inicial.';
  END IF;
  SELECT * INTO p FROM public.cs_veiculo_km_pendentes(NEW.solicitante_id) LIMIT 1;
  IF p.id IS NOT NULL THEN
    RAISE EXCEPTION 'Feche o KM final da viagem nº % (% · % a %) antes de agendar outro veículo.',
      p.numero, p.veiculo_nome, to_char(p.data_inicio, 'DD/MM'), to_char(p.data_fim, 'DD/MM');
  END IF;
  NEW.km_inicial_em := coalesce(NEW.km_inicial_em, now());
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_cs_veic_exige_km ON public.cs_veiculo_agendamento;
CREATE TRIGGER trg_cs_veic_exige_km BEFORE INSERT ON public.cs_veiculo_agendamento
  FOR EACH ROW EXECUTE FUNCTION public.cs_veiculo_agendamento_exige_km();

-- 5) Fechar a viagem (KM final) -----------------------------------------
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
  IF p_km IS NULL OR p_km < 0 THEN RAISE EXCEPTION 'Informe o KM final.'; END IF;
  IF a.km_inicial IS NOT NULL AND p_km < a.km_inicial THEN
    RAISE EXCEPTION 'O KM final (%) não pode ser menor que o inicial (%).', p_km, a.km_inicial;
  END IF;
  IF nullif(btrim(coalesce(p_foto, '')), '') IS NULL THEN RAISE EXCEPTION 'Anexe a foto do painel com o KM final.'; END IF;

  UPDATE public.cs_veiculo_agendamento
     SET km_final = p_km, km_final_foto = p_foto, km_final_em = now(), updated_at = now()
   WHERE id = p_agendamento;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'km_final',
          'KM final ' || p_km || (CASE WHEN a.km_inicial IS NOT NULL THEN ' · rodou ' || (p_km - a.km_inicial) || ' km' ELSE '' END),
          auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_km_final(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_km_final(uuid, integer, text) TO authenticated;

-- 6) Contratos da viagem: acrescentar/editar ----------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_contratos_definir(p_agendamento uuid, p_contratos jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_nome text; n int;
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou o Patrimônio) muda os contratos da viagem.';
  END IF;
  n := jsonb_array_length(coalesce(p_contratos, '[]'::jsonb));
  IF n = 0 THEN RAISE EXCEPTION 'A viagem precisa de ao menos um contrato.'; END IF;

  DELETE FROM public.cs_veiculo_agendamento_contrato WHERE agendamento_id = p_agendamento;
  INSERT INTO public.cs_veiculo_agendamento_contrato(agendamento_id, contrato_id, contrato_codigo, contrato_nome, administrativo)
  SELECT p_agendamento, NULL,
         nullif(c->>'codigo', '')::bigint, c->>'nome', coalesce((c->>'administrativo')::boolean, false)
    FROM jsonb_array_elements(p_contratos) c;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'contratos', 'Contratos da viagem: ' ||
          (SELECT string_agg(c->>'nome', ', ') FROM jsonb_array_elements(p_contratos) c), auth.uid(), v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_contratos_definir(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_contratos_definir(uuid, jsonb) TO authenticated;

-- 7) Nota de abastecimento ----------------------------------------------
-- Contrato que veio só na nota entra também na viagem: é o que a auditoria
-- procura depois ("esse carro atendeu quais contratos nessa viagem?").
CREATE OR REPLACE FUNCTION public.cs_veiculo_abastecimento_registrar(
  p_agendamento uuid, p_arquivo jsonb, p_contratos jsonb,
  p_descricao text DEFAULT NULL, p_data date DEFAULT NULL,
  p_valor numeric DEFAULT NULL, p_litros numeric DEFAULT NULL, p_km integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record; v_id uuid; v_nome text;
BEGIN
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou o Patrimônio) anexa nota nesta viagem.';
  END IF;
  IF nullif(btrim(coalesce(p_arquivo->>'path', '')), '') IS NULL THEN RAISE EXCEPTION 'Anexe a nota do abastecimento.'; END IF;
  IF jsonb_array_length(coalesce(p_contratos, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um contrato atendido por este abastecimento.';
  END IF;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.cs_veiculo_abastecimento(agendamento_id, data, descricao, valor, litros, km,
                                              storage_path, nome_arquivo, tipo, tamanho, criado_por_nome)
  VALUES (p_agendamento, coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date),
          nullif(btrim(coalesce(p_descricao, '')), ''), p_valor, p_litros, p_km,
          p_arquivo->>'path', coalesce(p_arquivo->>'nome', 'nota'), p_arquivo->>'tipo',
          nullif(p_arquivo->>'tamanho', '')::bigint, v_nome)
  RETURNING id INTO v_id;

  INSERT INTO public.cs_veiculo_abastecimento_contrato(abastecimento_id, contrato_codigo, contrato_nome, administrativo)
  SELECT v_id, nullif(c->>'codigo', '')::bigint, c->>'nome', coalesce((c->>'administrativo')::boolean, false)
    FROM jsonb_array_elements(p_contratos) c
  ON CONFLICT (abastecimento_id, contrato_nome) DO NOTHING;

  -- contrato novo também passa a valer para a viagem
  INSERT INTO public.cs_veiculo_agendamento_contrato(agendamento_id, contrato_id, contrato_codigo, contrato_nome, administrativo)
  SELECT p_agendamento, NULL, nullif(c->>'codigo', '')::bigint, c->>'nome', coalesce((c->>'administrativo')::boolean, false)
    FROM jsonb_array_elements(p_contratos) c
   WHERE NOT EXISTS (SELECT 1 FROM public.cs_veiculo_agendamento_contrato x
                      WHERE x.agendamento_id = p_agendamento AND x.contrato_nome = c->>'nome');

  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'abastecimento',
          'Nota anexada' || coalesce(' · R$ ' || to_char(p_valor, 'FM999G999D00'), '') ||
          ' · ' || (SELECT string_agg(c->>'nome', ', ') FROM jsonb_array_elements(p_contratos) c),
          auth.uid(), v_nome);
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_abastecimento_registrar(uuid, jsonb, jsonb, text, date, numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_abastecimento_registrar(uuid, jsonb, jsonb, text, date, numeric, numeric, integer) TO authenticated;

-- 8) A viagem com tudo junto (tela e auditoria) -------------------------
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
-- DROP TRIGGER IF EXISTS trg_cs_veic_exige_km ON public.cs_veiculo_agendamento;
-- DROP FUNCTION IF EXISTS public.cs_veiculo_agendamento_exige_km(), public.cs_veiculo_viagem(uuid),
--   public.cs_veiculo_abastecimento_registrar(uuid,jsonb,jsonb,text,date,numeric,numeric,integer),
--   public.cs_veiculo_contratos_definir(uuid,jsonb), public.cs_veiculo_km_final(uuid,integer,text),
--   public.cs_veiculo_km_pendentes(uuid);
-- DROP TABLE IF EXISTS public.cs_veiculo_abastecimento_contrato, public.cs_veiculo_abastecimento;
-- ALTER TABLE public.cs_veiculo_agendamento
--   DROP CONSTRAINT IF EXISTS cs_veic_km_final_maior, DROP CONSTRAINT IF EXISTS cs_veic_km_coerente,
--   DROP COLUMN IF EXISTS km_final_em, DROP COLUMN IF EXISTS km_final_foto, DROP COLUMN IF EXISTS km_final,
--   DROP COLUMN IF EXISTS km_inicial_em, DROP COLUMN IF EXISTS km_inicial_foto, DROP COLUMN IF EXISTS km_inicial;
-- (bucket cs-veiculos e policies de storage ficam.)
