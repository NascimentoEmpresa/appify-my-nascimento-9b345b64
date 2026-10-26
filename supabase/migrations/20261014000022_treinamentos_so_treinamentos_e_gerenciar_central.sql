-- =========================================================================
-- TREINAMENTOS: tudo em Treinamentos + "Pode adicionar treinamentos" na
-- Central de Serviços (14/10/2026)
--
-- Pedido do Pablo, depois de ver a mig 20261014000020 no ar: "tira o
-- Treinamentos Sistemas, deixa só Treinamentos — é a mesma coisa", e
-- "adiciona no gerenciamento de acesso quem pode adicionar treinamentos no
-- Central de Serviços".
--
--   1. A grade `sistemas` sai. Treinamento que estava marcado nela vai para a
--      Central de Serviços (é onde a tela fica); o CHECK, o
--      trn_pode_ver_escopos e a leitura do bucket voltam ao que eram. A rota
--      /treinamentos-sistemas continua só como a tela de confirmar o
--      treinamento de chamado (mig 273), fora do menu.
--   2. Menu fantasma `central_servicos_treinamentos_gerenciar` ("Pode
--      adicionar treinamentos") no módulo Central de Serviços, com incluir /
--      alterar / excluir. Dá o mesmo que o `treinamentos_gerenciar`, mas só
--      para treinamento que é SÓ da Central (escopos = {central_servicos}):
--      quem cuida da Central não reescreve o treinamento dos Encarregados.
--      trn_pode_gerenciar() passa a reconhecê-lo (rascunho, upload no bucket,
--      gabarito, alertas), e as policies de escrita do TREINAMENTOS também.
--   3. As notificações do alerta de prova apontam para Treinamentos
--      (?alertas=1 abre o painel de alertas na própria grade).
--
-- DEPENDE da 20261014000020 (já mergeada) — aplicar depois dela.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Sai a grade `sistemas` ───────────────────────────────────────────
UPDATE public."TREINAMENTOS"
   SET escopos = CASE
         WHEN cardinality(array_remove(escopos, 'sistemas')) = 0 THEN ARRAY['central_servicos']::text[]
         WHEN 'central_servicos' = ANY(escopos) THEN array_remove(escopos, 'sistemas')
         ELSE array_append(array_remove(escopos, 'sistemas'), 'central_servicos')
       END
 WHERE 'sistemas' = ANY(escopos);

ALTER TABLE public."TREINAMENTOS" DROP CONSTRAINT IF EXISTS trn_escopos_validos;
ALTER TABLE public."TREINAMENTOS" ADD CONSTRAINT trn_escopos_validos CHECK (
  cardinality(escopos) > 0
  AND escopos <@ ARRAY['encarregados', 'central_servicos']::text[]
);

-- O par exato de antes (mig 20260930000055): cada grade, o seu menu.
CREATE OR REPLACE FUNCTION public.trn_pode_ver_escopos(_escopos text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT ('encarregados' = ANY(_escopos)
          AND public.can_access(auth.uid(), 'treinamentos_erp', 'visualizar'::public.app_acao))
      OR ('central_servicos' = ANY(_escopos)
          AND public.can_access(auth.uid(), 'central_servicos_treinamentos', 'visualizar'::public.app_acao));
$$;
REVOKE ALL ON FUNCTION public.trn_pode_ver_escopos(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_pode_ver_escopos(text[]) TO authenticated;

-- Leitura do bucket só para a grade `sistemas`, que não existe mais. A
-- trn_stg_read (mig 20260925000001) segue valendo para as duas grades.
-- portaria-ok: R3 — policy da grade `sistemas` (mig 20261014000020), que saiu; a trn_stg_read cobre o bucket
DROP POLICY IF EXISTS trn_stg_read_sistemas ON storage.objects;

-- ── 2) "Pode adicionar treinamentos" na Central de Serviços ─────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'central_servicos_treinamentos_gerenciar', 'Pode adicionar treinamentos', NULL, 76, true
  FROM public.app_modulo m
 WHERE m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

UPDATE public.app_menu SET ativo = true WHERE codigo = 'central_servicos_treinamentos_gerenciar';

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('central_servicos_treinamentos_gerenciar', 'incluir'::public.app_acao),
       ('central_servicos_treinamentos_gerenciar', 'alterar'::public.app_acao),
       ('central_servicos_treinamentos_gerenciar', 'excluir'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trn_pode_gerenciar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.can_access(auth.uid(), 'treinamentos_gerenciar', 'incluir'::public.app_acao)
      OR public.can_access(auth.uid(), 'treinamentos_gerenciar', 'alterar'::public.app_acao)
      -- 14/10/2026 (mig 20261014000022): quem adiciona treinamentos na Central.
      OR public.can_access(auth.uid(), 'central_servicos_treinamentos_gerenciar', 'incluir'::public.app_acao)
      OR public.can_access(auth.uid(), 'central_servicos_treinamentos_gerenciar', 'alterar'::public.app_acao);
$$;
REVOKE EXECUTE ON FUNCTION public.trn_pode_gerenciar() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.trn_pode_gerenciar() TO authenticated;

-- Escrita: o menu do módulo Treinamentos alcança tudo; o da Central, só o
-- treinamento que é só da Central.
DROP POLICY IF EXISTS trn_insert ON public."TREINAMENTOS";
CREATE POLICY trn_insert ON public."TREINAMENTOS" FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'treinamentos_gerenciar', 'incluir'::public.app_acao)
    OR (public.can_access(auth.uid(), 'central_servicos_treinamentos_gerenciar', 'incluir'::public.app_acao)
        AND "TREINAMENTOS".escopos <@ ARRAY['central_servicos']::text[])
  );
DROP POLICY IF EXISTS trn_update ON public."TREINAMENTOS";
CREATE POLICY trn_update ON public."TREINAMENTOS" FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'treinamentos_gerenciar', 'alterar'::public.app_acao)
    OR (public.can_access(auth.uid(), 'central_servicos_treinamentos_gerenciar', 'alterar'::public.app_acao)
        AND "TREINAMENTOS".escopos <@ ARRAY['central_servicos']::text[])
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'treinamentos_gerenciar', 'alterar'::public.app_acao)
    OR (public.can_access(auth.uid(), 'central_servicos_treinamentos_gerenciar', 'alterar'::public.app_acao)
        AND "TREINAMENTOS".escopos <@ ARRAY['central_servicos']::text[])
  );
