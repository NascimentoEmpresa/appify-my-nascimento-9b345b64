-- ============================================================================
-- SIS-2026-0942 — Conciliação Bancária: tirar da tela as contas substituídas, sem apagar o histórico
-- ============================================================================
-- Na conferência mensal dos saldos (Financeiro › Conciliação Bancária › Dashboard › Saldos) cada cartão é um grupo empresa + banco
-- [+ conta]. O grupo nasce de três fontes: lançamento do Fluxo, conciliação salva ou SALDO INICIAL manual
-- (financeiro_conciliacao_saldo_inicial). As quatro contas do chamado não têm lançamento nem conciliação: existem só por causa de uma
-- linha de saldo inicial que sobrou do cadastro antigo, e por isso ficam "Pendente de conferência" para sempre:
--   - HAGG · Sicredi (sem conta, R$ 28.269,68): saldo de antes da SIS-2026-0777, que separou o Sicredi em HAGG 119 e HAGG 155 — o mesmo
--     valor já foi lançado na HAGG 119, que confere;
--   - SN · Sicredi · 748 / 1190000000173904: conta digitada em texto livre, antes do cadastro de contas;
--   - SN · Sicredi · 119 — HAGG 119: saldo gravado para a SN apontando a conta da HAGG (conta de outra empresa);
--   - HAGG · Banco do Brasil Rende Facil: banco antigo, substituído por "Banco do Brasil Rende Facil Hagg · 001 / 12000-6".
--
-- O que muda:
--  1) a linha de saldo inicial ganha condição cadastral: ativo = false tira a conta da conciliação (cartão, pendência e saldo do sistema)
--     e guarda quando, quem e por quê. Nada é apagado: valor e histórico continuam na tabela (critério 7 — os R$ 28.269,68 seguem
--     rastreáveis) e a tela lista os retirados à parte, com botão para devolver;
--  2) gatilho que impede a volta automática (critério 8):
--     - saldo ativo com conta do cadastro (uuid) só aceita conta da MESMA empresa e banco (o caso SN × HAGG 119 não se repete);
--     - saldo retirado não muda de valor nem é apagado sem ser devolvido antes (o campo do cartão de um grupo que voltasse a ter
--       lançamento faria upsert/delete na mesma chave e reabriria a conta em silêncio);
--  3) retira as quatro linhas do chamado. A retirada é pela identificação do cadastro (empresa + banco + conta), NUNCA por saldo zero.
--     Cada caso só age quando empresa e banco são achados sem ambiguidade; senão avisa (NOTICE) e não mexe — o Financeiro retira pela
--     tela ("Retirar da conciliação" aparece nos cartões que só existem pelo saldo inicial).
--
-- Sem menu novo e sem policy nova: retirar é um UPDATE, já coberto por conciliacao_saldo_inicial_update ('alterar' em
-- conciliacao-fluxo-caixa). Fluxo de Caixa não é tocado (o saldo inicial manual não é lançamento do Fluxo).
-- Idempotente.

SET lock_timeout = '5s';

-- 1) Condição cadastral -------------------------------------------------------------------------------------------------------------
ALTER TABLE public.financeiro_conciliacao_saldo_inicial
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inativado_em timestamptz,
  ADD COLUMN IF NOT EXISTS inativado_por uuid, -- sem FK para auth.users, como updated_by (42501 ao criar a chave)
  ADD COLUMN IF NOT EXISTS motivo_inativacao text;

COMMENT ON COLUMN public.financeiro_conciliacao_saldo_inicial.ativo IS
  'SIS-2026-0942: false = conta substituída, fora da Conciliação Bancária. A linha fica como histórico; não filtrar por saldo zero.';

