import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { TiAtivo, TiCelula, TiElemento, TiPlanta } from "@/hooks/useTiMapa";
import { statusAtivo, tipoAtivo, tipoElemento } from "../mapa/catalogo";
import {
  M,
  alturaDeApoio,
  alturaDoAndar,
  arestasDoContorno,
  bordaParaRemover,
  celulasDoRetangulo,
  chaveCelula,
  contornoParaExpandir,
  alturaDoElemento,
  camaraInicial,
  cantoDaPeca,
  centroDaPeca,
  dimensoesAtivo,
  pontasDaParede,
  rad,
  redimensionarPorCanto,
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
  /** Fim do redimensionamento (puxar parede pela ponta, esticar sala pela quina). */
  onRedimensionar?: (id: string, patch: Partial<TiElemento>) => void;
  /**
   * Os quadrados que formam o piso. Vazio = planta antiga, ainda retangular:
   * a cena desenha o retângulo inteiro (ver `celulasDoRetangulo`).
   */
  celulas?: TiCelula[];
  /** Clique num "+" (ocupar) ou "−" (liberar) de UM quadrado de 1 m². */
  onDefinirCelula?: (cx: number, cy: number, ocupar: boolean) => void;
  onAbrirFicha?: (ativoId: string) => void;
  /**
   * Andares abaixo/acima, desenhados translúcidos e SEM interação.
   *
   * Servem de referência ("a sala do 2º fica em cima de qual?") sem virar um
   * segundo editor: quem edita é sempre o andar corrente, e peça de outro
   * andar não deve responder a clique nem entrar no raycast do arrasto.
   */
  andaresVizinhos?: {
    planta: TiPlanta;
    elementos: TiElemento[];
    ativos: TiAtivo[];
    celulas?: TiCelula[];
  }[];
  /** Todas as plantas — a cena precisa delas para calcular a altura do andar. */
  plantas?: TiPlanta[];
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
  onRedimensionar,
  celulas,
  onDefinirCelula,
  onAbrirFicha,
  andaresVizinhos = [],
  plantas = [],
}: Props) {
  const L = M(planta.largura_cm);
  const P = M(planta.altura_cm);
  // O andar corrente é desenhado na altura dele, não em y=0: assim ele fica no
  // lugar certo em relação aos vizinhos quando os dois estão visíveis.
  const base = M(alturaDoAndar(plantas.length ? plantas : [planta], planta.nivel ?? 0));
  const centro = useMemo<[number, number, number]>(() => [L / 2, base, P / 2], [L, base, P]);

  const { invalidate } = useThree();
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);

  // Posição durante o arrasto: local, sem tocar no banco. Ver o cabeçalho.
  const [previa, setPrevia] = useState<Record<string, { x: number; y: number }>>({});
  const [arrasto, setArrasto] = useState<
    { tipo: "elemento" | "ativo"; id: string; alturaBase: number; dx: number; dz: number } | null
  >(null);
  const [traco, setTraco] = useState<TracoNoChao | null>(null);
  // Puxar parede / esticar sala: guarda a peça e a alça pega.
  const [resize, setResize] = useState<{ el: TiElemento; alca: "a" | "b" | "nw" | "ne" | "sw" | "se" } | null>(null);
  const [previaResize, setPreviaResize] = useState<Partial<TiElemento> | null>(null);
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

  // Planta antiga (sem célula) desenha como o retângulo que sempre foi.
  const celulasDoPiso = useMemo(
    () => (celulas && celulas.length > 0 ? celulas : celulasDoRetangulo(planta.largura_cm, planta.altura_cm)),
    [celulas, planta.largura_cm, planta.altura_cm],
  );

  /**
   * A peça selecionada COMO ELA ESTÁ NA TELA agora — já com o que estiver
   * sendo arrastado ou esticado.
   *
   * As alças e a caixa de seleção se penduram nisto. Antes olhavam só o dado
   * do banco: enquanto a peça era arrastada, o contorno e as bolinhas ficavam
   * parados no lugar antigo, como se fossem de outro objeto.
   */
  const elementoSelecionado = useMemo(() => {
    if (selecao?.tipo !== "elemento") return null;
    const cru = elementos.find((e) => e.id === selecao.id);
    if (!cru) return null;

    const comResize =
      previaResize && resize?.el.id === cru.id ? ({ ...cru, ...previaResize } as TiElemento) : cru;

    const p = previa[cru.id];
    if (!p) return comResize;
    const canto = cantoDaPeca(p.x, p.y, comResize.largura, comResize.altura);
    return { ...comResize, x: canto.x, y: canto.y } as TiElemento;
  }, [selecao, elementos, previaResize, resize, previa]);

  const termo = (destaque ?? "").trim().toLowerCase();
  const casa = useCallback(
    (a: TiAtivo) =>
      !termo ||
      [a.nome, a.codigo, a.patrimonio, a.ip, a.hostname, a.responsavel_nome, a.setor]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo)),
    [termo],
  );

  const aplicarResize = (px: number, py: number) => {
    if (!resize) return;
    const { el, alca } = resize;
    if (alca === "a" || alca === "b") {
      // Puxar a parede pela ponta: a outra ponta fica onde está.
      const { a, b } = pontasDaParede(el);
      const fixo = alca === "a" ? b : a;
      const r = retanguloDoTraco(fixo.x, fixo.y, px, py, Number(el.altura));
      setPreviaResize({ x: r.x, y: r.y, largura: Math.max(10, r.largura), rotacao: r.rotacao });
    } else {
      setPreviaResize(redimensionarPorCanto(el, alca, px, py));
    }
    invalidate();
  };

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

      {/* Andares vizinhos: referência translúcida, sem interação. */}
      {andaresVizinhos.map((a) => (
        <AndarFantasma
          key={a.planta.id}
          planta={a.planta}
          elementos={a.elementos}
          ativos={a.ativos}
          celulas={a.celulas}
          base={M(alturaDoAndar(plantas.length ? plantas : [a.planta], a.planta.nivel ?? 0))}
        />
      ))}

      {/* O andar que está sendo editado/visto. Só o Y muda: X e Z continuam
          sendo as coordenadas do banco, e é por isso que o arrasto (que
          trabalha em coordenadas de mundo) não precisa saber de andar. */}
      <group position={[0, base, 0]}>
      <Piso
        planta={planta}
        celulas={celulasDoPiso}
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

      <ParedesDoContorno celulas={celulasDoPiso} planta={planta} />

      {/*
        Os marcadores de piso aparecem com a grade ligada e SEM ferramenta na
        mão: com uma peça selecionada para desenhar, eles roubariam o clique
        que deveria começar a parede.
      */}
      {editavel && mostrarGrade && !desenhando && onDefinirCelula && (
        <MarcadoresDeCelula celulas={celulasDoPiso} onDefinir={onDefinirCelula} />
      )}

      <PonteiroNoPlano
        ativo={!!arrasto || !!traco || !!resize}
        altura={(arrasto?.alturaBase ?? 0) + base}
        onMover={(x, z) => {
          if (resize) {
            aplicarResize(snap(x * 100, livre), snap(z * 100, livre));
          } else if (arrasto) {
            moverLocal(x - arrasto.dx, z - arrasto.dz);
          } else if (traco) {
            const x2 = snap(x * 100, livre);
            const y2 = snap(z * 100, livre);
            setTraco((t) => (t ? { ...t, x2, y2, clique: false } : t));
            invalidate();
          }
        }}
        onSoltar={() => {
          if (resize) {
            if (previaResize) onRedimensionar?.(resize.el.id, previaResize);
            setResize(null);
            setPreviaResize(null);
            travarCamera(false);
            invalidate();
            return;
          }
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

      {elementos.map((cru) => {
        // Enquanto a alça está sendo puxada, a peça desenha com a medida
        // provisória — o banco só recebe no soltar.
        const el =
          previaResize && resize?.el.id === cru.id ? ({ ...cru, ...previaResize } as TiElemento) : cru;
        const def = tipoElemento(el.tipo);
        const largura = M(Number(el.largura));
        const profundidade = M(Number(el.altura));
        const altura = M(alturaDoElemento(el));
        const selecionado = selecao?.tipo === "elemento" && selecao.id === el.id;
        const pos = previa[el.id];
        // ⚠ `previa` guarda o CENTRO (é o que o arrasto calcula); `el.x`/`el.y`
        // guardam o CANTO (é o que o banco grava). Somar largura/2 nos dois
        // fazia a peça saltar meia largura no instante em que se começava a
        // arrastar — a mesa "pulava" para fora da sala.
        const centro = pos ?? centroDaPeca(el);
        const x = M(centro.x);
        const z = M(centro.y);
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

      {/* Alças de manipulação: puxar a parede pelas pontas, esticar a sala
          pelas quinas. Ficam por último para desenhar por cima das peças. */}
      {editavel && !desenhando && elementoSelecionado && (
        <Alcas
          el={elementoSelecionado}
          previa={previaResize}
          onPegar={(alca) => {
            setResize({ el: elementoSelecionado, alca });
            setPreviaResize(null);
            travarCamera(true);
          }}
        />
      )}
      </group>
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

/**
 * UM mesh para o piso inteiro, montado com dois triângulos por quadrado.
 *
 * A alternativa óbvia — um `<mesh>` por célula — custa centenas de objetos na
 * cena num andar de 20×15, e cada um deles entra no raycast a cada movimento
 * do mouse. Aqui o piso é uma geometria só: o clique continua funcionando (é
 * o mesmo plano) e o custo não cresce com o tamanho do escritório.
 *
 * Compartilhada entre o andar corrente e os andares vizinhos — foi por não
 * ser compartilhada que o Mapa desenhava um retângulo onde o Construir já
 * mostrava o piso recortado.
 */
function useGeometriaDoPiso(celulas: TiCelula[]) {
  const geometria = useMemo(() => {
    const posicoes = new Float32Array(celulas.length * 18);
    const normais = new Float32Array(celulas.length * 18);
    celulas.forEach((c, i) => {
      const x0 = c.cx;
      const z0 = c.cy;
      const x1 = x0 + 1;
      const z1 = z0 + 1;
      // dois triângulos: (x0,z0)-(x1,z0)-(x1,z1) e (x0,z0)-(x1,z1)-(x0,z1)
      const v = [x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1];
      posicoes.set(v, i * 18);
      for (let k = 0; k < 6; k++) normais.set([0, 1, 0], i * 18 + k * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(posicoes, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normais, 3));
    return g;
  }, [celulas]);

  useEffect(() => () => geometria.dispose(), [geometria]);
  return geometria;
}

function Piso({
  planta,
  celulas,
  mostrarGrade,
  editavel,
  desenhando,
  livre,
  onComecarTraco,
}: {
  planta: TiPlanta;
  celulas: TiCelula[];
  mostrarGrade: boolean;
  editavel: boolean;
  desenhando: boolean;
  livre: boolean;
  onComecarTraco: (t: TracoNoChao) => void;
}) {
  const L = M(planta.largura_cm);
  const P = M(planta.altura_cm);

  const geometria = useGeometriaDoPiso(celulas);

  return (
    <group>
      <mesh
        receiveShadow
        geometry={geometria}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          if (!editavel || !desenhando) return;
          e.stopPropagation();
          const x = snap(e.point.x * 100, livre);
          const y = snap(e.point.z * 100, livre);
          onComecarTraco({ x1: x, y1: y, x2: x, y2: y, clique: true });
        }}
      >
        <meshStandardMaterial color={planta.cor_piso || "#eef2f7"} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {mostrarGrade && (
        <Grid
          position={[L / 2, 0.006, P / 2]}
          args={[L, P]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#aebbcc"
          sectionSize={5}
          sectionThickness={1.3}
          sectionColor="#7f92a8"
          fadeDistance={Math.max(L, P) * 2.4}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={false}
        />
      )}
    </group>
  );
}

/**
 * As paredes externas, correndo pelo CONTORNO do piso.
 *
 * Antes eram quatro caixas no retângulo da planta — o que, com o piso feito de
 * células, mentia: num andar em L a parede cortava o vazio e deixava o recorte
 * aberto. Agora cada trecho do contorno vira uma parede, então ela acompanha o
 * formato desenhado, seja qual for.
 *
 * Meia altura (1,3 m no máximo) de propósito: parede inteira no perímetro tapa
 * a vista da câmera, que olha de fora e de cima.
 */
function ParedesDoContorno({ celulas, planta }: { celulas: TiCelula[]; planta: TiPlanta }) {
  const arestas = useMemo(() => arestasDoContorno(celulas), [celulas]);
  const h = Math.min(M(planta.pe_direito_cm ?? 280) * 0.42, 1.3);
  const e = 0.1;

  return (
    <group>
      {arestas.map((a, i) => {
        const horizontal = a.y1 === a.y2;
        const comprimento = horizontal ? a.x2 - a.x1 : a.y2 - a.y1;
        const cx = horizontal ? (a.x1 + a.x2) / 2 : a.x1;
        const cz = horizontal ? a.y1 : (a.y1 + a.y2) / 2;
        return (
          <mesh
            key={`${a.x1}-${a.y1}-${a.x2}-${a.y2}-${i}`}
            castShadow
            receiveShadow
            position={[cx, h / 2, cz]}
            raycast={() => null}
          >
            <boxGeometry
              args={horizontal ? [comprimento + e, h, e] : [e, h, comprimento + e]}
            />
            <meshStandardMaterial color="#c3ccd8" roughness={0.9} />
          </mesh>
        );
      })}
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

/**
 * Um andar que não está sendo editado: translúcido, sem sombra e sem eventos.
 *
 * `raycast={() => null}` em vez de `pointerEvents`: three não tem CSS, e sem
 * desligar o raycast o clique atravessaria para a peça do outro andar — que é
 * exatamente o acidente que a translucidez promete evitar.
 */
function AndarFantasma({
  planta,
  elementos,
  ativos,
  celulas,
  base,
}: {
  planta: TiPlanta;
  elementos: TiElemento[];
  ativos: TiAtivo[];
  celulas?: TiCelula[];
  base: number;
}) {
  const L = M(planta.largura_cm);
  const doPiso = useMemo(
    () =>
      celulas && celulas.length > 0
        ? celulas
        : celulasDoRetangulo(planta.largura_cm, planta.altura_cm),
    [celulas, planta.largura_cm, planta.altura_cm],
  );
  const geometria = useGeometriaDoPiso(doPiso);
  return (
    <group position={[0, base, 0]} raycast={() => null}>
      <mesh geometry={geometria} raycast={() => null}>
        <meshStandardMaterial
          color={planta.cor_piso || "#eef2f7"}
          transparent
          opacity={0.35}
          roughness={1}
          side={THREE.DoubleSide}
        />
      </mesh>
      <group>
        {elementos.map((el) => {
          const largura = M(Number(el.largura));
          const profundidade = M(Number(el.altura));
          const altura = M(alturaDoElemento(el));
          return (
            <group
              key={el.id}
              position={[M(Number(el.x)) + largura / 2, 0, M(Number(el.y)) + profundidade / 2]}
              rotation={[0, rad(Number(el.rotacao)), 0]}
              raycast={() => null}
            >
              <ModeloDoElemento elemento={el} largura={largura} profundidade={profundidade} altura={altura} />
            </group>
          );
        })}
        {ativos
          .filter((a) => a.planta_id === planta.id && a.pos_x != null)
          .map((a) => {
            const { largura, profundidade, altura } = dimensoesAtivo(a);
            return (
              <group
                key={a.id}
                position={[M(Number(a.pos_x)), M(alturaDeApoio(a, elementos)), M(Number(a.pos_y))]}
                rotation={[0, rad(Number(a.rotacao)), 0]}
                raycast={() => null}
              >
                <ModeloDoAtivo ativo={a} largura={largura} profundidade={profundidade} altura={altura} />
              </group>
            );
          })}
      </group>
      <Html center distanceFactor={26} position={[L / 2, 0.4, -0.6]}>
        <span className="whitespace-nowrap rounded bg-slate-900/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {planta.nome}
        </span>
      </Html>
    </group>
  );
}

/**
 * Os marcadores que moldam o piso, um por quadrado de 1 m².
 *
 *   "+" fora, encostado no piso  → aquele metro quadrado passa a existir;
 *   "−" nos quadrados de borda   → aquele metro quadrado deixa de existir.
 *
 * É assim que um retângulo vira um L: clicar num "+" da direita embaixo
 * acrescenta SÓ aquele quadrado, não a fileira inteira.
 *
 * Célula cercada por todos os lados não recebe "−" — tirar um quadrado do
 * meio abriria um buraco no piso, que ninguém quer de propósito.
 */
function MarcadoresDeCelula({
  celulas,
  onDefinir,
}: {
  celulas: TiCelula[];
  onDefinir: (cx: number, cy: number, ocupar: boolean) => void;
}) {
  const fora = useMemo(() => contornoParaExpandir(celulas), [celulas]);
  const borda = useMemo(() => bordaParaRemover(celulas), [celulas]);

  return (
    <group>
      {fora.map((c) => (
        <MarcadorNoChao
          key={`mais-${chaveCelula(c.cx, c.cy)}`}
          cx={c.cx}
          cy={c.cy}
          modo="mais"
          onClicar={() => onDefinir(c.cx, c.cy, true)}
        />
      ))}
      {borda.map((c) => (
        <MarcadorNoChao
          key={`menos-${chaveCelula(c.cx, c.cy)}`}
          cx={c.cx}
          cy={c.cy}
          modo="menos"
          onClicar={() => onDefinir(c.cx, c.cy, false)}
        />
      ))}
    </group>
  );
}

/** Um quadrado clicável com "+" ou "−" desenhado — acende ao passar o mouse. */
function MarcadorNoChao({
  cx,
  cy,
  modo,
  onClicar,
}: {
  cx: number;
  cy: number;
  modo: "mais" | "menos";
  onClicar: () => void;
}) {
  const [aceso, setAceso] = useState(false);
  const mais = modo === "mais";
  // O "−" fica quase invisível parado: ele mora EM CIMA do piso existente, e
  // um marcador forte em cada quadrado de borda poluiria a planta inteira.
  const opacidade = aceso ? 0.5 : mais ? 0.18 : 0.05;
  const cor = aceso ? (mais ? "#0ea5e9" : "#ef4444") : "#94a3b8";
  const corSinal = aceso ? "#ffffff" : mais ? "#64748b" : "#94a3b8";

  return (
    <group
      position={[cx + 0.5, 0.03, cy + 0.5]}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onClicar();
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setAceso(true);
      }}
      onPointerOut={() => setAceso(false)}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshBasicMaterial color={cor} transparent opacity={opacidade} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.42, 0.09]} />
        <meshBasicMaterial color={corSinal} transparent opacity={aceso ? 1 : 0.7} depthWrite={false} />
      </mesh>
      {mais && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.09, 0.42]} />
          <meshBasicMaterial color={corSinal} transparent opacity={aceso ? 1 : 0.7} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** Uma bola de puxar: esfera visível + esfera invisível maior, para acertar. */
function Alca({
  posicao,
  onPegar,
}: {
  posicao: [number, number, number];
  onPegar: () => void;
}) {
  const pegar = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onPegar();
  };
  return (
    <group position={posicao}>
      {/* A área de clique é 2,5× maior que a bola desenhada: mirar numa esfera
          de 15 cm num mapa de 20 m é frustrante, e aumentar o desenho todo
          esconderia a peça embaixo. */}
      <mesh onPointerDown={pegar} visible={false}>
        <sphereGeometry args={[0.38, 8, 6]} />
      </mesh>
      <mesh onPointerDown={pegar}>
        <sphereGeometry args={[0.15, 16, 14]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.6} />
      </mesh>
      {/* Anel no chão, para a alça ser vista mesmo com a peça na frente. */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.28, 20]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

/**
 * As alças de manipulação da peça selecionada.
 *
 * Peça alongada (parede, divisória, janela) ganha DUAS alças, nas pontas:
 * puxar uma delas muda comprimento e ângulo de uma vez, que é como se ajusta
 * parede. As demais ganham QUATRO, nas quinas, e esticam o retângulo com o
 * canto oposto parado.
 *
 * Enquanto se puxa, a medida aparece em metros ao lado — sem isso, "aumentar
 * um quadrado" vira tentativa e erro contra o grid.
 */
function Alcas({
  el,
  previa,
  onPegar,
}: {
  el: TiElemento;
  previa: Partial<TiElemento> | null;
  onPegar: (alca: "a" | "b" | "nw" | "ne" | "sw" | "se") => void;
}) {
  const peca = previa ? ({ ...el, ...previa } as TiElemento) : el;
  const def = tipoElemento(peca.tipo);
  const altura = M(alturaDoElemento(peca)) + 0.15;
  const metros = (cm: number) => `${(cm / 100).toFixed(2).replace(".", ",")} m`;

  if (def.familia === "estrutura") {
    const { a, b } = pontasDaParede(peca);
    return (
      <>
        <Alca posicao={[M(a.x), altura, M(a.y)]} onPegar={() => onPegar("a")} />
        <Alca posicao={[M(b.x), altura, M(b.y)]} onPegar={() => onPegar("b")} />
        <Html
          center
          distanceFactor={16}
          position={[M((a.x + b.x) / 2), altura + 0.35, M((a.y + b.y) / 2)]}
        >
          <span className="pointer-events-none whitespace-nowrap rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white shadow">
            {metros(Number(peca.largura))}
          </span>
        </Html>
      </>
    );
  }

  const x0 = M(Number(peca.x));
  const y0 = M(Number(peca.y));
  const x1 = x0 + M(Number(peca.largura));
  const y1 = y0 + M(Number(peca.altura));
  const quinas: [("nw" | "ne" | "sw" | "se"), number, number][] = [
    ["nw", x0, y0],
    ["ne", x1, y0],
    ["sw", x0, y1],
    ["se", x1, y1],
  ];
  return (
    <>
      {quinas.map(([nome, px, pz]) => (
        <Alca key={nome} posicao={[px, altura, pz]} onPegar={() => onPegar(nome)} />
      ))}
      <Html center distanceFactor={16} position={[(x0 + x1) / 2, altura + 0.35, (y0 + y1) / 2]}>
        <span className="pointer-events-none whitespace-nowrap rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white shadow">
          {metros(Number(peca.largura))} × {metros(Number(peca.altura))}
        </span>
      </Html>
    </>
  );
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
