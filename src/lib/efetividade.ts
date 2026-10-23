// =====================================================================
// OPERACIONAL › EFETIVIDADE E COBERTURAS — quem foi trabalhar e quem faltou,
// dia a dia, pelas batidas da Senior (RPC ope_efet_base, mig
// 20261008000030). Lógica pura, testada em src/test/efetividade.test.ts.
//
// A REGRA DE UM DIA DE UM COLABORADOR (em ordem):
//   1. Fora do contrato (antes da admissão / depois do desligamento) → some.
//   2. Bateu ponto na jornada do dia → PRESENTE (mesmo afastado ou de folga:
//      quem bateu, trabalhou).
//   3. Afastado nesse dia (Situação ≠ Trabalhando desde "Data Afastamento")
//      → FÉRIAS, ATESTADO ou AFASTAMENTO (auxílio-doença, licença, cárcere).
//   4. Nenhuma batida em 14 dias para trás → SEM REGISTRO: não usa o relógio
//      (ADM, estagiário, ponto por outro meio). Medido em 08/10/2026: 273 dos
//      2.216 "Trabalhando". Chamar essa gente de faltosa todo dia afogaria as
//      faltas de verdade — fica num contador à parte.
//   5. Dia depois do último sincronizado → AGUARDANDO (o ponto ainda não chegou).
//      HOJE também é AGUARDANDO até o meio-dia (20/10/2026, pedido do Pablo):
//      o espelho roda de 10 em 10 min, então "sincronizado até hoje" já vale
//      às 07:00 — mas a Senior importa as batidas com atraso, e todo mundo
//      que entrou às 7h aparecia como falta na primeira hora. Falta de hoje
//      só depois das 12h (e de 1h após a entrada da escala, para o turno da
//      tarde/noite não virar falta antes de começar). Rótulo na tela:
//      "Aguardando apuração total dos pontos da Senior".
//   6. A escala diz se o dia era de trabalho:
//        · fixa (SEG-SEX, +SÁB): dia útil da semana; feriado nacional não;
//        · 12x36: paridade com o último dia trabalhado (trabalha em dias
//          alternados — 2, 4, 6 dias depois da última batida);
//        · outro revezamento (6x1, SAMU): uma folga por semana, então só o
//          SEGUNDO dia seguido sem batida é falta; o primeiro é folga.
//      Dia de trabalho sem batida → FALTA; senão → FOLGA (ou FERIADO).
//   7. UMA batida no dia do calendário basta para não ser falta (20/10/2026,
//      pedido do Pablo: "se a pessoa marcou 1x no dia já não é falta"). O
//      agrupamento por jornada pode levar a batida para o dia vizinho (saída
//      da madrugada do noturno, entrada às 23h de quem começa à meia-noite) e
//      deixar o dia vazio; antes de chamar de falta, olha o dia cru.
//
// EFETIVO PREVISTO = presentes + faltas + atestados (quem a escala esperava).
// Ficam FORA: férias (ausência planejada) e, desde 22/10/2026, o AFASTAMENTO
// longo (INSS, auxílio-doença, licença, cárcere). Pedido do Pablo: na UFRGS
// Limpeza (047/2022) o painel dizia 342 previstos com 313 Trabalhando e 303
// postos — os 29 afastados têm substituto no posto, que já está nos 313;
// contar os dois inflava o previsto e derrubava a efetividade. O afastamento
// continua contado e listado (Afastamentos), só não entra na conta.
// EFETIVIDADE = presentes ÷ previsto (sem os aguardando apuração).
// AGUARDANDO APURAÇÃO: enquanto a maior parte do previsto ainda não tem ponto
// (manhã de hoje, antes de a Senior importar) ou ninguém tem batida ainda, a
// efetividade não é medida — 0% às 10h só dizia "a Flex ainda não mandou".
// POSTO DESCOBERTO = falta ou atestado do dia sem cobertura em andamento ou
// concluída (afastamento longo costuma ter substituto fixo — entra na lista,
// mas só conta como descoberto se alguém registrou a ocorrência).
// =====================================================================

import { agruparPorJornada, feriadosNacionais, interpretarEscala, type Batida, type EscalaSenior, type Jornada } from "@/lib/gestaoPonto";

