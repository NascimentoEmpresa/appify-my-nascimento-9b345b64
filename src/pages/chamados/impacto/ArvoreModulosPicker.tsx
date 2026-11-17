import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Crosshair, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  alternarTela, filtrarArvore, marcadasPorSetor, setorDoModulo,
  type InfoTela, type SetorArvore,
} from "@/lib/chamados/arvoreModulos";

// =====================================================================
// SELETOR SETOR → TELAS (SIS-2026-0921), no desenho do modelo anexado ao
// chamado: à esquerda os setores da barra lateral, na ordem dela; clicar num
// setor abre ao lado as telas dele (agrupadas pelas categorias do menu) para
// marcar. Dá para marcar telas de vários setores; o contador ao lado de cada
// setor diz quantas já estão marcadas. A busca procura em setores e telas.
//
// Dois jeitos:
//   · `multiplo` — Módulos do sistema impactados (chips no gatilho);
//   · simples — Posição/módulo diretamente ajustado (escolheu, fecha), com
//     `extras` para opções fora da árvore ("Outro").
// No celular as duas colunas viram duas etapas (setores → telas, com voltar).
// =====================================================================

export interface OpcaoExtra { value: string; label: string; hint?: string }

interface Base {
  arvore: SetorArvore[];
  indice: ReadonlyMap<string, InfoTela>;
  /** Rótulo de qualquer valor gravado (tela, valor amplo antigo, extra). */
  rotulo: (v: string) => string;
  disabled?: boolean;
  placeholder?: string;
  /** Tela/posição que fica destacada (e, no múltiplo, não sai pelo "x"). */
  destaque?: string | null;
  className?: string;
}

export type ArvoreModulosPickerProps = Base & (
  | { multiplo: true; value: string[]; onChange: (v: string[]) => void; extras?: never }
  | { multiplo?: false; value: string; onChange: (v: string) => void; extras?: OpcaoExtra[] }
);

