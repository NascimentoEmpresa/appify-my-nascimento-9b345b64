-- =====================================================================
-- DIÁRIAS NO MÓDULO ENCARREGADOS — menu próprio (encarregados_diarias)
--
-- O PROBLEMA (relatado em 09/09/2026, com print do Gerenciamento de Acesso):
-- no /app/administracao?tab=modulos, a chave de Diárias só existia dentro do
-- bloco "Operacional". No bloco "Encarregados" ela não aparecia — e não
-- aparecia porque não havia NADA a mostrar: o item "Controle de Diárias" que
-- a sidebar desenha dentro de Encarregados apontava para a rota do Operacional
-- (/app/operacional/diarias), e a sidebar casa permissão por ROTA. Ou seja,
-- aquele item sempre foi governado por `operacional_diarias`, um menu de outro
-- módulo.
--
-- Isso deixava só uma saída para liberar Diárias a um encarregado: ligar
-- `operacional_diarias`. Só que aí o módulo OPERACIONAL INTEIRO brotava na
-- sidebar dele (Gestão Recrutamento, Solicitações de Demissão, Conferência de
-- Ponto, Mudança de Função), porque um módulo aparece assim que qualquer menu
-- seu é liberado. Não dá para "liberar Diárias sem liberar o Operacional"
-- quando os dois são a mesma linha de app_menu.
--
-- A SOLUÇÃO: um menu próprio no módulo Encarregados, com rota própria
-- (/app/encarregados/diarias) renderizando a MESMA tela (React reusa o
-- componente ControleDiarias, como já faz com os Chamados de Sistemas). A
-- chave passa a existir no bloco Encarregados; ligá-la mostra o item só ali; e
-- o módulo Operacional continua invisível para quem não tem menu nenhum dele.
--
-- A REGRA DE OURO, e o motivo de existir a função diaria_pode() abaixo:
-- `encarregados_diarias` concede VISUALIZAR e INCLUIR. NUNCA 'aprovar'.
-- Quem decide diária é o Operacional — o encarregado lança e acompanha. Isso
-- não é confiança no frontend: o toggle padrão da tela de acesso grava o
-- pacote inteiro (visualizar/incluir/alterar/aprovar/exportar, veja
-- ACOES_DO_TOGGLE_PADRAO em ModulosMenusTab.tsx), então a linha 'aprovar' VAI
-- existir em screen_permission_user para o encarregado. É diaria_pode() que a
-- torna inofensiva, recusando 'aprovar' por este menu independentemente do que
-- estiver gravado.
--
-- O QUE O ENCARREGADO VÊ NA LISTA: só as solicitações dele. Decisão do
-- 09/09/2026, e ela sai de graça — a policy diaria_solicitacao_select já é
-- `solicitante_id = auth.uid() OR can_access('operacional_diarias', ...)`, e
-- este arquivo NÃO a amplia de propósito. A trava anti-duplicidade de escala
-- continua íntegra porque roda em diaria_linha_valida() (SECURITY DEFINER),
-- que enxerga a base inteira mesmo para quem só vê as próprias linhas.
--
-- Backend do módulo em 20260930000019 (+ 33/35/36). Este arquivo só amplia os
-- gates de leitura e de criação; nada de aprovação é tocado.
-- =====================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────
--
-- ATENÇÃO À ORDEM: esta migration precisa estar aplicada ANTES de o frontend
-- novo subir. O menu `minhas_solicitações` do módulo Encarregados tem rota
-- '/app/encarregados', e matchMenuCode() casa por prefixo mais longo — sem a
-- linha abaixo, /app/encarregados/diarias cairia naquele menu e herdaria a
-- permissão errada.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT mo.id, 'encarregados_diarias', 'Controle de Diárias', '/app/encarregados/diarias',
       COALESCE((SELECT max(am.ordem) FROM public.app_menu am WHERE am.modulo_id = mo.id), 0) + 10
  FROM public.app_modulo mo
 WHERE mo.codigo = 'encarregados'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = 'encarregados_diarias');

-- can_access() devolve false para menu inativo ANTES de olhar perfil, e nem o
-- Administrador Geral escapa disso.
UPDATE public.app_menu SET ativo = true WHERE codigo = 'encarregados_diarias';

