-- =========================================================================
-- RH › DOCUMENTOS — TIPO da solicitação, ASSINATURA no card e TERMO DE
-- CIÊNCIA no login (22/10/2026). Continua a mig 20261019000040.
--
-- PEDIDO (Pablo): ao criar a solicitação, TIPO obrigatório, com 3 opções:
--   · registro   — só registra e guarda o documento; não pede nada de
--                  ninguém. Nasce CONCLUÍDA e não notifica o destinatário.
--   · assinatura — o destinatário (encarregado ou usuário) ASSINA o card.
--                  Fica pendente até ele assinar; é notificado no sino.
--   · ciencia    — termo de ciência: toda vez que o destinatário entra no
--                  sistema aparece a janela pedindo a assinatura, até ele
--                  assinar (GateTermoCiencia.tsx, montado no AppShell).
-- E: "cada pessoa pode salvar uma assinatura padrão na conta ou desenhar na
-- hora"; imagens no termo e nos outros tipos aparecem no card e na janela
-- de assinatura (as imagens são anexos comuns — image/* no mesmo bucket
-- rh-documentos; nada muda no storage).
--
-- O QUE JÁ EXISTIA VIRA 'anexo'
--   As solicitações de antes desta migration seguem o fluxo antigo
--   (destinatário anexa o documento assinado e envia — rh_doc_concluir).
--   Mudar o jeito de concluir uma pendente no meio do caminho só confundiria
--   quem já recebeu; 'anexo' não é oferecido na criação.
--
-- ASSINATURA PADRÃO DA CONTA — "USUARIO_ASSINATURA"
--   Mesmo formato da TRN_ASSINATURA de Treinamentos (mig 20261005000003 /
--   20261006000002): tipo 'desenho' (PNG em data URL, ≤ 400 mil caracteres)
--   ou 'texto' (texto + fonte cursiva + tamanho 0,6–1,4), e pelo mesmo
--   motivo o PNG mora NA TABELA e não num bucket. Não é a mesma tabela de
--   propósito: TRN_ASSINATURA é a lista de assinaturas de TREINADOR que vão
--   no certificado (seletor do curso, menu treinamentos_assinaturas) —
--   assinatura pessoal de cada usuário ali apareceria como treinador.
--   O reaproveitamento é no formato, no componente (QuadroAssinatura, que
--   saiu do AssinaturaEditor para src/components/assinatura/) e num atalho:
--   quem é treinador e ainda não salvou a da conta recebe a assinatura de
--   Treinamentos dele como padrão (usuario_assinatura_padrao).
--   Cada um só lê e grava a própria; escrita só pelas RPCs.
--
-- ASSINATURA GRAVADA — "RH_DOCUMENTO_ASSINATURA"
--   Cópia da assinatura no momento em que foi feita (trocar a padrão depois
--   não reescreve documento assinado), com quem (user_id + nome) e quando.
--   Uma linha por assinatura: se o RH devolver e a pessoa assinar de novo,
--   a anterior fica no histórico. Leitura = quem vê a solicitação.
--
-- PERMISSÕES — nenhuma nova. Criar continua rh_documentos/incluir; assinar
-- é do destinatário pela pessoa (como anexar), sem exigir menu — o termo de
-- ciência chega a qualquer usuário. O link da notificação vai para
-- Encarregados › Documentos só se a pessoa tem esse menu; senão abre a
-- solicitação por cima da tela inicial (/app?documento=<id>).
--
-- Idempotente. ROLLBACK no fim do arquivo.
-- =========================================================================

-- ── 1) Tipo da solicitação ───────────────────────────────────────────────
ALTER TABLE public."RH_DOCUMENTO_SOLICITACAO" ADD COLUMN IF NOT EXISTS tipo text;
UPDATE public."RH_DOCUMENTO_SOLICITACAO" SET tipo = 'anexo' WHERE tipo IS NULL;
ALTER TABLE public."RH_DOCUMENTO_SOLICITACAO" ALTER COLUMN tipo SET NOT NULL;
ALTER TABLE public."RH_DOCUMENTO_SOLICITACAO" DROP CONSTRAINT IF EXISTS rds_tipo_chk;
ALTER TABLE public."RH_DOCUMENTO_SOLICITACAO" ADD CONSTRAINT rds_tipo_chk
  CHECK (tipo IN ('registro', 'assinatura', 'ciencia', 'anexo'));
-- O termo de ciência é procurado a cada entrada no sistema.
CREATE INDEX IF NOT EXISTS idx_rds_ciencia_pendente ON public."RH_DOCUMENTO_SOLICITACAO"(destinatario_id)
  WHERE tipo = 'ciencia' AND status = 'pendente';

-- ── 2) Regra da assinatura (a mesma do CHECK da TRN_ASSINATURA) ──────────
-- Devolve o que está errado, ou NULL. Usada pelas RPCs para dar mensagem
-- legível antes de o CHECK estourar. Mudar junto com problemaAssinaturaPessoal
-- (src/lib/rh/documentosSolicitados.ts).
CREATE OR REPLACE FUNCTION public.usuario_assinatura_problema(_tipo text, _imagem text, _texto text, _fonte text, _tamanho numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN _tipo = 'desenho' THEN CASE
      WHEN coalesce(_imagem, '') NOT LIKE 'data:image/png;base64,%' THEN 'Desenhe a assinatura no quadro.'
      WHEN length(_imagem) > 400000 THEN 'A assinatura ficou grande demais — limpe e desenhe de novo.' END
    WHEN _tipo = 'texto' THEN CASE
      WHEN length(btrim(coalesce(_texto, ''))) < 2 THEN 'Escreva a assinatura.'
      WHEN coalesce(_fonte, '') = '' THEN 'Escolha a letra da assinatura.'
      WHEN coalesce(_tamanho, 1) NOT BETWEEN 0.6 AND 1.4 THEN 'Tamanho da letra fora do permitido.' END
    ELSE 'Assinatura inválida.'
  END
$$;
REVOKE ALL ON FUNCTION public.usuario_assinatura_problema(text, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_assinatura_problema(text, text, text, text, numeric) TO authenticated;

-- ── 3) Assinatura padrão da conta ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."USUARIO_ASSINATURA" (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('desenho', 'texto')),
  imagem      text,
  texto       text,
  fonte       text,
  tamanho     numeric(3,2) NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuario_assinatura_valida CHECK (public.usuario_assinatura_problema(tipo, imagem, texto, fonte, tamanho) IS NULL)
);
DROP TRIGGER IF EXISTS trg_usuario_assinatura_updated ON public."USUARIO_ASSINATURA";
CREATE TRIGGER trg_usuario_assinatura_updated BEFORE UPDATE ON public."USUARIO_ASSINATURA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public."USUARIO_ASSINATURA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."USUARIO_ASSINATURA" FROM PUBLIC, anon;
GRANT SELECT ON public."USUARIO_ASSINATURA" TO authenticated;
DROP POLICY IF EXISTS usuario_assinatura_sel ON public."USUARIO_ASSINATURA";
CREATE POLICY usuario_assinatura_sel ON public."USUARIO_ASSINATURA" FOR SELECT TO authenticated USING (user_id = auth.uid());

-- A padrão de quem está logado: a da conta; senão, a assinatura ATIVA de
-- treinador dele em Treinamentos (TRN_ASSINATURA.usuario_id). NULL = nenhuma.
CREATE OR REPLACE FUNCTION public.usuario_assinatura_padrao()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('origem', 'conta', 'tipo', u.tipo, 'imagem', u.imagem, 'texto', u.texto,
                               'fonte', u.fonte, 'tamanho', u.tamanho, 'atualizada_em', u.updated_at)
       FROM public."USUARIO_ASSINATURA" u WHERE u.user_id = auth.uid()),
    (SELECT jsonb_build_object('origem', 'treinamentos', 'tipo', t.tipo, 'imagem', t.imagem, 'texto', t.texto,
                               'fonte', t.fonte, 'tamanho', t.tamanho, 'atualizada_em', t.updated_at)
       FROM public."TRN_ASSINATURA" t
      WHERE t.usuario_id = auth.uid() AND t.ativo AND auth.uid() IS NOT NULL
        AND public.usuario_assinatura_problema(t.tipo, t.imagem, t.texto, t.fonte, t.tamanho) IS NULL
      ORDER BY t.updated_at DESC LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.usuario_assinatura_padrao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_assinatura_padrao() TO authenticated;

-- Grava (ou troca) a padrão da conta. p = {tipo, imagem, texto, fonte, tamanho}.
CREATE OR REPLACE FUNCTION public.usuario_assinatura_salvar(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tipo text := p->>'tipo';
  v_img  text := NULLIF(p->>'imagem', '');
  v_txt  text := NULLIF(btrim(p->>'texto'), '');
  v_fon  text := NULLIF(p->>'fonte', '');
  v_tam  numeric := coalesce(NULLIF(p->>'tamanho', '')::numeric, 1);
  v_erro text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre no sistema.' USING ERRCODE = '42501'; END IF;
  v_erro := public.usuario_assinatura_problema(v_tipo, v_img, v_txt, v_fon, v_tam);
  IF v_erro IS NOT NULL THEN RAISE EXCEPTION '%', v_erro; END IF;
  INSERT INTO public."USUARIO_ASSINATURA" (user_id, tipo, imagem, texto, fonte, tamanho)
  VALUES (auth.uid(), v_tipo,
          CASE WHEN v_tipo = 'desenho' THEN v_img END,
          CASE WHEN v_tipo = 'texto' THEN v_txt END,
          CASE WHEN v_tipo = 'texto' THEN v_fon END,
          CASE WHEN v_tipo = 'texto' THEN v_tam ELSE 1 END)
  ON CONFLICT (user_id) DO UPDATE
    SET tipo = EXCLUDED.tipo, imagem = EXCLUDED.imagem, texto = EXCLUDED.texto,
        fonte = EXCLUDED.fonte, tamanho = EXCLUDED.tamanho;
END $fn$;
REVOKE ALL ON FUNCTION public.usuario_assinatura_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_assinatura_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.usuario_assinatura_remover()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public."USUARIO_ASSINATURA" WHERE user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.usuario_assinatura_remover() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_assinatura_remover() TO authenticated;

-- ── 4) Assinatura gravada na solicitação ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public."RH_DOCUMENTO_ASSINATURA" (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  solicitacao_id  bigint NOT NULL REFERENCES public."RH_DOCUMENTO_SOLICITACAO"(id) ON DELETE CASCADE,
  user_id         uuid   NOT NULL DEFAULT auth.uid(),
  nome            text,
  tipo            text   NOT NULL CHECK (tipo IN ('desenho', 'texto')),
  imagem          text,
  texto           text,
  fonte           text,
  tamanho         numeric(3,2) NOT NULL DEFAULT 1,
  -- Termo de ciência: a frase que a pessoa assinou, como estava na hora.
  declaracao      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rh_documento_assinatura_valida CHECK (public.usuario_assinatura_problema(tipo, imagem, texto, fonte, tamanho) IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_rdass_solicitacao ON public."RH_DOCUMENTO_ASSINATURA"(solicitacao_id, created_at DESC);

ALTER TABLE public."RH_DOCUMENTO_ASSINATURA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."RH_DOCUMENTO_ASSINATURA" FROM PUBLIC, anon;
GRANT SELECT ON public."RH_DOCUMENTO_ASSINATURA" TO authenticated;
DROP POLICY IF EXISTS rdass_sel ON public."RH_DOCUMENTO_ASSINATURA";
CREATE POLICY rdass_sel ON public."RH_DOCUMENTO_ASSINATURA" FOR SELECT TO authenticated USING (public.rh_doc_pode_ver(solicitacao_id));

-- ── 5) Anexar: registro concluído continua recebendo arquivo do RH ───────
-- Registro nasce concluído (não espera ninguém), mas o RH precisa conseguir
-- subir o documento e as imagens depois de criar — e acrescentar mais tarde.
CREATE OR REPLACE FUNCTION public.rh_doc_pode_anexar(_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public."RH_DOCUMENTO_SOLICITACAO" s
                  WHERE s.id = _id
                    AND ((s.status = 'pendente'
                          AND (s.destinatario_id = auth.uid()
                               OR public.rh_doc_pode('incluir') OR public.rh_doc_pode('alterar')))
                      OR (s.tipo = 'registro' AND s.status = 'concluida'
                          AND (public.rh_doc_pode('incluir') OR public.rh_doc_pode('alterar')))))
$$;

-- Para onde a notificação leva o destinatário: a tela dos Encarregados se
-- ele tem o menu; senão a solicitação abre por cima da tela inicial
-- (GateTermoCiencia lê ?documento=). 'anexo' precisa da tela para anexar.
CREATE OR REPLACE FUNCTION public.rh_doc_link_destinatario(_dest uuid, _id bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN public.can_access(_dest, 'encarregados_documentos', 'visualizar'::public.app_acao)
              THEN '/app/encarregados/documentos?s=' ELSE '/app?documento=' END || _id
$$;
REVOKE ALL ON FUNCTION public.rh_doc_link_destinatario(uuid, bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rh_doc_rotulo_tipo(_tipo text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE _tipo WHEN 'registro' THEN 'Registro' WHEN 'assinatura' THEN 'Assinatura'
                    WHEN 'ciencia' THEN 'Termo de ciência' ELSE 'Devolver anexado' END
$$;

-- ── 6) Solicitar (com tipo) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_doc_solicitar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tipo text := NULLIF(btrim(p->>'tipo'), '');
  v_tit  text := NULLIF(btrim(p->>'titulo'), '');
  v_desc text := NULLIF(btrim(p->>'descricao'), '');
  v_emp  bigint := NULLIF(p->>'contrato_empresa', '')::bigint;
  v_fil  bigint := NULLIF(p->>'contrato_filial', '')::bigint;
  v_dest uuid := NULLIF(p->>'destinatario_id', '')::uuid;
  v_prazo date := NULLIF(p->>'prazo', '')::date;
  v_d    record;
  v_eu   text := public.rh_doc_nome_usuario(auth.uid());
  v_id   bigint;
BEGIN
  IF NOT public.rh_doc_pode('incluir') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar documentos.' USING ERRCODE = '42501';
  END IF;
  -- 'anexo' é só das solicitações antigas: não se cria mais.
  IF v_tipo IS NULL OR v_tipo NOT IN ('registro', 'assinatura', 'ciencia') THEN
    RAISE EXCEPTION 'Escolha o tipo: Registro, Assinatura ou Termo de ciência.';
  END IF;
  IF v_tit IS NULL THEN RAISE EXCEPTION 'Informe o título.'; END IF;
  IF v_desc IS NULL THEN RAISE EXCEPTION 'Descreva o que está sendo solicitado.'; END IF;
  IF (v_emp IS NULL) <> (v_fil IS NULL) THEN RAISE EXCEPTION 'Contrato incompleto.'; END IF;
  SELECT * INTO v_d FROM public.rh_doc_validar_destino(v_emp, v_fil, v_dest);
  -- Registro não espera ninguém: prazo não faz sentido.
  IF v_tipo = 'registro' THEN v_prazo := NULL; END IF;

  INSERT INTO public."RH_DOCUMENTO_SOLICITACAO"
    (tipo, titulo, descricao, contrato_empresa, contrato_filial, contrato_nome, destinatario_id, destinatario_nome,
     destinatario_empregado_id, solicitante_nome, prazo, status, concluida_em, concluida_por)
  VALUES (v_tipo, v_tit, v_desc, v_emp, v_fil, v_d.contrato_nome, v_dest, v_d.nome, v_d.empregado_id, v_eu, v_prazo,
          CASE WHEN v_tipo = 'registro' THEN 'concluida' ELSE 'pendente' END,
          CASE WHEN v_tipo = 'registro' THEN now() END,
          CASE WHEN v_tipo = 'registro' THEN v_eu END)
  RETURNING id INTO v_id;

  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (v_id, 'criada',
          public.rh_doc_rotulo_tipo(v_tipo) || ' — para ' || coalesce(v_d.nome, '—') || coalesce(' — ' || v_d.contrato_nome, ''),
          v_eu, 'rh');

  IF v_tipo <> 'registro' THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (v_dest,
            CASE v_tipo WHEN 'ciencia' THEN 'Termo de ciência para assinar' ELSE 'Documento para assinar' END,
            v_tit || coalesce(' — ' || v_d.contrato_nome, '') || coalesce('. Prazo: ' || to_char(v_prazo, 'DD/MM/YYYY'), '') || '.',
            'rh_documento_solicitado', public.rh_doc_link_destinatario(v_dest, v_id));
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_doc_solicitar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_doc_solicitar(jsonb) TO authenticated;

-- ── 7) Assinar (assinatura e termo de ciência) ───────────────────────────
-- p = {tipo, imagem, texto, fonte, tamanho, salvar_padrao, observacao}.
-- A tela manda a assinatura padrão já carregada ou o desenho feito na hora;
-- salvar_padrao=true grava o desenho como a padrão da conta.
CREATE OR REPLACE FUNCTION public.rh_doc_assinar(p_id bigint, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_s    public."RH_DOCUMENTO_SOLICITACAO";
  v_tipo text := p->>'tipo';
  v_img  text := NULLIF(p->>'imagem', '');
  v_txt  text := NULLIF(btrim(p->>'texto'), '');
  v_fon  text := NULLIF(p->>'fonte', '');
  v_tam  numeric := coalesce(NULLIF(p->>'tamanho', '')::numeric, 1);
  v_obs  text := NULLIF(btrim(p->>'observacao'), '');
  v_eu   text := public.rh_doc_nome_usuario(auth.uid());
  v_erro text;
  v_decl text;
BEGIN
  SELECT * INTO v_s FROM public."RH_DOCUMENTO_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_s.destinatario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só o destinatário assina o documento.' USING ERRCODE = '42501';
  END IF;
  IF v_s.tipo NOT IN ('assinatura', 'ciencia') THEN
    RAISE EXCEPTION 'Este documento não pede assinatura.';
  END IF;
  IF v_s.status <> 'pendente' THEN RAISE EXCEPTION 'O documento não está pendente (está %).', v_s.status; END IF;
  v_erro := public.usuario_assinatura_problema(v_tipo, v_img, v_txt, v_fon, v_tam);
  IF v_erro IS NOT NULL THEN RAISE EXCEPTION '%', v_erro; END IF;

  IF v_s.tipo = 'ciencia' THEN
    v_decl := 'Declaro que li e estou ciente do termo "' || v_s.titulo || '".';
  END IF;
  INSERT INTO public."RH_DOCUMENTO_ASSINATURA" (solicitacao_id, nome, tipo, imagem, texto, fonte, tamanho, declaracao)
  VALUES (p_id, v_eu, v_tipo,
          CASE WHEN v_tipo = 'desenho' THEN v_img END,
          CASE WHEN v_tipo = 'texto' THEN v_txt END,
          CASE WHEN v_tipo = 'texto' THEN v_fon END,
          CASE WHEN v_tipo = 'texto' THEN v_tam ELSE 1 END,
          v_decl);

  IF coalesce((p->>'salvar_padrao')::boolean, false) THEN
    PERFORM public.usuario_assinatura_salvar(p - 'salvar_padrao' - 'observacao');
  END IF;

  UPDATE public."RH_DOCUMENTO_SOLICITACAO"
     SET status = 'concluida', concluida_em = now(), concluida_por = v_eu, observacao_envio = v_obs
   WHERE id = p_id;
  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (p_id, 'assinada', coalesce(v_decl, v_obs), v_eu, 'destinatario');
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (v_s.solicitante_id,
          CASE v_s.tipo WHEN 'ciencia' THEN 'Termo de ciência assinado' ELSE 'Documento assinado' END,
          v_s.titulo || ' — ' || coalesce(v_eu, '') || coalesce(' — ' || v_s.contrato_nome, '') || coalesce('. Obs.: ' || left(v_obs, 200), ''),
          'rh_documento_concluido', '/app/rh/documentos?s=' || p_id);
END $fn$;
REVOKE ALL ON FUNCTION public.rh_doc_assinar(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_doc_assinar(bigint, jsonb) TO authenticated;

-- ── 8) Concluir anexando: só o fluxo antigo ('anexo') ────────────────────
CREATE OR REPLACE FUNCTION public.rh_doc_concluir(p_id bigint, p_observacao text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_s   public."RH_DOCUMENTO_SOLICITACAO";
  v_obs text := NULLIF(btrim(p_observacao), '');
  v_eu  text := public.rh_doc_nome_usuario(auth.uid());
BEGIN
  SELECT * INTO v_s FROM public."RH_DOCUMENTO_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_s.destinatario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só o destinatário envia o documento.' USING ERRCODE = '42501';
  END IF;
  IF v_s.tipo <> 'anexo' THEN RAISE EXCEPTION 'Este documento se conclui assinando, não anexando.'; END IF;
  IF v_s.status <> 'pendente' THEN RAISE EXCEPTION 'A solicitação não está pendente (está %).', v_s.status; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."RH_DOCUMENTO_ANEXO" WHERE solicitacao_id = p_id AND origem = 'destinatario') THEN
    RAISE EXCEPTION 'Anexe o documento antes de enviar.';
  END IF;
  UPDATE public."RH_DOCUMENTO_SOLICITACAO"
     SET status = 'concluida', concluida_em = now(), concluida_por = v_eu, observacao_envio = v_obs
   WHERE id = p_id;
  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (p_id, 'concluida', v_obs, v_eu, 'destinatario');
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (v_s.solicitante_id, 'Documento devolvido assinado',
          v_s.titulo || ' — ' || coalesce(v_eu, '') || coalesce(' — ' || v_s.contrato_nome, '') || coalesce('. Obs.: ' || left(v_obs, 200), ''),
          'rh_documento_concluido', '/app/rh/documentos?s=' || p_id);
END $fn$;

-- ── 9) Mensagem, devolver, reencaminhar, cancelar: link certo ────────────
-- Mesmo corpo da mig 20261019000040; muda o link para o destinatário
-- (rh_doc_link_destinatario) e devolver não vale para registro.
CREATE OR REPLACE FUNCTION public.rh_doc_mensagem(p_id bigint, p_texto text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_s   public."RH_DOCUMENTO_SOLICITACAO";
  v_txt text := NULLIF(btrim(p_texto), '');
  v_eu  text := public.rh_doc_nome_usuario(auth.uid());
  v_dest boolean;
BEGIN
  SELECT * INTO v_s FROM public."RH_DOCUMENTO_SOLICITACAO" WHERE id = p_id;
  IF NOT FOUND OR NOT public.rh_doc_pode_ver(p_id) THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_txt IS NULL THEN RAISE EXCEPTION 'Escreva a mensagem.'; END IF;
  v_dest := v_s.destinatario_id = auth.uid();
  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (p_id, 'mensagem', v_txt, v_eu, CASE WHEN v_dest THEN 'destinatario' ELSE 'rh' END);
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (CASE WHEN v_dest THEN v_s.solicitante_id ELSE v_s.destinatario_id END,
          'Mensagem em documento solicitado', v_s.titulo || ' — ' || coalesce(v_eu, '') || ': ' || left(v_txt, 200),
          'rh_documento_mensagem',
          CASE WHEN v_dest THEN '/app/rh/documentos?s=' || p_id ELSE public.rh_doc_link_destinatario(v_s.destinatario_id, p_id) END);
END $fn$;

CREATE OR REPLACE FUNCTION public.rh_doc_devolver(p_id bigint, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_s   public."RH_DOCUMENTO_SOLICITACAO";
  v_mot text := NULLIF(btrim(p_motivo), '');
  v_eu  text := public.rh_doc_nome_usuario(auth.uid());
BEGIN
  IF NOT public.rh_doc_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF v_mot IS NULL THEN RAISE EXCEPTION 'Informe o motivo da devolução.'; END IF;
  SELECT * INTO v_s FROM public."RH_DOCUMENTO_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_s.tipo = 'registro' THEN RAISE EXCEPTION 'Registro não volta ao destinatário: não há o que ele fazer.'; END IF;
  IF v_s.status <> 'concluida' THEN RAISE EXCEPTION 'Só solicitação concluída pode ser devolvida.'; END IF;
  UPDATE public."RH_DOCUMENTO_SOLICITACAO"
     SET status = 'pendente', concluida_em = NULL, concluida_por = NULL
   WHERE id = p_id;
  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (p_id, 'devolvida', v_mot, v_eu, 'rh');
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (v_s.destinatario_id, 'Documento devolvido pelo RH',
          v_s.titulo || '. Motivo: ' || left(v_mot, 200) || CASE WHEN v_s.tipo = 'anexo' THEN '. Corrija e envie de novo.' ELSE '. Assine de novo.' END,
          'rh_documento_devolvido', public.rh_doc_link_destinatario(v_s.destinatario_id, p_id));
END $fn$;

CREATE OR REPLACE FUNCTION public.rh_doc_reencaminhar(p_id bigint, p_destinatario uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_s   public."RH_DOCUMENTO_SOLICITACAO";
  v_d   record;
  v_eu  text := public.rh_doc_nome_usuario(auth.uid());
BEGIN
  IF NOT public.rh_doc_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_s FROM public."RH_DOCUMENTO_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_s.status <> 'pendente' THEN RAISE EXCEPTION 'Só solicitação pendente pode ser reencaminhada.'; END IF;
  IF p_destinatario = v_s.destinatario_id THEN RAISE EXCEPTION 'Essa pessoa já é a destinatária.'; END IF;
  SELECT * INTO v_d FROM public.rh_doc_validar_destino(v_s.contrato_empresa, v_s.contrato_filial, p_destinatario);
  UPDATE public."RH_DOCUMENTO_SOLICITACAO"
     SET destinatario_id = p_destinatario, destinatario_nome = v_d.nome, destinatario_empregado_id = v_d.empregado_id
   WHERE id = p_id;
  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (p_id, 'reencaminhada',
          'De ' || coalesce(v_s.destinatario_nome, '—') || ' para ' || coalesce(v_d.nome, '—') || coalesce('. ' || NULLIF(btrim(p_motivo), ''), ''),
          v_eu, 'rh');
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (p_destinatario,
          CASE v_s.tipo WHEN 'ciencia' THEN 'Termo de ciência para assinar' WHEN 'assinatura' THEN 'Documento para assinar' ELSE 'Documento solicitado pelo RH' END,
          v_s.titulo || coalesce(' — ' || v_s.contrato_nome, '') || ' (reencaminhado a você).',
          'rh_documento_solicitado', public.rh_doc_link_destinatario(p_destinatario, p_id));
END $fn$;

CREATE OR REPLACE FUNCTION public.rh_doc_cancelar(p_id bigint, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_s   public."RH_DOCUMENTO_SOLICITACAO";
  v_mot text := NULLIF(btrim(p_motivo), '');
  v_eu  text := public.rh_doc_nome_usuario(auth.uid());
BEGIN
  IF NOT public.rh_doc_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF v_mot IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;
  SELECT * INTO v_s FROM public."RH_DOCUMENTO_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_s.status <> 'pendente' THEN RAISE EXCEPTION 'Só solicitação pendente pode ser cancelada.'; END IF;
  UPDATE public."RH_DOCUMENTO_SOLICITACAO"
     SET status = 'cancelada', cancelada_em = now(), cancelada_por = v_eu, cancelamento_motivo = v_mot
   WHERE id = p_id;
  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (p_id, 'cancelada', v_mot, v_eu, 'rh');
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (v_s.destinatario_id, 'Solicitação de documento cancelada', v_s.titulo || '. Motivo: ' || left(v_mot, 200),
          'rh_documento_cancelado', public.rh_doc_link_destinatario(v_s.destinatario_id, p_id));
END $fn$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar, da mig 20261019000040, rh_doc_pode_anexar, rh_doc_solicitar,
-- rh_doc_concluir, rh_doc_mensagem, rh_doc_devolver, rh_doc_reencaminhar e
-- rh_doc_cancelar (sem tipo e com o link fixo de Encarregados). Depois:
-- DROP FUNCTION IF EXISTS public.rh_doc_assinar(bigint, jsonb), public.rh_doc_link_destinatario(uuid, bigint),
--   public.rh_doc_rotulo_tipo(text), public.usuario_assinatura_padrao(), public.usuario_assinatura_salvar(jsonb),
--   public.usuario_assinatura_remover();
-- DROP TABLE IF EXISTS public."RH_DOCUMENTO_ASSINATURA", public."USUARIO_ASSINATURA";
-- DROP FUNCTION IF EXISTS public.usuario_assinatura_problema(text, text, text, text, numeric);
-- DROP INDEX IF EXISTS public.idx_rds_ciencia_pendente;
-- ALTER TABLE public."RH_DOCUMENTO_SOLICITACAO" DROP CONSTRAINT IF EXISTS rds_tipo_chk;
-- ALTER TABLE public."RH_DOCUMENTO_SOLICITACAO" DROP COLUMN IF EXISTS tipo;
