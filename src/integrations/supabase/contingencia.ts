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
// está no servidor, onde ninguém contorna — REVOKE nas tabelas e nas 451 RPC
// que escrevem. Qualquer tentativa de gravar volta com "permission denied",
// ainda que este código tivesse um bug. Liberar escrita é decisão humana
// (infra/failover/.../promover.sh).
//
// =====================================================================
// DE ONDE VÊM O ENDEREÇO E A CHAVE — e por que são tratados diferente
//
// O ERP é publicado pelo Lovable, e lá as variáveis de build ("Segredos de
// compilação") são recurso Enterprise — conferido em 02/10/2026: a tela só
// oferece "Fazer upgrade". Sem elas, um `.env` local nunca chega ao site
// publicado, e a contingência ficaria eternamente desligada em produção.
//
// A saída NÃO foi escrever a chave aqui. Este repositório é público, e
// credencial versionada é credencial vazada — vale mesmo quando a RLS protege
// os dados, porque a regra não comporta exceção caso a caso.
//
//   ENDEREÇO  fica no código. Não é segredo: https://erp-failover.onrender.com
//             responde a qualquer um e qualquer varredura acha. É só um
//             destino, e deixá-lo fixo é o que impede alguém de apontar o ERP
//             para um servidor de terceiro (ver `backendEmUso`).
//
//   CHAVE     vem da PRÓPRIA RÉPLICA, em /contingencia.json. Ela é assinada
//             com outro segredo (a de produção não serve aqui) e muda se a
//             réplica for recriada. Buscá-la em tempo de execução também
//             permite trocá-la sem reconstruir o ERP.
//
// Medido no mesmo dia, direto na API: com a chave anon e SEM login, a réplica
// devolve zero linhas em EMPREGADOS, profiles e notificacoes. Quem protege os
// dados é a RLS — exatamente como o env.ts já explica para a chave de produção.
// =====================================================================

/**
 * Endereço da réplica. O `.env` sobrescreve (útil para apontar a contingência
 * a outro servidor em teste); o padrão é a réplica de produção.
 */
const URL_REPLICA = (
  (import.meta.env.VITE_FAILOVER_URL as string | undefined) || "https://erp-failover.onrender.com"
).replace(/\/$/, "");

/** Onde a réplica publica a própria configuração. */
const ENDERECO_CONFIG = `${URL_REPLICA}/contingencia.json`;

/**
 * sessionStorage e não localStorage, de propósito: a contingência vale para
 * ESTA aba e esta sessão. Fechar o navegador volta para a produção sozinho —
 * ninguém fica preso na réplica porque trocou num dia em que a Supabase
 * piscou e esqueceu.
 */
const CHAVE_SESSAO = "erp:contingencia";
const CHAVE_SESSAO_ANON = "erp:contingencia:anon";

function doArmazenamento(chave: string): string {
  try {
    return sessionStorage.getItem(chave) ?? "";
  } catch {
    // Navegador com armazenamento bloqueado: segue na produção, que é o certo.
    return "";
  }
}

/** A contingência está disponível? (sempre sim — o endereço é fixo) */
export const CONTINGENCIA_CONFIGURADA = Boolean(URL_REPLICA);

/** Estamos falando com a réplica agora? */
export function emContingencia(): boolean {
  return doArmazenamento(CHAVE_SESSAO) === "1" && Boolean(doArmazenamento(CHAVE_SESSAO_ANON));
}

/**
 * O endereço e a chave que o cliente Supabase deve usar.
 *
 * O ENDEREÇO NÃO VEM DO ARMAZENAMENTO, e isso é deliberado: guardar a URL ali
 * deixaria qualquer script que rode na página apontar o ERP para um servidor
 * de terceiro e colher os tokens de quem logasse. O destino é sempre o valor
 * fixo acima; do armazenamento vem apenas a chave, e uma chave errada só faz
 * a réplica recusar — não desvia ninguém para lugar nenhum.
 */
export function backendEmUso(padrao: { url: string; chave: string }): { url: string; chave: string } {
  return emContingencia() ? { url: URL_REPLICA, chave: doArmazenamento(CHAVE_SESSAO_ANON) } : padrao;
}

/**
 * A réplica está no ar E sabe se apresentar? Devolve a chave anon dela, ou
 * null. Usado antes de oferecer a troca ao usuário: um botão que leva a uma
 * tela que não carrega é pior que botão nenhum.
 */
export async function replicaRespondendo(): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const r = await fetch(ENDERECO_CONFIG, { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) return null;
    const cfg = (await r.json()) as { anon?: string };
    // Sem chave não há contingência possível — melhor não oferecer.
    return cfg?.anon && cfg.anon.length > 40 ? cfg.anon : null;
  } catch {
    return null;
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
export function entrarEmContingencia(chaveAnon: string): void {
  if (!chaveAnon) return;
  try {
    sessionStorage.setItem(CHAVE_SESSAO, "1");
    sessionStorage.setItem(CHAVE_SESSAO_ANON, chaveAnon);
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
    sessionStorage.removeItem(CHAVE_SESSAO_ANON);
    Object.keys(localStorage)
      .filter((k) => k.startsWith("sb-"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* sem armazenamento: o reload já volta para a produção */
  }
  window.location.reload();
}
