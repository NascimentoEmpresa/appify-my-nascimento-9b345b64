-- =========================================================================
-- RECRUTAMENTO: FILTRO "RESPONSÁVEL DA VAGA" INCLUI AS ENCERRADAS (14/10/2026)
--
-- SINTOMA (Pablo): "pesquiso a vaga 261 e aparece responsável Giovana, mas
-- filtrando a responsável Giovana não aparece a 261 — tá aparecendo uns 15,
-- deveria aparecer uns 25". A Giovana cuida de 28 vagas: 15 em andamento,
-- 11 Contratado, 1 Concluído, 1 Reprovada. O filtro e a contagem (mig
-- 20261014000003) só olhavam as EM ANDAMENTO.
--
-- AGORA: por pessoa, conta tudo o que ela cuidou — menos as filas de
-- aprovação (Pendente Operacional/Analista/Diretoria), que ainda não chegaram
-- ao Recrutamento. "Sem responsável" segue só nas em andamento (senão o
-- legado anterior ao responsável inteiro entraria). A tela aplica a mesma
-- regra (src/lib/recrutamento/responsavelVaga.ts).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_responsaveis_contagem()
RETURNS TABLE(responsavel_id uuid, responsavel_nome text, vagas bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  -- Por pessoa: tudo o que ela cuidou, fora das filas de aprovação.
  SELECT r.responsavel_id, r.responsavel_nome, count(*)
    FROM public."SISTEMA_RECRUTAMENTO" s
    JOIN public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r ON r.vaga_id = s.id
   WHERE s.status NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria')
   GROUP BY 1, 2
  UNION ALL
  -- Sem responsável: só as em andamento.
  SELECT NULL::uuid, 'Sem responsável', count(*)
    FROM public."SISTEMA_RECRUTAMENTO" s
    LEFT JOIN public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r ON r.vaga_id = s.id
   WHERE public.rec_vaga_tem_responsavel(s.status) AND r.vaga_id IS NULL
  HAVING count(*) > 0
   ORDER BY 3 DESC, 2
$$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar rec_responsaveis_contagem da mig 20261014000003 (só em andamento).
