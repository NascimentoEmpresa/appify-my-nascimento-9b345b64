import { useRef, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { Copy, FileText, Link2, Lock, Move, MoreHorizontal, Pencil, Star, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  LAYOUT, processosDoSetor, responsavelDoSetor, type Estrutura, type LayoutCanvas, type Processo,
} from "@/lib/organograma/estruturaProcessos";
import { Avatar, DefsSetas, IconeSetor, TRACO, cor, seta } from "./visual";

// =====================================================================
// O canvas do Cadastro da Estrutura (mig 20261020000060): o setor escolhido
// no meio, com a cadeia de processos; os setores ligados a ele em cima
// (mandam algo) e embaixo (recebem), cada um com o responsável e o processo
// do outro lado da ligação. Os processos do meio se arrastam (posição vai
// para o rascunho com "Salvar rascunho"); a barra flutuante do processo
// selecionado edita, duplica, liga, exclui. No modo "ligar", o próximo
// clique num processo (do meio ou dos setores ao redor) cria a conexão.
// =====================================================================

const PREFIXO = "org-canvas-";
const W = LAYOUT.larguraProcesso, H = LAYOUT.alturaProcesso;

export interface PropsCanvas {
  e: Estrutura;
  setorId: string;
  layout: LayoutCanvas;
  pos: Record<string, { x: number; y: number }>;
  zoom: number;
  selecionado: string | null;
  ligandoDe: string | null;
  podeEditar: boolean;
  onSelecionar: (id: string | null) => void;
  onMover: (id: string, x: number, y: number) => void;
  onFimArrasto: () => void;
  onClicarProcesso: (id: string) => void;
  onAbrirSetor: (setorId: string) => void;
  onEditar: () => void;
  onDuplicar: () => void;
  onLigar: () => void;
  onExcluir: () => void;
  onAlternarPrincipal: () => void;
  onAlternarTrava: () => void;
}

export function CanvasSetor(p: PropsCanvas) {
  const { e, setorId, layout, pos, zoom } = p;
  const setor = e.setores.find((s) => s.id === setorId)!;
  const meus = processosDoSetor(e, setorId);
  const idsMeus = new Set(meus.map((x) => x.id));
  const resp = responsavelDoSetor(e, setorId);
  const c = cor(setor.cor);
  const arrasto = useRef<{ id: string; x0: number; y0: number; px: number; py: number; moveu: boolean } | null>(null);

  // A moldura do setor abraça os processos onde quer que tenham sido arrastados.
  const pontos = meus.map((x) => pos[x.id]).filter(Boolean);
  const minX = Math.min(layout.centro.x, ...pontos.map((q) => q.x - 24));
  const minY = Math.min(layout.centro.y, ...pontos.map((q) => q.y - 96));
  const maxX = Math.max(layout.centro.x + layout.centro.w, ...pontos.map((q) => q.x + W + 24));
  const maxY = Math.max(layout.centro.y + layout.centro.h, ...pontos.map((q) => q.y + H + 18));
  const moldura = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const largura = Math.max(layout.largura, maxX + LAYOUT.margem);
  const altura = Math.max(layout.altura, maxY + 70 + LAYOUT.alturaSetorLateral + LAYOUT.margem);
  const laterais = layout.laterais.map((l) => l.posicao === "baixo" ? { ...l, y: Math.max(l.y, maxY + 70) } : l);

  // Processo mostrado em cada setor ao redor: o primeiro ligado ao setor do meio.
  const ligadoDoLado = (outroSetorId: string): Processo | null => {
    for (const cx of e.conexoes) {
      const o = e.processos.find((x) => x.id === cx.origem_id), d = e.processos.find((x) => x.id === cx.destino_id);
      if (o && d && idsMeus.has(d.id) && o.setor_id === outroSetorId) return o;
      if (o && d && idsMeus.has(o.id) && d.setor_id === outroSetorId) return d;
    }
    return null;
  };
  const caixaLateral = (l: (typeof laterais)[number]) => ({ x: l.x + 12, y: l.y + 84, w: LAYOUT.larguraSetor - 24, h: 58 });

  // ── Linhas ──
  const linhas: { d: string; cor: string; dash?: string; chave: string }[] = [];
  for (const px of meus) {
    const a = pos[px.id], b = px.proximo_id && pos[px.proximo_id];
    if (!a || !b) continue;
    const y1 = a.y + H / 2, y2 = b.y + H / 2;
    const d = Math.abs(y1 - y2) < 4 && b.x > a.x
      ? `M${a.x + W},${y1} H${b.x - 3}`
      : `M${a.x + W / 2},${a.y + H} V${(a.y + H + b.y) / 2} H${b.x + W / 2} V${b.y - 3}`;
    linhas.push({ d, cor: "#1e293b", chave: `f-${px.id}` });
  }
  laterais.forEach((l) => {
    const caixa = caixaLateral(l);
    const ligs = e.conexoes.filter((cx) => {
      const o = e.processos.find((x) => x.id === cx.origem_id), d = e.processos.find((x) => x.id === cx.destino_id);
      return o && d && ((idsMeus.has(d.id) && o.setor_id === l.setor.id) || (idsMeus.has(o.id) && d.setor_id === l.setor.id));
    });
    ligs.forEach((cx, k) => {
      const meuId = idsMeus.has(cx.destino_id) ? cx.destino_id : cx.origem_id;
      const alvo = pos[meuId];
      if (!alvo) return;
      const t = TRACO[cx.tipo];
      const off = (k - (ligs.length - 1) / 2) * 12;
      const entra = idsMeus.has(cx.destino_id);
      let d: string;
      if (l.posicao === "cima") {
        const x1 = caixa.x + caixa.w / 2 + off, y1 = caixa.y + caixa.h, x2 = alvo.x + W / 2 + off / 2, y2 = moldura.y;
        const ym = y1 + (y2 - y1) * 0.55;
        d = entra ? `M${x1},${y1 + 4} V${ym} H${x2} V${y2 - 3}` : `M${x2},${y2} V${ym} H${x1} V${y1 + 7}`;
      } else {
        const x1 = alvo.x + W / 2 + off / 2, y1 = moldura.y + moldura.h, x2 = caixa.x + caixa.w / 2 + off, y2 = l.y;
        const ym = y1 + (y2 - y1) * 0.5;
        d = entra ? `M${x2},${y2} V${ym} H${x1} V${y1 + 3}` : `M${x1},${y1} V${ym} H${x2} V${y2 - 3}`;
      }
      linhas.push({ d, cor: t.cor, dash: t.dash, chave: `c-${cx.id}` });
    });
  });

  const iniciar = (ev: RPointerEvent, px: Processo) => {
    ev.stopPropagation();
    p.onSelecionar(px.id);
    if (p.ligandoDe) return;
    if (!p.podeEditar || px.bloquear_posicao) return;
    const q = pos[px.id];
    arrasto.current = { id: px.id, x0: ev.clientX, y0: ev.clientY, px: q.x, py: q.y, moveu: false };
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  };
  const mover = (ev: RPointerEvent) => {
    const a = arrasto.current;
    if (!a) return;
    const dx = (ev.clientX - a.x0) / zoom, dy = (ev.clientY - a.y0) / zoom;
    if (Math.abs(dx) + Math.abs(dy) > 3) a.moveu = true;
    if (a.moveu) p.onMover(a.id, Math.max(0, a.px + dx), Math.max(0, a.py + dy));
  };
  const soltar = () => { if (arrasto.current?.moveu) p.onFimArrasto(); arrasto.current = null; };

  return (
    <div style={{ width: largura * zoom, height: altura * zoom }} className="relative">
      <div style={{ width: largura, height: altura, transform: `scale(${zoom})`, transformOrigin: "0 0" }} className="absolute left-0 top-0"
        onPointerDown={() => p.onSelecionar(null)}>
        <svg className="pointer-events-none absolute left-0 top-0" width={largura} height={altura}>
          <DefsSetas prefixo={PREFIXO} />
          {linhas.map((l) => (
            <path key={l.chave} d={l.d} fill="none" stroke={l.cor} strokeWidth={l.dash ? 1.6 : 1.8} strokeDasharray={l.dash} markerEnd={seta(PREFIXO, l.cor)} />
          ))}
        </svg>

        {/* Setores ao redor */}
        {laterais.map((l) => {
          const cl = cor(l.setor.cor);
          const r = responsavelDoSetor(e, l.setor.id);
          const outro = ligadoDoLado(l.setor.id);
          const caixa = caixaLateral(l);
          return (
            <div key={l.setor.id} style={{ left: l.x, top: l.y, width: LAYOUT.larguraSetor, height: LAYOUT.alturaSetorLateral }}
              className={cn("absolute rounded-xl border-2 shadow-sm", cl.borda, cl.fundo)} onPointerDown={(ev) => ev.stopPropagation()}>
              <button className="flex w-full items-center gap-2 px-2.5 pt-2 text-left" title="Abrir este setor no canvas" onClick={() => p.onAbrirSetor(l.setor.id)}>
                <IconeSetor icone={l.setor.icone} corSetor={l.setor.cor} tamanho="sm" />
                <span className="truncate text-[13px] font-bold">{l.setor.nome}</span>
              </button>
              <div className="mt-1.5 flex items-center gap-2 px-2.5">
                <Avatar nome={r?.nome} foto={r?.avatar_url} tamanho={24} />
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-[10.5px] font-semibold uppercase">{r?.nome ?? "—"}</div>
                  <div className="truncate text-[9.5px] text-muted-foreground">{r?.cargo ?? ""}</div>
                </div>
              </div>
              {outro && (
                <button style={{ left: caixa.x - l.x, top: caixa.y - l.y, width: caixa.w, height: caixa.h }}
                  onClick={() => p.onClicarProcesso(outro.id)}
                  className={cn("absolute flex items-center gap-2 rounded-lg border bg-white px-2 text-left shadow-sm hover:border-primary",
                    p.ligandoDe && "ring-2 ring-sky-300")}>
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="line-clamp-2 text-[10.5px] font-medium leading-tight">{outro.nome}</span>
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border bg-white px-1.5 text-[8.5px] text-muted-foreground">{outro.codigo}</span>
                </button>
              )}
            </div>
          );
        })}

        {/* O setor do meio */}
        <div style={{ left: moldura.x, top: moldura.y, width: moldura.w, height: moldura.h }}
          className={cn("absolute rounded-2xl border-2", c.borda)}>
          <div className={cn("absolute inset-0 rounded-2xl", c.fundo)} />
          <div className="relative flex items-center gap-3 px-4 pt-3">
            <IconeSetor icone={setor.icone} corSetor={setor.cor} tamanho="lg" />
            <div className="leading-tight">
              <div className="text-base font-bold">{setor.nome}</div>
              <div className="text-[10.5px] font-semibold uppercase">{resp?.nome ?? "Sem responsável"}</div>
              <div className="text-[10px] text-muted-foreground">{resp?.cargo ?? ""}</div>
            </div>
          </div>
        </div>

        {meus.map((px) => {
          const q = pos[px.id];
          if (!q) return null;
          const sel = p.selecionado === px.id;
          return (
            <div key={px.id} style={{ left: q.x, top: q.y, width: W, height: H }} className="absolute">
              {sel && p.podeEditar && !p.ligandoDe && (
                <div className="absolute -top-10 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-slate-900 px-1.5 py-1 text-white shadow-lg"
                  onPointerDown={(ev) => ev.stopPropagation()}>
                  <BotaoBarra titulo={px.bloquear_posicao ? "Posição travada" : "Arraste o bloco para mover"}>{px.bloquear_posicao ? <Lock className="h-3.5 w-3.5" /> : <Move className="h-3.5 w-3.5" />}</BotaoBarra>
                  <BotaoBarra titulo="Editar propriedades" onClick={p.onEditar}><Pencil className="h-3.5 w-3.5" /></BotaoBarra>
                  <BotaoBarra titulo="Duplicar" onClick={p.onDuplicar}><Copy className="h-3.5 w-3.5" /></BotaoBarra>
                  <BotaoBarra titulo="Ligar a outro processo" onClick={p.onLigar}><Link2 className="h-3.5 w-3.5" /></BotaoBarra>
                  <BotaoBarra titulo="Excluir" onClick={p.onExcluir}><Trash2 className="h-3.5 w-3.5 text-red-400" /></BotaoBarra>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="rounded p-1 hover:bg-white/15" title="Mais"><MoreHorizontal className="h-3.5 w-3.5" /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={p.onAlternarPrincipal}><Star className="mr-2 h-4 w-4" /> {px.principal ? "Tirar dos principais" : "Marcar como principal"}</DropdownMenuItem>
                      <DropdownMenuItem onClick={p.onAlternarTrava}><Lock className="mr-2 h-4 w-4" /> {px.bloquear_posicao ? "Destravar posição" : "Travar posição"}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              <div onPointerDown={(ev) => iniciar(ev, px)} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
                onClick={(ev) => { ev.stopPropagation(); if (p.ligandoDe) p.onClicarProcesso(px.id); }}
                className={cn("flex h-full select-none items-center gap-2 rounded-lg border bg-white px-2.5 shadow-sm transition-shadow",
                  sel ? "border-blue-500 ring-2 ring-blue-200" : "hover:border-slate-400",
                  p.ligandoDe && p.ligandoDe !== px.id && "ring-2 ring-sky-300",
                  px.status === "em_revisao" && "border-amber-300", px.status === "inativo" && "opacity-50",
                  p.podeEditar && !px.bloquear_posicao && !p.ligandoDe ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")}>
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="line-clamp-3 text-[11px] font-semibold leading-tight">{px.nome}</span>
                {px.principal && <Star className="absolute right-1 top-1 h-2.5 w-2.5 fill-amber-400 text-amber-400" />}
              </div>
              <span className="pointer-events-none absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border bg-white px-1.5 text-[9px] text-muted-foreground">{px.codigo}</span>
            </div>
          );
        })}
        {meus.length === 0 && (
          <div style={{ left: moldura.x, top: moldura.y + 70, width: moldura.w }} className="absolute text-center text-sm text-muted-foreground">
            Nenhum processo neste setor ainda — use “Novo processo”.
          </div>
        )}
      </div>
    </div>
  );
}

function BotaoBarra({ titulo, onClick, children }: { titulo: string; onClick?: () => void; children: ReactNode }) {
  return <button title={titulo} onClick={onClick} className={cn("rounded p-1", onClick ? "hover:bg-white/15" : "cursor-default opacity-80")}>{children}</button>;
}
