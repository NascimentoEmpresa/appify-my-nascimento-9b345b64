import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Video, Paperclip, ListChecks, Plus, Trash2, Check, Loader2, Upload, X, AlertCircle,
} from "lucide-react";
import {
  temConteudo, validarProva, caminhoNoBucket, embedDeVideo,
  type PerguntaProva, type Treinamento,
} from "./core";

// =====================================================================
// TREINAMENTOS — criar e editar um card.
//
// As três peças (vídeo, anexo, prova) são opcionais e ficam em abas, mas o
// botão de salvar só libera quando pelo menos uma existe — a mesma regra do
// CHECK `trn_precisa_de_conteudo`. O aviso aparece o tempo todo em vez de
// só no submit, para ninguém preencher a prova inteira e descobrir no fim.
// =====================================================================

type Aba = "video" | "anexo" | "prova";

const novaQuestao = (): PerguntaProva => ({
  id: crypto.randomUUID(), enunciado: "", opcoes: ["", ""], correta: 0,
});

interface Props {
  aberto: boolean;
  /** null = criando; objeto = editando. */
  treinamento: Treinamento | null;
  meuNome: string;
  meuId: string | undefined;
  onFechar: () => void;
  onSalvo: () => void;
}

export function TreinamentoEditor({ aberto, treinamento, meuNome, meuId, onFechar, onSalvo }: Props) {
  const { toast } = useToast();
  const [salvando, setSalvando] = useState(false);
  const [aba, setAba] = useState<Aba>("video");

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoArquivo, setVideoArquivo] = useState<File | null>(null);
  const [anexoPath, setAnexoPath] = useState<string | null>(null);
  const [anexoNome, setAnexoNome] = useState<string | null>(null);
  const [anexoArquivo, setAnexoArquivo] = useState<File | null>(null);
  const [prova, setProva] = useState<PerguntaProva[]>([]);
  const [notaMinima, setNotaMinima] = useState(70);
  const [publicado, setPublicado] = useState(true);

  const refVideo = useRef<HTMLInputElement>(null);
  const refAnexo = useRef<HTMLInputElement>(null);

  // Recarrega a cada abertura: o modal fica montado e sem isto o segundo
  // "Novo treinamento" viria com o que sobrou do card editado antes.
  useEffect(() => {
    if (!aberto) return;
    const t = treinamento;
    setTitulo(t?.titulo ?? "");
    setDescricao(t?.descricao ?? "");
    setVideoUrl(t?.video_url ?? "");
    setVideoPath(t?.video_path ?? null);
    setAnexoPath(t?.anexo_path ?? null);
    setAnexoNome(t?.anexo_nome ?? null);
    setProva(Array.isArray(t?.prova) ? t!.prova! : []);
    setNotaMinima(t?.nota_minima ?? 70);
    setPublicado(t?.publicado ?? true);
    setVideoArquivo(null); setAnexoArquivo(null);
    setAba("video");
  }, [aberto, treinamento]);

  // O que "vai existir" depois de salvar — inclui arquivo escolhido mas
  // ainda não enviado, senão o botão fica travado com o upload na mão.
  const rascunho = useMemo(() => ({
    video_url: videoUrl,
    video_path: videoArquivo ? "pendente" : videoPath,
    anexo_path: anexoArquivo ? "pendente" : anexoPath,
    prova,
  }), [videoUrl, videoArquivo, videoPath, anexoArquivo, anexoPath, prova]);

  const conteudoOk = temConteudo(rascunho);
  const tituloOk = titulo.trim().length > 0;
  const embed = videoUrl.trim() ? embedDeVideo(videoUrl) : null;

  const marcarCorreta = (qi: number, oi: number) =>
    setProva(p => p.map((q, i) => (i === qi ? { ...q, correta: oi } : q)));

  const mudarOpcao = (qi: number, oi: number, valor: string) =>
    setProva(p => p.map((q, i) => (i === qi
      ? { ...q, opcoes: q.opcoes.map((o, j) => (j === oi ? valor : o)) } : q)));

  const removerOpcao = (qi: number, oi: number) =>
    setProva(p => p.map((q, i) => {
      if (i !== qi) return q;
      const opcoes = q.opcoes.filter((_, j) => j !== oi);
      // O gabarito é um índice: apagar a opção acima dele desloca a resposta
      // certa para outra alternativa se ninguém corrigir aqui.
      const correta = q.correta === oi ? 0 : q.correta > oi ? q.correta - 1 : q.correta;
      return { ...q, opcoes, correta };
    }));

  const salvar = async () => {
    if (!tituloOk) { toast({ title: "Dê um título ao treinamento", variant: "destructive" }); return; }
    if (!conteudoOk) {
      toast({
        title: "Falta o conteúdo",
        description: "Um treinamento precisa de pelo menos um vídeo, um anexo ou uma prova.",
        variant: "destructive",
      });
      return;
    }
    const problema = validarProva(prova);
    if (problema) { toast({ title: "Revise a prova", description: problema, variant: "destructive" }); return; }

    setSalvando(true);
    try {
      // O id sai antes do upload porque ele é a pasta do arquivo no bucket:
      // sem isso o anexo do card novo não teria onde morar.
      const id = treinamento?.id ?? crypto.randomUUID();

      let vPath = videoPath;
      if (videoArquivo) {
        const path = caminhoNoBucket(id, "video", videoArquivo.name);
        const { error } = await supabase.storage.from("treinamentos").upload(path, videoArquivo);
        if (error) throw new Error(`vídeo: ${error.message}`);
        vPath = path;
      }
      let aPath = anexoPath, aNome = anexoNome;
      if (anexoArquivo) {
        const path = caminhoNoBucket(id, "anexo", anexoArquivo.name);
        const { error } = await supabase.storage.from("treinamentos").upload(path, anexoArquivo);
        if (error) throw new Error(`anexo: ${error.message}`);
        aPath = path; aNome = anexoArquivo.name;
      }

      const linha = {
        id,
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        video_url: videoUrl.trim() || null,
        video_path: vPath,
        anexo_path: aPath,
        anexo_nome: aNome,
        prova: prova.length ? prova : null,
        nota_minima: notaMinima,
        publicado,
      };

      const { error } = treinamento
        ? await (supabase as any).from("TREINAMENTOS").update(linha).eq("id", id)
        : await (supabase as any).from("TREINAMENTOS")
            .insert({ ...linha, criado_por: meuId ?? null, criado_por_nome: meuNome });
      if (error) throw new Error(error.message);

      toast({ title: treinamento ? "Treinamento atualizado" : "Treinamento publicado" });
      onSalvo(); onFechar();
    } catch (e) {
      toast({ title: "Não deu para salvar", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  const abas: Array<{ id: Aba; nome: string; icone: typeof Video; ativo: boolean }> = [
    { id: "video", nome: "Vídeo", icone: Video, ativo: !!(videoUrl.trim() || videoPath || videoArquivo) },
    { id: "anexo", nome: "Anexo", icone: Paperclip, ativo: !!(anexoPath || anexoArquivo) },
    { id: "prova", nome: "Prova", icone: ListChecks, ativo: prova.length > 0 },
  ];

  return (
    <Dialog open={aberto} onOpenChange={o => !o && onFechar()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{treinamento ? "Editar treinamento" : "Novo treinamento"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Título <span className="text-destructive">*</span></Label>
            <Input value={titulo} onChange={e => setTitulo(e.target.value)}
                   placeholder="Ex.: Como lançar uma despesa no Malote" autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={3}
                      placeholder="Sobre o que é este treinamento, para quem serve e o que a pessoa vai saber fazer no fim." />
          </div>

          {/* Abas do conteúdo. A bolinha verde marca a peça já preenchida. */}
          <div className="flex gap-2 border-b">
            {abas.map(a => (
              <button key={a.id} type="button" onClick={() => setAba(a.id)}
                className={`relative flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all
                  ${aba === a.id
                    ? "border-b-2 border-primary text-primary"
                    : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"}`}>
                <a.icone className="h-4 w-4" />
                {a.nome}
                {a.ativo && <span className="h-2 w-2 rounded-full bg-emerald-500 animate-in zoom-in" />}
              </button>
            ))}
          </div>

          {aba === "video" && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
              <div className="space-y-1.5">
                <Label>Link do vídeo</Label>
                <Input value={videoUrl} onChange={e => setVideoUrl(e.target.value)}
                       placeholder="https://youtu.be/... ou https://vimeo.com/..." />
                {embed && embed.tipo === "desconhecido" && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Não reconheci como YouTube, Vimeo ou arquivo de vídeo — vai virar um link para abrir em outra aba.
                  </p>
                )}
                {embed && embed.tipo !== "desconhecido" && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <Check className="h-3.5 w-3.5" /> Vai tocar embutido na tela ({embed.tipo}).
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>ou envie o arquivo</Label>
                <input ref={refVideo} type="file" accept="video/*" className="hidden"
                       onChange={e => setVideoArquivo(e.target.files?.[0] ?? null)} />
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => refVideo.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" /> Escolher vídeo
                  </Button>
                  {(videoArquivo || videoPath) && (
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      {videoArquivo?.name ?? "vídeo enviado"}
                      <button type="button" onClick={() => { setVideoArquivo(null); setVideoPath(null); }}
                              className="text-destructive hover:underline"><X className="h-4 w-4" /></button>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Até 200 MB. Para vídeo longo, prefira o link.</p>
              </div>
            </div>
          )}

          {aba === "anexo" && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
              <Label>Material de apoio</Label>
              <input ref={refAnexo} type="file" className="hidden"
                     accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.zip"
                     onChange={e => setAnexoArquivo(e.target.files?.[0] ?? null)} />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => refAnexo.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" /> Escolher arquivo
                </Button>
                {(anexoArquivo || anexoNome) && (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    {anexoArquivo?.name ?? anexoNome}
                    <button type="button" onClick={() => { setAnexoArquivo(null); setAnexoPath(null); setAnexoNome(null); }}
                            className="text-destructive hover:underline"><X className="h-4 w-4" /></button>
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PDF, Word, Excel, PowerPoint, imagem ou zip.</p>
            </div>
          )}

          {aba === "prova" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-200">
              {prova.length === 0 && (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Sem prova. O treinamento é concluído assim que a pessoa abre o material.
                </div>
              )}

              {prova.map((q, qi) => (
                <div key={q.id} className="space-y-3 rounded-lg border bg-muted/30 p-4 animate-in fade-in">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {qi + 1}
                    </span>
                    <Textarea value={q.enunciado} rows={2} placeholder="Escreva a pergunta"
                      onChange={e => setProva(p => p.map((x, i) => (i === qi ? { ...x, enunciado: e.target.value } : x)))} />
                    <Button type="button" variant="ghost" size="icon" className="text-destructive"
                            onClick={() => setProva(p => p.filter((_, i) => i !== qi))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2 pl-8">
                    {q.opcoes.map((o, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        {/* Clicar no círculo é o que define o gabarito. */}
                        <button type="button" onClick={() => marcarCorreta(qi, oi)}
                          title="Marcar como a alternativa correta"
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all
                            ${q.correta === oi
                              ? "border-emerald-500 bg-emerald-500 text-white scale-110"
                              : "border-muted-foreground/30 hover:border-emerald-400"}`}>
                          {q.correta === oi && <Check className="h-3.5 w-3.5" />}
                        </button>
                        <Input value={o} placeholder={`Alternativa ${oi + 1}`}
                               onChange={e => mudarOpcao(qi, oi, e.target.value)} />
                        {q.opcoes.length > 2 && (
                          <Button type="button" variant="ghost" size="icon"
                                  onClick={() => removerOpcao(qi, oi)}>
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="ghost" size="sm"
                      onClick={() => setProva(p => p.map((x, i) => (i === qi ? { ...x, opcoes: [...x.opcoes, ""] } : x)))}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Alternativa
                    </Button>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => setProva(p => [...p, novaQuestao()])}>
                  <Plus className="mr-2 h-4 w-4" /> Adicionar questão
                </Button>
                {prova.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Nota mínima</Label>
                    <Input type="number" min={0} max={100} className="w-20" value={notaMinima}
                           onChange={e => setNotaMinima(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                    <span className="text-sm text-muted-foreground">% para aprovar</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-semibold">Publicado</Label>
              <p className="text-xs text-muted-foreground">
                Desligado, o card fica visível só para quem gerencia treinamentos.
              </p>
            </div>
            <Switch checked={publicado} onCheckedChange={setPublicado} />
          </div>

          {!conteudoOk && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 animate-in fade-in dark:bg-amber-950/30">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Tudo é opcional, mas <strong>alguma coisa</strong> tem que vir: um vídeo, um anexo ou uma prova.</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !tituloOk || !conteudoOk}>
            {salvando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…</> : "Salvar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
