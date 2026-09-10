/**
 * Trajeto do objeto dos Correios — dos eventos crus para as paradas do mapa.
 *
 * O QUE ISTO NÃO É: rastreamento por satélite. Os Correios não expõem posição
 * de veículo, e não é uma limitação da nossa integração — o evento nasce
 * quando o objeto é BIPADO numa unidade, então o que se sabe é "passou por
 * esta cidade nesta hora". A linha que o mapa desenha entre duas paradas é
 * ligação reta, não o caminho que o caminhão fez. A tela diz isso ao usuário;
 * este arquivo só garante que a estrutura de dados não prometa mais do que há.
 *
 * Aqui não se importa React, Leaflet nem Supabase: é o que o teste carrega.
 */

export interface EventoCorreio {
  descricao: string | null;
  data: string | null;
  cidade: string | null;
  uf: string | null;
  destinoCidade?: string | null;
  destinoUf?: string | null;
}

export interface Parada {
  /** "PENHA-SC" — o mesmo formato da chave em `correios_geo_cidade`. */
  chave: string;
  cidade: string;
  uf: string;
  /** Todos os eventos registrados nesta cidade, na ordem em que aconteceram. */
  eventos: EventoCorreio[];
  /** Só o objeto ainda não passou por aqui: veio de "em transferência PARA". */
  previsto: boolean;
}

const semAcento = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

/** A chave que liga a parada à coordenada guardada. */
export function chaveCidade(cidade?: string | null, uf?: string | null): string {
  const c = semAcento(cidade);
  const u = semAcento(uf);
  if (!c || !u) return "";
  return `${c}-${u}`;
}

/** "Sao Jose" + "SC" → "Sao Jose - SC", como o site dos Correios escreve. */
export const rotuloCidade = (p: { cidade: string; uf: string }) => `${p.cidade} - ${p.uf}`;

/**
 * Agrupa os eventos em paradas, na ordem cronológica.
 *
 * Duas decisões que mudam o desenho:
 *
 *   • cidades REPETIDAS EM SEQUÊNCIA viram uma parada só. Um objeto costuma
 *     gerar três eventos seguidos na mesma unidade ("saiu para entrega",
 *     "entregue"), e três pinos empilhados no mesmo ponto do mapa não
 *     informam nada além de sujeira;
 *   • a cidade repetida DEPOIS de ter saído volta a ser parada nova — o
 *     objeto que retorna à unidade de origem passou por lá duas vezes, e
 *     omitir isso esconderia justamente o extravio que se quer enxergar.
 */
export function montarParadas(eventos: EventoCorreio[]): Parada[] {
  const paradas: Parada[] = [];

  for (const e of eventos) {
    const chave = chaveCidade(e.cidade, e.uf);
    // Evento sem unidade não vira pino: o mapa não tem onde pôr. Ele continua
    // existindo na lista lateral da tela, que é texto e não precisa de lugar.
    if (!chave) continue;

    const ultima = paradas[paradas.length - 1];
    if (ultima && ultima.chave === chave) {
      ultima.eventos.push(e);
      continue;
    }
    paradas.push({
      chave,
      cidade: String(e.cidade).trim(),
      uf: String(e.uf).trim().toUpperCase(),
      eventos: [e],
      previsto: false,
    });
  }

  // A última transferência aponta para onde o objeto está indo. Enquanto ele
  // não chega, essa cidade não tem evento próprio — e é exatamente a que quem
  // abre o mapa quer ver. Entra como parada PREVISTA, desenhada tracejada.
  const ultimoEvento = eventos[eventos.length - 1];
  const destino = chaveCidade(ultimoEvento?.destinoCidade, ultimoEvento?.destinoUf);
  if (destino && paradas[paradas.length - 1]?.chave !== destino) {
    paradas.push({
      chave: destino,
      cidade: String(ultimoEvento!.destinoCidade).trim(),
      uf: String(ultimoEvento!.destinoUf).trim().toUpperCase(),
      eventos: [],
      previsto: true,
    });
  }

  return paradas;
}

/** Já foi entregue? Fecha o mapa em verde e para de prometer próxima parada. */
export const foiEntregue = (eventos: EventoCorreio[]) =>
  eventos.some((e) => /entregue ao destinat/i.test(e.descricao ?? ""));

/** As cidades cuja coordenada ainda não está no cache — o que falta buscar. */
export function chavesSemCoordenada(
  paradas: Parada[],
  conhecidas: Record<string, unknown>,
): string[] {
  return [...new Set(paradas.map((p) => p.chave))].filter((c) => !(c in conhecidas));
}

/**
 * A consulta que vai ao Nominatim.
 *
 * Município + UF + Brasil, e nada mais. "Penha" sozinho existe em Portugal e
 * é bairro no Rio; sem a UF o pino cai no lugar errado com toda a confiança.
 */
export const consultaDaCidade = (p: { cidade: string; uf: string }) =>
  `${p.cidade}, ${p.uf}, Brasil`;

/** Data do evento em "31/08/2026 10:47" — o formato do site dos Correios. */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
