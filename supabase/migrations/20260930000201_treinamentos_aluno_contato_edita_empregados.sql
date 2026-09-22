-- =========================================================================
-- Treinamentos: e-mail e telefone do aluno-colaborador passam a ser
-- editáveis — e a edição grava em EMPREGADOS
--
-- Pedido do Pablo em 22/09/2026: "o email e telefone pode ser editável, mas
-- pede pra confirmar e salvar, e isso altera na tabela empregados também".
--
-- Até aqui o aluno que veio do cadastro (origem integracao, empregado_id)
-- tinha nome/telefone/e-mail/CPF travados na tela: a sincronização
-- (trn_sync_aluno_do_empregado) sobrescreveria o que fosse editado só no
-- TRN_ALUNO. E-mail e telefone, porém, NÃO vêm da Senior — são colunas do
-- ERP em EMPREGADOS (email/telefone, ver 20260930000194) —, então dá pra
-- editar na origem sem a importação desfazer. Nome e CPF continuam travados
-- (esses a Senior reescreve).
--
--   • trn_aluno_atualizar_contato(aluno, email, telefone): grava em
--     EMPREGADOS; o trigger trg_trn_aluno_do_empregado leva pro TRN_ALUNO.
--     O telefone também é gravado direto no aluno: a sync faz
--     coalesce(e.telefone, telefone) e não apagaria o telefone limpo.
--   • E-mail já usado por OUTRO aluno é recusado aqui, com o nome — a sync
--     cairia calada no e-mail sintético (<ID>@colaborador.nascimento.local).
--   • Fica no histórico do aluno ("Contato alterado", antes → depois).
--   • Mesma ação da tela: treinamentos_alunos / alterar.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.trn_aluno_atualizar_contato(p_aluno_id uuid, p_email text, p_telefone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_aluno   public."TRN_ALUNO"%ROWTYPE;
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_tel     text := nullif(btrim(coalesce(p_telefone, '')), '');
  v_dono    text;
  v_detalhe text := '';
BEGIN
  IF NOT public.trn_acesso('treinamentos_alunos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar alunos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_aluno FROM public."TRN_ALUNO" WHERE id = p_aluno_id FOR UPDATE;
  IF v_aluno.id IS NULL THEN
    RAISE EXCEPTION 'Aluno não encontrado.';
  END IF;
  IF v_aluno.empregado_id IS NULL THEN
    RAISE EXCEPTION 'Este aluno não está vinculado a um colaborador do cadastro.';
  END IF;

  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido.';
  END IF;

  SELECT a.nome INTO v_dono
    FROM public."TRN_ALUNO" a
   WHERE lower(btrim(a.email)) = v_email AND a.id <> p_aluno_id
   LIMIT 1;
  IF v_dono IS NOT NULL THEN
    RAISE EXCEPTION 'O e-mail % já é de outro aluno (%).', v_email, v_dono;
  END IF;

  IF lower(btrim(v_aluno.email)) IS DISTINCT FROM v_email THEN
    v_detalhe := 'E-mail: ' || v_aluno.email || ' → ' || v_email;
  END IF;
  IF v_aluno.telefone IS DISTINCT FROM v_tel THEN
    v_detalhe := v_detalhe || CASE WHEN v_detalhe = '' THEN '' ELSE ' · ' END
              || 'Telefone: ' || coalesce(v_aluno.telefone, '(vazio)') || ' → ' || coalesce(v_tel, '(vazio)');
  END IF;
  IF v_detalhe = '' THEN RETURN; END IF;

  -- Só mexe no e-mail do cadastro se o e-mail mudou (trocar só o telefone
  -- não pode apagar um e-mail do cadastro que a sync tinha trocado pelo
  -- sintético). E o sintético não é e-mail de verdade: não vai pro cadastro.
  UPDATE public."EMPREGADOS"
     SET email = CASE
                   WHEN lower(btrim(v_aluno.email)) IS NOT DISTINCT FROM v_email THEN email
                   WHEN v_email LIKE '%@colaborador.nascimento.local' THEN NULL
                   ELSE v_email
                 END,
         telefone = v_tel
   WHERE "ID" = v_aluno.empregado_id;

  UPDATE public."TRN_ALUNO"
     SET telefone = v_tel, updated_at = now()
   WHERE id = p_aluno_id AND telefone IS DISTINCT FROM v_tel;

  INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, autor_nome)
  VALUES (p_aluno_id, 'Contato alterado', v_detalhe || ' (gravado também no cadastro do colaborador)', public.trn_nome_autor());
END $fn$;
REVOKE ALL ON FUNCTION public.trn_aluno_atualizar_contato(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_aluno_atualizar_contato(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.trn_aluno_atualizar_contato(uuid, text, text);
