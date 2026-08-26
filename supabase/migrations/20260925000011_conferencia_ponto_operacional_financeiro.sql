-- =========================================================================
-- CONFERÊNCIA DE PONTO — as outras duas portas (Operacional e Financeiro)
--
-- Complementa a 20260925000010, que criou o sistema só dentro do RH. O fluxo
-- atravessa TRÊS setores, e obrigar o Operacional e o Financeiro a entrar
-- pelo módulo do RH para ver o próprio trabalho é o tipo de coisa que faz a
-- pessoa voltar a controlar por planilha.
--
-- MESMA TELA, três rotas. O que a pessoa PODE FAZER continua saindo das
-- quatro chaves de ação criadas na 20260925000010 — a porta só decide se ela
-- enxerga a tela, nunca o que ela pode decidir nela:
--
--   rh_conferencia_ponto           /app/rh/conferencia-ponto
--   operacional_conferencia_ponto  /app/operacional/conferencia-ponto   ← aqui
--   financeiro_conferencia_ponto   /app/financeiro/conferencia-ponto    ← aqui
--
-- É o mesmo desenho da Mudança de Função depois da 20260925000009: uma tela,
-- várias portas, e o recorte na permissão.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota,
       COALESCE((SELECT max(y.ordem) FROM public.app_menu y WHERE y.modulo_id = m.id), 0) + 1,
       true
  FROM (VALUES
    ('operacional', 'operacional_conferencia_ponto', 'Conferência de Ponto', '/app/operacional/conferencia-ponto'),
    ('financeiro',  'financeiro_conferencia_ponto',  'Conferência de Ponto', '/app/financeiro/conferencia-ponto')
  ) AS x(modulo, codigo, nome, rota)
  JOIN public.app_modulo m ON m.codigo = x.modulo
 WHERE NOT EXISTS (SELECT 1 FROM public.app_menu z WHERE z.codigo = x.codigo);

-- ── Conferência ──────────────────────────────────────────────────────────
-- Esperado: 3 telas com rota + 4 fantasmas de ação.
SELECT mo.codigo AS modulo, m.codigo AS menu, COALESCE(m.rota, '(fantasma — só permissão)') AS rota, m.ativo
  FROM public.app_menu m
  JOIN public.app_modulo mo ON mo.id = m.modulo_id
 WHERE m.codigo LIKE '%conferencia_ponto%' OR m.codigo LIKE 'ponto\_%'
 ORDER BY mo.ordem, m.ordem;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DE RODAR: liberar em Administração › Acesso por Usuário.
--   operacional_conferencia_ponto → quem confere o ponto nos contratos
--   financeiro_conferencia_ponto  → quem paga
-- E, à parte, as quatro chaves de AÇÃO da 20260925000010 — ver a tela e
-- poder agir nela continuam sendo duas perguntas diferentes.
-- =========================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo IN
--     ('operacional_conferencia_ponto','financeiro_conferencia_ponto');
-- =========================================================================
