-- SIS-2026-0878 — Cobranças: data da cobrança registrada POR SETOR (Jurídico e Financeiro), como no sistema antigo
-- ============================================================================
-- O sistema antigo mostrava, em cada nota, "Jurídico: dd/mm/aaaa" e "Financeiro: dd/mm/aaaa" (a data da última cobrança de cada setor).
-- No ERP só existia o último e-mail AUTOMÁTICO do contrato (cobranca_auto_envio, que é do Financeiro); a cobrança manual do Jurídico
-- (e a do próprio Financeiro fora da automação) não deixava rastro.
--
-- cobranca_registro: uma linha por NOTA + SETOR + DATA ("a nota X foi cobrada pelo Jurídico em tal dia"). Quem registra é o usuário, pela
-- tela Cobranças (RPC cobranca_registrar). A data do Financeiro na tela é a MAIOR entre este registro e o envio automático em produção
-- (cobranca_auto_envio.notas guarda os ids das notas de cada e-mail), então não se registra à mão o que a automação já enviou.
--
-- Permissão (menu 'cobrancas', Acesso por Usuário): registrar pelo JURÍDICO = aprovar ou alterar; pelo FINANCEIRO = alterar.
-- Ver os registros = qualquer uma das três ações da tela (a visibilidade das notas por faixa de atraso continua na tela).
--
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.cobranca_registrar(uuid[], text, date, text);
--   DROP TABLE IF EXISTS public.cobranca_registro;
--   NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.cobranca_registro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nf_emissao_id uuid NOT NULL REFERENCES public.nf_emissao(id) ON DELETE CASCADE,
  contrato_id uuid REFERENCES public.contratos(id),
  setor text NOT NULL CHECK (setor IN ('financeiro', 'juridico')),
  data_cobranca date NOT NULL,
  observacao text,
  registrado_por uuid,   -- sem FK em auth.users (o usuário do pgAdmin não tem REFERENCES nessa tabela; é só auditoria)
  registrado_por_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- clique duplo / reenvio do mesmo registro não duplica
CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_registro_nota_setor_data ON public.cobranca_registro (nf_emissao_id, setor, data_cobranca);
CREATE INDEX IF NOT EXISTS cobranca_registro_contrato_id_idx ON public.cobranca_registro (contrato_id);

ALTER TABLE public.cobranca_registro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cobranca_registro_select ON public.cobranca_registro;
CREATE POLICY cobranca_registro_select ON public.cobranca_registro FOR SELECT TO authenticated
  USING (
    (SELECT public.has_screen_access((SELECT auth.uid()), 'cobrancas', 'alterar'::public.app_acao))
    OR (SELECT public.has_screen_access((SELECT auth.uid()), 'cobrancas', 'aprovar'::public.app_acao))
    OR (SELECT public.has_screen_access((SELECT auth.uid()), 'cobrancas', 'visualizar'::public.app_acao))
  );
-- Escrita só pela RPC (SECURITY DEFINER): sem policy de insert/update/delete.

-- _nf_ids: notas cobradas; _setor: 'juridico' | 'financeiro'; _data: dia da cobrança (hoje por padrão, nunca no futuro).
-- Devolve quantas notas foram registradas (já registradas no mesmo dia/setor não contam).
CREATE OR REPLACE FUNCTION public.cobranca_registrar(_nf_ids uuid[], _setor text, _data date DEFAULT NULL, _observacao text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nome text;
  v_data date := COALESCE(_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_n integer;
  v_achadas integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  IF _setor NOT IN ('financeiro', 'juridico') THEN RAISE EXCEPTION 'Setor inválido: use financeiro ou juridico.'; END IF;
  IF _setor = 'juridico' THEN
    IF NOT (public.can_access(v_uid, 'cobrancas', 'aprovar'::public.app_acao) OR public.can_access(v_uid, 'cobrancas', 'alterar'::public.app_acao)) THEN
      RAISE EXCEPTION 'Sem permissão para registrar cobrança do Jurídico.';
    END IF;
  ELSIF NOT public.can_access(v_uid, 'cobrancas', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para registrar cobrança do Financeiro.';
  END IF;
  IF _nf_ids IS NULL OR array_length(_nf_ids, 1) IS NULL THEN RAISE EXCEPTION 'Selecione ao menos uma nota.'; END IF;
  IF v_data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'A data da cobrança não pode ser futura.'; END IF;

  SELECT count(*) INTO v_achadas FROM public.nf_emissao WHERE id = ANY(_nf_ids);
  IF v_achadas <> (SELECT count(DISTINCT x) FROM unnest(_nf_ids) x) THEN RAISE EXCEPTION 'Alguma nota informada não foi encontrada.'; END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.cobranca_registro (nf_emissao_id, contrato_id, setor, data_cobranca, observacao, registrado_por, registrado_por_nome)
  SELECT n.id, n.contrato_id, _setor, v_data, NULLIF(btrim(COALESCE(_observacao, '')), ''), v_uid, v_nome
    FROM public.nf_emissao n
   WHERE n.id = ANY(_nf_ids)
  ON CONFLICT (nf_emissao_id, setor, data_cobranca) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.cobranca_registrar(uuid[], text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_registrar(uuid[], text, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
