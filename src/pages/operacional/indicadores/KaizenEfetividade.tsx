import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleDollarSign, ClipboardCheck, Clock3, Lightbulb, Pencil, Plus, Ruler, Trash2, TrendingUp } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CabecalhoIndicador, GradeCarregando, Kpi, SemDados } from "@/components/indicadores/IndicadoresUi";
import { supabase } from "@/integrations/supabase/client";
import { resumirKaizen, sobreTotal, STATUS_KAIZEN, type Iniciativa, type StatusKaizen } from "@/lib/operacional/indicadoresKaizen";
import { fmtBRL } from "@/lib/operacional/painelExecutivo";
import { useScreenAccess } from "@/hooks/useScreenAccess";

// =====================================================================
// Operacional › Indicadores › 5. KAIZEN E EFETIVIDADE (09/11/2026)
// Tabela OPE_KAIZEN_INICIATIVA (mig 20261109003300): quem vê, inclui, altera
// e exclui é a RLS, pela permissão da tela. Os botões só aparecem para quem pode.
// =====================================================================

const MENU = "ope_indicadores_kaizen";
const TABELA = "OPE_KAIZEN_INICIATIVA";
const CHAVE = ["ope-kaizen"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const hojeIso = () => new Date().toISOString().slice(0, 10);
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

const COR_STATUS: Record<StatusKaizen, string> = {
  Planejada: "bg-slate-100 text-slate-700 border-slate-200",
  "Em andamento": "bg-amber-100 text-amber-800 border-amber-200",
  Concluída: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Cancelada: "bg-zinc-100 text-zinc-500 border-zinc-200 line-through",
};

type Rascunho = Omit<Iniciativa, "id" | "concluida_em" | "economia"> & { id?: number; economia: string };
const vazio = (): Rascunho => ({ titulo: "", area: "", descricao: "", data_inicio: hojeIso(), prazo: null, status: "Em andamento", resultado: "", economia: "" });

function FormIniciativa({ inicial, onFechar }: { inicial: Rascunho; onFechar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Rascunho>(inicial);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setF((x) => ({ ...x, [k]: v }));
  const salvar = useMutation({
    mutationFn: async () => {
      const economia = f.economia.trim() === "" ? null : Number(f.economia.replace(/\./g, "").replace(",", "."));
      if (economia != null && !(economia >= 0)) throw new Error("Economia inválida.");
      const linha = {
        titulo: f.titulo.trim(), area: f.area.trim(), descricao: f.descricao?.trim() || null, data_inicio: f.data_inicio,
        prazo: f.prazo || null, status: f.status, resultado: f.resultado?.trim() || null, economia,
      };
      const q = f.id ? sb.from(TABELA).update(linha).eq("id", f.id).select("id") : sb.from(TABELA).insert(linha).select("id");
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para salvar.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE }); toast.success("Iniciativa salva."); onFechar(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ok = f.titulo.trim().length >= 3 && f.area.trim().length >= 2 && !!f.data_inicio && (!f.prazo || f.prazo >= f.data_inicio);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{f.id ? "Editar iniciativa" : "Nova iniciativa"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Título</Label><Input value={f.titulo} maxLength={200} onChange={(e) => set("titulo", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Área responsável</Label><Input value={f.area} maxLength={120} onChange={(e) => set("area", e.target.value)} placeholder="Ex.: Controladoria" /></div>
            <div>
              <Label>Status</Label>
              <Select value={f.status} onValueChange={(v) => set("status", v as StatusKaizen)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_KAIZEN.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Início</Label><Input type="date" value={f.data_inicio} onChange={(e) => set("data_inicio", e.target.value)} /></div>
            <div><Label>Prazo</Label><Input type="date" value={f.prazo ?? ""} onChange={(e) => set("prazo", e.target.value || null)} /></div>
          </div>
          <div><Label>Descrição</Label><Textarea rows={2} value={f.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)} /></div>
          <div><Label>Resultado obtido</Label><Textarea rows={2} value={f.resultado ?? ""} onChange={(e) => set("resultado", e.target.value)} placeholder="O que mudou, medido (ex.: redução de 40% no tempo)" /></div>
          <div><Label>Economia por mês (R$)</Label><Input inputMode="decimal" value={f.economia} onChange={(e) => set("economia", e.target.value)} placeholder="Deixe em branco se não for mensurável" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={!ok || salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function KaizenEfetividade() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const { data: podeAlterar } = useScreenAccess(MENU, "alterar");
  const { data: podeExcluir } = useScreenAccess(MENU, "excluir");
  const q = useQuery({
    queryKey: CHAVE,
    queryFn: async (): Promise<Iniciativa[]> => {
      const { data, error } = await sb.from(TABELA)
        .select("id, titulo, area, descricao, data_inicio, prazo, status, resultado, economia, concluida_em")
        .order("data_inicio", { ascending: false }).order("id", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Iniciativa[];
    },
  });
  const excluir = useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await sb.from(TABELA).delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para excluir.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE }); toast.success("Iniciativa excluída."); },
    onError: (e: Error) => toast.error(e.message),
  });
  const r = useMemo(() => (q.data ? resumirKaizen(q.data, hojeIso()) : null), [q.data]);
  const pct = (n: number) => { const p = r ? sobreTotal(n, r.total) : null; return p != null ? `${p.toLocaleString("pt-BR")}% do total` : null; };

  return (
    <AcessoGate menu={MENU} acao="visualizar" fallback={<SemDados texto="Você não tem acesso a esta tela." />}>
      <div className="space-y-5">
        <CabecalhoIndicador numero={5} titulo="Kaizen e Efetividade" icone={Lightbulb}
          descricao="Iniciativas de melhoria contínua e os resultados obtidos."
          extra={<AcessoGate menu={MENU} acao="incluir"><Button className="gap-1.5" onClick={() => setEditando(vazio())}><Plus className="h-4 w-4" /> Nova iniciativa</Button></AcessoGate>} />
        {q.isError ? <SemDados texto="Não foi possível carregar as iniciativas." /> : !r ? <GradeCarregando n={6} /> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <Kpi titulo="Total de Iniciativas" valor={String(r.total)} icone={ClipboardCheck} cor="azul" aviso="Sem as canceladas" />
              <Kpi titulo="Concluídas" valor={String(r.concluidas)} icone={CheckCircle2} cor="verde" aviso={pct(r.concluidas)} />
              <Kpi titulo="Em Andamento" valor={String(r.andamento)} icone={TrendingUp} cor="laranja" aviso={pct(r.andamento)} />
              <Kpi titulo="Resultados Mensurados" valor={String(r.mensurados)} icone={Ruler} cor="azul" aviso={pct(r.mensurados)} />
              <Kpi titulo="Economia Gerada" valor={fmtBRL(r.economia)} icone={CircleDollarSign} cor="verde" aviso="Por mês, das concluídas" />
              <Kpi titulo="Entregues no Prazo" valor={r.noPrazo != null ? `${r.noPrazo.toLocaleString("pt-BR")}%` : null} icone={Clock3} cor="verde"
                aviso={r.noPrazo == null ? "Nenhuma concluída com prazo" : r.atrasadas ? `${r.atrasadas} em aberto com prazo vencido` : "Das concluídas com prazo"} />
            </div>
            <Tabs defaultValue="lista">
              <TabsList>
                <TabsTrigger value="lista">Lista de Iniciativas</TabsTrigger>
                <TabsTrigger value="area">Por Área</TabsTrigger>
              </TabsList>
              <TabsContent value="lista" className="mt-4">
                <Card className="overflow-x-auto p-2">
                  {!q.data?.length ? <SemDados texto="Nenhuma iniciativa cadastrada ainda" altura={120} /> : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Título</TableHead><TableHead>Área</TableHead><TableHead>Início</TableHead><TableHead>Prazo</TableHead>
                          <TableHead>Status</TableHead><TableHead>Resultado</TableHead><TableHead className="text-right">Economia</TableHead><TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {q.data.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell className="max-w-[18rem]"><p className="truncate font-medium">{i.titulo}</p></TableCell>
                            <TableCell>{i.area}</TableCell>
                            <TableCell className="tabular-nums">{dataBr(i.data_inicio)}</TableCell>
                            <TableCell className={`tabular-nums ${i.status !== "Concluída" && i.status !== "Cancelada" && i.prazo && i.prazo < hojeIso() ? "text-red-600" : ""}`}>{dataBr(i.prazo)}</TableCell>
                            <TableCell><Badge variant="outline" className={COR_STATUS[i.status]}>{i.status}</Badge></TableCell>
                            <TableCell className="max-w-[16rem] truncate text-muted-foreground">{i.resultado || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{i.economia != null ? fmtBRL(Number(i.economia)) : "—"}</TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              {podeAlterar && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Editar" onClick={() => setEditando({ ...i, economia: i.economia != null ? String(i.economia).replace(".", ",") : "" })}><Pencil className="h-3.5 w-3.5" /></Button>}
                              {podeExcluir && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" aria-label="Excluir" onClick={() => { if (window.confirm(`Excluir "${i.titulo}"?`)) excluir.mutate(i.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Card>
              </TabsContent>
              <TabsContent value="area" className="mt-4">
                <Card className="overflow-x-auto p-2">
                  {!r.porArea.length ? <SemDados texto="Nenhuma iniciativa cadastrada ainda" altura={120} /> : (
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Área</TableHead><TableHead className="text-right">Iniciativas</TableHead><TableHead className="text-right">Concluídas</TableHead><TableHead className="text-right">Economia por mês</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.porArea.map((a) => (
                          <TableRow key={a.area}>
                            <TableCell>{a.area}</TableCell>
                            <TableCell className="text-right tabular-nums">{a.total}</TableCell>
                            <TableCell className="text-right tabular-nums">{a.concluidas}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtBRL(a.economia)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
        {editando && <FormIniciativa inicial={editando} onFechar={() => setEditando(null)} />}
      </div>
    </AcessoGate>
  );
}