// ---- O que a RPC devolve ---------------------------------------------------------

export interface EncarregadoEfet { id: number; nome: string; telefone: string | null }

export interface ContratoEfet {
  empresa: number;
  filial: number;
  nome: string;
  empresa_nome: string | null;
  ativos: number;
  endereco: string | null;
  cep: string | null;
  encarregados: EncarregadoEfet[];
}

export interface ColaboradorEfet {
  id: number;
  empresa: number;
  filial: number;
  contrato: string;
  cadastro: number | string | null;
  nome: string;
  cargo: string | null;
  situacao: string | null;
  admissao: string | null;          // AAAA-MM-DD
  data_afastamento: string | null;  // início do afastamento atual / desligamento
  posto_codigo: string | null;
  posto_nome: string;
  telefone: string | null;
  escala: EscalaSenior;
  dias: [string, number[]][];       // [dia, minutos do dia]
}

export interface BaseEfet {
  disponivel: boolean;
  motivo?: string;
  inicio: string;
  fim: string;
  sincronizado_ate: string | null;
  ultima_sincronizacao: string | null;
  gerado_em: string;
  contratos: ContratoEfet[];
  colaboradores: ColaboradorEfet[];
}

export type StatusCobertura =
  | "sem_cobertura" | "acionado" | "aceita" | "em_deslocamento" | "aguardando_ponto"
  | "ponto_confirmado" | "nao_realizada" | "nao_se_aplica" | "cancelada";

export type MotivoOcorrencia = "falta" | "atestado" | "afastamento" | "ferias" | "folga" | "outros";

