/**
 * ENDEREÇO → COORDENADA (Patrimônio).
 *
 * O mapa mostrava um pino por CIDADE. Para mostrar cada imóvel no lugar dele
 * é preciso coordenada, e o cadastro só tem texto — texto bem irregular, do
 * tipo "RUA JOÃO PESSOA, 172" até "COTAS - GAV" e "MURANO".
 *
 * A coordenada é buscada UMA VEZ e gravada em JUR_PATRIMONIOS
 * (latitude/longitude/geo_endereco). O que a tela faz a cada abertura é só
 * ler o que já está gravado.
 *
 * Este arquivo não importa React nem Supabase: é o que os testes carregam.
 */

export interface PatrimonioGeo {
  id: number;
  cidade?: string | null;
  localizacao?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geo_endereco?: string | null;
  geo_status?: string | null;
}

export type GeoStatus = "ok" | "manual" | "nao_encontrado";

/**
 * Limpa o endereço para consulta.
 *
 * O cadastro mistura endereço com anotação — "RUA ALLAN KARDEC - CASA AZUL
 * (o valor faltante será pago ao final da regularização)". O que está entre
 * parênteses é recado, nunca endereço, e derruba a busca. Também tira
 * marcadores de unidade (bloco, apartamento, box, sala), que o geocodificador
 * não conhece e que não mudam a coordenada do prédio.
 */
export function limparEndereco(bruto?: string | null): string {
  let s = String(bruto ?? "")
    .replace(/\([^)]*\)/g, " ")                    // anotação entre parênteses
    .replace(/\bN[ºO°]?\s*\.?\s*0+\b/gi, " ")      // "Nº 0" = sem número
    .replace(/\b(BL|BLOCO|AP|APTO|APARTAMENTO|BOX|SALA|TORRE|UNIDADE)\.?\s*[\w-]*/gi, " ")
    // Tirar um pedaço do meio deixa separador órfão: "TRAVESSA X, 876, - ZONA"
    // e "CHACARÁ TF 10, , PASSO FUNDO". Vírgula/traço repetido atrapalha a
    // busca, então some junto com o que foi removido.
    .replace(/\s*[,-]\s*(?=[,-])/g, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,\-]+|[\s,\-]+$/g, "")
    .trim();
  // Sobrou só pontuação/traço: não é endereço.
  if (!/[a-zà-ú]/i.test(s)) s = "";
  return s;
}

/**
 * A consulta que vai ao geocodificador: endereço + cidade + RS + Brasil.
 *
 * Sem cidade e estado, "RUA JOÃO PESSOA, 172" cai em qualquer canto do país.
 * Devolve "" quando não há o que consultar — aí o imóvel fica no pino da
 * cidade em vez de virar um pino no lugar errado.
 */
export function consultaGeo(p: PatrimonioGeo): string {
  const endereco = limparEndereco(p.localizacao);
  const cidade = String(p.cidade ?? "").trim();
  // SEM endereço não há o que localizar: buscar só a cidade devolveria o
  // centro dela, ou seja, um pino "exato" que não é o imóvel. Nesse caso o
  // patrimônio fica no pino de cidade, que é honesto sobre o que se sabe.
  if (!endereco) return "";
  // Nome de empreendimento ("MURANO") sozinho não localiza, mas somado à
  // cidade ainda pode achar o prédio — vale tentar.
  const partes = [endereco, cidade, "RS", "Brasil"].filter(Boolean);
  return partes.join(", ");
}

/**
 * O pedaço que é LOGRADOURO, quando dá para reconhecer.
 *
 * O cadastro põe o nome do empreendimento na frente da rua — "TURIM - RUA
 * JOSE MILTON LOPES, 557", "ATLANTIDA GREEN SQUARE - AV CENTRAL, 1891" — e
 * com esse prefixo o serviço não acha nada. Aqui a rua é recortada do meio do
 * texto: do "RUA/AV/TRAVESSA..." até o número, se houver.
 */
export function logradouro(endereco: string): string {
  const m = /\b(RUA|R\.|AV|AVENIDA|AV\.|TRAVESSA|TV\.|ESTRADA|ESTR\.|RODOVIA|BR-?\d*|ALAMEDA|PRACA|PRAÇA)\b[^,]*/i.exec(endereco);
  if (!m) return "";
  const daRuaEmDiante = endereco.slice(m.index);
  // Fica com "RUA X, 557" e descarta o que vier depois do número.
  const comNumero = /^([^,]+,\s*\d+)/.exec(daRuaEmDiante);
  const so = comNumero ? comNumero[1] : daRuaEmDiante.split(",")[0];
  return so.replace(/\s*-\s*.*$/, "").trim();
}

/**
 * As consultas a tentar, da mais específica para a mais genérica.
 *
 * Uma tentativa só resolve pouco mais da metade do cadastro: os endereços vêm
 * com prefixo de empreendimento, apelido da casa ("CASA AZUL") e nome de
 * bairro colados. Descendo o nível de detalhe, o que sobra é o que o mapa
 * realmente conhece. Parar na PRIMEIRA que achar mantém a precisão: a
 * variante seguinte só entra quando a anterior não devolveu nada.
 */
/**
 * Como o mapa escreve a cidade.
 *
 * O cadastro grava "Xangrilá" e o OpenStreetMap conhece "Xangri-lá" — medido:
 * com a grafia do cadastro a busca devolve VAZIO, com a do mapa acha na hora.
 * Só entram aqui os nomes em que as duas grafias divergem de verdade.
 */
