-- =========================================================================
-- OPERACIONAL › ATIVOS/CONTRATOS e COLABORADORES — as duas telas saem do RH
-- para o Operacional, e Ativos/Contratos ganha ATESTADOS POR DIA (03/11/2026)
--
-- PEDIDO DO PABLO (03/11/2026, com prints das duas telas)
--   1. A tela Ativos/Contratos é alimentada pelos supervisores de cada
--      contrato e precisa mostrar, fácil de ver, quantos estão de atestado
--      em cada dia — por contrato e no total.
--   2. Ativos/Contratos e Colaboradores passam a ficar no módulo Operacional.
--
-- 1. MUDANÇA DE MÓDULO — só app_menu.modulo_id e app_menu.rota
--   A permissão é por CÓDIGO de menu (screen_permission_user.menu_codigo,
--   perfil_acesso_permissao.menu_codigo, list_accessible_menus casa só pelo
--   código). Os códigos NÃO mudam — `colaboradores`, `rh_ativos_contratos`
--   e o fantasma `rh_ativos_contratos_vincular` —, então quem tinha acesso
--   continua com acesso, sem copiar permissão nenhuma. O prefixo `rh_` no
--   código fica: renomear obrigaria a mexer nas RPCs (rh_ac_exige) e nas
--   permissões de todo mundo, para ganhar só estética.
--     /app/rh/colaboradores     → /app/operacional/colaboradores
--     /app/rh/ativos-contratos  → /app/operacional/ativos-contratos
--   As URLs antigas viram redirect ANTES do RouteGuard (ROTAS_MOVIDAS em
--   src/lib/acesso.ts): rota sem app_menu é negada pelo guard antes de o
--   <Navigate> rodar, e favorito/link antigo daria "Acesso negado".
--
-- 2. ATESTADOS POR DIA — rh_ac_atestados_dias(inicio, fim)
--   HOJE a tela conta pela situação atual da EMPREGADOS — a mesma fonte de
--   "Afastados" (rh_ac_painel); nenhuma RPC nova para isso.
--   O espelho da Senior só tem a situação ATUAL, então os dias passados
--   vêm do SST_AFASTAMENTO: a captura sst_afa_capturar_senior (pg_cron de
--   hora em hora, migs 20261029001750/003100) abre um afastamento quando a
--   pessoa entra em "Atestado…" e fecha quando volta a "Trabalhando" — é o
--   histórico da mesma situação, dia a dia. Entram tipo atestado e
--   atestado_acompanhante (régua sst_afa_tipo_da_situacao: ~* 'ATEST'), não
--   cancelados, de qualquer origem (senior, planilha de telemedicina,
--   efetividade, manual). Último dia: sst_afa_fim (dias conhecidos, véspera
--   do retorno, ou hoje se em aberto). Contrato: a lotação gravada na data
--   do afastamento. Uma pessoa conta uma vez por dia e contrato, mesmo com
--   dois registros que se sobrepõem.
--   Peso: um SELECT só, sem por-linha de permissão (rh_ac_exige roda uma
--   vez), limitado a 93 dias; usa o índice de data_inicio se houver.
--
-- Acesso: o mesmo da tela (rh_ac_exige → has_screen_access
-- rh_ativos_contratos visualizar). Os nomes saem para quem já vê os nomes
-- dos afastados no painel — nada além disso (sem CID, sem dias).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Menus: RH → Operacional ───────────────────────────────────────────
UPDATE public.app_menu am
   SET modulo_id = op.id,
       rota = x.rota_nova
  FROM (VALUES
    ('colaboradores',                '/app/operacional/colaboradores'),
    ('rh_ativos_contratos',          '/app/operacional/ativos-contratos'),
    ('rh_ativos_contratos_vincular', NULL)
  ) AS x(codigo, rota_nova),
       public.app_modulo rh,
       public.app_modulo op
 WHERE rh.codigo = 'rh'
   AND op.codigo = 'operacional'
   AND am.modulo_id = rh.id
   AND am.codigo = x.codigo
   AND NOT EXISTS (SELECT 1 FROM public.app_menu y WHERE y.modulo_id = op.id AND y.codigo = x.codigo);

-- ── 2. Atestados por dia ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_ac_atestados_dias(p_inicio date, p_fim date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ini date := COALESCE(p_inicio, current_date - 29);
  v_fim date := LEAST(COALESCE(p_fim, current_date), current_date);
  v_out jsonb;
BEGIN
  PERFORM public.rh_ac_exige();
  IF v_fim < v_ini THEN RETURN '[]'::jsonb; END IF;
  IF v_fim - v_ini > 92 THEN v_ini := v_fim - 92; END IF;

  WITH afa AS MATERIALIZED (
    SELECT a.contrato_id,
           -- Pelo NOME, não pelo empregado_id: a linha importada da planilha
           -- de telemedicina pode vir sem id e a da captura com id — pelo id
           -- a mesma pessoa contaria duas vezes no mesmo dia.
           upper(btrim(a.nome)) AS quem,
           a.nome,
           a.data_inicio AS ini,
           public.sst_afa_fim(a.data_inicio, a.dias_considerados, a.retornou_em) AS fim
      FROM public."SST_AFASTAMENTO" a
     WHERE a.tipo IN ('atestado', 'atestado_acompanhante')
       AND NOT a.cancelado
       AND a.contrato_id IS NOT NULL
       AND a.data_inicio <= v_fim
  ),
  dia AS (
    SELECT DISTINCT ON (f.contrato_id, d.d, f.quem)
           f.contrato_id, d.d::date AS dia, f.nome
      FROM afa f
      CROSS JOIN LATERAL generate_series(GREATEST(f.ini, v_ini), LEAST(f.fim, v_fim), interval '1 day') AS d(d)
     WHERE f.fim >= v_ini
     ORDER BY f.contrato_id, d.d, f.quem
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('contrato_id', g.contrato_id, 'dia', g.dia, 'nomes', g.nomes)
                            ORDER BY g.dia, g.contrato_id), '[]'::jsonb)
    INTO v_out
    FROM (SELECT contrato_id, dia, jsonb_agg(nome ORDER BY nome) AS nomes
            FROM dia GROUP BY contrato_id, dia) g;

  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.rh_ac_atestados_dias(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_ac_atestados_dias(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin):
--   SELECT am.codigo, mo.codigo AS modulo, am.rota FROM public.app_menu am
--     JOIN public.app_modulo mo ON mo.id = am.modulo_id
--    WHERE am.codigo IN ('colaboradores', 'rh_ativos_contratos', 'rh_ativos_contratos_vincular');

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public.app_menu am SET modulo_id = rh.id, rota = x.rota
--   FROM (VALUES ('colaboradores', '/app/rh/colaboradores'),
--                ('rh_ativos_contratos', '/app/rh/ativos-contratos'),
--                ('rh_ativos_contratos_vincular', NULL)) AS x(codigo, rota),
--        public.app_modulo rh, public.app_modulo op
--  WHERE rh.codigo = 'rh' AND op.codigo = 'operacional'
--    AND am.modulo_id = op.id AND am.codigo = x.codigo;
-- DROP FUNCTION IF EXISTS public.rh_ac_atestados_dias(date, date);
-- NOTIFY pgrst, 'reload schema';
