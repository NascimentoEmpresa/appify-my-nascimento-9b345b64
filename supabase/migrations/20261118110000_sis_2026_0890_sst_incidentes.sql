-- SIS-2026-0890: relatórios de incidente, ligados à pessoa pelo CPF estável.
-- Depende das funções de pessoas/contratos do SIS-2026-0889 (já na main).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_incidentes', 'Incidentes', '/app/sst/incidentes',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
FROM public.app_modulo m WHERE m.codigo = 'sst'
AND NOT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = 'sst_incidentes');

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES ('sst_incidentes', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'sst_incidentes', p.acao, true FROM public.perfil_acesso_permissao p
WHERE p.menu_codigo = 'sst_acidentes_trabalho' AND p.acao IN ('visualizar', 'alterar') AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT p.user_id, 'sst_incidentes', p.acao, true, 'SIS-2026-0890: acesso SST aos incidentes'
FROM public.screen_permission_user p
WHERE p.menu_codigo = 'sst_acidentes_trabalho' AND p.acao IN ('visualizar', 'alterar') AND p.allow
AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x WHERE x.user_id = p.user_id AND x.menu_codigo = 'sst_incidentes' AND x.acao = p.acao);

CREATE TABLE IF NOT EXISTS public."SST_INCIDENTE" (
  id bigserial PRIMARY KEY,
  cpf text NOT NULL CHECK (cpf ~ '^[0-9]{11}$'),
  nome text NOT NULL,
  contrato_id uuid,
  contrato_nome text,
  encarregado text,
  data_incidente date NOT NULL,
  dias_afastamento integer CHECK (dias_afastamento IS NULL OR dias_afastamento >= 0),
  numero_relatorio text,
  status text NOT NULL DEFAULT 'elaboracao' CHECK (status IN ('elaboracao', 'aguardando_assinatura', 'recebido', 'finalizado')),
  observacoes text,
  arquivo_nome text,
  arquivo_path text UNIQUE,
  arquivo_tamanho bigint,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_incidente_cpf_idx ON public."SST_INCIDENTE" (cpf);
CREATE INDEX IF NOT EXISTS sst_incidente_data_idx ON public."SST_INCIDENTE" (data_incidente DESC);
CREATE TABLE IF NOT EXISTS public."SST_INCIDENTE_HISTORICO" (
  id bigserial PRIMARY KEY,
  incidente_id bigint NOT NULL REFERENCES public."SST_INCIDENTE"(id) ON DELETE CASCADE,
  descricao text NOT NULL,
  autor_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_incidente_hist_idx ON public."SST_INCIDENTE_HISTORICO" (incidente_id);
ALTER TABLE public."SST_INCIDENTE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SST_INCIDENTE_HISTORICO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SST_INCIDENTE", public."SST_INCIDENTE_HISTORICO" FROM anon, authenticated;
DROP TRIGGER IF EXISTS trg_sst_incidente_updated_at ON public."SST_INCIDENTE";
CREATE TRIGGER trg_sst_incidente_updated_at BEFORE UPDATE ON public."SST_INCIDENTE"
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.sst_incidente_exige(p_acao text DEFAULT 'visualizar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access(auth.uid(), 'sst_incidentes', p_acao::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso aos incidentes (%)', p_acao USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sst_incidente_exige(text) FROM PUBLIC, anon, authenticated;

-- O arquivo referenciado por um incidente não pode ser apagado diretamente
-- no Storage. Na substituição, o caminho antigo fica solto e pode sair.
CREATE OR REPLACE FUNCTION public.sst_incidente_arquivo_solto(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.can_access(auth.uid(), 'sst_incidentes', 'alterar'::public.app_acao)
    AND NOT EXISTS (SELECT 1 FROM public."SST_INCIDENTE" WHERE arquivo_path = p_path)
$$;
REVOKE ALL ON FUNCTION public.sst_incidente_arquivo_solto(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_incidente_arquivo_solto(text) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sst-incidentes', 'sst-incidentes', false, 26214400)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "sst incidentes select" ON storage.objects;
CREATE POLICY "sst incidentes select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'sst-incidentes' AND (SELECT public.can_access(auth.uid(), 'sst_incidentes', 'visualizar'::public.app_acao)));
DROP POLICY IF EXISTS "sst incidentes insert" ON storage.objects;
CREATE POLICY "sst incidentes insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'sst-incidentes' AND (SELECT public.can_access(auth.uid(), 'sst_incidentes', 'alterar'::public.app_acao)));
DROP POLICY IF EXISTS "sst incidentes delete" ON storage.objects;
CREATE POLICY "sst incidentes delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'sst-incidentes' AND (SELECT public.can_access(auth.uid(), 'sst_incidentes', 'alterar'::public.app_acao))
  AND (SELECT public.sst_incidente_arquivo_solto(name)));

CREATE OR REPLACE FUNCTION public.sst_incidente_colaboradores(p_busca text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_busca text := btrim(COALESCE(p_busca, ''));
BEGIN
  PERFORM public.sst_incidente_exige();
  IF length(v_busca) < 3 THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.empregado_id, 'nome', p.nome,
    'filial', p.filial, 'desligado', p.desligado) ORDER BY p.desligado, p.nome)
    FROM (SELECT * FROM public.sst_toxico_pessoas() x
      WHERE x.nome ILIKE '%' || v_busca || '%' AND x.nome NOT ILIKE '%teste%'
      ORDER BY x.desligado, x.nome LIMIT 20) p), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_incidente_colaboradores(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_incidente_colaboradores(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_incidente_contratos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_incidente_exige();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) ORDER BY c.nome)
    FROM public.contratos c WHERE nullif(btrim(c.nome), '') IS NOT NULL), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_incidente_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_incidente_contratos() TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_incidente_sugestao(p_empregado_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_filial text; v_local text; v_contrato jsonb;
BEGIN
  PERFORM public.sst_incidente_exige();
  SELECT x.filial, x.local_senior INTO v_filial, v_local FROM public.sst_acidente_pessoa(p_empregado_id) x;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador não encontrado.'; END IF;
  v_contrato := public.sst_toxico_contrato(v_filial, v_local);
  RETURN jsonb_build_object('contrato_id', v_contrato->>'contrato_id',
    'encarregado', (SELECT public.organograma_nome_no(o.parent_id) FROM public."ORGANOGRAMA_NO" o
      WHERE o.empregado_id = p_empregado_id AND o.parent_id IS NOT NULL LIMIT 1));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_incidente_sugestao(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_incidente_sugestao(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_incidentes_lista(p_empregado_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cpf text;
BEGIN
  PERFORM public.sst_incidente_exige();
  IF p_empregado_id IS NOT NULL THEN
    SELECT x.cpf INTO v_cpf FROM public.sst_acidente_pessoa(p_empregado_id) x;
    IF length(COALESCE(v_cpf, '')) <> 11 THEN RETURN '[]'::jsonb; END IF;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'nome', i.nome, 'contrato_id', i.contrato_id, 'contrato_nome', i.contrato_nome,
    'encarregado', i.encarregado, 'data_incidente', i.data_incidente, 'dias_afastamento', i.dias_afastamento,
    'numero_relatorio', i.numero_relatorio, 'status', i.status, 'observacoes', i.observacoes,
    'arquivo_nome', i.arquivo_nome, 'arquivo_path', i.arquivo_path, 'created_at', i.created_at,
    'empregado_id', p.empregado_id) ORDER BY i.data_incidente DESC, i.id DESC)
    FROM public."SST_INCIDENTE" i
    LEFT JOIN LATERAL (SELECT x.empregado_id FROM public.sst_toxico_pessoas() x WHERE x.cpf = i.cpf LIMIT 1) p ON true
    WHERE p_empregado_id IS NULL OR i.cpf = v_cpf), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_incidentes_lista(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_incidentes_lista(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_incidente_historico(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_incidente_exige();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'descricao', h.descricao,
    'autor_nome', h.autor_nome, 'created_at', h.created_at) ORDER BY h.id DESC)
    FROM public."SST_INCIDENTE_HISTORICO" h WHERE h.incidente_id = p_id), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_incidente_historico(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_incidente_historico(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_incidente_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id bigint := nullif(p->>'id', '')::bigint;
  v_emp bigint := nullif(p->>'empregado_id', '')::bigint;
  v_cpf text; v_nome text; v_ant public."SST_INCIDENTE"%ROWTYPE; v_novo public."SST_INCIDENTE"%ROWTYPE;
  v_contrato_nome text; v_status text := COALESCE(nullif(p->>'status', ''), 'elaboracao');
  v_dias integer := nullif(p->>'dias_afastamento', '')::integer;
BEGIN
  PERFORM public.sst_incidente_exige('alterar');
  IF v_emp IS NOT NULL THEN
    SELECT x.cpf, x.nome INTO v_cpf, v_nome FROM public.sst_acidente_pessoa(v_emp) x;
    IF NOT FOUND OR length(COALESCE(v_cpf, '')) <> 11 THEN RAISE EXCEPTION 'Escolha um colaborador com CPF válido.'; END IF;
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_ant FROM public."SST_INCIDENTE" WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Incidente não encontrado.'; END IF;
  ELSIF v_emp IS NULL THEN RAISE EXCEPTION 'Escolha o colaborador.'; END IF;
  IF v_dias < 0 THEN RAISE EXCEPTION 'Os dias de afastamento não podem ser negativos.'; END IF;
  IF v_status NOT IN ('elaboracao', 'aguardando_assinatura', 'recebido', 'finalizado') THEN RAISE EXCEPTION 'Status inválido.'; END IF;
  IF p ? 'contrato_id' AND nullif(p->>'contrato_id', '') IS NOT NULL THEN
    SELECT c.nome INTO v_contrato_nome FROM public.contratos c WHERE c.id = (p->>'contrato_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado.'; END IF;
  END IF;
  IF v_id IS NULL THEN
    IF nullif(p->>'data_incidente', '') IS NULL THEN RAISE EXCEPTION 'Informe a data do incidente.'; END IF;
    INSERT INTO public."SST_INCIDENTE" (cpf, nome, data_incidente, created_by)
    VALUES (v_cpf, v_nome, (p->>'data_incidente')::date, auth.uid()) RETURNING id INTO v_id;
  END IF;
  UPDATE public."SST_INCIDENTE" SET
    cpf = CASE WHEN v_emp IS NULL THEN cpf ELSE v_cpf END,
    nome = CASE WHEN v_emp IS NULL THEN nome ELSE v_nome END,
    contrato_id = CASE WHEN p ? 'contrato_id' THEN nullif(p->>'contrato_id', '')::uuid ELSE contrato_id END,
    contrato_nome = CASE WHEN p ? 'contrato_id' THEN v_contrato_nome ELSE contrato_nome END,
    encarregado = CASE WHEN p ? 'encarregado' THEN nullif(btrim(p->>'encarregado'), '') ELSE encarregado END,
    data_incidente = CASE WHEN p ? 'data_incidente' THEN (p->>'data_incidente')::date ELSE data_incidente END,
    dias_afastamento = CASE WHEN p ? 'dias_afastamento' THEN v_dias ELSE dias_afastamento END,
    numero_relatorio = CASE WHEN p ? 'numero_relatorio' THEN nullif(btrim(p->>'numero_relatorio'), '') ELSE numero_relatorio END,
    status = CASE WHEN p ? 'status' THEN v_status ELSE status END,
    observacoes = CASE WHEN p ? 'observacoes' THEN nullif(btrim(p->>'observacoes'), '') ELSE observacoes END
  WHERE id = v_id RETURNING * INTO v_novo;
  IF v_novo.data_incidente > current_date THEN RAISE EXCEPTION 'A data do incidente não pode ser futura.'; END IF;
  IF v_novo.status IN ('recebido', 'finalizado') AND v_novo.arquivo_path IS NULL THEN
    RAISE EXCEPTION 'Anexe o relatório assinado antes de marcar como recebido ou finalizado.';
  END IF;
  IF v_novo.status = 'finalizado' AND v_novo.numero_relatorio IS NULL THEN
    RAISE EXCEPTION 'Informe o número do relatório antes de finalizar.';
  END IF;
  IF v_ant.id IS NULL OR to_jsonb(v_ant) - 'updated_at' IS DISTINCT FROM to_jsonb(v_novo) - 'updated_at' THEN
    INSERT INTO public."SST_INCIDENTE_HISTORICO" (incidente_id, descricao, autor_nome)
    VALUES (v_id, CASE WHEN v_ant.id IS NULL THEN 'Incidente registrado.'
      WHEN v_ant.status IS DISTINCT FROM v_novo.status THEN 'Status: ' || v_ant.status || ' → ' || v_novo.status || '.'
      ELSE 'Dados do incidente alterados.' END, public.sst_afa_nome_usuario());
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_incidente_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_incidente_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_incidente_anexar(p_id bigint, p_nome text, p_path text, p_tamanho bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_antigo text;
BEGIN
  PERFORM public.sst_incidente_exige('alterar');
  IF p_path !~ ('^' || p_id::text || '/[A-Za-z0-9_-]+_[^/]+$') OR nullif(btrim(p_nome), '') IS NULL
    OR p_tamanho < 1 OR p_tamanho > 26214400 THEN RAISE EXCEPTION 'Arquivo inválido.'; END IF;
  PERFORM 1 FROM storage.objects WHERE bucket_id = 'sst-incidentes' AND name = p_path;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envie o arquivo antes de registrá-lo.'; END IF;
  SELECT arquivo_path INTO v_antigo FROM public."SST_INCIDENTE" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Incidente não encontrado.'; END IF;
  UPDATE public."SST_INCIDENTE" SET arquivo_nome = p_nome, arquivo_path = p_path, arquivo_tamanho = p_tamanho WHERE id = p_id;
  INSERT INTO public."SST_INCIDENTE_HISTORICO" (incidente_id, descricao, autor_nome)
  VALUES (p_id, 'Relatório assinado anexado: ' || p_nome || '.', public.sst_afa_nome_usuario());
  RETURN v_antigo;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_incidente_anexar(bigint, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_incidente_anexar(bigint, text, text, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (somente se não houver registros a preservar):
-- DROP POLICY IF EXISTS "sst incidentes select" ON storage.objects;
-- DROP POLICY IF EXISTS "sst incidentes insert" ON storage.objects;
-- DROP POLICY IF EXISTS "sst incidentes delete" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.sst_incidente_anexar(bigint, text, text, bigint), public.sst_incidente_salvar(jsonb),
--   public.sst_incidente_historico(bigint), public.sst_incidentes_lista(bigint), public.sst_incidente_sugestao(bigint),
--   public.sst_incidente_contratos(), public.sst_incidente_colaboradores(text), public.sst_incidente_arquivo_solto(text),
--   public.sst_incidente_exige(text);
-- DELETE FROM storage.buckets WHERE id = 'sst-incidentes'; -- somente bucket vazio
-- DROP TABLE IF EXISTS public."SST_INCIDENTE_HISTORICO", public."SST_INCIDENTE";
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'sst_incidentes';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sst_incidentes';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sst_incidentes';
-- DELETE FROM public.app_menu WHERE codigo = 'sst_incidentes';
-- NOTIFY pgrst, 'reload schema';
