import { feriadosNacionais } from "@/lib/feriadosNacionais";

/**
 * REGRAS DA SOLICITAÇÃO DE VAGA — fonte única.
 *
 * As mesmas regras valem nas duas telas que abrem vaga (o encarregado em
 * "Minhas Solicitações" e o RH em "Recrutamento"), e são reforçadas no banco
 * pelo trigger `sistema_recrutamento_guard` (migration 20260903000001). Aqui
 * é onde elas ficam escritas uma vez só — se mudar o prazo ou a lista de
 * cargos com CNH, muda neste arquivo (e no trigger, que é o piso).
 */

// ── Motivo da vaga ──────────────────────────────────────────────────────
// "Expansão" virou "Expansão (Aumento de Quadro)". As vagas antigas seguem
// gravadas como "Expansão" — `motivoLabel` mostra o nome novo pras duas.
export const MOTIVO_EXPANSAO = "Expansão (Aumento de Quadro)";
export const MOTIVO_SUBSTITUICAO = "Substituição";
export const MOTIVOS_VAGA = ["Admissão", MOTIVO_SUBSTITUICAO, MOTIVO_EXPANSAO, "Transferência", "Retorno"];

export const motivoLabel = (m?: string | null): string =>
  String(m ?? "").trim() === "Expansão" ? MOTIVO_EXPANSAO : String(m ?? "");

export const ehSubstituicao = (m?: string | null): boolean =>
  String(m ?? "").trim() === MOTIVO_SUBSTITUICAO;

// ── Colaborador de referência ───────────────────────────────────────────
// Todo motivo de vaga exige escolher alguém do cadastro: é de lá que saem
// cargo, contrato, escala, salário e insalubridade — ninguém digita isso à
// mão e ninguém erra o posto. A ÚNICA diferença entre os motivos é o nome:
// em Substituição ele fica registrado na vaga (a vaga repõe aquela pessoa);
// nos outros ele é só o molde e não aparece em lugar nenhum.
export const rotuloReferencia = (m?: string | null): string =>
  ehSubstituicao(m) ? "Colaborador a Substituir" : "Selecione alguém com o mesmo cargo";

export const ajudaReferencia = (m?: string | null): string =>
  ehSubstituicao(m)
    ? "Cargo, contrato, escala e salário vêm do cadastro dele e não podem ser trocados."
    : "Serve só de molde: cargo, contrato, escala e salário vêm do cadastro dele. O nome não fica na vaga.";

/** O nome do escolhido só é exibido quando a vaga é de Substituição. */
export const mostraNomeReferencia = (m?: string | null): boolean => ehSubstituicao(m);

// ── Substituído só pode estar em UMA vaga ───────────────────────────────
// Um colaborador não pode ser escolhido para substituição se já existe vaga
// de substituição dele em pé. Reprovada e Cancelada não seguram ninguém: não
// repõem o posto, e travar a pessoa por causa de uma vaga recusada só daria
// trabalho pro RH. O piso é o banco (índice único parcial + trigger
// `rec_substituido_unico`, migration 20260909000009) — aqui é para a tela
// avisar ANTES de a pessoa preencher três etapas e tomar erro no fim.
export const STATUS_VAGA_MORTA = ["Reprovada", "Cancelada"];

export const vagaSeguraSubstituido = (status?: string | null): boolean =>
  !STATUS_VAGA_MORTA.includes(String(status ?? "").trim());

/**
 * Dos IDs de empregado passados, quais já estão presos a uma vaga viva.
 * Devolve empregado → número da vaga, para a tela poder dizer QUAL é.
 *
 * Recebe o client em vez de importá-lo: mantém este arquivo sem dependência
 * de Supabase (é ele que os testes carregam) e serve as duas telas.
 * Banco ainda sem a coluna: devolve vazio e a regra fica só no servidor.
 */
