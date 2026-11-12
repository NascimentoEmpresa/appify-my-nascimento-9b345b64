// =====================================================================
// BONIFICAÇÃO — detalhe dos valores do Comparativo individual (12/11/2026).
//
// Pablo: "ao colocar o mouse em cima dos valores apareça detalhadamente do
// que se trata, todos valores de cada chamado, e ao clicar no valor do
// chamado abra o chamado" + "adiciona uma I.A pra fazer perguntas sobre esse
// comparativo individual e valores". Aqui: as linhas do detalhe (cada
// entrega, de onde veio o valor) e o contexto que vai para a I.A — puro, com
// teste em src/test/bonificacao-detalhe.test.ts.
// =====================================================================
import { CRITERIOS, ROTULO_CRITERIO, type EntregaBonificacao, type ResumoDev } from "./bonificacaoColetiva";

/** Campos extras que a entrega da tela tem (EntregaDetalhada) e o detalhe usa. */
type EntregaComOrigem = EntregaBonificacao & {
  valoresAvaliados?: boolean; observacao?: string | null;
  horasInternas?: number | null; custoInterno?: number | null; lucro?: number | null;
};

/** "lucro" = valor de mercado − custo real conosco (lucroDaEntrega, 12/11/2026). */
export type CampoValor = "valorMercado" | "valorFreelancer" | "lucro";
export type OrigemValor = "gestor" | "ia" | "sem valor";

export interface LinhaDetalheValor {
  chamadoId: string;
  numero: string;
  assunto: string;
  valor: number;
  origem: OrigemValor;
  observacao: string | null;
  /** Só no lucro: a conta (mercado − horas × hora do salário). */
  conta?: string | null;
}

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const horasTxt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function valorDoCampo(e: EntregaComOrigem, campo: CampoValor): number | null {
  const v = e[campo] as number | null | undefined;
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

export function origemDoValor(e: EntregaComOrigem, campo: CampoValor): OrigemValor {
  const v = valorDoCampo(e, campo);
  if (v === null) return "sem valor";
  return e.valoresAvaliados ? "gestor" : "ia";
}

/** Entregas do dev com o valor do campo, da maior para a menor. Soma = total da coluna. */
export function detalheValores(entregas: EntregaComOrigem[], campo: CampoValor): LinhaDetalheValor[] {
  return entregas
    .map((e) => ({
      chamadoId: e.chamadoId,
      numero: e.numero ?? "—",
      assunto: e.assunto,
      valor: valorDoCampo(e, campo) ?? 0,
      origem: origemDoValor(e, campo),
      observacao: e.observacao?.trim() || null,
      conta: campo === "lucro" && e.lucro != null && e.valorMercado != null && e.custoInterno != null && e.horasInternas
        ? `${reais(e.valorMercado)} de mercado − ${reais(e.custoInterno)} de custo real (${horasTxt(e.horasInternas)} h × hora do salário)`
        : null,
    }))
    .sort((a, b) => b.valor - a.valor || a.numero.localeCompare(b.numero));
}

export const ROTULO_ORIGEM: Record<OrigemValor, string> = {
  gestor: "avaliação do gestor",
  ia: "parecer da I.A",
  "sem valor": "sem valor",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * O que a I.A recebe: exatamente o que o comparativo mostra no mês, por dev,
 * com cada entrega (valor, origem e observação). JSON compacto.
 */
export function contextoComparativo(devs: ResumoDev[], rotuloMes: string): string {
  return JSON.stringify({
    mes: rotuloMes,
    regra: "Soma das entregas CONCLUÍDAS no mês. Valores estimados; não alteram o pagamento (cota igual para todos). Lucro = valor de mercado − custo real (horas da equipe interna × hora do salário de R$ 3.138,65 ÷ 220 h).",
    desenvolvedores: devs.map((d) => {
      const n = d.entregas.length;
      return {
        nome: d.devNome,
        entregas: n,
        nota_final: d.nota === null ? null : r2(d.nota),
        criterios: Object.fromEntries(CRITERIOS.map((k) => [ROTULO_CRITERIO[k], d.medias[k] === null ? null : r2(d.medias[k] as number)])),
        mercado_total: r2(d.mercado),
        media_por_entrega: n ? r2(d.mercado / n) : null,
        freelancer_total: r2(d.freelancer),
        lucro_total: r2((d.entregas as EntregaComOrigem[]).reduce((a, e) => a + (e.lucro ?? 0), 0)),
        chamados: (d.entregas as EntregaComOrigem[]).map((e) => ({
          numero: e.numero,
          assunto: e.assunto.slice(0, 140),
          concluido: e.concluidoDia,
          mercado: e.valorMercado,
          freelancer: e.valorFreelancer,
          ...(e.custoInterno != null ? { custo_real: e.custoInterno, horas_internas: e.horasInternas, lucro: e.lucro } : {}),
          origem: origemDoValor(e, "valorMercado"),
          ...(e.observacao?.trim() ? { observacao: e.observacao.trim().slice(0, 300) } : {}),
        })),
      };
    }),
  });
}
