-- =====================================================================
-- SIS-2026-0791 (Carlos Fergutz, OPERACIONAL, 30/10/2026) — "PODER AJUSTAR
-- OS VALORES QUANDO SOLICITADO AJUSTE. PODENDO AJUSTAR NÃO SERÁ NECESSÁRIO
-- O CANCELAMENTO DA DIÁRIA E SIM FEITO O AJUSTE."
--
-- O ajuste do pedido é o DO MALOTE: a despesa já nasceu e o aprovador a
-- devolveu como 'necessidade_de_ajuste'. Aí a pessoa descobre o beco sem
-- saída que existe desde que o módulo nasceu:
--
--   * diaria_ufrgs_enviar_malote deixa a diária 'aprovada' com
--     malote_despesa_id (20260930000237, seção 4);
--   * diaria_ufrgs_editar recusa status fora de 'solicitada'/'em_ajuste';
--   * diaria_ufrgs_solicitar_ajuste só aceita 'solicitada'/'reprovada'
--     (20260930000155);
--   * e corrigir só a despesa não resolve, porque o envio amarra os dois
--     valores: "O valor da despesa deve ser igual ao valor total da diária".
--
-- Sobrava cancelar a despesa no Malote, EXCLUIR a diária e relançar tudo do
-- zero — motorista, ofício, datas, destino, posto, as cinco quantidades,
-- Pix, anexos. É o "cancelamento da diária" que o chamado pede para acabar.
--
-- Nenhuma RPC fazia o caminho de volta Malote → diária até aqui; a diária de
-- diarista também não tem (o guard da 20260930000033 só trata
-- 'solicitada' → 'aprovada'/'reprovada'). Então são duas partes:
--
-- PARTE A — diaria_ufrgs_editar passa a gravar o CONTRATO e a recalcular a
--   COMPETÊNCIA. Confirmado com o solicitante em 03/11/2026: "às vezes pode
--   ter sido selecionado o contrato errado e precisa ajustar". A tela já
--   libera o campo e o hook já manda contrato_id no payload — o UPDATE é que
--   ignorava, salvando sem erro e reabrindo com o contrato antigo. A
--   competência nascia no INSERT como o mês da saída e nunca era recalculada,
--   então ajustar a saída para outro mês deixava a diária no mês errado do
--   fechamento.
--
-- PARTE B — diaria_ufrgs_reabrir_para_ajuste(uuid, text): cancela a despesa
--   no Malote, devolve a diária para 'em_ajuste' e limpa o vínculo. Daí o
--   fluxo que já existe faz o resto: o dono corrige tudo por
--   diaria_ufrgs_editar e reenvia, gerando uma despesa NOVA.
--
-- POR QUE RPC NOVA E NÃO ESTENDER solicitar_ajuste: a ação nova cancela uma
-- despesa no módulo financeiro. Enfiar isso na ação rotineira do aprovador
-- daria a um botão de uso diário poder sobre o Malote, com a mesma permissão.
-- Nome separado = permissão separada = auditável na trilha.
-- =====================================================================

-- ── PARTE A) Editar — grava o contrato e recalcula a competência ─────
--
-- Mesmo corpo da 20260930000237 (seção 3), com o contrato acrescentado. O
-- `p_dados ? 'pix'` continua ali pelo mesmo motivo de antes: front antigo
-- sem a chave no payload não pode APAGAR a chave de uma diária que já tem.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_editar(p_dados jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d        public."DIARIA_UFRGS"%ROWTYPE;
  v_id       uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_mat      text := NULLIF(btrim(coalesce(p_dados->>'matricula', '')), '');
  v_mot_nome text := btrim(coalesce(p_dados->>'motorista_nome', ''));
  v_mot_id   bigint := NULLIF(p_dados->>'motorista_empregado_id', '')::bigint;
  v_pix      text := NULLIF(btrim(coalesce(p_dados->>'pix', '')), '');
  v_pix_tipo text := NULLIF(btrim(coalesce(p_dados->>'pix_tipo', '')), '');
  v_contrato_id uuid := NULLIF(p_dados->>'contrato_id', '')::uuid;
  v_contrato public.contratos%ROWTYPE;
  v_empresa  text;
  v_nome     text;
  v_removidos text[] := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(p_dados->'anexos_removidos', '[]'::jsonb))
  );