export async function substituidosComVagaViva(
  sb: any, ids: number[],
): Promise<Map<number, number>> {
  const presos = new Map<number, number>();
  const alvos = Array.from(new Set(ids.filter(n => Number.isFinite(n))));
  if (!alvos.length) return presos;
  const { data, error } = await sb.from("SISTEMA_RECRUTAMENTO")
    .select("id, substituido_id, status")
    .in("substituido_id", alvos);
  if (error || !data) return presos;
  for (const v of data as any[]) {
    const emp = Number(v.substituido_id);
    if (!Number.isFinite(emp) || !vagaSeguraSubstituido(v.status)) continue;
    if (!presos.has(emp)) presos.set(emp, Number(v.id));
  }
  return presos;
}

export const avisoSubstituidoPreso = (vagaId: number): string =>
  `Esse colaborador já está na vaga de substituição #${vagaId}. Só dá para abrir outra depois que aquela for concluída, cancelada ou reprovada.`;

// ── Salário ─────────────────────────────────────────────────────────────
// Quem ABRE a vaga (encarregado/solicitante) não vê salário — vê a máscara.
// Operacional e Recrutamento, que aprovam, veem o valor.
export const SALARIO_MASCARA = "****";

// ── Contrato do empregado ───────────────────────────────────────────────
/**
 * Acha o contrato do empregado dentro da lista de CONTRATOS ativos.
 *
 * A ligação é pela Filial, mas UMA FILIAL PODE TER MAIS DE UM CONTRATO — a
 * 1093, por exemplo, tem "LIMPEZA HUSM" e "ADM E ESTAGIARIOS - NH". Pegar o
 * primeiro que o `find` achava trazia o contrato errado para metade da
 * filial. No empate quem desempata é o `Nome Filial` do próprio empregado,
 * que é onde o Senior grava o contrato dele.
 */
export function contratoDoEmpregado<T extends Record<string, any>>(
  contratos: T[], emp: Record<string, any> | null | undefined,
): T | null {
  const filial = String(emp?.["Filial"] ?? "").trim();
  if (!filial) return null;
  const daFilial = contratos.filter(c => String(c.Filial ?? "").trim() === filial);
  if (daFilial.length <= 1) return daFilial[0] ?? null;
  const nomeFilial = String(emp?.["Nome Filial"] ?? "").trim().toUpperCase();
  return daFilial.find(c => String(c["NOME CONTRATO"] ?? "").trim().toUpperCase() === nomeFilial)
      ?? daFilial[0];
}

// ── Dias úteis ──────────────────────────────────────────────────────────
// Seg–sex menos feriados NACIONAIS (ponto facultativo não conta como
// feriado — é dia útil pra empresa). Feriado estadual/municipal não entra:
// não existe esse cadastro no ERP.
const feriadosCache = new Map<number, Set<string>>();
const feriadosDoAno = (ano: number): Set<string> => {
  let s = feriadosCache.get(ano);
  if (!s) {
    s = new Set(feriadosNacionais(ano).filter(f => f.tipo === "Feriado").map(f => f.data));
    feriadosCache.set(ano, s);
  }
  return s;
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Data local (não UTC): `new Date("2026-08-20")` cai no dia anterior no Brasil. */
const doIso = (s: string) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, (m || 1) - 1, d || 1); };
export const hojeIso = () => iso(new Date());

export const ehDiaUtil = (dataIso: string): boolean => {
  const d = doIso(dataIso);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !feriadosDoAno(d.getFullYear()).has(dataIso);
};

/** Dias úteis de `de` (exclusive) até `ate` (inclusive). Negativo = passado. */
export function diasUteisEntre(deIso: string, ateIso: string): number {
  if (!deIso || !ateIso) return 0;
  if (ateIso < deIso) return -diasUteisEntre(ateIso, deIso);
  let n = 0;
  const cur = doIso(deIso);
  const fim = doIso(ateIso);
  while (cur < fim) {
    cur.setDate(cur.getDate() + 1);
    if (ehDiaUtil(iso(cur))) n++;
  }
  return n;
}

/** Soma dias úteis a uma data (pula fim de semana e feriado). */
export function somaDiasUteis(deIso: string, dias: number): string {
  const cur = doIso(deIso);
  let faltam = dias;
  while (faltam > 0) {
    cur.setDate(cur.getDate() + 1);
    if (ehDiaUtil(iso(cur))) faltam--;
  }
  return iso(cur);
}

