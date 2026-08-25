-- =====================================================================
-- SIS-2026-0199 — desfaz o filtro de empresa nos preços
--
-- CORREÇÃO DE ERRO MEU, INTRODUZIDO NA 20260925000005.
--
-- A revisão automática da PR #426 apontou (J7) que sup_precos_consulta lia
-- sup_estoque_item sem filtrar empresa. Eu li a policy original em
-- 20260820000001, que de fato tinha o filtro, e "corrigi" replicando-o nas
-- funções e na policy de sup_item_preco.
--
-- O QUE EU NÃO CONFERI: aquela não era a policy vigente. Em 13/08/2026 uma
-- decisão de produto do Eduardo REMOVEU o filtro de empresa das 28 policies do
-- Suprimentos (20260901000001_suprimentos_sem_filtro_de_empresa.sql), porque
-- ele quebrava o módulo na prática:
--
--     "A empresa do usuário é informação VISUAL. Ela não governa acesso:
--      quem governa é o Acesso por Usuário (can_access)."
--
-- Quem não tem linha em `user_empresa` casa com conjunto vazio e vê ZERO, sem
-- erro nenhum na tela. Foi medido em produção com o CASSIO — que tem todas as
-- permissões de Suprimentos e nenhum vínculo: sup_item 0 de 1424, sup_posto
-- 0 de 444. E o Cassio é justamente quem pediu este chamado.
--
-- Ou seja: a 20260925000005 teria deixado "Preços de Materiais" e a aba Preços
-- VAZIAS para o usuário final, sem mensagem de erro. É o pior tipo de bloqueio,
-- e a própria REGRAS-PR.md avisa em J1.E que policy nova combinando can_access
-- com filtro de empresa é suspeita — a ressalva que eu deveria ter seguido.
--
-- Volta ao que o módulo inteiro faz: só can_access. Mesma exigência de
-- permissão de antes, nem mais nem menos.
--
-- Migration nova em vez de editar a 0005, por R4 (migrations são append-only).
-- Idempotente. Nenhum dado é tocado.
-- =====================================================================

-- ── 1) Policy do histórico ───────────────────────────────────────────
DROP POLICY IF EXISTS sup_item_preco_select ON public.sup_item_preco;
CREATE POLICY sup_item_preco_select ON public.sup_item_preco
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_precos_consulta', 'visualizar')
  );

-- ── 2) Histórico de um material ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_item_precos(p_sup_item_id uuid)
RETURNS TABLE (
  valor_unitario numeric, valor_anterior numeric, valido_ate date,
  origem text, fornecedor_nome text, documento text,
  registrado_em timestamptz, registrado_por_nome text, almoxarifado text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.valor_unitario, p.valor_anterior, p.valido_ate, p.origem,
         p.fornecedor_nome, p.documento, p.registrado_em, p.registrado_por_nome,
         a.nome
    FROM public.sup_item_preco p
    LEFT JOIN public.almoxarifado a ON a.id = p.almoxarifado_id
   WHERE p.sup_item_id = p_sup_item_id
     AND (public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_precos_consulta', 'visualizar'))
   ORDER BY p.registrado_em DESC
   LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.sup_item_precos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_item_precos(uuid) TO authenticated;

-- ── 3) Consulta de preços da Licitação ───────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_precos_consulta(p_busca text DEFAULT NULL)
RETURNS TABLE (
  sup_item_id uuid, material text, tipo text,
  valor_unitario numeric, valido_ate date, vencido boolean,
  fornecedor_nome text, atualizado_em timestamptz, almoxarifado text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (ei.sup_item_id)
         ei.sup_item_id, i.nome, i.tipo,
         ei.valor_unitario, ei.preco_valido_ate,
         (ei.preco_valido_ate IS NOT NULL AND ei.preco_valido_ate < CURRENT_DATE),
         COALESCE(f.razao_social, ei.fornecedor),
         ei.updated_at, a.nome
    FROM public.sup_estoque_item ei
    JOIN public.sup_item i ON i.id = ei.sup_item_id
    LEFT JOIN public.fornecedor f ON f.id = ei.fornecedor_id
    LEFT JOIN public.almoxarifado a ON a.id = ei.almoxarifado_id
   WHERE COALESCE(ei.valor_unitario, 0) > 0
     AND i.ativo
     AND (p_busca IS NULL OR btrim(p_busca) = ''
          OR i.nome ILIKE '%' || btrim(p_busca) || '%')
     AND (public.can_access(auth.uid(), 'sup_precos_consulta', 'visualizar')
          OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar'))
   ORDER BY ei.sup_item_id, ei.updated_at DESC
$$;

REVOKE ALL ON FUNCTION public.sup_precos_consulta(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_precos_consulta(text) TO authenticated;

-- ── Conferência ──────────────────────────────────────────────────────
-- Rodar com um usuário SEM vínculo em user_empresa: tem que devolver preço,
-- não zero. É o cenário do Cassio.
SELECT count(*) AS precos_visiveis FROM public.sup_precos_consulta(NULL);

NOTIFY pgrst, 'reload schema';
