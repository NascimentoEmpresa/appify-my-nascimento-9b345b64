/**
 * Saídas por Contrato (SIS-2026-0769) — tipos e regras de leitura do relatório.
 *
 * A conta pesada está nas RPCs `sup_rel_saidas_por_contrato` e
 * `sup_rel_saidas_cobertura`. Aqui mora só o que transforma a linha crua em
 * leitura: agrupar por contrato, somar por competência e — o ponto do chamado —
 * dizer de onde veio cada número.
 *
 * Por que "origem" existe e não pode sumir da tela: de março a junho/2026 o
 * vínculo entre a saída e o contrato tinha se perdido, porque os pedidos foram
 * apagados DENTRO do sistema antigo antes da importação (dos ids 253..4535 do
 * legado só 1.872 chegaram). O que reconstruiu esse vínculo foram exports em
 * Excel feitos enquanto o sistema antigo rodava — dado de boa procedência, mas
 * que NÃO é registro do ERP. Numa análise de lucratividade essa diferença
 * importa, então a tela sempre mostra as três origens separadas em vez de um
 * total único que fecharia bonito e esconderia a reconstrução.
 *
 * Maio/2026 fica em ~54% de cobertura e não há como melhorar: o mês cai no vão
 * entre o export de 27/04 e o de 23/06, e o setor confirmou em 30/10/2026 que
 * não existe outro arquivo.
 */

export type OrigemSaida = "sistema" | "planilha" | "sem_destino";

export interface LinhaSaida {
  competencia: string;
  contrato_id: string | null;
  contrato_nome: string;
  sup_item_id: string | null;
  item_nome: string;
  item_codigo: string | null;
  item_tipo: string | null;
  quantidade: number;
  /** 'sistema' | 'sem_destino' | 'planilha:<arquivo>' — cru, como a RPC devolve. */
  origem: string;
}

export interface LinhaCobertura {
  competencia: string;
  unidades_total: number;
  unidades_sistema: number;
  unidades_planilha: number;
  unidades_sem_destino: number;
}

export interface FiltroSaidas {
  inicio: string;
  fim: string;
  contratoId: string | null;
}

/**
 * A RPC devolve 'planilha:ATÉ 23-04-2026.xlsx' para guardar a procedência no
 * próprio dado. A tela agrupa por categoria; o nome do arquivo aparece só no
 * detalhe e na exportação.
 */
export function categoriaOrigem(origem: string): OrigemSaida {
  if (origem === "sistema") return "sistema";
  if (origem.startsWith("planilha:")) return "planilha";
  return "sem_destino";
}

export function arquivoDaOrigem(origem: string): string | null {
  return origem.startsWith("planilha:") ? origem.slice("planilha:".length) : null;
}

export const ROTULO_ORIGEM: Record<OrigemSaida, string> = {
  sistema: "Registrado no sistema",
  planilha: "Reconstruído de planilha",
  sem_destino: "Sem contrato identificado",
};

export interface ResumoContrato {
  contrato_id: string | null;
  contrato_nome: string;
  quantidade: number;
  sistema: number;
  planilha: number;
  sem_destino: number;
}

/** Soma as linhas por contrato, mantendo a separação por origem. */
export function resumirPorContrato(linhas: LinhaSaida[]): ResumoContrato[] {
  const porContrato = new Map<string, ResumoContrato>();
  for (const l of linhas) {
    const chave = l.contrato_id ?? "__sem__";
    let r = porContrato.get(chave);
    if (!r) {
      r = {
        contrato_id: l.contrato_id,
        contrato_nome: l.contrato_nome,
        quantidade: 0,
        sistema: 0,
        planilha: 0,
        sem_destino: 0,
      };
      porContrato.set(chave, r);
    }
    r.quantidade += l.quantidade;
    r[categoriaOrigem(l.origem)] += l.quantidade;
  }
  return [...porContrato.values()].sort((a, b) => b.quantidade - a.quantidade);
}

/**
 * Percentual de unidades com contrato identificado — some o que veio do
 * sistema com o que foi reconstruído, porque as duas respondem "para qual
 * contrato foi". Devolve null quando não houve saída no mês, para a tela
 * mostrar "—" em vez de 0%, que sugeriria mês ruim onde não houve movimento.
 */
export function percentualCobertura(linha: LinhaCobertura): number | null {
  if (!linha.unidades_total) return null;
  const comDestino = linha.unidades_sistema + linha.unidades_planilha;
  return Math.round((100 * comDestino) / linha.unidades_total);
}

/** Abaixo disso a tela destaca o mês: o número não sustenta análise fechada. */
export const LIMIAR_COBERTURA_CONFIAVEL = 90;

export function coberturaPreocupante(linha: LinhaCobertura): boolean {
  const pct = percentualCobertura(linha);
  return pct !== null && pct < LIMIAR_COBERTURA_CONFIAVEL;
}

const CABECALHO_CSV = [
  "competencia",
  "contrato",
  "item",
  "codigo",
  "tipo",
  "quantidade",
  "origem",
  "arquivo_origem",
];

function campoCsv(valor: string | number | null): string {
  const s = valor === null || valor === undefined ? "" : String(valor);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV com ponto-e-vírgula (o Excel em pt-BR abre assim sem pedir importação) e
 * uma coluna de origem por linha — quem receber o arquivo precisa conseguir
 * separar o que é registro do que é reconstrução sem voltar aqui para perguntar.
 */
export function gerarCsvSaidas(linhas: LinhaSaida[]): string {
  const corpo = linhas.map((l) =>
    [
      l.competencia,
      l.contrato_nome,
      l.item_nome,
      l.item_codigo,
      l.item_tipo,
      l.quantidade,
      ROTULO_ORIGEM[categoriaOrigem(l.origem)],
      arquivoDaOrigem(l.origem),
    ]
      .map(campoCsv)
      .join(";"),
  );
  return [CABECALHO_CSV.join(";"), ...corpo].join("\n");
}
