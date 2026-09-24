-- =========================================================================
-- Datas: um conversor universal para o sistema inteiro + módulo Presidência
-- em Acesso por Usuário.
--
-- Pedidos do Pablo (24/09/2026):
--   1) "o sistema tem que entender todas as datas" — depois do vínculo que
--      falhava com nascimento em ISO (mig 228). O EMPREGADOS guarda datas
--      como TEXTO em mais de um formato: DD/MM/AAAA (21.987), ISO (2.457) e
--      até número serial do Excel ("40581" = 07/02/2011). Havia três
--      conversores (rh_data_br_para_date, rh_data, sup_norm_data), cada um
--      entendendo um pedaço.
--   2) Módulo Presidência (criado no menu em 24/09) aparecer em
--      Administração › Acesso por Usuário com seus submódulos.
--
-- 1) public.data_universal(text) → date. Entende:
--      17/08/1979 · 17-08-1979 · 17.08.1979 · 1/8/1979 · 17/08/79
--      1979-08-17 (com ou sem hora) · 1979/08/17 · 17081979 · 19790817
--      serial do Excel de 5 dígitos (30/12/1899 + n)
--    Data impossível (31/02, mês 13) → NULL, nunca erro. Ano de 2 dígitos:
--    00–40 = 20xx, 41–99 = 19xx (virada fixa: a função é IMMUTABLE).
--    rh_data_br_para_date e rh_data passam a CHAMAR a universal (mesma
--    assinatura) — vínculo, aniversariantes, portal, ficha do colaborador e
--    treinamentos ganham todos os formatos de uma vez. Nenhum índice, coluna
--    gerada ou CHECK usa essas funções (conferido), então trocar o corpo é
--    seguro. sup_norm_data (Suprimentos) fica como está.
--    vincular_meu_empregado: a data DIGITADA também passa pela universal.
--
-- 2) app_modulo 'presidencia' + os 4 menus movidos para ele. Permissão é
--    por CÓDIGO de menu (has_screen_access/screen_permission_user), não por
--    módulo — mover não muda o acesso de ninguém. O trigger
--    trg_criar_perfil_acesso_do_modulo cria o perfil espelho do módulo novo
--    (exceção da J2).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Conversor universal ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.data_universal(_v text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  s  text := btrim(coalesce(_v, ''));
  m  text[];
  d  text;
  a  int; mm int; dd int;
BEGIN
  IF s = '' THEN RETURN NULL; END IF;

  -- ISO e variantes: AAAA-MM-DD, AAAA/MM/DD, AAAA.MM.DD (hora depois é ignorada)
  m := regexp_match(s, '^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})');
  IF m IS NOT NULL THEN a := m[1]::int; mm := m[2]::int; dd := m[3]::int;
  ELSE
    -- BR: DD/MM/AAAA, D/M/AAAA, com / - ou .
    m := regexp_match(s, '^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(\D|$)');
    IF m IS NOT NULL THEN dd := m[1]::int; mm := m[2]::int; a := m[3]::int;
    ELSE
      -- BR com ano de 2 dígitos: DD/MM/AA
      m := regexp_match(s, '^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$');
      IF m IS NOT NULL THEN
        dd := m[1]::int; mm := m[2]::int; a := m[3]::int;
        a := CASE WHEN a <= 40 THEN 2000 + a ELSE 1900 + a END;   -- virada fixa (IMMUTABLE)
      ELSE
        d := regexp_replace(s, '\D', '', 'g');
        IF d <> s THEN RETURN NULL; END IF;              -- sobrou texto que não é data
        IF length(d) = 8 THEN
          -- Só dígitos: DDMMAAAA (como se digita) e, se não fechar, AAAAMMDD.
          dd := substr(d,1,2)::int; mm := substr(d,3,2)::int; a := substr(d,5,4)::int;
          IF NOT (mm BETWEEN 1 AND 12 AND dd BETWEEN 1 AND 31 AND a BETWEEN 1850 AND 2200) THEN
            a := substr(d,1,4)::int; mm := substr(d,5,2)::int; dd := substr(d,7,2)::int;
          END IF;
        ELSIF length(d) = 5 AND d::int BETWEEN 10000 AND 80000 THEN
          -- Serial do Excel (base 30/12/1899). Só 5 dígitos (1927–2119): um "1979"
          -- sozinho é ano, não serial.
          RETURN date '1899-12-30' + d::int;
        ELSE
          RETURN NULL;
        END IF;
      END IF;
    END IF;
  END IF;

  IF a < 1850 OR a > 2200 THEN RETURN NULL; END IF;
  BEGIN
    RETURN make_date(a, mm, dd);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;                                         -- 31/02, mês 13...
  END;
END $fn$;

REVOKE ALL ON FUNCTION public.data_universal(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.data_universal(text) TO authenticated, service_role;

-- Os conversores antigos passam a ser a universal (mesma assinatura).
CREATE OR REPLACE FUNCTION public.rh_data_br_para_date(_txt text)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT public.data_universal(_txt) $$;

CREATE OR REPLACE FUNCTION public.rh_data(_v text)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT public.data_universal(_v) $$;

-- Vínculo: a data digitada também pela universal.
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
  IF length(v_nasc) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe a data de nascimento (DD/MM/AAAA).');
  END IF;

  -- Data digitada vira DATA pelo conversor universal (mig 229): aceita
  -- 17/08/1979, 17-08-79, 1979-08-17, 17081979... Impossível → NULL → aviso.
  v_data := public.data_universal(p_nascimento);
  IF v_data IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Data de nascimento inválida.');
  END IF;

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
  IF public.data_universal(v_emp."Nascimento") IS DISTINCT FROM v_data
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

-- ── 2) Módulo Presidência em Acesso por Usuário ─────────────────────────
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem, ativo)
SELECT 'presidencia', 'Presidência', 'Tudo em que a Presidência tem ação, reunido', 'Crown', 5, true
 WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'presidencia');

