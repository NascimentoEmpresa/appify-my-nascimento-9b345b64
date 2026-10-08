import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { corAviso, INTERVALO_PING_S, normalizarChaveTv, youtubeEmbed, type EstadoTv, type ItemTv } from "@/lib/tv/tv";
import { TvRelatorio } from "./TvRelatorio";

// =====================================================================
// /tv — PLAYER das TVs da empresa (Sistemas › TV's, mig 20261007000012)
//
// Rota PÚBLICA (a TV não tem login). Abre no navegador da TV:
//   1. sem token → tv_registrar: ganha token (fica só neste navegador) e um
//      código de 6 dígitos, mostrado em tela cheia até alguém parear em
//      Sistemas › TV's;
//   2. a cada 15 s → tv_estado(token): playlist, aviso geral e comando
//      ("recarregar"). Cada consulta é o "ping" que mostra a TV online;
//   3. toca os itens em sequência (imagem/aviso/página/YouTube pelo tempo
//      cadastrado; vídeo até acabar). O aviso geral cobre tudo enquanto
//      estiver valendo.
// Token apagado/desconhecido → registra de novo (novo código).
//
// 07/10/2026 (mig 20261007000014) — "elas ficam desligando; ao ligar, só de
// abrir o navegador já teria que conectar":
//   · /tv/<chave>: LINK FIXO da TV (gerado em Sistemas › TV's). A chave é o
//     token: não depende do navegador guardar nada. Vai como página inicial
//     do navegador / app de quiosque;
//   · cão de guarda: 3 min sem conseguir falar com o ERP → recarrega; e uma
//     recarga limpa por dia, de madrugada (navegador de TV vaza memória);
//   · item "relatório": números do ERP em tela cheia (TvRelatorio).
//
// 08/10/2026 (mig 20261008000003) — AO VIVO na gestão: a cada troca de item
// a TV avisa qual entrou (tv_reportar), e Sistemas › TV's desenha a mesma
// coisa. É só um aviso: se falhar, a TV segue tocando; se o banco ainda não
// tem a função, ela para de tentar até a próxima recarga.
// =====================================================================

const CHAVE_TOKEN = "gn:tv:token";
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
const tela = () => `${window.screen?.width ?? window.innerWidth}x${window.screen?.height ?? window.innerHeight}`;
const lerToken = () => { try { return localStorage.getItem(CHAVE_TOKEN); } catch { return null; } };
const gravarToken = (t: string | null) => { try { t ? localStorage.setItem(CHAVE_TOKEN, t) : localStorage.removeItem(CHAVE_TOKEN); } catch { /* modo privado */ } };
const midiaPublica = (arquivo: string | null) => (arquivo ? supabase.storage.from("tv-midia").getPublicUrl(arquivo).data.publicUrl : "");

const SEM_CONTATO_RECARREGA_MS = 3 * 60_000;
const ABERTA_EM = Date.now();

