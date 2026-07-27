-- Backfill idempotente (seguro mesmo que 20260715000001 já tenha rodado):
-- cobre ações criadas via criar_acao_reuniao_plano_acao antes do fix em
-- 20260728000001, que ficaram com responsavel_profile_id preenchido mas
-- responsavel_nome_origem NULL — por isso apareciam com responsável "—"
-- na Lista mesmo com o vínculo certo.
UPDATE public.plano_acao pa
   SET responsavel_nome_origem = p.display_name
  FROM public.profiles p
 WHERE pa.responsavel_profile_id = p.id
   AND p.display_name IS NOT NULL
   AND (pa.responsavel_nome_origem IS DISTINCT FROM p.display_name);
