import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, ClipboardCheck, Copy, Download, ExternalLink, FileText, Image as ImageIcon, ImagePlus,
  Link2, Loader2, Paperclip, PlayCircle, Save, Smartphone, Trash2, Type, Upload,
} from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { uploadMidia, urlMidia } from "@/hooks/useTreinamentosPlataforma";
import {
  novoItemCampanha, urlPublicaCampanha, useTrnCampanha, useTrnCampanhaAcessos, useTrnCampanhaRespostas,
  useTrnExcluirRespostaCampanha, useTrnSalvarCampanha,
  type CampanhaInput, type CampanhaPublica, type ItemInput,
} from "@/hooks/useTrnCampanhas";
import { CampanhaConteudo } from "@/pages/publico/CampanhaPublica";
import { embedDeVideo } from "@/pages/treinamentos/treinamento/core";
import { MENU, ROTULO_ITEM_CAMPANHA, type TipoItemCampanha } from "./tipos";
import { ProvaEditor, erroDaProva, quizParaSalvar } from "./ProvaEditor";
import { BotaoQrCode } from "./QrCodeDialog";
import { LinkVoltar, TrnCarregando, TrnEstilo, TrnHero, TrnKpi, fmtDataHora } from "./ui";

// =====================================================================
// TREINAMENTOS › Campanhas — criar/editar (30/09/2026).
//
// Esquerda: dados da campanha e o conteúdo, montado em blocos (vídeo,
// texto, imagem, link, arquivo, provinha) que sobem e descem. Direita:
// link público + QR Code e a PRÉVIA ao vivo — o mesmo componente da página
// pública, alimentado pelo formulário (não precisa salvar para ver).
//
// Cada vídeo tem o seu QR (o link da campanha com #item-<id>: a página rola
// até ele). O id do bloco nasce aqui no navegador, então o QR do vídeo já
// fica certo; só depende da campanha estar salva (é o slug que dá o link).
// =====================================================================

const CORES = ["#0f3171", "#1d4ed8", "#f26522", "#047857", "#7c3aed", "#be123c", "#0f172a"];

const ICONE: Record<TipoItemCampanha, typeof Type> = {
  video: PlayCircle, texto: Type, imagem: ImageIcon, link: Link2, arquivo: Paperclip, prova: ClipboardCheck,
};

const VAZIA: CampanhaInput = {
  titulo: "", slug: "", resumo: "", capa_path: null, cor: CORES[0], publicada: false,
  inicio_em: null, fim_em: null, pedir_identificacao: true, pedir_documento: false,
};

// datetime-local ↔ ISO (horário local da pessoa).
const paraLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const deLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const slugify = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "").slice(0, 80);

