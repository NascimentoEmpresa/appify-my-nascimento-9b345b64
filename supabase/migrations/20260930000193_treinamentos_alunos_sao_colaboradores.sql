-- =========================================================================
-- Treinamentos: aluno é colaborador — vem do cadastro (EMPREGADOS), não se
-- cadastra à mão
--
-- Pedido do Pablo em 21/09/2026: "pra ser nosso aluno tem que ser nosso
-- colaborador; os alunos vão entrar direto com a admissão. Troca o
-- 'Adicionar novo' por um painel de gerenciar alunos: quem está
-- Trabalhando é ativo; afastado ou demitido é inativo".
--
-- O QUE MUDA
--   • TRN_ALUNO ganha status 'inativo' (afastado/demitido — diferente de
--     'bloqueado', que é decisão de alguém) e as colunas situacao / contrato
--     / cargo espelhadas do cadastro, pro painel filtrar sem join.
--   • trn_sync_aluno_do_empregado(_id): cria/atualiza o aluno de UM
--     colaborador. Chave = empregado_id (único). E-mail: o do cadastro se
--     houver e estiver livre; senão um sintético <ID>@colaborador.nascimento.local
--     (só 158 dos 2.465 não demitidos têm e-mail; a coluna é NOT NULL/única).
--     Colaborador nasce com acesso_completo (a trilha de NRs é de todos).
--   • trg_trn_aluno_do_empregado em EMPREGADOS: admissão vira aluno na hora;
--     mudou Situação/Nome/CPF/e-mail/posto/cargo, o aluno acompanha.
--   • trn_sincronizar_alunos(): a RPC do botão "Sincronizar com o cadastro"
--     — percorre todos os não demitidos + os alunos já vinculados (pra
--     marcar quem foi demitido depois). Demitido antigo que nunca foi aluno
--     não entra: seriam 10.800 linhas mortas.
--   • trn_alunos_gerenciar(): a lista do painel.
--   • Menu treinamentos_alunos_novo vira "Alunos — Gerenciar" (o código
--     fica: é ele que carrega a permissão de quem já tinha).
--   • Carga inicial no fim.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Colunas e status ──────────────────────────────────────────────────
ALTER TABLE public."TRN_ALUNO" DROP CONSTRAINT IF EXISTS "TRN_ALUNO_status_check";
ALTER TABLE public."TRN_ALUNO"
  ADD CONSTRAINT "TRN_ALUNO_status_check" CHECK (status IN ('pendente','ativo','bloqueado','inativo'));

ALTER TABLE public."TRN_ALUNO"
  ADD COLUMN IF NOT EXISTS situacao text,
  ADD COLUMN IF NOT EXISTS contrato text,
  ADD COLUMN IF NOT EXISTS cargo    text,
  ADD COLUMN IF NOT EXISTS sincronizado_em timestamptz;
COMMENT ON COLUMN public."TRN_ALUNO".situacao IS 'EMPREGADOS."Situação" na última sincronização (Trabalhando → ativo; o resto → inativo).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_trn_aluno_empregado ON public."TRN_ALUNO"(empregado_id) WHERE empregado_id IS NOT NULL;

-- ── 2) Sincroniza UM colaborador ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trn_sync_aluno_do_empregado(_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  e          record;
  v_email    text;
  v_status   text;
  v_aluno    uuid;
BEGIN
  SELECT "ID", btrim("Nome") AS nome, regexp_replace(coalesce("CPF", ''), '\D', '', 'g') AS cpf,
         lower(btrim(coalesce(email, ''))) AS email_cad, "Situação" AS situacao,
         btrim(coalesce("Nome Filial", "Descrição do Local", '')) AS contrato,
         btrim(coalesce("Título do Cargo", '')) AS cargo
    INTO e
    FROM public."EMPREGADOS" WHERE "ID" = _id;
  IF e."ID" IS NULL OR e.nome IS NULL OR e.nome = '' THEN RETURN; END IF;

  v_status := CASE WHEN e.situacao = 'Trabalhando' THEN 'ativo' ELSE 'inativo' END;

  SELECT id INTO v_aluno FROM public."TRN_ALUNO" WHERE empregado_id = _id;

  -- E-mail do cadastro, se válido e livre; senão o sintético (estável por ID).
  v_email := CASE
    WHEN e.email_cad ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     AND NOT EXISTS (SELECT 1 FROM public."TRN_ALUNO" a WHERE lower(btrim(a.email)) = e.email_cad AND a.empregado_id IS DISTINCT FROM _id)
      THEN e.email_cad
    ELSE _id::text || '@colaborador.nascimento.local'
  END;

  IF v_aluno IS NULL THEN
    -- Demitido que nunca foi aluno não entra.
    IF e.situacao = 'Demitido' THEN RETURN; END IF;
    INSERT INTO public."TRN_ALUNO"(nome, email, documento, status, acesso_completo, empregado_id, origem,
                                   situacao, contrato, cargo, sincronizado_em)
    VALUES (e.nome, v_email, nullif(e.cpf, ''), v_status, true, _id, 'integracao',
            e.situacao, nullif(e.contrato, ''), nullif(e.cargo, ''), now());
  ELSE
    UPDATE public."TRN_ALUNO"
       SET nome = e.nome,
           email = v_email,
           documento = coalesce(nullif(e.cpf, ''), documento),
           -- Bloqueio é decisão de alguém: não é desfeito pelo cadastro.
           status = CASE WHEN status = 'bloqueado' THEN 'bloqueado' ELSE v_status END,
           situacao = e.situacao, contrato = nullif(e.contrato, ''), cargo = nullif(e.cargo, ''),
           sincronizado_em = now(), updated_at = now()
     WHERE id = v_aluno
       AND (nome IS DISTINCT FROM e.nome OR email IS DISTINCT FROM v_email
            OR situacao IS DISTINCT FROM e.situacao OR contrato IS DISTINCT FROM nullif(e.contrato, '')
            OR cargo IS DISTINCT FROM nullif(e.cargo, '')
            OR (status <> 'bloqueado' AND status IS DISTINCT FROM v_status));
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sync_aluno_do_empregado(bigint) FROM PUBLIC, anon, authenticated;

-- ── 3) Trigger: admissão vira aluno; situação acompanha ─────────────────
CREATE OR REPLACE FUNCTION public.trn_aluno_do_empregado_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.trn_sync_aluno_do_empregado(NEW."ID");
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_trn_aluno_do_empregado ON public."EMPREGADOS";
CREATE TRIGGER trg_trn_aluno_do_empregado
  AFTER INSERT OR UPDATE OF "Situação", "Nome", "CPF", email, "Nome Filial", "Descrição do Local", "Título do Cargo"
  ON public."EMPREGADOS"
  FOR EACH ROW EXECUTE FUNCTION public.trn_aluno_do_empregado_trg();

