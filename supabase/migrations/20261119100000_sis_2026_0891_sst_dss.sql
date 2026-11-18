-- =========================================================================
-- SIS-2026-0891: DSS — DIÁLOGO SEMANAL DE SEGURANÇA (18/11/2026)
--
-- CHAMADO (Milena, SST): o DSS é escrito toda semana pelo SST e vai para os
-- encarregados, que imprimem, fazem a conversa e devolvem a folha assinada.
-- Com ~58 contratos ninguém sabe quem recebeu nem quais contratos fazem o
-- DSS. Pedido: o colaborador lê e assina no ERP; o SST acompanha por pessoa,
-- por contrato e por período.
--
-- DESENHO (decidido com o Eduardo em 18/11)
--   • O colaborador lê e assina no PORTAL DO COLABORADOR (/colaborador): a
--     sessão própria do portal (mig 20260930000196) já identifica a pessoa;
--     a assinatura é a declaração "li e estou ciente" + data/hora, IP,
--     aparelho e um hash. SEM senha pessoal: só 30 dos ~2.450 ativos têm uma
--     (os outros entram com o CPF) — exigir a senha, como a Entrega de EPI
--     (mig 20261117210000), deixaria 98% sem conseguir assinar.
--   • Público = contratos escolhidos pelo SST (ou todos). Contrato da pessoa
--     é EMPREGADOS ("Empresa", "Filial") → "CONTRATOS" — a mesma chave dos
--     Treinamentos por Contrato (mig 20261104006000). Os destinatários são
--     calculados NA HORA (quem entra no contrato enquanto o DSS vale também
--     recebe); quem já acessou/assinou fica gravado com cópia do contrato.
--   • Quem não tem celular continua no papel: o SST anexa a folha assinada
--     do contrato e marca quem assinou (origem = 'papel').
--
-- TABELAS
--   SST_DSS           o DSS (tema, texto, anexo, semana, vigência, situação).
--                     Depois de publicado o conteúdo NÃO muda (a assinatura
--                     prova ciência de um texto fixo; conteudo_hash gravado
--                     na publicação). Corrigir = encerrar e publicar outro.
--   SST_DSS_CONTRATO  contratos-alvo (quando não é "todos").
--   SST_DSS_CIENCIA   1 linha por DSS × pessoa: acesso e assinatura. Só
--                     avança (não acessado → acessado → assinado); não apaga.
--   SST_DSS_FOLHA     folha em papel anexada pelo SST. Imutável.
--   Bucket PRIVADO sst-dss: dss/<id>/… (conteúdo) e folhas/<id>/… (papel).
--
-- ACESSO — menu novo `treinamentos_dss` (/app/treinamentos/dss), módulo
-- Treinamentos. Nasce PENDENTE (SIS-0931): liberar em Novos Módulos. Ações:
-- visualizar = painel e relatórios; incluir = criar/publicar; alterar =
-- encerrar e lançar folha em papel; exportar = planilha. Acesso preparado:
-- quem já tem `sst_acidentes_trabalho` (a equipe do SST).
-- O portal só alcança as RPCs col_dss_* pela Edge Function colaborador-portal
-- (service_role); EXECUTE revogado de anon e authenticated.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menu e acesso preparado ──────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'treinamentos_dss', 'DSS – Diálogo Semanal de Segurança', '/app/treinamentos/dss',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
FROM public.app_modulo m WHERE m.codigo = 'treinamentos'
AND NOT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = 'treinamentos_dss');

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'treinamentos_dss', a::public.app_acao
  FROM unnest(ARRAY['visualizar','incluir','alterar','exportar']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- Quem vê os acidentes vê e exporta o DSS; quem altera os acidentes cria,
-- publica e lança papel no DSS.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT p.perfil_id, 'treinamentos_dss', m.destino::public.app_acao, true
  FROM public.perfil_acesso_permissao p
  JOIN (VALUES ('visualizar','visualizar'), ('visualizar','exportar'), ('alterar','incluir'), ('alterar','alterar')) m(origem, destino)
    ON p.acao::text = m.origem
 WHERE p.menu_codigo = 'sst_acidentes_trabalho' AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT p.user_id, 'treinamentos_dss', m.destino::public.app_acao, true, 'SIS-2026-0891: acesso SST ao DSS'
  FROM public.screen_permission_user p
  JOIN (VALUES ('visualizar','visualizar'), ('visualizar','exportar'), ('alterar','incluir'), ('alterar','alterar')) m(origem, destino)
    ON p.acao::text = m.origem
 WHERE p.menu_codigo = 'sst_acidentes_trabalho' AND p.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = p.user_id AND x.menu_codigo = 'treinamentos_dss' AND x.acao::text = m.destino);

