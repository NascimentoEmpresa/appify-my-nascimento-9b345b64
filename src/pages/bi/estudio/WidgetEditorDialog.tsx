// Estúdio de BI — o editor de um widget, à mão.
//
// Esquerda: SQL (com o catálogo de tabelas ao lado pra consultar) e o botão
// Executar, que devolve as colunas. Direita: o gráfico ao vivo e o
// mapeamento (tipo, eixo, séries, formato, tamanho). O que a IA gerou passa
// por aqui do mesmo jeito — o editor não sabe quem escreveu o SQL.
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { WidgetGrafico } from "@/components/bi/WidgetGrafico";
import { executarSqlBi, useCatalogoBi } from "@/hooks/useBiEstudio";
import {
  ALTURAS, LARGURAS, PALETA, TIPOS_WIDGET, colunasNumericas, sugerirConfig,
  type FiltroPainel, type FormatoNumero, type ResultadoSql, type TipoWidget, type Widget, type WidgetConfig, type WidgetRascunho,
} from "@/lib/bi/estudio";
import { Database, Loader2, Play, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** widget existente (edição) ou rascunho (novo / vindo da IA) */
  inicial: Partial<Widget> & Partial<WidgetRascunho>;
  filtros: FiltroPainel[];
  params: Record<string, string | null>;
  onSalvar: (w: Partial<Widget>) => Promise<void>;
  onPedirIa?: (atual: Partial<WidgetRascunho>) => void;
  escuro?: boolean;
}

const SQL_EXEMPLO = `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes,
       count(*) AS vagas
  FROM "SISTEMA_RECRUTAMENTO"
 WHERE created_at >= now() - interval '12 months'
 GROUP BY 1
 ORDER BY 1`;

