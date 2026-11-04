import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/env";

// =====================================================================
// MONITOR DE QUEDA (23/09/2026)
//
// O banco do app (Supabase, plano Micro) passou a travar alguns minutos por
// vez quando lota — em 23/09 o health check deu "Failed to connect to
// database" e voltou sozinho em ~1 min. Nessa janela o ERP não quebrava:
// ele "funcionava vazio". O perfil e as permissões não carregavam, o usuário
// aparecia como "Usuário" genérico, o menu vinha em branco e ninguém sabia
// se era erro dele, falta de acesso ou queda. Pedido do Pablo: uma tela
// dizendo que o sistema está instável e que é para aguardar.
//
// Como detecta, sem falso alarme:
//   1. envolve o window.fetch e observa SÓ as chamadas ao Supabase (REST,
//      Auth, Storage). Falha de rede ou resposta 5xx vira SUSPEITA;
//   2. suspeita não derruba nada: dispara o teste de saúde — RPC
//      sistema_saude() (o PostgREST responde 503 quando não alcança o banco).
//      Só com DUAS falhas seguidas, 3 s de intervalo, o estado vira "fora".
//      Um 500 de uma RPC com bug não passa daqui, porque a saúde responde ok;
//   3. com o estado "fora", testa de novo (ver "03/11/2026" abaixo) e, quando
//      responde, RECARREGA a página: perfil, permissões e menu vêm do zero, em
//      vez de ficar com o estado vazio da janela de queda.
// Edge Functions ficam de fora: 5xx delas é erro da função, não queda.
//
// 03/11/2026 — O PRÓPRIO MONITOR SEGURAVA A QUEDA (post-mortem em
// docs/incidentes/2026-11-03-post-mortem.md, causa C3)
// Até aqui o reteste era a cada 15 s FIXOS e, no primeiro sucesso, a aba
// recarregava NA HORA. Todas as abas do ERP entram em queda no mesmo segundo
// (é o mesmo PostgREST caindo), então testavam em fase e, quando o servidor
// voltava, recarregavam JUNTAS — inclusive as abas em segundo plano que
// ninguém estava olhando. Cada recarga é o boot inteiro (perfil, sessão,
// permissões, menu, notificações). Medido no log do Kong: o boot foi de
// ~15/min para 1.674/min às 14:22 UTC e 1.990/min às 19:03 UTC, e esse pico
// derrubava o servidor que tinha acabado de voltar. Três quedas de 10 a 25
// minutos naquele dia foram esse ciclo.
// Agora:
//   - o reteste espera mais a cada falha (15 → 30 → 60 → 120 s, teto) e cada
//     espera é sorteada entre 50 % e 150 % — as abas saem de fase;
//   - quando o servidor volta, a aba visível recarrega depois de um sorteio
//     de até ATRASO_MAX_RECARGA_MS, não no mesmo segundo que todas as outras;
//   - a aba em segundo plano NÃO recarrega: espera o usuário voltar a ela.
//     A maioria das abas abertas está escondida, e essas não precisam de nada
//     até alguém olhar para elas;
//   - o botão "Recarregar" continua imediato: é uma pessoa pedindo, não uma
//     multidão de temporizadores.
//
// ?simular-queda=1 na URL mostra a tela sem queda real (apresentação e
// conferência visual). Não muda nada no servidor.
// =====================================================================

export type EstadoDoSistema = "ok" | "verificando" | "fora";

const INTERVALO_REVERIFICACAO_MS = 15_000;
const INTERVALO_REVERIFICACAO_MAX_MS = 120_000;
const ATRASO_MAX_RECARGA_MS = 20_000;
const INTERVALO_CONFIRMACAO_MS = 3_000;
const TEMPO_LIMITE_SAUDE_MS = 8_000;

/**
 * Espera antes do próximo reteste: dobra a cada falha até o teto e é sorteada
 * entre 50 % e 150 % do valor, para as abas não testarem em fase.
 * `sorteio` em [0, 1) — parâmetro para o teste poder fixar.
 */
export function intervaloReverificacao(falhas: number, sorteio = Math.random()): number {
  const base = Math.min(INTERVALO_REVERIFICACAO_MS * 2 ** Math.max(0, falhas), INTERVALO_REVERIFICACAO_MAX_MS);
  return Math.round(base * (0.5 + sorteio));
}

/** Quanto a aba visível espera para recarregar depois que o servidor volta. */
export function atrasoDeRecarga(sorteio = Math.random()): number {
  return Math.round(ATRASO_MAX_RECARGA_MS * sorteio);
}

let estado: EstadoDoSistema = "ok";
let proximaVerificacaoEm: number | null = null;
let simulado = false;
let instalado = false;
let fetchOriginal: typeof window.fetch | null = null;
let reverificacao: ReturnType<typeof setTimeout> | null = null;
let falhasSeguidas = 0;
let recargaAgendada = false;
const ouvintes = new Set<() => void>();