export function ArvoreModulosPicker(props: ArvoreModulosPickerProps) {
  const { arvore, indice, rotulo, disabled, placeholder, destaque, className } = props;
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const valor = props.value;
  const selecao = useMemo<string[]>(
    () => (Array.isArray(valor) ? valor : valor ? [valor] : []),
    [valor],
  );
  // Ao abrir, começa no setor da primeira tela marcada (ou no primeiro).
  const setorInicial = () => {
    for (const v of selecao) { const t = setorDoModulo(v, indice); if (t) return t.setorId; }
    return arvore[0]?.id ?? null;
  };
  const [setorId, setSetorId] = useState<string | null>(null);
  // Celular: false = lista de setores, true = telas do setor.
  const [verTelas, setVerTelas] = useState(false);

  const filtrada = useMemo(() => filtrarArvore(arvore, busca), [arvore, busca]);
  const contagem = useMemo(() => marcadasPorSetor(arvore, selecao), [arvore, selecao]);
  const setor = filtrada.find((s) => s.id === setorId) ?? filtrada[0] ?? null;
  const categorias = useMemo(() => {
    const m = new Map<string, SetorArvore["telas"]>();
    for (const t of setor?.telas ?? []) m.set(t.categoria, [...(m.get(t.categoria) ?? []), t]);
    return [...m.entries()];
  }, [setor]);

  const abrir = (o: boolean) => {
    setAberto(o);
    if (o) { setBusca(""); setSetorId(setorInicial()); setVerTelas(false); }
  };

  const escolher = (rota: string) => {
    if (props.multiplo) props.onChange(alternarTela(props.value, rota, destaque));
    else { (props.onChange as (v: string) => void)(rota); setAberto(false); }
  };

  const remover = (v: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (props.multiplo) props.onChange(props.value.filter((x) => x !== v));
  };

  return (
    <div className={cn("relative", className)}>
      <Popover open={aberto} onOpenChange={abrir}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={aberto} disabled={disabled}
            className="h-auto min-h-9 w-full justify-between gap-1 bg-background py-1.5 font-normal">
            <span className="flex min-w-0 flex-1 flex-wrap gap-1 text-left">
              {selecao.length === 0 ? (
                <span className="text-muted-foreground">{placeholder ?? "Selecionar…"}</span>
              ) : props.multiplo ? (
                selecao.map((v) => (
                  <Badge key={v} variant="secondary" title={rotulo(v)}
                    className={cn("max-w-full gap-1 pr-1 text-xs", v === destaque && "border-primary/40 bg-primary/10 text-primary")}>
                    {v === destaque && <Crosshair className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{rotulo(v)}</span>
                    {!disabled && v !== destaque && (
                      <span role="button" tabIndex={-1} aria-label={`Remover ${rotulo(v)}`} onClick={(e) => remover(v, e)}
                        className="rounded-sm opacity-70 hover:opacity-100"><X className="h-3 w-3" /></span>
                    )}
                  </Badge>
                ))
              ) : (
                <span className="truncate">{rotulo(selecao[0])}</span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(680px,calc(100vw-2rem))] p-0">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input autoFocus value={busca} onChange={(e) => { setBusca(e.target.value); setVerTelas(false); }}
                placeholder="Buscar setor ou tela…" className="h-9 pl-8" />
            </div>
          </div>

          {filtrada.length === 0 && !props.extras?.length ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Nenhum setor ou tela encontrado.</p>
          ) : (
            <div className="flex h-[min(380px,60vh)]">
              {/* Setores */}
              <div className={cn("w-full shrink-0 overflow-y-auto border-r border-border p-1 sm:block sm:w-56", verTelas && "hidden")}>
                {filtrada.map((s) => {
                  const n = contagem.get(s.id) ?? 0;
                  return (
                    <button key={s.id} type="button" onClick={() => { setSetorId(s.id); setVerTelas(true); }}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                        setor?.id === s.id && "bg-primary/10 font-semibold text-primary")}>
                      <span className="min-w-0 flex-1 truncate">{s.rotulo}</span>
                      {n > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-primary-foreground">{n}</span>}
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </button>
                  );
                })}
                {!props.multiplo && props.extras?.map((x) => (
                  <button key={x.value} type="button" onClick={() => { (props.onChange as (v: string) => void)(x.value); setAberto(false); }}
                    className={cn("mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-sm hover:bg-muted",
                      props.value === x.value && "font-semibold text-primary")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{x.label}</span>
                      {x.hint && <span className="block truncate text-[11px] text-muted-foreground">{x.hint}</span>}
                    </span>
                    {props.value === x.value && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>

              {/* Telas do setor aberto */}
              <div className={cn("min-w-0 flex-1 overflow-y-auto p-2 sm:block", !verTelas && "hidden")}>
                {setor ? (
                  <>
                    <div className="mb-1 flex items-center gap-1">
                      <button type="button" onClick={() => setVerTelas(false)} className="rounded p-0.5 hover:bg-muted sm:hidden" aria-label="Voltar aos setores">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{setor.rotulo}</p>
                    </div>
                    {categorias.map(([cat, telas]) => (
                      <div key={cat} className="mb-2">
                        <p className="px-1 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{cat}</p>
                        <div className="grid gap-0.5 md:grid-cols-2">
                          {telas.map((t) => {
                            const marcada = selecao.includes(t.rota);
                            const fixa = props.multiplo && t.rota === destaque;
                            return (
                              <button key={t.rota} type="button" onClick={() => escolher(t.rota)} disabled={fixa}
                                title={fixa ? "Posição — módulo diretamente ajustado (troque a posição para tirar)" : t.rota}
                                className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:cursor-default",
                                  marcada && "bg-primary/5 font-medium")}>
                                {props.multiplo
                                  ? <Checkbox checked={marcada} tabIndex={-1} className="pointer-events-none" />
                                  : <Check className={cn("h-4 w-4 shrink-0 text-primary", !marcada && "opacity-0")} />}
                                <span className="min-w-0 flex-1 truncate">{t.rotulo}</span>
                                {t.rota === destaque && <Crosshair className="h-3.5 w-3.5 shrink-0 text-primary" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">Escolha um setor.</p>
                )}
              </div>
            </div>
          )}

          {props.multiplo && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span>{selecao.length} tela(s) marcada(s) · os setores e telas são os da barra lateral</span>
              <Button type="button" size="sm" className="h-7" onClick={() => setAberto(false)}>Concluir</Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
