-- =========================================================================
-- ORGANOGRAMA › ESTRUTURA E PROCESSOS — PESSOAS REAIS, PERFIL E BIO
-- (22/10/2026)
--
-- PEDIDO (Pablo): no painel do setor (Estrutura e Processos) as "pessoas"
-- eram texto digitado — um cargo ou um primeiro nome — com as
-- funções e os processos (P-0xx) pendurados nelas. Tem que ser gente de
-- verdade: o colaborador do cadastro (EMPREGADOS) e, quando tiver, o login
-- do ERP (profiles). Clicar na pessoa abre o perfil dela, com os dados do
-- cadastro e "o que ela faz na empresa" — a bio, que a própria pessoa
-- escreve em Meu Perfil ou quem edita o organograma escreve por ela.
--
-- O QUE JÁ EXISTIA (mig 20261020000060): ORG_PROC_MEMBRO.empregado_id e
-- user_id, opcionais; a carga inicial gravou só o primeiro nome. E a bio
-- (profiles.bio, mig 20260829000002, 500 caracteres) já é editada em Meu
-- Perfil. Nada de tabela nova: a bio continua UMA só, em profiles — a que a
-- pessoa vê em Meu Perfil é a mesma do organograma.
--
-- 1) Trigger: membro novo exige empregado_id; vinculado não volta a ser
--    texto livre; nome e login vêm do cadastro (o nome digitado some).
--    Os que ainda não têm vínculo ("pendentes") seguem editáveis — tirar
--    as linhas apagaria funções e processos.
-- 2) Vínculo automático do que já estava digitado — conservador: só liga
--    quando o nome bate com UMA pessoa Trabalhando (a do setor, ou, sem
--    ninguém no setor, a única com login no ERP). Ambíguo, cargo no lugar
--    do nome (ex.: "Gerente de Setor") ou sem correspondência fica pendente,
--    e o Cadastro da Estrutura mostra o selo para alguém escolher a pessoa.
-- 3) org_proc_montar devolve "pendente" e a foto pelo login atual.
-- 4) org_proc_perfil_pessoa: o perfil para quem vê o organograma — sem CPF
--    nem nascimento (o organograma não é a ficha do RH).
-- 5) org_proc_salvar_bio: o dono ou quem tem ALTERAR no Cadastro da
--    Estrutura (organograma_processos_cadastro). Pessoa sem login no ERP
--    não tem profiles, então fica sem bio (decisão do Pablo, 22/10).
--
-- Permissão: nenhuma nova. Ler = quem já vê o organograma; escrever a bio
-- de outra pessoa = 'alterar' do cadastro, que o toggle já concede.
-- =========================================================================

