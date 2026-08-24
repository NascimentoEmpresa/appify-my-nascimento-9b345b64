-- =========================================================================
-- Recrutamento: o Operacional volta a conseguir aprovar a vaga
--
-- SINTOMA
-- Usuário com TODAS as permissões de Operacional abre a Solicitação em
-- "Pendente Operacional", clica em Aprovar e recebe "Erro ao aprovar".
--
-- CAUSA
-- Não é permissão: a RLS deixa passar (sistema_recrutamento_operacional
-- cobra `operacional_recrutamento` alterar/aprovar, e ele tem). Quem recusa
-- é o gatilho `sistema_recrutamento_guard`, da 20260903000001:
--
--     v_rh := has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
--          OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir');
--     IF NOT v_rh THEN  -- só pode mexer na data
--       RAISE EXCEPTION 'Depois de criada, você só pode alterar a Data...'
--
-- O gatilho foi escrito para travar o ENCARREGADO que abriu a vaga — e, em
-- 03/09, `recrutamento_gestao` era de fato a única porta de quem decide
-- sobre ela. Seis dias depois, a 20260909000007 criou a tela do Operacional,
-- com capacidade própria (`operacional_recrutamento`), e ninguém voltou aqui.
-- Resultado: a RLS abre a porta e o gatilho fecha logo atrás.
--
-- CORREÇÃO
-- Quem pode decidir sobre a vaga passa a ser as DUAS portas, exatamente as
-- mesmas que a RLS reconhece. O nome da variável muda junto: não é mais "é
-- do RH", é "pode editar a vaga inteira" — foi o nome antigo que fez a
-- segunda porta passar despercebida.
--
-- O resto do gatilho fica intacto: o encarregado continua só podendo mexer
-- na data, com justificativa e prazo mínimo.
--
-- Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sistema_recrutamento_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gestor  boolean;
  v_dias    integer;
  v_livre   jsonb;
  v_ult     jsonb;
  v_msg     text := 'A vaga precisa de no mínimo 7 dias úteis entre hoje e a data de início prevista.';
BEGIN
  -- Nome novo do motivo, venha de onde vier.
  IF btrim(coalesce(NEW.motivo_vaga, '')) = 'Expansão' THEN
    NEW.motivo_vaga := 'Expansão (Aumento de Quadro)';
  END IF;

  -- CNH obrigatória pelo cargo (marca + linha no requisito, sem duplicar).
  IF public.rec_cargo_exige_cnh(NEW.cargo) THEN
    NEW.cnh_obrigatoria := true;
    IF upper(translate(coalesce(NEW.req_obrigatorios, ''),
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       !~ '(CNH|CARTEIRA DE (MOTORISTA|HABILITA))' THEN
      NEW.req_obrigatorios := btrim(concat(
        'CNH obrigatória (categoria compatível com a função).',
        CASE WHEN btrim(coalesce(NEW.req_obrigatorios, '')) = '' THEN '' ELSE E'\n' || NEW.req_obrigatorios END));
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cnh_obrigatoria := COALESCE(NEW.cnh_obrigatoria, false);
  END IF;

  -- ── INSERT: prazo mínimo + grau automático ─────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NOT NULL THEN
      v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
      IF v_dias < 7 THEN
        RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
      END IF;
      NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);
    END IF;
    NEW.data_inicio_alteracoes := COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb);
    RETURN NEW;
  END IF;

  -- ── UPDATE ─────────────────────────────────────────────────────────────
  -- Quem decide sobre a vaga. São as MESMAS duas portas que a RLS reconhece
  -- (sistema_recrutamento_gate e sistema_recrutamento_operacional) — manter
  -- as duas listas iguais é o que impede a RLS liberar e o gatilho recusar,
  -- que foi exatamente o defeito corrigido aqui.
  v_gestor := has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
           OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
           OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
           OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'aprovar');

  -- Quem não decide (o encarregado que abriu a vaga) só mexe na data — e no
  -- que deriva dela. Comparar o resto como jsonb pega qualquer coluna,
  -- inclusive as que forem criadas depois desta migration.
  IF NOT v_gestor THEN
    v_livre := to_jsonb(OLD) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes';
    IF v_livre IS DISTINCT FROM (to_jsonb(NEW) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes') THEN
      RAISE EXCEPTION 'Depois de criada, você só pode alterar a Data de Início Prevista da vaga. Para mudar qualquer outra informação, fale com o Recrutamento.';
    END IF;
  END IF;

  IF NEW.data_inicio_prevista IS DISTINCT FROM OLD.data_inicio_prevista THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NULL THEN
      RAISE EXCEPTION 'Informe a nova data de início prevista.';
    END IF;
    v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
    IF v_dias < 7 THEN
      RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
    END IF;
    NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);

    -- Justificativa: a troca precisa entrar no histórico, com texto de gente.
    IF jsonb_array_length(COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb))
       <> jsonb_array_length(COALESCE(OLD.data_inicio_alteracoes, '[]'::jsonb)) + 1 THEN
      RAISE EXCEPTION 'Toda troca de data precisa de uma justificativa.';
    END IF;
    v_ult := NEW.data_inicio_alteracoes -> (jsonb_array_length(NEW.data_inicio_alteracoes) - 1);
    IF length(btrim(coalesce(v_ult->>'justificativa', ''))) < 10 THEN
      RAISE EXCEPTION 'Escreva a justificativa da troca de data (mínimo 10 caracteres).';
    END IF;
    IF btrim(coalesce(v_ult->>'para', '')) <> btrim(coalesce(NEW.data_inicio_prevista, '')) THEN
      RAISE EXCEPTION 'O histórico da troca de data não bate com a data enviada.';
    END IF;
    -- Carimbo de quem trocou: quem grava é o banco, não o cliente.
    NEW.data_inicio_alteracoes := jsonb_set(
      NEW.data_inicio_alteracoes,
      ARRAY[(jsonb_array_length(NEW.data_inicio_alteracoes) - 1)::text],
      v_ult || jsonb_build_object('por', auth.uid(), 'em', now()));
  ELSIF NEW.data_inicio_alteracoes IS DISTINCT FROM OLD.data_inicio_alteracoes AND NOT v_gestor THEN
    -- Não deixa mexer no histórico sem trocar a data (reescrever justificativa).
    RAISE EXCEPTION 'O histórico de datas não pode ser alterado.';
  END IF;

  RETURN NEW;
END $$;

-- O gatilho já existe e aponta para esta função; o CREATE OR REPLACE acima
-- basta. Recriado assim mesmo para o caso de a 20260903000001 não ter
-- rodado neste banco.
DROP TRIGGER IF EXISTS trg_sistema_recrutamento_guard ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_sistema_recrutamento_guard
  BEFORE INSERT OR UPDATE ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.sistema_recrutamento_guard();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Recriar public.sistema_recrutamento_guard() da 20260903000001 (v_rh só
--   com recrutamento_gestao). Isso devolve o "Erro ao aprovar" para o
--   Operacional.
-- =========================================================================