-- 2) Gatilho: impede saldo apontando conta de outra empresa e mudança silenciosa de saldo retirado ------------------------------------
CREATE OR REPLACE FUNCTION public.conciliacao_saldo_inicial_guarda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta public.financeiro_conta_banco%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.ativo = false THEN
      RAISE EXCEPTION 'Este saldo anterior foi retirado da conciliação (conta substituída). Devolva-o em "Retirados da conciliação" antes de apagar.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.ativo = false AND NEW.ativo = false
     AND (NEW.valor IS DISTINCT FROM OLD.valor OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
          OR NEW.banco_id IS DISTINCT FROM OLD.banco_id OR NEW.conta IS DISTINCT FROM OLD.conta OR NEW.ano IS DISTINCT FROM OLD.ano) THEN
    RAISE EXCEPTION 'Este saldo anterior foi retirado da conciliação (conta substituída). Devolva-o em "Retirados da conciliação" antes de alterar.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- conta do cadastro (uuid): tem que ser da mesma empresa e do mesmo banco do saldo. Texto livre antigo continua aceito ("sem conta").
  IF NEW.ativo AND NEW.conta ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_conta FROM public.financeiro_conta_banco WHERE id = NEW.conta::uuid;
    IF NOT FOUND OR v_conta.empresa_id <> NEW.empresa_id OR v_conta.banco_id <> NEW.banco_id THEN
      RAISE EXCEPTION 'A conta escolhida não é desta empresa e banco: o saldo anterior não pode ser gravado nela.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_conciliacao_saldo_inicial_guarda ON public.financeiro_conciliacao_saldo_inicial;
CREATE TRIGGER trg_conciliacao_saldo_inicial_guarda
  BEFORE INSERT OR UPDATE OR DELETE ON public.financeiro_conciliacao_saldo_inicial
  FOR EACH ROW EXECUTE FUNCTION public.conciliacao_saldo_inicial_guarda();

-- 3) Retira as quatro contas do chamado ----------------------------------------------------------------------------------------------
DO $$
DECLARE
  c_motivo constant text := 'SIS-2026-0942: cadastro substituído — retirado da Conciliação Bancária (histórico preservado).';
  v_hagg uuid;
  v_sn uuid;
  v_sicredi uuid;
  v_rende_facil uuid;
  n int;
