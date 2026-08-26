import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ChevronDown, ChevronRight, FileCheck2, FilePlus2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// A migration é nova e ainda não existe em types.ts (regra R8 do projeto).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface MaterialEpi {
  id: string;
  nome: string;
}

interface LaudoEpi {
  id: string;
  sup_item_id: string;
  validade_minima_meses: number;
  ca_referencia: string | null;
  riscos: string;
  especificacao: string | null;
  observacoes: string | null;
  ativo: boolean;
  emitido_por_nome: string | null;
  emitido_em: string;
  inativado_em: string | null;
  motivo_inativacao: string | null;
}

interface FormularioLaudo {
  validade_minima_meses: string;
  riscos: string;
  ca_referencia: string;
  especificacao: string;
  observacoes: string;
}

const FORMULARIO_VAZIO: FormularioLaudo = {
  validade_minima_meses: "",
  riscos: "",
  ca_referencia: "",
  especificacao: "",
  observacoes: "",
};
const MATERIAIS_VAZIOS: MaterialEpi[] = [];
const LAUDOS_VAZIOS: LaudoEpi[] = [];

function mensagemErro(erro: unknown, padrao: string) {
  if (erro instanceof Error) return erro.message;
  if (erro && typeof erro === "object" && "message" in erro) {
    const mensagem = (erro as { message?: unknown }).message;
    if (typeof mensagem === "string" && mensagem) return mensagem;
  }
  return padrao;
}

