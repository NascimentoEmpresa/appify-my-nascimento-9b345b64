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
 *   girar e apagar existem: no Mapa ele é falso e a cena vira um passeio —
 *   dá para orbitar, aproximar e clicar para ver a ficha, e não há como mover
 *   nada por acidente. Não são duas cenas parecidas mantidas em paralelo.
 *
 * ARRASTAR
 *   Não usa plano invisível de colisão: o ponteiro é projetado num
 *   THREE.Plane matemático na altura da base do objeto. Plano de colisão real
 *   deixa de receber evento assim que o cursor passa por cima de outra peça —
 *   e o objeto "gruda" no meio do caminho, que é o bug clássico deste tipo de
 *   editor.
 */

export type SelecaoCena =
  | { tipo: "elemento"; id: string }
  | { tipo: "ativo"; id: string }
  | null;

interface Props {
  planta: TiPlanta;
  elementos: TiElemento[];
  ativos: TiAtivo[];
  selecao: SelecaoCena;
  onSelecionar: (s: SelecaoCena) => void;
  /** Falso no Mapa (só ver); verdadeiro em Construir. */
  editavel: boolean;
  /** Termo de busca: quem não casa fica translúcido. */
  destaque?: string;
  mostrarGrade?: boolean;
  mostrarRotulos?: boolean;
  /** Só quando uma ferramenta está ativa: clicar no chão cria a peça ali. */
  onClicarNoChao?: (x: number, y: number) => void;
  onMoverElemento?: (id: string, x: number, y: number) => void;
  onMoverAtivo?: (id: string, x: number, y: number) => void;
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
      dpr={[1, 2]}
      camera={{ position: camera, fov: 42, near: 0.1, far: 500 }}
      // O fundo é pintado aqui e não no CSS: o canvas cobre o contêiner
      // inteiro, então um `background` de div nunca apareceria.
      onCreated={({ scene }) => {
        scene.background = new THREE.Color("#dbe3ec");
        scene.fog = new THREE.Fog("#dbe3ec", 40, 140);
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
  onClicarNoChao,
  onMoverElemento,
  onMoverAtivo,
  onAbrirFicha,
}: Props) {
  const L = M(planta.largura_cm);
  const P = M(planta.altura_cm);
  const centro = useMemo<[number, number, number]>(() => [L / 2, 0, P / 2], [L, P]);

  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);
  const [arrasto, setArrasto] = useState<{
    tipo: "elemento" | "ativo";
    id: string;
    alturaBase: number;
    dx: number;
    dz: number;
  } | null>(null);
  const [livre, setLivre] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  // Alt solta o grid enquanto arrasta — mesma tecla do editor 2D anterior.
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

