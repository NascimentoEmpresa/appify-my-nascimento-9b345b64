// Moldura comum das quatro telas setoriais de Início de Contrato
// (SIS-2026-0599). Nos mockups do Yuri as quatro são a MESMA tela com
// conteúdo diferente: cabeçalho com Imprimir/Exportar, barra de filtros,
// fileira de indicadores, painéis de gráfico e, embaixo, abas com tabela.
// Mantê-las num componente só é o que garante que continuem iguais quando
// uma delas mudar — e é o mesmo motivo pelo qual o dashboard de Suprimentos
// extraiu o PainelBase.
import { ReactNode } from "react";
import { Printer, Download, Search, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CabecalhoSetor({
  icone,
  titulo,
  subtitulo,
  modulo,
  tom = "orange",
  acoes,
}: {
  icone: ReactNode;
  titulo: string;
  subtitulo: string;
  modulo: string;
  tom?: "orange" | "blue" | "violet" | "green";
  acoes?: ReactNode;
}) {
  const tons = {
    orange: "bg-orange-100 text-orange-600",
    blue: "bg-blue-100 text-blue-600",
    violet: "bg-violet-100 text-violet-600",
    green: "bg-emerald-100 text-emerald-600",
  };
  return (
    <div className="mb-5 flex flex-col gap-4 rounded-xl border bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-4">
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", tons[tom])}>{icone}</div>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">{titulo}</h1>
          <p className="mt-0.5 text-xs text-slate-500">ERP &gt; {modulo} &gt; Início de Contrato</p>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{subtitulo}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {acoes}
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> Imprimir
        </Button>
      </div>
    </div>
  );
}

export function BotaoExportar({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" className="bg-orange-500 text-white hover:bg-orange-600" onClick={onClick}>
      <Download className="mr-1.5 h-4 w-4" /> Exportar
    </Button>
  );
}

export interface CampoFiltro {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
  placeholder?: string;
}

export function BarraFiltros({ campos, onLimpar }: { campos: CampoFiltro[]; onLimpar: () => void }) {
  return (
    <Card className="mb-5">
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        {campos.map((c) => (
          <div key={c.label} className="min-w-[170px] flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-600">{c.label}</label>
            <Select value={c.valor} onValueChange={c.onChange}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={c.placeholder ?? "Todos"} />
              </SelectTrigger>
              <SelectContent>
                {c.opcoes.map((o) => (
                  <SelectItem key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        <Button size="sm" className="h-9 bg-slate-900 text-white hover:bg-slate-800">
          <Search className="mr-1.5 h-4 w-4" /> Filtrar
        </Button>
        <Button size="sm" variant="outline" className="h-9" onClick={onLimpar}>
          <RotateCcw className="mr-1.5 h-4 w-4" /> Limpar
        </Button>
      </CardContent>
    </Card>
  );
}

/** A fileira de indicadores do topo — 5 ou 6 cartões, como nos mockups. */
export function FileiraIndicadores({ children }: { children: ReactNode }) {
  return <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

/**
 * Aviso de base vazia. Tela de lista vazia aqui quase nunca é bug de tela:
 * ou ninguém semeou a base ainda, ou a RLS negou (que devolve vazio, não
 * erro). Dizer isso na tela evita o chamado "a tela não mostra nada".
 */
export function BaseVazia({ contratoEscolhido }: { contratoEscolhido: boolean }) {
  return (
    <Card>
      <CardContent className="p-10 text-center">
        <p className="text-sm font-semibold text-slate-700">
          {contratoEscolhido ? "Sem dados para este contrato." : "Escolha um contrato para ver o resumo."}
        </p>
        {contratoEscolhido && (
          <p className="mx-auto mt-2 max-w-md text-xs text-slate-500">
            A Base Mestre deste contrato ainda não foi preenchida, ou você não tem acesso liberado a ela. Quem monta a
            base é a Implantação, em Licitações &gt; Base Mestre de Contrato.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
