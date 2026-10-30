// Ficha do ASO admissional — o que o SST pediu, e SÓ isso (chamado do SST,
// 18/09/2026; mig 191). O banco monta a ficha (rec_ficha_aso): aqui ficam a
// ordem dos campos, os rótulos, quais o Recrutamento pode preencher à mão
// quando o automático não acha, e a conta do que falta.
import { postoELocalDaVaga } from "@/lib/recrutamento/postoDaVaga";

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
  /** local_exato da vaga, cru (mig 20261030003400) — ver localExatoDaFicha. */
  local_exato?: string | null;
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

export type CampoAso = Exclude<keyof FichaAso, "candidato_id" | "vaga_id" | "faltando" | "aso_posto" | "aso_empresa" | "aso_encarregado" | "local_exato">;

/**
 * Endereço / local exato da vaga para o SST (30/10/2026, vaga #1418: "pro
 * SST tá indo o nome do posto, mas precisa ir o local também"). Só quando
 * diz algo além do posto — a vaga do encarregado grava em local_exato o
 * próprio nome do posto. Opcional: não entra na conta do que falta.
 */
export const localExatoDaFicha = (f: Partial<FichaAso> | null | undefined): string =>
  postoELocalDaVaga(f?.posto, f?.local_exato).local;

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

/**
 * O "CHECKLIST ASO" do chamado SIS-2026-0667, pronto para colar no WhatsApp
 * (clínica / SST): os mesmos rótulos e a mesma ordem que o Recrutamento
 * usava no texto solto, já com os dados da ficha. Campo vazio sai em branco
 * depois dos dois-pontos, como no modelo.
 */
export function textoChecklistAso(f: Partial<FichaAso> | null | undefined): string {
  const v = (x: unknown) => (x == null ? "" : String(x).trim());
  const linhas: [string, string][] = [
    ["Tipo de ASO", v(f?.tipo_aso)],
    ["Nome", v(f?.nome)],
    ["Data de Nascimento", dataBrDaFicha(f?.nascimento)],
    ["Nome da Mãe", v(f?.nome_mae)],
    ["Função", v(f?.funcao)],
    ["CPF", v(f?.cpf)],
    ["RG", v(f?.rg)],
    ["PIS", v(f?.pis)],
    ["Setor/Posto", v(f?.posto)],
    ["Local / Cidade", v(f?.local_cidade)],
    ["Endereço / Local exato", localExatoDaFicha(f)],
    ["Celular", v(f?.celular)],
    ["Empresa", v(f?.empresa)],
    ["Contrato", v(f?.contrato)],
    ["Encarregado", v(f?.encarregado)],
  ].filter(([k, x]) => x || k !== "Endereço / Local exato") as [string, string][]; // endereço é opcional: sem ele, a linha nem aparece
  return ["ASO - ATESTADO DE SAÚDE OCUPACIONAL", ...linhas.map(([k, x]) => (x ? `${k}: ${x}` : `${k}:`))].join("\n");
}
