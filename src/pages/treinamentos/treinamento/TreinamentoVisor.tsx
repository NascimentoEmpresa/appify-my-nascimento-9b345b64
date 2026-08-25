import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Download, ExternalLink, ListChecks, Check, X, Trophy, RotateCcw, Loader2, PartyPopper,
} from "lucide-react";
import { corrigirProva, embedDeVideo, type Resultado, type Treinamento } from "./core";

// =====================================================================
// TREINAMENTOS — assistir, baixar o material e fazer a prova.
//
// Sem prova, abrir já conclui. Com prova, a conclusão é o resultado dela —
// e a nota é recalculada aqui, no cliente, apenas para mostrar; o que vale
// para o histórico é a linha gravada em TREINAMENTO_CONCLUSAO.
// =====================================================================

interface Props {
  treinamento: Treinamento | null;
  meuNome: string;
  meuId: string | undefined;
  jaFeito: { prova_nota: number | null; aprovado: boolean | null } | null;
  onFechar: () => void;
  onConcluido: () => void;
}

export function TreinamentoVisor({ treinamento, meuNome, meuId, jaFeito, onFechar, onConcluido }: Props) {
  const { toast } = useToast();
  const [urlVideo, setUrlVideo] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<Record<string, number | undefined>>({});
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [baixando, setBaixando] = useState(false);

  const t = treinamento;
  const temProva = Array.isArray(t?.prova) && t!.prova!.length > 0;
  const embed = t?.video_url ? embedDeVideo(t.video_url) : null;

  // Bucket privado: o arquivo só abre por URL assinada, gerada a cada
  // abertura. Uma hora é folga suficiente para assistir sem recarregar.
  useEffect(() => {
    let cancelado = false;
    setRespostas({}); setResultado(null); setUrlVideo(null);
    if (!t?.video_path) return;
    (async () => {
      const { data } = await supabase.storage.from("treinamentos").createSignedUrl(t.video_path!, 3600);
      if (!cancelado) setUrlVideo(data?.signedUrl ?? null);
    })();
    return () => { cancelado = true; };
  }, [t?.id, t?.video_path]);

  const baixarAnexo = async () => {
    if (!t?.anexo_path) return;
    setBaixando(true);
    const { data, error } = await supabase.storage.from("treinamentos").createSignedUrl(t.anexo_path, 3600);
    setBaixando(false);
    if (error || !data?.signedUrl) {
      toast({ title: "Não consegui abrir o anexo", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const registrar = async (r: Resultado) => {
    if (!t || !meuId) return;
    // upsert: refazer a prova atualiza a mesma linha (UNIQUE por
    // treinamento+usuário) em vez de empilhar histórico duplicado.
    const { error } = await (supabase as any).from("TREINAMENTO_CONCLUSAO").upsert({
      treinamento_id: t.id,
      user_id: meuId,
      usuario_nome: meuNome,
      prova_nota: temProva ? r.nota : null,
      prova_respostas: temProva ? respostas : null,
      aprovado: r.aprovado,
      concluido_em: new Date().toISOString(),
    }, { onConflict: "treinamento_id,user_id" });
    if (error) {
      toast({ title: "Não deu para registrar sua conclusão", description: error.message, variant: "destructive" });
      return;
    }
    onConcluido();
  };

  const enviarProva = async () => {
    if (!t) return;
    const naoRespondidas = t.prova!.filter(q => respostas[q.id] == null).length;
    if (naoRespondidas > 0) {
      toast({
        title: `Falta${naoRespondidas > 1 ? "m" : ""} ${naoRespondidas} quest${naoRespondidas > 1 ? "ões" : "ão"}`,
        description: "Responda tudo antes de enviar — questão em branco conta como erro.",
        variant: "destructive",
      });
      return;
    }
    setEnviando(true);
    const r = corrigirProva(t.prova, respostas, t.nota_minima);
    setResultado(r);
    await registrar(r);
    setEnviando(false);
  };

  const concluirSemProva = async () => {
    if (!t) return;
    setEnviando(true);
    await registrar(corrigirProva(null, {}));
    setEnviando(false);
    toast({ title: "Treinamento concluído!", description: "Registramos que você viu o material." });
    onFechar();
  };

  if (!t) return null;

  return (
    <Dialog open={!!t} onOpenChange={o => !o && onFechar()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8 text-xl">{t.titulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {t.descricao && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{t.descricao}</p>
          )}

          {/* ---- vídeo ---- */}
          {embed && (embed.tipo === "youtube" || embed.tipo === "vimeo") && (
            <div className="aspect-video overflow-hidden rounded-xl border bg-black shadow-lg animate-in fade-in zoom-in-95 duration-300">
              <iframe src={embed.src} className="h-full w-full" allowFullScreen
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                      title={t.titulo} />
            </div>
          )}
          {embed && embed.tipo === "arquivo" && (
            <video src={embed.src} controls className="aspect-video w-full rounded-xl border bg-black shadow-lg" />
          )}
          {embed && embed.tipo === "desconhecido" && (
            <Button variant="outline" asChild className="w-full">
              <a href={embed.src} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Abrir o vídeo em outra aba
              </a>
            </Button>
          )}
          {urlVideo && (
            <video src={urlVideo} controls className="aspect-video w-full rounded-xl border bg-black shadow-lg animate-in fade-in duration-300" />
          )}

          {/* ---- anexo ---- */}
          {t.anexo_path && (
            <Button variant="outline" className="w-full justify-start" onClick={baixarAnexo} disabled={baixando}>
              {baixando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {t.anexo_nome ?? "Baixar o material de apoio"}
            </Button>
          )}

          {/* ---- prova ---- */}
          {temProva && !resultado && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-t pt-4">
                <ListChecks className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Prova</h3>
                <span className="text-sm text-muted-foreground">
                  {t.prova!.length} {t.prova!.length === 1 ? "questão" : "questões"} · precisa de {t.nota_minima}% para passar
                </span>
              </div>

              {jaFeito?.aprovado && (
                <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                  Você já foi aprovado com {jaFeito.prova_nota}%. Refazer substitui a nota anterior.
                </p>
              )}

              {t.prova!.map((q, qi) => (
                <div key={q.id} className="space-y-2 rounded-lg border p-4">
                  <p className="font-medium">
                    <span className="mr-2 text-primary">{qi + 1}.</span>{q.enunciado}
                  </p>
                  <div className="space-y-1.5">
                    {q.opcoes.map((o, oi) => (
                      <button key={oi} type="button"
                        onClick={() => setRespostas(r => ({ ...r, [q.id]: oi }))}
                        className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-all
                          ${respostas[q.id] === oi
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "hover:border-primary/40 hover:bg-muted/50"}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all
                          ${respostas[q.id] === oi ? "border-primary bg-primary scale-110" : "border-muted-foreground/30"}`}>
                          {respostas[q.id] === oi && <Check className="h-3 w-3 text-primary-foreground" />}
                        </span>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <Button className="w-full" size="lg" onClick={enviarProva} disabled={enviando}>
                {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Corrigindo…</> : "Enviar prova"}
              </Button>
            </div>
          )}

          {/* ---- resultado ---- */}
          {resultado && (
            <div className="space-y-4 border-t pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className={`flex flex-col items-center gap-2 rounded-xl p-6 text-center
                ${resultado.aprovado
                  ? "bg-gradient-to-b from-emerald-50 to-emerald-100 dark:from-emerald-950/40 dark:to-emerald-900/20"
                  : "bg-gradient-to-b from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/20"}`}>
                {resultado.aprovado
                  ? <PartyPopper className="h-12 w-12 text-emerald-600 animate-in zoom-in duration-500" />
                  : <RotateCcw className="h-12 w-12 text-amber-600 animate-in zoom-in duration-500" />}
                <p className="text-3xl font-black tabular-nums">{resultado.nota}%</p>
                <p className="font-semibold">
                  {resultado.aprovado ? "Aprovado!" : `Faltou pouco — o mínimo é ${t.nota_minima}%`}
                </p>
                <p className="text-sm text-muted-foreground">
                  {resultado.acertos} de {resultado.total} {resultado.total === 1 ? "questão" : "questões"}
                </p>
              </div>

              {/* Gabarito: errar sem saber onde não ensina nada. */}
              <div className="space-y-2">
                {t.prova!.map((q, qi) => (
                  <div key={q.id} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                    {resultado.porQuestao[qi]
                      ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      : <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                    <div className="space-y-1">
                      <p className="font-medium">{qi + 1}. {q.enunciado}</p>
                      {!resultado.porQuestao[qi] && (
                        <p className="text-muted-foreground">
                          Resposta certa: <strong className="text-emerald-700 dark:text-emerald-400">{q.opcoes[q.correta]}</strong>
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1"
                        onClick={() => { setRespostas({}); setResultado(null); }}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Refazer
                </Button>
                <Button className="flex-1" onClick={onFechar}>
                  <Trophy className="mr-2 h-4 w-4" /> Concluir
                </Button>
              </div>
            </div>
          )}

          {/* Sem prova, concluir é o próprio botão. */}
          {!temProva && (
            <Button className="w-full" size="lg" onClick={concluirSemProva} disabled={enviando}>
              {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Marcar como concluído
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
