import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Download, ExternalLink, ListChecks, Check, X, Trophy, RotateCcw, Loader2, PartyPopper, Lock, PlayCircle,
} from "lucide-react";
import {
  acertosMinimos, corrigirProva, embedDeVideo,
  type EscopoTreinamento, type EstadoProva, type ResultadoProvaServidor, type Treinamento,
} from "./core";
import { PlayerAteOFim, type FonteVideo } from "@/components/treinamentos/PlayerAteOFim";
import { ReacoesVideo } from "@/components/treinamentos/ReacoesVideo";
import { useCurtirTreinamento, useNumerosTreinamentos, useRecarregarNumeros } from "@/hooks/useVideoNumeros";

// =====================================================================
// TREINAMENTOS — assistir, baixar o material e fazer a prova.
//
// Sem prova, abrir já conclui. Com prova, a conclusão é o resultado dela.
//
// 02/10/2026: com vídeo que o player acompanha (arquivo, YouTube, Vimeo), só
// conclui — e só envia a prova — depois de assistir até o fim, sem adiantar
// (PlayerAteOFim, a mesma regra das aulas do Portal, mig 290).
//
// 14/10/2026 (mig 20261014000020): A PROVA É CORRIGIDA NO BANCO. A tela não
// tem mais o gabarito (chega -1) e não grava a nota: manda as respostas para
// trn_prova_enviar, que corrige, grava a tentativa e a conclusão. O banco
// também guarda a regra das tentativas — reprovou, precisa assistir o vídeo
// de novo até o fim (trn_video_assistido) antes de refazer; reprovou o
// limite de vezes seguidas, a prova trava e quem cuida dos treinamentos é
// alertado. A tela só reflete o que trn_prova_estado diz.
// =====================================================================

interface Props {
  treinamento: Treinamento | null;
  meuNome: string;
  meuId: string | undefined;
  /** De qual porta a pessoa entrou — vai junto no registro de visualização. */
  escopo: EscopoTreinamento;
  jaFeito: { prova_nota: number | null; aprovado: boolean | null } | null;
  onFechar: () => void;
  onConcluido: () => void;
}

