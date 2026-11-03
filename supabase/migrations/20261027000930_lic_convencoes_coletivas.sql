-- =========================================================================
-- LICITAÇÕES › CONVENÇÕES COLETIVAS E DECRETOS MUNICIPAIS (27/10/2026)
--
-- PEDIDO (chamado "Convenções Coletivas e Decretos Municipais — criação do
-- módulo e integração com a Planilha de Custo e a Abertura de Vagas"):
--   1. A Licitação cadastra a CCT e/ou o decreto (anexos + identificação,
--      sindicato, categoria, município, vigência) e preenche os benefícios
--      e adicionais em campos próprios — não basta anexar.
--   2. Na Planilha de Custo, cada POSTO é vinculado a uma referência
--      (Contrato → Posto → CCT/decreto → benefícios). O cadastro da
--      convenção não tem posto: o vínculo mora aqui.
--   3. Na Abertura de Vagas, contrato + posto da vaga acham o vínculo e o
--      quadro "Benefícios e adicionais da vaga" aparece sozinho.
--
-- REGRAS QUE O BANCO SEGURA:
--   • campo vazio NÃO é "Não contém" — os benefícios ficam num jsonb com
--     `nao_contem` explícito; a tela marca pendência para o que faltar
--     (src/lib/licitacoes/convencoes.ts, com teste);
--   • sem vínculo do posto = pendência. Nada de usar a CCT de outro posto
--     do mesmo contrato (o resolvedor casa contrato + posto, e só);
--   • mais de uma referência no posto: `regras` diz, benefício a
--     benefício, de qual convenção ele sai — nada é somado nem duplicado;
--   • origem preservada: toda edição da convenção vira uma versão nova
--     (LIC_CONVENCAO_COLETIVA_VERSAO) e a vaga guarda o retrato do que usou
--     (SISTEMA_RECRUTAMENTO_BENEFICIOS), com o número da versão.
--
-- Benefícios da vaga ficam em tabela à parte (1 linha por vaga) pelo mesmo
-- motivo de SISTEMA_RECRUTAMENTO_RESPONSAVEL (mig 20261013000003): coluna
-- nova na vaga passaria pelo sistema_recrutamento_guard e pelo histórico
-- automático. As "Observações da solicitação" (layout de referência do
-- chamado) moram nessa mesma linha.
--
-- Idempotente.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'licitacoes_convencoes', 'Convenções Coletivas e Decretos Municipais',
       '/app/licitacoes/convencoes', 283, true
  FROM public.app_modulo m
 WHERE m.codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- Menu sem nenhuma regra é tratado como ABERTO para todo autenticado:
-- semeia o perfil "concede tudo" para nascer fechado aos demais.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'licitacoes_convencoes', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Quem vê convenção: o módulo novo, ou quem monta a Planilha de Custo (é lá
-- que se escolhe a referência do posto).
CREATE OR REPLACE FUNCTION public.lic_convencao_pode(p_acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_screen_access(auth.uid(), 'licitacoes_convencoes', p_acao::public.app_acao)
    OR (p_acao = 'visualizar' AND public.has_screen_access(auth.uid(), 'planilha-custo', 'visualizar'::public.app_acao)))
$$;
REVOKE ALL ON FUNCTION public.lic_convencao_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lic_convencao_pode(text) TO authenticated;

-- ── 2) Convenções / decretos ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."LIC_CONVENCAO_COLETIVA" (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES public.empresas(id),
  contrato_id             uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  identificacao           text,
  categoria_profissional  text,
  sindicato               text,
  municipio               text,
  vigencia_inicio         date,
  vigencia_fim            date,
  cct_arquivo_path        text,
  cct_arquivo_nome        text,
  cct_arquivo_tamanho     bigint,
  decreto_numero          text,
  decreto_arquivo_path    text,
  decreto_arquivo_nome    text,
  decreto_arquivo_tamanho bigint,
  -- { "va": { "nao_contem": false, "valor": 23.5, "periodo": "dia" }, ... }
  -- Chaves e regras em src/lib/licitacoes/convencoes.ts (BENEFICIOS).
  beneficios              jsonb NOT NULL DEFAULT '{}'::jsonb,
  observacoes             text,
  -- 'completo' | 'pendente' — calculado pela tela ao salvar (mesma função
  -- que desenha os avisos), guardado para os KPIs e o filtro.
  situacao                text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('completo', 'pendente')),
  versao                  integer NOT NULL DEFAULT 1,
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lic_convencao_vigencia_ok CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE INDEX IF NOT EXISTS idx_lic_convencao_contrato ON public."LIC_CONVENCAO_COLETIVA"(contrato_id);
CREATE INDEX IF NOT EXISTS idx_lic_convencao_empresa  ON public."LIC_CONVENCAO_COLETIVA"(empresa_id);