CREATE OR REPLACE FUNCTION public.sst_dss_acesso(_acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND public.has_screen_access(auth.uid(), 'treinamentos_dss', _acao::public.app_acao)
$fn$;
REVOKE ALL ON FUNCTION public.sst_dss_acesso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_dss_acesso(text) TO authenticated;

-- ── 2) Tabelas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SST_DSS" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tema             text NOT NULL CHECK (btrim(tema) <> ''),
  conteudo         text NOT NULL DEFAULT '',
  arquivo_path     text,
  arquivo_nome     text,
  semana_ref       date NOT NULL,
  disponivel_de    date NOT NULL,
  disponivel_ate   date,
  situacao         text NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho', 'publicado', 'encerrado')),
  todos_contratos  boolean NOT NULL DEFAULT false,
  conteudo_hash    text,
  publicado_em     timestamptz,
  publicado_por    uuid,
  encerrado_em     timestamptz,
  encerrado_por    uuid,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_dss_vigencia CHECK (disponivel_ate IS NULL OR disponivel_ate >= disponivel_de),
  CONSTRAINT sst_dss_publicado_hash CHECK (situacao = 'rascunho' OR (conteudo_hash IS NOT NULL AND publicado_em IS NOT NULL)),
  CONSTRAINT sst_dss_tem_conteudo CHECK (btrim(conteudo) <> '' OR arquivo_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_sst_dss_semana ON public."SST_DSS" (semana_ref DESC);
CREATE INDEX IF NOT EXISTS idx_sst_dss_vigentes ON public."SST_DSS" (disponivel_de) WHERE situacao = 'publicado';

CREATE TABLE IF NOT EXISTS public."SST_DSS_CONTRATO" (
  dss_id         uuid NOT NULL REFERENCES public."SST_DSS"(id) ON DELETE CASCADE,
  empresa        bigint NOT NULL,
  filial         bigint NOT NULL,
  contrato_nome  text NOT NULL,
  PRIMARY KEY (dss_id, empresa, filial)
);

CREATE TABLE IF NOT EXISTS public."SST_DSS_FOLHA" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dss_id        uuid NOT NULL REFERENCES public."SST_DSS"(id) ON DELETE RESTRICT,
  empresa       bigint NOT NULL,
  filial        bigint NOT NULL,
  contrato_nome text NOT NULL,
  storage_path  text NOT NULL UNIQUE,
  arquivo_nome  text,
  anexado_por   uuid NOT NULL,
  anexado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sst_dss_folha_dss ON public."SST_DSS_FOLHA" (dss_id, empresa, filial);

CREATE TABLE IF NOT EXISTS public."SST_DSS_CIENCIA" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dss_id           uuid NOT NULL REFERENCES public."SST_DSS"(id) ON DELETE RESTRICT,
  empregado_id     bigint NOT NULL,
  cpf              text,
  nome             text NOT NULL,
  matricula        text,
  cargo            text,
  empresa          bigint NOT NULL,
  filial           bigint NOT NULL,
  empresa_nome     text,
  contrato_nome    text NOT NULL,
  acessado_em      timestamptz,
  assinado_em      timestamptz,
  assinatura_hash  text,
  origem           text CHECK (origem IN ('portal', 'papel')),
  folha_id         uuid REFERENCES public."SST_DSS_FOLHA"(id) ON DELETE RESTRICT,
  registrado_por   uuid,
  ip               text,
  dispositivo      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_dss_ciencia_unica UNIQUE (dss_id, empregado_id),
  CONSTRAINT sst_dss_ciencia_par CHECK ((assinado_em IS NULL) = (assinatura_hash IS NULL) AND (assinado_em IS NULL) = (origem IS NULL)),
  CONSTRAINT sst_dss_ciencia_papel CHECK (origem IS DISTINCT FROM 'papel' OR folha_id IS NOT NULL),
  CONSTRAINT sst_dss_ciencia_portal CHECK (origem IS DISTINCT FROM 'portal' OR acessado_em IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_sst_dss_ciencia_contrato ON public."SST_DSS_CIENCIA" (dss_id, empresa, filial);
CREATE INDEX IF NOT EXISTS idx_sst_dss_ciencia_emp ON public."SST_DSS_CIENCIA" (empregado_id, dss_id);

-- ── 3) Imutabilidade ────────────────────────────────────────────────────
-- DSS publicado: conteúdo, público e semana congelados. Só pode encerrar
-- (publicado → encerrado) e mexer no fim da vigência. Apagar, só rascunho.
CREATE OR REPLACE FUNCTION public.sst_dss_guarda()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.situacao <> 'rascunho' THEN RAISE EXCEPTION 'DSS publicado não pode ser excluído'; END IF;
    RETURN OLD;
  END IF;
  NEW.updated_at := now();
  IF OLD.situacao = 'rascunho' THEN RETURN NEW; END IF;
  IF OLD.situacao = 'encerrado' AND NEW.situacao <> 'encerrado' THEN
    RAISE EXCEPTION 'DSS encerrado não volta a valer — publique um novo';
  END IF;
  IF (to_jsonb(NEW) - 'situacao' - 'disponivel_ate' - 'encerrado_em' - 'encerrado_por' - 'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'situacao' - 'disponivel_ate' - 'encerrado_em' - 'encerrado_por' - 'updated_at')
     OR NEW.situacao = 'rascunho' THEN
    RAISE EXCEPTION 'DSS publicado não pode ser alterado — encerre e publique um novo';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_sst_dss_guarda ON public."SST_DSS";
CREATE TRIGGER trg_sst_dss_guarda BEFORE UPDATE OR DELETE ON public."SST_DSS"
FOR EACH ROW EXECUTE FUNCTION public.sst_dss_guarda();

-- O público só muda enquanto o DSS é rascunho. O CASCADE de apagar um
-- rascunho passa (o pai ainda é rascunho quando o filho sai).
CREATE OR REPLACE FUNCTION public.sst_dss_contrato_guarda()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_situacao text;
BEGIN
  SELECT situacao INTO v_situacao FROM public."SST_DSS" WHERE id = COALESCE(NEW.dss_id, OLD.dss_id);
  IF v_situacao IS NOT NULL AND v_situacao <> 'rascunho' THEN
    RAISE EXCEPTION 'Os contratos de um DSS publicado não mudam';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
DROP TRIGGER IF EXISTS trg_sst_dss_contrato_guarda ON public."SST_DSS_CONTRATO";
CREATE TRIGGER trg_sst_dss_contrato_guarda BEFORE INSERT OR UPDATE OR DELETE ON public."SST_DSS_CONTRATO"
FOR EACH ROW EXECUTE FUNCTION public.sst_dss_contrato_guarda();

-- Ciência só avança: o acesso grava uma vez; a assinatura grava uma vez;
-- identidade e contrato copiados nunca mudam. Nada se apaga.
CREATE OR REPLACE FUNCTION public.sst_dss_ciencia_guarda()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Registro de ciência do DSS não pode ser excluído'; END IF;
  IF OLD.acessado_em IS NOT NULL AND NEW.acessado_em IS DISTINCT FROM OLD.acessado_em THEN
    RAISE EXCEPTION 'Data de acesso ao DSS não pode ser alterada';
  END IF;
  IF OLD.assinado_em IS NOT NULL AND
     (NEW.assinado_em, NEW.assinatura_hash, NEW.origem, NEW.folha_id, NEW.registrado_por, NEW.ip, NEW.dispositivo)
     IS DISTINCT FROM
     (OLD.assinado_em, OLD.assinatura_hash, OLD.origem, OLD.folha_id, OLD.registrado_por, OLD.ip, OLD.dispositivo) THEN
    RAISE EXCEPTION 'Assinatura do DSS não pode ser alterada';
  END IF;
  IF (to_jsonb(NEW) - 'acessado_em' - 'assinado_em' - 'assinatura_hash' - 'origem' - 'folha_id' - 'registrado_por' - 'ip' - 'dispositivo') IS DISTINCT FROM
     (to_jsonb(OLD) - 'acessado_em' - 'assinado_em' - 'assinatura_hash' - 'origem' - 'folha_id' - 'registrado_por' - 'ip' - 'dispositivo') THEN
    RAISE EXCEPTION 'Registro de ciência do DSS não pode ser alterado';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_sst_dss_ciencia_guarda ON public."SST_DSS_CIENCIA";
CREATE TRIGGER trg_sst_dss_ciencia_guarda BEFORE UPDATE OR DELETE ON public."SST_DSS_CIENCIA"
FOR EACH ROW EXECUTE FUNCTION public.sst_dss_ciencia_guarda();

CREATE OR REPLACE FUNCTION public.sst_dss_folha_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'Folha de DSS não pode ser alterada ou excluída'; END $fn$;
DROP TRIGGER IF EXISTS trg_sst_dss_folha_imutavel ON public."SST_DSS_FOLHA";
CREATE TRIGGER trg_sst_dss_folha_imutavel BEFORE UPDATE OR DELETE ON public."SST_DSS_FOLHA"
FOR EACH ROW EXECUTE FUNCTION public.sst_dss_folha_imutavel();

-- ── 4) RLS: leitura pelo menu; escrita só pelas RPCs ─────────────────────
ALTER TABLE public."SST_DSS" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SST_DSS_CONTRATO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SST_DSS_CIENCIA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SST_DSS_FOLHA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SST_DSS", public."SST_DSS_CONTRATO", public."SST_DSS_CIENCIA", public."SST_DSS_FOLHA"
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public."SST_DSS", public."SST_DSS_CONTRATO", public."SST_DSS_CIENCIA", public."SST_DSS_FOLHA" TO authenticated;

DROP POLICY IF EXISTS sst_dss_select ON public."SST_DSS";
CREATE POLICY sst_dss_select ON public."SST_DSS" FOR SELECT TO authenticated
  USING ((SELECT public.sst_dss_acesso('visualizar')));
DROP POLICY IF EXISTS sst_dss_contrato_select ON public."SST_DSS_CONTRATO";
CREATE POLICY sst_dss_contrato_select ON public."SST_DSS_CONTRATO" FOR SELECT TO authenticated
  USING ((SELECT public.sst_dss_acesso('visualizar')));
DROP POLICY IF EXISTS sst_dss_ciencia_select ON public."SST_DSS_CIENCIA";
CREATE POLICY sst_dss_ciencia_select ON public."SST_DSS_CIENCIA" FOR SELECT TO authenticated
  USING ((SELECT public.sst_dss_acesso('visualizar')));
DROP POLICY IF EXISTS sst_dss_folha_select ON public."SST_DSS_FOLHA";
CREATE POLICY sst_dss_folha_select ON public."SST_DSS_FOLHA" FOR SELECT TO authenticated
  USING ((SELECT public.sst_dss_acesso('visualizar')));

-- ── 5) Storage (privado) ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sst-dss', 'sst-dss', false, 10485760) -- 10 MB
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "sst dss ler" ON storage.objects;
CREATE POLICY "sst dss ler" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sst-dss' AND (SELECT public.sst_dss_acesso('visualizar')));
DROP POLICY IF EXISTS "sst dss anexar" ON storage.objects;
CREATE POLICY "sst dss anexar" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sst-dss' AND (
    (split_part(name, '/', 1) = 'dss' AND (SELECT public.sst_dss_acesso('incluir')))
    OR (split_part(name, '/', 1) = 'folhas' AND (SELECT public.sst_dss_acesso('alterar')))));
