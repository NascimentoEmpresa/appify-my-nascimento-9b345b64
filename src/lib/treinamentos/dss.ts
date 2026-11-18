// =====================================================================
// DSS — Diálogo Semanal de Segurança (SIS-2026-0891, mig 20261119100000)
//
// Regras que o painel do SST e o Portal do Colaborador compartilham: status
// da pessoa, status do contrato, indicadores e os períodos dos filtros
// (semana / mês). O banco devolve só contagens por DSS × contrato
// (sst_dss_painel) e a lista de pessoas (sst_dss_pessoas); o resto sai daqui.
//
// Os 6 status do chamado viram:
//   Disponibilizado            → DSS publicado e dentro da vigência
//   Não acessado               → destinatário que ainda não abriu
//   Acessado / Aguardando ass. → abriu e não assinou (é um estado só)
//   Assinado                   → assinou no portal ou em papel
//   Concluído                  → CONTRATO com 100% dos destinatários assinados
// =====================================================================

export const MENU_DSS = "treinamentos_dss";
export const BUCKET_DSS = "sst-dss";

/** Texto que o colaborador confirma. Mudou o texto? Mude a versão no hash (col_dss_assinar). */
export const DECLARACAO_DSS =
  "Declaro que li e compreendi as orientações deste DSS – Diálogo Semanal de Segurança e me comprometo a segui-las no meu trabalho.";

export type SituacaoDss = "rascunho" | "publicado" | "encerrado";
export type StatusPessoaDss = "nao_acessado" | "aguardando" | "assinado" | "assinado_papel";
export type StatusContratoDss = "concluido" | "pendente" | "sem_destinatarios";

export const ROTULO_STATUS_PESSOA: Record<StatusPessoaDss, string> = {
  nao_acessado: "Não acessado",
  aguardando: "Acessado – aguardando assinatura",
  assinado: "Assinado",
  assinado_papel: "Assinado em papel",
};
export const ROTULO_SITUACAO: Record<SituacaoDss, string> = {
  rascunho: "Rascunho",
  publicado: "Disponibilizado",
  encerrado: "Encerrado",
};

export interface DssResumo {
  id: string; tema: string; semana_ref: string; situacao: SituacaoDss; vigente: boolean;
  disponivel_de: string; disponivel_ate: string | null; todos_contratos: boolean;
  publicado_em: string | null; encerrado_em: string | null; tem_arquivo: boolean; created_at: string;
}
export interface LinhaContratoDss {
  dss_id: string; empresa: number; filial: number; contrato_nome: string;
  destinatarios: number; acessaram: number; assinaram: number; assinaram_papel: number;
}
export interface PessoaDss {
  empregado_id: number; nome: string; matricula: string | null; cargo: string | null; cpf: string | null;
  empresa: number; filial: number; contrato_nome: string;
  acessado_em: string | null; assinado_em: string | null; origem: "portal" | "papel" | null;
  folha_id: string | null; assinatura_hash: string | null;
}

export function statusPessoa(p: Pick<PessoaDss, "acessado_em" | "assinado_em" | "origem">): StatusPessoaDss {
  if (p.assinado_em) return p.origem === "papel" ? "assinado_papel" : "assinado";
  return p.acessado_em ? "aguardando" : "nao_acessado";
}
export const assinou = (s: StatusPessoaDss) => s === "assinado" || s === "assinado_papel";

export function statusContrato(destinatarios: number, assinaram: number): StatusContratoDss {
  if (destinatarios <= 0) return "sem_destinatarios";
  return assinaram >= destinatarios ? "concluido" : "pendente";
}

/** 0–100, uma casa. Sem destinatário = 0 (não 100: não houve DSS feito). */
export function pct(parte: number, total: number): number {
  if (!total) return 0;
  return Math.round((parte / total) * 1000) / 10;
}
export const fmtPctDss = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export interface IndicadoresDss {
  destinatarios: number; acessaram: number; assinaram: number; assinaramPapel: number;
  naoAcessaram: number; aguardando: number; pendentes: number; pctConclusao: number;
  contratos: number; contratosConcluidos: number; contratosPendentes: number;
}

export interface ContratoAgregado {
  chave: string; empresa: number; filial: number; contrato_nome: string;
  destinatarios: number; acessaram: number; assinaram: number; assinaram_papel: number;
  status: StatusContratoDss; pct: number;
}

