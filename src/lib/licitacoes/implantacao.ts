// =====================================================================
// Contratos — PREVISTO × IMPLANTADO (27/10/2026)
//
// Previsto = o que a Planilha de Custo diz que o contrato tem (assinatura).
// Implantado = o que de fato está rodando — às vezes menor, até a pedido do
// tomador. A Licitação registra o implantado a cada renovação (ou quando
// muda no meio do ano), com justificativa sempre que difere do previsto; os
// supervisores (Ativos/Contratos, Efetividade) trabalham pelo implantado.
//
// As regras abaixo são as MESMAS do banco (mig 20261027000020:
// contrato_implantacao_salvar e contrato_ciclo_inicio) — a tela avisa antes,
// o banco decide.
// =====================================================================

/** Mínimo de caracteres da justificativa (o CHECK do banco usa o mesmo). */
export const JUSTIFICATIVA_MIN = 5;

/** Registro feito até tantos dias antes do aniversário já confirma o ciclo. */
export const ANTECEDENCIA_CICLO_DIAS = 60;

export interface PostoImplantacao {
  posto: string;
  previsto: number;
  implantado: number;
  /** false = nunca registrado: o implantado é o previsto, por padrão. */
  registrado: boolean;
  justificativa: string | null;
  vale_a_partir_de: string | null;
  registrado_em: string | null;
  registrado_por_nome: string | null;
}

export interface ContratoImplantacao {
  id: string;
  nome: string;
  cliente: string | null;
  empresa_id: string | null;
  base_ciclo: string | null;
  ciclo_inicio: string | null;
  previsto: number;
  implantado: number;
  pendente: boolean;
  ultimo_registro: string | null;
  postos: PostoImplantacao[];
}

export interface RegistroImplantacao {
  id: number;
  posto: string;
  previsto: number;
  implantado: number;
  vale_a_partir_de: string;
  justificativa: string | null;
  registrado_por_nome: string | null;
  registrado_em: string;
}

/** Linha do formulário: o implantado chega como texto do input. */
export interface LinhaForm {
  posto: string;
  previsto: number;
  implantado: string;
  justificativa: string;
}

/** Erros por posto (chave = nome do posto). Vazio = pode salvar. */
export function errosImplantacao(linhas: LinhaForm[]): Record<string, string> {
  const erros: Record<string, string> = {};
  for (const l of linhas) {
    const txt = l.implantado.trim();
    const n = Number(txt);
    if (txt === "" || !Number.isInteger(n) || n < 0) {
      erros[l.posto] = "Informe um número inteiro (0 ou mais).";
    } else if (n !== l.previsto && l.justificativa.trim().length < JUSTIFICATIVA_MIN) {
      erros[l.posto] = `Diferente do previsto (${l.previsto}): justifique.`;
    }
  }
  return erros;
}

/** O que vai para contrato_implantacao_salvar. */
export const paraPayload = (linhas: LinhaForm[]) =>
  linhas.map((l) => ({
    posto: l.posto,
    implantado: Number(l.implantado.trim()),
    justificativa: l.justificativa.trim() || null,
  }));

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const deIso = (s: string) => { const [a, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(a, m - 1, d); };

/**
 * Início do ciclo anual vigente em `hoje`: o último aniversário da data base
 * (vigência inicial). null = sem data ou contrato que ainda não começou.
 * 29/02 cai em 28/02 nos anos comuns, como o `+ interval 'n years'` do banco.
 */
export function cicloInicio(base: string | null, hoje: string): string | null {
  if (!base) return null;
  const b = deIso(base), h = deIso(hoje);
  if (b > h) return null;
  const esteAno = aniversario(b, h.getFullYear());
  return iso(esteAno <= h ? esteAno : aniversario(b, h.getFullYear() - 1));
}

/** Próxima renovação: o primeiro aniversário da data base depois de `hoje`. */
export function proximaRenovacao(base: string | null, hoje: string): string | null {
  if (!base) return null;
  const b = deIso(base), h = deIso(hoje);
  if (b > h) return iso(b);
  const esteAno = aniversario(b, h.getFullYear());
  return iso(esteAno > h ? esteAno : aniversario(b, h.getFullYear() + 1));
}

function aniversario(base: Date, ano: number): Date {
  const ultimoDia = new Date(ano, base.getMonth() + 1, 0).getDate();
  return new Date(ano, base.getMonth(), Math.min(base.getDate(), ultimoDia));
}

/** "8 de 10 previstos" quando difere; só o número quando bate. */
export const rotuloImplantado = (implantado: number, previsto: number) =>
  implantado === previsto ? String(implantado) : `${implantado} de ${previsto} previsto${previsto === 1 ? "" : "s"}`;
