// Busca de telas do ERP — o motor, sem DOM (teste em src/test/busca-telas.test.ts).
//
// A barra do topo era só um <input> sem nada ligado. Aqui a pessoa escreve do
// jeito que sabe, e a conta cobre os três jeitos de errar:
//   · grafia: acento, cedilha, ss/ç/c, plural ("demição", "demissoes") somem na
//     forma sonora, e o que sobra passa pela distância de edição ("recrutameto");
//   · vocabulário: "vaga" não está escrito em "Gestão Recrutamento" — SINONIMOS
//     liga as palavras que a empresa usa aos nomes do menu;
//   · digitação pela metade: "solic dem" casa pelo começo de cada palavra.
//
// Quem pode ver cada tela NÃO é decidido aqui: a lista já chega filtrada pelo
// acesso (useTelasDaBusca).

export interface TelaBusca {
  to: string;
  label: string;
  modulo: string;
  grupo?: string;
}

export interface ResultadoBusca extends TelaBusca {
  pontos: number;
  /** A tela só apareceu por sinônimo: a tela explica o porquê. */
  porSinonimo?: string;
}

/**
 * Palavras que significam a mesma coisa na empresa. Vale nos dois sentidos.
 * Tela nova que as pessoas procuram por outro nome: é só acrescentar aqui.
 */
export const SINONIMOS: string[][] = [
  ["demissao", "demitir", "demitido", "desligamento", "desligar", "rescisao", "aviso previo", "dispensa", "mandar embora"],
  ["vaga", "recrutamento", "selecao", "contratar", "contratacao", "curriculo", "candidato", "banco de talentos", "emprego"],
  ["admissao", "admitir", "contratado", "novas admissoes"],
  ["ferias", "descanso"],
  ["afastamento", "atestado", "licenca", "maternidade", "inss", "auxilio doenca", "telemedicina", "beneficio", "limbo"],
  ["aso", "exame", "demissional", "admissional", "medico", "saude"],
  ["epi", "uniforme", "luva", "bota", "protecao", "laudo", "controle de ca"],
  ["material", "materiais", "almoxarifado", "estoque", "item", "separacao", "etiqueta", "retirada", "uniforme"],
  ["compra", "comprar", "cotacao", "orcamento de compra", "fornecedor", "pedidos de compra"],
  ["nota fiscal", "nf", "nfe", "nota", "emissao", "faturamento", "fatura"],
  ["boleto", "pagamento", "pagar", "conta a pagar", "malote", "despesa"],
  ["reembolso", "ressarcimento"],
  ["carro", "veiculo", "frota", "km", "quilometragem", "agendamento de veiculos"],
  ["salario", "holerite", "contracheque", "ficha financeira", "remuneracao"],
  ["ponto", "marcacao", "batida", "espelho", "frequencia", "conferencia de ponto"],
  ["hora extra", "he", "horas extras", "liberacao de he"],
  ["falta", "efetividade", "cobertura", "diaria", "diarista", "substituicao", "presenca"],
  ["advertencia", "suspensao", "medida disciplinar", "punicao"],
  ["mudanca de funcao", "troca de funcao", "promocao", "trocar funcao"],
  ["treinamento", "curso", "capacitacao", "certificado", "aula"],
  ["chamado", "suporte", "ajuda", "erro", "bug", "problema no sistema", "ticket"],
  ["senha", "login", "acesso", "usuario"],
  ["colaborador", "funcionario", "empregado", "pessoa", "pessoas", "ativos"],
  ["contrato", "postos", "planilha de custo", "implantacao"],
  ["licitacao", "edital", "pregao", "impugnacao", "grade de licitacoes"],
  ["conciliacao", "extrato", "banco", "fluxo de caixa"],
  ["orcamento", "obz", "dre", "lucratividade"],
  ["relatorio", "indicador", "dashboard", "bi", "painel", "grafico"],
  ["denuncia", "comite de etica", "assedio"],
  ["reuniao", "agenda", "calendario"],
  ["organograma", "hierarquia", "estrutura organizacional", "quem e o chefe"],
  ["tarefa", "tarefas", "checklist", "pop", "rotina", "atividade"],
  ["whatsapp", "zap", "wpp", "mensagem"],
  ["juridico", "processo", "audiencia", "advogado", "parecer juridico"],
  ["patrimonio", "bem", "inventario"],
  ["manutencao", "conserto", "reparo", "equipamento"],
  ["bonificacao", "bonus", "premio"],
];

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "um", "uma", "para", "pra", "por", "no", "na", "em", "com", "quero", "preciso", "onde", "como", "fazer", "ver", "tela", "sistema"]);

