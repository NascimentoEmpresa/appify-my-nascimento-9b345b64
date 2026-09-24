import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  type Coluna, type GrupoFicha, type Linha, type ModeloRelatorio,
  excelBlob, htmlBlob, montarExcel, montarHtml, slug, txt,
} from "@/lib/exportarRelatorio";
import {
  LABEL_TURNO_DASH, diasDaReserva, hojeBR, indicadores, kmRodados, situacaoDe,
  type AbastecimentoDash, type AgendamentoDash,
} from "@/lib/veiculos/dashboardVeiculos";

// =====================================================================
// Dashboard de Veículos — dados e relatório exportado (24/09/2026)
//
// Os dados vêm em páginas de 1000 (o PostgREST corta aí; o useAgendamentos
// da tela de agendar não pagina, e com o tempo passa disso). O relatório
// usa o motor comum de src/lib/exportarRelatorio.ts (o mesmo do Jurídico):
// Excel pra trabalhar, HTML pra ler/imprimir, "todos" ou "um".
// =====================================================================

const db = supabase as unknown as SupabaseClient;

async function todas<T>(tabela: string, select: string, filtro: (q: any) => any = (q) => q): Promise<T[]> {
  const acc: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(db.from(tabela).select(select)).order("id", { ascending: true }).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    acc.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return acc;
}

const CONTRATOS = "contrato_codigo, contrato_nome, administrativo";

/** Todos os agendamentos (com contratos e KM) e todas as notas de abastecimento. */
export function useDadosDashboardVeiculos(ativo: boolean) {
  return useQuery({
    queryKey: ["cs_veiculo_dashboard"],
    enabled: ativo,
    staleTime: 60_000,
    queryFn: async () => {
      const [agendamentos, abastecimentos] = await Promise.all([
        todas<AgendamentoDash>("cs_veiculo_agendamento", `*, contratos:cs_veiculo_agendamento_contrato(${CONTRATOS})`),
        todas<AbastecimentoDash>("cs_veiculo_abastecimento", `*, contratos:cs_veiculo_abastecimento_contrato(${CONTRATOS})`),
      ]);
      return { agendamentos, abastecimentos };
    },
  });
}

/** Histórico (log) das viagens que vão no relatório. */
export async function carregarHistorico(ids: string[] | null): Promise<Map<string, Linha[]>> {
  const ls = await todas<Linha>("cs_veiculo_agendamento_log", "*", (q) => (ids ? q.in("agendamento_id", ids) : q));
  const m = new Map<string, Linha[]>();
  ls.forEach((l) => { const k = txt(l.agendamento_id); (m.get(k) ?? m.set(k, []).get(k)!).push(l); });
  return m;
}

const nomesContratos = (a: AgendamentoDash) => a.contratos.map((c) => c.contrato_nome).join(", ");

const FICHA: GrupoFicha<AgendamentoDash>[] = [
  { grupo: "Reserva", campos: [
    { rotulo: "Nº", tipo: "inteiro", valor: (a) => a.numero },
    { rotulo: "Veículo", valor: (a) => a.veiculo_nome },
    { rotulo: "Placa / identificador", valor: (a) => a.veiculo_identificador },
    { rotulo: "Início", tipo: "data", valor: (a) => a.data_inicio },
    { rotulo: "Fim", tipo: "data", valor: (a) => a.data_fim },
    { rotulo: "Dias", tipo: "inteiro", valor: (a) => diasDaReserva(a) },
    { rotulo: "Turno", valor: (a) => LABEL_TURNO_DASH[a.turno] ?? a.turno },
    { rotulo: "Situação", valor: (a) => situacaoDe(a), selo: true },
    { rotulo: "Motivo do cancelamento", valor: (a) => a.motivo_cancelamento },
  ] },
  { grupo: "Solicitação", campos: [
    { rotulo: "Solicitante", valor: (a) => a.solicitante_nome },
    { rotulo: "Contratos atendidos", valor: nomesContratos },
    { rotulo: "Destino", valor: (a) => a.destino },
    { rotulo: "Motivo", valor: (a) => a.motivo },
    { rotulo: "Observações", valor: (a) => a.observacoes },
    { rotulo: "Agendado em", tipo: "datahora", valor: (a) => a.created_at },
  ] },
  { grupo: "Quilometragem", campos: [
    { rotulo: "KM inicial", tipo: "inteiro", valor: (a) => a.km_inicial },
    { rotulo: "KM inicial registrado em", tipo: "datahora", valor: (a) => a.km_inicial_em },
    { rotulo: "KM final", tipo: "inteiro", valor: (a) => a.km_final },
    { rotulo: "KM final registrado em", tipo: "datahora", valor: (a) => a.km_final_em },
    { rotulo: "KM rodados", tipo: "inteiro", valor: (a) => kmRodados(a) },
  ] },
];

