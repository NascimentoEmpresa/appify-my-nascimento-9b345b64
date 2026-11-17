// SST › Exames Toxicológicos (SIS-2026-0887, mig 20261117140000) — o que a
// tela calcula: a situação de cada exame, o alerta de 15 dias, os indicadores
// do painel e a leitura da planilha que o SST usava. Quem PRECISA do exame
// (CNH C/D/E, ou o cargo) e quem entra na lista moram no banco
// (sst_toxico_precisa_exame / sst_toxico_lista), porque valem para qualquer leitura.
import * as XLSX from "xlsx";
import { fmtData, hojeIso } from "@/lib/sst/controleAfastamentos";

export { fmtData, hojeIso };

export type SituacaoExame = "em_dia" | "proximo" | "vencido" | "aguardando";
export const ROTULO_SITUACAO: Record<SituacaoExame, string> = {
  em_dia: "Em dia", proximo: "Próximo do vencimento", vencido: "Vencido", aguardando: "Aguardando atualização",
};
export const SITUACOES = Object.keys(ROTULO_SITUACAO) as SituacaoExame[];

/** Pedido do SST: 30 dias antes é "próximo do vencimento"; 15 dias antes, alerta. */
export const DIAS_PROXIMO = 30;
export const DIAS_ALERTA = 15;
/** 41 dos 47 exames da planilha tinham validade de 24 meses — é a sugestão do formulário. */
export const MESES_VALIDADE = 24;
export const CATEGORIAS_CNH = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"] as const;

export interface ItemToxico {
  toxicologico_id: number | null;
  empregado_id: number | null;
  nome: string;
  cargo: string | null;
  situacao_senior: string | null;
  desligado: boolean;
  contrato_id: string | null;
  contrato_nome: string | null;
  local_trabalho: string | null;
  categoria_cnh: string | null;
  cnh_do_cargo: string | null;
  precisa_exame: boolean;
  responsavel: string | null;
  superior_organograma: string | null;
  data_ultimo_exame: string | null;
  data_validade: string | null;
  clinica: string | null;
  observacao: string | null;
  ultima_cobranca_em: string | null;
  ultimo_contato_em: string | null;
  ultimo_contato_obs: string | null;
  documentos: number;
}

/** O registro ainda pode não existir (motorista sem exame): aí a chave é o colaborador. */
export const chaveItem = (i: Pick<ItemToxico, "toxicologico_id" | "empregado_id">): string =>
  i.toxicologico_id != null ? `t${i.toxicologico_id}` : `e${i.empregado_id}`;

