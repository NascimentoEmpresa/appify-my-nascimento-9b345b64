// =====================================================================
// VÍDEO ATÉ O FIM (02/10/2026, mig 20260930000290)
//
// Pedido do Pablo: "o usuário só consiga concluir quando terminar o vídeo —
// se não terminar, não pode pegar o certificado". Antes o player avisava
// "assistido" a 90% e dava para arrastar a barra até o fim.
//
// Este acompanhamento recebe o tempo do player (o <video> pelo timeupdate,
// YouTube pelo infoDelivery, Vimeo pelo timeupdate) e:
//   • soma só o tempo REALMENTE tocado — saltos para frente não contam;
//   • devolve `voltarPara` quando a pessoa arrasta para além do ponto mais
//     distante já assistido (o player volta para lá: não dá para adiantar);
//   • considera terminado quando chegou ao fim E assistiu quase tudo.
// Voltar para rever é livre. Funções puras, testadas em
// src/test/video-ate-o-fim.test.ts.
// =====================================================================

/** Maior avanço entre duas leituras que ainda conta como "tocando" (s). O YouTube manda ~4 por segundo; 2x de velocidade dá ~0,5 s. */
export const PASSO_MAXIMO = 3;
/** Quanto além do ponto mais distante a pessoa pode clicar sem voltar (s). */
export const TOLERANCIA_PULO = 2;
/** Fração do vídeo que precisa ter sido tocada. */
export const FRACAO_MINIMA = 0.95;
/** A que distância do fim já conta como "chegou ao fim" (s). */
export const MARGEM_FIM = 1.5;

export interface EstadoVideo {
  /** Segundos efetivamente tocados (sem contar saltos). */
  assistido: number;
  /** O ponto mais distante alcançado tocando (s). */
  maximo: number;
  /** Última posição recebida (s). */
  ultimo: number;
  duracao: number;
  terminou: boolean;
}

export const estadoInicial = (): EstadoVideo => ({ assistido: 0, maximo: 0, ultimo: 0, duracao: 0, terminou: false });

const chegouAoFim = (e: EstadoVideo) =>
  e.duracao > 0 && e.maximo >= e.duracao - MARGEM_FIM && e.assistido >= e.duracao * FRACAO_MINIMA;

/**
 * Registra uma leitura do player. Devolve o novo estado e, se a pessoa
 * tentou adiantar, a posição para onde o player deve voltar.
 */
export function registrarPosicao(e: EstadoVideo, posicao: number, duracao: number): { estado: EstadoVideo; voltarPara: number | null } {
  if (!Number.isFinite(posicao) || posicao < 0) return { estado: e, voltarPara: null };
  const dur = Number.isFinite(duracao) && duracao > 0 ? duracao : e.duracao;
  const delta = posicao - e.ultimo;

  // Pulou para frente além do que já tinha visto: não conta e volta.
  if (posicao > e.maximo + TOLERANCIA_PULO && delta > PASSO_MAXIMO) {
    return { estado: { ...e, duracao: dur }, voltarPara: e.maximo };
  }

  let { assistido, maximo } = e;
  if (delta > 0 && delta <= PASSO_MAXIMO) {
    // Tocando: soma só o trecho NOVO (além do ponto mais distante) — rever
    // um pedaço já visto não conta de novo.
    assistido += Math.max(0, posicao - Math.max(e.ultimo, maximo));
    maximo = Math.max(maximo, posicao);
  }
  const estado: EstadoVideo = { assistido, maximo, ultimo: posicao, duracao: dur, terminou: e.terminou };
  estado.terminou = e.terminou || chegouAoFim(estado);
  return { estado, voltarPara: null };
}

/** O evento "terminou" do player: só vale se a pessoa de fato assistiu. */
export function registrarFim(e: EstadoVideo): EstadoVideo {
  const estado = { ...e, maximo: e.duracao > 0 ? Math.max(e.maximo, Math.min(e.duracao, e.ultimo)) : e.maximo };
  return { ...estado, terminou: e.terminou || chegouAoFim(estado) };
}

/** 0–100, para a barrinha "assistido". */
export const percentualAssistido = (e: EstadoVideo): number =>
  e.terminou ? 100 : e.duracao > 0 ? Math.min(99, Math.floor((e.assistido / e.duracao) * 100)) : 0;

/** "3:07" */
export const relogio = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), seg = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(seg).padStart(2, "0")}` : `${m}:${String(seg).padStart(2, "0")}`;
};
