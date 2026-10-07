-- =========================================================================
-- PORTAL DO COLABORADOR › Seus dados: E-MAIL também (06/10/2026)
--
-- PEDIDO (Pablo): "deixa opção de atualizar o e-mail também" — junto de
-- sexo, estado civil e celular/WhatsApp (mig 20261006000007).
--
-- Aqui NÃO precisa de coluna nova: EMPREGADOS.email já é do ERP — o
-- rh_sync_senior_empregados preserva (só limpa quando a matrícula vira
-- outra pessoa). Ele não é o login do ERP (esse mora em auth.users); o
-- gatilho trg_trn_aluno_do_empregado leva o e-mail novo para o aluno dos
-- Treinamentos, como já fazia com o RH.
--
-- Barra e-mail que já é de OUTRO colaborador ativo: Recrutamento e
-- Treinamentos procuram o nome pelo e-mail, e dois donos dariam o nome
-- errado.
--
-- col_atualizar_dados ganha p_email (assinatura nova → a de 4 parâmetros
-- sai; a Edge colaborador-portal é publicada junto).
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

DROP FUNCTION IF EXISTS public.col_atualizar_dados(bigint, text, text, text);

CREATE OR REPLACE FUNCTION public.col_atualizar_dados(p_emp bigint, p_sexo text, p_estado_civil text, p_celular text, p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cel   text := nullif(regexp_replace(coalesce(p_celular, ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
BEGIN
  IF p_emp IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  -- Valida antes do UPDATE: o erro do CHECK traz a linha inteira da
  -- EMPREGADOS (conta bancária inclusive) e a Edge repassa a mensagem à tela.
  IF nullif(btrim(p_sexo), '') IS NOT NULL AND btrim(p_sexo) NOT IN ('Feminino', 'Masculino') THEN
    RAISE EXCEPTION 'Sexo inválido.';
  END IF;
  IF nullif(btrim(p_estado_civil), '') IS NOT NULL AND btrim(p_estado_civil) NOT IN
     ('Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Separado(a)', 'Viúvo(a)') THEN
    RAISE EXCEPTION 'Estado civil inválido.';
  END IF;
  IF v_cel IS NOT NULL AND length(v_cel) NOT BETWEEN 10 AND 13 THEN
    RAISE EXCEPTION 'Celular inválido — informe com DDD, ex.: (51) 99999-9999.';
  END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;
  IF v_email IS NOT NULL AND EXISTS (
       SELECT 1 FROM public."EMPREGADOS" o
        WHERE o."ID" <> p_emp AND lower(btrim(o.email)) = v_email AND public.esp_col_esta_ativo(o."Situação")) THEN
    RAISE EXCEPTION 'Este e-mail já está no cadastro de outro colaborador. Use um e-mail só seu.';
  END IF;

  UPDATE public."EMPREGADOS"
     SET sexo_informado = nullif(btrim(p_sexo), ''),
         estado_civil_informado = nullif(btrim(p_estado_civil), ''),
         celular_whatsapp = v_cel,
         email = v_email,
         dados_pessoais_atualizados_em = now()
   WHERE "ID" = p_emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;
  RETURN public.col_perfil(p_emp);
END $$;
REVOKE ALL ON FUNCTION public.col_atualizar_dados(bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_atualizar_dados(bigint, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar col_atualizar_dados de 4 parâmetros (mig 20261006000007)
-- DROP FUNCTION IF EXISTS public.col_atualizar_dados(bigint, text, text, text, text);
