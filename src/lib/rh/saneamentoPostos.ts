// =====================================================================
// SANEAMENTO DE POSTOS — Senior × ERP (13/11/2026, mig 20261115200000)
// Lógica pura (sem React), testada em src/test/rh-saneamento-postos.test.ts.
//
// PEDIDO (chamado da Operação): os postos cadastrados na Senior nasceram
// fora do padrão e não batem com os do ERP (Planilha de Custo — a fonte da
// verdade). Antes de trocar de sistema de folha, a base precisa ser saneada:
// cada posto da Senior tem que ter UM posto do ERP, com o mesmo nome.
//
// O banco (rh_ac_saneamento_postos) devolve, por contrato:
//   · senior: cada posto da Senior em uso (código PO-xxxxx + nome), quanta
//     gente tem e em que posto(s) do ERP essa gente está (pela mesma regra
//     do Ativos/Contratos — rh_ac_pessoas_posto);
//   · erp: cada posto vigente da planilha e quem o ocupa.
// Aqui: classificar cada linha e dizer o que fazer com ela.
// =====================================================================
import { limparPostoSenior } from "@/pages/rh/conferenciaAtivos";

export interface PostoSeniorSan {
  contrato_id: string;
  contrato: string;
  /** Código do posto na Senior (EMPREGADOS."Posto"); "" = sem código. */
  codigo: string;
  /** "Nome do Posto" como vem da Senior; "" = colaborador sem posto. */
  posto_senior: string;
  pessoas: number;
  /** Pessoas deste posto ainda sem posto do ERP. */
  sem_posto: number;
  /** Marcadas "fora da conta" do contrato. */
  fora: number;
  /** Em renda técnica. */
  rt: number;
  /** Postos do ERP (planilha) em que as pessoas deste posto estão. */
  postos_erp: string[];
}

export interface PostoErpSan {
  contrato_id: string;
  contrato: string;
  posto: string;
  previsto: number;
  implantado: number;
  pessoas: number;
  codigos_senior: string[];
}

export interface SaneamentoPostos {
  gerado_em: string;
  senior: PostoSeniorSan[];
  erp: PostoErpSan[];
}

export type StatusSaneamento =
  | "padronizado"      // 1 posto do ERP, mesmo nome
  | "nome_diferente"   // 1 posto do ERP, nome diferente → renomear na Senior
  | "varios_erp"       // 1 posto da Senior espalhado em vários do ERP → desmembrar na Senior
  | "parcial"          // parte da gente ligada, parte sem posto
  | "sem_equivalente"  // ninguém ligado: falta ligar (ou o posto não existe no ERP)
  | "sem_posto_senior" // colaborador sem posto no cadastro da Senior
  | "fora_da_conta";   // todo mundo fora da conta / renda técnica — nada a sanear

export const ROTULO_STATUS: Record<StatusSaneamento, string> = {
  padronizado: "Padronizado",
  nome_diferente: "Nome diferente",
  varios_erp: "Um posto na Senior, vários no ERP",
  parcial: "Parte sem vínculo",
  sem_equivalente: "Sem vínculo com o ERP",
  sem_posto_senior: "Sem posto na Senior",
  fora_da_conta: "Fora da conta",
};

export const ACAO_STATUS: Record<StatusSaneamento, string> = {
  padronizado: "Nada a fazer.",
  nome_diferente: "Renomear o posto na Senior para o nome do ERP.",
  varios_erp: "Desmembrar na Senior: um posto para cada posto do ERP.",
  parcial: "Definir o posto das pessoas que faltam em Ativos/Contratos.",
  sem_equivalente: "Ligar ao posto do ERP em Ativos/Contratos — ou cadastrar o posto na Planilha de Custo.",
  sem_posto_senior: "Informar o posto do colaborador na Senior.",
  fora_da_conta: "Nada a fazer (fora da conta ou renda técnica).",
};

/** Do que mais atrapalha o supervisor para o que já está certo. */
export const ORDEM_STATUS: StatusSaneamento[] = [
  "sem_posto_senior", "sem_equivalente", "parcial", "varios_erp", "nome_diferente", "padronizado", "fora_da_conta",
];

/** Mesma régua do sup_norm_nome do banco: sem acento, só letras e números. */
export const normNome = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * O nome da Senior já é o do ERP? Compara sem o prefixo de endereço
 * ("01-1099-0071-0061-06-") — ele é da estrutura da Senior, não do nome.
 */
