import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoreVertical, PenLine, Plus, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  useTrnAssinaturas, useTrnExcluirAssinatura, useTrnSalvarAssinatura, type AssinaturaComUso,
} from "@/hooks/useTreinamentosPlataforma";
import { MENU, type Assinatura } from "./tipos";
import { AssinaturaTraco, problemaAssinatura } from "./assinaturaFolha";
import { AssinaturaEditor, type RascunhoAssinatura } from "./AssinaturaEditor";
import { TrnCarregando, TrnEstilo, TrnHero, TrnVazio } from "./ui";

// =====================================================================
// TREINAMENTOS — Cursos › Assinaturas (mig 20261005000003).
//
// Quem tem o menu "Cursos — Assinaturas" cria a assinatura do treinador
// (desenhada ou escrita) e o curso a escolhe como ASSINATURA PRINCIPAL em
// Editar curso. Assinatura que já saiu em certificado não se apaga — só
// desativa (o certificado emitido continua mostrando a dele).
// =====================================================================

/** Nome do usuário logado (profiles.display_name — o Nome oficial quando vinculado à EMPREGADOS). */
function useMeuNome() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["perfil-nome", user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("display_name").eq("id", user!.id).maybeSingle();
      return (data?.display_name as string | null) ?? "";
    },
  }).data ?? "";
}

/** Diálogo de criar/editar assinatura. Devolve o id salvo em onSalvo. */
export function DialogAssinatura({ aberto, inicial, onClose, onSalvo }: {
  aberto: boolean; inicial?: Assinatura | null; onClose: () => void; onSalvo?: (id: string) => void;
}) {
  const { user } = useAuth();
  const meuNome = useMeuNome();
  const salvar = useTrnSalvarAssinatura();
  const [r, setR] = useState<RascunhoAssinatura>({ tipo: "desenho" });

  useEffect(() => {
    if (!aberto) return;
    setR(inicial ? { ...inicial } : { tipo: "desenho", nome_completo: meuNome, usuario_id: user?.id ?? null });
  }, [aberto, inicial, meuNome, user?.id]);

  const gravar = async () => {
    const p = problemaAssinatura(r);
    if (p) return toast.error(p);
    try {
      const id = await salvar.mutateAsync({ ...r, nome_completo: r.nome_completo!.trim(), cargo: r.cargo?.trim() || null, texto: r.texto?.trim() || null } as never);
      toast.success(inicial ? "Assinatura atualizada." : "Assinatura criada.");
      onSalvo?.(id);
      onClose();
    } catch (e) { toast.error((e as Error).message ?? "Não deu para salvar."); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><PenLine className="h-4 w-4" /> {inicial ? "Editar assinatura" : "Nova assinatura"}</DialogTitle></DialogHeader>
        <div className="trn"><div className="trn-form"><AssinaturaEditor valor={r} onChange={setR} /></div></div>
        {inicial && (inicial as AssinaturaComUso).certificados > 0 && (
          <p className="text-xs text-amber-700">Certificados já emitidos com esta assinatura também passam a mostrar a versão nova.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={salvar.isPending} onClick={gravar}><Save className="mr-2 h-4 w-4" /> {inicial ? "Salvar" : "Criar assinatura"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Assinaturas() {
  const { data: lista = [], isLoading } = useTrnAssinaturas();
  const salvar = useTrnSalvarAssinatura();
  const excluir = useTrnExcluirAssinatura();
  const [dialogo, setDialogo] = useState<{ inicial: Assinatura | null } | null>(null);

  const alternarAtivo = async (a: AssinaturaComUso) => {
    try {
      await salvar.mutateAsync({ ...a, ativo: !a.ativo });
      toast.success(a.ativo ? "Assinatura desativada — não pode mais ser escolhida em cursos." : "Assinatura reativada.");
    } catch (e) { toast.error((e as Error).message); }
  };
  const apagar = async (a: AssinaturaComUso) => {
    const aviso = a.cursos ? ` ${a.cursos} curso(s) usam esta assinatura e passam a emitir certificado sem assinatura.` : "";
    if (!window.confirm(`Excluir a assinatura de ${a.nome_completo}?${aviso}`)) return;
    try { await excluir.mutateAsync(a.id); toast.success("Assinatura excluída."); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.assinaturas} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para as assinaturas.</Card>}>
        <TrnHero eyebrow="Treinamentos › Cursos" titulo="Assinaturas"
          texto={'A assinatura do treinador no certificado: "ASSINADO DIGITALMENTE POR" + o nome completo e a assinatura desenhada ou escrita. Cada curso escolhe a sua em Editar curso.'}
          acoes={<AcessoGate menu={MENU.assinaturas} acao="incluir"><button onClick={() => setDialogo({ inicial: null })}><Plus className="h-4 w-4" /> Nova assinatura</button></AcessoGate>} />

        {isLoading ? <TrnCarregando /> : lista.length === 0 ? (
          <TrnVazio titulo="Nenhuma assinatura ainda" texto="Crie a assinatura do treinador para colocar nos certificados."
            acao={<AcessoGate menu={MENU.assinaturas} acao="incluir"><Button onClick={() => setDialogo({ inicial: null })}>Nova assinatura</Button></AcessoGate>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lista.map((a) => (
              <div key={a.id} className={`trn-card flex flex-col gap-3 ${a.ativo ? "" : "opacity-60"}`}>
                <div className="grid h-20 place-items-center overflow-hidden rounded-lg border bg-white px-3">
                  <AssinaturaTraco a={a} altura="56px" />
                </div>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <b className="block truncate">{a.nome_completo}</b>
                    <span className="text-xs text-slate-500">{a.cargo || (a.tipo === "desenho" ? "Desenhada" : `Escrita · ${a.fonte}`)}</span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {!a.ativo && <Badge variant="outline" className="text-[10px]">Desativada</Badge>}
                      <Badge variant="outline" className="text-[10px]">{a.cursos} curso(s)</Badge>
                      <Badge variant="outline" className="text-[10px]">{a.certificados} certificado(s)</Badge>
                    </div>
                  </div>
                  <AcessoGate menu={MENU.assinaturas} acao="alterar">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setDialogo({ inicial: a })}>Editar</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => alternarAtivo(a)}>{a.ativo ? "Desativar" : "Reativar"}</DropdownMenuItem>
                        {a.certificados === 0 && <DropdownMenuItem className="text-rose-600" onSelect={() => apagar(a)}>Excluir</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </AcessoGate>
                </div>
              </div>
            ))}
          </div>
        )}
      </AcessoGate>
      <DialogAssinatura aberto={!!dialogo} inicial={dialogo?.inicial ?? null} onClose={() => setDialogo(null)} />
    </div>
  );
}
