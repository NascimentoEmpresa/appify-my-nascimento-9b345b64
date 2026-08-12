// =====================================================================
// CHAMADOS DE SISTEMAS — o histórico do chamado como CHAT DE GRUPO
//
// Antes eram duas caixas separadas ("Responder ao solicitante" e
// "Observações internas") e uma lista de caixinhas: quem atendia precisava
// escolher em qual campo escrever e não tinha como saber se o solicitante já
// tinha lido. Aqui é uma conversa só — o grupo do chamado (solicitante +
// responsável + quem já participou) — no formato do WhatsApp:
//
//   · balão por mensagem, com o NOME de quem escreveu em cima;
//   · ✓ enviada · ✓✓ cinza lida por parte do grupo · ✓✓ azul LIDA POR TODOS
//     (clicando abre quem leu e quem ainda não);
//   · Ctrl+V cola print direto na conversa (e arrastar arquivo também);
//   · mensagem "só a equipe" fica marcada e o solicitante nem recebe (a RLS
//     esconde o evento e o anexo).
//
// Toda a escrita passa por chamado_enviar_mensagem() e a leitura é carimbada
// por chamado_marcar_lido() — migration 20260831000001_chamados_chat_grupo.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Check, CheckCheck, Paperclip, Send, X, Lock, Users, Download, ImageIcon, Loader2,
} from "lucide-react";
import { BUCKET_CHAMADOS, fmtDataHora, type Anexo, type Evento } from "./types";

export interface Participante {
  user_id: string;
  nome: string;
  papel: "solicitante" | "responsavel" | "gestao";
  ve_interno: boolean;
  /** Solicitante e responsável — de quem se espera resposta. Ver PAPEL_LABEL. */
  principal: boolean;
  lido_em: string | null;
}

const PAPEL_LABEL: Record<string, string> = {
  solicitante: "solicitante",
  responsavel: "responsável",
  gestao: "gestão",
};

/** Estado de leitura de uma mensagem, no vocabulário do WhatsApp. */
type EstadoLeitura = "sozinho" | "enviada" | "parcial" | "todos";

const LIMITE_TEXTO = 4000;
const TAMANHO_MAX_MB = 20; // igual ao limite do bucket

// Cor do nome de quem escreveu, como no grupo do WhatsApp: estável por pessoa.
const CORES_AUTOR = ["text-primary", "text-info", "text-success", "text-warning", "text-destructive"];
const corDoAutor = (uid: string) => {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return CORES_AUTOR[Math.abs(h) % CORES_AUTOR.length];
};

