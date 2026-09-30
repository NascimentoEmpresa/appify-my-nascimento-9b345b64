-- =========================================================================
-- Formulários: resposta "em nome de outra pessoa"
--
-- SINTOMA (30/09/2026): "PESQUISA DE DIAGNÓSTICO DA LIDERANÇA — algumas
-- pessoas do operacional responderam mas não está aparecendo".
--
-- CAUSA: as respostas estão TODAS gravadas (54; toda pessoa com acesso ao
-- formulário enxerga as 54). Mas quem respondeu pelo operacional foram os
-- supervisores/gerentes, logados no ERP, preenchendo POR cada colaborador:
-- o nome da pessoa vai na pergunta "Nome do Colaborador (Caso seja outra
-- Pessoa)". Logado, a resposta é carimbada com o cadastro de quem ENVIOU —
-- então ~45 colaboradores (Suelen, Paulo Roberto, Jessica…) apareciam na tela
-- como "DAISON TAVARES RODRIGUES" (16×), "ISMAEL KUHL LOPES" (12×) etc., e
-- não existiam no filtro de respondente.
--
-- CORREÇÃO: o formulário ganha a configuração `pergunta_em_nome_de_id` — a
-- pergunta onde se escreve o nome de quem está sendo respondido. Preenchida
-- numa resposta, a tela de Respostas mostra ESSA pessoa (filtro, PDF, CSV) e
-- guarda "enviado por <quem estava logado>" ao lado. Não se confunde com
-- `pergunta_nome_id` (que identifica o próprio respondente e mapeia apelido →
-- cadastro de quem enviou — usar aquela aqui casaria o nome da colaboradora
-- com o do supervisor).
--
-- Já liga a configuração no formulário do diagnóstico da liderança.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."CS_FORMULARIOS"
  ADD COLUMN IF NOT EXISTS pergunta_em_nome_de_id text;

COMMENT ON COLUMN public."CS_FORMULARIOS".pergunta_em_nome_de_id IS
  'Pergunta onde se escreve o nome de quem está sendo respondido (resposta preenchida por outra pessoa). Preenchida, a tela de Respostas mostra essa pessoa e "enviado por" quem estava logado.';

-- PESQUISA DE DIAGNÓSTICO DA LIDERANÇA → "Nome do Colaborador (Caso seja outra Pessoa)"
UPDATE public."CS_FORMULARIOS"
   SET pergunta_em_nome_de_id = 'ad1c0910-fee6-4005-bcf9-b8347a8339e2'
 WHERE id = '077ec978-ece7-43ca-86a6-bc8674cb3bda'
   AND pergunta_em_nome_de_id IS NULL;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- ALTER TABLE public."CS_FORMULARIOS" DROP COLUMN IF EXISTS pergunta_em_nome_de_id;
-- NOTIFY pgrst, 'reload schema';