-- Sem linha em app_menu_acao de propósito: `operacional_diarias` também não
-- tem nenhuma, então a tela de acesso mostra só a chave principal nos dois
-- módulos — mesma cara, mesma leitura para quem administra.

-- ── 2) Seed de permissão ─────────────────────────────────────────────
--
-- Menu novo nasce SEM regra nenhuma, e desde o rewrite de 20260717200003 isso
-- significa invisível para todo mundo (não existe mais o ramo "ninguém
-- configurou => aberto" no nível de rota). Perfis concede_tudo passam pelo
-- ramo 2 de has_screen_access() e não precisam de linha; o perfil de módulo
-- "Encarregados" precisa.
--
-- 'aprovar' fica de fora — ver a regra de ouro no cabeçalho.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'encarregados_diarias', v.acao::public.app_acao, true
  FROM public.perfil_acesso pa
  JOIN (VALUES ('visualizar'), ('incluir')) AS v(acao) ON true
 WHERE pa.nome = 'Encarregados' AND pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 3) O gate único ──────────────────────────────────────────────────
--
-- Toda trava de diária passava por can_access(..., 'operacional_diarias', X)
-- espalhado em 9 lugares. Centralizar aqui evita que alguém amplie um deles e
-- esqueça o "menos aprovar" — a exceção mora num lugar só. Mesmo desenho de
-- ti_pode() (20260930000060) e trn_pode_ver() (20260930000054).
CREATE OR REPLACE FUNCTION public.diaria_pode(_acao public.app_acao)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.can_access(auth.uid(), 'operacional_diarias', _acao)
      OR ( _acao <> 'aprovar'::public.app_acao
           AND public.can_access(auth.uid(), 'encarregados_diarias', _acao) );
$$;
REVOKE ALL ON FUNCTION public.diaria_pode(public.app_acao) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_pode(public.app_acao) TO authenticated;

-- ── 4) Policies ──────────────────────────────────────────────────────
--
-- NÃO tocadas, e o porquê de cada uma:
--
--   diaria_solicitacao_select — é o que mantém "o encarregado vê só as dele".
--     Ampliar aqui abriria CPF, PIX e valores de todos os contratos.
--   diaria_solicitacao_update — o dono já entra pelo primeiro ramo enquanto
--     status = 'solicitada'; o segundo ramo é do aprovador e continua exigindo
--     'operacional_diarias'/'aprovar'.
--   DIARIA_LINHA / DIARIA_ANEXO / DIARIA_EVENTO — todas por dono ou por EXISTS
--     na solicitação-mãe, que reaplica a policy de SELECT dela.
--   diaria_guard() (20260930000036) e diaria_aprovar_com_despesa()
--     (20260930000035) — a decisão continua exclusiva do Operacional. O
--     encarregado cai no ramo "Você não tem permissão para decidir esta
--     solicitação", que é o comportamento correto.
--
-- Postgres não tem CREATE OR REPLACE POLICY: DROP + CREATE, idempotente.
DROP POLICY IF EXISTS diaria_solicitacao_insert ON public."DIARIA_SOLICITACAO";
CREATE POLICY diaria_solicitacao_insert ON public."DIARIA_SOLICITACAO"
  FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = auth.uid()
    AND public.diaria_pode('incluir')
  );

DROP POLICY IF EXISTS "diaria anexo select" ON storage.objects;
CREATE POLICY "diaria anexo select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'diarias'
    AND public.diaria_pode('visualizar')
  );

DROP POLICY IF EXISTS "diaria anexo insert" ON storage.objects;
CREATE POLICY "diaria anexo insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'diarias'
    AND public.diaria_pode('incluir')
  );

-- Trocar o arquivo errado antes de enviar faz parte do fluxo.
DROP POLICY IF EXISTS "diaria anexo delete" ON storage.objects;
CREATE POLICY "diaria anexo delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'diarias'
    AND owner = auth.uid()
    AND public.diaria_pode('incluir')
  );

-- ── 5) RPCs ──────────────────────────────────────────────────────────
--
-- Corpos idênticos aos de 20260930000019 (e, no caso de
-- diaria_empresa_contrato, ao de 20260930000033). Muda SÓ a linha do gate.
-- Sem estas quatro, a tela abriria para o encarregado com os dropdowns de
-- contrato, posto e pessoa todos vazios — e o "Salvar" recusado.

