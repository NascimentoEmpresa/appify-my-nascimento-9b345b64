import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import type { Alteracao } from "@/hooks/useSupCatalogo";
import { CheckCircle2, XCircle, ChevronDown, ChevronRight, Inbox, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Aprovação de Catálogo — decide lotes de alterações em bloco.
 *
 * O card NÃO mostra JSON cru: mostra "Contrato X · Posto Y · Função Z" e a
 * lista de alterações em linguagem de negócio, lendo o `contexto` que foi
 * gravado junto de cada rascunho. É a melhor decisão de design do Subsistema
 * 6 do legado (REPLICAR-MODULO-COMPRAS.md §8.3) e vale preservar.
 *
 * A decisão em si sai pela RPC sup_cat_decidir_lote, que aplica ou reverte
 * tudo numa transação e rejeita lote já decidido.
 */

const sb = supabase as any;

interface Lote {
  id: string; codigo: string; status: string; total_alteracoes: number;
  criado_por_nome: string | null; decidido_por_nome: string | null;
  comentario: string | null; data_envio: string; data_resposta: string | null;
}

/** Data local, sem passar por UTC — evita o clássico "andou um dia". */
function fmtData(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const CORES_STATUS: Record<string, string> = {
  PENDENTE: "border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  APROVADO: "border-emerald-400/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
  REPROVADO: "border-red-400/50 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
};

const CORES_ACAO: Record<string, string> = {
  criar: "border-emerald-400/50 text-emerald-700 dark:text-emerald-300",
  editar: "border-blue-400/50 text-blue-700 dark:text-blue-300",
  excluir: "border-red-400/50 text-red-700 dark:text-red-300",
};

export default function CatalogoAprovacoes() {
  const { data: empresaId } = useEmpresaId();
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState("PENDENTE");
  const [aberto, setAberto] = useState<string | null>(null);
  const [decidindo, setDecidindo] = useState<{ lote: Lote; status: "APROVADO" | "REPROVADO" } | null>(null);
  const [comentario, setComentario] = useState("");

  const { data: lotes = [], isLoading } = useQuery({
    queryKey: ["sup_cat_lote", empresaId, filtro],
    enabled: !!empresaId,
    queryFn: async (): Promise<Lote[]> => {
      let q = sb.from("sup_cat_lote").select("*").eq("empresa_id", empresaId);
      if (filtro !== "TODOS") q = q.eq("status", filtro);
      const { data, error } = await q.order("data_envio", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: alteracoes = [] } = useQuery({
    queryKey: ["sup_cat_alteracao", "porLote", aberto],
    enabled: !!aberto,
    queryFn: async (): Promise<Alteracao[]> => {
      const { data, error } = await sb
        .from("sup_cat_alteracao").select("*").eq("lote_id", aberto).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const decidir = useMutation({
    mutationFn: async (v: { loteId: string; status: string; comentario: string }) => {
      const { error } = await sb.rpc("sup_cat_decidir_lote", {
        p_lote_id: v.loteId, p_status: v.status, p_comentario: v.comentario || null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      ["sup_cat_lote", "sup_cat_alteracao", "sup_posto", "sup_funcao", "sup_item", "sup_funcao_item"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(v.status === "APROVADO" ? "Lote aprovado — o catálogo já está no ar." : "Lote reprovado.");
      setDecidindo(null);
      setComentario("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível decidir o lote."),
  });

  const pendentes = useMemo(() => lotes.filter((l) => l.status === "PENDENTE").length, [lotes]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aprovação de Catálogo"
        subtitle="Mudanças no catálogo só passam a valer para o encarregado depois de aprovadas aqui."
        module="Suprimentos"
        breadcrumb={["Catálogo de Materiais", "Aprovações"]}
        actions={
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDENTE">Pendentes</SelectItem>
              <SelectItem value="APROVADO">Aprovados</SelectItem>
              <SelectItem value="REPROVADO">Reprovados</SelectItem>
              <SelectItem value="TODOS">Todos</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {filtro === "PENDENTE" && pendentes > 0 && (
        <p className="text-sm text-muted-foreground">
          {pendentes} lote{pendentes === 1 ? "" : "s"} aguardando decisão.
        </p>
      )}

      {isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : lotes.length === 0 ? (
        // Dois estados vazios diferentes: "nada a fazer" é boa notícia e é
        // apresentado como tal; um filtro sem resultado é só um beco sem saída.
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          {filtro === "PENDENTE" ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="font-medium">Nenhum lote aguardando aprovação.</p>
              <p className="text-sm text-muted-foreground">O catálogo está em dia.</p>
            </>
          ) : (
            <>
              <Inbox className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium">Nenhum lote neste filtro.</p>
              <p className="text-sm text-muted-foreground">Tente outro status.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {lotes.map((lote) => {
            const expandido = aberto === lote.id;
            return (
              <Card key={lote.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setAberto(expandido ? null : lote.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {expandido ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <CardTitle className="truncate text-base">{lote.codigo}</CardTitle>
                      <Badge variant="outline" className={cn("shrink-0", CORES_STATUS[lote.status])}>
                        {lote.status}
                      </Badge>
                      <Badge variant="secondary" className="shrink-0">
                        {lote.total_alteracoes} alteraç{lote.total_alteracoes === 1 ? "ão" : "ões"}
                      </Badge>
                    </button>

                    {lote.status === "PENDENTE" && (
                      <div className="flex gap-2">
                        <Button
                          size="sm" variant="outline"
                          className="border-red-300 text-red-600 hover:bg-red-50"
                          onClick={() => { setDecidindo({ lote, status: "REPROVADO" }); setComentario(""); }}
                        >
                          <XCircle className="mr-1.5 h-4 w-4" /> Reprovar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => { setDecidindo({ lote, status: "APROVADO" }); setComentario(""); }}
                        >
                          <CheckCircle2 className="mr-1.5 h-4 w-4" /> Aprovar
                        </Button>
                      </div>
                    )}
                  </div>

                  <p className="pl-6 text-xs text-muted-foreground">
                    Enviado por {lote.criado_por_nome ?? "—"} em {fmtData(lote.data_envio)}
                    {lote.data_resposta && (
                      <> · Decidido por {lote.decidido_por_nome ?? "—"} em {fmtData(lote.data_resposta)}</>
                    )}
                  </p>
                  {lote.comentario && (
                    <p className="pl-6 text-xs italic text-muted-foreground">"{lote.comentario}"</p>
                  )}
                </CardHeader>

                {expandido && (
                  <CardContent className="pt-0">
                    <ContextoDoLote alteracoes={alteracoes} />
                    <div className="mt-3 space-y-1.5">
                      {alteracoes.map((a) => (
                        <div key={a.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                          <Badge variant="outline" className={cn("mt-0.5 shrink-0 text-[10px] uppercase", CORES_ACAO[a.tipo_acao])}>
                            {a.tipo_acao}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p>{a.descricao}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {[a.contexto?.contrato, a.contexto?.posto, a.contexto?.funcao]
                                .filter(Boolean).join(" · ") || "—"}
                            </p>
                          </div>
                        </div>
                      ))}
                      {alteracoes.length === 0 && (
                        <p className="py-4 text-center text-xs text-muted-foreground">Carregando alterações…</p>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Decisão */}
      <Dialog open={!!decidindo} onOpenChange={(o) => !o && setDecidindo(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decidindo?.status === "APROVADO" ? "Aprovar lote" : "Reprovar lote"} {decidindo?.lote.codigo}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {decidindo?.status === "APROVADO" ? (
                <>
                  As <strong>{decidindo?.lote.total_alteracoes}</strong> alterações passam a valer e o
                  encarregado começa a ver o catálogo atualizado.
                </>
              ) : (
                <>
                  Os cadastros novos deste lote são <strong>descartados</strong> e as exclusões são desfeitas.
                  Renomeações já aplicadas não voltam atrás.
                </>
              )}
            </p>
            <div>
              <Label>Comentário {decidindo?.status === "REPROVADO" ? "(recomendado)" : "(opcional)"}</Label>
              <Textarea
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Ex.: falta o item de EPI obrigatório para essa função."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecidindo(null)}>Cancelar</Button>
            <Button
              variant={decidindo?.status === "REPROVADO" ? "destructive" : "default"}
              disabled={decidir.isPending}
              onClick={() =>
                decidindo && decidir.mutate({
                  loteId: decidindo.lote.id, status: decidindo.status, comentario,
                })}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Resumo em linguagem de negócio: contratos, postos, funções e materiais tocados. */
function ContextoDoLote({ alteracoes }: { alteracoes: Alteracao[] }) {
  const resumo = useMemo(() => {
    const unico = (campo: string) =>
      Array.from(new Set(alteracoes.map((a) => a.contexto?.[campo]).filter(Boolean) as string[]));
    return {
      contratos: unico("contrato"),
      postos: unico("posto"),
      funcoes: unico("funcao"),
      itens: unico("item"),
    };
  }, [alteracoes]);

  const linhas: [string, string[]][] = [
    ["Contrato", resumo.contratos],
    ["Posto", resumo.postos],
    ["Função", resumo.funcoes],
    ["Materiais", resumo.itens],
  ];

  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <PackageCheck className="h-3.5 w-3.5" /> O que este lote toca
      </p>
      <dl className="grid gap-1.5 text-sm sm:grid-cols-[7rem_1fr]">
        {linhas.map(([rotulo, valores]) => (
          <div key={rotulo} className="contents">
            <dt className="text-muted-foreground">{rotulo}</dt>
            <dd className="mb-1 sm:mb-0">{valores.length ? valores.join(", ") : "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
