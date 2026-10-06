import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AcessoGate } from "@/components/auth/AcessoGate";
import {
  useCtrlAcoes, useCtrlExcluirAcao, useCtrlRegistros, useCtrlSalvarAcao, type Acao, type Registro, type SituacaoAcao,
} from "@/hooks/useReunioesEncarregados";
import { TEMAS } from "@/lib/controladoria/reunioes";
import { MENU_REUNIOES, ROTULO_SITUACAO, SeloSituacao, dataBR, semCodigo } from "./comum";

// =====================================================================
// Reuniões com Encarregados › Plano de ação (mig 20261006000005).
// A ação nasce do registro (botão "Ação" na revisão) ou solta. Responsável,
// prazo e situação são preenchidos por quem cria — nada é presumido.
// Atrasada = prazo vencido e não concluída (calculado na tela).
// =====================================================================

const VAZIA = { descricao: "", responsavel: "", prazo: "", situacao: "aberta" as SituacaoAcao, contrato: "", tema: "" };

export function DialogAcao({ aberto, registro, acao, onClose }: { aberto: boolean; registro?: Registro | null; acao?: Acao | null; onClose: () => void }) {
  const salvar = useCtrlSalvarAcao();
  const [f, setF] = useState(VAZIA);
  useEffect(() => {
    if (!aberto) return;
    if (acao) setF({ descricao: acao.descricao, responsavel: acao.responsavel ?? "", prazo: acao.prazo ?? "", situacao: acao.situacao, contrato: acao.contrato ?? "", tema: acao.tema ?? "" });
    else setF({ ...VAZIA, contrato: registro?.contrato ?? "", tema: registro?.tema ?? "" });
  }, [aberto, acao, registro]);

  const gravar = async () => {
    if (f.descricao.trim().length < 3) return toast.error("Descreva a ação.");
    try {
      await salvar.mutateAsync({
        id: acao?.id, descricao: f.descricao.trim(), responsavel: f.responsavel.trim() || null, prazo: f.prazo || null, situacao: f.situacao,
        contrato: f.contrato.trim() || null, tema: f.tema || null,
        ...(acao ? {} : { registro_id: registro?.id ?? null, reuniao_id: registro?.reuniao_id ?? null }),
      });
      toast.success(acao ? "Ação atualizada." : "Ação criada no plano.");
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{acao ? "Editar ação" : "Nova ação"}</DialogTitle></DialogHeader>
        {registro && <p className="rounded-md bg-muted px-3 py-2 text-xs italic">“{registro.trecho}”</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label className="text-xs">O que vai ser feito *</Label><Textarea rows={3} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <div><Label className="text-xs">Responsável</Label><Input value={f.responsavel} onChange={(e) => setF({ ...f, responsavel: e.target.value })} /></div>
          <div><Label className="text-xs">Prazo</Label><Input type="date" value={f.prazo} onChange={(e) => setF({ ...f, prazo: e.target.value })} /></div>
          <div>
            <Label className="text-xs">Situação</Label>
            <Select value={f.situacao} onValueChange={(v) => setF({ ...f, situacao: v as SituacaoAcao })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(ROTULO_SITUACAO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tema</Label>
            <Select value={f.tema || "__"} onValueChange={(v) => setF({ ...f, tema: v === "__" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__">—</SelectItem>{TEMAS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2"><Label className="text-xs">Contrato</Label><Input value={f.contrato} onChange={(e) => setF({ ...f, contrato: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={salvar.isPending} onClick={gravar}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PlanoAcao() {
  const { data: acoes = [], isLoading } = useCtrlAcoes();
  const { data: registros = [] } = useCtrlRegistros();
  const excluir = useCtrlExcluirAcao();
  const salvar = useCtrlSalvarAcao();
  const [situacao, setSituacao] = useState("abertas");
  const [editando, setEditando] = useState<Acao | null>(null);
  const [nova, setNova] = useState(false);
  const regPorId = useMemo(() => new Map(registros.map((r) => [r.id, r])), [registros]);

  const lista = acoes
    .filter((a) => situacao === "todas" || (situacao === "abertas" ? a.situacao !== "concluida" : a.situacao === "concluida"))
    .sort((a, b) => (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999"));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="abertas">Em aberto</SelectItem><SelectItem value="concluidas">Concluídas</SelectItem><SelectItem value="todas">Todas</SelectItem></SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{lista.length} ação(ões)</span>
        <AcessoGate menu={MENU_REUNIOES} acao="alterar">
          <Button size="sm" className="ml-auto" onClick={() => setNova(true)}><Plus className="mr-1 h-4 w-4" /> Nova ação</Button>
        </AcessoGate>
      </div>
      {isLoading ? <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card> : lista.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma ação aqui. Crie a partir de um registro em Revisar levantamento (botão "Ação").</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">Ação</th><th className="px-3 py-2 font-medium">Responsável</th><th className="px-3 py-2 font-medium">Prazo</th><th className="px-3 py-2 font-medium">Situação</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {lista.map((a) => {
                const r = a.registro_id ? regPorId.get(a.registro_id) : null;
                return (
                  <tr key={a.id} className="border-t align-top">
                    <td className="px-4 py-2">
                      <p className="font-medium">{a.descricao}</p>
                      <p className="text-xs text-muted-foreground">{[a.tema, semCodigo(a.contrato)].filter(Boolean).join(" · ")}</p>
                      {r && <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">“{r.trecho}”</p>}
                    </td>
                    <td className="px-3 py-2 text-xs">{a.responsavel ?? "—"}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{dataBR(a.prazo)}</td>
                    <td className="px-3 py-2">
                      <AcessoGate menu={MENU_REUNIOES} acao="alterar" fallback={<SeloSituacao situacao={a.situacao} prazo={a.prazo} />}>
                        <Select value={a.situacao} onValueChange={(v) => salvar.mutate({ id: a.id, descricao: a.descricao, situacao: v as SituacaoAcao }, { onError: (e) => toast.error((e as Error).message) })}>
                          <SelectTrigger className="h-8 w-36 text-xs"><SeloSituacao situacao={a.situacao} prazo={a.prazo} /></SelectTrigger>
                          <SelectContent>{Object.entries(ROTULO_SITUACAO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                      </AcessoGate>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <AcessoGate menu={MENU_REUNIOES} acao="alterar"><Button size="sm" variant="ghost" onClick={() => setEditando(a)}>Editar</Button></AcessoGate>
                      <AcessoGate menu={MENU_REUNIOES} acao="excluir">
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { if (!window.confirm("Excluir esta ação?")) return; try { await excluir.mutateAsync(a.id); } catch (e) { toast.error((e as Error).message); } }}><Trash2 className="h-4 w-4" /></Button>
                      </AcessoGate>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <DialogAcao aberto={nova || !!editando} acao={editando} onClose={() => { setNova(false); setEditando(null); }} />
    </div>
  );
}