const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${de.slice(0, 10)}T00:00:00Z`)) / 86400000);

const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Soma meses; o dia que não existe no mês de chegada vira o último (29/02 + 24 meses = 28/02). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.slice(0, 10).split("-").map(Number);
  const total = a * 12 + (m - 1) + meses;
  const na = Math.floor(total / 12);
  const nm = total - na * 12 + 1;
  const ultimo = new Date(Date.UTC(na, nm, 0)).getUTCDate();
  return iso(na, nm, Math.min(d, ultimo));
}

export const validadeSugerida = (dataExame: string): string => somarMeses(dataExame, MESES_VALIDADE);

/** Negativo = vencido há tantos dias; 0 = vence hoje. */
export const diasParaVencer = (i: Pick<ItemToxico, "data_validade">, hoje = hojeIso()): number | null =>
  i.data_validade ? diasEntre(hoje, i.data_validade) : null;

export function situacaoExame(i: Pick<ItemToxico, "data_validade">, hoje = hojeIso()): SituacaoExame {
  const d = diasParaVencer(i, hoje);
  if (d == null) return "aguardando";
  if (d < 0) return "vencido";
  return d <= DIAS_PROXIMO ? "proximo" : "em_dia";
}

/** Vence em até 15 dias, contando o dia de hoje (no dia do vencimento ainda vale). */
export const emAlerta = (i: Pick<ItemToxico, "data_validade">, hoje = hojeIso()): boolean => {
  const d = diasParaVencer(i, hoje);
  return d != null && d >= 0 && d <= DIAS_ALERTA;
};

/** Quem soma no painel: precisa do exame e ainda trabalha na empresa. */
export const contaNoPainel = (i: Pick<ItemToxico, "precisa_exame" | "desligado">): boolean => i.precisa_exame && !i.desligado;

/**
 * A cobrança é deste ciclo se veio depois do último exame. Sem a data do exame
 * (a planilha quase nunca tinha), o ciclo começa 24 meses antes da validade.
 * É o que decide o selo "Cobrado em": depois do exame novo, ele some sozinho.
 */
export function cobradoNoCiclo(i: Pick<ItemToxico, "ultima_cobranca_em" | "data_ultimo_exame" | "data_validade">): boolean {
  if (!i.ultima_cobranca_em) return false;
  const inicio = i.data_ultimo_exame ?? (i.data_validade ? somarMeses(i.data_validade, -MESES_VALIDADE) : null);
  return !inicio || i.ultima_cobranca_em >= inicio;
}

export const cnhExibida = (i: Pick<ItemToxico, "categoria_cnh" | "cnh_do_cargo">): { cnh: string | null; doCargo: boolean } =>
  i.categoria_cnh ? { cnh: i.categoria_cnh, doCargo: false } : { cnh: i.cnh_do_cargo, doCargo: !!i.cnh_do_cargo };

/** Sem responsável digitado, a sugestão é o superior do Organograma. */
export const responsavelExibido = (i: Pick<ItemToxico, "responsavel" | "superior_organograma">): { nome: string | null; doOrganograma: boolean } =>
  i.responsavel ? { nome: i.responsavel, doOrganograma: false } : { nome: i.superior_organograma, doOrganograma: !!i.superior_organograma };

export const INDICADORES = [
  { chave: "total", titulo: "Total de motoristas", filtro: (_i: ItemToxico, _h: string) => true },
  { chave: "em_dia", titulo: "Exames regulares", filtro: (i: ItemToxico, h: string) => situacaoExame(i, h) === "em_dia" },
  { chave: "proximo", titulo: "Próximos do vencimento", filtro: (i: ItemToxico, h: string) => situacaoExame(i, h) === "proximo" },
  { chave: "vencido", titulo: "Vencidos", filtro: (i: ItemToxico, h: string) => situacaoExame(i, h) === "vencido" },
  { chave: "aguardando", titulo: "Aguardando atualização", filtro: (i: ItemToxico, h: string) => situacaoExame(i, h) === "aguardando" },
] as const;
export type ChaveIndicador = (typeof INDICADORES)[number]["chave"];

/** Quanto menor, mais em cima: vencido, alerta de 15 dias, próximo, sem exame, em dia. */
export function prioridade(i: ItemToxico, hoje = hojeIso()): number {
  if (!contaNoPainel(i)) return 9;
  const s = situacaoExame(i, hoje);
  if (s === "vencido") return 0;
  if (emAlerta(i, hoje)) return 1;
  if (s === "proximo") return 2;
  return s === "aguardando" ? 3 : 4;
}

// =====================================================================
// A planilha que o SST usava ("CONTROLE EXAMES TOXICOLÓGICOS.xlsx"): uma aba
// por responsável, cabeçalho Contrato | Nome do Colaborador | CPF | Função |
// Tipo de CNH | Data do Último Exame | Data de Vencimento | Status | Clínica /
// Laboratório | Observações, e no fim de algumas abas uma linha "MOTORISTAS
// CAT B - NÃO PRECISAM DE TOXICOLÓGICO" seguida de quem não precisa.
// =====================================================================

export interface LinhaToxico {
  aba: string;
  linha: number;
  nome: string;
  cpf: string;
  local_trabalho: string | null;
  funcao: string | null;
  categoria_cnh: string | null;
  data_ultimo_exame: string | null;
  data_validade: string | null;
  ultima_cobranca_em: string | null;
  clinica: string | null;
  observacao: string | null;
  nao_precisa: boolean;
  avisos: string[];
}
export interface AbaToxico { nome: string; linhas: number; naoPrecisam: number; responsavel: string }
export interface LeituraToxico { abas: AbaToxico[]; linhas: LinhaToxico[] }

const normalizar = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const texto = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const digitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

export function normCnh(v: unknown): string | null {
  const x = String(v ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (CATEGORIAS_CNH as readonly string[]).includes(x) ? x : null;
}

const dataValida = (a: number, m: number, d: number): string | null => {
  if (a < 1900 || m < 1 || m > 12 || d < 1) return null;
  return d <= new Date(Date.UTC(a, m, 0)).getUTCDate() ? iso(a, m, d) : null;
};

/**
 * Data de célula. A planilha guarda número de série do Excel; ler pelo número
 * (e não por Date) evita perder um dia no fuso. Texto digitado vale como
 * dd/mm/aaaa ou aaaa-mm-dd. Devolve undefined quando havia algo ilegível.
 */
export function dataDaCelula(v: unknown): string | null | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? dataValida(p.y, p.m, p.d) ?? undefined : undefined;
  }
  const t = texto(v);
  if (!t) return null;
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/);
  if (m) return dataValida(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1])) ?? undefined;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return dataValida(Number(m[1]), Number(m[2]), Number(m[3])) ?? undefined;
  return undefined;
}

/**
 * "COBRADO 11/11/2026" ou "(COBRADO 12/11 ESTV FÉRIAS)" — o SST anotava a
 * cobrança na coluna da clínica. Sem ano, o ano de hoje; se cair no futuro,
 * o anterior.
 */
export function cobrancaDoTexto(v: unknown, hoje = hojeIso()): string | null {
  // \d{4} antes de \d{2}: na ordem inversa, "11/11/2026" virava 2020.
  const m = normalizar(v).match(/COBRAD[OA]S?\s+(?:EM\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?/);
  if (!m) return null;
  const anoHoje = Number(hoje.slice(0, 4));
  if (m[3]) return dataValida(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  const neste = dataValida(anoHoje, Number(m[2]), Number(m[1]));
  if (!neste) return null;
  return neste > hoje ? dataValida(anoHoje - 1, Number(m[2]), Number(m[1])) : neste;
}

/**
 * Quem cobra, pelo nome da aba ("EXAMES MOT ANDRIO" → "ANDRIO"). A aba com o
 * nome do contrato ("UFFS", e os locais "UFFS ERECHIM"...) não diz quem cobra:
 * fica vazio e a tela mostra o superior do Organograma.
 */
export function responsavelDaAba(aba: string, locais: string[]): string {
  const a = normalizar(aba);
  if (locais.some((l) => { const n = normalizar(l); return n !== "" && n.startsWith(a); })) return "";
  return a.replace(/^EXAMES?\s+(MOT(ORISTAS?)?\s+)?/, "").replace(/\bCOLETA DE LIXO\b/, "").replace(/\s*,\s*/g, ", ").trim();
}

const CABECALHO: Record<string, RegExp> = {
  local: /^CONTRATO|LOCAL/, nome: /NOME/, cpf: /CPF/, funcao: /FUNC/, cnh: /CNH/,
  ultimo: /ULTIMO/, validade: /VENC|VALIDADE/, clinica: /CLINICA|LABORAT/, observacao: /OBSERV/,
};
type Coluna = keyof typeof CABECALHO;

export function lerPlanilhaToxicologico(dados: ArrayBuffer | Uint8Array, hoje = hojeIso()): LeituraToxico {
  const wb = XLSX.read(dados, { type: "array" });
  const abas: AbaToxico[] = [];
  const linhas: LinhaToxico[] = [];

  for (const nomeAba of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nomeAba], { header: 1, raw: true, defval: "" });
    const iCab = rows.slice(0, 6).findIndex((r) => r.some((c) => /NOME/.test(normalizar(c))) && r.some((c) => /CPF/.test(normalizar(c))));
    if (iCab < 0) continue;
    const col = {} as Record<Coluna, number>;
    rows[iCab].forEach((c, i) => {
      const n = normalizar(c);
      for (const k of Object.keys(CABECALHO) as Coluna[]) if (col[k] == null && CABECALHO[k].test(n)) { col[k] = i; break; }
    });
    const cel = (r: unknown[], k: Coluna) => (col[k] == null ? "" : r[col[k]]);

    const daAba: LinhaToxico[] = [];
    let naoPrecisa = false;
    rows.slice(iCab + 1).forEach((r, k) => {
      // A linha "MOTORISTAS CAT B - NÃO PRECISAM DE TOXICOLÓGICO" separa quem não precisa.
      if (r.some((c) => /NAO PRECISA/.test(normalizar(c)))) { naoPrecisa = true; return; }
      let nome = texto(cel(r, "nome"));
      if (!nome) return;
      const avisos: string[] = [];

      let cpf = digitos(cel(r, "cpf"));
      if (cpf.length !== 11) {
        const colado = nome.match(/(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\s*$/);
        if (colado) { cpf = digitos(colado[1]); nome = nome.slice(0, colado.index).trim(); avisos.push("CPF estava junto do nome: separado"); }
      }
      if (cpf.length !== 11) { cpf = ""; avisos.push("Sem CPF: inclua o colaborador à mão pela tela"); }

      const cnhTexto = texto(cel(r, "cnh"));
      let cnh = normCnh(cnhTexto);
      if (cnhTexto && !cnh) avisos.push(`CNH "${cnhTexto}" não reconhecida`);
      if (!cnh && naoPrecisa) cnh = "B";

      const lerData = (k: Coluna, rotulo: string): string | null => {
        const d = dataDaCelula(cel(r, k));
        if (d === undefined && /^S\/?\s*TOX/.test(normalizar(cel(r, k)))) { avisos.push(`${rotulo} marcada "S/TOXIC" (sem toxicológico)`); return null; }
        if (d === undefined) { avisos.push(`${rotulo} ilegível ("${texto(cel(r, k))}"): ignorada`); return null; }
        return d;
      };
      const validade = lerData("validade", "Validade");
      let ultimo = lerData("ultimo", "Data do último exame");
      if (ultimo && ultimo > hoje) { avisos.push(`Último exame no futuro (${fmtData(ultimo)}): descartado`); ultimo = null; }
      if (ultimo && validade && ultimo > validade) { avisos.push(`Último exame (${fmtData(ultimo)}) depois da validade: descartado`); ultimo = null; }

      // A coluna da clínica servia para anotar a cobrança; o texto vai para a observação.
      const clinicaTexto = texto(cel(r, "clinica"));
      const obsTexto = texto(cel(r, "observacao"));
      const cobranca = cobrancaDoTexto(clinicaTexto, hoje) ?? cobrancaDoTexto(obsTexto, hoje);
      const ehCobranca = !!cobrancaDoTexto(clinicaTexto, hoje);
      // "DEMITIDO" não entra: quem diz se a pessoa saiu é a Senior.
      const obs = [/^DEMITID[OA]$/.test(normalizar(obsTexto)) ? "" : obsTexto, ehCobranca ? clinicaTexto : ""].filter(Boolean).join(" · ");

      daAba.push({
        aba: nomeAba, linha: iCab + k + 2, nome, cpf,
        local_trabalho: texto(cel(r, "local")) || null, funcao: texto(cel(r, "funcao")) || null, categoria_cnh: cnh,
        data_ultimo_exame: ultimo, data_validade: validade, ultima_cobranca_em: cobranca,
        clinica: ehCobranca ? null : clinicaTexto || null, observacao: obs || null, nao_precisa: naoPrecisa, avisos,
      });
    });
    if (daAba.length === 0) continue;
    abas.push({
      nome: nomeAba, linhas: daAba.length, naoPrecisam: daAba.filter((l) => l.nao_precisa).length,
      responsavel: responsavelDaAba(nomeAba, daAba.map((l) => l.local_trabalho ?? "")),
    });
    linhas.push(...daAba);
  }
  return { abas, linhas };
}

/** O que vai para sst_toxico_importar: as linhas com CPF, com o responsável escolhido para a aba. */
export const linhasParaImportar = (l: LinhaToxico[], responsavelPorAba: Record<string, string>) =>
  l.filter((x) => x.cpf).map((x) => ({
    aba: x.aba, linha: x.linha, nome: x.nome, cpf: x.cpf, categoria_cnh: x.categoria_cnh, local_trabalho: x.local_trabalho,
    responsavel: (responsavelPorAba[x.aba] ?? "").trim() || null, data_ultimo_exame: x.data_ultimo_exame, data_validade: x.data_validade,
    ultima_cobranca_em: x.ultima_cobranca_em, clinica: x.clinica, observacao: x.observacao,
  }));
