-- =========================================================================
-- SST › ACIDENTES DE TRABALHO — registro e controle (17/11/2026, SIS-2026-0889)
--
-- CHAMADO (SST): "Criar no ERP uma área específica para registro e controle
-- dos acidentes de trabalho, vinculada diretamente ao cadastro do
-- colaborador [...] substituindo a planilha paralela."
--
-- A PLANILHA ("PLANILHA DE ACIDENTES.xlsx", aba "Histórico de Acidentes"),
-- lida em 17/11/2026: 128 acidentes de 2024 a 2026, um por pessoa (a coluna
-- "Nº DE PESSOAS ENVOLVIDAS" é 1 em todas). A coluna "ACIDENTE" juntava duas
-- respostas em três valores — S/ AFASTAMENTO (35), C/ AFASTAMENTO S/ INSS
-- (78) e C/ AFASTAMENTO (15, que é COM INSS). Aqui viram dois Sim/Não.
-- 26 sem CAT, 99 com número, 3 com "SIM" e sem número.
--
-- O QUE ESTA MIGRATION FAZ (aditiva)
--   1. Menu sst_acidentes_trabalho (visualizar + alterar + excluir), semeado
--      como o dos Exames Toxicológicos: perfis concede_tudo e quem já cuida
--      do Controle de Afastamentos. `excluir` NÃO vem no toggle do painel
--      (J1.A): vai nos mesmos perfis e pessoas, e quem mais precisar ganha por
--      um perfil de acesso com a ação marcada.
--      O código não é "sst_acidentes" porque esse já é um indicador das TVs
--      gerenciais (TVG_INDICADOR, mig 20261109001000) — namespace diferente,
--      mas confundiria quem procura.
--   2. SST_ACIDENTE (um acidente de UMA pessoa), _HISTORICO e _DOC. Sem
--      acesso direto às tabelas (guardam CPF e dado de saúde): tudo por RPC.
--   3. Bucket privado sst-acidentes para a CAT (nunca link público).
--   4. Concluir confere o mínimo (sst_acidente_pendencias): tipo, descrição,
--      contrato, colaborador ligado, dias se houve afastamento e, sobre a CAT,
--      número + arquivo anexado — ou o motivo de não ter emitido. A mesma
--      regra está em src/lib/sst/acidentes.ts (pendenciasParaConcluir), com teste.
--   5. Importação da planilha pelo botão da tela (sst_acidente_importar), com
--      simulação antes de gravar. O arquivo NÃO entra no repositório (é
--      público e a planilha tem nome de colaborador e descrição do acidente).
--
-- A PESSOA É O CPF, não EMPREGADOS."ID" (a carga da Senior recria as linhas,
-- mig 20261005000001). Linha importada cujo nome não casou com UM só CPF
-- fica com cpf NULL ("sem vínculo") até o SST escolher a pessoa na tela.
--
-- Afastamento: o acidente é o fato; o afastamento tem fluxo próprio
-- (SST_AFASTAMENTO e SST_CTRL_AFASTAMENTO). Aqui só se LIGA a um deles —
-- nada é criado lá, para não duplicar o lançamento do SST.
--
-- Reaproveita sst_toxico_pessoas() e sst_toxico_contrato() da mig
-- 20261117140000: mesma leitura de pessoa por CPF e de contrato pela filial.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Menu e acesso ─────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_acidentes_trabalho', 'Acidentes de Trabalho', '/app/sst/acidentes',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'sst_acidentes_trabalho');

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('sst_acidentes_trabalho', 'alterar'::public.app_acao),
       ('sst_acidentes_trabalho', 'excluir'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- concede_tudo já via tudo: a linha só marca o menu como configurado, e sem
-- ela a tela nasceria aberta para todo autenticado (J2 de .github/REGRAS-PR.md).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sst_acidentes_trabalho', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('alterar'::public.app_acao), ('excluir'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Quem altera o Controle de Afastamentos também exclui aqui (J1.A).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'sst_acidentes_trabalho', a.acao, true
  FROM public.perfil_acesso_permissao pp
 CROSS JOIN LATERAL (VALUES (pp.acao), (CASE WHEN pp.acao = 'alterar' THEN 'excluir'::public.app_acao END)) AS a(acao)
 WHERE pp.menu_codigo = 'sst_controle_afastamentos'
   AND pp.acao IN ('visualizar', 'alterar') AND pp.allow
   AND a.acao IS NOT NULL
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sst_acidentes_trabalho', a.acao, true,
       'Migração 20261117220000 (SIS-2026-0889): já cuidava do Controle de Afastamentos'
  FROM public.screen_permission_user s
 CROSS JOIN LATERAL (VALUES (s.acao), (CASE WHEN s.acao = 'alterar' THEN 'excluir'::public.app_acao END)) AS a(acao)
 WHERE s.menu_codigo = 'sst_controle_afastamentos'
   AND s.acao IN ('visualizar', 'alterar') AND s.allow
   AND a.acao IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'sst_acidentes_trabalho' AND x.acao = a.acao);

