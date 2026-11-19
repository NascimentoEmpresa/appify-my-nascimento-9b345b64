-- =========================================================================
-- COMITÊ DE ÉTICA — Documentos da investigação (19/11/2026, [SEM-CHAMADO])
--
-- PEDIDO DO COMITÊ
--   O relator precisa redigir, dentro do sistema, os documentos formais de
--   cada procedimento investigativo:
--     · Termo de Abertura do Procedimento Investigativo — formaliza o início
--       da apuração e descreve os fatos a investigar;
--     · Parecer Conclusivo — análise das informações reunidas e conclusão.
--   Cada um com editor, salvar (quem salvou e quando) e versão final. A I.A
--   ajuda a escrever a MINUTA (Edge denuncia-parecer-ia, modo "minuta"), mas
--   nunca grava nada: quem salva é a pessoa, e a versão final é um segundo
--   clique dela.
--
-- O QUE ESTA MIGRATION FAZ (ADITIVA — nada do canal muda)
--   1. Menu fantasma `comite_etica_documentos` ("Pode redigir os documentos
--      da investigação"), para quem é do Comitê mas não é o relator do caso.
--      Nasce PENDENTE (SIS-2026-0931): liberar em Novos Módulos.
--   2. "CANAL_DENUNCIA_DOCUMENTO": um documento por (denúncia, tipo).
--   3. "CANAL_DENUNCIA_DOCUMENTO_VERSAO": cada salvamento vira uma versão,
--      gravada pelo gatilho — a trilha de quem escreveu o quê e quando.
--   4. Gatilho de carimbo/trava: autor e data vêm do banco (não do cliente);
--      versão final não se edita sem antes reabrir; final vazio é recusado.
--   5. RLS. Ler: quem enxerga o caso (Comitê no recorte de empresa, ou a
--      Presidência nas situações dela) — as mesmas funções das outras
--      filhas do canal. Escrever: quem enxerga o caso E (é o relator —
--      apuracao_responsavel_id — OU tem a capacidade da Presidência OU tem
--      `comite_etica_documentos`). Sem DELETE: documento de procedimento
--      não some.
--
-- SIGILO
--   O texto é sigiloso como o resto do caso: nada dele vai para log, e a
--   tabela não tem SELECT para anon. O relator NÃO ganha acesso ao caso por
--   ser relator — continua precisando enxergar a denúncia pelas regras do
--   canal; ser relator só libera a escrita.
--
-- Idempotente.
-- =========================================================================

-- ── 1. Menu fantasma (capacidade) ────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'comite_etica_documentos', 'Pode redigir os documentos da investigação', NULL, 95, true
  FROM public.app_modulo m WHERE m.codigo = 'comite_etica'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. Documento ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_DOCUMENTO" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id          uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  -- Espelho: TIPOS_DOCUMENTO em src/pages/comite-etica/documentos.ts.
  tipo                 text NOT NULL CHECK (tipo IN ('termo_abertura', 'parecer_conclusivo')),
  conteudo             text NOT NULL DEFAULT '',
  versao               integer NOT NULL DEFAULT 1,
  final                boolean NOT NULL DEFAULT false,
  -- Marcado pela tela quando o texto salvo partiu de uma minuta da I.A.
  -- Só informação: a I.A não grava aqui, quem grava é a pessoa.
  usou_minuta_ia       boolean NOT NULL DEFAULT false,
  finalizado_em        timestamptz,
  finalizado_por       uuid REFERENCES auth.users(id),
  finalizado_por_nome  text,
  atualizado_por       uuid REFERENCES auth.users(id),
  atualizado_por_nome  text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (denuncia_id, tipo)
);

COMMENT ON TABLE public."CANAL_DENUNCIA_DOCUMENTO" IS
  'Termo de Abertura e Parecer Conclusivo de cada procedimento do Comite de Etica. Autor/data carimbados por gatilho; cada salvamento vira linha em CANAL_DENUNCIA_DOCUMENTO_VERSAO.';

