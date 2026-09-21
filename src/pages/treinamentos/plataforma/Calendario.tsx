import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTrnCursos, useTrnEventos, useTrnExcluirEvento, useTrnSalvarEvento } from "@/hooks/useTreinamentosPlataforma";
import { MENU, type Evento, type Publico } from "./tipos";
import { PublicoPicker, TrnEstilo, TrnHero } from "./ui";

// =====================================================================
// TREINAMENTOS — Comunicação › Calendário. No membox está desabilitado
// na conta do Grupo; aqui nasce funcionando: grade mensal com eventos
// (aula ao vivo, prazo de curso, treinamento presencial…), público por
// tags e vínculo opcional com um curso.
// =====================================================================

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const CORES = ["#1d4ed8", "#f26522", "#0f766e", "#7c3aed", "#be123c", "#b45309"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const localInput = (isoTs: string) => { const d = new Date(isoTs); return `${iso(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

interface Form { id?: string; titulo: string; descricao: string; inicio: string; fim: string; dia_inteiro: boolean; local: string; url: string; cor: string; publico: Publico; tagIds: string[]; curso_id: string }

export default function Calendario() {
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const ini = useMemo(() => new Date(ref.getFullYear(), ref.getMonth(), 1), [ref]);
  const fim = useMemo(() => new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59), [ref]);
  const { data: eventos = [] } = useTrnEventos(ini.toISOString(), fim.toISOString());
  const { data: cursos = [] } = useTrnCursos();
  const salvar = useTrnSalvarEvento();
  const excluir = useTrnExcluirEvento();
  const [f, setF] = useState<Form | null>(null);
  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x));

  const grade = useMemo(() => {
    const primeiro = ini.getDay();
    const dias = fim.getDate();
    const celulas: (Date | null)[] = Array.from({ length: primeiro }, () => null);
    for (let d = 1; d <= dias; d++) celulas.push(new Date(ref.getFullYear(), ref.getMonth(), d));
    while (celulas.length % 7) celulas.push(null);
    return celulas;
  }, [ini, fim, ref]);
  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>();
    eventos.forEach((e) => { const k = iso(new Date(e.inicio_em)); m.set(k, [...(m.get(k) ?? []), e]); });
    return m;
  }, [eventos]);

  const abrir = (e?: Evento, dia?: Date) => {
    const base = dia ?? new Date();
    setF(e ? { id: e.id, titulo: e.titulo, descricao: e.descricao ?? "", inicio: localInput(e.inicio_em), fim: e.fim_em ? localInput(e.fim_em) : "", dia_inteiro: e.dia_inteiro, local: e.local ?? "", url: e.url ?? "", cor: e.cor ?? CORES[0], publico: e.publico, tagIds: (e.tags ?? []).map((t) => t.tag_id), curso_id: e.curso_id ?? "" }
      : { titulo: "", descricao: "", inicio: `${iso(base)}T09:00`, fim: "", dia_inteiro: false, local: "", url: "", cor: CORES[0], publico: "todos", tagIds: [], curso_id: "" });
  };
  const gravar = async () => {
    if (!f) return;
    if (!f.titulo.trim()) return toast.error("Informe o título.");
    if (!f.inicio) return toast.error("Informe a data/hora de início.");
    if (f.fim && f.fim < f.inicio) return toast.error("O fim não pode ser antes do início.");
    if (f.publico === "tags" && !f.tagIds.length) return toast.error("Escolha ao menos uma tag.");
    try {
      await salvar.mutateAsync({ id: f.id, titulo: f.titulo.trim(), descricao: f.descricao.trim() || null, inicio_em: new Date(f.inicio).toISOString(), fim_em: f.fim ? new Date(f.fim).toISOString() : null,
        dia_inteiro: f.dia_inteiro, local: f.local.trim() || null, url: f.url.trim() || null, cor: f.cor, publico: f.publico, tagIds: f.tagIds, curso_id: f.curso_id || null });
      toast.success(f.id ? "Evento atualizado." : "Evento criado."); setF(null);
    } catch (e: any) { toast.error(e?.message ?? "Não deu para salvar."); }
  };
  const apagar = async () => {
    if (!f?.id || !window.confirm("Excluir este evento?")) return;
    try { await excluir.mutateAsync(f.id); toast.success("Evento excluído."); setF(null); } catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };
  const mes = ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const hoje = iso(new Date());

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.calendario} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para o calendário.</Card>}>
        <TrnHero eyebrow="Treinamentos › Comunicação" titulo="Calendário" texto="Aulas ao vivo, prazos e treinamentos presenciais — o aluno vê o que for do público dele."
                 acoes={<AcessoGate menu={MENU.calendario} acao="incluir"><button onClick={() => abrir()}><Plus className="h-4 w-4" /> Adicionar evento</button></AcessoGate>} />
        <div className="trn-card p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="flex items-center gap-2 text-sm font-black capitalize text-slate-900"><CalendarDays className="h-4 w-4 text-orange-500" /> {mes}</div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); d.setDate(1); setRef(d); }}>Hoje</Button>
              <Button variant="outline" size="sm" onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-b bg-slate-50 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">{DIAS.map((d) => <div key={d} className="py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {grade.map((d, i) => {
              const k = d ? iso(d) : "";
              const evs = d ? porDia.get(k) ?? [] : [];
              return (
                <div key={i} className={`min-h-[96px] border-b border-r p-1.5 ${d ? "cursor-pointer hover:bg-slate-50" : "bg-slate-50/60"}`} onClick={() => d && abrir(undefined, d)}>
                  {d && <div className={`mb-1 inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${k === hoje ? "bg-orange-500 text-white" : "text-slate-600"}`}>{d.getDate()}</div>}
                  {evs.map((e) => (
                    <button key={e.id} type="button" onClick={(ev) => { ev.stopPropagation(); abrir(e); }}
                            className="mb-1 block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-semibold text-white" style={{ background: e.cor ?? CORES[0] }} title={e.titulo}>
                      {!e.dia_inteiro && `${new Date(e.inicio_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} `}{e.titulo}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <Dialog open={!!f} onOpenChange={(o) => !o && setF(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{f?.id ? "Editar evento" : "Adicionar evento"}</DialogTitle></DialogHeader>
            {f && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><Label className="text-xs">Título *</Label><Input value={f.titulo} onChange={(e) => set({ titulo: e.target.value })} /></div>
                <div><Label className="text-xs">Início *</Label><Input type={f.dia_inteiro ? "date" : "datetime-local"} value={f.dia_inteiro ? f.inicio.slice(0, 10) : f.inicio} onChange={(e) => set({ inicio: f.dia_inteiro ? `${e.target.value}T00:00` : e.target.value })} /></div>
                <div><Label className="text-xs">Fim (opcional)</Label><Input type={f.dia_inteiro ? "date" : "datetime-local"} value={f.dia_inteiro ? f.fim.slice(0, 10) : f.fim} onChange={(e) => set({ fim: e.target.value ? (f.dia_inteiro ? `${e.target.value}T23:59` : e.target.value) : "" })} /></div>
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={f.dia_inteiro} onCheckedChange={(v) => set({ dia_inteiro: v })} /> Dia inteiro</label>
                <div><Label className="text-xs">Local</Label><Input value={f.local} onChange={(e) => set({ local: e.target.value })} placeholder="Sala, unidade ou 'online'" /></div>
                <div><Label className="text-xs">Link (opcional)</Label><Input value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://meet…" /></div>
                <div className="sm:col-span-2"><Label className="text-xs">Descrição</Label><Textarea rows={3} value={f.descricao} onChange={(e) => set({ descricao: e.target.value })} /></div>
                <div><Label className="text-xs">Curso relacionado (opcional)</Label>
                  <Select value={f.curso_id || "__"} onValueChange={(v) => set({ curso_id: v === "__" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="__">Nenhum</SelectItem>{cursos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent></Select></div>
                <div><Label className="text-xs">Cor</Label><div className="mt-1 flex gap-2">{CORES.map((c) => <button key={c} type="button" onClick={() => set({ cor: c })} className={`h-7 w-7 rounded-full border-2 ${f.cor === c ? "border-slate-900" : "border-transparent"}`} style={{ background: c }} />)}</div></div>
                <div className="sm:col-span-2"><Label className="mb-2 block text-xs">Público</Label><PublicoPicker publico={f.publico} tagIds={f.tagIds} onPublico={(p) => set({ publico: p })} onTags={(ids) => set({ tagIds: ids })} /></div>
              </div>
            )}
            <DialogFooter className="flex-wrap gap-2">
              {f?.id && <AcessoGate menu={MENU.calendario} acao="excluir"><Button variant="ghost" className="mr-auto text-rose-600" onClick={apagar}><Trash2 className="mr-1 h-4 w-4" /> Excluir</Button></AcessoGate>}
              <Button variant="outline" onClick={() => setF(null)}>Cancelar</Button>
              <AcessoGate menu={MENU.calendario} acao={f?.id ? "alterar" : "incluir"}><Button disabled={salvar.isPending} onClick={gravar}>Salvar</Button></AcessoGate>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AcessoGate>
    </div>
  );
}
