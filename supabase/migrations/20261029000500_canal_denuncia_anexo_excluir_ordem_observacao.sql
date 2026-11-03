-- =========================================================================
-- Comitê de Ética › ficha da denúncia › "Anexos e evidências":
-- APAGAR, ORGANIZAR e OBSERVAÇÃO por documento (29/10/2026)
--
-- PEDIDO
--   1. Excluir um documento, com confirmação, ficando no histórico quem
--      apagou, quando, o nome do arquivo e o tipo.
--   2. Arrastar os documentos para mudar a ordem — ordem gravada no banco,
--      a mesma para todo mundo.
--   3. Um campo de observação por documento, que também vai ao histórico.
--
-- O QUE NÃO MUDA
--   O arquivo que veio com o relato (origem = 'denunciante') continua sem
--   poder ser excluído por NINGUÉM. Até aqui isso era garantido por ausência
--   (não havia policy de DELETE nem GRANT DELETE). Como agora existe um
--   caminho de exclusão, a regra vira trava explícita em dois lugares:
--     · a RPC recusa;
--     · um gatilho BEFORE DELETE recusa mesmo para service_role/dono —
--       só deixa passar a cascata de quando a própria denúncia some.
--
-- DESENHO
--   · DELETE continua sem GRANT para `authenticated`: o único caminho é a
--     RPC canal_denuncia_anexo_excluir, que confere acesso à denúncia (o
--     mesmo do UPDATE: canal_denuncia_visivel_por_id), sigilo e origem,
--     grava o evento e devolve o storage_path para a tela apagar o arquivo.
--   · Apagar o objeto do bucket: policy de DELETE em storage.objects que só
--     alcança arquivo do Comitê (`<denuncia>/comite/...`) SEM linha em
--     CANAL_DENUNCIA_ANEXO. Arquivo com linha (inclusive o do denunciante)
--     não sai pelo storage. De quebra, conserta o `remove()` que a tela já
--     fazia quando o INSERT da linha falhava e que morria calado por falta
--     de policy.
--   · Ordem: coluna `ordem`, preenchida por gatilho no INSERT (inclusive o
--     da edge function denuncia-anexar). Reordenar é RPC SECURITY INVOKER:
--     roda com a RLS de quem chama, então quem não vê os sigilosos só mexe
--     nos que vê — e os sigilosos ficam nas posições onde estavam.
--   · Observação: coluna nova `observacao`. NÃO reaproveita `descricao`,
--     que é o texto que o denunciante mandou junto com o arquivo (é prova).
--   · Histórico: CANAL_DENUNCIA_EVENTO ganha `objeto` (de qual arquivo é a
--     linha) e `sensivel`. Evento de anexo sigiloso carrega o nome do
--     arquivo — e o nome já diz muito ("Entrevista <nome> - VITIMA.pdf").
--     Por isso evento sensível só aparece para quem tem comite_etica_sigilo,
--     igual ao próprio anexo.
--
-- Idempotente.
-- =========================================================================

-- ── 1. Colunas novas ─────────────────────────────────────────────────
ALTER TABLE public."CANAL_DENUNCIA_ANEXO"
  ADD COLUMN IF NOT EXISTS ordem      integer,
  ADD COLUMN IF NOT EXISTS observacao text;

COMMENT ON COLUMN public."CANAL_DENUNCIA_ANEXO".ordem IS
  'Posicao do documento na lista da ficha. Uma so para todos; reordenar pela RPC canal_denuncia_anexo_reordenar.';
COMMENT ON COLUMN public."CANAL_DENUNCIA_ANEXO".observacao IS
  'Observacao do Comite sobre o documento. Diferente de descricao, que e o texto do denunciante. Mudanca vai para CANAL_DENUNCIA_EVENTO.';

