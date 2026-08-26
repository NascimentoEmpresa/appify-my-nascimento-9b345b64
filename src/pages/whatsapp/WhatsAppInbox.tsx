import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { useToast } from "@/hooks/use-toast";
import { novoUuid, erroDaFunction } from "@/lib/utils";
import { HistoricoConversa } from "./HistoricoConversa";
import { NovaConversa } from "./NovaConversa";
import { FichaContato } from "./FichaContato";
import {
  MenuMensagens, PreencherVariaveis, useMensagensProntas, useRespostasBot, useStatusNaMeta,
  type ItemMenu, type WaTemplate,
} from "./MenuMensagens";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Send, Search, ShieldAlert, Settings, User, MessageCircle, MousePointerClick, FileText, Inbox, AlertTriangle, Loader2, Check, CheckCheck, Paperclip, X, SmilePlus, CheckCircle2, History, MessageCirclePlus, Tag } from "lucide-react";
import {
  fmtHora, fmtTelefone, iniciais, motivoFalha, nomeContato, MENU_TODAS, EMOJIS_REACAO,
  type WaConversa, type WaContato, type WaMensagem, type WaMidia, type WaPasta,
} from "./types";

// Pseudo-pastas da barra lateral. "todas" é a visão completa (exige a permissão
// whatsapp_todas); "sem_pasta" é a triagem — o que o bot ainda não direcionou.
const TODAS = "todas";
const SEM_PASTA = "sem_pasta";