-- ── 4) RPC do botão "Sincronizar com o cadastro" ─────────────────────────
CREATE OR REPLACE FUNCTION public.trn_sincronizar_alunos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r     record;
  n     int := 0;
  antes int;
BEGIN
  IF NOT (public.trn_acesso('treinamentos_alunos_novo', 'alterar') OR public.trn_acesso('treinamentos_alunos_novo', 'incluir')) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar alunos.' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO antes FROM public."TRN_ALUNO" WHERE empregado_id IS NOT NULL;
  FOR r IN
    SELECT e."ID" FROM public."EMPREGADOS" e
     WHERE e."Situação" IS DISTINCT FROM 'Demitido'
        OR EXISTS (SELECT 1 FROM public."TRN_ALUNO" a WHERE a.empregado_id = e."ID")
  LOOP
    PERFORM public.trn_sync_aluno_do_empregado(r."ID");
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object(
    'percorridos', n,
    'novos', (SELECT count(*) FROM public."TRN_ALUNO" WHERE empregado_id IS NOT NULL) - antes,
    'ativos', (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'ativo'),
    'inativos', (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'inativo'));
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sincronizar_alunos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_sincronizar_alunos() TO authenticated;

-- ── 5) Lista do painel ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trn_alunos_gerenciar()
RETURNS TABLE (
  id uuid, nome text, email text, documento text, status text, situacao text, contrato text, cargo text,
  empregado_id bigint, origem text, acesso_completo boolean, cursos int, ultimo_acesso_em timestamptz,
  sincronizado_em timestamptz, admissao text, afastamento text, email_sintetico boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT a.id, a.nome, a.email, a.documento, a.status, a.situacao, a.contrato, a.cargo,
         a.empregado_id, a.origem, a.acesso_completo,
         (SELECT count(*)::int FROM public."TRN_MATRICULA" m WHERE m.aluno_id = a.id),
         a.ultimo_acesso_em, a.sincronizado_em,
         e."Admissão", e."Data Afastamento",
         a.email LIKE '%@colaborador.nascimento.local'
    FROM public."TRN_ALUNO" a
    LEFT JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
   WHERE public.trn_acesso('treinamentos_alunos_novo') OR public.trn_acesso('treinamentos_alunos')
   ORDER BY (a.status = 'ativo') DESC, a.nome;
$fn$;
REVOKE ALL ON FUNCTION public.trn_alunos_gerenciar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_gerenciar() TO authenticated;

-- ── 6) Menu ──────────────────────────────────────────────────────────────
UPDATE public.app_menu SET nome = 'Alunos — Gerenciar' WHERE codigo = 'treinamentos_alunos_novo';

-- ── 7) Carga inicial ─────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT "ID" FROM public."EMPREGADOS" WHERE "Situação" IS DISTINCT FROM 'Demitido' LOOP
    PERFORM public.trn_sync_aluno_do_empregado(r."ID");
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_trn_aluno_do_empregado ON public."EMPREGADOS";
-- DROP FUNCTION IF EXISTS public.trn_aluno_do_empregado_trg(), public.trn_sincronizar_alunos(), public.trn_alunos_gerenciar(), public.trn_sync_aluno_do_empregado(bigint);
-- DELETE FROM public."TRN_ALUNO" WHERE origem = 'integracao';
-- ALTER TABLE public."TRN_ALUNO" DROP COLUMN IF EXISTS situacao, DROP COLUMN IF EXISTS contrato, DROP COLUMN IF EXISTS cargo, DROP COLUMN IF EXISTS sincronizado_em;
-- UPDATE public.app_menu SET nome = 'Alunos — Adicionar novo' WHERE codigo = 'treinamentos_alunos_novo';
