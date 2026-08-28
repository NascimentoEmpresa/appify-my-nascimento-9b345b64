// Domínio do Controle de Diárias (módulo Operacional).

export type TurnoDiaria = "manha" | "tarde" | "noite" | "dia_inteiro";
export type StatusSolicitacao = "solicitada" | "aprovada" | "reprovada";

export const TURNOS: { value: TurnoDiaria; label: string }[] = [
  { value: "manha", label: "Manhã" },
  { value: "tarde", label: "Tarde" },
  { value: "noite", label: "Noite" },
  { value: "dia_inteiro", label: "Dia Inteiro" },
];

export const labelTurno = (t: TurnoDiaria) => TURNOS.find((x) => x.value === t)?.label ?? t;

export const STATUS_SOLICITACAO: Record<StatusSolicitacao, { label: string; cls: string }> = {
  solicitada: { label: "Solicitada", cls: "border-warning/40 bg-warning/10 text-warning" },
  aprovada: { label: "Aprovada", cls: "border-success/40 bg-success/10 text-success" },
  reprovada: { label: "Reprovada", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};

export interface ContratoOpcao {
  id: string;
  numero: string;
  descricao: string;
  empresa: string;
  postos: string[];
}

export interface LinhaDiaria {
  id: string;
  data: string; // yyyy-mm-dd
  turno: TurnoDiaria;
  qtVt: number;
  valorUnitVt: number;
  valorDiaria: number;
}

export interface AnexoDiaria {
  nome: string;
  tipo: string; // PDF, JPG, ...
  tamanho: string; // já formatado
  enviadoEm: string;
}

export interface SolicitacaoDiaria {
  id: string; // SD-2025-000123
  criadoEm: string; // 18/05/2025 às 09:24
  status: StatusSolicitacao;
  contratoId: string;
  posto: string;
  faltanteNome: string;
  faltanteCpf: string;
  diaristaNome: string;
  diaristaCpf: string;
  pix: string;
  diarias: LinhaDiaria[];
  comprovantePonto: AnexoDiaria[];
  documentos: AnexoDiaria[];
  observacoes: string;
  solicitante: string;
  // Preenchidos na aprovação (seção 7 — pré-visualização do Malote).
  maloteMotivo?: string;
  maloteDataPagamento?: string;
}

export const valorTotalLinha = (l: Pick<LinhaDiaria, "qtVt" | "valorUnitVt" | "valorDiaria">) =>
  l.valorDiaria + l.qtVt * l.valorUnitVt;

export const valorTotalSolicitacao = (s: Pick<SolicitacaoDiaria, "diarias">) =>
  s.diarias.reduce((acc, l) => acc + valorTotalLinha(l), 0);

export const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtData = (iso: string) => {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
};

// ---------------------------------------------------------------------------
// CPF
// ---------------------------------------------------------------------------

export const soDigitos = (v: string) => v.replace(/\D/g, "");

export function mascaraCpf(v: string) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Validação de dígito verificador — a regra pede não aceitar CPF inexistente. */
export function cpfValido(v: string) {
  const cpf = soDigitos(v);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

// ---------------------------------------------------------------------------
// Conflito de escala
// ---------------------------------------------------------------------------

/**
 * "Dia Inteiro" cobre os três turnos, então conflita com qualquer um deles.
 * Os demais turnos só conflitam entre iguais.
 */
export const turnosConflitam = (a: TurnoDiaria, b: TurnoDiaria) =>
  a === b || a === "dia_inteiro" || b === "dia_inteiro";

export type TipoConflito = "faltante" | "diarista" | "ambos";

export interface ConflitoLinha {
  tipo: TipoConflito;
  detalhe: string; // ex.: "19/05/2025 - Manhã"
}

interface AlvoConflito {
  faltanteCpf: string;
  diaristaCpf: string;
  linhas: { data: string; turno: TurnoDiaria }[];
}

/**
 * Retorna, por índice de linha, o conflito encontrado — dentro da própria
 * solicitação e contra as solicitações já lançadas (mesma data e turno
 * equivalente, para o mesmo faltante e/ou diarista).
 */
export function avaliarConflitos(
  alvo: AlvoConflito,
  existentes: SolicitacaoDiaria[],
): (ConflitoLinha | null)[] {
  const faltante = soDigitos(alvo.faltanteCpf);
  const diarista = soDigitos(alvo.diaristaCpf);

  return alvo.linhas.map((linha, i) => {
    if (!linha.data) return null;
    let comFaltante = false;
    let comDiarista = false;
    let detalhe = "";

    const marcar = (cf: boolean, cd: boolean, data: string, turno: TurnoDiaria) => {
      if (!cf && !cd) return;
      comFaltante = comFaltante || cf;
      comDiarista = comDiarista || cd;
      if (!detalhe) detalhe = `${fmtData(data)} - ${labelTurno(turno)}`;
    };

    // Dentro da própria solicitação: faltante e diarista são os mesmos, então
    // repetir data + turno equivalente conflita nos dois.
    alvo.linhas.forEach((outra, j) => {
      if (i === j || !outra.data) return;
      if (outra.data === linha.data && turnosConflitam(outra.turno, linha.turno)) {
        marcar(!!faltante, !!diarista, outra.data, outra.turno);
      }
    });

    // Contra o que já está lançado.
    for (const s of existentes) {
      if (s.status === "reprovada") continue; // reprovada não ocupa escala
      const mesmoFaltante = !!faltante && soDigitos(s.faltanteCpf) === faltante;
      const mesmoDiarista = !!diarista && soDigitos(s.diaristaCpf) === diarista;
      if (!mesmoFaltante && !mesmoDiarista) continue;
      for (const l of s.diarias) {
        if (l.data === linha.data && turnosConflitam(l.turno, linha.turno)) {
          marcar(mesmoFaltante, mesmoDiarista, l.data, l.turno);
        }
      }
    }

    if (!comFaltante && !comDiarista) return null;
    const tipo: TipoConflito =
      comFaltante && comDiarista ? "ambos" : comFaltante ? "faltante" : "diarista";
    return { tipo, detalhe };
  });
}

export const textoConflito = (c: ConflitoLinha) =>
  c.tipo === "ambos"
    ? "Duplicidade no faltante e diarista"
    : c.tipo === "faltante"
      ? "Duplicidade no faltante"
      : "Duplicidade no diarista";

export const CONTRATOS_DISPONIVEIS: ContratoOpcao[] = [];

export const rotuloContrato = (id: string) => {
  const c = CONTRATOS_DISPONIVEIS.find((x) => x.id === id);
  return c ? `${c.numero} - ${c.descricao}` : id;
};

export const empresaDoContrato = (id: string) =>
  CONTRATOS_DISPONIVEIS.find((c) => c.id === id)?.empresa ?? "—";

export const POSTOS_DISPONIVEIS: string[] = [];
