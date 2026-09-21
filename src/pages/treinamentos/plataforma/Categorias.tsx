import { useState } from "react";
import { toast } from "sonner";
import { FolderTree, MoreVertical, Plus } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTrnCategorias, useTrnCursos, useTrnExcluirCategoria, useTrnSalvarCategoria } from "@/hooks/useTreinamentosPlataforma";
import { MENU, type Categoria } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero, TrnVazio } from "./ui";

// =====================================================================
// TREINAMENTOS — Cursos › Categorias. Agrupam os cursos na vitrine.
// =====================================================================

export default function Categorias() {
  const { data: categorias = [], isLoading } = useTrnCategorias();
  const { data: cursos = [] } = useTrnCursos();
  const salvar = useTrnSalvarCategoria();
  const excluir = useTrnExcluirCategoria();
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [nome, setNome] = useState("");
  const [ordem, setOrdem] = useState("100");
  const [ativo, setAtivo] = useState(true);

  const abrir = (c?: Categoria) => { setEditando(c ?? null); setNome(c?.nome ?? ""); setOrdem(String(c?.ordem ?? 100)); setAtivo(c?.ativo ?? true); setAberto(true); };
  const gravar = async () => {
    if (!nome.trim()) return toast.error("Informe o nome.");
    try { await salvar.mutateAsync({ id: editando?.id, nome, ordem: Number(ordem) || 100, ativo }); toast.success("Categoria salva."); setAberto(false); }
    catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };
  const apagar = async (c: Categoria) => {
    const n = cursos.filter((x) => x.categoria_id === c.id).length;
    if (!window.confirm(`Excluir "${c.nome}"? ${n ? `${n} curso(s) ficam sem categoria.` : ""}`)) return;
    try { await excluir.mutateAsync(c.id); toast.success("Categoria excluída."); } catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };

  return (
    <div className="trn mx-auto max-w-6xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.categorias} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para as categorias.</Card>}>
        <TrnHero eyebrow="Treinamentos › Cursos" titulo="Categorias de cursos" texto="Torne seus cursos mais organizados: cada categoria vira um bloco na vitrine da área do aluno."
                 acoes={<AcessoGate menu={MENU.categorias} acao="incluir"><button onClick={() => abrir()}><Plus className="h-4 w-4" /> Adicionar categoria</button></AcessoGate>} />
        {isLoading ? <TrnCarregando /> : categorias.length === 0 ? (
          <TrnVazio titulo="Você ainda não criou uma categoria" texto="Torne seus cursos ainda mais organizados com as categorias." acao={<Button onClick={() => abrir()}>Adicionar categoria</Button>} />
        ) : (
          <div className="trn-card p-0">
            <table className="trn-tab">
              <thead><tr><th>Categoria</th><th>Ordem</th><th>Cursos</th><th>Status</th><th /></tr></thead>
              <tbody>
                {categorias.map((c) => (
                  <tr key={c.id}>
                    <td className="font-semibold"><FolderTree className="mr-2 inline h-4 w-4 text-slate-400" />{c.nome}</td>
                    <td>{c.ordem}</td>
                    <td>{cursos.filter((x) => x.categoria_id === c.id).length}</td>
                    <td><span className={`trn-badge ${c.ativo ? "ok" : "off"}`}>{c.ativo ? "Ativa" : "Inativa"}</span></td>
                    <td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => abrir(c)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem className="text-rose-600" onSelect={() => apagar(c)}>Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editando ? "Editar categoria" : "Adicionar categoria"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">Nome *</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === "Enter" && gravar()} /></div>
              <div><Label className="text-xs">Ordem</Label><Input inputMode="numeric" value={ordem} onChange={(e) => setOrdem(e.target.value)} /></div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={ativo} onCheckedChange={setAtivo} /> Ativa (aparece na vitrine)</label>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button><Button disabled={salvar.isPending} onClick={gravar}>Salvar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </AcessoGate>
    </div>
  );
}
