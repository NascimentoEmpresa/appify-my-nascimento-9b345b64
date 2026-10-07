import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, Copy, Eye, EyeOff, Image as ImageIcon, Link2, ListVideo, Loader2, Megaphone, MonitorPlay, Power,
  Pause, Play, Plus, RefreshCw, Trash2, Tv, Type, Upload, Video, Clapperboard, Globe,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useAuth } from "@/hooks/useAuth";
import { useContratosRelatorio } from "@/hooks/useRelatoriosDiretoria";
import {
  MENU_TVS, enviarMidia, urlMidia, useAtualizarTv, useGerarLinkTv, useCriarAlerta, useEncerrarAlerta, useExcluirItem, useExcluirPlaylist,
  useMoverItem, useParearTv, useRecarregarTv, useRemoverTv, useSalvarItem, useSalvarPlaylist, useTvAlertas, useTvDispositivos,
  useTvPlaylists, type TvDispositivo, type TvItem, type TvPlaylist,
} from "@/hooks/useTvs";
import {
  PERIODOS_TV, RELATORIOS_TV, TIPOS_ITEM, corAviso, duracaoTotal, haQuanto, rotuloPeriodoTv, statusTv, tituloRelatorioTv, urlValida, youtubeEmbed,
  type TipoItem,
} from "@/lib/tv/tv";

// =====================================================================
// SISTEMAS › TV's (07/10/2026, mig 20261007000012)
//
// "Um módulo pra conectar TODAS as TVs da empresa no ERP e controlar tudo o
// que passa nelas." Três abas:
//   · TVs — as TVs conectadas (online/offline pelo ping de 15 s), playlist
//     de cada uma, recarregar à distância, pausar, remover. "Adicionar TV"
//     pareia pelo código de 6 dígitos que a TV mostra em <app>/tv;
//   · Playlists — o que passa: imagem, vídeo, aviso em texto, YouTube e
//     página web, com duração, validade e ordem;
//   · Aviso geral — texto que cobre a tela de todas (ou algumas) TVs até
//     a hora escolhida.
// 07/10/2026 (mig 20261007000014): item "Relatório do ERP" (qual relatório,
// período e contrato — tela cheia na TV) e LINK FIXO por TV (<app>/tv/<chave>)
// para a TV abrir já conectada ao ligar, com o guia do app de quiosque.
// Liberação: sistemas_tvs (Acesso por Usuário). Regras em src/lib/tv/tv.ts.
// =====================================================================

const ICONE: Record<TipoItem, typeof ImageIcon> = { imagem: ImageIcon, video: Video, aviso: Type, youtube: Clapperboard, url: Globe, relatorio: BarChart3 };
const fmtDataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const urlPlayer = () => `${window.location.origin}/tv`;

export default function Tvs() {
  const tvs = useTvDispositivos();
  const playlists = useTvPlaylists();
  const online = (tvs.data ?? []).filter((t) => statusTv(t.ultimo_ping) === "online").length;

  return (
    <div className="space-y-4">
      <PageHeader title="TV's" subtitle="Tudo o que passa nas TVs da empresa: conexão, playlists e avisos" module="Sistemas" breadcrumb={["TV's"]} />
      <AcessoGate menu={MENU_TVS} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
        <Tabs defaultValue="tvs">
          <TabsList>
            <TabsTrigger value="tvs" className="gap-1.5"><Tv className="h-4 w-4" /> TVs {tvs.data && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{online}/{tvs.data.length} online</Badge>}</TabsTrigger>
            <TabsTrigger value="playlists" className="gap-1.5"><ListVideo className="h-4 w-4" /> Playlists</TabsTrigger>
            <TabsTrigger value="aviso" className="gap-1.5"><Megaphone className="h-4 w-4" /> Aviso geral</TabsTrigger>
          </TabsList>
          <TabsContent value="tvs"><AbaTvs tvs={tvs.data ?? []} carregando={tvs.isLoading} playlists={playlists.data ?? []} /></TabsContent>
          <TabsContent value="playlists"><AbaPlaylists playlists={playlists.data ?? []} carregando={playlists.isLoading} tvs={tvs.data ?? []} /></TabsContent>
          <TabsContent value="aviso"><AbaAviso tvs={tvs.data ?? []} /></TabsContent>
        </Tabs>
      </AcessoGate>
    </div>
  );
}

