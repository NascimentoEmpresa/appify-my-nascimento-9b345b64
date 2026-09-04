import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { TiAtivo, TiElemento, TiPlanta } from "@/hooks/useTiMapa";
import {
  GRID_CM,
  arredondarGrid,
  cmParaMetros,
  statusAtivo,
  tipoAtivo,
  tipoElemento,
} from "./catalogo";

/**
 * O tabuleiro do Mapa de Hardware.
 *
 * COMO ISTO FUNCIONA (vale ler antes de mexer)
 *
 * O mundo é medido em CENTÍMETROS e desenhado 1 cm = 1 px numa camada HTML
 * absoluta; o zoom é um `transform: translate(...) scale(k)` com
 * `transform-origin: 0 0` no contêiner dessa camada. Só isso. Não há canvas
 * 2D nem SVG root: elemento e equipamento são `div`s posicionados, o que dá
 * de graça sombra, transição, `:hover`, foco de teclado e leitor de tela —
 * coisas que num <canvas> teriam que ser reinventadas.
 *
 * Converter tela → mundo é `(clientX - rect.left - view.x) / view.k`. Toda
 * interação (arrastar, criar, redimensionar) trabalha em centímetros e só
 * volta para pixel no render, por isso a planta continua fiel quando alguém
 * mede a sala com trena.
 *
 * O que NÃO escala junto com o zoom, de propósito: os rótulos dos
 * equipamentos e as alças de manipulação, que ganham um `scale(1/k)` para
 * continuarem legíveis e clicáveis em qualquer aproximação. Sem isso, com o
 * mapa inteiro na tela o nome da máquina vira um fio de 3 px.
 */

export interface FerramentaElemento {
  tipo: "elemento";
  valor: string;
}
export type Ferramenta = { tipo: "selecao" } | FerramentaElemento;

export type SelecaoMapa =
  | { tipo: "elemento"; id: string }
  | { tipo: "ativo"; id: string }
  | null;

export interface PlantaCanvasProps {
  planta: TiPlanta;
  elementos: TiElemento[];
  ativos: TiAtivo[];
  selecao: SelecaoMapa;
  onSelecionar: (s: SelecaoMapa) => void;
  ferramenta: Ferramenta;
  podeEditarPlanta: boolean;
  podeMoverAtivos: boolean;
  /** Termo da busca: quem casa fica aceso, o resto apaga. */
  destaque?: string;
  mostrarGrid: boolean;
  mostrarRotulos: boolean;
  onCriarElemento: (e: { tipo: string; x: number; y: number; largura: number; altura: number }) => void;
  onMoverElemento: (id: string, patch: Partial<TiElemento>) => void;
  onMoverAtivo: (id: string, pos: { pos_x: number; pos_y: number }) => void;
  /** Soltou um equipamento da bandeja lateral dentro do mapa. */
  onSoltarAtivoNaPlanta: (ativoId: string, pos: { pos_x: number; pos_y: number }) => void;
  onAbrirAtivo: (id: string) => void;
}

interface Vista {
  x: number;
  y: number;
  k: number;
}

const ZOOM_MIN = 0.08;
const ZOOM_MAX = 4;

type Arrasto =
  | { modo: "pan"; x0: number; y0: number; vx: number; vy: number }
  | { modo: "mover-elemento"; id: string; dx: number; dy: number; moveu: boolean }
  | { modo: "mover-ativo"; id: string; dx: number; dy: number; moveu: boolean }
  | {
      modo: "redimensionar";
      id: string;
      canto: "nw" | "ne" | "sw" | "se";
      x0: number;
      y0: number;
      l0: number;
      a0: number;
    }
  | { modo: "desenhar"; tipo: string; x0: number; y0: number }
  | null;

