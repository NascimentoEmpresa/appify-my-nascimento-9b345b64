import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { TiAtivo, TiElemento, TiPlanta } from "@/hooks/useTiMapa";
import { statusAtivo, tipoAtivo, tipoElemento } from "../mapa/catalogo";
import {
  M,
  alturaDeApoio,
  alturaDoElemento,
  camaraInicial,
  dimensoesAtivo,
  rad,
  retanguloDoTraco,
  snap,
} from "./apoio";
import { ModeloDoAtivo, ModeloDoElemento, Selecao } from "./Modelos";

/**
 * A cena 3D do escritório.
 *
 * COMO ELA SE ORGANIZA
 *   O mundo é medido em METROS (o banco guarda centímetros; `M()` converte na
 *   borda). O canto superior esquerdo da planta é a origem: um objeto em
 *   x=300, y=150 no banco aparece em x=3, z=1.5 na cena. O eixo Y é a altura,
 *   e a base de todo modelo nasce em y=0 — quem levanta o objeto para cima da
 *   mesa é `alturaDeApoio`, não o modelo.
 *
 *   O MESMO componente serve as duas telas. `editavel` decide se arrastar,
 *   desenhar e apagar existem: no Mapa ele é falso e a cena vira um passeio.
 *
 * ARRASTAR SEM TRAVAR — a regra mais importante deste arquivo
 *   Enquanto o dedo está no objeto, a posição vive AQUI, em estado local
 *   (`previa`), e a cena redesenha sozinha. A gravação no banco acontece UMA
 *   vez, no soltar (`onSoltarElemento` / `onSoltarAtivo`).
 *
 *   A primeira versão chamava a mutation a cada `pointermove`: um UPDATE no
 *   Supabase por pixel arrastado, dezenas por segundo. A parede andava aos
 *   trancos, o histórico enchia de linhas e o banco levava a culpa. Se
 *   precisar mexer aqui, mantenha a regra: **mover é local, soltar é que
 *   persiste**.
 *
 * DESENHAR PAREDE
 *   Parede não se cria clicando e digitando o comprimento. Com a ferramenta
 *   ativa, arrasta-se do começo ao fim do traço e a peça nasce com o
 *   comprimento e o ângulo do arrasto — é como se desenha uma planta.
 *
 * frameloop="demand": a cena só redesenha quando algo muda (arrasto, câmera,
 * dado novo). Sem isso o canvas fica em 60 fps eternos consumindo GPU com o
 * escritório parado na tela.
 */

export type SelecaoCena =
  | { tipo: "elemento"; id: string }
  | { tipo: "ativo"; id: string }
  | null;

/** Um traço feito no chão, em cm: do ponto inicial ao final. */
export interface TracoNoChao {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Verdadeiro quando foi um clique seco, sem arrastar. */
  clique: boolean;
}

interface Props {
  planta: TiPlanta;
  elementos: TiElemento[];
  ativos: TiAtivo[];
  selecao: SelecaoCena;
  onSelecionar: (s: SelecaoCena) => void;
  editavel: boolean;
  destaque?: string;
  mostrarGrade?: boolean;
  mostrarRotulos?: boolean;
  /** Ferramenta ativa (só o rótulo importa aqui: se há algo para desenhar). */
  desenhando?: boolean;
  /** Traço concluído no chão — cria a peça. */
  onDesenharNoChao?: (t: TracoNoChao) => void;
  /** Fim do arrasto: a hora (única) de gravar. */
  onSoltarElemento?: (id: string, x: number, y: number) => void;
  onSoltarAtivo?: (id: string, x: number, y: number) => void;
  onAbrirFicha?: (ativoId: string) => void;
}

export function Cena3D(props: Props) {
  const { planta } = props;
  const camera = useMemo(
    () => camaraInicial(planta.largura_cm, planta.altura_cm),
    [planta.largura_cm, planta.altura_cm],
  );

  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 1.75]}
      camera={{ position: camera, fov: 42, near: 0.1, far: 500 }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color("#dbe3ec");
        scene.fog = new THREE.Fog("#dbe3ec", 45, 160);
      }}
    >
      <Suspense fallback={null}>
        <Conteudo {...props} />
      </Suspense>
    </Canvas>
  );
}

