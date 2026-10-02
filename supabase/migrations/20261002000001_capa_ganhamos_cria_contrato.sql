-- =====================================================================
-- [SEM-CHAMADO] — GANHAMOS cria Implantação + Contrato sozinho
--
-- PROBLEMA
--   Quando uma licitação é ganha (Grade Finalizada em 1º → Capa "Ganhamos"),
--   a cadeia parava na Capa: Implantação, Contratos e Planilha de Custo não
--   mostravam nada. O contrato só nascia no botão manual "Criar Contrato" da
--   Capa, que exigia (1) data da reunião de alinhamento, (2) Cliente/Órgão
--   preenchido e (3) alguém lembrar de clicar. Além disso o INSERT em
--   public.contratos é barrado por RLS de user_empresa (a mesma classe de erro
--   do contrato CEITEC / do Iury), então quem não tinha vínculo com a empresa
--   tomava erro de policy.
--
--   As três frentes (Implantação, Planilha de Custo, Contratos) rodam EM
--   PARALELO depois do Ganhamos — a Licitação precisa de um contrato vazio
--   pra preencher a planilha, e a Implantação precisa de um contrato sem
--   nenhuma pergunta respondida.
--
-- O QUE MUDA
--   1. _criar_contrato_da_capa(capa_id): núcleo idempotente. Cria (ou reaproveita)
--      a implantacao_contrato e o contrato oficial a partir da Capa, liga os dois
--      (contrato_id) e carimba o histórico da Capa. Cliente vem da Capa; se
--      estiver vazio vira 'A definir' (contratos.cliente é NOT NULL). A reunião
--      de alinhamento NÃO é pré-requisito: é copiada se já existir, senão fica
--      nula e se completa depois na Capa.
--   2. Trigger AFTER UPDATE OF status em capa_edital: ao virar 'Ganhamos'
--      (por qualquer caminho — botão da Capa ou Grade finalizada), chama o núcleo.
--      SECURITY DEFINER, então não depende de user_empresa. Falha no núcleo
--      não derruba a mudança de status (vira WARNING); o botão "Criar Contrato"
--      continua na Capa como recuperação pra quem ficou sem contrato.
--   3. criar_contrato_da_capa(capa_id): RPC pro botão (recuperação / histórico
--      sem contrato). Gate: can_access('editais','alterar') — o mesmo da RLS da Capa.
--
-- NÃO FAZ: não cria linha em planilha_custo (contrato sem postos já aparece nos
-- seletores de Contratos/Orçamento/Planilha). Não faz backfill sozinho — ver
-- bloco comentado no fim.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- ── 1. Núcleo (interno — não exposto a authenticated) ────────────────
CREATE OR REPLACE FUNCTION public._criar_contrato_da_capa(p_capa_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c             public.capa_edital%ROWTYPE;
  v_nome        text;
  v_impl_id     uuid;
  v_contrato_id uuid;
BEGIN
  SELECT * INTO c FROM public.capa_edital WHERE id = p_capa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Capa não encontrada.' USING ERRCODE = '22023';
  END IF;
  IF c.status::text <> 'Ganhamos' THEN
    RAISE EXCEPTION 'Apenas licitações ganhas geram contrato.' USING ERRCODE = '22023';
  END IF;

  -- Mesmo nome inicial que o frontend sempre usou: "cidade — objeto".
  v_nome := COALESCE(
    NULLIF(btrim(concat_ws(' — ', NULLIF(btrim(c.cidade), ''), NULLIF(btrim(c.objeto), ''))), ''),
    'Contrato sem nome'
  );

  -- Implantação: reaproveita a que já existe pra essa Capa.
  v_impl_id := c.contrato_id;
  IF v_impl_id IS NULL THEN
    SELECT i.id INTO v_impl_id
      FROM public.implantacao_contrato i
     WHERE i.capa_id = c.id
     ORDER BY i.created_at
     LIMIT 1;
  END IF;
  IF v_impl_id IS NULL THEN
    INSERT INTO public.implantacao_contrato
           (empresa_id, nome, capa_id, status, data_inicio, abertura,
            reuniao_alinhamento, data_homologacao)
    VALUES (c.empresa_id, v_nome, c.id, 'ativo', c.data_inicio, c.abertura,
            c.reuniao_alinhamento, c.data_homologacao::text)
    RETURNING id INTO v_impl_id;
  END IF;

  -- Contrato oficial: reaproveita o que já nasceu dessa Capa.
  SELECT k.id INTO v_contrato_id
    FROM public.contratos k
   WHERE k.capa_id = c.id
   ORDER BY k.created_at
   LIMIT 1;
  IF v_contrato_id IS NULL THEN
    INSERT INTO public.contratos
           (empresa_id, nome, cliente, data_inicio, status, capa_id, grade_id)
    VALUES (c.empresa_id, v_nome,
            COALESCE(NULLIF(btrim(c.cliente), ''), 'A definir'),
            c.data_inicio, 'ativo', c.id, c.grade_id)
    RETURNING id INTO v_contrato_id;
  END IF;

  -- Amarra as duas pontas (o trigger link_implantacao_ao_contrato já faz isso
  -- quando o contrato é inserido depois; aqui cobre o caso de reaproveitar).
  UPDATE public.implantacao_contrato
     SET contrato_id = v_contrato_id
   WHERE id = v_impl_id AND contrato_id IS NULL;

  -- capa_edital.contrato_id aponta pra implantacao_contrato (modelo existente).
  -- Só mexe em contrato_id/historico: o trigger de status não redispara.
  UPDATE public.capa_edital
     SET contrato_id = COALESCE(contrato_id, v_impl_id),
         historico   = COALESCE(historico, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'ts',    to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS'),
             'campo', 'Contrato',
             'de',    '—',
             'para',  'Criado automaticamente ao ganhar'))
   WHERE id = c.id
     AND contrato_id IS NULL;

  RETURN v_impl_id;
