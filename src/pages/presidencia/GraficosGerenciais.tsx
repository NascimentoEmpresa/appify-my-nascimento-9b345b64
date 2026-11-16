// =====================================================================
// ACOMPANHAMENTO DE CHAMADOS › gráficos (SIS-2026-0923)
//
// Segue a skill dataviz com as cores do tema do ERP:
//   · barra = uma série só (magnitude) → um matiz, hsl(var(--primary));
//     barra fina, ponta arredondada de 4px, valor escrito na ponta (rótulo
//     direto) e tooltip ao passar o mouse; sem grade, eixo discreto;
//   · rosca de status = trabalho de STATUS → os tokens de status do tema
//     (info/warning/success/muted), sempre com legenda + número ao lado, nunca
//     só a cor; anel de 2px na cor do cartão separando as fatias.
// A tabela de rendimento ao lado é a "visão em tabela" dos mesmos números.
// =====================================================================
import {
  Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const COR_SERIE = "hsl(var(--primary))";
const ESTILO_TOOLTIP = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--popover-foreground))",
};

export interface ItemBarra { nome: string; valor: number; rotulo?: string }

/** Barras horizontais com o nome à esquerda e o valor na ponta. */
export function BarrasHorizontais({
  dados, unidade, dominioMax, vazio = "Sem dados no filtro atual.",
}: { dados: ItemBarra[]; unidade?: string; dominioMax?: number; vazio?: string }) {
  if (dados.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{vazio}</p>;
  const altura = Math.max(80, dados.length * 30 + 16);
  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }} barCategoryGap={8}>
          <XAxis type="number" hide domain={[0, dominioMax ?? "dataMax"]} />
          <YAxis type="category" dataKey="nome" width={130} tickLine={false} axisLine={false}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
          <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} contentStyle={ESTILO_TOOLTIP}
            formatter={(_v: number, _n: string, item: { payload?: ItemBarra }) =>
              [item.payload?.rotulo ?? `${item.payload?.valor ?? ""}${unidade ? ` ${unidade}` : ""}`, ""]}
            separator="" />
          <Bar dataKey="valor" fill={COR_SERIE} radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false}>
            <LabelList dataKey="rotulo" position="right" style={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
              formatter={(v: string | number) => v} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface FatiaStatus { chave: string; nome: string; valor: number; cor: string }

/** Rosca com o total no centro e legenda com os números (identidade nunca só pela cor). */
export function RoscaStatus({ fatias, rotuloTotal = "Chamados" }: { fatias: FatiaStatus[]; rotuloTotal?: string }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const comValor = fatias.filter((f) => f.valor > 0);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={comValor.length ? comValor : [{ chave: "vazio", nome: "Sem chamados", valor: 1, cor: "hsl(var(--muted))" }]}
              dataKey="valor" nameKey="nome" innerRadius={46} outerRadius={66} startAngle={90} endAngle={-270}
              stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false}>
              {(comValor.length ? comValor : [{ chave: "vazio", cor: "hsl(var(--muted))" }]).map((f) => (
                <Cell key={f.chave} fill={f.cor} />
              ))}
            </Pie>
            {comValor.length > 0 && (
              <Tooltip contentStyle={ESTILO_TOOLTIP}
                formatter={(v: number, n: string) => [`${v} (${total ? Math.round((v / total) * 100) : 0}%)`, n]} />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold leading-none">{total}</span>
          <span className="text-[10px] text-muted-foreground">{rotuloTotal}</span>
        </div>
      </div>
      <ul className="min-w-[9rem] flex-1 space-y-1.5 text-xs">
        {fatias.map((f) => (
          <li key={f.chave} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: f.cor }} aria-hidden />
            <span className="flex-1 text-muted-foreground">{f.nome}</span>
            <b className="tabular-nums">{f.valor}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