function mudar(novo: EstadoDoSistema) {
  if (novo === estado) return;
  estado = novo;
  ouvintes.forEach((fn) => fn());
}

export const monitorDeQueda = {
  estado: () => estado,
  proximaVerificacaoEm: () => proximaVerificacaoEm,
  simulado: () => simulado,
  assinar(fn: () => void) {
    ouvintes.add(fn);
    return () => ouvintes.delete(fn);
  },
};

const ehSupabase = (url: string) =>
  url.startsWith(SUPABASE_URL) && !url.startsWith(`${SUPABASE_URL}/functions/`);

/**
 * O banco responde? true = sim (qualquer status < 500).
 *
 * 15/10/2026: era GET /rest/v1/ — a Supabase passou a devolver 401 ("só
 * service_role") nesse endereço SEM tocar no banco, então o teste dizia "de
 * pé" com o Postgres caído e a tela de queda nunca entrava (o ERP ficava na
 * tela de início vazia). Agora é a RPC sistema_saude() (mig
 * 20261015000013): obriga o PostgREST a pegar conexão e rodar SQL — banco
 * fora ou lotado responde 503/504.
 */
export async function servidorRespondendo(): Promise<boolean> {
  const f = fetchOriginal ?? window.fetch.bind(window);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_SAUDE_MS);
  try {
    const r = await f(`${SUPABASE_URL}/rest/v1/rpc/sistema_saude`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return r.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function agendarReverificacao() {
  if (reverificacao) clearTimeout(reverificacao);
  const espera = intervaloReverificacao(falhasSeguidas);
  falhasSeguidas++;
  proximaVerificacaoEm = Date.now() + espera;
  ouvintes.forEach((fn) => fn());
  reverificacao = setTimeout(() => void verificarAgora(false), espera);
}

const abaEscondida = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * O servidor voltou e quem descobriu foi o temporizador, não uma pessoa.
 * Aba visível: recarrega depois de um sorteio. Aba escondida: só quando o
 * usuário voltar a ela (ver "03/11/2026" no topo).
 */
function recarregarSemManada() {
  if (recargaAgendada) return;
  recargaAgendada = true;
  if (abaEscondida()) {
    proximaVerificacaoEm = null;
    ouvintes.forEach((fn) => fn());
    const aoVoltar = () => {
      if (abaEscondida()) return;
      document.removeEventListener("visibilitychange", aoVoltar);
      window.location.reload();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return;
  }
  const atraso = atrasoDeRecarga();
  proximaVerificacaoEm = Date.now() + atraso;
  ouvintes.forEach((fn) => fn());
  setTimeout(() => window.location.reload(), atraso);
}

/**
 * Testa já. Voltou → recarrega a página (o estado montado durante a queda
 * está vazio e não se conserta sozinho). Continua fora → agenda de novo.
 */
export async function verificarAgora(manual = true): Promise<boolean> {
  if (simulado) {
    // Na simulação o relógio só recomeça; sair é o botão (tira o parâmetro da URL).
    if (!manual) { agendarReverificacao(); return false; }
    const url = new URL(window.location.href);
    url.searchParams.delete("simular-queda");
    window.location.replace(url.toString());
    return true;
  }
  const ok = await servidorRespondendo();
  if (ok) {
    if (manual) {
      proximaVerificacaoEm = null;
      window.location.reload();
    } else {
      recarregarSemManada();
    }
    return true;
  }
  agendarReverificacao();
  return false;
}

async function suspeitar() {
  if (estado !== "ok") return;
  mudar("verificando");
  if (await servidorRespondendo()) { mudar("ok"); return; }
  await esperar(INTERVALO_CONFIRMACAO_MS);
  if (await servidorRespondendo()) { mudar("ok"); return; }
  mudar("fora");
  falhasSeguidas = 0;
  agendarReverificacao();
}

/** Chamado uma vez, no main.tsx, antes de montar o React. */
export function instalarMonitorDeQueda() {
  if (instalado || typeof window === "undefined") return;
  instalado = true;

  if (new URLSearchParams(window.location.search).has("simular-queda")) {
    simulado = true;
    estado = "fora";
    setTimeout(agendarReverificacao, 0);
  }

  fetchOriginal = window.fetch.bind(window);
  const original = fetchOriginal;
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const observar = ehSupabase(url);
    try {
      const r = await original(entrada, init);
      if (observar && r.status >= 500 && r.status !== 501) void suspeitar();
      return r;
    } catch (e) {
      // Abort é quem chamou desistindo (troca de tela, debounce) — não é queda.
      const abortado = e instanceof DOMException && e.name === "AbortError";
      if (observar && !abortado) void suspeitar();
      throw e;
    }
  };
}