DROP POLICY IF EXISTS trn_delete ON public."TREINAMENTOS";
CREATE POLICY trn_delete ON public."TREINAMENTOS" FOR DELETE TO authenticated
  USING (
    public.can_access(auth.uid(), 'treinamentos_gerenciar', 'excluir'::public.app_acao)
    OR (public.can_access(auth.uid(), 'central_servicos_treinamentos_gerenciar', 'excluir'::public.app_acao)
        AND "TREINAMENTOS".escopos <@ ARRAY['central_servicos']::text[])
  );

-- ── 3) Notificações apontam para Treinamentos ───────────────────────────
-- (as duas funções da mig 20261014000020, só com o link trocado)
CREATE OR REPLACE FUNCTION public.trn_notificar_alerta(_alerta public."TREINAMENTO_ALERTA")
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT p.id,
         'Treinamento: ' || coalesce(_alerta.usuario_nome, 'colaborador') || ' reprovou ' || _alerta.tentativas || 'x',
         coalesce(_alerta.usuario_nome, 'Um colaborador') || ' não atingiu a nota mínima ('
           || coalesce(_alerta.nota_minima::text, '?') || '%) em "' || coalesce(_alerta.treinamento_titulo, 'treinamento')
           || '" depois de ' || _alerta.tentativas || ' tentativas (última: ' || coalesce(_alerta.ultima_nota::text, '?')
           || '%). A prova ficou travada até alguém verificar.',
         'treinamento_alerta',
         '/app/central-servicos/treinamentos?alertas=1'
    FROM public.profiles p
   WHERE p.id <> _alerta.user_id
     AND (public.can_access(p.id, 'treinamentos_alertas', 'visualizar'::public.app_acao)
          OR public.can_access(p.id, 'treinamentos_gerenciar', 'alterar'::public.app_acao));