-- Comparação de nomes sem acento, caixa ou pontuação ("José" = "JOSE").
CREATE OR REPLACE FUNCTION public.org_proc_norm(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT btrim(regexp_replace(regexp_replace(upper(translate(coalesce(_t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- ── 1) Membro é pessoa do cadastro ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_proc_membro_pessoa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_nome text; v_auth uuid; v_achou boolean;
BEGIN
  IF NEW.empregado_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Escolha a pessoa pelo cadastro de colaboradores — a equipe só aceita gente vinculada.';
    END IF;
    IF OLD.empregado_id IS NOT NULL THEN
      RAISE EXCEPTION 'Essa pessoa já está vinculada ao cadastro; para trocar, escolha outra pessoa.';
    END IF;
    RETURN NEW;  -- pendente da carga inicial: segue editável até vincular
  END IF;

  IF TG_OP = 'INSERT' OR NEW.empregado_id IS DISTINCT FROM OLD.empregado_id THEN
    IF EXISTS (SELECT 1 FROM public."ORG_PROC_MEMBRO" m
                WHERE m.setor_id = NEW.setor_id AND m.empregado_id = NEW.empregado_id AND m.id <> NEW.id) THEN
      RAISE EXCEPTION 'Essa pessoa já está na equipe deste setor.';
    END IF;
  END IF;

  SELECT true, e."Nome"::text, e.auth_user_id INTO v_achou, v_nome, v_auth
    FROM public."EMPREGADOS" e WHERE e."ID"::bigint = NEW.empregado_id;
  IF NOT coalesce(v_achou, false) THEN
    RAISE EXCEPTION 'Colaborador % não encontrado no cadastro.', NEW.empregado_id;
  END IF;
  NEW.nome := coalesce(nullif(btrim(v_nome), ''), NEW.nome);
  IF TG_OP = 'INSERT' OR NEW.empregado_id IS DISTINCT FROM OLD.empregado_id THEN
    NEW.user_id := v_auth;
  ELSE
    NEW.user_id := coalesce(v_auth, NEW.user_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_org_proc_membro_pessoa ON public."ORG_PROC_MEMBRO";
CREATE TRIGGER trg_org_proc_membro_pessoa BEFORE INSERT OR UPDATE ON public."ORG_PROC_MEMBRO"
  FOR EACH ROW EXECUTE FUNCTION public.org_proc_membro_pessoa();

-- ── 2) Vínculo automático do que a carga inicial digitou ─────────────────
DO $vinc$
DECLARE
  r record; v_n int; v_emp bigint;
  n_setor int := 0; n_login int := 0; n_pend int; v_ids uuid[] := '{}';
BEGIN
  FOR r IN
    SELECT m.id, m.setor_id, public.org_proc_norm(m.nome) AS nome, public.org_proc_norm(s.nome) AS setor
      FROM public."ORG_PROC_MEMBRO" m JOIN public."ORG_PROC_SETOR" s ON s.id = m.setor_id
     WHERE m.empregado_id IS NULL
  LOOP
    CONTINUE WHEN length(r.nome) < 3;

    -- (a) a pessoa do setor
    SELECT count(*), min(e."ID"::bigint) INTO v_n, v_emp
      FROM public."EMPREGADOS" e
     WHERE e."Situação" = 'Trabalhando'
       AND (public.org_proc_norm(e."Nome") = r.nome OR public.org_proc_norm(e."Nome") LIKE r.nome || ' %')
       AND public.org_proc_norm(e."Setor_ERP") <> ''
       AND (position(public.org_proc_norm(e."Setor_ERP") IN r.setor) > 0
            OR position(r.setor IN public.org_proc_norm(e."Setor_ERP")) > 0
            OR split_part(public.org_proc_norm(e."Setor_ERP"), ' ', 1) = split_part(r.setor, ' ', 1))
       AND NOT EXISTS (SELECT 1 FROM public."ORG_PROC_MEMBRO" x WHERE x.setor_id = r.setor_id AND x.empregado_id = e."ID"::bigint);
    IF v_n = 1 THEN
      UPDATE public."ORG_PROC_MEMBRO" SET empregado_id = v_emp WHERE id = r.id;
      n_setor := n_setor + 1; v_ids := v_ids || r.id;
      CONTINUE;
    END IF;
    CONTINUE WHEN v_n > 1;  -- dois no setor com o mesmo nome: alguém escolhe

    -- (b) ninguém no setor: a única com login no ERP (quem está no
    --     organograma de processos é do administrativo, que tem login)
    SELECT count(*), min(e."ID"::bigint) INTO v_n, v_emp
      FROM public."EMPREGADOS" e
     WHERE e."Situação" = 'Trabalhando' AND e.auth_user_id IS NOT NULL
       AND (public.org_proc_norm(e."Nome") = r.nome OR public.org_proc_norm(e."Nome") LIKE r.nome || ' %')
       AND NOT EXISTS (SELECT 1 FROM public."ORG_PROC_MEMBRO" x WHERE x.setor_id = r.setor_id AND x.empregado_id = e."ID"::bigint);
    IF v_n = 1 THEN
      UPDATE public."ORG_PROC_MEMBRO" SET empregado_id = v_emp WHERE id = r.id;
      n_login := n_login + 1; v_ids := v_ids || r.id;
    END IF;
  END LOOP;

  SELECT count(*) INTO n_pend FROM public."ORG_PROC_MEMBRO" WHERE empregado_id IS NULL;
  RAISE NOTICE 'organograma de processos: % vinculados pelo setor, % pelo login, % pendentes de vínculo; vinculados agora: %', n_setor, n_login, n_pend, v_ids;
END $vinc$;

-- ── 3) Leitura montada: pendente e foto pelo login atual ─────────────────
CREATE OR REPLACE FUNCTION public.org_proc_montar()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'unidades', COALESCE((SELECT jsonb_agg(to_jsonb(u) || jsonb_build_object('avatar_url',
                   (SELECT p.avatar_url FROM public.profiles p WHERE p.id = COALESCE(u.user_id,
                      (SELECT e.auth_user_id FROM public."EMPREGADOS" e WHERE e."ID" = u.empregado_id))))
                   ORDER BY u.tipo DESC, u.ordem, u.nome) FROM public."ORG_PROC_UNIDADE" u), '[]'::jsonb),
    'setores', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.ordem, s.nome) FROM public."ORG_PROC_SETOR" s WHERE s.ativo), '[]'::jsonb),
    'membros', COALESCE((SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object(
                   'pendente', m.empregado_id IS NULL,
                   'avatar_url', (SELECT p.avatar_url FROM public.profiles p WHERE p.id = COALESCE(
                      (SELECT e.auth_user_id FROM public."EMPREGADOS" e WHERE e."ID" = m.empregado_id), m.user_id)))
                   ORDER BY m.nivel, m.ordem, m.nome) FROM public."ORG_PROC_MEMBRO" m), '[]'::jsonb),
    'macros', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ordem, x.nome) FROM public."ORG_PROC_MACRO" x), '[]'::jsonb),
    'processos', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.ordem, p.codigo) FROM public."ORG_PROC_PROCESSO" p), '[]'::jsonb),
    'conexoes', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public."ORG_PROC_CONEXAO" c), '[]'::jsonb),
    'documentos', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at) FROM public."ORG_PROC_DOCUMENTO" d), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.org_proc_montar() FROM PUBLIC, anon, authenticated;

