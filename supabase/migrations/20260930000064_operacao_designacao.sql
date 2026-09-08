-- =====================================================================
-- OPERAÇÃO — quem responde por cada contrato (designação, com vigência)
--
-- A PERGUNTA QUE ORIGINOU ISTO
--
--   "Se eu precisar trocar um supervisor de contrato, ou adicionar um
--    encarregado num posto, onde faço? E se essa pessoa for demitida ou
--    mudar de função, como fica?"
--
--   A resposta honesta, até esta migration, era: NÃO TEM ONDE. E a árvore do
--   Espaço do Colaborador vinha derivando a chefia do "Título do Cargo", que
--   responde a pergunta errada.
--
-- ATRIBUTO ≠ DESIGNAÇÃO, e essa é a raiz do problema
--
--   Ser supervisor é um ATRIBUTO da pessoa — está no cargo dela.
--   Supervisionar o contrato X é uma DESIGNAÇÃO — é uma decisão da Operação,
--   que muda sem que nada mude no cadastro do RH.
--
--   Derivar do cargo responde "quem é supervisor" e NÃO responde "de qual
--   contrato". A prova veio da planilha da Operação (04/09/2026): são 4
--   supervisores para 77 frentes de trabalho. Derivando por cargo, a árvore
--   mostrava os 68 colaboradores com cargo de supervisão espalhados pelos
--   contratos onde estão LOTADOS — o Dickson responde por 19 frentes e está
--   lotado em uma. A árvore parecia um organograma e não era.
--
-- A TABELA MORTA QUE EU ESTAVA LENDO
--
--   A 052 pendurou o "encarregado designado" em `RH_CONTRATO_ENCARREGADO`.
--   Conferido agora: a tabela tem ZERO linhas, nenhuma tela escreve nela, e
--   o próprio App.tsx registra que "RH > Hierarquia" foi descontinuado em
--   jul/2026 e que ela "pode ser dropada". O campo "Encarregado do contrato"
--   da ficha nunca mostraria nada além de "—".
--
--   Esta migration substitui aquela leitura. A tabela antiga não é dropada
--   aqui: derrubar tabela de outro módulo não é efeito colateral aceitável
--   de uma migration desta feature.
--
-- POR QUE VIGÊNCIA, E NÃO UM CAMPO QUE SE SOBRESCREVE
--
--   Sem `vigente_de`/`vigente_ate`, trocar o supervisor APAGA quem respondia
--   antes. E a pergunta "quem respondia por este contrato em março?" aparece
--   exatamente quando algo deu errado em março — que é o pior momento para
--   descobrir que o dado foi sobrescrito.
--
--   Trocar passa a ser: fecha a linha atual (`vigente_ate = hoje`) e abre uma
--   nova. O histórico fica inteiro, de graça.
--
-- POSTO É OPCIONAL, E É ISSO QUE COBRE OS DOIS PEDIDOS
--
--   `posto IS NULL`  → designação do CONTRATO inteiro (o caso do supervisor).
--   `posto` preenchido → designação de UM POSTO (o caso do encarregado, que
--                        é o "quais postos cada encarregado cuida" do fluxo
--                        que a Operação descreveu).
--
--   O índice único parcial garante UMA designação viva por
--   (contrato, papel, posto) — sem ele, dois supervisores vivos no mesmo
--   contrato passariam despercebidos até alguém estranhar a árvore.
--
-- O QUE ISTO NÃO RESOLVE (e é honesto dizer)
--
--   A Operação chama as coisas por FRENTE DE TRABALHO ("UFRGS JARDINAGEM
--   VALE"), que é mais fina que contrato e mais grossa que posto. As 77
--   frentes da planilha colapsam em 47 contratos, e hoje isso não perde
--   informação porque nenhuma frente do mesmo contrato tem supervisor
--   diferente — foi conferido. No dia em que tiver, "frente" precisa virar
--   entidade, e aí é uma conversa maior que uma tabela de designação.
-- =====================================================================


-- ── 1. A tabela ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operacao_designacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresas(id)  ON DELETE CASCADE,
  contrato_id    uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,

  papel          text NOT NULL CHECK (papel IN ('supervisor', 'encarregado')),
  -- NULL = o contrato inteiro. Preenchido = um posto dele.
  posto          text,

  -- EMPREGADOS."ID". Sem FK de propósito: EMPREGADOS é espelho do Senior e
  -- não tem PK estável para referenciar (o mesmo motivo pelo qual
  -- sup_pedido.colaborador_empregado_id também é bigint solto).
  empregado_id   bigint NOT NULL,
  empregado_nome text,

  vigente_de     date NOT NULL DEFAULT current_date,
  vigente_ate    date,

  obs            text,
  criado_por     uuid DEFAULT auth.uid(),
  criado_por_nome text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT operacao_designacao_vigencia_coerente
    CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_de)
);