EXCEPTION WHEN others THEN
  -- Avisar não pode desfazer a tentativa: o alerta já está gravado e aparece na tela.
  RAISE WARNING 'trn_notificar_alerta: %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public.trn_notificar_alerta(public."TREINAMENTO_ALERTA") FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trn_alerta_tratar(_alerta uuid, _acao text, _obs text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  a      public."TREINAMENTO_ALERTA";
  v_nome text;
  v_obs  text := nullif(btrim(coalesce(_obs, '')), '');
BEGIN
  IF v_uid IS NULL OR NOT public.trn_pode_tratar_alertas() THEN
    RAISE EXCEPTION 'Você não pode tratar alertas de treinamento. Peça "Recebe alertas de treinamento" (alterar) em Acesso por Usuário › Treinamentos.'
      USING ERRCODE = '42501';
  END IF;
  IF _acao NOT IN ('liberar', 'encerrar') THEN RAISE EXCEPTION 'Ação inválida.'; END IF;
  SELECT * INTO a FROM public."TREINAMENTO_ALERTA" WHERE id = _alerta FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Alerta não encontrado.'; END IF;
  IF a.status <> 'aberto' THEN RAISE EXCEPTION 'Este alerta já foi tratado.'; END IF;
  IF _acao = 'encerrar' AND v_obs IS NULL THEN
    RAISE EXCEPTION 'Para encerrar sem liberar, escreva o que foi verificado.';
  END IF;

  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_nome FROM public.profiles WHERE id = v_uid;
  UPDATE public."TREINAMENTO_ALERTA"
     SET status = CASE WHEN _acao = 'liberar' THEN 'liberado' ELSE 'encerrado' END,
         tratado_por = v_uid, tratado_por_nome = v_nome, tratado_em = now(), tratado_obs = v_obs
   WHERE id = a.id;

  IF _acao = 'liberar' THEN
    UPDATE public."TREINAMENTO_PROVA_ESTADO"
       SET bloqueado = false, falhas_seguidas = 0, liberacoes = liberacoes + 1
     WHERE treinamento_id = a.treinamento_id AND user_id = a.user_id;
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (a.user_id, 'Prova liberada: ' || coalesce(a.treinamento_titulo, 'treinamento'),
              'Você ganhou uma nova rodada de tentativas. Assista o vídeo novamente e refaça a prova.'
                || coalesce(' Observação: ' || v_obs, ''),
              'treinamento_liberado', '/app/central-servicos/treinamentos');
    EXCEPTION WHEN others THEN
      RAISE WARNING 'trn_alerta_tratar (aviso ao colaborador): %', SQLERRM;
    END;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.trn_alerta_tratar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alerta_tratar(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar da 20261014000020: trn_pode_ver_escopos, trn_escopos_validos,
-- trn_stg_read_sistemas, trn_notificar_alerta e trn_alerta_tratar.
-- Reaplicar trn_pode_gerenciar e trn_insert/trn_update/trn_delete da 20260925000001.
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'central_servicos_treinamentos_gerenciar';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'central_servicos_treinamentos_gerenciar';
-- DELETE FROM public.app_menu_acao           WHERE menu_codigo = 'central_servicos_treinamentos_gerenciar';
-- DELETE FROM public.app_menu                WHERE codigo      = 'central_servicos_treinamentos_gerenciar';
-- NOTIFY pgrst, 'reload schema';
