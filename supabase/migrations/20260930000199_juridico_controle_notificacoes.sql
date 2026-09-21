-- =========================================================================
-- Jurídico › Controle de Notificações (21/09/2026)
--
-- PEDIDO
--   Controle de multas, glosas, notificações, apontamentos contratuais e das
--   defesas administrativas — hoje em planilhas de Excel. Uma plataforma só,
--   do recebimento à conclusão (defesa, recurso, reversão, desconto e medida
--   preventiva), com rastreabilidade completa e indicadores para Jurídico,
--   Administrativo, Operacional, RH e Diretoria.
--
-- O QUE ENTRA
--   1) Menu `juridico_notificacoes` (/app/juridico/notificacoes) no módulo
--      Jurídico. Deny-by-default (has_screen_access): semeado com TODAS as
--      ações no perfil "Legado: juridico" (a equipe do Jurídico) e só
--      visualizar no perfil do módulo. Administrativo, Operacional, RH e
--      Diretoria: liberar por pessoa em Acesso por Usuário.
--   2) "JUR_NOTIFICACOES" — a ocorrência. Protocolo NOT-AAAA-NNNNN automático.
--      `etapa` = onde está o trabalho; `resultado` = o que decidiram;
--      `desfecho_financeiro` = o que aconteceu com o dinheiro. Separados de
--      propósito: "defesa protocolada" e "revertida parcialmente" são
--      perguntas diferentes, e a planilha misturava as duas numa coluna só.
--   3) "JUR_NOTIFICACAO_DEFESAS" — defesa prévia, recursos, reconsideração:
--      uma linha por peça, com prazo, protocolo e resultado de cada uma.
--   4) "JUR_NOTIFICACAO_ANEXOS" + bucket privado `juridico-notificacoes`.
--   5) "JUR_NOTIFICACAO_HISTORICO" — rastreabilidade: trigger grava toda
--      mudança dos campos que importam (etapa, resultado, valores, prazo,
--      responsável…), defesa lançada/alterada e documento anexado — com quem
--      e quando. Ninguém escreve nela à mão (só SELECT pelo app).
--   Comentários usam o feed único SISTEMA_COMENTARIOS (modulo='notificacao').
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- 1) Menu + permissões semeadas -------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'juridico_notificacoes', 'Controle de Notificações', '/app/juridico/notificacoes', 35, true
  FROM public.app_modulo m
 WHERE m.codigo = 'juridico'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'juridico_notificacoes');

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'juridico_notificacoes', a.acao::public.app_acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'), ('incluir'), ('alterar'), ('excluir'), ('exportar')) AS a(acao)
 WHERE pa.nome = 'Legado: juridico'
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pa.id AND x.menu_codigo = 'juridico_notificacoes' AND x.acao = a.acao::public.app_acao);

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'juridico_notificacoes', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.modulo_codigo = 'juridico'
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pa.id AND x.menu_codigo = 'juridico_notificacoes' AND x.acao = 'visualizar');

