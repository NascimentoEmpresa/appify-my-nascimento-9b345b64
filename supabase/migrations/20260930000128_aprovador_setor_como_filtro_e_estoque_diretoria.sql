-- =========================================================================
-- Setores do aprovador são FILTRO; estoque de demissões/vagas vai pra Diretoria
--
-- Segunda leitura do pedido do Pablo (16/09/2026): "tem que aparecer os que
-- têm setor e que são administrativo/escritório... podendo filtrar por setor
-- no acesso por usuário". Ou seja: a tela da Diretoria mostra TODAS as
-- administrativas; os setores marcados em Acesso por Usuário RECORTAM —
-- quem não tem nenhum marcado vê e decide tudo; quem tem, só os dele.
--
--   aprova_setor(_setor): true se o setor é vazio, se a pessoa não tem
--   nenhum setor marcado, ou se o setor está entre os dela. (Na 127 era
--   opt-out: sem setor marcado, não aprovava nada — travava todo mundo.)
--
-- ESTOQUE: demissões antigas não têm e_escritorio marcado, mas o posto do
-- cadastro já diz "ADMINISTRATIVO"/"ESCRITÓRIO" (4 na 1093 - ADM E
-- ESTAGIARIOS - NH, 1 na 1054). Marca e_escritorio e leva as que estavam
-- "Pendente Operacional" pra "Pendente Diretoria" — só aparecem lá, e só
-- depois da Diretoria vão pro RH e pro SST. Vagas administrativas paradas
-- em "Pendente Analista" idem.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.aprova_setor(_setor text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.cs_reembolso_norm_setor(_setor) IS NULL
      OR NOT EXISTS (SELECT 1 FROM public."SISTEMA_APROVADOR_SETOR" a WHERE a.user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public."SISTEMA_APROVADOR_SETOR" a
         WHERE a.user_id = auth.uid()
           AND public.cs_reembolso_norm_setor(a.setor) = public.cs_reembolso_norm_setor(_setor)
      );
$fn$;

-- Demissões: o posto do cadastro já diz que é escritório.
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET e_escritorio = true
 WHERE NOT e_escritorio
   AND translate(upper(btrim(coalesce(colaborador_posto, ''))), 'ÁÀÂÃÉÊÍÓÔÕÚÇ0', 'AAAAEEIOOOUCO') ~ '^(ADMINISTRATIVO|ESCRITORIO)( |$)';

UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET status = 'Pendente Diretoria'
 WHERE status = 'Pendente Operacional'
   AND (e_escritorio OR nullif(btrim(coalesce(setor, '')), '') IS NOT NULL);

-- Vagas administrativas que ainda esperavam o analista.
UPDATE public."SISTEMA_RECRUTAMENTO"
   SET status = 'Pendente Diretoria'
 WHERE status = 'Pendente Analista'
   AND (coalesce(administrativa, false) OR nullif(btrim(coalesce(setor, '')), '') IS NOT NULL);

NOTIFY pgrst, 'reload schema';

-- Conferência
-- SELECT id, colaborador_nome, colaborador_posto, e_escritorio, setor, status FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE e_escritorio ORDER BY id;

-- ROLLBACK: aprova_setor da 127 (opt-out); os status movidos não voltam sozinhos.
