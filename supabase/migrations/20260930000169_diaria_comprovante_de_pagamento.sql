-- =====================================================================
-- DIÁRIAS — o comprovante de pagamento volta do Malote para as duas telas.
--
-- Pedido de 17/09/2026: "quando uma diária já for paga lá no malote (status
-- 'Despesa Paga'), nas diárias deve vir o arquivo anexado comprovando que foi
-- pago realmente. Atualmente fica só o status que foi pago; agora é ficar o
-- status de pago + arquivo de comprovante."
--
-- O status "Paga" já chega às telas desde 20260930000151, por uma coluna
-- computada (malote_despesa_paga). O ARQUIVO não chegava, e não era descuido:
-- ele mora em `malote_despesa.comprovante_pagamento_path`, no bucket
-- `malote-anexos`, cujas regras são do Malote. Quem enxerga diária —
-- especialmente o encarregado externo — não tem leitura nem na tabela nem no
-- bucket. Ele veria "Paga" e nada mais, que é exatamente o relato.
--
-- COMO SE RESOLVE, e por que assim:
--
--   1) Uma coluna computada (mesmo desenho de malote_despesa_paga) devolve os
--      metadados do comprovante. SECURITY DEFINER porque a leitura de
--      malote_despesa é do Malote; a função devolve só o necessário para
--      desenhar a linha do anexo, não a despesa.
--
--   2) Uma policy de SELECT no bucket, estreita: libera EXATAMENTE os objetos
--      que são comprovante de uma diária que a pessoa já pode ver. Policy
--      permissiva soma com as que já existem (OR) — nada do Malote é
--      restringido aqui, só se acrescenta uma porta do tamanho de uma fresta.
--
-- COPIAR o arquivo para o bucket `diarias` (como a aprovação faz com a
-- papelada da solicitação, em 20260930000019) foi considerado e recusado: lá
-- a cópia acontece porque existe um ato do usuário para pendurá-la (a
-- aprovação). O pagamento acontece no Malote, por outra pessoa, sem passar
-- por nenhum código de diária — não há gancho, e duplicar arquivo por trigger
-- deixaria duas verdades para o mesmo comprovante.
--
-- PARCELADA TAMBÉM CONTA: a diária pode ser aprovada em parcelas
-- (diaria_aprovar_com_despesa aceita `parcelas`, ver 20260930000035), e desde
-- 20260930000001 cada parcela tem comprovante próprio. Por isso o retorno é
-- uma LISTA, não um arquivo só.
-- =====================================================================

-- ── 1) Índices ───────────────────────────────────────────────────────
--
-- A policy do bucket procura um path entre os comprovantes. Sem estes dois,
-- cada verificação de objeto vira seq scan em malote_despesa — e o Storage
-- avalia a policy por objeto.
CREATE INDEX IF NOT EXISTS idx_malote_despesa_comprovante_path
  ON public.malote_despesa(comprovante_pagamento_path)
  WHERE comprovante_pagamento_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_malote_despesa_parcela_comprovante_path
  ON public.malote_despesa_parcela(comprovante_pagamento_path)
  WHERE comprovante_pagamento_path IS NOT NULL;