CREATE TABLE IF NOT EXISTS public."LIC_CONVENCAO_COLETIVA_VERSAO" (
  convencao_id uuid NOT NULL REFERENCES public."LIC_CONVENCAO_COLETIVA"(id) ON DELETE CASCADE,
  versao       integer NOT NULL,
  dados        jsonb NOT NULL,
  criado_por   uuid,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (convencao_id, versao)
);

-- Versão: sobe a cada mudança de conteúdo (carimbos não contam).
CREATE OR REPLACE FUNCTION public.lic_convencao_versionar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.versao := 1;
    NEW.created_by := coalesce(NEW.created_by, auth.uid());
    NEW.updated_by := coalesce(NEW.updated_by, auth.uid());
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'versao' - 'updated_at' - 'updated_by' - 'created_at' - 'created_by')
     IS DISTINCT FROM (to_jsonb(OLD) - 'versao' - 'updated_at' - 'updated_by' - 'created_at' - 'created_by') THEN
    NEW.versao := OLD.versao + 1;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  ELSE
    NEW.versao := OLD.versao;
  END IF;
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_convencao_versionar() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lic_convencao_guardar_versao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  INSERT INTO public."LIC_CONVENCAO_COLETIVA_VERSAO"(convencao_id, versao, dados, criado_por)
  VALUES (NEW.id, NEW.versao, to_jsonb(NEW), auth.uid())
  ON CONFLICT (convencao_id, versao) DO NOTHING;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_convencao_guardar_versao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lic_convencao_versionar ON public."LIC_CONVENCAO_COLETIVA";
CREATE TRIGGER trg_lic_convencao_versionar
  BEFORE INSERT OR UPDATE ON public."LIC_CONVENCAO_COLETIVA"
  FOR EACH ROW EXECUTE FUNCTION public.lic_convencao_versionar();

DROP TRIGGER IF EXISTS trg_lic_convencao_guardar_versao ON public."LIC_CONVENCAO_COLETIVA";
CREATE TRIGGER trg_lic_convencao_guardar_versao
  AFTER INSERT OR UPDATE ON public."LIC_CONVENCAO_COLETIVA"
  FOR EACH ROW EXECUTE FUNCTION public.lic_convencao_guardar_versao();

ALTER TABLE public."LIC_CONVENCAO_COLETIVA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LIC_CONVENCAO_COLETIVA_VERSAO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LIC_CONVENCAO_COLETIVA" TO authenticated;
GRANT SELECT ON public."LIC_CONVENCAO_COLETIVA_VERSAO" TO authenticated;

DROP POLICY IF EXISTS lic_convencao_select ON public."LIC_CONVENCAO_COLETIVA";
CREATE POLICY lic_convencao_select ON public."LIC_CONVENCAO_COLETIVA" FOR SELECT TO authenticated
  USING (public.lic_convencao_pode('visualizar'));
DROP POLICY IF EXISTS lic_convencao_insert ON public."LIC_CONVENCAO_COLETIVA";
CREATE POLICY lic_convencao_insert ON public."LIC_CONVENCAO_COLETIVA" FOR INSERT TO authenticated
  WITH CHECK (public.lic_convencao_pode('incluir'));
DROP POLICY IF EXISTS lic_convencao_update ON public."LIC_CONVENCAO_COLETIVA";
CREATE POLICY lic_convencao_update ON public."LIC_CONVENCAO_COLETIVA" FOR UPDATE TO authenticated
  USING (public.lic_convencao_pode('alterar')) WITH CHECK (public.lic_convencao_pode('alterar'));
