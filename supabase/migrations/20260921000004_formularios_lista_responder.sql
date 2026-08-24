-- =========================================================================
-- FORMULÁRIOS — QUEM ESTÁ NA LISTA DE ACESSO TAMBÉM RESPONDE
--
-- O PROBLEMA
--   O botão "Acesso" de cada card governa quem ADMINISTRA e quem LÊ as
--   respostas. Quem PODE RESPONDER é outra pergunta, respondida pelo
--   público-alvo do editor (`seguranca` + `setores_acesso` +
--   CS_FORM_ALVO_USUARIOS, tudo dentro de `cs_form_alvo`).
--
--   As duas nunca se falaram. Resultado: colocar a Fulana como dona de um
--   formulário restrito ao setor JURIDICO não a deixava abrir o próprio
--   formulário para responder se ela não fosse do JURIDICO — ela edita, mas
--   toma "Você não está na lista de quem pode responder".
--
-- A DECISÃO (Pablo, 24/08/2026): SOMAR, não substituir.
--   * O público-alvo continua sendo quem define os respondentes. Nenhum
--     formulário que hoje coleta respostas para de coletar — é o motivo de
--     não termos feito a lista MANDAR em quem responde: a pesquisa com 2
--     administradores na lista pararia de receber as respostas do alvo no
--     instante do deploy.
--   * Quem está na lista de acesso (form_dono/form_gerenciar/form_editar/
--     form_ver) passa a poder responder MESMO fora do alvo. É o mínimo para
--     que administrar o formulário não exclua você dele.
--
-- O QUE **NÃO** MUDA
--   * `cs_form_aberto` (publicado, dentro da janela, abaixo do limite) segue
--     valendo para todo mundo — estar na lista não fura formulário encerrado.
--   * `cs_form_senha_ok` segue valendo: senha é camada extra, não público.
--   * `cs_forms_select` (quem ENXERGA a linha do formulário) fica como está.
--     Podá-la pela lista seria inócuo e perigoso: `cs_form_alvo` já devolve
--     true para qualquer logado no caso "restrito sem filtro nenhum", que é a
--     maioria, e quem pode responder PRECISA ler o formulário para preenchê-lo.
--     Sumir o card da tela de GESTÃO de quem a lista exclui é decisão de
--     interface (Formularios.tsx), não de RLS — a RLS não distingue "abri a
--     gestão" de "abri o link para responder".
--
-- A tela pública já chama `cs_form_alvo` por RPC para decidir o que mostrar
-- (FormularioPublico.tsx), então ela acompanha esta migration sozinha.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- Mesma função de 20260715000002 com UM ramo a mais: estar na lista de acesso
-- do formulário. `cs_form_papel_no_form` só considera os quatro papéis da
-- lista (desde 20260921000002), então as linhas de LEITURA por formulário —
-- que não são lista de acesso — não entram aqui e não viram passe de resposta.
CREATE OR REPLACE FUNCTION public.cs_form_alvo(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CS_FORMULARIOS" f
     WHERE f.id = _form_id
       AND (
         f.seguranca = 'liberado'
         OR (auth.uid() IS NOT NULL AND (
           -- restrito sem filtro nenhum = qualquer usuário logado do ERP
           (COALESCE(array_length(f.setores_acesso, 1), 0) = 0
            AND NOT EXISTS (SELECT 1 FROM public."CS_FORM_ALVO_USUARIOS" u WHERE u.formulario_id = f.id))
           -- união: do setor liberado OU escolhido a dedo
           OR EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                       WHERE e.auth_user_id = auth.uid()
                         AND e."Setor_ERP" = ANY (f.setores_acesso))
           OR EXISTS (SELECT 1 FROM public."CS_FORM_ALVO_USUARIOS" u
                       WHERE u.formulario_id = f.id AND u.user_id = auth.uid())
           -- NOVO: quem administra ou lê pela lista do botão "Acesso" também
           -- responde, esteja ou não no público-alvo.
           OR public.cs_form_papel_no_form(f.id) IS NOT NULL
         ))
       ));
$$;

-- CREATE OR REPLACE preserva os grants; repetidos aqui para o caso de a função
-- ser criada do zero num banco novo.
REVOKE EXECUTE ON FUNCTION public.cs_form_alvo(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_alvo(uuid) TO anon, authenticated;

-- ── Conferência ──────────────────────────────────────────────────────────
-- Quantos formulários têm lista, e quantos deles são restritos (só nesses o
-- ramo novo muda alguma coisa).
SELECT count(*) FILTER (WHERE tem_lista)                              AS com_lista,
       count(*) FILTER (WHERE tem_lista AND seguranca = 'restrito')   AS com_lista_restritos
  FROM (SELECT f.seguranca,
               EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a
                        WHERE a.formulario_id = f.id
                          AND a.papel IN ('form_dono','form_gerenciar','form_editar','form_ver')) AS tem_lista
          FROM public."CS_FORMULARIOS" f WHERE f.deleted_at IS NULL) t;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Recriar public.cs_form_alvo(uuid) sem o ramo
--   `OR public.cs_form_papel_no_form(f.id) IS NOT NULL`
--   (versão original em 20260715000002_formularios_seguranca.sql, linha 97).
-- =========================================================================