export const mesmoNome = (postoSenior: string, postoErp: string) => {
  const erp = normNome(postoErp);
  return !!erp && (normNome(postoSenior) === erp || normNome(limparPostoSenior(postoSenior)) === erp);
};

export function statusDoPostoSenior(p: PostoSeniorSan): StatusSaneamento {
  const dentro = p.pessoas - p.fora - p.rt;
  if (dentro <= 0) return "fora_da_conta";
  // Mesmo que o RH já tenha movido a pessoa à mão no ERP, o cadastro da
  // Senior continua sem posto — e é ele que vai para a folha nova.
  if (!p.posto_senior.trim()) return "sem_posto_senior";
  if (p.sem_posto >= dentro || !p.postos_erp.length) return "sem_equivalente";
  if (p.sem_posto > 0) return "parcial";
  if (p.postos_erp.length > 1) return "varios_erp";
  return mesmoNome(p.posto_senior, p.postos_erp[0]) ? "padronizado" : "nome_diferente";
}

export interface LinhaSaneamento extends PostoSeniorSan {
  status: StatusSaneamento;
  /** Nome que o posto deveria ter na Senior (o do ERP), quando há um só. */
  nome_padrao: string | null;
}

export function classificarSaneamento(dados: SaneamentoPostos): LinhaSaneamento[] {
  const peso = new Map(ORDEM_STATUS.map((s, i) => [s, i]));
  return dados.senior
    .map((p) => {
      const status = statusDoPostoSenior(p);
      return { ...p, status, nome_padrao: p.postos_erp.length === 1 ? p.postos_erp[0] : null };
    })
    .sort((a, b) =>
      (peso.get(a.status)! - peso.get(b.status)!)
      || a.contrato.localeCompare(b.contrato, "pt-BR")
      || b.pessoas - a.pessoas
      || a.posto_senior.localeCompare(b.posto_senior, "pt-BR"));
}

export interface ResumoSaneamento {
  porStatus: Record<StatusSaneamento, { postos: number; pessoas: number }>;
  /** Pessoas ativas (com contrato) sem posto do ERP — o número do chamado. */
  pessoasSemVinculo: number;
  /** Postos da Senior em uso (pares contrato × posto). */
  postosSenior: number;
  /** % dos postos da Senior em uso que já estão padronizados (fora da conta não entra). */
  pctPadronizado: number;
  /** Postos do ERP com implantado > 0 e ninguém ligado. */
  erpSemNinguem: number;
}

export function resumirSaneamento(linhas: LinhaSaneamento[], erp: PostoErpSan[]): ResumoSaneamento {
  const porStatus = Object.fromEntries(ORDEM_STATUS.map((s) => [s, { postos: 0, pessoas: 0 }])) as ResumoSaneamento["porStatus"];
  for (const l of linhas) {
    porStatus[l.status].postos += 1;
    porStatus[l.status].pessoas += l.pessoas;
  }
  const emUso = linhas.filter((l) => l.status !== "fora_da_conta").length;
  return {
    porStatus,
    pessoasSemVinculo: linhas.reduce((s, l) => s + l.sem_posto, 0),
    postosSenior: linhas.length,
    pctPadronizado: emUso ? Math.round((porStatus.padronizado.postos / emUso) * 100) : 100,
    erpSemNinguem: erp.filter((p) => Number(p.implantado) > 0 && !p.pessoas).length,
  };
}

/** Linhas da planilha de exportação (aba "Senior × ERP"). */
export function linhasParaExcel(linhas: LinhaSaneamento[]) {
  return linhas.map((l) => ({
    Contrato: l.contrato,
    "Código Senior": l.codigo,
    "Posto na Senior": l.posto_senior || "(sem posto no cadastro)",
    Pessoas: l.pessoas,
    "Sem vínculo": l.sem_posto,
    "Fora da conta": l.fora,
    "Renda técnica": l.rt,
    "Posto(s) no ERP": l.postos_erp.join(" | "),
    "Nome padrão (ERP)": l.nome_padrao ?? "",
    "Situação": ROTULO_STATUS[l.status],
    "O que fazer": ACAO_STATUS[l.status],
  }));
}

/** Aba "Postos do ERP": a estrutura que o sistema de folha novo deve consumir. */
export function erpParaExcel(erp: PostoErpSan[]) {
  return erp.map((p) => ({
    Contrato: p.contrato,
    "Posto (ERP)": p.posto,
    Previsto: Number(p.previsto) || 0,
    Implantado: Number(p.implantado) || 0,
    "Pessoas ligadas": p.pessoas,
    "Código(s) na Senior": (p.codigos_senior ?? []).join(" | "),
  }));
}
