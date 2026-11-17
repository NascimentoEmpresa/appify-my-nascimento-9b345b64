// =====================================================================
// RECARGA SEGURA DA TV — SIS-2026-0912
//
// 13/11/2026 (sexta) o ERP caiu inteiro e a TV do Compras (painel de
// Suprimentos) ficou fora até segunda, quando alguém recarregou na mão. O
// cão de guarda do TvPlayer FEZ o que devia: sem falar com o ERP, recarregou
// a página. Só que recarregou COM O ERP FORA: o navegador da TV caiu na
// própria página de erro ("não foi possível acessar o site"), que não tem o
// nosso JS — sem cão de guarda, sem nova tentativa, tela parada para sempre.
// A recarga de madrugada (3 h–5 h) tem o mesmo buraco se pegar o servidor
// em manutenção. 17/11/2026 caiu de novo do mesmo jeito.
//
// Agora toda recarga (cão de guarda, madrugada, versão nova, aviso novo,
// botão Recarregar) PRIMEIRO baixa o index.html publicado e só sai da página
// se ele voltou com o script do ERP. ERP fora → a TV fica onde está (com o JS
// vivo, mostrando "sem conexão — tentando de novo") e o cão de guarda tenta de
// novo depois de ESPERA_APOS_FALHA_MS. Quando o ERP volta, a TV volta sozinha.
//
// Requisição: só o arquivo estático (/), e só quando a TV JÁ ia recarregar —
// não chega ao banco nem cria timer novo (regra de 03/11, guardião D2).
// =====================================================================
import { scriptPrincipal } from "./tv";

/** O HTML devolvido é a página do ERP (tem o script principal), e não uma página de erro do servidor/proxy. */
export function paginaDoErpNoAr(html: string | null | undefined): boolean {
  return !!scriptPrincipal(html);
}

/** Depois de uma tentativa com o ERP fora, espera isto antes de baixar o index.html de novo. */
export const ESPERA_APOS_FALHA_MS = 60_000;

export interface DepsRecarga {
  /** Baixa o index.html publicado sem cache (null = resposta não-OK). Pode rejeitar (sem rede). */
  buscarIndex: () => Promise<string | null>;
  /** Sai da página (location.replace com ?tv-r=). */
  irPara: () => void;
  agora?: () => number;
}

/**
 * Devolve a função de recarga da TV. Uma tentativa por vez; depois de uma
 * falha, as chamadas seguintes são ignoradas até passar ESPERA_APOS_FALHA_MS.
 * Resolve true se saiu da página.
 */
export function criarRecargaSegura(deps: DepsRecarga): () => Promise<boolean> {
  const agora = deps.agora ?? Date.now;
  let tentando = false;
  let falhouEm = -Infinity;
  return async () => {
    if (tentando || agora() - falhouEm < ESPERA_APOS_FALHA_MS) return false;
    tentando = true;
    try {
      const html = await deps.buscarIndex().catch(() => null);
      if (!paginaDoErpNoAr(html)) { falhouEm = agora(); return false; }
      deps.irPara();
      return true;
    } finally {
      tentando = false;
    }
  };
}
