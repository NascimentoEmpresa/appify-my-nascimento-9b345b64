-- =====================================================================
-- IMPLANTAÇÃO — nova pergunta "Supervisor do Contrato"
--
-- O PEDIDO
--
--   Registrar, por contrato, qual supervisor responde por ele — do mesmo
--   jeito que já se registra o encarregado, na tela
--   /app/licitacoes/implantacao.
--
-- POR QUE ISTO É UMA LINHA, E NÃO UMA COLUNA
--
--   O pedido chegou como "criar uma coluna a mais em checklist_respostas".
--   Não é preciso, e fazer assim daria muito mais trabalho para chegar no
--   mesmo lugar. A dupla de tabelas já é genérica:
--
--     checklist_items     = as PERGUNTAS (63 hoje). Uma linha por pergunta,
--                           com row_index, setor, categoria, prazo, momento.
--     checklist_respostas = as RESPOSTAS. Uma linha por
--                           (contrato_id, row_index), com resposta e obs.
--
--   O "Encarregados do contrato" da tela é simplesmente a linha row_index=5
--   de checklist_items. Então o supervisor é MAIS UMA LINHA ali — e a
--   resposta cai sozinha em checklist_respostas.resposta, sem NENHUMA
--   alteração de código: a tela já sabe listar, salvar e versionar.
--
--   Uma coluna nova exigiria mexer no salvar, no ler, no histórico e no
--   componente — e ainda quebraria o padrão de todas as outras 63 perguntas.
--
-- POR QUE row_index = 63 E NÃO 6 (ao lado do encarregado)
--
--   row_index é a CHAVE das respostas já gravadas. Renumerar para encaixar a
--   pergunta ao lado do encarregado moveria a resposta de cada contrato para
--   a pergunta errada — silenciosamente. A tela agrupa por SETOR, então com
--   setor='Recrutamento' a pergunta já aparece no mesmo cartão do
--   encarregado; só fica por último dentro dele, o que é barato demais para
--   justificar o risco.
--
-- OS METADADOS SÃO COPIADOS DO ENCARREGADO
--
--   Mesmo setor, mesma categoria, mesmo momento e mesmo prazo: as duas
--   perguntas são a mesma decisão ("quem responde por este contrato"),
--   tomadas na mesma reunião. O único campo diferente é `plano_acao`, que no
--   encarregado descreve recrutar/contratar — o supervisor já é do quadro,
--   então ali vai a orientação de designação.
-- =====================================================================

INSERT INTO public.checklist_items
  (row_index, setor, categoria, item, prazo_limite, tipo_resposta,
   momento, resp_questionamento, plano_acao, responsavel_acao, onde, ordem)
SELECT 63, 'Recrutamento', 'Responsáveis', 'Supervisor do Contrato',
       '15 dias antes do inicio do contrato', 'Descritivo',
       'Reunião de alinhamento', 'Licitação',
       'Designar supervisor responsável pelo contrato',
       'Operacional', 'ERP', 63
 WHERE NOT EXISTS (
   SELECT 1 FROM public.checklist_items WHERE row_index = 63
      OR item ILIKE 'Supervisor do Contrato'
 );

NOTIFY pgrst, 'reload schema';


-- ── Conferência ──────────────────────────────────────────────────────
-- Espera: as duas linhas de "Responsáveis" lado a lado — o encarregado
-- (row_index 5) e o supervisor (row_index 63).
SELECT row_index, setor, categoria, item, momento, prazo_limite, tipo_resposta
  FROM public.checklist_items
 WHERE categoria = 'Responsáveis'
 ORDER BY row_index;

-- Espera: 64 perguntas no total (eram 63).
SELECT count(*) AS total_perguntas, max(row_index) AS ultimo_row_index
  FROM public.checklist_items;


-- =====================================================================
-- ROLLBACK
--   -- Apaga as respostas antes da pergunta: a FK não existe, mas resposta
--   -- órfã de pergunta apagada some da tela e fica ocupando espaço.
--   DELETE FROM public.checklist_respostas WHERE row_index = 63;
--   DELETE FROM public.checklist_items     WHERE row_index = 63;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
