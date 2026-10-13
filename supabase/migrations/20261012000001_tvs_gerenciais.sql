-- =========================================================================
-- TV's — TVs GERENCIAIS POR DIRETORIA (12/10/2026) — SIS-2026-0635
--
-- PEDIDO (chamado SIS-2026-0635, Iury/Sistemas): "fazer as telas para TVs
-- conforme os anexos" — documento "Indicadores das TVs — Separação por
-- Diretoria e Áreas Transversais" (Grupo Nascimento, jul/2026). 13 TVs:
--   Diretor Operacional ... Gerência Operacional, Licitações, Supply,
--                           Frota e Patrimônio;
--   Diretora Administrativa Recrutamento e Seleção, RH (com DP), SST,
--                           Treinamento, Financeiro, Jurídico;
--   Transversais ......... Controladoria, TI/ERP, Presidência.
--
-- REGRAS DO DOCUMENTO (Parte IV) e como ficaram:
--   · cada indicador mostra resultado, meta, contrato/setor afetado, causa
--     principal e responsável → colunas do cálculo/lançamento + responsável
--     do cadastro;
--   · "fonte, periodicidade, meta e regra de semáforo parametrizáveis" →
--     TVG_INDICADOR (meta, limite de atenção, sentido, periodicidade,
--     responsável, parâmetro do cálculo, na TV ou não), editável na tela
--     TV's › Indicadores gerenciais;
--   · "fora da meta primeiro, ordenado pelo impacto absoluto" → a ordem é
--     feita na tela (src/lib/tv/gerencial.ts, com teste);
--   · "consolidado abre os subindicadores" → TVG_INDICADOR.pai (subs não
--     ocupam a TV; abrem no detalhe) e fonte 'soma' (consolidado = soma);
--   · "detalhamento por clique, sem poluir a TV" → a TV mostra o resumo; o
--     detalhe (por contrato, histórico, subindicadores) é a tela de gestão.
--
-- FONTES (TVG_INDICADOR.fonte):
--   auto    — calculado do ERP em tvg_calc() (vagas, quadro × folha,
--             turn-over, glosas, grade de licitações, estoque, pedidos,
--             patrimônio, NF, jurídico, plano de ação, chamados…). A regra
--             de cada um fica escrita em TVG_INDICADOR.regra (aparece no
--             detalhe);
--   manual  — o ERP não tem a informação (margem real, faltas do ponto,
--             ASO, EPI, eSocial, backups…): o líder LANÇA o número
--             (TVG_LANCAMENTO) com contrato afetado, causa e responsável.
--             Sem lançamento dentro da periodicidade → conta em
--             "Indicadores não atualizados" (Controladoria);
--   espelho — o mesmo número de outro indicador (Presidência, RH↔Operação);
--   soma    — soma dos `componentes` (consolidados).
--
-- PRIVACIDADE: a TV fica em área comum — nenhum cálculo devolve nome de
-- pessoa (só contrato, cidade, setor, motivo, etapa), como os relatórios.
--
-- ACESSO: menu tvs_gerenciais (módulo TV's, Acesso por Usuário). A TV lê
-- por tv_relatorio(token) como os outros relatórios; a prévia da gestão
-- usa tvg_painel(), que pede tvs_gerenciais OU sistemas_tvs.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT id, 'tvs_gerenciais', 'Indicadores gerenciais', '/app/sistemas/tvs/indicadores', 2, true
  FROM public.app_modulo WHERE codigo = 'tvs'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- Quem libera: tela nova nasce FECHADA (mig 20261008000006 — o "concede
-- tudo" não alcança). Quem já gerencia as TVs (sistemas_tvs, hoje só por
-- exceção individual) ganha as mesmas ações aqui, inclusive `excluir`
-- (apagar lançamento — fora do toggle padrão, J1.A); os demais, pelo painel
-- Acesso por Usuário (toggle = visualizar/incluir/alterar; excluir à parte).
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow)
SELECT s.user_id, 'tvs_gerenciais', s.acao, true
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'sistemas_tvs' AND s.allow
   AND s.acao IN ('visualizar', 'incluir', 'alterar', 'excluir')
ON CONFLICT DO NOTHING;
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'tvs_gerenciais', p.acao, true
  FROM public.perfil_acesso_permissao p JOIN public.perfil_acesso pa ON pa.id = p.perfil_id AND pa.ativo AND NOT pa.concede_tudo
 WHERE p.menu_codigo = 'sistemas_tvs' AND p.allow AND p.acao IN ('visualizar', 'incluir', 'alterar', 'excluir')
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 2) Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."TVG_PAINEL" (
  slug       text PRIMARY KEY,
  titulo     text NOT NULL,
  diretoria  text NOT NULL,
  pergunta   text NOT NULL,
  ordem      int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public."TVG_INDICADOR" (
  codigo        text PRIMARY KEY,
  painel        text NOT NULL REFERENCES public."TVG_PAINEL"(slug) ON UPDATE CASCADE,
  ordem         int  NOT NULL DEFAULT 0,
  nome          text NOT NULL,
  identificar   text NOT NULL,              -- "o que a empresa precisa identificar"
  regra         text,                       -- como é calculado (aparece no detalhe)
  fonte         text NOT NULL DEFAULT 'manual' CHECK (fonte IN ('auto', 'manual', 'espelho', 'soma')),
  espelho_de    text,
  componentes   text[],
  unidade       text NOT NULL DEFAULT 'qtd' CHECK (unidade IN ('qtd', 'pct', 'brl', 'dias')),
  sentido       text NOT NULL DEFAULT 'menor' CHECK (sentido IN ('menor', 'maior')),
  meta          numeric,                    -- null = só acompanhamento (sem semáforo)
  alerta        numeric,                    -- limite de atenção (amarelo) entre a meta e o vermelho
  periodicidade text NOT NULL DEFAULT 'mensal' CHECK (periodicidade IN ('diaria', 'semanal', 'mensal')),
  responsavel   text,
  parametro     numeric,                    -- ajuste do cálculo (dias, prazo…) — ver parametro_rotulo
  parametro_rotulo text,
  pai           text REFERENCES public."TVG_INDICADOR"(codigo) ON DELETE SET NULL,
  na_tv         boolean NOT NULL DEFAULT true,
  ativo         boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);
CREATE INDEX IF NOT EXISTS idx_tvg_indicador_painel ON public."TVG_INDICADOR" (painel, ordem);

CREATE TABLE IF NOT EXISTS public."TVG_LANCAMENTO" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicador    text NOT NULL REFERENCES public."TVG_INDICADOR"(codigo) ON DELETE CASCADE ON UPDATE CASCADE,
  referencia   date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  valor        numeric NOT NULL,
  afetado      text,
  causa        text,
  responsavel  text,
  impacto      numeric,                     -- R$ em jogo (ordena a TV pelo impacto absoluto)
  detalhe      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{nome, valor, rotulo?}] — por contrato/cidade
  observacao   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT auth.uid(),
  created_by_nome text,
  CONSTRAINT tvg_lancamento_detalhe_array CHECK (jsonb_typeof(detalhe) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_tvg_lancamento_ind ON public."TVG_LANCAMENTO" (indicador, referencia DESC, created_at DESC);

ALTER TABLE public."TVG_PAINEL" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TVG_INDICADOR" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TVG_LANCAMENTO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tvg_painel_select ON public."TVG_PAINEL";
CREATE POLICY tvg_painel_select ON public."TVG_PAINEL" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'));
DROP POLICY IF EXISTS tvg_painel_update ON public."TVG_PAINEL";
CREATE POLICY tvg_painel_update ON public."TVG_PAINEL" FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'alterar'));

DROP POLICY IF EXISTS tvg_indicador_select ON public."TVG_INDICADOR";
CREATE POLICY tvg_indicador_select ON public."TVG_INDICADOR" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'));
DROP POLICY IF EXISTS tvg_indicador_update ON public."TVG_INDICADOR";
CREATE POLICY tvg_indicador_update ON public."TVG_INDICADOR" FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'alterar'));

DROP POLICY IF EXISTS tvg_lancamento_select ON public."TVG_LANCAMENTO";
CREATE POLICY tvg_lancamento_select ON public."TVG_LANCAMENTO" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar'));
DROP POLICY IF EXISTS tvg_lancamento_insert ON public."TVG_LANCAMENTO";
CREATE POLICY tvg_lancamento_insert ON public."TVG_LANCAMENTO" FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'incluir'));
DROP POLICY IF EXISTS tvg_lancamento_delete ON public."TVG_LANCAMENTO";
CREATE POLICY tvg_lancamento_delete ON public."TVG_LANCAMENTO" FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'excluir'));

-- Quem alterou o cadastro fica registrado (a policy só deixa quem pode).
CREATE OR REPLACE FUNCTION public.tvg_indicador_carimbo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now(); NEW.updated_by := auth.uid();
  -- Código, painel e fonte são do sistema: a tela só mexe nos parâmetros.
  NEW.codigo := OLD.codigo; NEW.painel := OLD.painel; NEW.fonte := OLD.fonte;
  NEW.espelho_de := OLD.espelho_de; NEW.componentes := OLD.componentes; NEW.pai := OLD.pai;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tvg_indicador_carimbo ON public."TVG_INDICADOR";
CREATE TRIGGER trg_tvg_indicador_carimbo BEFORE UPDATE ON public."TVG_INDICADOR"
  FOR EACH ROW WHEN (auth.uid() IS NOT NULL) EXECUTE FUNCTION public.tvg_indicador_carimbo();

CREATE OR REPLACE FUNCTION public.tvg_lancamento_autor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.created_by := auth.uid();
  NEW.created_by_nome := COALESCE((SELECT coalesce(p.display_name, p.email) FROM public.profiles p WHERE p.id = auth.uid()), NEW.created_by_nome);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tvg_lancamento_autor ON public."TVG_LANCAMENTO";
CREATE TRIGGER trg_tvg_lancamento_autor BEFORE INSERT ON public."TVG_LANCAMENTO"
  FOR EACH ROW WHEN (auth.uid() IS NOT NULL) EXECUTE FUNCTION public.tvg_lancamento_autor();

-- ── 3) Painéis (as 13 TVs do documento) ─────────────────────────────────
INSERT INTO public."TVG_PAINEL" (slug, titulo, diretoria, pergunta, ordem) VALUES
 ('ger-operacional',  'Gerência Operacional', 'Diretor Operacional', 'Qual contrato não está sendo entregue corretamente e qual contrato está consumindo dinheiro?', 10),
 ('ger-licitacoes',   'Licitações', 'Diretor Operacional', 'Qual licitação pode ser perdida por prazo, documento, preço ou falha de preparação, e qual contrato vencido ainda não foi encaminhado para implantação?', 20),
 ('ger-supply',       'Supply', 'Diretor Operacional', 'O que pode faltar, o que está parado e qual atraso pode interromper a operação?', 30),
 ('ger-frota',        'Frota e Patrimônio', 'Diretor Operacional', 'Qual veículo ou patrimônio está gerando risco de perda, parada ou gasto desnecessário?', 40),
 ('ger-recrutamento', 'Recrutamento e Seleção', 'Diretora Administrativa', 'Qual contrato corre risco de ficar sem trabalhador por falha de recrutamento?', 50),
 ('ger-rh',           'RH e Departamento Pessoal', 'Diretora Administrativa', 'Onde estamos com pessoas demais, pessoas de menos, custos acima do que o contrato suporta ou risco trabalhista?', 60),
 ('ger-sst',          'SST', 'Diretora Administrativa', 'Quem está trabalhando sem estar legalmente ou tecnicamente apto?', 70),
 ('ger-treinamento',  'Treinamento', 'Diretora Administrativa', 'Existe alguém trabalhando sem ter sido treinado ou sem comprovação do treinamento?', 80),
 ('ger-financeiro',   'Financeiro', 'Diretora Administrativa', 'Quanto dinheiro deveria estar no caixa e ainda não está?', 90),
 ('ger-juridico',     'Jurídico', 'Diretora Administrativa', 'Qual prazo, processo ou notificação pode gerar perda financeira ou jurídica para a empresa?', 100),
 ('ger-controladoria','Controladoria', 'Áreas Transversais', 'Onde a empresa está perdendo margem e onde os gestores não estão corrigindo os desvios?', 110),
 ('ger-ti',           'TI / ERP', 'Áreas Transversais', 'Qual falha tecnológica está impedindo trabalho, gerando risco ou afetando dinheiro?', 120),
 ('ger-presidencia',  'Presidência', 'Presidência', 'Onde estamos perdendo dinheiro, onde não estamos cumprindo o contrato e onde algum gestor precisa agir imediatamente?', 130)
