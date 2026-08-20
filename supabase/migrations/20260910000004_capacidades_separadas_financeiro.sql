-- Separa no Financeiro quatro capacidades que hoje vêm todas juntas em duas
-- permissões genéricas, e corrige de quebra uma exposição séria.
--
-- O PROBLEMA
-- `contas-pagar | alterar` libera SETE operações de poderes muito diferentes:
--   titulo_agendar          (agendar pagamento — planejamento)
--   titulo_pagar_baixar     (dar baixa — escrituração)
--   malote_adicionar_titulo / malote_remover_titulo (montar o lote)
--   pre_titulo_promover     (promover pré-título)
--   cnab_gerar_remessa      << GERA O ARQUIVO DE REMESSA BANCÁRIA
--   malote_executar         << EXECUTA O LOTE / ENVIA AO BANCO
-- As duas últimas movimentam dinheiro. Levantamento em produção: 40 pessoas
-- ativas podiam fazer isso, a maioria por perfis Legado sem nenhuma relação
-- com finanças — Legado: comercial (10), operacional (9), sst (6), juridico
-- (5). Gente de SST e Jurídico podia mandar ordem de pagamento ao banco.
--
-- Idem em `contas-receber | alterar` (dar baixa + gerar boleto/PIX + remessa
-- de cobrança) e `contas-receber | incluir` (faturar contrato).
--
-- AS QUATRO CAPACIDADES NOVAS (flags = menu sem rota, padrão já usado no ERP)
--   financeiro_remessa_banco    → cnab_gerar_remessa, malote_executar,
--                                 cnab_gerar_remessa_cobranca
--   financeiro_baixar_titulo    → titulo_pagar_baixar, titulo_baixar
--   financeiro_gerar_cobranca   → cobranca_gerar_boleto, cobranca_gerar_pix
--   financeiro_faturar_contrato → faturar_contrato_competencia,
--                                 emitir_titulo_de_cronograma
--
-- SEMEADURA — DECISÃO EXPLÍCITA DO USUÁRIO
-- Diferente da migration do Suprimentos (que preservou exatamente quem podia),
-- aqui a semeadura CORTA de propósito: só perfis de finanças recebem as flags.
-- 23 pessoas ativas perdem a capacidade de gerar remessa bancária. Foi a
-- escolha consciente do usuário ao ver o levantamento acima.
--
-- Exceções individuais (screen_permission_user) são preservadas: são decisões
-- deliberadas por pessoa, não acesso genérico herdado de perfil. Na prática
-- isso mantém MILENA DA CUNHA CASTRO, cujo perfil é 'Legado: sst' e cujo
-- acesso depende só da exceção individual — sem esta cláusula ela perderia.
--
-- ROLLBACK: recriar as 9 funções com a checagem antiga (o bloco DO abaixo faz
-- o caminho inverso trocando flag→(menu,acao) original), depois:
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo LIKE 'financeiro\_%';
--   DELETE FROM public.screen_permission_user  WHERE menu_codigo LIKE 'financeiro\_%';
--   DELETE FROM public.app_menu                WHERE codigo      LIKE 'financeiro\_%';

-- ── 1. As quatro flags ───────────────────────────────────────────────────────

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT mo.id, v.codigo, v.nome, NULL,
       COALESCE((SELECT max(am.ordem) FROM public.app_menu am WHERE am.modulo_id = mo.id), 0) + 10
FROM public.app_modulo mo
JOIN (VALUES
  ('financeiro_remessa_banco',    'Enviar remessa ao banco (CNAB)'),
  ('financeiro_baixar_titulo',    'Dar baixa em título'),
  ('financeiro_gerar_cobranca',   'Gerar boleto / PIX'),
  ('financeiro_faturar_contrato', 'Faturar contrato')
) AS v(codigo, nome) ON true
WHERE mo.nome = 'Financeiro'
  AND NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = v.codigo);

-- ── 2. Semeadura ────────────────────────────────────────────────────────────

-- Perfis: só os de finanças, e só se já tinham a permissão de origem.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pap.perfil_id, v.flag, 'visualizar'::app_acao, true
FROM public.perfil_acesso_permissao pap
JOIN public.perfil_acesso pa ON pa.id = pap.perfil_id AND pa.ativo
JOIN (VALUES
  ('contas-pagar',   'alterar', 'financeiro_remessa_banco'),
  ('contas-receber', 'alterar', 'financeiro_remessa_banco'),
  ('contas-pagar',   'alterar', 'financeiro_baixar_titulo'),
  ('contas-receber', 'alterar', 'financeiro_baixar_titulo'),
  ('contas-receber', 'alterar', 'financeiro_gerar_cobranca'),
  ('contas-receber', 'incluir', 'financeiro_faturar_contrato')
) AS v(menu_origem, acao_origem, flag)
  ON pap.menu_codigo = v.menu_origem AND pap.acao::text = v.acao_origem
