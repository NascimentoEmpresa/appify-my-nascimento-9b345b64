// Motivos dos processos trabalhistas (23/10/2026).
//
// Pablo: "o processo da Mara tem Dano Moral e Dano Material; filtrando por
// Dano Material ele não aparece" — o filtro comparava só com o 1º motivo do
// processo. E "junta os nomes repetidos": a lista de motivos é montada dos
// textos gravados em JUR_PROCESSOS.motivos, então "Indenização por Dano
// Material" e "Indenização por danos materiais" viravam duas opções.
//
// chaveMotivo é a identidade de um motivo: sem acento, sem maiúscula, espaços
// colapsados e plural → singular, palavra por palavra (…ais → …al, …eis → …el,
// …ois → …ol, …ões/…ães → …ão, senão tira o "s" final). Dois textos com a
// mesma chave são o MESMO motivo. A mig 20261023000200 grava no banco o nome
// mais usado de cada chave com esta MESMA regra (jur_motivo_chave) — mudou
// aqui, muda lá.

export function chaveMotivo(motivo: string | null | undefined): string {
  return String(motivo ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ").trim()
    .replace(/([a-z]{2,})ais\b/g, "$1al")
    .replace(/([a-z]{2,})eis\b/g, "$1el")
    .replace(/([a-z]{2,})ois\b/g, "$1ol")
    .replace(/([a-z]{2,})[oa]es\b/g, "$1ao")
    .replace(/([a-z]{3,})s\b/g, "$1");
}

export interface MotivoAgrupado {
  chave: string;
  /** O nome mais usado entre as grafias da chave (empate: ordem alfabética). */
  nome: string;
  /** Grafias encontradas, do mais usado para o menos. */
  grafias: string[];
  /** Quantas vezes aparece (linhas de motivo). */
  usos: number;
}

/** Agrupa grafias do mesmo motivo. `textos` = um item por uso (linha de motivo). */
export function agruparMotivos(textos: Iterable<string | null | undefined>): MotivoAgrupado[] {
  const grupos = new Map<string, Map<string, number>>();
  for (const t of textos) {
    const nome = String(t ?? "").replace(/\s+/g, " ").trim();
    if (!nome) continue;
    const k = chaveMotivo(nome);
    const g = grupos.get(k) ?? new Map<string, number>();
    g.set(nome, (g.get(nome) ?? 0) + 1);
    grupos.set(k, g);
  }
  return [...grupos.entries()].map(([chave, g]) => {
    const grafias = [...g.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR")).map(([n]) => n);
    return { chave, nome: grafias[0], grafias, usos: [...g.values()].reduce((s, n) => s + n, 0) };
  });
}

/** O processo tem este motivo em QUALQUER posição (não só o 1º)? */
export const processoTemMotivo = (motivos: { motivo: string }[], chave: string): boolean =>
  motivos.some((m) => chaveMotivo(m.motivo) === chave);