// ---- TVs ---------------------------------------------------------------------

function AbaTvs({ tvs, carregando, playlists }: { tvs: TvDispositivo[]; carregando: boolean; playlists: TvPlaylist[] }) {
  const [adicionando, setAdicionando] = useState(false);
  const [linkDe, setLinkDe] = useState<TvDispositivo | null>(null);
  const atualizar = useAtualizarTv();
  const recarregar = useRecarregarTv();
  const remover = useRemoverTv();
  const salvar = async (id: string, patch: Parameters<typeof atualizar.mutateAsync>[0]["patch"], msg: string) => {
    try { await atualizar.mutateAsync({ id, patch }); toast.success(msg); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <MonitorPlay className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          <b className="text-foreground">Como conectar uma TV:</b> no navegador da TV (Smart TV, Fire TV Stick, Chromecast ou mini PC) abra
          {" "}<span className="font-mono text-foreground">{urlPlayer()}</span>. Vai aparecer um código de 6 dígitos — clique em <b className="text-foreground">Adicionar TV</b> e digite.
          Na TV, dois cliques deixam em tela cheia.
        </div>
        <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(urlPlayer()).then(() => toast.success("Endereço copiado."))}><Copy className="mr-1 h-3.5 w-3.5" /> Copiar endereço</Button>
        <AcessoGate menu={MENU_TVS} acao="incluir">
          <Button size="sm" onClick={() => setAdicionando(true)}><Plus className="mr-1 h-4 w-4" /> Adicionar TV</Button>
        </AcessoGate>
        {tvs.length > 1 && (
          <AcessoGate menu={MENU_TVS} acao="alterar">
            <Button size="sm" variant="ghost" disabled={recarregar.isPending}
              onClick={() => window.confirm(`Recarregar as ${tvs.length} TVs?`) && recarregar.mutateAsync(tvs.map((t) => t.id)).then(() => toast.success("Comando enviado — as TVs recarregam em até 15 s."))}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Recarregar todas
            </Button>
          </AcessoGate>
        )}
      </Card>

      {carregando ? <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>
        : tvs.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma TV conectada ainda. Abra o endereço acima numa TV e clique em <b>Adicionar TV</b>.</Card>
        : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr><th className="px-4 py-2 font-medium">TV</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Playlist</th><th className="px-3 py-2 font-medium">Tela</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody>
                {tvs.map((t) => {
                  const st = statusTv(t.ultimo_ping);
                  return (
                    <tr key={t.id} className="border-t align-middle">
                      <td className="px-4 py-2">
                        <p className="font-semibold">{t.nome}</p>
                        <p className="text-xs text-muted-foreground">{t.local ?? "—"}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className={`h-2.5 w-2.5 rounded-full ${st === "online" ? "bg-success" : "bg-muted-foreground/40"}`} />
                          <b>{st === "online" ? "Online" : "Offline"}</b>
                          {!t.ativo && <Badge variant="outline" className="ml-1 text-[10px]">pausada</Badge>}
                        </span>
                        <p className="text-[11px] text-muted-foreground">visto {haQuanto(t.ultimo_ping)}</p>
                      </td>
                      <td className="px-3 py-2">
                        <AcessoGate menu={MENU_TVS} acao="alterar" fallback={<span className="text-xs">{playlists.find((p) => p.id === t.playlist_id)?.nome ?? "—"}</span>}>
                          <Select value={t.playlist_id ?? "__"} onValueChange={(v) => salvar(t.id, { playlist_id: v === "__" ? null : v }, `Playlist de ${t.nome} trocada.`)}>
                            <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__">Sem playlist (relógio)</SelectItem>
                              {playlists.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </AcessoGate>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{t.tela ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <AcessoGate menu={MENU_TVS} acao="alterar">
                          <Button size="sm" variant="ghost" className="h-8 text-xs" title="Endereço fixo desta TV, para ela abrir já conectada ao ligar" onClick={() => setLinkDe(t)}><Link2 className="mr-1 h-3.5 w-3.5" /> Link fixo</Button>
                          <Button size="icon" variant="ghost" title="Recarregar a TV" onClick={() => recarregar.mutateAsync([t.id]).then(() => toast.success(`${t.nome} recarrega em até 15 s.`))}><RefreshCw className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" title={t.ativo ? "Pausar (mostra só o nome)" : "Voltar a tocar"} onClick={() => salvar(t.id, { ativo: !t.ativo }, t.ativo ? `${t.nome} pausada.` : `${t.nome} voltou a tocar.`)}>
                            {t.ativo ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </Button>
                        </AcessoGate>
                        <AcessoGate menu={MENU_TVS} acao="excluir">
                          <Button size="icon" variant="ghost" className="text-destructive" title="Remover a TV (ela volta a pedir código)"
                            onClick={() => window.confirm(`Remover ${t.nome}? Ela volta a mostrar um código para ser conectada de novo.`) && remover.mutateAsync(t.id).then(() => toast.success("TV removida."))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AcessoGate>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      <GuiaAutomatico />
      <DialogAdicionar aberto={adicionando} onClose={() => setAdicionando(false)} playlists={playlists} />
      <DialogLinkFixo tv={linkDe} onClose={() => setLinkDe(null)} />
    </div>
  );
}

function DialogLinkFixo({ tv, onClose }: { tv: TvDispositivo | null; onClose: () => void }) {
  const gerar = useGerarLinkTv();
  const [chave, setChave] = useState<string | null>(null);
  const fechar = () => { setChave(null); onClose(); };
  const url = chave ? `${urlPlayer()}/${chave}` : "";
  const criar = async () => {
    if (!tv) return;
    try { setChave(await gerar.mutateAsync(tv.id)); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={!!tv} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Link fixo — {tv?.nome}</DialogTitle></DialogHeader>
        {!chave ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>O link fixo é o endereço desta TV. Coloque-o como <b className="text-foreground">página inicial</b> do navegador da TV (ou no app de quiosque): ao ligar, ela abre <b className="text-foreground">já conectada</b>, sem código, mesmo que o navegador tenha apagado tudo.</p>
            <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">Gerar um link novo <b>desliga o anterior</b> — se esta TV já usa um link fixo, ela vai pedir o novo.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Digite na TV exatamente assim:</p>
            <div className="rounded-lg border bg-muted/40 p-3 text-center font-mono text-lg font-bold break-all">{url}</div>
            <p className="text-center text-xs text-muted-foreground">Chave: <span className="font-mono text-base font-bold tracking-widest text-foreground">{chave.slice(0, 4)} {chave.slice(4, 8)} {chave.slice(8)}</span> (sem 0, O, 1 ou I — não tem como confundir)</p>
            <Button variant="outline" className="w-full" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success("Link copiado."))}><Copy className="mr-1 h-4 w-4" /> Copiar link</Button>
            <p className="text-[11px] text-muted-foreground">Guarde o link: por segurança ele só aparece agora. Se perder, gere outro.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>{chave ? "Pronto" : "Cancelar"}</Button>
          {!chave && <Button disabled={gerar.isPending} onClick={criar}><Link2 className="mr-1 h-4 w-4" /> Gerar link fixo</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Como deixar a TV ligando e conectando sozinha (pedido de 07/10/2026). */
function GuiaAutomatico() {
  return (
    <Card className="space-y-2 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold"><Power className="h-4 w-4 text-primary" /> Deixar a TV 100% automática (liga, abre e conecta sozinha)</p>
      <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
        <li><b className="text-foreground">Melhor opção — Android TV / Fire TV Stick / TV Box:</b> instale o app <b className="text-foreground">Fully Kiosk Browser</b> (Play Store / Amazon Appstore). Em <i>Settings › Web Content</i>, ponha o <b className="text-foreground">Link fixo</b> desta TV como <i>Start URL</i>; em <i>Device Management</i> ligue <i>Launch on Boot</i> e <i>Keep Screen On</i>; em <i>Web Auto Reload</i> ligue <i>Reload on Network Reconnect</i>. A TV ligou → o app abre sozinho na tela da TV, em tela cheia.</li>
        <li><b className="text-foreground">Smart TV sem app (Samsung/LG):</b> abra o navegador da TV no Link fixo e salve como <b className="text-foreground">página inicial</b>. Nas configurações da TV, desligue <i>Desligamento automático / Eco / Economia de energia</i> — é isso que costuma desligar a TV sozinha depois de algumas horas.</li>
        <li><b className="text-foreground">Ligar e desligar no horário:</b> use o <i>Timer de ligar/desligar</i> da própria TV (Configurações › Geral › Hora). Com Fire TV/TV Box ligado em HDMI-CEC, a TV também liga junto com o aparelho.</li>
        <li>Se a TV perder a internet, ela tenta de novo sozinha e <b className="text-foreground">recarrega depois de 3 min sem conexão</b>; uma vez por dia, de madrugada, faz uma recarga limpa.</li>
      </ol>
    </Card>
  );
}

function DialogAdicionar({ aberto, onClose, playlists }: { aberto: boolean; onClose: () => void; playlists: TvPlaylist[] }) {
  const parear = useParearTv();
  const [f, setF] = useState({ codigo: "", nome: "", local: "", playlist: "__" });
  const fechar = () => { setF({ codigo: "", nome: "", local: "", playlist: "__" }); onClose(); };
  const enviar = async () => {
    try {
      await parear.mutateAsync({ codigo: f.codigo, nome: f.nome, local: f.local, playlistId: f.playlist === "__" ? null : f.playlist });
      toast.success(`${f.nome} conectada — em até 15 s ela começa a tocar.`); fechar();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Adicionar TV</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Código que aparece na TV *</Label>
            <Input inputMode="numeric" maxLength={7} value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="000000" className="text-center font-mono text-2xl tracking-[0.3em]" /></div>
          <div><Label className="text-xs">Nome *</Label><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: TV Recepção" /></div>
          <div><Label className="text-xs">Local</Label><Input value={f.local} onChange={(e) => setF({ ...f, local: e.target.value })} placeholder="Ex.: HAGG — recepção, 1º andar" /></div>
          <div><Label className="text-xs">Playlist</Label>
            <Select value={f.playlist} onValueChange={(v) => setF({ ...f, playlist: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">Sem playlist por enquanto (mostra o relógio)</SelectItem>
                {playlists.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button disabled={parear.isPending || f.codigo.length !== 6 || f.nome.trim().length < 2} onClick={enviar}><Tv className="mr-1 h-4 w-4" /> Conectar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Playlists ---------------------------------------------------------------

function AbaPlaylists({ playlists, carregando, tvs }: { playlists: TvPlaylist[]; carregando: boolean; tvs: TvDispositivo[] }) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = playlists.find((p) => p.id === selId) ?? playlists[0] ?? null;
  const salvar = useSalvarPlaylist();
  const excluir = useExcluirPlaylist();

  const nova = async () => {
    const nome = window.prompt("Nome da nova playlist (ex.: Recepção, Refeitório):")?.trim();
    if (!nome) return;
    try { await salvar.mutateAsync({ nome }); toast.success("Playlist criada."); } catch (e) { toast.error((e as Error).message); }
  };
  const renomear = async (p: TvPlaylist) => {
    const nome = window.prompt("Novo nome:", p.nome)?.trim();
    if (!nome || nome === p.nome) return;
    try { await salvar.mutateAsync({ id: p.id, nome }); } catch (e) { toast.error((e as Error).message); }
  };
  const apagar = async (p: TvPlaylist) => {
    const usando = tvs.filter((t) => t.playlist_id === p.id).length;
    if (!window.confirm(`Excluir a playlist ${p.nome}?${usando ? ` ${usando} TV(s) ficam sem playlist (mostram o relógio).` : ""}`)) return;
    try { await excluir.mutateAsync(p.id); setSelId(null); toast.success("Playlist excluída."); } catch (e) { toast.error((e as Error).message); }
  };

  if (carregando) return <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit p-2">
        <div className="space-y-1">
          {playlists.map((p) => {
            const usando = tvs.filter((t) => t.playlist_id === p.id).length;
            return (
              <button key={p.id} type="button" onClick={() => setSelId(p.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${sel?.id === p.id ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>
                <p className="truncate">{p.nome}</p>
                <p className="text-[11px] font-normal text-muted-foreground">{p.itens.filter((i) => i.ativo).length} itens · {usando} TV{usando === 1 ? "" : "s"}</p>
              </button>
            );
          })}
          {playlists.length === 0 && <p className="p-3 text-xs text-muted-foreground">Nenhuma playlist ainda.</p>}
        </div>
        <AcessoGate menu={MENU_TVS} acao="incluir">
          <Button size="sm" variant="outline" className="mt-2 w-full" onClick={nova}><Plus className="mr-1 h-4 w-4" /> Nova playlist</Button>
        </AcessoGate>
      </Card>
      {sel ? <EditorPlaylist key={sel.id} p={sel} onRenomear={() => renomear(sel)} onExcluir={() => apagar(sel)} />
        : <Card className="p-8 text-center text-sm text-muted-foreground">Crie uma playlist para escolher o que passa nas TVs.</Card>}
    </div>
  );
}

function EditorPlaylist({ p, onRenomear, onExcluir }: { p: TvPlaylist; onRenomear: () => void; onExcluir: () => void }) {
  const salvarItem = useSalvarItem();
  const excluirItem = useExcluirItem();
  const mover = useMoverItem();
  const ativos = p.itens.filter((i) => i.ativo);

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="mr-auto">
          <p className="font-semibold">{p.nome}</p>
          <p className="text-xs text-muted-foreground">{ativos.length} itens ativos · uma volta leva cerca de {duracaoTotal(ativos)}</p>
        </div>
        <AcessoGate menu={MENU_TVS} acao="alterar"><Button size="sm" variant="ghost" onClick={onRenomear}>Renomear</Button></AcessoGate>
        <AcessoGate menu={MENU_TVS} acao="excluir"><Button size="sm" variant="ghost" className="text-destructive" onClick={onExcluir}><Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir</Button></AcessoGate>
      </Card>

      <Card className="overflow-hidden p-0">
        {p.itens.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Playlist vazia — adicione o primeiro item abaixo.</p> : (
          <ul>
            {p.itens.map((i, n) => {
              const Ic = ICONE[i.tipo];
              const fora = (i.valido_ate && new Date(i.valido_ate) < new Date()) || (i.valido_de && new Date(i.valido_de) > new Date());
              return (
                <li key={i.id} className={`flex items-center gap-3 border-t px-3 py-2 first:border-t-0 ${i.ativo && !fora ? "" : "opacity-50"}`}>
                  <Miniatura item={i} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium"><Ic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{i.titulo || (i.tipo === "relatorio" ? `${tituloRelatorioTv(i.relatorio)} · ${rotuloPeriodoTv(i.rel_periodo)}` : null) || i.texto || i.url || TIPOS_ITEM.find((t) => t.valor === i.tipo)?.rotulo}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {i.tipo === "video" ? "toca até o fim" : `${i.duracao_seg} s`}
                      {(i.valido_de || i.valido_ate) && <> · {i.valido_de ? `de ${fmtDataHora(i.valido_de)}` : ""} {i.valido_ate ? `até ${fmtDataHora(i.valido_ate)}` : ""}</>}
                      {fora && <b className="text-warning"> · fora da validade</b>}
                    </p>
                  </div>
                  <AcessoGate menu={MENU_TVS} acao="alterar">
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={n === 0} onClick={() => mover.mutate({ a: i, b: p.itens[n - 1] })}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={n === p.itens.length - 1} onClick={() => mover.mutate({ a: i, b: p.itens[n + 1] })}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title={i.ativo ? "Tirar da TV (sem apagar)" : "Voltar a passar"} onClick={() => salvarItem.mutate({ id: i.id, item: { ativo: !i.ativo } })}>
                      {i.ativo ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </Button>
                  </AcessoGate>
                  <AcessoGate menu={MENU_TVS} acao="excluir">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => window.confirm("Excluir este item?") && excluirItem.mutateAsync(i).then(() => toast.success("Item excluído."))}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </AcessoGate>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <AcessoGate menu={MENU_TVS} acao="incluir"><NovoItem playlistId={p.id} proximaOrdem={(p.itens.at(-1)?.ordem ?? 0) + 10} /></AcessoGate>
    </div>
  );
}

function Miniatura({ item }: { item: TvItem }) {
  const cls = "h-12 w-20 shrink-0 overflow-hidden rounded border bg-muted";
  if (item.tipo === "imagem" && item.arquivo) return <img src={urlMidia(item.arquivo)} alt="" className={`${cls} object-cover`} loading="lazy" />;
  if (item.tipo === "video" && item.arquivo) return <video src={urlMidia(item.arquivo)} className={`${cls} object-cover`} muted preload="metadata" />;
  if (item.tipo === "relatorio") return <div className={`${cls} flex flex-col items-center justify-center bg-[#0b1220] p-1 text-center text-[8px] font-bold leading-tight text-white`}><BarChart3 className="mb-0.5 h-3.5 w-3.5 text-blue-400" />{tituloRelatorioTv(item.relatorio).slice(0, 24)}</div>;
  if (item.tipo === "aviso") return <div className={`${cls} flex items-center justify-center p-1 text-center text-[8px] font-bold leading-tight text-white`} style={{ background: corAviso(item.cor) }}>{(item.texto ?? "").slice(0, 40)}</div>;
  const Ic = ICONE[item.tipo];
  return <div className={`${cls} flex items-center justify-center`}><Ic className="h-5 w-5 text-muted-foreground" /></div>;
}

const VAZIO = { tipo: "relatorio" as TipoItem, titulo: "", url: "", texto: "", cor: "#1d4ed8", duracao: "30", de: "", ate: "", relatorio: "geral", periodo: "12m", contrato: "" };

function NovoItem({ playlistId, proximaOrdem }: { playlistId: string; proximaOrdem: number }) {
  const salvar = useSalvarItem();
  const { data: contratos = [] } = useContratosRelatorio();
  const [f, setF] = useState(VAZIO);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const precisaArquivo = f.tipo === "imagem" || f.tipo === "video";
  const dica = TIPOS_ITEM.find((t) => t.valor === f.tipo)?.dica;

  const invalido = useMemo(() => {
    if (precisaArquivo && !arquivo) return "Escolha o arquivo.";
    if (f.tipo === "url" && !urlValida(f.url)) return "Informe um endereço começando com http:// ou https://";
    if (f.tipo === "youtube" && !youtubeEmbed(f.url)) return "Cole o link de um vídeo do YouTube.";
    if (f.tipo === "aviso" && !f.texto.trim()) return "Escreva o texto do aviso.";
    const d = Number(f.duracao);
    if (f.tipo !== "video" && (!Number.isInteger(d) || d < 3 || d > 3600)) return "Duração entre 3 e 3600 segundos.";
    if (f.de && f.ate && new Date(f.ate) <= new Date(f.de)) return "A validade termina antes de começar.";
    return null;
  }, [f, arquivo, precisaArquivo]);

  const adicionar = async () => {
    if (invalido) return toast.error(invalido);
    setEnviando(true);
    try {
      const caminho = precisaArquivo && arquivo ? await enviarMidia(playlistId, arquivo) : null;
      await salvar.mutateAsync({ item: {
        playlist_id: playlistId, ordem: proximaOrdem, tipo: f.tipo, titulo: f.titulo.trim() || null,
        url: f.tipo === "url" || f.tipo === "youtube" ? f.url.trim() : null, arquivo: caminho,
        texto: f.tipo === "aviso" ? f.texto.trim() : null, cor: f.tipo === "aviso" ? f.cor : null,
        relatorio: f.tipo === "relatorio" ? f.relatorio : null, rel_periodo: f.tipo === "relatorio" ? f.periodo : null,
        rel_contrato: f.tipo === "relatorio" && f.contrato ? f.contrato : null,
        duracao_seg: f.tipo === "video" ? 15 : Number(f.duracao),
        valido_de: f.de ? new Date(f.de).toISOString() : null, valido_ate: f.ate ? new Date(f.ate).toISOString() : null,
      } });
      toast.success("Item adicionado — as TVs pegam na próxima consulta (até 15 s).");
      setF({ ...VAZIO, tipo: f.tipo }); setArquivo(null); if (inputRef.current) inputRef.current.value = "";
    } catch (e) { toast.error((e as Error).message); } finally { setEnviando(false); }
  };

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-semibold">Adicionar à playlist</p>
      <div className="flex flex-wrap gap-1.5">
        {TIPOS_ITEM.map((t) => {
          const Ic = ICONE[t.valor];
          return (
            <button key={t.valor} type="button" onClick={() => { setF({ ...f, tipo: t.valor }); setArquivo(null); }}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${f.tipo === t.valor ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>
              <Ic className="h-3.5 w-3.5" /> {t.rotulo}
            </button>
          );
        })}
      </div>
      {dica && <p className="text-[11px] text-muted-foreground">{dica}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label className="text-xs">Título (opcional)</Label><Input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Só para identificar na lista" /></div>
        {f.tipo !== "video" && (
          <div><Label className="text-xs">Tempo na tela (segundos)</Label><Input type="number" min={3} max={3600} value={f.duracao} onChange={(e) => setF({ ...f, duracao: e.target.value })} /></div>
        )}
        {precisaArquivo && (
          <div className="sm:col-span-2"><Label className="text-xs">Arquivo *</Label>
            <Input ref={inputRef} type="file" accept={f.tipo === "imagem" ? "image/jpeg,image/png,image/webp,image/gif" : "video/mp4,video/webm"} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            <p className="mt-1 text-[11px] text-muted-foreground">Fica num armazenamento público (a TV não tem login) — não suba nada sigiloso. Até 200 MB.</p></div>
        )}
        {(f.tipo === "url" || f.tipo === "youtube") && (
          <div className="sm:col-span-2"><Label className="text-xs">{f.tipo === "youtube" ? "Link do vídeo *" : "Endereço *"}</Label>
            <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder={f.tipo === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://…"} /></div>
        )}
        {f.tipo === "relatorio" && (
          <>
            <div><Label className="text-xs">Relatório *</Label>
              <Select value={f.relatorio} onValueChange={(v) => setF({ ...f, relatorio: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RELATORIOS_TV.map((r) => <SelectItem key={r.slug} value={r.slug}>{r.titulo}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label className="text-xs">Período</Label>
              <Select value={f.periodo} onValueChange={(v) => setF({ ...f, periodo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PERIODOS_TV.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="sm:col-span-2"><Label className="text-xs">Contrato (opcional)</Label>
              <Select value={f.contrato || "__"} onValueChange={(v) => setF({ ...f, contrato: v === "__" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__">Todos os contratos</SelectItem>
                  {contratos.filter((c) => !c.encerrado).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">Ex.: na TV do contrato UFRGS, só os números da UFRGS. Os números se atualizam sozinhos.</p></div>
          </>
        )}
        {f.tipo === "aviso" && (
          <>
            <div className="sm:col-span-2"><Label className="text-xs">Texto *</Label><Textarea rows={3} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} placeholder="Ex.: Reunião geral sexta às 9h no auditório" /></div>
            <div><Label className="text-xs">Cor de fundo</Label>
              <div className="flex items-center gap-2"><input type="color" value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} className="h-9 w-14 cursor-pointer rounded border" />
                <div className="flex-1 truncate rounded px-2 py-1.5 text-center text-xs font-bold text-white" style={{ background: corAviso(f.cor) }}>{f.texto.slice(0, 40) || "prévia"}</div></div></div>
          </>
        )}
        <div><Label className="text-xs">Passa a partir de (opcional)</Label><Input type="datetime-local" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></div>
        <div><Label className="text-xs">Para de passar em (opcional)</Label><Input type="datetime-local" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></div>
      </div>
      <div className="flex justify-end">
        <Button disabled={enviando} onClick={adicionar}>{enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : precisaArquivo ? <Upload className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />} Adicionar</Button>
      </div>
    </Card>
  );
}

// ---- Aviso geral --------------------------------------------------------------

function AbaAviso({ tvs }: { tvs: TvDispositivo[] }) {
  const { user } = useAuth();
  const alertas = useTvAlertas();
  const criar = useCriarAlerta();
  const encerrar = useEncerrarAlerta();
  const [f, setF] = useState({ texto: "", cor: "#dc2626", minutos: "30", todas: true, escolhidas: [] as string[] });
  const agora = Date.now();
  const ativos = (alertas.data ?? []).filter((a) => !a.encerrado_em && new Date(a.fim).getTime() > agora && new Date(a.inicio).getTime() <= agora);
  const historico = (alertas.data ?? []).filter((a) => !ativos.includes(a));

  const enviar = async () => {
    const min = Number(f.minutos);
    if (!f.texto.trim()) return toast.error("Escreva o aviso.");
    if (!Number.isInteger(min) || min < 1 || min > 1440) return toast.error("Duração entre 1 e 1440 minutos.");
    if (!f.todas && f.escolhidas.length === 0) return toast.error("Escolha pelo menos uma TV.");
    try {
      await criar.mutateAsync({ texto: f.texto.trim(), cor: f.cor, fim: new Date(Date.now() + min * 60_000).toISOString(), todas: f.todas, dispositivos: f.escolhidas,
                               autor: (user?.user_metadata?.display_name as string) || user?.email || "" });
      toast.success("Aviso no ar — as TVs mostram em até 15 s."); setF({ ...f, texto: "" });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AcessoGate menu={MENU_TVS} acao="incluir" fallback={<Card className="p-6 text-sm text-muted-foreground">Você pode ver os avisos, mas não enviar.</Card>}>
        <Card className="space-y-3 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-destructive" /> Novo aviso geral</p>
          <p className="text-xs text-muted-foreground">Cobre a tela inteira das TVs por cima da playlist, até acabar o tempo ou alguém encerrar.</p>
          <Textarea rows={4} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} placeholder="Ex.: Simulado de incêndio às 15h — siga as orientações da brigada" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-xs">Fica no ar por (minutos)</Label><Input type="number" min={1} max={1440} value={f.minutos} onChange={(e) => setF({ ...f, minutos: e.target.value })} /></div>
            <div><Label className="text-xs">Cor</Label><div className="flex items-center gap-2"><input type="color" value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} className="h-9 w-14 cursor-pointer rounded border" />
              <div className="flex-1 truncate rounded px-2 py-1.5 text-center text-xs font-bold text-white" style={{ background: corAviso(f.cor) }}>{f.texto.slice(0, 30) || "prévia"}</div></div></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.todas} onCheckedChange={(v) => setF({ ...f, todas: v })} /> Todas as TVs</label>
          {!f.todas && (
            <div className="flex flex-wrap gap-1.5">
              {tvs.map((t) => {
                const marcada = f.escolhidas.includes(t.id);
                return <button key={t.id} type="button" onClick={() => setF({ ...f, escolhidas: marcada ? f.escolhidas.filter((x) => x !== t.id) : [...f.escolhidas, t.id] })}
                  className={`rounded-full border px-3 py-1 text-xs ${marcada ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>{t.nome}</button>;
              })}
              {tvs.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma TV conectada.</p>}
            </div>
          )}
          <div className="flex justify-end"><Button variant="destructive" disabled={criar.isPending} onClick={enviar}><Megaphone className="mr-1 h-4 w-4" /> Colocar no ar</Button></div>
        </Card>
      </AcessoGate>

      <div className="space-y-3">
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">No ar agora</p>
          {ativos.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum aviso geral no ar.</p> : ativos.map((a) => (
            <div key={a.id} className="mb-2 flex items-start gap-3 rounded-lg border p-2">
              <div className="h-10 w-2 shrink-0 rounded" style={{ background: corAviso(a.cor) }} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="whitespace-pre-wrap font-medium">{a.texto}</p>
                <p className="text-[11px] text-muted-foreground">{a.todas ? "todas as TVs" : `${a.dispositivos.length} TV(s)`} · até {fmtDataHora(a.fim)} · {a.created_by_nome ?? ""}</p>
              </div>
              <AcessoGate menu={MENU_TVS} acao="alterar"><Button size="sm" variant="outline" onClick={() => encerrar.mutateAsync(a.id).then(() => toast.success("Aviso encerrado."))}>Encerrar</Button></AcessoGate>
            </div>
          ))}
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Últimos avisos</p>
          {historico.length === 0 ? <p className="text-xs text-muted-foreground">Nada ainda.</p> : historico.slice(0, 10).map((a) => (
            <p key={a.id} className="truncate border-t py-1.5 text-xs first:border-t-0"><span className="text-muted-foreground">{fmtDataHora(a.created_at)} · </span>{a.texto}</p>
          ))}
        </Card>
      </div>
    </div>
  );
}
