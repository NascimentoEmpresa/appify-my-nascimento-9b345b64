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
  Image as ImageIcon,
} from "lucide-react";
import {
  temConteudo, validarProva, caminhoNoBucket, embedDeVideo, validarTamanho, formatarMB,
  LIMITE_UPLOAD_BYTES, ESCOPOS_TREINAMENTO, TIPOS_TREINAMENTO, PADRAO_NOTA_MINIMA, PADRAO_MAX_TENTATIVAS,
  acertosMinimos, juntarGabarito,
  type EscopoTreinamento, type PerguntaProva, type Treinamento,
} from "./core";
import { MODULOS_ERP } from "@/pages/chamados/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// =====================================================================
// TREINAMENTOS — criar e editar um card.
//
// As três peças (vídeo, prova, material) ficam empilhadas, na ordem em que a
// pessoa passa por elas (eram abas até 14/10/2026 — parecia "vídeo OU
// prova"). Cada uma é opcional, mas o
// botão de salvar só libera quando pelo menos uma existe — a mesma regra do
// CHECK `trn_precisa_de_conteudo`. O aviso aparece o tempo todo em vez de
// só no submit, para ninguém preencher a prova inteira e descobrir no fim.
// =====================================================================

const novaQuestao = (): PerguntaProva => ({
  id: crypto.randomUUID(), enunciado: "", opcoes: ["", ""], correta: 0,
});

interface Props {
  aberto: boolean;
  /** null = criando; objeto = editando. */
  treinamento: Treinamento | null;
  /** Módulo da tela que abriu o editor — é o que já vem marcado no card novo. */
  escopoPadrao: EscopoTreinamento;
  /**
   * Quem só pode gerenciar a grade de um módulo (ex.: "Pode adicionar
   * treinamentos" da Central de Serviços, mig 20261014000022): o treinamento
   * fica preso a ele. null = escolhe livremente.
   */
  escopoTravado?: EscopoTreinamento | null;
  meuNome: string;
  meuId: string | undefined;
  onFechar: () => void;
  onSalvo: () => void;
}