const CIDADE_NO_MAPA: Record<string, string> = {
  XANGRILA: "Xangri-lá",
  "XANGRI LA": "Xangri-lá",
  "CAPAO DA CANOA": "Capão da Canoa",
};

const semAcento = (v?: string | null) =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

export const cidadeParaBusca = (cidade?: string | null): string =>
  CIDADE_NO_MAPA[semAcento(cidade)] ?? String(cidade ?? "").trim();

export function variantesDeConsulta(p: PatrimonioGeo): string[] {
  const endereco = limparEndereco(p.localizacao);
  if (!endereco) return [];
  const sufixo = [cidadeParaBusca(p.cidade), "RS", "Brasil"].filter(Boolean).join(", ");
  const rua = logradouro(endereco);
  const semNumero = rua.replace(/,\s*\d+\s*$/, "").trim();
  // Endereço sem "RUA/AV" na frente ("ADÃO TAVARES DA SILVA, 393") não tem
  // logradouro a recortar; o que dá para afrouxar nele é o número.
  const enderecoSemNumero = endereco.replace(/,\s*\d+.*$/, "").trim();
  const candidatos = [endereco, rua, semNumero, enderecoSemNumero]
    .map(x => x.trim()).filter(Boolean);
  // Sem repetir: "RUA X" pode sair igual nas três variantes.
  return [...new Set(candidatos)].map(x => `${x}, ${sufixo}`);
}

/** Assinatura do endereço: muda quando o cadastro muda, e aí refaz a busca. */
export const assinaturaEndereco = (p: PatrimonioGeo): string =>
  `${String(p.localizacao ?? "").trim()}|${String(p.cidade ?? "").trim()}`;

/** Já tem coordenada boa e do endereço ATUAL? */
export const temCoordenada = (p: PatrimonioGeo): boolean =>
  p.latitude != null && p.longitude != null;

/**
 * Precisa procurar coordenada?
 *
 * Não procura de novo o que já falhou com o MESMO endereço — senão toda
 * abertura de tela repetiria as buscas impossíveis ("COTAS - GAV"). Corrigiu
 * o endereço no cadastro, volta a ser tentado.
 * Coordenada digitada à mão (manual) nunca é sobrescrita.
 */
export function precisaLocalizar(p: PatrimonioGeo): boolean {
  if (p.geo_status === "manual") return false;
  const mudou = assinaturaEndereco(p) !== String(p.geo_endereco ?? "");
  if (temCoordenada(p) && !mudou) return false;
  if (p.geo_status === "nao_encontrado" && !mudou) return false;
  return variantesDeConsulta(p).length > 0;
}

/** Coordenada plausível para o Sul do Brasil — barra dígito trocado na mão. */
export function coordenadaValida(lat: unknown, lng: unknown): boolean {
  const a = Number(lat), b = Number(lng);
  if (!isFinite(a) || !isFinite(b)) return false;
  return a >= -34 && a <= 5 && b >= -74 && b <= -34;
}

// ── Chamada ao serviço ──────────────────────────────────────────────────
export interface Achado { lat: number; lng: number; rotulo: string }

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/**
 * Uma busca no Nominatim (OpenStreetMap).
 *
 * `countrycodes=br` e o viewbox do Rio Grande do Sul apertam o resultado: sem
 * isso "RUA PERU" acha o país Peru. `bounded=0` mantém o viewbox como
 * preferência, não como cerca — imóvel fora do RS ainda aparece.
 *
 * NÃO manda nome de proprietário nem valor: só rua, cidade e estado.
 */
export async function buscarCoordenada(consulta: string, fetchFn = fetch): Promise<Achado | null> {
  if (!consulta.trim()) return null;
  const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=br`
    + `&viewbox=-58,-27,-49,-34&q=${encodeURIComponent(consulta)}`;
  const r = await fetchFn(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Serviço de mapas respondeu ${r.status}`);
  const dados = await r.json();
  const primeiro = Array.isArray(dados) ? dados[0] : null;
  if (!primeiro) return null;
  const lat = Number(primeiro.lat), lng = Number(primeiro.lon);
  if (!coordenadaValida(lat, lng)) return null;
  return { lat, lng, rotulo: String(primeiro.display_name ?? consulta) };
}

/**
 * Tenta as variantes em ordem e para na primeira que achar.
 *
 * `aguardar` é injetável para o teste não esperar 1,1s por tentativa.
 */
export async function localizarPatrimonio(
  p: PatrimonioGeo,
  opcoes: { fetchFn?: typeof fetch; aguardar?: (ms: number) => Promise<void> } = {},
): Promise<{ achado: Achado | null; tentativas: number }> {
  const variantes = variantesDeConsulta(p);
  const fetchFn = opcoes.fetchFn ?? fetch;
  const aguardar = opcoes.aguardar ?? esperar;
  for (let i = 0; i < variantes.length; i++) {
    if (i > 0) await aguardar(INTERVALO_MS);
    const achado = await buscarCoordenada(variantes[i], fetchFn);
    if (achado) return { achado, tentativas: i + 1 };
  }
  return { achado: null, tentativas: variantes.length };
}

/** O Nominatim pede no máximo 1 chamada por segundo. Isso é o intervalo. */
export const INTERVALO_MS = 1100;

export const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