/** Soma as linhas DSS × contrato por contrato (o mesmo contrato em 2 DSS do período vira 1 linha). */
export function agregarPorContrato(linhas: LinhaContratoDss[]): ContratoAgregado[] {
  const m = new Map<string, ContratoAgregado>();
  for (const l of linhas) {
    const chave = `${l.empresa}/${l.filial}`;
    const a = m.get(chave) ?? {
      chave, empresa: l.empresa, filial: l.filial, contrato_nome: l.contrato_nome,
      destinatarios: 0, acessaram: 0, assinaram: 0, assinaram_papel: 0, status: "sem_destinatarios", pct: 0,
    };
    a.destinatarios += l.destinatarios; a.acessaram += l.acessaram;
    a.assinaram += l.assinaram; a.assinaram_papel += l.assinaram_papel;
    m.set(chave, a);
  }
  return [...m.values()]
    .map((a) => ({ ...a, status: statusContrato(a.destinatarios, a.assinaram), pct: pct(a.assinaram, a.destinatarios) }))
    .sort((x, y) => x.contrato_nome.localeCompare(y.contrato_nome, "pt-BR"));
}

export function calcularIndicadoresDss(linhas: LinhaContratoDss[]): IndicadoresDss {
  const t = linhas.reduce((a, l) => ({
    destinatarios: a.destinatarios + l.destinatarios, acessaram: a.acessaram + l.acessaram,
    assinaram: a.assinaram + l.assinaram, papel: a.papel + l.assinaram_papel,
  }), { destinatarios: 0, acessaram: 0, assinaram: 0, papel: 0 });
  const contratos = agregarPorContrato(linhas).filter((c) => c.status !== "sem_destinatarios");
  return {
    destinatarios: t.destinatarios, acessaram: t.acessaram, assinaram: t.assinaram, assinaramPapel: t.papel,
    naoAcessaram: t.destinatarios - t.acessaram, aguardando: t.acessaram - t.assinaram,
    pendentes: t.destinatarios - t.assinaram, pctConclusao: pct(t.assinaram, t.destinatarios),
    contratos: contratos.length,
    contratosConcluidos: contratos.filter((c) => c.status === "concluido").length,
    contratosPendentes: contratos.filter((c) => c.status === "pendente").length,
  };
}

// ── Datas (strings AAAA-MM-DD; contas em UTC para não escorregar de fuso) ──
const paraData = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const paraIso = (d: Date) => d.toISOString().slice(0, 10);

/** Hoje no fuso de Brasília. */
export function hojeIso(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** Segunda-feira da semana da data (a "semana de referência" do DSS). */
export function segundaDaSemana(iso: string): string {
  const d = paraData(iso);
  const dia = d.getUTCDay(); // 0 = domingo
  d.setUTCDate(d.getUTCDate() - (dia === 0 ? 6 : dia - 1));
  return paraIso(d);
}

export function somarDias(iso: string, dias: number): string {
  const d = paraData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return paraIso(d);
}

/** Filtro "semana": a semana de referência é a própria segunda. */
export function intervaloSemana(iso: string): { de: string; ate: string } {
  const s = segundaDaSemana(iso);
  return { de: s, ate: s };
}

/** Filtro "mês" ("2026-11"): DSS cuja semana de referência começa no mês. */
export function intervaloMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

export function rotuloSemana(segunda: string): string {
  const fim = somarDias(segunda, 6);
  const f = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return `Semana de ${f(segunda)} a ${f(fim)}/${fim.slice(0, 4)}`;
}

/** Vigente hoje? (o banco decide de verdade; isto é só para a tela) */
export function vigenteEm(d: { situacao: SituacaoDss; disponivel_de: string; disponivel_ate: string | null }, hoje: string): boolean {
  return d.situacao === "publicado" && d.disponivel_de <= hoje && (!d.disponivel_ate || d.disponivel_ate >= hoje);
}

/** Filtro de pessoas da tela de detalhe. */
export function filtrarPessoas(pessoas: PessoaDss[], f: { status?: StatusPessoaDss | "pendentes" | "todos"; busca?: string }): PessoaDss[] {
  const t = (f.busca ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const digitos = t.replace(/\D/g, "");
  return pessoas.filter((p) => {
    const s = statusPessoa(p);
    if (f.status && f.status !== "todos") {
      if (f.status === "pendentes" ? assinou(s) : s !== f.status) return false;
    }
    if (!t) return true;
    const nome = p.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return nome.includes(t) || (digitos.length >= 3 && ((p.matricula ?? "").includes(digitos) || (p.cpf ?? "").startsWith(digitos)));
  });
}
