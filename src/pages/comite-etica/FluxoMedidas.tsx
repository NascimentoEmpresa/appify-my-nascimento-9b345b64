import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, FileText, Gavel, Loader2, RefreshCw, Send, Sparkles, Undo2 } from "lucide-react";
import {
  BUCKET_MEDIDAS, COLS_CICLO, COLS_EVENTO, COLS_ITEM, COLS_MEDIDA, ETAPA, SITUACAO_CICLO, SITUACAO_MEDIDA,
  type Ciclo, type EventoFluxo, type ItemSupervisor, type Medida,
  cicloAberto, cumprimento, dataBr, dataHoraBr, etapaDaMedida, podeEnviarParecer, validarDecisao,
} from "@/lib/comite-etica/encaminhamento";

// =====================================================================
// PARECER → PRESIDÊNCIA → JURÍDICO → SUPERVISOR (SIS-2026-0957)
//
// O mesmo bloco nas duas fichas:
//   · Comitê (FichaDenuncia): vê cada ciclo, o que a presidente decidiu e o
//     cumprimento; reenvia o parecer depois de uma devolução;
//   · Presidência (FichaPresidencia): para cada medida do ciclo aberto,
//     "Desaprovar" (volta ao Comitê com proposta/aditivo) ou "Aprovar e
//     encaminhar ao Jurídico" (com o resumo do parecer, redigido com a I.A).
// Quem grava é o banco (RPCs cetica_*): a tela só chama e relê.
// =====================================================================

interface Fluxo {
  ciclos: Ciclo[];
  medidas: Medida[];
  itens: ItemSupervisor[];
  eventos: EventoFluxo[];
  parecerFinal: boolean;
}

async function erroDaEdge(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
  return corpo?.error ?? (error as Error).message;
}

async function abrirArquivoMedida(path: string) {
  const { data, error } = await db.storage.from(BUCKET_MEDIDAS).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Arquivo indisponível.");
  window.open(data.signedUrl, "_blank", "noopener");
}

function useFluxoMedidas(denunciaId: string) {
  return useQuery({
    queryKey: ["cetica-fluxo", denunciaId],
    queryFn: async (): Promise<Fluxo> => {
      const [c, m, i, e, d] = await Promise.all([
        db.from("COMITE_ETICA_PARECER_CICLO").select(COLS_CICLO).eq("denuncia_id", denunciaId).order("ciclo", { ascending: false }).limit(50),
        db.from("COMITE_ETICA_MEDIDA").select(COLS_MEDIDA).eq("denuncia_id", denunciaId).order("created_at").limit(200),
        db.from("COMITE_ETICA_MEDIDA_SUPERVISOR").select(COLS_ITEM).eq("denuncia_id", denunciaId).limit(200),
        db.from("COMITE_ETICA_MEDIDA_EVENTO").select(COLS_EVENTO).eq("denuncia_id", denunciaId).order("em", { ascending: false }).limit(300),
        db.from("CANAL_DENUNCIA_DOCUMENTO").select("final").eq("denuncia_id", denunciaId).eq("tipo", "parecer_conclusivo").limit(1),
      ]);
      const erro = c.error ?? m.error ?? i.error ?? e.error;
      if (erro) throw erro;
      return {
        ciclos: (c.data ?? []) as Ciclo[], medidas: (m.data ?? []) as Medida[],
        itens: (i.data ?? []) as ItemSupervisor[], eventos: (e.data ?? []) as EventoFluxo[],
        parecerFinal: !!(d.data ?? [])[0]?.final,
      };
    },
  });
}