-- 2) A ocorrência ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."JUR_NOTIFICACOES" (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  protocolo             text UNIQUE,
  tipo                  text NOT NULL,
  -- Quem aplicou: o contratante / órgão / fiscal do contrato.
  orgao                 text,
  contrato              text,
  numero_documento      text,          -- nº do auto, ofício, notificação
  data_ocorrencia       date,          -- quando aconteceu o fato apontado
  data_recebimento      date NOT NULL,
  prazo_defesa          date,
  assunto               text NOT NULL,
  descricao             text,
  fundamentacao         text,          -- cláusula / base legal citada
  local_posto           text,
  valor_original        numeric(14,2),
  valor_final           numeric(14,2), -- o que ficou devido após defesa/recurso
  valor_descontado      numeric(14,2), -- o que efetivamente saiu (glosa na fatura / pagamento)
  etapa                 text NOT NULL DEFAULT 'Recebida',
  resultado             text,
  desfecho_financeiro   text,
  data_desfecho         date,
  setor_responsavel     text,
  responsavel_nome      text,
  causa_raiz            text,
  medida_preventiva     text,
  medida_responsavel    text,
  medida_prazo          date,
  medida_concluida      boolean NOT NULL DEFAULT false,
  observacoes           text,
  criado_por            uuid DEFAULT auth.uid(),
  criado_por_nome       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  encerrada_em          timestamptz,
  CONSTRAINT jur_notificacoes_tipo_chk CHECK (tipo IN
    ('Multa', 'Glosa', 'Notificação', 'Apontamento contratual', 'Advertência contratual', 'Outros')),
  CONSTRAINT jur_notificacoes_etapa_chk CHECK (etapa IN
    ('Recebida', 'Em análise', 'Defesa em elaboração', 'Defesa protocolada', 'Em recurso', 'Aguardando decisão', 'Encerrada')),
  CONSTRAINT jur_notificacoes_resultado_chk CHECK (resultado IS NULL OR resultado IN
    ('Revertida', 'Revertida parcialmente', 'Mantida', 'Sem defesa', 'Cancelada pelo órgão')),
  CONSTRAINT jur_notificacoes_desfecho_chk CHECK (desfecho_financeiro IS NULL OR desfecho_financeiro IN
    ('Descontada em fatura', 'Paga', 'Sem impacto financeiro', 'Aguardando desconto')),
  CONSTRAINT jur_notificacoes_valores_chk CHECK (
    coalesce(valor_original, 0) >= 0 AND coalesce(valor_final, 0) >= 0 AND coalesce(valor_descontado, 0) >= 0)
);
CREATE INDEX IF NOT EXISTS idx_jur_notificacoes_etapa    ON public."JUR_NOTIFICACOES" (etapa);
CREATE INDEX IF NOT EXISTS idx_jur_notificacoes_prazo    ON public."JUR_NOTIFICACOES" (prazo_defesa) WHERE etapa <> 'Encerrada';
CREATE INDEX IF NOT EXISTS idx_jur_notificacoes_contrato ON public."JUR_NOTIFICACOES" (contrato);

-- Protocolo NOT-AAAA-NNNNN (sequência por ano) + carimbo de quem criou.
CREATE OR REPLACE FUNCTION public.jur_notificacao_antes_inserir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ano text := to_char(coalesce(NEW.data_recebimento, current_date), 'YYYY'); v_n int;
BEGIN
  IF NEW.protocolo IS NULL OR btrim(NEW.protocolo) = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('jur_notificacao_protocolo_' || v_ano));
    SELECT coalesce(max(nullif(split_part(protocolo, '-', 3), '')::int), 0) + 1 INTO v_n
      FROM public."JUR_NOTIFICACOES" WHERE protocolo LIKE 'NOT-' || v_ano || '-%';
    NEW.protocolo := 'NOT-' || v_ano || '-' || lpad(v_n::text, 5, '0');
  END IF;
  NEW.criado_por := coalesce(NEW.criado_por, auth.uid());
  IF NEW.criado_por_nome IS NULL THEN
    SELECT coalesce(display_name, email) INTO NEW.criado_por_nome FROM public.profiles WHERE id = auth.uid();
  END IF;
  IF NEW.etapa = 'Encerrada' THEN NEW.encerrada_em := coalesce(NEW.encerrada_em, now()); END IF;
  RETURN NEW;
END $$;

-- updated_at + encerrada_em acompanham a etapa.
CREATE OR REPLACE FUNCTION public.jur_notificacao_antes_atualizar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.protocolo := OLD.protocolo;           -- protocolo não muda
  NEW.criado_por := OLD.criado_por; NEW.criado_por_nome := OLD.criado_por_nome; NEW.created_at := OLD.created_at;
  IF NEW.etapa = 'Encerrada' AND OLD.etapa <> 'Encerrada' THEN NEW.encerrada_em := now(); END IF;
  IF NEW.etapa <> 'Encerrada' THEN NEW.encerrada_em := NULL; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jur_notificacao_antes_inserir ON public."JUR_NOTIFICACOES";
