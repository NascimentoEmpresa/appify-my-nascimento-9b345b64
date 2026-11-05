-- =========================================================================
-- Central de Serviços › Agendamento de Veículos: checklist de SAÍDA e de
-- CHEGADA, provável data/hora da chegada e o aviso de quem não preencheu
-- (04/11/2026).
--
-- Pedido do Pablo: trazer para o agendamento o formulário antigo "Checklist
-- Veículos Retorno" (fotos das 4 laterais, 4 do interior, do KM e de defeito
-- não listado), para a saída e para a chegada, preenchido em Meus
-- Agendamentos. Nome do condutor e veículo NÃO são perguntados: vêm do
-- agendamento. E, nas palavras dele, "nada pode ser impedido" — quem não
-- preencheu continua agendando outro carro, mas o novo agendamento nasce com
-- "FULANO NÃO PREENCHEU A SAÍDA E A CHEGADA" (ou só uma das duas) no
-- histórico, e a pessoa recebe "VOCÊ PRECISA PREENCHER A CHEGADA do veículo".
--
-- O que esta migration faz:
--   1) cs_veiculo_agendamento ganha chegada_prevista (pergunta nova do Novo
--      Agendamento), checklist_exigido (false nos agendamentos que já
--      existiam — não se cobra checklist de viagem anterior a ele) e
--      checklist_pendente_ao_agendar (o texto, para o card mostrar sem ler o
--      log);
--   2) "CS_VEICULO_CHECKLIST": um por agendamento e tipo, com as fotos e a
--      coluna gerada `completo`;
--   3) "CS_VEICULO_CHECKLIST_LEMBRETE": qual aviso já foi para o sino (um por
--      agendamento e tipo — o cron não repete);
--   4) a régua do "atrasado" (mesma de src/lib/checklistVeiculo.ts): saída
--      cobrada quando a viagem começa (hora de início do turno), chegada
--      cobrada quando passa a provável chegada (sem ela, fim do turno do
--      retorno). Incompleto conta como não preenchido;
--   5) gatilho BEFORE INSERT: ao agendar com checklist atrasado de outro
--      agendamento, grava o texto no histórico dos dois e manda o sino. NUNCA
--      barra o INSERT — qualquer erro aqui é engolido;
--   6) RPC cs_veiculo_checklist_salvar(): grava (parcial ou completo), e o KM
--      do checklist alimenta o KM da viagem que já existe (km_inicial na
--      saída, km_final na chegada — só se ainda estiver vazio, sem duplicar).
--      Checklist de chegada completo finaliza a viagem (finalizada_em);
--   7) bucket privado cs-veiculos-checklist: só quem agendou e quem gerencia
--      a frota (Patrimônio, o mesmo gate das RPCs de KM) leem e enviam;
--   8) cs_veiculo_checklist_lembretes() + pg_cron de 15 em 15 min.
--
-- Acesso: can_access() (nada de has_role). O gestor da frota é quem tem
-- sup_patrimonio — mesma decisão da 20260828000003 e das RPCs de KM.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- 1) Colunas novas no agendamento --------------------------------------------
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS chegada_prevista timestamptz;
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS checklist_pendente_ao_agendar text;
-- Criada na 20261105009200 ("Não usei o carro no dia"); repetida aqui só para
-- esta migration não depender da ordem de aplicação. Reserva marcada como
-- não usada não cobra checklist nenhum.
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS nao_utilizado_em timestamptz;
-- DEFAULT false no ADD preenche as linhas que já existem (não cobra o
-- passado); o SET DEFAULT true vale daqui para a frente.
ALTER TABLE public.cs_veiculo_agendamento ADD COLUMN IF NOT EXISTS checklist_exigido boolean NOT NULL DEFAULT false;
ALTER TABLE public.cs_veiculo_agendamento ALTER COLUMN checklist_exigido SET DEFAULT true;

COMMENT ON COLUMN public.cs_veiculo_agendamento.chegada_prevista IS
  'Provável data/hora da chegada, informada no Novo Agendamento (04/11/2026). Depois dela, o checklist de chegada passa a ser cobrado.';
COMMENT ON COLUMN public.cs_veiculo_agendamento.checklist_exigido IS
  'false = agendamento anterior ao checklist de saída/chegada (mig 20261105009300); não cobra nada.';