BEGIN
  -- empresas e bancos pelo nome que a tela mostra; só segue com correspondência única
  IF (SELECT count(*) FROM public.empresas WHERE ativa AND upper(btrim(COALESCE(NULLIF(nome_fantasia, ''), razao_social))) = 'HAGG') = 1 THEN
    SELECT id INTO v_hagg FROM public.empresas WHERE ativa AND upper(btrim(COALESCE(NULLIF(nome_fantasia, ''), razao_social))) = 'HAGG';
  END IF;
  IF (SELECT count(*) FROM public.empresas WHERE ativa AND upper(btrim(COALESCE(NULLIF(nome_fantasia, ''), razao_social))) = 'SN') = 1 THEN
    SELECT id INTO v_sn FROM public.empresas WHERE ativa AND upper(btrim(COALESCE(NULLIF(nome_fantasia, ''), razao_social))) = 'SN';
  END IF;
  IF (SELECT count(*) FROM public.malote_cartao_banco WHERE upper(btrim(nome)) = 'SICREDI') = 1 THEN
    SELECT id INTO v_sicredi FROM public.malote_cartao_banco WHERE upper(btrim(nome)) = 'SICREDI';
  END IF;
  IF (SELECT count(*) FROM public.malote_cartao_banco WHERE upper(btrim(nome)) = 'BANCO DO BRASIL RENDE FACIL') = 1 THEN
    SELECT id INTO v_rende_facil FROM public.malote_cartao_banco WHERE upper(btrim(nome)) = 'BANCO DO BRASIL RENDE FACIL';
  END IF;

  -- a) SN · Sicredi · 119 — HAGG 119 (e qualquer outro saldo ativo apontando conta de outra empresa/banco ou conta que não existe)
  UPDATE public.financeiro_conciliacao_saldo_inicial s
     SET ativo = false, inativado_em = now(), motivo_inativacao = c_motivo || ' Conta de outra empresa/banco.', updated_at = now()
   WHERE s.ativo
     AND s.conta ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NOT EXISTS (SELECT 1 FROM public.financeiro_conta_banco c
                      WHERE c.id::text = lower(s.conta) AND c.empresa_id = s.empresa_id AND c.banco_id = s.banco_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'SIS-2026-0942: % saldo(s) com conta de outra empresa/banco retirado(s).', n;

  -- b) HAGG · Sicredi (sem conta): substituído por HAGG 119 / HAGG 155
  IF v_hagg IS NOT NULL AND v_sicredi IS NOT NULL THEN
    UPDATE public.financeiro_conciliacao_saldo_inicial
       SET ativo = false, inativado_em = now(), motivo_inativacao = c_motivo || ' Substituída por Sicredi HAGG 119 / HAGG 155.', updated_at = now()
     WHERE ativo AND empresa_id = v_hagg AND banco_id = v_sicredi AND btrim(conta) = '';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'SIS-2026-0942: HAGG · Sicredi (sem conta): % linha(s) retirada(s).', n;
  ELSE
    RAISE NOTICE 'SIS-2026-0942: HAGG ou Sicredi não achados sem ambiguidade — HAGG · Sicredi não foi retirada (retirar pela tela).';
  END IF;

  -- c) SN · Sicredi · 748 / 1190000000173904 (conta em texto livre, antes do cadastro de contas)
  IF v_sn IS NOT NULL AND v_sicredi IS NOT NULL THEN
    UPDATE public.financeiro_conciliacao_saldo_inicial
       SET ativo = false, inativado_em = now(), motivo_inativacao = c_motivo || ' Conta antiga em texto livre (748 / 1190000000173904).', updated_at = now()
     WHERE ativo AND empresa_id = v_sn AND banco_id = v_sicredi AND regexp_replace(conta, '\D', '', 'g') = '7481190000000173904';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'SIS-2026-0942: SN · Sicredi · 748 / 1190000000173904: % linha(s) retirada(s).', n;
  ELSE
    RAISE NOTICE 'SIS-2026-0942: SN ou Sicredi não achados sem ambiguidade — SN · Sicredi · 748 não foi retirada (retirar pela tela).';
  END IF;

  -- d) HAGG · Banco do Brasil Rende Facil (banco antigo; a conta atual é "Banco do Brasil Rende Facil Hagg")
  IF v_hagg IS NOT NULL AND v_rende_facil IS NOT NULL THEN
    UPDATE public.financeiro_conciliacao_saldo_inicial
       SET ativo = false, inativado_em = now(), motivo_inativacao = c_motivo || ' Substituída por Banco do Brasil Rende Facil Hagg · 001 / 12000-6.', updated_at = now()
     WHERE ativo AND empresa_id = v_hagg AND banco_id = v_rende_facil;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'SIS-2026-0942: HAGG · Banco do Brasil Rende Facil: % linha(s) retirada(s).', n;
  ELSE
    RAISE NOTICE 'SIS-2026-0942: HAGG ou "Banco do Brasil Rende Facil" não achados sem ambiguidade — não foi retirada (retirar pela tela).';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   UPDATE public.financeiro_conciliacao_saldo_inicial SET ativo = true WHERE motivo_inativacao LIKE 'SIS-2026-0942:%';
--   DROP TRIGGER IF EXISTS trg_conciliacao_saldo_inicial_guarda ON public.financeiro_conciliacao_saldo_inicial;
--   DROP FUNCTION IF EXISTS public.conciliacao_saldo_inicial_guarda();
--   ALTER TABLE public.financeiro_conciliacao_saldo_inicial
--     DROP COLUMN IF EXISTS motivo_inativacao, DROP COLUMN IF EXISTS inativado_por,
--     DROP COLUMN IF EXISTS inativado_em, DROP COLUMN IF EXISTS ativo;
--   NOTIFY pgrst, 'reload schema';
