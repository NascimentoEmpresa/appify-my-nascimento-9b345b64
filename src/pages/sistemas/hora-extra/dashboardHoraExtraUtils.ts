// =====================================================================
// DASHBOARD DE HORA EXTRA — regras de leitura dos números.
//
// A RPC `hora_extra_dashboard` devolve só minutos e contagens crus; tudo
// que vira texto, escala de eixo, faixa de efetividade ou insight mora
// aqui, fora do componente, porque é isso que os testes cobrem.
// =====================================================================
import { TIPOS } from "@/pages/chamados/types";
import { formatarDuracao } from "./horaExtraUtils";
import type {
  ColaboradorDashboardHoraExtra,
  DadosDashboardHoraExtra,
  DiaSemanaDashboardHoraExtra,
  InsightDashboardHoraExtra,
  NivelEfetividade,
} from "./types";

/** `extract(isodow)` do Postgres: 1 = segunda ... 7 = domingo. */
export const DIAS_SEMANA: Array<{ dia: number; curto: string; longo: string }> = [
  { dia: 1, curto: "Seg", longo: "Segunda-feira" },
  { dia: 2, curto: "Ter", longo: "Terça-feira" },
  { dia: 3, curto: "Qua", longo: "Quarta-feira" },
  { dia: 4, curto: "Qui", longo: "Quinta-feira" },
  { dia: 5, curto: "Sex", longo: "Sexta-feira" },
  { dia: 6, curto: "Sáb", longo: "Sábado" },
  { dia: 7, curto: "Dom", longo: "Domingo" },
];

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** `2026-09` → `Set/2026`. Sem `Date`: o dia 1 em UTC volta como mês anterior. */
export function rotuloMes(mes: string): string {
  const [ano, numero] = mes.split("-");
  const indice = Number(numero) - 1;
  if (!ano || indice < 0 || indice > 11) return mes;
  return `${MESES_CURTOS[indice]}/${ano}`;
}

/**
 * Rótulo de duração do dashboard: `8h` quando fecha na hora cheia, `8h30`
 * quando não. Vale para o eixo e para o número em cima da barra — o
 * `formatarDuracao` do módulo escreveria "20h00", que polui a leitura de
 * um gráfico inteiro de horas redondas.
 */
export function rotuloHoras(minutos: number): string {
  return minutos % 60 === 0 ? `${Math.round(minutos / 60)}h` : formatarDuracao(minutos, true);
}

// Passos "redondos" em minutos: 15min, 30min, 1h, 2h, 3h, 5h, 10h, 15h,
// 20h, 30h. Um eixo de 7h13 não ajuda ninguém a comparar duas barras.
const PASSOS_ESCALA = [15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800];

/**
 * Marcações do eixo de horas. Sempre sobra ~12% acima da maior barra para
 * o rótulo do valor, que fica fora da barra, não caber em cima da borda
 * do gráfico.
 */
export function escalaHoras(maiorMinutos: number, maxDivisoes = 6): number[] {
  // Piso de 2h: período sem hora extra nenhuma ainda precisa de um eixo
  // legível, e `0h / 0h15 / 0h30` não é um eixo, é ruído.
  const alvo = Math.max(Math.round((Number(maiorMinutos) || 0) * 1.12), 120);
  const passo = PASSOS_ESCALA.find((p) => p * maxDivisoes >= alvo) ?? Math.ceil(alvo / maxDivisoes / 60) * 60;
  const divisoes = Math.max(1, Math.ceil(alvo / passo));
  return Array.from({ length: divisoes + 1 }, (_, i) => i * passo);
}

/**
 * Quebra o rótulo do eixo em até `maxLinhas` linhas. `maxCaracteres` é o
 * que cabe na largura reservada; quando o nome não fecha nesse limite, o
 * limite CRESCE até caber no número de linhas, em vez de cortar o texto —
 * cortar some justamente com o sobrenome que separa duas pessoas do mesmo
 * setor ("Eduardo Jeiel Padilha…" e "Eduardo Jeiel Souza…").
 */
export function quebrarNome(texto: string, maxCaracteres: number, maxLinhas = 2): string[] {
  const palavras = String(texto).trim().split(/\s+/).filter(Boolean);
  if (!palavras.length) return [""];
  const inteiro = palavras.join(" ");
  const linhas = Math.max(1, Math.floor(maxLinhas));
  for (let limite = Math.max(6, Math.floor(maxCaracteres)); limite < inteiro.length; limite += 1) {
    const quebrado = agruparEmLinhas(palavras, limite);
    if (quebrado.length <= linhas) return quebrado;
  }
  return [inteiro];
}

function agruparEmLinhas(palavras: string[], limite: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    if (candidata.length <= limite || !atual) {
      atual = candidata;
    } else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** Variação contra a janela anterior, do jeito que o card mostra. */
export function textoVariacao(variacao?: number | null): { texto: string; tom: "alta" | "baixa" | "neutro" } {
  const valor = Math.round(Number(variacao) || 0);
  if (valor === 0) return { texto: "Sem alteração", tom: "neutro" };
  return {
    texto: `${Math.abs(valor)}% em relação ao mês anterior`,
    tom: valor > 0 ? "alta" : "baixa",
  };
}

export function formatarMoeda(valor?: number | null): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(valor) || 0);
}

