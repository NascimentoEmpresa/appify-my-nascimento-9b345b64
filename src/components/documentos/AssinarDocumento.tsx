import { useEffect, useState } from "react";
import { FileSignature, Loader2, Paperclip, PenLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { QuadroAssinatura } from "@/components/assinatura/QuadroAssinatura";
import { AssinaturaTraco } from "@/pages/treinamentos/plataforma/assinaturaFolha";
import { ImagensDocumento } from "@/components/documentos/ImagensDocumento";
import { useAssinarDocumento, useAssinaturaPadrao, useDetalheDocumento, urlDocumento } from "@/hooks/useDocumentosSolicitados";
import {
  TIPO_DOCUMENTO, ehImagem, fmtTamanho, nomeLegivel, problemaAssinaturaPessoal,
  type AssinaturaPessoal, type SolicitacaoDocumento,
} from "@/lib/rh/documentosSolicitados";

// =====================================================================
// RH › Documentos — janela de ASSINATURA (mig 20261022000500).
//
// Usada no detalhe da solicitação (botão "Assinar") e na janela do termo
// de ciência que aparece a cada entrada no sistema (GateTermoCiencia).
// Mostra o que está sendo assinado — descrição, imagens e arquivos — e
// pede a assinatura: a PADRÃO da conta (ou a de treinador de Treinamentos,
// se a pessoa ainda não salvou uma), ou DESENHADA na hora no mesmo quadro
// de Treinamentos, com a opção de virar a padrão.
// =====================================================================

/** O traço de uma assinatura (desenho ou texto em fonte cursiva), no formato de Treinamentos. */
export function TracoAssinatura({ a, nome, altura = "64px" }: {
  a: Pick<AssinaturaPessoal, "tipo" | "imagem" | "texto" | "fonte" | "tamanho">; nome?: string | null; altura?: string;
}) {
  return (
    <AssinaturaTraco altura={altura}
      a={{ nome_completo: nome ?? "", cargo: null, registro: null, tipo: a.tipo, imagem: a.imagem, texto: a.texto, fonte: a.fonte, tamanho: a.tamanho }} />
  );
}

interface Props {
  solicitacao: SolicitacaoDocumento | null;
  onFechar: () => void;
  /** Termo de ciência no login: "Assinar depois" (volta na próxima entrada). Sem isso, o botão é "Cancelar". */
  onAdiar?: () => void;
  /** Quantos termos ainda faltam depois deste (só informativo). */
  restantes?: number;
}

export function AssinarDocumento({ solicitacao: s, onFechar, onAdiar, restantes = 0 }: Props) {
  const detalhe = useDetalheDocumento(s?.id ?? null);
  const padrao = useAssinaturaPadrao(!!s);
  const assinar = useAssinarDocumento();
  const [modo, setModo] = useState<"padrao" | "desenhar">("desenhar");
  const [desenho, setDesenho] = useState<string | null>(null);
  const [salvarPadrao, setSalvarPadrao] = useState(false);
  const [observacao, setObservacao] = useState("");

  const temPadrao = !!padrao.data && !problemaAssinaturaPessoal(padrao.data);
  // Com padrão salva, já começa usando ela; sem, desenha e já oferece salvar.
  useEffect(() => {
    if (padrao.isLoading) return;
    setModo(temPadrao ? "padrao" : "desenhar");
    setSalvarPadrao(!temPadrao || padrao.data?.origem !== "conta");
  }, [temPadrao, padrao.isLoading, padrao.data?.origem, s?.id]);
  useEffect(() => { setDesenho(null); setObservacao(""); }, [s?.id]);

  if (!s) return null;
  const ciencia = s.tipo === "ciencia";
  const anexos = detalhe.data?.anexos ?? [];
  const arquivos = anexos.filter((a) => !ehImagem(a));
  const assinatura: AssinaturaPessoal | null = modo === "padrao"
    ? padrao.data ?? null
    : desenho ? { tipo: "desenho", imagem: desenho, texto: null, fonte: null, tamanho: 1 } : null;
  const problema = problemaAssinaturaPessoal(assinatura);

  const confirmar = async () => {
    if (!assinatura || problema) return;
    try {
      await assinar.mutateAsync({
        id: s.id, assinatura, observacao: ciencia ? undefined : observacao,
        // A padrão que veio de Treinamentos também pode virar a da conta.
        salvarPadrao: salvarPadrao && (modo === "desenhar" || padrao.data?.origem !== "conta"),
      });
      toast.success(ciencia ? "Termo de ciência assinado." : "Documento assinado. O RH foi avisado.");
      onFechar();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={!!s} onOpenChange={(v) => { if (!v) (onAdiar ?? onFechar)(); }}>
      <DialogContent className="max-h-[94vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <FileSignature className="h-5 w-5 text-primary" />
            {ciencia ? "Termo de ciência" : "Assinar documento"}
            <Badge variant="outline" className={cn("font-semibold", TIPO_DOCUMENTO[s.tipo].cor)}>{TIPO_DOCUMENTO[s.tipo].rotulo}</Badge>
          </DialogTitle>
          <DialogDescription>
            Enviado por {nomeLegivel(s.solicitante_nome) || "RH"} em {new Date(s.created_at).toLocaleDateString("pt-BR")}
            {s.contrato_nome ? ` · ${s.contrato_nome}` : ""}
            {restantes > 0 ? ` · mais ${restantes} termo${restantes === 1 ? "" : "s"} depois deste` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold leading-tight">{s.titulo}</h3>
          {s.descricao && <div className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">{s.descricao}</div>}

          <ImagensDocumento anexos={anexos} tamanho="grande" />

          {arquivos.length > 0 && (
            <ul className="space-y-1">
              {arquivos.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <button className="min-w-0 truncate text-left text-primary underline-offset-2 hover:underline"
                    onClick={async () => { const u = await urlDocumento(a.storage_path); if (u) window.open(u, "_blank"); else toast.error("Não foi possível abrir o arquivo."); }}>
                    {a.nome_arquivo ?? a.storage_path}
                  </button>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtTamanho(a.tamanho_bytes)}</span>
                </li>
              ))}
            </ul>
          )}
          {detalhe.isLoading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando anexos…</p>}

          {/* ── Assinatura ── */}
          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            {ciencia && (
              <p className="flex items-start gap-1.5 text-sm font-medium">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                Declaro que li e estou ciente do termo "{s.titulo}".
              </p>
            )}

            {padrao.isLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando sua assinatura…</p>
            ) : (
              <>
                {temPadrao && (
                  <div className="inline-flex rounded-lg border bg-background p-0.5">
                    {([["padrao", "Minha assinatura"], ["desenhar", "Desenhar agora"]] as const).map(([m, rot]) => (
                      <button key={m} type="button" onClick={() => setModo(m)}
                        className={cn("rounded-md px-3 py-1.5 text-xs font-semibold", modo === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                        {rot}
                      </button>
                    ))}
                  </div>
                )}

                {modo === "padrao" && padrao.data ? (
                  <div className="rounded-lg border bg-white px-3 py-4">
                    <TracoAssinatura a={padrao.data} altura="70px" />
                    <p className="mt-2 text-center text-xs text-slate-500">
                      {padrao.data.origem === "treinamentos" ? "Sua assinatura de Treinamentos" : "Sua assinatura padrão"}
                    </p>
                  </div>
                ) : (
                  <QuadroAssinatura key={s.id} imagem={desenho} onChange={setDesenho} />
                )}

                {(modo === "desenhar" || padrao.data?.origem === "treinamentos") && (
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={salvarPadrao} onCheckedChange={(v) => setSalvarPadrao(v === true)} />
                    {temPadrao && padrao.data?.origem === "conta" ? "Trocar minha assinatura padrão por esta" : "Salvar como minha assinatura padrão"}
                  </label>
                )}
              </>
            )}

            {!ciencia && (
              <Textarea rows={2} placeholder="Observação para o RH (opcional)" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onAdiar ?? onFechar}>{onAdiar ? "Assinar depois" : "Cancelar"}</Button>
          <Button onClick={confirmar} disabled={!!problema || assinar.isPending || padrao.isLoading}>
            {assinar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PenLine className="mr-1.5 h-4 w-4" />}
            {ciencia ? "Assinar o termo" : "Assinar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
