-- reuniao_convidado.user_id era NOT NULL desde a criação da tabela
-- (20260706000002_reunioes_tabelas_filhas.sql), mas essa restrição nunca
-- chegou a valer em produção de verdade (confirmado via
-- pg_attribute.attnotnull = false) — permitiu pelo menos uma linha órfã
-- (convidado sem pessoa nenhuma associada), que quebrava o front-end ao
-- tentar montar as iniciais do avatar a partir de um nome nulo.
--
-- Limpa as linhas órfãs existentes (não dá pra reatribuir a ninguém —
-- não há como saber quem deveria ser) e recria a constraint de verdade.
DELETE FROM public.reuniao_convidado WHERE user_id IS NULL;

ALTER TABLE public.reuniao_convidado ALTER COLUMN user_id SET NOT NULL;
