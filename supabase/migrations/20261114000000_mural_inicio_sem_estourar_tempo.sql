-- =========================================================================
-- [SEM-CHAMADO] MURAL DO INÍCIO SUMIU DEPOIS DE PUBLICAR SETEMBRO
--
-- O SINTOMA (12/11/2026, Pablo)
--   "quando eu recarrego a página não tá aparecendo o mural com os
--   comentários, antes tava aparecendo, mas quando publiquei os de setembro
--   deixou de aparecer, e os de outubro demorou pra aparecer também."
--   No navegador: POST /rpc/cs_form_mural_inicio levando ~8 s e voltando
--   500 — o statement_timeout. O cartão trata erro como "nada publicado" e
--   some (ReconhecimentoCard: isError → null).
--
-- A CAUSA
--   cs_form_mural_inicio (20261112210000) busca foto, cargo e setor de cada
--   recado com um LEFT JOIN LATERAL em "EMPREGADOS" por
--   upper(btrim("Nome")) — expressão sem índice. O LATERAL roda UMA VEZ POR
--   RECADO, e cada vez varre a tabela inteira de empregados (ativos e
--   demitidos). Com outubro (~320 recados) já ficava lento; somando setembro
--   (~240) passou do limite. Quanto mais meses publicados, pior.
--
-- A CORREÇÃO
--   Busca cada PESSOA uma vez só: os nomes distintos dos recados (~60) são
--   cruzados com "EMPREGADOS" num único join (hash), escolhendo o mesmo
--   registro de antes (não demitido primeiro, depois com login). O resto da
--   função — portão, 12 meses, formato do JSON, ordem — é o mesmo.
--   Não cria índice em "EMPREGADOS" (tabela quente do RH; CREATE INDEX
--   seguraria a escrita dela durante o deploy).
--
-- Idempotente (CREATE OR REPLACE da mesma assinatura). ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cs_form_mural_inicio()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje  timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_ini   timestamptz;
  v_fim   timestamptz;
  v_itens jsonb;
  v_meses jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  -- Do 1º dia de 11 meses atrás até o fim do mês corrente: 12 meses civis.
  v_ini := date_trunc('month', v_hoje - interval '11 months') AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (date_trunc('month', v_hoje) + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';

  WITH pub AS MATERIALIZED (
    SELECT l.*, m.status,
           to_char(l.enviado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS mes,
           upper(l.colaborador) AS nome_chave
      FROM public.cs_form_mural_linhas(NULL, v_ini, v_fim) l
      JOIN public."CS_FORM_MURAL_RECONHECIMENTO" m
        ON m.resposta_id = l.resposta_id AND m.pergunta_id = l.pergunta_id AND m.linha = l.linha
       AND m.status = 'liberado' AND m.assinatura = l.assinatura
     WHERE l.positivo
  ),
  -- Uma linha por pessoa reconhecida, com o mesmo desempate do LATERAL
  -- antigo: quem não está demitido primeiro, depois quem tem login.
  pessoa AS (
    SELECT DISTINCT ON (n.nome_chave)
           n.nome_chave, pr.avatar_url,
           nullif(btrim(coalesce(e."Título do Cargo", '')), '') AS cargo,
           nullif(btrim(coalesce(e."Setor_ERP", '')), '') AS setor
      FROM (SELECT DISTINCT nome_chave FROM pub) n
      JOIN public."EMPREGADOS" e ON upper(btrim(e."Nome")) = n.nome_chave
      LEFT JOIN public.profiles pr ON pr.id = e.auth_user_id
     ORDER BY n.nome_chave, (coalesce(e."Situação", '') ~* 'demitid'), (e.auth_user_id IS NULL)
  )
  SELECT jsonb_agg(jsonb_build_object(
           'chave', p.resposta_id::text || ':' || p.pergunta_id || ':' || p.linha,
           'mes', p.mes,
           'colaborador', p.colaborador, 'setor', coalesce(p.setor, c.setor),
           'cargo', c.cargo, 'avatar_url', c.avatar_url,
           'nota', p.nota, 'escala', p.escala, 'comentario', p.comentario,
           'formulario', p.formulario, 'enviado_em', p.enviado_em, 'status', p.status)
         ORDER BY p.mes DESC, p.enviado_em DESC, p.linha),
         (SELECT jsonb_agg(x.mes ORDER BY x.mes DESC) FROM (SELECT DISTINCT mes FROM pub) x)
    INTO v_itens, v_meses
    FROM pub p
    LEFT JOIN pessoa c ON c.nome_chave = p.nome_chave;

  RETURN jsonb_build_object(
    'mes', coalesce(v_meses->>0, to_char(date_trunc('month', v_hoje - interval '1 month'), 'YYYY-MM')),
    'meses', coalesce(v_meses, '[]'::jsonb),
    'itens', coalesce(v_itens, '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.cs_form_mural_inicio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_inicio() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (volta a lentidão; só se esta versão quebrar algo)
--   Reaplicar a seção 2 de 20261112210000 (cs_form_mural_inicio com o
--   LEFT JOIN LATERAL por recado).
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