COMMENT ON COLUMN public.cs_veiculo_agendamento.checklist_pendente_ao_agendar IS
  'Texto gravado ao agendar com checklist atrasado de outro agendamento: "FULANO NÃO PREENCHEU A SAÍDA E A CHEGADA do agendamento nº…". Não bloqueia nada.';

CREATE INDEX IF NOT EXISTS idx_cs_veic_agend_checklist
  ON public.cs_veiculo_agendamento(solicitante_id, data_inicio)
  WHERE checklist_exigido AND status = 'confirmado';

-- 2) O checklist -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."CS_VEICULO_CHECKLIST" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id         uuid NOT NULL REFERENCES public.cs_veiculo_agendamento(id) ON DELETE CASCADE,
  tipo                   text NOT NULL CHECK (tipo IN ('saida', 'chegada')),
  -- "Data e horário" do formulário: nasce com agora, editável.
  realizado_em           timestamptz NOT NULL DEFAULT now(),
  km                     integer CHECK (km IS NULL OR km >= 0),
  foto_lateral_direita   text,
  foto_lateral_esquerda  text,
  foto_dianteira         text,
  foto_traseira          text,
  fotos_interior         text[] NOT NULL DEFAULT '{}',
  foto_km                text,
  -- Opcional: defeito que não está no histórico do carro.
  fotos_defeito          text[] NOT NULL DEFAULT '{}',
  observacao             text,
  -- Condutor = quem agendou (não é pergunta). Quem preencheu pode ser o gestor.
  condutor_id            uuid,
  condutor_nome          text,
  preenchido_por_id      uuid,
  preenchido_por_nome    text,
  completo               boolean GENERATED ALWAYS AS (
                           foto_lateral_direita IS NOT NULL
                           AND foto_lateral_esquerda IS NOT NULL
                           AND foto_dianteira IS NOT NULL
                           AND foto_traseira IS NOT NULL
                           AND coalesce(cardinality(fotos_interior), 0) >= 4
                           AND foto_km IS NOT NULL
                         ) STORED,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agendamento_id, tipo)
);
COMMENT ON TABLE public."CS_VEICULO_CHECKLIST" IS
  'Checklist de saída/chegada do Agendamento de Veículos (fotos em cs-veiculos-checklist/<agendamento_id>/...). Escrita só pela RPC cs_veiculo_checklist_salvar.';

DROP TRIGGER IF EXISTS trg_cs_veic_checklist_updated ON public."CS_VEICULO_CHECKLIST";
CREATE TRIGGER trg_cs_veic_checklist_updated BEFORE UPDATE ON public."CS_VEICULO_CHECKLIST"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Avisos já enviados ao sino ---------------------------------------------
CREATE TABLE IF NOT EXISTS public."CS_VEICULO_CHECKLIST_LEMBRETE" (
  agendamento_id uuid NOT NULL REFERENCES public.cs_veiculo_agendamento(id) ON DELETE CASCADE,
  tipo           text NOT NULL CHECK (tipo IN ('saida', 'chegada')),
  enviado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agendamento_id, tipo)
);

-- RLS: o checklist é de quem agendou e de quem gerencia a frota. Escrita só
-- pela RPC (SECURITY DEFINER) — por isso não há policy de INSERT/UPDATE.
ALTER TABLE public."CS_VEICULO_CHECKLIST" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CS_VEICULO_CHECKLIST_LEMBRETE" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_veic_checklist_select ON public."CS_VEICULO_CHECKLIST";
CREATE POLICY cs_veic_checklist_select ON public."CS_VEICULO_CHECKLIST" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cs_veiculo_agendamento a
                  WHERE a.id = agendamento_id
                    AND (a.solicitante_id = auth.uid()
                         OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::public.app_acao))));
-- "CS_VEICULO_CHECKLIST_LEMBRETE" sem policy: só as funções do banco mexem.

