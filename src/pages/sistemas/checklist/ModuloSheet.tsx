import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATUS_CHAMADO } from "@/pages/chamados/types";
import { cn } from "@/lib/utils";
import { useChamadosModulo } from "@/hooks/useChecklistModulos";
import type { DadosChecklist, LinhaModulo, LinhaTela } from "@/lib/sistemas/checklistModulos";
import { BarraEfetividade, fmtDataHora } from "./ui";
import { TabelaTelas } from "./TabelaTelas";
import { PessoasModulo } from "./PessoasModulo";
import { BugsPainel } from "./BugsPainel";
import { HistoricoLista } from "./HistoricoLista";

// Tudo de um módulo num painel: telas e status, pessoas (uso + treinamento),
// bugs, chamados de sistemas abertos para ele e o histórico do checklist.

export function ModuloSheet({ modulo, dados, nomeUsuario, podeAlterar, podeIncluir, podeExcluir, onFechar, onEditarModulo, onEditarTela, onBugTela }: {
  modulo: LinhaModulo | null;
  dados: DadosChecklist;
  nomeUsuario: Map<string, string>;
  podeAlterar: boolean; podeIncluir: boolean; podeExcluir: boolean;
  onFechar: () => void;
  onEditarModulo: (m: LinhaModulo) => void;
  onEditarTela: (m: LinhaModulo, t: LinhaTela) => void;
  onBugTela: (m: LinhaModulo, t: LinhaTela) => void;
}) {
  const chamados = useChamadosModulo(modulo?.modulo.codigo ?? null);
  if (!modulo) return null;
  const m = modulo;
  const resp = m.item?.responsavel_id ? nomeUsuario.get(m.item.responsavel_id) : null;
  const chave = m.item?.usuario_chave_id ? nomeUsuario.get(m.item.usuario_chave_id) : null;

  return (
    <Sheet open onOpenChange={(v) => !v && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[min(1240px,96vw)]">
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="text-xl">{m.modulo.nome}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>{m.ativas} telas ativas · {m.preenchidas} preenchidas</span>
              <span className="flex items-center gap-2">Efetividade <BarraEfetividade valor={m.efetividade} vazio={!m.preenchidas} /></span>
              <span>Responsável: <b className="text-foreground">{resp ?? "—"}</b></span>
              <span>Usuário-chave: <b className="text-foreground">{chave ?? "—"}</b></span>
              {podeAlterar && (
                <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => onEditarModulo(m)}><Pencil className="h-3.5 w-3.5" /> Dados do módulo</Button>
              )}
            </div>
          </SheetDescription>
          {m.item?.observacoes && <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">{m.item.observacoes}</p>}
        </SheetHeader>

        <Tabs defaultValue="telas" className="mt-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="telas">Telas ({m.telas.length})</TabsTrigger>
            <TabsTrigger value="pessoas">Pessoas · uso e treinamento</TabsTrigger>
            <TabsTrigger value="bugs">Bugs{m.bugsAbertos ? ` (${m.bugsAbertos})` : ""}</TabsTrigger>
            <TabsTrigger value="chamados">Chamados{m.chamadosAbertos ? ` (${m.chamadosAbertos})` : ""}</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="telas">
            <Card className="overflow-hidden">
              <TabelaTelas modulo={m} telas={m.telas} nomeUsuario={nomeUsuario} podeAlterar={podeAlterar} podeIncluir={podeIncluir}
                onEditar={(t) => onEditarTela(m, t)} onBug={(t) => onBugTela(m, t)} />
            </Card>
          </TabsContent>

          <TabsContent value="pessoas">
            <PessoasModulo moduloId={m.modulo.id} moduloNome={m.modulo.nome} podeAlterar={podeAlterar} />
          </TabsContent>

          <TabsContent value="bugs">
            <BugsPainel dados={dados} moduloId={m.modulo.id} podeIncluir={podeIncluir} podeAlterar={podeAlterar} podeExcluir={podeExcluir} />
          </TabsContent>

          <TabsContent value="chamados">
            {chamados.isLoading ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando chamados…</p>
            ) : !chamados.data?.length ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum chamado de sistemas aberto para "{m.modulo.nome}".</Card>
            ) : (
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-3 py-2">Chamado</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Solicitante</th><th className="px-3 py-2">Aberto em</th><th /></tr>
                  </thead>
                  <tbody>
                    {chamados.data.map((c) => {
                      const st = STATUS_CHAMADO[c.status];
                      return (
                        <tr key={c.id} className="border-t border-border">
                          <td className="max-w-[420px] px-3 py-2"><p className="text-xs font-bold text-muted-foreground">{c.numero}</p><p className="truncate font-medium">{c.assunto}</p></td>
                          <td className="px-3 py-2"><span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", st?.cls)}>{st?.label ?? c.status}</span></td>
                          <td className="px-3 py-2 text-xs">{c.solicitante ?? "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDataHora(c.created_at)}</td>
                          <td className="px-3 py-2 text-right">
                            <Link to={`/app/sistemas/chamados/${c.id}/acompanhar`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Abrir <ExternalLink className="h-3 w-3" /></Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="historico">
            <HistoricoLista dados={dados} moduloId={m.modulo.id} compacto />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
