-- =========================================================================
-- SIS-2026-0598 — bolinha no menu para os Logins (06/10/2026)
--
-- Acrescenta à minhas_pendencias_aprovacao (mig 20261006000006) duas filas:
--   · Sistemas › Logins (sistemas_logins alterar): login a criar
--     ('pendente') + demitido com login ainda não tratado;
--   · Minhas Solicitações (quem pediu a vaga): login pronto ('criado')
--     esperando ser repassado.
-- Troca só o final da função vigente (antes do RETURN), para não reescrever
-- as regras de aprovação que já estão nela.
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

DO $$
DECLARE v_def text; v_novo text;
BEGIN
  v_def := pg_get_functiondef('public.minhas_pendencias_aprovacao()'::regprocedure);
  IF v_def LIKE '%SIS_LOGIN_PEDIDO%' THEN RETURN; END IF;  -- já aplicado
  v_novo := replace(v_def, E'  RETURN v_out;\nEND', $blk$
  -- ── Sistemas › Logins (SIS-2026-0598) ─────────────────────────────────
  IF public.has_screen_access(v_uid, 'sistemas_logins', 'alterar'::public.app_acao) THEN
    SELECT (SELECT count(*) FROM public."SIS_LOGIN_PEDIDO" WHERE status = 'pendente')
         + (SELECT count(*) FROM public."EMPREGADOS" e
              JOIN auth.users u ON u.id = e.auth_user_id
              LEFT JOIN public."SIS_LOGIN_DESLIGAMENTO" d ON d.auth_user_id = u.id
             WHERE e."Situação" = 'Demitido' AND d.auth_user_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" o
                                WHERE o.auth_user_id = e.auth_user_id AND public.esp_col_esta_ativo(o."Situação")))
      INTO n;
    IF n > 0 THEN v_out := v_out || jsonb_build_object('/app/sistemas/logins', n); END IF;
  END IF;
  -- Login pronto da vaga que EU pedi (solicitante_email = e-mail do meu login).
  SELECT count(*) INTO n FROM public."SIS_LOGIN_PEDIDO" p
   WHERE p.status = 'criado'
     AND p.solicitante_email = (SELECT lower(u.email) FROM auth.users u WHERE u.id = v_uid);
  IF n > 0 THEN
    v_out := v_out || jsonb_build_object('/app/encarregados/minhas-solicitacoes', n, '/app/central-servicos/solicitacoes', n);
  END IF;

  RETURN v_out;
END$blk$);
  IF v_novo = v_def THEN
    RAISE EXCEPTION 'minhas_pendencias_aprovacao mudou: não achei o RETURN final.';
  END IF;
  EXECUTE v_novo;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar minhas_pendencias_aprovacao da mig 20261006000006.