-- 4) A régua do atrasado (espelho de src/lib/checklistVeiculo.ts) ------------
CREATE OR REPLACE FUNCTION public.cs_veic_checklist_pendencias(p_agendamento uuid, p_agora timestamptz DEFAULT now())
RETURNS TABLE (saida boolean, chegada boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    NOT coalesce((SELECT c.completo FROM public."CS_VEICULO_CHECKLIST" c WHERE c.agendamento_id = a.id AND c.tipo = 'saida'), false)
      AND p_agora >= ((a.data_inicio + make_time(CASE a.turno WHEN 'tarde' THEN 13 ELSE 8 END, 0, 0)) AT TIME ZONE 'America/Sao_Paulo'),
    NOT coalesce((SELECT c.completo FROM public."CS_VEICULO_CHECKLIST" c WHERE c.agendamento_id = a.id AND c.tipo = 'chegada'), false)
      AND p_agora >= coalesce(a.chegada_prevista,
                              (a.data_fim + make_time(CASE a.turno WHEN 'manha' THEN 12 ELSE 18 END, 0, 0)) AT TIME ZONE 'America/Sao_Paulo')
    FROM public.cs_veiculo_agendamento a
   WHERE a.id = p_agendamento
     AND a.status <> 'cancelado'
     AND a.checklist_exigido
     AND a.nao_utilizado_em IS NULL;
$$;
REVOKE ALL ON FUNCTION public.cs_veic_checklist_pendencias(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veic_checklist_pendencias(uuid, timestamptz) TO authenticated;

/** "A SAÍDA E A CHEGADA" | "A SAÍDA" | "A CHEGADA" | NULL — igual a oQueFalta() da lib. */
CREATE OR REPLACE FUNCTION public.cs_veic_checklist_o_que_falta(p_saida boolean, p_chegada boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_saida AND p_chegada THEN 'A SAÍDA E A CHEGADA'
    WHEN p_saida THEN 'A SAÍDA'
    WHEN p_chegada THEN 'A CHEGADA'
  END;
$$;

/** "HILUX JBZ-4D93 · 26/01/2030" (ou "· 26/01/2030 a 28/01/2030") — igual a veiculoEData() da lib. */
CREATE OR REPLACE FUNCTION public.cs_veic_checklist_veiculo_e_data(p_agendamento uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.veiculo_nome || coalesce(' ' || nullif(btrim(a.veiculo_identificador), ''), '') || ' · '
         || to_char(a.data_inicio, 'DD/MM/YYYY')
         || CASE WHEN a.data_fim <> a.data_inicio THEN ' a ' || to_char(a.data_fim, 'DD/MM/YYYY') ELSE '' END
    FROM public.cs_veiculo_agendamento a WHERE a.id = p_agendamento;
$$;
REVOKE ALL ON FUNCTION public.cs_veic_checklist_veiculo_e_data(uuid) FROM PUBLIC, anon;

/**
 * Manda "VOCÊ PRECISA PREENCHER A CHEGADA do veículo X" ao sino de quem
 * agendou, uma vez por agendamento e tipo. Devolve true se mandou agora.
 */
CREATE OR REPLACE FUNCTION public.cs_veic_checklist_avisar(p_agendamento uuid, p_tipo text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a record;
BEGIN
  INSERT INTO public."CS_VEICULO_CHECKLIST_LEMBRETE"(agendamento_id, tipo) VALUES (p_agendamento, p_tipo)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT id, numero, veiculo_nome, solicitante_id INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (a.solicitante_id,
          'VOCÊ PRECISA PREENCHER ' || CASE p_tipo WHEN 'saida' THEN 'A SAÍDA' ELSE 'A CHEGADA' END || ' do veículo ' || a.veiculo_nome,
          left('Checklist de ' || CASE p_tipo WHEN 'saida' THEN 'saída' ELSE 'chegada' END || ' do agendamento nº ' || a.numero
               || ' (' || public.cs_veic_checklist_veiculo_e_data(a.id) || '). Preencha em Agendamento de Veículos › Meus Agendamentos.', 300),
          'warning',
          '/app/central-servicos/veiculos?aba=meus');
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veic_checklist_avisar(uuid, text) FROM PUBLIC, anon;

-- 5) Ao agendar: registra quem não preencheu (sem barrar) ---------------------
CREATE OR REPLACE FUNCTION public.cs_veic_checklist_ao_agendar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r       record;
  v_nome  text;
  v_quem  text;
  v_linha text;
  v_textos text[] := '{}';
BEGIN
  -- Fallback da provável chegada (a tela exige; o que chegar sem ela —
  -- carga, front antigo em cache — ganha o fim do turno do retorno).
  IF NEW.chegada_prevista IS NULL THEN
    NEW.chegada_prevista := (NEW.data_fim + make_time(CASE NEW.turno WHEN 'manha' THEN 12 ELSE 18 END, 0, 0)) AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  IF NEW.status <> 'confirmado' OR NOT NEW.checklist_exigido THEN
    RETURN NEW;
  END IF;

  -- Daqui para baixo é só registro: se algo falhar, o agendamento vale.
  BEGIN
    v_nome := coalesce(nullif(btrim(NEW.solicitante_nome), ''),
                       (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = NEW.solicitante_id));
    v_quem := upper(coalesce(nullif(btrim(v_nome), ''), 'USUÁRIO SEM NOME'));

    FOR r IN
      SELECT a.id, a.numero, p.saida, p.chegada
        FROM public.cs_veiculo_agendamento a
        CROSS JOIN LATERAL public.cs_veic_checklist_pendencias(a.id) p
       WHERE a.solicitante_id = NEW.solicitante_id
         AND a.id <> NEW.id
         AND a.status = 'confirmado'
         AND a.checklist_exigido
         AND (p.saida OR p.chegada)
       ORDER BY a.data_inicio, a.numero
    LOOP
      v_linha := v_quem || ' NÃO PREENCHEU ' || public.cs_veic_checklist_o_que_falta(r.saida, r.chegada)
                 || ' do agendamento nº ' || r.numero || ' (' || public.cs_veic_checklist_veiculo_e_data(r.id) || ')';
      v_textos := v_textos || v_linha;

      -- No histórico do agendamento NOVO…
      INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
      VALUES (NEW.id, 'checklist_pendente', v_linha, NEW.solicitante_id, v_nome);
      -- …e no do anterior, para quem abrir aquele.
      INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
      VALUES (r.id, 'checklist_pendente',
              v_linha || ' — agendou outro veículo (' || NEW.veiculo_nome || ', ' || to_char(NEW.data_inicio, 'DD/MM/YYYY') || ') sem preencher',
              NEW.solicitante_id, v_nome);

      IF r.saida   THEN PERFORM public.cs_veic_checklist_avisar(r.id, 'saida');   END IF;
      IF r.chegada THEN PERFORM public.cs_veic_checklist_avisar(r.id, 'chegada'); END IF;
    END LOOP;

    IF cardinality(v_textos) > 0 THEN
      NEW.checklist_pendente_ao_agendar := array_to_string(v_textos, E'\n');
    END IF;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'cs_veic_checklist_ao_agendar: % (agendamento segue)', SQLERRM;
  END;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veic_checklist_ao_agendar() FROM PUBLIC, anon;

-- O nome com "z" é de propósito: gatilhos BEFORE rodam em ordem alfabética,
-- e este tem de vir depois do trg_cs_veic_solicitante (que congela o nome) e
-- do trg_cs_veic_checar (se ele recusar o INSERT, nada daqui é gravado).
DROP TRIGGER IF EXISTS trg_cs_veic_zchecklist ON public.cs_veiculo_agendamento;
CREATE TRIGGER trg_cs_veic_zchecklist BEFORE INSERT ON public.cs_veiculo_agendamento
  FOR EACH ROW EXECUTE FUNCTION public.cs_veic_checklist_ao_agendar();

-- 6) Salvar o checklist ------------------------------------------------------
-- p_fotos: { foto_lateral_direita, foto_lateral_esquerda, foto_dianteira,
-- foto_traseira, foto_km: "caminho", fotos_interior: [...], fotos_defeito:
-- [...] }. Foto única que vier substitui; lista que vier é a lista inteira
-- (a tela manda as que ficaram + as novas). Chave ausente = não mexe.
CREATE OR REPLACE FUNCTION public.cs_veiculo_checklist_salvar(
  p_agendamento uuid, p_tipo text, p_realizado_em timestamptz, p_km integer, p_fotos jsonb, p_observacao text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  a          record;
  c          public."CS_VEICULO_CHECKLIST"%ROWTYPE;
  v_fotos    jsonb := coalesce(p_fotos, '{}'::jsonb);
  v_prefixo  text := p_agendamento::text || '/';
  v_caminho  text;
  v_nome     text;
  v_era      boolean;
  v_falta    int;
BEGIN
  IF p_tipo NOT IN ('saida', 'chegada') THEN RAISE EXCEPTION 'Tipo de checklist inválido.'; END IF;
  SELECT * INTO a FROM public.cs_veiculo_agendamento WHERE id = p_agendamento;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF a.solicitante_id <> auth.uid() AND NOT public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Só quem agendou (ou quem gerencia a frota) preenche este checklist.';
  END IF;
  IF a.status = 'cancelado' THEN RAISE EXCEPTION 'Agendamento cancelado não tem checklist.'; END IF;
  IF p_km IS NOT NULL AND p_km < 0 THEN RAISE EXCEPTION 'KM inválido.'; END IF;
  IF p_tipo = 'chegada' AND p_km IS NOT NULL AND a.km_inicial IS NOT NULL AND p_km < a.km_inicial THEN
    RAISE EXCEPTION 'O KM da chegada (%) não pode ser menor que o KM inicial da viagem (%).', p_km, a.km_inicial;
  END IF;

  -- Só aceita arquivo da pasta deste agendamento (é o que a policy do bucket deixou subir).
  FOR v_caminho IN SELECT x #>> '{}' FROM jsonb_path_query(v_fotos, '$.** ? (@.type() == "string")') x LOOP
    IF left(v_caminho, length(v_prefixo)) <> v_prefixo THEN
      RAISE EXCEPTION 'Arquivo fora da pasta do agendamento: %', v_caminho;
    END IF;
  END LOOP;

  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public."CS_VEICULO_CHECKLIST"(agendamento_id, tipo, condutor_id, condutor_nome, preenchido_por_id, preenchido_por_nome)
  VALUES (p_agendamento, p_tipo, a.solicitante_id, a.solicitante_nome, auth.uid(), v_nome)
  ON CONFLICT (agendamento_id, tipo) DO NOTHING;

  SELECT * INTO c FROM public."CS_VEICULO_CHECKLIST" WHERE agendamento_id = p_agendamento AND tipo = p_tipo FOR UPDATE;
  v_era := c.completo;

  UPDATE public."CS_VEICULO_CHECKLIST" SET
    realizado_em          = coalesce(p_realizado_em, realizado_em),
    km                    = coalesce(p_km, km),
    foto_lateral_direita  = coalesce(nullif(v_fotos->>'foto_lateral_direita', ''),  foto_lateral_direita),
    foto_lateral_esquerda = coalesce(nullif(v_fotos->>'foto_lateral_esquerda', ''), foto_lateral_esquerda),
    foto_dianteira        = coalesce(nullif(v_fotos->>'foto_dianteira', ''),        foto_dianteira),
    foto_traseira         = coalesce(nullif(v_fotos->>'foto_traseira', ''),         foto_traseira),
    foto_km               = coalesce(nullif(v_fotos->>'foto_km', ''),               foto_km),
    fotos_interior        = CASE WHEN jsonb_typeof(v_fotos->'fotos_interior') = 'array'
                                 THEN ARRAY(SELECT jsonb_array_elements_text(v_fotos->'fotos_interior')) ELSE fotos_interior END,
    fotos_defeito         = CASE WHEN jsonb_typeof(v_fotos->'fotos_defeito') = 'array'
                                 THEN ARRAY(SELECT jsonb_array_elements_text(v_fotos->'fotos_defeito')) ELSE fotos_defeito END,
    observacao            = CASE WHEN p_observacao IS NULL THEN observacao ELSE nullif(btrim(p_observacao), '') END,
    condutor_id           = coalesce(condutor_id, a.solicitante_id),
    condutor_nome         = coalesce(condutor_nome, a.solicitante_nome),
    preenchido_por_id     = auth.uid(),
    preenchido_por_nome   = v_nome
  WHERE id = c.id
  RETURNING * INTO c;

  -- O KM do checklist é o KM da viagem: preenche o que ainda estiver vazio,
  -- nunca sobrescreve (o KM inicial/final têm trilha própria). Em bloco
  -- protegido: o UPDATE passa pelo trg_cs_veic_checar, e um carro que entrou
  -- em manutenção depois não pode impedir o checklist de ser salvo.
  BEGIN
    IF p_tipo = 'saida' AND (c.km IS NOT NULL OR c.foto_km IS NOT NULL)
       AND (a.km_inicial IS NULL OR a.km_inicial_foto IS NULL) THEN
      UPDATE public.cs_veiculo_agendamento
         SET km_inicial      = coalesce(km_inicial, c.km),
             km_inicial_foto = coalesce(km_inicial_foto, c.foto_km),
             km_inicial_em   = coalesce(km_inicial_em, now()),
             updated_at      = now()
       WHERE id = p_agendamento;
    ELSIF p_tipo = 'chegada' THEN
      UPDATE public.cs_veiculo_agendamento
         SET km_final      = coalesce(km_final, c.km),
             km_final_foto = coalesce(km_final_foto, c.foto_km),
             km_final_em   = CASE WHEN (km_final IS NULL AND c.km IS NOT NULL) OR (km_final_foto IS NULL AND c.foto_km IS NOT NULL)
                                  THEN coalesce(km_final_em, now()) ELSE km_final_em END,
             -- Chegada completa = carro devolvido: finaliza a viagem.
             finalizada_em = CASE WHEN c.completo THEN coalesce(finalizada_em, now()) ELSE finalizada_em END,
             updated_at    = now()
       WHERE id = p_agendamento;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'cs_veiculo_checklist_salvar: KM da viagem não atualizado (%)', SQLERRM;
  END;

  v_falta := (CASE WHEN c.foto_lateral_direita IS NULL THEN 1 ELSE 0 END) + (CASE WHEN c.foto_lateral_esquerda IS NULL THEN 1 ELSE 0 END)
           + (CASE WHEN c.foto_dianteira IS NULL THEN 1 ELSE 0 END) + (CASE WHEN c.foto_traseira IS NULL THEN 1 ELSE 0 END)
           + greatest(0, 4 - coalesce(cardinality(c.fotos_interior), 0)) + (CASE WHEN c.foto_km IS NULL THEN 1 ELSE 0 END);

  INSERT INTO public.cs_veiculo_agendamento_log(agendamento_id, acao, detalhe, usuario_id, usuario_nome)
  VALUES (p_agendamento, 'checklist_' || p_tipo,
          concat_ws(' · ',
            'Checklist de ' || CASE p_tipo WHEN 'saida' THEN 'saída' ELSE 'chegada' END
              || CASE WHEN c.completo AND NOT v_era THEN ' preenchido'
                      WHEN c.completo THEN ' atualizado'
                      ELSE ' salvo pela metade (falta' || CASE WHEN v_falta > 1 THEN 'm ' ELSE ' ' END || v_falta || ' foto' || CASE WHEN v_falta > 1 THEN 's' ELSE '' END || ')' END,
            CASE WHEN c.km IS NOT NULL THEN 'KM ' || c.km END,
            CASE WHEN cardinality(c.fotos_defeito) > 0 THEN cardinality(c.fotos_defeito) || ' foto(s) de defeito' END,
            CASE WHEN c.preenchido_por_id IS DISTINCT FROM a.solicitante_id THEN 'preenchido por ' || coalesce(v_nome, '—') END),
          auth.uid(), v_nome);

  RETURN to_jsonb(c);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_checklist_salvar(uuid, text, timestamptz, integer, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_checklist_salvar(uuid, text, timestamptz, integer, jsonb, text) TO authenticated;

-- 7) Bucket privado das fotos -----------------------------------------------
-- Separado do cs-veiculos (notas e painel), cuja leitura é de quem tem a
-- tela: aqui as fotos do carro são só de quem agendou e do gestor da frota.
-- Caminho: <agendamento_id>/<saida|chegada>/<campo>-<timestamp>-<arquivo>.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cs-veiculos-checklist', 'cs-veiculos-checklist', false, 15728640) -- 15 MB
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cs_veic_checklist_pode_arquivo(p_nome text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a
     WHERE a.id::text = split_part(p_nome, '/', 1)
       AND (a.solicitante_id = auth.uid()
            OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'::public.app_acao))
  );
$$;
REVOKE ALL ON FUNCTION public.cs_veic_checklist_pode_arquivo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veic_checklist_pode_arquivo(text) TO authenticated;

DROP POLICY IF EXISTS "cs veiculos checklist select" ON storage.objects;
CREATE POLICY "cs veiculos checklist select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cs-veiculos-checklist' AND public.cs_veic_checklist_pode_arquivo(name));
DROP POLICY IF EXISTS "cs veiculos checklist insert" ON storage.objects;
CREATE POLICY "cs veiculos checklist insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cs-veiculos-checklist' AND public.cs_veic_checklist_pode_arquivo(name));
-- Sem DELETE/UPDATE: foto de checklist é evidência; trocar = subir outra.

-- 8) Lembretes no sino (pg_cron) --------------------------------------------
CREATE OR REPLACE FUNCTION public.cs_veiculo_checklist_lembretes()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT a.id, p.saida, p.chegada
      FROM public.cs_veiculo_agendamento a
      CROSS JOIN LATERAL public.cs_veic_checklist_pendencias(a.id) p
     WHERE a.status = 'confirmado'
       AND a.checklist_exigido
       -- Janela: lembrete de viagem de dois meses atrás já não ajuda ninguém.
       AND a.data_inicio >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 60
       AND a.data_inicio <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
       AND (p.saida OR p.chegada)
  LOOP
    IF r.saida   AND public.cs_veic_checklist_avisar(r.id, 'saida')   THEN n := n + 1; END IF;
    IF r.chegada AND public.cs_veic_checklist_avisar(r.id, 'chegada') THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_veiculo_checklist_lembretes() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cs-veiculo-checklist-lembretes')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cs-veiculo-checklist-lembretes');
    PERFORM cron.schedule('cs-veiculo-checklist-lembretes', '*/15 * * * *',
      $job$SELECT public.cs_veiculo_checklist_lembretes();$job$);
    RAISE NOTICE 'pg_cron: cs-veiculo-checklist-lembretes agendado (*/15).';
  ELSE
    RAISE NOTICE 'pg_cron ausente — os lembretes do checklist só saem ao agendar outro veículo.';
  END IF;
END
$cron$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     PERFORM cron.unschedule('cs-veiculo-checklist-lembretes')
--       WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cs-veiculo-checklist-lembretes');
--   END IF;
-- END $$;
-- DROP TRIGGER IF EXISTS trg_cs_veic_zchecklist ON public.cs_veiculo_agendamento;
-- DROP POLICY IF EXISTS "cs veiculos checklist select" ON storage.objects;
-- DROP POLICY IF EXISTS "cs veiculos checklist insert" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.cs_veiculo_checklist_lembretes();
-- DROP FUNCTION IF EXISTS public.cs_veiculo_checklist_salvar(uuid, text, timestamptz, integer, jsonb, text);
-- DROP FUNCTION IF EXISTS public.cs_veic_checklist_ao_agendar();
-- DROP FUNCTION IF EXISTS public.cs_veic_checklist_avisar(uuid, text);
-- DROP FUNCTION IF EXISTS public.cs_veic_checklist_pode_arquivo(text);
-- DROP FUNCTION IF EXISTS public.cs_veic_checklist_veiculo_e_data(uuid);
-- DROP FUNCTION IF EXISTS public.cs_veic_checklist_o_que_falta(boolean, boolean);
-- DROP FUNCTION IF EXISTS public.cs_veic_checklist_pendencias(uuid, timestamptz);
-- DROP TABLE IF EXISTS public."CS_VEICULO_CHECKLIST_LEMBRETE";
-- DROP TABLE IF EXISTS public."CS_VEICULO_CHECKLIST";
-- ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN IF EXISTS checklist_pendente_ao_agendar,
--   DROP COLUMN IF EXISTS checklist_exigido, DROP COLUMN IF EXISTS chegada_prevista;
-- DROP INDEX IF EXISTS public.idx_cs_veic_agend_checklist;
-- NOTIFY pgrst, 'reload schema';
-- (o bucket cs-veiculos-checklist fica: apagar exige esvaziar antes.)
