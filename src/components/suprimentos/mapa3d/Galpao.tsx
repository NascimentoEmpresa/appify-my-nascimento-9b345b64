import { useMemo } from "react";
import { CORES, MEDIDAS } from "./cena";
import type { LayoutMapa } from "@/hooks/useSupEstoqueMapa";

/**
 * O salão: piso, paredes, forro, as tubulares do teto e a bancada de trabalho.
 *
 * A bancada não é enfeite — é o ponto de partida do voo da câmera ("puxar o
 * zoom desde o local onde o pessoal fica sentado mexendo nos pc até a baia do
 * item"), e por isso a posição dela vem do banco (`sup_estoque_layout.mesa_*`)
 * e não fica chumbada aqui.
 */
export function Galpao({ layout }: { layout: LayoutMapa }) {
  const L = layout.largura_m;
  const P = layout.profundidade_m;
  const H = layout.pe_direito_m;

  // Tubulares corridas no sentido da profundidade, espaçadas como no vídeo:
  // uma a cada ~3 m, centralizadas nos corredores.
  const luminarias = useMemo(() => {
    const linhas: { x: number; z: number; comprimento: number }[] = [];
    const passo = 3;
    for (let x = passo / 2; x < L; x += passo) {
      linhas.push({ x, z: P / 2, comprimento: P * 0.82 });
    }
    return linhas;
  }, [L, P]);

  return (
    <group>
      {/* Piso — porcelanato claro e polido. O brilho vem do material, não de
          uma textura: o reflexo real fica por conta da luz das tubulares. */}
      <mesh position={[L / 2, 0, P / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[L, P]} />
        <meshStandardMaterial color={CORES.piso} roughness={0.22} metalness={0.05} />
      </mesh>

      {/* Rodapé — a faixa escura que separa piso de parede */}
      {[
        { pos: [L / 2, 0.05, 0.01] as const, args: [L, 0.1, 0.02] as const },
        { pos: [L / 2, 0.05, P - 0.01] as const, args: [L, 0.1, 0.02] as const },
        { pos: [0.01, 0.05, P / 2] as const, args: [0.02, 0.1, P] as const },
        { pos: [L - 0.01, 0.05, P / 2] as const, args: [0.02, 0.1, P] as const },
      ].map((r, i) => (
        <mesh key={i} position={r.pos as any}>
          <boxGeometry args={r.args as any} />
          <meshStandardMaterial color={CORES.estanteEscura} roughness={0.9} />
        </mesh>
      ))}

      {/* Paredes — viradas para dentro */}
      <mesh position={[L / 2, H / 2, 0]} receiveShadow>
        <planeGeometry args={[L, H]} />
        <meshStandardMaterial color={CORES.parede} emissive={CORES.parede} emissiveIntensity={0.16} roughness={0.95} />
      </mesh>
      <mesh position={[L / 2, H / 2, P]} rotation={[0, Math.PI, 0]} receiveShadow>
        <planeGeometry args={[L, H]} />
        <meshStandardMaterial color={CORES.parede} emissive={CORES.parede} emissiveIntensity={0.16} roughness={0.95} />
      </mesh>
      <mesh position={[0, H / 2, P / 2]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[P, H]} />
        <meshStandardMaterial color={CORES.parede} emissive={CORES.parede} emissiveIntensity={0.16} roughness={0.95} />
      </mesh>
      <mesh position={[L, H / 2, P / 2]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[P, H]} />
        <meshStandardMaterial color={CORES.parede} emissive={CORES.parede} emissiveIntensity={0.16} roughness={0.95} />
      </mesh>

      {/* Forro. As tubulares apontam para BAIXO, então o forro não recebe luz
          quase nenhuma e sairia cinza-chumbo — no galpão real ele é branco,
          porque a luz que volta do piso claro o lava. Em vez de simular esse
          rebote (caro), o forro emite um tantinho de luz própria. */}
      <mesh position={[L / 2, H, P / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[L, P]} />
        <meshStandardMaterial
          color={CORES.forro}
          emissive={CORES.forro}
          emissiveIntensity={0.55}
          roughness={1}
        />
      </mesh>

      {/* Tubulares: a caixa que acende + a luz que ela joga */}
      {luminarias.map((lu, i) => (
        <group key={i} position={[lu.x, H - 0.06, lu.z]}>
          <mesh>
            <boxGeometry args={[0.1, 0.06, lu.comprimento]} />
            <meshStandardMaterial
              color={CORES.luminaria}
              emissive={CORES.luminaria}
              emissiveIntensity={1.6}
              toneMapped={false}
            />
          </mesh>
          <rectAreaLight
            width={0.3}
            height={lu.comprimento}
            intensity={3.2}
            color="#f4f6ff"
            position={[0, -0.05, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
        </group>
      ))}

      <Bancada layout={layout} />
    </group>
  );
}

/**
 * A bancada com os monitores e as cadeiras azuis — é literalmente a cena do
 * segundo vídeo, e é de onde a câmera arranca.
 */
function Bancada({ layout }: { layout: LayoutMapa }) {
  const rot = (layout.mesa_rotacao * Math.PI) / 180;
  const { mesaLargura: W, mesaProfundidade: D, mesaAltura: A } = MEDIDAS;

  return (
    <group position={[layout.mesa_x, 0, layout.mesa_z]} rotation={[0, rot, 0]}>
      {/* Tampo */}
      <mesh position={[W / 2, A, D / 2]} castShadow receiveShadow>
        <boxGeometry args={[W, 0.04, D]} />
        <meshStandardMaterial color="#f7f5f1" roughness={0.45} />
      </mesh>
      {/* Pés */}
      {[0.1, W - 0.1].map((x) => (
        <mesh key={x} position={[x, A / 2, D / 2]}>
          <boxGeometry args={[0.05, A, D * 0.85]} />
          <meshStandardMaterial color="#e6e2da" roughness={0.6} />
        </mesh>
      ))}

      {/* Monitores e cadeiras: três postos, como no vídeo */}
      {[0.62, 1.6, 2.58].map((x, i) => (
        <group key={i}>
          <mesh position={[x, A + 0.26, D * 0.3]} castShadow>
            <boxGeometry args={[0.52, 0.32, 0.02]} />
            <meshStandardMaterial color="#1c2430" roughness={0.35} />
          </mesh>
          <mesh position={[x, A + 0.06, D * 0.32]}>
            <boxGeometry args={[0.06, 0.12, 0.06]} />
            <meshStandardMaterial color="#20262f" roughness={0.5} />
          </mesh>
          {/* Cadeira azul */}
          <group position={[x, 0, D + 0.45]}>
            <mesh position={[0, 0.46, 0]} castShadow>
              <boxGeometry args={[0.46, 0.08, 0.44]} />
              <meshStandardMaterial color="#2b4c9b" roughness={0.8} />
            </mesh>
            <mesh position={[0, 0.72, -0.2]} castShadow>
              <boxGeometry args={[0.44, 0.44, 0.07]} />
              <meshStandardMaterial color="#2b4c9b" roughness={0.8} />
            </mesh>
            <mesh position={[0, 0.22, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 0.44, 12]} />
              <meshStandardMaterial color="#2a2f36" roughness={0.5} metalness={0.3} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}
