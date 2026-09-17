// Domínio do Controle de Diárias (módulo Operacional).

export type TurnoDiaria = "manha" | "tarde" | "noite" | "dia_inteiro";
// "paga" NÃO existe no banco: é "aprovada" cuja despesa do Malote já está
// despesa_paga, derivado na leitura (ver 20260930000151_diaria_status_paga.sql).
//
// "em_ajuste" e "excluida" são do banco (20260930000153): a solicitação
// devolvida a quem a criou, e a excluída logicamente — que continua existindo
// porque diária é pagamento a pessoa física e apagar a linha apagaria a prova.
export type StatusSolicitacao =
  | "solicitada"
  | "em_ajuste"
  | "aprovada"
  | "paga"
  | "reprovada"
  | "excluida";

export const TURNOS: { value: TurnoDiaria; label: string }[] = [
  { value: "manha", label: "Manhã" },
  { value: "tarde", label: "Tarde" },
  { value: "noite", label: "Noite" },
  { value: "dia_inteiro", label: "Dia Inteiro" },
];

export const labelTurno = (t: TurnoDiaria) => TURNOS.find((x) => x.value === t)?.label ?? t;

export const STATUS_SOLICITACAO: Record<StatusSolicitacao, { label: string; cls: string }> = {
  solicitada: { label: "Solicitada", cls: "border-warning/40 bg-warning/10 text-warning" },
  em_ajuste: { label: "Em ajuste", cls: "border-info/40 bg-info/10 text-info" },
  aprovada: { label: "Aprovada", cls: "border-success/40 bg-success/10 text-success" },
  paga: { label: "Paga", cls: "border-primary/40 bg-primary/10 text-primary" },
  reprovada: { label: "Reprovada", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  excluida: {
    label: "Excluída",
    cls: "border-muted-foreground/40 bg-muted text-muted-foreground line-through",
  },
};

/**
 * A excluída é exclusão LÓGICA: continua no banco (e na trilha), mas some da
 * lista de trabalho. Só reaparece quando se filtra por ela de propósito —
 * daí este predicado existir num lugar só, e não como um `!== "excluida"`
 * repetido em cada tela.
 */
export const visivelNaLista = (s: { status: StatusSolicitacao }, filtroStatus: string) =>
  s.status !== "excluida" || filtroStatus === "excluida";

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
  categoria: "comprovante_ponto" | "documento";
  storagePath: string;
}

export interface SolicitacaoDiaria {
  /** Chave real no banco — é ela que as mutações usam. */
  uuid: string;
  id: string; // número legível gerado no banco: SD-2026-000123
  criadoEm: string; // 18/05/2025 às 09:24
  status: StatusSolicitacao;
  contratoId: string;
  /**
   * Nome e cliente do contrato ficam GRAVADOS na leitura, não resolvidos por
   * uma tabela de apoio no front: a lista mostra centenas de linhas e ir
   * buscar o contrato de cada uma seria uma consulta por linha.
   */
  contratoNome: string;
  contratoCliente: string;
  contratoEmpresa: string;
  posto: string;
  faltanteNome: string;
  faltanteCpf: string;
  diaristaNome: string;
  diaristaCpf: string;
  pix: string;
  /** Null nas solicitações criadas antes de o campo ter tipo (20260930000153). */
  pixTipo: TipoPix | null;
  diarias: LinhaDiaria[];
  comprovantePonto: AnexoDiaria[];
  documentos: AnexoDiaria[];
  observacoes: string;
  solicitanteId: string;
  solicitante: string;
  // Preenchidos na aprovação (seção 7 — pré-visualização do Malote).
  maloteMotivo?: string;
  maloteDataPagamento?: string;
  // Preenchidos quando o Operacional devolve a solicitação para ajuste. Saem
  // do cabeçalho no reenvio — o histórico fica na trilha (DIARIA_EVENTO).
  ajusteMotivo?: string;
  ajustePedidoPor?: string;
  ajustePedidoEm?: string;
  // Preenchidos na exclusão lógica.
  exclusaoMotivo?: string;
  excluidaPor?: string;
  excluidaEm?: string;
  /**
   * Comprovantes do pagamento feito no Malote. Vazio até a despesa chegar a
   * "Despesa Paga" — é o que diferencia "Aprovada" de "Paga de verdade, com
   * papel". Lista porque diária parcelada tem um comprovante por parcela.
   */
  comprovantesPagamento: ComprovantePagamentoDiaria[];
}

/**
 * O comprovante que o Malote anexou ao pagar de verdade.
 *
 * Vem de `malote_despesa.comprovante_pagamento_path` (ou de cada parcela,
 * quando a diária foi aprovada parcelada) pela coluna computada
 * `diaria_comprovantes_pagamento` — ver 20260930000169. Mora no bucket
 * `malote-anexos`, NÃO no `diarias`: por isso tem abertura própria.
 */