export interface Ocorrencia {
  id: number;
  data: string;
  empresa: number | null;
  filial: number | null;
  contrato: string | null;
  posto_codigo: string | null;
  posto_nome: string | null;
  turno: string | null;
  horario_previsto: number | null;
  empregado_id: number | null;
  empregado_nome: string | null;
  motivo: MotivoOcorrencia;
  origem: "ponto" | "manual";
  substituto_tipo: "diarista" | "colaborador" | null;
  substituto_empregado_id: number | null;
  substituto_diarista_id: number | null;
  substituto_nome: string | null;
  substituto_telefone: string | null;
  status: StatusCobertura;
  acionado_em: string | null;
  aceito_em: string | null;
  deslocamento_em: string | null;
  chegada_em: string | null;
  ponto_em: string | null;
  encerrado_em: string | null;
  acionado_por_nome: string | null;
  observacao: string | null;
  created_by_nome: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventoOcorrencia {
  id: number;
  ocorrencia_id: number;
  tipo: string;
  descricao: string | null;
  autor_nome: string | null;
  created_at: string;
}

export interface Diarista {
  id: number;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  cidade: string | null;
  regioes: string | null;
  disponivel: boolean;
  ativo: boolean;
  observacao: string | null;
  origem: string;
  chamados: number;
  aceitos: number;
  recusas: number;
  confirmados: number;
  em_aberto: number;
  diarias: number;
  ultima_diaria: string | null;
  ultimo_contrato: string | null;
}

// ---- Situação do dia ------------------------------------------------------------

export type SituacaoEfet =
  | "presente" | "falta" | "atestado" | "afastamento" | "ferias"
  | "folga" | "feriado" | "aguardando" | "sem_registro" | "fora_contrato";

export type Turno = "manha" | "tarde" | "noite" | "flexivel";

export interface DiaEfet {
  data: string;
  situacao: SituacaoEfet;
  /** A escala esperava a pessoa (entra no efetivo previsto). */
  previsto: boolean;
  /** Batidas do dia de jornada (minutos ajustados: saída após meia-noite = +1440). */
  batidas: number[];
  /** Primeira batida (entrada). */
  entrada: number | null;
  /** Entrada prevista pela escala. */
  horarioPrevisto: number | null;
  /** Minutos de atraso além da tolerância (10 min). */
  atraso: number;
}

export const AUSENCIAS: SituacaoEfet[] = ["falta", "atestado", "afastamento"];
/** Ausência que deixa o posto descoberto no dia, se ninguém cobrir. */
export const AUSENCIA_A_COBRIR: SituacaoEfet[] = ["falta", "atestado"];
const JANELA_CICLO = 14;
const TOLERANCIA = 10;
/** Antes disto (hora de Brasília), dia de hoje sem batida não é falta: o ponto chega com atraso. */
export const FALTA_SO_DEPOIS_DE = 12 * 60;
/** E nem antes de passar este tanto da entrada prevista (turno da tarde/noite). */
const FOLGA_APOS_ENTRADA = 60;

// O formatador é criado UMA vez e o resultado fica guardado pelo minuto
// (21/10/2026): avaliarDia chama isto para cada pessoa × dia, e criar um
// Intl.DateTimeFormat por chamada levava 5,5 s para avaliar um mês da
// empresa toda (2.400 pessoas × 30 dias) na Efetividade Mensal.
let fmtBrasilia: Intl.DateTimeFormat | null = null;
let ultimoBrasilia: { minutoUtc: number; r: { data: string; minuto: number } } | null = null;

/** Data (AAAA-MM-DD) e minuto do dia no horário de Brasília — a regra do meio-dia é de lá. */
export function agoraBrasilia(agora: Date = new Date()): { data: string; minuto: number } {
  const minutoUtc = Math.floor(agora.getTime() / 60_000);
  if (ultimoBrasilia?.minutoUtc === minutoUtc) return { ...ultimoBrasilia.r };
  fmtBrasilia ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = fmtBrasilia.formatToParts(agora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const r = { data: `${v("year")}-${v("month")}-${v("day")}`, minuto: +v("hour") * 60 + +v("minute") };
  ultimoBrasilia = { minutoUtc, r };
  return { ...r };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const somaDias = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
export const difDias = (a: string, b: string) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86_400_000);
const diaSemana = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();

/** Situação da EMPREGADOS → motivo da ausência (null = trabalhando ou desligado). */
export function motivoDaSituacao(situacao: string | null | undefined): "ferias" | "atestado" | "afastamento" | null {
  const s = (situacao ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  if (!s || s === "TRABALHANDO" || /DEMIT|DESLIG|RESCIS|APOSENT/.test(s)) return null;
  if (/FERIAS/.test(s)) return "ferias";
  if (/ATESTADO/.test(s)) return "atestado";
  return "afastamento";
}

export const desligado = (situacao: string | null | undefined) =>
  /DEMIT|DESLIG|RESCIS|APOSENT/i.test(situacao ?? "");

export function turnoDaJornada(j: Pick<Jornada, "inicio" | "flexivel">): Turno {
  if (j.inicio == null || j.flexivel) return "flexivel";
  if (j.inicio >= 4 * 60 && j.inicio < 12 * 60) return "manha";
  if (j.inicio >= 12 * 60 && j.inicio < 18 * 60) return "tarde";
  return "noite";
}

export const ROTULO_TURNO: Record<Turno, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite", flexivel: "Flexível" };

/** O colaborador pré-processado uma vez (escala + batidas por dia de jornada). */
export interface ColaboradorPrep {
  c: ColaboradorEfet;
  jornada: Jornada;
  turno: Turno;
  porDia: Map<string, number[]>;
  /** Batidas pelo dia do CALENDÁRIO, sem agrupar por jornada (regra 7). */
  brutoPorDia: Map<string, number[]>;
  /** Dias com batida, ordenados. */
  diasTrabalhados: string[];
  motivo: ReturnType<typeof motivoDaSituacao>;
}

export function prepararColaborador(c: ColaboradorEfet): ColaboradorPrep {
  const jornada = interpretarEscala(c.escala ?? { descricao: null, h_semana: null });
  const batidas: Batida[] = [];
  const brutoPorDia = new Map<string, number[]>();
  for (const [dia, mins] of c.dias ?? []) {
    for (const m of mins ?? []) batidas.push([dia, m]);
    if (mins?.length) brutoPorDia.set(dia, [...mins].sort((a, b) => a - b));
  }
  const porDia = agruparPorJornada(batidas, jornada);
  const diasTrabalhados = [...porDia.entries()].filter(([, l]) => l.length > 0).map(([d]) => d).sort();
  return { c, jornada, turno: turnoDaJornada(jornada), porDia, brutoPorDia, diasTrabalhados, motivo: motivoDaSituacao(c.situacao) };
}

const feriadosCache = new Map<number, Map<string, string>>();
const feriado = (d: string) => {
  const ano = +d.slice(0, 4);
  if (!feriadosCache.has(ano)) feriadosCache.set(ano, feriadosNacionais(ano));
  return feriadosCache.get(ano)!.get(d) ?? null;
};

/** Último dia trabalhado ANTES de `data`, dentro da janela. */
function ultimoTrabalhadoAntes(p: ColaboradorPrep, data: string, janela = JANELA_CICLO): string | null {
  const limite = somaDias(data, -janela);
  for (let i = p.diasTrabalhados.length - 1; i >= 0; i--) {
    const d = p.diasTrabalhados[i];
    if (d >= data) continue;
    return d >= limite ? d : null;
  }
  return null;
}

/** A escala esperava trabalho neste dia? (sem olhar batida do próprio dia) */
export function diaDeTrabalho(p: ColaboradorPrep, data: string): boolean {
  const j = p.jornada;
  if (j.escala12x36) {
    const ult = ultimoTrabalhadoAntes(p, data);
    return ult != null && difDias(data, ult) % 2 === 0;
  }
  if (j.revezamento) {
    // Uma folga por semana: falta só se a véspera também ficou sem batida.
    const vespera = somaDias(data, -1);
    return !(p.porDia.get(vespera)?.length) && ultimoTrabalhadoAntes(p, data) != null && ultimoTrabalhadoAntes(p, data)! < vespera;
  }
  if (feriado(data)) return false;
  const dow = diaSemana(data);
  if (dow >= 1 && dow <= 5) return true;
  return dow === 6 && j.sabado;
}

/**
 * Hoje, ainda cedo demais para chamar de falta? (regra 5) — antes do meio-dia
 * ou antes de 1h depois da entrada prevista, no horário de Brasília.
 */
export function cedoParaFalta(p: ColaboradorPrep, data: string, agora: Date = new Date()): boolean {
  const { data: hoje, minuto } = agoraBrasilia(agora);
  if (data !== hoje) return data > hoje;
  if (minuto < FALTA_SO_DEPOIS_DE) return true;
  const j = p.jornada;
  return !j.flexivel && j.inicio != null && j.inicio >= 0 && minuto < j.inicio + FOLGA_APOS_ENTRADA;
}

export function avaliarDia(p: ColaboradorPrep, data: string, sincronizadoAte: string | null, agora: Date = new Date()): DiaEfet {
  const { c, jornada: j } = p;
  const base = { data, batidas: [] as number[], entrada: null as number | null, horarioPrevisto: j.inicio, atraso: 0 };
  const saiu = desligado(c.situacao) && !!c.data_afastamento && data > c.data_afastamento;
  if ((c.admissao && data < c.admissao) || saiu) return { ...base, situacao: "fora_contrato", previsto: false };

  const batidas = p.porDia.get(data) ?? [];
  if (batidas.length) {
    const entrada = batidas[0];
    const atraso = !j.flexivel && j.inicio != null ? Math.max(0, entrada - j.inicio - TOLERANCIA) : 0;
    return { ...base, batidas, entrada, atraso: atraso > 6 * 60 ? 0 : atraso, situacao: "presente", previsto: true };
  }

  if (p.motivo && c.data_afastamento && data >= c.data_afastamento) {
    // Só o atestado (ausência curta, a cobrir) entra no previsto; férias e
    // afastamento longo, não (22/10/2026 — ver o cabeçalho).
    return { ...base, situacao: p.motivo, previsto: p.motivo === "atestado" };
  }

  const trabalhouNaJanela = p.diasTrabalhados.some((d) => d < data && d >= somaDias(data, -JANELA_CICLO));
  if (!trabalhouNaJanela) return { ...base, situacao: "sem_registro", previsto: false };

  const deTrabalho = diaDeTrabalho(p, data);
  if (!sincronizadoAte || data > sincronizadoAte || cedoParaFalta(p, data, agora)) {
    return { ...base, situacao: deTrabalho ? "aguardando" : "folga", previsto: deTrabalho };
  }
  if (deTrabalho) {
    // Regra 7: bateu ao menos uma vez neste dia do calendário → não é falta.
    const cru = p.brutoPorDia.get(data);
    if (cru?.length) return { ...base, batidas: cru, entrada: cru[0], situacao: "presente", previsto: true };
    return { ...base, situacao: "falta", previsto: true };
  }
  return { ...base, situacao: !j.revezamento && feriado(data) ? "feriado" : "folga", previsto: false };
}

// ---- Coberturas ------------------------------------------------------------------

export const COBERTURA_EM_ANDAMENTO: StatusCobertura[] = ["acionado", "aceita", "em_deslocamento", "aguardando_ponto"];
export const COBERTURA_OK: StatusCobertura[] = ["ponto_confirmado"];

export type EstadoCobertura = "coberto" | "em_andamento" | "descoberto" | "dispensado";

export function estadoCobertura(o: Pick<Ocorrencia, "status"> | null | undefined): EstadoCobertura {
  if (!o) return "descoberto";
  if (COBERTURA_OK.includes(o.status)) return "coberto";
  if (COBERTURA_EM_ANDAMENTO.includes(o.status)) return "em_andamento";
  if (o.status === "nao_se_aplica" || o.status === "cancelada") return "dispensado";
  return "descoberto";
}

export const ROTULO_STATUS: Record<StatusCobertura, string> = {
  sem_cobertura: "Sem cobertura",
  acionado: "Substituto acionado",
  aceita: "Cobertura aceita",
  em_deslocamento: "Em deslocamento",
  aguardando_ponto: "Aguardando ponto",
  ponto_confirmado: "Ponto confirmado",
  nao_realizada: "Não realizada",
  nao_se_aplica: "Não se aplica",
  cancelada: "Cancelada",
};

export const ROTULO_SITUACAO: Record<SituacaoEfet, string> = {
  presente: "Presente", falta: "Falta", atestado: "Atestado", afastamento: "Afastamento",
  ferias: "Férias", folga: "Folga", feriado: "Feriado", aguardando: "Aguardando apuração total dos pontos da Senior",
  sem_registro: "Sem registro de ponto", fora_contrato: "Fora do contrato",
};

export const ROTULO_MOTIVO: Record<MotivoOcorrencia, string> = {
  falta: "Falta", atestado: "Atestado", afastamento: "Afastamento", ferias: "Férias", folga: "Folga", outros: "Outros",
};

// ---- Agregações ------------------------------------------------------------------

export interface Resumo {
  previsto: number; presentes: number; faltas: number; atestados: number; afastamentos: number;
  ferias: number; folgas: number; aguardando: number; semRegistro: number; atrasos: number;
  /** presentes ÷ previsto (0–1); null sem previsto ou aguardando apuração. */
  efetividade: number | null;
  /** O ponto do recorte ainda não chegou o bastante para medir (ver fecharResumo). */
  aguardandoApuracao: boolean;
}

export const RESUMO_VAZIO: Resumo = {
  previsto: 0, presentes: 0, faltas: 0, atestados: 0, afastamentos: 0, ferias: 0, folgas: 0, aguardando: 0, semRegistro: 0, atrasos: 0,
  efetividade: null, aguardandoApuracao: false,
};

/**
 * Fecha previsto, efetividade e "aguardando apuração" a partir das contagens
 * — a MESMA conta para um dia (resumir), para a soma de dias/contratos
 * (Efetividade Mensal, semanas do Histórico) e para o Excel.
 *
 * Aguardando apuração = há gente aguardando E (ninguém presente ainda OU os
 * aguardando são metade ou mais do previsto). De manhã, antes de a Senior
 * importar, é o dia inteiro; à tarde sobra só o turno da noite e a
 * efetividade já aparece; num mês fechado os aguardando são zero.
 */
export function fecharResumo<T extends Resumo>(r: T): T {
  // Presente na folga não infla o previsto além de quem a escala esperava:
  // conta como presente E previsto (trabalhou, está no posto).
  r.previsto = r.presentes + r.faltas + r.atestados + r.aguardando;
  const base = r.previsto - r.aguardando;
  r.aguardandoApuracao = r.aguardando > 0 && (r.presentes === 0 || r.aguardando * 2 >= r.previsto);
  r.efetividade = !r.aguardandoApuracao && base > 0 ? r.presentes / base : null;
  return r;
}

export function resumir(dias: DiaEfet[]): Resumo {
  const r: Resumo = { ...RESUMO_VAZIO };
  for (const d of dias) {
    if (d.situacao === "presente") { r.presentes++; if (d.atraso > 0) r.atrasos++; }
    else if (d.situacao === "falta") r.faltas++;
    else if (d.situacao === "atestado") r.atestados++;
    else if (d.situacao === "afastamento") r.afastamentos++;
    else if (d.situacao === "ferias") r.ferias++;
    else if (d.situacao === "folga" || d.situacao === "feriado") r.folgas++;
    else if (d.situacao === "aguardando") r.aguardando++;
    else if (d.situacao === "sem_registro") r.semRegistro++;
  }
  return fecharResumo(r);
}

export const chaveContrato = (empresa: number | null | undefined, filial: number | null | undefined) => `${empresa ?? ""}-${filial ?? ""}`;
export const chavePosto = (c: Pick<ColaboradorEfet, "empresa" | "filial" | "posto_codigo" | "posto_nome">) =>
  `${c.empresa}-${c.filial}-${c.posto_codigo || c.posto_nome}`;

/** Linha da avaliação: colaborador + o dia + a ocorrência de cobertura (se houver). */
export interface LinhaDia {
  p: ColaboradorPrep;
  dia: DiaEfet;
  ocorrencia: Ocorrencia | null;
  cobertura: EstadoCobertura | null;   // só para ausências
}

export function avaliarTodos(preps: ColaboradorPrep[], data: string, sincronizadoAte: string | null, ocorrencias: Ocorrencia[]): LinhaDia[] {
  const porEmp = new Map<number, Ocorrencia>();
  for (const o of ocorrencias) if (o.data === data && o.empregado_id != null) porEmp.set(o.empregado_id, o);
  return preps.map((p) => {
    const dia = avaliarDia(p, data, sincronizadoAte);
    const ocorrencia = porEmp.get(p.c.id) ?? null;
    // Falta avisada à mão para hoje (ponto ainda não chegou): vira ausência.
    if (ocorrencia && (dia.situacao === "aguardando" || dia.situacao === "folga" || dia.situacao === "sem_registro")
        && ocorrencia.status !== "cancelada") {
      const sit: SituacaoEfet = ocorrencia.motivo === "atestado" ? "atestado"
        : ocorrencia.motivo === "afastamento" ? "afastamento"
        : ocorrencia.motivo === "ferias" ? "ferias" : ocorrencia.motivo === "folga" ? "folga" : "falta";
      dia.situacao = sit;
      dia.previsto = sit === "falta" || sit === "atestado";
    }
    const ausente = AUSENCIAS.includes(dia.situacao);
    return { p, dia, ocorrencia, cobertura: ausente ? estadoCobertura(ocorrencia) : null };
  });
}

/** Ausência que conta como posto descoberto. */
export const descoberto = (l: LinhaDia) =>
  l.cobertura === "descoberto" && (AUSENCIA_A_COBRIR.includes(l.dia.situacao) || !!l.ocorrencia);

export interface ResumoGrupo extends Resumo {
  chave: string;
  coberturas: number;      // ponto confirmado
  emAndamento: number;
  descobertos: number;
  linhas: LinhaDia[];
}

export function agrupar(linhas: LinhaDia[], chave: (l: LinhaDia) => string): Map<string, ResumoGrupo> {
  const m = new Map<string, LinhaDia[]>();
  for (const l of linhas) {
    const k = chave(l);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(l);
  }
  const out = new Map<string, ResumoGrupo>();
  m.forEach((ls, k) => out.set(k, {
    ...resumir(ls.map((l) => l.dia)),
    chave: k,
    coberturas: ls.filter((l) => l.cobertura === "coberto").length,
    emAndamento: ls.filter((l) => l.cobertura === "em_andamento").length,
    descobertos: ls.filter(descoberto).length,
    linhas: ls,
  }));
  return out;
}

export type StatusContrato = "normal" | "atencao" | "critico";

/** Normal ≥ 95% e nenhum descoberto; crítico < 91% ou 5+ descobertos. */
export function statusContrato(g: Pick<ResumoGrupo, "efetividade" | "descobertos">): StatusContrato {
  const ef = g.efetividade ?? 1;
  if (ef < 0.91 || g.descobertos >= 5) return "critico";
  if (ef < 0.95 || g.descobertos > 0) return "atencao";
  return "normal";
}

// ---- Período (histórico) -------------------------------------------------------

export function diasEntre(ini: string, fim: string): string[] {
  const out: string[] = [];
  for (let d = ini; d <= fim; d = somaDias(d, 1)) out.push(d);
  return out;
}

export interface PontoSerie extends Resumo { data: string }

/** Uma linha por dia do período, até o último dia sincronizado. */
export function serieDiaria(preps: ColaboradorPrep[], ini: string, fim: string, sincronizadoAte: string | null): PontoSerie[] {
  const ate = sincronizadoAte && sincronizadoAte < fim ? sincronizadoAte : fim;
  return diasEntre(ini, ate).map((data) => ({ data, ...resumir(preps.map((p) => avaliarDia(p, data, sincronizadoAte))) }));
}

// ---- Formatação ----------------------------------------------------------------

export const pct = (v: number | null | undefined, casas = 1) =>
  v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

/** 420 → "07:00"; 1500 → "01:00 (+1)"; −5 → "23:55 (−1)". */
export function fmtMin(min: number | null | undefined): string {
  if (min == null) return "—";
  const dias = Math.floor(min / 1440);
  const m = ((min % 1440) + 1440) % 1440;
  const txt = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return dias > 0 ? `${txt} (+${dias})` : dias < 0 ? `${txt} (−1)` : txt;
}

/** Duração em minutos → "2h 15min" / "45 min". */
export function fmtDuracao(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const a = Math.max(0, Math.round(min));
  if (a < 60) return `${a} min`;
  const h = Math.floor(a / 60), r = a % 60;
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return r ? `${h}h ${String(r).padStart(2, "0")}min` : `${h}h`;
}

export const fmtDataBR = (d: string | null | undefined) => (d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—");
export const fmtHoraTs = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";

/** Minutos entre dois instantes (null se faltar um). */
export const minutosEntre = (a: string | null | undefined, b: string | null | undefined) =>
  a && b ? (Date.parse(b) - Date.parse(a)) / 60_000 : null;

/**
 * Tempo sem cobertura de uma ausência: da entrada prevista (no dia) até a
 * cobertura confirmada — ou até agora, se ainda aberta. Só faz sentido no dia
 * corrente; dia passado sem cobertura devolve null (a tela mostra "dia
 * encerrado", não "53h sem cobertura").
 */
export function tempoSemCobertura(data: string, horarioPrevisto: number | null, o: Pick<Ocorrencia, "status" | "chegada_em" | "ponto_em" | "created_at"> | null, agora = new Date()): number | null {
  const hoje = iso(new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000));
  const inicio = horarioPrevisto != null
    ? new Date(`${data}T00:00:00`).getTime() + horarioPrevisto * 60_000
    : o ? Date.parse(o.created_at) : null;
  if (inicio == null) return null;
  const fimTs = o?.chegada_em ?? o?.ponto_em;
  if (fimTs) return Math.max(0, (Date.parse(fimTs) - inicio) / 60_000);
  if (data !== hoje) return null;
  return Math.max(0, (agora.getTime() - inicio) / 60_000);
}

/** Link de WhatsApp a partir de um telefone brasileiro qualquer. */
export function linkWhatsapp(tel: string | null | undefined): string | null {
  const d = (tel ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith("55") && d.length >= 12 ? d : `55${d}`}`;
}
export const linkTel = (tel: string | null | undefined) => {
  const d = (tel ?? "").replace(/\D/g, "");
  return d.length >= 8 ? `tel:${d}` : null;
};

export function baixarCsv(nome: string, linhas: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(["﻿" + linhas.map((l) => l.map(esc).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
