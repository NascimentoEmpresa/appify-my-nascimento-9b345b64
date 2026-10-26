-- ===========================================================================
-- 61 LINHAS AINDA APONTAVAM PARA O STORAGE DA SUPABASE ANTIGA
--
-- COMO APARECEU (19/10/2026)
-- O Eduardo clicou numa imagem do sistema e o navegador abriu
--   https://fwmzeaztjxrxxzxzxmgc.supabase.co/storage/v1/object/public/avatars/...
-- Ou seja: um dia depois da virada, parte das imagens continuava sendo
-- servida pelo projeto ANTIGO.
--
-- O QUE ERA, E O QUE NAO ERA
-- Nao era arquivo faltando. Os bytes estao no cluster -- conferido no mesmo
-- dia: 43 buckets, 12.919 arquivos, 6,0 GB, e o avatar exato da URL acima
-- responde 200 com os MESMOS 82.575 bytes nos dois lados.
--
-- O problema e TEXTO: estas colunas guardam a URL absoluta, montada na epoca
-- em que o storage era a Supabase. O codigo nao tem nenhuma URL fixa (ele usa
-- getPublicUrl/createSignedUrl, que seguem a VITE_SUPABASE_URL) -- o que
-- ficou para tras foi o que ja estava gravado no banco.
--
-- POR QUE ISTO E URGENTE MESMO FUNCIONANDO HOJE
-- Funciona porque a Supabase ainda esta no ar. No dia em que ela for
-- desligada, estas 61 imagens somem de uma vez -- 44 delas sao foto de
-- perfil. E ninguem vai ligar o sumico das fotos ao desligamento de um
-- servico feito semanas antes.
--
-- Medido antes de escrever (19/10/2026):
--   profiles.avatar_url             44
--   CS_FORMULARIOS.imagem_capa_url   9
--   SISTEMA_NOTIFICACOES.anexo_url   5
--   BI_LINK.imagem_url               2
--   app_config_runtime.valor         1   <- tratada em separado, abaixo
--
-- A TROCA E SO DA ORIGEM
-- O caminho depois do dominio e identico nos dois lados
-- (/storage/v1/object/public/<bucket>/<arquivo>), entao basta trocar o
-- prefixo. Nada de regex: `replace` de uma string exata nao tem como pegar
-- uma linha que nao devia.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SET LOCAL ROLE postgres -- por que esta linha existe
--
-- A primeira tentativa desta migration falhou com `ERROR: sessão ausente`.
-- A culpa e de `profiles_block_self_escalation`, um gatilho de seguranca que
-- recusa UPDATE em `profiles` fora de uma sessao de usuario -- a trava que
-- impede alguem de se promover a administrador por fora da tela.
--
-- Ele TEM uma saida para manutencao:
--     IF v_uid IS NULL THEN
--       IF v_effective_role IN ('service_role','supabase_admin','postgres')
--         THEN RETURN NEW;
--
-- So que `v_effective_role` cai em `current_setting('role', true)`, e o psql
-- conectado COMO postgres, sem nenhum `SET ROLE`, devolve `none` -- nao
-- `postgres`. Ser o usuario postgres e ter o papel postgres ATIVO sao coisas
-- diferentes, e e essa diferenca que derrubou a migration.
--
-- `SET LOCAL` vale so ate o fim desta transacao. Preferido a desligar o
-- gatilho (`DISABLE TRIGGER`): aqui a trava continua inteira e nos passamos
-- pela porta que ela mesma deixou aberta, em vez de arrombar a porta.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE postgres;

UPDATE public.profiles
   SET avatar_url = replace(avatar_url,
         'https://fwmzeaztjxrxxzxzxmgc.supabase.co/', 'https://api.grpnascimento.com.br/')
 WHERE avatar_url LIKE 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/%';

UPDATE public."CS_FORMULARIOS"
   SET imagem_capa_url = replace(imagem_capa_url,
         'https://fwmzeaztjxrxxzxzxmgc.supabase.co/', 'https://api.grpnascimento.com.br/')
 WHERE imagem_capa_url LIKE 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/%';

UPDATE public."SISTEMA_NOTIFICACOES"
   SET anexo_url = replace(anexo_url,
         'https://fwmzeaztjxrxxzxzxmgc.supabase.co/', 'https://api.grpnascimento.com.br/')
 WHERE anexo_url LIKE 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/%';

UPDATE public."BI_LINK"
   SET imagem_url = replace(imagem_url,
         'https://fwmzeaztjxrxxzxzxmgc.supabase.co/', 'https://api.grpnascimento.com.br/')
 WHERE imagem_url LIKE 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/%';

-- ---------------------------------------------------------------------------
-- app_config_runtime: lixo que guarda a anon_key do projeto antigo
--
-- Esta tabela tinha duas chaves, `anon_key` e `functions_url`, lidas por
-- gatilhos que chamavam `net.http_post`. A migration 20261006000001 trocou o
-- `pg_net` pela `fila_http`, e o proprio comentario dela registra: "com a
-- fila, nenhuma das duas e necessaria".
--
-- Conferido em 19/10/2026: nenhuma funcao do banco e nenhum arquivo de
-- `src/`, `supabase/functions/` ou `worker/` le esta tabela. O que sobrou foi
-- a `anon_key` de um projeto que vamos desligar, parada num lugar onde
-- ninguem procura.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.app_config_runtime;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- ROLLBACK
--
-- A volta das URLs e simetrica -- so faz sentido se a Supabase voltar a ser o
-- storage, o que exigiria desfazer a virada inteira:
--
--   UPDATE public.profiles SET avatar_url = replace(avatar_url,
--     'https://api.grpnascimento.com.br/', 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/')
--    WHERE avatar_url LIKE 'https://api.grpnascimento.com.br/storage/%';
--   (idem para CS_FORMULARIOS.imagem_capa_url, SISTEMA_NOTIFICACOES.anexo_url
--    e BI_LINK.imagem_url, sempre com o LIKE restrito a /storage/ para nao
--    pegar URL de function.)
--
-- A tabela volta assim -- mas sem os valores, que eram segredo de um projeto
-- aposentado e nao devem ser reescritos aqui:
--
--   CREATE TABLE public.app_config_runtime (chave text PRIMARY KEY, valor text);
--   ALTER TABLE public.app_config_runtime ENABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS app_config_runtime_sem_acesso ON public.app_config_runtime;
--   CREATE POLICY app_config_runtime_sem_acesso ON public.app_config_runtime
--     FOR ALL TO authenticated USING (false) WITH CHECK (false);
-- ===========================================================================