CREATE TRIGGER trg_jur_notificacao_antes_inserir BEFORE INSERT ON public."JUR_NOTIFICACOES"
  FOR EACH ROW EXECUTE FUNCTION public.jur_notificacao_antes_inserir();
DROP TRIGGER IF EXISTS trg_jur_notificacao_antes_atualizar ON public."JUR_NOTIFICACOES";
CREATE TRIGGER trg_jur_notificacao_antes_atualizar BEFORE UPDATE ON public."JUR_NOTIFICACOES"
  FOR EACH ROW EXECUTE FUNCTION public.jur_notificacao_antes_atualizar();

-- 3) Defesas e recursos ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public."JUR_NOTIFICACAO_DEFESAS" (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notificacao_id    bigint NOT NULL REFERENCES public."JUR_NOTIFICACOES"(id) ON DELETE CASCADE,
  instancia         text NOT NULL,
  prazo             date,
  data_protocolo    date,
  numero_protocolo  text,
  argumentos        text,
  resultado         text NOT NULL DEFAULT 'Aguardando',
  data_resultado    date,
  valor_apos        numeric(14,2),     -- valor que ficou depois desta decisão
  responsavel_nome  text,
  observacao        text,
  criado_por_nome   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jur_notificacao_defesas_instancia_chk CHECK (instancia IN
    ('Defesa prévia', 'Recurso', 'Recurso — 2ª instância', 'Pedido de reconsideração', 'Outros')),
  CONSTRAINT jur_notificacao_defesas_resultado_chk CHECK (resultado IN
    ('Aguardando', 'Deferida', 'Parcialmente deferida', 'Indeferida', 'Não conhecida'))
);
CREATE INDEX IF NOT EXISTS idx_jur_notificacao_defesas_notif ON public."JUR_NOTIFICACAO_DEFESAS" (notificacao_id);