BEGIN
  IF NOT public.diaria_pode('incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar diárias.';
  END IF;

  SELECT * INTO v_d FROM public."DIARIA_UFRGS" WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diária UFRGS não encontrada.';
  END IF;
  IF v_d.status NOT IN ('solicitada', 'em_ajuste') THEN
    RAISE EXCEPTION 'Uma diária % não pode mais ser editada.', v_d.status;
  END IF;
  IF v_d.status = 'em_ajuste' AND v_d.solicitante_id <> auth.uid()
     AND NOT public.diaria_decide('aprovar') THEN
    RAISE EXCEPTION 'A diária devolvida para ajuste é corrigida por quem a lançou.';
  END IF;

  PERFORM public.diaria_ufrgs_validar(p_dados);
  PERFORM public.diaria_ufrgs_validar_anexos(v_id, p_dados->'anexos_novos');

  -- O contrato só é resolvido de novo quando MUDA, e a comparação não é zelo
  -- gratuito: exigir status='ativo' em toda edição passaria a recusar o
  -- ajuste de uma diária antiga cujo contrato já foi encerrado — regressão
  -- em cima de um fluxo que funciona. Com a guarda, contrato encerrado só
  -- incomoda quem está de fato trocando de contrato.
  IF v_contrato_id IS NOT NULL AND v_contrato_id <> v_d.contrato_id THEN
    SELECT * INTO v_contrato
      FROM public.contratos c
     WHERE c.id = v_contrato_id
       AND c.status = 'ativo';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contrato ativo não encontrado.';
    END IF;
    SELECT COALESCE(e.nome_fantasia, e.razao_social) INTO v_empresa
      FROM public.empresas e WHERE e.id = v_contrato.empresa_id;
  END IF;

  IF NOT (p_dados ? 'pix') THEN
    v_pix := v_d.pix;
    v_pix_tipo := v_d.pix_tipo;
  END IF;
  IF (v_pix IS NULL) <> (v_pix_tipo IS NULL) THEN
    RAISE EXCEPTION 'Informe o tipo e a chave Pix juntos.';
  END IF;
  IF v_pix_tipo IS NOT NULL AND v_pix_tipo NOT IN ('celular', 'email', 'cpf', 'cnpj') THEN
    RAISE EXCEPTION 'Tipo de chave Pix inválido.';
  END IF;

  IF v_mot_id IS NOT NULL THEN
    SELECT e."Nome", nullif(btrim(e."Cadastro"::text), '')
      INTO v_mot_nome, v_mat
      FROM public."EMPREGADOS" e WHERE e."ID" = v_mot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Motorista não encontrado em EMPREGADOS.';
    END IF;
  END IF;

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  UPDATE public."DIARIA_UFRGS" SET
    -- As quatro colunas do contrato andam juntas: contrato_nome/cliente/
    -- empresa são cópias denormalizadas que alimentam lista, export e
    -- relatório. contrato_cliente vai por CASE e não por COALESCE porque a
    -- coluna é anulável: contrato novo SEM cliente tem que LIMPAR o valor
    -- antigo, e COALESCE manteria o do contrato anterior.
    contrato_id            = COALESCE(v_contrato.id, v_d.contrato_id),
    contrato_nome          = COALESCE(v_contrato.nome, v_d.contrato_nome),
    contrato_cliente       = CASE WHEN v_contrato.id IS NULL
                                  THEN v_d.contrato_cliente
                                  ELSE v_contrato.cliente END,
    contrato_empresa       = COALESCE(v_empresa, v_d.contrato_empresa),
    -- Mesma conta do INSERT (diaria_ufrgs_criar). Faltava aqui: ajustar a
    -- saída para outro mês deixava a diária na competência do lançamento.
    competencia            = date_trunc('month', (p_dados->>'saida')::date)::date,
    cod_fornecedor         = NULLIF(btrim(coalesce(p_dados->>'cod_fornecedor', '')), ''),
    matricula              = v_mat,
    motorista_empregado_id = v_mot_id,
    motorista_nome         = v_mot_nome,
    sindicato              = p_dados->>'sindicato',
    lotacao                = p_dados->>'lotacao',
    numero_oficio          = btrim(p_dados->>'numero_oficio'),
    saida                  = (p_dados->>'saida')::date,
    retorno                = (p_dados->>'retorno')::date,
    destino                = btrim(p_dados->>'destino'),
    posto                  = NULLIF(p_dados->>'posto', ''),
    valor_posto_variavel_centavos = COALESCE((p_dados->>'valor_posto_variavel_centavos')::bigint, 0),
    qt_hospedagem          = COALESCE((p_dados->>'qt_hospedagem')::int, 0),
    qt_cafe                = COALESCE((p_dados->>'qt_cafe')::int, 0),
    qt_almoco              = COALESCE((p_dados->>'qt_almoco')::int, 0),
    qt_janta               = COALESCE((p_dados->>'qt_janta')::int, 0),
    qt_va                  = COALESCE((p_dados->>'qt_va')::int, 0),
    pix                    = v_pix,
    pix_tipo               = v_pix_tipo,
    observacoes            = NULLIF(btrim(coalesce(p_dados->>'observacoes', '')), ''),
    -- Reenviar depois do ajuste devolve a diária para a fila. A decisão
    -- anterior sai de cena; quem devolveu e por quê continua na trilha.
    status                 = CASE WHEN v_d.status = 'em_ajuste' THEN 'solicitada' ELSE v_d.status END,
    ajuste_motivo          = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_motivo END,
    ajuste_pedido_por      = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_pedido_por END,
    ajuste_pedido_por_nome = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_pedido_por_nome END,
    ajuste_pedido_em       = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_pedido_em END
  WHERE id = v_id;

  -- A trilha automática (diaria_ufrgs_evento_auto) registra 'editada'
  -- genérico. Trocar de contrato muda a EMPRESA e o orçamento onde a despesa
  -- vai nascer, então o de antes e o de agora ficam nomeados: é o dado que o
  -- Financeiro vai querer quando a despesa reaparecer em outra empresa.
  IF v_contrato.id IS NOT NULL THEN
    SELECT COALESCE(p.display_name, p.email) INTO v_nome
      FROM public.profiles p WHERE p.id = auth.uid();
    INSERT INTO public."DIARIA_UFRGS_EVENTO" (diaria_id, tipo, descricao, autor_id, autor_nome)
    VALUES (v_id, 'contrato_alterado',
            'Contrato alterado de "' || COALESCE(v_d.contrato_nome, '(sem nome)') ||
            '" para "' || COALESCE(v_contrato.nome, '(sem nome)') || '".',
            auth.uid(), v_nome);
  END IF;

  DELETE FROM public."DIARIA_UFRGS_ANEXO"
   WHERE diaria_id = v_id AND storage_path = ANY (v_removidos);

  INSERT INTO public."DIARIA_UFRGS_ANEXO" (
    diaria_id, storage_path, nome_arquivo, mime_type, tamanho_bytes
  )
  SELECT v_id, a->>'storage_path', a->>'nome_arquivo',
         NULLIF(a->>'mime_type', ''), NULLIF(a->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(COALESCE(p_dados->'anexos_novos', '[]'::jsonb)) a;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_editar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_editar(jsonb) TO authenticated;

-- ── PARTE B) Reabrir para ajuste — o caminho de volta do Malote ──────
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_reabrir_para_ajuste(
  p_diaria_id uuid,
  p_motivo    text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d       public."DIARIA_UFRGS"%ROWTYPE;
  v_despesa public.malote_despesa%ROWTYPE;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_nome    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada.';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Diga o que precisa ser ajustado — é o que o solicitante vai ler.';
  END IF;

  SELECT * INTO v_d FROM public."DIARIA_UFRGS" WHERE id = p_diaria_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diária UFRGS não encontrada.';
  END IF;
  IF v_d.status <> 'aprovada' OR v_d.malote_despesa_id IS NULL THEN
    RAISE EXCEPTION 'Só uma diária já enviada ao Malote é reaberta por aqui (esta está %).', v_d.status;
  END IF;

  SELECT * INTO v_despesa
    FROM public.malote_despesa WHERE id = v_d.malote_despesa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A despesa do Malote ligada a esta diária não foi encontrada.';
  END IF;

  -- Quem mandou para o Malote (Controladoria) OU quem recebe o pedido de
  -- ajuste de volta — o created_by da despesa, pela regra do SIS-2026-0378
  -- (20260930000089). Fora disso, não reabre.
  IF NOT public.diaria_decide('enviar_malote')
     AND v_despesa.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só quem enviou a diária ao Malote pode reabri-la para ajuste.';
  END IF;

  -- Despesa paga não reabre: desfazer pagamento é estorno no Financeiro, não
  -- ajuste de diária. O corte é o status terminal + a coluna computada que a
  -- lista já usa para mostrar a diária como "paga" (20260930000151).
  IF v_despesa.status IN ('despesa_paga', 'cancelada')
     OR public.malote_despesa_paga(v_d) THEN
    RAISE EXCEPTION 'A despesa do Malote está % — reabrir a diária não é o caminho.',
      v_despesa.status;
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  -- 1) A despesa sai de cena. Mesmo efeito do cancelamento manual que hoje
  --    se faz na tela do Malote (a RLS da 20260930000027 já permite ao
  --    created_by), então rateio e parcelas seguem a despesa cancelada —
  --    nada de caminho novo no financeiro.
  UPDATE public.malote_despesa
     SET status = 'cancelada'
   WHERE id = v_despesa.id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_despesa.id, 'cancelamento', auth.uid(),
          'Cancelada para reabrir a diária UFRGS ' ||
          COALESCE(v_d.numero, v_d.id::text) || ' para ajuste: ' || v_motivo);

  -- 2) A diária destrava. Limpar o vínculo é obrigatório, não cosmético:
  --    sem isso ela reenvia ao Malote carregando o id de uma despesa morta.
  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  UPDATE public."DIARIA_UFRGS"
     SET status                 = 'em_ajuste',
         ajuste_motivo          = v_motivo,
         ajuste_pedido_por      = auth.uid(),
         ajuste_pedido_por_nome = v_nome,
         ajuste_pedido_em       = now(),
         malote_despesa_id      = NULL,
         enviado_malote_em      = NULL,
         malote_motivo          = NULL,
         malote_data_pagamento  = NULL,
         decidido_por           = NULL,
         decidido_por_nome      = NULL,
         decidido_em            = NULL
   WHERE id = p_diaria_id;

  -- O evento 'em_ajuste' sai de graça no diaria_ufrgs_evento_auto; o que
  -- falta na trilha é o destino da despesa.
  INSERT INTO public."DIARIA_UFRGS_EVENTO" (diaria_id, tipo, descricao, autor_id, autor_nome)
  VALUES (p_diaria_id, 'malote_cancelado',
          'Despesa ' || COALESCE(v_despesa.numero::text, v_despesa.id::text) ||
          ' cancelada no Malote para permitir o ajuste.',
          auth.uid(), v_nome);
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);

  -- O sininho global, no mesmo molde de diaria_ufrgs_solicitar_ajuste. O
  -- link leva para a rota do Operacional porque é lá que a diária UFRGS é
  -- lançada e corrigida.
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT v_d.solicitante_id,
         'Diária UFRGS reaberta para ajuste',
         'A diária ' || COALESCE(v_d.numero, '') ||
         ' voltou do Malote e precisa de ajuste: ' || v_motivo,
         'diaria_ajuste',
         '/app/operacional/diarias?tipo=ufrgs&diaria=' || p_diaria_id::text
   WHERE v_d.solicitante_id IS DISTINCT FROM auth.uid();
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_reabrir_para_ajuste(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_reabrir_para_ajuste(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_reabrir_para_ajuste(uuid, text);
--
-- E reaplicar diaria_ufrgs_editar(jsonb) exatamente como está na seção 3 da
-- migration 20260930000237_diaria_ufrgs_pix_e_valor_total_malote.sql (a
-- versão sem contrato/competência), seguida de
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
