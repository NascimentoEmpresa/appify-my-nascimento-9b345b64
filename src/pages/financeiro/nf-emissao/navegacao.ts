import { rotaVisivelNoMenu } from "@/hooks/useAccessibleMenus";

export const ROTA_CONTROLE_NOTAS = "/app/financeiro/emissao-nf";
export const ETAPAS_CONTROLE_NOTAS = [
  { rota: `${ROTA_CONTROLE_NOTAS}/cadastro`, titulo: "Emissão de NF", descricao: "Preparar os dados, os itens e as retenções e encaminhar a nota ao Financeiro." },
  { rota: `${ROTA_CONTROLE_NOTAS}/controle-notas`, titulo: "Validação de Notas", descricao: "Conferir as preparações enviadas e acessar a integração de NFS-e com a prefeitura." },
  // SIS-2026-0941
  { rota: `${ROTA_CONTROLE_NOTAS}/parametrizacao-fiscal`, titulo: "Parametrização Fiscal", descricao: "Códigos fiscais por item de serviço e tomador por contrato, que preenchem a emissão da NFS-e." },
] as const;

export function etapasControleNotas(acesso: Parameters<typeof rotaVisivelNoMenu>[1]) {
  return ETAPAS_CONTROLE_NOTAS.filter(etapa => rotaVisivelNoMenu(etapa.rota, acesso));
}
