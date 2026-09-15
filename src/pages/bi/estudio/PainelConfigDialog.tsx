// Estúdio de BI — configuração do painel: nome, visibilidade, filtros, tema.
//
// Filtro = um controle no topo do painel que vira {{chave}} em qualquer SQL
// dos widgets. Quatro tipos: texto, data, número e lista (opções fixas).
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FiltroPainel, Painel } from "@/lib/bi/estudio";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  painel: Painel;
  onSalvar: (p: Partial<Painel>) => Promise<void>;
  onExcluir?: () => Promise<void>;
}

const chaveValida = (s: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);

export function PainelConfigDialog({ aberto, onFechar, painel, onSalvar, onExcluir }: Props) {
  const [nome, setNome] = useState(painel.nome);
  const [descricao, setDescricao] = useState(painel.descricao ?? "");
  const [publico, setPublico] = useState(painel.publico);
  const [tema, setTema] = useState<"claro" | "escuro">(painel.config?.tema ?? "claro");
  const [atualizar, setAtualizar] = useState<number>(painel.config?.atualizar_a_cada_seg ?? 0);
  const [filtros, setFiltros] = useState<FiltroPainel[]>(painel.filtros ?? []);
  const [salvando, setSalvando] = useState(false);
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setNome(painel.nome); setDescricao(painel.descricao ?? ""); setPublico(painel.publico);
    setTema(painel.config?.tema ?? "claro"); setAtualizar(painel.config?.atualizar_a_cada_seg ?? 0);
    setFiltros(painel.filtros ?? []); setConfirmarExcluir(false);
  }, [aberto, painel]);

  const salvar = async () => {
    if (!nome.trim()) { toast.error("Dê um nome ao painel."); return; }
    for (const f of filtros) {
      if (!chaveValida(f.chave)) { toast.error(`Chave "${f.chave}" inválida — use letras, números e _ (ex.: data_inicio).`); return; }
      if (!f.rotulo.trim()) { toast.error(`O filtro ${f.chave} precisa de um rótulo.`); return; }
    }
    if (new Set(filtros.map(f => f.chave)).size !== filtros.length) { toast.error("Duas chaves de filtro iguais."); return; }
    setSalvando(true);
    try {
      await onSalvar({
        id: painel.id, nome: nome.trim(), descricao: descricao.trim() || null, publico,
        filtros: filtros.map(f => ({ ...f, opcoes: f.tipo === "lista" ? (f.opcoes ?? []).filter(Boolean) : undefined })),
        config: { ...(painel.config ?? {}), tema, atualizar_a_cada_seg: atualizar > 0 ? atualizar : undefined },
      });
      onFechar();
    } catch (e) {
      toast.error("Não consegui salvar: " + (e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const mudarFiltro = (i: number, patch: Partial<FiltroPainel>) => setFiltros(fs => fs.map((f, j) => j === i ? { ...f, ...patch } : f));

  return (
    <Dialog open={aberto} onOpenChange={o => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar painel</DialogTitle>
          <DialogDescription>Nome, quem vê, filtros do topo e aparência.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div><Label>Nome *</Label><Input className="mt-1" value={nome} onChange={e => setNome(e.target.value)} /></div>
          <div><Label>Descrição</Label><Textarea className="mt-1" rows={2} value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Pra que serve este painel, quem usa…" /></div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span>Público<br /><span className="text-xs text-muted-foreground">quem tem o Estúdio vê</span></span>
              <Switch checked={publico} onCheckedChange={setPublico} />
            </label>
            <div>
              <Label className="text-xs">Tema</Label>
              <Select value={tema} onValueChange={v => setTema(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="claro">Claro</SelectItem><SelectItem value="escuro">Escuro (TV)</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Atualizar sozinho</Label>
              <Select value={String(atualizar)} onValueChange={v => setAtualizar(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Não</SelectItem>
                  <SelectItem value="60">A cada 1 min</SelectItem>
                  <SelectItem value="300">A cada 5 min</SelectItem>
                  <SelectItem value="900">A cada 15 min</SelectItem>
                  <SelectItem value="3600">A cada 1 h</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>Filtros do painel</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setFiltros(fs => [...fs, { chave: `filtro_${fs.length + 1}`, rotulo: "", tipo: "texto", padrao: "" }])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Filtro
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">Cada filtro vira <code>{"{{chave}}"}</code> nos SQLs. Ex.: <code>WHERE criado_em &gt;= {"{{inicio}}"}::date</code>. Vazio vira NULL — trate com <code>COALESCE</code> ou <code>OR {"{{x}}"} IS NULL</code>.</p>
            <div className="space-y-2">
              {filtros.length === 0 && <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">Sem filtros. O painel mostra tudo.</p>}
              {filtros.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_110px_1fr_auto] items-end gap-2 rounded-lg border p-2">
                  <div><Label className="text-[10px]">Chave</Label><Input className="mt-0.5 h-8 font-mono text-xs" value={f.chave} onChange={e => mudarFiltro(i, { chave: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })} /></div>
                  <div><Label className="text-[10px]">Rótulo</Label><Input className="mt-0.5 h-8 text-xs" value={f.rotulo} onChange={e => mudarFiltro(i, { rotulo: e.target.value })} placeholder="Data inicial" /></div>
                  <div>
                    <Label className="text-[10px]">Tipo</Label>
                    <Select value={f.tipo} onValueChange={v => mudarFiltro(i, { tipo: v as FiltroPainel["tipo"] })}>
                      <SelectTrigger className="mt-0.5 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="texto">Texto</SelectItem><SelectItem value="data">Data</SelectItem>
                        <SelectItem value="numero">Número</SelectItem><SelectItem value="lista">Lista</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px]">{f.tipo === "lista" ? "Opções (vírgula)" : "Padrão"}</Label>
                    {f.tipo === "lista"
                      ? <Input className="mt-0.5 h-8 text-xs" value={(f.opcoes ?? []).join(", ")} onChange={e => mudarFiltro(i, { opcoes: e.target.value.split(",").map(s => s.trim()) })} placeholder="A, B, C" />
                      : <Input className="mt-0.5 h-8 text-xs" type={f.tipo === "data" ? "date" : f.tipo === "numero" ? "number" : "text"} value={f.padrao ?? ""} onChange={e => mudarFiltro(i, { padrao: e.target.value })} />}
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setFiltros(fs => fs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          {onExcluir ? (
            !confirmarExcluir
              ? <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirmarExcluir(true)}><Trash2 className="mr-1.5 h-4 w-4" /> Excluir painel</Button>
              : <div className="flex items-center gap-2 text-sm"><span>Excluir mesmo? Leva os gráficos junto.</span><Button type="button" variant="destructive" size="sm" onClick={onExcluir}>Sim, excluir</Button><Button type="button" variant="ghost" size="sm" onClick={() => setConfirmarExcluir(false)}>Não</Button></div>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>{salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