WHERE pap.allow = true
  AND pa.nome IN ('Financeiro', 'Legado: financeiro', 'Legado: controladoria', 'Legado: diretor_adm')
ON CONFLICT DO NOTHING;

-- Exceções individuais: preservadas (decisão por pessoa, não herança de perfil).
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id)
SELECT DISTINCT spu.user_id, v.flag, 'visualizar'::app_acao, true, NULL::uuid
FROM public.screen_permission_user spu
JOIN (VALUES
  ('contas-pagar',   'alterar', 'financeiro_remessa_banco'),
  ('contas-receber', 'alterar', 'financeiro_remessa_banco'),
  ('contas-pagar',   'alterar', 'financeiro_baixar_titulo'),
  ('contas-receber', 'alterar', 'financeiro_baixar_titulo'),
  ('contas-receber', 'alterar', 'financeiro_gerar_cobranca'),
  ('contas-receber', 'incluir', 'financeiro_faturar_contrato')
) AS v(menu_origem, acao_origem, flag)
  ON spu.menu_codigo = v.menu_origem AND spu.acao::text = v.acao_origem
WHERE spu.allow = true AND spu.empresa_id IS NULL
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO UPDATE SET allow = true, updated_at = now();

-- ── 3. As 9 funções passam a checar a flag ──────────────────────────────────
--
-- Troca CIRÚRGICA: reescreve só a linha do can_access em cada função, via
-- regexp sobre pg_get_functiondef. Preferi isto a colar os 9 corpos inteiros
-- aqui — alguns são longos (cnab_gerar_remessa monta o arquivo CNAB linha a
-- linha) e transcrever à mão é justamente onde se introduz bug silencioso.
--
-- A troca é verificada duas vezes e FALHA ALTO se algo não bater:
--   • por função, se o regexp não casou nada (checagem mudou desde a auditoria)
--   • no fim, se o total alterado não for exatamente 9.
-- Assim a migration nunca "passa" tendo alterado só metade.

DO $mig$
DECLARE
  r          record;
  v_atual    text;
  v_novo     text;
  v_contador int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, v.menu_origem, v.acao_origem, v.flag
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    JOIN (VALUES
      ('cnab_gerar_remessa',           'contas-pagar',   'alterar', 'financeiro_remessa_banco'),
      ('malote_executar',              'contas-pagar',   'alterar', 'financeiro_remessa_banco'),
      ('cnab_gerar_remessa_cobranca',  'contas-receber', 'alterar', 'financeiro_remessa_banco'),
      ('titulo_pagar_baixar',          'contas-pagar',   'alterar', 'financeiro_baixar_titulo'),
      ('titulo_baixar',                'contas-receber', 'alterar', 'financeiro_baixar_titulo'),
      ('cobranca_gerar_boleto',        'contas-receber', 'alterar', 'financeiro_gerar_cobranca'),
      ('cobranca_gerar_pix',           'contas-receber', 'alterar', 'financeiro_gerar_cobranca'),
      ('faturar_contrato_competencia', 'contas-receber', 'incluir', 'financeiro_faturar_contrato'),
      ('emitir_titulo_de_cronograma',  'contas-receber', 'incluir', 'financeiro_faturar_contrato')
    ) AS v(fn, menu_origem, acao_origem, flag) ON v.fn = p.proname
    WHERE p.prokind = 'f'
  LOOP
    v_atual := pg_get_functiondef(r.oid);
    v_novo  := replace(
      v_atual,
      format('public.can_access(auth.uid(), %L, %L::app_acao)', r.menu_origem, r.acao_origem),
      format('public.can_access(auth.uid(), %L, %L::app_acao)', r.flag, 'visualizar')
    );

    IF v_novo = v_atual THEN
      RAISE EXCEPTION
        'Checagem can_access(%, %) não encontrada em %(). A função mudou desde a auditoria — revise antes de rodar.',
        r.menu_origem, r.acao_origem, r.proname;
    END IF;

    EXECUTE v_novo;
    v_contador := v_contador + 1;
  END LOOP;

  IF v_contador <> 9 THEN
    RAISE EXCEPTION 'Esperava alterar 9 funções, alterei %. Abortado.', v_contador;
  END IF;
END $mig$;
