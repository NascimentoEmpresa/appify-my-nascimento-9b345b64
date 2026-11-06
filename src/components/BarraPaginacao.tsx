import { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { paginaDigitada, paginasVisiveis } from "@/lib/paginacao";
import { TAMANHOS_PADRAO } from "@/hooks/usePaginacaoNumerada";

// Paginação no estilo da planilha de Rescisões: "Mostrando X–Y de N", páginas numeradas, tamanho da página (lembrado no navegador) e
// "Ir para" para pular direto a uma página (a 7ª, por exemplo) sem passar pelas outras.

export function BarraPaginacao({ totalItens, pagina, totalPaginas, porPagina, ini, fim, irPara, trocarTamanho, rotulo = "registro" }: {
  totalItens: number; pagina: number; totalPaginas: number; porPagina: number; ini: number; fim: number;
  irPara: (p: number) => void; trocarTamanho: (n: number) => void; rotulo?: string;
}) {
  const [digitada, setDigitada] = useState("");
  if (totalItens === 0) return null;

  function pular() {
    const p = paginaDigitada(digitada, totalPaginas);
    if (p != null) irPara(p);
    setDigitada("");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
      <span className="text-muted-foreground">
        Mostrando <b className="tabular-nums text-foreground">{(ini + 1).toLocaleString("pt-BR")}–{fim.toLocaleString("pt-BR")}</b> de{" "}
        <b className="tabular-nums text-foreground">{totalItens.toLocaleString("pt-BR")}</b> {rotulo}{totalItens === 1 ? "" : "s"}
      </span>
      {totalPaginas > 1 && (
        <nav className="flex flex-wrap items-center gap-1" aria-label="Páginas">
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pagina <= 1} onClick={() => irPara(1)} title="Primeira página"><ChevronsLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pagina <= 1} onClick={() => irPara(pagina - 1)} title="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
          {paginasVisiveis(pagina, totalPaginas).map((p, k) => p == null
            ? <span key={`r${k}`} className="px-1 text-muted-foreground">…</span>
            : (
              <Button key={p} size="sm" variant={p === pagina ? "default" : "ghost"} aria-current={p === pagina ? "page" : undefined}
                className={cn("h-8 min-w-8 px-2 tabular-nums", p === pagina && "pointer-events-none")} onClick={() => irPara(p)}>
                {p}
              </Button>
            ))}
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pagina >= totalPaginas} onClick={() => irPara(pagina + 1)} title="Próxima página"><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pagina >= totalPaginas} onClick={() => irPara(totalPaginas)} title="Última página"><ChevronsRight className="h-4 w-4" /></Button>
          <form className="ml-2 flex items-center gap-1.5 text-muted-foreground" onSubmit={(e) => { e.preventDefault(); pular(); }}>
            Ir para
            <Input
              inputMode="numeric" value={digitada} onChange={(e) => setDigitada(e.target.value.replace(/\D/g, ""))}
              placeholder={`1–${totalPaginas}`} aria-label="Ir para a página" className="h-8 w-16 px-2 text-center tabular-nums"
            />
          </form>
        </nav>
      )}
      <label className="flex items-center gap-2 text-muted-foreground">
        Por página
        <select value={porPagina} onChange={(e) => trocarTamanho(Number(e.target.value))}
          className="h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30">
          {TAMANHOS_PADRAO.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}