CREATE OR REPLACE FUNCTION public.sst_acidente_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'sst_acidentes_trabalho', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.sst_acidente_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_pode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_acidente_exige(_acao text DEFAULT 'visualizar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.sst_acidente_pode(_acao) THEN
    RAISE EXCEPTION 'Sem acesso (%) aos Acidentes de Trabalho', _acao USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sst_acidente_exige(text) FROM PUBLIC, anon, authenticated;

-- O nome que a planilha do SST usava. EMPREGADOS."Empresa" 1 é a NASCIMENTO
-- SERVICOS DE LIMPEZA LTDA (conferido em 17/11/2026), não "HAGG" como diz
-- o EMPRESA_MAP do RH.
CREATE OR REPLACE FUNCTION public.sst_acidente_empresa(_codigo text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE btrim(COALESCE(_codigo, '')) WHEN '1' THEN 'NASCIMENTO' WHEN '2' THEN 'SN' WHEN '3' THEN 'CANAÃ' WHEN '5' THEN 'NH' END
$$;

-- ── 2. Tabelas ───────────────────────────────────────────────────────────
-- contrato_id e os ids de afastamento sem FK, como em SST_AFASTAMENTO: a
-- lista faz LEFT JOIN e mostra o texto quando o alvo some.
CREATE TABLE IF NOT EXISTS public."SST_ACIDENTE" (
  id                  bigserial PRIMARY KEY,
  cpf                 text CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),   -- NULL = sem vínculo (só importação)
  nome                text NOT NULL,                                      -- cópia, para quem saiu do EMPREGADOS
  empresa             text,
  contrato_id         uuid,
  -- O contrato como a planilha escrevia ("HU  RIO GRANDE"); fica mesmo
  -- depois de escolhido o contrato, para conferência.
  contrato_texto      text,
  encarregado         text,
  data_acidente       date NOT NULL,
  tipo                text CHECK (tipo IS NULL OR tipo IN ('tipico', 'trajeto')),
  descricao           text,
  houve_afastamento   boolean NOT NULL DEFAULT false,
  dias_afastamento    integer CHECK (dias_afastamento IS NULL OR dias_afastamento >= 0),
  encaminhado_inss    boolean NOT NULL DEFAULT false,
  cat_emitida         boolean,                                            -- NULL = ainda não decidido
  numero_cat          text,
  cat_motivo_sem      text,
  morte_invalidez     boolean NOT NULL DEFAULT false,
  observacoes         text,
  afastamento_id      bigint,                                             -- SST_AFASTAMENTO (atestado)
  ctrl_afastamento_id bigint,                                             -- SST_CTRL_AFASTAMENTO (longo / INSS)
  concluido           boolean NOT NULL DEFAULT false,
  concluido_em        timestamptz,
  concluido_por       text,
  origem              text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'planilha')),
  chave_importacao    text UNIQUE,
  created_by          uuid,
  created_by_nome     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_acid_afastamento_ck CHECK (houve_afastamento OR (dias_afastamento IS NULL AND NOT encaminhado_inss))
);
CREATE INDEX IF NOT EXISTS sst_acid_data_idx ON public."SST_ACIDENTE" (data_acidente);
CREATE INDEX IF NOT EXISTS sst_acid_cpf_idx ON public."SST_ACIDENTE" (cpf);