/** Sem acento, minúsculo, só letras e números. O "ç" e o plural em "ões" entram antes de o acento sumir. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/ç/g, "ss")
    .replace(/[õã]es\b/g, "ao")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A palavra como ela soa: "demição", "demissão" e "demissoes" viram a mesma coisa. */
export function sonora(palavra: string): string {
  let p = palavra
    .replace(/oes$/, "ao")
    .replace(/ph/g, "f")
    .replace(/ch/g, "x")
    .replace(/lh/g, "li")
    .replace(/nh/g, "n")
    .replace(/qu/g, "k")
    .replace(/sc(?=[ei])/g, "s")
    .replace(/c(?=[ei])/g, "s")
    .replace(/cao$/, "sao")
    // Digitando pela metade: "solic" tem que continuar sendo o começo de "solicitar".
    .replace(/c$/, "s")
    .replace(/c/g, "k")
    .replace(/z/g, "s")
    .replace(/y/g, "i")
    .replace(/w/g, "v")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1");
  if (p.length > 3 && p.endsWith("s")) p = p.slice(0, -1);
  return p;
}

const palavras = (texto: string): string[] => normalizar(texto).split(" ").filter(Boolean).map(sonora);

/** Damerau-Levenshtein: letra trocada de lugar ("feiras") custa 1, não 2. */
export function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Quanto erro cabe: palavra curta quase não aceita, senão "ata" vira "nota". */
const toleranciaPara = (n: number): number => (n <= 2 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : 3);

/** 0 a 1: o quanto a palavra digitada casa com uma palavra do nome. */
export function casarPalavra(q: string, w: string): number {
  if (q === w) return 1;
  if (q.length >= 2 && w.startsWith(q)) return 0.85;
  if (w.length >= 4 && q.startsWith(w)) return 0.7;
  if (q.length >= 4 && w.includes(q)) return 0.6;
  const limite = toleranciaPara(q.length);
  if (limite === 0) return 0;
  // Erro aceito só se começar igual: sem isto, "demisao" trazia "Emissão de NF"
  // e "Admissão", que são a uma ou duas letras de distância e outro assunto.
  if (q[0] !== w[0]) return 0;
  const dist = distancia(q, w);
  if (dist <= limite) return 0.8 - 0.12 * dist;
  // Digitando ainda, com erro: compara com o começo da palavra.
  if (q.length >= 5 && w.length > q.length && distancia(q, w.slice(0, q.length)) <= limite - 1) return 0.45;
  return 0;
}

const melhorNasPalavras = (q: string, alvo: string[]): number => alvo.reduce((m, w) => Math.max(m, casarPalavra(q, w)), 0);

interface TermoSinonimo { texto: string; palavras: string[] }
const GRUPOS: TermoSinonimo[][] = SINONIMOS.map((g) => g.map((texto) => ({ texto, palavras: palavras(texto) })));

/** Os termos ligados ao que foi digitado (o digitado pode vir com erro). */
function sinonimosDe(token: string, frase: string): TermoSinonimo[] {
  const achados: TermoSinonimo[] = [];
  for (const grupo of GRUPOS) {
    const liga = grupo.some((t) =>
      t.palavras.length === 1
        ? casarPalavra(token, t.palavras[0]) >= 0.55 && (token.length > 2 || token === t.palavras[0])
        : frase.includes(t.palavras.join(" ")));
    if (liga) achados.push(...grupo);
  }
  return achados;
}

const PESO_SINONIMO = 0.62;
const PESO_GRUPO = 0.3;
const PESO_MODULO = 0.35;

/**
 * Procura e ordena. Toda palavra digitada precisa casar com alguma coisa: quem
 * escreve "solicitar demissão" não quer "Solicitar Férias".
 * `recentes` (rotas, a mais recente primeiro) desempata a favor do que a pessoa já usa.
 */
