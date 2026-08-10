import { useMemo, useState } from "react";
import { Car, CalendarCheck, Ban, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  disponibilidadeDoVeiculo,
  hojeISO,
  type Agendamento,
  type VeiculoFrota,
} from "@/hooks/useAgendamentoVeiculos";

interface Props {
  agendamentos: Agendamento[];
  frota: VeiculoFrota[];
}

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Painel de uso da frota, embaixo do assistente de agendamento.
 *
 * Nasceu para o espaço vazio que sobrava à esquerda quando a lista da direita
 * era mais alta que o card — mas só entrou porque havia dado real para mostrar
 * (o histórico importado). Fosse enfeite, era melhor deixar o vazio.
 *
 * Tudo aqui é SÉRIE ÚNICA de propósito: o assunto é magnitude ("qual carro
 * roda mais", "quanto rodou por mês"), não identidade. Série única quer um
 * matiz só e dispensa legenda — o título já diz o que está plotado, e um
 * quadrinho com uma cor só repetiria o título ocupando espaço.
 *
 * Nenhuma consulta nova: tudo é calculado do que a tela já carregou.
 */
export function PainelFrota({ agendamentos, frota }: Props) {
  const hoje = hojeISO();

  const dados = useMemo(() => {
    const confirmados = agendamentos.filter((a) => a.status === "confirmado");

    const livresAgora = frota.filter((v) => {
      if (!disponibilidadeDoVeiculo(v, hoje).disponivel) return false;
      return !confirmados.some((a) => a.data_inicio <= hoje && a.data_fim >= hoje && a.patrimonio_id === v.id);
    }).length;

    const em30 = (() => {
      const fim = new Date(`${hoje}T00:00:00`);
      fim.setDate(fim.getDate() + 30);
      const limite = fim.toISOString().slice(0, 10);
      return confirmados.filter((a) => a.data_inicio >= hoje && a.data_inicio <= limite).length;
    })();

    const cancelados = agendamentos.filter((a) => a.status === "cancelado").length;
    const taxaCancel = agendamentos.length
      ? Math.round((cancelados / agendamentos.length) * 100)
      : 0;

    // Uso por veículo — ordenado do maior para o menor, que é como se lê
    // magnitude. Sem corte artificial: a frota toda cabe.
    const porVeiculo = Object.entries(
      confirmados.reduce<Record<string, number>>((acc, a) => {
        acc[a.veiculo_nome] = (acc[a.veiculo_nome] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total);

    // Últimos 6 meses fechados + o corrente.
    const meses: { rotulo: string; chave: string; total: number }[] = [];
    const base = new Date(`${hoje}T00:00:00`);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      meses.push({ rotulo: MES_CURTO[d.getMonth()], chave, total: 0 });
    }
    confirmados.forEach((a) => {
      const m = meses.find((x) => x.chave === a.data_inicio.slice(0, 7));
      if (m) m.total++;
    });

    return { confirmados: confirmados.length, livresAgora, em30, taxaCancel, porVeiculo, meses };
  }, [agendamentos, frota, hoje]);

  if (agendamentos.length === 0) return null;

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icone={CalendarCheck} rotulo="Reservas confirmadas" valor={dados.confirmados} />
        <Tile icone={Car} rotulo="Livres agora" valor={dados.livresAgora} sufixo={`de ${frota.length}`} />
        <Tile icone={TrendingUp} rotulo="Próximos 30 dias" valor={dados.em30} />
        <Tile icone={Ban} rotulo="Taxa de cancelamento" valor={`${dados.taxaCancel}%`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <UsoPorVeiculo dados={dados.porVeiculo} />
        <ReservasPorMes dados={dados.meses} />
      </div>
    </div>
  );
}

function Tile({
  icone: Icone, rotulo, valor, sufixo,
}: {
  icone: typeof Car; rotulo: string; valor: number | string; sufixo?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        <span className="text-xs font-medium uppercase tracking-wide">{rotulo}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums text-foreground">{valor}</span>
        {sufixo && <span className="text-xs text-muted-foreground">{sufixo}</span>}
      </div>
    </Card>
  );
}

/**
 * Barras horizontais: os nomes dos veículos são longos e a comparação é de
 * magnitude. Valor só na ponta de cada barra — número em cima de tudo vira
 * ruído e deixa de ser lido.
 */
function UsoPorVeiculo({ dados }: { dados: { nome: string; total: number }[] }) {
  const maior = Math.max(...dados.map((d) => d.total), 1);

  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-foreground">Uso por veículo</h3>
      <p className="mb-3 text-xs text-muted-foreground">Reservas confirmadas, todo o período.</p>

      {dados.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Sem reservas ainda.</p>
      ) : (
        // gap-y de 8px é o respiro entre barras vizinhas: sem tocar uma na
        // outra, cada uma se lê sozinha sem precisar de contorno.
        <ul className="flex flex-col gap-2">
          {dados.map((d) => (
            <li key={d.nome} className="group grid grid-cols-[9rem_1fr_2rem] items-center gap-2">
              <span className="truncate text-xs text-muted-foreground" title={d.nome}>
                {d.nome}
              </span>
              <span className="h-4 w-full overflow-hidden rounded-sm bg-muted/50">
                <span
                  className="block h-full rounded-r-[4px] bg-primary transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.max((d.total / maior) * 100, 3)}%` }}
                />
              </span>
              <span className="text-right text-xs font-semibold tabular-nums text-foreground">
                {d.total}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Linha com área a 10% — a forma padrão para tendência de série única. Cada
 * ponto tem alvo de hover maior que o próprio marcador, senão ninguém acerta.
 */
function ReservasPorMes({ dados }: { dados: { rotulo: string; total: number }[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);

  const L = 8, R = 8, T = 10, B = 22;
  const W = 300, H = 120;
  const maior = Math.max(...dados.map((d) => d.total), 1);
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(dados.length - 1, 1);
  const y = (v: number) => T + (1 - v / maior) * (H - T - B);

  const pontos = dados.map((d, i) => ({ ...d, cx: x(i), cy: y(d.total) }));
  const linha = pontos.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx},${p.cy}`).join(" ");
  const area = `${linha} L${x(dados.length - 1)},${H - B} L${x(0)},${H - B} Z`;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-foreground">Reservas por mês</h3>
      <p className="mb-3 text-xs text-muted-foreground">Últimos 6 meses.</p>

      {/* O tooltip vive DENTRO deste wrapper: assim ele se posiciona em % da
          caixa do próprio SVG, e acompanha qualquer largura sem conta mágica. */}
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Reservas por mês">
        {/* Grade discreta: 1px sólida, um passo fora da superfície. */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={L} x2={W - R}
            y1={T + f * (H - T - B)} y2={T + f * (H - T - B)}
            stroke="hsl(var(--border))" strokeWidth={1}
          />
        ))}

        <path d={area} fill="hsl(var(--primary))" fillOpacity={0.1} />
        <path d={linha} fill="none" stroke="hsl(var(--primary))" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" />

        {pontos.map((p, i) => (
          <g key={p.rotulo + i}>
            {/* Anel na cor da superfície: o ponto continua legível onde cruza
                a linha, e o alvo de clique é maior que o marcador. */}
            <circle cx={p.cx} cy={p.cy} r={4}
                    fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth={2} />
            <circle cx={p.cx} cy={p.cy} r={14} fill="transparent"
                    onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo(null)} />
            <text x={p.cx} y={H - 6} textAnchor="middle"
                  className="fill-muted-foreground text-[9px]">{p.rotulo}</text>
          </g>
        ))}
      </svg>

        {ativo !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md"
            style={{
              left: `${(pontos[ativo].cx / W) * 100}%`,
              top: `${(pontos[ativo].cy / H) * 100}%`,
            }}
          >
            <span className="font-semibold text-foreground">{pontos[ativo].total}</span>{" "}
            <span className="text-muted-foreground">em {pontos[ativo].rotulo}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
