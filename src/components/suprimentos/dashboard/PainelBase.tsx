import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatarMoeda } from "@/lib/suprimentos/dashboardComprasEstoque";

/**
 * Primitivos visuais do Dashboard de Suprimentos.
 *
 * Nasceram dentro de DashboardComprasEstoque.tsx e saíram para cá quando a aba
 * de Rotatividade do Estoque passou a precisar dos mesmos cartões e painéis.
 * O ponto é ter UMA linguagem visual: as quatro abas do dashboard usam o mesmo
 * cartão, o mesmo painel de gráfico e o mesmo estado vazio, e mexer no estilo
 * aqui muda as quatro de uma vez.
 *
 * Nada aqui tem regra de negócio — é só apresentação.
 */

/**
 * Paleta dos gráficos.
 *
 * `AZUL_MAGNITUDE` é hue única para gráfico de magnitude (quanto saiu por
 * tamanho): o comprimento da barra já carrega o valor, a cor não precisa
 * codificar nada.
 *
 * `SERIES` é a ordem categórica fixa — cada papel tem a sua cor e ela não muda
 * quando um filtro reduz o número de séries. Validada para daltonismo em todos
 * os pares (pior par ΔE 8,1 em deuteranopia, piso 8), por isso toda série vem
 * com legenda e rótulo direto, nunca identificada só pela cor.
 */
export const AZUL_MAGNITUDE = "#0969da";
export const SERIES = {
  pedido: "#0969da",
  entrada: "#10b981",
  saida: "#ef4444",
  declarado: "#f59e0b",
} as const;

/** Cinza recessivo de grade e eixo — nunca compete com a marca de dado. */
export const CINZA_GRADE = "#e2e8f0";

export function CartaoIndicador({
  titulo,
  valor,
  detalhe,
  icone,
  tom = "blue",
}: {
  titulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  icone: ReactNode;
  tom?: "blue" | "green" | "amber" | "red" | "violet" | "slate";
}) {
  const tons = {
    blue: "border-blue-100 bg-gradient-to-br from-white to-blue-50 text-blue-700",
    green: "border-emerald-100 bg-gradient-to-br from-white to-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-gradient-to-br from-white to-amber-50 text-amber-700",
    red: "border-rose-100 bg-gradient-to-br from-white to-rose-50 text-rose-700",
    violet: "border-violet-100 bg-gradient-to-br from-white to-violet-50 text-violet-700",
    slate: "border-slate-200 bg-gradient-to-br from-white to-slate-50 text-slate-700",
  };
  return (
    <Card className={cn("overflow-hidden border shadow-sm", tons[tom])}>
      <CardContent className="flex min-h-[116px] items-start gap-3 p-4">
        <div className="mt-0.5 rounded-xl bg-current/10 p-2.5">{icone}</div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-600">{titulo}</p>
          <p className="mt-1 break-words text-2xl font-extrabold tracking-tight text-slate-950">{valor}</p>
          {detalhe && <div className="mt-1.5 text-xs text-slate-500">{detalhe}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Cartão de número-herói: a resposta curta de uma pergunta, sem gráfico.
 * "Qual tamanho mais sai" é um valor único — virar barra de uma categoria só
 * seria gráfico decorativo.
 */
export function CartaoDestaque({
  titulo,
  valor,
  detalhe,
  icone,
  tom = "blue",
}: {
  titulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  icone: ReactNode;
  tom?: "blue" | "green" | "amber" | "red";
}) {
  const tons = {
    blue: "from-[#062b53] via-[#0a4d88] to-[#0d75c5]",
    green: "from-[#064e3b] via-[#047857] to-[#10b981]",
    amber: "from-[#78350f] via-[#b45309] to-[#f59e0b]",
    red: "from-[#7f1d1d] via-[#b91c1c] to-[#ef4444]",
  };
  return (
    <Card className={cn("overflow-hidden border-0 bg-gradient-to-br text-white shadow-md", tons[tom])}>
      <CardContent className="flex min-h-[132px] items-start gap-3 p-4">
        <div className="mt-0.5 rounded-xl bg-white/15 p-2.5">{icone}</div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/80">{titulo}</p>
          <p className="mt-1 break-words text-4xl font-extrabold leading-none tracking-tight">{valor}</p>
          {detalhe && <div className="mt-2 text-xs text-white/85">{detalhe}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export function PainelGrafico({
  titulo,
  subtitulo,
  acao,
  children,
  className,
}: {
  titulo: string;
  subtitulo?: string;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-slate-200 shadow-sm", className)}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base font-bold text-blue-950">{titulo}</CardTitle>
            {subtitulo && <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p>}
          </div>
          {acao}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function TooltipMoeda({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white p-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-semibold text-slate-700">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey} className="text-slate-600">
          <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: p.color }} />
          {p.name}: {formatarMoeda(p.value)}
        </p>
      ))}
    </div>
  );
}

export function EstadoVazio({ texto, altura = 220 }: { texto: string; altura?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-slate-500" style={{ height: altura }}>
      {texto}
    </div>
  );
}

export function CabecalhoTabela({
  children,
  alinhar = "left",
}: {
  children: ReactNode;
  alinhar?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border-b bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600",
        alinhar === "right" && "text-right",
        alinhar === "center" && "text-center",
        alinhar === "left" && "text-left",
      )}
    >
      {children}
    </th>
  );
}
