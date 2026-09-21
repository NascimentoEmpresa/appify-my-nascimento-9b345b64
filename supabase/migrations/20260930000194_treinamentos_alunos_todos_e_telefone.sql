-- =========================================================================
-- Treinamentos: todo colaborador é aluno (demitido = inativo) e o cadastro
-- ganha telefone
--
-- Pedido do Pablo em 21/09/2026: "ativos deveria ser ~2.300 (todos
-- Trabalhando); inativos são ~10 mil; bate os nomes da planilha do membox e
-- preenche e-mail e telefone em EMPREGADOS".
--
--   • EMPREGADOS.telefone — coluna do ERP (como email/auth_user_id), não vem
--     da Senior. Preenchida junto com email pela planilha do membox
--     (membox-export-alunos.xlsx, 1.368 alunos): casamento por nome completo
--     normalizado; homônimo resolvido pelo que está Trabalhando; 23 nomes
--     ambíguos e 178 sem cadastro ficaram de fora. Carga feita por script em
--     21/09/2026 (dados, não schema — não cabem numa migration); e-mail já
--     preenchido no cadastro NÃO foi sobrescrito.
--   • trn_sync_aluno_do_empregado: TODO colaborador entra (a 193 deixava o
--     demitido antigo de fora) — Trabalhando = ativo, o resto = inativo; leva
--     o telefone; e-mail real do cadastro tem prioridade sobre o sintético.
--   • trn_sincronizar_alunos percorre EMPREGADOS inteiro.
--   • Carga no fim (o painel passa a mostrar ~2.200 ativos / ~10.800 inativos).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."EMPREGADOS" ADD COLUMN IF NOT EXISTS telefone text;
COMMENT ON COLUMN public."EMPREGADOS".telefone IS 'Telefone/WhatsApp do colaborador — coluna do ERP (não vem da Senior). Alimenta TRN_ALUNO.telefone.';

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
         lower(btrim(coalesce(email, ''))) AS email_cad, nullif(btrim(coalesce(telefone, '')), '') AS telefone,
         "Situação" AS situacao,
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
    INSERT INTO public."TRN_ALUNO"(nome, email, telefone, documento, status, acesso_completo, empregado_id, origem,
                                   situacao, contrato, cargo, sincronizado_em)
    VALUES (e.nome, v_email, e.telefone, nullif(e.cpf, ''), v_status, true, _id, 'integracao',
            e.situacao, nullif(e.contrato, ''), nullif(e.cargo, ''), now());
  ELSE
    UPDATE public."TRN_ALUNO"
       SET nome = e.nome,
           email = v_email,
           telefone = coalesce(e.telefone, telefone),
           documento = coalesce(nullif(e.cpf, ''), documento),
           -- Bloqueio é decisão de alguém: não é desfeito pelo cadastro.
           status = CASE WHEN status = 'bloqueado' THEN 'bloqueado' ELSE v_status END,
           situacao = e.situacao, contrato = nullif(e.contrato, ''), cargo = nullif(e.cargo, ''),
           sincronizado_em = now(), updated_at = now()
     WHERE id = v_aluno
       AND (nome IS DISTINCT FROM e.nome OR email IS DISTINCT FROM v_email
            OR (e.telefone IS NOT NULL AND telefone IS DISTINCT FROM e.telefone)
            OR situacao IS DISTINCT FROM e.situacao OR contrato IS DISTINCT FROM nullif(e.contrato, '')
            OR cargo IS DISTINCT FROM nullif(e.cargo, '')
            OR (status <> 'bloqueado' AND status IS DISTINCT FROM v_status));
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sync_aluno_do_empregado(bigint) FROM PUBLIC, anon, authenticated;

-- O trigger também acorda quando o telefone muda.
DROP TRIGGER IF EXISTS trg_trn_aluno_do_empregado ON public."EMPREGADOS";
CREATE TRIGGER trg_trn_aluno_do_empregado
  AFTER INSERT OR UPDATE OF "Situação", "Nome", "CPF", email, telefone, "Nome Filial", "Descrição do Local", "Título do Cargo"
  ON public."EMPREGADOS"
  FOR EACH ROW EXECUTE FUNCTION public.trn_aluno_do_empregado_trg();

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
  FOR r IN SELECT e."ID" FROM public."EMPREGADOS" e LOOP
    PERFORM public.trn_sync_aluno_do_empregado(r."ID");
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object(
    'percorridos', n,
    'novos', (SELECT count(*) FROM public."TRN_ALUNO" WHERE empregado_id IS NOT NULL) - antes,
    'ativos', (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'ativo'),
    'inativos', (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'inativo'));
END $fn$;

-- Carga: todo mundo.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT "ID" FROM public."EMPREGADOS" LOOP
    PERFORM public.trn_sync_aluno_do_empregado(r."ID");
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TRN_ALUNO" WHERE origem = 'integracao' AND situacao = 'Demitido';
-- Reaplicar trn_sync_aluno_do_empregado / trn_sincronizar_alunos / trigger da 20260930000193;
-- ALTER TABLE public."EMPREGADOS" DROP COLUMN IF EXISTS telefone;
