import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Lock, LockOpen, Save, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type DocumentoInvestigacao, type TipoDocumento, ROTULO_SITUACAO_DOC, TIPOS_DOCUMENTO,
  aplicarMinuta, podeMarcarFinal, podeRedigirDocumento, situacaoDocumento,
} from "./documentos";
import { MINUTAS, type IdMinuta } from "../../../supabase/functions/_shared/denuncia-minuta-ia";

// =====================================================================
// ABERTURA DE INVESTIGAÇÃO — documentos formais do procedimento
// (19/11/2026, pedido do Comitê de Ética)
//
// Duas abas — Termo de Abertura e Parecer Conclusivo — com editor, salvar
// (o banco carimba quem e quando, e cada salvamento vira versão) e versão
// final. O botão "Gerar documento com IA" pede uma minuta à Edge
// denuncia-parecer-ia (modo "minuta"), que lê o caso e os anexos com o
// login de quem clicou. A minuta só preenche o editor: ninguém salva por
// ela, e a versão final é sempre um clique do relator.
//
// Quem redige: relator do caso (apuracao_responsavel_id), Presidência ou
// `comite_etica_documentos`. Os demais do Comitê leem. A RLS decide; a tela
// só esconde os botões.
// =====================================================================

const COLS = "id, denuncia_id, tipo, conteudo, versao, final, usou_minuta_ia, finalizado_em, finalizado_por_nome, atualizado_por_nome, updated_at";

const fmt = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

interface RespostaMinuta {
  texto: string;
  documento: IdMinuta;
  modelo?: string;
  anexos?: { numero: number; nome: string; lido: boolean; aviso: string | null }[];
}

