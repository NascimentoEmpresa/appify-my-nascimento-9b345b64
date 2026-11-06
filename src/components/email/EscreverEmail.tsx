import { useCallback, useEffect, useRef, useState } from "react";
import {
  Minus, Maximize2, Minimize2, X, Paperclip, Trash2, Send, Loader2, FileText, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { CampoDestinatarios } from "./CampoDestinatarios";
import { EditorTexto, type EditorTextoRef } from "./EditorTexto";
import {
  subirAnexo, useEnviarEmail, useExcluirEmail, useSalvarRascunho,
  type AnexoEmail, type CaixaEmailCfg, type ConfigEnvio,
} from "@/hooks/useCaixaEmail";
import {
  conferirAntesDeEnviar, esqueceuAnexo, formatarTamanho,
  MAX_ANEXOS_BYTES, nomeArquivoSeguro, type SugestaoEndereco,
} from "@/lib/email/caixa";

/**
 * Janela "Nova mensagem" no canto, como no Gmail: minimiza, maximiza, salva
 * rascunho sozinho enquanto a pessoa escreve (3 s depois da última tecla) e
 * envia com Ctrl+Enter.
 */
export interface MensagemInicial {
  id?: string | null;            // rascunho existente
  para?: string[]; cc?: string[]; cco?: string[];
  assunto?: string;
  html?: string;
  anexos?: AnexoEmail[];
  /** Donos já ligados à mensagem (ex.: o fornecedor da linha clicada). */
  donoIds?: string[];
}

export function chaveAssinatura(uid: string | undefined) {
  return `sup_email_assinatura_${uid ?? "anon"}`;
}
export function lerAssinatura(uid: string | undefined): string {
  try { return localStorage.getItem(chaveAssinatura(uid)) ?? ""; } catch { return ""; }
}

export function EscreverEmail({
  caixa, inicial, uid, config, sugestoes, extras, onFechar,
}: {
  caixa: CaixaEmailCfg;
  /** Colunas a mais que a caixa grava (Fornecedores: fornecedor_ids). */
  extras?: (enderecos: string[], donoIds: string[]) => Record<string, unknown>;
  inicial: MensagemInicial;
  uid: string;
  config: ConfigEnvio | undefined;
  sugestoes: SugestaoEndereco[];
  onFechar: () => void;
}) {
  const [rascunhoId, setRascunhoId] = useState<string | null>(inicial.id ?? null);
  const [para, setPara] = useState<string[]>(inicial.para ?? []);
  const [cc, setCc] = useState<string[]>(inicial.cc ?? []);
  const [cco, setCco] = useState<string[]>(inicial.cco ?? []);
  const [mostrarCc, setMostrarCc] = useState((inicial.cc?.length ?? 0) > 0);
  const [mostrarCco, setMostrarCco] = useState((inicial.cco?.length ?? 0) > 0);
  const [assunto, setAssunto] = useState(inicial.assunto ?? "");
  const [anexos, setAnexos] = useState<AnexoEmail[]>([]);
  const [subindo, setSubindo] = useState(0);
  const [responderParaMim, setResponderParaMim] = useState(true);
  const [modo, setModo] = useState<"normal" | "min" | "max">("normal");
  const [sujo, setSujo] = useState(false);
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);
  const editor = useRef<EditorTextoRef>(null);
  // Refs, não estado: o salvamento automático roda num timer e veria o valor
  // velho. Sem isso, um rascunho salvo DURANTE o envio criava uma cópia.
  const enviandoRef = useRef(false);
  const salvandoRef = useRef(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const enviar = useEnviarEmail(caixa);
  const salvar = useSalvarRascunho(caixa);
  const excluir = useExcluirEmail(caixa);

  const corpoInicial = useRef(
    inicial.html ?? (() => {
      const a = lerAssinatura(uid);
      const seguro = a.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      return a ? `<p><br></p><p><br></p><div data-assinatura>--<br>${seguro}</div>` : "";
    })(),
  );

  // Anexos vindos de outra mensagem (encaminhar) estão na pasta de quem
  // enviou; a Edge só aceita a pasta de quem envia agora. Copia para cá.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const proprios: AnexoEmail[] = [];
      for (const a of inicial.anexos ?? []) {
        if (a.path.startsWith(`${uid}/`)) { proprios.push(a); continue; }
        const destino = `${uid}/${crypto.randomUUID()}/${nomeArquivoSeguro(a.nome)}`;
        const { error } = await supabase.storage.from(caixa.bucket).copy(a.path, destino);
        if (error) toast.error(`Não foi possível trazer o anexo "${a.nome}".`);
        else proprios.push({ ...a, path: destino });
      }
      if (vivo) setAnexos(proprios);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const montar = useCallback(() => {
    const todos = [...para, ...cc, ...cco];
    return {
      id: rascunhoId,
      para, cc, cco, assunto,
      html: editor.current?.html() ?? "",
      anexos,
      extras: extras?.(todos, inicial.donoIds ?? []),
      responder_para: responderParaMim,
    };
  }, [para, cc, cco, assunto, anexos, rascunhoId, responderParaMim, extras, inicial.donoIds]);

  const temConteudo = () =>
    para.length + cc.length + cco.length > 0 || assunto.trim() !== "" || anexos.length > 0
    || (editor.current?.texto().replace(/--[\s\S]*$/, "").trim() ?? "") !== "";

  const salvarRascunho = useCallback(async (silencioso = true) => {
    if (enviandoRef.current || salvandoRef.current) return;
    salvandoRef.current = true;
    try {
      const id = await salvar.mutateAsync({ ...montar(), autor_nome: config?.autor_nome ?? null });
      setRascunhoId(id);
      setSujo(false);
      setSalvoEm(new Date());
      if (!silencioso) toast.success("Rascunho salvo.");
    } catch (e: any) {
      if (!silencioso) toast.error(e?.message ?? "Não foi possível salvar o rascunho.");
    } finally {
      salvandoRef.current = false;
    }
  }, [montar, salvar, config?.autor_nome]);

  // Rascunho automático
  useEffect(() => {
    if (!sujo) return;
    const t = setTimeout(() => { if (temConteudo()) salvarRascunho(true); }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sujo, para, cc, cco, assunto, anexos]);

  const marcar = () => setSujo(true);
  useEffect(() => { marcar(); }, [para, cc, cco, assunto, anexos]);

  const bytesAnexos = anexos.reduce((s, a) => s + (a.tamanho ?? 0), 0);

  const adicionarArquivos = async (arquivos: FileList | File[]) => {
    const lista = Array.from(arquivos);
    let soma = bytesAnexos;
    for (const f of lista) {
      if (soma + f.size > MAX_ANEXOS_BYTES) { toast.error(`"${f.name}" passa do limite de 20 MB somados.`); continue; }
      soma += f.size;
      setSubindo((n) => n + 1);
      try {
        const a = await subirAnexo(caixa, uid, f);
        setAnexos((xs) => [...xs, a]);
      } catch (e: any) {
        toast.error(`Falha ao anexar "${f.name}": ${e?.message ?? "erro"}`);
      } finally {
        setSubindo((n) => n - 1);
      }
    }
  };

  const removerAnexo = (a: AnexoEmail) => {
    setAnexos((xs) => xs.filter((x) => x.path !== a.path));
    supabase.storage.from(caixa.bucket).remove([a.path]).catch(() => undefined);
  };

  const fazerEnvio = async () => {
    if (subindo > 0) { toast.message("Aguarde os anexos terminarem de subir."); return; }
    const m = montar();
    const textoCorpo = editor.current?.texto() ?? "";
    const problemas = conferirAntesDeEnviar({ para, cc, cco, assunto, corpoTexto: textoCorpo, anexosBytes: bytesAnexos });
    if (problemas.length) { toast.error(problemas[0].mensagem); return; }
    if (esqueceuAnexo(assunto, textoCorpo.replace(/--[\s\S]*$/, ""), anexos.length)
        && !window.confirm("A mensagem fala em anexo, mas nenhum arquivo foi anexado. Enviar mesmo assim?")) return;
    if (!textoCorpo.trim() && !window.confirm("Enviar a mensagem sem texto no corpo?")) return;
    enviandoRef.current = true;
    try {
      // Espera um salvamento automático em curso terminar antes de mandar.
      while (salvandoRef.current) await new Promise((r) => setTimeout(r, 100));
      await enviar.mutateAsync(m);
      toast.success("Mensagem enviada.");
      onFechar();
    } catch (e: any) {
      // Se a Edge já gravou a tentativa (vai para Falhas), o rascunho de
      // origem deixou de ser rascunho: o próximo salvamento cria um novo. A
      // janela continua aberta para corrigir e tentar de novo.
      if (e?.gravadoId) setRascunhoId(null);
      toast.error(e?.message ?? "Não foi possível enviar.", { duration: 8000 });
    } finally {
      enviandoRef.current = false;
    }
  };

  const fechar = async () => {
    if (temConteudo() && sujo) await salvarRascunho(true);
    onFechar();
  };

  const descartar = async () => {
    if (temConteudo() && !window.confirm("Descartar esta mensagem?")) return;
    if (rascunhoId) {
      await excluir.mutateAsync({ id: rascunhoId, status: "rascunho", anexos }).catch(() => undefined);
    } else if (anexos.length) {
      await supabase.storage.from(caixa.bucket).remove(anexos.map((a) => a.path)).catch(() => undefined);
    }
    onFechar();
  };

  const titulo = assunto.trim() || "Nova mensagem";

  return (
    <div
      className={cn(
        "absolute z-40 flex flex-col overflow-hidden rounded-t-lg border bg-background shadow-2xl",
        modo === "max" && "inset-4 rounded-lg sm:inset-8",
        modo === "normal" && "bottom-0 right-2 h-[min(620px,calc(100%-1rem))] w-[calc(100%-1rem)] sm:right-6 sm:w-[560px]",
        modo === "min" && "bottom-0 right-2 w-72 sm:right-6",
      )}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) adicionarArquivos(e.dataTransfer.files); }}
    >
      <div
        className="flex cursor-pointer items-center gap-2 bg-muted px-4 py-2.5"
        onClick={() => modo === "min" && setModo("normal")}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{titulo}</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" title={modo === "min" ? "Restaurar" : "Minimizar"}
                onClick={(e) => { e.stopPropagation(); setModo(modo === "min" ? "normal" : "min"); }}>
          <Minus className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" title={modo === "max" ? "Sair da tela cheia" : "Tela cheia"}
                onClick={(e) => { e.stopPropagation(); setModo(modo === "max" ? "normal" : "max"); }}>
          {modo === "max" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" title="Salvar e fechar"
                onClick={(e) => { e.stopPropagation(); fechar(); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className={cn("flex min-h-0 flex-1 flex-col", modo === "min" && "hidden")}>
        {/* De */}
        <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
          <span className="w-10 shrink-0 text-muted-foreground">De</span>
          <span className="min-w-0 flex-1 truncate">
            {config
              ? <>{config.de_nome} <span className="text-muted-foreground">&lt;{config.de_email ?? "não configurado"}&gt;</span></>
              : <span className="text-muted-foreground">Carregando remetente…</span>}
          </span>
        </div>
        {config && config.responder_para && (
          <label className="flex items-center gap-2 border-b px-4 py-1.5 text-xs text-muted-foreground">
            <Switch checked={responderParaMim} onCheckedChange={setResponderParaMim} className="scale-75" />
            Respostas vão para <b className="font-medium text-foreground">{config.responder_para}</b>
          </label>
        )}
        {config && !config.configurado && (
          <div className="flex items-center gap-2 border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" /> {config.motivo || "O envio ainda não está configurado no servidor — a mensagem vai falhar."}
          </div>
        )}

        <CampoDestinatarios
          rotulo="Para" valor={para} onChange={setPara} sugestoes={sugestoes} autoFocus={para.length === 0}
          extra={
            <span className="flex shrink-0 gap-2 pt-1.5 text-sm text-muted-foreground">
              {!mostrarCc && <button type="button" className="hover:underline" onClick={() => setMostrarCc(true)}>Cc</button>}
              {!mostrarCco && <button type="button" className="hover:underline" onClick={() => setMostrarCco(true)}>Cco</button>}
            </span>
          }
        />
        {mostrarCc && <CampoDestinatarios rotulo="Cc" valor={cc} onChange={setCc} sugestoes={sugestoes} />}
        {mostrarCco && <CampoDestinatarios rotulo="Cco" valor={cco} onChange={setCco} sugestoes={sugestoes} />}

        <input
          value={assunto}
          onChange={(e) => setAssunto(e.target.value.slice(0, 300))}
          placeholder="Assunto"
          className="border-b bg-transparent px-4 py-2.5 text-sm outline-none"
          autoFocus={para.length > 0 && !assunto}
        />

        <EditorTexto
          ref={editor}
          inicial={corpoInicial.current}
          onChange={marcar}
          onAtalhoEnviar={fazerEnvio}
          className="flex min-h-0 flex-1 flex-col"
        />

        {(anexos.length > 0 || subindo > 0) && (
          <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto border-t px-4 py-2">
            {anexos.map((a) => (
              <span key={a.path} className="inline-flex max-w-[15rem] items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-xs">
                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate font-medium">{a.nome}</span>
                <span className="shrink-0 text-muted-foreground">{formatarTamanho(a.tamanho ?? 0)}</span>
                <button type="button" onClick={() => removerAnexo(a)} className="rounded p-0.5 hover:bg-foreground/10" aria-label={`Remover ${a.nome}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {subindo > 0 && (
              <span className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando {subindo} arquivo{subindo > 1 ? "s" : ""}…
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 border-t px-3 py-2">
          <Button onClick={fazerEnvio} disabled={enviar.isPending} className="rounded-full px-5">
            {enviar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {enviar.isPending ? "Enviando…" : "Enviar"}
          </Button>
          <Button size="icon" variant="ghost" title="Anexar arquivos (até 20 MB somados)" onClick={() => arquivoRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </Button>
          <input ref={arquivoRef} type="file" multiple className="hidden"
                 onChange={(e) => { if (e.target.files) adicionarArquivos(e.target.files); e.target.value = ""; }} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {salvar.isPending ? "Salvando…" : salvoEm ? `Rascunho salvo às ${salvoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Ctrl+Enter envia"}
          </span>
          <Button size="icon" variant="ghost" title="Descartar rascunho" onClick={descartar}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