export function PlantaCanvas(props: PlantaCanvasProps) {
  const {
    planta,
    elementos,
    ativos,
    selecao,
    onSelecionar,
    ferramenta,
    podeEditarPlanta,
    podeMoverAtivos,
    destaque,
    mostrarGrid,
    mostrarRotulos,
    onCriarElemento,
    onMoverElemento,
    onMoverAtivo,
    onSoltarAtivoNaPlanta,
    onAbrirAtivo,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState<Vista>({ x: 40, y: 40, k: 0.35 });
  // Espelho da vista para o listener de wheel, que é registrado uma vez só e
  // não enxergaria o estado novo pelo closure.
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const [arrasto, setArrasto] = useState<Arrasto>(null);
  const arrastoRef = useRef<Arrasto>(null);
  arrastoRef.current = arrasto;
  // Posição "otimista": enquanto o dedo está no item, a fonte da verdade é
  // local. Só no soltar é que a mutação sobe — arrastar não pode disparar um
  // UPDATE por frame.
  const [previa, setPrevia] = useState<Record<string, { x: number; y: number; largura?: number; altura?: number }>>({});
  const [caixaDesenho, setCaixaDesenho] = useState<{ x: number; y: number; largura: number; altura: number } | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [semSnap, setSemSnap] = useState(false);

  const paraMundo = useCallback(
    (clientX: number, clientY: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - vista.x) / vista.k,
        y: (clientY - rect.top - vista.y) / vista.k,
      };
    },
    [vista],
  );

  const snap = useCallback((v: number) => (semSnap ? Math.round(v) : arredondarGrid(v, GRID_CM)), [semSnap]);

  /** Enquadra a planta inteira — é o estado inicial e o botão "ajustar". */
  const ajustarZoom = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margem = 60;
    const k = Math.min(
      (rect.width - margem * 2) / planta.largura_cm,
      (rect.height - margem * 2) / planta.altura_cm,
    );
    const kk = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k));
    setVista({
      k: kk,
      x: (rect.width - planta.largura_cm * kk) / 2,
      y: (rect.height - planta.altura_cm * kk) / 2,
    });
  }, [planta.largura_cm, planta.altura_cm]);

  useLayoutEffect(() => {
    ajustarZoom();
    // Reenquadra ao trocar de planta, não a cada render.
  }, [planta.id, ajustarZoom]);

  // Alt solta o snap: alinhar ao grid é o certo 95% do tempo, e o teclado é a
  // válvula para o canto de sala que não é múltiplo de 25 cm.
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Alt") setSemSnap(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Alt") setSemSnap(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const zoomPara = useCallback((novoK: number, centroX?: number, centroY?: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = centroX ?? rect.width / 2;
    const cy = centroY ?? rect.height / 2;
    setVista((v) => {
      const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, novoK));
      // Mantém sob o cursor o mesmo ponto do mundo antes e depois do zoom.
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  }, []);

  // O wheel é registrado à mão com `passive: false`: o React anexa o listener
  // dele como passivo no root, e sem poder chamar preventDefault a roda do
  // mouse dava zoom no mapa E rolava a página junto — o mapa fugia da tela no
  // primeiro giro.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fator = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomPara(vistaRef.current.k * fator, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoomPara]);

  // ── Arrastar ────────────────────────────────────────────────────────
  const iniciarPan = (e: React.PointerEvent) => {
    if (ferramenta.tipo === "elemento" && podeEditarPlanta) {
      const p = paraMundo(e.clientX, e.clientY);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setArrasto({ modo: "desenhar", tipo: ferramenta.valor, x0: snap(p.x), y0: snap(p.y) });
      setCaixaDesenho({ x: snap(p.x), y: snap(p.y), largura: 0, altura: 0 });
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setArrasto({ modo: "pan", x0: e.clientX, y0: e.clientY, vx: vista.x, vy: vista.y });
    onSelecionar(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const a = arrastoRef.current;
    if (!a) return;
    if (a.modo === "pan") {
      setVista((v) => ({ ...v, x: a.vx + (e.clientX - a.x0), y: a.vy + (e.clientY - a.y0) }));
      return;
    }
    const p = paraMundo(e.clientX, e.clientY);
    if (a.modo === "desenhar") {
      const x = Math.min(a.x0, snap(p.x));
      const y = Math.min(a.y0, snap(p.y));
      setCaixaDesenho({ x, y, largura: Math.abs(snap(p.x) - a.x0), altura: Math.abs(snap(p.y) - a.y0) });
      return;
    }
    if (a.modo === "mover-elemento" || a.modo === "mover-ativo") {
      a.moveu = true;
      setPrevia((prev) => ({ ...prev, [a.id]: { x: snap(p.x - a.dx), y: snap(p.y - a.dy) } }));
      return;
    }
    if (a.modo === "redimensionar") {
      const dx = snap(p.x) - a.x0;
      const dy = snap(p.y) - a.y0;
      const sinalX = a.canto === "ne" || a.canto === "se" ? 1 : -1;
      const sinalY = a.canto === "sw" || a.canto === "se" ? 1 : -1;
      const largura = Math.max(GRID_CM, a.l0 + dx * sinalX);
      const altura = Math.max(GRID_CM, a.a0 + dy * sinalY);
      const el = elementos.find((x) => x.id === a.id);
      if (!el) return;
      setPrevia((prev) => ({
        ...prev,
        [a.id]: {
          x: sinalX < 0 ? el.x + (a.l0 - largura) : el.x,
          y: sinalY < 0 ? el.y + (a.a0 - altura) : el.y,
          largura,
          altura,
        },
      }));
    }
  };

  const onPointerUp = () => {
    const a = arrastoRef.current;
    setArrasto(null);
    if (!a) return;

    if (a.modo === "desenhar" && caixaDesenho) {
      const def = tipoElemento(a.tipo);
      // Clique seco (sem arrastar) coloca a peça no tamanho de catálogo — é o
      // caminho rápido para mesa/cadeira, que ninguém quer desenhar à mão.
      const largura = caixaDesenho.largura < GRID_CM ? def.largura : caixaDesenho.largura;
      const altura = caixaDesenho.altura < GRID_CM ? def.altura : caixaDesenho.altura;
      onCriarElemento({ tipo: a.tipo, x: caixaDesenho.x, y: caixaDesenho.y, largura, altura });
      setCaixaDesenho(null);
      return;
    }

    if (a.modo === "mover-elemento" && a.moveu) {
      const p = previa[a.id];
      if (p) onMoverElemento(a.id, { x: p.x, y: p.y });
    }
    if (a.modo === "mover-ativo" && a.moveu) {
      const p = previa[a.id];
      if (p) onMoverAtivo(a.id, { pos_x: p.x, pos_y: p.y });
    }
    if (a.modo === "redimensionar") {
      const p = previa[a.id];
      if (p) onMoverElemento(a.id, { x: p.x, y: p.y, largura: p.largura, altura: p.altura });
    }
    // A prévia some quando o dado novo chega pela query; limpar aqui evitaria
    // um piscada de volta à posição antiga, então esperamos o próximo render
    // com os dados já invalidados.
    window.setTimeout(() => setPrevia({}), 400);
  };

  // ── Bandeja → mapa (HTML5 drag & drop) ──────────────────────────────
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/ti-ativo");
    if (!id || !podeMoverAtivos) return;
    const p = paraMundo(e.clientX, e.clientY);
    onSoltarAtivoNaPlanta(id, { pos_x: snap(p.x), pos_y: snap(p.y) });
  };

  const ativosNaPlanta = useMemo(
    () => ativos.filter((a) => a.planta_id === planta.id && a.pos_x != null && a.pos_y != null),
    [ativos, planta.id],
  );

  const termo = (destaque ?? "").trim().toLowerCase();
  const casaBusca = useCallback(
    (a: TiAtivo) => {
      if (!termo) return true;
      return [a.nome, a.codigo, a.patrimonio, a.ip, a.hostname, a.responsavel_nome, a.setor, a.marca, a.modelo]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo));
    },
    [termo],
  );

  const ativoHover = hover ? ativos.find((a) => a.id === hover.id) ?? null : null;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative h-full w-full overflow-hidden rounded-xl border bg-slate-200 dark:bg-slate-900",
        arrasto?.modo === "pan" && "cursor-grabbing",
        ferramenta.tipo === "elemento" && "cursor-crosshair",
      )}
      style={{ touchAction: "none" }}
      onPointerDown={iniciarPan}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Piso + tudo que vive no mundo */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})` }}
      >
        <div
          className="relative shadow-[0_18px_60px_-15px_rgba(15,23,42,0.55)] ring-1 ring-slate-400/60 dark:ring-slate-700"
          style={{
            width: planta.largura_cm,
            height: planta.altura_cm,
            background: planta.cor_piso,
            backgroundImage: mostrarGrid
              ? `linear-gradient(to right, rgba(15,23,42,0.10) 1px, transparent 1px),
                 linear-gradient(to bottom, rgba(15,23,42,0.10) 1px, transparent 1px),
                 linear-gradient(to right, rgba(15,23,42,0.05) 1px, transparent 1px),
                 linear-gradient(to bottom, rgba(15,23,42,0.05) 1px, transparent 1px)`
              : undefined,
            backgroundSize: mostrarGrid
              ? `${GRID_CM * 4}px ${GRID_CM * 4}px, ${GRID_CM * 4}px ${GRID_CM * 4}px, ${GRID_CM}px ${GRID_CM}px, ${GRID_CM}px ${GRID_CM}px`
              : undefined,
          }}
        >
          {/* Cenário */}
          {elementos.map((el) => (
            <ElementoView
              key={el.id}
              el={el}
              previa={previa[el.id]}
              selecionado={selecao?.tipo === "elemento" && selecao.id === el.id}
              podeEditar={podeEditarPlanta}
              zoom={vista.k}
              apagado={!!termo}
              onPointerDown={(e) => {
                if (ferramenta.tipo === "elemento") return;
                e.stopPropagation();
                onSelecionar({ tipo: "elemento", id: el.id });
                if (!podeEditarPlanta) return;
                const p = paraMundo(e.clientX, e.clientY);
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setArrasto({ modo: "mover-elemento", id: el.id, dx: p.x - el.x, dy: p.y - el.y, moveu: false });
              }}
              onHandlePointerDown={(e, canto) => {
                e.stopPropagation();
                const p = paraMundo(e.clientX, e.clientY);
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setArrasto({
                  modo: "redimensionar",
                  id: el.id,
                  canto,
                  x0: snap(p.x),
                  y0: snap(p.y),
                  l0: el.largura,
                  a0: el.altura,
                });
              }}
            />
          ))}

          {/* Caixa fantasma de "desenhando agora" */}
          {caixaDesenho && (
            <div
              className="pointer-events-none absolute border-2 border-dashed border-sky-500 bg-sky-400/20"
              style={{
                left: caixaDesenho.x,
                top: caixaDesenho.y,
                width: Math.max(caixaDesenho.largura, 2),
                height: Math.max(caixaDesenho.altura, 2),
              }}
            />
          )}

          {/* Hardware */}
          {ativosNaPlanta.map((a) => (
            <AtivoView
              key={a.id}
              ativo={a}
              previa={previa[a.id]}
              zoom={vista.k}
              selecionado={selecao?.tipo === "ativo" && selecao.id === a.id}
              apagado={!!termo && !casaBusca(a)}
              mostrarRotulo={mostrarRotulos}
              onPointerDown={(e) => {
                if (ferramenta.tipo === "elemento") return;
                e.stopPropagation();
                onSelecionar({ tipo: "ativo", id: a.id });
                if (!podeMoverAtivos) return;
                const p = paraMundo(e.clientX, e.clientY);
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setArrasto({
                  modo: "mover-ativo",
                  id: a.id,
                  dx: p.x - (a.pos_x ?? 0),
                  dy: p.y - (a.pos_y ?? 0),
                  moveu: false,
                });
              }}
              onDoubleClick={() => onAbrirAtivo(a.id)}
              onHover={(dentro, e) =>
                setHover(dentro && e ? { id: a.id, x: e.clientX, y: e.clientY } : null)
              }
            />
          ))}
        </div>
      </div>

      {/* Cartão flutuante do hover — fora da camada com transform, senão ele
          escalaria junto e ficaria ilegível no zoom-out. */}
      {ativoHover && hover && (
        <CartaoHover ativo={ativoHover} x={hover.x} y={hover.y} wrap={wrapRef.current} />
      )}

      {/* Controles */}
      <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col items-end gap-2">
        <Minimapa planta={planta} ativos={ativosNaPlanta} vista={vista} wrap={wrapRef.current} />
        <div className="flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-lg backdrop-blur">
          <BotaoZoom label="−" onClick={() => zoomPara(vista.k / 1.3)} />
          <button
            type="button"
            className="min-w-[3.2rem] rounded px-2 py-1 text-xs font-semibold tabular-nums text-muted-foreground hover:bg-muted"
            onClick={ajustarZoom}
            title="Ajustar à tela"
          >
            {Math.round(vista.k * 100)}%
          </button>
          <BotaoZoom label="+" onClick={() => zoomPara(vista.k * 1.3)} />
        </div>
      </div>

      {/* Régua de escala: sem ela ninguém sabe se o mapa está em metros ou em
          "mais ou menos". Mede 200 cm no zoom atual. */}
      <div className="pointer-events-none absolute bottom-4 left-3 flex items-center gap-2 rounded-md bg-background/85 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow backdrop-blur">
        <div className="h-2 border-x-2 border-b-2 border-foreground/60" style={{ width: Math.max(12, 200 * vista.k) }} />
        {cmParaMetros(200)}
      </div>

      {ferramenta.tipo === "elemento" && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow-lg">
          Clique para posicionar · arraste para dimensionar · Alt solta o grid
        </div>
      )}
    </div>
  );
}

function BotaoZoom({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 w-7 rounded text-sm font-bold text-muted-foreground hover:bg-muted"
    >
      {label}
    </button>
  );
}

// ── Elemento do cenário ───────────────────────────────────────────────

interface ElementoViewProps {
  el: TiElemento;
  previa?: { x: number; y: number; largura?: number; altura?: number };
  selecionado: boolean;
  podeEditar: boolean;
  zoom: number;
  apagado: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onHandlePointerDown: (e: React.PointerEvent, canto: "nw" | "ne" | "sw" | "se") => void;
}

function ElementoView({
  el,
  previa,
  selecionado,
  podeEditar,
  zoom,
  apagado,
  onPointerDown,
  onHandlePointerDown,
}: ElementoViewProps) {
  const def = tipoElemento(el.tipo);
  const x = previa?.x ?? el.x;
  const y = previa?.y ?? el.y;
  const largura = previa?.largura ?? el.largura;
  const altura = previa?.altura ?? el.altura;
  const cor = el.cor || def.cor;
  const estrutura = def.familia === "estrutura";
  const area = def.familia === "area";

  if (def.familia === "texto") {
    return (
      <div
        className={cn("absolute select-none", selecionado && "ring-2 ring-sky-500")}
        style={{ left: x, top: y, width: largura, height: altura, transform: `rotate(${el.rotacao}deg)` }}
        onPointerDown={onPointerDown}
      >
        <span
          className="block truncate font-bold leading-none"
          style={{ color: cor, fontSize: Math.max(18, altura * 0.7) }}
        >
          {el.rotulo || "Texto"}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn("absolute", apagado && "opacity-50", podeEditar && "cursor-move")}
      style={{
        left: x,
        top: y,
        width: largura,
        height: altura,
        transform: `rotate(${el.rotacao}deg)`,
        zIndex: area ? 1 : estrutura ? 3 : 2,
      }}
      onPointerDown={onPointerDown}
    >
      <div
        className="h-full w-full"
        style={{
          background: area ? `${cor}` : cor,
          opacity: area ? 0.55 : 1,
          borderRadius: estrutura ? 2 : area ? 8 : 6,
          border: area ? `2px dashed ${sombrear(cor, -25)}` : `1px solid ${sombrear(cor, -20)}`,
          boxShadow: estrutura
            ? "0 1px 0 rgba(255,255,255,0.25) inset"
            : area
              ? "none"
              : "0 4px 10px -4px rgba(15,23,42,0.45)",
        }}
      />
      {el.rotulo && (
        <span
          className="pointer-events-none absolute left-1 top-1 max-w-full truncate rounded bg-black/25 px-1 font-semibold text-white"
          style={{ fontSize: Math.max(11, 13 / zoom), lineHeight: 1.4 }}
        >
          {el.rotulo}
        </span>
      )}
      {selecionado && (
        <>
          <div className="pointer-events-none absolute -inset-[2px] rounded-[6px] ring-2 ring-sky-500" />
          {podeEditar &&
            (["nw", "ne", "sw", "se"] as const).map((canto) => (
              <div
                key={canto}
                onPointerDown={(e) => onHandlePointerDown(e, canto)}
                className="absolute z-10 rounded-sm border border-white bg-sky-500 shadow"
                style={{
                  width: 10 / zoom,
                  height: 10 / zoom,
                  cursor: canto === "nw" || canto === "se" ? "nwse-resize" : "nesw-resize",
                  left: canto === "nw" || canto === "sw" ? -5 / zoom : undefined,
                  right: canto === "ne" || canto === "se" ? -5 / zoom : undefined,
                  top: canto === "nw" || canto === "ne" ? -5 / zoom : undefined,
                  bottom: canto === "sw" || canto === "se" ? -5 / zoom : undefined,
                }}
              />
            ))}
        </>
      )}
    </div>
  );
}

// ── Equipamento ───────────────────────────────────────────────────────

interface AtivoViewProps {
  ativo: TiAtivo;
  previa?: { x: number; y: number };
  zoom: number;
  selecionado: boolean;
  apagado: boolean;
  mostrarRotulo: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
  onHover: (dentro: boolean, e?: React.PointerEvent) => void;
}

function AtivoView({
  ativo,
  previa,
  zoom,
  selecionado,
  apagado,
  mostrarRotulo,
  onPointerDown,
  onDoubleClick,
  onHover,
}: AtivoViewProps) {
  const def = tipoAtivo(ativo.tipo);
  const st = statusAtivo(ativo.status);
  const Icone = def.icone;
  const x = previa?.x ?? ativo.pos_x ?? 0;
  const y = previa?.y ?? ativo.pos_y ?? 0;
  const escala = ativo.escala || 1;
  const largura = def.largura * escala;
  const altura = def.altura * escala;
  const cor = ativo.cor || def.cor;
  // A peça tem um tamanho mínimo em PIXELS DE TELA: um access point de 25 cm
  // com o mapa inteiro à vista viraria um ponto de 2 px, impossível de clicar.
  const ladoMin = 26 / zoom;

  return (
    <div
      className={cn("absolute select-none", apagado ? "opacity-20" : "opacity-100")}
      style={{
        left: x,
        top: y,
        width: Math.max(largura, ladoMin),
        height: Math.max(altura, ladoMin),
        transform: `translate(-50%, -50%) rotate(${ativo.rotacao}deg)`,
        zIndex: selecionado ? 30 : 20,
        transition: "opacity 160ms ease",
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onPointerEnter={(e) => onHover(true, e)}
      onPointerLeave={() => onHover(false)}
    >
      <div
        className="flex h-full w-full items-center justify-center rounded-md"
        style={{
          background: `linear-gradient(160deg, ${clarear(cor, 18)}, ${cor})`,
          border: `${Math.max(1, 2 / zoom)}px solid ${sombrear(cor, -30)}`,
          boxShadow: selecionado
            ? `0 0 0 ${3 / zoom}px #0ea5e9, 0 ${6 / zoom}px ${14 / zoom}px -${4 / zoom}px rgba(15,23,42,0.6)`
            : `0 ${4 / zoom}px ${10 / zoom}px -${3 / zoom}px rgba(15,23,42,0.5)`,
          cursor: "grab",
        }}
      >
        <Icone
          color="#ffffff"
          style={{ width: "62%", height: "62%" }}
          strokeWidth={2.2}
          absoluteStrokeWidth={false}
        />
      </div>

      {/* LED de status: pisca só em quem exige ação (manutenção). */}
      <span
        className={cn("absolute rounded-full ring-2 ring-white", st.pulsa && "animate-pulse")}
        style={{
          width: Math.max(8 / zoom, 6),
          height: Math.max(8 / zoom, 6),
          right: -3 / zoom,
          top: -3 / zoom,
          background: st.cor,
          boxShadow: `0 0 ${8 / zoom}px ${st.cor}`,
        }}
      />

      {mostrarRotulo && (
        <span
          className="pointer-events-none absolute left-1/2 top-full whitespace-nowrap rounded bg-slate-900/85 px-1.5 py-0.5 font-semibold text-white"
          style={{
            transform: `translate(-50%, ${4 / zoom}px) scale(${1 / zoom})`,
            transformOrigin: "top center",
            fontSize: 11,
          }}
        >
          {ativo.nome}
        </span>
      )}
    </div>
  );
}