export function TreinamentoEditor({ aberto, treinamento, escopoPadrao, escopoTravado = null, meuNome, meuId, onFechar, onSalvo }: Props) {
  const { toast } = useToast();
  const [salvando, setSalvando] = useState(false);

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
  // Classificação e regra de tentativas (14/10/2026, mig 20261014000020).
  const [tipo, setTipo] = useState("");
  const [moduloSistema, setModuloSistema] = useState<string>("");
  const [maxTentativas, setMaxTentativas] = useState<number | null>(null);
  const [tiposUsados, setTiposUsados] = useState<string[]>([...TIPOS_TREINAMENTO]);
  const [carregandoGabarito, setCarregandoGabarito] = useState(false);
  const [publicado, setPublicado] = useState(true);
  const [escopos, setEscopos] = useState<EscopoTreinamento[]>([escopoPadrao]);
  const [capaPath, setCapaPath] = useState<string | null>(null);
  const [capaArquivo, setCapaArquivo] = useState<File | null>(null);
  const [capaPreview, setCapaPreview] = useState<string | null>(null);

  const refVideo = useRef<HTMLInputElement>(null);
  const refAnexo = useRef<HTMLInputElement>(null);
  const refCapa = useRef<HTMLInputElement>(null);

  /**
   * Recusa o arquivo grande NA ESCOLHA, não no salvar.
   *
   * O upload de 60 MB sobe inteiro antes de a API recusar, e o erro dela
   * ("The object exceeded the maximum allowed size") vem em inglês e sem
   * dizer qual é o limite. Melhor gastar o clique agora do que a espera
   * depois.
   */
  const escolherArquivo = (arquivo: File | null, onOk: (f: File | null) => void) => {
    if (!arquivo) { onOk(null); return; }
    const problema = validarTamanho(arquivo);
    if (problema) {
      toast({ title: "Arquivo grande demais", description: problema, variant: "destructive" });
      return;
    }
    onOk(arquivo);
  };

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
    // Card novo nasce com a regra do pedido: 8 de 10 e 3 tentativas. O que já
    // existia mantém o que tinha (os antigos ficaram sem limite de tentativas).
    setNotaMinima(t?.nota_minima ?? PADRAO_NOTA_MINIMA);
    setTipo(t?.tipo ?? "");
    setModuloSistema(t?.modulo_sistema ?? "");
    setMaxTentativas(t ? (t.max_tentativas ?? null) : PADRAO_MAX_TENTATIVAS);
    setPublicado(t?.publicado ?? true);
    // Card novo já nasce no módulo de onde o editor foi aberto; editando, vale
    // o que está gravado (que pode ser os dois).
    setEscopos(escopoTravado ? [escopoTravado] : t?.escopos?.length ? t.escopos : [escopoPadrao]);
    setCapaPath(t?.capa_path ?? null);
    setVideoArquivo(null); setAnexoArquivo(null); setCapaArquivo(null); setCapaPreview(null);
  }, [aberto, treinamento, escopoPadrao, escopoTravado]);

  // O gabarito não vem no card (a prova chega com correta = -1 para todo
  // mundo): quem gerencia o lê de TREINAMENTO_GABARITO e ele é juntado aqui.
  // Sem isto, salvar sem tocar nas respostas marcaria a 1ª alternativa em todas.
  useEffect(() => {
    let vivo = true;
    const t = treinamento;
    if (!aberto || !t?.id || !Array.isArray(t.prova) || t.prova.length === 0) return;
    setCarregandoGabarito(true);
    (async () => {
      const { data, error } = await (supabase as any).from("TREINAMENTO_GABARITO")
        .select("respostas").eq("treinamento_id", t.id).maybeSingle();
      if (!vivo) return;
      setCarregandoGabarito(false);
      if (error) {
        toast({ title: "Não consegui carregar o gabarito", description: error.message, variant: "destructive" });
        return;
      }
      setProva(p => juntarGabarito(p, (data?.respostas ?? null) as Record<string, number> | null));
    })();
    return () => { vivo = false; };
  }, [aberto, treinamento, toast]);

  // Tipos já usados entram nas sugestões junto dos padrões.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    (async () => {
      const { data } = await (supabase as any).from("TREINAMENTOS").select("tipo").not("tipo", "is", null);
      if (!vivo) return;
      const usados = (data ?? []).map((r: { tipo: string | null }) => String(r.tipo ?? "").trim()).filter(Boolean);
      setTiposUsados([...new Set<string>([...TIPOS_TREINAMENTO, ...usados])]);
    })();
    return () => { vivo = false; };
  }, [aberto]);

  // Capa que já está salva: bucket é privado, então precisa de URL assinada
  // para aparecer no formulário de edição.
  useEffect(() => {
    let vivo = true;
    if (!aberto || !capaPath || capaArquivo) return;
    (async () => {
      const { data } = await supabase.storage.from("treinamentos").createSignedUrl(capaPath, 3600);
      if (vivo) setCapaPreview(data?.signedUrl ?? null);
    })();
    return () => { vivo = false; };
  }, [aberto, capaPath, capaArquivo]);

  // Preview local do arquivo recém-escolhido, sem esperar upload. O
  // revokeObjectURL evita segurar a imagem em memória a cada troca.
  useEffect(() => {
    if (!capaArquivo) return;
    const url = URL.createObjectURL(capaArquivo);
    setCapaPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [capaArquivo]);

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
    // Sem módulo nenhum o card não apareceria em grade alguma — some do
    // sistema sem erro. O CHECK do banco recusa, mas o aviso tem que ser aqui.
    if (carregandoGabarito) { toast({ title: "Aguarde o gabarito carregar", variant: "destructive" }); return; }
    if (escopos.length === 0) {
      toast({
        title: "Escolha onde o treinamento aparece",
        description: "Marque pelo menos um módulo: Encarregados, Central de Serviços ou Treinamentos Sistemas.",
        variant: "destructive",
      });
      return;
    }

    setSalvando(true);
    try {
      // O id sai antes do upload porque ele é a pasta do arquivo no bucket:
      // sem isso o anexo do card novo não teria onde morar.
      const id = treinamento?.id ?? crypto.randomUUID();

      // Arquivos que saíram de cena e precisam ser apagados DEPOIS de o
      // update passar. Sem isto cada troca de vídeo/anexo/capa deixava o
      // arquivo velho no bucket para sempre, pagando storage por lixo.
      const aRemover: string[] = [];

      let vPath = videoPath;
      if (videoArquivo) {
        const path = caminhoNoBucket(id, "video", videoArquivo.name);
        const { error } = await supabase.storage.from("treinamentos").upload(path, videoArquivo);
        if (error) throw new Error(`vídeo: ${error.message}`);
        if (treinamento?.video_path) aRemover.push(treinamento.video_path);
        vPath = path;
      } else if (treinamento?.video_path && !videoPath) {
        aRemover.push(treinamento.video_path);   // removido pelo X, sem substituto
      }

      let aPath = anexoPath, aNome = anexoNome;
      if (anexoArquivo) {
        const path = caminhoNoBucket(id, "anexo", anexoArquivo.name);
        const { error } = await supabase.storage.from("treinamentos").upload(path, anexoArquivo);
        if (error) throw new Error(`anexo: ${error.message}`);
        if (treinamento?.anexo_path) aRemover.push(treinamento.anexo_path);
        aPath = path; aNome = anexoArquivo.name;
      } else if (treinamento?.anexo_path && !anexoPath) {
        aRemover.push(treinamento.anexo_path);
      }

      let cPath = capaPath;
      if (capaArquivo) {
        const path = caminhoNoBucket(id, "capa", capaArquivo.name);
        const { error } = await supabase.storage.from("treinamentos").upload(path, capaArquivo);
        if (error) throw new Error(`capa: ${error.message}`);
        if (treinamento?.capa_path) aRemover.push(treinamento.capa_path);
        cPath = path;
      } else if (treinamento?.capa_path && !capaPath) {
        aRemover.push(treinamento.capa_path);
      }

      const linha = {
        id,
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        video_url: videoUrl.trim() || null,
        video_path: vPath,
        anexo_path: aPath,
        anexo_nome: aNome,
        capa_path: cPath,
        prova: prova.length ? prova : null,
        nota_minima: notaMinima,
        tipo: tipo.trim() || null,
        modulo_sistema: moduloSistema || null,
        max_tentativas: prova.length ? maxTentativas : null,
        publicado,
        escopos,
      };

      const { error } = treinamento
        ? await (supabase as any).from("TREINAMENTOS").update(linha).eq("id", id)
        : await (supabase as any).from("TREINAMENTOS")
            .insert({ ...linha, criado_por: meuId ?? null, criado_por_nome: meuNome });
      if (error) throw new Error(error.message);

      // Só depois do update: apagar antes deixaria o card apontando para um
      // arquivo que não existe mais se a gravação falhasse.
      if (aRemover.length) await supabase.storage.from("treinamentos").remove(aRemover);

      toast({ title: treinamento ? "Treinamento atualizado" : "Treinamento publicado" });
      onSalvo(); onFechar();
    } catch (e) {
      toast({ title: "Não deu para salvar", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

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

          {/* Capa: fica junto do título porque é identidade do card, não
              conteúdo — por isso não entra nas abas nem no CHECK. */}
          <div className="space-y-1.5">
            <Label>Foto de capa</Label>
            <input ref={refCapa} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                   onChange={e => { escolherArquivo(e.target.files?.[0] ?? null, setCapaArquivo); e.target.value = ""; }} />
            {capaPreview ? (
              <div className="group relative overflow-hidden rounded-xl border">
                <img src={capaPreview} alt="Capa do treinamento" className="h-40 w-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button type="button" variant="secondary" size="sm" onClick={() => refCapa.current?.click()}>
                    <ImageIcon className="mr-2 h-4 w-4" /> Trocar
                  </Button>
                  <Button type="button" variant="destructive" size="sm"
                          onClick={() => { setCapaArquivo(null); setCapaPath(null); setCapaPreview(null); }}>
                    <Trash2 className="mr-2 h-4 w-4" /> Remover
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => refCapa.current?.click()}
                className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-muted-foreground transition-all hover:border-primary/50 hover:bg-muted/40 hover:text-foreground">
                <ImageIcon className="h-6 w-6" />
                <span className="text-sm font-medium">Escolher imagem de capa</span>
                <span className="text-xs">PNG, JPG ou WebP · opcional</span>
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={3}
                      placeholder="Sobre o que é este treinamento, para quem serve e o que a pessoa vai saber fazer no fim." />
          </div>

          {/* Classificação (14/10/2026): o tipo agrupa a grade e o módulo diz de
              que parte do ERP o vídeo trata — "um vídeo por módulo". */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo de treinamento</Label>
              <Input list="trn-tipos" value={tipo} onChange={e => setTipo(e.target.value)}
                     placeholder="Sistema, Segurança do Trabalho…" />
              <datalist id="trn-tipos">
                {tiposUsados.map(x => <option key={x} value={x} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>Módulo do sistema</Label>
              <Select value={moduloSistema || "_nenhum"} onValueChange={v => setModuloSistema(v === "_nenhum" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_nenhum">Nenhum (não é de um módulo)</SelectItem>
                  {MODULOS_ERP.filter(m => m.value !== "outro").map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>



          {/* Vídeo → Prova → Material (14/10/2026). Eram abas, e parecia que
              dava para pôr só vídeo OU só prova. Agora as três peças ficam à
              vista, na ordem em que a pessoa passa por elas: assiste o vídeo
              inteiro, depois faz a prova de marcar. */}
          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
              <div>
                <p className="flex items-center gap-1.5 font-semibold"><Video className="h-4 w-4 text-primary" /> Vídeo</p>
                <p className="text-xs text-muted-foreground">A pessoa precisa assistir até o fim, sem adiantar, para liberar a prova. Se reprovar, assiste inteiro de novo antes de refazer.</p>
              </div>
            </div>
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
                       onChange={e => { escolherArquivo(e.target.files?.[0] ?? null, setVideoArquivo); e.target.value = ""; }} />
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
                <p className="text-xs text-muted-foreground">
                  Até {formatarMB(LIMITE_UPLOAD_BYTES)}. Vídeo maior que isso: publique no YouTube e cole o link acima — por lá não há limite.
                </p>
              </div>
            </div>
          </section>
          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
              <div>
                <p className="flex items-center gap-1.5 font-semibold"><ListChecks className="h-4 w-4 text-primary" /> Prova de múltipla escolha</p>
                <p className="text-xs text-muted-foreground">Cada questão tem alternativas; clique no círculo para marcar a correta. Sem questões, o treinamento conclui ao terminar o vídeo.</p>
              </div>
            </div>
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-200">
              {prova.length === 0 && (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Nenhuma questão ainda. Clique em <b>Adicionar questão</b> para montar a prova (ex.: 10 questões).
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
              </div>

              {prova.length > 0 && (
                <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold">Nota mínima</Label>
                    <div className="flex items-center gap-2">
                      <Input type="number" min={0} max={100} className="w-20" value={notaMinima}
                             onChange={e => setNotaMinima(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                      <span className="text-sm text-muted-foreground">% para aprovar</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      = acertar <b className="text-foreground">{acertosMinimos(prova.length, notaMinima)} de {prova.length}</b>{" "}
                      {prova.length === 1 ? "questão" : "questões"}.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-sm font-semibold">Limitar tentativas</Label>
                      <Switch checked={maxTentativas != null}
                              onCheckedChange={v => setMaxTentativas(v ? PADRAO_MAX_TENTATIVAS : null)} />
                    </div>
                    {maxTentativas != null ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Input type="number" min={1} max={20} className="w-20" value={maxTentativas}
                                 onChange={e => setMaxTentativas(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
                          <span className="text-sm text-muted-foreground">tentativas</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Reprovou: assiste o vídeo de novo e refaz. Reprovou {maxTentativas}x seguidas: a prova trava e
                          quem recebe alertas de treinamento é avisado para verificar e liberar.
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">Sem limite: a pessoa refaz quantas vezes precisar (revendo o vídeo a cada reprovação).</p>
                    )}
                  </div>
                </div>
              )}
              {carregandoGabarito && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando o gabarito…</p>
              )}
            </div>
          </section>
          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">+</span>
              <div>
                <p className="flex items-center gap-1.5 font-semibold"><Paperclip className="h-4 w-4 text-primary" /> Material de apoio (opcional)</p>
                <p className="text-xs text-muted-foreground">Um arquivo para baixar junto: PDF, apresentação, planilha…</p>
              </div>
            </div>
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
              <Label>Material de apoio</Label>
              <input ref={refAnexo} type="file" className="hidden"
                     accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.zip"
                     onChange={e => { escolherArquivo(e.target.files?.[0] ?? null, setAnexoArquivo); e.target.value = ""; }} />
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
              <p className="text-xs text-muted-foreground">
                PDF, Word, Excel, PowerPoint, imagem ou zip. Até {formatarMB(LIMITE_UPLOAD_BYTES)}.
              </p>
            </div>
          </section>

          {/* Onde o card aparece. Marcar os dois é o jeito de aproveitar um
              treinamento que já existe no outro módulo, sem duplicar a linha
              (duplicar daria duas provas e dois históricos para o mesmo
              vídeo). */}
          <div className="rounded-lg border p-3">
            <Label className="text-sm font-semibold">Aparece em</Label>
            <p className="text-xs text-muted-foreground">
              {escopoTravado
                ? "Você gerencia os treinamentos só deste módulo, então o card fica nele."
                : "Cada módulo tem a sua grade. Marque os dois para o mesmo treinamento valer nos dois — continua sendo um só, com uma prova e um histórico."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {ESCOPOS_TREINAMENTO.filter(e => !escopoTravado || e.id === escopoTravado).map(e => {
                const marcado = escopos.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() => setEscopos(atual => marcado
                      ? atual.filter(x => x !== e.id)
                      : [...atual, e.id])}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      marcado
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {e.label}{marcado ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
            {escopos.length === 0 && (
              <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-500">
                Sem módulo marcado o treinamento não aparece em lugar nenhum.
              </p>
            )}
          </div>

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