UPDATE public.app_menu m
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'presidencia'),
       nome  = v.nome,
       ordem = v.ordem
  FROM (VALUES
    ('presidencia',                     'Painel da Presidência',                               10),
    ('comite_etica_presidencia_painel', 'Comitê de Ética · Presidência',                       20),
    ('comite_etica_presidencia',        'Comitê de Ética · Pode registrar a decisão da Presidência', 21),
    ('comite_etica_indicadores',        'Comitê de Ética · Indicadores',                       30)
  ) AS v(codigo, nome, ordem)
 WHERE m.codigo = v.codigo;

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT public.data_universal(x) FROM (VALUES ('17/08/1979'),('1979-08-17'),('17-08-79'),('17081979'),('19790817'),('40581'),('31/02/2020')) t(x);
-- SELECT m.codigo, m.nome FROM app_menu m JOIN app_modulo mo ON mo.id = m.modulo_id WHERE mo.codigo = 'presidencia' ORDER BY m.ordem;

-- ROLLBACK
-- UPDATE public.app_menu SET modulo_id = (SELECT id FROM app_modulo WHERE codigo = 'licitacoes'), nome = 'Presidência', ordem = 6 WHERE codigo = 'presidencia';
-- UPDATE public.app_menu SET modulo_id = (SELECT id FROM app_modulo WHERE codigo = 'comite_etica'), nome = 'Indicadores', ordem = 5 WHERE codigo = 'comite_etica_indicadores';
-- UPDATE public.app_menu SET modulo_id = (SELECT id FROM app_modulo WHERE codigo = 'comite_etica'), nome = 'Presidência', ordem = 29 WHERE codigo = 'comite_etica_presidencia_painel';
-- UPDATE public.app_menu SET modulo_id = (SELECT id FROM app_modulo WHERE codigo = 'comite_etica'), nome = 'Pode registrar a decisão da Presidência', ordem = 30 WHERE codigo = 'comite_etica_presidencia';
-- (o módulo presidencia e o perfil espelho podem ficar; sem menus, somem da tela)
-- rh_data_br_para_date / rh_data: reaplicar os corpos antigos (ISO + DD/MM/AAAA);
-- vincular_meu_empregado: reaplicar a 20260930000228.
-- NOTIFY pgrst, 'reload schema';
