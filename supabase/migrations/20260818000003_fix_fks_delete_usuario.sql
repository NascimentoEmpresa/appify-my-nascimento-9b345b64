-- Continuação da correção de "não consigo excluir um usuário". A migration
-- anterior (20260818000002) corrigiu o trigger de plano_acao; esta corrige as
-- FKs de profiles(id) que ainda travariam o DELETE por causa de: (a) SET NULL
-- contra coluna NOT NULL (erro de constraint, igual acabou de acontecer com
-- reuniao_convidado.user_id) ou (b) NO ACTION (bloqueia o DELETE de vez,
-- mesmo em coluna nullable, porque "no action" nunca zera sozinho).
--
-- Auditoria via pg_constraint de TODAS as FKs -> profiles(id) confirmou só
-- estas 4 como problemáticas (as outras ~20 já são SET NULL/CASCADE em
-- coluna nullable, ok). Corrigidas uma a uma, conforme o papel de cada campo:
--
-- 1) reuniao_convidado.user_id (NOT NULL) — é linha de "fulano foi convidado
--    pra essa reunião"; com user_id NULL a linha não tem sentido nenhum, e a
--    própria tabela já é 100% CASCADE por reuniao_id. Vira CASCADE também por
--    user_id: exclui o usuário → some da lista de convidados daquela reunião.
--
-- 2) reuniao.organizador_user_id (NOT NULL, sem ON DELETE = trava o delete).
--    As colunas irmãs da mesma tabela (criado_por, responsavel_preenchimento_
--    user_id) já são nullable + SET NULL — o front (ReuniaoDetalhe.tsx) já
--    trata a ausência com "nomeUsuario(...) ?? '—'". Alinha organizador_user_id
--    ao mesmo padrão: fica nullable, SET NULL.
--
-- 3) reuniao_assunto_fora_pauta.responsavel_tratativa_user_id (nullable, sem
--    ON DELETE) — já era opcional, só faltava o ON DELETE SET NULL.
--
-- 4) reuniao_decisao_acao.responsavel_user_id (nullable, sem ON DELETE) —
--    idem.
--
-- Verificado que nenhum trigger BEFORE UPDATE dessas tabelas revalida esses
-- campos de forma ampla (o mesmo tipo de bug do plano_acao): checar_transicao_
-- reuniao já ignora updates que não mudam "etapa"; checar_conflito_horario_
-- reuniao usa organizador_user_id só pra checar conflito de agenda, e as
-- funções de conflito tratam id NULL como "sem conflito" (comparação NULL
-- normal do SQL). Único caso de borda real: reuniao_assunto_fora_pauta tem 1
-- linha com tratativa='estacionar', que exige responsavel_tratativa_user_id
-- IS NOT NULL — se essa linha específica apontar pro usuário sendo excluído,
-- o DELETE falha na CHECK constraint (erro claro, não misterioso); dado que é
-- 1 linha só, não vale complicar a migration por causa disso.
--
-- ROLLBACK:
-- ALTER TABLE public.reuniao_convidado DROP CONSTRAINT reuniao_convidado_user_id_fkey,
--   ADD CONSTRAINT reuniao_convidado_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
-- ALTER TABLE public.reuniao DROP CONSTRAINT reuniao_organizador_user_id_fkey,
--   ADD CONSTRAINT reuniao_organizador_user_id_fkey FOREIGN KEY (organizador_user_id) REFERENCES public.profiles(id);
-- ALTER TABLE public.reuniao ALTER COLUMN organizador_user_id SET NOT NULL;
-- ALTER TABLE public.reuniao_assunto_fora_pauta DROP CONSTRAINT reuniao_assunto_fora_pauta_responsavel_tratativa_user_id_fkey,
--   ADD CONSTRAINT reuniao_assunto_fora_pauta_responsavel_tratativa_user_id_fkey FOREIGN KEY (responsavel_tratativa_user_id) REFERENCES public.profiles(id);
-- ALTER TABLE public.reuniao_decisao_acao DROP CONSTRAINT reuniao_decisao_acao_responsavel_user_id_fkey,
--   ADD CONSTRAINT reuniao_decisao_acao_responsavel_user_id_fkey FOREIGN KEY (responsavel_user_id) REFERENCES public.profiles(id);

ALTER TABLE public.reuniao_convidado
  DROP CONSTRAINT reuniao_convidado_user_id_fkey,
  ADD CONSTRAINT reuniao_convidado_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.reuniao
  ALTER COLUMN organizador_user_id DROP NOT NULL;

ALTER TABLE public.reuniao
  DROP CONSTRAINT reuniao_organizador_user_id_fkey,
  ADD CONSTRAINT reuniao_organizador_user_id_fkey
    FOREIGN KEY (organizador_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.reuniao_assunto_fora_pauta
  DROP CONSTRAINT reuniao_assunto_fora_pauta_responsavel_tratativa_user_id_fkey,
  ADD CONSTRAINT reuniao_assunto_fora_pauta_responsavel_tratativa_user_id_fkey
    FOREIGN KEY (responsavel_tratativa_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.reuniao_decisao_acao
  DROP CONSTRAINT reuniao_decisao_acao_responsavel_user_id_fkey,
  ADD CONSTRAINT reuniao_decisao_acao_responsavel_user_id_fkey
    FOREIGN KEY (responsavel_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