-- 4) Documentos + bucket ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public."JUR_NOTIFICACAO_ANEXOS" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notificacao_id  bigint NOT NULL REFERENCES public."JUR_NOTIFICACOES"(id) ON DELETE CASCADE,
  defesa_id       bigint REFERENCES public."JUR_NOTIFICACAO_DEFESAS"(id) ON DELETE SET NULL,
  categoria       text NOT NULL DEFAULT 'Outros',
  nome            text NOT NULL,
  storage_path    text NOT NULL,
  tamanho         bigint,
  tipo            text,
  enviado_por     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jur_notificacao_anexos_categoria_chk CHECK (categoria IN
    ('Notificação recebida', 'Defesa', 'Recurso', 'Decisão', 'Comprovante de pagamento/desconto', 'Evidência', 'Outros'))
);
CREATE INDEX IF NOT EXISTS idx_jur_notificacao_anexos_notif ON public."JUR_NOTIFICACAO_ANEXOS" (notificacao_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('juridico-notificacoes', 'juridico-notificacoes', false, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "juridico notificacoes arquivo select" ON storage.objects;
CREATE POLICY "juridico notificacoes arquivo select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'juridico-notificacoes' AND public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'visualizar'::public.app_acao));
DROP POLICY IF EXISTS "juridico notificacoes arquivo insert" ON storage.objects;
CREATE POLICY "juridico notificacoes arquivo insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'juridico-notificacoes' AND public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'alterar'::public.app_acao));
DROP POLICY IF EXISTS "juridico notificacoes arquivo delete" ON storage.objects;
CREATE POLICY "juridico notificacoes arquivo delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'juridico-notificacoes' AND public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'alterar'::public.app_acao));

-- 5) Histórico (rastreabilidade) ------------------------------------------
-- R$ no formato brasileiro (o to_char do servidor sai em inglês: 1,500.00).
CREATE OR REPLACE FUNCTION public.jur_brl(v numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$ SELECT CASE WHEN v IS NULL THEN NULL ELSE 'R$ ' || translate(to_char(v, 'FM999,999,999,990.00'), ',.', '.,') END $$;

CREATE TABLE IF NOT EXISTS public."JUR_NOTIFICACAO_HISTORICO" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notificacao_id  bigint NOT NULL REFERENCES public."JUR_NOTIFICACOES"(id) ON DELETE CASCADE,
  acao            text NOT NULL,
  detalhe         text,
  autor_id        uuid DEFAULT auth.uid(),
  autor_nome      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jur_notificacao_historico_notif ON public."JUR_NOTIFICACAO_HISTORICO" (notificacao_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.jur_notificacao_hist(p_id bigint, p_acao text, p_detalhe text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_nome text;
BEGIN
  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public."JUR_NOTIFICACAO_HISTORICO" (notificacao_id, acao, detalhe, autor_id, autor_nome)
  VALUES (p_id, p_acao, p_detalhe, auth.uid(), coalesce(v_nome, 'Sistema'));
END $$;
REVOKE ALL ON FUNCTION public.jur_notificacao_hist(bigint, text, text) FROM PUBLIC, anon, authenticated;

-- O que muda na ocorrência e vale registrar, com rótulo legível.
CREATE OR REPLACE FUNCTION public.jur_notificacao_depois()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_mud text[] := '{}';
  c record;
  v_old jsonb; v_new jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.jur_notificacao_hist(NEW.id, 'Ocorrência registrada',
      NEW.tipo || ' · ' || NEW.assunto || coalesce(' · ' || public.jur_brl(NEW.valor_original), ''));
    RETURN NEW;
  END IF;
  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  FOR c IN SELECT * FROM (VALUES
      ('etapa', 'Etapa'), ('resultado', 'Resultado'), ('desfecho_financeiro', 'Desfecho financeiro'),
      ('valor_original', 'Valor original'), ('valor_final', 'Valor final'), ('valor_descontado', 'Valor descontado/pago'),
      ('prazo_defesa', 'Prazo de defesa'), ('responsavel_nome', 'Responsável'), ('setor_responsavel', 'Setor responsável'),
      ('tipo', 'Tipo'), ('contrato', 'Contrato'), ('orgao', 'Órgão / contratante'), ('data_desfecho', 'Data do desfecho'),
      ('medida_preventiva', 'Medida preventiva'), ('medida_concluida', 'Medida preventiva concluída')
    ) AS t(campo, rotulo)
  LOOP
    IF v_old -> c.campo IS DISTINCT FROM v_new -> c.campo THEN
      v_mud := v_mud || (c.rotulo || ': ' ||
        CASE WHEN c.campo LIKE 'valor_%'
             THEN coalesce(public.jur_brl((v_old ->> c.campo)::numeric), '—') || ' → ' || coalesce(public.jur_brl((v_new ->> c.campo)::numeric), '—')
             WHEN c.campo IN ('prazo_defesa', 'data_desfecho')
             THEN coalesce(to_char((v_old ->> c.campo)::date, 'DD/MM/YYYY'), '—') || ' → ' || coalesce(to_char((v_new ->> c.campo)::date, 'DD/MM/YYYY'), '—')
             WHEN c.campo = 'medida_concluida'
             THEN CASE WHEN (v_new ->> c.campo)::boolean THEN 'Sim' ELSE 'Não' END
             ELSE coalesce(v_old ->> c.campo, '—') || ' → ' || coalesce(v_new ->> c.campo, '—') END);
    END IF;
  END LOOP;
  IF array_length(v_mud, 1) > 0 THEN
    PERFORM public.jur_notificacao_hist(NEW.id,
      CASE WHEN NEW.etapa IS DISTINCT FROM OLD.etapa THEN 'Etapa: ' || NEW.etapa ELSE 'Ocorrência alterada' END,
      array_to_string(v_mud, E'\n'));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_jur_notificacao_depois ON public."JUR_NOTIFICACOES";
CREATE TRIGGER trg_jur_notificacao_depois AFTER INSERT OR UPDATE ON public."JUR_NOTIFICACOES"
  FOR EACH ROW EXECUTE FUNCTION public.jur_notificacao_depois();

CREATE OR REPLACE FUNCTION public.jur_notificacao_defesa_depois()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.jur_notificacao_hist(OLD.notificacao_id, OLD.instancia || ' excluída', NULL);
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.jur_notificacao_hist(NEW.notificacao_id, NEW.instancia || ' lançada',
      concat_ws(' · ', 'Prazo ' || to_char(NEW.prazo, 'DD/MM/YYYY'), 'Protocolo ' || NEW.numero_protocolo,
                'Protocolada em ' || to_char(NEW.data_protocolo, 'DD/MM/YYYY')));
  ELSIF NEW.resultado IS DISTINCT FROM OLD.resultado OR NEW.valor_apos IS DISTINCT FROM OLD.valor_apos
        OR NEW.data_protocolo IS DISTINCT FROM OLD.data_protocolo THEN
    PERFORM public.jur_notificacao_hist(NEW.notificacao_id, NEW.instancia || ': ' || NEW.resultado,
      concat_ws(' · ', 'Protocolada em ' || to_char(NEW.data_protocolo, 'DD/MM/YYYY'),
                'Decisão em ' || to_char(NEW.data_resultado, 'DD/MM/YYYY'),
                'Valor após: ' || public.jur_brl(NEW.valor_apos)));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_jur_notificacao_defesa_depois ON public."JUR_NOTIFICACAO_DEFESAS";
CREATE TRIGGER trg_jur_notificacao_defesa_depois AFTER INSERT OR UPDATE OR DELETE ON public."JUR_NOTIFICACAO_DEFESAS"
  FOR EACH ROW EXECUTE FUNCTION public.jur_notificacao_defesa_depois();
-- updated_at da defesa (o AFTER acima não consegue mexer em NEW).
CREATE OR REPLACE FUNCTION public.jur_notificacao_defesa_antes()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_jur_notificacao_defesa_antes ON public."JUR_NOTIFICACAO_DEFESAS";
CREATE TRIGGER trg_jur_notificacao_defesa_antes BEFORE UPDATE ON public."JUR_NOTIFICACAO_DEFESAS"
  FOR EACH ROW EXECUTE FUNCTION public.jur_notificacao_defesa_antes();

CREATE OR REPLACE FUNCTION public.jur_notificacao_anexo_depois()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.jur_notificacao_hist(OLD.notificacao_id, 'Documento removido', OLD.categoria || ' · ' || OLD.nome);
    RETURN OLD;
  END IF;
  PERFORM public.jur_notificacao_hist(NEW.notificacao_id, 'Documento anexado', NEW.categoria || ' · ' || NEW.nome);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_jur_notificacao_anexo_depois ON public."JUR_NOTIFICACAO_ANEXOS";
CREATE TRIGGER trg_jur_notificacao_anexo_depois AFTER INSERT OR DELETE ON public."JUR_NOTIFICACAO_ANEXOS"
  FOR EACH ROW EXECUTE FUNCTION public.jur_notificacao_anexo_depois();

-- 6) RLS -------------------------------------------------------------------
ALTER TABLE public."JUR_NOTIFICACOES"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JUR_NOTIFICACAO_DEFESAS"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JUR_NOTIFICACAO_ANEXOS"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JUR_NOTIFICACAO_HISTORICO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."JUR_NOTIFICACOES", public."JUR_NOTIFICACAO_DEFESAS", public."JUR_NOTIFICACAO_ANEXOS" TO authenticated;
GRANT SELECT ON public."JUR_NOTIFICACAO_HISTORICO" TO authenticated;

DROP POLICY IF EXISTS jur_notificacoes_select ON public."JUR_NOTIFICACOES";
CREATE POLICY jur_notificacoes_select ON public."JUR_NOTIFICACOES" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'visualizar'::public.app_acao));
DROP POLICY IF EXISTS jur_notificacoes_insert ON public."JUR_NOTIFICACOES";
CREATE POLICY jur_notificacoes_insert ON public."JUR_NOTIFICACOES" FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'incluir'::public.app_acao));
DROP POLICY IF EXISTS jur_notificacoes_update ON public."JUR_NOTIFICACOES";
CREATE POLICY jur_notificacoes_update ON public."JUR_NOTIFICACOES" FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'alterar'::public.app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'alterar'::public.app_acao));
DROP POLICY IF EXISTS jur_notificacoes_delete ON public."JUR_NOTIFICACOES";
CREATE POLICY jur_notificacoes_delete ON public."JUR_NOTIFICACOES" FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'excluir'::public.app_acao));

