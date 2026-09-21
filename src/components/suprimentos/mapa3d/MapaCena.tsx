import { Suspense, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, SoftShadows } from "@react-three/drei";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { Galpao } from "./Galpao";
import { Corredores, type CaixoteRef } from "./Corredores";
import { CameraCinematica, type Voo } from "./CameraCinematica";
import { MEDIDAS } from "./cena";
import type { CorredorMapa } from "@/lib/suprimentos/enderecoEstoque";
import type { CaixoteOcupado, LayoutMapa, MarcoMapa } from "@/hooks/useSupEstoqueMapa";

/**
 * A cena inteira do mapa 3D.
 *
 * `rectAreaLight` (a luz retangular das tubulares, que é o que dá o brilho
 * comprido na madeira) precisa que as uniformes sejam carregadas uma vez
 * antes do primeiro render — sem isso a luz simplesmente não aparece, sem
 * erro no console.
 */
RectAreaLightUniformsLib.init();

interface Props {
  layout: LayoutMapa;
  corredores: CorredorMapa[];
  marcos: MarcoMapa[];
  porCaixote: Map<string, CaixoteOcupado>;
  destaque: CaixoteRef | null;
  selecionado: CaixoteRef | null;
  colunaEmEdicao: string | null;
  voo: Voo | null;
  onClicarCaixote: (c: CaixoteRef) => void;
  onClicarVazio: () => void;
  aoPousar?: () => void;
}

export function MapaCena({
  layout, corredores, marcos, porCaixote, destaque, selecionado,
  colunaEmEdicao, voo, onClicarCaixote, onClicarVazio, aoPousar,
}: Props) {
  const controles = useRef<any>(null);

  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 58, near: 0.05, far: 120 }}
      onPointerMissed={onClicarVazio}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.background = new THREE.Color("#e9e7e2");
        // Névoa levíssima: dá profundidade ao corredor comprido sem lavar a
        // imagem. Começa depois das prateleiras mais próximas.
        scene.fog = new THREE.Fog("#e9e7e2", 14, 42);
      }}
    >
      <PosicaoInicial layout={layout} controles={controles} />

      <SoftShadows size={26} samples={12} focus={0.85} />

      {/* Luz ambiente baixa: o galpão é iluminado pelas tubulares, e ambiente
          alto demais apaga as sombras que dão volume às prateleiras. */}
      <ambientLight intensity={0.5} color="#eef1f6" />
      <hemisphereLight args={["#f2f5ff", "#b9b2a4", 0.45]} />

      {/* Uma direcional só, alta, para as sombras de contato — mais de uma
          direcional com sombra derruba o desempenho e ninguém nota. */}
      <directionalLight
        position={[layout.largura_m * 0.65, layout.pe_direito_m * 2.4, layout.profundidade_m * 0.3]}
        intensity={0.85}
        color="#ffffff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
      />

      <Suspense fallback={null}>
        <Galpao layout={layout} marcos={marcos} />
        <Corredores
          corredores={corredores}
          porCaixote={porCaixote}
          destaque={destaque}
          selecionado={selecionado}
          colunaEmEdicao={colunaEmEdicao}
          onClicarCaixote={onClicarCaixote}
        />
      </Suspense>

      <CameraCinematica
        voo={voo}
        controles={controles}
        peDireito={layout.pe_direito_m}
        aoPousar={aoPousar}
      />

      <OrbitControls
        ref={controles}
        makeDefault
        enablePan
        enableDamping
        dampingFactor={0.08}
        minDistance={0.45}
        maxDistance={Math.max(layout.largura_m, layout.profundidade_m) * 1.6}
        // Não deixa a câmera ir para debaixo do piso nem virar de cabeça
        // para baixo — o galpão só existe acima do chão.
        maxPolarAngle={Math.PI / 2 - 0.02}
        minPolarAngle={0.12}
      />
    </Canvas>
  );
}

/**
 * Onde a câmera nasce: sentada na bancada, olhando para dentro do salão. É o
 * mesmo enquadramento das fotos, e é o começo do voo.
 */
function PosicaoInicial({
  layout, controles,
}: {
  layout: LayoutMapa;
  controles: React.MutableRefObject<any>;
}) {
  const jaPosicionou = useRef(false);

  useEffect(() => {
    if (jaPosicionou.current) return;
    jaPosicionou.current = true;
    const c = controles.current;
    if (!c) return;
    const pv = pontoDeVistaMesa(layout);
    (c.object as THREE.PerspectiveCamera).position.set(pv.posicao.x, pv.posicao.y, pv.posicao.z);
    c.target.set(pv.alvo.x, pv.alvo.y, pv.alvo.z);
    c.update();
  });

  return null;
}

/** Posição da câmera "sentado na bancada" — usada também pelo botão de voltar. */
export function pontoDeVistaMesa(layout: LayoutMapa) {
  // A bancada fica no fundo do salão e olha para dentro; a câmera senta nela
  // e mira no meio da profundidade, que é onde os corredores começam.
  const rot = (layout.mesa_rotacao * Math.PI) / 180;
  const meioX = layout.mesa_x + (layout.mesa_largura_m / 2) * Math.cos(rot);
  const meioZ = layout.mesa_z - (layout.mesa_largura_m / 2) * Math.sin(rot);

  return {
    posicao: {
      x: Math.min(Math.max(meioX, 0.4), layout.largura_m - 0.4),
      y: MEDIDAS.olhoSentado,
      z: Math.min(Math.max(meioZ + 0.9, 0.4), layout.profundidade_m - 0.3),
    },
    alvo: { x: layout.largura_m / 2, y: 1.35, z: layout.profundidade_m * 0.35 },
  };
}

/** Enquadramento de cima, para ver a planta inteira. */
export function pontoDeVistaGeral(layout: LayoutMapa) {
  return {
    posicao: {
      x: layout.largura_m / 2,
      y: Math.max(layout.largura_m, layout.profundidade_m) * 0.95,
      z: layout.profundidade_m * 1.32,
    },
    alvo: { x: layout.largura_m / 2, y: 0.9, z: layout.profundidade_m / 2 },
  };
}