  const termo = (destaque ?? "").trim().toLowerCase();
  const casa = useCallback(
    (a: TiAtivo) =>
      !termo ||
      [a.nome, a.codigo, a.patrimonio, a.ip, a.hostname, a.responsavel_nome, a.setor]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo)),
    [termo],
  );

  const iniciarArrasto = (
    tipo: "elemento" | "ativo",
    id: string,
    alturaBase: number,
    ponto: THREE.Vector3,
    posX: number,
    posZ: number,
  ) => {
    if (!editavel) return;
    setArrasto({ tipo, id, alturaBase, dx: ponto.x - posX, dz: ponto.z - posZ });
    if (controlsRef.current) controlsRef.current.enabled = false;
  };

  const terminarArrasto = useCallback(() => {
    setArrasto(null);
    if (controlsRef.current) controlsRef.current.enabled = true;
  }, []);

  return (
    <>
      <Luzes largura={L} profundidade={P} />

      <OrbitControls
        ref={controlsRef}
        target={centro}
        makeDefault
        // Não deixa passar do horizonte: por baixo do piso não há nada para
        // ver, e voltar de lá é um quebra-cabeça para quem não usa 3D.
        maxPolarAngle={Math.PI * 0.49}
        minDistance={1.5}
        maxDistance={Math.max(L, P) * 2.5 + 20}
        enableDamping
        dampingFactor={0.12}
      />

      <Piso planta={planta} mostrarGrade={mostrarGrade} onClicarNoChao={onClicarNoChao} editavel={editavel} />
      <ParedesDoPerimetro planta={planta} />

      <ArrastoNoPlano
        arrasto={arrasto}
        livre={livre}
        onArrastar={(x, z) => {
          if (!arrasto) return;
          const cmX = snap(x * 100, livre);
          const cmY = snap(z * 100, livre);
          if (arrasto.tipo === "elemento") onMoverElemento?.(arrasto.id, cmX, cmY);
          else onMoverAtivo?.(arrasto.id, cmX, cmY);
        }}
        onSoltar={terminarArrasto}
      />

      {elementos.map((el) => {
        const def = tipoElemento(el.tipo);
        const largura = M(Number(el.largura));
        const profundidade = M(Number(el.altura));
        const altura = M(alturaDoElemento(el));
        const selecionado = selecao?.tipo === "elemento" && selecao.id === el.id;
        // A âncora do banco é o canto; a da cena é o centro da peça.
        const x = M(Number(el.x)) + largura / 2;
        const z = M(Number(el.y)) + profundidade / 2;
        return (
          <group
            key={el.id}
            position={[x, 0, z]}
            rotation={[0, rad(Number(el.rotacao)), 0]}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onSelecionar({ tipo: "elemento", id: el.id });
              iniciarArrasto("elemento", el.id, 0, e.point, x, z);
            }}
          >
            <ModeloDoElemento elemento={el} largura={largura} profundidade={profundidade} altura={altura} />
            {selecionado && <Selecao largura={largura} profundidade={profundidade} altura={altura} />}
            {selecionado && el.rotulo && (
              <Html center distanceFactor={14} position={[0, altura + 0.25, 0]}>
                <span className="whitespace-nowrap rounded bg-slate-900/85 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  {el.rotulo}
                </span>
              </Html>
            )}
            {def.familia === "area" && el.rotulo && !selecionado && (
              <Html center distanceFactor={22} position={[0, 0.05, 0]}>
                <span className="whitespace-nowrap rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-700">
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
          const base = M(alturaDeApoio(a, elementos));
          const x = M(Number(a.pos_x));
          const z = M(Number(a.pos_y));
          const selecionado = selecao?.tipo === "ativo" && selecao.id === a.id;
          const apagado = !!termo && !casa(a);
          const st = statusAtivo(a.status);

          return (
            <group
              key={a.id}
              position={[x, base, z]}
              rotation={[0, rad(Number(a.rotacao)), 0]}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
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
              }}
              onPointerOut={() => setHover((h) => (h === a.id ? null : h))}
            >
              <group visible={!apagado}>
                <ModeloDoAtivo ativo={a} largura={largura} profundidade={profundidade} altura={altura} />
              </group>
              {selecionado && <Selecao largura={largura} profundidade={profundidade} altura={altura} />}

              {/* Pino de status no topo — a bolinha que se enxerga de longe. */}
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
  // A sombra precisa cobrir a planta inteira: uma shadow-camera padrão (±5)
  // corta a sombra no meio do escritório e deixa metade das mesas flutuando.
  const alcance = Math.max(largura, profundidade) * 0.75 + 6;
  return (
    <>
      <hemisphereLight args={["#ffffff", "#9aa7b5", 1.05]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        castShadow
        position={[largura * 0.6 + 8, Math.max(largura, profundidade) * 0.8 + 10, profundidade * 0.35 - 6]}
        intensity={1.35}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
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
  onClicarNoChao,
  editavel,
}: {
  planta: TiPlanta;
  mostrarGrade: boolean;
  onClicarNoChao?: (x: number, y: number) => void;
  editavel: boolean;
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
          if (!editavel || !onClicarNoChao) return;
          e.stopPropagation();
          onClicarNoChao(Math.round(e.point.x * 100), Math.round(e.point.z * 100));
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
          fadeDistance={Math.max(L, P) * 2.2}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={false}
        />
      )}
    </group>
  );
}

/**
 * O contorno do ambiente: paredes baixas no perímetro da planta.
 *
 * Existem para dar volume ao espaço mesmo numa planta recém-criada, em que
 * ninguém desenhou parede ainda — um piso solto no vazio não se lê como
 * escritório. São meia altura (1,2 m) de propósito: parede inteira no
 * perímetro tampa a vista da câmera de fora.
 */
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

/**
 * Converte o movimento do mouse em posição no mundo enquanto se arrasta.
 *
 * Projeta o ponteiro num plano matemático (não num objeto) na altura da base
 * da peça — ver o comentário do topo do arquivo sobre por que o plano de
 * colisão real não serve aqui.
 */
function ArrastoNoPlano({
  arrasto,
  onArrastar,
  onSoltar,
}: {
  arrasto: { tipo: "elemento" | "ativo"; id: string; alturaBase: number; dx: number; dz: number } | null;
  livre: boolean;
  onArrastar: (x: number, z: number) => void;
  onSoltar: () => void;
}) {
  const { camera, gl } = useThree();
  const alvo = useRef(new THREE.Vector3());
  const raycaster = useRef(new THREE.Raycaster());
  const ponteiro = useRef(new THREE.Vector2());

  useEffect(() => {
    if (!arrasto) return;
    const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -arrasto.alturaBase);
    const el = gl.domElement;

    const mover = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ponteiro.current.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(ponteiro.current, camera);
      if (raycaster.current.ray.intersectPlane(plano, alvo.current)) {
        onArrastar(alvo.current.x - arrasto.dx, alvo.current.z - arrasto.dz);
      }
    };
    const soltar = () => onSoltar();

    el.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    return () => {
      el.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
  }, [arrasto, camera, gl, onArrastar, onSoltar]);

  return null;
}

/** Legenda dos status, para a tela não precisar repetir as cores. */
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

/** Ícone do tipo, reexportado para as telas montarem paletas sem reimportar. */
export const iconeDoTipo = (tipo: string) => tipoAtivo(tipo).icone;