-- Uma designação VIVA por (contrato, papel, posto). `COALESCE(posto,'')`
-- porque NULL nunca é igual a NULL num índice único — sem isso, dois
-- supervisores vivos do mesmo contrato entrariam sem reclamação.
CREATE UNIQUE INDEX IF NOT EXISTS operacao_designacao_viva_unica
  ON public.operacao_designacao (contrato_id, papel, COALESCE(posto, ''))
  WHERE vigente_ate IS NULL;

CREATE INDEX IF NOT EXISTS operacao_designacao_contrato
  ON public.operacao_designacao (contrato_id) WHERE vigente_ate IS NULL;

CREATE INDEX IF NOT EXISTS operacao_designacao_empregado
  ON public.operacao_designacao (empregado_id) WHERE vigente_ate IS NULL;


-- ── 2. Acesso ────────────────────────────────────────────────────────
--
-- Reusa o menu do Espaço do Colaborador: LER é quem já vê a árvore
-- ('visualizar'); ESCREVER exige 'alterar' no mesmo menu. Assim a Operação
-- ganha o direito de designar sem que todo mundo que consulta a árvore
-- possa mexer — e sem criar um menu novo para uma tela que é continuação
-- daquela.
ALTER TABLE public.operacao_designacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operacao_designacao FROM public, anon;
GRANT SELECT, INSERT, UPDATE ON public.operacao_designacao TO authenticated;

DROP POLICY IF EXISTS operacao_designacao_select ON public.operacao_designacao;
CREATE POLICY operacao_designacao_select ON public.operacao_designacao
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'central_servicos_espaco_colaborador', 'visualizar'::app_acao));

DROP POLICY IF EXISTS operacao_designacao_insert ON public.operacao_designacao;
CREATE POLICY operacao_designacao_insert ON public.operacao_designacao
  FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'central_servicos_espaco_colaborador', 'alterar'::app_acao));

DROP POLICY IF EXISTS operacao_designacao_update ON public.operacao_designacao;
CREATE POLICY operacao_designacao_update ON public.operacao_designacao
  FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'central_servicos_espaco_colaborador', 'alterar'::app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'central_servicos_espaco_colaborador', 'alterar'::app_acao));

-- Sem policy de DELETE, de propósito: designação não se apaga, se encerra
-- (`vigente_ate`). Apagar destruiria o histórico que é a razão da tabela.


