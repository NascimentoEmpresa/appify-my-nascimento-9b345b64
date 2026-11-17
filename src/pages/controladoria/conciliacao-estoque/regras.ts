// SIS-2026-0908: Conciliação de Estoque e Custo de Materiais (Controladoria). Funções puras — a tela só junta as fontes.
//
//   Compras de estoque  = saídas do Fluxo de Caixa nos contratos de estoque ("ADMINISTRATIVO - HAGG ESTOQUE", "ADMINISTRATIVO - SN ESTOQUE").
//                         Hoje o Fechamento da Empresa as soma em Outras Despesas (começam com ADMINISTRATIVO).
//   Estoque físico      = foto do almoxarifado (ctl_estoque_foto, mig 20261117160000) no início e no fim; entre as duas, entradas (lotes criados)
//                         e saídas (ledger), tudo a preço de cadastro — o mesmo preço das Saídas por Contrato e da coluna Consumo de Estoque.
//   Estoque Adm (contábil) = estoque inicial + compras − saídas. O inicial contábil é o físico da foto inicial: a conciliação começa na primeira foto
//                         (decisão de 16/11/2026, porque o saldo de uma data passada não se reconstrói pelos movimentos — ver a migration).
//   Diferença           = Estoque Adm (contábil) final − Estoque físico final. Zero quando tudo o que se comprou para estoque entrou no
//                         almoxarifado pelo mesmo valor e nada saiu sem registro. Se não for zero, as pendências dão nome à diferença.

