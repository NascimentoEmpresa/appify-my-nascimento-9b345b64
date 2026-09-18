// Ficha do ASO admissional — o que o SST pediu, e SÓ isso (chamado do SST,
// 18/09/2026; mig 191). O banco monta a ficha (rec_ficha_aso): aqui ficam a
// ordem dos campos, os rótulos, quais o Recrutamento pode preencher à mão
// quando o automático não acha, e a conta do que falta.

export interface FichaAso {
  candidato_id: number;
  vaga_id: number | null;
  tipo_aso: string;
  nome: string | null;
  nascimento: string | null;
  nome_mae: string | null;
  funcao: string | null;
  cpf: string | null;
  rg: string | null;
  pis: string | null;
  posto: string | null;
  local_cidade: string | null;
  celular: string | null;
  email: string | null;
  empresa: string | null;
  contrato: string | null;
  encarregado: string | null;
  aso_posto?: string | null;
  aso_empresa?: string | null;
  aso_encarregado?: string | null;
  faltando: string[];
}

export type CampoAso = Exclude<keyof FichaAso, "candidato_id" | "vaga_id" | "faltando" | "aso_posto" | "aso_empresa" | "aso_encarregado">;

/** A ordem do chamado. */
export const CAMPOS_ASO: { key: CampoAso; label: string }[] = [
  { key: "tipo_aso", label: "Tipo de ASO" },
  { key: "nome", label: "Nome" },
  { key: "nascimento", label: "Data de nascimento" },
  { key: "nome_mae", label: "Nome da mãe" },
  { key: "funcao", label: "Função" },
  { key: "cpf", label: "CPF" },
  { key: "rg", label: "RG" },
  { key: "pis", label: "PIS" },
  { key: "posto", label: "Setor / Posto de trabalho" },
  { key: "local_cidade", label: "Local / Cidade" },
  { key: "celular", label: "Celular" },
  { key: "email", label: "E-mail" },
  { key: "empresa", label: "Empresa" },
  { key: "contrato", label: "Contrato" },
  { key: "encarregado", label: "Encarregado responsável" },
];

/**
 * O que o Recrutamento preenche quando o automático não acha, e em que
 * coluna de WA_CURRICULOS cada um grava. Função, contrato e cidade vêm da
 * vaga e não se editam aqui (corrige-se na vaga).
 */
export const EDITAVEIS_ASO: { key: CampoAso; coluna: string; tipo?: "date" }[] = [
  { key: "nascimento", coluna: "data_nascimento", tipo: "date" },
  { key: "nome_mae", coluna: "nome_mae" },
  { key: "rg", coluna: "rg" },
  { key: "pis", coluna: "pis" },
  { key: "posto", coluna: "aso_posto" },
  { key: "celular", coluna: "telefone" },
  { key: "email", coluna: "email" },
  { key: "empresa", coluna: "aso_empresa" },
  { key: "encarregado", coluna: "aso_encarregado" },
];

export const rotuloAso = (key: string): string => CAMPOS_ASO.find(c => c.key === key)?.label ?? key;

/** Campos vazios, na ordem do chamado — a mesma conta do banco, feita local pra tela reagir sem refetch. */
export function faltandoNaFicha(f: Partial<FichaAso> | null | undefined): CampoAso[] {
  if (!f) return [];
  return CAMPOS_ASO.map(c => c.key).filter(k => k !== "tipo_aso" && !String(f[k] ?? "").trim());
}

export const fichaCompleta = (f: Partial<FichaAso> | null | undefined): boolean => !!f && faltandoNaFicha(f).length === 0;

/** Data ISO (yyyy-mm-dd) → dd/mm/aaaa, sem mexer em fuso. */
export const dataBrDaFicha = (iso?: string | null): string => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
};
