// =====================================================================
// CHAMADOS VINCULADOS (Parte 1, Parte 2…) e MOTIVO DA REABERTURA
// 12/11/2026, mig 20261112002000. Pedido do Pablo:
//   - Reabrir pelo solicitante pede o motivo: "não atendeu o solicitado"
//     (volta para a triagem do Gestor de Sistemas) ou "precisa de
//     modificações" (não reabre: abre outro chamado baseado nesse, com o
//     quadro "O que é preciso a mais", vinculado como a parte seguinte).
//   - Ao abrir chamado novo dá para vincular a um existente.
// Lógica pura, testada em src/test/chamado-vinculos.test.ts.
// =====================================================================

export type MotivoReabertura = "nao_atendeu" | "modificacoes";

export const MOTIVOS_REABERTURA: { valor: MotivoReabertura; rotulo: string; ajuda: string }[] = [
  {
    valor: "nao_atendeu",
    rotulo: "Não atendeu o solicitado",
    ajuda: "A entrega não faz o que foi pedido. O Gestor de Sistemas verifica, confirma a reabertura e envia para um desenvolvedor de novo.",
  },
  {
    valor: "modificacoes",
    rotulo: "Precisa de modificações no que foi solicitado",
    ajuda: "O que foi pedido foi entregue, mas agora precisa de mais coisa ou de mudança.",
  },
];

export const PARAM_BASEADO = "baseado";
export const MIN_COMPLEMENTO = 10;

/** Rota do formulário de chamado novo a partir da tela atual (encarregados ou central de serviços). */
export function rotaNovoChamado(pathname: string, baseadoEm?: string | null): string {
  const base = pathname.startsWith("/app/encarregados") ? "/app/encarregados/chamados" : "/app/central-servicos/chamados";
  return baseadoEm ? `${base}/novo?${PARAM_BASEADO}=${encodeURIComponent(baseadoEm)}` : `${base}/novo`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function lerBaseado(search: string): string | null {
  const v = new URLSearchParams(search).get(PARAM_BASEADO);
  return v && UUID.test(v) ? v.toLowerCase() : null;
}

export const rotuloParte = (parte: number | null | undefined) => `Parte ${parte && parte > 0 ? parte : 1}`;

/** Campos do chamado anterior que o "baseado nesse" copia para o formulário. */
export interface ChamadoBase {
  id: string;
  numero: string;
  assunto: string;
  categorias: string[] | null;
  tipo_solicitacao: string | null;
  prioridade: string | null;
  descricao: string | null;
  observacoes_solicitante: string | null;
  impacto_trabalho: string | null;
  urgencia: string | null;
  prazo_solicitante?: string | null;
  modulo_sistema: string | null;
  modulo_sistema_outro: string | null;
  ambiente: string | null;
  afeta_usuarios: number | null;
}

export interface FormularioBaseado {
  assunto: string;
  categorias: string[];
  tipo: string;
  prioridade: string;
  descricao: string;
  observacoes: string;
  impacto: string;
  urgencia: string;
  /** Só a data do anterior se ainda não passou; senão o formulário sugere pela urgência. */
  prazoSolicitante: string;
  modulo: string;
  moduloOutro: string;
  ambiente: string;
  afetaUsuarios: string;
}

const TITULO_MAX = 120;

/** Título da parte nova: "Assunto (Parte N)", sem repetir o sufixo e dentro do limite. */
export function tituloDaParte(assunto: string, parte: number): string {
  const limpo = assunto.replace(/\s*\(Parte \d+\)\s*$/i, "").trim();
  const sufixo = ` (Parte ${parte})`;
  return limpo.slice(0, TITULO_MAX - sufixo.length).trimEnd() + sufixo;
}

export function formularioBaseadoEm(c: ChamadoBase, proximaParte: number, hoje: string): FormularioBaseado {
  const prazo = c.prazo_solicitante && c.prazo_solicitante >= hoje ? c.prazo_solicitante : "";
  return {
    assunto: tituloDaParte(c.assunto, proximaParte),
    categorias: c.categorias ?? [],
    tipo: c.tipo_solicitacao ?? "",
    prioridade: c.prioridade ?? "",
    descricao: c.descricao ?? "",
    observacoes: c.observacoes_solicitante ?? "",
    impacto: c.impacto_trabalho ?? "",
    urgencia: c.urgencia ?? "",
    prazoSolicitante: prazo,
    modulo: c.modulo_sistema ?? "",
    moduloOutro: c.modulo_sistema_outro ?? "",
    ambiente: c.ambiente ?? "producao",
    afetaUsuarios: c.afeta_usuarios != null ? String(c.afeta_usuarios) : "",
  };
}

/** Linha da RPC chamado_vinculos. */
export interface ParteSerie {
  id: string;
  numero: string;
  assunto: string;
  status: string;
  parte: number;
  vinculado_a: string | null;
  complemento: string | null;
  created_at: string;
}

/** Próximo número de parte (o banco recalcula; aqui é só para a tela mostrar). */
export function proximaParte(serie: Pick<ParteSerie, "parte">[]): number {
  return serie.reduce((m, p) => Math.max(m, p.parte || 1), 1) + 1;
}

/** Busca do seletor "Vincular a um chamado existente": número ou assunto, sem acento. */
export function filtrarChamadosParaVincular<T extends { numero: string; assunto: string }>(lista: T[], busca: string): T[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(busca.trim().replace(/^#/, ""));
  if (!q) return lista;
  return lista.filter((c) => norm(c.numero).includes(q) || norm(c.assunto).includes(q));
}
