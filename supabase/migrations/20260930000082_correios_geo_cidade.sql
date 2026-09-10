-- Correios — cache de coordenada por cidade (mapa do trajeto do objeto).
--
-- O rastreio dos Correios diz por onde o objeto passou em texto: "Unidade de
-- Tratamento, Sao Jose - SC". Para desenhar isso num mapa é preciso latitude e
-- longitude, e os Correios não devolvem coordenada nenhuma — nem eles têm, o
-- evento é registrado por unidade, não por GPS.
--
-- A coordenada vem do Nominatim (OpenStreetMap), que é gratuito mas pede
-- parcimônia: no máximo uma consulta por segundo, e nada de repetir o que já
-- se sabe. Por isso ela é resolvida UMA VEZ POR CIDADE e guardada aqui, para a
-- empresa inteira. As cidades se repetem muito entre objetos (toda carga do RS
-- passa pela mesma unidade de Porto Alegre), então na prática a tabela para de
-- crescer depois das primeiras dezenas de postagens.
--
-- Não há informação de negócio aqui: é o mesmo dado público que qualquer mapa
-- mostra. O que a tabela evita é ir buscá-lo de novo a cada abertura de tela.

CREATE TABLE IF NOT EXISTS public.correios_geo_cidade (
  -- "PENHA-SC": cidade sem acento, caixa alta, com a UF. É o que o rastreio
  -- devolve, e é o que a tela procura.
  chave       text PRIMARY KEY,
  cidade      text NOT NULL,
  uf          text NOT NULL,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid DEFAULT auth.uid(),
  -- Caixa do Brasil. Um dígito trocado põe a cidade no meio do Atlântico e o
  -- mapa abre num oceano vazio sem dizer por quê; aqui a linha simplesmente
  -- não entra, e a tela cai no comportamento de "cidade sem coordenada".
  CONSTRAINT correios_geo_cidade_dentro_do_brasil CHECK (
    latitude BETWEEN -34 AND 6 AND longitude BETWEEN -74 AND -34
  )
);

ALTER TABLE public.correios_geo_cidade ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS correios_geo_cidade_ler ON public.correios_geo_cidade;
CREATE POLICY correios_geo_cidade_ler
  ON public.correios_geo_cidade FOR SELECT
  TO authenticated
  USING (true);

-- Escrita liberada a qualquer autenticado de propósito: quem abre o mapa é
-- quem preenche o cache. Gatear por tela faria o primeiro usuário sem aquela
-- permissão ver um mapa vazio sem explicação, e não há o que proteger — o dado
-- é a coordenada de um município.
DROP POLICY IF EXISTS correios_geo_cidade_gravar ON public.correios_geo_cidade;
CREATE POLICY correios_geo_cidade_gravar
  ON public.correios_geo_cidade FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Sem UPDATE e sem DELETE, e é intencional: uma coordenada resolvida errada
-- não pode ser reescrita por outro usuário sem ninguém notar. Correção de
-- linha ruim é feita no SQL Editor, apagando a chave para ela ser resolvida
-- de novo.

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP POLICY IF EXISTS correios_geo_cidade_gravar ON public.correios_geo_cidade;
-- DROP POLICY IF EXISTS correios_geo_cidade_ler ON public.correios_geo_cidade;
-- DROP TABLE IF EXISTS public.correios_geo_cidade;
-- NOTIFY pgrst, 'reload schema';