export function percentual(parte?: number | null, total?: number | null): number {
  const base = Number(total) || 0;
  if (base <= 0) return 0;
  return Math.round(((Number(parte) || 0) * 100) / base);
}

/**
 * Faixa de efetividade pela média de conclusão dos chamados da pessoa no
 * período. Os cortes são os do desenho aprovado em SIS-2026-0474: 94% para
 * cima é "Muito alta", 88% é "Alta", 75% ainda é "Boa".
 */
export function nivelEfetividade(conclusaoMedia?: number | null): NivelEfetividade {
  const media = Number(conclusaoMedia) || 0;
  if (media >= 94) return { label: "Muito alta", classe: "bg-emerald-100 text-emerald-700" };
  if (media >= 88) return { label: "Alta", classe: "bg-emerald-50 text-emerald-700" };
  if (media >= 75) return { label: "Boa", classe: "bg-blue-100 text-blue-700" };
  return { label: "Regular", classe: "bg-amber-100 text-amber-700" };
}

export function rotuloMotivo(motivo: string): string {
  return TIPOS.find((tipo) => tipo.value === motivo)?.label ?? "Outro";
}

/**
 * Domingo só entra no gráfico de dia da semana quando existe HE nele. O
 * desenho tem seis colunas (Seg–Sáb) e a escala de HE é de dia útil; a
 * sétima aparece só quando escondê-la esconderia hora extra de verdade.
 */
export function seriePorDiaSemana(
  dias: DiaSemanaDashboardHoraExtra[],
): Array<{ dia: number; curto: string; longo: string; minutos: number }> {
  const porDia = new Map(dias.map((item) => [Number(item.dia), Number(item.minutos) || 0]));
  return DIAS_SEMANA.filter((d) => d.dia !== 7 || (porDia.get(7) ?? 0) > 0).map((d) => ({
    ...d,
    minutos: porDia.get(d.dia) ?? 0,
  }));
}

function maiorPor<T>(itens: T[], valor: (item: T) => number): T | undefined {
  return itens.reduce<T | undefined>(
    (melhor, item) => (melhor === undefined || valor(item) > valor(melhor) ? item : melhor),
    undefined,
  );
}

/**
 * Os três destaques do mês. Cada um pode faltar sozinho — período sem
 * chamado nenhum ainda tem "maior volume de HE" —, por isso a lista sai
 * montada item a item e não num bloco só.
 */
export function insightsDashboard(dados?: DadosDashboardHoraExtra | null): InsightDashboardHoraExtra[] {
  if (!dados) return [];
  const insights: InsightDashboardHoraExtra[] = [];

  // "% do total" é sempre sobre a HE aprovada do período — o número do
  // primeiro card. Somar as barras do gráfico daria outro denominador
  // quando a lista for cortada, e aí dois lugares da mesma tela diriam
  // porcentagens diferentes para a mesma pessoa.
  const totalPeriodo =
    Number(dados.indicadores?.aprovadas_min) ||
    dados.por_colaborador.reduce((soma, c) => soma + (Number(c.minutos) || 0), 0);
  const maiorVolume = maiorPor(dados.por_colaborador, (c) => Number(c.minutos) || 0);
  if (maiorVolume && Number(maiorVolume.minutos) > 0) {
    insights.push({
      chave: "volume",
      titulo: "Maior volume de HE",
      destaque: maiorVolume.nome,
      detalhe: `${rotuloHoras(maiorVolume.minutos)} (${percentual(maiorVolume.minutos, totalPeriodo)}% do total)`,
    });
  }

  const comChamados = dados.efetividade.filter((e) => Number(e.chamados) > 0);
  const melhorEfetividade = maiorPor(comChamados, (e) => Number(e.conclusao_media) || 0);
  if (melhorEfetividade && Number(melhorEfetividade.conclusao_media) > 0) {
    insights.push({
      chave: "efetividade",
      titulo: "Melhor efetividade",
      destaque: melhorEfetividade.nome,
      detalhe: `${Math.round(Number(melhorEfetividade.conclusao_media))}% de conclusão média`,
    });
  }

  const dias = seriePorDiaSemana(dados.por_dia_semana);
  const maiorDia = maiorPor(dias, (d) => d.minutos);
  if (maiorDia && maiorDia.minutos > 0) {
    insights.push({
      chave: "dia",
      titulo: "Dia com mais HE",
      destaque: maiorDia.longo,
      detalhe: `${rotuloHoras(maiorDia.minutos)} (${percentual(maiorDia.minutos, totalPeriodo)}% do total)`,
    });
  }

  return insights;
}

/** Linhas da planilha do botão "Exportar Relatório". */
export function linhasExcelDashboard(efetividade: ColaboradorDashboardHoraExtra[]) {
  return efetividade.map((colaborador) => ({
    Colaborador: colaborador.nome,
    "Qtd. HEs": colaborador.qtd,
    "Horas aprovadas": rotuloHoras(colaborador.aprovadas_min),
    "Horas realizadas": rotuloHoras(colaborador.realizadas_min),
    Chamados: colaborador.chamados,
    "Conclusão média": `${Math.round(Number(colaborador.conclusao_media) || 0)}%`,
    Efetividade: nivelEfetividade(colaborador.conclusao_media).label,
  }));
}
