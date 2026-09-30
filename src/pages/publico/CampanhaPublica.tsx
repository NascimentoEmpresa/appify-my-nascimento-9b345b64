import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { CheckCircle2, ClipboardCheck, Download, ExternalLink, Loader2, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import logoNascimento from "@/assets/logo-nascimento-completo.webp";
import { urlMidia } from "@/hooks/useTreinamentosPlataforma";
import {
  useCampanhaPublica, useResponderCampanha,
  type CampanhaPublica as TCampanha, type ItemPublico, type PerguntaPublica, type ResultadoCampanha,
} from "@/hooks/useTrnCampanhas";
import { embedDeVideo } from "@/pages/treinamentos/treinamento/core";

// =====================================================================
// CAMPANHA PÚBLICA — /campanhas/<slug>, sem login (30/09/2026).
//
// Quem chega pelo QR Code (cartaz, crachá, grupo de WhatsApp) vê a campanha
// do setor de Treinamentos: vídeos, textos, imagens, links, arquivos e
// provinhas. Tudo vem de uma RPC só (trn_campanha_publica), que já filtra
// rascunho e campanha fora do período; a provinha chega SEM gabarito e é
// corrigida no banco (trn_campanha_responder).
//
// `#item-<id>` no endereço rola até aquele conteúdo — é o QR "do vídeo".
// O miolo (CampanhaConteudo) é o mesmo da prévia no editor.
// =====================================================================

export default function CampanhaPublica() {
  const { slug } = useParams<{ slug: string }>();
  const { hash } = useLocation();
  const q = useCampanhaPublica(slug);

  useEffect(() => {
    if (q.data) document.title = `${q.data.titulo} · Grupo Nascimento`;
  }, [q.data]);

  // Chegou pelo QR de um vídeo: rola até ele e destaca por um instante.
  useEffect(() => {
    if (!q.data || !hash.startsWith("#item-")) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(hash.slice(1));
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-4", "ring-orange-300");
      window.setTimeout(() => el.classList.remove("ring-4", "ring-orange-300"), 2600);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q.data, hash]);

  if (q.isLoading) {
    return <Tela><div className="grid min-h-[60vh] place-items-center text-slate-500"><Loader2 className="h-7 w-7 animate-spin" /></div></Tela>;
  }
  if (q.isError || !q.data) {
    return (
      <Tela>
        <div className="mx-auto grid min-h-[70vh] max-w-md place-items-center px-6 text-center">
          <div>
            <img src={logoNascimento} alt="Grupo Nascimento" className="mx-auto mb-8 w-44" />
            <h1 className="text-xl font-bold text-slate-900">Campanha indisponível</h1>
            <p className="mt-2 text-sm text-slate-600">Este endereço não existe, a campanha ainda não foi publicada ou o período dela já acabou.</p>
          </div>
        </div>
      </Tela>
    );
  }
  return <Tela><CampanhaConteudo campanha={q.data} slug={slug!} /></Tela>;
}

function Tela({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-slate-100 font-sans text-slate-800">{children}</div>;
}

/** A campanha inteira. `previa` = editor: a provinha não envia nada. */
export function CampanhaConteudo({ campanha, slug, previa = false }: { campanha: TCampanha; slug: string; previa?: boolean }) {
  const capa = urlMidia(campanha.capa_path);
  const cor = /^#[0-9a-f]{6}$/i.test(campanha.cor) ? campanha.cor : "#0f3171";
  const [identidade, setIdentidade] = useState({ nome: "", documento: "" });
  const fim = campanha.fim_em ? new Date(campanha.fim_em) : null;

  return (
    <div className="pb-10">
      <header className="relative overflow-hidden text-white" style={{ background: `linear-gradient(135deg, ${cor} 0%, ${cor}cc 100%)` }}>
        {capa && <img src={capa} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />}
        <div className="relative mx-auto max-w-3xl px-5 pb-10 pt-6">
          <div className="mb-8 inline-block rounded-xl bg-white/95 px-3 py-2 shadow-sm"><img src={logoNascimento} alt="Grupo Nascimento" className="h-8" /></div>
          <div className="text-[11px] font-extrabold uppercase tracking-[.18em] opacity-80">Campanha · Treinamentos</div>
          <h1 className="mt-1 text-3xl font-black leading-tight sm:text-4xl">{campanha.titulo || "Sem título"}</h1>
          {campanha.resumo && <p className="mt-3 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed opacity-95">{campanha.resumo}</p>}
          {fim && <p className="mt-4 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Disponível até {fim.toLocaleDateString("pt-BR")}</p>}
        </div>
      </header>

      <main className="relative mx-auto -mt-5 max-w-3xl space-y-4 px-4">
        {campanha.itens.length === 0 && (
          <section className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Nenhum conteúdo ainda.</section>
        )}
        {campanha.itens.map((it) => (
          <section key={it.id} id={`item-${it.id}`} className="scroll-mt-4 overflow-hidden rounded-2xl bg-white shadow-sm transition-shadow">
            <Item item={it} cor={cor} slug={slug} previa={previa} campanha={campanha} identidade={identidade} setIdentidade={setIdentidade} />
          </section>
        ))}
      </main>

      <footer className="mx-auto mt-10 max-w-3xl px-5 text-center text-xs text-slate-400">Grupo Nascimento · soluções em serviços</footer>
    </div>
  );
}

type Identidade = { nome: string; documento: string };

/** Só http(s): o link vem digitado no editor e vai para uma página pública. */
const urlSegura = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

function Item({ item, cor, slug, previa, campanha, identidade, setIdentidade }: {
  item: ItemPublico; cor: string; slug: string; previa: boolean; campanha: TCampanha;
  identidade: Identidade; setIdentidade: (i: Identidade) => void;
}) {
  const titulo = item.titulo?.trim();
  const cabecalho = titulo && item.tipo !== "prova" ? <h2 className="px-5 pt-5 text-lg font-bold text-slate-900">{titulo}</h2> : null;

  switch (item.tipo) {
    case "video":
      return (
        <>
          {cabecalho}
          <div className={cn("bg-black", titulo && "mt-3")}><Video item={item} /></div>
          {item.texto?.trim() && <TextoRico texto={item.texto} className="px-5 py-4" />}
        </>
      );
    case "texto":
      return <>{cabecalho}<TextoRico texto={item.texto ?? ""} className={cn("px-5 pb-5", titulo ? "pt-2" : "pt-5")} /></>;
    case "imagem": {
      const src = urlMidia(item.imagem_path);
      return (
        <>
          {cabecalho}
          {src ? <img src={src} alt={titulo ?? ""} className={cn("w-full", titulo && "mt-3")} loading="lazy" /> : <Vazio texto="Imagem não enviada." />}
          {item.texto?.trim() && <TextoRico texto={item.texto} className="px-5 py-4" />}
        </>
      );
    }
    case "link":
      return (
        <div className="p-5">
          {titulo && <h2 className="mb-1 text-lg font-bold text-slate-900">{titulo}</h2>}
          {item.texto?.trim() && <TextoRico texto={item.texto} className="mb-3" />}
          {urlSegura(item.link_url)
            ? <a href={urlSegura(item.link_url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: cor }}><ExternalLink className="h-4 w-4" /> {item.link_rotulo?.trim() || "Acessar"}</a>
            : <p className="text-sm text-slate-400">Link não informado.</p>}
        </div>
      );
    case "arquivo": {
      const src = urlMidia(item.arquivo_path);
      return (
        <div className="p-5">
          {titulo && <h2 className="mb-1 text-lg font-bold text-slate-900">{titulo}</h2>}
          {item.texto?.trim() && <TextoRico texto={item.texto} className="mb-3" />}
          {src
            ? <a href={src} target="_blank" rel="noopener noreferrer" download={item.arquivo_nome ?? undefined} className="flex items-center gap-3 rounded-xl border p-3 hover:bg-slate-50"><Download className="h-5 w-5 shrink-0" style={{ color: cor }} /><span className="min-w-0 truncate text-sm font-semibold">{item.arquivo_nome || "Baixar arquivo"}</span></a>
            : <p className="text-sm text-slate-400">Arquivo não enviado.</p>}
        </div>
      );
    }
    case "prova":
      return <Provinha item={item} cor={cor} slug={slug} previa={previa} campanha={campanha} identidade={identidade} setIdentidade={setIdentidade} />;
    default:
      return null;
  }
}

function Vazio({ texto }: { texto: string }) {
  return <div className="grid aspect-video place-items-center bg-slate-100 text-sm text-slate-400">{texto}</div>;
}

function Video({ item }: { item: ItemPublico }) {
  const arquivo = urlMidia(item.video_path);
  if (arquivo) return <video src={arquivo} controls playsInline preload="metadata" className="aspect-video w-full" />;
  if (!urlSegura(item.video_url)) return <Vazio texto="Vídeo não informado." />;
  const emb = embedDeVideo(item.video_url);
  if (emb.tipo === "youtube" || emb.tipo === "vimeo") {
    return <iframe src={emb.src} title={item.titulo ?? "Vídeo"} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen className="aspect-video w-full" />;
  }
  if (emb.tipo === "arquivo") return <video src={emb.src} controls playsInline preload="metadata" className="aspect-video w-full" />;
  return (
    <a href={urlSegura(item.video_url)!} target="_blank" rel="noopener noreferrer" className="flex aspect-video items-center justify-center gap-2 text-sm font-semibold text-white">
      <ExternalLink className="h-5 w-5" /> Assistir ao vídeo
    </a>
  );
}

/** Texto com parágrafos, **negrito** e links clicáveis — nada de HTML cru. */
export function TextoRico({ texto, className }: { texto: string; className?: string }) {
  const partes = useMemo(() => texto.split(/(https?:\/\/[^\s)]+|\*\*[^*]+\*\*)/g), [texto]);
  return (
    <div className={cn("whitespace-pre-line text-[15px] leading-relaxed text-slate-700", className)}>
      {partes.map((p, i) => {
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-blue-700 underline">{p}</a>;
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-bold text-slate-900">{p.slice(2, -2)}</strong>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </div>
  );
}

const maskCpf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

function Provinha({ item, cor, slug, previa, campanha, identidade, setIdentidade }: {
  item: ItemPublico; cor: string; slug: string; previa: boolean; campanha: TCampanha;
  identidade: Identidade; setIdentidade: (i: Identidade) => void;
}) {
  const prova = item.prova;
  const responder = useResponderCampanha(slug);
  const [respostas, setRespostas] = useState<Record<string, number[]>>({});
  const [resultado, setResultado] = useState<ResultadoCampanha | null>(null);
  const perguntas = prova?.perguntas ?? [];

  const marcar = (p: PerguntaPublica, i: number) => {
    if (resultado) return;
    setRespostas((r) => {
      const atual = r[p.id] ?? [];
      if (p.tipo === "multipla") return { ...r, [p.id]: atual.includes(i) ? atual.filter((x) => x !== i) : [...atual, i] };
      return { ...r, [p.id]: [i] };
    });
  };

  const enviar = async () => {
    if (previa) { toast.info("Na pré-visualização a provinha não é enviada."); return; }
    if (campanha.pedir_identificacao && !identidade.nome.trim()) { toast.error("Informe seu nome antes de enviar."); return; }
    if (campanha.pedir_documento && identidade.documento.replace(/\D/g, "").length !== 11) { toast.error("Informe o CPF completo."); return; }
    const faltam = perguntas.filter((p) => !respostas[p.id]?.length).length;
    if (faltam > 0 && !window.confirm(`${faltam} pergunta(s) sem resposta contam como erradas. Enviar mesmo assim?`)) return;
    try {
      const r = await responder.mutateAsync({ item: item.id, nome: identidade.nome, documento: identidade.documento, respostas });
      setResultado(r);
      document.getElementById(`item-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar agora.");
    }
  };

  const refazer = () => { setResultado(null); setRespostas({}); };
  const correcao = new Map((resultado?.itens ?? []).map((c) => [c.id, c]));

  return (
    <div className="p-5">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.14em]" style={{ color: cor }}>
        <ClipboardCheck className="h-4 w-4" /> Provinha
      </div>
      <h2 className="text-lg font-bold text-slate-900">{prova?.titulo || item.titulo || "Provinha"}</h2>
      {prova?.instrucoes && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{prova.instrucoes}</p>}
      <p className="mt-1 text-xs text-slate-500">{perguntas.length} pergunta(s) · para passar: {item.nota_minima}%</p>

      {resultado && (
        <div className={cn("mt-4 flex items-center gap-3 rounded-xl p-4", resultado.aprovado ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900")}>
          {resultado.aprovado ? <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" /> : <XCircle className="h-8 w-8 shrink-0 text-rose-600" />}
          <div className="flex-1">
            <div className="text-2xl font-black">{resultado.nota}%</div>
            <div className="text-sm">{resultado.aprovado ? "Parabéns, você passou!" : `Não foi dessa vez — o mínimo é ${resultado.nota_minima}%.`} {resultado.acertos} de {resultado.total} certa(s).</div>
          </div>
          <button type="button" onClick={refazer} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-bold shadow-sm"><RotateCcw className="h-3.5 w-3.5" /> Refazer</button>
        </div>
      )}

      {!resultado && campanha.pedir_identificacao && (
        <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">Seu nome *
            <input value={identidade.nome} onChange={(e) => setIdentidade({ ...identidade, nome: e.target.value })} maxLength={120} autoComplete="name"
                   className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
          </label>
          {campanha.pedir_documento && (
            <label className="text-xs font-semibold text-slate-600">CPF *
              <input value={identidade.documento} onChange={(e) => setIdentidade({ ...identidade, documento: maskCpf(e.target.value) })} inputMode="numeric"
                     className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
            </label>
          )}
        </div>
      )}

      <ol className="mt-4 space-y-4">
        {perguntas.map((p, n) => {
          const c = correcao.get(p.id);
          const marcadas = respostas[p.id] ?? [];
          return (
            <li key={p.id} className={cn("rounded-xl border p-4", c && (c.ok ? "border-emerald-300 bg-emerald-50/40" : "border-rose-300 bg-rose-50/40"))}>
              <div className="mb-2 flex items-start gap-2">
                <span className="mt-0.5 text-xs font-bold text-slate-400">{n + 1}.</span>
                <p className="flex-1 whitespace-pre-line text-[15px] font-semibold text-slate-900">{p.enunciado}</p>
                {c && (c.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <XCircle className="h-5 w-5 shrink-0 text-rose-600" />)}
              </div>
              {p.tipo === "multipla" && !resultado && <p className="mb-2 text-xs text-slate-500">Marque todas as corretas.</p>}
              <div className="space-y-2">
                {p.opcoes.map((o, i) => {
                  const sel = marcadas.includes(i);
                  const certa = c?.corretas?.includes(i);
                  return (
                    <button key={i} type="button" onClick={() => marcar(p, i)} disabled={!!resultado}
                            className={cn("flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition",
                              !resultado && (sel ? "border-transparent text-white" : "border-slate-200 hover:bg-slate-50"),
                              resultado && certa && "border-emerald-400 bg-emerald-100 font-semibold text-emerald-900",
                              resultado && !certa && sel && "border-rose-300 bg-rose-100 text-rose-900",
                              resultado && !certa && !sel && "border-slate-200 text-slate-500")}
                            style={!resultado && sel ? { background: cor } : undefined}>
                      <span className={cn("grid h-5 w-5 shrink-0 place-items-center border-2 text-[10px]", p.tipo === "multipla" ? "rounded" : "rounded-full",
                        !resultado && sel ? "border-white" : "border-slate-300")}>{sel ? "✓" : ""}</span>
                      <span className="flex-1">{o}</span>
                    </button>
                  );
                })}
              </div>
              {c?.explicacao && <p className="mt-3 rounded-lg bg-white/70 p-2 text-xs text-slate-600"><b>Explicação:</b> {c.explicacao}</p>}
            </li>
          );
        })}
      </ol>

      {!resultado && perguntas.length > 0 && (
        <button type="button" onClick={enviar} disabled={responder.isPending}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-60 sm:w-auto"
                style={{ background: cor }}>
          {responder.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Enviar respostas
        </button>
      )}
    </div>
  );
}
