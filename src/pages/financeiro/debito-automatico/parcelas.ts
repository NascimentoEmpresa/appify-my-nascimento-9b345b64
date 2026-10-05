// SIS-2026-0570: cálculo de parcelas do Débito Automático. Valores e datas
// podem ser automáticos (divisão igual + um vencimento por mês) ou
// ajustados à mão parcela a parcela na grade do modal.

export interface ParcelaCalculada {
  valor: number;
  data_vencimento: string; // yyyy-mm-dd
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Soma `meses` mantendo o dia; se o mês de destino é mais curto (31 → 30/28),
// cai no último dia dele — assim 31/01 vira 28/02, 31/03 (não "pula" pro mês
// seguinte).
export function somarMeses(dataIso: string, meses: number): string {
  const [a, m, d] = dataIso.split("-").map(Number);
  const alvo = m - 1 + meses;
  const ano = a + Math.floor(alvo / 12);
  const mes = ((alvo % 12) + 12) % 12;
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  return `${ano}-${pad(mes + 1)}-${pad(Math.min(d, ultimoDia))}`;
}

// Divisão igual em centavos: o resto (se houver) vai pra última parcela, pra
// a soma bater exatamente com o total.
export function gerarParcelasAutomaticas(valorTotal: number, quantidade: number, primeiroVencimento: string): ParcelaCalculada[] {
  if (!(quantidade >= 2) || !(valorTotal > 0) || !primeiroVencimento) return [];
  const base = Math.floor((valorTotal * 100) / quantidade) / 100;
  const parcelas: ParcelaCalculada[] = [];
  for (let i = 0; i < quantidade; i++) {
    parcelas.push({ valor: base, data_vencimento: somarMeses(primeiroVencimento, i) });
  }
  const somaBase = r2(base * quantidade);
  parcelas[quantidade - 1].valor = r2(base + (r2(valorTotal) - somaBase));
  return parcelas;
}

export function somaParcelas(parcelas: { valor: number }[]): number {
  return r2(parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0));
}

// Erro de validação da grade (null = ok).
export function validarParcelas(parcelas: ParcelaCalculada[], valorTotal: number): string | null {
  if (parcelas.length < 2) return "Informe ao menos 2 parcelas.";
  for (let i = 0; i < parcelas.length; i++) {
    if (!(parcelas[i].valor > 0)) return `Parcela ${i + 1}: informe um valor maior que zero.`;
    if (!parcelas[i].data_vencimento) return `Parcela ${i + 1}: informe a data de vencimento.`;
  }
  if (somaParcelas(parcelas) !== r2(valorTotal)) return "A soma das parcelas é diferente do valor total.";
  return null;
}

// Dias de hoje até o vencimento (negativo = vencido). Compara só datas.
export function diasParaVencer(dataVencimento: string, hoje: string): number {
  const [a1, m1, d1] = hoje.split("-").map(Number);
  const [a2, m2, d2] = dataVencimento.split("-").map(Number);
  const ms = Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1);
  return Math.round(ms / 86400000);
}

export const DIAS_AVISO_VENCIMENTO = 7;