END;
$$;

REVOKE ALL ON FUNCTION public._criar_contrato_da_capa(uuid) FROM public, anon, authenticated;

-- ── 2. Trigger: virou 'Ganhamos' → cria ──────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_capa_ganhamos_cria_contrato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status::text = 'Ganhamos'
     AND OLD.status::text IS DISTINCT FROM 'Ganhamos'
     AND NEW.contrato_id IS NULL THEN
    BEGIN
      PERFORM public._criar_contrato_da_capa(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- Não impede o usuário de marcar "Ganhamos". Sem contrato, a Capa segue
      -- mostrando o botão "Criar Contrato" (RPC criar_contrato_da_capa).
      RAISE WARNING 'capa % ganhou mas o contrato não foi criado: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capa_ganhamos_cria_contrato ON public.capa_edital;
CREATE TRIGGER trg_capa_ganhamos_cria_contrato
  AFTER UPDATE OF status ON public.capa_edital
  FOR EACH ROW EXECUTE FUNCTION public.trg_capa_ganhamos_cria_contrato();

-- ── 3. RPC do botão "Criar Contrato" (recuperação) ───────────────────
CREATE OR REPLACE FUNCTION public.criar_contrato_da_capa(p_capa_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'editais', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para criar contrato a partir da Capa.' USING ERRCODE = '42501';
  END IF;
  RETURN public._criar_contrato_da_capa(p_capa_id);
END;
$$;

REVOKE ALL ON FUNCTION public.criar_contrato_da_capa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.criar_contrato_da_capa(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- BACKLOG — capas JÁ ganhas que ficaram sem contrato (NÃO roda sozinho)
--
-- 1) Veja a lista primeiro:
--
--   SELECT c.id, c.empresa_id, c.cidade, c.objeto, c.cliente, c.data_homologacao
--     FROM public.capa_edital c
--    WHERE c.status::text = 'Ganhamos' AND c.contrato_id IS NULL
--    ORDER BY c.data_homologacao NULLS LAST;
--
-- 2) Compare com Contratos: se alguém já criou à mão um contrato dessa mesma
--    licitação SEM capa_id, o backfill abaixo geraria um DUPLICADO (o núcleo só
--    reaproveita contrato que tenha o mesmo capa_id). Remova da lista o que
--    já existir.
--
-- 3) Só então, pra criar tudo de uma vez:
--
--   SELECT public._criar_contrato_da_capa(c.id)
--     FROM public.capa_edital c
--    WHERE c.status::text = 'Ganhamos' AND c.contrato_id IS NULL;
-- =====================================================================

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_capa_ganhamos_cria_contrato ON public.capa_edital;
--   DROP FUNCTION IF EXISTS public.trg_capa_ganhamos_cria_contrato();
--   DROP FUNCTION IF EXISTS public.criar_contrato_da_capa(uuid);
--   DROP FUNCTION IF EXISTS public._criar_contrato_da_capa(uuid);
--   NOTIFY pgrst, 'reload schema';
--   (contratos/implantações já criados pelo trigger permanecem.)
-- =====================================================================