-- 5.1) Busca de empregado para Faltante e Diarista.
CREATE OR REPLACE FUNCTION public.diaria_buscar_empregados(p_termo text)
RETURNS TABLE (
  empregado_id bigint,
  nome         text,
  cpf          text,
  cargo        text,
  situacao     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_q      text   := btrim(coalesce(p_termo, ''));
  v_digits text   := regexp_replace(v_q, '\D', '', 'g');
  v_tokens text[];
  v_bloq   text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
BEGIN
  IF NOT public.diaria_pode('visualizar') THEN
    RETURN;  -- sem a tela liberada → sem resultados
  END IF;
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  v_tokens := ARRAY(
    SELECT regexp_replace(lower(unaccent_safe(w)), '[^a-z0-9]+', '', 'g')
      FROM regexp_split_to_table(v_q, '\s+') AS w
  );

  RETURN QUERY
  SELECT e."ID", e."Nome", e."CPF", e."Título do Cargo", e."Situação"
    FROM public."EMPREGADOS" e
   WHERE upper(coalesce(e."Situação", '')) <> ALL (v_bloq)
     AND coalesce(e."Nome", '') NOT ILIKE '%teste%'
     AND (
       ( EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE t <> '')
         AND NOT EXISTS (
           SELECT 1 FROM unnest(v_tokens) t
            WHERE t <> ''
              AND regexp_replace(lower(unaccent_safe(coalesce(e."Nome", ''))), '[^a-z0-9]+', '', 'g')
                  NOT LIKE '%' || t || '%'
         )
       )
       OR ( length(v_digits) >= 3
            AND regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g') LIKE '%' || v_digits || '%' )
     )
   ORDER BY e."Nome"
   LIMIT 30;
END $$;
REVOKE ALL ON FUNCTION public.diaria_buscar_empregados(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_buscar_empregados(text) TO authenticated;

-- 5.2) Contratos e postos do dropdown.
CREATE OR REPLACE FUNCTION public.diaria_contratos()
RETURNS TABLE (
  contrato_id uuid,
  nome        text,
  cliente     text,
  empresa     text,
  status      text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.nome, c.cliente,
         COALESCE(e.nome_fantasia, e.razao_social), c.status
    FROM public.contratos c
    LEFT JOIN public.empresas e ON e.id = c.empresa_id
   WHERE public.diaria_pode('visualizar')
     AND c.status = 'ativo'
   ORDER BY c.nome;
$$;
REVOKE ALL ON FUNCTION public.diaria_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_contratos() TO authenticated;

CREATE OR REPLACE FUNCTION public.diaria_postos(p_contrato_id uuid)
RETURNS TABLE (
  posto_id uuid,
  nome     text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.nome
    FROM public.sup_posto p
   WHERE public.diaria_pode('visualizar')
     AND p.contrato_id = p_contrato_id
     AND p.ativo = true
     AND p.aprovado = true
   ORDER BY p.nome;
$$;
REVOKE ALL ON FUNCTION public.diaria_postos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_postos(uuid) TO authenticated;

-- 5.3) Empresa do contrato (alimenta o painel de rateio do Malote na
-- aprovação). O encarregado não aprova, mas o modal chama esta RPC ao abrir
-- uma solicitação já existente — sem o gate ampliado ela devolveria NULL para
-- o dono olhando a própria diária. É leitura de um único id de empresa.
CREATE OR REPLACE FUNCTION public.diaria_empresa_contrato(p_contrato_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.empresa_id
    FROM public.contratos c
   WHERE c.id = p_contrato_id
     AND public.diaria_pode('visualizar');
$$;
REVOKE ALL ON FUNCTION public.diaria_empresa_contrato(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.diaria_empresa_contrato(uuid) TO authenticated;

-- 5.4) Criação da solicitação inteira numa transação só.
CREATE OR REPLACE FUNCTION public.diaria_criar_solicitacao(p_dados jsonb)
RETURNS TABLE (id uuid, numero text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id      uuid := COALESCE((p_dados->>'id')::uuid, gen_random_uuid());
  v_numero  text;
  v_nome    text;
  v_empresa_nome text;
  v_contrato public.contratos%ROWTYPE;
  v_posto    public.sup_posto%ROWTYPE;
  v_faltante_id bigint := NULLIF(p_dados->>'faltante_empregado_id', '')::bigint;
  v_diarista_id bigint := NULLIF(p_dados->>'diarista_empregado_id', '')::bigint;
  v_faltante_nome text := btrim(coalesce(p_dados->>'faltante_nome', ''));
  v_faltante_cpf  text := btrim(coalesce(p_dados->>'faltante_cpf', ''));
  v_diarista_nome text := btrim(coalesce(p_dados->>'diarista_nome', ''));
  v_diarista_cpf  text := btrim(coalesce(p_dados->>'diarista_cpf', ''));
  n_ponto   int;
  n_doc     int;
BEGIN
  IF NOT public.diaria_pode('incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para lançar diárias.';
  END IF;

  IF jsonb_array_length(COALESCE(p_dados->'diarias', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma diária.';
  END IF;

  SELECT * INTO v_contrato
    FROM public.contratos c
   WHERE c.id = (p_dados->>'contrato_id')::uuid
     AND c.status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato ativo não encontrado.';
  END IF;
  SELECT COALESCE(e.nome_fantasia, e.razao_social) INTO v_empresa_nome
    FROM public.empresas e WHERE e.id = v_contrato.empresa_id;

  SELECT * INTO v_posto
    FROM public.sup_posto p
   WHERE p.id = NULLIF(p_dados->>'posto_id', '')::uuid
     AND p.contrato_id = v_contrato.id
     AND p.ativo = true
     AND p.aprovado = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posto ativo e aprovado não encontrado neste contrato.';
  END IF;

  -- Quando a pessoa veio do dropdown, nome e CPF saem de EMPREGADOS no
  -- servidor. O cliente não consegue trocar o CPF mantendo o mesmo id.
  IF v_faltante_id IS NOT NULL THEN
    SELECT e."Nome", e."CPF" INTO v_faltante_nome, v_faltante_cpf
      FROM public."EMPREGADOS" e WHERE e."ID" = v_faltante_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Faltante não encontrado em EMPREGADOS.'; END IF;
  END IF;
  IF v_diarista_id IS NOT NULL THEN
    SELECT e."Nome", e."CPF" INTO v_diarista_nome, v_diarista_cpf
      FROM public."EMPREGADOS" e WHERE e."ID" = v_diarista_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Diarista não encontrado em EMPREGADOS.'; END IF;
  END IF;

  IF v_faltante_nome = '' OR length(regexp_replace(v_faltante_cpf, '\D', '', 'g')) <> 11 THEN
    RAISE EXCEPTION 'Informe nome e CPF válido do faltante.';
  END IF;
  IF v_diarista_nome = '' OR length(regexp_replace(v_diarista_cpf, '\D', '', 'g')) <> 11 THEN
    RAISE EXCEPTION 'Informe nome e CPF válido do diarista.';
  END IF;
  IF regexp_replace(v_faltante_cpf, '\D', '', 'g') = regexp_replace(v_diarista_cpf, '\D', '', 'g') THEN
    RAISE EXCEPTION 'Faltante e diarista precisam ser pessoas diferentes.';
  END IF;
  IF btrim(coalesce(p_dados->>'pix', '')) = '' THEN
    RAISE EXCEPTION 'Informe a chave Pix do diarista.';
  END IF;

  -- Os dois anexos são obrigatórios na tela; aqui é onde a regra vale mesmo.
  SELECT count(*) FILTER (WHERE a->>'categoria' = 'comprovante_ponto'),
         count(*) FILTER (WHERE a->>'categoria' = 'documento')
    INTO n_ponto, n_doc
    FROM jsonb_array_elements(COALESCE(p_dados->'anexos', '[]'::jsonb)) a;
  IF n_ponto = 0 OR n_doc = 0 THEN
    RAISE EXCEPTION 'Anexe o comprovante do ponto e ao menos um documento.';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(p_dados->'anexos', '[]'::jsonb)) a
     WHERE coalesce(a->>'categoria', '') NOT IN ('comprovante_ponto', 'documento')
        OR coalesce(a->>'storage_path', '') NOT LIKE
             v_id::text || '/' || (a->>'categoria') || '/%'
        OR coalesce(a->>'nome_arquivo', '') = ''
        OR NOT CASE
             WHEN coalesce(a->>'tamanho_bytes', '') ~ '^[0-9]+$'
             THEN (a->>'tamanho_bytes')::bigint BETWEEN 1 AND 10485760
             ELSE false
           END
  ) THEN
    RAISE EXCEPTION 'Metadados de anexo inválidos.';
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."DIARIA_SOLICITACAO" (
    id, contrato_id, contrato_nome, contrato_cliente, contrato_empresa, posto_id, posto_nome,
    faltante_empregado_id, faltante_nome, faltante_cpf,
    diarista_empregado_id, diarista_nome, diarista_cpf, pix,
    observacoes, solicitante_id, solicitante_nome
  ) VALUES (
    v_id,
    v_contrato.id, v_contrato.nome, v_contrato.cliente, v_empresa_nome,
    v_posto.id, v_posto.nome,
    v_faltante_id, v_faltante_nome, v_faltante_cpf,
    v_diarista_id, v_diarista_nome, v_diarista_cpf,
    btrim(p_dados->>'pix'),
    NULLIF(p_dados->>'observacoes', ''),
    auth.uid(), v_nome
  )
  RETURNING "DIARIA_SOLICITACAO".numero INTO v_numero;

  INSERT INTO public."DIARIA_LINHA" (
    solicitacao_id, data, turno, qt_vt, valor_unit_vt_centavos, valor_diaria_centavos
  )
  SELECT v_id, (d->>'data')::date, d->>'turno',
         COALESCE((d->>'qt_vt')::int, 0),
         COALESCE((d->>'valor_unit_vt_centavos')::bigint, 0),
         COALESCE((d->>'valor_diaria_centavos')::bigint, 0)
    FROM jsonb_array_elements(p_dados->'diarias') d;

  INSERT INTO public."DIARIA_ANEXO" (
    solicitacao_id, categoria, storage_path, nome_arquivo, mime_type, tamanho_bytes
  )
  SELECT v_id, a->>'categoria', a->>'storage_path', a->>'nome_arquivo',
         NULLIF(a->>'mime_type', ''), NULLIF(a->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(p_dados->'anexos') a;

  RETURN QUERY SELECT v_id, v_numero;
END $$;
REVOKE ALL ON FUNCTION public.diaria_criar_solicitacao(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_criar_solicitacao(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- -- 1) Devolver as travas ao gate antigo. As RPCs precisam ser recriadas com
-- --    os corpos de 20260930000019 (e 20260930000033 para
-- --    diaria_empresa_contrato), trocando diaria_pode(X) de volta por
-- --    can_access(auth.uid(), 'operacional_diarias', X).
-- DROP POLICY IF EXISTS diaria_solicitacao_insert ON public."DIARIA_SOLICITACAO";
-- CREATE POLICY diaria_solicitacao_insert ON public."DIARIA_SOLICITACAO"
--   FOR INSERT TO authenticated
--   WITH CHECK (solicitante_id = auth.uid()
--               AND public.can_access(auth.uid(), 'operacional_diarias', 'incluir'));
-- DROP POLICY IF EXISTS "diaria anexo select" ON storage.objects;
-- CREATE POLICY "diaria anexo select" ON storage.objects
--   FOR SELECT TO authenticated
--   USING (bucket_id = 'diarias'
--          AND public.can_access(auth.uid(), 'operacional_diarias', 'visualizar'));
-- DROP POLICY IF EXISTS "diaria anexo insert" ON storage.objects;
-- CREATE POLICY "diaria anexo insert" ON storage.objects
--   FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'diarias'
--               AND public.can_access(auth.uid(), 'operacional_diarias', 'incluir'));
-- DROP POLICY IF EXISTS "diaria anexo delete" ON storage.objects;
-- CREATE POLICY "diaria anexo delete" ON storage.objects
--   FOR DELETE TO authenticated
--   USING (bucket_id = 'diarias' AND owner = auth.uid()
--          AND public.can_access(auth.uid(), 'operacional_diarias', 'incluir'));
--
-- -- 2) Só então a função pode cair (as policies acima dependem dela).
-- DROP FUNCTION IF EXISTS public.diaria_pode(public.app_acao);
--
-- -- 3) Permissões e menu.
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'encarregados_diarias';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'encarregados_diarias';
-- DELETE FROM public.app_menu                WHERE codigo      = 'encarregados_diarias';
-- NOTIFY pgrst, 'reload schema';
