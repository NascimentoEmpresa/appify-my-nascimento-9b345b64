// SIS-2026-0929 — Atendimento dos supervisores por WhatsApp com I.A.
//
// Regras de tela (status, fila, tempo de espera, indicadores). Espelho das
// RPCs wa_atd_fila / wa_atd_indicadores e dos triggers de status da migration
// 20261118130000 — testadas em src/test/whatsapp-atendimento-fila.test.ts.
// A autorização por número mora em supabase/functions/_shared/whatsapp-atendimento.ts.

export type StatusAtendimento = "ia" | "aguardando_humano" | "em_atendimento_humano" | "concluido";

export const STATUS_ROTULO: Record<StatusAtendimento, string> = {
  ia: "Em atendimento pela I.A",
  aguardando_humano: "Aguardando atendimento humano",
  em_atendimento_humano: "Em atendimento humano",
  concluido: "Concluído",
};

export const STATUS_COR: Record<StatusAtendimento, string> = {
  ia: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  aguardando_humano: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  em_atendimento_humano: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  concluido: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
};

export const PAPEL_ROTULO: Record<string, string> = {
  colaborador: "Colaborador",
  encarregado: "Encarregado",
  supervisor: "Supervisor",
  desconhecido: "Número não cadastrado",
  divergente: "Divergência cadastral",
};

export const MOTIVO_CONSULTA_ROTULO: Record<string, string> = {
  proprio: "Próprio colaborador",
  subordinado: "Encarregado → subordinado",
  supervisionado: "Supervisor → contrato dele",
  numero_nao_cadastrado: "Número não cadastrado",
  cadastro_divergente: "Número em mais de um cadastro",
  categoria_desconhecida: "Categoria desconhecida",
  categoria_sensivel: "Categoria sensível (nunca automática)",
  alvo_nao_encontrado: "Fora do vínculo / não encontrado",
  alvo_ambiguo: "Mais de uma pessoa casou",
  funcao_nao_permite: "Função não permite essa categoria",
  erro: "Erro na consulta",
};

export const MOTIVO_ENCAMINHAMENTO_ROTULO: Record<string, string> = {
  pediu_humano: "Pediu atendimento humano",
  ia_encaminhou: "A I.A encaminhou",
  consulta_negada: "Informação não autorizada automaticamente",
  midia_recebida: "Enviou arquivo/áudio/imagem",
  falha_ia: "Falha da I.A",
  saida_bloqueada: "Resposta bloqueada (dado sensível)",
};

export function rotuloMotivoEncaminhamento(m: string | null | undefined): string {
  if (!m) return "—";
  const [base, detalhe] = m.split(":");
  const r = MOTIVO_ENCAMINHAMENTO_ROTULO[base] ?? base;
  return detalhe ? `${r} (${MOTIVO_CONSULTA_ROTULO[detalhe] ?? detalhe})` : r;
}

// ---------------------------------------------------------------------------
// Máquina de status (espelho dos triggers/RPCs)
// ---------------------------------------------------------------------------
export type EventoAtendimento =
  | "ia_encaminhou"      // regra/I.A passou para humano
  | "humano_respondeu"   // mensagem de atendente
  | "humano_assumiu"     // botão Assumir / desligar o bot na Caixa de Entrada
  | "devolvido_ia"       // religar o bot
  | "encaminhado"        // equipe encaminhou a outra pessoa/setor
  | "concluido";         // botão Concluir / pasta Concluído / [[RESOLVIDO]] / inatividade

export function proximoStatus(atual: StatusAtendimento, evento: EventoAtendimento): StatusAtendimento {
  if (atual === "concluido") return "concluido"; // protocolo fechado não reabre: nova mensagem = novo protocolo
  switch (evento) {
    case "ia_encaminhou": return atual === "ia" ? "aguardando_humano" : atual;
    case "humano_respondeu":
    case "humano_assumiu": return atual === "ia" || atual === "aguardando_humano" ? "em_atendimento_humano" : atual;
    case "devolvido_ia": return "ia";
    case "encaminhado": return "aguardando_humano";
    case "concluido": return "concluido";
  }
}

// ---------------------------------------------------------------------------
// Protocolo
// ---------------------------------------------------------------------------
export function formatarProtocolo(ano: number, sequencia: number): string {
  return `ATD-${ano}-${String(sequencia).padStart(6, "0")}`;
}
export const RE_PROTOCOLO = /^ATD-\d{4}-\d{6,}$/;

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------
export interface ItemFila {
  id: string;
  protocolo: string;
  status: StatusAtendimento;
  aberto_em: string;
  aguardando_desde: string | null;
  responsavel_id?: string | null;
  concluido_em?: string | null;
  [k: string]: unknown;
}

