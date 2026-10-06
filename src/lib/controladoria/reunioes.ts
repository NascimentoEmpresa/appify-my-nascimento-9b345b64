// =====================================================================
// CONTROLADORIA › Reuniões com Encarregados (mig 20261006000005)
//
// Pedido (06/10/2026): importar as transcrições das reuniões dos
// supervisores com os encarregados e gerar um dashboard das reclamações e
// dificuldades. Tudo aqui é REGRA, não IA — o texto não sai do ERP:
//   1. normalizarTranscricao: VTT/SRT/Meet/Teams → linhas "Nome: fala";
//   2. separarReunioes: texto colado com várias reuniões (um cabeçalho
//      "Reunião iniciada em…" por reunião) vira uma por cabeçalho;
//   3. lerCabecalho: data e participantes do cabeçalho do Meet;
//   4. extrairFalas: quem falou o quê (continuação de linha junta na fala);
//   5. classificarTrecho: tema por palavras-chave (o que mais pontua) e
//      tipo — dificuldade/reclamação ou dúvida/solicitação; fala sem nenhum
//      dos dois não vira registro;
//   6. levantamento: monta os registros sugeridos, ligando quem falou ao
//      encarregado/contrato pelos vínculos.
// Os registros nascem "pendente" — a tela Revisar é quem confirma.
// =====================================================================

export const TEMAS = [
  "Pessoal, férias e cobertura",
  "Ponto e acesso digital",
  "Vagas, admissões e desligamentos",
  "Pagamentos e benefícios",
  "Compras e manutenção",
  "SST e documentação",
  "Gestão contratual",
  "Fluxos e comunicação",
  "Rotina e contingências",
  "Sobrecarga e agenda",
] as const;
export type Tema = (typeof TEMAS)[number];

export type TipoRegistro = "dificuldade" | "duvida";
export const ROTULO_TIPO: Record<TipoRegistro, string> = { dificuldade: "Dificuldade / reclamação", duvida: "Dúvida / solicitação" };

/** Sem acento, minúsculo, espaços simples — base de toda comparação. */
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

// Palavras-chave por tema, já normalizadas. Raiz curta ("deslig") pega as
// variações; termos curtos demais (rt, vt, va) vão com borda de palavra.
const PALAVRAS: Record<Tema, (string | RegExp)[]> = {
  "Pessoal, férias e cobertura": ["ferias", "cobertura", "cobrir", "faltou", "faltas", "falta de funcionario", "falta de pessoal", "atestado", "folga", "substitu", "afastad", "licenca", "reserva tecnica", "feriado", /\brts?\b/],
  "Ponto e acesso digital": ["ponto", "bater o", "batida", "marcacao", "relogio", "nexti", "aplicativo", /\bapp\b/, "senha", "login", "acesso ao", "sistema", "celular", "espelho", "reconhecimento facial"],
  "Vagas, admissões e desligamentos": ["vaga", "admiss", "admitid", "demiss", "demitid", "deslig", "aviso previo", "recrutamento", "entrevista", "experiencia", "contratar", "pedido de conta", "pediu conta"],
  "Pagamentos e benefícios": ["salario", "pagamento", "holerite", "contracheque", "vale transporte", "vale alimentacao", "vale refeicao", /\bv[tar]\b/, "adiantamento", "beneficio", "hora extra", "horas extras", "desconto", "insalubridade", "plano de saude", "cesta basica", "13o", "decimo terceiro"],
  "Compras e manutenção": ["material", "materiais", "produto", "uniforme", "equipamento", "maquina", "manutencao", "conserto", "consert", "quebrad", "estragad", "compra", "estoque", "carrinho", "mop", "vassoura", "saco de lixo", "papel"],
  "SST e documentação": [/\baso\b/, "exame", "seguranca do trabalho", "acidente", /\bnr ?\d+/, "documento", "documentacao", "treinamento", /\bcat\b/, "laudo", /\bepis?\b/, "bota", "luva"],
  "Gestão contratual": ["fiscal", "contrato", "glosa", "multa", "cliente", "contratante", "prefeitura", "notificacao", "notificad", "ordem de servico", "medicao", "aditivo", "gestor do contrato"],
  "Fluxos e comunicação": ["comunicacao", "whatsapp", "zap", "grupo", "e-mail", "email", "informacao", "informar", "avisar", "avisaram", "retorno", "resposta", "ninguem responde", "nao responde", "ligar", "ligacao", "telefone", "fluxo", "processo", "orientacao"],
  "Rotina e contingências": ["rotina", "escala", "turno", "horario", "plantao", "emergencia", "chuva", "imprevisto", "setor", "posto", "troca de posto", "remanej"],
  "Sobrecarga e agenda": ["sobrecarg", "muita coisa", "demanda", "agenda", "correria", "acumul", "cansad", "sozinh", "retrabalho", "nao da tempo", "sem tempo"],
};