function Conteudo({
  planta,
  elementos,
  ativos,
  selecao,
  onSelecionar,
  editavel,
  destaque,
  mostrarGrade = true,
  mostrarRotulos = true,
  desenhando = false,
  onDesenharNoChao,
  onSoltarElemento,
  onSoltarAtivo,
  onAbrirFicha,
}: Props) {
  const L = M(planta.largura_cm);
  const P = M(planta.altura_cm);
  const centro = useMemo<[number, number, number]>(() => [L / 2, 0, P / 2], [L, P]);

  const { invalidate } = useThree();
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);

  // Posição durante o arrasto: local, sem tocar no banco. Ver o cabeçalho.
  const [previa, setPrevia] = useState<Record<string, { x: number; y: number }>>({});
  const [arrasto, setArrasto] = useState<
    { tipo: "elemento" | "ativo"; id: string; alturaBase: number; dx: number; dz: number } | null
  >(null);
  const [traco, setTraco] = useState<TracoNoChao | null>(null);
  const [livre, setLivre] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const d = (e: KeyboardEvent) => e.key === "Alt" && setLivre(true);
    const u = (e: KeyboardEvent) => e.key === "Alt" && setLivre(false);
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
    };
  }, []);

  const travarCamera = (travar: boolean) => {
    if (controlsRef.current) controlsRef.current.enabled = !travar;
  };

  const iniciarArrasto = (
    tipo: "elemento" | "ativo",
    id: string,
    alturaBase: number,
    ponto: THREE.Vector3,
    posX: number,
    posZ: number,
  ) => {
    if (!editavel || desenhando) return;
    setArrasto({ tipo, id, alturaBase, dx: ponto.x - posX, dz: ponto.z - posZ });
    travarCamera(true);
  };

  const moverLocal = useCallback(
    (x: number, z: number) => {
      setArrasto((a) => {
        if (!a) return a;
        setPrevia((p) => ({ ...p, [a.id]: { x: snap(x * 100, livre), y: snap(z * 100, livre) } }));
        return a;
      });
      invalidate();
    },
    [livre, invalidate],
  );

  const soltar = useCallback(() => {
    setArrasto((a) => {
      if (a) {
        travarCamera(false);
        setPrevia((p) => {
          const pos = p[a.id];
          // ESTA é a única gravação do arrasto inteiro.
          if (pos) {
            if (a.tipo === "elemento") onSoltarElemento?.(a.id, pos.x, pos.y);
            else onSoltarAtivo?.(a.id, pos.x, pos.y);
          }
          return p;
        });
      }
      return null;
    });
  }, [onSoltarElemento, onSoltarAtivo]);

  // A prévia some quando o dado novo chega pela query. Limpar na hora faria a
  // peça piscar de volta na posição antiga até o refetch responder.
  useEffect(() => {
    if (arrasto || Object.keys(previa).length === 0) return;
    const t = window.setTimeout(() => setPrevia({}), 600);
    return () => window.clearTimeout(t);
  }, [arrasto, previa, elementos, ativos]);

  const termo = (destaque ?? "").trim().toLowerCase();
  const casa = useCallback(
    (a: TiAtivo) =>
      !termo ||
      [a.nome, a.codigo, a.patrimonio, a.ip, a.hostname, a.responsavel_nome, a.setor]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo)),
    [termo],
  );

  return (
    <>
      <Luzes largura={L} profundidade={P} />

      <OrbitControls
        ref={controlsRef}
        target={centro}
        makeDefault
        maxPolarAngle={Math.PI * 0.49}
        minDistance={1.5}
        maxDistance={Math.max(L, P) * 2.5 + 20}
        enableDamping
        dampingFactor={0.15}
      />

      <Piso
        planta={planta}
        mostrarGrade={mostrarGrade}
        editavel={editavel}
        desenhando={desenhando}
        livre={livre}
        onComecarTraco={(t) => {
          setTraco(t);
          travarCamera(true);
          invalidate();
        }}
      />

      <ParedesDoPerimetro planta={planta} />

      <PonteiroNoPlano
        ativo={!!arrasto || !!traco}
        altura={arrasto?.alturaBase ?? 0}
        onMover={(x, z) => {
          if (arrasto) {
            moverLocal(x - arrasto.dx, z - arrasto.dz);
          } else if (traco) {
            const x2 = snap(x * 100, livre);
            const y2 = snap(z * 100, livre);
            setTraco((t) => (t ? { ...t, x2, y2, clique: false } : t));
            invalidate();
          }
        }}
        onSoltar={() => {
          if (traco) {
            travarCamera(false);
            onDesenharNoChao?.(traco);
            setTraco(null);
            invalidate();
          }
          soltar();
        }}
      />

      {traco && <FantasmaDoTraco traco={traco} />}

      {elementos.map((el) => {
        const def = tipoElemento(el.tipo);
        const largura = M(Number(el.largura));
        const profundidade = M(Number(el.altura));
        const altura = M(alturaDoElemento(el));
        const selecionado = selecao?.tipo === "elemento" && selecao.id === el.id;
        const pos = previa[el.id];
        const x = M(pos ? pos.x : Number(el.x)) + largura / 2;
        const z = M(pos ? pos.y : Number(el.y)) + profundidade / 2;
        return (
          <group
            key={el.id}
            position={[x, 0, z]}
            rotation={[0, rad(Number(el.rotacao)), 0]}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              if (desenhando) return;
              e.stopPropagation();
              onSelecionar({ tipo: "elemento", id: el.id });
              iniciarArrasto("elemento", el.id, 0, e.point, x, z);
            }}
          >
            <ModeloDoElemento elemento={el} largura={largura} profundidade={profundidade} altura={altura} />
            {selecionado && <Selecao largura={largura} profundidade={profundidade} altura={altura} />}
            {def.familia === "area" && el.rotulo && (
              <Html center distanceFactor={22} position={[0, 0.05, 0]}>
                <span className="whitespace-nowrap rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-700">
                  {el.rotulo}
                </span>
              </Html>
            )}
            {selecionado && def.familia !== "area" && el.rotulo && (
              <Html center distanceFactor={14} position={[0, altura + 0.25, 0]}>
                <span className="whitespace-nowrap rounded bg-slate-900/85 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  {el.rotulo}
                </span>
              </Html>
            )}
          </group>
        );
      })}

      {ativos
        .filter((a) => a.planta_id === planta.id && a.pos_x != null && a.pos_y != null)
        .map((a) => {
          const { largura, profundidade, altura } = dimensoesAtivo(a);
          const pos = previa[a.id];
          const alvo = pos ? ({ ...a, pos_x: pos.x, pos_y: pos.y } as TiAtivo) : a;
          const base = M(alturaDeApoio(alvo, elementos));
          const x = M(Number(alvo.pos_x));
          const z = M(Number(alvo.pos_y));
          const selecionado = selecao?.tipo === "ativo" && selecao.id === a.id;
          const apagado = !!termo && !casa(a);
          const st = statusAtivo(a.status);

          return (
            <group
              key={a.id}
              position={[x, base, z]}
              rotation={[0, rad(Number(a.rotacao)), 0]}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                if (desenhando) return;
                e.stopPropagation();
                onSelecionar({ tipo: "ativo", id: a.id });
                iniciarArrasto("ativo", a.id, base, e.point, x, z);
              }}
              onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                onAbrirFicha?.(a.id);
              }}
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHover(a.id);
                invalidate();
              }}
              onPointerOut={() => {
                setHover((h) => (h === a.id ? null : h));
                invalidate();
              }}
            >
              <group visible={!apagado}>
                <ModeloDoAtivo ativo={a} largura={largura} profundidade={profundidade} altura={altura} />
              </group>
              {selecionado && <Selecao largura={largura} profundidade={profundidade} altura={altura} />}

              {!apagado && (
                <mesh position={[0, altura + 0.09, 0]}>
                  <sphereGeometry args={[0.045, 12, 10]} />
                  <meshStandardMaterial color={st.cor} emissive={st.cor} emissiveIntensity={0.75} />
                </mesh>
              )}

              {!apagado && (mostrarRotulos || hover === a.id || selecionado) && (
                <Html center distanceFactor={13} position={[0, altura + 0.3, 0]} zIndexRange={[20, 0]}>
                  <span
                    className="pointer-events-none whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold text-white shadow"
                    style={{ background: hover === a.id || selecionado ? "#0f172a" : "rgba(15,23,42,0.72)" }}
                  >
                    {a.nome}
                    {hover === a.id && a.responsavel_nome ? ` · ${a.responsavel_nome}` : ""}
                  </span>
                </Html>
              )}
            </group>
          );
        })}
    </>
  );
}

