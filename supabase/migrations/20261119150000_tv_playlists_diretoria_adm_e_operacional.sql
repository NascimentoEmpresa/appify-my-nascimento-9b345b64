-- =========================================================================
-- TVs: PLAYLISTS DA DIRETORIA ADM E DO DIRETOR OPERACIONAL (19/11/2026)
--
-- Pablo: duas playlists no modelo da "Presidência — Todos os setores"
-- (mig 20261118140000), cada uma só com os setores de uma diretoria:
--
--   · TV Diretoria ADM ........ RH, Recrutamento, SST, Financeiro e Jurídico
--   · TV Diretor Operacional .. Operacional, Compras e Licitação
--
-- Mesmo mecanismo da Presidência: itens "Outra playlist"
-- (TV_ITEM.inclui_playlist_id) apontando para as playlists que estão nas TVs
-- dos setores. Nada é copiado — mudou a playlist do setor, a da diretoria
-- acompanha sozinha. Nenhum indicador novo, nenhuma TV trocada (escolher a
-- TV é na tela Sistemas › TV's). O Filtro de Natal (TV_CONFIG, mig
-- 20261119060000) é global e chega pelo tv_estado: vale aqui sem mexer.
--
-- Quais playlists (as que as TVs dos setores tocam em 18/11/2026):
--   RH + Recrutamento → "Recrutamento e Seleção" (é a TV RH: painel do
--                        Recrutamento, Recursos Humanos e Salários ×
--                        orçamento — uma playlist para os dois setores)
--   SST               → "TV SST"
--   Financeiro        → "Financeiro — Controle de Faturamento"
--   Jurídico          → "TV JURÍDICO"
--   Operacional       → "Operacional — Indicadores por Contrato"
--   Compras           → "Compras — Suprimentos"
--   Licitação         → "TV LICITAÇÃO" (o painel TV Licitações, "Painel
--                        gerencial · Diretor Operacional", com os cavalinhos)
-- Ficam de fora a Visão geral (é de todos os setores) e as playlists antigas
-- que nenhuma TV usa (TV RH, TV FINANCEIRO, TV OPERACIONAL, TV COMPRAS).
--
-- Teto de 60 s por item incluído, como na Presidência. A lista dos nomes tem
-- teste em src/test/tv-playlists-diretorias.test.ts.
-- REGRA da mig 20261118150000: nada de FK nova de TV_ITEM para TV_PLAYLIST.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

DO $$
DECLARE
  v_pl uuid; v_inc uuid; v_ordem int; v_nome text; r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('TV Diretoria ADM',
       'RH, Recrutamento, SST, Financeiro e Jurídico — passa as playlists desses setores, uma depois da outra, e acompanha sozinha quando um setor muda a sua.',
       ARRAY['Recrutamento e Seleção', 'TV SST', 'Financeiro — Controle de Faturamento', 'TV JURÍDICO']),
      ('TV Diretor Operacional',
       'Operacional, Compras e Licitação — passa as playlists desses setores, uma depois da outra, e acompanha sozinha quando um setor muda a sua.',
       ARRAY['Operacional — Indicadores por Contrato', 'Compras — Suprimentos', 'TV LICITAÇÃO'])
    ) AS t(nome, descricao, incluidas)
  LOOP
    SELECT id INTO v_pl FROM public."TV_PLAYLIST" WHERE nome = r.nome LIMIT 1;
    IF v_pl IS NULL THEN
      INSERT INTO public."TV_PLAYLIST" (nome, descricao) VALUES (r.nome, r.descricao) RETURNING id INTO v_pl;
    END IF;
    v_ordem := 0;
    FOREACH v_nome IN ARRAY r.incluidas LOOP
      v_ordem := v_ordem + 10;
      v_inc := NULL;
      SELECT id INTO v_inc FROM public."TV_PLAYLIST" WHERE nome = v_nome AND id <> v_pl LIMIT 1;
      IF v_inc IS NULL THEN
        RAISE WARNING 'TV: playlist "%" não existe — "%" fica sem ela.', v_nome, r.nome;
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pl AND inclui_playlist_id = v_inc) THEN
        INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, inclui_playlist_id, duracao_seg, ativo)
        VALUES (v_pl, v_ordem, 'playlist', v_nome, v_inc, 60, true);
      END IF;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (o gatilho trg_tv_playlist_apaga_inclusoes não se aplica aqui: os itens
--  são DA playlist apagada e saem pelo ON DELETE CASCADE de playlist_id)
-- DELETE FROM public."TV_PLAYLIST" WHERE nome IN ('TV Diretoria ADM', 'TV Diretor Operacional');