export default function CampanhaForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = useTrnCampanha(id);
  const salvar = useTrnSalvarCampanha();

  const [c, setC] = useState<CampanhaInput>(VAZIA);
  const [itens, setItens] = useState<ItemInput[]>([]);
  const [slugSalvo, setSlugSalvo] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(!id);
  const [subindo, setSubindo] = useState<Record<string, number>>({});
  const [prevMovel, setPrevMovel] = useState(true);

  useEffect(() => {
    if (!q.data || carregado) return;
    const { campanha: k, itens: its } = q.data;
    setC({
      id: k.id, titulo: k.titulo, slug: k.slug, resumo: k.resumo, capa_path: k.capa_path, cor: k.cor, publicada: k.publicada,
      inicio_em: k.inicio_em, fim_em: k.fim_em, pedir_identificacao: k.pedir_identificacao, pedir_documento: k.pedir_documento,
    });
    setItens(its.map(({ campanha_id, posicao, ...i }) => ({ ...i, quiz: i.quiz ?? (i.tipo === "prova" ? [] : null), prova_config: i.prova_config ?? {} })));
    setSlugSalvo(k.slug);
    setCarregado(true);
  }, [q.data, carregado]);

  const set = (p: Partial<CampanhaInput>) => setC((x) => ({ ...x, ...p }));
  const setItem = (iid: string, p: Partial<ItemInput>) => setItens((l) => l.map((i) => (i.id === iid ? { ...i, ...p } : i)));
  const mover = (k: number, d: -1 | 1) => setItens((l) => {
    const j = k + d; if (j < 0 || j >= l.length) return l;
    const n = [...l]; [n[k], n[j]] = [n[j], n[k]]; return n;
  });
  const remover = (it: ItemInput) => {
    const temConteudo = it.titulo?.trim() || it.texto?.trim() || it.video_url || it.video_path || it.imagem_path || it.arquivo_path || it.quiz?.length;
    if (temConteudo && !window.confirm(`Remover este bloco (${ROTULO_ITEM_CAMPANHA[it.tipo]})?${it.tipo === "prova" ? " As respostas já enviadas continuam guardadas." : ""}`)) return;
    setItens((l) => l.filter((i) => i.id !== it.id));
  };
  const adicionar = (tipo: TipoItemCampanha) => {
    const novo = novoItemCampanha(tipo);
    setItens((l) => [...l, novo]);
    window.setTimeout(() => document.getElementById(`bloco-${novo.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  const subir = async (chave: string, file: File | null, pasta: string, aceita: RegExp, erro: string): Promise<string | null> => {
    if (!file) return null;
    if (!aceita.test(file.type || file.name)) { toast.error(erro); return null; }
    setSubindo((s) => ({ ...s, [chave]: 0 }));
    try { return await uploadMidia(file, pasta, (pct) => setSubindo((s) => ({ ...s, [chave]: pct }))); }
    catch (e: any) { toast.error(e?.message ?? "Não deu para enviar."); return null; }
    finally { setSubindo((s) => { const n = { ...s }; delete n[chave]; return n; }); }
  };

  const validar = (): string | null => {
    if (!c.titulo.trim()) return "Informe o título da campanha.";
    if (c.inicio_em && c.fim_em && new Date(c.fim_em) < new Date(c.inicio_em)) return "O fim do período é antes do início.";
    for (const [k, it] of itens.entries()) {
      const n = `Bloco ${k + 1} (${ROTULO_ITEM_CAMPANHA[it.tipo]})`;
      if (it.tipo === "video" && !it.video_path && !it.video_url?.trim()) return `${n}: informe o link ou envie o vídeo.`;
      if (it.tipo === "texto" && !it.texto?.trim()) return `${n}: escreva o texto.`;
      if (it.tipo === "texto" && it.recolhido && !it.titulo?.trim()) return `${n}: texto recolhido precisa de título (é o que aparece com a setinha).`;
      if (it.tipo === "imagem" && !it.imagem_path) return `${n}: envie a imagem.`;
      if (it.tipo === "arquivo" && !it.arquivo_path) return `${n}: envie o arquivo.`;
      if (it.tipo === "link" && !/^https?:\/\/\S+$/i.test(it.link_url?.trim() ?? "")) return `${n}: o link precisa começar com http:// ou https://.`;
      if (it.tipo === "video" && it.video_url?.trim() && !/^https?:\/\//i.test(it.video_url.trim())) return `${n}: o link do vídeo precisa começar com https://.`;
      if (it.tipo === "prova") {
        const e = erroDaProva(it.quiz ?? [], it.prova_config);
        if (e) return `${n}: ${e}`;
      }
    }
    return null;
  };

  const gravar = async () => {
    const erro = validar();
    if (erro) { toast.error(erro); return; }
    if (Object.keys(subindo).length) { toast.error("Espere terminar de enviar os arquivos."); return; }
    if (slugSalvo && c.slug && c.slug !== slugSalvo &&
        !window.confirm("Você mudou o endereço da campanha. Os QR Codes e links já divulgados param de funcionar. Continuar?")) return;
    try {
      const salva = await salvar.mutateAsync({
        campanha: { ...c, titulo: c.titulo.trim(), resumo: c.resumo?.trim() || null, slug: c.slug ? slugify(c.slug) : null },
        itens: itens.map((i) => ({
          ...i, titulo: i.titulo?.trim() || null, texto: i.texto?.trim() || null, recolhido: i.tipo === "texto" && !!i.recolhido,
          video_url: i.tipo === "video" && !i.video_path ? i.video_url?.trim() || null : null,
          link_url: i.link_url?.trim() || null, link_rotulo: i.link_rotulo?.trim() || null,
          quiz: i.tipo === "prova" ? quizParaSalvar(i.quiz ?? []) : null,
          nota_minima: Math.min(100, Math.max(0, Number(i.nota_minima) || 0)),
        })),
      });
      toast.success(id ? "Campanha salva." : "Campanha criada — o link público e o QR Code já estão prontos.");
      setSlugSalvo(salva.slug);
      set({ slug: salva.slug });
      if (!id) navigate(`/app/treinamentos/campanhas/${salva.id}`, { replace: true });
    } catch (e: any) {
      toast.error(/duplicate|unique/i.test(e?.message ?? "") ? "Esse endereço já é de outra campanha." : e?.message ?? "Não deu para salvar.");
    }
  };

  // A prévia é a página pública de verdade, com o que está no formulário.
  const previa: CampanhaPublica = useMemo(() => ({
    id: c.id ?? "previa", titulo: c.titulo, slug: slugSalvo ?? "previa", resumo: c.resumo, capa_path: c.capa_path, cor: c.cor, fim_em: c.fim_em,
    pedir_identificacao: c.pedir_identificacao, pedir_documento: c.pedir_documento,
    itens: itens.map((i) => ({
      id: i.id, tipo: i.tipo, titulo: i.titulo, texto: i.texto, recolhido: i.tipo === "texto" && !!i.recolhido, video_url: i.video_path ? null : i.video_url, video_path: i.video_path,
      imagem_path: i.imagem_path, arquivo_path: i.arquivo_path, arquivo_nome: i.arquivo_nome, link_url: i.link_url, link_rotulo: i.link_rotulo,
      nota_minima: Number(i.nota_minima) || 0,
      prova: i.tipo === "prova" ? {
        titulo: i.prova_config?.titulo || i.titulo || "Provinha", instrucoes: i.prova_config?.instrucoes ?? null,
        perguntas: (i.quiz ?? []).map((p) => ({ id: p.id, tipo: p.tipo ?? "unica", enunciado: p.enunciado, opcoes: p.opcoes, pontos: p.pontos ?? 1 })),
      } : null,
    })),
  }), [c, itens, slugSalvo]);

  if (id && (q.isLoading || !carregado)) return <TrnCarregando texto="Abrindo a campanha…" />;
  if (id && q.isError) return <Card className="p-6 text-sm text-muted-foreground">Campanha não encontrada (ou sem liberação para ver).</Card>;

  const url = slugSalvo ? urlPublicaCampanha(slugSalvo) : null;
  const aba = params.get("aba") === "respostas" && id ? "respostas" : "conteudo";
  const noAr = c.publicada && (!c.inicio_em || new Date(c.inicio_em) <= new Date()) && (!c.fim_em || new Date(c.fim_em) >= new Date());
  const avisoQr = !noAr ? "A campanha não está no ar — quem ler o QR agora vê \"Campanha indisponível\". Marque \"Publicada\" e salve." : undefined;

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.campanhas} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para as campanhas.</Card>}>
        <LinkVoltar to="/app/treinamentos/campanhas">Campanhas</LinkVoltar>
        <TrnHero eyebrow="Treinamentos › Campanhas" titulo={id ? c.titulo || "Campanha" : "Nova campanha"}
                 texto={url ? url : "Ao salvar, a campanha ganha um endereço público e o QR Code."}
                 acoes={<>
                   {url && <BotaoQrCode url={url} titulo={c.titulo} rotulo="GERAR QR CODE" variant="secondary" aviso={avisoQr} />}
                   {url && <a href={url} target="_blank" rel="noreferrer" className="sec"><ExternalLink className="h-4 w-4" /> Abrir página</a>}
                   <AcessoGate menu={MENU.campanhas} acao={id ? "alterar" : "incluir"}>
                     <button type="button" onClick={gravar} disabled={salvar.isPending}>{salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar</button>
                   </AcessoGate>
                 </>} />

        <Tabs value={aba} onValueChange={(v) => setParams(v === "respostas" ? { aba: "respostas" } : {}, { replace: true })}>
          {id && (
            <TabsList className="mb-4">
              <TabsTrigger value="conteudo">Conteúdo</TabsTrigger>
              <TabsTrigger value="respostas">Respostas e acessos</TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="conteudo" className="mt-0">
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
              <div className="trn-form">
                {/* ── Dados ─────────────────────────────────────────── */}
                <div className="grupo">
                  <h4>Dados da campanha</h4>
                  <div className="grid gap-3">
                    <div className="campo"><label>Título *</label>
                      <Input value={c.titulo} maxLength={160} onChange={(e) => set({ titulo: e.target.value })} placeholder="Ex.: Setembro Amarelo — cuidar de quem cuida" /></div>
                    <div className="campo"><label>Resumo</label>
                      <Textarea rows={3} value={c.resumo ?? ""} onChange={(e) => set({ resumo: e.target.value })} placeholder="Uma ou duas frases que aparecem no topo da página." /></div>
                    <div className="campo"><label>Endereço público</label>
                      <div className="flex items-center gap-1 rounded-md border bg-slate-50 pl-3 text-sm">
                        <span className="shrink-0 text-slate-500">{window.location.host}/campanhas/</span>
                        <Input className="border-0 bg-white font-mono" value={c.slug ?? ""} placeholder={slugify(c.titulo) || "gerado-do-titulo"}
                               onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
                      </div>
                      <div className="ajuda">Em branco, sai do título. Depois de divulgar o QR Code, evite mudar — o link antigo deixa de funcionar.</div></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="campo"><label>Capa (opcional)</label>
                        <div className="flex items-center gap-2">
                          <label className="cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted">
                            <ImagePlus className="mr-1 inline h-4 w-4" /> {subindo.capa != null ? `Enviando ${subindo.capa}%` : c.capa_path ? "Trocar" : "Enviar imagem"}
                            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                                   onChange={async (e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; const p = await subir("capa", f, "campanhas/capas", /^image\//, "A capa tem que ser uma imagem."); if (p) set({ capa_path: p }); }} />
                          </label>
                          {c.capa_path && <><img src={urlMidia(c.capa_path)!} alt="" className="h-9 w-14 rounded object-cover" /><button type="button" className="text-xs text-rose-600" onClick={() => set({ capa_path: null })}>remover</button></>}
                        </div></div>
                      <div className="campo"><label>Cor da campanha</label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {CORES.map((k) => <button key={k} type="button" title={k} onClick={() => set({ cor: k })} className={`h-7 w-7 rounded-full border-2 ${c.cor === k ? "border-slate-900 ring-2 ring-slate-300" : "border-white shadow"}`} style={{ background: k }} />)}
                          <input type="color" value={c.cor} onChange={(e) => set({ cor: e.target.value })} className="h-7 w-9 cursor-pointer rounded border" title="Outra cor" />
                        </div></div>
                    </div>
                  </div>
                </div>

                {/* ── Publicação ─────────────────────────────────────── */}
                <div className="grupo">
                  <h4>Publicação</h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={c.publicada} onCheckedChange={(v) => set({ publicada: v })} />
                      <span><b>Publicada</b> — qualquer pessoa com o link ou o QR Code acessa, sem login.</span></label>
                    <div className="campo"><label>No ar a partir de (opcional)</label>
                      <Input type="datetime-local" value={paraLocal(c.inicio_em)} onChange={(e) => set({ inicio_em: deLocal(e.target.value) })} /></div>
                    <div className="campo"><label>Sai do ar em (opcional)</label>
                      <Input type="datetime-local" value={paraLocal(c.fim_em)} onChange={(e) => set({ fim_em: deLocal(e.target.value) })} /></div>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={c.pedir_identificacao} onCheckedChange={(v) => set({ pedir_identificacao: v, pedir_documento: v && c.pedir_documento })} /> Provinha pede o nome de quem responde</label>
                    <label className={`flex items-center gap-2 text-sm sm:col-span-2 ${c.pedir_identificacao ? "" : "opacity-50"}`}><Switch disabled={!c.pedir_identificacao} checked={c.pedir_documento} onCheckedChange={(v) => set({ pedir_documento: v })} /> …e também o CPF</label>
                  </div>
                </div>

                {/* ── Conteúdo ───────────────────────────────────────── */}
                <div className="grupo">
                  <h4>Conteúdo <span className="font-normal text-slate-400">· {itens.length} bloco(s), na ordem em que aparecem</span></h4>
                  {itens.length === 0 && <p className="mb-3 rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">Adicione vídeos, textos, imagens, links, arquivos ou uma provinha.</p>}
                  <div className="space-y-3">
                    {itens.map((it, k) => (
                      <Bloco key={it.id} it={it} k={k} total={itens.length} slug={slugSalvo} titulo={c.titulo} avisoQr={avisoQr} subindo={subindo}
                             setItem={(p) => setItem(it.id, p)} mover={(d) => mover(k, d)} remover={() => remover(it)} subir={subir} />
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                    <span className="mr-1 self-center text-xs font-bold uppercase tracking-wide text-slate-500">Adicionar</span>
                    {(Object.keys(ROTULO_ITEM_CAMPANHA) as TipoItemCampanha[]).map((t) => {
                      const I = ICONE[t];
                      return <Button key={t} type="button" variant="outline" size="sm" onClick={() => adicionar(t)}><I className="mr-1.5 h-4 w-4" /> {ROTULO_ITEM_CAMPANHA[t]}</Button>;
                    })}
                  </div>
                </div>

                <div className="flex gap-2">
                  <AcessoGate menu={MENU.campanhas} acao={id ? "alterar" : "incluir"} fallback={<p className="text-xs text-muted-foreground">Você pode ver, mas não tem a ação de salvar.</p>}>
                    <Button onClick={gravar} disabled={salvar.isPending}>{salvar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} {id ? "Salvar alterações" : "Criar campanha"}</Button>
                  </AcessoGate>
                  <Button variant="outline" asChild><Link to="/app/treinamentos/campanhas">Voltar</Link></Button>
                </div>
              </div>

              {/* ── Link + prévia ──────────────────────────────────────── */}
              <div className="space-y-3 lg:sticky lg:top-4">
                <div className="trn-card">
                  <h3>Link público</h3>
                  {url ? (
                    <>
                      <div className="sub">{noAr ? "No ar — qualquer um acessa." : "Fora do ar — quem abrir vê \"indisponível\"."}</div>
                      <div className="flex gap-2">
                        <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                        <Button variant="outline" size="icon" title="Copiar" onClick={async () => { try { await navigator.clipboard.writeText(url); toast.success("Link copiado."); } catch { /* sem clipboard */ } }}><Copy className="h-4 w-4" /></Button>
                      </div>
                      <BotaoQrCode url={url} titulo={c.titulo} rotulo="GERAR QR CODE" variant="default" size="default" className="mt-2 w-full" aviso={avisoQr} />
                    </>
                  ) : <div className="sub mb-0">Salve a campanha para gerar o link e o QR Code.</div>}
                </div>
                <div className="trn-card p-0">
                  <div className="flex items-center justify-between px-4 pt-3">
                    <h3>Pré-visualização</h3>
                    <button type="button" onClick={() => setPrevMovel((v) => !v)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><Smartphone className="h-3.5 w-3.5" /> {prevMovel ? "celular" : "largura toda"}</button>
                  </div>
                  <div className="sub px-4">Como a pessoa vê, antes mesmo de salvar.</div>
                  <div className="max-h-[70vh] overflow-y-auto rounded-b-2xl bg-slate-100">
                    <div className={prevMovel ? "mx-auto w-[375px] max-w-full origin-top" : ""}><CampanhaConteudo campanha={previa} slug={slugSalvo ?? "previa"} previa /></div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {id && (
            <TabsContent value="respostas" className="mt-0">
              <Respostas campanhaId={id} titulo={c.titulo} itens={itens} />
            </TabsContent>
          )}
        </Tabs>
      </AcessoGate>
    </div>
  );
}

// ── Bloco de conteúdo ─────────────────────────────────────────────────

type Subir = (chave: string, file: File | null, pasta: string, aceita: RegExp, erro: string) => Promise<string | null>;

function Bloco({ it, k, total, slug, titulo, avisoQr, subindo, setItem, mover, remover, subir }: {
  it: ItemInput; k: number; total: number; slug: string | null; titulo: string; avisoQr?: string; subindo: Record<string, number>;
  setItem: (p: Partial<ItemInput>) => void; mover: (d: -1 | 1) => void; remover: () => void; subir: Subir;
}) {
  const I = ICONE[it.tipo];
  const pct = subindo[it.id];
  const enviar = (pasta: string, aceita: RegExp, erro: string, onPath: (path: string, f: File) => void) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null; e.target.value = "";
    const p = await subir(it.id, f, pasta, aceita, erro);
    if (p && f) onPath(p, f);
  };
  const Upload_ = ({ rotulo, accept, onChange }: { rotulo: string; accept: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => (
    <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted ${pct != null ? "pointer-events-none opacity-70" : ""}`}>
      {pct != null ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando {pct}%</> : <><Upload className="h-4 w-4" /> {rotulo}</>}
      <input type="file" accept={accept} className="hidden" onChange={onChange} />
    </label>
  );

  return (
    <div id={`bloco-${it.id}`} className="rounded-xl border bg-white">
      <div className="flex items-center gap-2 border-b bg-slate-50 px-3 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-orange-100 text-orange-700"><I className="h-4 w-4" /></span>
        <b className="text-sm">{k + 1}. {ROTULO_ITEM_CAMPANHA[it.tipo]}</b>
        <div className="ml-auto flex items-center gap-0.5">
          {it.tipo === "video" && (
            <BotaoQrCode url={slug ? urlPublicaCampanha(slug, it.id) : ""} titulo={it.titulo?.trim() || titulo || "Vídeo"} subtitulo={it.titulo?.trim() ? titulo : undefined}
                         rotulo="QR do vídeo" className="mr-1 h-8" aviso={avisoQr}
                         desabilitado={!slug} motivoDesabilitado="Salve a campanha para gerar o QR do vídeo" />
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={k === 0} title="Subir" onClick={() => mover(-1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={k === total - 1} title="Descer" onClick={() => mover(1)}><ArrowDown className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" title="Remover" onClick={remover}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid gap-3 p-3">
        {it.tipo !== "prova" && (
          <div className="campo"><label>Título {it.tipo === "texto" ? (it.recolhido ? "*" : "(opcional)") : ""}</label>
            <Input value={it.titulo ?? ""} onChange={(e) => setItem({ titulo: e.target.value })} placeholder={it.tipo === "video" ? "Ex.: Como usar o EPI corretamente" : ""} /></div>
        )}

        {it.tipo === "video" && (
          <>
            {!it.video_path && (
              <div className="campo"><label>Link do vídeo (YouTube, Vimeo ou .mp4)</label>
                <Input value={it.video_url ?? ""} onChange={(e) => setItem({ video_url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" />
                {it.video_url?.trim() && <div className="ajuda">{(() => { const t = embedDeVideo(it.video_url).tipo; return t === "youtube" ? "YouTube — toca dentro da página." : t === "vimeo" ? "Vimeo — toca dentro da página." : t === "arquivo" ? "Arquivo de vídeo — toca dentro da página." : "Outro site — vira um botão \"Assistir ao vídeo\"."; })()}</div>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {!it.video_path && <span className="text-xs text-slate-500">ou</span>}
              <Upload_ rotulo={it.video_path ? "Trocar arquivo" : "Enviar arquivo de vídeo (até 500 MB)"} accept="video/*"
                       onChange={enviar("campanhas/videos", /^video\/|\.(mp4|webm|mov|m4v)$/i, "Envie um arquivo de vídeo (mp4, webm, mov).", (p) => setItem({ video_path: p, video_url: null }))} />
              {it.video_path && <span className="truncate text-xs text-slate-500">{it.video_path.split("/").pop()}</span>}
              {it.video_path && <button type="button" className="text-xs text-rose-600" onClick={() => setItem({ video_path: null })}>remover</button>}
            </div>
            <div className="campo"><label>Texto abaixo do vídeo (opcional)</label>
              <Textarea rows={2} value={it.texto ?? ""} onChange={(e) => setItem({ texto: e.target.value })} /></div>
          </>
        )}

        {it.tipo === "texto" && (
          <div className="campo"><label>Texto *</label>
            <Textarea rows={6} value={it.texto ?? ""} onChange={(e) => setItem({ texto: e.target.value })} />
            <div className="ajuda">Quebras de linha são mantidas. Use **assim** para negrito; links (https://…) viram clicáveis.</div>
            {/* Texto recolhido (mig 278): na página pública fica só o título com
                a setinha, e o conteúdo abre ao tocar — como as seções da
                Wikipédia no celular. Recolhidos em sequência viram uma lista. */}
            <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0f3171]" checked={!!it.recolhido}
                     onChange={(e) => setItem({ recolhido: e.target.checked })} />
              <span>
                <span className="block text-sm font-semibold text-slate-800">Recolhido — mostrar só o título com a setinha</span>
                <span className="block text-xs text-slate-500">O texto abre ao clicar no título. Vários textos recolhidos seguidos formam uma lista de tópicos.</span>
              </span>
            </label></div>
        )}

        {it.tipo === "imagem" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Upload_ rotulo={it.imagem_path ? "Trocar imagem" : "Enviar imagem"} accept="image/png,image/jpeg,image/webp,image/gif"
                       onChange={enviar("campanhas/imagens", /^image\//, "Envie uma imagem (JPG, PNG, WEBP ou GIF).", (p) => setItem({ imagem_path: p }))} />
              {it.imagem_path && <img src={urlMidia(it.imagem_path)!} alt="" className="h-12 rounded border object-cover" />}
            </div>
            <div className="campo"><label>Legenda (opcional)</label>
              <Textarea rows={2} value={it.texto ?? ""} onChange={(e) => setItem({ texto: e.target.value })} /></div>
          </>
        )}

        {it.tipo === "link" && (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <div className="campo"><label>Endereço *</label>
                <Input value={it.link_url ?? ""} onChange={(e) => setItem({ link_url: e.target.value })} placeholder="https://…" /></div>
              <div className="campo"><label>Texto do botão</label>
                <Input value={it.link_rotulo ?? ""} onChange={(e) => setItem({ link_rotulo: e.target.value })} placeholder="Acessar" /></div>
            </div>
            <div className="campo"><label>Descrição (opcional)</label>
              <Textarea rows={2} value={it.texto ?? ""} onChange={(e) => setItem({ texto: e.target.value })} /></div>
          </>
        )}

        {it.tipo === "arquivo" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Upload_ rotulo={it.arquivo_path ? "Trocar arquivo" : "Enviar arquivo (PDF, planilha…)"} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg,.mp3"
                       onChange={enviar("campanhas/arquivos", /./, "", (p, f) => setItem({ arquivo_path: p, arquivo_nome: it.arquivo_nome || f.name }))} />
              {it.arquivo_path && <span className="flex items-center gap-1 text-xs text-slate-500"><FileText className="h-3.5 w-3.5" /> enviado</span>}
            </div>
            {it.arquivo_path && <div className="campo"><label>Nome que aparece para baixar</label>
              <Input value={it.arquivo_nome ?? ""} onChange={(e) => setItem({ arquivo_nome: e.target.value })} /></div>}
            <div className="campo"><label>Descrição (opcional)</label>
              <Textarea rows={2} value={it.texto ?? ""} onChange={(e) => setItem({ texto: e.target.value })} /></div>
          </>
        )}

        {it.tipo === "prova" && (
          <ProvaEditor publico quiz={it.quiz ?? []} notaMinima={String(it.nota_minima)} cfg={it.prova_config}
                       onChange={(p) => setItem({
                         ...(p.quiz ? { quiz: p.quiz } : {}),
                         ...(p.notaMinima != null ? { nota_minima: p.notaMinima as unknown as number } : {}),
                         ...(p.cfg ? { prova_config: p.cfg } : {}),
                       })} />
        )}
      </div>
    </div>
  );
}

// ── Respostas e acessos ───────────────────────────────────────────────

function Respostas({ campanhaId, titulo, itens }: { campanhaId: string; titulo: string; itens: ItemInput[] }) {
  const r = useTrnCampanhaRespostas(campanhaId);
  const a = useTrnCampanhaAcessos(campanhaId);
  const excluir = useTrnExcluirRespostaCampanha(campanhaId);
  const [prova, setProva] = useState("todas");
  const lista = (r.data ?? []).filter((x) => prova === "todas" || x.item_id === prova || (prova === "apagadas" && !x.item_id));
  const provas = itens.filter((i) => i.tipo === "prova");

  const acessos = (a.data ?? []).reduce((s, x) => s + x.acessos, 0);
  const aprovados = lista.filter((x) => x.aprovado).length;
  const media = lista.length ? Math.round(lista.reduce((s, x) => s + x.nota, 0) / lista.length) : null;

  // Últimos 30 dias, com os dias sem acesso zerados.
  const dias = useMemo(() => {
    const mapa = new Map((a.data ?? []).map((x) => [x.dia, x.acessos]));
    return Array.from({ length: 30 }, (_, k) => {
      const d = new Date(); d.setDate(d.getDate() - (29 - k));
      const iso = d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
      return { dia: iso, n: mapa.get(iso) ?? 0 };
    });
  }, [a.data]);
  const max = Math.max(1, ...dias.map((d) => d.n));

  const csv = () => {
    const linhas = [["Data", "Provinha", "Nome", "CPF", "Acertos", "Total", "Nota (%)", "Aprovado"],
      ...lista.map((x) => [fmtDataHora(x.created_at), x.item_titulo ?? "", x.nome ?? "", x.documento ?? "", x.acertos, x.total, x.nota, x.aprovado ? "Sim" : "Não"])];
    const txt = "﻿" + linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
    el.download = `respostas-${titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "campanha"}.csv`;
    el.click();
    URL.revokeObjectURL(el.href);
  };

  return (
    <div className="space-y-4">
      <div className="trn-kpis">
        <TrnKpi rotulo="Acessos" valor={acessos} sub="aberturas da página" icone={<ExternalLink className="h-5 w-5" />} />
        <TrnKpi rotulo="Respostas" valor={lista.length} sub={prova === "todas" ? "todas as provinhas" : "desta provinha"} icone={<ClipboardCheck className="h-5 w-5" />} />
        <TrnKpi rotulo="Aprovação" valor={lista.length ? `${Math.round((100 * aprovados) / lista.length)}%` : "—"} sub={`${aprovados} aprovado(s)`} icone={<ClipboardCheck className="h-5 w-5" />} />
        <TrnKpi rotulo="Nota média" valor={media != null ? `${media}%` : "—"} icone={<ClipboardCheck className="h-5 w-5" />} />
      </div>

      <div className="trn-card">
        <h3>Acessos por dia</h3><div className="sub">Últimos 30 dias</div>
        <div className="flex h-28 items-end gap-[3px]">
          {dias.map((d) => (
            <div key={d.dia} className="group relative flex-1" title={`${d.dia.split("-").reverse().join("/")}: ${d.n}`}>
              <div className="rounded-t bg-blue-600/80 group-hover:bg-orange-500" style={{ height: `${Math.max(d.n ? 6 : 2, (100 * d.n) / max)}%`, opacity: d.n ? 1 : 0.25 }} />
            </div>
          ))}
        </div>
      </div>

      <div className="trn-card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="mr-auto">Respostas das provinhas</h3>
          <Select value={prova} onValueChange={setProva}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as provinhas</SelectItem>
              {provas.map((p) => <SelectItem key={p.id} value={p.id}>{p.prova_config?.titulo || p.titulo || "Provinha"}</SelectItem>)}
              <SelectItem value="apagadas">De provinhas removidas</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={csv} disabled={!lista.length}><Download className="mr-1.5 h-4 w-4" /> Exportar CSV</Button>
        </div>
        {r.isLoading ? <TrnCarregando /> : lista.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Ninguém respondeu ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="trn-tab">
              <thead><tr><th>Data</th><th>Provinha</th><th>Nome</th><th>CPF</th><th>Acertos</th><th>Nota</th><th /></tr></thead>
              <tbody>
                {lista.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap">{fmtDataHora(x.created_at)}</td>
                    <td>{x.item_titulo ?? "—"}</td>
                    <td>{x.nome ?? <span className="text-slate-400">anônimo</span>}</td>
                    <td className="font-mono text-xs">{x.documento ? x.documento.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "—"}</td>
                    <td>{x.acertos}/{x.total}</td>
                    <td><span className={`trn-badge ${x.aprovado ? "ok" : "err"}`}>{x.nota}%</span></td>
                    <td className="text-right">
                      <AcessoGate menu={MENU.campanhas} acao="excluir">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600" title="Excluir resposta"
                                onClick={async () => { if (!window.confirm("Excluir esta resposta?")) return; try { await excluir.mutateAsync(x.id); } catch (e: any) { toast.error(e?.message ?? "Não deu."); } }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AcessoGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
