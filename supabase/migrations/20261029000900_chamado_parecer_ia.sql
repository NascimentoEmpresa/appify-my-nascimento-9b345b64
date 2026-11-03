-- =========================================================================
-- PARECER DA I.A EM CADA CHAMADO DE SISTEMAS (pedido do Pablo, 29/10/2026)
--
-- Todo chamado de desenvolvimento ganha um parecer gerado pela I.A, em duas
-- partes:
--   1) PREÇO — três valores médios de mercado para desenvolver o chamado
--      (freelancer, software house, equipe interna), cada um com o
--      embasamento (valor/hora × horas estimadas) e uma explicação curta;
--   2) COMPLEXIDADE — nível de 1 a 5 com a justificativa.
--
-- O parecer fica GUARDADO aqui: abrir a tela do chamado não chama a I.A.
-- Quem gera é a Edge Function chamado-parecer-ia, por dois caminhos:
--   · automático: o chamado é ABERTO (INSERT) → fila_http → worker → function.
--     Gera na abertura, e não na coordenação, porque o preço e a complexidade
--     dependem do PEDIDO (assunto + descrição), que já está todo ali — e quem
--     coordena precisa do parecer ANTES, para decidir para quem mandar;
--   · manual: botão "Gerar de novo" na tela (gestor ou responsável), que chama
--     a function direto com o login de quem clicou e mostra o erro se falhar.
--
-- Erro da I.A NÃO some em silêncio (lição do Groq fora do ar, ver memória do
-- projeto): a linha fica com status = 'erro' e a mensagem em `erro`, e a tela
-- mostra.
--
-- BACKFILL: no fim desta migration, os últimos 10 chamados de cada
-- desenvolvedor (por responsavel_id) entram na fila. No merge da main as
-- Edge Functions sobem ANTES das migrations (cluster_pos_merge.yml, job
-- `migrations` com needs: functions), então quando o worker entregar a
-- function já existe.
-- =========================================================================

-- ── 1) A tabela ──────────────────────────────────────────────────────────
-- Uma linha por chamado (a PK é o chamado): gerar de novo SOBRESCREVE.
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_PARECER_IA" (
  chamado_id                 uuid PRIMARY KEY REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  status                     text        NOT NULL DEFAULT 'pendente',
  -- [{ perfil, rotulo, valor_hora, horas, valor, embasamento, explicacao }] × 3
  precos                     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  valor_medio                numeric(12,2),
  horas_estimadas            numeric(8,1),
  complexidade_nivel         smallint,
  complexidade_rotulo        text,
  complexidade_justificativa text,
  premissas                  text,
  provedor                   text,
  modelo                     text,
  erro                       text,
  solicitado_por             uuid,
  gerado_em                  timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public."CHAMADO_SISTEMA_PARECER_IA"
    ADD CONSTRAINT chamado_parecer_ia_status_chk CHECK (status IN ('pendente', 'pronto', 'erro'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public."CHAMADO_SISTEMA_PARECER_IA"
    ADD CONSTRAINT chamado_parecer_ia_nivel_chk CHECK (complexidade_nivel IS NULL OR complexidade_nivel BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public."CHAMADO_SISTEMA_PARECER_IA" IS
  'Parecer da I.A por chamado: 3 preços de mercado + complexidade 1-5. Escrito só pela Edge Function chamado-parecer-ia (service_role).';

DROP TRIGGER IF EXISTS trg_chamado_parecer_ia_updated_at ON public."CHAMADO_SISTEMA_PARECER_IA";
CREATE TRIGGER trg_chamado_parecer_ia_updated_at
  BEFORE UPDATE ON public."CHAMADO_SISTEMA_PARECER_IA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2) RLS: vê o parecer quem vê o chamado ───────────────────────────────
-- O EXISTS roda com a RLS de "CHAMADO_SISTEMA" de quem consulta
-- (chamado_sistema_select: solicitante, responsável, participante ou quem
-- tem chamado_sistema_pode_ver_todos — que por dentro é tem_acesso_menu dos
-- menus de Chamados). Assim a regra é UMA só: se um dia a tela do chamado
-- mudar quem enxerga, o parecer acompanha sem migration nova.
-- Escrita: nenhuma policy. Só a Edge Function (service_role) grava.
ALTER TABLE public."CHAMADO_SISTEMA_PARECER_IA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chamado_parecer_ia_select ON public."CHAMADO_SISTEMA_PARECER_IA";
CREATE POLICY chamado_parecer_ia_select ON public."CHAMADO_SISTEMA_PARECER_IA" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = "CHAMADO_SISTEMA_PARECER_IA".chamado_id));

REVOKE ALL ON public."CHAMADO_SISTEMA_PARECER_IA" FROM anon, authenticated;
GRANT SELECT ON public."CHAMADO_SISTEMA_PARECER_IA" TO authenticated;

-- ── 3) Quem pode pedir para gerar de novo ────────────────────────────────
-- Cada geração gasta token da I.A: não é qualquer um que vê o chamado.
-- Gestão de chamados (painel/coordenar/aprovar) ou o responsável pela execução.
CREATE OR REPLACE FUNCTION public.chamado_parecer_ia_pode_gerar(p_chamado_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND (c.responsavel_id = auth.uid() OR public.chamado_sistema_gestor())
  );