-- Ordem inicial = a ordem de chegada, que é como a tela listava até hoje.
UPDATE public."CANAL_DENUNCIA_ANEXO" a
   SET ordem = x.n
  FROM (SELECT id, row_number() OVER (PARTITION BY denuncia_id ORDER BY created_at, id) AS n
          FROM public."CANAL_DENUNCIA_ANEXO") x
 WHERE a.id = x.id AND a.ordem IS NULL;

CREATE INDEX IF NOT EXISTS idx_canal_anexo_denuncia_ordem
  ON public."CANAL_DENUNCIA_ANEXO"(denuncia_id, ordem);

ALTER TABLE public."CANAL_DENUNCIA_EVENTO"
  ADD COLUMN IF NOT EXISTS objeto   text,
  ADD COLUMN IF NOT EXISTS sensivel boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."CANAL_DENUNCIA_EVENTO".objeto IS
  'Sobre o que e a linha, quando nao e um campo da ficha (ex.: o nome do anexo excluido).';
COMMENT ON COLUMN public."CANAL_DENUNCIA_EVENTO".sensivel IS
  'Evento de anexo sigiloso: so quem tem comite_etica_sigilo le (o nome do arquivo ja expoe).';

-- ── 2. Ordem no INSERT ───────────────────────────────────────────────
-- Vale para a tela e para a edge function (service_role): todo arquivo novo
-- entra no fim da lista.
CREATE OR REPLACE FUNCTION public.canal_denuncia_anexo_ordem_inicial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.ordem IS NULL THEN
    SELECT COALESCE(max(ordem), 0) + 1 INTO NEW.ordem
      FROM public."CANAL_DENUNCIA_ANEXO" WHERE denuncia_id = NEW.denuncia_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_canal_anexo_ordem_inicial ON public."CANAL_DENUNCIA_ANEXO";
CREATE TRIGGER trg_canal_anexo_ordem_inicial
  BEFORE INSERT ON public."CANAL_DENUNCIA_ANEXO"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_anexo_ordem_inicial();

-- ── 3. Trava: arquivo do denunciante não sai ─────────────────────────
-- A exceção é a cascata de quando a denúncia inteira é removida: nesse
-- momento a linha-mãe já não existe para esta transação.
CREATE OR REPLACE FUNCTION public.canal_denuncia_anexo_nao_excluir_denunciante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.origem = 'denunciante'
     AND EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d WHERE d.id = OLD.denuncia_id) THEN
    RAISE EXCEPTION 'Arquivo enviado pelo denunciante não pode ser excluído — é prova do que foi entregue.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_canal_anexo_nao_excluir_denunciante ON public."CANAL_DENUNCIA_ANEXO";
CREATE TRIGGER trg_canal_anexo_nao_excluir_denunciante
  BEFORE DELETE ON public."CANAL_DENUNCIA_ANEXO"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_anexo_nao_excluir_denunciante();

-- ── 4. Observação vai para o histórico ───────────────────────────────
-- DEFINER porque `authenticated` só tem SELECT em CANAL_DENUNCIA_EVENTO —
-- o histórico é escrito por gatilho, nunca pela aplicação.
CREATE OR REPLACE FUNCTION public.canal_denuncia_anexo_registrar_observacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_nome text;
BEGIN
  IF NULLIF(btrim(NEW.observacao), '') IS NOT DISTINCT FROM NULLIF(btrim(OLD.observacao), '') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."CANAL_DENUNCIA_EVENTO"
    (denuncia_id, campo, objeto, de, para, por_user_id, por_nome, sensivel)
  VALUES
    (NEW.denuncia_id, 'anexo_observacao', NEW.nome_arquivo,
     NULLIF(btrim(OLD.observacao), ''), NULLIF(btrim(NEW.observacao), ''),
     auth.uid(), v_nome, NEW.sensivel);

  UPDATE public."CANAL_DENUNCIA" SET ultima_movimentacao_em = now()
   WHERE id = NEW.denuncia_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_canal_anexo_registrar_observacao ON public."CANAL_DENUNCIA_ANEXO";
