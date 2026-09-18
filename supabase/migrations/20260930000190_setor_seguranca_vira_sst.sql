-- =========================================================================
-- Setor SEGURANÇA = SST: fica só SST (18/09/2026, Pablo)
--
-- No cadastro (EMPREGADOS."Setor_ERP") havia "SEGURANCA" (Ellem) e
-- "SEGURANÇA" (Matheus, demitido) ao lado de "SST" (Milena, Isabella,
-- Viviane) — o mesmo setor com dois nomes, aparecendo duas vezes na lista de
-- setores do formulário de avaliação. Unifica em SST, inclusive nas
-- permissões por setor dos formulários (CS_FORM_ACESSOS), onde a linha
-- SEGURANCA vira SST ou some quando a SST equivalente já existe.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

UPDATE public."EMPREGADOS"
   SET "Setor_ERP" = 'SST'
 WHERE upper(translate("Setor_ERP", 'ÇÃÁ', 'CAA')) IN ('SEGURANCA', 'SEGURANCA DO TRABALHO');

DELETE FROM public."CS_FORM_ACESSOS" a
 WHERE upper(translate(a.setor, 'Ç', 'C')) = 'SEGURANCA'
   AND EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" b
                WHERE b.papel = a.papel AND upper(b.setor) = 'SST'
                  AND b.formulario_id IS NOT DISTINCT FROM a.formulario_id
                  AND b.user_id IS NOT DISTINCT FROM a.user_id);

UPDATE public."CS_FORM_ACESSOS"
   SET setor = 'SST'
 WHERE upper(translate(setor, 'Ç', 'C')) = 'SEGURANCA';

-- ROLLBACK: não há — é unificação de dado (os nomes antigos eram o mesmo setor).