DROP POLICY IF EXISTS lic_convencao_delete ON public."LIC_CONVENCAO_COLETIVA";
CREATE POLICY lic_convencao_delete ON public."LIC_CONVENCAO_COLETIVA" FOR DELETE TO authenticated
  USING (public.lic_convencao_pode('excluir'));
DROP POLICY IF EXISTS lic_convencao_versao_select ON public."LIC_CONVENCAO_COLETIVA_VERSAO";
CREATE POLICY lic_convencao_versao_select ON public."LIC_CONVENCAO_COLETIVA_VERSAO" FOR SELECT TO authenticated
  USING (public.lic_convencao_pode('visualizar'));

-- ── 3) Anexos (CCT e decreto) ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('convencoes-coletivas', 'convencoes-coletivas', false, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

-- Ler: qualquer autenticado (o Recrutamento consulta a referência da vaga;
-- o bucket é privado, a leitura é por URL assinada). Escrever: o módulo.
DROP POLICY IF EXISTS "convencoes coletivas anexo select" ON storage.objects;
CREATE POLICY "convencoes coletivas anexo select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'convencoes-coletivas');
DROP POLICY IF EXISTS "convencoes coletivas anexo insert" ON storage.objects;
CREATE POLICY "convencoes coletivas anexo insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'convencoes-coletivas'
              AND (public.lic_convencao_pode('incluir') OR public.lic_convencao_pode('alterar')));
DROP POLICY IF EXISTS "convencoes coletivas anexo delete" ON storage.objects;
CREATE POLICY "convencoes coletivas anexo delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'convencoes-coletivas'
         AND (public.lic_convencao_pode('alterar') OR public.lic_convencao_pode('excluir')));

-- ── 4) Vínculo do posto (Planilha de Custo) ──────────────────────────────
-- Um por contrato + posto (o `posto` da planilha_custo, que é também o
-- sup_posto.nome do catálogo). `regras`: { "<beneficio>": "<convencao_id>" }
-- só para o que NÃO sai da principal.
CREATE TABLE IF NOT EXISTS public."LIC_POSTO_CONVENCAO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id   uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  posto         text NOT NULL,
  convencao_id  uuid NOT NULL REFERENCES public."LIC_CONVENCAO_COLETIVA"(id) ON DELETE RESTRICT,
  regras        jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lic_posto_convencao
  ON public."LIC_POSTO_CONVENCAO"(contrato_id, upper(btrim(posto)));

CREATE OR REPLACE FUNCTION public.lic_posto_convencao_carimbo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.posto := btrim(NEW.posto);
  NEW.regras := coalesce(NEW.regras, '{}'::jsonb);
  NEW.atualizado_em := now();
  NEW.atualizado_por := auth.uid();
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_posto_convencao_carimbo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_lic_posto_convencao_carimbo ON public."LIC_POSTO_CONVENCAO";
CREATE TRIGGER trg_lic_posto_convencao_carimbo
  BEFORE INSERT OR UPDATE ON public."LIC_POSTO_CONVENCAO"
  FOR EACH ROW EXECUTE FUNCTION public.lic_posto_convencao_carimbo();

ALTER TABLE public."LIC_POSTO_CONVENCAO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LIC_POSTO_CONVENCAO" TO authenticated;
DROP POLICY IF EXISTS lic_posto_convencao_select ON public."LIC_POSTO_CONVENCAO";
CREATE POLICY lic_posto_convencao_select ON public."LIC_POSTO_CONVENCAO" FOR SELECT TO authenticated
  USING (public.lic_convencao_pode('visualizar'));
-- Quem vincula é quem mexe na Planilha de Custo.
DROP POLICY IF EXISTS lic_posto_convencao_write ON public."LIC_POSTO_CONVENCAO";
CREATE POLICY lic_posto_convencao_write ON public."LIC_POSTO_CONVENCAO" FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'planilha-custo', 'alterar'::public.app_acao)
         OR public.has_screen_access(auth.uid(), 'planilha-custo', 'incluir'::public.app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'planilha-custo', 'alterar'::public.app_acao)
              OR public.has_screen_access(auth.uid(), 'planilha-custo', 'incluir'::public.app_acao));


