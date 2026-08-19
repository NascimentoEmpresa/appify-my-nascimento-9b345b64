// Domínio do Controle de Diárias (módulo Operacional).
//
// Ainda não existe tabela no Supabase para diárias — esta tela é a primeira
// entrega, só de frontend, em cima das telas aprovadas. Tudo aqui (contratos,
// postos e a lista de solicitações) é mock em memória; quando o backend
// existir, basta trocar `SOLICITACOES_MOCK` pela query e manter os tipos.

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

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

export const CONTRATOS: ContratoOpcao[] = [
  { id: "CT-2025/0107", numero: "CT-2025/0107", descricao: "Serviço de Portaria", empresa: "HAGG", postos: ["Portaria 01", "Portaria 02", "Portaria 03", "Portaria 04"] },
  { id: "CT-2025/0108", numero: "CT-2025/0108", descricao: "Serviço de Recepção", empresa: "HAGG", postos: ["Recepção", "Recepção 02"] },
  { id: "CT-2025/0109", numero: "CT-2025/0109", descricao: "Serviço de Limpeza", empresa: "RAZÃO & SARDA LTDA", postos: ["Zeladoria", "Zeladoria 02"] },
  { id: "CT-2025/0110", numero: "CT-2025/0110", descricao: "Apoio Operacional", empresa: "RAZÃO & SARDA LTDA", postos: ["Portaria 03", "Apoio 01"] },
];

export const rotuloContrato = (id: string) => {
  const c = CONTRATOS.find((x) => x.id === id);
  return c ? `${c.numero} - ${c.descricao}` : id;
};

export const empresaDoContrato = (id: string) => CONTRATOS.find((c) => c.id === id)?.empresa ?? "—";

export const POSTOS = Array.from(new Set(CONTRATOS.flatMap((c) => c.postos))).sort((a, b) =>
  a.localeCompare(b, "pt-BR"),
);

const anexo = (nome: string, tipo: string, tamanho: string): AnexoDiaria => ({
  nome,
  tipo,
  tamanho,
  enviadoEm: "18/05/2025 às 09:26",
});

const pessoas = [
  { nome: "João Carlos da Silva", cpf: "529.982.247-25" },
  { nome: "Maria Souza", cpf: "111.444.777-35" },
  { nome: "Paulo Santos", cpf: "390.533.447-05" },
  { nome: "José Oliveira", cpf: "168.995.350-09" },
  { nome: "Fernanda Alves", cpf: "946.827.870-02" },
  { nome: "Gabriel Costa", cpf: "016.394.520-02" },
];

const diaristas = [
  { nome: "Carlos Pereira", cpf: "153.509.460-56", pix: "11 98765-4321" },
  { nome: "Ana Lima", cpf: "796.020.610-88", pix: "ana.lima.pix@gmail.com" },
  { nome: "Bruno Rodrigues", cpf: "222.333.444-05", pix: "bruno.rodrigues@pix.com" },
  { nome: "Marcos Vinícius Almeida", cpf: "875.234.930-13", pix: "11987654321 (CPF)" },
];

/** 128 solicitações, para bater com os totais das telas aprovadas. */
export const SOLICITACOES_MOCK: SolicitacaoDiaria[] = Array.from({ length: 128 }, (_, i) => {
  const n = 128 - i; // mais recente primeiro
  const contrato = CONTRATOS[n % CONTRATOS.length];
  const faltante = pessoas[n % pessoas.length];
  const diarista = diaristas[n % diaristas.length];
  const turno = TURNOS[n % 3].value;
  const dia = String(10 + (n % 18)).padStart(2, "0");
  const status: StatusSolicitacao =
    n % 7 === 0 ? "reprovada" : n % 2 === 0 ? "aprovada" : "solicitada";
  return {
    id: `SD-2025-${String(n).padStart(6, "0")}`,
    criadoEm: `${dia}/05/2025 às 09:24`,
    status,
    contratoId: contrato.id,
    posto: contrato.postos[n % contrato.postos.length],
    faltanteNome: faltante.nome,
    faltanteCpf: faltante.cpf,
    diaristaNome: diarista.nome,
    diaristaCpf: diarista.cpf,
    pix: diarista.pix,
    diarias: [
      {
        id: `${n}-1`,
        data: `2025-05-${dia}`,
        turno,
        qtVt: n % 3 === 0 ? 1 : 2,
        valorUnitVt: 11,
        valorDiaria: 125,
      },
    ],
    comprovantePonto: [anexo("comprovante_ponto.pdf", "PDF", "256 KB")],
    documentos: [anexo("documento_foto.jpg", "JPG", "512 KB")],
    observacoes: `Solicitação referente à cobertura de escala no dia ${dia}/05/2025.\nFavor revisar apontamentos de inconsistência antes de aprovar.`,
    solicitante: "Iury de Jesus Silva",
  };
});