ON CONFLICT (slug) DO UPDATE SET titulo = EXCLUDED.titulo, diretoria = EXCLUDED.diretoria, ordem = EXCLUDED.ordem;

-- ── 4) Indicadores (seed — ON CONFLICT não pisa no que a gestão parametrizou) ─
-- Colunas: codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta,
--          periodicidade, responsavel, parametro, parametro_rotulo, pai, na_tv, espelho_de, componentes, regra
INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, parametro, parametro_rotulo, pai, na_tv, espelho_de, componentes, regra)
VALUES
 -- ===== GERÊNCIA OPERACIONAL =====
 ('op_postos', 'ger-operacional', 1, 'Postos contratados x cobertos', 'Contratos nos quais a empresa não está entregando o quantitativo de postos vendido.', 'auto', 'qtd', 'menor', 0, 5, 'diaria', 'Gerência Operacional', NULL, NULL, NULL, true, NULL, NULL,
  'Por contrato ativo: postos contratados (cadastro do contrato, "funcionários estipulados") menos colaboradores com situação Trabalhando na folha (Senior). Soma só a falta. Causa: o que explica a falta — afastamentos, férias ou quadro incompleto. Contratos sem vínculo com a folha não entram.'),
 ('op_lucratividade', 'ger-operacional', 2, 'Lucratividade por contrato (%)', 'Contratos com prejuízo ou margem abaixo da prevista na licitação.', 'manual', 'pct', 'maior', 10, 5, 'mensal', 'Controladoria', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado pela Controladoria: margem real do mês. No detalhe, uma linha por contrato com a margem.'),
 ('op_custo_direto', 'ger-operacional', 3, 'Custo direto acima do orçado (%)', 'Onde mão de obra, benefícios, insumos ou demais custos diretos ultrapassaram o orçamento.', 'manual', 'pct', 'menor', 0, 5, 'mensal', 'Controladoria', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado pela Controladoria: desvio do custo direto realizado sobre o orçado. Detalhe por contrato e causa (rubrica).'),
 ('op_glosas', 'ger-operacional', 4, 'Glosas por contrato', 'O valor perdido, o contrato afetado e a principal causa.', 'auto', 'brl', 'menor', 0, 5000, 'semanal', 'Operação', 90, 'Janela (dias)', NULL, true, NULL, NULL,
  'Notificações do Jurídico do tipo Glosa recebidas na janela (não revertidas): valor final (ou original, se ainda sem desfecho). Causa: a causa-raiz / assunto de maior valor.'),
 ('op_faltas', 'ger-operacional', 5, 'Faltas por contrato (%)', 'Onde as ausências comprometem a cobertura e elevam o custo operacional.', 'manual', 'pct', 'menor', 2, 4, 'semanal', 'Gerência Operacional', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado pela Operação a partir do ponto: faltas ÷ dias previstos. Detalhe por contrato.'),
 ('op_turnover', 'ger-operacional', 6, 'Turnover por contrato (%)', 'Contratos com equipes instáveis e reposições frequentes.', 'auto', 'pct', 'menor', 3, 5, 'mensal', 'Gerência Operacional', 3, 'Meses na média', NULL, true, NULL, NULL,
  'Turn-over do painel da Diretoria (desligamentos ÷ efetivo médio), média mensal dos últimos meses do ano. Detalhe: contratos com 10 ou mais pessoas, pela taxa. Causa: o motivo de desligamento mais frequente.'),
 ('op_reclamacoes', 'ger-operacional', 7, 'Reclamações ou baixa satisfação', 'Contratos com risco de desgaste, penalidade ou perda do cliente.', 'manual', 'qtd', 'menor', 0, 2, 'semanal', 'Gerência Operacional', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado pela Operação: reclamações formais ou pesquisas abaixo da nota mínima no período. Detalhe por contrato.'),
 ('op_satisfacao_colab', 'ger-operacional', 20, 'Satisfação dos colaboradores', 'Clima das equipes por contrato.', 'manual', 'pct', 'maior', 80, 70, 'mensal', 'Gerência Operacional', NULL, NULL, NULL, false, NULL, NULL,
  'Subindicador (fica no sistema, não ocupa a TV). Lançado a partir da pesquisa de satisfação.'),
 ('op_feedbacks', 'ger-operacional', 21, 'Feedbacks em atraso', 'Feedbacks combinados e não realizados.', 'manual', 'qtd', 'menor', 0, 5, 'mensal', 'Gerência Operacional', NULL, NULL, NULL, false, NULL, NULL,
  'Subindicador. Lançado pela Operação.'),
 ('op_experiencia', 'ger-operacional', 22, 'Contratos de experiência sem avaliação', 'Cruzamento entre pesquisa de satisfação, feedback e tempo de trabalho.', 'espelho', 'qtd', 'menor', 0, 3, 'semanal', 'Gerência Operacional', NULL, NULL, NULL, false, 'rh_ob_experiencia', NULL,
  'Subindicador — o mesmo número do RH (Obrigações trabalhistas).'),

 -- ===== LICITAÇÕES =====
 ('lic_prazo', 'ger-licitacoes', 1, 'Licitações estratégicas com prazo próximo', 'Oportunidades que exigem decisão, documentação ou atuação imediata.', 'auto', 'qtd', 'menor', 0, 2, 'diaria', 'Licitações', 3, 'Dias até a sessão', NULL, true, NULL, NULL,
  'Grade de licitações: processos ainda "À Iniciar" ou "Iniciado" com sessão de hoje até N dias. Detalhe: edital, cidade e dias até a sessão.'),
 ('lic_documentos', 'ger-licitacoes', 2, 'Documentação ou certidão pendente', 'Risco de impedimento ou desclassificação por documento inválido ou ausente.', 'manual', 'qtd', 'menor', 0, 1, 'semanal', 'Licitações', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado por Licitações: certidões vencidas ou documentos faltando para processos em andamento.'),
 ('lic_propostas', 'ger-licitacoes', 3, 'Propostas em elaboração x concluídas', 'Se todas as propostas programadas serão entregues dentro do prazo.', 'auto', 'pct', 'maior', 100, 80, 'diaria', 'Licitações', 7, 'Dias à frente', NULL, true, NULL, NULL,
  'Processos ativos com sessão nos próximos N dias: % já "Em Andamento" (proposta pronta) sobre o total. "À Iniciar" e "Iniciado" contam como em elaboração.'),
 ('lic_risco', 'ger-licitacoes', 4, 'Licitações com risco de desclassificação', 'Falhas técnicas, documentais, jurídicas ou de preço.', 'manual', 'qtd', 'menor', 0, 1, 'semanal', 'Licitações', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado por Licitações, com o motivo (técnico, documental, jurídico, preço) como causa.'),
 ('lic_implantacao', 'ger-licitacoes', 5, 'Licitações vencidas aguardando implantação', 'Novos contratos ainda não formalmente repassados aos setores responsáveis.', 'auto', 'qtd', 'menor', 0, 1, 'diaria', 'Licitações', 365, 'Janela (dias)', NULL, true, NULL, NULL,
  'Grade: processos Finalizados em 1º lugar na janela que ainda não têm Implantação de Contrato (pela capa) nem contrato cadastrado ligado à grade.'),
 ('lic_perdidas', 'ger-licitacoes', 6, 'Licitações perdidas e principal motivo', 'Perdas por preço, documentação, requisito técnico, prazo ou decisão de não participar.', 'auto', 'qtd', 'menor', NULL, NULL, 'semanal', 'Licitações', 90, 'Janela (dias)', NULL, true, NULL, NULL,
  'Grade: processos Finalizados fora do 1º lugar atualizados na janela. Motivo: a observação de status da grade (sem observação = "motivo não registrado").'),
 ('lic_valor', 'ger-licitacoes', 7, 'Valor potencial das propostas em andamento', 'A receita em disputa e os processos de maior relevância estratégica.', 'auto', 'brl', 'maior', NULL, NULL, 'semanal', 'Licitações', NULL, NULL, NULL, true, NULL, NULL,
  'Soma do valor global da grade dos processos À Iniciar, Iniciado e Em Andamento (mesma leitura do Painel Executivo). Detalhe: os maiores.'),

 -- ===== SUPPLY =====
 ('sup_compras_vencidas', 'ger-supply', 1, 'Compras vencidas e não entregues', 'Atrasos que possam comprometer a operação.', 'auto', 'qtd', 'menor', 0, 10, 'diaria', 'Supply', 15, 'Prazo de compra (dias)', NULL, true, NULL, NULL,
  'Pedidos de Suprimentos em "AGUARDANDO COMPRA" há mais que o prazo. Detalhe por contrato.'),
 ('sup_abaixo_minimo', 'ger-supply', 2, 'Itens abaixo do estoque mínimo', 'Materiais que podem faltar nos próximos dias.', 'auto', 'qtd', 'menor', 0, 10, 'diaria', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Itens de estoque ativos com estoque mínimo cadastrado e saldo disponível abaixo dele. Impacto: custo para repor até o mínimo.'),
 ('sup_valor_estoque', 'ger-supply', 3, 'Valor total do estoque', 'Quanto capital está imobilizado em materiais.', 'auto', 'brl', 'menor', NULL, NULL, 'semanal', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Saldo físico × valor unitário de cada item de estoque ativo. Detalhe: os itens de maior valor.'),
 ('sup_sem_mov', 'ger-supply', 4, 'Itens sem movimentação', 'Materiais comprados e não utilizados.', 'auto', 'qtd', 'menor', 0, 20, 'semanal', 'Supply', 90, 'Dias sem movimento', NULL, true, NULL, NULL,
  'Itens com saldo físico e nenhuma movimentação/consumo nos últimos N dias. Impacto: o valor parado.'),
 ('sup_fornecedor', 'ger-supply', 5, 'Pedidos em atraso por fornecedor', 'Fornecedores que estejam causando risco operacional.', 'manual', 'qtd', 'menor', 0, 2, 'semanal', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado por Supply: pedidos de compra atrasados, com o fornecedor no detalhe.'),
 ('sup_contratos_sem_entrega', 'ger-supply', 6, 'Contratos sem entrega de material prevista', 'Operações que não receberam os materiais necessários.', 'auto', 'qtd', 'menor', 0, 2, 'diaria', 'Supply', 10, 'Dias de espera', NULL, true, NULL, NULL,
  'Contratos com pedido de material aberto (aguardando compra, envio, preparação ou separação) há mais de N dias.'),

 -- ===== FROTA E PATRIMÔNIO =====
 ('fro_indisponiveis', 'ger-frota', 1, 'Veículos indisponíveis', 'Operações afetadas pela falta de veículo.', 'auto', 'qtd', 'menor', 0, 1, 'diaria', 'Frota', NULL, NULL, NULL, true, NULL, NULL,
  'Patrimônio categoria veículo, ativo, em manutenção ou marcado como indisponível. Detalhe: veículo e lotação.'),
 ('fro_manutencoes', 'ger-frota', 2, 'Manutenções vencidas', 'Veículos e equipamentos com risco de quebra ou acidente.', 'auto', 'qtd', 'menor', 0, 1, 'diaria', 'Frota', NULL, NULL, NULL, true, NULL, NULL,
  'Patrimônios em manutenção com a previsão de fim já vencida. Detalhe: dias de atraso.'),
 ('fro_documentos', 'ger-frota', 3, 'Documentos vencidos ou a vencer', 'Veículos sujeitos a multa ou impedimento de circulação.', 'manual', 'qtd', 'menor', 0, 1, 'semanal', 'Frota', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado pela Frota: licenciamento, seguro, IPVA e laudos vencidos ou a vencer em 30 dias.'),
 ('fro_combustivel', 'ger-frota', 4, 'Consumo de combustível fora da média', 'Desperdício, uso indevido ou possível problema mecânico.', 'manual', 'qtd', 'menor', 0, 1, 'mensal', 'Frota', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado pela Frota: veículos com km/l abaixo da média da categoria.'),
 ('fro_nao_localizados', 'ger-frota', 5, 'Patrimônios não localizados', 'Bens sem confirmação física.', 'manual', 'qtd', 'menor', 0, 1, 'mensal', 'Patrimônio', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado após o inventário físico.'),
 ('fro_sem_responsavel', 'ger-frota', 6, 'Patrimônios sem responsável', 'Bens sem responsabilização formal.', 'auto', 'qtd', 'menor', 0, 5, 'semanal', 'Patrimônio', NULL, NULL, NULL, true, NULL, NULL,
  'Patrimônios ativos sem contrato, sem posto e sem lotação informados. Detalhe por categoria.'),

 -- ===== RECRUTAMENTO E SELEÇÃO =====
 ('rec_risco', 'ger-recrutamento', 1, 'Vagas com risco de posto descoberto', 'Vagas que precisam ser preenchidas imediatamente para evitar falha contratual.', 'auto', 'qtd', 'menor', 0, 3, 'diaria', 'Recrutamento', NULL, NULL, NULL, true, NULL, NULL,
  'Vagas abertas (nem Concluídas, nem Contratadas, nem Reprovadas) com urgência "Alta". Conta a quantidade de vagas. Causa: a etapa onde mais estão paradas.'),
 ('rec_abertas', 'ger-recrutamento', 2, 'Vagas abertas por contrato e cidade', 'Onde está concentrado o problema de contratação.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Recrutamento', NULL, NULL, NULL, true, NULL, NULL,
  'Total de vagas abertas. Detalhe por contrato e cidade.'),
 ('rec_prazo', 'ger-recrutamento', 3, 'Vagas acima do prazo de preenchimento', 'Processos que estão demorando além do prazo aceitável.', 'auto', 'qtd', 'menor', 0, 5, 'diaria', 'Recrutamento', 15, 'Prazo (dias)', NULL, true, NULL, NULL,
  'Vagas abertas há mais que o prazo (desde a abertura da solicitação).'),
 ('rec_admissoes', 'ger-recrutamento', 4, 'Admissões previstas x concluídas', 'Se o setor entregará as pessoas necessárias na data combinada.', 'auto', 'pct', 'maior', 100, 85, 'diaria', 'Recrutamento', NULL, NULL, NULL, true, NULL, NULL,
  'Vagas com início previsto no mês até hoje (sem as reprovadas): % já Contratadas ou Concluídas.'),
 ('rec_desistencias', 'ger-recrutamento', 5, 'Desistências antes da admissão', 'Cidades, salários ou etapas do processo que afastam candidatos.', 'auto', 'qtd', 'menor', 0, 5, 'semanal', 'Recrutamento', 30, 'Janela (dias)', NULL, true, NULL, NULL,
  'Histórico do recrutamento: candidatos marcados como "desistiu" na janela. Detalhe por cidade; causa: a etapa onde mais desistem.'),

 -- ===== RH (com DP) =====
 ('rh_quadro', 'ger-rh', 1, 'Colaboradores ativos x necessários', 'Contratos com excesso ou falta de pessoas.', 'auto', 'qtd', 'menor', 0, 3, 'diaria', 'RH', 2, 'Tolerância (pessoas)', NULL, true, NULL, NULL,
  'Por contrato: colaboradores ativos na folha (todos menos demitidos) menos o quadro contratado. Conta os contratos com diferença acima da tolerância, para mais ou para menos.'),
 ('rh_salarios', 'ger-rh', 2, 'Salários e benefícios acima do orçamento (%)', 'Contratos ou cidades em que o custo de pessoal está consumindo a margem prevista.', 'manual', 'pct', 'menor', 0, 3, 'mensal', 'RH', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado pelo RH/Controladoria: folha + benefícios realizados sobre o orçado. Detalhe por contrato.'),
 ('rh_turnover', 'ger-rh', 3, 'Turnover por contrato (%)', 'Contratos com maior perda de colaboradores e necessidade de intervenção.', 'espelho', 'pct', 'menor', 3, 5, 'mensal', 'RH', NULL, NULL, NULL, true, 'op_turnover', NULL,
  'O mesmo número da Gerência Operacional.'),
 ('rh_absenteismo', 'ger-rh', 4, 'Absenteísmo por contrato (%)', 'Onde faltas e ausências comprometem produtividade, cobertura e custo.', 'manual', 'pct', 'menor', 3, 5, 'mensal', 'RH', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado pelo DP a partir do ponto: horas de ausência ÷ horas previstas. Detalhe por contrato.'),
 ('rh_obrigacoes', 'ger-rh', 5, 'Obrigações trabalhistas', 'Riscos de pagamento incorreto, multa ou passivo trabalhista.', 'soma', 'qtd', 'menor', 0, 5, 'semanal', 'Departamento Pessoal', NULL, NULL, NULL, true, NULL,
  ARRAY['rh_ob_folhas', 'rh_ob_rescisoes', 'rh_ob_ferias_vencidas', 'rh_ob_ferias_vencer', 'rh_ob_banco_horas', 'rh_ob_esocial', 'rh_ob_experiencia'],
  'Consolidado: soma das pendências dos subindicadores (abrem no detalhe).'),
 ('rh_ob_folhas', 'ger-rh', 10, 'Folhas corrigidas por inconsistência', 'Quantidade, origem do erro e evolução.', 'manual', 'qtd', 'menor', 0, 2, 'mensal', 'Departamento Pessoal', NULL, NULL, 'rh_obrigacoes', false, NULL, NULL, 'Lançado pelo DP.'),
 ('rh_ob_rescisoes', 'ger-rh', 11, 'Rescisões programadas e pendentes', 'Prazos de conclusão e risco de atraso.', 'auto', 'qtd', 'menor', 0, 5, 'diaria', 'Departamento Pessoal', 10, 'Atraso a partir de (dias)', 'rh_obrigacoes', false, NULL, NULL,
  'Solicitações de demissão ainda pendentes (Operacional, RH, SST ou agendamento do demissional). Detalhe por etapa; afetado: quantas passaram do prazo.'),
 ('rh_ob_ferias_vencidas', 'ger-rh', 12, 'Férias vencidas', 'Passivo trabalhista já existente.', 'manual', 'qtd', 'menor', 0, 1, 'mensal', 'Departamento Pessoal', NULL, NULL, 'rh_obrigacoes', false, NULL, NULL, 'Lançado pelo DP (relatório da Senior).'),
 ('rh_ob_ferias_vencer', 'ger-rh', 13, 'Férias a vencer no próximo mês', 'Necessidade de programação imediata.', 'manual', 'qtd', 'menor', 0, 10, 'mensal', 'Departamento Pessoal', NULL, NULL, 'rh_obrigacoes', false, NULL, NULL, 'Lançado pelo DP (relatório da Senior).'),
 ('rh_ob_banco_horas', 'ger-rh', 14, 'Banco de horas acima do limite', 'Acúmulo de custo trabalhista.', 'manual', 'qtd', 'menor', 0, 5, 'mensal', 'Departamento Pessoal', NULL, NULL, 'rh_obrigacoes', false, NULL, NULL, 'Lançado pelo DP.'),
 ('rh_ob_esocial', 'ger-rh', 15, 'Eventos do eSocial rejeitados', 'Pendências que exigem correção, com as que podem gerar multa.', 'manual', 'qtd', 'menor', 0, 1, 'semanal', 'Departamento Pessoal', NULL, NULL, 'rh_obrigacoes', false, NULL, NULL, 'Lançado pelo DP; marcar na causa os que geram multa.'),
 ('rh_ob_experiencia', 'ger-rh', 16, 'Contratos de experiência sem avaliação', 'Risco de perda do prazo de avaliação ou desligamento.', 'manual', 'qtd', 'menor', 0, 3, 'semanal', 'Departamento Pessoal', NULL, NULL, 'rh_obrigacoes', false, NULL, NULL, 'Lançado pelo DP.'),

 -- ===== SST =====
 ('sst_impedidos', 'ger-sst', 1, 'Trabalhadores com impedimento para exercer a função', 'Colaboradores que não podem trabalhar regularmente por falta de requisito legal, médico ou de segurança.', 'soma', 'qtd', 'menor', 0, 1, 'diaria', 'SST', NULL, NULL, NULL, true, NULL,
  ARRAY['sst_imp_aso', 'sst_imp_exame', 'sst_imp_treinamento', 'sst_imp_epi', 'sst_imp_retorno', 'sst_imp_restricao'],
  'Definição obrigatória do documento: soma de ASO inapto/vencido, exame pendente, treinamento legal vencido, EPI não entregue, retorno sem liberação e restrição incompatível.'),
 ('sst_aso', 'ger-sst', 2, 'ASOs vencidos ou a vencer', 'Quem está ou ficará irregular.', 'manual', 'qtd', 'menor', 0, 5, 'semanal', 'SST', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pelo SST (vencidos + a vencer em 30 dias).'),
 ('sst_treinamentos', 'ger-sst', 3, 'Treinamentos obrigatórios vencidos', 'Quem não possui capacitação legal ou contratual válida.', 'espelho', 'qtd', 'menor', 0, 3, 'semanal', 'SST', NULL, NULL, NULL, true, 'trn_vencidos', NULL, 'O mesmo número da TV de Treinamento.'),
 ('sst_epi', 'ger-sst', 4, 'EPIs pendentes ou com troca vencida', 'Quem está trabalhando sem proteção adequada.', 'manual', 'qtd', 'menor', 0, 3, 'semanal', 'SST', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pelo SST.'),
 ('sst_afastamentos', 'ger-sst', 5, 'Afastamentos ativos por contrato', 'Ausências prolongadas que estejam afetando a operação.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'SST', NULL, NULL, NULL, true, NULL, NULL,
  'Colaboradores com situação de afastamento na folha (auxílio-doença, licenças, atestados, aposentadoria por invalidez…). Detalhe por contrato; causa: a situação mais comum.'),
 ('sst_acidentes', 'ger-sst', 6, 'Acidentes e quase acidentes do mês', 'Riscos de repetição e necessidade de correção.', 'manual', 'qtd', 'menor', 0, 1, 'semanal', 'SST', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pelo SST, com a causa e o contrato.'),
 ('sst_imp_aso', 'ger-sst', 10, 'ASO inapto ou vencido', 'Parte do impedimento.', 'manual', 'qtd', 'menor', 0, NULL, 'semanal', 'SST', NULL, NULL, 'sst_impedidos', false, NULL, NULL, 'Lançado pelo SST.'),
 ('sst_imp_exame', 'ger-sst', 11, 'Exame obrigatório pendente', 'Parte do impedimento.', 'manual', 'qtd', 'menor', 0, NULL, 'semanal', 'SST', NULL, NULL, 'sst_impedidos', false, NULL, NULL, 'Lançado pelo SST.'),
 ('sst_imp_treinamento', 'ger-sst', 12, 'Treinamento legal vencido', 'Parte do impedimento.', 'manual', 'qtd', 'menor', 0, NULL, 'semanal', 'SST', NULL, NULL, 'sst_impedidos', false, NULL, NULL, 'Lançado pelo SST.'),
 ('sst_imp_epi', 'ger-sst', 13, 'EPI obrigatório não entregue', 'Parte do impedimento.', 'manual', 'qtd', 'menor', 0, NULL, 'semanal', 'SST', NULL, NULL, 'sst_impedidos', false, NULL, NULL, 'Lançado pelo SST.'),
 ('sst_imp_retorno', 'ger-sst', 14, 'Retorno de afastamento sem liberação', 'Parte do impedimento.', 'manual', 'qtd', 'menor', 0, NULL, 'semanal', 'SST', NULL, NULL, 'sst_impedidos', false, NULL, NULL, 'Lançado pelo SST.'),
 ('sst_imp_restricao', 'ger-sst', 15, 'Restrição médica incompatível com a função', 'Parte do impedimento.', 'manual', 'qtd', 'menor', 0, NULL, 'semanal', 'SST', NULL, NULL, 'sst_impedidos', false, NULL, NULL, 'Lançado pelo SST.'),

 -- ===== TREINAMENTO =====
 ('trn_integracoes', 'ger-treinamento', 1, 'Integrações pendentes', 'Quem iniciou ou iniciará sem receber as orientações obrigatórias.', 'auto', 'qtd', 'menor', 0, 10, 'diaria', 'Treinamento', 30, 'Admitidos nos últimos (dias)', NULL, true, NULL, NULL,
  'Alunos ativos da plataforma de Treinamentos cadastrados na janela que ainda não concluíram nenhuma aula. Detalhe por contrato.'),
 ('trn_contratuais', 'ger-treinamento', 2, 'Treinamentos contratuais pendentes', 'Contratos que ainda não cumpriram exigências de capacitação.', 'manual', 'qtd', 'menor', 0, 1, 'mensal', 'Treinamento', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pelo Treinamento, por contrato.'),
 ('trn_vencidos', 'ger-treinamento', 3, 'Treinamentos vencidos ou a vencer', 'Quem precisa de renovação imediata.', 'manual', 'qtd', 'menor', 0, 3, 'semanal', 'Treinamento', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pelo Treinamento (NRs e reciclagens).'),
 ('trn_programados', 'ger-treinamento', 4, 'Programados x realizados no mês', 'O cumprimento do plano mensal de treinamento.', 'manual', 'pct', 'maior', 100, 85, 'mensal', 'Treinamento', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pelo Treinamento: realizados ÷ programados.'),
 ('trn_sem_comprovacao', 'ger-treinamento', 5, 'Treinamentos sem comprovação', 'Treinamentos sem lista, certificado ou evidência.', 'manual', 'qtd', 'menor', 0, 1, 'mensal', 'Treinamento', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pelo Treinamento.'),

 -- ===== FINANCEIRO =====
 ('fin_notas_pendentes', 'ger-financeiro', 1, 'Notas pendentes de emissão', 'Serviços prestados que ainda não se transformaram em cobrança.', 'auto', 'qtd', 'menor', 0, 2, 'diaria', 'Faturamento', 20, 'Dia limite de emissão', NULL, true, NULL, NULL,
  'Contratos ativos com valor mensal sem NF emitida (enviada ou concluída) na competência cujo prazo já passou: até o dia limite vale a de dois meses atrás; depois, a do mês anterior.'),
 ('fin_valor_pendente', 'ger-financeiro', 2, 'Valor pendente de faturamento', 'O valor de receita represada.', 'auto', 'brl', 'menor', 0, 50000, 'diaria', 'Faturamento', 20, 'Dia limite de emissão', NULL, true, NULL, NULL,
  'Soma do valor mensal (executado, ou contratado) dos contratos das notas pendentes.'),
 ('fin_recebimentos', 'ger-financeiro', 3, 'Recebimentos previstos x realizados', 'Quanto deveria ter entrado e ainda não foi recebido.', 'auto', 'pct', 'maior', 100, 90, 'diaria', 'Financeiro', 30, 'Prazo de pagamento (dias)', NULL, true, NULL, NULL,
  'NFs concluídas que venceram neste mês até hoje (emissão + prazo): % com pagamento registrado. Impacto: o valor líquido que não entrou.'),
 ('fin_inadimplencia', 'ger-financeiro', 4, 'Inadimplência por faixa', 'Valores em atraso nas faixas de 15, 30, 60, 90 e 120 dias ou mais.', 'auto', 'brl', 'menor', 0, 100000, 'diaria', 'Financeiro', 30, 'Prazo de pagamento (dias)', NULL, true, NULL, NULL,
  'NFs concluídas sem pagamento, vencidas (emissão + prazo) há 15 dias ou mais. Detalhe pelas faixas do documento; afetado: contratos.'),
 ('fin_fluxo', 'ger-financeiro', 5, 'Fluxo de caixa projetado', 'Risco de insuficiência de caixa nos próximos dias.', 'manual', 'brl', 'maior', 0, NULL, 'diaria', 'Financeiro', NULL, NULL, NULL, true, NULL, NULL,
  'Lançado pelo Financeiro: saldo projetado para os próximos 30 dias (conciliado com o malote e o banco).'),
 ('fin_glosas', 'ger-financeiro', 6, 'Valores glosados ou retidos', 'Valores que o cliente deixou de pagar e suas causas.', 'auto', 'brl', 'menor', 0, 10000, 'semanal', 'Financeiro', 90, 'Janela (dias)', NULL, true, NULL, NULL,
  'Na janela: glosas e multas (notificações do Jurídico, não revertidas) + descontos após a emissão e conta vinculada retida nas NFs. Detalhe pela origem.'),

 -- ===== JURÍDICO =====
 ('jur_prazos', 'ger-juridico', 1, 'Prazos jurídicos próximos ou vencidos', 'Risco de perda de prazo.', 'auto', 'qtd', 'menor', 0, 2, 'diaria', 'Jurídico', 5, 'Dias de antecedência', NULL, true, NULL, NULL,
  'Notificações em aberto com prazo de defesa vencido ou nos próximos N dias.'),
 ('jur_sem_resposta', 'ger-juridico', 2, 'Notificações sem resposta', 'Clientes ou órgãos que aguardam manifestação.', 'auto', 'qtd', 'menor', 0, 2, 'diaria', 'Jurídico', NULL, NULL, NULL, true, NULL, NULL,
  'Notificações nas etapas "Recebida" ou "Em análise" (ainda sem defesa protocolada).'),
 ('jur_audiencias', 'ger-juridico', 3, 'Audiências próximas', 'Providências e documentos que precisam ser preparados.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Jurídico', 15, 'Dias à frente', NULL, true, NULL, NULL,
  'Processos em andamento com audiência (designada, primeira ou de instrução) ou perícia nos próximos N dias.'),
 ('jur_contratos_analise', 'ger-juridico', 4, 'Contratos pendentes de análise', 'Operações que aguardam validação jurídica.', 'manual', 'qtd', 'menor', 0, 2, 'semanal', 'Jurídico', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pelo Jurídico.'),
 ('jur_risco', 'ger-juridico', 5, 'Processos com risco de perda elevado', 'Exposição financeira relevante.', 'manual', 'qtd', 'menor', 0, 3, 'mensal', 'Jurídico', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pelo Jurídico, com o valor provável no impacto.'),
 ('jur_reincidentes', 'ger-juridico', 6, 'Causas trabalhistas reincidentes', 'Falhas internas que estejam gerando processos repetidos.', 'auto', 'qtd', 'menor', 0, 3, 'mensal', 'Jurídico', 5, 'Repetições para contar', NULL, true, NULL, NULL,
  'Processos em andamento: motivos (pedidos) que aparecem em N ou mais processos. Causa: o motivo mais repetido.'),
 ('jur_valor_condenacao', 'ger-juridico', 20, 'Valor provável de condenação', 'Subindicador jurídico.', 'manual', 'brl', 'menor', NULL, NULL, 'mensal', 'Jurídico', NULL, NULL, NULL, false, NULL, NULL, 'Lançado pelo Jurídico.'),
 ('jur_valor_acordo', 'ger-juridico', 21, 'Valor de acordo (proposto, orientado ou requerido)', 'Subindicador jurídico.', 'manual', 'brl', 'menor', NULL, NULL, 'mensal', 'Jurídico', NULL, NULL, NULL, false, NULL, NULL, 'Lançado pelo Jurídico.'),
 ('jur_multas_revertidas', 'ger-juridico', 22, 'Multas descontadas e revertidas', 'Multas/glosas descontadas no Financeiro e revertidas pelo Jurídico.', 'auto', 'brl', 'maior', NULL, NULL, 'mensal', 'Jurídico', 365, 'Janela (dias)', NULL, false, NULL, NULL,
  'Notificações com resultado "Revertida" (total ou parcial) desfechadas na janela: valor original menos o final.'),

 -- ===== CONTROLADORIA =====
 ('ctl_margem', 'ger-controladoria', 1, 'Contratos abaixo da margem mínima', 'Onde a empresa está operando com resultado insuficiente.', 'manual', 'qtd', 'menor', 0, 2, 'mensal', 'Controladoria', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pela Controladoria a partir do DRE por contrato.'),
 ('ctl_desvio', 'ger-controladoria', 2, 'Desvio de custo por contrato (%)', 'Qual contrato gastou acima do orçamento e em qual rubrica.', 'manual', 'pct', 'menor', 0, 5, 'mensal', 'Controladoria', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pela Controladoria; a rubrica vai na causa.'),
 ('ctl_vermelhos', 'ger-controladoria', 3, 'Contratos classificados como vermelhos', 'Riscos financeiros, operacionais ou contratuais combinados.', 'manual', 'qtd', 'menor', 0, 2, 'mensal', 'Controladoria', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pela Controladoria (classificação do comitê).'),
 ('ctl_planos', 'ger-controladoria', 4, 'Planos de ação vencidos', 'Problemas que ainda não foram corrigidos.', 'auto', 'qtd', 'menor', 0, 10, 'diaria', 'Controladoria', NULL, NULL, NULL, true, NULL, NULL,
  'Planos de ação não concluídos com fim planejado já vencido. Detalhe por área.'),
 ('ctl_nao_atualizados', 'ger-controladoria', 5, 'Indicadores não atualizados', 'Setores que não estão entregando informação confiável.', 'auto', 'qtd', 'menor', 0, 3, 'diaria', 'Controladoria', NULL, NULL, NULL, true, NULL, NULL,
  'Indicadores de lançamento manual (das TVs) sem lançamento dentro da periodicidade (diária 2 dias, semanal 8, mensal 35). Detalhe por TV.'),
 ('ctl_reincidentes', 'ger-controladoria', 6, 'Desvios reincidentes', 'Situações em que o plano de ação não resolveu o problema.', 'manual', 'qtd', 'menor', 0, 1, 'mensal', 'Controladoria', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pela Controladoria.'),

 -- ===== TI / ERP =====
 ('ti_indisponiveis', 'ger-ti', 1, 'Sistemas indisponíveis', 'Áreas impedidas de trabalhar.', 'manual', 'qtd', 'menor', 0, NULL, 'diaria', 'TI', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pela TI (sistemas fora do ar agora).'),
 ('ti_erros', 'ger-ti', 2, 'Erros críticos abertos', 'Falhas que comprometem folha, faturamento, operação ou contratação.', 'auto', 'qtd', 'menor', 0, 2, 'diaria', 'TI / ERP', NULL, NULL, NULL, true, NULL, NULL,
  'Chamados de Sistemas do tipo Correção, prioridade alta, ainda abertos. Detalhe por módulo.'),
 ('ti_integracoes', 'ger-ti', 3, 'Integrações com falha', 'Onde os dados não estão circulando corretamente.', 'auto', 'qtd', 'menor', 0, 1, 'diaria', 'TI / ERP', 7, 'Janela (dias)', NULL, true, NULL, NULL,
  'Chamadas da fila de integrações (WhatsApp, cobrança, SLA…) com erro e não processadas na janela.'),
 ('ti_backups', 'ger-ti', 4, 'Backups com falha', 'Risco de perda de informação.', 'manual', 'qtd', 'menor', 0, NULL, 'diaria', 'TI', NULL, NULL, NULL, true, NULL, NULL, 'Lançado pela TI (rotina de backup do dia).'),
 ('ti_demandas', 'ger-ti', 5, 'Demandas ERP críticas atrasadas', 'Melhorias relevantes que não foram entregues.', 'auto', 'qtd', 'menor', 0, 5, 'diaria', 'TI / ERP', 30, 'Prazo sem data prevista (dias)', NULL, true, NULL, NULL,
  'Chamados de prioridade alta abertos com o prazo previsto vencido (ou, sem prazo, abertos há mais de N dias). Detalhe por módulo.'),
 ('ti_acessos', 'ger-ti', 6, 'Usuários com acesso incompatível', 'Risco de fraude ou vazamento de informação.', 'auto', 'qtd', 'menor', 0, NULL, 'diaria', 'TI', NULL, NULL, NULL, true, NULL, NULL,
  'Colaboradores demitidos na folha com login do ERP ainda liberado (não bloqueado). Detalhe por setor.'),

 -- ===== PRESIDÊNCIA (o mesmo número das TVs de origem) =====
 ('pre_lucratividade', 'ger-presidencia', 1, 'Lucratividade geral e por contrato (%)', 'Onde a empresa ganha e perde dinheiro.', 'espelho', 'pct', 'maior', 10, 5, 'mensal', 'Controladoria', NULL, NULL, NULL, true, 'op_lucratividade', NULL, 'O mesmo número da Gerência Operacional.'),
 ('pre_vermelhos', 'ger-presidencia', 2, 'Contratos vermelhos', 'Contratos que exigem decisão da alta liderança.', 'espelho', 'qtd', 'menor', 0, 2, 'mensal', 'Controladoria', NULL, NULL, NULL, true, 'ctl_vermelhos', NULL, 'O mesmo número da Controladoria.'),
 ('pre_postos', 'ger-presidencia', 3, 'Postos contratados x cobertos', 'Se a empresa está entregando o que vendeu.', 'espelho', 'qtd', 'menor', 0, 5, 'diaria', 'Gerência Operacional', NULL, NULL, NULL, true, 'op_postos', NULL, 'O mesmo número da Gerência Operacional.'),
 ('pre_glosas', 'ger-presidencia', 4, 'Glosas e retenções', 'Quanto de receita foi perdido ou bloqueado.', 'espelho', 'brl', 'menor', 0, 10000, 'semanal', 'Financeiro', NULL, NULL, NULL, true, 'fin_glosas', NULL, 'O mesmo número do Financeiro.'),
 ('pre_salarios', 'ger-presidencia', 5, 'Salários e benefícios acima do orçamento', 'Onde os custos de pessoas estão consumindo a margem.', 'espelho', 'pct', 'menor', 0, 3, 'mensal', 'RH', NULL, NULL, NULL, true, 'rh_salarios', NULL, 'O mesmo número do RH.'),
 ('pre_caixa', 'ger-presidencia', 6, 'Notas pendentes e inadimplência', 'Quanto dinheiro deveria estar no caixa e ainda não está.', 'soma', 'brl', 'menor', 0, 150000, 'diaria', 'Financeiro', NULL, NULL, NULL, true, NULL, ARRAY['fin_valor_pendente', 'fin_inadimplencia'],
  'Valor pendente de faturamento + inadimplência (TV Financeira).'),
 ('pre_clientes', 'ger-presidencia', 7, 'Clientes insatisfeitos', 'Contratos sob risco comercial.', 'espelho', 'qtd', 'menor', 0, 2, 'semanal', 'Gerência Operacional', NULL, NULL, NULL, true, 'op_reclamacoes', NULL, 'O mesmo número da Gerência Operacional.'),
 ('pre_planos', 'ger-presidencia', 8, 'Planos de ação vencidos', 'Problemas que continuam sem solução.', 'espelho', 'qtd', 'menor', 0, 10, 'diaria', 'Controladoria', NULL, NULL, NULL, true, 'ctl_planos', NULL, 'O mesmo número da Controladoria.')
ON CONFLICT (codigo) DO UPDATE SET
  nome = EXCLUDED.nome, identificar = EXCLUDED.identificar, regra = EXCLUDED.regra, fonte = EXCLUDED.fonte,
  espelho_de = EXCLUDED.espelho_de, componentes = EXCLUDED.componentes, pai = EXCLUDED.pai, painel = EXCLUDED.painel,
  unidade = EXCLUDED.unidade, parametro_rotulo = EXCLUDED.parametro_rotulo;

-- ── 5) Apoio aos cálculos ────────────────────────────────────────────────
-- "R$ 1.750.267,32" / "1750267.32" → numeric (a mesma leitura de valorDaGrade, src/lib/tv/licitacaoTv.ts).
CREATE OR REPLACE FUNCTION public.tvg_num_br(t text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN n ~ '^-?[0-9]+(\.[0-9]+)?$' THEN n::numeric ELSE 0 END
    FROM (SELECT CASE WHEN s LIKE '%,%' THEN replace(replace(s, '.', ''), ',', '.')
                      WHEN length(s) - length(replace(s, '.', '')) > 1 THEN replace(s, '.', '')
                      ELSE s END AS n
            FROM (SELECT regexp_replace(coalesce(t, ''), '[R$[:space:]]', '', 'g') AS s) a) b
$$;

-- Quadro × folha por contrato ativo: postos contratados (contratos.quant_func_estipulado)
-- e a folha da Senior pela filial do contrato (mesma ligação de dir_turnover_filial,
-- feita de uma vez: ~30 ms para todos).
CREATE OR REPLACE FUNCTION public.tvg_quadro_contratos()
RETURNS TABLE (contrato_id uuid, contrato text, cidade text, necessarios int, ativos int, trabalhando int, ferias int, afastados int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH f AS (
    SELECT e."Nome Filial" AS filial,
           count(*) FILTER (WHERE e."Situação" <> 'Demitido') AS ativos,
           count(*) FILTER (WHERE e."Situação" = 'Trabalhando') AS trab,
           count(*) FILTER (WHERE e."Situação" = 'Férias') AS ferias,
           count(*) FILTER (WHERE e."Situação" NOT IN ('Demitido', 'Trabalhando', 'Férias')) AS afast
      FROM public."EMPREGADOS" e WHERE e."Nome Filial" IS NOT NULL GROUP BY 1),
  fn AS (SELECT f.*, public.rh_norm_contrato(f.filial) AS nn FROM f),
  c AS (SELECT c.id, c.nome, c.cidade, COALESCE(c.quant_func_estipulado, 0) AS nec, public.dir_rel_contrato_nn(c.id) AS nn
          FROM public.contratos c WHERE c.status = 'ativo')
  SELECT c.id, c.nome, c.cidade, c.nec, sum(fn.ativos)::int, sum(fn.trab)::int, sum(fn.ferias)::int, sum(fn.afast)::int
    FROM c JOIN fn ON fn.nn = c.nn
   GROUP BY c.id, c.nome, c.cidade, c.nec
$$;
REVOKE ALL ON FUNCTION public.tvg_quadro_contratos() FROM PUBLIC, anon, authenticated;

-- ── 6) Os cálculos automáticos ──────────────────────────────────────────
-- Devolve {valor, afetado, causa, impacto, base, detalhe:[{nome, valor, rotulo?}]}.
-- Sem nome de pessoa em nada (a TV fica em área comum).
CREATE OR REPLACE FUNCTION public.tvg_calc(p_codigo text, p_param numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r jsonb;
  v_ano int; v_meses int[]; v_painel jsonb; v_comp date; n int;
BEGIN
  -- ===== Gerência Operacional =====
  IF p_codigo = 'op_postos' THEN
    WITH q AS (SELECT *, greatest(necessarios - trabalhando, 0) AS falta FROM public.tvg_quadro_contratos() WHERE necessarios > 0),
    x AS (SELECT *, least(falta, afastados) AS p_af, least(falta - least(falta, afastados), ferias) AS p_fe FROM q WHERE falta > 0),
    c AS (SELECT sum(p_af) af, sum(p_fe) fe, sum(falta - p_af - p_fe) va FROM x)
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT sum(falta) FROM q), 0),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Todos os contratos cobertos'
                         ELSE count(*) || ' contrato' || CASE WHEN count(*) > 1 THEN 's' ELSE '' END || ' · maior falta: '
                              || (SELECT contrato || ' (−' || falta || ')' FROM x ORDER BY falta DESC LIMIT 1) END FROM x),
      'causa', (SELECT CASE WHEN COALESCE(af, 0) + COALESCE(fe, 0) + COALESCE(va, 0) = 0 THEN NULL
                            WHEN af >= fe AND af >= va THEN 'Afastamentos (' || af || ' postos)'
                            WHEN fe >= va THEN 'Férias sem cobertura (' || fe || ' postos)'
                            ELSE 'Quadro incompleto — vagas não preenchidas (' || va || ' postos)' END FROM c),
      'base', (SELECT count(*) || ' contratos com quadro e folha' FROM q),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', falta, 'rotulo', '−' || falta || ' · ' || trabalhando || ' de ' || necessarios)
                                            ORDER BY falta DESC) FROM (SELECT * FROM x ORDER BY falta DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo IN ('op_glosas') THEN
    WITH g AS (SELECT coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'Sem contrato') AS contrato,
                      coalesce(nullif(btrim(n.causa_raiz), ''), nullif(btrim(n.assunto), ''), 'Sem causa registrada') AS causa,
                      coalesce(n.valor_final, n.valor_original, 0) AS v
                 FROM public."JUR_NOTIFICACOES" n
                WHERE n.tipo = 'Glosa' AND coalesce(n.resultado, '') <> 'Revertida'
                  AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT sum(v) FROM g), 0),
      'impacto', COALESCE((SELECT sum(v) FROM g), 0),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s) · ' || count(*) || ' glosa(s)' FROM g),
      'causa', (SELECT left(causa, 90) FROM g GROUP BY causa ORDER BY sum(v) DESC, count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', s, 'rotulo', n || ' glosa(s)') ORDER BY s DESC)
                             FROM (SELECT contrato, sum(v) s, count(*) n FROM g GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'op_turnover' THEN
    v_ano := extract(year FROM hoje)::int;
    n := greatest(1, least(12, coalesce(p_param, 3)::int));
    v_meses := ARRAY(SELECT m FROM generate_series(greatest(1, extract(month FROM hoje)::int - n + 1), extract(month FROM hoje)::int) m);
    v_painel := public.dir_turnover_painel_dados(v_ano, NULL, NULL, NULL, v_meses);
    WITH pc AS (SELECT x->>'contrato' AS contrato, (x->>'demissoes')::numeric AS dem, nullif((x->>'efetivo_medio')::numeric, 0) AS ef
                  FROM jsonb_array_elements(v_painel->'por_contrato') x),
    t AS (SELECT contrato, round(dem / ef / cardinality(v_meses) * 100, 1) AS taxa, dem FROM pc WHERE ef >= 10)
    SELECT jsonb_build_object(
      'valor', (SELECT round(avg((m->>'taxa')::numeric), 1) FROM jsonb_array_elements(v_painel->'mensal') m WHERE (m->>'taxa') IS NOT NULL),
      'afetado', (SELECT count(*) || ' contrato(s) acima de 5%/mês' || COALESCE(' · pior: ' || (SELECT contrato || ' (' || replace(taxa::text, '.', ',') || '%)' FROM t ORDER BY taxa DESC LIMIT 1), '') FROM t WHERE taxa > 5),
      'causa', (SELECT c->>'causa' FROM jsonb_array_elements(v_painel->'causas') c WHERE c->>'causa' NOT ILIKE '%não informado%' ORDER BY (c->>'n')::int DESC LIMIT 1),
      'base', 'Média mensal de ' || cardinality(v_meses) || ' mês(es) de ' || v_ano,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', taxa, 'rotulo', replace(taxa::text, '.', ',') || '% · ' || dem || ' saída(s)') ORDER BY taxa DESC)
                             FROM (SELECT * FROM t ORDER BY taxa DESC LIMIT 12) z), '[]'::jsonb))
      INTO r;

  -- ===== Licitações =====
  ELSIF p_codigo = 'lic_prazo' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, g.data - hoje AS dias, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text IN ('À Iniciar', 'Iniciado') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 3)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g), 'impacto', (SELECT sum(v) FROM g),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Nenhuma sessão próxima sem proposta' ELSE count(*) FILTER (WHERE dias = 0) || ' hoje · ' || count(*) FILTER (WHERE dias = 1) || ' amanhã' END FROM g),
      'causa', CASE WHEN (SELECT count(*) FROM g) > 0 THEN 'Proposta ainda não iniciada/concluída' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', CASE dias WHEN 0 THEN 'hoje' WHEN 1 THEN 'amanhã' ELSE 'em ' || dias || ' dias' END) ORDER BY dias)
                             FROM (SELECT * FROM g ORDER BY dias LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'lic_propostas' THEN
    WITH g AS (SELECT g.fase::text AS fase, coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, g.data - hoje AS dias
                 FROM public.grade g WHERE g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 7)::int)
    SELECT jsonb_build_object(
      'valor', (SELECT CASE WHEN count(*) = 0 THEN 100 ELSE round(100.0 * count(*) FILTER (WHERE fase = 'Em Andamento') / count(*)) END FROM g),
      'afetado', (SELECT count(*) FILTER (WHERE fase <> 'Em Andamento') || ' em elaboração de ' || count(*) || ' com sessão' FROM g),
      'causa', (SELECT CASE WHEN count(*) FILTER (WHERE fase = 'À Iniciar') > 0 THEN count(*) FILTER (WHERE fase = 'À Iniciar') || ' ainda nem iniciada(s)' END FROM g),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', fase || ' · ' || CASE dias WHEN 0 THEN 'hoje' ELSE 'em ' || dias || ' d' END) ORDER BY dias)
                             FROM g WHERE fase <> 'Em Andamento'), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'lic_implantacao' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, hoje - g.data AS dias, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g
                WHERE g.fase::text = 'Finalizada' AND g.posicao = 1 AND g.data >= hoje - coalesce(p_param, 365)::int
                  AND NOT EXISTS (SELECT 1 FROM public.implantacao_contrato i WHERE g.capa_id IS NOT NULL AND i.capa_id = g.capa_id)
                  AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.grade_id = g.id))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g), 'impacto', (SELECT sum(v) FROM g),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Todas encaminhadas' ELSE 'Mais antiga: ' || max(dias) || ' dias da sessão' END FROM g),
      'causa', CASE WHEN (SELECT count(*) FROM g) > 0 THEN 'Sem implantação aberta no ERP' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', dias || ' dias') ORDER BY dias DESC) FROM g), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'lic_perdidas' THEN
    WITH g AS (SELECT coalesce(nullif(btrim(g.status_obs), ''), 'Motivo não registrado') AS motivo
                 FROM public.grade g WHERE g.fase::text = 'Finalizada' AND g.posicao IS DISTINCT FROM 1
                  AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 90)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g),
      'causa', (SELECT left(motivo, 80) || ' (' || count(*) || ')' FROM g GROUP BY motivo ORDER BY count(*) DESC LIMIT 1),
      'afetado', 'Últimos ' || coalesce(p_param, 90)::int || ' dias',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', left(motivo, 80), 'valor', n) ORDER BY n DESC)
                             FROM (SELECT motivo, count(*) n FROM g GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'lic_valor' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento'))
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM g), 0),
      'afetado', (SELECT count(*) || ' processos em disputa' FROM g),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', v) ORDER BY v DESC) FROM (SELECT * FROM g ORDER BY v DESC LIMIT 10) t), '[]'::jsonb))
      INTO r;

  -- ===== Supply =====
  ELSIF p_codigo = 'sup_compras_vencidas' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato, hoje - p.data_solicitacao AS dias
                 FROM public.sup_pedido p WHERE p.status = 'AGUARDANDO COMPRA' AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' || COALESCE(' · mais antigo: ' || max(dias) || ' dias', '') FROM p),
      'causa', CASE WHEN (SELECT count(*) FROM p) > 0 THEN 'Aguardando compra além de ' || coalesce(p_param, 15)::int || ' dias' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n, 'rotulo', n || ' pedido(s) · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT contrato, count(*) n, max(dias) d FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo IN ('sup_abaixo_minimo', 'sup_valor_estoque', 'sup_sem_mov') THEN
    WITH s AS (SELECT item_estoque_id, sum(disponivel) AS disp, sum(fisico) AS fis FROM public.sup_estoque_saldo GROUP BY 1),
    i AS (SELECT ei.id, it.nome, ei.estoque_minimo AS minimo, coalesce(ei.valor_unitario, 0) AS vu,
                 coalesce(s.disp, 0) AS disp, coalesce(s.fis, 0) AS fis
            FROM public.sup_estoque_item ei JOIN public.sup_item it ON it.id = ei.sup_item_id
            LEFT JOIN s ON s.item_estoque_id = ei.id WHERE ei.arquivado_em IS NULL)
    SELECT CASE p_codigo
      WHEN 'sup_abaixo_minimo' THEN (
        SELECT jsonb_build_object('valor', count(*), 'impacto', sum((minimo - disp) * vu),
          'afetado', count(*) FILTER (WHERE disp <= 0) || ' zerado(s)',
          'causa', CASE WHEN count(*) > 0 THEN 'Reposição abaixo do consumo' END,
          'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', disp, 'rotulo', disp || ' de mín. ' || minimo) ORDER BY disp::numeric / greatest(minimo, 1))
                                 FROM (SELECT * FROM i WHERE minimo > 0 AND disp < minimo ORDER BY disp::numeric / greatest(minimo, 1) LIMIT 15) t), '[]'::jsonb))
          FROM i WHERE minimo > 0 AND disp < minimo)
      WHEN 'sup_valor_estoque' THEN (
        SELECT jsonb_build_object('valor', round(sum(fis * vu), 2), 'afetado', count(*) FILTER (WHERE fis > 0) || ' itens com saldo',
          'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', round(fis * vu, 2), 'rotulo', fis || ' un.') ORDER BY fis * vu DESC)
                                 FROM (SELECT * FROM i WHERE fis > 0 ORDER BY fis * vu DESC LIMIT 10) t), '[]'::jsonb))
          FROM i)
      ELSE (
        WITH parado AS (SELECT i.* FROM i WHERE i.fis > 0
                          AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_movimento m WHERE m.item_estoque_id = i.id AND m.created_at >= now() - make_interval(days => coalesce(p_param, 90)::int))
                          AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_consumo c WHERE c.item_estoque_id = i.id AND c.consumido_em >= now() - make_interval(days => coalesce(p_param, 90)::int)))
        SELECT jsonb_build_object('valor', count(*), 'impacto', round(sum(fis * vu), 2),
          'afetado', 'R$ ' || to_char(coalesce(sum(fis * vu), 0), 'FM999G999G990') || ' parados',
          'causa', CASE WHEN count(*) > 0 THEN 'Sem uso há mais de ' || coalesce(p_param, 90)::int || ' dias' END,
          'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', round(fis * vu, 2), 'rotulo', fis || ' un.') ORDER BY fis * vu DESC)
                                 FROM (SELECT * FROM parado ORDER BY fis * vu DESC LIMIT 12) t), '[]'::jsonb))
          FROM parado)
      END INTO r;

  ELSIF p_codigo = 'sup_contratos_sem_entrega' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato, p.status, hoje - p.data_solicitacao AS dias
                 FROM public.sup_pedido p
                WHERE p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO')
                  AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int)
    SELECT jsonb_build_object('valor', (SELECT count(DISTINCT contrato) FROM p),
      'afetado', (SELECT count(*) || ' pedido(s) parado(s)' FROM p),
      'causa', (SELECT initcap(lower(status)) || ' (' || count(*) || ')' FROM p GROUP BY status ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n, 'rotulo', n || ' pedido(s) · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT contrato, count(*) n, max(dias) d FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  -- ===== Frota e Patrimônio =====
  ELSIF p_codigo = 'fro_indisponiveis' THEN
    WITH v AS (SELECT p.nome || coalesce(' · ' || p.identificador, '') AS nome, coalesce(nullif(btrim(p.lotacao), ''), 'Sem lotação') AS lot,
                      coalesce(p.motivo_indisponivel, CASE WHEN p.em_manutencao THEN 'manutencao' END) AS motivo
                 FROM public.sup_patrimonio p WHERE p.categoria = 'veiculo' AND p.ativo AND (p.em_manutencao OR p.motivo_indisponivel IS NOT NULL))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM v),
      'afetado', (SELECT string_agg(DISTINCT lot, ', ') FROM v),
      'causa', (SELECT CASE motivo WHEN 'manutencao' THEN 'Manutenção' ELSE initcap(motivo) END || ' (' || count(*) || ')' FROM v GROUP BY motivo ORDER BY count(*) DESC LIMIT 1),
      'base', (SELECT count(*) || ' veículos ativos' FROM public.sup_patrimonio WHERE categoria = 'veiculo' AND ativo),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', 1, 'rotulo', lot)) FROM v), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'fro_manutencoes' THEN
    WITH v AS (SELECT p.nome || coalesce(' · ' || p.identificador, '') AS nome, hoje - p.data_previsao_fim AS dias, p.categoria
                 FROM public.sup_patrimonio p WHERE p.ativo AND p.em_manutencao AND p.data_previsao_fim < hoje)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM v),
      'afetado', (SELECT count(*) FILTER (WHERE categoria = 'veiculo') || ' veículo(s) · ' || count(*) FILTER (WHERE categoria <> 'veiculo') || ' equipamento(s)' FROM v),
      'causa', CASE WHEN (SELECT count(*) FROM v) > 0 THEN 'Previsão de retorno vencida' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', dias || ' dias de atraso') ORDER BY dias DESC) FROM v), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'fro_sem_responsavel' THEN
    WITH v AS (SELECT initcap(p.categoria) AS cat FROM public.sup_patrimonio p
                WHERE p.ativo AND p.contrato_id IS NULL AND p.posto_id IS NULL AND nullif(btrim(p.lotacao), '') IS NULL)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM v),
      'causa', CASE WHEN (SELECT count(*) FROM v) > 0 THEN 'Sem contrato, posto ou lotação no cadastro' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', cat, 'valor', n) ORDER BY n DESC) FROM (SELECT cat, count(*) n FROM v GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  -- ===== Recrutamento =====
  ELSIF p_codigo IN ('rec_risco', 'rec_abertas', 'rec_prazo') THEN
    WITH a AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, coalesce(nullif(btrim(s.cidade), ''), '—') AS cidade,
                      greatest(coalesce(s.quantidade_vagas, 1), 1) AS q, s.status, s.grau_urgencia, (hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date) AS dias
                 FROM public."SISTEMA_RECRUTAMENTO" s WHERE s.status NOT IN ('Concluído', 'Reprovada', 'Contratado')),
    f AS (SELECT * FROM a WHERE (p_codigo = 'rec_abertas')
                             OR (p_codigo = 'rec_risco' AND grau_urgencia ILIKE 'Alta%')
                             OR (p_codigo = 'rec_prazo' AND dias > coalesce(p_param, 15)))
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(q) FROM f), 0),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s) · ' || count(DISTINCT cidade) || ' cidade(s)' FROM f),
      'causa', (SELECT 'Parada em: ' || status || ' (' || sum(q) || ')' FROM f GROUP BY status ORDER BY sum(q) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato || ' · ' || cidade, 'valor', n, 'rotulo', n || ' vaga(s) · mais antiga ' || d || ' d') ORDER BY n DESC, d DESC)
                             FROM (SELECT contrato, cidade, sum(q) n, max(dias) d FROM f GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'rec_admissoes' THEN
    WITH a AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, greatest(coalesce(s.quantidade_vagas, 1), 1) AS q,
                      s.status IN ('Contratado', 'Concluído') AS ok
                 FROM public."SISTEMA_RECRUTAMENTO" s
                WHERE s.status <> 'Reprovada' AND s.data_inicio_prevista ~ '^\d{4}-\d{2}-\d{2}'
                  AND left(s.data_inicio_prevista, 10)::date BETWEEN date_trunc('month', hoje)::date AND hoje)
    SELECT jsonb_build_object(
      'valor', (SELECT CASE WHEN coalesce(sum(q), 0) = 0 THEN 100 ELSE round(100.0 * coalesce(sum(q) FILTER (WHERE ok), 0) / sum(q)) END FROM a),
      'afetado', (SELECT coalesce(sum(q) FILTER (WHERE ok), 0) || ' de ' || coalesce(sum(q), 0) || ' previstas no mês até hoje' FROM a),
      'causa', (SELECT CASE WHEN coalesce(sum(q) FILTER (WHERE NOT ok), 0) > 0 THEN sum(q) FILTER (WHERE NOT ok) || ' admissão(ões) com início vencido' END FROM a),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n, 'rotulo', n || ' pendente(s)') ORDER BY n DESC)
                             FROM (SELECT contrato, sum(q) FILTER (WHERE NOT ok) n FROM a GROUP BY 1 HAVING sum(q) FILTER (WHERE NOT ok) > 0 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'rec_desistencias' THEN
    WITH d AS (SELECT coalesce(nullif(btrim(s.cidade), ''), '—') AS cidade,
                      coalesce(substring(h.evento FROM '\(em ([^)]+)\)'), coalesce(h.de_status, 'etapa não informada')) AS etapa
                 FROM public."RECRUTAMENTO_HISTORICO" h LEFT JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = h.solicitacao_id
                WHERE h.evento ILIKE '%desist%' AND h.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d),
      'afetado', (SELECT count(DISTINCT cidade) || ' cidade(s)' FROM d),
      'causa', (SELECT 'Etapa: ' || initcap(lower(etapa)) || ' (' || count(*) || ')' FROM d GROUP BY etapa ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', cidade, 'valor', n) ORDER BY n DESC) FROM (SELECT cidade, count(*) n FROM d GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  -- ===== RH =====
  ELSIF p_codigo = 'rh_quadro' THEN
    WITH q AS (SELECT contrato, ativos - necessarios AS dif FROM public.tvg_quadro_contratos() WHERE necessarios > 0),
    f AS (SELECT * FROM q WHERE abs(dif) > coalesce(p_param, 2))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) FILTER (WHERE dif < 0) || ' com falta · ' || count(*) FILTER (WHERE dif > 0) || ' com excesso' FROM f),
      'causa', (SELECT CASE WHEN dif < 0 THEN 'Maior falta: ' ELSE 'Maior excesso: ' END || contrato || ' (' || CASE WHEN dif > 0 THEN '+' ELSE '' END || dif || ')' FROM f ORDER BY abs(dif) DESC LIMIT 1),
      'base', (SELECT count(*) || ' contratos com quadro e folha' FROM q),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', dif, 'rotulo', CASE WHEN dif > 0 THEN '+' || dif || ' excedente' ELSE dif || ' faltando' END) ORDER BY abs(dif) DESC)
                             FROM (SELECT * FROM f ORDER BY abs(dif) DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'rh_ob_rescisoes' THEN
    WITH d AS (SELECT s.status, hoje - coalesce(s.data_solicitacao, s.criado_em::date) AS dias
                 FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
                WHERE s.status IN ('Pendente Operacional', 'Pendente RH', 'Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida'))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d),
      'afetado', (SELECT count(*) FILTER (WHERE dias > coalesce(p_param, 10)) || ' acima de ' || coalesce(p_param, 10)::int || ' dias' FROM d),
      'causa', (SELECT status || ' (' || count(*) || ')' FROM d GROUP BY status ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', status, 'valor', n, 'rotulo', n || ' · até ' || m || ' d') ORDER BY n DESC)
                             FROM (SELECT status, count(*) n, max(dias) m FROM d GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  -- ===== SST =====
  ELSIF p_codigo = 'sst_afastamentos' THEN
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT sum(afastados) FROM public.tvg_quadro_contratos()), 0),
      'afetado', (SELECT count(*) FILTER (WHERE afastados > 0) || ' contrato(s)' FROM public.tvg_quadro_contratos()),
      'causa', (SELECT "Situação" || ' (' || count(*) || ')' FROM public."EMPREGADOS" WHERE "Situação" NOT IN ('Demitido', 'Trabalhando', 'Férias') GROUP BY "Situação" ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', afastados, 'rotulo', afastados || ' de ' || ativos || ' (' || round(100.0 * afastados / greatest(ativos, 1)) || '%)') ORDER BY afastados DESC)
                             FROM (SELECT * FROM public.tvg_quadro_contratos() WHERE afastados > 0 ORDER BY afastados DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  -- ===== Treinamento =====
  ELSIF p_codigo = 'trn_integracoes' THEN
    WITH a AS (SELECT coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS contrato
                 FROM public."TRN_ALUNO" a
                WHERE a.status = 'ativo' AND a.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int)
                  AND NOT EXISTS (SELECT 1 FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM a),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' FROM a),
      'causa', CASE WHEN (SELECT count(*) FROM a) > 0 THEN 'Nenhuma aula concluída na plataforma' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC) FROM (SELECT contrato, count(*) n FROM a GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  -- ===== Financeiro =====
  ELSIF p_codigo IN ('fin_notas_pendentes', 'fin_valor_pendente') THEN
    v_comp := CASE WHEN extract(day FROM hoje) > coalesce(p_param, 20) THEN date_trunc('month', hoje - interval '1 month')
                   ELSE date_trunc('month', hoje - interval '2 months') END::date;
    WITH c AS (SELECT c.nome, coalesce(nullif(c.valor_executado_mensal, 0), c.valor_mensal_contratado) AS v
                 FROM public.contratos c
                WHERE c.status = 'ativo' AND coalesce(c.valor_mensal_contratado, 0) > 0
                  AND NOT EXISTS (SELECT 1 FROM public.nf_emissao n WHERE n.contrato_id = c.id AND n.deleted_at IS NULL
                                    AND n.status::text IN ('enviada', 'concluida') AND n.competencia = v_comp))
    SELECT jsonb_build_object(
      'valor', CASE WHEN p_codigo = 'fin_notas_pendentes' THEN (SELECT count(*) FROM c) ELSE COALESCE((SELECT sum(v) FROM c), 0) END,
      'impacto', COALESCE((SELECT sum(v) FROM c), 0),
      'afetado', (SELECT count(*) || ' contrato(s) · competência ' || to_char(v_comp, 'MM/YYYY') FROM c),
      'causa', CASE WHEN (SELECT count(*) FROM c) > 0 THEN 'NF da competência não emitida' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', v) ORDER BY v DESC) FROM (SELECT * FROM c ORDER BY v DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'fin_recebimentos' THEN
    WITH n AS (SELECT c.nome AS contrato, coalesce(n.vlr_liquido_total, 0) AS v, n.data_pagamento IS NOT NULL AS pago
                 FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
                WHERE n.deleted_at IS NULL AND n.status::text = 'concluida' AND n.data_emissao IS NOT NULL
                  AND n.data_emissao + coalesce(p_param, 30)::int BETWEEN date_trunc('month', hoje)::date AND hoje)
    SELECT jsonb_build_object(
      'valor', (SELECT CASE WHEN coalesce(sum(v), 0) = 0 THEN 100 ELSE round(100.0 * coalesce(sum(v) FILTER (WHERE pago), 0) / sum(v), 1) END FROM n),
      'impacto', COALESCE((SELECT sum(v) FILTER (WHERE NOT pago) FROM n), 0),
      'afetado', (SELECT 'R$ ' || to_char(coalesce(sum(v) FILTER (WHERE pago), 0), 'FM999G999G990') || ' de R$ ' || to_char(coalesce(sum(v), 0), 'FM999G999G990') || ' previstos' FROM n),
      'causa', (SELECT CASE WHEN count(*) FILTER (WHERE NOT pago) > 0 THEN count(*) FILTER (WHERE NOT pago) || ' NF(s) vencida(s) sem baixa' END FROM n),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', coalesce(contrato, 'Sem contrato'), 'valor', s) ORDER BY s DESC)
                             FROM (SELECT contrato, sum(v) s FROM n WHERE NOT pago GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'fin_inadimplencia' THEN
    WITH n AS (SELECT c.nome AS contrato, coalesce(n.vlr_liquido_total, 0) AS v, hoje - (n.data_emissao + coalesce(p_param, 30)::int) AS atraso
                 FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
                WHERE n.deleted_at IS NULL AND n.status::text = 'concluida' AND n.data_pagamento IS NULL AND n.data_emissao IS NOT NULL),
    a AS (SELECT *, CASE WHEN atraso >= 120 THEN '120 dias ou mais' WHEN atraso >= 90 THEN '90 a 119 dias' WHEN atraso >= 60 THEN '60 a 89 dias'
                         WHEN atraso >= 30 THEN '30 a 59 dias' ELSE '15 a 29 dias' END AS faixa,
                    CASE WHEN atraso >= 120 THEN 5 WHEN atraso >= 90 THEN 4 WHEN atraso >= 60 THEN 3 WHEN atraso >= 30 THEN 2 ELSE 1 END AS ord
            FROM n WHERE atraso >= 15)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM a), 0), 'impacto', COALESCE((SELECT sum(v) FROM a), 0),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' || COALESCE(' · maior: ' || (SELECT contrato FROM a GROUP BY contrato ORDER BY sum(v) DESC LIMIT 1), '') FROM a),
      'causa', (SELECT 'Maior faixa: ' || faixa FROM a GROUP BY faixa ORDER BY sum(v) DESC LIMIT 1),
      'detalhe', (SELECT jsonb_agg(jsonb_build_object('nome', f.faixa, 'valor', coalesce(s.v, 0), 'rotulo', coalesce(s.n, 0) || ' NF(s)') ORDER BY f.ord)
                    FROM (VALUES (1, '15 a 29 dias'), (2, '30 a 59 dias'), (3, '60 a 89 dias'), (4, '90 a 119 dias'), (5, '120 dias ou mais')) f(ord, faixa)
                    LEFT JOIN (SELECT faixa, sum(v) v, count(*) n FROM a GROUP BY 1) s ON s.faixa = f.faixa))
      INTO r;

  ELSIF p_codigo = 'fin_glosas' THEN
    WITH o AS (
      SELECT CASE WHEN n.tipo = 'Glosa' THEN 'Glosas' ELSE 'Multas' END AS origem, coalesce(n.valor_final, n.valor_original, 0) AS v
        FROM public."JUR_NOTIFICACOES" n
       WHERE n.tipo IN ('Glosa', 'Multa') AND coalesce(n.resultado, '') <> 'Revertida'
         AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
      UNION ALL
      SELECT 'Descontos após a emissão', coalesce(n.descontos_pos_emissao_total, 0) FROM public.nf_emissao n
       WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= hoje - coalesce(p_param, 90)::int
      UNION ALL
      SELECT 'Conta vinculada (retida)', coalesce(n.desconto_conta_vinculada, 0) FROM public.nf_emissao n
       WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM o), 0), 'impacto', COALESCE((SELECT sum(v) FROM o), 0),
      'afetado', 'Últimos ' || coalesce(p_param, 90)::int || ' dias',
      'causa', (SELECT origem FROM o GROUP BY origem HAVING sum(v) > 0 ORDER BY sum(v) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', origem, 'valor', s) ORDER BY s DESC) FROM (SELECT origem, sum(v) s FROM o GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  -- ===== Jurídico =====
  ELSIF p_codigo IN ('jur_prazos', 'jur_sem_resposta') THEN
    WITH a AS (SELECT coalesce(n.tipo, 'Notificação') || ' · ' || coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'sem contrato') AS nome,
                      n.prazo_defesa - hoje AS dias, n.etapa
                 FROM public."JUR_NOTIFICACOES" n
                WHERE n.encerrada_em IS NULL AND coalesce(n.etapa, '') <> 'Encerrada'),
    f AS (SELECT * FROM a WHERE (p_codigo = 'jur_prazos' AND dias IS NOT NULL AND dias <= coalesce(p_param, 5))
                             OR (p_codigo = 'jur_sem_resposta' AND etapa IN ('Recebida', 'Em análise')))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) FILTER (WHERE dias < 0) || ' vencido(s) · ' || count(*) FILTER (WHERE dias >= 0) || ' no prazo' FROM f),
      'causa', (SELECT 'Etapa: ' || coalesce(etapa, '—') || ' (' || count(*) || ')' FROM f GROUP BY etapa ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo',
                                CASE WHEN dias IS NULL THEN coalesce(etapa, '—') WHEN dias < 0 THEN 'vencido há ' || -dias || ' d' WHEN dias = 0 THEN 'vence hoje' ELSE 'em ' || dias || ' d' END)
                                ORDER BY dias NULLS LAST) FROM (SELECT * FROM f ORDER BY dias NULLS LAST LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'jur_audiencias' THEN
    WITH d AS (
      SELECT coalesce(nullif(btrim(p.contrato), ''), p.comarca, 'sem contrato') AS contrato, x.tipo, left(x.dt, 10)::date AS dia
        FROM public."JUR_PROCESSOS" p
        CROSS JOIN LATERAL (VALUES ('Audiência', p.data_audiencia_designada), ('1ª audiência', p.data_primeira_audiencia),
                                   ('Instrução', p.data_audiencia_instrucao), ('Perícia', p.data_pericia)) x(tipo, dt)
       WHERE p.status = 'EM ANDAMENTO' AND x.dt ~ '^\d{4}-\d{2}-\d{2}'),
    f AS (SELECT DISTINCT * FROM d WHERE dia BETWEEN hoje AND hoje + coalesce(p_param, 15)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) FILTER (WHERE dia <= hoje + 3) || ' nos próximos 3 dias' FROM f),
      'causa', (SELECT tipo || ' (' || count(*) || ')' FROM f GROUP BY tipo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', tipo || ' · ' || contrato, 'valor', dia - hoje, 'rotulo', to_char(dia, 'DD/MM')) ORDER BY dia)
                             FROM (SELECT * FROM f ORDER BY dia LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'jur_reincidentes' THEN
    WITH m AS (SELECT btrim(x) AS motivo FROM public."JUR_PROCESSOS" p, regexp_split_to_table(coalesce(p.motivos, ''), '\s*[,;]\s*') x
                WHERE p.status = 'EM ANDAMENTO' AND btrim(x) <> ''),
    c AS (SELECT motivo, count(*) n FROM m GROUP BY 1)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c WHERE n >= coalesce(p_param, 5)),
      'afetado', (SELECT count(*) || ' processos em andamento' FROM public."JUR_PROCESSOS" WHERE status = 'EM ANDAMENTO'),
      'causa', (SELECT motivo || ' (' || n || ')' FROM c ORDER BY n DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', motivo, 'valor', n) ORDER BY n DESC) FROM (SELECT * FROM c WHERE n >= coalesce(p_param, 5) ORDER BY n DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'jur_multas_revertidas' THEN
    WITH a AS (SELECT coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'sem contrato') AS contrato,
                      greatest(coalesce(n.valor_original, 0) - coalesce(n.valor_final, 0), 0) AS v
                 FROM public."JUR_NOTIFICACOES" n
                WHERE n.resultado ILIKE 'Revertida%' AND coalesce(n.data_desfecho, n.updated_at::date) >= hoje - coalesce(p_param, 365)::int)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM a), 0), 'afetado', (SELECT count(*) || ' reversão(ões)' FROM a),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', s) ORDER BY s DESC) FROM (SELECT contrato, sum(v) s FROM a GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  -- ===== Controladoria =====
  ELSIF p_codigo = 'ctl_planos' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.area), ''), nullif(btrim(p.setor), ''), nullif(btrim(p.comite), ''), 'Sem área') AS area,
                      hoje - p.data_fim_planejado AS dias, coalesce(p.custo_previsto, 0) AS custo
                 FROM public.plano_acao p
                WHERE p.deleted_at IS NULL AND coalesce(p.status_normalizado, '') NOT LIKE 'concluida%' AND p.data_fim_planejado < hoje)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p), 'impacto', (SELECT nullif(sum(custo), 0) FROM p),
      'afetado', (SELECT count(DISTINCT area) || ' área(s) · ' || count(*) FILTER (WHERE dias > 30) || ' com mais de 30 dias' FROM p),
      'causa', (SELECT 'Mais atrasos: ' || area || ' (' || count(*) || ')' FROM p GROUP BY area ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', area, 'valor', n, 'rotulo', n || ' · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT area, count(*) n, max(dias) d FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'ctl_nao_atualizados' THEN
    WITH i AS (SELECT i.codigo, i.nome, pa.titulo AS painel,
                      (SELECT max(l.created_at) FROM public."TVG_LANCAMENTO" l WHERE l.indicador = i.codigo) AS ultimo,
                      CASE i.periodicidade WHEN 'diaria' THEN 2 WHEN 'semanal' THEN 8 ELSE 35 END AS tol
                 FROM public."TVG_INDICADOR" i JOIN public."TVG_PAINEL" pa ON pa.slug = i.painel
                WHERE i.ativo AND i.fonte = 'manual'),
    f AS (SELECT * FROM i WHERE ultimo IS NULL OR ultimo < now() - make_interval(days => tol))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT painel) || ' TV(s) · ' || count(*) FILTER (WHERE ultimo IS NULL) || ' nunca lançado(s)' FROM f),
      'causa', (SELECT 'Mais pendências: ' || painel || ' (' || count(*) || ')' FROM f GROUP BY painel ORDER BY count(*) DESC LIMIT 1),
      'base', (SELECT count(*) || ' indicadores de lançamento manual' FROM i),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', painel, 'valor', n) ORDER BY n DESC) FROM (SELECT painel, count(*) n FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  -- ===== TI / ERP =====
  ELSIF p_codigo IN ('ti_erros', 'ti_demandas') THEN
    WITH c AS (SELECT coalesce(nullif(btrim(c.modulo_sistema), ''), 'Outro') AS modulo,
                      hoje - (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias
                 FROM public."CHAMADO_SISTEMA" c
                WHERE c.status IN ('aberto', 'em_andamento', 'aguardando_retorno') AND c.prioridade = 'alta'
                  AND ((p_codigo = 'ti_erros' AND c.tipo_solicitacao = 'correcao')
                    OR (p_codigo = 'ti_demandas' AND (c.prazo_previsto < hoje
                         OR (c.prazo_previsto IS NULL AND c.created_at < now() - make_interval(days => coalesce(p_param, 30)::int))))))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c),
      'afetado', (SELECT count(DISTINCT modulo) || ' módulo(s)' || COALESCE(' · mais antigo: ' || max(dias) || ' d', '') FROM c),
      'causa', (SELECT 'Mais chamados: ' || modulo || ' (' || count(*) || ')' FROM c GROUP BY modulo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', modulo, 'valor', n, 'rotulo', n || ' · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT modulo, count(*) n, max(dias) d FROM c GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'ti_integracoes' THEN
    WITH f AS (SELECT f.destino FROM public.fila_http f
                WHERE f.erro IS NOT NULL AND f.processado_em IS NULL AND f.criado_em >= now() - make_interval(days => coalesce(p_param, 7)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT destino) || ' integração(ões)' FROM f),
      'causa', (SELECT destino || ' (' || count(*) || ')' FROM f GROUP BY destino ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', destino, 'valor', n) ORDER BY n DESC) FROM (SELECT destino, count(*) n FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'ti_acessos' THEN
    WITH d AS (SELECT coalesce(nullif(btrim(e."Setor_ERP"), ''), nullif(btrim(e."Nome Filial"), ''), 'Sem setor') AS setor
                 FROM public."EMPREGADOS" e JOIN auth.users u ON u.id = e.auth_user_id
                WHERE e."Situação" = 'Demitido' AND (u.banned_until IS NULL OR u.banned_until < now()))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d),
      'causa', CASE WHEN (SELECT count(*) FROM d) > 0 THEN 'Login não bloqueado após a demissão' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', setor, 'valor', n) ORDER BY n DESC) FROM (SELECT setor, count(*) n FROM d GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  ELSE
    RETURN NULL;   -- não é automático
  END IF;

  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.tvg_calc(text, numeric) FROM PUBLIC, anon, authenticated;

-- ── 7) O painel inteiro (interna: a TV e a prévia chamam) ───────────────
-- Para cada indicador ativo do painel: o cadastro + o resultado (auto, último
-- lançamento, espelho ou soma) + subindicadores. Um cálculo que falhar não
-- derruba o painel: vem com "erro" e a TV mostra "sem dado".
CREATE OR REPLACE FUNCTION public.tvg_resultado(p_codigo text, p_nivel int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  i public."TVG_INDICADOR"; l public."TVG_LANCAMENTO"; r jsonb; c text; s numeric := 0; tem boolean := false; sub jsonb;
  partes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND OR p_nivel > 3 THEN RETURN NULL; END IF;

  IF i.fonte = 'auto' THEN
    BEGIN
      r := public.tvg_calc(i.codigo, i.parametro) || jsonb_build_object('atualizado_em', now(), 'origem', 'ERP');
    EXCEPTION WHEN OTHERS THEN
      r := jsonb_build_object('valor', NULL, 'erro', SQLERRM);
    END;
  ELSIF i.fonte = 'manual' THEN
    SELECT * INTO l FROM public."TVG_LANCAMENTO" WHERE indicador = i.codigo ORDER BY referencia DESC, created_at DESC LIMIT 1;
    IF FOUND THEN
      r := jsonb_build_object('valor', l.valor, 'afetado', l.afetado, 'causa', l.causa, 'impacto', l.impacto, 'detalhe', l.detalhe,
                              'responsavel', nullif(btrim(l.responsavel), ''), 'referencia', l.referencia, 'atualizado_em', l.created_at,
                              'origem', 'Lançamento', 'observacao', l.observacao);
    ELSE
      r := jsonb_build_object('valor', NULL, 'origem', 'Lançamento');
    END IF;
  ELSIF i.fonte = 'espelho' THEN
    r := (public.tvg_resultado(i.espelho_de, p_nivel + 1)->'resultado') || jsonb_build_object('origem', 'Espelho');
  ELSE -- soma
    FOREACH c IN ARRAY coalesce(i.componentes, ARRAY[]::text[]) LOOP
      sub := public.tvg_resultado(c, p_nivel + 1);
      IF sub IS NOT NULL THEN
        partes := partes || jsonb_build_array(jsonb_build_object('nome', sub->>'nome', 'valor', (sub->'resultado'->>'valor')::numeric,
                                                                  'rotulo', CASE WHEN sub->'resultado'->>'valor' IS NULL THEN 'sem lançamento' END));
        IF (sub->'resultado'->>'valor') IS NOT NULL THEN s := s + (sub->'resultado'->>'valor')::numeric; tem := true; END IF;
      END IF;
    END LOOP;
    r := jsonb_build_object('valor', CASE WHEN tem THEN s END, 'detalhe', partes, 'origem', 'Soma',
                            'afetado', (SELECT count(*) || ' de ' || jsonb_array_length(partes) || ' com pendência' FROM jsonb_array_elements(partes) x WHERE (x->>'valor')::numeric > 0),
                            'causa', (SELECT 'Maior: ' || (x->>'nome') || ' (' || (x->>'valor') || ')' FROM jsonb_array_elements(partes) x
                                       WHERE (x->>'valor')::numeric > 0 ORDER BY (x->>'valor')::numeric DESC LIMIT 1));
  END IF;

  RETURN jsonb_build_object(
    'codigo', i.codigo, 'nome', i.nome, 'identificar', i.identificar, 'regra', i.regra, 'fonte', i.fonte, 'unidade', i.unidade,
    'sentido', i.sentido, 'meta', i.meta, 'alerta', i.alerta, 'periodicidade', i.periodicidade,
    'responsavel', coalesce(r->>'responsavel', i.responsavel), 'pai', i.pai, 'na_tv', i.na_tv, 'ordem', i.ordem,
    'parametro', i.parametro, 'parametro_rotulo', i.parametro_rotulo, 'espelho_de', i.espelho_de,
    'resultado', coalesce(r, '{}'::jsonb) - 'responsavel');
END $$;
REVOKE ALL ON FUNCTION public.tvg_resultado(text, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_painel_dados(p_painel text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'painel', (SELECT jsonb_build_object('slug', p.slug, 'titulo', p.titulo, 'diretoria', p.diretoria, 'pergunta', p.pergunta)
                 FROM public."TVG_PAINEL" p WHERE p.slug = p_painel),
    'indicadores', COALESCE((SELECT jsonb_agg(public.tvg_resultado(i.codigo) ORDER BY i.na_tv DESC, i.ordem)
                               FROM public."TVG_INDICADOR" i WHERE i.painel = p_painel AND i.ativo), '[]'::jsonb),
    'gerado_em', now())
$$;
REVOKE ALL ON FUNCTION public.tvg_painel_dados(text) FROM PUBLIC, anon, authenticated;

-- Prévia/gestão (com login).
CREATE OR REPLACE FUNCTION public.tvg_painel(p_painel text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tvg_painel_dados(p_painel);
END $$;
REVOKE ALL ON FUNCTION public.tvg_painel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_painel(text) TO authenticated;

-- ── 8) Playlist: o item "relatório" aceita as 13 TVs gerenciais ─────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    relatorio IN ('geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                  'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas', 'licitacoes', 'treinamentos',
                  'ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-frota', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                  'ger-treinamento', 'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-ti', 'ger-presidencia')
    AND COALESCE(rel_periodo, '12m') IN ('mes', '3m', '6m', '12m', 'ano')));