const DIFICULDADE: (string | RegExp)[] = [
  "problema", "dificuldade", "dificil", "nao consig", "nao conseg", "nao tem ", "nao temos", "nao tinha", "falta", "faltando", "atras", "demora",
  "reclam", "ruim", "complicad", "sobrecarg", "nao chegou", "nao veio", "nao funciona", "quebr", "estrag", "nao recebe", "nao pagou", "nao pagaram",
  "erro", "errad", "insatisf", "cobrando", "retrabalho", "nao da ", "impossivel", "preocup", "nao resolve", "nao resolveu", "pessimo", "absurdo", "chateado",
];
const DUVIDA: (string | RegExp)[] = [
  "?", "duvida", "pergunt", "queria saber", "como faz", "como que", "poderia", "precisa", "preciso", "precisamos", "solicit", "pedir", "pedido",
  "gostaria", "tem como", "seria possivel", "orienta",
];

const casa = (t: string, p: string | RegExp) => (typeof p === "string" ? t.includes(p) : p.test(t));

/** Tema (o que mais pontua) e tipo de um trecho; null = não é registro para atenção. */
export function classificarTrecho(trecho: string): { tema: Tema; tipo: TipoRegistro; pontos: number } | null {
  const t = normalizar(trecho);
  if (t.length < 25) return null;
  let melhor: Tema | null = null, pontos = 0;
  for (const tema of TEMAS) {
    const n = PALAVRAS[tema].reduce((s, p) => s + (casa(t, p) ? 1 : 0), 0);
    if (n > pontos) { melhor = tema; pontos = n; }
  }
  if (!melhor) return null;
  const tipo: TipoRegistro | null = DIFICULDADE.some((p) => casa(t, p)) ? "dificuldade" : DUVIDA.some((p) => casa(t, p)) ? "duvida" : null;
  return tipo ? { tema: melhor, tipo, pontos } : null;
}

// ---- Leitura do texto ----------------------------------------------------------

const RE_TEMPO = /^\s*\[?\(?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\)?\]?\s*/;

/**
 * VTT/SRT/Teams → texto "Nome: fala" por linha. Tira cabeçalho WEBVTT,
 * número de legenda, linha de tempo ("00:00:01.000 --> 00:00:04.000"),
 * marca de voz do Teams (<v Nome>fala</v>) e tempo no começo da linha.
 */
