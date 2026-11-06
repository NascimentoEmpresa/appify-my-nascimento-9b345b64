// Peças pequenas da Bonificação Coletiva: o "i" de ajuda (textos do
// protótipo), a barra de critério e o cartão de indicador.
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Textos de ajuda — os mesmos do protótipo, ajustados aos dados reais. */
export const AJUDA = {
  abaEquipe: "Visão geral do desempenho coletivo, com médias dos cinco critérios e estimativa da bonificação.",
  abaIndividual: "Permite comparar os indicadores e notas de cada desenvolvedor. As notas individuais não alteram o valor recebido na bonificação coletiva.",
  abaTarefas: "Mostra cada entrega individual e a composição de sua nota em qualidade, satisfação, prazo, dificuldade e valor.",
  abaBonificacao: "A verba é liberada conforme a nota média da equipe e dividida em partes iguais entre os participantes do período.",
  abaRegras: "Configura a importância percentual de cada critério na nota final. A soma dos cinco pesos deve ser 100%.",
  periodo: "Filtra entregas pelo mês de conclusão do chamado. A bonificação coletiva é apurada para o mês selecionado.",
  desenvolvedor: "Filtra os detalhes e gráficos exibidos. Esse filtro não modifica a nota coletiva usada para calcular a verba do período.",
  csv: "Exporta as entregas e notas para uma planilha CSV, que pode ser aberta no Excel.",
  entregas: "Número de chamados concluídos no período e no filtro selecionados.",
  notaFinal: "Nota ponderada de 0 a 100, calculada com os cinco critérios conforme seus pesos configuráveis.",
  notaColetiva: "Nota média ponderada das tarefas da equipe no período. É essa nota que define o percentual da verba liberada.",
  qualidadeSemAjustes: "Percentual de entregas que atenderam ao solicitado sem precisar de correções ou retrabalho.",
  satisfacaoMedia: "Média das notas de 1 a 5 atribuídas pelos solicitantes na avaliação do chamado.",
  noPrazo: "Percentual de tarefas concluídas até a data limite registrada no chamado.",
  mercadoIa: "Soma dos valores estimados pela Inteligência Artificial (IA) a partir do escopo das tarefas e de referências de preços do mercado de desenvolvimento de software. É uma estimativa, não economia comprovada.",
  qualidade: "Mede se o trabalho atendeu ao pedido e se exigiu correções. Quanto menos ajustes necessários, maior a nota. Sem avaliação do gestor, a sugestão é “atendeu sem ajuste”: reabrir o chamado não conta como erro, porque o solicitante pode reabrir sem querer ou para pedir mais coisa.",
  satisfacao: "Converte a avaliação do solicitante (1 a 5) em nota de 0 a 100 para compor o resultado.",
  prazo: "Compara a data prometida e a data efetiva de conclusão; concluir depois do limite zera o critério.",
  dificuldade: "A IA classifica a complexidade (1 a 5 no parecer do chamado), ajustável pelo gestor: fácil, médio, difícil ou muito difícil. Os pontos de cada nível são definidos pela empresa em Pesos e regras, e não são uma nota dada pela IA.",
  valor: "Valor da tarefa estimado pela IA com base no escopo e em referências de mercado. Toda entrega vale no mínimo 50; o valor de mercado só diferencia de 50 a 100, comparado com a régua do mês (percentil 75 das entregas do período); não é pagamento nem economia comprovada.",
  composicao: "Mostra quantos pontos cada critério contribuiu para a nota consolidada da equipe.",
  resultadoCriterios: "Médias dos cinco critérios de todas as tarefas consideradas, antes de aplicar os pesos da nota final.",
  porDev: "Comparativo de entregas e notas individuais. Útil para gestão, sem alterar a cota igualitária.",
  verba: "Valor total reservado para bonificação no período, antes do efeito da nota coletiva.",
  liberado: "Verba máxima multiplicada pela nota consolidada da equipe dividida por 100.",
  saldo: "Diferença entre verba máxima e montante liberado. Esse saldo não é redistribuído.",
  cota: "Valor liberado à equipe dividido igualmente pelo número de participantes que possuem entregas no período.",
  participantes: "Quantidade de desenvolvedores com ao menos uma entrega concluída no período.",
  freelancer: "Estimativa de preço para executar a tarefa por profissional autônomo (PJ).",
  clt: "Estimativa do custo da execução por profissional contratado em regime CLT, sob as premissas utilizadas.",
  pontosPerdidos: "Diferença entre a pontuação máxima possível do critério e os pontos efetivamente obtidos.",
  peso: "Participação percentual desse critério na nota final. A soma de todos os pesos é 100%.",
  referencia: "A régua do critério Valor é o percentil 75 do valor de mercado das entregas do mês. Esta referência fixa só vale em mês com menos de 3 entregas com valor da IA.",
  fechamento: "Fechar o período guarda a foto do resultado e trava a verba, a configuração e as avaliações das entregas do mês. Reabrir descarta a foto.",
  pendencias: "Entregas com algum critério sem dado. O critério sem dado fica fora da média e os pesos dos demais são redistribuídos — complete antes de fechar o período.",
} as const;

export function Ajuda({ texto, className }: { texto: string; className?: string }) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Informações: ${texto.slice(0, 60)}`}
          className={cn("ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden", className)}
          onClick={(e) => e.preventDefault()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{texto}</TooltipContent>
    </Tooltip>
  );
}

export function Titulo({ children, ajuda, className }: { children: ReactNode; ajuda?: string; className?: string }) {
  return (
    <h2 className={cn("mb-3 flex items-center text-base font-semibold", className)}>
      {children}
      {ajuda && <Ajuda texto={ajuda} />}
    </h2>
  );
}

const TONS = {
  azul: "text-primary",
  verde: "text-success",
  ambar: "text-warning",
  violeta: "text-violet-600 dark:text-violet-400",
} as const;

export function Kpi({ rotulo, valor, tom = "azul", ajuda, detalhe }: {
  rotulo: string; valor: ReactNode; tom?: keyof typeof TONS; ajuda?: string; detalhe?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center text-xs text-muted-foreground">{rotulo}{ajuda && <Ajuda texto={ajuda} />}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", TONS[tom])}>{valor}</div>
      {detalhe && <div className="mt-1 text-[11px] text-muted-foreground">{detalhe}</div>}
    </Card>
  );
}

export function BarraCriterio({ rotulo, nota, peso, pontos, ajuda }: {
  rotulo: string; nota: number | null; peso: number; pontos: number; ajuda?: string;
}) {
  return (
    <div className="my-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center">
          {rotulo} <small className="ml-1 text-muted-foreground">(peso {peso}%)</small>
          {ajuda && <Ajuda texto={ajuda} />}
        </span>
        <b className="tabular-nums">
          {nota === null ? <span className="font-normal text-muted-foreground">sem dado</span> : <>{num(nota)}/100 <small className="font-normal text-muted-foreground">→ {num(pontos)} pts</small></>}
        </b>
      </div>
      <Progress value={nota === null ? 0 : Math.max(0, Math.min(100, nota))} className="h-2" />
    </div>
  );
}

export const num = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export const moeda = (n: number | null | undefined) =>
  (Number.isFinite(n as number) ? (n as number) : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export const dataBr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>;
}