function formatarDataHora(valor: string | null) {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? "—"
    : data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function LaudosEpi() {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState<string | null>(null);
  const [emitindo, setEmitindo] = useState<MaterialEpi | null>(null);
  const [inativando, setInativando] = useState<LaudoEpi | null>(null);
  const [formulario, setFormulario] = useState<FormularioLaudo>({ ...FORMULARIO_VAZIO });
  const [motivo, setMotivo] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["sst_laudos_epi"],
    queryFn: async (): Promise<{ materiais: MaterialEpi[]; laudos: LaudoEpi[] }> => {
      const [materiaisResposta, laudosResposta] = await Promise.all([
        sb.from("sup_item").select("id, nome").eq("tipo", "epi").eq("ativo", true).order("nome"),
        sb.from("sst_laudo_epi").select("*").order("emitido_em", { ascending: false }),
      ]);
      if (materiaisResposta.error) throw materiaisResposta.error;
      if (laudosResposta.error) throw laudosResposta.error;
      return {
        materiais: materiaisResposta.data ?? [],
        laudos: laudosResposta.data ?? [],
      };
    },
  });

  const materiais = data?.materiais ?? MATERIAIS_VAZIOS;
  const laudos = data?.laudos ?? LAUDOS_VAZIOS;
  const laudosPorMaterial = useMemo(() => {
    const agrupados = new Map<string, LaudoEpi[]>();
    for (const laudo of laudos) {
      agrupados.set(laudo.sup_item_id, [...(agrupados.get(laudo.sup_item_id) ?? []), laudo]);
    }
    return agrupados;
  }, [laudos]);
  const semLaudo = materiais.filter((material) =>
    !(laudosPorMaterial.get(material.id) ?? []).some((laudo) => laudo.ativo)).length;

  const emitir = useMutation({
    mutationFn: async () => {
      if (!emitindo) return;
      const { error: erro } = await sb.rpc("sst_laudo_emitir", {
        p_sup_item_id: emitindo.id,
        p_validade_minima_meses: Number(formulario.validade_minima_meses),
        p_riscos: formulario.riscos.trim(),
        p_ca_referencia: formulario.ca_referencia.trim() || null,
        p_especificacao: formulario.especificacao.trim() || null,
        p_observacoes: formulario.observacoes.trim() || null,
      });
      if (erro) throw erro;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sst_laudos_epi"] });
      queryClient.invalidateQueries({ queryKey: ["sst_laudo_ativo"] });
      toast.success("Laudo emitido. A nova exigência já vale para entradas de estoque.");
      setEmitindo(null);
      setFormulario({ ...FORMULARIO_VAZIO });
    },
    onError: (erro: unknown) => toast.error(mensagemErro(erro, "Não foi possível emitir o laudo.")),
  });

  const inativar = useMutation({
    mutationFn: async () => {
      if (!inativando) return;
      const { error: erro } = await sb.rpc("sst_laudo_inativar", {
        p_id: inativando.id,
        p_motivo: motivo.trim(),
      });
      if (erro) throw erro;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sst_laudos_epi"] });
      queryClient.invalidateQueries({ queryKey: ["sst_laudo_ativo"] });
      toast.success("Laudo inativado e mantido no histórico.");
      setInativando(null);
      setMotivo("");
    },
    onError: (erro: unknown) => toast.error(mensagemErro(erro, "Não foi possível inativar o laudo.")),
  });

  const formularioValido = Number(formulario.validade_minima_meses) > 0 && !!formulario.riscos.trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laudos de EPI"
        subtitle="Defina os riscos e a validade mínima de CA que Compras deve exigir em cada recebimento."
        module="SST"
        breadcrumb={["Laudos de EPI"]}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador rotulo="EPIs do catálogo" valor={materiais.length} />
        <Indicador rotulo="Com laudo ativo" valor={materiais.length - semLaudo} />
        <Indicador rotulo="Aguardando análise" valor={semLaudo} alerta={semLaudo > 0} />
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Não foi possível carregar os laudos: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : materiais.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <ShieldCheck className="h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">Nenhum EPI ativo no catálogo.</p>
          <p className="text-sm text-muted-foreground">Cadastre os materiais como tipo EPI em Suprimentos.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {materiais.map((material) => {
            const historico = laudosPorMaterial.get(material.id) ?? [];
            const ativo = historico.find((laudo) => laudo.ativo);
            const expandido = aberto === material.id;
            return (
              <Card key={material.id} className={cn(!ativo && "border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/10")}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setAberto(expandido ? null : material.id)}
                    >
                      {expandido
                        ? <ChevronDown className="h-4 w-4 shrink-0" />
                        : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <CardTitle className="truncate text-base">{material.nome}</CardTitle>
                      {ativo ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Laudo ativo</Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Sem laudo
                        </Badge>
                      )}
                    </button>

                    {ativo && (
                      <span className="text-sm font-medium">
                        CA válido por pelo menos {ativo.validade_minima_meses} mês{ativo.validade_minima_meses === 1 ? "" : "es"}
                      </span>
                    )}

                    <AcessoGate menu="sst_laudo" acao="alterar">
                      <div className="flex gap-2">
                        {ativo && (
                          <Button variant="outline" size="sm" onClick={() => { setInativando(ativo); setMotivo(""); }}>
                            Inativar
                          </Button>
                        )}
                        <Button size="sm" onClick={() => { setEmitindo(material); setFormulario({ ...FORMULARIO_VAZIO }); }}>
                          <FilePlus2 className="mr-1.5 h-4 w-4" /> {ativo ? "Emitir novo" : "Emitir laudo"}
                        </Button>
                      </div>
                    </AcessoGate>
                  </div>
                </CardHeader>

                {expandido && (
                  <CardContent className="space-y-3 pt-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Histórico de laudos — mais recente primeiro
                    </p>
                    {historico.length === 0 ? (
                      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        O SST ainda não analisou este material.
                      </p>
                    ) : historico.map((laudo) => (
                      <div key={laudo.id} className="rounded-md border bg-background p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Badge variant={laudo.ativo ? "default" : "secondary"}>
                            {laudo.ativo ? "Ativo" : "Inativo"}
                          </Badge>
                          <span className="font-semibold">{laudo.validade_minima_meses} mês{laudo.validade_minima_meses === 1 ? "" : "es"} mínimos</span>
                          <span className="text-xs text-muted-foreground">
                            Emitido por {laudo.emitido_por_nome ?? "Usuário sem nome"} em {formatarDataHora(laudo.emitido_em)}
                          </span>
                        </div>
                        <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
                          <dt className="text-muted-foreground">Riscos protegidos</dt><dd>{laudo.riscos}</dd>
                          <dt className="text-muted-foreground">CA de referência</dt><dd>{laudo.ca_referencia || "—"}</dd>
                          <dt className="text-muted-foreground">Especificação</dt><dd className="whitespace-pre-wrap">{laudo.especificacao || "—"}</dd>
                          <dt className="text-muted-foreground">Observações</dt><dd className="whitespace-pre-wrap">{laudo.observacoes || "—"}</dd>
                          {!laudo.ativo && <>
                            <dt className="text-muted-foreground">Inativação</dt>
                            <dd>{laudo.motivo_inativacao || "—"} · {formatarDataHora(laudo.inativado_em)}</dd>
                          </>}
                        </dl>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!emitindo} onOpenChange={(valor) => !valor && setEmitindo(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Emitir laudo — {emitindo?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Validade mínima do CA na entrada (meses) *</Label>
              <Input
                type="number" min="1" step="1"
                value={formulario.validade_minima_meses}
                onChange={(evento) => setFormulario((atual) => ({ ...atual, validade_minima_meses: evento.target.value }))}
                placeholder="Ex.: 6"
              />
            </div>
            <div>
              <Label>Riscos que este EPI protege *</Label>
              <Textarea value={formulario.riscos} rows={3}
                onChange={(evento) => setFormulario((atual) => ({ ...atual, riscos: evento.target.value }))} />
            </div>
            <div>
              <Label>CA de referência</Label>
              <Input value={formulario.ca_referencia}
                onChange={(evento) => setFormulario((atual) => ({ ...atual, ca_referencia: evento.target.value }))} />
            </div>
            <div>
              <Label>Especificação técnica</Label>
              <Textarea value={formulario.especificacao} rows={3}
                onChange={(evento) => setFormulario((atual) => ({ ...atual, especificacao: evento.target.value }))} />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={formulario.observacoes} rows={3}
                onChange={(evento) => setFormulario((atual) => ({ ...atual, observacoes: evento.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmitindo(null)}>Cancelar</Button>
            <Button disabled={!formularioValido || emitir.isPending} onClick={() => emitir.mutate()}>
              <FileCheck2 className="mr-1.5 h-4 w-4" /> Emitir laudo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!inativando} onOpenChange={(valor) => !valor && setInativando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Inativar laudo</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              O histórico será preservado, mas novas entradas deixarão de exigir este parâmetro.
            </p>
            <div>
              <Label>Motivo *</Label>
              <Textarea value={motivo} rows={3} onChange={(evento) => setMotivo(evento.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInativando(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={!motivo.trim() || inativar.isPending} onClick={() => inativar.mutate()}>
              Inativar laudo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Indicador({ rotulo, valor, alerta = false }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-4", alerta && "border-amber-400/60 bg-amber-50 dark:bg-amber-950/20")}>
      <p className={cn("text-2xl font-bold", alerta && "text-amber-700 dark:text-amber-300")}>{valor}</p>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
    </div>
  );
}