-- ── 3. Versões ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_DOCUMENTO_VERSAO" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id    uuid NOT NULL REFERENCES public."CANAL_DENUNCIA_DOCUMENTO"(id) ON DELETE CASCADE,
  denuncia_id     uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  tipo            text NOT NULL,
  versao          integer NOT NULL,
  conteudo        text NOT NULL,
  final           boolean NOT NULL,
  usou_minuta_ia  boolean NOT NULL DEFAULT false,
  salvo_por       uuid REFERENCES auth.users(id),
  salvo_por_nome  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canal_documento_versao_doc
  ON public."CANAL_DENUNCIA_DOCUMENTO_VERSAO"(documento_id, versao DESC);

-- ── 4. Quem pode redigir ─────────────────────────────────────────────
-- DEFINER: authenticated não lê CANAL_DENUNCIA (só id/empresa_id/status),
-- e o relator mora em apuracao_responsavel_id.
CREATE OR REPLACE FUNCTION public.canal_denuncia_documento_pode_ler(_denuncia uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.canal_denuncia_visivel_por_id(_denuncia)
      OR public.canal_denuncia_presidencia_ve_por_id(_denuncia);
$$;

CREATE OR REPLACE FUNCTION public.canal_denuncia_documento_pode_redigir(_denuncia uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.canal_denuncia_documento_pode_ler(_denuncia)
     AND (
       EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                WHERE d.id = _denuncia AND d.apuracao_responsavel_id = auth.uid())
       OR public.has_screen_access(auth.uid(), 'comite_etica_presidencia', 'visualizar'::public.app_acao, NULL)
       OR public.has_screen_access(auth.uid(), 'comite_etica_documentos',  'visualizar'::public.app_acao, NULL)
     );
$$;

COMMENT ON FUNCTION public.canal_denuncia_documento_pode_redigir(uuid) IS
  'Redige Termo de Abertura/Parecer Conclusivo e gera minuta com I.A: quem enxerga o caso E (relator do caso OU Presidencia OU comite_etica_documentos).';

REVOKE ALL ON FUNCTION public.canal_denuncia_documento_pode_ler(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.canal_denuncia_documento_pode_redigir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_documento_pode_ler(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_documento_pode_redigir(uuid) TO authenticated;

-- ── 5. Gatilho: carimbo, trava da versão final e trilha ──────────────
CREATE OR REPLACE FUNCTION public.canal_denuncia_documento_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_nome text;
BEGIN
  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();

  IF TG_OP = 'UPDATE' THEN
    -- Não se troca de caso nem de tipo: seria outro documento.
    IF NEW.denuncia_id IS DISTINCT FROM OLD.denuncia_id OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
      RAISE EXCEPTION 'O documento não pode mudar de procedimento nem de tipo.';
    END IF;
    -- Versão final é o que vale no procedimento: para mudar o texto, reabre
    -- antes (final = false), e isso fica na trilha.
    IF OLD.final AND NEW.final AND NEW.conteudo IS DISTINCT FROM OLD.conteudo THEN
      RAISE EXCEPTION 'Este documento está na versão final. Reabra para editar.';
    END IF;
    NEW.versao     := OLD.versao + 1;
    NEW.created_at := OLD.created_at;
  ELSE
    NEW.versao := 1;
  END IF;

  IF NEW.final AND btrim(coalesce(NEW.conteudo, '')) = '' THEN
    RAISE EXCEPTION 'Não dá para marcar como versão final um documento vazio.';
  END IF;

  -- Carimbo do banco, nunca do cliente.
  NEW.atualizado_por      := auth.uid();
  NEW.atualizado_por_nome := v_nome;
  NEW.updated_at          := now();
  IF NEW.final AND (TG_OP = 'INSERT' OR NOT OLD.final) THEN
    NEW.finalizado_em       := now();
    NEW.finalizado_por      := auth.uid();
    NEW.finalizado_por_nome := v_nome;
  ELSIF NOT NEW.final THEN
    NEW.finalizado_em := NULL; NEW.finalizado_por := NULL; NEW.finalizado_por_nome := NULL;
  ELSE
    NEW.finalizado_em := OLD.finalizado_em; NEW.finalizado_por := OLD.finalizado_por;
    NEW.finalizado_por_nome := OLD.finalizado_por_nome;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.canal_denuncia_documento_registrar_versao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public."CANAL_DENUNCIA_DOCUMENTO_VERSAO"
    (documento_id, denuncia_id, tipo, versao, conteudo, final, usou_minuta_ia, salvo_por, salvo_por_nome)
  VALUES
    (NEW.id, NEW.denuncia_id, NEW.tipo, NEW.versao, NEW.conteudo, NEW.final, NEW.usou_minuta_ia,
     NEW.atualizado_por, NEW.atualizado_por_nome);
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.canal_denuncia_documento_guard()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.canal_denuncia_documento_registrar_versao() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_canal_denuncia_documento_guard ON public."CANAL_DENUNCIA_DOCUMENTO";
CREATE TRIGGER trg_canal_denuncia_documento_guard
  BEFORE INSERT OR UPDATE ON public."CANAL_DENUNCIA_DOCUMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_documento_guard();

DROP TRIGGER IF EXISTS trg_canal_denuncia_documento_versao ON public."CANAL_DENUNCIA_DOCUMENTO";
CREATE TRIGGER trg_canal_denuncia_documento_versao
  AFTER INSERT OR UPDATE ON public."CANAL_DENUNCIA_DOCUMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_documento_registrar_versao();

-- ── 6. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public."CANAL_DENUNCIA_DOCUMENTO"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CANAL_DENUNCIA_DOCUMENTO_VERSAO" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."CANAL_DENUNCIA_DOCUMENTO"        FROM anon, PUBLIC;
REVOKE ALL ON TABLE public."CANAL_DENUNCIA_DOCUMENTO_VERSAO" FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public."CANAL_DENUNCIA_DOCUMENTO" TO authenticated;
-- Versões: só leitura; quem escreve é o gatilho (DEFINER).
GRANT SELECT ON TABLE public."CANAL_DENUNCIA_DOCUMENTO_VERSAO" TO authenticated;

DROP POLICY IF EXISTS canal_documento_select ON public."CANAL_DENUNCIA_DOCUMENTO";
CREATE POLICY canal_documento_select ON public."CANAL_DENUNCIA_DOCUMENTO"
  FOR SELECT TO authenticated
  USING (public.canal_denuncia_documento_pode_ler(denuncia_id));

DROP POLICY IF EXISTS canal_documento_insert ON public."CANAL_DENUNCIA_DOCUMENTO";
CREATE POLICY canal_documento_insert ON public."CANAL_DENUNCIA_DOCUMENTO"
  FOR INSERT TO authenticated
  WITH CHECK (public.canal_denuncia_documento_pode_redigir(denuncia_id));

DROP POLICY IF EXISTS canal_documento_update ON public."CANAL_DENUNCIA_DOCUMENTO";
CREATE POLICY canal_documento_update ON public."CANAL_DENUNCIA_DOCUMENTO"
  FOR UPDATE TO authenticated
  USING (public.canal_denuncia_documento_pode_redigir(denuncia_id))
  WITH CHECK (public.canal_denuncia_documento_pode_redigir(denuncia_id));

DROP POLICY IF EXISTS canal_documento_versao_select ON public."CANAL_DENUNCIA_DOCUMENTO_VERSAO";
CREATE POLICY canal_documento_versao_select ON public."CANAL_DENUNCIA_DOCUMENTO_VERSAO"
  FOR SELECT TO authenticated
  USING (public.canal_denuncia_documento_pode_ler(denuncia_id));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TABLE IF EXISTS public."CANAL_DENUNCIA_DOCUMENTO_VERSAO";
-- DROP TABLE IF EXISTS public."CANAL_DENUNCIA_DOCUMENTO";
-- DROP FUNCTION IF EXISTS public.canal_denuncia_documento_registrar_versao();
-- DROP FUNCTION IF EXISTS public.canal_denuncia_documento_guard();
-- DROP FUNCTION IF EXISTS public.canal_denuncia_documento_pode_redigir(uuid);
-- DROP FUNCTION IF EXISTS public.canal_denuncia_documento_pode_ler(uuid);
-- DELETE FROM public.app_menu WHERE codigo = 'comite_etica_documentos';
-- NOTIFY pgrst, 'reload schema';