-- Defesas e documentos: ver com visualizar, mexer com alterar (fazem parte
-- da ocorrência — lançar a defesa é trabalhar nela, não criar outra).
DROP POLICY IF EXISTS jur_notificacao_defesas_select ON public."JUR_NOTIFICACAO_DEFESAS";
CREATE POLICY jur_notificacao_defesas_select ON public."JUR_NOTIFICACAO_DEFESAS" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'visualizar'::public.app_acao));
DROP POLICY IF EXISTS jur_notificacao_defesas_write ON public."JUR_NOTIFICACAO_DEFESAS";
CREATE POLICY jur_notificacao_defesas_write ON public."JUR_NOTIFICACAO_DEFESAS" FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'alterar'::public.app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS jur_notificacao_anexos_select ON public."JUR_NOTIFICACAO_ANEXOS";
CREATE POLICY jur_notificacao_anexos_select ON public."JUR_NOTIFICACAO_ANEXOS" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'visualizar'::public.app_acao));
DROP POLICY IF EXISTS jur_notificacao_anexos_write ON public."JUR_NOTIFICACAO_ANEXOS";
CREATE POLICY jur_notificacao_anexos_write ON public."JUR_NOTIFICACAO_ANEXOS" FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'alterar'::public.app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS jur_notificacao_historico_select ON public."JUR_NOTIFICACAO_HISTORICO";
CREATE POLICY jur_notificacao_historico_select ON public."JUR_NOTIFICACAO_HISTORICO" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'juridico_notificacoes', 'visualizar'::public.app_acao));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TABLE IF EXISTS public."JUR_NOTIFICACAO_HISTORICO", public."JUR_NOTIFICACAO_ANEXOS",
--   public."JUR_NOTIFICACAO_DEFESAS", public."JUR_NOTIFICACOES" CASCADE;
-- DROP FUNCTION IF EXISTS public.jur_notificacao_antes_inserir(), public.jur_notificacao_antes_atualizar(),
--   public.jur_notificacao_hist(bigint, text, text), public.jur_notificacao_depois(),
--   public.jur_notificacao_defesa_depois(), public.jur_notificacao_defesa_antes(), public.jur_notificacao_anexo_depois(),
--   public.jur_brl(numeric);
-- DROP POLICY IF EXISTS "juridico notificacoes arquivo select" ON storage.objects;
-- DROP POLICY IF EXISTS "juridico notificacoes arquivo insert" ON storage.objects;
-- DROP POLICY IF EXISTS "juridico notificacoes arquivo delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'juridico-notificacoes';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'juridico_notificacoes';
-- DELETE FROM public.app_menu WHERE codigo = 'juridico_notificacoes';
-- NOTIFY pgrst, 'reload schema';
