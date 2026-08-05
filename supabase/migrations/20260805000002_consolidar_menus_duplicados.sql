-- =====================================================================
-- ACESSO — consolidar menus duplicados no app_menu
--
-- Sete rotas tinham DOIS menus ativos apontando para elas. Como o desempate
-- do resolvedor é por tamanho de rota e as rotas são idênticas, o acesso
-- dependia da ordem de retorno do banco (sem ORDER BY). Sintoma real: usuária
-- com "4/4 menus liberados" no Recrutamento não via nada, porque a tela de
-- Acesso por Usuário concedia `recrutamento_gestao` e o resolvedor cobrava
-- `recrutamento`.
--
-- Aqui a duplicidade some da ORIGEM: um código por rota no app_menu.
--
-- Qual fica: o que o banco e o app realmente usam. Levantado por evidência,
-- não por preferência —
--   recrutamento_gestao  11 policies / 12 referências no app
--   advertencias          5 policies      candidatos   5 policies
--   patrimonios           4 policies      duvidas      3 policies
--   processos             3 policies
-- Os legados (`recrutamento`, `juridico_*`) não aparecem em NENHUMA policy
-- nem em NENHUMA linha do app: são só entradas de menu com concessões.
--
-- FORA daqui, de propósito: o par /app/financeiro/fluxo-caixa-diario. O
-- segundo código (financeiro.fluxo_caixa_diario.consolidado_empresas) NÃO é
-- uma tela duplicada — é uma capacidade DENTRO da tela (podeConsolidar, em
-- FluxoCaixaDiario.tsx). Fundir daria "consolidar empresas" a ~60 pessoas.
-- Para ele, basta limpar a rota: é o que causava a colisão.
--
-- Idempotente. ROLLBACK no fim do arquivo.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."APP_MENU_CONSOLIDACAO_BACKUP" (
  origem            text NOT NULL,          -- 'perfil' | 'usuario' | 'menu'
  menu_legado       text NOT NULL,
  menu_canonico     text,
  detalhe           jsonb NOT NULL,
  consolidado_em    timestamptz NOT NULL DEFAULT now()
);

-- Pares: legado -> canônico.
CREATE TEMP TABLE _pares(legado text, canonico text) ON COMMIT DROP;
INSERT INTO _pares VALUES
  ('recrutamento',           'recrutamento_gestao'),
  ('juridico_processos',     'processos'),
  ('juridico_patrimonios',   'patrimonios'),
  ('juridico_advertencias',  'advertencias'),
  ('juridico_candidatos',    'candidatos'),
  ('juridico_duvidas',       'duvidas');

-- ── 1. Guarda o que existe hoje, para desfazer ──
INSERT INTO public."APP_MENU_CONSOLIDACAO_BACKUP" (origem, menu_legado, menu_canonico, detalhe)
SELECT 'perfil', p.legado, p.canonico, to_jsonb(x)
  FROM _pares p JOIN public.perfil_acesso_permissao x ON x.menu_codigo = p.legado;

INSERT INTO public."APP_MENU_CONSOLIDACAO_BACKUP" (origem, menu_legado, menu_canonico, detalhe)
SELECT 'usuario', p.legado, p.canonico, to_jsonb(x)
  FROM _pares p JOIN public.screen_permission_user x ON x.menu_codigo = p.legado;

INSERT INTO public."APP_MENU_CONSOLIDACAO_BACKUP" (origem, menu_legado, menu_canonico, detalhe)
SELECT 'menu', p.legado, p.canonico, to_jsonb(m)
  FROM _pares p JOIN public.app_menu m ON m.codigo = p.legado;

-- ── 2. Migra as concessões do legado para o canônico ──
-- Só onde o canônico AINDA NÃO tem linha para aquele (perfil/usuário, ação):
-- decisão explícita já registrada no código atual continua valendo.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT ON (x.perfil_id, p.canonico, x.acao)
       x.perfil_id, p.canonico, x.acao, x.allow
  FROM _pares p
  JOIN public.perfil_acesso_permissao x ON x.menu_codigo = p.legado
 WHERE NOT EXISTS (
   SELECT 1 FROM public.perfil_acesso_permissao y
    WHERE y.perfil_id = x.perfil_id AND y.menu_codigo = p.canonico AND y.acao = x.acao)
 ORDER BY x.perfil_id, p.canonico, x.acao, x.allow DESC;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id)
SELECT DISTINCT ON (x.user_id, p.canonico, x.acao)
       x.user_id, p.canonico, x.acao, x.allow, NULL
  FROM _pares p
  JOIN public.screen_permission_user x ON x.menu_codigo = p.legado
 WHERE x.empresa_id IS NULL
   AND NOT EXISTS (
   SELECT 1 FROM public.screen_permission_user y
    WHERE y.user_id = x.user_id AND y.menu_codigo = p.canonico
      AND y.acao = x.acao AND y.empresa_id IS NULL)
 ORDER BY x.user_id, p.canonico, x.acao, x.allow DESC;

-- ── 3. Tira o legado de circulação ──
-- Desativa em vez de apagar: as concessões antigas ficam no banco, e reverter
-- é um UPDATE. As linhas legadas param de ser resolvidas porque
-- list_accessible_menus só enxerga app_menu.ativo = true.
UPDATE public.app_menu m SET ativo = false
  FROM _pares p WHERE m.codigo = p.legado AND m.ativo;

-- ── 4. Financeiro: capacidade não é tela ──
-- Sem rota, para de colidir com /app/financeiro/fluxo-caixa-diario. Continua
-- ativa e concedível normalmente em Acesso por Usuário.
INSERT INTO public."APP_MENU_CONSOLIDACAO_BACKUP" (origem, menu_legado, menu_canonico, detalhe)
SELECT 'menu', m.codigo, NULL, to_jsonb(m) FROM public.app_menu m
 WHERE m.codigo = 'financeiro.fluxo_caixa_diario.consolidado_empresas' AND m.rota IS NOT NULL;

UPDATE public.app_menu SET rota = NULL
 WHERE codigo = 'financeiro.fluxo_caixa_diario.consolidado_empresas';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   UPDATE public.app_menu m SET ativo = true, rota = (b.detalhe->>'rota')
--     FROM public."APP_MENU_CONSOLIDACAO_BACKUP" b
--    WHERE b.origem = 'menu' AND m.codigo = b.menu_legado;
--   -- e apagar as linhas inseridas nos canônicos comparando com o backup.
