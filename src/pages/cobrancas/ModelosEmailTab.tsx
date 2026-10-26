import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, History, RotateCcw, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MODELOS_COBRANCA, VARIAVEIS_MODELO, previaDoModelo, validarModelo } from "./regrasModelosEmails";

// SIS-2026-0653: edição dos textos da cobrança automática. A rotina lê o modelo ativo (template_mensagem, codigo cobranca_auto_*)
// a cada envio, então o que for salvo aqui vale no próximo tick. Cada alteração guarda a versão anterior (cobranca_auto_modelo_historico).
// Faixa roxa/preta não tem modelo aqui: é sempre manual (Jurídico).

interface Modelo {
  id: string;
  codigo: string;
  assunto: string | null;
  corpo: string;
  updated_at: string | null;
}
interface Versao {
  id: string;
  assunto: string | null;
  corpo: string;
  substituida_por: string | null;
  substituida_em: string;
}

const fmtHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function ModelosEmailTab() {
  const { can } = usePermissoes();
  const podeAlterar = can("alterar", undefined, "cobrancas");
  const qc = useQueryClient();
  const corpoRef = useRef<HTMLTextAreaElement>(null);

  const [codigo, setCodigo] = useState(MODELOS_COBRANCA[0].codigo);
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [umaNota, setUmaNota] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const { data: modelos = [], isLoading } = useQuery<Modelo[]>({
    queryKey: ["cobranca-modelos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("template_mensagem")
        .select("id, codigo, assunto, corpo, updated_at")
        .in("codigo", MODELOS_COBRANCA.map((m) => m.codigo))
        .is("empresa_id", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: assinatura = "" } = useQuery<string>({
    queryKey: ["cobranca-auto-config-assinatura"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("cobranca_auto_config").select("assinatura_html").eq("id", 1).maybeSingle();
      return data?.assinatura_html ?? "";
    },
  });

  const { data: versoes = [] } = useQuery<Versao[]>({
    queryKey: ["cobranca-modelo-historico", codigo],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cobranca_auto_modelo_historico")
        .select("id, assunto, corpo, substituida_por, substituida_em")
        .eq("codigo", codigo)
        .order("substituida_em", { ascending: false })
        .limit(50);
      if (error) return [];
      return data ?? [];
    },
  });

  const { data: nomes = new Map<string, string>() } = useQuery<Map<string, string>>({
    queryKey: ["cobranca-modelo-historico-nomes", versoes.map((v) => v.substituida_por).join(",")],
    enabled: versoes.some((v) => v.substituida_por),
    queryFn: async () => {
      const ids = [...new Set(versoes.map((v) => v.substituida_por).filter(Boolean))] as string[];
      const pares = await Promise.all(
        ids.map(async (id) => {
          const { data } = await (supabase as any).rpc("nome_usuario_ator", { _user_id: id });
          return [id, (data as string | null) ?? "usuário"] as const;
        }),
      );
      return new Map<string, string>(pares);
    },
  });

  const atual = modelos.find((m) => m.codigo === codigo) ?? null;
  const meta = MODELOS_COBRANCA.find((m) => m.codigo === codigo)!;

  // Troca de modelo (ou recarga depois de salvar): o editor recomeça do texto gravado.
  useEffect(() => {
    if (atual) {
      setAssunto(atual.assunto ?? "");
      setCorpo(atual.corpo);
    }
  }, [atual?.id, atual?.updated_at, atual?.corpo, atual?.assunto]);

  const alterado = !!atual && (assunto !== (atual.assunto ?? "") || corpo !== atual.corpo);
  const problemas = useMemo(() => validarModelo(assunto, corpo), [assunto, corpo]);
  const bloqueado = problemas.some((p) => p.bloqueia);
  const previa = useMemo(() => previaDoModelo(meta.faixa, assunto, corpo, assinatura, umaNota ? 1 : 2), [meta.faixa, assunto, corpo, assinatura, umaNota]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!atual) throw new Error("Modelo não encontrado.");
      const { error } = await (supabase as any)
        .from("template_mensagem")
        .update({ assunto: assunto.trim(), corpo, updated_at: new Date().toISOString() })
        .eq("id", atual.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cobranca-modelos"] });
      qc.invalidateQueries({ queryKey: ["cobranca-modelo-historico", codigo] });
      toast.success("Modelo salvo. Vale a partir do próximo envio.");
    },
    onError: (e: any) => toast.error(`Não foi possível salvar: ${e.message ?? e}`),
  });

  const inserirVariavel = (nome: string) => {
    if (!podeAlterar) return;
    const el = corpoRef.current;
    const marca = `{{${nome}}}`;
    if (!el) {
      setCorpo((c) => c + marca);
      return;
    }
    const ini = el.selectionStart ?? corpo.length;
    const fim = el.selectionEnd ?? corpo.length;
    setCorpo(corpo.slice(0, ini) + marca + corpo.slice(fim));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + marca.length, ini + marca.length);
    });
  };

  const trocarModelo = (novo: string) => {
    if (novo === codigo) return;
    if (alterado && !window.confirm("Há alterações não salvas neste modelo. Descartar e trocar de modelo?")) return;
    setCodigo(novo);
  };

  const original = versoes.length > 0 ? versoes[versoes.length - 1] : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-1 p-4 text-sm text-muted-foreground">
          <p>
            Estes são os e-mails enviados pela cobrança automática, um por faixa. O que for salvo aqui vale a partir do próximo envio, para
            todos os contratos. As faixas roxa e preta não têm modelo: são sempre enviadas à mão pelo Jurídico.
          </p>
          <p>
            O assunto recebe automaticamente “(NFs: números das notas)” no final, e a assinatura e a cópia (CC) ficam em Automação › Configurar.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Faixas</CardTitle></CardHeader>
          <CardContent className="space-y-1 p-2 pt-0">
            {MODELOS_COBRANCA.map((m) => (
              <button
                key={m.codigo}
                onClick={() => trocarModelo(m.codigo)}
                className={cn(
                  "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                  m.codigo === codigo ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {m.rotulo}
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {!isLoading && !atual && (
            <Card><CardContent className="p-4 text-sm text-muted-foreground">Modelo “{codigo}” não encontrado. Ele é criado pela migration da cobrança automática.</CardContent></Card>
          )}
          {atual && (
            <>
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-base">
                    {meta.rotulo}
                    {atual.updated_at && <span className="ml-2 text-xs font-normal text-muted-foreground">salvo em {fmtHora(atual.updated_at)}</span>}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setHistoricoAberto(true)}>
                      <History className="h-3.5 w-3.5" /> Histórico ({versoes.length})
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Assunto</Label>
                    <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} disabled={!podeAlterar} />
                  </div>
                  <div>
                    <Label>Corpo do e-mail (HTML)</Label>
                    <Textarea
                      ref={corpoRef}
                      rows={16}
                      value={corpo}
                      onChange={(e) => setCorpo(e.target.value)}
                      disabled={!podeAlterar}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Variáveis (clique para inserir onde está o cursor)</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {VARIAVEIS_MODELO.map((v) => (
                        <button
                          key={v.nome}
                          type="button"
                          title={v.descricao}
                          disabled={!podeAlterar}
                          onClick={() => inserirVariavel(v.nome)}
                          className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs hover:border-primary/50 disabled:opacity-60"
                        >
                          {`{{${v.nome}}}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {problemas.length > 0 && (
                    <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                      {problemas.map((p, i) => (
                        <p key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p.texto}</p>
                      ))}
                    </div>
                  )}

                  {podeAlterar ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button className="gap-1.5" disabled={!alterado || bloqueado || salvar.isPending} onClick={() => salvar.mutate()}>
                        <Save className="h-4 w-4" /> {salvar.isPending ? "Salvando…" : "Salvar modelo"}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-1.5"
                        disabled={!alterado}
                        onClick={() => {
                          setAssunto(atual.assunto ?? "");
                          setCorpo(atual.corpo);
                        }}
                      >
                        <RotateCcw className="h-4 w-4" /> Descartar alterações
                      </Button>
                      {alterado && <Badge variant="outline">Alterações não salvas</Badge>}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Você pode ver os modelos, mas só quem tem permissão de alterar em Cobranças pode editá-los.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm">Prévia com dados de exemplo</CardTitle>
                  <div className="flex gap-1">
                    {[false, true].map((u) => (
                      <button
                        key={String(u)}
                        onClick={() => setUmaNota(u)}
                        className={cn("rounded-full border px-3 py-1 text-xs", umaNota === u ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}
                      >
                        {u ? "1 nota" : "2 notas"}
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm"><span className="text-muted-foreground">Assunto: </span><b>{previa.assunto}</b></p>
                  <iframe title="Prévia do e-mail" sandbox="" srcDoc={previa.corpo} className="h-[420px] w-full rounded-md border border-border bg-white" />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <Dialog open={historicoAberto} onOpenChange={setHistoricoAberto}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico — {meta.rotulo}</DialogTitle>
            <DialogDescription>
              Versões que foram substituídas. “Usar esta versão” só coloca o texto no editor; ele passa a valer quando você salvar.
            </DialogDescription>
          </DialogHeader>
          {versoes.length === 0 && <p className="text-sm text-muted-foreground">Este modelo ainda não foi alterado: o texto atual é o original.</p>}
          <div className="space-y-3">
            {versoes.map((v) => (
              <div key={v.id} className="space-y-1.5 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Substituída em {fmtHora(v.substituida_em)}
                    {v.substituida_por ? ` por ${nomes.get(v.substituida_por) ?? "usuário"}` : ""}
                    {original?.id === v.id && <Badge variant="outline" className="ml-2">Original</Badge>}
                  </span>
                  {podeAlterar && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAssunto(v.assunto ?? "");
                        setCorpo(v.corpo);
                        setHistoricoAberto(false);
                        toast.info("Versão carregada no editor. Clique em Salvar modelo para valer.");
                      }}
                    >
                      Usar esta versão
                    </Button>
                  )}
                </div>
                <p className="text-sm font-medium">{v.assunto}</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">{v.corpo}</pre>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