const ehImagem = (a: Pick<Anexo, "mime_type" | "nome_arquivo">) =>
  (a.mime_type ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(a.nome_arquivo ?? "");

const sanitizeNome = (nome: string) =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");

/** Só a hora (o dia vai no separador entre os blocos). */
const soHora = (s: string) => {
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

const diaDe = (s: string) => new Date(s).toDateString();

// ---- Aviso do sistema x mensagem de gente ---------------------------
// Só mensagem de verdade ganha balão com nome em cima. O resto — mudança de
// status, direcionamento, log de robô — é linha de aviso no meio da conversa,
// escrita em português de gente e já com QUEM fez a ação dentro da frase
// ("Iury designou o chamado para Pablo"), que é como o WhatsApp faz.
//
// O texto vem gravado no banco desde sempre, então a tradução acontece aqui na
// leitura: assim as conversas antigas também ficam legíveis, sem migrar dados.
interface Aviso { texto: string; interno: boolean }

function descreverAviso(e: Evento, nomeDe: (uid: string | null) => string): Aviso | null {
  const meta = (e.meta ?? {}) as Record<string, any>;
  const t = (e.texto ?? "").trim();

  // Log de robô: gravado como observação interna, mas não é alguém falando.
  if (meta.canal === "whatsapp") {
    const para = meta.destinatario_id ? nomeDe(meta.destinatario_id) : null;
    return {
      interno: true,
      texto: meta.sucesso === false
        ? `Falha ao enviar a notificação por WhatsApp${para ? ` para ${para}` : ""}`
        : `Notificação enviada por WhatsApp${para ? ` para ${para}` : ""}`,
    };
  }
  if (e.tipo !== "evento") return null;

  const quem = nomeDe(e.autor_id);
  const frase = (() => {
    let m: RegExpMatchArray | null;
    if (/^Chamado aberto$/i.test(t)) return `${quem} abriu o chamado`;
    if (/^Chamado conclu[ií]do$/i.test(t)) return `${quem} concluiu o chamado`;
    // O direcionamento nem sempre trouxe a posição na fila (gravações antigas).
    if ((m = t.match(/^Chamado direcionado a (.+?)(?:\s*—\s*(\d+)º lugar na fila.*)?$/i)))
      return `${quem} designou o chamado para ${m[1]}${m[2] ? ` · ${m[2]}º na fila` : ""}`;
    if ((m = t.match(/^Chamado reprovado:\s*(.+)$/is))) return `${quem} reprovou o chamado — ${m[1]}`;
    if ((m = t.match(/^Status alterado para\s+(.+)$/i))) return `${quem} mudou o status para ${m[1]}`;
    if ((m = t.match(/^Prioridade alterada para\s+(.+)$/i))) return `${quem} mudou a prioridade para ${m[1]}`;
    if (/^Solicitadas mais informa/i.test(t)) return `${quem} pediu mais informações ao solicitante`;
    if (/^Solicita[çc][ãa]o de informa[çc][õo]es cancelada/i.test(t)) return `${quem} retomou o chamado`;
    return t; // aviso que ainda não tem tradução: mostra como está, sem inventar
  })();

  return { texto: frase, interno: false };
}

const rotuloDoDia = (s: string) => {
  const d = new Date(s);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
};

export interface ChatChamadoProps {
  chamadoId: string;
  solicitanteId: string;
  /** Quem está olhando: a equipe pode escrever mensagem interna, o solicitante não. */
  perfil: "equipe" | "solicitante";
  /** Chamado concluído/reprovado → conversa fechada (a equipe ainda registra interno). */
  encerrado?: boolean;
  /** Sem permissão para escrever (ex.: gestor só observando) — a conversa fica só de leitura. */
  somenteLeitura?: boolean;
}

export function ChatChamado({
  chamadoId, solicitanteId, perfil, encerrado = false, somenteLeitura = false,
}: ChatChamadoProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const ehEquipe = perfil === "equipe";

  const [texto, setTexto] = useState("");
  const [interno, setInterno] = useState(false);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  // Miniatura do que ainda não foi enviado. Fica em estado (e não calculada no
  // render) porque createObjectURL a cada render trocaria o src da <img> e a
  // faria piscar; o revoke acompanha a lista para não vazar memória.
  const [previas, setPrevias] = useState<Array<string | null>>([]);
  useEffect(() => {
    const urls = arquivos.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null));
    setPrevias(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [arquivos]);

  const listaRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- Dados da conversa --------------------------------------------
  // Mesmas chaves das telas que embutem o chat: a resposta é reaproveitada.
  const { data: eventosDesc = [] } = useQuery({
    queryKey: ["chamado-eventos", chamadoId],
    enabled: !!chamadoId,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("CHAMADO_SISTEMA_EVENTO").select("*").eq("chamado_id", chamadoId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Evento[];
    },
  });

  const { data: anexos = [] } = useQuery({
    queryKey: ["chamado-anexos", chamadoId],
    enabled: !!chamadoId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("CHAMADO_SISTEMA_ANEXO").select("*").eq("chamado_id", chamadoId).order("created_at");
      return (data ?? []) as Anexo[];
    },
  });

  const { data: participantes = [] } = useQuery({
    queryKey: ["chamado-participantes", chamadoId],
    enabled: !!chamadoId,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamado_participantes", { p_chamado_id: chamadoId });
      return (data ?? []) as Participante[];
    },
  });

  const mensagens = useMemo(() => [...eventosDesc].reverse(), [eventosDesc]);
  const ultimoId = eventosDesc[0]?.id ?? null;

  // Abriu (ou chegou mensagem nova com a tela aberta) → carimba a leitura, que
  // é o que acende o ✓✓ azul do outro lado.
  useEffect(() => {
    if (!chamadoId) return;
    (async () => {
      const { error } = await (supabase as any).rpc("chamado_marcar_lido", { p_chamado_id: chamadoId });
      if (!error) {
        qc.invalidateQueries({ queryKey: ["chamado-participantes", chamadoId] });
        qc.invalidateQueries({ queryKey: ["chamados-nao-lidos"] });
      }
    })();
  }, [chamadoId, ultimoId, qc]);

  // Imagens aparecem dentro do balão → precisa de URL assinada (bucket privado).
  const caminhosImagem = useMemo(
    () => anexos.filter(ehImagem).map((a) => a.storage_path),
    [anexos],
  );
  const { data: urlsImagem = {} } = useQuery({
    queryKey: ["chamado-anexos-urls", chamadoId, caminhosImagem.join("|")],
    enabled: caminhosImagem.length > 0,
    staleTime: 50 * 60 * 1000, // a assinatura vale 1 h
    queryFn: async () => {
      const { data } = await supabase.storage.from(BUCKET_CHAMADOS).createSignedUrls(caminhosImagem, 3600);
      const m: Record<string, string> = {};
      (data ?? []).forEach((d: any) => { if (d?.path && d?.signedUrl) m[d.path] = d.signedUrl; });
      return m;
    },
  });

  const anexosPorEvento = useMemo(() => {
    const m: Record<string, Anexo[]> = {};
    anexos.forEach((a) => { if (a.evento_id) (m[a.evento_id] ??= []).push(a); });
    return m;
  }, [anexos]);

  // Os avisos citam gente de fora do grupo (o destinatário de um WhatsApp, por
  // exemplo), então o nome sai do grupo primeiro e da lista geral depois.
  const { data: usuarios = [] } = useQuery({
    queryKey: ["chamados-usuarios"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_usuarios_ativos");
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });

  const nomePorId = useMemo(() => {
    const m: Record<string, string> = {};
    usuarios.forEach((u) => { m[u.id] = u.display_name; });
    participantes.forEach((p) => { m[p.user_id] = p.nome; });
    return m;
  }, [usuarios, participantes]);
  const nomeDe = (uid: string | null) => (uid ? nomePorId[uid] ?? "Usuário" : "Sistema");

  // Rola pro fim quando entra mensagem (é uma conversa: o novo fica embaixo).
  // Se a pessoa subiu para reler algo, não arranca a tela dela — só desce
  // quando já estava acompanhando o fim da conversa.
  const primeiraRolagem = useRef(true);
  useEffect(() => {
    const el = listaRef.current;
    if (!el) return;
    const noFim = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (primeiraRolagem.current || noFim) el.scrollTop = el.scrollHeight;
    if (mensagens.length > 0) primeiraRolagem.current = false;
  }, [mensagens.length]);

  // ---- Quem leu o quê -----------------------------------------------
  // O ✓✓ azul olha para quem a mensagem COBRA resposta: solicitante e
  // responsável (numa interna, só quem enxerga interno). A gestão tem acesso e
  // aparece no grupo, mas não trava o "lida por todos" — com 4 gestores no
  // cadastro, o azul nunca acenderia e o selo perderia a serventia.
  const leu = (p: Participante, em: number) => p.lido_em != null && +new Date(p.lido_em) >= em;

  const leitura = (e: Evento) => {
    const enviadoEm = +new Date(e.created_at);
    const destinos = participantes.filter(
      (p) => p.principal && p.user_id !== e.autor_id
             && (e.tipo !== "observacao_interna" || p.ve_interno),
    );
    const leram = destinos.filter((p) => leu(p, enviadoEm));
    const faltam = destinos.filter((p) => !leu(p, enviadoEm));
    // Gestão: informativo no popover, fora da conta do selo.
    const gestao = participantes.filter(
      (p) => !p.principal && p.user_id !== e.autor_id
             && (e.tipo !== "observacao_interna" || p.ve_interno),
    );
    const estado: EstadoLeitura =
      destinos.length === 0 ? "sozinho"
      : leram.length === 0 ? "enviada"
      : leram.length === destinos.length ? "todos"
      : "parcial";
    return { estado, leram, faltam, destinos, gestao, enviadoEm };
  };

  // ---- Envio ---------------------------------------------------------
  const adicionarArquivos = (novos: File[]) => {
    const grandes = novos.filter((f) => f.size > TAMANHO_MAX_MB * 1024 * 1024);
    if (grandes.length) {
      toast({
        title: `Arquivo acima de ${TAMANHO_MAX_MB} MB`,
        description: grandes.map((f) => f.name).join(", "),
        variant: "destructive",
      });
    }
    const ok = novos.filter((f) => f.size <= TAMANHO_MAX_MB * 1024 * 1024);
    if (ok.length) setArquivos((cur) => [...cur, ...ok]);
  };

  // Ctrl+V com print na área de transferência → vira anexo da mensagem.
  const colar = (ev: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const itens = Array.from(ev.clipboardData?.items ?? []);
    const imagens = itens
      .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f)
      .map((f) => {
        const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
        // Print colado vem sem nome útil ("image.png"): carimba a hora pra dar contexto.
        return f.name && f.name !== "image.png"
          ? f
          : new File([f], `print-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.${ext}`, { type: f.type });
      });
    if (imagens.length) {
      ev.preventDefault(); // senão o navegador ainda cola o caminho do arquivo no texto
      adicionarArquivos(imagens);
    }
  };

  const enviar = async () => {
    const txt = texto.trim();
    if ((!txt && arquivos.length === 0) || enviando) return;
    setEnviando(true);

    const { data: eventoId, error } = await (supabase as any).rpc("chamado_enviar_mensagem", {
      p_chamado_id: chamadoId,
      p_texto: txt || null,
      p_interno: interno,
      p_tem_anexo: arquivos.length > 0,
    });
    if (error) {
      setEnviando(false);
      toast({ title: "Erro ao enviar", description: error.message, variant: "destructive" });
      return;
    }

    const falhas: string[] = [];
    for (const file of arquivos) {
      const path = `${chamadoId}/${Date.now()}-${sanitizeNome(file.name)}`;
      const up = await supabase.storage.from(BUCKET_CHAMADOS).upload(path, file, { contentType: file.type });
      if (up.error) { falhas.push(file.name); continue; }
      const ins = await (supabase as any).from("CHAMADO_SISTEMA_ANEXO").insert({
        chamado_id: chamadoId, evento_id: eventoId, storage_path: path, nome_arquivo: file.name,
        mime_type: file.type || null, tamanho_bytes: file.size, campo: interno ? "interno" : "chat",
      });
      if (ins.error) falhas.push(file.name);
    }

    // Mensagem interna não notifica o solicitante — ele nem enxerga.
    if (!interno) {
      supabase.functions.invoke("enviar-notificacao-push", {
        body: { chamado_id: chamadoId, evento: ehEquipe ? "mensagem" : "info_adicionada" },
      }).catch(() => {});
    }

    setTexto(""); setArquivos([]); setEnviando(false);
    if (areaRef.current) areaRef.current.style.height = "auto";
    if (falhas.length) {
      toast({ title: "Anexos com falha", description: falhas.join(", "), variant: "destructive" });
    }
    qc.invalidateQueries({ queryKey: ["chamado-eventos", chamadoId] });
    qc.invalidateQueries({ queryKey: ["chamado-anexos", chamadoId] });
    qc.invalidateQueries({ queryKey: ["chamado", chamadoId] });
    qc.invalidateQueries({ queryKey: ["chamado-participantes", chamadoId] });
  };

  const baixarAnexo = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET_CHAMADOS).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { toast({ title: "Erro ao abrir anexo", variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  // Conversa com o solicitante fecha ao encerrar; registro interno continua.
  const podeMandarPublica = !encerrado && !somenteLeitura;
  const podeMandarInterna = ehEquipe && !somenteLeitura;
  const podeEscrever = interno ? podeMandarInterna : podeMandarPublica;

  useEffect(() => {
    if (encerrado && ehEquipe && !somenteLeitura) setInterno(true);
  }, [encerrado, ehEquipe, somenteLeitura]);

  return (
    <Card className="flex flex-col overflow-hidden">
      {/* Cabeçalho: o grupo */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">Conversa do chamado</p>
          <p className="truncate text-[11px] font-medium text-muted-foreground">
            {participantes.length === 0
              ? "Carregando quem tem acesso…"
              : `${participantes.length} com acesso: ` + participantes
                  .map((p) => `${p.nome.split(" ")[0]} (${PAPEL_LABEL[p.papel] ?? p.papel})`)
                  .join(" · ")}
          </p>
        </div>
        {participantes.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:border-primary/40">
                Quem tem acesso
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <p className="mb-2 text-xs font-bold">Quem enxerga este chamado</p>
              <div className="space-y-1">
                {participantes.map((p) => (
                  <div key={p.user_id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate">{p.nome}</span>
                    <span className="shrink-0 text-muted-foreground">{PAPEL_LABEL[p.papel] ?? p.papel}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
                A gestão enxerga todos os chamados. Mensagem marcada como “só a equipe” não chega ao solicitante.
              </p>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Mensagens */}
      <div ref={listaRef} className="max-h-[540px] min-h-[220px] overflow-y-auto bg-muted/20 px-3 py-3">
        {mensagens.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            Nenhuma mensagem ainda. Escreva abaixo para falar com o grupo do chamado.
          </p>
        )}

        {mensagens.map((e, i) => {
          const novoDia = i === 0 || diaDe(e.created_at) !== diaDe(mensagens[i - 1].created_at);
          const separador = novoDia && (
            <div key={`d-${e.id}`} className="flex justify-center py-1.5">
              <span className="rounded-full bg-background px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm">
                {rotuloDoDia(e.created_at)}
              </span>
            </div>
          );

          // Aviso do sistema (status, direcionamento, log de robô): linha
          // central, sem balão e sem nome em cima — o autor já vai na frase.
          const aviso = descreverAviso(e, nomeDe);
          if (aviso) {
            return (
              <div key={e.id}>
                {separador}
                {/* Aviso não usa balão (senão compete com a conversa), mas
                    precisa ser LEGÍVEL: em cima do fundo cinza só funciona com
                    peso e cor cheia — apagado demais some. */}
                <div className="flex justify-center px-6 py-0.5">
                  <span
                    className={`flex max-w-[90%] items-center justify-center gap-1 text-center text-[11px] font-semibold leading-snug ${
                      aviso.interno ? "text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {aviso.interno && <Lock className="h-3 w-3 shrink-0" />}
                    <span>{aviso.texto}</span>
                    <span className="shrink-0 font-normal opacity-80">· {soHora(e.created_at)}</span>
                  </span>
                </div>
              </div>
            );
          }

          const meu = e.autor_id === user?.id;
          const ehInterna = e.tipo === "observacao_interna";
          const doSolicitante = e.autor_id === solicitanteId;
          const anexosMsg = anexosPorEvento[e.id] ?? [];
          const { estado, leram, faltam, destinos, gestao, enviadoEm } = leitura(e);

          // Sequência da mesma pessoa (mesmo tipo, até 5 min) vira um bloco só:
          // repetir o nome em cada balão é o que mais polui a leitura.
          const ant = mensagens[i - 1];
          const emenda =
            !novoDia && !!ant && !descreverAviso(ant, nomeDe)
            && ant.autor_id === e.autor_id && ant.tipo === e.tipo
            && +new Date(e.created_at) - +new Date(ant.created_at) < 5 * 60 * 1000;

          return (
            <div key={e.id} className={emenda ? "mt-0.5" : "mt-2"}>
              {separador}
              <div className={`flex ${meu ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[88%] rounded-xl border px-3 py-1.5 shadow-sm sm:max-w-[68%] ${
                    ehInterna
                      ? "border-warning/30 bg-warning/5"
                      : meu
                        ? "border-primary/30 bg-primary/10"
                        : "border-border bg-background"
                  }`}
                >
                  {/* Nome só na primeira mensagem do bloco */}
                  <p className={`flex flex-wrap items-center gap-1.5 text-[11px] leading-tight ${emenda ? "hidden" : "mb-0.5"}`}>
                    <span className={`font-bold ${meu ? "text-foreground" : corDoAutor(e.autor_id ?? "")}`}>
                      {meu ? "Você" : nomeDe(e.autor_id)}
                    </span>
                    {doSolicitante && !meu && (
                      <span className="rounded bg-primary/10 px-1.5 text-[9px] font-semibold uppercase text-primary">solicitante</span>
                    )}
                    {ehInterna && (
                      <span className="flex items-center gap-0.5 text-[9px] font-semibold uppercase text-warning/80">
                        <Lock className="h-2.5 w-2.5" /> só a equipe
                      </span>
                    )}
                  </p>

                  {/* overflow-wrap:anywhere porque break-words não quebra uma
                      "palavra" gigante sem espaço — e aí o balão estoura. */}
                  {e.texto && <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{e.texto}</p>}

                  {anexosMsg.length > 0 && (
                    <div className="mt-1.5 space-y-1.5">
                      {anexosMsg.map((a) =>
                        ehImagem(a) && urlsImagem[a.storage_path] ? (
                          <button
                            key={a.id} type="button" onClick={() => baixarAnexo(a.storage_path)}
                            className="block overflow-hidden rounded-lg border border-border/60 transition-opacity hover:opacity-90"
                          >
                            <img
                              src={urlsImagem[a.storage_path]} alt={a.nome_arquivo} loading="lazy"
                              className="max-h-64 w-full object-contain"
                            />
                          </button>
                        ) : (
                          <button
                            key={a.id} type="button" onClick={() => baixarAnexo(a.storage_path)}
                            className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-left text-xs hover:border-primary/40"
                          >
                            {ehImagem(a) ? <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                         : <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <span className="flex-1 truncate">{a.nome_arquivo}</span>
                            {a.tamanho_bytes != null && (
                              <span className="text-[10px] text-muted-foreground">{Math.round(a.tamanho_bytes / 1024)} KB</span>
                            )}
                            <Download className="h-3 w-3 shrink-0 text-muted-foreground" />
                          </button>
                        ),
                      )}
                    </div>
                  )}

                  {/* Hora + confirmação de leitura (só nas MINHAS mensagens) */}
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-medium text-muted-foreground">
                    <span>{soHora(e.created_at)}</span>
                    {meu && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="flex items-center gap-0.5 rounded px-0.5 hover:bg-foreground/5"
                            title={
                              estado === "sozinho" ? "Ninguém mais no chamado ainda"
                              : estado === "todos" ? "Lida por todos"
                              : estado === "parcial" ? `Lida por ${leram.length} de ${destinos.length}`
                              : "Entregue — ninguém leu ainda"
                            }
                          >
                            {estado === "sozinho" || estado === "enviada"
                              ? <Check className={`h-3.5 w-3.5 ${estado === "enviada" ? "" : "opacity-50"}`} />
                              : <CheckCheck className={`h-3.5 w-3.5 ${estado === "todos" ? "text-info" : ""}`} />}
                            {estado === "parcial" && <span>{leram.length}/{destinos.length}</span>}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-64 p-3">
                          <p className="mb-2 text-xs font-bold">Informações da mensagem</p>
                          {destinos.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">
                              Ainda não há mais ninguém no chamado — assim que houver responsável, ele recebe esta mensagem.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              <div>
                                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-info">
                                  <CheckCheck className="h-3 w-3" /> Lida por ({leram.length}/{destinos.length})
                                </p>
                                {leram.length === 0
                                  ? <p className="text-[11px] text-muted-foreground">Ninguém ainda.</p>
                                  : leram.map((p) => (
                                      <p key={p.user_id} className="flex items-center justify-between gap-2 text-[11px]">
                                        <span className="truncate">{p.nome}</span>
                                        <span className="shrink-0 text-muted-foreground">{fmtDataHora(p.lido_em)}</span>
                                      </p>
                                    ))}
                              </div>
                              {faltam.length > 0 && (
                                <div className="border-t border-border pt-2">
                                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    <Check className="h-3 w-3" /> Ainda não leu
                                  </p>
                                  {faltam.map((p) => (
                                    <p key={p.user_id} className="truncate text-[11px]">{p.nome}</p>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {gestao.length > 0 && (
                            <div className="mt-2 border-t border-border pt-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Gestão (não conta no selo)
                              </p>
                              {gestao.map((p) => (
                                <p key={p.user_id} className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="truncate">{p.nome}</span>
                                  <span className="shrink-0 text-muted-foreground">
                                    {leu(p, enviadoEm) ? "leu" : "não leu"}
                                  </span>
                                </p>
                              ))}
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Escrita */}
      {somenteLeitura ? (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Você acompanha esta conversa, mas não participa dela.
        </p>
      ) : (
        <div
          className={`space-y-2 border-t border-border p-3 ${arrastando ? "bg-primary/5 ring-2 ring-inset ring-primary/40" : ""}`}
          onDragOver={(ev) => { ev.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(ev) => {
            ev.preventDefault(); setArrastando(false);
            adicionarArquivos(Array.from(ev.dataTransfer.files ?? []));
          }}
        >
          {ehEquipe && (
            <div className="flex flex-wrap items-center gap-1">
              <div className="inline-flex rounded-lg border border-border p-0.5">
                <button
                  type="button" onClick={() => setInterno(false)} disabled={encerrado}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                    !interno ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Para o grupo
                </button>
                <button
                  type="button" onClick={() => setInterno(true)}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    interno ? "bg-warning text-warning-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Lock className="h-3 w-3" /> Só a equipe
                </button>
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">
                {interno ? "O solicitante não vê nem é notificado." : "O solicitante recebe e vê no histórico."}
              </span>
            </div>
          )}

          {arquivos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {arquivos.map((f, i) => {
                const url = previas[i] ?? null;
                return (
                  <div key={`${f.name}-${i}`} className="relative rounded-lg border border-border bg-background p-1">
                    {url ? (
                      <img src={url} alt={f.name} className="h-16 w-16 rounded object-cover" />
                    ) : (
                      <div className="flex h-16 w-28 flex-col justify-center px-1.5">
                        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate text-[10px]">{f.name}</span>
                      </div>
                    )}
                    <button
                      type="button" onClick={() => setArquivos((cur) => cur.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                      aria-label={`Remover ${f.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              type="button" onClick={() => inputRef.current?.click()} disabled={!podeEscrever}
              className="mb-0.5 rounded-lg border border-border p-2 text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-40"
              aria-label="Anexar arquivo"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              ref={inputRef} type="file" multiple className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/*"
              onChange={(ev) => { adicionarArquivos(Array.from(ev.target.files ?? [])); ev.target.value = ""; }}
            />
            <Textarea
              ref={areaRef} rows={1} maxLength={LIMITE_TEXTO} value={texto} disabled={!podeEscrever}
              placeholder={
                !podeEscrever ? "Chamado encerrado — a conversa está fechada."
                : interno ? "Observação visível só à equipe…"
                : "Escreva para o grupo do chamado…  (Ctrl+V cola print)"
              }
              className="max-h-40 min-h-[42px] resize-none"
              onChange={(ev) => {
                setTexto(ev.target.value);
                const el = ev.target as HTMLTextAreaElement;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }}
              onPaste={colar}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); enviar(); }
              }}
            />
            <Button
              className="mb-0.5 gap-1.5" onClick={enviar}
              disabled={!podeEscrever || enviando || (!texto.trim() && arquivos.length === 0)}
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="hidden sm:inline">{enviando ? "Enviando…" : "Enviar"}</span>
            </Button>
          </div>
          <p className="text-[11px] font-medium text-muted-foreground">
            Enter envia · Shift+Enter quebra linha · Ctrl+V cola imagem · arraste arquivos aqui
          </p>
        </div>
      )}
    </Card>
  );
}

export default ChatChamado;