$$;

REVOKE ALL ON FUNCTION public.chamado_parecer_ia_pode_gerar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_parecer_ia_pode_gerar(uuid) TO authenticated;

-- ── 4) Enfileirar a geração (gatilho e backfill) ─────────────────────────
-- Marca 'pendente' (a tela mostra "gerando…") e grava a intenção na
-- fila_http — o worker entrega à function com a service_role. Parecer já
-- pronto não é refeito por aqui: refazer é só pelo botão.
CREATE OR REPLACE FUNCTION public.chamado_parecer_ia_enfileirar(p_chamado_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_PARECER_IA"
              WHERE chamado_id = p_chamado_id AND status = 'pronto') THEN
    RETURN;
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_PARECER_IA" (chamado_id, status)
  VALUES (p_chamado_id, 'pendente')
  ON CONFLICT (chamado_id) DO UPDATE SET status = 'pendente', erro = NULL;

  PERFORM public.enfileirar_http('chamado-parecer-ia', jsonb_build_object('chamado_id', p_chamado_id));
END $$;

REVOKE ALL ON FUNCTION public.chamado_parecer_ia_enfileirar(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5) Automático na abertura ────────────────────────────────────────────
-- Best-effort, como o gatilho de novidade: o parecer falhar NUNCA pode
-- impedir alguém de abrir chamado.
CREATE OR REPLACE FUNCTION public.chamado_aberto_gera_parecer_ia()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.chamado_parecer_ia_enfileirar(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chamado-parecer-ia não foi enfileirada para %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;  -- AFTER trigger: o retorno é ignorado
END $$;

REVOKE ALL ON FUNCTION public.chamado_aberto_gera_parecer_ia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_aberto_parecer_ia ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_aberto_parecer_ia
  AFTER INSERT ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_aberto_gera_parecer_ia();

-- ── 6) Backfill: os últimos N de cada desenvolvedor ──────────────────────
-- Reexecutável: o que já está pronto é pulado por chamado_parecer_ia_enfileirar.
-- Para rodar de novo à mão (no banco1, fora do pico):
--   SELECT public.chamado_parecer_ia_backfill(10);
CREATE OR REPLACE FUNCTION public.chamado_parecer_ia_backfill(p_por_dev integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_n  integer := 0;
BEGIN
  FOR v_id IN
    SELECT x.id FROM (
      SELECT c.id,
             row_number() OVER (PARTITION BY c.responsavel_id ORDER BY c.created_at DESC) AS rn
        FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id IS NOT NULL
    ) x
     WHERE x.rn <= greatest(coalesce(p_por_dev, 10), 1)
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_PARECER_IA" p
                        WHERE p.chamado_id = x.id AND p.status = 'pronto')
  LOOP
    PERFORM public.chamado_parecer_ia_enfileirar(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.chamado_parecer_ia_backfill(integer) FROM PUBLIC, anon, authenticated;

SELECT public.chamado_parecer_ia_backfill(10);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_chamado_aberto_parecer_ia ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_aberto_gera_parecer_ia();
--   DROP FUNCTION IF EXISTS public.chamado_parecer_ia_backfill(integer);
--   DROP FUNCTION IF EXISTS public.chamado_parecer_ia_enfileirar(uuid);
--   DROP FUNCTION IF EXISTS public.chamado_parecer_ia_pode_gerar(uuid);
--   DELETE FROM public.fila_http WHERE destino = 'chamado-parecer-ia' AND processado_em IS NULL;
--   DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_PARECER_IA";
-- =========================================================================
