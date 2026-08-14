-- =========================================================================
-- RECRUTAMENTO E SELEÇÃO — regras da solicitação de vaga no BANCO
--
-- O que passa a valer (as mesmas regras estão em src/lib/recrutamento/
-- vagaRegras.ts, que é o que a tela usa — aqui é o piso, não a decoração):
--
-- 1) PRAZO MÍNIMO: vaga só abre para daqui a 7 DIAS ÚTEIS ou mais.
-- 2) GRAU DE URGÊNCIA sai do prazo, ninguém escolhe na mão:
--       7 a 13 dias úteis → 'Alta — Urgente'
--      14 a 20            → 'Média'
--      21 ou mais         → 'Baixa'
-- 3) ENCARREGADO SÓ EDITA A DATA depois da vaga criada, e com justificativa.
--    Toda troca de data fica registrada em data_inicio_alteracoes (jsonb).
-- 4) CNH OBRIGATÓRIA entra sozinha quando o cargo é motorista, tratorista,
--    operador de retroescavadeira ou supervisor operacional.
-- 5) MOTIVO 'Expansão' passa a se chamar 'Expansão (Aumento de Quadro)' —
--    as vagas antigas são normalizadas.
--
-- Diferença conhecida entre a tela e o banco: a tela desconta FERIADO
-- NACIONAL na conta de dias úteis (src/lib/feriadosNacionais.ts); aqui só
-- sábado e domingo saem. O banco é, portanto, o piso mais frouxo — quem
-- passa pela tela passa aqui. Replicar o calendário de feriados em SQL não
-- se paga: o que importa é não deixar ninguém furar a regra pela API.
--
-- Automação de servidor (service_role, sem sessão) não é barrada — quem tem
-- a service_role já pode tudo, e travá-la só quebraria integração.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Colunas novas ─────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS cnh_obrigatoria boolean NOT NULL DEFAULT false,
  -- histórico de troca da data de início: [{de, para, justificativa, por, por_nome, em}]
  ADD COLUMN IF NOT EXISTS data_inicio_alteracoes jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 'Expansão' → 'Expansão (Aumento de Quadro)' nas vagas que já existem.
UPDATE public."SISTEMA_RECRUTAMENTO"
   SET motivo_vaga = 'Expansão (Aumento de Quadro)'
 WHERE btrim(coalesce(motivo_vaga, '')) = 'Expansão';

-- ── 2) Helpers ───────────────────────────────────────────────────────────

-- Dias úteis de _de (exclusivo) até _ate (inclusive). Só tira sáb/dom.
CREATE OR REPLACE FUNCTION public.dias_uteis_entre(_de date, _ate date)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _de IS NULL OR _ate IS NULL OR _ate <= _de THEN 0 ELSE (
    SELECT count(*)::int FROM generate_series(_de + 1, _ate, interval '1 day') d
     WHERE extract(isodow from d) < 6) END;
$$;

-- data_inicio_prevista é TEXT na tabela (vem do <input type=date>). Converte
-- só o que tem cara de ISO; qualquer outra coisa vira NULL em vez de erro.
CREATE OR REPLACE FUNCTION public.rec_data_prevista(_txt text)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(coalesce(_txt, '')) ~ '^\d{4}-\d{2}-\d{2}'
              THEN to_date(substr(btrim(_txt), 1, 10), 'YYYY-MM-DD') END;
$$;

-- Grau pelo prazo. NULL = sem data ou abaixo do mínimo (o guard barra).
CREATE OR REPLACE FUNCTION public.rec_grau_por_data(_data text, _hoje date DEFAULT current_date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN public.rec_data_prevista(_data) IS NULL THEN NULL
    WHEN public.dias_uteis_entre(_hoje, public.rec_data_prevista(_data)) >= 21 THEN 'Baixa'
    WHEN public.dias_uteis_entre(_hoje, public.rec_data_prevista(_data)) >= 14 THEN 'Média'
    WHEN public.dias_uteis_entre(_hoje, public.rec_data_prevista(_data)) >= 7  THEN 'Alta — Urgente'
    ELSE NULL END;
$$;

-- Cargo que dirige veículo/máquina da empresa. Sem acento e sem caixa —
-- o cargo vem digitado à mão ou do "Título do Cargo" da EMPREGADOS.
CREATE OR REPLACE FUNCTION public.rec_cargo_exige_cnh(_cargo text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(translate(coalesce(_cargo, ''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
         ~ '(MOTORISTA|TRATORISTA|RETRO ?ESCAVADEIRA|SUPERVISOR(A)? .*OPERACIONAL)';
$$;

REVOKE EXECUTE ON FUNCTION public.dias_uteis_entre(date, date), public.rec_data_prevista(text),
  public.rec_grau_por_data(text, date), public.rec_cargo_exige_cnh(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dias_uteis_entre(date, date), public.rec_data_prevista(text),
  public.rec_grau_por_data(text, date), public.rec_cargo_exige_cnh(text) TO authenticated;

-- ── 3) O guard ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sistema_recrutamento_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
  v_rh    boolean;
  v_dias  int;
  v_grau  text;
  v_livre jsonb;   -- colunas que o encarregado PODE mexer
  v_ult   jsonb;
  v_msg   text := 'A vaga precisa de no mínimo 7 dias úteis de antecedência.';
BEGIN
  IF v_auto THEN RETURN NEW; END IF;

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
  v_rh := has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
       OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir');

  -- Quem não é do Recrutamento (o encarregado que abriu a vaga) só mexe na
  -- data — e no que deriva dela. Comparar o resto como jsonb pega qualquer
  -- coluna, inclusive as que forem criadas depois desta migration.
  IF NOT v_rh THEN
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
  ELSIF NEW.data_inicio_alteracoes IS DISTINCT FROM OLD.data_inicio_alteracoes AND NOT v_rh THEN
    -- Não deixa mexer no histórico sem trocar a data (reescrever justificativa).
    RAISE EXCEPTION 'O histórico de datas não pode ser alterado.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sistema_recrutamento_guard ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_sistema_recrutamento_guard
  BEFORE INSERT OR UPDATE ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.sistema_recrutamento_guard();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TRIGGER trg_sistema_recrutamento_guard ON public."SISTEMA_RECRUTAMENTO";
--   DROP FUNCTION public.sistema_recrutamento_guard();
--   DROP FUNCTION public.rec_grau_por_data(text, date), public.rec_cargo_exige_cnh(text),
--                 public.rec_data_prevista(text), public.dias_uteis_entre(date, date);
--   As colunas novas podem ficar (cnh_obrigatoria default false, histórico vazio).
--   O UPDATE do motivo 'Expansão' não se desfaz sozinho — se precisar voltar:
--   UPDATE "SISTEMA_RECRUTAMENTO" SET motivo_vaga='Expansão'
--    WHERE motivo_vaga='Expansão (Aumento de Quadro)';