// ── Prazo mínimo e grau de urgência ─────────────────────────────────────
// Vaga não abre para daqui a menos de 7 dias ÚTEIS. Dentro disso, o grau sai
// do próprio prazo — ninguém escolhe na mão:
//   7 a 13 dias úteis  → Alta — Urgente
//   14 a 20            → Média
//   21 ou mais         → Baixa
export const MIN_DIAS_UTEIS = 7;
export const GRAU_ALTA = "Alta — Urgente";
export const GRAU_MEDIA = "Média";
export const GRAU_BAIXA = "Baixa";

/** Primeira data que a vaga pode ter (hoje + 7 dias úteis). */
export const dataMinimaVaga = (hoje = hojeIso()): string => somaDiasUteis(hoje, MIN_DIAS_UTEIS);

export function grauPorDiasUteis(dias: number): string | null {
  if (dias >= 21) return GRAU_BAIXA;
  if (dias >= 14) return GRAU_MEDIA;
  if (dias >= MIN_DIAS_UTEIS) return GRAU_ALTA;
  return null;   // abaixo do mínimo: não tem grau, tem impedimento
}

export interface PrazoVaga {
  dias: number;          // dias úteis entre hoje e a data escolhida
  grau: string | null;   // null = abaixo do mínimo
  ok: boolean;
  erro: string | null;   // mensagem pronta pro usuário
  minima: string;        // primeira data aceita (yyyy-mm-dd)
}

/** Avalia a data escolhida: quantos dias úteis faltam, qual grau e se passa. */
export function avaliarPrazo(dataIso: string, hoje = hojeIso()): PrazoVaga {
  const minima = dataMinimaVaga(hoje);
  if (!dataIso) return { dias: 0, grau: null, ok: false, erro: "Informe a data de início prevista.", minima };
  const dias = diasUteisEntre(hoje, dataIso);
  const grau = grauPorDiasUteis(dias);
  if (!grau) return {
    dias, grau: null, ok: false, minima,
    erro: `A vaga precisa de no mínimo ${MIN_DIAS_UTEIS} dias úteis de antecedência (a data escolhida tem ${dias < 0 ? 0 : dias}). A primeira data possível é ${fmtBr(minima)}.`,
  };
  return { dias, grau, ok: true, erro: null, minima };
}

export const fmtBr = (dataIso?: string | null): string => {
  const s = String(dataIso ?? "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s || "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

// ── CNH obrigatória por cargo ───────────────────────────────────────────
// Cargo que dirige veículo/máquina da empresa entra com CNH obrigatória
// sozinho — o solicitante não precisa lembrar, e não consegue desmarcar.
export const CARGOS_CNH: { rotulo: string; teste: RegExp }[] = [
  { rotulo: "Motorista",                     teste: /\bMOTORISTA\b/ },
  { rotulo: "Tratorista",                    teste: /\bTRATORISTA\b/ },
  { rotulo: "Operador de retroescavadeira",  teste: /RETRO\s*ESCAVADEIRA|RETROESCAVADEIRA/ },
  { rotulo: "Supervisor operacional",        teste: /\bSUPERVISOR(A)?\b.*\bOPERACIONAL\b/ },
];

export const REQ_CNH_TEXTO = "CNH obrigatória (categoria compatível com a função).";

const semAcento = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** Qual regra de CNH o cargo dispara (null = nenhuma). */
export function cargoExigeCnh(cargo?: string | null): string | null {
  const c = semAcento(cargo ?? "");
  if (!c.trim()) return null;
  return CARGOS_CNH.find(x => x.teste.test(c))?.rotulo ?? null;
}

/** Garante a linha da CNH dentro dos requisitos obrigatórios (sem duplicar). */
export function aplicarReqCnh(req: string, cargo?: string | null): string {
  if (!cargoExigeCnh(cargo)) return req;
  if (/\bCNH\b|CARTEIRA DE (MOTORISTA|HABILITA)/.test(semAcento(req))) return req;
  const base = String(req ?? "").trim();
  return base ? `${REQ_CNH_TEXTO}\n${base}` : REQ_CNH_TEXTO;
}
