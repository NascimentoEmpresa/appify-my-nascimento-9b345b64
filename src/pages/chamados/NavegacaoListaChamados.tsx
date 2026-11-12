// Setas para passar ao chamado anterior/próximo da lista de onde ele foi
// aberto (?lista= na URL — ver src/lib/chamados/navegacaoLista.ts). Sem
// lista, não aparece. As setas do teclado (← →) também andam, fora de campo
// de texto.
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PARAM_LISTA, hrefNaLista, lerLista, posicaoNaLista } from "@/lib/chamados/navegacaoLista";

export function NavegacaoListaChamados({ id }: { id: string | undefined }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const lista = lerLista(params.get(PARAM_LISTA));
  const pos = posicaoNaLista(lista, id);

  useEffect(() => {
    if (!pos) return;
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target instanceof Element ? e.target : null;
      if (e.altKey || e.ctrlKey || e.metaKey || alvo?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (e.key === "ArrowLeft" && pos.anterior) nav(hrefNaLista(pos.anterior, lista));
      if (e.key === "ArrowRight" && pos.proximo) nav(hrefNaLista(pos.proximo, lista));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  if (!pos) return null;
  return (
    <div className="flex items-center gap-1 rounded-md border bg-background px-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!pos.anterior}
        onClick={() => pos.anterior && nav(hrefNaLista(pos.anterior, lista))} aria-label="Chamado anterior" title="Chamado anterior (←)">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[56px] text-center text-xs tabular-nums text-muted-foreground">{pos.indice + 1} de {pos.total}</span>
      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!pos.proximo}
        onClick={() => pos.proximo && nav(hrefNaLista(pos.proximo, lista))} aria-label="Próximo chamado" title="Próximo chamado (→)">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