export function buscarTelas(busca: string, telas: TelaBusca[], recentes: string[] = [], limite = 12): ResultadoBusca[] {
  const todasPalavras = palavras(busca);
  const util = normalizar(busca).split(" ").filter((p) => p && !PALAVRAS_VAZIAS.has(p)).map(sonora);
  const tokens = util.length ? util : todasPalavras;
  if (!tokens.length) return [];
  const frase = tokens.join(" ");
  const buscaInteira = todasPalavras.join(" ");

  const achados: ResultadoBusca[] = [];
  for (const tela of telas) {
    // "e", "de"… do nome não casam com nada (09/11/2026): "HE" vira "e" pelo som
    // e trazia toda tela "X e Y" (as de Indicadores) à frente de Hora Extra.
    const nomeCompleto = palavras(tela.label);
    const nomeUtil = normalizar(tela.label).split(" ").filter((p) => p && !PALAVRAS_VAZIAS.has(p)).map(sonora);
    const nome = nomeUtil.length ? nomeUtil : nomeCompleto;
    const grupo = tela.grupo ? palavras(tela.grupo) : [];
    const modulo = palavras(tela.modulo);
    const nomeInteiro = nomeCompleto.join(" ");

    let soma = 0;
    let faltou = false;
    let porSinonimo: string | undefined;
    for (const q of tokens) {
      // Grupo e módulo só contam sem erro de digitação: "demisao" é parecido com
      // "Decisão", e isso traria todas as telas do grupo Análise & Decisão.
      const semErro = (alvo: string[]) => { const n = melhorNasPalavras(q, alvo); return n >= 0.85 ? n : 0; };
      const direto = Math.max(melhorNasPalavras(q, nome), semErro(grupo) * PESO_GRUPO, semErro(modulo) * PESO_MODULO);
      let viaSinonimo = 0;
      let termo: string | undefined;
      for (const t of sinonimosDe(q, frase)) {
        // O sinônimo tem que estar no NOME: no módulo, traria o módulo inteiro.
        const nota = t.palavras.every((p) => nome.some((w) => casarPalavra(p, w) >= 0.85)) ? PESO_SINONIMO : 0;
        if (nota > viaSinonimo) { viaSinonimo = nota; termo = t.texto; }
      }
      const melhor = Math.max(direto, viaSinonimo);
      if (melhor <= 0) { faltou = true; break; }
      if (viaSinonimo > direto) porSinonimo = termo;
      soma += melhor;
    }
    if (faltou) continue;

    let pontos = soma / tokens.length;
    // Relatório "Demissões" tem o nome exato, mas quem digita o assunto quer a
    // tela de trabalho: relatório fica logo depois dela, sem os bônus de nome.
    if (/^relat/i.test(tela.modulo)) pontos -= 0.45;
    else if (nomeInteiro === buscaInteira || nomeInteiro === frase) pontos += tela.label.trim().includes(" ") ? 1 : 0.05;
    else if (tokens.length > 1 && nomeInteiro.startsWith(frase)) pontos += 0.3;
    // Quem procura um assunto, em geral, quer abrir o pedido dele.
    if (/^solicitar\b/i.test(tela.label)) pontos += 0.06;
    // Depois do pedido, a tela de gestão do assunto; painel é consulta, vem depois.
    else if (/^gest/i.test(normalizar(tela.label))) pontos += 0.04;
    else if (/^dashboard\b/i.test(tela.label)) pontos -= 0.03;
    // Nome curto é mais "a tela do assunto" do que nome que só cita o assunto.
    pontos += 0.04 * Math.min(1, tokens.length / nome.length);
    const usoRecente = recentes.indexOf(tela.to);
    if (usoRecente >= 0) pontos += 0.12 - Math.min(usoRecente, 5) * 0.01;
    achados.push({ ...tela, pontos, porSinonimo });
  }

  achados.sort((a, b) => b.pontos - a.pontos || a.label.localeCompare(b.label, "pt-BR"));

  // A mesma tela em vários módulos (Gestão Recrutamento está em quatro) não
  // pode empurrar as outras para fora: repetidos vão para o fim da lista.
  const vistos = new Set<string>();
  const primeiros: ResultadoBusca[] = [];
  const repetidos: ResultadoBusca[] = [];
  for (const r of achados) {
    (vistos.has(r.label) ? repetidos : primeiros).push(r);
    vistos.add(r.label);
  }
  return [...primeiros, ...repetidos].slice(0, limite);
}

/** Trechos do nome que casaram, para destacar na lista. */
export function trechosDestacados(label: string, busca: string): { texto: string; marcado: boolean }[] {
  const tokens = palavras(busca);
  return label.split(/(\s+)/).filter(Boolean).map((parte) => {
    if (!parte.trim()) return { texto: parte, marcado: false };
    const ps = palavras(parte);
    return { texto: parte, marcado: ps.length > 0 && tokens.some((q) => ps.some((w) => casarPalavra(q, w) >= 0.45)) };
  });
}
