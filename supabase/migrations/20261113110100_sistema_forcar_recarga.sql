-- =========================================================================
-- SISTEMA — FORÇAR TODO MUNDO A RECARREGAR A PÁGINA (12/11/2026)
--
-- O CASO
--   No incidente do Mural do Início (mig 20261113110000), os comentários
--   saíram do servidor, mas quem estava com o Início aberto continuou vendo:
--   desde 03/11 o app não refaz consulta sozinho (refetchOnWindowFocus off,
--   staleTime de minutos — App.tsx), e não havia como mandar as abas abertas
--   recarregarem. Pedido do Pablo: "preciso que de algum jeito todos
--   atualizem obrigatoriamente".
--
-- O DESENHO
--   Uma linha só, "SISTEMA_RECARGA_GERAL", com a hora do último pedido.
--   SEM temporizador (o QA de telas reprova qualquer requisição de tela
--   parada, e com razão — post-mortem de 03/11): cada aba confere quando a
--   PESSOA usa a tela — clique, tecla, rolagem, troca de tela, volta para a
--   aba —, no máximo 1x por minuto (src/lib/recargaGeral.ts).
--   sistema_recarga_idade() devolve há quantos SEGUNDOS foi o último pedido
--   (relógio do banco). A aba compara com há quanto tempo ELA foi aberta
--   (performance.now, relógio dela): pedido mais novo que a aba → recarrega,
--   depois de um sorteio de até 30 s. Nenhum relógio precisa bater com o
--   outro, e abrir a tela não custa requisição nenhuma.
--   Quem pede: sistema_forcar_recarga(), com a capacidade própria
--   'sistema_forcar_recarga' (ação alterar), concedida em Administração ›
--   Acesso por Usuário. Semeada para o Pablo.
--
--   ⚠ Só alcança abas que já carregaram o código novo, e só quando a pessoa
--   mexe na tela — aba esquecida aberta recarrega no primeiro uso.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."SISTEMA_RECARGA_GERAL" (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  versao      bigint NOT NULL DEFAULT 0,
  pedido_em   timestamptz,
  pedido_por  uuid,
  motivo      text
);
INSERT INTO public."SISTEMA_RECARGA_GERAL" (id, versao) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
-- Fechada: só as RPCs abaixo leem e escrevem.
ALTER TABLE public."SISTEMA_RECARGA_GERAL" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SISTEMA_RECARGA_GERAL" FROM anon, authenticated;

-- ── A capacidade ─────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sistema_forcar_recarga', 'FORÇAR TODOS A RECARREGAR O ERP', NULL, 90, true
  FROM public.app_modulo m WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('sistema_forcar_recarga', 'alterar'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT p.id, 'sistema_forcar_recarga', 'alterar'::app_acao, true,
       'Migração 20261113110100: incidente do Mural do Início (12/11/2026)'
  FROM public.profiles p
 WHERE lower(coalesce(p.display_name, '')) LIKE '%pablo flores santarem%'
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = p.id AND x.menu_codigo = 'sistema_forcar_recarga'
                      AND x.acao = 'alterar'::app_acao);

-- ── Leitura: há quantos segundos foi o último pedido (qualquer logado) ───
-- NULL = nunca pediram.
CREATE OR REPLACE FUNCTION public.sistema_recarga_idade()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT round(extract(epoch FROM (now() - pedido_em))::numeric, 1)
    FROM public."SISTEMA_RECARGA_GERAL" WHERE id = 1 AND pedido_em IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.sistema_recarga_idade() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sistema_recarga_idade() TO authenticated;

-- ── Escrita: sobe o número (quem tem a capacidade) ───────────────────────
CREATE OR REPLACE FUNCTION public.sistema_forcar_recarga(p_motivo text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sistema_forcar_recarga', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para forçar a recarga do ERP.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."SISTEMA_RECARGA_GERAL" (id, versao) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
  UPDATE public."SISTEMA_RECARGA_GERAL"
     SET versao = versao + 1, pedido_em = now(), pedido_por = auth.uid(),
         motivo = nullif(btrim(coalesce(p_motivo, '')), '')
   WHERE id = 1
  RETURNING versao INTO v;
  RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.sistema_forcar_recarga(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sistema_forcar_recarga(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.sistema_forcar_recarga(text);
--   DROP FUNCTION IF EXISTS public.sistema_recarga_idade();
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'sistema_forcar_recarga';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sistema_forcar_recarga';
--   DELETE FROM public.app_menu WHERE codigo = 'sistema_forcar_recarga';
--   DROP TABLE IF EXISTS public."SISTEMA_RECARGA_GERAL";
-- =========================================================================