export default function WhatsAppInbox() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: access } = useAccessibleMenus("visualizar");
  const podeVer = access?.codes.has("whatsapp") ?? false;
  const podeConfig = access?.codes.has("whatsapp_chatbot") ?? false;
  const podeTodas = access?.codes.has(MENU_TODAS) ?? false;

  // ?conversa=<uuid> abre direto naquela conversa. É como o Recrutamento manda
  // o atendente para o candidato certo sem ele ter que caçar na lista.
  const [searchParams, setSearchParams] = useSearchParams();
  const conversaDaUrl = searchParams.get("conversa");

  const [selId, setSelId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [anexo, setAnexo] = useState<File | null>(null);
  const [historico, setHistorico] = useState(false);
  const [novaConversa, setNovaConversa] = useState(false);
  const [ficha, setFicha] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  // Menu da "/": abre quando o campo COMEÇA com barra, e o que vem depois
  // dela é o filtro. Só no começo — barra no meio de uma frase é barra.
  const menuAberto = texto.startsWith("/") && !anexo;
  const filtroMenu = menuAberto ? texto.slice(1) : "";
  // Mensagem escolhida que ainda precisa das variáveis preenchidas.
  const [preenchendo, setPreenchendo] = useState<WaTemplate | null>(null);
  // O foco fica no textarea enquanto o menu está aberto; ele repassa ↑/↓/Enter
  // para o menu por esta função, que o próprio menu registra aqui.
  const navegarMenu = useRef<((e: React.KeyboardEvent) => boolean) | null>(null);
  const { data: mensagensProntas = [] } = useMensagensProntas(podeVer);
  const { data: statusMeta = {} } = useStatusNaMeta(podeVer);
  const { data: respostasBot = [] } = useRespostasBot(podeVer);

  /** Etiqueta selecionada no filtro. Vazio = todas. Vive DENTRO da pasta. */
  const [etiquetaSel, setEtiquetaSel] = useState("");

  // As prontas primeiro (é o que o atendente usa mais), as do bot depois.
  const itensMenu: ItemMenu[] = useMemo(() => [
    ...mensagensProntas.map((pronta) => ({ tipo: "pronta" as const, pronta })),
    ...respostasBot.map((bot) => ({ tipo: "bot" as const, bot })),
  ], [mensagensProntas, respostasBot]);
  // Pasta aberta. Começa vazio e é resolvido assim que as pastas carregam: quem
  // tem "todas as conversas" abre nela; quem não tem, abre na primeira pasta
  // liberada — senão a tela abriria vazia sem explicar por quê.
  const [pastaSel, setPastaSel] = useState<string>("");
  const fimRef = useRef<HTMLDivElement>(null);

  // Catálogo de pastas, recortado pelo que a pessoa pode ver. A RLS já filtra as
  // CONVERSAS; aqui é só para não desenhar aba de pasta que ela não acessa.
  const { data: pastas = [] } = useQuery({
    queryKey: ["wa-pastas"],
    enabled: podeVer,
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_PASTA").select("*").eq("ativo", true).order("ordem");
      return (data ?? []) as WaPasta[];
    },
  });
  const pastasVisiveis = useMemo(
    () => pastas.filter((p) => podeTodas || (access?.codes.has(p.menu_codigo) ?? false)),
    [pastas, podeTodas, access]);

  // Conversas (com contato) — poll leve.
  const { data: conversas = [] } = useQuery({
    queryKey: ["wa-conversas"],
    enabled: podeVer,
    refetchInterval: 8000,
    queryFn: async () => {
      const { data: convs } = await (supabase as any).from("WA_CONVERSA")
        .select("*").order("ultima_mensagem_em", { ascending: false, nullsFirst: false });
      const lista = (convs ?? []) as WaConversa[];
      const ids = [...new Set(lista.map((c) => c.contato_id))];
      const mapa: Record<string, WaContato> = {};
      if (ids.length) {
        const { data: cts } = await (supabase as any).from("WA_CONTATO").select("*").in("id", ids);
        for (const c of cts ?? []) mapa[c.id] = c as WaContato;
      }
      return lista.map((c) => ({ ...c, contato: mapa[c.contato_id] ?? null }));
    },
  });

  // Resolve a pasta inicial uma única vez (o `!pastaSel` evita voltar para a
  // inicial a cada refetch das pastas).
  useEffect(() => {
    if (pastaSel) return;
    if (podeTodas) { setPastaSel(TODAS); return; }
    if (pastasVisiveis.length) setPastaSel(pastasVisiveis[0].codigo);
  }, [pastaSel, podeTodas, pastasVisiveis]);

  const sel = useMemo(() => conversas.find((c) => c.id === selId) ?? null, [conversas, selId]);

  // Abre a conversa pedida pela URL assim que a lista chega. Também alinha a
  // aba de pasta: sem isso a thread abriria certa, mas a lista ao lado estaria
  // noutra pasta e pareceria que nada foi selecionado. Consome o parâmetro
  // depois de usar, senão clicar noutra conversa voltaria para esta.
  useEffect(() => {
    if (!conversaDaUrl || !conversas.length) return;
    const alvo = conversas.find((c) => c.id === conversaDaUrl);
    if (alvo) {
      setSelId(alvo.id);
      const destino = alvo.pasta_codigo ?? SEM_PASTA;
      if (podeTodas) setPastaSel(destino);
      else if (alvo.pasta_codigo && pastasVisiveis.some((p) => p.codigo === alvo.pasta_codigo)) setPastaSel(alvo.pasta_codigo);
    } else {
      // Existe no banco mas a RLS não devolveu: é falta de acesso à pasta, não
      // conversa inexistente — dizer isso evita o atendente procurar na lista.
      toast({ title: "Conversa fora do seu acesso", description: "Você não tem permissão para a pasta onde ela está." });
    }
    searchParams.delete("conversa");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaDaUrl, conversas]);

  // Conversas de cada pasta — a contagem das abas e a lista saem daqui.
  const daPasta = (codigo: string) =>
    codigo === TODAS ? conversas
      : codigo === SEM_PASTA ? conversas.filter((c) => !c.pasta_codigo)
        : conversas.filter((c) => c.pasta_codigo === codigo);

  // Abas: "Todas as conversas" e a triagem só para quem enxerga tudo.
  const abas = useMemo(() => [
    ...(podeTodas ? [{ codigo: TODAS, nome: "Todas as conversas" }, { codigo: SEM_PASTA, nome: "Sem pasta" }] : []),
    ...pastasVisiveis.map((p) => ({ codigo: p.codigo, nome: p.nome })),
  ], [podeTodas, pastasVisiveis]);

  // Mover a conversa de pasta à mão (o bot direciona sozinho, mas o atendente
  // precisa poder corrigir/encaminhar).
  // Passa pela edge function em vez de dar UPDATE direto: além de mover, ela
  // avisa o contato pelo WhatsApp ("transferido para o setor X" / "marcado
  // como Concluído"), e mandar mensagem exige o token do servidor.
  const moverPara = async (codigo: string) => {
    if (!sel) return;
    const destino = codigo === SEM_PASTA ? null : codigo;
    const { data, error } = await supabase.functions.invoke("whatsapp-mover-pasta", {
      body: { conversa_id: sel.id, pasta_codigo: destino },
    });
    if (error) { toast({ title: "Não deu para mover", description: await erroDaFunction(error), variant: "destructive" }); return; }

    // Mover funcionou mesmo se o aviso falhou (fora da janela de 24h, por
    // exemplo) — avisar disso evita a impressão de que nada aconteceu.
    const r = data as any;
    if (destino && r?.avisado === false) {
      toast({
        title: "Conversa movida, mas o contato não foi avisado",
        description: r?.motivo ?? "A mensagem automática não pôde ser entregue — veja o motivo na conversa.",
      });
    }

    // Sem acesso ao destino a conversa sai de vista na hora (a RLS deixa de
    // devolvê-la) — fechar a thread evita um painel preso num registro sumido.
    const aindaVejo = podeTodas || pastasVisiveis.some((p) => p.codigo === destino);
    if (!aindaVejo) setSelId(null);
    qc.invalidateQueries({ queryKey: ["wa-conversas"] });
    qc.invalidateQueries({ queryKey: ["wa-mensagens", sel.id] });
  };

  // Mensagens da conversa selecionada — poll mais rápido.
  const { data: mensagens = [] } = useQuery({
    queryKey: ["wa-mensagens", selId],
    enabled: podeVer && !!selId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_MENSAGEM")
        .select("*").eq("conversa_id", selId).order("criada_em", { ascending: true });
      return (data ?? []) as WaMensagem[];
    },
  });

  useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [mensagens.length, selId]);

  // Ao abrir a conversa, zera as não lidas.
  const abrir = async (c: WaConversa) => {
    setSelId(c.id);
    if (c.nao_lidas > 0) {
      await (supabase as any).from("WA_CONVERSA").update({ nao_lidas: 0 }).eq("id", c.id);
      qc.invalidateQueries({ queryKey: ["wa-conversas"] });
    }
  };

  const alternarBot = async () => {
    if (!sel) return;
    const { error } = await (supabase as any).from("WA_CONVERSA").update({ bot_ativo: !sel.bot_ativo }).eq("id", sel.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["wa-conversas"] });
  };

  // Reagir/desreagir. Clicar no emoji que já está marcado remove (a Meta usa
  // emoji vazio pra isso). Só vale pra mensagem que já tem wamid.
  const reagir = async (m: WaMensagem, emoji: string) => {
    if (!sel || !m.wa_message_id) return;
    const atual = m.payload?.reacoes?.nossa ?? null;
    const { error } = await supabase.functions.invoke("whatsapp-enviar", {
      body: { conversa_id: sel.id, reagir: { wa_message_id: m.wa_message_id, emoji: atual === emoji ? "" : emoji } },
    });
    if (error) { toast({ title: "Não deu para reagir", description: await erroDaFunction(error), variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["wa-mensagens", sel.id] });
  };

  // Anexo pendente: escolhido/colado, ainda não enviado. Fica aqui e não no
  // envio direto pra dar tempo de conferir o print e escrever uma legenda.
  const anexar = (arquivo: File | null | undefined) => {
    if (!arquivo) return;
    const limite = arquivo.type.startsWith("image/") ? 5 : arquivo.type.startsWith("video/") || arquivo.type.startsWith("audio/") ? 16 : 100;
    if (arquivo.size > limite * 1024 * 1024) {
      toast({ title: "Arquivo grande demais", description: `O WhatsApp aceita até ${limite} MB para esse tipo.`, variant: "destructive" });
      return;
    }
    setAnexo(arquivo);
  };

  // Ctrl+V com print na área de transferência: o navegador entrega o PNG como
  // item de arquivo do evento de colar. Texto copiado segue colando normal.
  const aoColar = (e: React.ClipboardEvent) => {
    const arquivo = Array.from(e.clipboardData.files)[0];
    if (!arquivo) return;
    e.preventDefault();
    anexar(arquivo);
  };

  const enviar = async () => {
    if (!sel || enviando) return;
    if (!texto.trim() && !anexo) return;
    // Enquanto o menu da "/" está aberto o campo guarda o filtro, não uma
    // mensagem — mandar "/saud" para o contato seria o pior desfecho.
    if (texto.startsWith("/") && !anexo) return;
    setEnviando(true);
    try {
      let midia: { storage_path: string; mime_type: string; filename: string } | undefined;
      if (anexo) {
        // Sobe direto pro bucket: base64 dentro do JSON estouraria o limite de
        // corpo da edge function num print grande.
        const nome = anexo.name || `colado-${Date.now()}.png`;
        const caminho = `saida/${sel.id}/${novoUuid()}-${nome}`.slice(0, 400);
        const { error: erroUp } = await supabase.storage.from("whatsapp-midia")
          .upload(caminho, anexo, { contentType: anexo.type || "application/octet-stream" });
        if (erroUp) throw new Error(`Falha ao subir o arquivo: ${erroUp.message}`);
        midia = { storage_path: caminho, mime_type: anexo.type || "application/octet-stream", filename: nome };
      }
      const { error } = await supabase.functions.invoke("whatsapp-enviar", {
        body: { conversa_id: sel.id, texto: texto.trim(), ...(midia ? { midia } : {}) },
      });
      if (error) throw new Error(await erroDaFunction(error));
      setTexto("");
      setAnexo(null);
      qc.invalidateQueries({ queryKey: ["wa-mensagens", sel.id] });
      qc.invalidateQueries({ queryKey: ["wa-conversas"] });
    } catch (e: any) {
      toast({ title: "Falha ao enviar", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  };

  // Mensagem pronta escolhida no menu da "/". Quem decide se vai como texto
  // livre ou como template é a edge function, que consulta a janela de 24h no
  // momento do envio — a daqui já pode estar velha.
  const enviarPronta = async (t: WaTemplate, valores: string[]) => {
    if (!sel || enviando) return;
    setEnviando(true);
    try {
      const { error } = await supabase.functions.invoke("whatsapp-template-enviar", {
        body: { conversa_id: sel.id, codigo: t.codigo, valores },
      });
      if (error) throw new Error(await erroDaFunction(error));
      setTexto("");
      setPreenchendo(null);
      qc.invalidateQueries({ queryKey: ["wa-mensagens", sel.id] });
      qc.invalidateQueries({ queryKey: ["wa-conversas"] });
    } catch (e: any) {
      toast({ title: "Falha ao enviar", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  };

  // Sem variável vai direto; com variável, o formulário primeiro.
  /**
   * Resposta do bot vai pelo whatsapp-enviar, que aceita botões — o
   * whatsapp-template-enviar só manda template, e template do "/" não tem
   * botão. Era por isso que a "/" mandava a mensagem sem os botões.
   */
  const enviarRespostaBot = async (b: { texto: string; botoes: { id: string; titulo: string }[] }) => {
    if (!sel || enviando) return;
    setEnviando(true);
    try {
      const { error } = await supabase.functions.invoke("whatsapp-enviar", {
        body: { conversa_id: sel.id, texto: b.texto, ...(b.botoes.length ? { botoes: b.botoes } : {}) },
      });
      if (error) throw new Error(await erroDaFunction(error));
      setTexto("");
      qc.invalidateQueries({ queryKey: ["wa-mensagens", sel.id] });
      qc.invalidateQueries({ queryKey: ["wa-conversas"] });
    } catch (e: any) {
      toast({ title: "Falha ao enviar", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setEnviando(false);
    }
  };

  // Sem variável vai direto; com variável, o formulário primeiro.
  const escolherPronta = (item: ItemMenu) => {
    if (item.tipo === "bot") { enviarRespostaBot(item.bot); return; }
    if (item.pronta.variaveis.length) { setPreenchendo(item.pronta); return; }
    enviarPronta(item.pronta, []);
  };

  const filtradas = useMemo(() => {
    const base = pastaSel ? daPasta(pastaSel) : [];
    const t = busca.trim().toLowerCase();
    const lista = !t ? base : base.filter((c) =>
      [c.contato?.nome, c.contato?.nome_manual, c.contato?.wa_id, c.ultima_mensagem_preview,
       ...(c.contato?.etiquetas ?? [])].some((v) => String(v ?? "").toLowerCase().includes(t)));

    // Não lidas sempre no topo. Quem espera resposta não pode ficar soterrado
    // por conversa que já foi respondida só porque a resposta é mais recente.
    //
    // A conversa aberta conta como "topo" mesmo depois de zerar as não lidas:
    // abrir uma conversa zera o contador, e sem isso ela despencaria da lista
    // no instante do clique, com o quadro se remontando embaixo do cursor.
    //
    // Dentro de cada grupo, mais recente primeiro; conversa sem mensagem
    // (criada pelo recrutamento, por exemplo) tem data nula e vai para o fim.
    const noTopo = (c: WaConversa) => (c.nao_lidas > 0 || c.id === selId ? 0 : 1);
    const quando = (c: WaConversa) => (c.ultima_mensagem_em ? Date.parse(c.ultima_mensagem_em) : -Infinity);
    return [...lista].sort((a, b) => noTopo(a) - noTopo(b) || quando(b) - quando(a));
  }, [conversas, busca, pastaSel, selId, etiquetaSel]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * As etiquetas que EXISTEM na pasta aberta, com quantas conversas cada uma.
   *
   * Sai da pasta, não do catálogo inteiro: filtro que oferece etiqueta sem
   * nenhuma conversa atrás só rende clique que devolve lista vazia.
   */
  const etiquetasDaPasta = useMemo(() => {
    const base = pastaSel ? daPasta(pastaSel) : [];
    const m = new Map<string, number>();
    for (const c of base) {
      for (const e of c.contato?.etiquetas ?? []) m.set(e, (m.get(e) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [conversas, pastaSel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trocar de pasta zera o filtro: a etiqueta escolhida pode não existir na
  // pasta nova, e a lista apareceria vazia sem explicação.
  useEffect(() => { setEtiquetaSel(""); }, [pastaSel]);

  if (!podeVer) {
    return (
      <div>
        <PageHeader title="WhatsApp — Caixa de Entrada" module="Central de Serviços" breadcrumb={["WhatsApp"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>WhatsApp — Caixa de Entrada</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp — Caixa de Entrada"
        subtitle="Atenda conversas e acompanhe o chatbot."
        module="Central de Serviços"
        breadcrumb={["WhatsApp", "Caixa de Entrada"]}
        actions={
          <div className="flex gap-2">
            <Button
              className="gap-1.5 bg-success text-success-foreground hover:bg-success/90"
              onClick={() => setNovaConversa(true)}
            >
              <MessageCirclePlus className="h-4 w-4" /> Nova conversa
            </Button>
            {podeConfig && (
              <Button variant="outline" className="gap-1.5" onClick={() => nav("/app/whatsapp/chatbot")}>
                <Settings className="h-4 w-4" /> Chatbot
              </Button>
            )}
          </div>
        }
      />

      <PreencherVariaveis
        mensagem={preenchendo}
        enviando={enviando}
        onCancelar={() => setPreenchendo(null)}
        onConfirmar={(valores) => preenchendo && enviarPronta(preenchendo, valores)}
      />

      <NovaConversa
        aberto={novaConversa}
        onFechar={() => setNovaConversa(false)}
        podeConfig={podeConfig}
        pastas={pastasVisiveis}
        podeTodas={podeTodas}
        onAberta={(id, pasta) => {
          // Alinha a aba com a pasta onde a conversa nasceu, senão ela abre
          // "selecionada" numa lista que não a contém.
          qc.invalidateQueries({ queryKey: ["wa-conversas"] });
          if (podeTodas) setPastaSel(pasta ?? SEM_PASTA);
          else if (pasta && pastasVisiveis.some((p) => p.codigo === pasta)) setPastaSel(pasta);
          setSelId(id);
        }}
      />

      <Card className="grid h-[calc(100vh-220px)] min-h-[480px] grid-cols-[320px_minmax(0,1fr)] overflow-hidden p-0">
        {/* Lista de conversas */}
        <div className="flex min-h-0 flex-col border-r border-border">
          {/* Pastas. A lista só mostra a pasta aberta — "Todas as conversas" é
              uma opção, não o padrão de todo mundo. */}
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            {abas.map((a) => {
              const n = daPasta(a.codigo).reduce((s, c) => s + (c.nao_lidas || 0), 0);
              const ativa = pastaSel === a.codigo;
              return (
                <button
                  key={a.codigo}
                  onClick={() => { setPastaSel(a.codigo); setSelId(null); }}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    ativa ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
                >
                  {a.codigo === TODAS && <Inbox className="h-3 w-3" />}
                  {a.nome}
                  {n > 0 && (
                    <span className={`rounded-full px-1 text-[10px] font-bold ${ativa ? "bg-primary-foreground/25" : "bg-success text-success-foreground"}`}>{n}</span>
                  )}
                </button>
              );
            })}
            {abas.length === 0 && (
              <p className="p-1 text-[11px] text-muted-foreground">
                Nenhuma pasta liberada para você. Peça acesso em Administração › Acesso por Usuário.
              </p>
            )}
          </div>
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 pl-8 text-sm" placeholder="Buscar por nome, número ou etiqueta…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>

            {/* Filtro por etiqueta, dentro da pasta. Só aparece quando há
                etiqueta na pasta — em pasta sem nenhuma, uma fileira de
                chips vazia é só ruído ocupando a altura da lista. */}
            {etiquetasDaPasta.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <button
                  type="button" onClick={() => setEtiquetaSel("")}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    etiquetaSel === "" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
                >
                  Todas
                </button>
                {etiquetasDaPasta.map(([e, n]) => (
                  <button
                    key={e} type="button"
                    onClick={() => setEtiquetaSel((v) => (v === e ? "" : e))}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      etiquetaSel === e ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20"}`}
                  >
                    {e} <span className="opacity-70">{n}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtradas.map((c) => (
              <button
                key={c.id}
                onClick={() => abrir(c)}
                className={`flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2.5 text-left hover:bg-muted/50 ${selId === c.id ? "bg-muted" : ""}`}
              >
                <Avatar className="h-9 w-9 shrink-0"><AvatarFallback className="bg-success/15 text-[11px] text-success">{iniciais(nomeContato(c.contato), c.contato?.wa_id)}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{nomeContato(c.contato)}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{fmtHora(c.ultima_mensagem_em)}</span>
                  </div>
                  {/* Etiquetas: no máximo duas na lista, para a linha não virar
                      uma parede de chips e esconder a prévia da mensagem. */}
                  {!!c.contato?.etiquetas?.length && (
                    <div className="mb-0.5 flex flex-wrap items-center gap-1">
                      {c.contato.etiquetas.slice(0, 2).map((e) => (
                        <span key={e} className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">{e}</span>
                      ))}
                      {c.contato.etiquetas.length > 2 && (
                        <span className="text-[10px] text-muted-foreground">+{c.contato.etiquetas.length - 2}</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {c.ultima_direcao === "saida" ? "Você: " : ""}{c.ultima_mensagem_preview || "—"}
                    </p>
                    {!c.bot_ativo && <User className="h-3 w-3 shrink-0 text-info" />}
                    {c.nao_lidas > 0 && <Badge className="h-4 min-w-4 justify-center rounded-full bg-success px-1 text-[10px] text-success-foreground">{c.nao_lidas}</Badge>}
                  </div>
                </div>
              </button>
            ))}
            {filtradas.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">Nenhuma conversa.</p>}
          </div>
        </div>

        {/* Thread */}
        {!sel ? (
          <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageCircle className="h-10 w-10 opacity-40" />
            <p className="text-sm">Selecione uma conversa</p>
          </div>
        ) : (
          // min-h-0: sem isso o item do grid cresce com o conteúdo, o composer
          // é empurrado para fora do Card (que tem overflow-hidden) e some da
          // tela assim que a conversa fica longa.
          <div className="flex min-h-0 min-w-0 flex-col">
            {/* Cabeçalho */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <Avatar className="h-8 w-8"><AvatarFallback className="bg-success/15 text-[11px] text-success">{iniciais(nomeContato(sel.contato), sel.contato?.wa_id)}</AvatarFallback></Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{nomeContato(sel.contato)}</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {fmtTelefone(sel.contato?.wa_id)}
                    {sel.contato?.etiquetas?.map((e) => (
                      <span key={e} className="rounded-full bg-primary/10 px-1.5 py-px font-medium text-primary">{e}</span>
                    ))}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={sel.pasta_codigo ?? SEM_PASTA} onValueChange={moverPara}>
                  <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Pasta" /></SelectTrigger>
                  <SelectContent>
                    {podeTodas && <SelectItem value={SEM_PASTA}>Sem pasta</SelectItem>}
                    {pastasVisiveis.map((p) => <SelectItem key={p.codigo} value={p.codigo}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline" size="sm"
                  className={`gap-1.5 ${sel.bot_ativo ? "border-success/40 text-success" : "border-info/40 text-info"}`}
                  onClick={alternarBot}
                >
                  {sel.bot_ativo ? <><Bot className="h-4 w-4" /> Bot ativo</> : <><User className="h-4 w-4" /> Atendimento humano</>}
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setFicha(true)}>
                  <Tag className="h-4 w-4" /> Ficha
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setHistorico(true)}>
                  <History className="h-4 w-4" /> Histórico
                </Button>
              </div>
            </div>

            {/* Observação do contato: fica à vista no topo da thread, não
                escondida na ficha — o recado só serve se for lido ANTES de
                responder. */}
            {sel.contato?.observacao && (
              <div className="shrink-0 border-b border-border bg-warning/5 px-4 py-1.5 text-[11px] text-muted-foreground">
                <b>Observação:</b> {sel.contato.observacao}
              </div>
            )}

            <HistoricoConversa
              conversaId={sel.id}
              nomeContato={nomeContato(sel.contato)}
              aberto={historico}
              onFechar={() => setHistorico(false)}
            />

            <FichaContato contato={sel.contato ?? null} aberto={ficha} onFechar={() => setFicha(false)} />

            {/* Mensagens */}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
              {mensagens.map((m) => {
                const saida = m.direcao === "saida";
                // Evento da conversa (conclusão/reabertura): não foi enviado a
                // ninguém, então não é bolha — vai centralizado, como marco.
                if (m.origem === "sistema") {
                  return (
                    <div key={m.id} className="flex justify-center py-1">
                      <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        {m.texto}
                        <span className="opacity-60">· {fmtHora(m.criada_em)}</span>
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={`group flex items-center gap-1 ${saida ? "justify-end" : "justify-start"}`}>
                    {/* Seletor de reação: aparece no hover, do lado de fora da
                        bolha, para não empurrar o texto nem cobrir o conteúdo. */}
                    {saida && m.wa_message_id && <SeletorReacao onEscolher={(e) => reagir(m, e)} atual={m.payload?.reacoes?.nossa} />}
                    <div className={`relative max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm ${saida ? "bg-success/90 text-success-foreground" : "bg-card"}`}>
                      {m.origem === "bot" && <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase opacity-80"><Bot className="h-3 w-3" /> bot</p>}
                      {!saida && m.payload?.reply_id && (
                        <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase opacity-70"><MousePointerClick className="h-3 w-3" /> resposta</p>
                      )}
                      {m.payload?.midia && <div className="mb-1"><MidiaAnexo midia={m.payload.midia} /></div>}
                      {m.texto && !(m.payload?.midia && /^\[[a-z]+\]$/i.test(m.texto)) && (
                        <TextoComLinks texto={m.texto} />
                      )}
                      {m.payload?.botoes?.length ? (
                        <div className="mt-1.5 space-y-1 border-t border-current/15 pt-1.5">
                          {m.payload.botoes.map((b) => (
                            <div key={b.id} className={`flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${saida ? "bg-success-foreground/15" : "bg-muted"}`}>
                              <MousePointerClick className="h-3 w-3 opacity-70" /> {b.titulo}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {m.status === "erro" && motivoFalha(m.payload?.erro) && (
                        <p className="mt-1 flex items-start gap-1 rounded bg-destructive/15 px-1.5 py-1 text-[10px] leading-snug text-destructive-foreground/90">
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                          <span>{motivoFalha(m.payload?.erro)}</span>
                        </p>
                      )}
                      <p className={`mt-0.5 flex items-center justify-end gap-1 text-right text-[10px] ${saida ? "opacity-80" : "text-muted-foreground"}`}>
                        {fmtHora(m.criada_em)}
                        {saida && <TiqueStatus status={m.status} />}
                      </p>
                      {/* Chips das reações, "pendurados" na borda de baixo da
                          bolha como no WhatsApp. */}
                      {(m.payload?.reacoes?.deles || m.payload?.reacoes?.nossa) && (
                        <div className={`absolute -bottom-2.5 flex gap-0.5 ${saida ? "left-2" : "right-2"}`}>
                          {m.payload?.reacoes?.deles && (
                            <span className="rounded-full border border-border bg-card px-1 text-[11px] shadow-sm" title="Reação do contato">
                              {m.payload.reacoes.deles}
                            </span>
                          )}
                          {m.payload?.reacoes?.nossa && (
                            <span className="rounded-full border border-border bg-card px-1 text-[11px] shadow-sm" title="Sua reação">
                              {m.payload.reacoes.nossa}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {!saida && m.wa_message_id && <SeletorReacao onEscolher={(e) => reagir(m, e)} atual={m.payload?.reacoes?.nossa} />}
                  </div>
                );
              })}
              {mensagens.length === 0 && <p className="text-center text-xs text-muted-foreground">Sem mensagens ainda.</p>}
              <div ref={fimRef} />
            </div>

            {/* Composer. Menus de botões são configurados no Chatbot e enviados
                pelo bot; aqui o atendente escreve texto e pode anexar arquivo
                (clipe, arrastar ou Ctrl+V com print na área de transferência). */}
            <div
              className="shrink-0 border-t border-border p-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); anexar(e.dataTransfer.files?.[0]); }}
            >
              {menuAberto && (
                <MenuMensagens
                  filtro={filtroMenu}
                  itens={itensMenu}
                  status={statusMeta}
                  onEscolher={escolherPronta}
                  onFechar={() => setTexto("")}
                  registrarNavegacao={(fn) => { navegarMenu.current = fn; }}
                />
              )}
              {anexo && <PreviaAnexo arquivo={anexo} onRemover={() => setAnexo(null)} />}
              <div className="flex items-end gap-2">
                <input
                  ref={inputArquivo} type="file" className="hidden"
                  onChange={(e) => { anexar(e.target.files?.[0]); e.target.value = ""; }}
                />
                <Button
                  variant="outline" size="icon" className="h-10 w-10 shrink-0"
                  title="Anexar arquivo (ou cole um print com Ctrl+V)"
                  onClick={() => inputArquivo.current?.click()} disabled={enviando}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Textarea
                  rows={1} className="max-h-32 min-h-[40px] resize-none"
                  placeholder={anexo ? "Legenda (opcional)…" : "Digite uma mensagem, ou / para as prontas…"}
                  value={texto} onChange={(e) => setTexto(e.target.value)}
                  onPaste={aoColar}
                  onKeyDown={(e) => {
                    // Com o menu aberto, ↑/↓/Enter/Esc são dele — só o que
                    // ele não usar cai no comportamento normal do campo.
                    if (menuAberto && navegarMenu.current?.(e)) { e.preventDefault(); return; }
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
                  }}
                />
                <Button className="shrink-0 gap-1.5 bg-success text-success-foreground hover:bg-success/90" onClick={enviar} disabled={(!texto.trim() && !anexo) || menuAberto || enviando}>
                  {enviando
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>
                    : <><Send className="h-4 w-4" /> Enviar</>}
                </Button>
              </div>
            </div>
            {sel.bot_ativo && (
              <p className="shrink-0 border-t border-border/50 bg-warning/5 px-3 py-1 text-[11px] text-muted-foreground">
                O bot responde automaticamente. Ao enviar manualmente, considere desligar o bot para assumir o atendimento.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// Seletor de reação. Fica invisível até passar o mouse na linha da mensagem
// (group-hover) para não poluir a conversa com seis emojis por bolha.
function SeletorReacao({ onEscolher, atual }: { onEscolher: (emoji: string) => void; atual?: string | null }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className={`rounded-full p-1 text-muted-foreground transition hover:bg-muted ${aberto ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        title="Reagir"
      >
        <SmilePlus className="h-4 w-4" />
      </button>
      {aberto && (
        <>
          {/* Camada de fora fecha ao clicar em qualquer lugar. */}
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-border bg-popover p-1 shadow-md">
            {EMOJIS_REACAO.map((e) => (
              <button
                key={e} type="button"
                onClick={() => { onEscolher(e); setAberto(false); }}
                className={`rounded-full px-1 text-base leading-none transition hover:scale-125 ${atual === e ? "bg-muted" : ""}`}
                title={atual === e ? "Remover reação" : `Reagir com ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Prévia do que vai ser enviado. Print colado sem isso vira envio às cegas —
// a pessoa só descobriria o que mandou depois que o contato recebeu.
function PreviaAnexo({ arquivo, onRemover }: { arquivo: File; onRemover: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!arquivo.type.startsWith("image/")) { setUrl(null); return; }
    const u = URL.createObjectURL(arquivo);
    setUrl(u);
    return () => URL.revokeObjectURL(u); // sem isso o blob vaza a cada print colado
  }, [arquivo]);

  const kb = arquivo.size / 1024;
  const tamanho = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  return (
    <div className="mb-2 flex items-center gap-3 rounded border border-border bg-muted/30 p-2">
      {url
        ? <img src={url} alt="" className="h-14 w-14 rounded object-cover" />
        : <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{arquivo.name || "print colado"}</p>
        <p className="text-[11px] text-muted-foreground">{tamanho}</p>
      </div>
      <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={onRemover} title="Remover anexo">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Tiques de entrega, como no WhatsApp. Os estados vêm do webhook de status da
// Meta (sent/delivered/read), que já eram gravados — só não apareciam como
// ícone. "lida" só chega se o contato mantém a confirmação de leitura ligada;
// com ela desligada a mensagem para em "entregue" para sempre.
const TIQUES: Record<string, { icone: typeof Check; classe: string; titulo: string }> = {
  enviada:  { icone: Check,      classe: "opacity-70",     titulo: "Enviada — a Meta aceitou" },
  entregue: { icone: CheckCheck, classe: "opacity-70",     titulo: "Entregue no aparelho" },
  lida:     { icone: CheckCheck, classe: "text-info",      titulo: "Visualizada" },
  erro:     { icone: AlertTriangle, classe: "text-destructive", titulo: "Falhou — não foi entregue" },
};

function TiqueStatus({ status }: { status: string }) {
  const t = TIQUES[status];
  if (!t) return null;
  const Icone = t.icone;
  return (
    <span title={t.titulo} aria-label={t.titulo} className="inline-flex">
      <Icone className={`h-3.5 w-3.5 shrink-0 ${t.classe}`} />
    </span>
  );
}

// Texto da mensagem como o WhatsApp mostra: link clicável (convite de grupo,
// link de vaga — renderizar cru obrigava a copiar na mão) e *negrito*, que é
// como sai a assinatura do atendente. Link abre em aba nova, sem referrer.
const URL_NA_MENSAGEM = /(https?:\/\/[^\s<]+)/g;
const NEGRITO_WHATSAPP = /\*([^*\n]+)\*/g;

function ComNegrito({ trecho }: { trecho: string }) {
  const partes = trecho.split(NEGRITO_WHATSAPP);
  return <>{partes.map((p, i) => (i % 2 === 0 ? p : <strong key={i}>{p}</strong>))}</>;
}

function TextoComLinks({ texto }: { texto: string }) {
  const partes = texto.split(URL_NA_MENSAGEM);
  return (
    <p className="whitespace-pre-wrap break-words">
      {partes.map((parte, i) => {
        if (i % 2 === 0) return <ComNegrito key={i} trecho={parte} />;
        // Pontuação colada no fim ("...acesse https://x.com.") não é do link.
        const limpa = parte.replace(/[.,;:!?)\]}>'"]+$/, "");
        const sobra = parte.slice(limpa.length);
        return (
          <span key={i}>
            <a href={limpa} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
              {limpa}
            </a>
            {sobra}
          </span>
        );
      })}
    </p>
  );
}

// Anexo de mídia recebida: gera uma URL assinada do bucket privado e renderiza
// conforme o tipo (imagem/vídeo/áudio inline; documento e demais como download).
function MidiaAnexo({ midia }: { midia: WaMidia }) {
  const pronto = midia.status === "pronto" && !!midia.storage_path;
  const { data: url } = useQuery({
    queryKey: ["wa-midia", midia.storage_path],
    enabled: pronto,
    staleTime: 50 * 60 * 1000, // a URL assinada dura 1h; revalida bem antes
    queryFn: async () => {
      const { data } = await supabase.storage.from("whatsapp-midia").createSignedUrl(midia.storage_path!, 3600);
      return data?.signedUrl ?? null;
    },
  });

  if (midia.status === "baixando") return <p className="text-[11px] italic opacity-80">Recebendo arquivo…</p>;
  if (midia.status === "erro") return <p className="text-[11px] italic text-destructive">Falha ao baixar o arquivo.</p>;
  if (!url) return <p className="text-[11px] italic opacity-80">Carregando…</p>;

  const mime = midia.mime_type ?? "";
  if (midia.tipo === "image" || midia.tipo === "sticker" || mime.startsWith("image/")) {
    return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={midia.filename ?? "imagem"} className="max-h-60 max-w-full rounded-md" /></a>;
  }
  if (midia.tipo === "video" || mime.startsWith("video/")) {
    return <video src={url} controls className="max-h-60 max-w-full rounded-md" />;
  }
  if (midia.tipo === "audio" || mime.startsWith("audio/")) {
    return <audio src={url} controls className="w-full" />;
  }
  return (
    <a
      href={url} target="_blank" rel="noreferrer" download={midia.filename ?? undefined}
      className="flex items-center gap-2 rounded-md border border-current/25 px-2 py-1.5 text-xs hover:underline"
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">{midia.filename ?? "documento"}</span>
    </a>
  );
}