-- Outras policies globais de Storage não podem autorizar troca nem exclusão.
DROP POLICY IF EXISTS "sst dss sem update" ON storage.objects;
CREATE POLICY "sst dss sem update" ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'sst-dss') WITH CHECK (bucket_id <> 'sst-dss');
DROP POLICY IF EXISTS "sst dss sem delete" ON storage.objects;
CREATE POLICY "sst dss sem delete" ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'sst-dss');

-- ── 6) Regras comuns ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_dss_hoje()
RETURNS date LANGUAGE sql STABLE AS $fn$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $fn$;

-- Vale hoje = publicado e dentro da vigência.
CREATE OR REPLACE FUNCTION public.sst_dss_vigente(_d public."SST_DSS")
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT _d.situacao = 'publicado' AND _d.disponivel_de <= public.sst_dss_hoje()
     AND (_d.disponivel_ate IS NULL OR _d.disponivel_ate >= public.sst_dss_hoje())
$fn$;

-- Último dia em que o DSS valeu (ou hoje, se ainda vale). Quem foi admitido
-- depois disso nunca teve como assinar e não conta como pendente.
CREATE OR REPLACE FUNCTION public.sst_dss_fim(_d public."SST_DSS")
RETURNS date LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT least(COALESCE(_d.disponivel_ate, public.sst_dss_hoje()),
               COALESCE((_d.encerrado_em AT TIME ZONE 'America/Sao_Paulo')::date, public.sst_dss_hoje()),
               public.sst_dss_hoje())
$fn$;

CREATE OR REPLACE FUNCTION public.sst_dss_alvo(_dss uuid, _todos boolean, _empresa bigint, _filial bigint)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT _todos OR EXISTS (SELECT 1 FROM public."SST_DSS_CONTRATO" k
                            WHERE k.dss_id = _dss AND k.empresa = _empresa AND k.filial = _filial)
$fn$;

