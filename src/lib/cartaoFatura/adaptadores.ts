import type { AdaptadorBanco } from "./tipos";
import { adaptadorBanrisul } from "./adaptadorBanrisul";
import { adaptadorBancoBrasil } from "./adaptadorBancoBrasil";
import { adaptadorBradesco } from "./adaptadorBradesco";

// SIS-2026-0255: 3 bancos com adaptador no v1 — únicos com amostra real de
// fatura. Sicredi ficou de fora (aquele cartão sempre passa pelo Malote).
// Itaú/Santander/Mentore/Prospera ficam sem adaptador até ter amostra —
// `adaptadorPorNomeBanco` devolve undefined pra eles, e o modal mostra
// "layout não reconhecido pra este banco" em vez de tentar advinhar.
const ADAPTADORES: AdaptadorBanco[] = [adaptadorBanrisul, adaptadorBancoBrasil, adaptadorBradesco];

// Exportada só pra montar a legenda de "formato aceito por banco" no
// modal — se um adaptador novo entrar aqui, a legenda acompanha sozinha.
export const BANCOS_COM_ADAPTADOR = ADAPTADORES;

export function adaptadorPorNomeBanco(nomeBanco: string | null | undefined): AdaptadorBanco | undefined {
  if (!nomeBanco) return undefined;
  const alvo = nomeBanco.trim().toLowerCase();
  return ADAPTADORES.find((a) => a.nomeBanco.toLowerCase() === alvo);
}

export function extensaoAceita(adaptador: AdaptadorBanco, nomeArquivo: string): boolean {
  const ext = nomeArquivo.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  if (ext === "htm") return adaptador.formatos.includes("html");
  return adaptador.formatos.includes(ext as any);
}