// Minutos esperando atendimento humano. Só conta enquanto aguarda/está com
// humano; em 'ia' a I.A responde na hora e concluído não espera mais.
export function tempoEsperaMin(item: Pick<ItemFila, "status" | "aguardando_desde" | "aberto_em">, agora = new Date()): number | null {
  if (item.status !== "aguardando_humano" && item.status !== "em_atendimento_humano") return null;
  const desde = item.aguardando_desde ?? item.aberto_em;
  if (!desde) return null;
  return Math.max(0, Math.floor((agora.getTime() - new Date(desde).getTime()) / 60000));
}

export function formatarEspera(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, "0")}`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// Faixa de urgência pela espera (para a cor na fila).
export function urgencia(min: number | null): "normal" | "atencao" | "critico" {
  if (min === null) return "normal";
  if (min >= 120) return "critico";
  if (min >= 30) return "atencao";
  return "normal";
}

const ORDEM_STATUS: Record<StatusAtendimento, number> = { aguardando_humano: 0, em_atendimento_humano: 1, ia: 2, concluido: 3 };

// Quem espera há mais tempo primeiro, aguardando antes de "em atendimento".
export function ordenarFila<T extends ItemFila>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const s = ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status];
    if (s) return s;
    const ra = new Date(a.aguardando_desde ?? a.aberto_em).getTime();
    const rb = new Date(b.aguardando_desde ?? b.aberto_em).getTime();
    return ra - rb;
  });
}

export function filtrarFila<T extends ItemFila>(itens: T[], f: { status?: StatusAtendimento | "abertos" | "todos"; meus?: string | null }): T[] {
  return itens.filter((i) => {
    if (f.status === "abertos" && i.status === "concluido") return false;
    if (f.status && f.status !== "abertos" && f.status !== "todos" && i.status !== f.status) return false;
    if (f.meus && i.responsavel_id !== f.meus) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Indicadores (espelho de wa_atd_indicadores)
// ---------------------------------------------------------------------------
export interface AtendimentoParaIndicador {
  status: StatusAtendimento;
  assunto: string | null;
  aberto_em: string;
  aguardando_desde: string | null;
  primeira_resposta_ia_em: string | null;
  primeira_resposta_humana_em: string | null;
  concluido_em: string | null;
  resolvido_pela_ia: boolean | null;
}

export interface Indicadores {
  total: number;
  concluidos: number;
  resolvidos_ia: number;
  pct_resolvido_ia: number | null;
  pendentes: number;
  tempo_resposta_ia_seg: number | null;
  espera_humano_min: number | null;
  duracao_media_min: number | null;
  assuntos: Array<{ assunto: string; total: number }>;
}

const umaCasa = (n: number) => Math.round(n * 10) / 10;
const media = (xs: number[]) => (xs.length ? umaCasa(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const ms = (a: string | null, b: string | null) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null);

export function calcularIndicadores(lista: AtendimentoParaIndicador[]): Indicadores {
  const concluidos = lista.filter((a) => a.status === "concluido");
  const resolvidos = concluidos.filter((a) => a.resolvido_pela_ia === true);
  const respIa = lista.map((a) => ms(a.aberto_em, a.primeira_resposta_ia_em)).filter((x): x is number => x !== null && x >= 0);
  const espera = lista.map((a) => ms(a.aguardando_desde, a.primeira_resposta_humana_em)).filter((x): x is number => x !== null && x >= 0);
  const dur = lista.map((a) => ms(a.aberto_em, a.concluido_em)).filter((x): x is number => x !== null && x >= 0);
  const porAssunto = new Map<string, number>();
  for (const a of lista) {
    const k = a.assunto || "(sem assunto)";
    porAssunto.set(k, (porAssunto.get(k) ?? 0) + 1);
  }
  return {
    total: lista.length,
    concluidos: concluidos.length,
    resolvidos_ia: resolvidos.length,
    pct_resolvido_ia: concluidos.length ? umaCasa((100 * resolvidos.length) / concluidos.length) : null,
    pendentes: lista.filter((a) => a.status === "aguardando_humano" || a.status === "em_atendimento_humano").length,
    tempo_resposta_ia_seg: media(respIa.map((x) => x / 1000)),
    espera_humano_min: media(espera.map((x) => x / 60000)),
    duracao_media_min: media(dur.map((x) => x / 60000)),
    assuntos: [...porAssunto.entries()]
      .map(([assunto, total]) => ({ assunto, total }))
      .sort((a, b) => b.total - a.total || a.assunto.localeCompare(b.assunto))
      .slice(0, 15),
  };
}