-- ── 2) Os comprovantes de uma diária ─────────────────────────────────
--
-- Coluna computada sobre "DIARIA_SOLICITACAO": o PostgREST a expõe no mesmo
-- select da lista, como já faz com malote_despesa_paga. Devolve um ARRAY
-- (despesa única = 1 item; parcelada = 1 por parcela paga).
--
-- Só entra comprovante de pagamento REALMENTE feito: despesa em
-- 'despesa_paga', parcela em 'paga'. Anexo de despesa em rascunho não é
-- comprovante de nada.
CREATE OR REPLACE FUNCTION public.diaria_comprovantes_pagamento(s public."DIARIA_SOLICITACAO")
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.ordem), '[]'::jsonb)
    FROM (
      -- Despesa única.
      SELECT '0000'::text AS ordem,
             jsonb_build_object(
               'rotulo',       'Comprovante de pagamento',
               'storage_path', d.comprovante_pagamento_path,
               'pago_em',      d.pago_em,
               'pago_por',     COALESCE(pr.display_name, pr.email),
               'observacao',   d.observacao_pagamento
             ) AS item
        FROM public.malote_despesa d
        LEFT JOIN public.profiles pr ON pr.id = d.pago_por
       WHERE d.id = s.malote_despesa_id
         AND d.status = 'despesa_paga'
         AND COALESCE(btrim(d.comprovante_pagamento_path), '') <> ''

      UNION ALL

      -- Parcelas pagas.
      SELECT lpad(pa.numero_parcela::text, 4, '0') AS ordem,
             jsonb_build_object(
               'rotulo',       'Comprovante da parcela ' || pa.numero_parcela,
               'storage_path', pa.comprovante_pagamento_path,
               'pago_em',      pa.pago_em,
               'pago_por',     COALESCE(pp.display_name, pp.email),
               'observacao',   pa.observacao_pagamento
             )
        FROM public.malote_despesa_parcela pa
        LEFT JOIN public.profiles pp ON pp.id = pa.pago_por
       WHERE pa.despesa_id = s.malote_despesa_id
         AND pa.status = 'paga'
         AND COALESCE(btrim(pa.comprovante_pagamento_path), '') <> ''
    ) x;
$$;
REVOKE ALL ON FUNCTION public.diaria_comprovantes_pagamento(public."DIARIA_SOLICITACAO") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_comprovantes_pagamento(public."DIARIA_SOLICITACAO") TO authenticated;

-- ── 3) Quem pode abrir o arquivo ─────────────────────────────────────
--
-- A MESMA regra de visibilidade da solicitação (a policy
-- diaria_solicitacao_select, repetida à mão porque esta função é SECURITY
-- DEFINER e não passa por RLS): o encarregado externo só enxerga as diárias
-- que ele criou, então só abre o comprovante do pagamento da própria diária.
--
-- Função à parte, e não a condição inteira dentro da policy, por dois
-- motivos: dentro de uma policy de storage.objects o `name` não qualificado
-- fica exposto a ambiguidade quando a subconsulta cresce, e assim a regra
-- pode ser testada sozinha com um SELECT.
CREATE OR REPLACE FUNCTION public.diaria_comprovante_visivel(_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public."DIARIA_SOLICITACAO" s
     WHERE s.malote_despesa_id IS NOT NULL
       AND ( s.solicitante_id = auth.uid()
             OR public.can_access(auth.uid(), 'operacional_diarias', 'visualizar') )
       AND (
         EXISTS (
           SELECT 1 FROM public.malote_despesa d
            WHERE d.id = s.malote_despesa_id
              AND d.status = 'despesa_paga'
              AND d.comprovante_pagamento_path = _path
         )
         OR EXISTS (
           SELECT 1 FROM public.malote_despesa_parcela pa
            WHERE pa.despesa_id = s.malote_despesa_id
              AND pa.status = 'paga'
              AND pa.comprovante_pagamento_path = _path
         )
       )
  );
$$;
REVOKE ALL ON FUNCTION public.diaria_comprovante_visivel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_comprovante_visivel(text) TO authenticated;

-- A policy é ADITIVA: policies permissivas se somam (OR), então isto não tira
-- nada de quem já lia o bucket pelas regras do Malote. O recorte é o mais
-- estreito possível — o path tem que ser, ele mesmo, o comprovante de uma
-- diária que a pessoa já pode abrir.
DROP POLICY IF EXISTS "diaria comprovante pagamento select" ON storage.objects;
CREATE POLICY "diaria comprovante pagamento select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'malote-anexos'
    AND public.diaria_comprovante_visivel(storage.objects.name)
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP POLICY IF EXISTS "diaria comprovante pagamento select" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.diaria_comprovante_visivel(text);
-- DROP FUNCTION IF EXISTS public.diaria_comprovantes_pagamento(public."DIARIA_SOLICITACAO");
-- DROP INDEX IF EXISTS public.idx_malote_despesa_parcela_comprovante_path;
-- DROP INDEX IF EXISTS public.idx_malote_despesa_comprovante_path;
-- NOTIFY pgrst, 'reload schema';