-- ── 4) Perfil da pessoa ──────────────────────────────────────────────────
-- Lido na hora (não do retrato publicado): a bio que a pessoa acabou de
-- escrever aparece sem precisar republicar a estrutura. O Organograma Geral
-- passa o id do membro do retrato; se ele saiu da equipe depois da
-- publicação, cai para o mesmo colaborador em outro lugar da estrutura.
CREATE OR REPLACE FUNCTION public.org_proc_perfil_pessoa(p_membro_id uuid, p_empregado_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  m public."ORG_PROC_MEMBRO"; e public."EMPREGADOS"; p public.profiles; v_uid uuid;
BEGIN
  IF NOT public.org_proc_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso à Estrutura de Setores e Processos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public."ORG_PROC_MEMBRO" WHERE id = p_membro_id;
  IF m.id IS NULL AND p_empregado_id IS NOT NULL THEN
    SELECT * INTO m FROM public."ORG_PROC_MEMBRO" WHERE empregado_id = p_empregado_id ORDER BY nivel LIMIT 1;
  END IF;
  IF m.id IS NULL THEN RETURN NULL; END IF;

  IF m.empregado_id IS NOT NULL THEN
    SELECT * INTO e FROM public."EMPREGADOS" x WHERE x."ID"::bigint = m.empregado_id;
  END IF;
  v_uid := COALESCE(e.auth_user_id, m.user_id);
  IF v_uid IS NOT NULL THEN
    SELECT * INTO p FROM public.profiles WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'membro_id', m.id,
    'setor_id', m.setor_id,
    'nome', COALESCE(nullif(btrim(e."Nome"::text), ''), m.nome),
    'cargo_organograma', m.cargo,
    'nivel', m.nivel,
    'pendente', m.empregado_id IS NULL,
    'tem_login', p.id IS NOT NULL,
    'eu', p.id IS NOT NULL AND p.id = auth.uid(),
    'pode_editar_bio', p.id IS NOT NULL AND (p.id = auth.uid() OR public.org_proc_pode('alterar')),
    'conta', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
      'nome', p.display_name, 'email', p.email, 'avatar_url', p.avatar_url,
      'telefone', p.telefone, 'cargo', p.cargo, 'bio', p.bio) END,
    'empregado', CASE WHEN m.empregado_id IS NULL THEN NULL ELSE jsonb_build_object(
      'nome', e."Nome", 'cargo', e."Título do Cargo", 'setor', e."Setor_ERP", 'situacao', e."Situação",
      'empresa', e."Nome da Empresa", 'filial', e."Nome Filial", 'email', e.email) END);
