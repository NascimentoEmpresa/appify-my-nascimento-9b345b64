-- =========================================================================
-- Vincular meu cadastro: CPF + nascimento em formato ISO dava
-- "CPF e data de nascimento não conferem" com os dados certos.
--
-- Caso de 24/09/2026: TIANE DA COSTA RODRIGUES (ID 11915) digitou
-- 17/08/1979 e o cadastro tem "1979-08-17" — a mesma data. A função
-- comparava só os dígitos ("17081979" x "19790817"). O "Nascimento" do
-- EMPREGADOS tem dois formatos (ISO: 2.190 ativos; DD/MM/AAAA: 297), então
-- quase todo mundo que tentasse se vincular sozinho esbarrava nisso — 2.052
-- cadastros ativos ainda sem vínculo estavam nessa situação.
--
-- Correção: a data digitada e a do cadastro viram DATE (a do cadastro por
-- rh_data_br_para_date, que já entende os dois formatos) e são comparadas
-- como data. A comparação antiga fica como alternativa. Resto da função
-- idêntico ao que estava no banco (pg_get_functiondef), mais pg_temp no
-- search_path.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.vincular_meu_empregado(p_cpf text, p_nascimento text, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_cpf     text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_nasc    text := regexp_replace(coalesce(p_nascimento, ''), '\D', '', 'g');
  v_cpf_fmt text;
  v_emp     public."EMPREGADOS"%ROWTYPE;
  v_bloq    text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
  v_preview jsonb;
  v_data    date;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;
  IF length(v_cpf) <> 11 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe um CPF válido (11 dígitos).');
  END IF;
  IF length(v_nasc) <> 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe a data de nascimento (DD/MM/AAAA).');
  END IF;

  -- Data digitada vira DATA (31/02 e afins caem aqui, com mensagem clara).
  BEGIN
    v_data := to_date(v_nasc, 'DDMMYYYY');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Data de nascimento inválida.');
  END;

  v_cpf_fmt := substr(v_cpf,1,3) || '.' || substr(v_cpf,4,3) || '.' || substr(v_cpf,7,3) || '-' || substr(v_cpf,10,2);

  SELECT * INTO v_emp
  FROM public."EMPREGADOS" e
  WHERE e."CPF" IN (v_cpf, v_cpf_fmt)
  ORDER BY
    (CASE WHEN upper(coalesce(e."Situação",'')) = ANY (v_bloq) THEN 1 ELSE 0 END) ASC,
    (CASE WHEN e."Admissão" ~ '^\d{2}/\d{2}/\d{4}$'
          THEN (substr(e."Admissão",7,4) || substr(e."Admissão",4,2) || substr(e."Admissão",1,2))::bigint
          ELSE 0 END) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CPF não encontrado.');
  END IF;

  IF upper(coalesce(v_emp."Situação",'')) = ANY (v_bloq) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cadastro consta como desligado. Procure o RH.');
  END IF;

  -- 24/09/2026: compara DATAS. O EMPREGADOS guarda "Nascimento" em dois
  -- formatos (ISO na maioria — 2.190 ativos — e DD/MM/AAAA); comparar só os
  -- dígitos dava "19790817" ≠ "17081979" e barrava todo cadastro em ISO.
  -- A comparação antiga fica como alternativa (nada que passava deixa de passar).
  IF public.rh_data_br_para_date(v_emp."Nascimento") IS DISTINCT FROM v_data
     AND regexp_replace(coalesce(v_emp."Nascimento",''), '\D', '', 'g') <> v_nasc THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CPF e data de nascimento não conferem.');
  END IF;

  IF v_emp.auth_user_id IS NOT NULL AND v_emp.auth_user_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este cadastro já está vinculado a outro usuário. Procure o RH.');
  END IF;

  v_preview := jsonb_build_object(
    'id',       v_emp."ID",
    'nome',     coalesce(v_emp."Nome", ''),
    'cargo',    coalesce(v_emp."Título do Cargo", ''),
    'setor',    coalesce(v_emp."Setor_ERP", ''),
    'perfil',   coalesce(v_emp."Perfil_ERP", ''),
    'lider',    coalesce(v_emp."LIDER", ''),
    'situacao', coalesce(v_emp."Situação", ''),
    'admissao', coalesce(v_emp."Admissão", ''),
    'empresa',  coalesce(v_emp."Nome da Empresa", ''),
    'filial',   coalesce(v_emp."Nome Filial", '')
  );

  IF NOT p_confirmar THEN
    RETURN jsonb_build_object('ok', true, 'ja_vinculado', (v_emp.auth_user_id = v_uid), 'empregado', v_preview);
  END IF;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = v_uid,
         "email" = CASE
                     WHEN coalesce(btrim("email"), '') = ''
                     THEN (SELECT u.email FROM auth.users u WHERE u.id = v_uid)
                     ELSE "email"
                   END
   WHERE "ID" = v_emp."ID";

  -- Puxa o nome oficial da Senior para o login.
  UPDATE public.profiles SET display_name = v_emp."Nome" WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'vinculado', true, 'empregado', v_preview);

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sua conta já está vinculada a outro cadastro.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.vincular_meu_empregado(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_meu_empregado(text, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (volta a comparar só os dígitos — reintroduz o erro com nascimento em ISO)
-- Reaplicar a versão anterior de public.vincular_meu_empregado: a comparação
-- regexp_replace(coalesce("Nascimento",''), '\D', '', 'g') <> v_nasc, sem v_data.
-- NOTIFY pgrst, 'reload schema';