export function normalizarTranscricao(texto: string): string {
  return texto
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*WEBVTT/i.test(l) && !/^\s*\d+\s*$/.test(l) && !/-->/.test(l) && !/^\s*NOTE\b/.test(l))
    .map((l) => l.replace(/<v\s+([^>]+)>/gi, "$1: ").replace(/<\/?[^>]+>/g, "").replace(RE_TEMPO, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const RE_INICIO = /reuni[aã]o iniciada em/i;

/** Texto com vários cabeçalhos "Reunião iniciada em…" → uma reunião por cabeçalho. */
export function separarReunioes(texto: string): string[] {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");
  const blocos: string[][] = [];
  for (const l of linhas) {
    if (RE_INICIO.test(l) || blocos.length === 0) blocos.push([]);
    blocos[blocos.length - 1].push(l);
  }
  return blocos.map((b) => b.join("\n").trim()).filter((b) => b.length > 0);
}

/** Data (ISO) e participantes do cabeçalho; o que não achar fica vazio. */
export function lerCabecalho(texto: string): { data: string | null; participantes: string[] } {
  const iso = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  const br = texto.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  const data = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : br ? `${br[3]}-${br[2]}-${br[1]}` : null;
  const linhas = texto.split("\n").map((l) => l.trim());
  const i = linhas.findIndex((l) => /^participantes:?$/i.test(l) || /^participantes:\s*\S/i.test(l));
  let participantes: string[] = [];
  if (i >= 0) {
    const mesma = linhas[i].replace(/^participantes:?\s*/i, "");
    const bloco: string[] = mesma ? [mesma] : [];
    for (let j = i + 1; j < linhas.length && !/^transcri[cç][aã]o/i.test(linhas[j]) && linhas[j] !== ""; j++) bloco.push(linhas[j]);
    participantes = [...new Set(bloco.join(",").split(/[,;]/).map((p) => p.trim()).filter((p) => p.length > 1))];
  }
  return { data, participantes };
}

export interface Fala { falante: string | null; texto: string }

// "Nome Sobrenome: fala" — nome curto, começa com letra, sem ponto final.
const RE_FALA = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]{0,59}?)\s*:\s+(.+)$/;
const NAO_FALANTE = /^(reuni[aã]o|participantes|transcri[cç][aã]o|data|t[ií]tulo|assunto|obs|observa[cç][aã]o|pauta|hor[aá]rio|local|https?)$/i;

/** Quem falou o quê, depois do cabeçalho. Linha sem "Nome:" continua a fala anterior. */
export function extrairFalas(texto: string): Fala[] {
  const linhas = normalizarTranscricao(texto).split("\n");
  const iTrans = linhas.findIndex((l) => /^\s*transcri[cç][aã]o\s*:?\s*$/i.test(l));
  const corpo = iTrans >= 0 ? linhas.slice(iTrans + 1) : linhas;
  const falas: Fala[] = [];
  for (const bruta of corpo) {
    const l = bruta.trim();
    if (!l || RE_INICIO.test(l)) continue;
    const m = l.match(RE_FALA);
    if (m && !NAO_FALANTE.test(m[1].trim()) && m[1].trim().split(" ").length <= 6) {
      falas.push({ falante: m[1].trim(), texto: m[2].trim() });
    } else if (falas.length) {
      falas[falas.length - 1].texto += " " + l;
    } else {
      falas.push({ falante: null, texto: l });
    }
  }
  return falas.filter((f) => f.texto.trim().length > 0);
}

