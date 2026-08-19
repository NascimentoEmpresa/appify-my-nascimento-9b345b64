-- 20 perfis de acesso nomeados exatamente como um módulo (Suprimentos,
-- Financeiro, Licitações, Fiscal, Contábil, Contratos, Jurídico, RH, SST,
-- Controladoria & Orçamento, Sistemas, Central de Serviços, Plano de Ações,
-- Recrutamento e Seleção, BI, Comitê de Ética, WhatsApp, Administração,
-- Malote, Operacional) estavam essencialmente vazios — só tinham 2-3
-- permissões genéricas que sobraram de algum seed (central_servicos_veiculos,
-- chamados_sistemas_abrir), nenhuma das telas reais do módulo.
--
-- Efeito colateral grave: a primeira vez que QUALQUER exceção individual é
-- gravada em screen_permission_user pra uma tela (ex.: via "Acesso por
-- Usuário"), essa tela vira "configurada" pra todo o sistema
-- (list_configured_menu_codes) e para de estar aberta por padrão pra quem
-- não tem permissão explícita. Como esses perfis estavam vazios, todo mundo
-- que dependia só do perfil (sem exceção individual própria) perdia acesso
-- de uma hora pra outra — daí o "só funciona com Administrador Geral".
--
-- Mesmo tratamento já aplicado ao perfil "Encarregados" em
-- 20260818000005_perfil_encarregados_completo.sql, agora pra todos os outros
-- 19 de uma vez: visualizar em cada tela ativa do módulo correspondente
-- (casamento por nome exato perfil_acesso.nome = app_modulo.nome, confirmado
-- 1:1 via SELECT antes de escrever esta migration).
--
-- Ações de escrita (incluir/alterar/excluir) ficam de fora de propósito —
-- não é uma decisão pra tomar em massa numa migration; ver a tela "Acesso
-- por Usuário" / "Por Módulo" pra conceder isso pessoa por pessoa.
--
-- Ficam de fora: "Painel da Presidência", "SETOR NOVO", "Teste Automático"
-- (sem módulo correspondente 1:1) e "Legado: *"/"Administrador Geral" (já
-- têm conteúdo próprio, não fazem parte deste problema).
--
-- ROLLBACK:
-- DELETE FROM public.perfil_acesso_permissao pap
--  USING public.perfil_acesso pa, public.app_modulo mo
--  WHERE pap.perfil_id = pa.id AND pa.nome = mo.nome AND pap.acao = 'visualizar'
--    AND pap.menu_codigo IN (SELECT codigo FROM public.app_menu WHERE modulo_id = mo.id);

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, am.codigo, 'visualizar', true
FROM public.perfil_acesso pa
JOIN public.app_modulo mo ON mo.nome = pa.nome
JOIN public.app_menu am ON am.modulo_id = mo.id AND am.ativo = true
WHERE pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT DO NOTHING;