CREATE TABLE IF NOT EXISTS public."SST_ACIDENTE_HISTORICO" (
  id          bigserial PRIMARY KEY,
  acidente_id bigint NOT NULL REFERENCES public."SST_ACIDENTE"(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('criacao', 'alteracao', 'conclusao', 'reabertura', 'documento', 'vinculo', 'importacao')),
  descricao   text,
  autor_nome  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_acid_hist_fk_idx ON public."SST_ACIDENTE_HISTORICO" (acidente_id);

CREATE TABLE IF NOT EXISTS public."SST_ACIDENTE_DOC" (
  id           bigserial PRIMARY KEY,
  acidente_id  bigint NOT NULL REFERENCES public."SST_ACIDENTE"(id) ON DELETE CASCADE,
  categoria    text NOT NULL DEFAULT 'cat' CHECK (categoria IN ('cat', 'outro')),
  nome         text NOT NULL,
  storage_path text NOT NULL,
  tamanho      bigint,
  tipo         text,
  enviado_por  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_acid_doc_fk_idx ON public."SST_ACIDENTE_DOC" (acidente_id);

-- RLS ligada e nenhuma policy: a tela lê e grava só pelas RPCs abaixo, que
-- nunca devolvem o CPF.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SST_ACIDENTE', 'SST_ACIDENTE_HISTORICO', 'SST_ACIDENTE_DOC'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_sst_acidente_updated_at ON public."SST_ACIDENTE";
CREATE TRIGGER trg_sst_acidente_updated_at
  BEFORE UPDATE ON public."SST_ACIDENTE"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. CAT e anexos: bucket privado ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sst-acidentes', 'sst-acidentes', false, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "sst acidentes select" ON storage.objects;
CREATE POLICY "sst acidentes select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sst-acidentes' AND (select public.sst_acidente_pode('visualizar')));
DROP POLICY IF EXISTS "sst acidentes insert" ON storage.objects;
CREATE POLICY "sst acidentes insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sst-acidentes' AND (select public.sst_acidente_pode('alterar')));
DROP POLICY IF EXISTS "sst acidentes delete" ON storage.objects;
CREATE POLICY "sst acidentes delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sst-acidentes' AND (select public.sst_acidente_pode('alterar')));

-- ── 4. Funções internas ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_acidente_hist(p_id bigint, p_tipo text, p_desc text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public."SST_ACIDENTE_HISTORICO" (acidente_id, tipo, descricao, autor_nome)
  VALUES (p_id, p_tipo, p_desc, public.sst_afa_nome_usuario())
$$;
REVOKE ALL ON FUNCTION public.sst_acidente_hist(bigint, text, text) FROM PUBLIC, anon, authenticated;

-- O que falta para concluir. A mesma lista, com os mesmos textos, está em
-- src/lib/sst/acidentes.ts (pendenciasParaConcluir): a tela mostra antes,
-- o banco confere na hora.
CREATE OR REPLACE FUNCTION public.sst_acidente_pendencias(p_id bigint)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  a     public."SST_ACIDENTE"%ROWTYPE;
  v_cat boolean;
  v_p   text[] := '{}';
BEGIN
  SELECT * INTO a FROM public."SST_ACIDENTE" WHERE id = p_id;
  IF NOT FOUND THEN RETURN ARRAY['Acidente não encontrado']; END IF;
  v_cat := EXISTS (SELECT 1 FROM public."SST_ACIDENTE_DOC" d WHERE d.acidente_id = p_id AND d.categoria = 'cat');
  IF a.cpf IS NULL THEN v_p := v_p || 'Ligar o registro a um colaborador'::text; END IF;
  IF a.contrato_id IS NULL AND nullif(btrim(a.contrato_texto), '') IS NULL THEN v_p := v_p || 'Informar o contrato'::text; END IF;
  IF a.tipo IS NULL THEN v_p := v_p || 'Informar o tipo (típico ou trajeto)'::text; END IF;
  IF nullif(btrim(a.descricao), '') IS NULL THEN v_p := v_p || 'Descrever o ocorrido'::text; END IF;
  IF a.houve_afastamento AND a.dias_afastamento IS NULL THEN v_p := v_p || 'Informar os dias de afastamento'::text; END IF;
  IF a.cat_emitida IS NULL THEN
    v_p := v_p || 'Dizer se a CAT foi emitida'::text;
  ELSIF a.cat_emitida THEN
    IF nullif(btrim(a.numero_cat), '') IS NULL THEN v_p := v_p || 'Informar o número da CAT'::text; END IF;
    IF NOT v_cat THEN v_p := v_p || 'Anexar o arquivo da CAT'::text; END IF;
  ELSIF nullif(btrim(a.cat_motivo_sem), '') IS NULL THEN
    v_p := v_p || 'Informar o motivo de não ter emitido a CAT'::text;
  END IF;
  RETURN v_p;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_pendencias(bigint) FROM PUBLIC, anon, authenticated;

-- Quem é a pessoa de um EMPREGADOS."ID": CPF, nome e o que a sugestão usa.
CREATE OR REPLACE FUNCTION public.sst_acidente_pessoa(p_empregado_id bigint)
RETURNS TABLE (cpf text, nome text, empresa text, filial text, local_senior text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT regexp_replace(COALESCE(e."CPF"::text, ''), '\D', '', 'g'), btrim(e."Nome"::text),
         public.sst_acidente_empresa(e."Empresa"::text), e."Nome Filial"::text, e."Descrição do Local"::text
    FROM public."EMPREGADOS" e WHERE e."ID" = p_empregado_id
$$;
REVOKE ALL ON FUNCTION public.sst_acidente_pessoa(bigint) FROM PUBLIC, anon, authenticated;

-- ── 5. RPCs de leitura ───────────────────────────────────────────────────
-- Todos os acidentes, sem CPF. São poucos (128 em dois anos e meio): a tela
-- filtra e soma no navegador.
CREATE OR REPLACE FUNCTION public.sst_acidentes_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_acidente_exige('visualizar');
  RETURN COALESCE((
    WITH p AS (SELECT * FROM public.sst_toxico_pessoas() x WHERE x.cpf IN (SELECT a.cpf FROM public."SST_ACIDENTE" a))
    SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'empregado_id', p.empregado_id, 'vinculado', a.cpf IS NOT NULL,
        'nome', COALESCE(p.nome, a.nome), 'cargo', p.cargo, 'situacao_senior', p.situacao,
        'desligado', COALESCE(p.desligado, false),
        'empresa', a.empresa, 'contrato_id', a.contrato_id, 'contrato_nome', c.nome, 'contrato_texto', a.contrato_texto,
        'encarregado', a.encarregado, 'data_acidente', a.data_acidente, 'tipo', a.tipo, 'descricao', a.descricao,
        'houve_afastamento', a.houve_afastamento, 'dias_afastamento', a.dias_afastamento,
        'encaminhado_inss', a.encaminhado_inss, 'cat_emitida', a.cat_emitida, 'numero_cat', a.numero_cat,
        'cat_motivo_sem', a.cat_motivo_sem, 'morte_invalidez', a.morte_invalidez, 'observacoes', a.observacoes,
        'afastamento_id', a.afastamento_id, 'ctrl_afastamento_id', a.ctrl_afastamento_id,
        'concluido', a.concluido, 'concluido_em', a.concluido_em, 'concluido_por', a.concluido_por,
        'origem', a.origem, 'created_at', a.created_at,
        'documentos', COALESCE(d.n, 0), 'cat_anexada', COALESCE(d.cat, false))
      ORDER BY a.data_acidente DESC, a.id DESC)
      FROM public."SST_ACIDENTE" a
      LEFT JOIN p ON p.cpf = a.cpf
      LEFT JOIN public.contratos c ON c.id = a.contrato_id
      LEFT JOIN (SELECT x.acidente_id, count(*) AS n, bool_or(x.categoria = 'cat') AS cat
                   FROM public."SST_ACIDENTE_DOC" x GROUP BY 1) d ON d.acidente_id = a.id
  ), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidentes_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidentes_lista() TO authenticated;

-- Histórico, anexos e os afastamentos da mesma pessoa perto da data — o que
-- a tela oferece para ligar (3 dias antes a 30 depois do acidente).
CREATE OR REPLACE FUNCTION public.sst_acidente_ficha(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a public."SST_ACIDENTE"%ROWTYPE;
BEGIN
  PERFORM public.sst_acidente_exige('visualizar');
  SELECT * INTO a FROM public."SST_ACIDENTE" WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acidente não encontrado.'; END IF;
  RETURN jsonb_build_object(
    'pendencias', to_jsonb(public.sst_acidente_pendencias(p_id)),
    'historico', COALESCE((SELECT jsonb_agg(to_jsonb(h) - 'acidente_id' ORDER BY h.created_at DESC, h.id DESC)
                             FROM public."SST_ACIDENTE_HISTORICO" h WHERE h.acidente_id = p_id), '[]'::jsonb),
    'documentos', COALESCE((SELECT jsonb_agg(to_jsonb(d) - 'acidente_id' ORDER BY d.id DESC)
                              FROM public."SST_ACIDENTE_DOC" d WHERE d.acidente_id = p_id), '[]'::jsonb),
    'afastamentos', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'data_inicio') FROM (
        SELECT jsonb_build_object('origem', 'atestado', 'id', f.id, 'data_inicio', f.data_inicio,
                 'descricao', CASE f.tipo WHEN 'acidente_trabalho' THEN 'Atestado por acidente de trabalho'
                                          WHEN 'auxilio_doenca' THEN 'Auxílio-doença' ELSE 'Atestado' END
                              || COALESCE(' (' || f.protocolo || ')', ''),
                 'dias', f.dias_considerados, 'ligado', f.id IS NOT DISTINCT FROM a.afastamento_id) AS x
          FROM public."SST_AFASTAMENTO" f
         WHERE a.cpf IS NOT NULL AND regexp_replace(COALESCE(f.cpf, ''), '\D', '', 'g') = a.cpf AND NOT f.cancelado
           AND (f.id = a.afastamento_id OR f.data_inicio BETWEEN a.data_acidente - 3 AND a.data_acidente + 30)
        UNION ALL
        SELECT jsonb_build_object('origem', 'controle', 'id', g.id, 'data_inicio', g.data_inicio,
                 'descricao', 'Controle de Afastamentos: ' || g.motivo || ' (' || g.status || ')',
                 -- Caso aberto: dias até hoje.
                 'dias', (COALESCE(g.data_retorno_real, g.encerrado_em, current_date) - g.data_inicio),
                 'ligado', g.id IS NOT DISTINCT FROM a.ctrl_afastamento_id)
          FROM public."SST_CTRL_AFASTAMENTO" g
         WHERE a.cpf IS NOT NULL AND regexp_replace(COALESCE(g.cpf, ''), '\D', '', 'g') = a.cpf
           AND (g.id = a.ctrl_afastamento_id OR g.data_inicio BETWEEN a.data_acidente - 3 AND a.data_acidente + 30)
      ) s), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_ficha(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_ficha(bigint) TO authenticated;

-- Busca para registrar: desligados também (o acidente pode ser lançado depois
-- que a pessoa saiu), marcados.
CREATE OR REPLACE FUNCTION public.sst_acidente_colaboradores(p_busca text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  t   text := btrim(COALESCE(p_busca, ''));
  dig text := regexp_replace(COALESCE(p_busca, ''), '\D', '', 'g');
BEGIN
  PERFORM public.sst_acidente_exige('visualizar');
  IF length(t) < 3 THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'desligado')::boolean, x->>'nome') FROM (
      SELECT jsonb_build_object('id', p.empregado_id, 'nome', p.nome, 'situacao', p.situacao, 'filial', p.filial,
                                'cargo', p.cargo, 'desligado', p.desligado) AS x
        FROM public.sst_toxico_pessoas() p
       WHERE (p.nome ILIKE '%' || t || '%' OR (length(dig) = 11 AND p.cpf = dig))
         AND p.nome NOT ILIKE '%teste%'
       ORDER BY p.desligado, p.nome
       LIMIT 20) s), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_colaboradores(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_colaboradores(text) TO authenticated;

-- O que o formulário preenche ao escolher a pessoa: empresa, contrato (pela
-- filial, como no Toxicológico) e os nomes possíveis de encarregado — o
-- superior no Organograma e quem tem cargo de encarregado/supervisor ativo
-- na mesma filial. A coluna LIDER não entra: é lixo em 97% das linhas.
CREATE OR REPLACE FUNCTION public.sst_acidente_sugestao(p_empregado_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  e   record;
  v_c jsonb;
BEGIN
  PERFORM public.sst_acidente_exige('visualizar');
  SELECT * INTO e FROM public.sst_acidente_pessoa(p_empregado_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador não encontrado.'; END IF;
  v_c := public.sst_toxico_contrato(e.filial, e.local_senior);
  RETURN jsonb_build_object(
    'empresa', e.empresa,
    'contrato_id', v_c->>'contrato_id', 'contrato_nome', v_c->>'contrato_nome',
    'encarregados', COALESCE((
      SELECT jsonb_agg(DISTINCT n.nome) FROM (
        SELECT public.organograma_nome_no(o.parent_id) AS nome
          FROM public."ORGANOGRAMA_NO" o
         WHERE o.empregado_id = p_empregado_id AND o.parent_id IS NOT NULL
        UNION
        SELECT p.nome FROM public.sst_toxico_pessoas() p
         WHERE NOT p.desligado AND p.filial IS NOT DISTINCT FROM e.filial
           AND p.cargo ~* '(ENCARREG|SUPERVISOR)' AND p.nome NOT ILIKE '%teste%'
      ) n WHERE nullif(btrim(n.nome), '') IS NOT NULL), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_sugestao(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_sugestao(bigint) TO authenticated;

-- A lista de contratos para o formulário: pela RPC, porque a RLS de
-- contratos devolveria lista vazia para quem é só do SST.
CREATE OR REPLACE FUNCTION public.sst_acidente_contratos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_acidente_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'encerrado', COALESCE(c.status, 'ativo') = 'encerrado')
                     ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), c.nome)
      FROM public.contratos c WHERE nullif(btrim(c.nome), '') IS NOT NULL), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_contratos() TO authenticated;

-- A aba "Acidentes" da Ficha do Colaborador (Espaço do Colaborador): os
-- acidentes do CPF daquele cadastro, com os anexos.
CREATE OR REPLACE FUNCTION public.sst_acidentes_do_colaborador(p_empregado_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cpf text;
BEGIN
  PERFORM public.sst_acidente_exige('visualizar');
  SELECT x.cpf INTO v_cpf FROM public.sst_acidente_pessoa(p_empregado_id) x;
  IF length(COALESCE(v_cpf, '')) <> 11 THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'data_acidente', a.data_acidente, 'tipo', a.tipo, 'descricao', a.descricao,
        'contrato_nome', COALESCE(c.nome, a.contrato_texto), 'houve_afastamento', a.houve_afastamento,
        'dias_afastamento', a.dias_afastamento, 'encaminhado_inss', a.encaminhado_inss,
        'cat_emitida', a.cat_emitida, 'numero_cat', a.numero_cat, 'concluido', a.concluido,
        'documentos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.nome, 'categoria', d.categoria,
                                                                   'storage_path', d.storage_path) ORDER BY d.id)
                                  FROM public."SST_ACIDENTE_DOC" d WHERE d.acidente_id = a.id), '[]'::jsonb))
      ORDER BY a.data_acidente DESC, a.id DESC)
      FROM public."SST_ACIDENTE" a
      LEFT JOIN public.contratos c ON c.id = a.contrato_id
     WHERE a.cpf = v_cpf), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidentes_do_colaborador(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidentes_do_colaborador(bigint) TO authenticated;

-- ── 6. RPCs de escrita ───────────────────────────────────────────────────
-- Cria (sem p.id, com p.empregado_id) ou altera. Grava só as chaves que
-- vierem em p. Mandar empregado_id num registro existente troca a pessoa —
-- é como o SST liga uma linha importada "sem vínculo".
CREATE OR REPLACE FUNCTION public.sst_acidente_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id    bigint := nullif(p->>'id', '')::bigint;
  a       public."SST_ACIDENTE"%ROWTYPE;
  n       public."SST_ACIDENTE"%ROWTYPE;
  v_emp   bigint := nullif(p->>'empregado_id', '')::bigint;
  -- Escalares, não um record: campo de record não atribuído quebra o UPDATE
  -- mesmo dentro do CASE que não é tomado.
  v_cpf   text;
  v_nome  text;
  v_empr  text;
  v_data  date;
  v_tipo  text;
  v_afa   boolean;
  v_dias  integer;
  v_inss  boolean;
  v_cat   boolean;
  v_num   text;
  v_mud   text[] := '{}';
  fmt     CONSTANT text := 'DD/MM/YYYY';
  sn      CONSTANT text[] := ARRAY['Não', 'Sim'];
BEGIN
  PERFORM public.sst_acidente_exige('alterar');

  IF v_emp IS NOT NULL THEN
    SELECT x.cpf, x.nome, x.empresa INTO v_cpf, v_nome, v_empr FROM public.sst_acidente_pessoa(v_emp) x;
    IF NOT FOUND THEN RAISE EXCEPTION 'Escolha o colaborador na lista.'; END IF;
    IF length(v_cpf) <> 11 THEN
      RAISE EXCEPTION '% está sem CPF no cadastro da Senior: não dá para ligar o acidente.', v_nome;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    IF v_emp IS NULL THEN RAISE EXCEPTION 'Escolha o colaborador na lista.'; END IF;
    IF nullif(p->>'data_acidente', '') IS NULL THEN RAISE EXCEPTION 'Informe a data do acidente.'; END IF;
    INSERT INTO public."SST_ACIDENTE" (cpf, nome, empresa, data_acidente, origem, created_by, created_by_nome)
    VALUES (v_cpf, v_nome, v_empr, (p->>'data_acidente')::date, 'manual', auth.uid(), public.sst_afa_nome_usuario())
    RETURNING id INTO v_id;
    PERFORM public.sst_acidente_hist(v_id, 'criacao', 'Acidente registrado.');
  ELSE
    PERFORM 1 FROM public."SST_ACIDENTE" WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Acidente não encontrado.'; END IF;
  END IF;

  SELECT * INTO a FROM public."SST_ACIDENTE" WHERE id = v_id;
  v_data := CASE WHEN p ? 'data_acidente' THEN nullif(p->>'data_acidente', '')::date ELSE a.data_acidente END;
  v_tipo := CASE WHEN p ? 'tipo' THEN nullif(p->>'tipo', '') ELSE a.tipo END;
  v_afa  := CASE WHEN p ? 'houve_afastamento' THEN COALESCE((p->>'houve_afastamento')::boolean, false) ELSE a.houve_afastamento END;
  v_dias := CASE WHEN p ? 'dias_afastamento' THEN nullif(p->>'dias_afastamento', '')::integer ELSE a.dias_afastamento END;
  v_inss := CASE WHEN p ? 'encaminhado_inss' THEN COALESCE((p->>'encaminhado_inss')::boolean, false) ELSE a.encaminhado_inss END;
  v_cat  := CASE WHEN p ? 'cat_emitida' THEN (nullif(p->>'cat_emitida', ''))::boolean ELSE a.cat_emitida END;
  v_num  := CASE WHEN p ? 'numero_cat' THEN nullif(btrim(p->>'numero_cat'), '') ELSE a.numero_cat END;

  -- Confere antes do UPDATE: a CHECK da tabela daria um erro ilegível.
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data do acidente.'; END IF;
  IF v_data > current_date THEN RAISE EXCEPTION 'A data do acidente não pode ser futura.'; END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('tipico', 'trajeto') THEN RAISE EXCEPTION 'Tipo de acidente inválido: %.', v_tipo; END IF;
  IF v_dias < 0 THEN RAISE EXCEPTION 'Os dias de afastamento não podem ser negativos.'; END IF;
  IF NOT v_afa AND v_dias IS NOT NULL THEN RAISE EXCEPTION 'Dias de afastamento só valem quando houve afastamento.'; END IF;
  IF NOT v_afa AND v_inss THEN RAISE EXCEPTION 'Encaminhamento ao INSS só vale quando houve afastamento.'; END IF;
  IF v_cat IS NOT TRUE AND v_num IS NOT NULL THEN RAISE EXCEPTION 'Marque "CAT emitida: Sim" para informar o número da CAT.'; END IF;

  UPDATE public."SST_ACIDENTE" SET
    cpf               = CASE WHEN v_emp IS NOT NULL THEN v_cpf ELSE cpf END,
    nome              = CASE WHEN v_emp IS NOT NULL THEN v_nome ELSE nome END,
    empresa           = CASE WHEN p ? 'empresa' THEN nullif(btrim(p->>'empresa'), '')
                             WHEN v_emp IS NOT NULL THEN COALESCE(empresa, v_empr) ELSE empresa END,
    contrato_id       = CASE WHEN p ? 'contrato_id' THEN nullif(p->>'contrato_id', '')::uuid ELSE contrato_id END,
    encarregado       = CASE WHEN p ? 'encarregado' THEN nullif(btrim(p->>'encarregado'), '') ELSE encarregado END,
    data_acidente     = v_data,
    tipo              = v_tipo,
    descricao         = CASE WHEN p ? 'descricao' THEN nullif(btrim(p->>'descricao'), '') ELSE descricao END,
    houve_afastamento = v_afa,
    dias_afastamento  = v_dias,
    encaminhado_inss  = v_inss,
    cat_emitida       = v_cat,
    numero_cat        = v_num,
    cat_motivo_sem    = CASE WHEN v_cat IS NOT FALSE THEN NULL
                             WHEN p ? 'cat_motivo_sem' THEN nullif(btrim(p->>'cat_motivo_sem'), '') ELSE cat_motivo_sem END,
    morte_invalidez   = CASE WHEN p ? 'morte_invalidez' THEN COALESCE((p->>'morte_invalidez')::boolean, false) ELSE morte_invalidez END,
    observacoes       = CASE WHEN p ? 'observacoes' THEN nullif(btrim(p->>'observacoes'), '') ELSE observacoes END
  WHERE id = v_id
  RETURNING * INTO n;

  -- Registro recém-criado: o "Acidente registrado" já basta no histórico.
  IF a.created_at < now() THEN
    IF n.cpf IS DISTINCT FROM a.cpf THEN
      v_mud := v_mud || ('Colaborador: ' || a.nome || CASE WHEN a.cpf IS NULL THEN ' (sem vínculo)' ELSE '' END || ' → ' || n.nome); END IF;
    IF n.empresa IS DISTINCT FROM a.empresa THEN v_mud := v_mud || ('Empresa: ' || COALESCE(n.empresa, '—')); END IF;
    IF n.contrato_id IS DISTINCT FROM a.contrato_id THEN
      v_mud := v_mud || ('Contrato: ' || COALESCE((SELECT c.nome FROM public.contratos c WHERE c.id = n.contrato_id), '—')); END IF;
    IF n.encarregado IS DISTINCT FROM a.encarregado THEN v_mud := v_mud || ('Encarregado: ' || COALESCE(n.encarregado, '—')); END IF;
    IF n.data_acidente IS DISTINCT FROM a.data_acidente THEN
      v_mud := v_mud || ('Data: ' || to_char(a.data_acidente, fmt) || ' → ' || to_char(n.data_acidente, fmt)); END IF;
    IF n.tipo IS DISTINCT FROM a.tipo THEN
      v_mud := v_mud || ('Tipo: ' || COALESCE(CASE n.tipo WHEN 'tipico' THEN 'Típico' WHEN 'trajeto' THEN 'Trajeto' END, '—')); END IF;
    IF n.descricao IS DISTINCT FROM a.descricao THEN v_mud := v_mud || 'Descrição alterada'::text; END IF;
    IF n.houve_afastamento IS DISTINCT FROM a.houve_afastamento THEN
      v_mud := v_mud || ('Houve afastamento: ' || sn[n.houve_afastamento::int + 1]); END IF;
    IF n.dias_afastamento IS DISTINCT FROM a.dias_afastamento THEN
      v_mud := v_mud || ('Dias de afastamento: ' || COALESCE(a.dias_afastamento::text, '—') || ' → ' || COALESCE(n.dias_afastamento::text, '—')); END IF;
    IF n.encaminhado_inss IS DISTINCT FROM a.encaminhado_inss THEN
      v_mud := v_mud || ('Encaminhado ao INSS: ' || sn[n.encaminhado_inss::int + 1]); END IF;
    IF n.cat_emitida IS DISTINCT FROM a.cat_emitida THEN
      v_mud := v_mud || ('CAT emitida: ' || COALESCE(sn[n.cat_emitida::int + 1], 'não informado')); END IF;
    IF n.numero_cat IS DISTINCT FROM a.numero_cat THEN v_mud := v_mud || ('Nº da CAT: ' || COALESCE(n.numero_cat, '—')); END IF;
    IF n.cat_motivo_sem IS DISTINCT FROM a.cat_motivo_sem THEN v_mud := v_mud || 'Motivo de não emitir a CAT alterado'::text; END IF;
    IF n.morte_invalidez IS DISTINCT FROM a.morte_invalidez THEN
      v_mud := v_mud || ('Morte/invalidez: ' || sn[n.morte_invalidez::int + 1]); END IF;
    IF n.observacoes IS DISTINCT FROM a.observacoes THEN v_mud := v_mud || 'Observações alteradas'::text; END IF;
    IF cardinality(v_mud) > 0 THEN
      PERFORM public.sst_acidente_hist(v_id, CASE WHEN n.cpf IS DISTINCT FROM a.cpf THEN 'vinculo' ELSE 'alteracao' END,
                                       array_to_string(v_mud, '; ') || '.');
    END IF;
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_salvar(jsonb) TO authenticated;

-- Concluir confere as pendências; reabrir não. Editar um concluído continua
-- possível (fica no histórico): a conferência vale para o momento de fechar.
CREATE OR REPLACE FUNCTION public.sst_acidente_concluir(p_id bigint, p_concluir boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  a    public."SST_ACIDENTE"%ROWTYPE;
  v_p  text[];
BEGIN
  PERFORM public.sst_acidente_exige('alterar');
  SELECT * INTO a FROM public."SST_ACIDENTE" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acidente não encontrado.'; END IF;
  IF p_concluir THEN
    IF a.concluido THEN RETURN; END IF;
    v_p := public.sst_acidente_pendencias(p_id);
    IF cardinality(v_p) > 0 THEN
      RAISE EXCEPTION 'Para concluir, falta: %.', array_to_string(v_p, '; ');
    END IF;
    UPDATE public."SST_ACIDENTE" SET concluido = true, concluido_em = now(), concluido_por = public.sst_afa_nome_usuario() WHERE id = p_id;
    PERFORM public.sst_acidente_hist(p_id, 'conclusao', 'Acidente concluído.');
  ELSE
    IF NOT a.concluido THEN RETURN; END IF;
    UPDATE public."SST_ACIDENTE" SET concluido = false, concluido_em = NULL, concluido_por = NULL WHERE id = p_id;
    PERFORM public.sst_acidente_hist(p_id, 'reabertura', 'Acidente reaberto.');
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_concluir(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_concluir(bigint, boolean) TO authenticated;

-- Liga (ou desliga, p_afastamento_id NULL) um atestado ('atestado') ou um
-- caso do Controle de Afastamentos ('controle') da mesma pessoa. Ligar
-- marca "houve afastamento" e, se os dias estavam vazios, traz os dias de lá.
CREATE OR REPLACE FUNCTION public.sst_acidente_ligar_afastamento(p_id bigint, p_origem text, p_afastamento_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  a      public."SST_ACIDENTE"%ROWTYPE;
  v_dias integer;
  v_desc text;
BEGIN
  PERFORM public.sst_acidente_exige('alterar');
  IF p_origem NOT IN ('atestado', 'controle') THEN RAISE EXCEPTION 'Origem de afastamento inválida.'; END IF;
  SELECT * INTO a FROM public."SST_ACIDENTE" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acidente não encontrado.'; END IF;

  IF p_afastamento_id IS NULL THEN
    UPDATE public."SST_ACIDENTE" SET
      afastamento_id      = CASE WHEN p_origem = 'atestado' THEN NULL ELSE afastamento_id END,
      ctrl_afastamento_id = CASE WHEN p_origem = 'controle' THEN NULL ELSE ctrl_afastamento_id END
    WHERE id = p_id;
    PERFORM public.sst_acidente_hist(p_id, 'vinculo', 'Afastamento desligado do acidente.');
    RETURN;
  END IF;

  IF a.cpf IS NULL THEN RAISE EXCEPTION 'Ligue o registro a um colaborador antes.'; END IF;
  IF p_origem = 'atestado' THEN
    SELECT f.dias_considerados, 'atestado de ' || to_char(f.data_inicio, 'DD/MM/YYYY') || COALESCE(' (' || f.protocolo || ')', '')
      INTO v_dias, v_desc
      FROM public."SST_AFASTAMENTO" f
     WHERE f.id = p_afastamento_id AND regexp_replace(COALESCE(f.cpf, ''), '\D', '', 'g') = a.cpf;
  ELSE
    SELECT NULL::integer, 'caso do Controle de Afastamentos de ' || to_char(g.data_inicio, 'DD/MM/YYYY') || ' (' || g.motivo || ')'
      INTO v_dias, v_desc
      FROM public."SST_CTRL_AFASTAMENTO" g
     WHERE g.id = p_afastamento_id AND regexp_replace(COALESCE(g.cpf, ''), '\D', '', 'g') = a.cpf;
  END IF;
  IF v_desc IS NULL THEN RAISE EXCEPTION 'Afastamento não encontrado para este colaborador.'; END IF;

  UPDATE public."SST_ACIDENTE" SET
    afastamento_id      = CASE WHEN p_origem = 'atestado' THEN p_afastamento_id ELSE afastamento_id END,
    ctrl_afastamento_id = CASE WHEN p_origem = 'controle' THEN p_afastamento_id ELSE ctrl_afastamento_id END,
    houve_afastamento   = true,
    dias_afastamento    = COALESCE(dias_afastamento, v_dias)
  WHERE id = p_id;
  PERFORM public.sst_acidente_hist(p_id, 'vinculo', 'Ligado ao ' || v_desc
    || CASE WHEN a.dias_afastamento IS NULL AND v_dias IS NOT NULL THEN '; dias de afastamento: ' || v_dias ELSE '' END || '.');
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_ligar_afastamento(bigint, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_ligar_afastamento(bigint, text, bigint) TO authenticated;

-- Devolve os caminhos dos anexos: a tela apaga os arquivos do bucket depois.
CREATE OR REPLACE FUNCTION public.sst_acidente_excluir(p_id bigint)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_paths text[];
BEGIN
  PERFORM public.sst_acidente_exige('excluir');
  SELECT COALESCE(array_agg(d.storage_path), '{}') INTO v_paths FROM public."SST_ACIDENTE_DOC" d WHERE d.acidente_id = p_id;
  DELETE FROM public."SST_ACIDENTE" WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acidente não encontrado.'; END IF;
  RETURN v_paths;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_excluir(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_excluir(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_acidente_doc_registrar(p_id bigint, p_categoria text, p_nome text, p_path text,
                                                             p_tamanho bigint, p_tipo text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_doc bigint;
BEGIN
  PERFORM public.sst_acidente_exige('alterar');
  -- O caminho tem que estar na pasta deste acidente.
  IF COALESCE(p_path, '') NOT LIKE p_id::text || '/%' THEN
    RAISE EXCEPTION 'Arquivo fora da pasta do acidente #%.', p_id;
  END IF;
  IF COALESCE(p_categoria, '') NOT IN ('cat', 'outro') THEN RAISE EXCEPTION 'Categoria de anexo inválida.'; END IF;
  PERFORM 1 FROM public."SST_ACIDENTE" WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acidente não encontrado.'; END IF;
  INSERT INTO public."SST_ACIDENTE_DOC" (acidente_id, categoria, nome, storage_path, tamanho, tipo, enviado_por)
  VALUES (p_id, p_categoria, p_nome, p_path, p_tamanho, p_tipo, public.sst_afa_nome_usuario())
  RETURNING id INTO v_doc;
  PERFORM public.sst_acidente_hist(p_id, 'documento',
    CASE p_categoria WHEN 'cat' THEN 'CAT anexada: ' ELSE 'Anexo incluído: ' END || p_nome || '.');
  RETURN v_doc;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_doc_registrar(bigint, text, text, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_doc_registrar(bigint, text, text, text, bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_acidente_doc_remover(p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE d public."SST_ACIDENTE_DOC"%ROWTYPE;
BEGIN
  PERFORM public.sst_acidente_exige('alterar');
  DELETE FROM public."SST_ACIDENTE_DOC" WHERE id = p_id RETURNING * INTO d;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.sst_acidente_hist(d.acidente_id, 'documento',
    CASE d.categoria WHEN 'cat' THEN 'CAT removida: ' ELSE 'Anexo removido: ' END || d.nome || '.');
  RETURN d.storage_path;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_doc_remover(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_doc_remover(bigint) TO authenticated;

-- ── 7. Importação da planilha ────────────────────────────────────────────
-- A planilha é lida no navegador (lerPlanilhaAcidentes) e só as linhas vêm
-- para cá. A pessoa casa pelo NOME (a planilha não tem CPF): um CPF só →
-- ligado; nenhum ou homônimo → entra "sem vínculo". O contrato casa pelo
-- nome normalizado; sem casar, fica o texto da planilha.
--
-- O acidente antigo entra CONCLUÍDO — o caso já foi fechado fora do ERP, e
-- sem isso a tela abriria com 128 pendências (a planilha nem tem os dias de
-- afastamento). A exceção é "CAT: SIM" sem número: entra em aberto.
--
-- Chave: data + nome normalizado. Reimportar não duplica nem desfaz o que o
-- SST já corrigiu na tela. p_simular = true faz as mesmas contas sem gravar.
CREATE OR REPLACE FUNCTION public.sst_acidente_importar(p_linhas jsonb, p_simular boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r        record;
  v_id     bigint;
  v_chave  text;
  v_data   date;
  v_cpfs   text[];
  v_cpf    text;
  v_ct     uuid;
  v_aberto boolean;
  v_cri    int := 0;
  v_exist  int := 0;
  v_lig    int := 0;
  v_abe    int := 0;
  v_sem    jsonb := '[]'::jsonb;
  v_ctsem  text[] := '{}';
  v_err    jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.sst_acidente_exige('alterar');
  IF jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'A planilha não tem linhas para importar.';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_sst_acid_pessoas (cpf text, nome_norm text) ON COMMIT DROP;
  TRUNCATE tmp_sst_acid_pessoas;
  INSERT INTO tmp_sst_acid_pessoas
  SELECT p.cpf, public.sup_norm_nome(p.nome) FROM public.sst_toxico_pessoas() p
   WHERE p.nome IS NOT NULL AND p.nome NOT ILIKE '%teste%';

  FOR r IN SELECT l.x FROM jsonb_array_elements(p_linhas) AS l(x) LOOP
    BEGIN
      v_data := nullif(r.x->>'data_acidente', '')::date;
      IF v_data IS NULL THEN RAISE EXCEPTION 'sem data do acidente'; END IF;
      IF v_data > current_date THEN RAISE EXCEPTION 'data do acidente no futuro'; END IF;
      IF nullif(btrim(r.x->>'nome'), '') IS NULL THEN RAISE EXCEPTION 'sem nome'; END IF;
      v_chave := 'planilha:' || v_data::text || ':' || public.sup_norm_nome(r.x->>'nome');

      SELECT array_agg(DISTINCT t.cpf) INTO v_cpfs FROM tmp_sst_acid_pessoas t WHERE t.nome_norm = public.sup_norm_nome(r.x->>'nome');
      v_cpf := CASE WHEN cardinality(v_cpfs) = 1 THEN v_cpfs[1] END;
      IF v_cpf IS NULL THEN
        v_sem := v_sem || jsonb_build_object('linha', r.x->>'linha', 'nome', r.x->>'nome',
                                             'motivo', CASE WHEN cardinality(v_cpfs) > 1 THEN 'homonimo' ELSE 'nao_encontrado' END);
      ELSE
        v_lig := v_lig + 1;
      END IF;

      v_ct := NULL;
      IF nullif(btrim(r.x->>'contrato'), '') IS NOT NULL THEN
        SELECT c.id INTO v_ct FROM public.contratos c
         WHERE public.rh_norm_contrato(c.nome) = public.rh_norm_contrato(r.x->>'contrato')
         ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC LIMIT 1;
        IF v_ct IS NULL THEN
          SELECT d.contrato_id INTO v_ct FROM public.sup_empregado_contrato_depara d
           WHERE public.rh_norm_contrato(d.filial_nome) = public.rh_norm_contrato(r.x->>'contrato')
           ORDER BY d.contrato_id LIMIT 1;
        END IF;
        IF v_ct IS NULL AND NOT (btrim(r.x->>'contrato') = ANY (v_ctsem)) THEN v_ctsem := v_ctsem || btrim(r.x->>'contrato'); END IF;
      END IF;

      v_aberto := COALESCE((r.x->>'cat_emitida')::boolean, false) AND nullif(btrim(r.x->>'numero_cat'), '') IS NULL;

      IF p_simular THEN
        IF EXISTS (SELECT 1 FROM public."SST_ACIDENTE" WHERE chave_importacao = v_chave) THEN v_exist := v_exist + 1;
        ELSE v_cri := v_cri + 1; IF v_aberto THEN v_abe := v_abe + 1; END IF; END IF;
        CONTINUE;
      END IF;

      v_id := NULL;
      INSERT INTO public."SST_ACIDENTE" (cpf, nome, empresa, contrato_id, contrato_texto, data_acidente, tipo, descricao,
        houve_afastamento, encaminhado_inss, cat_emitida, numero_cat, morte_invalidez, observacoes,
        concluido, concluido_em, concluido_por, origem, chave_importacao, created_by, created_by_nome)
      VALUES (v_cpf, btrim(r.x->>'nome'), nullif(btrim(r.x->>'empresa'), ''), v_ct, nullif(btrim(r.x->>'contrato'), ''), v_data,
        nullif(r.x->>'tipo', ''), nullif(btrim(r.x->>'descricao'), ''),
        COALESCE((r.x->>'houve_afastamento')::boolean, false),
        COALESCE((r.x->>'houve_afastamento')::boolean, false) AND COALESCE((r.x->>'encaminhado_inss')::boolean, false),
        (r.x->>'cat_emitida')::boolean, nullif(btrim(r.x->>'numero_cat'), ''),
        COALESCE((r.x->>'morte_invalidez')::boolean, false), nullif(btrim(r.x->>'observacoes'), ''),
        NOT v_aberto, CASE WHEN NOT v_aberto THEN now() END, CASE WHEN NOT v_aberto THEN 'Importação da planilha' END,
        'planilha', v_chave, auth.uid(), public.sst_afa_nome_usuario())
      ON CONFLICT (chave_importacao) DO NOTHING
      RETURNING id INTO v_id;

      IF v_id IS NULL THEN
        v_exist := v_exist + 1;
      ELSE
        v_cri := v_cri + 1;
        IF v_aberto THEN v_abe := v_abe + 1; END IF;
        PERFORM public.sst_acidente_hist(v_id, 'importacao', 'Importado da planilha (linha ' || COALESCE(r.x->>'linha', '?') || ')'
          || CASE WHEN v_cpf IS NULL THEN '; colaborador sem vínculo' ELSE '' END
          || CASE WHEN v_aberto THEN '; em aberto: CAT marcada SIM sem número' ELSE '' END || '.');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err || jsonb_build_object('linha', r.x->>'linha', 'nome', r.x->>'nome', 'erro', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('simulado', p_simular, 'criados', v_cri, 'ja_existiam', v_exist, 'ligados', v_lig,
                            'em_aberto', v_abe, 'sem_vinculo', v_sem, 'contratos_sem_casar', to_jsonb(v_ctsem), 'erros', v_err);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_acidente_importar(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_acidente_importar(jsonb, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.sst_acidente_importar(jsonb, boolean), public.sst_acidente_doc_remover(bigint),
--   public.sst_acidente_doc_registrar(bigint, text, text, text, bigint, text), public.sst_acidente_excluir(bigint),
--   public.sst_acidente_ligar_afastamento(bigint, text, bigint), public.sst_acidente_concluir(bigint, boolean),
--   public.sst_acidente_salvar(jsonb), public.sst_acidentes_do_colaborador(bigint), public.sst_acidente_contratos(),
--   public.sst_acidente_sugestao(bigint), public.sst_acidente_colaboradores(text), public.sst_acidente_ficha(bigint),
--   public.sst_acidentes_lista(), public.sst_acidente_pessoa(bigint), public.sst_acidente_pendencias(bigint),
--   public.sst_acidente_hist(bigint, text, text);
-- DROP POLICY IF EXISTS "sst acidentes select" ON storage.objects;
-- DROP POLICY IF EXISTS "sst acidentes insert" ON storage.objects;
-- DROP POLICY IF EXISTS "sst acidentes delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'sst-acidentes';   -- só vazio
-- DROP TABLE IF EXISTS public."SST_ACIDENTE_DOC", public."SST_ACIDENTE_HISTORICO", public."SST_ACIDENTE";
-- DROP FUNCTION IF EXISTS public.sst_acidente_empresa(text), public.sst_acidente_exige(text), public.sst_acidente_pode(text);
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'sst_acidentes_trabalho';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sst_acidentes_trabalho';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sst_acidentes_trabalho';
-- DELETE FROM public.app_menu      WHERE codigo      = 'sst_acidentes_trabalho';
-- NOTIFY pgrst, 'reload schema';