-- ── 3. Ler as designações vivas ──────────────────────────────────────
--
-- Devolve `pessoa_ativa`, e é essa coluna que responde a pergunta "e se o
-- supervisor for demitido?": a designação continua, mas a tela passa a
-- alertar em vez de mostrar um nome que não trabalha mais aqui. Sumir com
-- ela em silêncio seria repetir o erro que deixou 435 pessoas invisíveis.
CREATE OR REPLACE FUNCTION public.esp_col_designacoes(p_contrato_id uuid DEFAULT NULL)
RETURNS TABLE (
  id             uuid,
  contrato_id    uuid,
  contrato_nome  text,
  papel          text,
  posto          text,
  empregado_id   bigint,
  empregado_nome text,
  cargo          text,
  situacao       text,
  pessoa_ativa   boolean,
  vigente_de     date,
  obs            text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.esp_col_exige_acesso();
  RETURN QUERY
  SELECT d.id, d.contrato_id, c.nome, d.papel, d.posto,
         d.empregado_id, COALESCE(e."Nome", d.empregado_nome),
         e."Título do Cargo", e."Situação",
         COALESCE(public.esp_col_esta_ativo(e."Situação"), false),
         d.vigente_de, d.obs
    FROM public.operacao_designacao d
    JOIN public.contratos c ON c.id = d.contrato_id
    LEFT JOIN public."EMPREGADOS" e ON e."ID" = d.empregado_id
   WHERE d.vigente_ate IS NULL
     AND (p_contrato_id IS NULL OR d.contrato_id = p_contrato_id)
   ORDER BY c.nome, d.papel, d.posto NULLS FIRST;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_designacoes(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_designacoes(uuid) TO authenticated;


-- ── 4. Designar / trocar / encerrar ──────────────────────────────────
--
-- Uma função só para os três casos, porque os três são a mesma operação:
-- fecha a vigência atual e, se veio alguém, abre a nova. Fazer isso na tela
-- exigiria duas chamadas, e entre uma e outra o contrato ficaria sem
-- designação — ou com duas, se a segunda falhasse.
--
-- `p_empregado_id NULL` = só encerrar (o contrato passa a não ter ninguém).
CREATE OR REPLACE FUNCTION public.esp_col_designar(
  p_contrato_id  uuid,
  p_papel        text,
  p_empregado_id bigint DEFAULT NULL,
  p_posto        text   DEFAULT NULL,
  p_obs          text   DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_emp   uuid;
  v_nome  text;
  v_quem  text;
  v_novo  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  -- ALTERAR, não visualizar: designar é escrita.
  IF NOT public.has_screen_access(v_uid, 'central_servicos_espaco_colaborador', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para designar responsáveis' USING ERRCODE = '42501';
  END IF;
  IF p_papel NOT IN ('supervisor', 'encarregado') THEN
    RAISE EXCEPTION 'Papel inválido: %', p_papel USING ERRCODE = '22023';
  END IF;

  SELECT c.empresa_id INTO v_emp FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado' USING ERRCODE = '23503';
  END IF;

  -- Fecha a vigência atual (se houver). `vigente_ate = current_date` e não
  -- ontem: a troca vale a partir de hoje, e ler "de 01/03 a 04/09" é mais
  -- natural para quem consulta do que uma data que não é a do evento.
  UPDATE public.operacao_designacao
     SET vigente_ate = current_date
   WHERE contrato_id = p_contrato_id
     AND papel = p_papel
     AND COALESCE(posto, '') = COALESCE(p_posto, '')
     AND vigente_ate IS NULL;

  IF p_empregado_id IS NULL THEN
    RETURN NULL;      -- só encerrou
  END IF;

  SELECT e."Nome" INTO v_nome FROM public."EMPREGADOS" e WHERE e."ID" = p_empregado_id;
  SELECT p.display_name INTO v_quem FROM public.profiles p WHERE p.id = v_uid;

  INSERT INTO public.operacao_designacao
    (empresa_id, contrato_id, papel, posto, empregado_id, empregado_nome, obs, criado_por, criado_por_nome)
  VALUES (v_emp, p_contrato_id, p_papel, nullif(btrim(p_posto), ''), p_empregado_id, v_nome, p_obs, v_uid, v_quem)
  RETURNING id INTO v_novo;

  RETURN v_novo;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_designar(uuid, text, bigint, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_designar(uuid, text, bigint, text, text) TO authenticated;


-- ── 5. Carga inicial: os 47 supervisores ─────────────────────────────
--
-- Da planilha revisada à mão pela Operação (SUPERVISORES-PARA-CONFERIR-
-- OFICIAL.xlsx, 04/09/2026). As 77 frentes colapsam em 47 contratos, sem
-- nenhum conflito de supervisor — conferido antes de gerar isto.
--
-- Ficaram de fora, de propósito:
--   • IRGA — o contrato ainda não existe em `contratos` (está só em
--     implantacao_contrato). Entra quando a licitação criar.
--   • EMBRAPA PELOTAS — a planilha aponta para o contrato de CANOINHAS, que
--     já é de outro supervisor. Canoinhas é SC, Pelotas é RS. Escolher por
--     conta própria colocaria supervisor no contrato errado.
--
-- `vigente_de` = 2026-09-04 (a data da revisão), não a data em que a
-- migration for aplicada: é quando a informação passou a ser verdade.
INSERT INTO public.operacao_designacao
  (empresa_id, contrato_id, papel, empregado_id, empregado_nome, vigente_de, obs)
SELECT ct.empresa_id, ct.id, 'supervisor', e."ID", e."Nome", DATE '2026-09-04',
       'Carga inicial — planilha revisada pela Operação em 04/09/2026.'
  FROM (VALUES
    ('BENTO GONÇALVES - AUX ADM - 002/2021', 'DICKSON SCHUBERT FLORES'),
    ('BENTO GONÇALVES LIMPEZA - 048/2026', 'DICKSON SCHUBERT FLORES'),
    ('CAMARA DE RIO GRANDE - LIMPEZA 001/2023', 'DICKSON SCHUBERT FLORES'),
    ('CAMARA DE RIO GRANDE - PORTARIA 002/2023', 'DICKSON SCHUBERT FLORES'),
    ('CANAA', 'DICKSON SCHUBERT FLORES'),
    ('CAXIAS DO SUL - 2026/95', 'DICKSON SCHUBERT FLORES'),
    ('CEITEC LIMPEZA - 025/2026', 'GUSTAVO BARCELOS BRAGA'),
    ('CHARQUEADAS - 005/2021', 'DICKSON SCHUBERT FLORES'),
    ('CHARQUEADAS - 168/2021', 'DICKSON SCHUBERT FLORES'),
    ('CHARQUEADAS - 249 /2020', 'DICKSON SCHUBERT FLORES'),
    ('DMAE - 895/0', 'CARLOS JOSE FERGUTZ NETO'),
    ('EMBRAPA - CANOINHA - 47/2024', 'ISMAEL KUHL LOPES'),
    ('FUNARBE PELOTAS - 58164/2025', 'DICKSON SCHUBERT FLORES'),
    ('FURG - PORTARIA - 55/2023', 'DICKSON SCHUBERT FLORES'),
    ('FURG HU - 006/2023', 'DICKSON SCHUBERT FLORES'),
    ('FURG JARDINAGEM  - 049/2022', 'DICKSON SCHUBERT FLORES'),
    ('GUAPORÉ LIMPEZA SMED EMERGENCIAL - 063/2026', 'DICKSON SCHUBERT FLORES'),
    ('HCPA - MENSAGEIROS - 1249781/2024', 'CARLOS JOSE FERGUTZ NETO'),
    ('HCPA - MENSAGEIROS - 1346659/2024', 'CARLOS JOSE FERGUTZ NETO'),
    ('HCPA - MENSAGEIROS - 1610628.2025', 'CARLOS JOSE FERGUTZ NETO'),
    ('HOSPITAL SÃO CAMILO - 50163.2025', 'GUSTAVO BARCELOS BRAGA'),
    ('HUSM LAVANDERIA EMERGENCIAL - 039/2026', 'ISMAEL KUHL LOPES'),
    ('IPAM - 012/2022', 'DICKSON SCHUBERT FLORES'),
    ('IPASEM - 13/2022', 'GUSTAVO BARCELOS BRAGA'),
    ('PENHA LIMPEZA - 039/2025', 'ISMAEL KUHL LOPES'),
    ('POLÍCIA CIVIL RS LIMPEZA - 066/2026', 'GUSTAVO BARCELOS BRAGA'),
    ('PREF POA SMS RECEPÇÃO - 98672/2025', 'GUSTAVO BARCELOS BRAGA'),
    ('SALTO DO JACUI - 722/2021', 'ISMAEL KUHL LOPES'),
    ('SAMU TELEFONISTAS - 96397/2025', 'GUSTAVO BARCELOS BRAGA'),
    ('SECRETARIA DA CULTURA POA - PORTARIA - 88123/2024', 'GUSTAVO BARCELOS BRAGA'),
    ('SEMAE - 3038/2020', 'GUSTAVO BARCELOS BRAGA'),
    ('TJRS - 023/2025', 'GUSTAVO BARCELOS BRAGA'),
    ('TRIUNFO MOTORISTAS - 213.2025', 'DICKSON SCHUBERT FLORES'),
    ('TRIUNFO VIGIAS - 33/2024', 'DICKSON SCHUBERT FLORES'),
    ('UFFS CERRO LARGO - 041/2021', 'ISMAEL KUHL LOPES'),
    ('UFFS CHAPECO - 041/2021', 'ISMAEL KUHL LOPES'),
    ('UFFS ERECHIM - 041/2021', 'ISMAEL KUHL LOPES'),
    ('UFFS PASSO FUNDO - 041/2021', 'ISMAEL KUHL LOPES'),
    ('UFFS REALEZA - 041/2021', 'ISMAEL KUHL LOPES'),
    ('UFRGS - CARREGADORES - 095/2024', 'CARLOS JOSE FERGUTZ NETO'),
    ('UFRGS - COPA E COZINHA - 025/2025', 'CARLOS JOSE FERGUTZ NETO'),
    ('UFRGS - JARDINAGEM - 062/2025', 'CARLOS JOSE FERGUTZ NETO'),
    ('UFRGS - LIMPEZA - 020/2022', 'CARLOS JOSE FERGUTZ NETO'),
    ('UFRGS - MOTORISTAS - 034/2022', 'CARLOS JOSE FERGUTZ NETO'),
    ('UFRGS AUXILIAR DE SAUDE BUCAL - 030/2026', 'CARLOS JOSE FERGUTZ NETO'),
    ('UFRGS INTERPRETE DE LIBRAS C. 009.2026', 'CARLOS JOSE FERGUTZ NETO'),
    ('VERANOPOLIS   -  001/2021', 'DICKSON SCHUBERT FLORES')  ) AS v(contrato_nome, supervisor)
  JOIN public.contratos ct ON ct.nome = v.contrato_nome
  -- LATERAL com LIMIT 1: há homônimos em EMPREGADOS, e sem o limite um nome
  -- repetido geraria duas designações vivas para o mesmo contrato — que o
  -- índice único barraria, derrubando a carga inteira por causa de um caso.
  JOIN LATERAL (
    SELECT e."ID", e."Nome"
      FROM public."EMPREGADOS" e
     WHERE e."Nome" = v.supervisor
       AND public.esp_col_esta_ativo(e."Situação")
     ORDER BY e."ID"
     LIMIT 1
  ) e ON true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.operacao_designacao d
    WHERE d.contrato_id = ct.id
      AND d.papel = 'supervisor'
      AND d.posto IS NULL
      AND d.vigente_ate IS NULL
 );


-- ── 6. A árvore passa a ler a designação REAL ────────────────────────
--
-- Troca a leitura de `RH_CONTRATO_ENCARREGADO` (vazia, sem tela, módulo
-- descontinuado em jul/2026) pela `operacao_designacao`. E agora devolve os
-- DOIS papéis, cada um com `pessoa_ativa`: é assim que a tela consegue
-- dizer "este contrato está com supervisor demitido" em vez de simplesmente
-- deixar de mostrar o nome.
CREATE OR REPLACE FUNCTION public.esp_col_arvore()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.esp_col_exige_acesso();

  WITH ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.sup_norm_nome(c.nome))
           public.sup_norm_nome(c.nome) AS nome_norm, c.id
      FROM public.contratos c
     ORDER BY public.sup_norm_nome(c.nome), c.nome
  ),
  pessoas AS MATERIALIZED (
    SELECT COALESCE(ctl.id, dp.contrato_id, ctf.id) AS contrato_id
      FROM public."EMPREGADOS" e
      LEFT JOIN ct ctl
             ON COALESCE(btrim(e."Descrição do Local"), '') <> ''
            AND ctl.nome_norm = public.sup_norm_nome(e."Descrição do Local")
      LEFT JOIN public.sup_empregado_contrato_depara dp
             ON dp.filial_nome = e."Nome Filial"
      LEFT JOIN ct ctf
             ON COALESCE(btrim(e."Nome Filial"), '') <> ''
            AND ctf.nome_norm = public.sup_norm_nome(e."Nome Filial")
     WHERE public.esp_col_esta_ativo(e."Situação")
       AND COALESCE(btrim(e."Nome"), '') <> ''
  ),
  totais AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE p.contrato_id IS NULL)::int AS sem
      FROM pessoas p
  ),
  cont_qtd AS (
    SELECT p.contrato_id, count(*)::int AS qtd
      FROM pessoas p WHERE p.contrato_id IS NOT NULL GROUP BY p.contrato_id
  ),
  posto_vivo AS (
    SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto))
           pc.id, pc.contrato_id, btrim(pc.posto) AS posto, pc.servico,
           pc.qt_postos, pc.data_vigencia
      FROM public.planilha_custo pc
     WHERE pc.contrato_id IS NOT NULL
       AND pc.orexec = 'EXECUTADO'
       AND NOT COALESCE(pc.encerrado, false)
       AND pc.data_vigencia IS NOT NULL
       AND COALESCE(btrim(pc.posto), '') <> ''
     ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), pc.data_vigencia DESC
  ),
  posto_local AS (
    SELECT l.planilha_custo_id,
           jsonb_agg(jsonb_build_object(
             'id', l.id, 'nome', l.nome, 'municipio', l.municipio, 'uf', l.uf,
             'orcadas', l.qt_pessoas_orcadas, 'executadas', l.qt_pessoas_executadas)
             ORDER BY l.nome) AS itens
      FROM public.planilha_posto_localizacao l
     GROUP BY l.planilha_custo_id
  ),
  postos AS (
    SELECT pv.contrato_id,
           jsonb_agg(jsonb_build_object(
             'id', pv.id, 'nome', pv.posto, 'servico', pv.servico,
             'vagas', pv.qt_postos, 'vigencia', pv.data_vigencia,
             'locais', COALESCE(pl.itens, '[]'::jsonb))
             ORDER BY pv.posto) AS itens,
           count(*)::int                           AS qtd_postos,
           sum(COALESCE(pv.qt_postos, 0))::numeric AS vagas
      FROM posto_vivo pv
      LEFT JOIN posto_local pl ON pl.planilha_custo_id = pv.id
     GROUP BY pv.contrato_id
  ),
  desig AS (
    -- Uma linha por contrato+papel, já com o estado da pessoa.
    SELECT d.contrato_id, d.papel,
           jsonb_agg(jsonb_build_object(
             'id', d.empregado_id,
             'nome', COALESCE(em."Nome", d.empregado_nome),
             'posto', d.posto,
             'desde', d.vigente_de,
             'ativa', COALESCE(public.esp_col_esta_ativo(em."Situação"), false),
             'situacao', em."Situação")
             ORDER BY d.posto NULLS FIRST) AS itens
      FROM public.operacao_designacao d
      LEFT JOIN public."EMPREGADOS" em ON em."ID" = d.empregado_id
     WHERE d.vigente_ate IS NULL
     GROUP BY d.contrato_id, d.papel
  ),
  nos AS (
    SELECT c.nome AS ordem,
           COALESCE(cq.qtd, 0) AS qtd,
           COALESCE(c.status, 'ativo') = 'encerrado' AS encerrado,
           jsonb_build_object(
             'id', c.id, 'nome', c.nome, 'cliente', c.cliente, 'status', c.status,
             'encerrado',     COALESCE(c.status, 'ativo') = 'encerrado',
             'colaboradores', COALESCE(cq.qtd, 0),
             'qtd_postos',    COALESCE(pt.qtd_postos, 0),
             'vagas',         COALESCE(pt.vagas, 0),
             'supervisores',  COALESCE(ds.itens, '[]'::jsonb),
             'encarregados',  COALESCE(de.itens, '[]'::jsonb),
             'postos',        COALESCE(pt.itens, '[]'::jsonb)) AS no
      FROM public.contratos c
      LEFT JOIN postos   pt ON pt.contrato_id = c.id
      LEFT JOIN cont_qtd cq ON cq.contrato_id = c.id
      LEFT JOIN desig    ds ON ds.contrato_id = c.id AND ds.papel = 'supervisor'
      LEFT JOIN desig    de ON de.contrato_id = c.id AND de.papel = 'encarregado'
     WHERE COALESCE(c.status, 'ativo') <> 'encerrado'
        OR COALESCE(cq.qtd, 0) > 0
  ),
  agg AS (
    SELECT COALESCE(jsonb_agg(n.no ORDER BY n.ordem), '[]'::jsonb) AS contratos,
           COALESCE(count(*) FILTER (WHERE n.encerrado AND n.qtd > 0), 0)::int AS encerrados
      FROM nos n
  )
  SELECT jsonb_build_object(
           'contratos',            a.contratos,
           'sem_contrato',         t.sem,
           'total_ativos',         t.total,
           'encerrados_com_gente', a.encerrados)
    INTO v_out
    FROM agg a CROSS JOIN totais t;

  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.esp_col_arvore() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.esp_col_arvore() TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ── Conferência (nada aqui pode lançar) ──────────────────────────────
