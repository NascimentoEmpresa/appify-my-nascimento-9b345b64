-- =========================================================================
-- Demissão: numeração 1..N sem buracos — agora e daqui pra frente
--
-- Pedido do Pablo em 14/09/2026: "preciso que fique do 1 até o último em
-- sequência certinho". A lista pulava (1, 4, 5, 7, 8...) porque o id era
-- BIGSERIAL: a sequência avança na hora do INSERT, e se o INSERT falha (um
-- trigger recusou) ou a linha é apagada depois (teste), o número some.
--
-- DUAS PARTES
--   1. RENUMERA o que existe, em ordem de id (= ordem de criação): 1, 4, 5,
--      7 → 1, 2, 3, 4... As referências vão junto:
--        • SISTEMA_SOL_DEMISSAO_ANEXOS.solicitacao_id  (FK → ON UPDATE CASCADE)
--        • SISTEMA_RECRUTAMENTO.demissao_id            (FK → ON UPDATE CASCADE)
--        • SISTEMA_COMENTARIOS.entidade_id (texto, modulo = 'demissao')
--      Os arquivos no bucket demissoes-docs NÃO mudam de lugar: o caminho
--      gravado em storage_path continua o mesmo, só o número da linha muda.
--
--   2. O id NOVO deixa de vir da sequência e passa a ser max(id) + 1,
--      calculado na hora (demissao_proximo_id). Se o INSERT falhar, a
--      transação volta e o número não é gasto — sem buraco. O advisory lock
--      serializa dois encarregados clicando ao mesmo tempo (sem ele os dois
--      pegariam o mesmo número e o segundo tomaria PK duplicada).
--
-- O que ainda ABRE buraco: apagar uma linha. Ninguém apaga demissão pela
-- tela; se acontecer no Table Editor, é rodar a parte 1 de novo (ela é
-- idempotente: com a numeração já certa, não mexe em nada).
--
-- ⚠️ Os números que as pessoas já citaram mudam: a #7 (CRISTIANE) vira #4,
-- e assim por diante. Foi o pedido.
--
-- Triggers das duas tabelas ficam desligados durante a renumeração:
--   • trg_sistema_recrutamento_guard recusa UPDATE sem auth.uid() (migration
--     não tem) — o mesmo motivo da 20260930000042;
--   • rec_vaga_avisa_demissao zeraria vaga_id ao ver demissao_id "mudar";
--   • demissao_contrato_pelo_cadastro reescreveria contrato — inócuo, mas
--     não é o que esta migration faz.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) FKs passam a acompanhar o id (ON UPDATE CASCADE) ────────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass AS tabela
      FROM pg_constraint
     WHERE contype = 'f'
       AND confrelid = 'public."SISTEMA_SOLICITACOES_DEMISSAO"'::regclass
       AND conrelid IN ('public."SISTEMA_SOL_DEMISSAO_ANEXOS"'::regclass,
                        'public."SISTEMA_RECRUTAMENTO"'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tabela, c.conname);
  END LOOP;
END $$;

ALTER TABLE public."SISTEMA_SOL_DEMISSAO_ANEXOS"
  ADD CONSTRAINT sistema_sol_demissao_anexos_solicitacao_id_fkey
  FOREIGN KEY (solicitacao_id) REFERENCES public."SISTEMA_SOLICITACOES_DEMISSAO"(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD CONSTRAINT sistema_recrutamento_demissao_id_fkey
  FOREIGN KEY (demissao_id) REFERENCES public."SISTEMA_SOLICITACOES_DEMISSAO"(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

-- ── 2) Renumera 1..N em ordem de criação ───────────────────────────────
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DISABLE TRIGGER USER;
ALTER TABLE public."SISTEMA_RECRUTAMENTO"          DISABLE TRIGGER USER;

DO $$
DECLARE
  r record;
  n bigint := 0;
BEGIN
  -- Em ordem crescente o destino n é sempre <= r.id e está livre: todo id
  -- menor que r.id já foi movido para um n menor que este.
  FOR r IN SELECT id FROM public."SISTEMA_SOLICITACOES_DEMISSAO" ORDER BY id LOOP
    n := n + 1;
    IF r.id <> n THEN
      UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO" SET id = n WHERE id = r.id;  -- FKs vão junto
      UPDATE public."SISTEMA_COMENTARIOS"
         SET entidade_id = n::text
       WHERE modulo = 'demissao' AND entidade_id = r.id::text;
    END IF;
  END LOOP;
  PERFORM setval('public."SISTEMA_SOLICITACOES_DEMISSAO_id_seq"', GREATEST(n, 1), n > 0);
END $$;

ALTER TABLE public."SISTEMA_RECRUTAMENTO"          ENABLE TRIGGER USER;
ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" ENABLE TRIGGER USER;

-- ── 3) Daqui pra frente: max(id) + 1, sem gastar número em INSERT que falha ─
CREATE OR REPLACE FUNCTION public.demissao_proximo_id()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Serializa quem está inserindo ao mesmo tempo; solta no fim da transação.
  PERFORM pg_advisory_xact_lock(hashtext('SISTEMA_SOLICITACOES_DEMISSAO.id'));
  RETURN (SELECT coalesce(max(id), 0) + 1 FROM public."SISTEMA_SOLICITACOES_DEMISSAO");
END $fn$;

REVOKE ALL ON FUNCTION public.demissao_proximo_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_proximo_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.demissao_proximo_id() TO authenticated;

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ALTER COLUMN id SET DEFAULT public.demissao_proximo_id();

NOTIFY pgrst, 'reload schema';

-- ── Conferência ────────────────────────────────────────────────────────
-- SELECT count(*) = max(id) AS sem_buracos FROM public."SISTEMA_SOLICITACOES_DEMISSAO";

-- =========================================================================
-- ROLLBACK (só a parte 3 — a renumeração não se desfaz)
-- =========================================================================
-- ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
--   ALTER COLUMN id SET DEFAULT nextval('public."SISTEMA_SOLICITACOES_DEMISSAO_id_seq"');
-- DROP FUNCTION IF EXISTS public.demissao_proximo_id();
-- NOTIFY pgrst, 'reload schema';
