-- =====================================================================
-- WHATSAPP — a IA responde sobre as vagas REAIS do banco
--
-- Hoje o bot só sabe mandar o link do portal. Para responder "tem vaga de
-- porteiro em Porto Alegre?" ela precisa das vagas na mão — e precisa que
-- venham do banco a cada conversa, não da memória do modelo: vaga fechada
-- ontem não pode ser oferecida hoje.
--
-- A RPC devolve SÓ o que pode ser dito a um candidato. A tabela guarda muita
-- coisa interna (CPF do solicitante, motivo da saída de quem estava na vaga,
-- motivo de reprovação, nome do substituído); nada disso sai daqui, senão a
-- IA poderia repetir ao candidato o que leu no contexto.
--
-- Status: 'Vaga aberta - Seleção de Currículos' é o mesmo que o portal de
-- candidaturas usa (BancoTalentos). Qualquer outro status é etapa interna.
--
-- Idempotente.
-- ROLLBACK: DROP FUNCTION IF EXISTS public.wa_vagas_abertas();
-- =====================================================================

-- O que SAI (o candidato pode/deve saber): cargo, local, quantidade, escala,
-- horário, salário, benefícios, insalubridade, requisitos, experiência e
-- início previsto.
--
-- O que NÃO sai, e por quê:
--   contrato              → nome do cliente, informação comercial
--   alta_rotatividade     → julgamento interno; afastaria candidato
--   grau_urgencia         → interno, e vira pressão de negociação
--   motivos_saida         → fala de quem saiu da vaga
--   nome_substituido      → pessoa identificável
--   observacao_importante → campo livre do RH, sem garantia de ser público
--   solicitante_*         → dados de quem abriu a requisição
CREATE OR REPLACE FUNCTION public.wa_vagas_abertas()
RETURNS TABLE(
  id bigint, cargo text, cidade text, estado text, escala text,
  horario text, salario text, beneficios text, quantidade_vagas integer,
  requisitos text, desejaveis text, experiencia text,
  insalubridade text, local_trabalho text, inicio_previsto text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.cargo, r.cidade, r.estado, r.escala,
         r.horario, r.salario, r.beneficios, r.quantidade_vagas,
         r.req_obrigatorios,
         r.req_desejaveis,
         -- "Sim" sozinho não diz nada ao candidato; junta com o "qual".
         CASE WHEN lower(coalesce(r.exp_minima, '')) LIKE 'sim%'
              THEN coalesce(nullif(btrim(r.exp_minima_qual), ''), 'sim')
              ELSE 'não exige' END,
         CASE WHEN lower(coalesce(r.insalubridade_recebe, '')) LIKE 'sim%'
              THEN coalesce(nullif(btrim(r.insalubridade_quanto), ''), 'sim')
              ELSE NULL END,
         r.local_exato,
         r.data_inicio_prevista
    FROM public."SISTEMA_RECRUTAMENTO" r
   WHERE r.status = 'Vaga aberta - Seleção de Currículos'
   ORDER BY r.created_at DESC
   -- Teto alto de propósito: se a lista fosse cortada, a IA responderia "não
   -- temos vaga na sua cidade" com base numa lista incompleta — e essa é a
   -- pergunta mais comum. Hoje são poucas vagas; 200 dá folga de sobra.
   LIMIT 200;
$$;

-- O bot chama com service_role; authenticated pode ler para conferir na tela.
REVOKE ALL ON FUNCTION public.wa_vagas_abertas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_vagas_abertas() FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_vagas_abertas() TO authenticated;

NOTIFY pgrst, 'reload schema';