const COLUNAS_CONTRATOS: Coluna[] = [
  { rotulo: "Contrato", valor: (c) => c.contrato_nome },
  { rotulo: "Código", tipo: "inteiro", valor: (c) => c.contrato_codigo },
  { rotulo: "Administrativo", valor: (c) => (c.administrativo ? "Sim" : "Não") },
];
const COLUNAS_ABAST: Coluna[] = [
  { rotulo: "Data", tipo: "data", valor: (b) => b.data },
  { rotulo: "Valor", tipo: "moeda", valor: (b) => b.valor },
  { rotulo: "Litros", valor: (b) => b.litros },
  { rotulo: "KM no abastecimento", tipo: "inteiro", valor: (b) => b.km },
  { rotulo: "Contratos da nota", valor: (b) => ((b.contratos as { contrato_nome: string }[]) ?? []).map((c) => c.contrato_nome).join(", ") },
  { rotulo: "Descrição", valor: (b) => b.descricao },
  { rotulo: "Arquivo da nota", valor: (b) => b.nome_arquivo },
  { rotulo: "Anexada por", valor: (b) => b.criado_por_nome },
];
const COLUNAS_HIST: Coluna[] = [
  { rotulo: "Quando", tipo: "datahora", valor: (h) => h.created_at },
  { rotulo: "O que aconteceu", valor: (h) => h.acao },
  { rotulo: "Detalhe", valor: (h) => h.detalhe },
  { rotulo: "Quem", valor: (h) => h.usuario_nome },
];