// ── Peças da cena ─────────────────────────────────────────────────────

function Luzes({ largura, profundidade }: { largura: number; profundidade: number }) {
  const alcance = Math.max(largura, profundidade) * 0.75 + 6;
  return (
    <>
      <hemisphereLight args={["#ffffff", "#9aa7b5", 1.05]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        castShadow
        position={[largura * 0.6 + 8, Math.max(largura, profundidade) * 0.8 + 10, profundidade * 0.35 - 6]}
        intensity={1.35}
        // 1024 em vez de 2048: com a planta inteira na sombra, a diferença
        // visual é mínima e o custo por frame cai à metade.
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0009}
        shadow-camera-left={-alcance}
        shadow-camera-right={alcance}
        shadow-camera-top={alcance}
        shadow-camera-bottom={-alcance}
        shadow-camera-far={alcance * 4}
      />
    </>
  );
}

function Piso({
  planta,
  mostrarGrade,
  editavel,
  desenhando,
  livre,
  onComecarTraco,
}: {
  planta: TiPlanta;
  mostrarGrade: boolean;
  editavel: boolean;
  desenhando: boolean;
  livre: boolean;
  onComecarTraco: (t: TracoNoChao) => void;
}) {
  const L = M(planta.largura_cm);
  const P = M(planta.altura_cm);
  return (
    <group>
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[L / 2, 0, P / 2]}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          if (!editavel || !desenhando) return;
          e.stopPropagation();
          const x = snap(e.point.x * 100, livre);
          const y = snap(e.point.z * 100, livre);
          onComecarTraco({ x1: x, y1: y, x2: x, y2: y, clique: true });
        }}
      >
        <planeGeometry args={[L, P]} />
        <meshStandardMaterial color={planta.cor_piso || "#eef2f7"} roughness={0.95} />
      </mesh>

      {mostrarGrade && (
        <Grid
          position={[L / 2, 0.006, P / 2]}
          args={[L, P]}
          cellSize={0.25}
          cellThickness={0.5}
          cellColor="#b9c4d2"
          sectionSize={1}
          sectionThickness={1}
          sectionColor="#8fa0b4"
          fadeDistance={Math.max(L, P) * 2.4}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={false}
        />
      )}
    </group>
  );
}