-- Espera: 47 designações vivas, distribuídas entre os 4 supervisores.
SELECT d.empregado_nome AS supervisor, count(*) AS contratos
  FROM public.operacao_designacao d
 WHERE d.vigente_ate IS NULL AND d.papel = 'supervisor'
 GROUP BY 1 ORDER BY 2 DESC;

-- Designação apontando para quem não está mais ativo. Hoje esperado ZERO;
-- é esta consulta que responde "e se o supervisor for demitido?".
SELECT c.nome AS contrato, d.empregado_nome, e."Situação"
  FROM public.operacao_designacao d
  JOIN public.contratos c ON c.id = d.contrato_id
  LEFT JOIN public."EMPREGADOS" e ON e."ID" = d.empregado_id
 WHERE d.vigente_ate IS NULL
   AND NOT COALESCE(public.esp_col_esta_ativo(e."Situação"), false)
 ORDER BY 1;

-- Contratos ativos SEM supervisor designado — a fila de trabalho da Operação.
SELECT c.nome
  FROM public.contratos c
 WHERE COALESCE(c.status, 'ativo') <> 'encerrado'
   AND NOT EXISTS (
     SELECT 1 FROM public.operacao_designacao d
      WHERE d.contrato_id = c.id AND d.papel = 'supervisor' AND d.vigente_ate IS NULL)
 ORDER BY 1;


-- =====================================================================
-- ROLLBACK
--   Reexecutar 20260930000058 devolve esp_col_arvore à versão anterior
--   (que lia RH_CONTRATO_ENCARREGADO). Depois:
--   DROP FUNCTION IF EXISTS public.esp_col_designar(uuid, text, bigint, text, text);
--   DROP FUNCTION IF EXISTS public.esp_col_designacoes(uuid);
--   DROP TABLE IF EXISTS public.operacao_designacao;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