export interface ComprovantePagamentoDiaria {
  rotulo: string;
  storagePath: string;
  /** Já formatado em pt-BR. */
  pagoEm: string;
  pagoPor: string;
  observacao: string;
}

/** Uma abertura da solicitação, carimbada na primeira vez que a pessoa entrou. */
export interface VisualizacaoDiaria {
  userId: string;
  nome: string;
  /** Já formatada em pt-BR: "16/09/2026 - 09:24". */
  quando: string;
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
// Chave Pix
// ---------------------------------------------------------------------------

/**
 * O tipo da chave é ESCOLHIDO, não adivinhado.
 *
 * O campo era texto livre com o placeholder "Digite o e-mail, CPF, telefone ou
 * chave Pix" — quatro formatos numa caixa só, sem máscara e sem conferência.
 * Chave Pix errada é dinheiro na conta de outra pessoa, e o erro só aparece
 * depois do pagamento. Escolher o tipo primeiro é o que permite formatar
 * enquanto digita e recusar o que obviamente não é chave daquele tipo.
 *
 * Chave aleatória (EVP) ficou de fora de propósito: não é uma das quatro
 * opções pedidas, e ninguém decora um UUID de banco para ditar ao encarregado.
 */
export type TipoPix = "celular" | "email" | "cpf" | "cnpj";

export const TIPOS_PIX: { value: TipoPix; label: string; placeholder: string }[] = [
  { value: "celular", label: "Celular", placeholder: "(11) 98765-4321" },
  { value: "email", label: "E-mail", placeholder: "nome@empresa.com.br" },
  { value: "cpf", label: "CPF", placeholder: "000.000.000-00" },
  { value: "cnpj", label: "CNPJ", placeholder: "00.000.000/0000-00" },
];

export const labelTipoPix = (t: TipoPix | null | undefined) =>
  TIPOS_PIX.find((x) => x.value === t)?.label ?? "";

export const placeholderPix = (t: TipoPix | "") =>
  TIPOS_PIX.find((x) => x.value === t)?.placeholder ?? "Escolha antes o tipo da chave";

export function mascaraCelular(v: string) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  // O corte do traço acompanha o tamanho: fixo tem 8 dígitos, celular tem 9.
  const meio = d.length <= 10 ? 6 : 7;
  return `(${d.slice(0, 2)}) ${d.slice(2, meio)}-${d.slice(meio)}`;
}

export function mascaraCnpj(v: string) {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Formata o que a pessoa digita conforme o tipo escolhido. E-mail não tem máscara. */
export function mascaraPix(tipo: TipoPix | "", valor: string) {
  if (tipo === "celular") return mascaraCelular(valor);
  if (tipo === "cpf") return mascaraCpf(valor);
  if (tipo === "cnpj") return mascaraCnpj(valor);
  return valor.trim();
}

/**
 * Validação de dígito verificador do CNPJ — mesma ideia de cpfValido: barrar
 * o número que não existe, não só o que tem tamanho errado.
 */
export function cnpjValido(v: string) {
  const cnpj = soDigitos(v);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (base: string) => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(cnpj.slice(0, 12)) === Number(cnpj[12]) && dv(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

/**
 * A chave serve para aquele tipo? Devolve a mensagem do que está errado, ou
 * `null` quando está válida — é o formato que os campos do modal já usam.
 */
export function erroChavePix(tipo: TipoPix | "", valor: string): string | null {
  const v = valor.trim();
  if (!tipo) return "Escolha o tipo da chave Pix.";
  if (!v) return "Informe a chave Pix.";
  if (tipo === "email") {
    // Deliberadamente frouxo: e-mail válido de verdade só o envio comprova, e
    // regex ambiciosa recusa endereço legítimo (o que trava um pagamento real).
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : "E-mail inválido.";
  }
  const d = soDigitos(v);
  if (tipo === "celular") {
    return d.length === 10 || d.length === 11
      ? null
      : "Informe o telefone com DDD (10 ou 11 dígitos).";
  }
  if (tipo === "cpf") return cpfValido(v) ? null : "CPF inexistente.";
  return cnpjValido(v) ? null : "CNPJ inexistente.";
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
      // Reprovada e excluída não ocupam escala: nenhuma das duas vira
      // pagamento, e barrar por causa delas impediria justamente o
      // relançamento corrigido. Mesma regra de diaria_linha_valida() no banco.
      if (s.status === "reprovada" || s.status === "excluida") continue;
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

// Contratos, postos e o cadastro de faltante/diarista NÃO moram aqui: vêm do
// Supabase por src/hooks/useDiarias.ts. Este arquivo é só a regra da tela
// (turno, CPF, duplicidade, formatação), que é o que os testes cobrem.
