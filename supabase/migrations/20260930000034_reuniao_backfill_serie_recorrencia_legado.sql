-- SIS-2026-0289 — devolve o autoatendimento das séries semanais antigas.
--
-- Contexto: `serie_recorrencia_id` nasceu em 20260729000002. Toda série
-- recorrente criada ANTES daquela data ficou com a coluna NULL, e é justamente
-- essa coluna que destrava os botões "Editar série" e "Excluir série" em
-- ReuniaoDetalhe.tsx:335 (e a query de useEditarSerieRecorrente). Resultado:
-- 6 séries semanais / 104 reuniões futuras em que ninguém consegue remanejar
-- dia e horário pela tela — só por UPDATE manual no banco. Foi exatamente o
-- que gerou o chamado SIS-2026-0289 (mover a AULA PARA JOVENS APRENDIZ de
-- quarta pra sexta): um pedido de dois cliques que precisou de um dev.
--
-- Esta migration NÃO cria nem altera função, tabela ou policy — é só backfill
-- de dado, por isso não termina com NOTIFY pgrst.
--
-- Agrupamento: (titulo, criado_por, duracao_minutos, dia da semana, hora local).
-- O DIA DA SEMANA ENTRA NA CHAVE DE PROPÓSITO. "Comitê Gestor Ordinário" tem
-- 17 ocorrências na quinta 10:00 e 1 solta na quarta 10:00 — sem o dia na
-- chave as duas viravam a mesma série, e um "Editar série" na quinta
-- arrastaria a quarta junto. Com o dia na chave, a quarta solta simplesmente
-- não forma grupo (HAVING count(*) > 1) e fica como está.
--
-- Escopo restrito a ocorrências FUTURAS ainda 'agendada' — é exatamente o que
-- useEditarSerieRecorrente e excluirSerie leem (ambos filtram
-- etapa = 'agendada' AND data_hora > now()). Linha passada/concluída/cancelada
-- não ganharia nada com o vínculo, e todo UPDATE em `reuniao` passa pela
-- trigger trg_checar_conflito_horario_reuniao — quanto menos linha tocada,
-- menor a chance de uma recusa por conflito herdado de agenda antiga.

WITH grupos AS (
  SELECT titulo,
         criado_por,
         duracao_minutos,
         EXTRACT(DOW FROM data_hora AT TIME ZONE 'America/Sao_Paulo') AS dia_semana,
         (data_hora AT TIME ZONE 'America/Sao_Paulo')::time           AS hora_local,
         gen_random_uuid()                                            AS nova_serie
    FROM public.reuniao
   WHERE serie_recorrencia_id IS NULL
     AND etapa = 'agendada'
     AND data_hora > now()
   GROUP BY 1, 2, 3, 4, 5
  HAVING count(*) > 1
)
UPDATE public.reuniao r
   SET serie_recorrencia_id = g.nova_serie
  FROM grupos g
 WHERE r.serie_recorrencia_id IS NULL
   AND r.etapa = 'agendada'
   AND r.data_hora > now()
   AND r.titulo = g.titulo
   AND r.criado_por = g.criado_por
   AND r.duracao_minutos = g.duracao_minutos
   AND EXTRACT(DOW FROM r.data_hora AT TIME ZONE 'America/Sao_Paulo') = g.dia_semana
   AND (r.data_hora AT TIME ZONE 'America/Sao_Paulo')::time = g.hora_local;

-- Conferência esperada: 6 séries, ~104 reuniões futuras vinculadas.
--
--   SELECT titulo,
--          to_char(min(data_hora) AT TIME ZONE 'America/Sao_Paulo', 'Dy HH24:MI') AS dia_hora,
--          count(*) AS ocorrencias
--     FROM public.reuniao
--    WHERE serie_recorrencia_id IS NOT NULL
--      AND etapa = 'agendada' AND data_hora > now()
--    GROUP BY titulo, serie_recorrencia_id
--    ORDER BY titulo;

-- ROLLBACK
-- Desfaz só o que esta migration semeou: séries futuras 'agendada' cujo
-- vínculo não existia antes. Guardar o resultado da conferência acima antes de
-- rodar, porque depois do rollback os ids somem.
--
-- UPDATE public.reuniao
--    SET serie_recorrencia_id = NULL
--  WHERE etapa = 'agendada'
--    AND data_hora > now()
--    AND titulo IN (
--          'AULA PARA JOVENS APRENDIZ',
--          'Comitê Controladoria',
--          'Comitê Diretivo Ordinário',
--          'Comitê ERP Ordinário',
--          'Comitê Gestor Ordinário',
--          'REUNIÃO DE ALINHAMENTO OPERACIONAL SEMANAL'
--        );
