import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Crosshair, FileText, FolderClosed, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  alternarTela, filtrarArvore, marcadasPorSetor, setorDoModulo,
  type InfoTela, type SetorArvore,
} from "@/lib/chamados/arvoreModulos";

// =====================================================================
// SELETOR SETOR → TELAS (SIS-2026-0921), no desenho do "modelo proposto"
// anexado ao chamado (Yuri, Controladoria): busca "Buscar módulo..." no topo;
// à esquerda os setores da barra lateral, com o MESMO ícone e na MESMA ordem
// dela; o setor aberto fica laranja, com a seta para baixo; ao lado, o
// cabeçalho do setor e as telas dele em duas colunas, na ordem da barra
// (de cima para baixo, coluna por coluna), cada uma com ícone de arquivo —
// a marcada fica laranja cheia. A categoria da barra (Cadastros Mestres,
// Ferramentas...) aparece ao passar o mouse.
//
// Dá para marcar telas de vários setores; o número ao lado do setor diz
// quantas dele já estão marcadas.
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

  const abrir = (o: boolean) => {
    setAberto(o);
    if (o) { setBusca(""); setSetorId(setorInicial()); setVerTelas(false); }
  };

  const escolherUm = (v: string) => { (props.onChange as (v: string) => void)(v); setAberto(false); };
  const escolher = (rota: string) => {
    if (props.multiplo) props.onChange(alternarTela(props.value, rota, destaque));
    else escolherUm(rota);
  };

  const remover = (v: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (props.multiplo) props.onChange(props.value.filter((x) => x !== v));
  };

  const IconeSetor = setor?.icone ?? FolderClosed;

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
                    // Chips laranja como no modelo do SIS-2026-0910 (17/11/2026); o módulo
                    // diretamente ajustado fica laranja CHEIO, com a mira, para não se
                    // confundir com os demais impactados.
                    className={cn("max-w-full gap-1 pr-1 text-xs font-medium",
                      v === destaque
                        ? "border-accent bg-accent text-accent-foreground hover:bg-accent"
                        : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15")}>
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
        <PopoverContent align="end" className="w-[min(600px,calc(100vw-2rem))] overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input autoFocus value={busca} onChange={(e) => { setBusca(e.target.value); setVerTelas(false); }}
              placeholder="Buscar módulo..." aria-label="Buscar módulo"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </div>

          {filtrada.length === 0 && !props.extras?.length ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Nenhum setor ou tela encontrado.</p>
          ) : (
            <div className="flex h-[min(340px,60vh)]">
              {/* Setores, como na barra lateral */}
              <div className={cn("w-full shrink-0 overflow-y-auto border-r border-border p-1.5 sm:block sm:w-52", verTelas && "hidden")}>
                {filtrada.map((s) => {
                  const n = contagem.get(s.id) ?? 0;
                  const ativo = setor?.id === s.id;
                  const Icone = s.icone ?? FolderClosed;
                  return (
                    <button key={s.id} type="button" onClick={() => { setSetorId(s.id); setVerTelas(true); }}
                      className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted",
                        ativo && "bg-accent/10 font-semibold text-accent hover:bg-accent/15")}>
                      <Icone className={cn("h-4 w-4 shrink-0", ativo ? "text-accent" : "text-muted-foreground")} />
                      <span className="min-w-0 flex-1 truncate">{s.rotulo}</span>
                      {n > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold leading-4 text-accent-foreground">{n}</span>}
                      {ativo
                        ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        : <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />}
                    </button>
                  );
                })}
                {!props.multiplo && props.extras?.map((x) => (
                  <button key={x.value} type="button" onClick={() => escolherUm(x.value)}
                    className={cn("mt-1 flex w-full items-center gap-2.5 rounded-md border-t border-border px-2 py-1.5 text-left text-[13px] hover:bg-muted",
                      props.value === x.value && "bg-accent font-semibold text-accent-foreground hover:bg-accent")}>
                    <FolderClosed className="h-4 w-4 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{x.label}</span>
                      {x.hint && <span className="block truncate text-[11px] opacity-75">{x.hint}</span>}
                    </span>
                  </button>
                ))}
              </div>

              {/* Telas do setor aberto */}
              <div className={cn("min-w-0 flex-1 overflow-y-auto p-2 sm:block", !verTelas && "hidden")}>
                {setor ? (
                  <>
                    <div className="mb-1.5 flex items-center gap-2 px-1 pt-0.5">
                      <button type="button" onClick={() => setVerTelas(false)} className="rounded p-0.5 hover:bg-muted sm:hidden" aria-label="Voltar aos setores">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <IconeSetor className="h-4 w-4 text-accent" />
                      <p className="text-sm font-bold text-foreground">{setor.rotulo}</p>
                    </div>
                    <div className="gap-1 sm:columns-2">
                      {setor.telas.map((t) => {
                        const marcada = selecao.includes(t.rota);
                        const ehDestaque = t.rota === destaque;
                        const fixa = props.multiplo && ehDestaque;
                        const Icone = ehDestaque ? Crosshair : FileText;
                        return (
                          <button key={t.rota} type="button" onClick={() => escolher(t.rota)} disabled={fixa}
                            aria-pressed={marcada}
                            title={fixa ? "Posição — módulo diretamente ajustado (troque a posição para tirar)" : `${t.categoria} · ${t.rota}`}
                            className={cn("mb-0.5 flex w-full break-inside-avoid items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors disabled:cursor-default",
                              marcada ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted")}>
                            <Icone className={cn("h-3.5 w-3.5 shrink-0", marcada ? "opacity-90" : "text-muted-foreground")} />
                            <span className="min-w-0 flex-1 truncate">{t.rotulo}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">Escolha um setor.</p>
                )}
              </div>
            </div>
          )}

          {props.multiplo && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span>{selecao.length} módulo(s) marcado(s) · setores e telas da barra lateral</span>
              <Button type="button" size="sm" className="h-7" onClick={() => setAberto(false)}>Concluir</Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
