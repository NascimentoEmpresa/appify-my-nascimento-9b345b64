import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Eye, Loader2, Pause, Play, Plus, SkipBack, SkipForward, Tv } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { MENU_TVS, useTvVisualizar, type TvPlaylist } from "@/hooks/useTvs";
import type { FiltroTv, TelaTv } from "@/lib/tv/tv";
import { MENU_VISUALIZAR_TVS, playlistsDaLista, resumoPlaylist } from "@/lib/tv/visualizarTvs";
import { QuadroTv, nomeDoItem, useTocadorPrevia } from "./Tvs";

// =====================================================================
// TV's › VISUALIZAR TVs (20/11/2026, mig 20261120200000)
//
// Pablo: "uma tela onde os gestores acompanhem o que está passando em cada
// TV, cada um vendo só as TVs liberadas para ele". Só para ASSISTIR: editar
// playlist continua em Sistemas › TV's — o "Nova playlist" só leva para lá
// e só aparece para quem pode incluir lá (sistemas_tvs).
//
// A prévia é a MESMA da gestão (QuadroTv + useTocadorPrevia de Tvs.tsx, o
// player /tv/previa num iframe Full HD reduzido), com o filtro global
// (TV_CONFIG) por cima. O relatório vem por tv_visualizar_relatorio
// (item.via_visualizar), que cobra a liberação da playlist, não a gestão.
// Liberação: tvs_visualizar + (tvs_visualizar_todas OU o menu da playlist) —
// regra em src/lib/tv/visualizarTvs.ts, decidida no banco.
// =====================================================================

const SEM_PLAYLISTS: TvPlaylist[] = [];

export default function TvsVisualizar() {
  return (
    <AcessoGate menu={MENU_VISUALIZAR_TVS} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const dados = useTvVisualizar();
  const [params, setParams] = useSearchParams();
  const todas = dados.data?.playlists ?? SEM_PLAYLISTS;
  const lista = useMemo(() => playlistsDaLista(dados.data?.playlists ?? []), [dados.data]);
  const sel = lista.find((p) => p.id === params.get("playlist")) ?? lista[0] ?? null;
  const escolher = (id: string) => setParams((p) => { p.set("playlist", id); return p; }, { replace: true });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Tv className="h-5 w-5" /></span>
        <span className="h-9 w-px shrink-0 bg-border" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold tracking-tight sm:text-2xl">{sel?.nome ?? "Visualizar TVs"}</h1>
          <p className="text-sm text-muted-foreground">Gerenciamento e prévia da playlist</p>
        </div>
      </div>

      {dados.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>
      ) : dados.error ? (
        <Card className="p-6 text-sm text-destructive">Não foi possível carregar as TVs: {(dados.error as Error).message}</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit p-2">
            <div className="space-y-1">
              {lista.map((p) => (
                <button key={p.id} type="button" onClick={() => escolher(p.id)}
                  className={`w-full rounded-md border-2 px-3 py-2 text-left text-sm transition ${sel?.id === p.id ? "border-foreground bg-primary/5 font-semibold" : "border-transparent hover:bg-muted"}`}>
                  <p className="truncate">{p.nome}</p>
                  <p className="text-[11px] font-normal text-muted-foreground">{resumoPlaylist(p)}</p>
                </button>
              ))}
              {lista.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">
                  Nenhuma TV liberada para você. A liberação é por TV, em Administração › Acesso por Usuário (módulo TV's › Visualizar TVs).
                </p>
              )}
            </div>
            <AcessoGate menu={MENU_TVS} acao="incluir">
              <Button asChild size="sm" variant="outline" className="mt-2 w-full">
                <Link to="/app/sistemas/tvs?tab=playlists"><Plus className="mr-1 h-4 w-4" /> Nova playlist</Link>
              </Button>
            </AcessoGate>
          </Card>
          {sel ? <Previa key={sel.id} p={sel} playlists={todas} filtro={dados.data?.filtro ?? null} />
            : <Card className="p-8 text-center text-sm text-muted-foreground">Escolha uma TV à esquerda para ver o que está passando.</Card>}
        </div>
      )}
    </div>
  );
}

function Previa({ p, playlists, filtro }: { p: TvPlaylist; playlists: TvPlaylist[]; filtro: FiltroTv | null }) {
  const { itens, idx, ir, proximo, tocando, setTocando, tela: base, onFim } = useTocadorPrevia(p, playlists, null);
  // Relatório pela liberação da playlist (via_visualizar) e o filtro global como na TV.
  const tela = useMemo<TelaTv>(() => {
    const chave = `${base.chave}|${filtro ?? ""}`;
    return base.modo === "item" ? { ...base, chave, filtro, item: { ...base.item, via_visualizar: true } } : { ...base, chave, filtro };
  }, [base, filtro]);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-background"><Eye className="h-3.5 w-3.5" /> Prévia</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">como fica depois de atualizar</span>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={itens.length < 2} onClick={() => ir(idx - 1)} title="Item anterior"><SkipBack className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={itens.length < 2} onClick={() => setTocando((x) => !x)} title={tocando ? "Pausar a prévia" : "Tocar a prévia"}>
          {tocando ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={itens.length < 2} onClick={proximo} title="Próximo item"><SkipForward className="h-4 w-4" /></Button>
      </div>
      <div className="rounded-xl border bg-card p-2 shadow-[4px_4px_0_0_hsl(var(--foreground)/0.85)]">
        <QuadroTv tela={tela} rotulo={`Prévia — ${p.nome}`} onFim={onFim} />
      </div>
      {itens.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {itens.map((i, n) => (
            <button key={`${i.id}-${n}`} type="button" onClick={() => ir(n)} title={nomeDoItem(i)}
              className={`max-w-[180px] truncate rounded border px-1.5 py-0.5 text-[10px] transition ${n === idx ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>
              {n + 1}. {nomeDoItem(i)} · {i.tipo === "video" ? "vídeo" : `${i.duracao_seg}s`}
            </button>
          ))}
        </div>
      ) : <p className="text-[11px] text-muted-foreground">Playlist vazia: a TV mostra o relógio.</p>}
    </Card>
  );
}
