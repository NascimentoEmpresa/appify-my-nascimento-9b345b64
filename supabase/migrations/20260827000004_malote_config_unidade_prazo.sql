-- SIS-2026-0082 (ajuste): "Em até N dia(s)" pode ser dia(s) útil(eis) OU
-- dia(s) corrido(s) — a orientação da diretoria previa as duas opções, não
-- só dias úteis (o mockup tinha um segundo dropdown ao lado do N que a
-- primeira versão desta tela tinha simplificado/removido por engano).
--
-- O valor 'dias_uteis' de *_pagamento_modo é mantido como está (significa
-- genericamente "em até N dias") por simplicidade — evita reescrever o
-- CHECK numa tabela que já está em uso em produção. A unidade real
-- (útil vs corrido) fica nas colunas novas abaixo.

ALTER TABLE public.malote_config
  ADD COLUMN inclusao_setor_pagamento_unidade text NOT NULL DEFAULT 'util'
    CHECK (inclusao_setor_pagamento_unidade IN ('util', 'corrido')),
  ADD COLUMN conferencia_aprovacao_pagamento_unidade text NOT NULL DEFAULT 'util'
    CHECK (conferencia_aprovacao_pagamento_unidade IN ('util', 'corrido'));

NOTIFY pgrst, 'reload schema';
