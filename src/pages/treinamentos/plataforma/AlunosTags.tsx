import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { MoreVertical, Plus, Tag as TagIcon } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTrnExcluirTag, useTrnSalvarTag, useTrnTags } from "@/hooks/useTreinamentosPlataforma";
import { MENU, type Tag } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero, TrnVazio } from "./ui";

// =====================================================================
// TREINAMENTOS — Alunos › Tags. Cartões com o nº de alunos vinculados,
// busca, adicionar/renomear/excluir. Clicar no cartão abre a lista de
// alunos já filtrada pela tag.
// =====================================================================

const CORES = ["#4338ca", "#0f766e", "#b45309", "#be123c", "#7c3aed", "#0369a1", "#15803d", "#475569"];

export default function AlunosTags() {
  const { data: tags = [], isLoading } = useTrnTags();
  const salvar = useTrnSalvarTag();
  const excluir = useTrnExcluirTag();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Tag | null>(null);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState<string | null>(null);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return b ? tags.filter((t) => t.nome.toLowerCase().includes(b)) : tags;
  }, [tags, busca]);

  const abrir = (t?: Tag) => { setEditando(t ?? null); setNome(t?.nome ?? ""); setCor(t?.cor ?? null); setAberto(true); };
  const gravar = async () => {
    if (!nome.trim()) return toast.error("Informe o nome da tag.");
    try { await salvar.mutateAsync({ id: editando?.id, nome, cor }); toast.success(editando ? "Tag atualizada." : "Tag criada."); setAberto(false); }
    catch (e: any) { toast.error(/uq_trn_tag_nome|duplicate/i.test(e?.message ?? "") ? "Já existe uma tag com esse nome." : (e?.message ?? "Não deu para salvar.")); }
  };
  const apagar = async (t: Tag) => {
    if (!window.confirm(`Excluir a tag "${t.nome}"? Ela sai de ${t.alunos ?? 0} aluno(s).`)) return;
    try { await excluir.mutateAsync(t.id); toast.success("Tag excluída."); }
    catch (e: any) { toast.error(e?.message ?? "Não deu para excluir."); }
  };

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.alunosTags} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para as tags.</Card>}>
        <TrnHero eyebrow="Treinamentos › Alunos" titulo="Tags de alunos" texto={`${tags.length} tag(s) cadastrada(s). No membox as tags são os postos/contratos — use do mesmo jeito para segmentar avisos, notificações e ações em massa.`}
                 acoes={<AcessoGate menu={MENU.alunosTags} acao="incluir"><button onClick={() => abrir()}><Plus className="h-4 w-4" /> Adicionar tag</button></AcessoGate>} />

        <div className="trn-card mb-3"><Input placeholder="Buscar tags" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>

        {isLoading ? <TrnCarregando /> : tags.length === 0 ? (
          <TrnVazio titulo="Nenhuma tag ainda" texto="Crie tags para os postos/contratos e segmente sua comunicação." acao={<Button onClick={() => abrir()}>Adicionar tag</Button>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lista.map((t) => (
              <div key={t.id} className="trn-card flex items-start justify-between gap-2">
                <Link to={`/app/treinamentos/alunos?tag=${t.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: t.cor ?? "#4338ca" }} />
                    <b className="truncate text-sm text-slate-900">{t.nome}</b>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{t.alunos ? `${t.alunos} aluno(s) vinculado(s)` : "Nenhum aluno vinculado"}</div>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => abrir(t)}>Editar</DropdownMenuItem>
                    <DropdownMenuItem className="text-rose-600" onSelect={() => apagar(t)}>Excluir</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            {lista.length === 0 && <div className="trn-vazio sm:col-span-3">Nenhuma tag bate com a busca.</div>}
          </div>
        )}

        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle><TagIcon className="mr-2 inline h-4 w-4" />{editando ? "Editar tag" : "Adicionar tag"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">Nome *</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: FURG HU" onKeyDown={(e) => e.key === "Enter" && gravar()} /></div>
              <div>
                <Label className="text-xs">Cor (opcional)</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {CORES.map((c) => <button key={c} type="button" onClick={() => setCor(c)} className={`h-7 w-7 rounded-full border-2 ${cor === c ? "border-slate-900" : "border-transparent"}`} style={{ background: c }} />)}
                  <button type="button" onClick={() => setCor(null)} className="text-xs text-muted-foreground">sem cor</button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
              <Button disabled={salvar.isPending} onClick={gravar}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AcessoGate>
    </div>
  );
}