export function TreinamentoVisor({ treinamento, meuNome, meuId, escopo, jaFeito, onFechar, onConcluido }: Props) {
  const { toast } = useToast();
  const [urlVideo, setUrlVideo] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<Record<string, number | undefined>>({});
  const [resultado, setResultado] = useState<ResultadoProvaServidor | null>(null);
  const [estado, setEstado] = useState<EstadoProva | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  // Trocar a chave remonta o player: é o "assistir de novo" depois de reprovar.
  const [rodada, setRodada] = useState(0);
  const topoRef = useRef<HTMLDivElement>(null);

  const t = treinamento;
  const temProva = Array.isArray(t?.prova) && t!.prova!.length > 0;
  const embed = t?.video_url ? embedDeVideo(t.video_url) : null;
  // O vídeo que o player acompanha até o fim: o arquivo do bucket ou o link.
  const fonte: FonteVideo | null = urlVideo
    ? { tipo: "arquivo", src: urlVideo }
    : embed && (embed.tipo === "youtube" || embed.tipo === "vimeo" || embed.tipo === "arquivo") ? { tipo: embed.tipo, src: embed.src } : null;
  const exigeVideo = !!t?.video_path || !!fonte;
  const [videoVisto, setVideoVisto] = useState(false);
  useEffect(() => { setVideoVisto(false); setRodada(0); }, [t?.id]);
  const jaConcluiu = !!jaFeito;
  // Com prova quem decide é o banco (precisa_ver_video); sem prova vale a
  // regra de antes: quem já concluiu revê livre.
  const precisaVerVideo = temProva ? !!estado?.precisa_ver_video : exigeVideo && !jaConcluiu;
  const faltaVideo = exigeVideo && precisaVerVideo && !videoVisto;
  const bloqueado = !!estado?.bloqueado;

  const carregarEstado = useCallback(async () => {
    if (!t?.id || !temProva) { setEstado(null); return; }
    const { data, error } = await (supabase as any).rpc("trn_prova_estado", { _treinamento: t.id });
    if (error) { console.warn("[treinamentos] estado da prova:", error.message); return; }
    setEstado(data as EstadoProva);
  }, [t?.id, temProva]);

  // Bucket privado: o arquivo só abre por URL assinada, gerada a cada
  // abertura. Uma hora é folga suficiente para assistir sem recarregar.
  useEffect(() => {
    let cancelado = false;
    setRespostas({}); setResultado(null); setUrlVideo(null); setEstado(null);
    carregarEstado();
    if (!t?.video_path) return;
    (async () => {
      const { data } = await supabase.storage.from("treinamentos").createSignedUrl(t.video_path!, 3600);
      if (!cancelado) setUrlVideo(data?.signedUrl ?? null);
    })();
    return () => { cancelado = true; };
  }, [t?.id, t?.video_path, carregarEstado]);

  // Registra que esta pessoa ABRIU o treinamento — a metade que faltava para
  // o Dashboard de vídeos responder "quem assistiu", e não só "quem concluiu".
  //
  // Dispara na abertura, não no play: YouTube e Vimeo tocam dentro de um
  // iframe de outro domínio, que não deixa a página saber se alguém apertou
  // play. Contar a abertura é o que dá para afirmar com honestidade — e é o
  // que a coluna "Visualizações" do dashboard diz que significa.
  //
  // Falha em silêncio de propósito: não conseguir contabilizar não pode
  // impedir ninguém de assistir ao treinamento.
  //
  // Visualizações e curtidas (05/10/2026, mig 20261005000004): depois de
  // registrar, recarrega os números para a abertura de agora já aparecer.
  const numeros = useNumerosTreinamentos(t?.id ? [t.id] : []);
  const recarregarNumeros = useRecarregarNumeros();
  const curtir = useCurtirTreinamento();
  useEffect(() => {
    if (!t?.id || !meuId) return;
    (async () => {
      const { error } = await (supabase as any).rpc("trn_registrar_visualizacao", {
        _treinamento: t.id,
        _escopo: escopo,
      });
      if (error) console.warn("[treinamentos] visualização não registrada:", error.message);
      else recarregarNumeros();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, meuId, escopo]);

  // O player chegou ao fim. Com prova, o banco precisa saber — é ele que
  // libera a (nova) tentativa.
  const videoTerminou = async () => {
    setVideoVisto(true);
    if (!t?.id || !temProva) return;
    const { error } = await (supabase as any).rpc("trn_video_assistido", { _treinamento: t.id });
    if (error) {
      toast({ title: "Não consegui registrar que você assistiu", description: error.message, variant: "destructive" });
      return;
    }
    carregarEstado();
  };

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

  const enviarProva = async () => {
    if (!t || faltaVideo || bloqueado) return;
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
    const { data, error } = await (supabase as any).rpc("trn_prova_enviar", {
      _treinamento: t.id, _respostas: respostas,
    });
    setEnviando(false);
    if (error) {
      toast({ title: "Não deu para enviar a prova", description: error.message, variant: "destructive" });
      carregarEstado();
      return;
    }
    setResultado(data as ResultadoProvaServidor);
    carregarEstado();
    onConcluido();
  };

  // Reprovou e ainda tem tentativa: volta para o vídeo, do começo.
  const reverERefazer = () => {
    setRespostas({}); setResultado(null); setVideoVisto(false);
    setRodada(r => r + 1);
    topoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Treinamento sem prova: a conclusão segue gravada direto (a policy
  // trn_conc_insert só aceita isso quando o treinamento não tem prova).
  const concluirSemProva = async () => {
    if (!t || !meuId || faltaVideo) return;
    setEnviando(true);
    const r = corrigirProva(null, {});
    const { error } = await (supabase as any).from("TREINAMENTO_CONCLUSAO").upsert({
      treinamento_id: t.id,
      user_id: meuId,
      usuario_nome: meuNome,
      prova_nota: null,
      prova_respostas: null,
      aprovado: r.aprovado,
      concluido_em: new Date().toISOString(),
    }, { onConflict: "treinamento_id,user_id" });
    setEnviando(false);
    if (error) {
      toast({ title: "Não deu para registrar sua conclusão", description: error.message, variant: "destructive" });
      return;
    }
    onConcluido();
    toast({ title: "Treinamento concluído!", description: "Registramos que você viu o material." });
    onFechar();
  };

  if (!t) return null;
  const total = t.prova?.length ?? 0;
  const minimo = acertosMinimos(total, t.nota_minima);
  const max = estado?.max_tentativas ?? t.max_tentativas ?? null;
  const tentativaAtual = (estado?.falhas_seguidas ?? 0) + 1;

  return (
    <Dialog open={!!t} onOpenChange={o => !o && onFechar()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8 text-xl">{t.titulo}</DialogTitle>
        </DialogHeader>

        <div ref={topoRef} className="space-y-5">
          {t.descricao && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{t.descricao}</p>
          )}

          {/* ---- vídeo ---- */}
          {fonte && (
            <div className="animate-in fade-in zoom-in-95 duration-300">
              <PlayerAteOFim key={rodada} fonte={fonte} titulo={t.titulo}
                jaAssistido={!precisaVerVideo} onTerminou={videoTerminou} />
            </div>
          )}
          {(t.video_url || t.video_path) && (
            <ReacoesVideo numeros={numeros.data?.[t.id]} curtindo={curtir.isPending}
              onCurtir={() => curtir.mutate(t.id, {
                onError: (e) => toast({ title: "Não deu para curtir", description: (e as Error).message, variant: "destructive" }),
              })} />
          )}
          {t.video_path && !urlVideo && (
            <div className="grid aspect-video place-items-center rounded-xl border bg-black text-white/70">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          {embed && embed.tipo === "desconhecido" && (
            <Button variant="outline" asChild className="w-full">
              <a href={embed.src} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Abrir o vídeo em outra aba
              </a>
            </Button>
          )}

          {/* ---- anexo ---- */}
          {t.anexo_path && (
            <Button variant="outline" className="w-full justify-start" onClick={baixarAnexo} disabled={baixando}>
              {baixando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {t.anexo_nome ?? "Baixar o material de apoio"}
            </Button>
          )}

          {/* ---- prova travada ---- */}
          {temProva && bloqueado && !resultado && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <Lock className="h-10 w-10 text-destructive" />
              <p className="font-semibold">Prova travada</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Você não atingiu {minimo} de {total} acertos em {estado?.falhas_seguidas} tentativas seguidas. A equipe responsável
                já foi avisada e vai conversar com você antes de liberar uma nova rodada.
              </p>
            </div>
          )}

          {/* ---- prova ---- */}
          {temProva && !bloqueado && !resultado && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <ListChecks className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Prova</h3>
                <span className="text-sm text-muted-foreground">
                  {total} {total === 1 ? "questão" : "questões"} · precisa acertar {minimo} de {total} ({t.nota_minima}%)
                </span>
                {max != null && (
                  <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums">
                    Tentativa {Math.min(tentativaAtual, max)} de {max}
                  </span>
                )}
              </div>

              {jaFeito?.aprovado && (
                <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                  Você já foi aprovado com {jaFeito.prova_nota}%. Refazer substitui a nota anterior.
                </p>
              )}
              {(estado?.falhas_seguidas ?? 0) > 0 && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  Você reprovou {estado!.falhas_seguidas}x seguida{estado!.falhas_seguidas > 1 ? "s" : ""}.
                  {estado?.restantes != null && <> Restam <b>{estado.restantes}</b> tentativa{estado.restantes === 1 ? "" : "s"} antes de a prova travar.</>}
                </p>
              )}

              {t.prova!.map((q, qi) => (
                <div key={q.id} className="space-y-2 rounded-lg border p-4">
                  <p className="font-medium">
                    <span className="mr-2 text-primary">{qi + 1}.</span>{q.enunciado}
                  </p>
                  <div className="space-y-1.5">
                    {q.opcoes.map((o, oi) => (
                      <button key={oi} type="button" disabled={faltaVideo}
                        onClick={() => setRespostas(r => ({ ...r, [q.id]: oi }))}
                        className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-all disabled:cursor-not-allowed disabled:opacity-60
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

              {faltaVideo && (
                <p className="rounded-lg bg-muted p-3 text-center text-sm text-muted-foreground">
                  {(estado?.falhas_seguidas ?? 0) > 0
                    ? "Assista o vídeo novamente até o fim para refazer a prova."
                    : "Assista o vídeo até o fim para fazer a prova."}
                </p>
              )}
              <Button className="w-full" size="lg" onClick={enviarProva} disabled={enviando || faltaVideo || !estado}>
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
                  : resultado.bloqueado
                    ? "bg-gradient-to-b from-red-50 to-red-100 dark:from-red-950/40 dark:to-red-900/20"
                    : "bg-gradient-to-b from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/20"}`}>
                {resultado.aprovado
                  ? <PartyPopper className="h-12 w-12 text-emerald-600 animate-in zoom-in duration-500" />
                  : resultado.bloqueado
                    ? <Lock className="h-12 w-12 text-red-600 animate-in zoom-in duration-500" />
                    : <RotateCcw className="h-12 w-12 text-amber-600 animate-in zoom-in duration-500" />}
                <p className="text-3xl font-black tabular-nums">{resultado.acertos} de {resultado.total}</p>
                <p className="font-semibold">
                  {resultado.aprovado ? "Aprovado!"
                    : `Não foi desta vez — precisa acertar ${acertosMinimos(resultado.total, resultado.nota_minima)} de ${resultado.total}`}
                </p>
                <p className="text-sm text-muted-foreground">
                  Nota {resultado.nota}% · tentativa {resultado.tentativa}
                </p>
                {!resultado.aprovado && (
                  <p className="max-w-md text-sm">
                    {resultado.bloqueado
                      ? <>Você chegou ao limite de {resultado.max_tentativas} tentativas. A prova travou e a equipe responsável foi avisada para verificar com você.</>
                      : resultado.restantes != null
                        ? <>Restam <b>{resultado.restantes}</b> tentativa{resultado.restantes === 1 ? "" : "s"}. Assista o vídeo de novo antes de refazer.</>
                        : <>Assista o vídeo de novo e refaça a prova.</>}
                  </p>
                )}
              </div>

              {/* Gabarito só para quem passou: para quem vai refazer, mostra
                  onde errou sem entregar a resposta da próxima tentativa. */}
              <div className="space-y-2">
                {t.prova!.map((q, qi) => {
                  const acertou = resultado.por_questao[qi];
                  const certa = resultado.gabarito?.[q.id];
                  return (
                    <div key={q.id} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                      {acertou
                        ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        : <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                      <div className="space-y-1">
                        <p className="font-medium">{qi + 1}. {q.enunciado}</p>
                        {!acertou && certa != null && (
                          <p className="text-muted-foreground">
                            Resposta certa: <strong className="text-emerald-700 dark:text-emerald-400">{q.opcoes[certa]}</strong>
                          </p>
                        )}
                        {!acertou && certa == null && (
                          <p className="text-muted-foreground">Você errou esta. Reveja o vídeo — a resposta está nele.</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2">
                {resultado.aprovado ? (
                  <Button variant="outline" className="flex-1" onClick={() => { setRespostas({}); setResultado(null); }}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Refazer
                  </Button>
                ) : !resultado.bloqueado && (
                  <Button variant="outline" className="flex-1" onClick={reverERefazer}>
                    <PlayCircle className="mr-2 h-4 w-4" />
                    {resultado.precisa_ver_video ? "Assistir de novo e refazer" : "Refazer"}
                  </Button>
                )}
                <Button className="flex-1" onClick={onFechar}>
                  <Trophy className="mr-2 h-4 w-4" /> {resultado.aprovado ? "Concluir" : "Fechar"}
                </Button>
              </div>
            </div>
          )}

          {/* Sem prova, concluir é o próprio botão. */}
          {!temProva && (
            <div className="space-y-2">
              {faltaVideo && <p className="text-center text-sm text-muted-foreground">Assista o vídeo até o fim para concluir.</p>}
              <Button className="w-full" size="lg" onClick={concluirSemProva} disabled={enviando || faltaVideo}>
                {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Marcar como concluído
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