// ── Cartão de hover ───────────────────────────────────────────────────

function CartaoHover({
  ativo,
  x,
  y,
  wrap,
}: {
  ativo: TiAtivo;
  x: number;
  y: number;
  wrap: HTMLDivElement | null;
}) {
  const rect = wrap?.getBoundingClientRect();
  if (!rect) return null;
  const st = statusAtivo(ativo.status);
  const def = tipoAtivo(ativo.tipo);
  // Vira para a esquerda perto da borda direita, senão o cartão sai da tela.
  const esquerda = x - rect.left > rect.width - 280;
  return (
    <div
      className="pointer-events-none absolute z-40 w-64 rounded-lg border bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur"
      style={{
        left: Math.min(Math.max(x - rect.left + (esquerda ? -272 : 16), 8), rect.width - 268),
        top: Math.min(Math.max(y - rect.top - 20, 8), Math.max(rect.height - 190, 8)),
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{ativo.nome}</p>
          <p className="text-[11px] text-muted-foreground">
            {def.label} · {ativo.codigo ?? "sem código"}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
          style={{ background: st.cor }}
        >
          {st.label}
        </span>
      </div>
      <dl className="mt-2 space-y-1 text-[11px]">
        <LinhaHover rotulo="Responsável" valor={ativo.responsavel_nome} />
        <LinhaHover rotulo="Setor" valor={ativo.setor} />
        <LinhaHover rotulo="IP" valor={ativo.ip} />
        <LinhaHover
          rotulo="Config"
          valor={[ativo.cpu, ativo.ram_gb ? `${ativo.ram_gb} GB` : null, ativo.armazenamento_gb ? `${ativo.armazenamento_gb} GB` : null]
            .filter(Boolean)
            .join(" · ")}
        />
      </dl>
      <p className="mt-2 text-[10px] text-muted-foreground">Duplo clique abre a ficha completa</p>
    </div>
  );
}

function LinhaHover({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 flex-1 truncate font-medium">{valor}</dd>
    </div>
  );
}

// ── Minimapa ──────────────────────────────────────────────────────────

function Minimapa({
  planta,
  ativos,
  vista,
  wrap,
}: {
  planta: TiPlanta;
  ativos: TiAtivo[];
  vista: Vista;
  wrap: HTMLDivElement | null;
}) {
  const LARGURA = 150;
  const escala = LARGURA / planta.largura_cm;
  const altura = planta.altura_cm * escala;
  const rect = wrap?.getBoundingClientRect();

  return (
    <div
      className="relative overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur"
      style={{ width: LARGURA, height: altura }}
      title="Visão geral da planta"
    >
      {ativos.map((a) => (
        <span
          key={a.id}
          className="absolute rounded-full"
          style={{
            left: (a.pos_x ?? 0) * escala - 1.5,
            top: (a.pos_y ?? 0) * escala - 1.5,
            width: 3,
            height: 3,
            background: statusAtivo(a.status).cor,
          }}
        />
      ))}
      {rect && (
        <div
          className="absolute border border-sky-500 bg-sky-500/10"
          style={{
            left: (-vista.x / vista.k) * escala,
            top: (-vista.y / vista.k) * escala,
            width: (rect.width / vista.k) * escala,
            height: (rect.height / vista.k) * escala,
          }}
        />
      )}
    </div>
  );
}

// ── Cor ───────────────────────────────────────────────────────────────
// Duas funções de 6 linhas em vez de uma dependência de cor: o mapa só
// precisa clarear o topo do ícone e escurecer a borda.

function ajustar(hex: string, delta: number): string {
  const limpo = hex.replace("#", "");
  if (limpo.length !== 6) return hex;
  const n = parseInt(limpo, 16);
  const canal = (deslocamento: number) => {
    const v = (n >> deslocamento) & 0xff;
    return Math.max(0, Math.min(255, Math.round(v + (delta / 100) * 255)));
  };
  return `rgb(${canal(16)}, ${canal(8)}, ${canal(0)})`;
}
const clarear = (hex: string, p: number) => ajustar(hex, p);
const sombrear = (hex: string, p: number) => ajustar(hex, p);
