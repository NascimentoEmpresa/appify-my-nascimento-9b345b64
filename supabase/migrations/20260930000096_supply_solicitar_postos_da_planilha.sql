-- =====================================================================
-- Solicitar Materiais: posto da Planilha de Custo aparece para o
-- encarregado, e contrato de outra empresa do grupo deixa de dar 400.
--
-- Incidente de 14/09/2026: em /app/encarregados/solicitar-materiais o
-- contrato CEITEC LIMPEZA - 025/2026 (empresa SN) abria o passo "Posto e
-- Função" com o dropdown vazio, e o console mostrava sup_ext_postos
-- respondendo 400 em loop — com dois postos cadastrados na planilha_custo
-- para ele. Medido em produção no mesmo dia: 14 dos 64 contratos ativos
-- estavam assim (posto na planilha, nenhum posto liberado em sup_posto).
--
-- Eram DUAS causas independentes:
--
--   1. O espelho planilha_custo -> sup_posto (20260930000081) só roda
--      quando alguém abre o CATÁLOGO de Materiais naquele contrato
--      (sup_cat_postos_do_contrato). A tela do encarregado lê sup_posto
--      por sup_ext_postos, que nunca sincronizava. Contrato que o
--      Suprimentos ainda não tinha aberto no catálogo ficava sem posto.
--      Consequência extra: sup_ext_contratos (login Externo) só lista
--      contrato com sup_posto — esses 14 nem apareciam para o externo.
--
--   2. sup_ext_pode_ver_contrato, na versão de 20260930000037, voltou a
--      exigir que a empresa do contrato estivesse em user_empresa. O
--      dropdown de contrato lista TODOS os contratos (contratos é leitura
--      aberta), então o usuário escolhia um contrato da SN estando
--      vinculado só à HAGG, e a RPC recusava com 'Sem acesso a este
--      contrato' — o 400. Isso contraria 20260901000001: no Suprimentos,
--      empresa é informação visual e quem governa acesso é can_access.
--
-- Correção:
--   * a sincronização sai de dentro de sup_cat_postos_do_contrato para uma
--     função interna, sup_posto_sincronizar_planilha, que o catálogo e o
--     sup_ext_postos chamam — as duas telas passam a enxergar o mesmo;
--   * sup_ext_pode_ver_contrato perde o filtro de empresa;
--   * backfill único dos contratos ativos, para o login Externo já
--     enxergar os 14 sem depender de alguém abrir a tela antes.
--
-- ROLLBACK ao final do arquivo.
-- =====================================================================

-- ── 1. Sincronização planilha_custo -> sup_posto (função interna) ────
--
-- Mesmos três passos de 20260930000081, sem mudança de regra:
--   (a) insere posto que a planilha tem e sup_posto não;
--   (b) reativa posto que voltou à planilha;
--   (c) desativa posto que saiu da planilha e não tem função ativa —
--       só quando p_desativar e só se a planilha tem alguma linha.
--
-- Devolve os nomes normalizados da planilha (o catálogo usa para marcar
-- na_planilha), ou NULL se o contrato não existe.
--
-- Sem checagem de permissão DE PROPÓSITO: quem chama é que valida
-- (sup_cat_postos_do_contrato pelo catálogo, sup_ext_postos pelo
-- sup_ext_pode_ver_contrato). Por isso não é concedida a nenhum papel.
CREATE OR REPLACE FUNCTION public.sup_posto_sincronizar_planilha(
  p_contrato_id uuid,
  p_desativar   boolean DEFAULT true
)
RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_empresa   uuid;
  v_contrato  text;
  v_nomes     text[];
  v_norm      text[];
BEGIN
  SELECT c.empresa_id, c.nome INTO v_empresa, v_contrato
    FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RETURN NULL;
  END IF;

  -- contrato_id OU nome: planilha_custo.contrato_id foi preenchido uma vez
  -- (20260714000002) e não há trigger que o mantenha — ver a 081.
  SELECT array_agg(p.nome), array_agg(public.sup_norm_nome(p.nome))
    INTO v_nomes, v_norm
    FROM (
      SELECT DISTINCT btrim(pc.posto) AS nome
        FROM public.planilha_custo pc
       WHERE btrim(coalesce(pc.posto, '')) <> ''
         AND (pc.contrato_id = p_contrato_id
              OR (pc.contrato_id IS NULL
                  AND pc.empresa_id = v_empresa
                  AND public.sup_norm_nome(pc.contrato) = public.sup_norm_nome(v_contrato)))
    ) p;

  v_nomes := coalesce(v_nomes, ARRAY[]::text[]);
  v_norm  := coalesce(v_norm,  ARRAY[]::text[]);

  -- (a) novos — derivado da planilha nasce aprovado (ver a 081)
  INSERT INTO public.sup_posto (empresa_id, contrato_id, nome, ativo, aprovado)
  SELECT v_empresa, p_contrato_id, n, true, true
    FROM unnest(v_nomes) AS n
   WHERE NOT EXISTS (
     SELECT 1 FROM public.sup_posto sp
      WHERE sp.contrato_id = p_contrato_id
        AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(n))
  ON CONFLICT (contrato_id, nome) DO NOTHING;

  -- (b) reativados
  UPDATE public.sup_posto sp
     SET ativo = true, aprovado = true, updated_at = now()
   WHERE sp.contrato_id = p_contrato_id
     AND (sp.ativo IS FALSE OR sp.aprovado IS FALSE)
     AND public.sup_norm_nome(sp.nome) = ANY (v_norm);

  -- (c) saiu da planilha e não tem função — sai da lista
  IF p_desativar AND array_length(v_norm, 1) > 0 THEN
    UPDATE public.sup_posto sp
       SET ativo = false, updated_at = now()
     WHERE sp.contrato_id = p_contrato_id
       AND sp.ativo
       AND NOT (public.sup_norm_nome(sp.nome) = ANY (v_norm))
       AND NOT EXISTS (
         SELECT 1 FROM public.sup_funcao f
          WHERE f.posto_id = sp.id AND f.ativo);
  END IF;

  RETURN v_norm;
