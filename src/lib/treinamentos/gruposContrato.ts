// =====================================================================
// Grupos de contrato do "Acesso por contrato" (Dashboard de Treinamentos).
//
// 27/10/2026, pedido do Pablo: "Todas UFRGS", "Todas UFFS", "Todas
// Prefeitura"... no seletor de contratos. Os grupos saem do PRÓPRIO NOME do
// contrato, que vem da Senior como "1050 - UFRGS - LIMPEZA GERAL",
// "1099 - PREF POA SMS RECEPÇÃO", "1030 - UFFS CHAPECO - 041/2025" — de
// propósito sem lista fixa à mão: contrato novo cai sozinho no grupo certo.
//
// Regra:
//   · tira o número do começo ("1050 - ") e pega o trecho até o próximo " - ";
//   · trecho que começa com PREF (PREF, PREF., PREFEITURA) → "Prefeituras";
//   · senão, a chave é a 1ª palavra ("UFFS CHAPECO" e "UFFS ERECHIM" → UFFS);
//   · o rótulo é o maior começo comum entre os membros ("POLICIA CIVIL RS
//     LIMPEZA" + "POLICIA CIVIL RS PORTARIA" → "POLICIA CIVIL RS"), pra não
//     mostrar "POLICIA" ou "BENTO" sozinhos;
//   · grupo de um contrato só não aparece — seria o próprio contrato repetido.
// =====================================================================

export interface GrupoContrato {
  chave: string;
  rotulo: string;
  nomes: string[];
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Trecho do cliente: "1050 - UFRGS - LIMPEZA GERAL" → "UFRGS". */
export function trechoCliente(nome: string): string {
  const semNumero = nome.trim().replace(/^\d+\s*-\s*/, "");
  return semNumero.split(/\s+-\s+/)[0].trim();
}

/** Chave do grupo (sem acento, maiúscula) ou null quando o nome não diz nada. */
export function chaveGrupoContrato(nome: string): string | null {
  const trecho = semAcento(trechoCliente(nome)).toUpperCase();
  if (!trecho) return null;
  if (/^PREF/.test(trecho)) return "PREFEITURA";
  const primeira = trecho.split(/[\s.,/]+/)[0];
  return primeira && !/^\d+$/.test(primeira) ? primeira : null;
}

function prefixoComum(listas: string[][]): string[] {
  const [primeira, ...resto] = listas;
  const out: string[] = [];
  for (let i = 0; i < primeira.length; i++) {
    const p = semAcento(primeira[i]).toUpperCase();
    if (resto.some((l) => semAcento(l[i] ?? "").toUpperCase() !== p)) break;
    out.push(primeira[i]);
  }
  return out;
}

/** Agrupa os contratos pelo cliente; só devolve grupos com 2+ contratos, em ordem alfabética. */
export function gruposDeContratos(nomes: string[]): GrupoContrato[] {
  const porChave = new Map<string, string[]>();
  for (const nome of nomes) {
    const chave = chaveGrupoContrato(nome);
    if (!chave) continue;
    const lista = porChave.get(chave) ?? [];
    lista.push(nome);
    porChave.set(chave, lista);
  }
  const grupos: GrupoContrato[] = [];
  for (const [chave, membros] of porChave) {
    if (membros.length < 2) continue;
    const rotulo = chave === "PREFEITURA"
      ? "Prefeituras"
      : prefixoComum(membros.map((m) => trechoCliente(m).split(/\s+/))).join(" ") || chave;
    grupos.push({ chave, rotulo, nomes: membros });
  }
  return grupos.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}