async function pedirMinuta(denunciaId: string, documento: IdMinuta, orientacao: string): Promise<RespostaMinuta> {
  const { data, error } = await supabase.functions.invoke("denuncia-parecer-ia", {
    body: { denuncia_id: denunciaId, modo: "minuta", documento, orientacao },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(corpo?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as RespostaMinuta;
}

export function DocumentosInvestigacao({ denunciaId, relatorId }: { denunciaId: string; relatorId: string | null }) {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const { toast } = useToast();

  const podeRedigir = podeRedigirDocumento({
    userId: user?.id, relatorId,
    presidencia: can("visualizar", undefined, "comite_etica_presidencia"),
    capacidadeDocumentos: can("visualizar", undefined, "comite_etica_documentos"),
  });

  const [docs, setDocs] = useState<Partial<Record<TipoDocumento, DocumentoInvestigacao>>>({});
  const [rascunho, setRascunho] = useState<Record<TipoDocumento, string>>({ termo_abertura: "", parecer_conclusivo: "" });
  const [usouIa, setUsouIa] = useState<Record<TipoDocumento, boolean>>({ termo_abertura: false, parecer_conclusivo: false });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<TipoDocumento | null>(null);
  const [aba, setAba] = useState<TipoDocumento>("termo_abertura");
  const [iaAberta, setIaAberta] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await db.from("CANAL_DENUNCIA_DOCUMENTO").select(COLS).eq("denuncia_id", denunciaId);
    setCarregando(false);
    if (error) { setErro(error.message); return; }
    setErro(null);
    const mapa: Partial<Record<TipoDocumento, DocumentoInvestigacao>> = {};
    for (const d of (data ?? []) as DocumentoInvestigacao[]) mapa[d.tipo] = d;
    setDocs(mapa);
    setRascunho({ termo_abertura: mapa.termo_abertura?.conteudo ?? "", parecer_conclusivo: mapa.parecer_conclusivo?.conteudo ?? "" });
    setUsouIa({ termo_abertura: false, parecer_conclusivo: false });
  }, [denunciaId]);

  useEffect(() => { carregar(); }, [carregar]);

  /** Grava o editor. `final`: undefined = mantém; true = marca; false = reabre. */
  const gravar = async (tipo: TipoDocumento, final?: boolean) => {
    if (salvando) return;
    const atual = docs[tipo];
    const conteudo = rascunho[tipo];
    setSalvando(tipo);
    const campos = {
      conteudo,
      final: final ?? atual?.final ?? false,
      usou_minuta_ia: (atual?.usou_minuta_ia ?? false) || usouIa[tipo],
    };
    const { data, error } = atual
      ? await db.from("CANAL_DENUNCIA_DOCUMENTO").update(campos).eq("id", atual.id).select(COLS).single()
      : await db.from("CANAL_DENUNCIA_DOCUMENTO").insert({ denuncia_id: denunciaId, tipo, ...campos }).select(COLS).single();
    setSalvando(null);
    if (error) { toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }); return; }
    const d = data as DocumentoInvestigacao;
    setDocs((c) => ({ ...c, [tipo]: d }));
    setRascunho((c) => ({ ...c, [tipo]: d.conteudo }));
    setUsouIa((c) => ({ ...c, [tipo]: false }));
    toast({
      title: final === true ? "Versão final registrada" : final === false ? "Documento reaberto para edição" : "Documento salvo",
      description: `${TIPOS_DOCUMENTO.find((t) => t.id === tipo)?.rotulo} · versão ${d.versao}`,
    });
  };

  return (
    <Card className="space-y-3 border-primary/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
            <FileText className="h-4 w-4 text-primary" /> Abertura de investigação
          </p>
          <p className="text-xs text-muted-foreground">
            Documentos formais do procedimento. {podeRedigir
              ? "Você pode redigir: salve o rascunho e, quando estiver pronto, marque a versão final."
              : "Somente leitura — quem redige é o relator do caso e a Presidência."}
          </p>
        </div>
        {podeRedigir && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setIaAberta(true)}>
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Gerar documento com IA
          </Button>
        )}
      </div>

      {erro ? (
        <p className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> Não foi possível carregar os documentos: {erro}
        </p>
      ) : carregando ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Carregando…</p>
      ) : (
        <Tabs value={aba} onValueChange={(v) => setAba(v as TipoDocumento)}>
          <TabsList className="h-auto flex-wrap">
            {TIPOS_DOCUMENTO.map((t) => {
              const sit = situacaoDocumento(docs[t.id] ?? null, rascunho[t.id]);
              return (
                <TabsTrigger key={t.id} value={t.id} className="gap-1.5 text-xs">
                  {t.aba}
                  {sit === "final" && <CheckCircle2 className="h-3 w-3 text-success" />}
                  {sit === "alterado" && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {TIPOS_DOCUMENTO.map((t) => {
            const doc = docs[t.id] ?? null;
            const texto = rascunho[t.id];
            const sit = situacaoDocumento(doc, texto);
            const travado = !!doc?.final;
            return (
              <TabsContent key={t.id} value={t.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold">{t.rotulo}</p>
                  <Badge variant="outline" className={`text-[10px] ${sit === "final" ? "border-success text-success" : sit === "alterado" ? "border-warning text-warning" : ""}`}>
                    {ROTULO_SITUACAO_DOC[sit]}
                  </Badge>
                  {doc?.usou_minuta_ia && <Badge variant="outline" className="text-[10px]">Partiu de minuta da I.A</Badge>}
                </div>
                <p className="text-[11px] text-muted-foreground">{t.desc}</p>
                <Textarea
                  rows={14}
                  value={texto}
                  readOnly={!podeRedigir || travado}
                  onChange={(e) => setRascunho((c) => ({ ...c, [t.id]: e.target.value }))}
                  placeholder={podeRedigir ? "Escreva o documento ou use “Gerar documento com IA” para começar de uma minuta." : "Ainda não redigido."}
                  className="font-mono text-xs leading-relaxed"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {doc
                      ? <>Salvo por <b>{doc.atualizado_por_nome || "—"}</b> em {fmt(doc.updated_at)} · versão {doc.versao}
                          {doc.final && <> · versão final por <b>{doc.finalizado_por_nome || "—"}</b> em {fmt(doc.finalizado_em)}</>}</>
                      : "Ainda não salvo."}
                  </p>
                  {podeRedigir && (
                    <div className="flex flex-wrap gap-2">
                      {travado ? (
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={!!salvando} onClick={() => gravar(t.id, false)}>
                          {salvando === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />} Reabrir para editar
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="gap-1.5" disabled={!!salvando || sit !== "alterado"} onClick={() => gravar(t.id)}>
                            {salvando === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar rascunho
                          </Button>
                          <Button size="sm" className="gap-1.5" disabled={!!salvando || !podeMarcarFinal(doc, texto)}
                                  title={sit === "alterado" ? "Salve antes de marcar a versão final." : undefined}
                                  onClick={() => gravar(t.id, true)}>
                            <Lock className="h-3.5 w-3.5" /> Marcar versão final
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {iaAberta && (
        <DialogMinutaIa
          denunciaId={denunciaId}
          abaAtual={aba}
          onFechar={() => setIaAberta(false)}
          onUsar={(tipo, textoMinuta, modo) => {
            if (docs[tipo]?.final) {
              toast({ title: "Documento em versão final", description: "Reabra o documento antes de trazer a minuta.", variant: "destructive" });
              return;
            }
            setRascunho((c) => ({ ...c, [tipo]: aplicarMinuta(c[tipo], textoMinuta, modo) }));
            setUsouIa((c) => ({ ...c, [tipo]: true }));
            setAba(tipo);
            setIaAberta(false);
            toast({ title: "Minuta levada ao editor", description: "Revise, edite e salve. Nada foi gravado ainda." });
          }}
        />
      )}
    </Card>
  );
}

function DialogMinutaIa({ denunciaId, abaAtual, onFechar, onUsar }: {
  denunciaId: string;
  abaAtual: TipoDocumento;
  onFechar: () => void;
  onUsar: (tipo: TipoDocumento, texto: string, modo: "substituir" | "acrescentar") => void;
}) {
  const [tipo, setTipo] = useState<IdMinuta>(abaAtual);
  const [orientacao, setOrientacao] = useState("");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [res, setRes] = useState<RespostaMinuta | null>(null);
  const [texto, setTexto] = useState("");

  const minuta = MINUTAS.find((m) => m.id === tipo)!;

  const gerar = async () => {
    setGerando(true); setErro(null); setRes(null);
    try {
      const r = await pedirMinuta(denunciaId, tipo, orientacao);
      setRes(r); setTexto(r.texto);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !gerando) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Gerar documento com IA</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A I.A lê o relato, a ficha da apuração e o conteúdo dos anexos (PDF, Word, texto e imagens) e escreve uma minuta.
            Anexos sigilosos e a identidade do denunciante não são enviados. A minuta vai para o editor — você revisa e salva.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MINUTAS.map((m) => (
              <button key={m.id} type="button" disabled={gerando}
                onClick={() => { setTipo(m.id); setRes(null); setErro(null); }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${tipo === m.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40"}`}>
                {m.rotulo}
              </button>
            ))}
          </div>
          <Textarea rows={2} value={orientacao} onChange={(e) => setOrientacao(e.target.value)} disabled={gerando}
            placeholder="Orientação opcional à I.A (ex.: dar ênfase às mensagens de WhatsApp anexadas)." className="text-xs" />
          <Button onClick={gerar} disabled={gerando} className="gap-1.5">
            {gerando ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Lendo o caso e os anexos…</> : <><Sparkles className="h-3.5 w-3.5" /> Gerar minuta — {minuta.rotulo}</>}
          </Button>

          {erro && (
            <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> A I.A não gerou a minuta: {erro}
            </p>
          )}

          {res && (
            <div className="space-y-2">
              {!!res.anexos?.length && (
                <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
                  <p className="mb-1 font-semibold">Anexos</p>
                  <ul className="space-y-0.5">
                    {res.anexos.map((a) => (
                      <li key={a.numero} className={a.lido ? "" : "text-muted-foreground"}>
                        [Anexo {a.numero}] {a.nome} — {a.lido ? "lido" : `não lido (${a.aviso})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[11px] font-semibold text-warning">MINUTA — revise antes de usar. Ainda não foi salva.</p>
              <Textarea rows={16} value={texto} onChange={(e) => setTexto(e.target.value)} className="font-mono text-xs leading-relaxed" />
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onFechar}>Descartar</Button>
                {minuta.id === "roteiro_entrevista" ? (
                  <Button size="sm" onClick={() => onUsar("termo_abertura", texto, "acrescentar")} disabled={!texto.trim()}>
                    Acrescentar ao Termo de Abertura
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => onUsar(minuta.aba, texto, "substituir")} disabled={!texto.trim()}>
                    Levar ao editor — {minuta.rotulo}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
