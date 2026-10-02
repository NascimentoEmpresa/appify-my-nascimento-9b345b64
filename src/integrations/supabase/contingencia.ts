// =====================================================================
// CONTINGÊNCIA — usar a réplica quando a Supabase não responde
//
// POR QUE ISTO EXISTE
// O monitorDeQueda já detecta que o banco caiu e mostra "aguarde". Isso foi
// um avanço sobre o ERP "funcionando vazio" de 23/09/2026, mas o usuário
// continua sem poder fazer nada — nem CONSULTAR, que é a maior parte do uso:
// conferir um pedido, ver uma escala, olhar um contrato.
//
// Existe uma réplica completa do banco rodando fora da Supabase. Este arquivo
// é o que permite ao navegador falar com ela enquanto a Supabase está fora.
//
// O RISCO QUE DEFINE O DESENHO: SPLIT-BRAIN
// Se metade dos navegadores escrevesse na réplica e a outra metade na
// Supabase, haveria duas verdades — e a próxima recarga da réplica apagaria
// o que foi escrito nela. Pedido aprovado que desaparece, hora extra que não
// existe mais. Pior que ficar fora do ar, porque o usuário viu "salvo".
//
// Por isso a contingência é SOMENTE LEITURA, e essa garantia NÃO está aqui:
// está no servidor, onde ninguém contorna —
//     alter role authenticated set default_transaction_read_only = on;
// Qualquer tentativa de gravar volta com
//     cannot execute INSERT in a read-only transaction
// ainda que este código tivesse um bug, ainda que alguém chame a API direto.
// Liberar escrita é decisão humana (infra/failover/.../promover.sh).
//
// DESLIGADO ENQUANTO NÃO FOR CONFIGURADO
// Sem VITE_FAILOVER_URL e VITE_FAILOVER_ANON_KEY no build, tudo aqui é inerte
// e o ERP se comporta exatamente como antes. É de propósito: isto entra no
// caminho de todos os usuários, e não se liga por acidente de merge.
// =====================================================================

/** Endereço da réplica, embutido no build. Vazio = contingência desligada. */
const URL_REPLICA = (import.meta.env.VITE_FAILOVER_URL as string | undefined)?.replace(/\/$/, "") ?? "";

/**
 * A réplica assina os JWT com OUTRO segredo, então ela tem a própria chave
 * anon. Reusar a da produção daria "invalid signature" em tudo — detalhe que
 * passa fácil, porque o erro não fala de assinatura.
 */
const CHAVE_REPLICA = (import.meta.env.VITE_FAILOVER_ANON_KEY as string | undefined) ?? "";

export const CONTINGENCIA_CONFIGURADA = Boolean(URL_REPLICA && CHAVE_REPLICA);

/**
 * sessionStorage e não localStorage, de propósito: a contingência vale para
 * ESTA aba e esta sessão. Fechar o navegador volta para a produção sozinho —
 * ninguém fica preso na réplica porque trocou num dia em que a Supabase
 * piscou e esqueceu.
 */
const CHAVE_SESSAO = "erp:contingencia";

/** Estamos falando com a réplica agora? */
export function emContingencia(): boolean {
  if (!CONTINGENCIA_CONFIGURADA || typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(CHAVE_SESSAO) === "1";
  } catch {
    // Navegador com armazenamento bloqueado: segue na produção, que é o certo.
    return false;
  }
}

/**
 * O endereço e a chave que o cliente Supabase deve usar.
 *
 * NÃO aceita URL arbitrária vinda do armazenamento — só o valor embutido no
 * build. O sessionStorage guarda apenas um "sim/não". Guardar a URL ali
 * deixaria qualquer script que rode na página apontar o ERP para um servidor
 * de terceiro e colher os tokens de quem logasse.
 */
export function backendEmUso(padrao: { url: string; chave: string }): { url: string; chave: string } {
  return emContingencia() ? { url: URL_REPLICA, chave: CHAVE_REPLICA } : padrao;
}

/** A réplica está no ar? Usado antes de oferecer a troca ao usuário. */
export async function replicaRespondendo(): Promise<boolean> {
  if (!CONTINGENCIA_CONFIGURADA) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    // /saude é do nginx da réplica e responde sem tocar no banco: serve para
    // saber se o serviço está de pé antes de prometer qualquer coisa.
    const r = await fetch(`${URL_REPLICA}/saude`, { cache: "no-store", signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Passa a usar a réplica e recarrega. O reload é necessário, não preguiça: o
 * cliente Supabase é criado uma vez, no import, e 354 arquivos já o têm em
 * mãos. Trocar a URL com o app montado deixaria metade das telas falando com
 * um endereço e metade com o outro.
 */
export function entrarEmContingencia(): void {
  if (!CONTINGENCIA_CONFIGURADA) return;
  try {
    sessionStorage.setItem(CHAVE_SESSAO, "1");
    // A sessão da produção não vale na réplica: são segredos JWT diferentes.
    // Sem limpar, o app subiria com um token que a réplica recusa e o usuário
    // veria "sessão expirada" em vez da tela de login.
    Object.keys(localStorage)
      .filter((k) => k.startsWith("sb-"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    return;
  }
  window.location.reload();
}

/** Volta para a produção. Mesmo cuidado com a sessão, no sentido inverso. */
export function sairDaContingencia(): void {
  try {
    sessionStorage.removeItem(CHAVE_SESSAO);
    Object.keys(localStorage)
      .filter((k) => k.startsWith("sb-"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* sem armazenamento: o reload já volta para a produção */
  }
  window.location.reload();
}
