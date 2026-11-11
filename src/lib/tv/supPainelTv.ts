// =====================================================================
// TV › COMPRAS — Suprimentos (11/11/2026, mig 20261111180000)
//
// Os 6 indicadores da tabela do Pablo, com o detalhe que cada um pede. A
// conta mora no banco (tv_supply_dados — a mesma dos cards da TV gerencial
// Supply); aqui o status de cada card e as páginas que se revezam.
// Regra das TVs (Pablo): "ruim" só quando é verdadeiro. Fonte pequena ou sem
// registro fica neutra, nunca vermelha.
// =====================================================================

export interface ItemMinimo { nome: string; tamanho: string | null; disp: number; minimo: number; falta: number; pct: number }
export interface ItemValor { nome: string; tamanho: string | null; qtd: number; valor: number }
export interface PedidoContrato { contrato: string; qtd: number; dias: number }

export interface DadosSupPainelTv {
  estoque: {
    itens: number;
    com_minimo: number;
    abaixo_minimo: { qtd: number; zerados: number; reposicao: number; itens: ItemMinimo[] };
    valor: { total: number; itens_com_saldo: number; por_tipo: { tipo: string; valor: number }[]; maiores: ItemValor[] };
    sem_mov: { dias: number; qtd: number; valor: number; itens: ItemValor[] };
  };
  pedidos: {
    compras_vencidas: { dias: number; qtd: number; contratos: number; mais_antigo: number | null; por_contrato: PedidoContrato[] };
    sem_entrega: { dias: number; contratos: number; pedidos: number; por_status: { status: string; qtd: number }[]; por_contrato: PedidoContrato[] };
  };
  fornecedor: { registrados: number; enviados: number; em_atraso: number; por_fornecedor: { fornecedor: string; qtd: number; valor: number; dias: number }[] };
  gerado_em?: string;
}

export type TomCard = "bom" | "atencao" | "critico" | "neutro";

export interface CardSup { chave: string; titulo: string; valor: string; sub: string; tom: TomCard; pergunta: string }

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const n = (v: number) => v.toLocaleString("pt-BR");

/** Segundos de cada página (a TV gira sozinha dentro do item). */
export const SEGUNDOS_POR_PAGINA_SUP = 15;

export function cardsSup(d: DadosSupPainelTv): CardSup[] {
  const cv = d.pedidos.compras_vencidas;
  const am = d.estoque.abaixo_minimo;
  const sm = d.estoque.sem_mov;
  const se = d.pedidos.sem_entrega;
  const f = d.fornecedor;
  return [
    {
      chave: "compras", titulo: "Compras vencidas e não entregues", pergunta: "Atrasos que podem comprometer a operação.",
      valor: n(cv.qtd), tom: cv.qtd === 0 ? "bom" : cv.qtd > 10 ? "critico" : "atencao",
      sub: cv.qtd ? `aguardando compra há mais de ${cv.dias} dias · ${cv.contratos} contrato(s) · mais antigo ${cv.mais_antigo} dias` : `nenhum pedido aguardando compra há mais de ${cv.dias} dias`,
    },
    {
      chave: "minimo", titulo: "Itens abaixo do estoque mínimo", pergunta: "Materiais que podem faltar nos próximos dias.",
      valor: n(am.qtd), tom: d.estoque.com_minimo === 0 ? "neutro" : am.qtd === 0 ? "bom" : am.zerados > 0 ? "critico" : "atencao",
      sub: d.estoque.com_minimo === 0 ? "nenhum item com estoque mínimo cadastrado"
        : am.qtd ? `${am.zerados} zerado(s) · ${brl(am.reposicao)} para repor o mínimo · de ${n(d.estoque.com_minimo)} itens com mínimo` : `todos os ${n(d.estoque.com_minimo)} itens com mínimo estão acima dele`,
    },
    {
      chave: "valor", titulo: "Valor total do estoque", pergunta: "Capital imobilizado em materiais.",
      valor: brl(d.estoque.valor.total), tom: "neutro",
      sub: `${n(d.estoque.valor.itens_com_saldo)} itens com saldo`,
    },
    {
      chave: "parados", titulo: "Itens sem movimentação", pergunta: "Materiais comprados e não utilizados.",
      valor: n(sm.qtd), tom: sm.qtd === 0 ? "bom" : "atencao",
      sub: sm.qtd ? `${brl(sm.valor)} parados há mais de ${sm.dias} dias` : `todo item com saldo se movimentou nos últimos ${sm.dias} dias`,
    },
    {
      chave: "fornecedor", titulo: "Pedidos em atraso por fornecedor", pergunta: "Fornecedores que causam risco operacional.",
      valor: f.enviados ? n(f.em_atraso) : "—",
      tom: !f.enviados ? "neutro" : f.em_atraso === 0 ? "bom" : "critico",
      sub: !f.enviados ? `${f.registrados} pedido(s) de compra registrado(s), nenhum enviado ao fornecedor ainda`
        : f.em_atraso ? `${f.por_fornecedor.length} fornecedor(es) com entrega vencida` : `${f.enviados} pedido(s) de compra no prazo`,
    },
    {
      chave: "entrega", titulo: "Contratos sem entrega de material prevista", pergunta: "Operações que não receberam os materiais necessários.",
      valor: n(se.contratos), tom: se.contratos === 0 ? "bom" : se.contratos > 10 ? "critico" : "atencao",
      sub: se.contratos ? `${se.pedidos} pedido(s) parado(s) há mais de ${se.dias} dias` : `nenhum pedido parado há mais de ${se.dias} dias`,
    },
  ];
}

export interface PaginaSup { chave: "geral" | "minimo" | "atrasos" | "estoque"; titulo: string }

/** Visão geral sempre; as de detalhe só quando têm o que mostrar. */
export function paginasSup(d: DadosSupPainelTv): PaginaSup[] {
  const ps: PaginaSup[] = [{ chave: "geral", titulo: "Visão geral" }];
  if (d.estoque.abaixo_minimo.itens.length) ps.push({ chave: "minimo", titulo: "Abaixo do estoque mínimo" });
  if (d.pedidos.compras_vencidas.por_contrato.length || d.pedidos.sem_entrega.por_contrato.length || d.fornecedor.por_fornecedor.length)
    ps.push({ chave: "atrasos", titulo: "Atrasos e entregas" });
  if (d.estoque.valor.maiores.length || d.estoque.sem_mov.itens.length) ps.push({ chave: "estoque", titulo: "Estoque e itens parados" });
  return ps;
}
