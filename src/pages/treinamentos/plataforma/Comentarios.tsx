import { useState } from "react";
import { toast } from "sonner";
import { MessageSquare, Reply, Trash2 } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTrnComentarios, useTrnCursos, useTrnExcluirComentario, useTrnModerarComentario } from "@/hooks/useTreinamentosPlataforma";
import { MENU, type Comentario, type StatusComentario } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero, fmtDataHora } from "./ui";

// =====================================================================
// TREINAMENTOS — Cursos › Comentários (moderação).
// Abas Todos/Aprovados/Pendentes/Rejeitados, filtro por curso, tabela com
// comentário, resposta, aluno, status, data e "Mudar status" + responder.
// A triagem por IA do membox fica de fora nesta fase.
// =====================================================================

const ROTULO: Record<StatusComentario, string> = { pendente: "Pendente", aprovado: "Publicado", rejeitado: "Rejeitado" };
const COR: Record<StatusComentario, string> = { pendente: "warn", aprovado: "ok", rejeitado: "err" };

export default function Comentarios() {
  const [aba, setAba] = useState<StatusComentario | "todos">("todos");
  const [curso, setCurso] = useState("");
  const { data: lista = [], isLoading } = useTrnComentarios(aba, curso || null);
  const { data: cursos = [] } = useTrnCursos();
  const moderar = useTrnModerarComentario();
  const excluir = useTrnExcluirComentario();
  const [respondendo, setRespondendo] = useState<Comentario | null>(null);
  const [resposta, setResposta] = useState("");

  const mudar = async (c: Comentario, status: StatusComentario) => {
    try { await moderar.mutateAsync({ id: c.id, status }); toast.success(`Comentário ${ROTULO[status].toLowerCase()}.`); }
    catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };
  const responder = async () => {
    if (!respondendo) return;
    try { await moderar.mutateAsync({ id: respondendo.id, resposta: resposta.trim() || null, status: "aprovado" }); toast.success("Resposta publicada."); setRespondendo(null); }
    catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.comentarios} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para os comentários.</Card>}>
        <TrnHero eyebrow="Treinamentos › Cursos" titulo="Todos os comentários" texto="O que os alunos escrevem nas aulas. Comentário pendente não aparece para os outros alunos até ser publicado." />
        <div className="trn-card mb-3 flex flex-wrap items-center gap-3">
          <Tabs value={aba} onValueChange={(v) => setAba(v as typeof aba)}>
            <TabsList><TabsTrigger value="todos">Todos</TabsTrigger><TabsTrigger value="aprovado">Aprovados</TabsTrigger><TabsTrigger value="pendente">Pendentes</TabsTrigger><TabsTrigger value="rejeitado">Rejeitados</TabsTrigger></TabsList>
          </Tabs>
          <Select value={curso || "__"} onValueChange={(v) => setCurso(v === "__" ? "" : v)}>
            <SelectTrigger className="ml-auto w-64"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__">Todos os cursos</SelectItem>{cursos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {isLoading ? <TrnCarregando /> : (
          <div className="trn-card p-0">
            <table className="trn-tab">
              <thead><tr><th>Comentário</th><th>Resposta</th><th>Aluno</th><th>Status</th><th>Data / hora</th><th>Ação</th></tr></thead>
              <tbody>
                {lista.length === 0 && <tr><td colSpan={6} className="trn-vazio"><MessageSquare className="mx-auto mb-2 h-6 w-6 text-slate-300" />Nenhum comentário aqui.</td></tr>}
                {lista.map((c) => (
                  <tr key={c.id}>
                    <td style={{ maxWidth: 360 }}>
                      <div className="line-clamp-2 text-slate-800" title={c.texto}>{c.texto}</div>
                      <div className="text-[11px] text-slate-400">{c.aula?.modulo?.curso?.nome ?? "—"} · {c.aula?.nome ?? ""}</div>
                    </td>
                    <td style={{ maxWidth: 240 }}>{c.resposta ? <div className="line-clamp-2 text-xs text-slate-600" title={c.resposta}>{c.resposta}</div> : <span className="text-xs text-slate-400">Não</span>}</td>
                    <td><div className="font-semibold">{c.aluno?.nome ?? "—"}</div><div className="text-[11px] text-slate-400">{c.aluno?.email}</div></td>
                    <td><span className={`trn-badge ${COR[c.status]}`}>{ROTULO[c.status]}</span></td>
                    <td className="whitespace-nowrap text-xs">{fmtDataHora(c.created_at)}</td>
                    <td>
                      <AcessoGate menu={MENU.comentarios} acao="alterar" fallback={<span className="text-xs text-slate-400">só leitura</span>}>
                        <div className="flex flex-wrap gap-1">
                          <Select value={c.status} onValueChange={(v) => mudar(c, v as StatusComentario)}>
                            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{(Object.keys(ROTULO) as StatusComentario[]).map((s) => <SelectItem key={s} value={s}>{ROTULO[s]}</SelectItem>)}</SelectContent>
                          </Select>
                          <Button variant="outline" size="sm" className="h-8" onClick={() => { setRespondendo(c); setResposta(c.resposta ?? ""); }}><Reply className="h-3.5 w-3.5" /></Button>
                          <AcessoGate menu={MENU.comentarios} acao="excluir">
                            <Button variant="ghost" size="sm" className="h-8 text-rose-600" onClick={async () => { if (window.confirm("Excluir este comentário?")) { try { await excluir.mutateAsync(c.id); } catch (e: any) { toast.error(e?.message ?? "Não deu."); } } }}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </AcessoGate>
                        </div>
                      </AcessoGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">Total: {lista.length} comentário(s)</div>
          </div>
        )}

        <Dialog open={!!respondendo} onOpenChange={(o) => !o && setRespondendo(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Responder comentário</DialogTitle></DialogHeader>
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{respondendo?.aluno?.nome}</b>: {respondendo?.texto}</div>
            <Textarea rows={4} placeholder="Sua resposta (aparece abaixo do comentário para o aluno)" value={resposta} onChange={(e) => setResposta(e.target.value)} />
            <DialogFooter><Button variant="outline" onClick={() => setRespondendo(null)}>Cancelar</Button><Button disabled={moderar.isPending} onClick={responder}>Publicar resposta</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </AcessoGate>
    </div>
  );
}