END $fn$;

-- O Supabase concede EXECUTE a anon/authenticated em toda função nova do
-- schema public; sem este REVOKE qualquer logado sincronizaria à vontade.
REVOKE ALL ON FUNCTION public.sup_posto_sincronizar_planilha(uuid, boolean)
  FROM PUBLIC, anon, authenticated;

-- ── 2. Catálogo passa a usar a função interna (comportamento igual) ──
CREATE OR REPLACE FUNCTION public.sup_cat_postos_do_contrato(p_contrato_id uuid)
RETURNS TABLE (
  id          uuid,
  contrato_id uuid,
  nome        text,
  ativo       boolean,
  aprovado    boolean,
  na_planilha boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  v_norm text[];
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_catalogo', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para o Catálogo de Materiais.';
  END IF;

  v_norm := public.sup_posto_sincronizar_planilha(p_contrato_id, true);
  IF v_norm IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT sp.id, sp.contrato_id, sp.nome, sp.ativo, sp.aprovado,
         (public.sup_norm_nome(sp.nome) = ANY (v_norm)) AS na_planilha
    FROM public.sup_posto sp
   WHERE sp.contrato_id = p_contrato_id
     AND sp.ativo
   ORDER BY sp.nome;
END $fn$;

-- ── 3. Encarregado: sincroniza antes de listar ───────────────────────
--
-- Deixa de ser STABLE: agora escreve em sup_posto.
CREATE OR REPLACE FUNCTION public.sup_ext_postos(p_contrato_id uuid)
RETURNS TABLE (id uuid, nome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.sup_ext_pode_ver_contrato(p_contrato_id) THEN
    RAISE EXCEPTION 'Sem acesso a este contrato';
  END IF;

  PERFORM public.sup_posto_sincronizar_planilha(p_contrato_id, true);

  RETURN QUERY
    SELECT p.id, p.nome
      FROM public.sup_posto p
     WHERE p.contrato_id = p_contrato_id AND p.aprovado AND p.ativo
     ORDER BY p.nome;
END $$;

-- ── 4. Acesso ao contrato sem filtro de empresa ──────────────────────
--
-- Mesma regra da 037 menos o JOIN com user_empresa. Continua exigindo que
-- o contrato exista em public.contratos.
CREATE OR REPLACE FUNCTION public.sup_ext_pode_ver_contrato(p_contrato_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_contrato_id IS NULL THEN RETURN false; END IF;

  -- Externo: exatamente o contrato que ele escolheu ao entrar.
  IF EXISTS (
    SELECT 1 FROM public.sup_ext_sessao s
     WHERE s.user_id = v_uid AND s.contrato_id = p_contrato_id
  ) THEN
    RETURN true;
  END IF;

  -- Interno: precisa da tela (solicitar OU editar a fila). Empresa NÃO
  -- entra — ver 20260901000001 e o incidente do CEITEC no cabeçalho.
  RETURN (
       public.can_access(v_uid, 'encarregados_solicitar_materiais', 'visualizar')
    OR public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar')
  ) AND EXISTS (SELECT 1 FROM public.contratos c WHERE c.id = p_contrato_id);
END $$;

-- ── 5. Backfill único dos contratos ativos ───────────────────────────
--
-- Só insere/reativa (p_desativar = false): desativar em massa numa
-- migration é efeito maior do que o necessário para o incidente. O passo
-- (c) continua acontecendo sob demanda, contrato a contrato, como já era.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.id FROM public.contratos c WHERE c.status = 'ativo' LOOP
    PERFORM public.sup_posto_sincronizar_planilha(r.id, false);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Recriar, pelas definições das migrations de origem:
--   sup_ext_pode_ver_contrato   -> 20260930000037_supply_pedido_editar.sql
--   sup_ext_postos              -> 20260819000003_supply_rpcs_externo.sql
--   sup_cat_postos_do_contrato  -> 20260930000081_supply_catalogo_posto_da_planilha.sql
-- e então:
-- DROP FUNCTION IF EXISTS public.sup_posto_sincronizar_planilha(uuid, boolean);
-- NOTIFY pgrst, 'reload schema';
--
-- As linhas que o backfill (seção 5) inseriu/reativou em sup_posto não
-- têm rollback automático — são exatamente as que a 081 teria criado na
-- primeira abertura do catálogo.
-- =====================================================================