function modelo(lista: AgendamentoDash[], abast: AbastecimentoDash[], hist: Map<string, Linha[]>, autor: string, recorte: string): ModeloRelatorio<AgendamentoDash> {
  const hoje = hojeBR();
  const ind = indicadores(lista, abast, hoje);
  const notasDe = new Map<string, AbastecimentoDash[]>();
  abast.forEach((b) => (notasDe.get(b.agendamento_id) ?? notasDe.set(b.agendamento_id, []).get(b.agendamento_id)!).push(b));
  return {
    modulo: "Central de Serviços · Agendamento de Veículos",
    itens: lista,
    nome: { um: "agendamento", varios: "agendamentos" },
    tituloTodos: `Agendamentos de veículos — ${recorte}`,
    tituloUm: (a) => `Agendamento nº ${a.numero} — ${a.veiculo_nome}`,
    ancora: (a) => `ag-${a.numero}`,
    cabecalho: (a) => ({
      eyebrow: `Nº ${a.numero} · ${LABEL_TURNO_DASH[a.turno] ?? a.turno}`,
      titulo: `${a.veiculo_nome}${a.veiculo_identificador ? ` (${a.veiculo_identificador})` : ""}`,
      sub: [a.solicitante_nome, nomesContratos(a)].filter(Boolean).join(" · "),
      selos: [situacaoDe(a, hoje)],
    }),
    destaques: (a) => [
      ["Período", a.data_inicio === a.data_fim ? a.data_inicio.split("-").reverse().join("/") : `${a.data_inicio.split("-").reverse().join("/")} a ${a.data_fim.split("-").reverse().join("/")}`],
      ["Dias", String(diasDaReserva(a))],
      ["KM rodados", kmRodados(a) != null ? String(kmRodados(a)) : ""],
    ],
    ficha: FICHA,
    blocos: [
      { titulo: "Contratos atendidos", aba: "Contratos", colunas: COLUNAS_CONTRATOS, linhas: (a) => a.contratos as unknown as Linha[] },
      { titulo: "Notas de abastecimento", aba: "Abastecimentos", colunas: COLUNAS_ABAST, linhas: (a) => (notasDe.get(a.id) ?? []) as unknown as Linha[] },
      { titulo: "Histórico", aba: "Histórico", colunas: COLUNAS_HIST,
        linhas: (a) => [...(hist.get(a.id) ?? [])].sort((x, y) => txt(x.created_at).localeCompare(txt(y.created_at))) },
    ],
    resumo: [
      { rotulo: "Agendamentos", valor: ind.total, tipo: "inteiro" },
      { rotulo: "Realizados", valor: ind.porSituacao.Realizado, tipo: "inteiro" },
      { rotulo: "Em andamento", valor: ind.porSituacao["Em andamento"], tipo: "inteiro" },
      { rotulo: "Agendados (futuros)", valor: ind.porSituacao.Agendado, tipo: "inteiro" },
      { rotulo: "Cancelados", valor: ind.porSituacao.Cancelado, tipo: "inteiro" },
      { rotulo: "Dias de uso reservados", valor: ind.diasReservados, tipo: "inteiro" },
      { rotulo: "Veículos usados", valor: ind.veiculosUsados, tipo: "inteiro" },
      { rotulo: "Contratos atendidos", valor: ind.contratosAtendidos, tipo: "inteiro" },
      { rotulo: "KM rodados", valor: ind.kmRodados, tipo: "inteiro" },
      { rotulo: "Gasto com abastecimento", valor: ind.valorAbastecido, tipo: "moeda" },
    ],
    indice: [
      { rotulo: "Nº", valor: (a) => a.numero },
      { rotulo: "Veículo", valor: (a) => a.veiculo_nome },
      { rotulo: "Início", tipo: "data", valor: (a) => a.data_inicio },
      { rotulo: "Fim", tipo: "data", valor: (a) => a.data_fim },
      { rotulo: "Solicitante", valor: (a) => a.solicitante_nome },
      { rotulo: "Situação", valor: (a) => situacaoDe(a, hoje), selo: true },
    ],
    identificacao: [
      { rotulo: "Nº", tipo: "inteiro", valor: (a) => a.numero },
      { rotulo: "Veículo", valor: (a) => a.veiculo_nome },
      { rotulo: "Início", tipo: "data", valor: (a) => a.data_inicio },
    ],
    notas: [
      ["Recorte", recorte],
      ["Situação", "Calculada pela data: Agendado (começa depois de hoje), Em andamento, Realizado (já terminou) ou Cancelado."],
      ["Dias", "Dias corridos da reserva, contando início e fim. Canceladas não entram nos dias, veículos nem contratos."],
    ],
    autor,
  };
}

export function gerarExcel(lista: AgendamentoDash[], abast: AbastecimentoDash[], hist: Map<string, Linha[]>, autor: string, recorte: string) {
  return excelBlob(montarExcel(modelo(lista, abast, hist, autor, recorte)));
}
export function gerarHtml(lista: AgendamentoDash[], abast: AbastecimentoDash[], hist: Map<string, Linha[]>, autor: string, recorte: string) {
  return htmlBlob(montarHtml(modelo(lista, abast, hist, autor, recorte)));
}
export const nomeArquivo = (lista: AgendamentoDash[], recorte: string) =>
  lista.length === 1 ? `agendamento-${lista[0].numero}-${slug(lista[0].veiculo_nome, 20)}` : `agendamentos-veiculos-${slug(recorte, 30)}`;
