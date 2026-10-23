-- =========================================================================
-- RECRUTAMENTO: VAGA ENCERRADA NÃO TEM RESPONSÁVEL NA TELA (23/10/2026)
--
-- PEDIDO (Pablo, com o print do filtro "Responsável da vaga: TAINARA"
-- trazendo Reprovada e Contratado): "quando estiver nesses 3 status
-- [Concluído, Reprovada, Contratado] não pode estar com ninguém responsável;
-- fica no histórico quem colocou nesse status e por quê. Filtrei a Tainara,
-- tem que aparecer só os que ainda estão em processo."
--
-- Desfaz a mig 20261014000017 (que, a pedido da época, passou a contar as
-- encerradas por pessoa). Agora, por pessoa: só o que está com ela — fora as
-- filas de aprovação (Pendente Operacional/Analista/Diretoria) E as
-- encerradas (Contratado, Concluído…, Reprovada, Cancelada).
--
-- O vínculo em SISTEMA_RECRUTAMENTO_RESPONSAVEL NÃO é apagado: é o "quem
-- cuidou" que os relatórios de recrutadoras (dir_vagas_recrutadores) e o
-- Excel exportado usam. Só deixa de contar/aparecer como responsável atual.
-- A tela aplica a mesma regra (src/lib/recrutamento/responsavelVaga.ts).
--
-- Idempotente (CREATE OR REPLACE de função, mesma assinatura).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_responsaveis_contagem()
RETURNS TABLE(responsavel_id uuid, responsavel_nome text, vagas bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  -- Por pessoa: o que está com ela agora — sem filas de aprovação nem encerradas.
  SELECT r.responsavel_id, r.responsavel_nome, count(*)
    FROM public."SISTEMA_RECRUTAMENTO" s
    JOIN public."SISTEMA_RECRUTAMENTO_RESPONSAVEL" r ON r.vaga_id = s.id
   WHERE s.status NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria',
                          'Contratado', 'Reprovada', 'Cancelada')
     AND s.status NOT LIKE 'Concluído%'
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
-- Reaplicar rec_responsaveis_contagem da mig 20261014000017 (por pessoa,
-- inclusive as encerradas: só tira Pendente Operacional/Analista/Diretoria).