CREATE TRIGGER trg_canal_anexo_registrar_observacao
  AFTER UPDATE OF observacao ON public."CANAL_DENUNCIA_ANEXO"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_anexo_registrar_observacao();

-- ── 5. Excluir ───────────────────────────────────────────────────────
-- Devolve o storage_path: quem apaga o objeto do bucket é a tela, pela
-- policy da seção 7 (o storage não é apagado de dentro do SQL).
CREATE OR REPLACE FUNCTION public.canal_denuncia_anexo_excluir(_anexo uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  a      public."CANAL_DENUNCIA_ANEXO"%ROWTYPE;
  v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO a FROM public."CANAL_DENUNCIA_ANEXO" WHERE id = _anexo FOR UPDATE;
  -- Mesma resposta para "não existe" e "não é seu": não confirma a existência
  -- de anexo (sigiloso ou de outra empresa) para quem não alcança.
  IF NOT FOUND
     OR NOT public.canal_denuncia_visivel_por_id(a.denuncia_id)
     OR (a.sensivel AND NOT public.tem_acesso_menu('comite_etica_sigilo')) THEN
    RAISE EXCEPTION 'Anexo não encontrado ou sem acesso.' USING ERRCODE = '42501';
  END IF;

  IF a.origem = 'denunciante' THEN
    RAISE EXCEPTION 'Arquivo enviado pelo denunciante não pode ser excluído — é prova do que foi entregue.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."CANAL_DENUNCIA_EVENTO"
    (denuncia_id, campo, objeto, de, para, por_user_id, por_nome, sensivel)
  VALUES
    (a.denuncia_id, 'anexo_excluido', a.nome_arquivo, a.categoria, 'excluido',
     auth.uid(), v_nome, a.sensivel);

  DELETE FROM public."CANAL_DENUNCIA_ANEXO" WHERE id = a.id;

  UPDATE public."CANAL_DENUNCIA" SET ultima_movimentacao_em = now()
   WHERE id = a.denuncia_id;

  RETURN a.storage_path;
END $$;

REVOKE ALL ON FUNCTION public.canal_denuncia_anexo_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_anexo_excluir(uuid) TO authenticated;

-- ── 6. Reordenar ─────────────────────────────────────────────────────
-- INVOKER: a RLS de quem chama decide o que ele enxerga e pode atualizar.
-- `_ids` é a lista VISÍVEL na nova ordem; os valores de `ordem` que esses
-- itens já ocupavam são redistribuídos entre eles, então um sigiloso que a
-- pessoa não vê fica exatamente onde estava.
CREATE OR REPLACE FUNCTION public.canal_denuncia_anexo_reordenar(_denuncia uuid, _ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_qtd int;
BEGIN
  IF NOT public.canal_denuncia_visivel_por_id(_denuncia) THEN
    RAISE EXCEPTION 'Sem acesso a esta denúncia.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_qtd FROM public."CANAL_DENUNCIA_ANEXO"
   WHERE denuncia_id = _denuncia AND id = ANY(_ids);
  IF v_qtd <> COALESCE(cardinality(_ids), 0)
     OR v_qtd <> (SELECT count(DISTINCT x) FROM unnest(_ids) x) THEN
    RAISE EXCEPTION 'A lista de anexos mudou. Recarregue a ficha e tente de novo.';
  END IF;

  WITH posicoes AS (
    SELECT ordem, row_number() OVER (ORDER BY ordem, id) AS n
      FROM public."CANAL_DENUNCIA_ANEXO"
     WHERE denuncia_id = _denuncia AND id = ANY(_ids)
  ), nova AS (
    SELECT u.id, u.n FROM unnest(_ids) WITH ORDINALITY AS u(id, n)
  )
  UPDATE public."CANAL_DENUNCIA_ANEXO" a
     SET ordem = p.ordem
    FROM nova JOIN posicoes p ON p.n = nova.n
   WHERE a.id = nova.id
     AND a.denuncia_id = _denuncia
     AND a.ordem IS DISTINCT FROM p.ordem;
END $$;

REVOKE ALL ON FUNCTION public.canal_denuncia_anexo_reordenar(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_anexo_reordenar(uuid, uuid[]) TO authenticated;

-- ── 7. Storage: apagar só arquivo do Comitê que ficou sem linha ──────
-- DEFINER: a consulta a CANAL_DENUNCIA_ANEXO não pode passar pela RLS de
-- quem chama — um sigiloso invisível pareceria "sem linha" e sairia.
CREATE OR REPLACE FUNCTION public.canal_denuncia_arquivo_orfao(_nome text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF split_part(COALESCE(_nome, ''), '/', 2) <> 'comite' THEN
    RETURN false;
  END IF;
  RETURN public.canal_denuncia_visivel_por_caminho(_nome)
     AND NOT EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA_ANEXO" WHERE storage_path = _nome);
END $$;

REVOKE ALL ON FUNCTION public.canal_denuncia_arquivo_orfao(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_arquivo_orfao(text) TO authenticated;

DROP POLICY IF EXISTS "denuncia evid excluir orfao" ON storage.objects;
CREATE POLICY "denuncia evid excluir orfao" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'denuncia-evidencias' AND public.canal_denuncia_arquivo_orfao(name));

-- ── 8. Evento sigiloso só para quem tem sigilo ───────────────────────
-- Mesmas duas policies de leitura do histórico (comitê e Presidência), com
-- o mesmo filtro que o anexo já tem.
DROP POLICY IF EXISTS canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO";
CREATE POLICY canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO"
  FOR SELECT TO authenticated
  USING ((NOT sensivel OR public.tem_acesso_menu('comite_etica_sigilo'))
         AND public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_evento_presidencia_select ON public."CANAL_DENUNCIA_EVENTO";
CREATE POLICY canal_evento_presidencia_select ON public."CANAL_DENUNCIA_EVENTO"
  FOR SELECT TO authenticated
  USING ((NOT sensivel OR public.tem_acesso_menu('comite_etica_sigilo'))
         AND public.canal_denuncia_presidencia_ve_por_id(denuncia_id));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP POLICY IF EXISTS canal_evento_presidencia_select ON public."CANAL_DENUNCIA_EVENTO";
-- CREATE POLICY canal_evento_presidencia_select ON public."CANAL_DENUNCIA_EVENTO"
--   FOR SELECT TO authenticated USING (public.canal_denuncia_presidencia_ve_por_id(denuncia_id));
-- DROP POLICY IF EXISTS canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO";
-- CREATE POLICY canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO"
--   FOR SELECT TO authenticated USING (public.canal_denuncia_visivel_por_id(denuncia_id));
-- DROP POLICY IF EXISTS "denuncia evid excluir orfao" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.canal_denuncia_arquivo_orfao(text);
-- DROP FUNCTION IF EXISTS public.canal_denuncia_anexo_reordenar(uuid, uuid[]);
-- DROP FUNCTION IF EXISTS public.canal_denuncia_anexo_excluir(uuid);
-- DROP TRIGGER IF EXISTS trg_canal_anexo_registrar_observacao ON public."CANAL_DENUNCIA_ANEXO";
-- DROP FUNCTION IF EXISTS public.canal_denuncia_anexo_registrar_observacao();
-- DROP TRIGGER IF EXISTS trg_canal_anexo_ordem_inicial ON public."CANAL_DENUNCIA_ANEXO";
-- DROP FUNCTION IF EXISTS public.canal_denuncia_anexo_ordem_inicial();
-- -- A trava do denunciante (seção 3) pode ficar: não depende do resto.
-- -- As colunas (ordem, observacao, objeto, sensivel) ficam — dropar perde dado.
-- NOTIFY pgrst, 'reload schema';