END $fn$;
REVOKE ALL ON FUNCTION public.org_proc_perfil_pessoa(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_proc_perfil_pessoa(uuid, bigint) TO authenticated;

-- ── 5) Bio pelo organograma ──────────────────────────────────────────────
-- Grava em profiles.bio, a mesma de Meu Perfil. Só para quem está na
-- estrutura: 'alterar' do organograma não é licença para reescrever o
-- perfil de qualquer usuário do ERP.
CREATE OR REPLACE FUNCTION public.org_proc_salvar_bio(p_membro_id uuid, p_bio text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE m public."ORG_PROC_MEMBRO"; v_uid uuid;
BEGIN
  SELECT * INTO m FROM public."ORG_PROC_MEMBRO" WHERE id = p_membro_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Pessoa não encontrada na estrutura.';
  END IF;
  SELECT COALESCE((SELECT e.auth_user_id FROM public."EMPREGADOS" e WHERE e."ID"::bigint = m.empregado_id), m.user_id)
    INTO v_uid;
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'Essa pessoa não tem login no ERP — a descrição fica disponível quando ela tiver.';
  END IF;
  IF NOT (v_uid = auth.uid() OR public.org_proc_pode('alterar')) THEN
    RAISE EXCEPTION 'Sem permissão para editar a descrição dessa pessoa.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_bio, ''))) > 500 THEN
    RAISE EXCEPTION 'A descrição tem limite de 500 caracteres.';
  END IF;
  UPDATE public.profiles SET bio = nullif(btrim(p_bio), '') WHERE id = v_uid;
END $fn$;
REVOKE ALL ON FUNCTION public.org_proc_salvar_bio(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_proc_salvar_bio(uuid, text) TO authenticated;

COMMENT ON COLUMN public.profiles.bio IS
  'Descrição livre ("o que faz na empresa"): escrita pelo próprio usuário em Meu Perfil ou por quem edita o Organograma › Estrutura e Processos (org_proc_salvar_bio). Opcional.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_org_proc_membro_pessoa ON public."ORG_PROC_MEMBRO";
-- DROP FUNCTION IF EXISTS public.org_proc_membro_pessoa();
-- DROP FUNCTION IF EXISTS public.org_proc_perfil_pessoa(uuid, bigint);
-- DROP FUNCTION IF EXISTS public.org_proc_salvar_bio(uuid, text);
-- DROP FUNCTION IF EXISTS public.org_proc_norm(text);
-- org_proc_montar: recriar como em 20261020000060 (sem 'pendente', foto por COALESCE(m.user_id, …)).
-- Os vínculos feitos no passo 2 ficam (são dado, não estrutura); para desfazer:
-- UPDATE public."ORG_PROC_MEMBRO" SET empregado_id = NULL, user_id = NULL WHERE id = ANY('<ids do NOTICE "vinculados agora">'::uuid[]);
-- NOTIFY pgrst, 'reload schema';
