-- =========================================================================
-- Patrimônio: coordenada por imóvel (o mapa deixa de ser um pino por cidade)
--
-- Hoje o mapa põe UM pino por cidade, de uma tabela de coordenadas fixa: dez
-- imóveis em Triunfo viram um pino só no centro de Triunfo. O Jurídico quer
-- ver cada endereço no lugar dele.
--
-- A coordenada fica GRAVADA aqui, não resolvida a cada abertura de tela:
-- geocodificar é chamada a serviço externo, e repetir isso a cada F5 seria
-- lento, frágil e abusivo com o Nominatim. Grava uma vez, usa sempre.
--
-- `geo_endereco` guarda o texto que gerou a coordenada. É ele que diz se
-- precisa refazer: mudou o endereço no cadastro, a coordenada está velha.
-- =========================================================================

ALTER TABLE public."JUR_PATRIMONIOS"
  ADD COLUMN IF NOT EXISTS latitude      double precision,
  ADD COLUMN IF NOT EXISTS longitude     double precision,
  ADD COLUMN IF NOT EXISTS geo_endereco  text,
  ADD COLUMN IF NOT EXISTS geo_status    text,
  ADD COLUMN IF NOT EXISTS geo_em        timestamptz;

COMMENT ON COLUMN public."JUR_PATRIMONIOS".latitude IS
  'Latitude do imóvel. Preenchida pelo botão "Localizar endereços" (Nominatim/OpenStreetMap) ou digitada à mão no cadastro.';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".longitude IS
  'Longitude do imóvel. Ver latitude.';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".geo_endereco IS
  'Endereço exatamente como estava quando a coordenada foi obtida. Se o cadastro mudar, a tela sabe que precisa localizar de novo.';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".geo_status IS
  'ok = achou pelo endereço; manual = coordenada digitada por alguém; nao_encontrado = o serviço não achou (fica no pino da cidade e não é tentado de novo sozinho).';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".geo_em IS
  'Quando a coordenada foi definida.';

-- Só quem tem coordenada entra no índice: a maioria das consultas do mapa
-- filtra exatamente por isso.
CREATE INDEX IF NOT EXISTS jur_patrimonios_geo_idx
  ON public."JUR_PATRIMONIOS" (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP INDEX public.jur_patrimonios_geo_idx;
--   ALTER TABLE public."JUR_PATRIMONIOS"
--     DROP COLUMN latitude, DROP COLUMN longitude,
--     DROP COLUMN geo_endereco, DROP COLUMN geo_status, DROP COLUMN geo_em;
-- =========================================================================