-- ── 5) Resolver contrato + posto → referência ────────────────────────────
-- Devolve o vínculo e as convenções que ele usa (dados da versão ATUAL).
-- Quem monta o quadro (benefício a benefício, pendências) é a tela.
-- status: 'sem_posto' | 'sem_vinculo' | 'vinculado'.
-- Casa contrato + posto e SÓ isso: posto sem vínculo é pendência, nunca a
-- CCT de outro posto do mesmo contrato.
CREATE OR REPLACE FUNCTION public.lic_referencia_do_posto_interno(p_contrato_id uuid, p_posto text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_link public."LIC_POSTO_CONVENCAO"%ROWTYPE;
  v_ids  uuid[];
BEGIN
  IF p_contrato_id IS NULL OR coalesce(btrim(p_posto), '') = '' THEN
    RETURN jsonb_build_object('status', 'sem_posto', 'contrato_id', p_contrato_id, 'posto', p_posto);
  END IF;
  SELECT * INTO v_link FROM public."LIC_POSTO_CONVENCAO"
   WHERE contrato_id = p_contrato_id AND upper(btrim(posto)) = upper(btrim(p_posto));
  IF v_link.id IS NULL THEN
    RETURN jsonb_build_object('status', 'sem_vinculo', 'contrato_id', p_contrato_id, 'posto', btrim(p_posto));
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids
    FROM (SELECT v_link.convencao_id AS x
          UNION ALL
          SELECT (r.value #>> '{}')::uuid FROM jsonb_each(v_link.regras) r
           WHERE (r.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') t;
  RETURN jsonb_build_object(
    'status', 'vinculado',
    'contrato_id', p_contrato_id,
    'posto', v_link.posto,
    'principal_id', v_link.convencao_id,
    'regras', v_link.regras,
    'vinculado_em', v_link.atualizado_em,
    'referencias', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'versao', c.versao, 'identificacao', c.identificacao,
               'categoria_profissional', c.categoria_profissional, 'sindicato', c.sindicato,
               'municipio', c.municipio, 'vigencia_inicio', c.vigencia_inicio, 'vigencia_fim', c.vigencia_fim,
               'cct_arquivo_path', c.cct_arquivo_path, 'decreto_numero', c.decreto_numero,
               'decreto_arquivo_path', c.decreto_arquivo_path, 'beneficios', c.beneficios,
               'contrato_nome', ct.nome, 'situacao', c.situacao))
        FROM public."LIC_CONVENCAO_COLETIVA" c
        LEFT JOIN public.contratos ct ON ct.id = c.contrato_id
       WHERE c.id = ANY (v_ids)), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.lic_referencia_do_posto_interno(uuid, text) FROM PUBLIC, anon, authenticated;

-- A pública (Abertura de Vagas, antes de a vaga existir). Benefício da CCT
-- não é segredo — é o que o Recrutamento conta ao candidato — então basta
-- estar logado.
CREATE OR REPLACE FUNCTION public.lic_referencia_do_posto(p_contrato_id uuid, p_posto text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada.' USING ERRCODE = '42501';
  END IF;
  RETURN public.lic_referencia_do_posto_interno(p_contrato_id, p_posto);
END $fn$;
REVOKE ALL ON FUNCTION public.lic_referencia_do_posto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lic_referencia_do_posto(uuid, text) TO authenticated;

-- ── 6) Retrato na vaga ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_RECRUTAMENTO_BENEFICIOS" (
  vaga_id          bigint PRIMARY KEY REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE CASCADE,
  -- Saída de lic_referencia_do_posto no momento em que a vaga a usou.
  referencia       jsonb,
  gerado_em        timestamptz,
  observacoes      text,
  observacoes_por  text,
  observacoes_em   timestamptz
);
ALTER TABLE public."SISTEMA_RECRUTAMENTO_BENEFICIOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."SISTEMA_RECRUTAMENTO_BENEFICIOS" TO authenticated;
-- Quem vê a vaga vê os benefícios e as observações dela. Escrita só pelas funções.
DROP POLICY IF EXISTS sistema_recrutamento_beneficios_select ON public."SISTEMA_RECRUTAMENTO_BENEFICIOS";
CREATE POLICY sistema_recrutamento_beneficios_select ON public."SISTEMA_RECRUTAMENTO_BENEFICIOS" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" r WHERE r.id = vaga_id));

-- Calcula e grava o retrato: contrato da vaga + nome do posto do catálogo
-- (sup_posto.nome = planilha_custo.posto).
CREATE OR REPLACE FUNCTION public.rec_beneficios_congelar(p_vaga bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_contrato uuid;
  v_posto    text;
  v_ref      jsonb;
BEGIN
  SELECT r.contrato_id, p.nome INTO v_contrato, v_posto
    FROM public."SISTEMA_RECRUTAMENTO" r
    LEFT JOIN public.sup_posto p ON p.id = r.posto_id
   WHERE r.id = p_vaga;
  v_ref := public.lic_referencia_do_posto_interno(v_contrato, v_posto);
  INSERT INTO public."SISTEMA_RECRUTAMENTO_BENEFICIOS"(vaga_id, referencia, gerado_em)
  VALUES (p_vaga, v_ref, now())
  ON CONFLICT (vaga_id) DO UPDATE SET referencia = EXCLUDED.referencia, gerado_em = EXCLUDED.gerado_em;
  RETURN v_ref;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_beneficios_congelar(bigint) FROM PUBLIC, anon, authenticated;

-- Gatilho: a vaga nasce (ou troca de contrato/posto) → retrato novo.
-- Nunca trava a vaga: erro vira WARNING.
CREATE OR REPLACE FUNCTION public.rec_beneficios_pela_vaga()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contrato_id IS NOT DISTINCT FROM OLD.contrato_id
     AND NEW.posto_id IS NOT DISTINCT FROM OLD.posto_id THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.rec_beneficios_congelar(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rec_beneficios_pela_vaga: %', SQLERRM;
  END;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.rec_beneficios_pela_vaga() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rec_beneficios_pela_vaga ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_beneficios_pela_vaga
  AFTER INSERT OR UPDATE OF contrato_id, posto_id ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_beneficios_pela_vaga();

-- Quem decide sobre a vaga — as MESMAS portas do sistema_recrutamento_guard.
CREATE OR REPLACE FUNCTION public.rec_beneficios_pode_alterar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
       public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar'::public.app_acao)
    OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir'::public.app_acao)
    OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar'::public.app_acao)
    OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar'::public.app_acao)
    OR public.has_screen_access(auth.uid(), 'diretoria_recrutamento', 'aprovar'::public.app_acao)
    OR public.has_screen_access(auth.uid(), 'diretoria_recrutamento', 'alterar'::public.app_acao))
$$;
REVOKE ALL ON FUNCTION public.rec_beneficios_pode_alterar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_beneficios_pode_alterar() TO authenticated;

-- Benefícios da vaga para a tela. O retrato vinculado vale como está (é a
-- versão que a vaga usou); sem retrato ou ainda pendente, tenta de novo —
-- a Licitação pode ter vinculado o posto depois que a vaga abriu.
-- `versoes_atuais` deixa a tela avisar quando a convenção já mudou.
-- `p_atualizar` = trocar o retrato pela versão atual (só quem decide a vaga).
CREATE OR REPLACE FUNCTION public.rec_beneficios_da_vaga(p_vaga bigint, p_atualizar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ref jsonb;
  v_em  timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada.' USING ERRCODE = '42501';
  END IF;
  IF p_atualizar AND NOT public.rec_beneficios_pode_alterar() THEN
    RAISE EXCEPTION 'Só quem conduz a vaga atualiza a referência dos benefícios.' USING ERRCODE = '42501';
  END IF;
  SELECT referencia, gerado_em INTO v_ref, v_em FROM public."SISTEMA_RECRUTAMENTO_BENEFICIOS" WHERE vaga_id = p_vaga;
  IF p_atualizar OR v_ref IS NULL OR v_ref->>'status' IS DISTINCT FROM 'vinculado' THEN
    v_ref := public.rec_beneficios_congelar(p_vaga);
    v_em := now();
  END IF;
  RETURN v_ref || jsonb_build_object(
    'gerado_em', v_em,
    'pode_atualizar', public.rec_beneficios_pode_alterar(),
    'versoes_atuais', coalesce((
      SELECT jsonb_object_agg(c.id, c.versao)
        FROM public."LIC_CONVENCAO_COLETIVA" c
       WHERE c.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(coalesce(v_ref->'referencias', '[]'::jsonb)) e)), '{}'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.rec_beneficios_da_vaga(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_beneficios_da_vaga(bigint, boolean) TO authenticated;

-- Observações da solicitação (quadro ao lado dos benefícios).
CREATE OR REPLACE FUNCTION public.rec_vaga_observacoes_salvar(p_vaga bigint, p_texto text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_nome  text;
  v_email text;
BEGIN
  IF NOT public.rec_beneficios_pode_alterar() THEN
    RAISE EXCEPTION 'Só quem conduz a vaga registra observações nela.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" WHERE id = p_vaga) THEN
    RAISE EXCEPTION 'Vaga #% não encontrada.', p_vaga;
  END IF;
  SELECT coalesce(nullif(btrim(display_name), ''), email), email INTO v_nome, v_email
    FROM public.profiles WHERE id = auth.uid();
  v_nome := coalesce(v_nome, 'Usuário');
  INSERT INTO public."SISTEMA_RECRUTAMENTO_BENEFICIOS"(vaga_id, observacoes, observacoes_por, observacoes_em)
  VALUES (p_vaga, nullif(btrim(p_texto), ''), v_nome, now())
  ON CONFLICT (vaga_id) DO UPDATE
     SET observacoes = EXCLUDED.observacoes, observacoes_por = EXCLUDED.observacoes_por, observacoes_em = EXCLUDED.observacoes_em;
  -- Sem de/para/candidato e sem papel: não mexe no responsável pela vaga.
  INSERT INTO public."RECRUTAMENTO_HISTORICO"(solicitacao_id, evento, usuario_nome, usuario_email, detalhe)
  VALUES (p_vaga, 'Observações da solicitação atualizadas', v_nome, v_email, nullif(btrim(p_texto), ''));
  RETURN jsonb_build_object('ok', true, 'por', v_nome, 'em', now());
END $fn$;
REVOKE ALL ON FUNCTION public.rec_vaga_observacoes_salvar(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_vaga_observacoes_salvar(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_rec_beneficios_pela_vaga ON public."SISTEMA_RECRUTAMENTO";
-- DROP FUNCTION IF EXISTS public.rec_vaga_observacoes_salvar(bigint, text);
-- DROP FUNCTION IF EXISTS public.rec_beneficios_da_vaga(bigint, boolean);
-- DROP FUNCTION IF EXISTS public.rec_beneficios_pode_alterar();
-- DROP FUNCTION IF EXISTS public.rec_beneficios_pela_vaga();
-- DROP FUNCTION IF EXISTS public.rec_beneficios_congelar(bigint);
-- DROP TABLE IF EXISTS public."SISTEMA_RECRUTAMENTO_BENEFICIOS";
-- DROP FUNCTION IF EXISTS public.lic_referencia_do_posto(uuid, text);
-- DROP FUNCTION IF EXISTS public.lic_referencia_do_posto_interno(uuid, text);
-- DROP TABLE IF EXISTS public."LIC_POSTO_CONVENCAO";
-- DROP TABLE IF EXISTS public."LIC_CONVENCAO_COLETIVA_VERSAO";
-- DROP TABLE IF EXISTS public."LIC_CONVENCAO_COLETIVA";
-- DROP FUNCTION IF EXISTS public.lic_convencao_pode(text);
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'licitacoes_convencoes';
-- DELETE FROM public.app_menu WHERE codigo = 'licitacoes_convencoes';