export default function TvPlayer() {
  const { chave } = useParams<{ chave?: string }>();
  const chaveFixa = normalizarChaveTv(chave);
  const [estado, setEstado] = useState<EstadoTv | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(chaveFixa ?? lerToken());
  const ultimoOk = useRef(Date.now());

  const consultar = useCallback(async () => {
    try {
      if (!tokenRef.current) {
        const { data, error } = await rpc("tv_registrar", { p_user_agent: navigator.userAgent, p_tela: tela() });
        if (error) throw new Error(error.message);
        tokenRef.current = data.token; gravarToken(data.token);
      }
      const { data, error } = await rpc("tv_estado", { p_token: tokenRef.current, p_tela: tela() });
      if (error) throw new Error(error.message);
      const e = data as EstadoTv;
      if (e.desconhecida) {
        // Link fixo com chave que não vale mais: NÃO cria outra TV — avisa.
        if (chaveFixa) { setEstado(null); setErro("Este link de TV não vale mais. Gere um novo em Sistemas › TV's."); return; }
        tokenRef.current = null; gravarToken(null); return consultar();
      }
      ultimoOk.current = Date.now();
      if (e.comando === "recarregar") { window.location.reload(); return; }
      setEstado(e); setErro(null);
    } catch (e) {
      setErro((e as Error).message || "Sem conexão com o ERP.");
    }
  }, [chaveFixa]);

  useEffect(() => {
    if (chaveFixa) gravarToken(chaveFixa);
    consultar();
    const t = window.setInterval(consultar, INTERVALO_PING_S * 1000);
    return () => window.clearInterval(t);
  }, [consultar]);

  // AO VIVO: avisa o ERP do item que entrou na tela (null = relógio/pausada).
  // Fogo e esquece — nunca atrapalha a reprodução.
  const reportarLigado = useRef(true);
  const reportar = useCallback((itemId: string | null) => {
    if (!reportarLigado.current || !tokenRef.current) return;
    rpc("tv_reportar", { p_token: tokenRef.current, p_item: itemId }).then(({ error }) => {
      // Banco sem a mig 20261008000003: não insiste até recarregar.
      if (error && /tv_reportar|function|PGRST202/i.test(error.message)) reportarLigado.current = false;
    }, () => { /* sem rede: o próximo item tenta de novo */ });
  }, []);

  // Cão de guarda: sem falar com o ERP há 3 min, ou de madrugada depois de
  // 20 h no ar, recarrega a página inteira (rede caiu, navegador travou).
  useEffect(() => {
    const t = window.setInterval(() => {
      const h = new Date().getHours();
      if (Date.now() - ultimoOk.current > SEM_CONTATO_RECARREGA_MS && navigator.onLine !== false) window.location.reload();
      else if (Date.now() - ABERTA_EM > 20 * 3600_000 && h >= 3 && h < 5) window.location.reload();
    }, 30_000);
    const voltou = () => consultar();
    window.addEventListener("online", voltou);
    return () => { window.clearInterval(t); window.removeEventListener("online", voltou); };
  }, [consultar]);

  // Tela não apaga (onde o navegador deixa) e o cursor some.
  useEffect(() => {
    let lock: { release?: () => Promise<void> } | null = null;
    const pedir = async () => { try { lock = await (navigator as any).wakeLock?.request("screen"); } catch { /* sem suporte */ } };
    pedir();
    const vis = () => document.visibilityState === "visible" && pedir();
    document.addEventListener("visibilitychange", vis);
    document.body.style.cursor = "none";
    return () => { document.removeEventListener("visibilitychange", vis); document.body.style.cursor = ""; lock?.release?.(); };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white" onDoubleClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
      {!estado ? <Centro titulo="Conectando ao ERP…" sub={erro ?? undefined} />
        : !estado.pareada ? <Pareamento codigo={estado.codigo ?? "------"} erro={erro} />
        : <Reprodutor itens={estado.itens ?? []} nome={estado.nome ?? ""} ativa={estado.ativa !== false} token={tokenRef.current ?? ""} aoMostrar={reportar} />}
      {estado?.pareada && estado.alerta && <Alerta texto={estado.alerta.texto} cor={estado.alerta.cor} />}
      {erro && estado?.pareada && <div className="absolute bottom-2 right-3 rounded bg-black/60 px-2 py-1 text-xs text-white/70">sem conexão — tentando de novo</div>}
    </div>
  );
}

export function Centro({ titulo, sub }: { titulo: string; sub?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-3xl font-bold">{titulo}</p>
      {sub && <p className="text-lg text-white/60">{sub}</p>}
    </div>
  );
}

function Pareamento({ codigo, erro }: { codigo: string; erro: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-gradient-to-br from-[#0b1f4d] to-[#1e3a8a] px-8 text-center">
      <p className="text-2xl font-semibold tracking-wide text-white/80">GRUPO NASCIMENTO · TV</p>
      <p className="text-3xl">Para conectar esta TV, no ERP abra <b>Sistemas › TV's</b>, clique em <b>Adicionar TV</b> e digite:</p>
      <p className="font-mono text-[18vmin] font-black leading-none tracking-[0.15em] text-orange-400">{codigo}</p>
      <p className="text-xl text-white/60">Dica: dê dois cliques para tela cheia. O código muda se a página for recarregada antes de conectar.</p>
      {erro && <p className="text-lg text-red-300">{erro}</p>}
    </div>
  );
}

export function Alerta({ texto, cor }: { texto: string; cor: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-[6vmin] text-center" style={{ background: corAviso(cor) }}>
      <p className="whitespace-pre-wrap text-[7vmin] font-black leading-tight">{texto}</p>
    </div>
  );
}

function Reprodutor({ itens, nome, ativa, token, aoMostrar }: { itens: ItemTv[]; nome: string; ativa: boolean; token: string; aoMostrar: (itemId: string | null) => void }) {
  const [idx, setIdx] = useState(0);
  const assinatura = useMemo(() => itens.map((i) => `${i.id}:${i.duracao_seg}`).join("|"), [itens]);
  const atual = itens.length ? itens[idx % itens.length] : null;
  const proximo = useCallback(() => setIdx((i) => (itens.length ? (i + 1) % itens.length : 0)), [itens.length]);

  // Playlist mudou no ERP: recomeça do primeiro.
  useEffect(() => { setIdx(0); }, [assinatura]);

  // AO VIVO da gestão: a cada troca do que está na tela.
  const naTela = ativa && atual ? `${atual.id}#${idx}` : null;
  useEffect(() => { aoMostrar(naTela ? naTela.split("#")[0] : null); }, [naTela, aoMostrar]);

  // Tudo, menos vídeo, troca pelo tempo cadastrado (vídeo troca ao acabar).
  useEffect(() => {
    if (!atual || itens.length < 2 || atual.tipo === "video") return;
    const t = window.setTimeout(proximo, Math.max(3, atual.duracao_seg) * 1000);
    return () => window.clearTimeout(t);
  }, [atual, itens.length, proximo]);

  if (!ativa) return <Centro titulo={nome} sub="TV pausada no ERP" />;
  if (!atual) return <Ocioso nome={nome} />;

  const prox = itens.length > 1 ? itens[(idx + 1) % itens.length] : null;
  return (
    <>
      <Item key={`${atual.id}-${idx}`} item={atual} sozinho={itens.length === 1} aoAcabar={proximo} token={token} />
      {/* pré-carrega a próxima imagem para a troca não piscar */}
      {prox?.tipo === "imagem" && prox.arquivo && <link rel="preload" as="image" href={midiaPublica(prox.arquivo)} />}
    </>
  );
}

/**
 * Um item da playlist em tela cheia. Exportado para a prévia/ao vivo da
 * gestão (TvPrevia). `inicioS` (só ao vivo): há quanto tempo o item está na
 * TV — vídeo e YouTube começam desse ponto, para bater com a tela da TV.
 */
export function Item({ item, sozinho, aoAcabar, token, previa = false, inicioS = 0 }: { item: ItemTv; sozinho: boolean; aoAcabar: () => void; token: string; previa?: boolean; inicioS?: number }) {
  if (item.tipo === "relatorio") return <TvRelatorio item={item} token={token} previa={previa} />;
  const midia = (arquivo: string | null) => item.url_previa || midiaPublica(arquivo);
  if (item.tipo === "imagem") {
    return <img src={midia(item.arquivo)} alt={item.titulo ?? ""} className="h-full w-full object-contain" onError={aoAcabar} />;
  }
  if (item.tipo === "video") {
    return <video src={midia(item.arquivo)} className="h-full w-full object-contain" autoPlay muted playsInline loop={sozinho} onEnded={aoAcabar} onError={aoAcabar}
      onLoadedMetadata={(e) => { const v = e.currentTarget; if (inicioS > 1 && Number.isFinite(v.duration) && v.duration > 0) v.currentTime = inicioS % v.duration; }} />;
  }
  if (item.tipo === "youtube") {
    const src = youtubeEmbed(item.url);
    return src ? <iframe src={inicioS > 1 ? `${src}&start=${Math.floor(inicioS)}` : src} title={item.titulo ?? "YouTube"} className="h-full w-full border-0" allow="autoplay; encrypted-media" /> : <Centro titulo="Link do YouTube inválido" sub={item.url ?? ""} />;
  }
  if (item.tipo === "url") {
    return <iframe src={item.url ?? "about:blank"} title={item.titulo ?? "Página"} className="h-full w-full border-0 bg-white" referrerPolicy="no-referrer" />;
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[3vmin] p-[6vmin] text-center" style={{ background: corAviso(item.cor) }}>
      {item.titulo && <p className="text-[5vmin] font-bold uppercase tracking-wide text-white/80">{item.titulo}</p>}
      <p className="whitespace-pre-wrap text-[8vmin] font-black leading-tight">{item.texto}</p>
    </div>
  );
}

export function Ocioso({ nome }: { nome: string }) {
  const [agora, setAgora] = useState(new Date());
  useEffect(() => { const t = window.setInterval(() => setAgora(new Date()), 1000); return () => window.clearInterval(t); }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#0b1f4d] to-[#1e3a8a] text-center">
      <p className="font-mono text-[16vmin] font-black leading-none">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
      <p className="text-[4vmin] capitalize text-white/80">{agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</p>
      <p className="mt-6 text-[2.5vmin] text-white/50">{nome} · sem conteúdo na playlist</p>
    </div>
  );
}