-- tv_relatorio: a da mig 20261008000007 + o ramo 'ger-*'.
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  d public."TV_DISPOSITIVO"; i public."TV_ITEM"; v_de date; v_ate date; v_out jsonb; s text;
  v_ano int; v_meses int[]; v_filial text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') AND pareado_em IS NOT NULL AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não autorizada.'; END IF;
  SELECT * INTO i FROM public."TV_ITEM" WHERE id = p_item AND playlist_id = d.playlist_id AND ativo AND tipo = 'relatorio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não está na playlist desta TV.'; END IF;

  SELECT p.de, p.ate INTO v_de, v_ate FROM public.tv_rel_periodo(i.rel_periodo) p;

  IF i.relatorio LIKE 'ger-%' THEN
    -- TVs gerenciais por diretoria (mig 20261012000001): sem período nem contrato.
    v_out := jsonb_build_object('tipo', 'gerencial') || public.tvg_painel_dados(i.relatorio);
  ELSIF i.relatorio = 'geral' THEN
    v_out := jsonb_build_object('tipo', 'geral', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'sistemas', '[]'::jsonb);
    FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'mudanca-funcao', 'chamados', 'orientacoes'] LOOP
      v_out := jsonb_set(v_out, '{sistemas}', (v_out->'sistemas') || jsonb_build_array(
        (SELECT jsonb_build_object('slug', s, 'titulo', r->>'titulo', 'kpis', r->'kpis', 'rotulo_item', r->>'rotulo_item',
                                   'mensal', r->'mensal')
           FROM (SELECT public.dir_rel_dados(s, v_de, v_ate, i.rel_contrato, NULL) r) x)));
    END LOOP;
  ELSIF i.relatorio = 'vagas' THEN
    v_out := jsonb_build_object('tipo', 'vagas', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
                                'painel', public.dir_vagas_painel_dados(v_de, v_ate, i.rel_contrato, NULL));
  ELSIF i.relatorio = 'turnover' THEN
    v_ano := extract(year FROM v_ate)::int;
    v_meses := ARRAY(SELECT m FROM generate_series(1, 12) m
                      WHERE make_date(v_ano, m, 1) BETWEEN date_trunc('month', v_de)::date AND v_ate);
    v_filial := public.dir_turnover_filial(i.rel_contrato);
    v_out := jsonb_build_object('tipo', 'turnover', 'filial', v_filial,
                                'painel', public.dir_turnover_painel_dados(v_ano, NULL, v_filial, NULL, v_meses));
  ELSIF i.relatorio = 'licitacoes' THEN
    v_out := jsonb_build_object('tipo', 'licitacoes') || public.tv_licitacao_dados();
  ELSIF i.relatorio = 'treinamentos' THEN
    v_out := jsonb_build_object('tipo', 'treinamentos', 'painel', public.trn_dashboard_dados(NULL, NULL, NULL));
  ELSE
    v_out := jsonb_build_object('tipo', 'sistema', 'slug', i.relatorio) || public.dir_rel_dados(i.relatorio, v_de, v_ate, i.rel_contrato, NULL);
  END IF;

  RETURN v_out || jsonb_build_object('contrato', (SELECT c.nome FROM public.contratos c WHERE c.id = i.rel_contrato), 'gerado_em', now());
END $$;
REVOKE ALL ON FUNCTION public.tv_relatorio(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- tv_relatorio: reaplicar a da mig 20261008000007.
-- CHECK tv_item_relatorio_check: recriar sem os 'ger-*' (antes, apagar esses itens:
--   DELETE FROM "TV_ITEM" WHERE relatorio LIKE 'ger-%';).
-- DROP FUNCTION IF EXISTS public.tvg_painel(text), public.tvg_painel_dados(text), public.tvg_resultado(text, int),
--   public.tvg_calc(text, numeric), public.tvg_quadro_contratos(), public.tvg_num_br(text),
--   public.tvg_lancamento_autor(), public.tvg_indicador_carimbo();
-- DROP TABLE IF EXISTS public."TVG_LANCAMENTO", public."TVG_INDICADOR", public."TVG_PAINEL";
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'tvs_gerenciais';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'tvs_gerenciais';
-- DELETE FROM public.app_menu WHERE codigo = 'tvs_gerenciais';