function ParedesDoPerimetro({ planta }: { planta: TiPlanta }) {
  const L = M(planta.largura_cm);
  const P = M(planta.altura_cm);
  const h = Math.min(M(planta.pe_direito_cm ?? 280) * 0.42, 1.3);
  const e = 0.08;
  const cor = "#c3ccd8";
  return (
    <group>
      <mesh castShadow receiveShadow position={[L / 2, h / 2, -e / 2]}>
        <boxGeometry args={[L + e * 2, h, e]} />
        <meshStandardMaterial color={cor} roughness={0.9} />
      </mesh>
      <mesh castShadow receiveShadow position={[L / 2, h / 2, P + e / 2]}>
        <boxGeometry args={[L + e * 2, h, e]} />
        <meshStandardMaterial color={cor} roughness={0.9} />
      </mesh>
      <mesh castShadow receiveShadow position={[-e / 2, h / 2, P / 2]}>
        <boxGeometry args={[e, h, P]} />
        <meshStandardMaterial color={cor} roughness={0.9} />
      </mesh>
      <mesh castShadow receiveShadow position={[L + e / 2, h / 2, P / 2]}>
        <boxGeometry args={[e, h, P]} />
        <meshStandardMaterial color={cor} roughness={0.9} />
      </mesh>
    </group>
  );
}

/** A prévia da peça enquanto o traço está sendo puxado, com a medida em metros. */
function FantasmaDoTraco({ traco }: { traco: TracoNoChao }) {
  const r = retanguloDoTraco(traco.x1, traco.y1, traco.x2, traco.y2, 15);
  const largura = M(r.largura);
  const profundidade = M(Math.max(r.profundidade, 10));
  const comprimento = Math.round(r.largura);
  return (
    <group position={[M(r.centroX), 0.4, M(r.centroY)]} rotation={[0, rad(r.rotacao), 0]}>
      <mesh>
        <boxGeometry args={[largura, 0.8, profundidade]} />
        <meshStandardMaterial color="#0ea5e9" transparent opacity={0.45} />
      </mesh>
      <Html center distanceFactor={14} position={[0, 0.8, 0]}>
        <span className="whitespace-nowrap rounded bg-sky-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
          {(comprimento / 100).toFixed(2).replace(".", ",")} m
        </span>
      </Html>
    </group>
  );
}

/**
 * Projeta o ponteiro num plano matemático e reporta a posição no mundo.
 *
 * Serve tanto para arrastar quanto para desenhar. Plano matemático, e não um
 * mesh invisível de colisão: o mesh para de receber evento assim que o cursor
 * passa por cima de outra peça, e o objeto "gruda" no meio do caminho.
 */
function PonteiroNoPlano({
  ativo,
  altura,
  onMover,
  onSoltar,
}: {
  ativo: boolean;
  altura: number;
  onMover: (x: number, z: number) => void;
  onSoltar: () => void;
}) {
  const { camera, gl } = useThree();
  const alvo = useRef(new THREE.Vector3());
  const raycaster = useRef(new THREE.Raycaster());
  const ponteiro = useRef(new THREE.Vector2());

  useEffect(() => {
    if (!ativo) return;
    const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -altura);
    const el = gl.domElement;

    const mover = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ponteiro.current.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(ponteiro.current, camera);
      if (raycaster.current.ray.intersectPlane(plano, alvo.current)) {
        onMover(alvo.current.x, alvo.current.z);
      }
    };

    el.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", onSoltar);
    return () => {
      el.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", onSoltar);
    };
  }, [ativo, altura, camera, gl, onMover, onSoltar]);

  return null;
}

export function LegendaStatus() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {["em_uso", "manutencao", "disponivel", "reservado", "inativo"].map((s) => {
        const d = statusAtivo(s);
        return (
          <span key={s} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: d.cor }} />
            {d.label}
          </span>
        );
      })}
    </div>
  );
}

export const iconeDoTipo = (tipo: string) => tipoAtivo(tipo).icone;
