// =====================================================================
// Relatórios › Vagas › ACOMPANHAMENTO (mig 20261020000050, 19/10/2026)
// Com teste em src/test/recrutamento-acompanhamento-vagas.test.ts.
//
// Pedido (chamado): vagas por contrato, tempo total em aberto CONTADO DA
// SOLICITAÇÃO, etapa atual e desde quando, tempo em cada etapa, quem é a
// recrutadora e quem está com a etapa atual, desistências (quantas, em que
// etapa, por quê) — com filtros por contrato, cidade, responsável,
// etapa/status e período.
//
// "O encaminhamento para a Giovana não deve encerrar essa contagem": a vaga
// fecha como "Contratado" quando o recrutamento envia o candidato à
// Admissão, mas aqui ela segue ABERTA ("Aguardando admissão") enquanto
// houver candidato encaminhado e ainda não admitido.
// =====================================================================

import {
  diasEntreMs, diasPorEtapa, diasTotais, etapaDoStatus, tituloEtapa, trechosDaVaga, vagaFechada, type VagaPainel,
} from "@/lib/relatorios/vagasPainel";

export interface DesistenciaVaga { candidato_id: number; nome: string | null; etapa: string; motivo: string; em: string | null }

/** Uma linha de rec_acompanhamento_vagas. */
export interface ExtraVaga {
  id: number;
  recrutadora: string | null;
  responsavel: string | null;
  responsavel_origem: string | null;
  admissao: { responsavel: string | null; enviado_em: string | null; aguardando: number; recrutadora: string | null } | null;
  desistencias: DesistenciaVaga[];
  reprovados: number;
}

export const ETAPA_ADMISSAO = { chave: "admissao", titulo: "Aguardando admissão" } as const;

export interface LinhaAcompanhamento {
  v: VagaPainel;
  recrutadora: string | null;
  responsavelAtual: string | null;
  etapa: string;
  etapaTitulo: string;
  desde: string | null;
  /** Dias na etapa atual (só vaga em aberto). */
  diasEtapa: number | null;
  /** Da solicitação até agora (aberta) ou até a conclusão. */
  diasAberto: number;
  aberta: boolean;
  aguardandoAdmissao: boolean;
  porEtapa: Record<string, number>;
  desistencias: DesistenciaVaga[];
  reprovados: number;
}

const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);

export function montarAcompanhamento(vagas: VagaPainel[], extras: Record<number, ExtraVaga>, agora: string): LinhaAcompanhamento[] {
  const tAgora = ms(agora);
  return vagas.map((v) => {
    const x = extras[v.id];
    const aguardando = (x?.admissao?.aguardando ?? 0) > 0;
    const aberta = !vagaFechada(v) || aguardando;
    const porEtapa = diasPorEtapa(trechosDaVaga(v, agora), true);
    let etapa = etapaDoStatus(v.status);
    let desde: string | null = v.status_em ?? v.criada;
    if (aguardando) {
      etapa = ETAPA_ADMISSAO.chave;
      desde = x!.admissao!.enviado_em ?? desde;
      porEtapa[ETAPA_ADMISSAO.chave] = diasEntreMs(ms(desde), tAgora);
    }
    return {
      v,
      recrutadora: x?.recrutadora ?? x?.admissao?.recrutadora ?? x?.responsavel ?? v.responsavel ?? null,
      responsavelAtual: aguardando ? x!.admissao!.responsavel : (x?.responsavel ?? v.responsavel ?? null),
      etapa,
      etapaTitulo: etapa === ETAPA_ADMISSAO.chave ? ETAPA_ADMISSAO.titulo : tituloEtapa(etapa),
      desde,
      diasEtapa: aberta ? diasEntreMs(ms(desde), tAgora) : null,
      diasAberto: aberta ? diasEntreMs(ms(v.criada), tAgora) : diasTotais(v, agora),
      aberta,
      aguardandoAdmissao: aguardando,
      porEtapa,
      desistencias: x?.desistencias ?? [],
      reprovados: x?.reprovados ?? 0,
    };
  });
}

export interface FiltroAcompanhamento {
  contrato: string; cidade: string; responsavel: string; etapa: string; situacao: "abertas" | "fechadas" | "todas";
}
export const FILTRO_ACOMP_PADRAO: FiltroAcompanhamento = { contrato: "", cidade: "", responsavel: "", etapa: "", situacao: "abertas" };

/** Responsável casa com a recrutadora OU com quem está com a etapa atual. */
export function filtrarAcompanhamento(linhas: LinhaAcompanhamento[], f: FiltroAcompanhamento): LinhaAcompanhamento[] {
  return linhas.filter((l) =>
    (!f.contrato || (l.v.contrato ?? "") === f.contrato)
    && (!f.cidade || (l.v.cidade ?? "") === f.cidade)
    && (!f.responsavel || l.recrutadora === f.responsavel || l.responsavelAtual === f.responsavel)
    && (!f.etapa || l.etapa === f.etapa)
    && (f.situacao === "todas" || (f.situacao === "abertas") === l.aberta));
}

export interface LinhaContrato { contrato: string; total: number; abertas: number; porEtapa: Record<string, number> }

export function vagasPorContrato(linhas: LinhaAcompanhamento[]): LinhaContrato[] {
  const m = new Map<string, LinhaContrato>();
  for (const l of linhas) {
    const c = l.v.contrato ?? "Sem contrato";
    const r = m.get(c) ?? { contrato: c, total: 0, abertas: 0, porEtapa: {} };
    r.total += 1;
    if (l.aberta) r.abertas += 1;
    r.porEtapa[l.etapa] = (r.porEtapa[l.etapa] ?? 0) + 1;
    m.set(c, r);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.contrato.localeCompare(b.contrato));
}

export interface ItemContagem { nome: string; n: number }

const contar = (xs: string[]): ItemContagem[] => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome));
};

/** Desistências (do candidato) e reprovações (da empresa), sempre separadas. */
export function resumoDesistencias(linhas: LinhaAcompanhamento[]) {
  const lista = linhas.flatMap((l) => l.desistencias.map((d) => ({ ...d, vaga: l.v })));
  return {
    total: lista.length,
    reprovados: linhas.reduce((s, l) => s + l.reprovados, 0),
    vagasComDesistencia: linhas.filter((l) => l.desistencias.length > 0).length,
    porEtapa: contar(lista.map((d) => d.etapa)),
    porMotivo: contar(lista.map((d) => d.motivo)),
    lista: lista.sort((a, b) => String(b.em ?? "").localeCompare(String(a.em ?? ""))),
  };
}