/** Fala comprida vira trechos de até ~3 frases, para o registro não virar um parágrafo inteiro. */
export function trechosDaFala(texto: string, maxChars = 600): string[] {
  if (texto.length <= maxChars) return [texto];
  const frases = texto.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [texto];
  const out: string[] = [];
  let atual = "";
  for (const f of frases) {
    if ((atual + f).length > maxChars && atual) { out.push(atual.trim()); atual = ""; }
    atual += f;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

// ---- Vínculos (nome na transcrição → encarregado + contrato) ---------------------

export interface Vinculo { nome_transcricao: string; encarregado: string; contrato: string | null }

/**
 * Lê a caixa de vínculos. Aceita:
 *   "Nome | Contrato | Nome na transcrição"   (o 3º é opcional)
 *   "Encarregado Nome - Contrato"
 * Linha "Supervisor …" é ignorada (o supervisor tem campo próprio).
 */
export function lerVinculos(texto: string): Vinculo[] {
  const out: Vinculo[] = [];
  for (const bruta of texto.split("\n")) {
    const l = bruta.trim();
    if (!l || /^supervisor\b/i.test(l)) continue;
    if (l.includes("|")) {
      const [nome, contrato, naTranscricao] = l.split("|").map((p) => p.trim());
      if (nome) out.push({ encarregado: nome, contrato: contrato || null, nome_transcricao: naTranscricao || nome });
      continue;
    }
    const m = l.replace(/^encarregad[oa]\s+/i, "").match(/^(.+?)\s+[-–]\s+(.+)$/);
    if (m) out.push({ encarregado: m[1].trim(), contrato: m[2].trim(), nome_transcricao: m[1].trim() });
  }
  return out;
}

/** Acha o vínculo de quem falou: nome igual (sem acento/caixa) ou mesmo primeiro + último nome. */
export function acharVinculo(falante: string | null, vinculos: Vinculo[]): Vinculo | null {
  if (!falante) return null;
  const f = normalizar(falante);
  const exato = vinculos.find((v) => normalizar(v.nome_transcricao) === f || normalizar(v.encarregado) === f);
  if (exato) return exato;
  const pontas = (s: string) => { const p = normalizar(s).split(" "); return p.length > 1 ? `${p[0]} ${p[p.length - 1]}` : p[0]; };
  return vinculos.find((v) => pontas(v.nome_transcricao) === pontas(falante) || pontas(v.encarregado) === pontas(falante)) ?? null;
}

/** O supervisor conduz a reunião — fala dele não é reclamação de encarregado. Compara pelo primeiro nome. */
export function ehSupervisor(falante: string | null, supervisor: string | null | undefined): boolean {
  if (!falante || !supervisor?.trim()) return false;
  const a = normalizar(falante).split(" ")[0], b = normalizar(supervisor).split(" ")[0];
  return a.length > 1 && a === b;
}

// ---- Levantamento ------------------------------------------------------------------

export interface RegistroSugerido {
  ordem: number; falante: string | null; encarregado: string | null; contrato: string | null;
  trecho: string; tema: Tema; tipo: TipoRegistro;
}

/** Os registros sugeridos de uma reunião. */
export function levantamento(texto: string, opcoes: { supervisor?: string | null; contrato?: string | null; vinculos?: Vinculo[] } = {}): RegistroSugerido[] {
  const out: RegistroSugerido[] = [];
  extrairFalas(texto).forEach((fala) => {
    if (ehSupervisor(fala.falante, opcoes.supervisor)) return;
    const v = acharVinculo(fala.falante, opcoes.vinculos ?? []);
    for (const trecho of trechosDaFala(fala.texto)) {
      const c = classificarTrecho(trecho);
      if (!c) continue;
      out.push({
        ordem: out.length + 1, falante: fala.falante, encarregado: v?.encarregado ?? fala.falante,
        contrato: v?.contrato ?? opcoes.contrato?.trim() ?? null, trecho, tema: c.tema, tipo: c.tipo,
      });
    }
  });
  return out;
}

// ---- Dashboard ---------------------------------------------------------------------

export interface RegistroDash { reuniao_id: string; tema: string; tipo: TipoRegistro; status: "pendente" | "validado" | "excluido"; contrato: string | null; encarregado: string | null }

/** Temas por nº de REUNIÕES em que aparecem (uma marca por tema por reunião), como no protótipo. */
export function temasRecorrentes(registros: RegistroDash[], totalReunioes: number) {
  const porTema = new Map<string, Set<string>>();
  for (const r of registros) {
    if (r.status === "excluido") continue;
    if (!porTema.has(r.tema)) porTema.set(r.tema, new Set());
    porTema.get(r.tema)!.add(r.reuniao_id);
  }
  return [...porTema.entries()]
    .map(([tema, s]) => ({ tema, reunioes: s.size, pct: totalReunioes ? Math.round((s.size * 1000) / totalReunioes) / 10 : 0 }))
    .sort((a, b) => b.reunioes - a.reunioes || a.tema.localeCompare(b.tema));
}

/** Contagem por chave (contrato, encarregado…), sem os excluídos. */
export function contarPor<T extends RegistroDash>(registros: T[], chave: (r: T) => string | null, vazio = "(não informado)") {
  const m = new Map<string, number>();
  for (const r of registros) {
    if (r.status === "excluido") continue;
    const k = chave(r)?.trim() || vazio;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome));
}
