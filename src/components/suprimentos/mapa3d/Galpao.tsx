import { useMemo } from "react";
import { CORES, MEDIDAS } from "./cena";
import type { LayoutMapa, MarcoMapa } from "@/hooks/useSupEstoqueMapa";

/**
 * O salão: piso, paredes, forro com as vigas, as tubulares, a bancada de
 * trabalho e os marcos (coluna de concreto e portas).
 *
 * A bancada não é enfeite — é o ponto de partida do voo da câmera ("puxar o
 * zoom desde o local onde o pessoal fica sentado mexendo nos pc até a baia do
 * item"), e por isso a posição e a largura dela vêm do banco
 * (`sup_estoque_layout.mesa_*`) e não ficam chumbadas aqui.
 */
export function Galpao({ layout, marcos }: { layout: LayoutMapa; marcos: MarcoMapa[] }) {
  const L = layout.largura_m;
  const P = layout.profundidade_m;
  const H = layout.pe_direito_m;

  // Tubulares corridas no sentido da profundidade, como nas fotos: uma por
  // corredor, acompanhando o comprimento dele.
  const luminarias = useMemo(() => {
    const linhas: { x: number; z: number; comprimento: number }[] = [];
    const passo = 2.6;
    for (let x = passo / 2; x < L; x += passo) {
      linhas.push({ x, z: P / 2, comprimento: P * 0.84 });
    }
    return linhas;
  }, [L, P]);

  // Vigas de concreto atravessando o forro — aparecem em quase toda foto e
  // são o que dá escala ao teto.
  const vigas = useMemo(() => {
    const v: number[] = [];
    for (let z = 3.0; z < P; z += 3.6) v.push(z);
    return v;
  }, [P]);

  return (
    <group>
      <Piso largura={L} profundidade={P} />

      {/* Rodapé — a faixa que separa piso de parede */}
      {[
        { pos: [L / 2, 0.05, 0.01], args: [L, 0.1, 0.02] },
        { pos: [L / 2, 0.05, P - 0.01], args: [L, 0.1, 0.02] },
        { pos: [0.01, 0.05, P / 2], args: [0.02, 0.1, P] },
        { pos: [L - 0.01, 0.05, P / 2], args: [0.02, 0.1, P] },
      ].map((r, i) => (
        <mesh key={i} position={r.pos as any}>
          <boxGeometry args={r.args as any} />
          <meshStandardMaterial color={CORES.estanteEscura} roughness={0.9} />
        </mesh>
      ))}

      {/* Paredes — viradas para dentro */}
      {[
        { pos: [L / 2, H / 2, 0], rot: [0, 0, 0], args: [L, H] },
        { pos: [L / 2, H / 2, P], rot: [0, Math.PI, 0], args: [L, H] },
        { pos: [0, H / 2, P / 2], rot: [0, Math.PI / 2, 0], args: [P, H] },
        { pos: [L, H / 2, P / 2], rot: [0, -Math.PI / 2, 0], args: [P, H] },
      ].map((p, i) => (
        <mesh key={i} position={p.pos as any} rotation={p.rot as any} receiveShadow>
          <planeGeometry args={p.args as any} />
          <meshStandardMaterial
            color={CORES.parede}
            emissive={CORES.parede}
            emissiveIntensity={0.16}
            roughness={0.95}
          />
        </mesh>
      ))}

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

      {/* Vigas de concreto */}
      {vigas.map((z) => (
        <mesh key={z} position={[L / 2, H - 0.13, z]} castShadow>
          <boxGeometry args={[L, 0.26, 0.3]} />
          <meshStandardMaterial
            color={CORES.viga}
            emissive={CORES.viga}
            emissiveIntensity={0.2}
            roughness={0.95}
          />
        </mesh>
      ))}

      {/* Tubulares: a caixa que acende + a luz que ela joga */}
      {luminarias.map((lu, i) => (
        <group key={i} position={[lu.x, H - 0.3, lu.z]}>
          <mesh>
            <boxGeometry args={[0.1, 0.06, lu.comprimento]} />
            <meshStandardMaterial
              color={CORES.luminaria}
              emissive={CORES.luminaria}
              emissiveIntensity={1.7}
              toneMapped={false}
            />
          </mesh>
          <rectAreaLight
            width={0.3}
            height={lu.comprimento}
            intensity={3.4}
            color="#f4f6ff"
            position={[0, -0.05, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
        </group>
      ))}

      {marcos.map((m) => (
        <Marco key={m.id} marco={m} peDireito={H} />
      ))}

      <Bancada layout={layout} />
    </group>
  );
}

/**
 * Piso de porcelanato grande e polido. As juntas são desenhadas como linhas
 * finas por cima do piso: nas fotos elas são bem visíveis e são o que dá
 * noção de distância no corredor — sem elas o chão vira um borrão cinza.
 */
function Piso({ largura, profundidade }: { largura: number; profundidade: number }) {
  const LADO = 1.2; // porcelanato de 120 cm, como o das fotos

  const juntas = useMemo(() => {
    const linhas: { pos: [number, number, number]; args: [number, number, number] }[] = [];
    for (let x = LADO; x < largura; x += LADO) {
      linhas.push({ pos: [x, 0.002, profundidade / 2], args: [0.012, 0.001, profundidade] });
    }
    for (let z = LADO; z < profundidade; z += LADO) {
      linhas.push({ pos: [largura / 2, 0.002, z], args: [largura, 0.001, 0.012] });
    }
    return linhas;
  }, [largura, profundidade]);

  return (
    <group>
      <mesh position={[largura / 2, 0, profundidade / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[largura, profundidade]} />
        <meshStandardMaterial color={CORES.piso} roughness={0.18} metalness={0.06} />
      </mesh>
      {juntas.map((j, i) => (
        <mesh key={i} position={j.pos}>
          <boxGeometry args={j.args} />
          <meshStandardMaterial color={CORES.pisoJunta} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/** Coluna de concreto e portas — o que faz a pessoa se localizar no salão. */
function Marco({ marco, peDireito }: { marco: MarcoMapa; peDireito: number }) {
  const altura = marco.altura_m ?? peDireito;
  const cx = marco.pos_x + marco.largura_m / 2;
  const cz = marco.pos_z + marco.profundidade_m / 2;

  if (marco.tipo === "pilar") {
    return (
      <mesh position={[cx, altura / 2, cz]} castShadow receiveShadow>
        <boxGeometry args={[marco.largura_m, altura, marco.profundidade_m]} />
        <meshStandardMaterial color={CORES.pilar} roughness={0.9} />
      </mesh>
    );
  }

  // Portas: chapa metálica cinza, embutida na parede.
  return (
    <group>
      <mesh position={[cx, altura / 2, cz]} castShadow>
        <boxGeometry args={[Math.max(marco.largura_m, 0.06), altura, Math.max(marco.profundidade_m, 0.06)]} />
        <meshStandardMaterial color={CORES.porta} roughness={0.55} metalness={0.25} />
      </mesh>
      {/* Batente claro em volta, para a porta não sumir na parede */}
      <mesh position={[cx, altura + 0.05, cz]}>
        <boxGeometry args={[marco.largura_m + 0.12, 0.08, marco.profundidade_m + 0.12]} />
        <meshStandardMaterial color="#e8e6e0" roughness={0.9} />
      </mesh>
    </group>
  );
}

/**
 * A bancada com os monitores e as cadeiras azuis — é a cena das fotos, e é de
 * onde a câmera arranca. A largura vem do banco: no croqui ela atravessa
 * quase todo o fundo do salão, não é uma mesinha de canto.
 */
function Bancada({ layout }: { layout: LayoutMapa }) {
  const rot = (layout.mesa_rotacao * Math.PI) / 180;
  const W = layout.mesa_largura_m;
  const { mesaProfundidade: D, mesaAltura: A } = MEDIDAS;

  // Um posto de trabalho a cada ~1,6 m de bancada.
  const postos = useMemo(() => {
    const n = Math.max(1, Math.round(W / 1.6));
    return Array.from({ length: n }, (_, i) => (W * (i + 0.5)) / n);
  }, [W]);

  return (
    <group position={[layout.mesa_x, 0, layout.mesa_z]} rotation={[0, rot, 0]}>
      <mesh position={[W / 2, A, D / 2]} castShadow receiveShadow>
        <boxGeometry args={[W, 0.04, D]} />
        <meshStandardMaterial color="#f7f5f1" roughness={0.45} />
      </mesh>
      {[0.1, W - 0.1].map((x) => (
        <mesh key={x} position={[x, A / 2, D / 2]}>
          <boxGeometry args={[0.05, A, D * 0.85]} />
          <meshStandardMaterial color="#e6e2da" roughness={0.6} />
        </mesh>
      ))}

      {postos.map((x, i) => (
        <group key={i}>
          <mesh position={[x, A + 0.26, D * 0.3]} castShadow>
            <boxGeometry args={[0.52, 0.32, 0.02]} />
            <meshStandardMaterial color="#1c2430" roughness={0.35} />
          </mesh>
          <mesh position={[x, A + 0.06, D * 0.32]}>
            <boxGeometry args={[0.06, 0.12, 0.06]} />
            <meshStandardMaterial color="#20262f" roughness={0.5} />
          </mesh>
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