export function WidgetEditorDialog({ aberto, onFechar, inicial, filtros, params, onSalvar, onPedirIa, escuro }: Props) {
  const [titulo, setTitulo] = useState(inicial.titulo ?? "");
  const [subtitulo, setSubtitulo] = useState(inicial.subtitulo ?? "");
  const [tipo, setTipo] = useState<TipoWidget>(inicial.tipo ?? "barras");
  const [sql, setSql] = useState(inicial.sql ?? "");
  const [config, setConfig] = useState<WidgetConfig>(inicial.config ?? {});
  const [largura, setLargura] = useState<number>(inicial.largura ?? 6);
  const [altura, setAltura] = useState<number>(inicial.altura ?? 2);
  const [resultado, setResultado] = useState<ResultadoSql | null>(inicial.amostra ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [verCatalogo, setVerCatalogo] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setTitulo(inicial.titulo ?? ""); setSubtitulo(inicial.subtitulo ?? ""); setTipo(inicial.tipo ?? "barras");
    setSql(inicial.sql ?? ""); setConfig(inicial.config ?? {}); setLargura(inicial.largura ?? 6); setAltura(inicial.altura ?? 2);
    setResultado(inicial.amostra ?? null); setErro(null);
    // Widget salvo abre já executado, pra ver o gráfico sem clicar.
    if (inicial.sql && !inicial.amostra) executar(inicial.sql, inicial.tipo ?? "barras", inicial.config ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const executar = async (s = sql, t = tipo, c = config) => {
    if (!s.trim()) { setErro("Escreva um SELECT."); return; }
    setRodando(true); setErro(null);
    try {
      const r = await executarSqlBi(s, params, 500);
      setResultado(r);
      setConfig(sugerirConfig(t, r, c));
    } catch (e) {
      setErro((e as Error).message); setResultado(null);
    } finally {
      setRodando(false);
    }
  };

  const mudarTipo = (t: TipoWidget) => {
    setTipo(t);
    setConfig(c => sugerirConfig(t, resultado, c));
    if (t === "kpi") { setLargura(3); setAltura(1); }
    else if (t === "tabela") { setLargura(12); }
  };

  const salvar = async () => {
    if (!titulo.trim()) { toast.error("Dê um título ao gráfico."); return; }
    if (!sql.trim()) { toast.error("Escreva o SELECT."); return; }
    if (!resultado) { toast.error("Execute o SQL antes de salvar — é assim que o gráfico é conferido."); return; }
    setSalvando(true);
    try {
      await onSalvar({ id: inicial.id, titulo: titulo.trim(), subtitulo: subtitulo.trim() || null, tipo, sql: sql.trim(), config, largura, altura, criado_por_ia: inicial.criado_por_ia ?? false });
      onFechar();
    } catch (e) {
      toast.error("Não consegui salvar: " + (e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const colunas = resultado?.colunas.map(c => c.nome) ?? [];
  const nums = colunasNumericas(resultado);
  const precisaX = !["kpi", "tabela"].includes(tipo);
  const precisaSeries = !["kpi", "tabela", "dispersao"].includes(tipo);
  const umaSerie = tipo === "pizza" || tipo === "rosca";

  const toggleSerie = (col: string) => {
    setConfig(c => {
      const atuais = c.series ?? [];
      const tem = atuais.some(s => s.coluna === col);
      if (umaSerie) return { ...c, series: [{ coluna: col, rotulo: col }] };
      return { ...c, series: tem ? atuais.filter(s => s.coluna !== col) : [...atuais, { coluna: col, rotulo: col }].slice(0, 8) };
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={o => { if (!o) onFechar(); }}>
      <DialogContent className="flex h-[92vh] max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2">
            {inicial.id ? "Editar gráfico" : "Novo gráfico"}
            {inicial.criado_por_ia && <Badge variant="outline" className="gap-1 text-[10px]"><Sparkles className="h-3 w-3" /> IA</Badge>}
          </DialogTitle>
          <DialogDescription>Escreva o SELECT, execute, escolha o tipo e mapeie eixo e séries. Filtros do painel entram como <code>{"{{chave}}"}</code>.</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_1fr]">
          {/* ── Esquerda: SQL ── */}
          <div className="flex min-h-0 flex-col border-r">
            <div className="grid grid-cols-2 gap-2 border-b px-4 py-3">
              <div><Label className="text-xs">Título *</Label><Input className="mt-1 h-8" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex.: Vagas abertas por mês" /></div>
              <div><Label className="text-xs">Subtítulo</Label><Input className="mt-1 h-8" value={subtitulo} onChange={e => setSubtitulo(e.target.value)} placeholder="Opcional" /></div>
            </div>
            <div className="flex items-center justify-between gap-2 px-4 pt-3">
              <Label className="text-xs">SQL (só SELECT)</Label>
              <div className="flex items-center gap-1.5">
                {filtros.length > 0 && filtros.map(f => (
                  <button key={f.chave} type="button" title={`Inserir {{${f.chave}}}`} onClick={() => setSql(s => s + ` {{${f.chave}}}`)}
                          className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted/70">{"{{" + f.chave + "}}"}</button>
                ))}
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setVerCatalogo(v => !v)}>
                  <Database className="mr-1 h-3.5 w-3.5" /> Tabelas
                </Button>
                {!sql && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSql(SQL_EXEMPLO)}>Exemplo</Button>}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 gap-0 px-4 pb-3 pt-1">
              <Textarea
                value={sql} onChange={e => setSql(e.target.value)} spellCheck={false}
                className="h-full min-h-[220px] flex-1 resize-none font-mono text-xs leading-relaxed"
                placeholder={"SELECT ...\n\nDica: dê alias curto às colunas (AS total, AS mes)."}
                onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); executar(); } }}
              />
              {verCatalogo && <CatalogoLateral onInserir={t => setSql(s => (s ? s + " " : "") + t)} onFechar={() => setVerCatalogo(false)} />}
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
              <div className="min-w-0 text-xs text-muted-foreground">
                {rodando ? "Executando…" : erro ? <span className="text-destructive">{erro}</span>
                  : resultado ? <>{resultado.total} linha{resultado.total === 1 ? "" : "s"} · {resultado.colunas.length} coluna{resultado.colunas.length === 1 ? "" : "s"} · {resultado.ms} ms{resultado.truncado ? " · truncado" : ""}</>
                  : "Ctrl+Enter executa"}
              </div>
              <div className="flex items-center gap-2">
                {onPedirIa && (
                  <Button type="button" variant="outline" size="sm" onClick={() => onPedirIa({ titulo, subtitulo, tipo, sql, config, largura, altura })}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Ajustar com IA
                  </Button>
                )}
                <Button type="button" size="sm" onClick={() => executar()} disabled={rodando}>
                  {rodando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />} Executar
                </Button>
              </div>
            </div>
          </div>

          {/* ── Direita: gráfico + mapeamento ── */}
          <div className="flex min-h-0 flex-col">
            <div className="border-b p-3" style={{ background: escuro ? "#1a1a19" : "#fcfcfb" }}>
              <div className="mb-1 flex items-center justify-between">
                <p className="truncate text-sm font-semibold" style={{ color: escuro ? "#fff" : "#0b0b0b" }}>{titulo || "Prévia"}</p>
                <span className="text-[10px] text-muted-foreground">{largura}×{altura}</span>
              </div>
              <WidgetGrafico tipo={tipo} config={config} dados={resultado} escuro={escuro} altura={tipo === "kpi" ? 100 : 230} />
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div>
                <Label className="text-xs">Tipo de gráfico</Label>
                <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                  {TIPOS_WIDGET.map(t => (
                    <button key={t.valor} type="button" title={t.dica} onClick={() => mudarTipo(t.valor)}
                            className={cn("rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors", tipo === t.valor ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                      {t.rotulo}
                    </button>
                  ))}
                </div>
              </div>

              {precisaX && (
                <div>
                  <Label className="text-xs">{tipo === "dispersao" ? "Eixo X (número)" : tipo === "pizza" || tipo === "rosca" ? "Categoria" : "Eixo X (categoria / data)"}</Label>
                  <Select value={config.x ?? ""} onValueChange={v => setConfig(c => ({ ...c, x: v }))} disabled={!colunas.length}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue placeholder={colunas.length ? "Escolha a coluna" : "Execute o SQL primeiro"} /></SelectTrigger>
                    <SelectContent>{colunas.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              {tipo === "dispersao" && (
                <div>
                  <Label className="text-xs">Eixo Y (número)</Label>
                  <Select value={config.y ?? ""} onValueChange={v => setConfig(c => ({ ...c, y: v }))} disabled={!nums.length}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Coluna" /></SelectTrigger>
                    <SelectContent>{nums.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              {precisaSeries && (
                <div>
                  <Label className="text-xs">{umaSerie ? "Valor" : "Séries (valores)"} {!umaSerie && <span className="text-muted-foreground">— até 8</span>}</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {nums.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma coluna numérica no resultado.</span>}
                    {nums.map((c, i) => {
                      const idx = (config.series ?? []).findIndex(s => s.coluna === c);
                      const ativo = idx >= 0;
                      return (
                        <button key={c} type="button" onClick={() => toggleSerie(c)}
                                className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", ativo ? "border-primary bg-primary/10" : "hover:bg-muted")}>
                          {ativo && <span className="h-2.5 w-2.5 rounded-full" style={{ background: (config.series ?? [])[idx]?.cor ?? PALETA[idx % 8] }} />}
                          {c}
                        </button>
                      );
                    })}
                  </div>
                  {(config.series ?? []).length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {(config.series ?? []).map((s, i) => (
                        <div key={s.coluna} className="flex items-center gap-2">
                          <input type="color" value={s.cor ?? PALETA[i % 8]} title="Cor da série"
                                 onChange={e => setConfig(c => ({ ...c, series: (c.series ?? []).map(x => x.coluna === s.coluna ? { ...x, cor: e.target.value } : x) }))}
                                 className="h-7 w-8 cursor-pointer rounded border bg-transparent p-0.5" />
                          <span className="w-28 truncate font-mono text-[11px] text-muted-foreground">{s.coluna}</span>
                          <Input className="h-7 flex-1 text-xs" value={s.rotulo ?? ""} placeholder="Rótulo na legenda"
                                 onChange={e => setConfig(c => ({ ...c, series: (c.series ?? []).map(x => x.coluna === s.coluna ? { ...x, rotulo: e.target.value } : x) }))} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tipo === "kpi" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Coluna do número</Label>
                    <Select value={config.kpi?.coluna ?? ""} onValueChange={v => setConfig(c => ({ ...c, kpi: { ...(c.kpi ?? {}), coluna: v } }))} disabled={!colunas.length}>
                      <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Coluna" /></SelectTrigger>
                      <SelectContent>{colunas.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Comparar com (opcional)</Label>
                    <Select value={config.kpi?.comparar_coluna ?? "__nenhuma"} onValueChange={v => setConfig(c => ({ ...c, kpi: { ...(c.kpi ?? {}), comparar_coluna: v === "__nenhuma" ? undefined : v } }))} disabled={!colunas.length}>
                      <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="__nenhuma">— nenhuma —</SelectItem>{nums.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">Prefixo</Label><Input className="mt-1 h-8" value={config.kpi?.prefixo ?? ""} onChange={e => setConfig(c => ({ ...c, kpi: { ...(c.kpi ?? {}), prefixo: e.target.value } }))} placeholder="Ex.: R$" /></div>
                  <div><Label className="text-xs">Sufixo</Label><Input className="mt-1 h-8" value={config.kpi?.sufixo ?? ""} onChange={e => setConfig(c => ({ ...c, kpi: { ...(c.kpi ?? {}), sufixo: e.target.value } }))} placeholder="Ex.: colaboradores" /></div>
                </div>
              )}

              {tipo === "tabela" && colunas.length > 0 && (
                <div>
                  <Label className="text-xs">Colunas (clique para ocultar/mostrar)</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {colunas.map(c => {
                      const visiveis = config.colunas?.length ? config.colunas : colunas;
                      const on = visiveis.includes(c);
                      return (
                        <button key={c} type="button" onClick={() => setConfig(cf => ({ ...cf, colunas: on ? visiveis.filter(x => x !== c) : [...visiveis, c].filter(x => colunas.includes(x)) }))}
                                className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary/10" : "text-muted-foreground line-through hover:bg-muted")}>{c}</button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Formato</Label>
                  <Select value={config.formato ?? "numero"} onValueChange={v => setConfig(c => ({ ...c, formato: v as FormatoNumero }))}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="numero">Número</SelectItem>
                      <SelectItem value="inteiro">Inteiro</SelectItem>
                      <SelectItem value="moeda">Moeda (R$)</SelectItem>
                      <SelectItem value="percentual">Percentual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Largura</Label>
                  <Select value={String(largura)} onValueChange={v => setLargura(Number(v))}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{LARGURAS.map(l => <SelectItem key={l} value={String(l)}>{l}/12 {l === 12 ? "(linha inteira)" : l === 6 ? "(metade)" : ""}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Altura</Label>
                  <Select value={String(altura)} onValueChange={v => setAltura(Number(v))}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{ALTURAS.map(a => <SelectItem key={a} value={String(a)}>{a} {a === 1 ? "(baixo)" : a === 2 ? "(padrão)" : ""}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              {precisaSeries && (
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <label className="flex items-center gap-2 text-xs"><Switch checked={!!config.mostrar_rotulos} onCheckedChange={v => setConfig(c => ({ ...c, mostrar_rotulos: v }))} /> Rótulos de valor</label>
                  <label className="flex items-center gap-2 text-xs"><Switch checked={config.mostrar_legenda ?? (config.series ?? []).length > 1} onCheckedChange={v => setConfig(c => ({ ...c, mostrar_legenda: v }))} /> Legenda</label>
                  {(tipo === "area" || tipo === "barras") && <label className="flex items-center gap-2 text-xs"><Switch checked={!!config.empilhar} onCheckedChange={v => setConfig(c => ({ ...c, empilhar: v }))} /> Empilhar</label>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar gráfico</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Catálogo de tabelas/colunas, com busca — clique insere o nome citado no SQL. */
function CatalogoLateral({ onInserir, onFechar }: { onInserir: (t: string) => void; onFechar: () => void }) {
  const { data = [], isLoading } = useCatalogoBi(true);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return data;
    return data.filter(t => t.nome.toLowerCase().includes(q) || t.colunas.some(c => c.nome.toLowerCase().includes(q)));
  }, [data, busca]);
  return (
    <div className="ml-2 flex w-64 shrink-0 flex-col rounded-lg border bg-muted/20">
      <div className="flex items-center gap-1 border-b p-1.5">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input className="h-6 flex-1 bg-transparent text-xs outline-none" placeholder="Tabela ou coluna…" value={busca} onChange={e => setBusca(e.target.value)} />
        <button type="button" onClick={onFechar} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1 text-[11px]">
        {isLoading ? <p className="p-2 text-muted-foreground">Carregando…</p> : lista.slice(0, 200).map(t => (
          <div key={t.nome}>
            <button type="button" onClick={() => setAberta(a => a === t.nome ? null : t.nome)}
                    className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left font-mono hover:bg-muted">
              <span className="truncate">{t.nome}</span>
              {t.tipo === "view" && <span className="ml-auto rounded bg-muted px-1 text-[9px] not-italic text-muted-foreground">view</span>}
            </button>
            {aberta === t.nome && (
              <div className="mb-1 ml-2 border-l pl-2">
                <button type="button" onClick={() => onInserir(`"${t.nome}"`)} className="mb-0.5 block text-[10px] text-primary hover:underline">inserir tabela</button>
                {t.colunas.map(c => (
                  <button key={c.nome} type="button" onClick={() => onInserir(`"${c.nome}"`)} className="flex w-full justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted">
                    <span className="truncate font-mono">{c.nome}</span><span className="shrink-0 text-muted-foreground">{c.tipo.replace("character varying", "varchar").replace("timestamp with time zone", "timestamptz")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