const TOM: Record<string, string> = {
  neutro: "border-border bg-muted text-muted-foreground",
  atencao: "border-warning/40 bg-warning/10 text-warning",
  ok: "border-success/40 bg-success/10 text-success",
  erro: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function FluxoMedidas({ denunciaId, statusDenuncia, modo, podeDecidir = false, onMudou }: {
  denunciaId: string;
  statusDenuncia: string;
  modo: "comite" | "presidencia";
  podeDecidir?: boolean;
  /** A situação da denúncia muda pelo fluxo: a lista de fora relê. */
  onMudou?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error, refetch, isFetching } = useFluxoMedidas(denunciaId);
  const [decidir, setDecidir] = useState<{ medida: Medida; aprovar: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ["cetica-fluxo", denunciaId] });
    // As listas de fora (Denúncias e Presidência): a situação muda pelo fluxo.
    qc.invalidateQueries({ queryKey: ["canal-denuncias"] });
    qc.invalidateQueries({ queryKey: ["comite-etica-presidencia"] });
    onMudou?.();
  };

  const enviar = async () => {
    setEnviando(true);
    const { error: e } = await db.rpc("cetica_parecer_enviar", { _denuncia: denunciaId });
    setEnviando(false);
    if (e) { toast({ title: "Não foi possível enviar", description: e.message, variant: "destructive" }); return; }
    toast({ title: "Parecer enviado à Presidência" });
    recarregar();
  };

  if (isLoading) return <Card className="p-4 text-sm text-muted-foreground">Carregando o encaminhamento…</Card>;
  if (error) return <Card className="p-4 text-sm text-destructive">Não foi possível ler o encaminhamento: {(error as Error).message}</Card>;
  const f = data!;
  const aberto = cicloAberto(f.ciclos) as Ciclo | null;
  const cump = cumprimento(f.medidas, f.itens);
  const itemDe = (id: string) => f.itens.find((i) => i.medida_id === id) ?? null;
  const aprovadas = f.medidas.filter((m) => m.status === "aprovada" && m.medida !== "nenhuma");

  return (
    <Card className="space-y-4 border-primary/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
            <Gavel className="h-4 w-4 text-primary" /> Presidência, Jurídico e cumprimento
          </p>
          <p className="text-xs text-muted-foreground">
            O Parecer Conclusivo em versão final vai sozinho à Presidência. Cada medida aprovada segue ao Jurídico e,
            dali, ao supervisor do contrato, que registra a aplicação.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {cump.total > 0 && (
            <Badge variant="outline" className={TOM[cump.completo ? "ok" : "atencao"]}>
              Cumprimento: {cump.aplicadas}/{cump.total} aplicada(s)
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} title="Atualizar">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {modo === "comite" && podeEnviarParecer({ parecerFinal: f.parecerFinal, ciclos: f.ciclos, statusDenuncia }) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs">
            {f.ciclos.length
              ? "O parecer está em versão final e nenhum ciclo está com a Presidência. Reenvie depois de ajustar o que ela devolveu."
              : "O parecer está em versão final, mas ainda não foi enviado à Presidência."}
          </p>
          <Button size="sm" onClick={enviar} disabled={enviando} className="gap-1.5">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar à Presidência
          </Button>
        </div>
      )}

      {!f.ciclos.length && (
        <p className="text-xs text-muted-foreground">
          Nenhum parecer enviado à Presidência ainda. {modo === "comite" && !f.parecerFinal && "Finalize o Parecer Conclusivo acima."}
        </p>
      )}

      {/* ------------------------------------------- ciclo com a Presidência */}
      {aberto && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ciclo {aberto.ciclo} — com a Presidência desde {dataHoraBr(aberto.enviado_em)}
            {aberto.parecer_versao ? ` · parecer versão ${aberto.parecer_versao}` : ""}
          </p>
          {f.medidas.filter((m) => m.ciclo_id === aberto.id).map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{m.medida_rotulo}</p>
                <p className="text-xs text-muted-foreground">
                  {m.colaborador_nome ? `Colaborador: ${m.colaborador_nome}` : "Sem colaborador vinculado"}
                  {m.contrato_texto ? ` · Contrato: ${m.contrato_texto}` : ""}
                </p>
                {m.status !== "pendente" && (
                  <p className="mt-1 text-xs">
                    <Badge variant="outline" className={TOM[m.status === "aprovada" ? "ok" : "erro"]}>{SITUACAO_MEDIDA[m.status]}</Badge>
                    {m.decisao_texto && <span className="ml-2 text-muted-foreground">{m.decisao_texto}</span>}
                  </p>
                )}
              </div>
              {modo === "presidencia" && podeDecidir && m.status === "pendente" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDecidir({ medida: m, aprovar: false })}>
                    <Undo2 className="h-4 w-4" /> Desaprovar
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => setDecidir({ medida: m, aprovar: true })}>
                    <CheckCircle2 className="h-4 w-4" />
                    {m.medida === "nenhuma" ? "Aprovar o parecer" : "Aprovar e encaminhar ao Jurídico"}
                  </Button>
                </div>
              )}
              {m.status === "pendente" && !(modo === "presidencia" && podeDecidir) && (
                <Badge variant="outline" className={TOM.atencao}>Aguardando a Presidência</Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* --------------------------------------------------- cumprimento */}
      {aprovadas.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Medidas aprovadas e cumprimento</p>
          {aprovadas.map((m) => {
            const it = itemDe(m.id);
            const et = etapaDaMedida(m, it);
            return (
              <div key={m.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {m.medida_rotulo}{m.colaborador_nome ? ` — ${m.colaborador_nome}` : ""}
                    {m.advertencia_id ? <span className="ml-2 text-xs font-normal text-muted-foreground">solicitação #{m.advertencia_id}</span> : null}
                  </p>
                  <Badge variant="outline" className={TOM[et.tom]}>{et.rotulo}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Aprovada por {m.decidido_por_nome ?? "—"} em {dataHoraBr(m.decidido_em)}
                  {it ? ` · supervisor ${it.supervisor_nome ?? "—"} (${it.contrato_nome ?? "—"}) desde ${dataBr(it.encaminhado_em)}` : ""}
                </p>
                {it && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {it.documento_path && <ArquivoBotao path={it.documento_path} rotulo={`Documento do Jurídico (${it.documento_nome ?? "arquivo"})`} />}
                    {it.comprovante_path && <ArquivoBotao path={it.comprovante_path} rotulo="Comprovante da aplicação" />}
                    {it.aplicacao_obs && <span className="text-xs text-muted-foreground">Obs. do supervisor: {it.aplicacao_obs}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ----------------------------------------------- ciclos anteriores */}
      {f.ciclos.filter((c) => c.status !== "aguardando_presidencia").length > 0 && (
        <details className="rounded-md border bg-muted/30 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            Ciclos anteriores ({f.ciclos.filter((c) => c.status !== "aguardando_presidencia").length})
          </summary>
          <div className="mt-2 space-y-2">
            {f.ciclos.filter((c) => c.status !== "aguardando_presidencia").map((c) => (
              <div key={c.id} className="rounded border bg-background p-2 text-xs">
                <p className="font-semibold">
                  Ciclo {c.ciclo} · {SITUACAO_CICLO[c.status]} · enviado em {dataHoraBr(c.enviado_em)} por {c.enviado_por_nome ?? "—"}
                </p>
                {f.medidas.filter((m) => m.ciclo_id === c.id).map((m) => (
                  <p key={m.id} className="mt-1">
                    {m.medida_rotulo}: <b>{SITUACAO_MEDIDA[m.status]}</b>
                    {m.decisao_texto ? ` — ${m.decisao_texto}` : ""}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* --------------------------------------------------------- trilha */}
      {f.eventos.length > 0 && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Histórico do encaminhamento ({f.eventos.length})</summary>
          <div className="mt-2 space-y-1.5 border-l-2 pl-3">
            {f.eventos.map((e) => (
              <div key={e.id} className="text-xs">
                <p><Badge variant="outline" className="mr-1 text-[10px]">{ETAPA[e.etapa]}</Badge><b>{e.evento}</b></p>
                <p className="text-muted-foreground">{dataHoraBr(e.em)}{e.usuario_nome ? ` · ${e.usuario_nome}` : ""}{e.detalhe ? ` — ${e.detalhe}` : ""}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      {decidir && (
        <DecidirMedida
          denunciaId={denunciaId} medida={decidir.medida} aprovar={decidir.aprovar}
          onFechar={() => setDecidir(null)}
          onFeito={() => { setDecidir(null); recarregar(); }}
        />
      )}
    </Card>
  );
}

function ArquivoBotao({ path, rotulo }: { path: string; rotulo: string }) {
  const { toast } = useToast();
  return (
    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
            onClick={() => abrirArquivoMedida(path).catch((e) => toast({ title: "Não foi possível abrir", description: e.message, variant: "destructive" }))}>
      <FileText className="h-3.5 w-3.5" /> {rotulo}
    </Button>
  );
}

// --------------------------------------------------------- decisão
function DecidirMedida({ denunciaId, medida: m, aprovar, onFechar, onFeito }: {
  denunciaId: string; medida: Medida; aprovar: boolean; onFechar: () => void; onFeito: () => void;
}) {
  const { toast } = useToast();
  const [texto, setTexto] = useState("");
  const [resumo, setResumo] = useState("");
  const [usouIa, setUsouIa] = useState(false);
  const [orientacao, setOrientacao] = useState("");
  const [colaborador, setColaborador] = useState(m.colaborador_nome ?? "");
  const [gerando, setGerando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const comJuridico = aprovar && m.medida !== "nenhuma";

  const gerar = async () => {
    setGerando(true);
    const { data, error } = await supabase.functions.invoke("denuncia-parecer-ia", {
      body: { denuncia_id: denunciaId, modo: "encaminhamento", medida_id: m.id, orientacao, colaborador },
    });
    setGerando(false);
    const msg = error ? await erroDaEdge(error) : data?.error;
    if (msg) { toast({ title: "A I.A não gerou o resumo", description: msg, variant: "destructive" }); return; }
    setResumo(String(data?.texto ?? ""));
    setUsouIa(true);
    toast({ title: "Resumo gerado", description: "Revise e edite antes de aprovar. Nada foi gravado ainda." });
  };

  const confirmar = async () => {
    const erro = validarDecisao({ aprovar, medida: m.medida, texto, resumo });
    if (erro) { toast({ title: "Falta preencher", description: erro, variant: "destructive" }); return; }
    setSalvando(true);
    const { error } = await db.rpc("cetica_medida_decidir", {
      _medida: m.id, _aprovar: aprovar, _texto: texto.trim() || null,
      _resumo: comJuridico ? resumo.trim() : null, _resumo_ia: comJuridico && usouIa,
      _colaborador_id: null, _colaborador_nome: colaborador.trim() || null,
    });
    setSalvando(false);
    if (error) { toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" }); return; }
    toast({
      title: aprovar ? (comJuridico ? "Aprovada e encaminhada ao Jurídico" : "Parecer aprovado") : "Medida desaprovada",
      description: aprovar ? m.medida_rotulo : "Quando todas as medidas do ciclo forem decididas, o parecer volta ao Comitê.",
    });
    onFeito();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {aprovar ? (comJuridico ? "Aprovar e encaminhar ao Jurídico" : "Aprovar o parecer") : "Desaprovar"} — {m.medida_rotulo}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!aprovar && (
            <div className="space-y-1">
              <p className="text-xs font-semibold">Medida que propõe ou aditivo à decisão (obrigatório)</p>
              <Textarea rows={4} value={texto} onChange={(e) => setTexto(e.target.value)}
                        placeholder="Ex.: substituir por orientação individual com registro em ata." />
              <p className="text-[11px] text-muted-foreground">O Comitê reavalia e reenvia o parecer ajustado para nova decisão.</p>
            </div>
          )}
          {comJuridico && (
            <>
              <div className="space-y-1">
                <p className="text-xs font-semibold">Colaborador</p>
                <Input value={colaborador} onChange={(e) => setColaborador(e.target.value)} placeholder="Se houver" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold">Orientação para a I.A (opcional)</p>
                <Textarea rows={2} value={orientacao} onChange={(e) => setOrientacao(e.target.value)}
                          placeholder="Ex.: reforçar que é reincidência; advertência escrita com ciência do RH." />
                <Button type="button" size="sm" variant="outline" onClick={gerar} disabled={gerando} className="gap-1.5">
                  {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Gerar resumo com I.A
                </Button>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold">Resumo do parecer para o Jurídico (obrigatório)</p>
                <Textarea rows={10} value={resumo} onChange={(e) => setResumo(e.target.value)}
                          placeholder="O que o Jurídico precisa para redigir a advertência padrão. Não identifique o denunciante." />
                <p className="text-[11px] text-muted-foreground">
                  Vai para a solicitação de advertência no Jurídico, com o nº da denúncia, o contrato e a medida.
                </p>
              </div>
            </>
          )}
          {aprovar && (
            <div className="space-y-1">
              <p className="text-xs font-semibold">Observação (opcional)</p>
              <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} />
            </div>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
            <Button onClick={confirmar} disabled={salvando} variant={aprovar ? "default" : "destructive"} className="gap-1.5">
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              {aprovar ? (comJuridico ? "Aprovar e encaminhar" : "Aprovar") : "Desaprovar e devolver"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