export const normalizar = (nome: string | null | undefined) => (nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

// Contrato de estoque: "ADMINISTRATIVO - HAGG ESTOQUE", "ADMINISTRATIVO - SN ESTOQUE" (o nome termina em ESTOQUE) ou um que comece com "ESTOQUE".
// "ADMINISTRATIVO - HAGG" (sem ESTOQUE) é a despesa administrativa de verdade e não entra.
export function ehContratoEstoque(nome: string | null | undefined): boolean {
  const n = normalizar(nome);
  if (n.startsWith("ESTOQUE")) return true;
  return n.startsWith("ADMINISTRATIVO") && /\bESTOQUE$/.test(n);
}

// Contrato administrativo da empresa: a saída para ele é "saída para o administrativo" (escritório), não para contrato de cliente.
export function ehContratoAdministrativo(nome: string | null | undefined): boolean {
  return normalizar(nome).startsWith("ADMINISTRATIVO");
}

// Classificações de compra de material no Fluxo (para apontar compra lançada direto no contrato que também recebeu saída do estoque).
export function ehClassificacaoMaterial(nome: string | null | undefined): boolean {
  return /\b(UNIFORME|EPI|MATERIA|INSUMO)/.test(normalizar(nome));
}

export interface AcertoConhecido { qtd: number; valor: number }

/** O bloco `fisico` de ctl_conciliacao_estoque_fisico. */
export interface FisicoConciliacao {
  inicial: number;
  entradas: number;
  saidas: number;
  final: number;
  final_tela: number | null;
  entradas_sem_custo: number;
  acertos_conhecidos: Record<string, AcertoConhecido>;
}

export interface SaidaContrato {
  contrato_id: string | null;
  contrato_nome: string;
  empresa_id: string | null;
  valor: number;
  unidades: number;
  unidades_sem_valor: number;
}

export interface ItemMovimentacao {
  item_estoque_id: string;
  item_nome: string | null;
  item_codigo: string | null;
  tipo_item: string | null;
  tamanho: string | null;
  inicial_qtd: number; inicial_valor: number;
  entrada_qtd: number; entrada_valor: number;
  saida_qtd: number; saida_valor: number;
  final_qtd: number; final_valor: number;
  valor_unitario: number;
}

export interface RespostaFisico {
  janela: { foto_inicial: string | null; inicio_em: string | null; foto_final: string | null; fim_agora: boolean; fim_em: string | null };
  fotos: string[];
  fisico: FisicoConciliacao | null;
  estoque_sem_custo: { itens: number; unidades: number };
  saidas_por_contrato: SaidaContrato[];
  itens: ItemMovimentacao[];
}

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** PostgREST devolve numeric como número ou texto, conforme a versão; normaliza tudo para número. */
export function normalizarResposta(bruto: any): RespostaFisico | null {
  if (!bruto) return null;
  const f = bruto.fisico;
  const acertos: Record<string, AcertoConhecido> = {};
  for (const [tipo, a] of Object.entries((f?.acertos_conhecidos ?? {}) as Record<string, any>)) acertos[tipo] = { qtd: n(a?.qtd), valor: n(a?.valor) };
  return {
    janela: {
      foto_inicial: bruto.janela?.foto_inicial ?? null,
      inicio_em: bruto.janela?.inicio_em ?? null,
      foto_final: bruto.janela?.foto_final ?? null,
      fim_agora: !!bruto.janela?.fim_agora,
      fim_em: bruto.janela?.fim_em ?? null,
    },
    fotos: (bruto.fotos ?? []) as string[],
    fisico: f
      ? { inicial: n(f.inicial), entradas: n(f.entradas), saidas: n(f.saidas), final: n(f.final), final_tela: f.final_tela == null ? null : n(f.final_tela), entradas_sem_custo: n(f.entradas_sem_custo), acertos_conhecidos: acertos }
      : null,
    estoque_sem_custo: { itens: n(bruto.estoque_sem_custo?.itens), unidades: n(bruto.estoque_sem_custo?.unidades) },
    saidas_por_contrato: ((bruto.saidas_por_contrato ?? []) as any[]).map((s) => ({
      contrato_id: s.contrato_id ?? null, contrato_nome: s.contrato_nome ?? "(sem contrato identificado)", empresa_id: s.empresa_id ?? null,
      valor: n(s.valor), unidades: n(s.unidades), unidades_sem_valor: n(s.unidades_sem_valor),
    })),
    itens: ((bruto.itens ?? []) as any[]).map((i) => ({
      item_estoque_id: i.item_estoque_id, item_nome: i.item_nome ?? null, item_codigo: i.item_codigo ?? null, tipo_item: i.tipo_item ?? null, tamanho: i.tamanho ?? null,
      inicial_qtd: n(i.inicial_qtd), inicial_valor: n(i.inicial_valor), entrada_qtd: n(i.entrada_qtd), entrada_valor: n(i.entrada_valor),
      saida_qtd: n(i.saida_qtd), saida_valor: n(i.saida_valor), final_qtd: n(i.final_qtd), final_valor: n(i.final_valor), valor_unitario: n(i.valor_unitario),
    })),
  };
}

export interface Conciliacao {
  estoqueInicial: number;
  compras: number;
  entradas: number;
  saidas: number;
  estoqueContabilFinal: number;
  estoqueFisicoFinal: number;
  /** Físico final − (inicial + entradas − saídas): o que mudou no almoxarifado sem entrada nem saída registrada. */
  acertosFisicos: number;
  /** Compras de estoque − entradas valoradas: comprado e não localizado no almoxarifado (ou entrado sem custo, ou comprado direto no contrato). */
  compraSemEntrada: number;
  /** Estoque Adm (contábil) final − físico final. Zero = conciliado. */
  diferenca: number;
  ok: boolean;
}

// A conta só existe com o lado físico (foto inicial e final). Sem ele, null: a tela mostra só os fluxos do período.
export function montarConciliacao(compras: number, fisico: FisicoConciliacao | null): Conciliacao | null {
  if (!fisico) return null;
  const estoqueContabilFinal = r2(fisico.inicial + compras - fisico.saidas);
  const diferenca = r2(estoqueContabilFinal - fisico.final);
  return {
    estoqueInicial: r2(fisico.inicial),
    compras: r2(compras),
    entradas: r2(fisico.entradas),
    saidas: r2(fisico.saidas),
    estoqueContabilFinal,
    estoqueFisicoFinal: r2(fisico.final),
    acertosFisicos: r2(fisico.final - (fisico.inicial + fisico.entradas - fisico.saidas)),
    compraSemEntrada: r2(compras - fisico.entradas),
    diferenca,
    ok: Math.abs(diferenca) < 0.01,
  };
}

export interface SaidasSeparadas {
  contratos: SaidaContrato[];
  administrativo: SaidaContrato[];
  semContrato: SaidaContrato[];
  totalContratos: number;
  totalAdministrativo: number;
  totalSemContrato: number;
  total: number;
}

// Saídas do período em três grupos: contrato de cliente (vai para a Lucratividade), administrativo (escritório) e sem contrato identificado.
export function separarSaidas(saidas: SaidaContrato[], nomeDoContrato: (id: string) => string | undefined = () => undefined): SaidasSeparadas {
  const out: SaidasSeparadas = { contratos: [], administrativo: [], semContrato: [], totalContratos: 0, totalAdministrativo: 0, totalSemContrato: 0, total: 0 };
  for (const s of saidas) {
    if (!s.contrato_id) { out.semContrato.push(s); out.totalSemContrato += s.valor; }
    else if (ehContratoAdministrativo(nomeDoContrato(s.contrato_id) ?? s.contrato_nome)) { out.administrativo.push(s); out.totalAdministrativo += s.valor; }
    else { out.contratos.push(s); out.totalContratos += s.valor; }
    out.total += s.valor;
  }
  out.totalContratos = r2(out.totalContratos);
  out.totalAdministrativo = r2(out.totalAdministrativo);
  out.totalSemContrato = r2(out.totalSemContrato);
  out.total = r2(out.total);
  return out;
}

export interface LinhaContrato {
  contratoId: string;
  contrato: string;
  saida: number;
  apropriado: number;
  diferenca: number;
  participacao: number;
  /** Compra de material lançada direto neste contrato no mesmo período (Fluxo). */
  compraDireta: number;
}

// Detalhamento por contrato: a saída do estoque (Saídas por Contrato) ao lado do que a Lucratividade mostra (coluna Consumo de Estoque).
export function linhasPorContrato(contratos: SaidaContrato[], apropriado: Map<string, number>, compraDireta: Map<string, number>): LinhaContrato[] {
  const total = contratos.reduce((s, c) => s + c.valor, 0);
  return contratos
    .filter((c): c is SaidaContrato & { contrato_id: string } => !!c.contrato_id)
    .map((c) => {
      const ap = apropriado.get(c.contrato_id) ?? 0;
      return {
        contratoId: c.contrato_id,
        contrato: c.contrato_nome,
        saida: r2(c.valor),
        apropriado: r2(ap),
        diferenca: r2(c.valor - ap),
        participacao: total > 0 ? c.valor / total : 0,
        compraDireta: r2(compraDireta.get(c.contrato_id) ?? 0),
      };
    })
    .sort((a, b) => b.saida - a.saida);
}

export type NivelPendencia = "ok" | "atencao" | "info";

export interface Pendencia {
  chave: string;
  titulo: string;
  valor: number;
  detalhe: string;
  nivel: NivelPendencia;
}

export interface EntradasPendencias {
  conciliacao: Conciliacao | null;
  saidas: SaidasSeparadas;
  linhas: LinhaContrato[];
  estoqueSemCusto: { itens: number; unidades: number };
  entradasSemCusto: number;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// As seis situações que o chamado pede para identificar, cada uma com o valor e de onde vem. "ok" = nada a apontar.
export function montarPendencias(e: EntradasPendencias): Pendencia[] {
  const c = e.conciliacao;
  const naoApropriado = r2(e.linhas.reduce((s, l) => s + Math.max(0, l.diferenca), 0));
  const duplicidade = e.linhas.filter((l) => l.compraDireta > 0 && l.saida > 0);
  const valorDuplicidade = r2(duplicidade.reduce((s, l) => s + Math.min(l.compraDireta, l.saida), 0));
  const p: Pendencia[] = [
    {
      chave: "comprado_sem_entrada",
      titulo: "Material comprado, mas não localizado no estoque",
      valor: c ? c.compraSemEntrada : 0,
      detalhe: c
        ? "Compras nos contratos de estoque menos as entradas valoradas no almoxarifado no mesmo intervalo. Não há chave entre o lançamento do Fluxo e o lote, então a comparação é pelo total."
        : "Sem foto do estoque para o período: não dá para comparar com as entradas.",
      nivel: c && Math.abs(c.compraSemEntrada) >= 0.01 ? "atencao" : "ok",
    },
    {
      chave: "baixa_sem_contrato",
      titulo: "Material baixado sem contrato identificado",
      valor: e.saidas.totalSemContrato,
      detalhe: `${e.saidas.semContrato.reduce((s, x) => s + x.unidades, 0).toLocaleString("pt-BR")} unidade(s) saíram do estoque sem pedido nem contrato recuperado.`,
      nivel: e.saidas.semContrato.length > 0 ? "atencao" : "ok",
    },
    {
      chave: "saida_nao_apropriada",
      titulo: "Saída registrada no estoque, mas não apropriada na Lucratividade",
      valor: naoApropriado,
      detalhe: "Saída para contrato de cliente que a coluna Consumo de Estoque da Lucratividade não mostra. Saídas para o administrativo não aparecem na Lucratividade por definição e ficam fora desta conta.",
      nivel: naoApropriado >= 0.01 ? "atencao" : "ok",
    },
    {
      chave: "financeiro_x_fisico",
      titulo: "Diferença entre estoque financeiro e estoque físico",
      valor: c ? c.diferenca : 0,
      detalhe: c
        ? `Estoque Adm (contábil) ${brl(c.estoqueContabilFinal)} contra físico ${brl(c.estoqueFisicoFinal)}. Acertos no almoxarifado sem entrada nem saída registrada (remoção, correção, inventário, troca de preço): ${brl(c.acertosFisicos)}.`
        : "Sem foto do estoque para o período.",
      nivel: c && !c.ok ? "atencao" : "ok",
    },
    {
      chave: "duplicidade",
      titulo: "Possível custo em duplicidade",
      valor: valorDuplicidade,
      detalhe: duplicidade.length
        ? `${duplicidade.length} contrato(s) tiveram compra de material lançada direto neles no Fluxo E receberam saída do estoque no mesmo período. Se a saída também virar custo, o mesmo material conta duas vezes.`
        : "Nenhum contrato com compra de material direta e saída do estoque no mesmo período.",
      nivel: duplicidade.length ? "atencao" : "ok",
    },
    {
      chave: "estoque_como_despesa",
      titulo: "Material ainda em estoque sendo considerado despesa",
      valor: c ? c.estoqueContabilFinal : 0,
      detalhe: "Hoje o Fechamento da Empresa soma a compra dos contratos de estoque em Outras Despesas (eles começam com ADMINISTRATIVO). O que ainda está no almoxarifado entra lá como despesa consumida até a troca de posição ser ligada.",
      nivel: "info",
    },
  ];
  if (e.estoqueSemCusto.unidades > 0 || e.entradasSemCusto > 0) {
    p.push({
      chave: "sem_custo",
      titulo: "Itens sem custo no cadastro",
      valor: 0,
      detalhe: `${e.estoqueSemCusto.itens} item(ns) com ${e.estoqueSemCusto.unidades.toLocaleString("pt-BR")} unidade(s) em estoque valem zero; ${e.entradasSemCusto.toLocaleString("pt-BR")} unidade(s) entraram sem custo no intervalo. Enquanto o valor não for preenchido em Suprimentos, a diferença não zera.`,
      nivel: "atencao",
    });
  }
  return p;
}

/** Soma por contrato as compras de material lançadas direto (Fluxo), fora os contratos de estoque. */
export function compraDiretaPorContrato(linhas: { contrato_id: string | null; classificacao_nome: string | null; valor: number }[], idsEstoque: Set<string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of linhas) {
    if (!l.contrato_id || idsEstoque.has(l.contrato_id) || !ehClassificacaoMaterial(l.classificacao_nome)) continue;
    m.set(l.contrato_id, (m.get(l.contrato_id) ?? 0) + (Number(l.valor) || 0));
  }
  return m;
}
