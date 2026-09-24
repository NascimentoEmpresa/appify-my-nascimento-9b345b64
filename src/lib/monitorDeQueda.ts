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
//   2. suspeita não derruba nada: dispara o teste de saúde — GET no
//      /rest/v1/ (o PostgREST responde 503 quando não alcança o banco).
//      Só com DUAS falhas seguidas, 3 s de intervalo, o estado vira "fora".
//      Um 500 de uma RPC com bug não passa daqui, porque a saúde responde ok;
//   3. com o estado "fora", testa de novo a cada 15 s e, quando responde,
//      RECARREGA a página: perfil, permissões e menu vêm do zero, em vez de
//      ficar com o estado vazio da janela de queda.
// Edge Functions ficam de fora: 5xx delas é erro da função, não queda.
//
// ?simular-queda=1 na URL mostra a tela sem queda real (apresentação e
// conferência visual). Não muda nada no servidor.
// =====================================================================

export type EstadoDoSistema = "ok" | "verificando" | "fora";

const INTERVALO_REVERIFICACAO_MS = 15_000;
const INTERVALO_CONFIRMACAO_MS = 3_000;
const TEMPO_LIMITE_SAUDE_MS = 8_000;

let estado: EstadoDoSistema = "ok";
let proximaVerificacaoEm: number | null = null;
let simulado = false;
let instalado = false;
let fetchOriginal: typeof window.fetch | null = null;
let reverificacao: ReturnType<typeof setTimeout> | null = null;
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

/** O banco responde? true = sim (qualquer status < 500). */
export async function servidorRespondendo(): Promise<boolean> {
  const f = fetchOriginal ?? window.fetch.bind(window);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_SAUDE_MS);
  try {
    const r = await f(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
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
  proximaVerificacaoEm = Date.now() + INTERVALO_REVERIFICACAO_MS;
  ouvintes.forEach((fn) => fn());
  reverificacao = setTimeout(() => void verificarAgora(false), INTERVALO_REVERIFICACAO_MS);
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
    proximaVerificacaoEm = null;
    window.location.reload();
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