CREATE OR REPLACE FUNCTION public.sst_dss_nome_contrato(_empresa bigint, _filial bigint, _reserva text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((SELECT k."NOME CONTRATO"::text FROM public."CONTRATOS" k
                    WHERE k."Empresa" = _empresa AND k."Filial" = _filial
                    ORDER BY (k."ATIVO" = 'SIM') DESC LIMIT 1),
                  NULLIF(btrim(_reserva), ''), 'Empresa ' || _empresa || ' / Filial ' || _filial)
$fn$;

REVOKE ALL ON FUNCTION public.sst_dss_vigente(public."SST_DSS"), public.sst_dss_fim(public."SST_DSS"),
  public.sst_dss_alvo(uuid, boolean, bigint, bigint), public.sst_dss_nome_contrato(bigint, bigint, text) FROM PUBLIC, anon;

-- Destinatários de um conjunto de DSS: quem já tem ciência registrada (com o
-- contrato copiado) + os ativos de hoje no público que ainda não têm, desde
-- que admitidos até o fim da vigência. Demitido que assinou continua; demitido
-- que não assinou sai da conta.
CREATE OR REPLACE FUNCTION public.sst_dss_destinatarios(_dss uuid[])
RETURNS TABLE (dss_id uuid, empregado_id bigint, nome text, matricula text, cargo text, cpf text,
               empresa bigint, filial bigint, contrato_nome text,
               acessado_em timestamptz, assinado_em timestamptz, origem text, folha_id uuid, assinatura_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH d AS NOT MATERIALIZED (
    SELECT x.*, public.sst_dss_fim(x) AS fim FROM public."SST_DSS" x
     WHERE x.id = ANY(_dss) AND x.situacao <> 'rascunho'
  )
  SELECT c.dss_id, c.empregado_id, c.nome, c.matricula, c.cargo, c.cpf, c.empresa, c.filial, c.contrato_nome,
         c.acessado_em, c.assinado_em, c.origem, c.folha_id, c.assinatura_hash
    FROM public."SST_DSS_CIENCIA" c JOIN d ON d.id = c.dss_id
  UNION ALL
  SELECT d.id, e."ID", e."Nome"::text, NULLIF(btrim(e."Cadastro"::text), ''),
         COALESCE(NULLIF(e."Título do Cargo", ''), NULLIF(e."Nome do Cargo", ''), e."Cargo"::text),
         e."CPF"::text, e."Empresa", e."Filial",
         public.sst_dss_nome_contrato(e."Empresa", e."Filial", e."Nome Filial"),
         NULL, NULL, NULL, NULL, NULL
    FROM d JOIN public."EMPREGADOS" e
      ON NOT public.col_desligado(e."Situação")
     AND e."Empresa" IS NOT NULL AND e."Filial" IS NOT NULL
     AND public.sst_dss_alvo(d.id, d.todos_contratos, e."Empresa", e."Filial")
     AND COALESCE(public.rh_data(e."Admissão"::text), d.fim) <= d.fim
   WHERE NOT EXISTS (SELECT 1 FROM public."SST_DSS_CIENCIA" c WHERE c.dss_id = d.id AND c.empregado_id = e."ID")
$fn$;
REVOKE ALL ON FUNCTION public.sst_dss_destinatarios(uuid[]) FROM PUBLIC, anon, authenticated;

-- ── 7) Portal do Colaborador (só service_role; p_emp vem da sessão) ──────
-- O DSS é visível para a pessoa se ela já tem ciência registrada (histórico)
-- ou se ele vale hoje para o contrato dela e ela não está desligada.
CREATE OR REPLACE FUNCTION public.col_dss_visivel(p_emp bigint, p_dss uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public."SST_DSS_CIENCIA" c WHERE c.dss_id = p_dss AND c.empregado_id = p_emp)
      OR EXISTS (SELECT 1 FROM public."SST_DSS" d JOIN public."EMPREGADOS" e ON e."ID" = p_emp
                  WHERE d.id = p_dss AND public.sst_dss_vigente(d)
                    AND NOT public.col_desligado(e."Situação")
                    AND public.sst_dss_alvo(d.id, d.todos_contratos, e."Empresa", e."Filial"))
$fn$;
REVOKE ALL ON FUNCTION public.col_dss_visivel(bigint, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.col_dss_lista(p_emp bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH e AS (SELECT x."Empresa", x."Filial", public.col_desligado(x."Situação") AS desligado
               FROM public."EMPREGADOS" x WHERE x."ID" = p_emp)
  SELECT COALESCE(jsonb_agg(s.obj ORDER BY s.semana_ref DESC, s.publicado_em DESC), '[]'::jsonb)
  FROM (SELECT jsonb_build_object(
                 'id', d.id, 'tema', d.tema, 'semana_ref', d.semana_ref,
                 'disponivel_de', d.disponivel_de, 'disponivel_ate', d.disponivel_ate,
                 'vigente', public.sst_dss_vigente(d), 'tem_arquivo', d.arquivo_path IS NOT NULL,
                 'acessado_em', c.acessado_em, 'assinado_em', c.assinado_em, 'origem', c.origem,
                 'assinatura_hash', c.assinatura_hash) AS obj,
               d.semana_ref, d.publicado_em
          FROM public."SST_DSS" d
          LEFT JOIN public."SST_DSS_CIENCIA" c ON c.dss_id = d.id AND c.empregado_id = p_emp
          CROSS JOIN e
         WHERE d.situacao <> 'rascunho'
           AND (c.id IS NOT NULL OR (public.sst_dss_vigente(d) AND NOT e.desligado
                AND public.sst_dss_alvo(d.id, d.todos_contratos, e."Empresa", e."Filial")))
         ORDER BY d.semana_ref DESC, d.publicado_em DESC LIMIT 100) s
$fn$;
REVOKE ALL ON FUNCTION public.col_dss_lista(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_dss_lista(bigint) TO service_role;

-- Abrir = registrar o primeiro acesso (com cópia da pessoa e do contrato) e
-- devolver o conteúdo. DSS que já não vale abre só para quem tem ciência.
CREATE OR REPLACE FUNCTION public.col_dss_abrir(p_emp bigint, p_dss uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_d public."SST_DSS"%ROWTYPE; v_c public."SST_DSS_CIENCIA"%ROWTYPE;
BEGIN
  IF p_dss IS NULL OR NOT public.col_dss_visivel(p_emp, p_dss) THEN
    RAISE EXCEPTION 'DSS não encontrado para você';
  END IF;
  SELECT * INTO v_d FROM public."SST_DSS" WHERE id = p_dss;
  SELECT * INTO v_c FROM public."SST_DSS_CIENCIA" WHERE dss_id = p_dss AND empregado_id = p_emp FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public."SST_DSS_CIENCIA" (dss_id, empregado_id, cpf, nome, matricula, cargo, empresa, filial,
                                          empresa_nome, contrato_nome, acessado_em)
    SELECT p_dss, e."ID", public.col_digitos(e."CPF"), e."Nome", NULLIF(btrim(e."Cadastro"::text), ''),
           COALESCE(NULLIF(e."Título do Cargo", ''), NULLIF(e."Nome do Cargo", ''), e."Cargo"::text),
           e."Empresa", e."Filial", e."Nome da Empresa",
           public.sst_dss_nome_contrato(e."Empresa", e."Filial", e."Nome Filial"), now()
      FROM public."EMPREGADOS" e WHERE e."ID" = p_emp
    ON CONFLICT (dss_id, empregado_id) DO NOTHING;
    SELECT * INTO v_c FROM public."SST_DSS_CIENCIA" WHERE dss_id = p_dss AND empregado_id = p_emp;
  ELSIF v_c.acessado_em IS NULL THEN
    -- Assinou no papel e agora abriu pelo portal: registra o acesso também.
    UPDATE public."SST_DSS_CIENCIA" SET acessado_em = now() WHERE id = v_c.id RETURNING * INTO v_c;
  END IF;
  RETURN jsonb_build_object(
    'id', v_d.id, 'tema', v_d.tema, 'conteudo', v_d.conteudo, 'semana_ref', v_d.semana_ref,
    'disponivel_de', v_d.disponivel_de, 'disponivel_ate', v_d.disponivel_ate,
    'vigente', public.sst_dss_vigente(v_d), 'tem_arquivo', v_d.arquivo_path IS NOT NULL,
    'arquivo_nome', v_d.arquivo_nome, 'contrato', v_c.contrato_nome,
    'acessado_em', v_c.acessado_em, 'assinado_em', v_c.assinado_em, 'origem', v_c.origem,
    'assinatura_hash', v_c.assinatura_hash);
END $fn$;
REVOKE ALL ON FUNCTION public.col_dss_abrir(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_dss_abrir(bigint, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.col_dss_arquivo_path(p_emp bigint, p_dss uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT d.arquivo_path FROM public."SST_DSS" d
   WHERE d.id = p_dss AND d.situacao <> 'rascunho' AND public.col_dss_visivel(p_emp, p_dss)
$fn$;
REVOKE ALL ON FUNCTION public.col_dss_arquivo_path(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_dss_arquivo_path(bigint, uuid) TO service_role;

-- Assinar exige ter aberto o DSS (o acesso é gravado no abrir) e o DSS valer
-- hoje. Repetir devolve a assinatura que já existe.
CREATE OR REPLACE FUNCTION public.col_dss_assinar(p_emp bigint, p_dss uuid, p_ip text, p_ua text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE v_d public."SST_DSS"%ROWTYPE; v_c public."SST_DSS_CIENCIA"%ROWTYPE; v_agora timestamptz := now(); v_hash text;
BEGIN
  SELECT * INTO v_c FROM public."SST_DSS_CIENCIA" WHERE dss_id = p_dss AND empregado_id = p_emp FOR UPDATE;
  IF NOT FOUND OR v_c.acessado_em IS NULL THEN RAISE EXCEPTION 'Abra e leia o DSS antes de assinar'; END IF;
  IF v_c.assinado_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'assinado_em', v_c.assinado_em, 'hash', v_c.assinatura_hash, 'origem', v_c.origem);
  END IF;
  SELECT * INTO v_d FROM public."SST_DSS" WHERE id = p_dss;
  IF NOT public.sst_dss_vigente(v_d) THEN RAISE EXCEPTION 'Este DSS não está mais disponível para assinatura'; END IF;
  v_hash := encode(digest(v_d.id::text || p_emp::text || v_d.conteudo_hash || v_agora::text || 'dss-declaracao-v1', 'sha256'), 'hex');
  UPDATE public."SST_DSS_CIENCIA"
     SET assinado_em = v_agora, assinatura_hash = v_hash, origem = 'portal',
         ip = left(p_ip, 100), dispositivo = left(p_ua, 300)
   WHERE id = v_c.id;
  RETURN jsonb_build_object('ok', true, 'assinado_em', v_agora, 'hash', v_hash, 'origem', 'portal');
END $fn$;
REVOKE ALL ON FUNCTION public.col_dss_assinar(bigint, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_dss_assinar(bigint, uuid, text, text) TO service_role;

-- ── 8) SST (authenticated; cada RPC confere a ação uma vez) ──────────────
-- Contratos ativos para escolher o público, com quantos ativos cada um tem.
CREATE OR REPLACE FUNCTION public.sst_dss_contratos()
RETURNS TABLE (empresa bigint, filial bigint, nome text, colaboradores bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.sst_dss_acesso('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao DSS.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH e AS (
    SELECT x."Empresa" AS empresa, x."Filial" AS filial, count(*) AS n, max(x."Nome Filial"::text) AS nome_filial
      FROM public."EMPREGADOS" x
     WHERE NOT public.col_desligado(x."Situação") AND x."Empresa" IS NOT NULL AND x."Filial" IS NOT NULL
     GROUP BY 1, 2
  ), c AS (
    SELECT DISTINCT ON (k."Empresa", k."Filial") k."Empresa"::bigint AS empresa, k."Filial"::bigint AS filial,
           k."NOME CONTRATO"::text AS nome, (k."ATIVO" = 'SIM') AS ativo
      FROM public."CONTRATOS" k
     WHERE k."Empresa" IS NOT NULL AND k."Filial" IS NOT NULL
     ORDER BY k."Empresa", k."Filial", (k."ATIVO" = 'SIM') DESC
  )
  SELECT COALESCE(c.empresa, e.empresa), COALESCE(c.filial, e.filial),
         COALESCE(c.nome, NULLIF(btrim(e.nome_filial), ''), 'Empresa ' || e.empresa || ' / Filial ' || e.filial),
         COALESCE(e.n, 0)
    FROM c FULL JOIN e ON e.empresa = c.empresa AND e.filial = c.filial
   WHERE COALESCE(c.ativo, false) OR e.n IS NOT NULL
   ORDER BY 3;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_dss_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_dss_contratos() TO authenticated;

-- Cria/edita o rascunho (o id vem do navegador para o anexo já subir em
-- dss/<id>/…) e, com p_publicar, publica: grava o hash do conteúdo e congela.
CREATE OR REPLACE FUNCTION public.sst_dss_salvar(
  p_id uuid, p_tema text, p_conteudo text, p_arquivo_path text, p_arquivo_nome text,
  p_semana_ref date, p_disponivel_de date, p_disponivel_ate date,
  p_todos_contratos boolean, p_contratos jsonb, p_publicar boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE v_situacao text; v_n int;
BEGIN
  IF NOT public.sst_dss_acesso('incluir') THEN
    RAISE EXCEPTION 'Sem permissão para criar DSS.' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'Identificador do DSS ausente'; END IF;
  IF NULLIF(btrim(COALESCE(p_tema, '')), '') IS NULL THEN RAISE EXCEPTION 'Informe o tema do DSS'; END IF;
  IF NULLIF(btrim(COALESCE(p_conteudo, '')), '') IS NULL AND p_arquivo_path IS NULL THEN
    RAISE EXCEPTION 'Escreva o conteúdo ou anexe o material do DSS';
  END IF;
  IF p_arquivo_path IS NOT NULL AND (split_part(p_arquivo_path, '/', 1) <> 'dss' OR split_part(p_arquivo_path, '/', 2) <> p_id::text) THEN
    RAISE EXCEPTION 'Anexo fora da pasta do DSS';
  END IF;
  IF p_semana_ref IS NULL OR p_disponivel_de IS NULL THEN RAISE EXCEPTION 'Informe a semana e o início da disponibilização'; END IF;
  IF p_disponivel_ate IS NOT NULL AND p_disponivel_ate < p_disponivel_de THEN
    RAISE EXCEPTION 'O fim da disponibilização é antes do início';
  END IF;
  IF NOT COALESCE(p_todos_contratos, false)
     AND (p_contratos IS NULL OR jsonb_typeof(p_contratos) <> 'array' OR jsonb_array_length(p_contratos) = 0) THEN
    RAISE EXCEPTION 'Escolha pelo menos um contrato (ou todos)';
  END IF;

  SELECT situacao INTO v_situacao FROM public."SST_DSS" WHERE id = p_id FOR UPDATE;
  IF FOUND AND v_situacao <> 'rascunho' THEN RAISE EXCEPTION 'DSS já publicado não pode ser editado'; END IF;
  IF NOT FOUND THEN
    INSERT INTO public."SST_DSS" (id, tema, conteudo, arquivo_path, arquivo_nome, semana_ref, disponivel_de, disponivel_ate, todos_contratos)
    VALUES (p_id, btrim(p_tema), COALESCE(p_conteudo, ''), p_arquivo_path, left(p_arquivo_nome, 200),
            p_semana_ref, p_disponivel_de, p_disponivel_ate, COALESCE(p_todos_contratos, false));
  ELSE
    UPDATE public."SST_DSS" SET tema = btrim(p_tema), conteudo = COALESCE(p_conteudo, ''), arquivo_path = p_arquivo_path,
           arquivo_nome = left(p_arquivo_nome, 200), semana_ref = p_semana_ref, disponivel_de = p_disponivel_de,
           disponivel_ate = p_disponivel_ate, todos_contratos = COALESCE(p_todos_contratos, false)
     WHERE id = p_id;
  END IF;

  DELETE FROM public."SST_DSS_CONTRATO" WHERE dss_id = p_id;
  IF NOT COALESCE(p_todos_contratos, false) THEN
    INSERT INTO public."SST_DSS_CONTRATO" (dss_id, empresa, filial, contrato_nome)
    SELECT DISTINCT p_id, (x->>'empresa')::bigint, (x->>'filial')::bigint,
           public.sst_dss_nome_contrato((x->>'empresa')::bigint, (x->>'filial')::bigint, x->>'nome')
      FROM jsonb_array_elements(p_contratos) x
     WHERE x->>'empresa' ~ '^\d+$' AND x->>'filial' ~ '^\d+$';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'Escolha pelo menos um contrato (ou todos)'; END IF;
  END IF;

  IF COALESCE(p_publicar, false) THEN
    UPDATE public."SST_DSS"
       SET situacao = 'publicado', publicado_em = now(), publicado_por = auth.uid(),
           conteudo_hash = encode(digest(tema || E'\n' || conteudo || E'\n' || COALESCE(arquivo_path, ''), 'sha256'), 'hex')
     WHERE id = p_id;
  END IF;
  RETURN p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_dss_salvar(uuid, text, text, text, text, date, date, date, boolean, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_dss_salvar(uuid, text, text, text, text, date, date, date, boolean, jsonb, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_dss_excluir_rascunho(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.sst_dss_acesso('incluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir DSS.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."SST_DSS" WHERE id = p_id; -- o gatilho recusa o que não é rascunho
END $fn$;
REVOKE ALL ON FUNCTION public.sst_dss_excluir_rascunho(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_dss_excluir_rascunho(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_dss_encerrar(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.sst_dss_acesso('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para encerrar DSS.' USING ERRCODE = '42501';
  END IF;
  UPDATE public."SST_DSS" SET situacao = 'encerrado', encerrado_em = now(), encerrado_por = auth.uid()
   WHERE id = p_id AND situacao = 'publicado';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só um DSS publicado pode ser encerrado'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_dss_encerrar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_dss_encerrar(uuid) TO authenticated;

-- Painel: os DSS do período (pela semana de referência) e, por DSS ×
-- contrato, quantos são destinatários, acessaram, assinaram (portal/papel).
-- Indicadores gerais, % e status do contrato saem disso no front
-- (src/lib/treinamentos/dss.ts).
CREATE OR REPLACE FUNCTION public.sst_dss_painel(p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_ids uuid[]; v_dss jsonb; v_contratos jsonb;
BEGIN
  IF NOT public.sst_dss_acesso('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao DSS.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(d.id), '{}') INTO v_ids FROM public."SST_DSS" d
   WHERE (p_de IS NULL OR d.semana_ref >= p_de) AND (p_ate IS NULL OR d.semana_ref <= p_ate);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', d.id, 'tema', d.tema, 'semana_ref', d.semana_ref, 'situacao', d.situacao,
      'vigente', public.sst_dss_vigente(d), 'disponivel_de', d.disponivel_de, 'disponivel_ate', d.disponivel_ate,
      'todos_contratos', d.todos_contratos, 'publicado_em', d.publicado_em, 'encerrado_em', d.encerrado_em,
      'tem_arquivo', d.arquivo_path IS NOT NULL, 'created_at', d.created_at)
      ORDER BY d.semana_ref DESC, d.created_at DESC), '[]'::jsonb)
    INTO v_dss FROM public."SST_DSS" d WHERE d.id = ANY(v_ids);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'dss_id', g.dss_id, 'empresa', g.empresa, 'filial', g.filial, 'contrato_nome', g.contrato_nome,
      'destinatarios', g.destinatarios, 'acessaram', g.acessaram, 'assinaram', g.assinaram,
      'assinaram_papel', g.assinaram_papel)
      ORDER BY g.contrato_nome), '[]'::jsonb)
    INTO v_contratos
    FROM (SELECT t.dss_id, t.empresa, t.filial, max(t.contrato_nome) AS contrato_nome,
                 count(*) AS destinatarios,
                 count(*) FILTER (WHERE t.acessado_em IS NOT NULL OR t.assinado_em IS NOT NULL) AS acessaram,
                 count(*) FILTER (WHERE t.assinado_em IS NOT NULL) AS assinaram,
                 count(*) FILTER (WHERE t.origem = 'papel') AS assinaram_papel
            FROM public.sst_dss_destinatarios(v_ids) t
           GROUP BY t.dss_id, t.empresa, t.filial) g;

  RETURN jsonb_build_object('dss', v_dss, 'contratos', v_contratos);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_dss_painel(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_dss_painel(date, date) TO authenticated;

-- Pessoas de um DSS (opcionalmente de um contrato), com status e datas.
CREATE OR REPLACE FUNCTION public.sst_dss_pessoas(p_dss uuid, p_empresa bigint DEFAULT NULL, p_filial bigint DEFAULT NULL)
RETURNS TABLE (empregado_id bigint, nome text, matricula text, cargo text, cpf text, empresa bigint, filial bigint,
               contrato_nome text, acessado_em timestamptz, assinado_em timestamptz, origem text, folha_id uuid,
               assinatura_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.sst_dss_acesso('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao DSS.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.empregado_id, t.nome, t.matricula, t.cargo, public.col_digitos(t.cpf), t.empresa, t.filial, t.contrato_nome,
         t.acessado_em, t.assinado_em, t.origem, t.folha_id, t.assinatura_hash
    FROM public.sst_dss_destinatarios(ARRAY[p_dss]) t
   WHERE (p_empresa IS NULL OR t.empresa = p_empresa) AND (p_filial IS NULL OR t.filial = p_filial)
   ORDER BY t.contrato_nome, t.nome;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_dss_pessoas(uuid, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_dss_pessoas(uuid, bigint, bigint) TO authenticated;

-- Filtro "colaborador" do painel: o histórico de DSS de quem casa com a busca
-- (nome, matrícula ou começo do CPF), nos DSS do período. Até 500 linhas.
CREATE OR REPLACE FUNCTION public.sst_dss_por_colaborador(p_busca text, p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS TABLE (dss_id uuid, tema text, semana_ref date, empregado_id bigint, nome text, matricula text, cargo text,
               empresa bigint, filial bigint, contrato_nome text, acessado_em timestamptz, assinado_em timestamptz, origem text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_ids uuid[]; b text := NULLIF(btrim(COALESCE(p_busca, '')), '');
        dg text := NULLIF(regexp_replace(COALESCE(p_busca, ''), '\D', '', 'g'), '');
BEGIN
  IF NOT public.sst_dss_acesso('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao DSS.' USING ERRCODE = '42501';
  END IF;
  IF b IS NULL OR length(b) < 3 THEN RETURN; END IF;
  SELECT COALESCE(array_agg(d.id), '{}') INTO v_ids FROM public."SST_DSS" d
   WHERE d.situacao <> 'rascunho' AND (p_de IS NULL OR d.semana_ref >= p_de) AND (p_ate IS NULL OR d.semana_ref <= p_ate);
  RETURN QUERY
  SELECT t.dss_id, d.tema, d.semana_ref, t.empregado_id, t.nome, t.matricula, t.cargo, t.empresa, t.filial, t.contrato_nome,
         t.acessado_em, t.assinado_em, t.origem
    FROM public.sst_dss_destinatarios(v_ids) t JOIN public."SST_DSS" d ON d.id = t.dss_id
   WHERE t.nome ILIKE '%' || b || '%'
      OR (dg IS NOT NULL AND length(dg) >= 3 AND (t.matricula = dg OR public.col_digitos(t.cpf) LIKE dg || '%'))
   ORDER BY t.nome, d.semana_ref DESC
   LIMIT 500;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_dss_por_colaborador(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_dss_por_colaborador(text, date, date) TO authenticated;

-- Folha em papel: grava a folha do contrato e marca como assinado quem o SST
-- conferiu nela. Quem já assinou (portal ou outra folha) fica como estava.
-- Só entra quem é destinatário deste DSS NESTE contrato.
CREATE OR REPLACE FUNCTION public.sst_dss_lancar_papel(
  p_dss uuid, p_empresa bigint, p_filial bigint, p_path text, p_arquivo_nome text, p_empregados bigint[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE v_d public."SST_DSS"%ROWTYPE; v_folha uuid; v_contrato text; v_agora timestamptz := now();
        v_lancados int := 0; v_ja int := 0; v_fora int := 0; v_emp bigint; v_t record;
BEGIN
  IF NOT public.sst_dss_acesso('alterar') THEN
    RAISE EXCEPTION 'Sem permissão para lançar folha de DSS.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public."SST_DSS" WHERE id = p_dss;
  IF NOT FOUND OR v_d.situacao = 'rascunho' THEN RAISE EXCEPTION 'DSS não publicado'; END IF;
  IF p_path IS NULL OR split_part(p_path, '/', 1) <> 'folhas' OR split_part(p_path, '/', 2) <> p_dss::text THEN
    RAISE EXCEPTION 'Folha fora da pasta do DSS';
  END IF;
  IF p_empregados IS NULL OR cardinality(p_empregados) = 0 THEN RAISE EXCEPTION 'Marque quem assinou a folha'; END IF;

  v_contrato := public.sst_dss_nome_contrato(p_empresa, p_filial, NULL);
  INSERT INTO public."SST_DSS_FOLHA" (dss_id, empresa, filial, contrato_nome, storage_path, arquivo_nome, anexado_por)
  VALUES (p_dss, p_empresa, p_filial, v_contrato, p_path, left(p_arquivo_nome, 200), auth.uid())
  RETURNING id INTO v_folha;

  FOREACH v_emp IN ARRAY (SELECT array_agg(DISTINCT x) FROM unnest(p_empregados) x) LOOP
    SELECT * INTO v_t FROM public.sst_dss_destinatarios(ARRAY[p_dss]) t
     WHERE t.empregado_id = v_emp AND t.empresa = p_empresa AND t.filial = p_filial;
    IF NOT FOUND THEN v_fora := v_fora + 1; CONTINUE; END IF;
    IF v_t.assinado_em IS NOT NULL THEN v_ja := v_ja + 1; CONTINUE; END IF;
    INSERT INTO public."SST_DSS_CIENCIA" (dss_id, empregado_id, cpf, nome, matricula, cargo, empresa, filial,
                                          empresa_nome, contrato_nome)
    SELECT p_dss, e."ID", public.col_digitos(e."CPF"), e."Nome", NULLIF(btrim(e."Cadastro"::text), ''),
           COALESCE(NULLIF(e."Título do Cargo", ''), NULLIF(e."Nome do Cargo", ''), e."Cargo"::text),
           e."Empresa", e."Filial", e."Nome da Empresa", v_t.contrato_nome
      FROM public."EMPREGADOS" e WHERE e."ID" = v_emp
    ON CONFLICT (dss_id, empregado_id) DO NOTHING;
    UPDATE public."SST_DSS_CIENCIA"
       SET assinado_em = v_agora, origem = 'papel', folha_id = v_folha, registrado_por = auth.uid(),
           assinatura_hash = encode(digest(p_dss::text || v_emp::text || v_d.conteudo_hash || v_agora::text
                                           || v_folha::text || 'dss-papel-v1', 'sha256'), 'hex')
     WHERE dss_id = p_dss AND empregado_id = v_emp AND assinado_em IS NULL;
    IF FOUND THEN v_lancados := v_lancados + 1; ELSE v_ja := v_ja + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('folha_id', v_folha, 'lancados', v_lancados, 'ja_assinados', v_ja, 'fora_do_contrato', v_fora);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_dss_lancar_papel(uuid, bigint, bigint, text, text, bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_dss_lancar_papel(uuid, bigint, bigint, text, text, bigint[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (só depois de exportar as ciências e as folhas — são prova de
-- orientação de segurança):
-- DROP FUNCTION IF EXISTS public.sst_dss_lancar_papel(uuid, bigint, bigint, text, text, bigint[]);
-- DROP FUNCTION IF EXISTS public.sst_dss_por_colaborador(text, date, date);
-- DROP FUNCTION IF EXISTS public.sst_dss_pessoas(uuid, bigint, bigint);
-- DROP FUNCTION IF EXISTS public.sst_dss_painel(date, date);
-- DROP FUNCTION IF EXISTS public.sst_dss_encerrar(uuid);
-- DROP FUNCTION IF EXISTS public.sst_dss_excluir_rascunho(uuid);
-- DROP FUNCTION IF EXISTS public.sst_dss_salvar(uuid, text, text, text, text, date, date, date, boolean, jsonb, boolean);
-- DROP FUNCTION IF EXISTS public.sst_dss_contratos();
-- DROP FUNCTION IF EXISTS public.col_dss_assinar(bigint, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.col_dss_arquivo_path(bigint, uuid);
-- DROP FUNCTION IF EXISTS public.col_dss_abrir(bigint, uuid);
-- DROP FUNCTION IF EXISTS public.col_dss_lista(bigint);
-- DROP FUNCTION IF EXISTS public.col_dss_visivel(bigint, uuid);
-- DROP FUNCTION IF EXISTS public.sst_dss_destinatarios(uuid[]);
-- DROP TABLE IF EXISTS public."SST_DSS_CIENCIA", public."SST_DSS_FOLHA", public."SST_DSS_CONTRATO", public."SST_DSS";
-- DROP FUNCTION IF EXISTS public.sst_dss_nome_contrato(bigint, bigint, text), public.sst_dss_alvo(uuid, boolean, bigint, bigint),
--   public.sst_dss_fim(public."SST_DSS"), public.sst_dss_vigente(public."SST_DSS"), public.sst_dss_hoje(),
--   public.sst_dss_guarda(), public.sst_dss_contrato_guarda(), public.sst_dss_ciencia_guarda(), public.sst_dss_folha_imutavel(),
--   public.sst_dss_acesso(text);
-- DROP POLICY IF EXISTS "sst dss ler" ON storage.objects; DROP POLICY IF EXISTS "sst dss anexar" ON storage.objects;
-- DROP POLICY IF EXISTS "sst dss sem update" ON storage.objects; DROP POLICY IF EXISTS "sst dss sem delete" ON storage.objects;
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'treinamentos_dss';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'treinamentos_dss';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'treinamentos_dss';
-- DELETE FROM public.app_menu WHERE codigo = 'treinamentos_dss';
