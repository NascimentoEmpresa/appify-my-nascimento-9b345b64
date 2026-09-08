import { useMemo } from "react";
import { DoubleSide } from "three";
import { M, trechosSolidos } from "./apoio";
import { tipoAtivo, tipoElemento } from "../mapa/catalogo";
import type { TiAtivo, TiElemento } from "@/hooks/useTiMapa";

/**
 * Os modelos 3D do escritório.
 *
 * Cada objeto é montado com primitivas (caixas, cilindros, cones) em vez de
 * carregado de um arquivo .glb. É decisão, não limitação:
 *
 *   • um pacote de modelos prontos são dezenas de MB baixados a cada visita,
 *     num ERP que já entrega um bundle de 8 MB;
 *   • licença de asset de terceiro é problema jurídico dentro de sistema
 *     interno da empresa;
 *   • e um monitor É uma tela sobre uma haste sobre uma base. Com sombra e
 *     material decente, primitiva bem proporcionada lê como monitor.
 *
 * CONVENÇÃO, válida para todos: o modelo nasce com a BASE em y = 0, centrado
 * em x = 0 e z = 0, e ocupa largura(X) × profundidade(Z) × altura(Y) em
 * METROS. Quem posiciona e gira é a cena — o modelo só sabe a própria forma.
 */

/** Tons auxiliares — o escuro do plástico, o vidro da tela, o metal. */
const PRETO = "#1e2530";
const GRAFITE = "#39414f";
const VIDRO = "#0f1720";
const METAL = "#94a3b8";
const MADEIRA_ESCURA = "#8a6236";

interface PropsModelo {
  /** Cor base, vinda do catálogo ou escolhida no editor. */
  cor: string;
  largura: number;
  profundidade: number;
  altura: number;
  ligado?: boolean;
  /**
   * Trechos vazados da peça, em METROS medidos da ponta esquerda (local -x).
   *
   * Quem calcula é a cena, que é a única que enxerga as outras peças; o
   * modelo só desenha o que sobra. Ver `vaosNaParede`, em apoio.ts.
   */
  vaos?: { de: number; ate: number; altura: number }[];
}

// ── Equipamentos ──────────────────────────────────────────────────────

function Desktop({ cor, largura, profundidade, altura, ligado }: PropsModelo) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.45} metalness={0.35} />
      </mesh>
      {/* Frente: a faixa escura dos drives e o LED de energia. */}
      <mesh position={[0, altura * 0.62, profundidade / 2 + 0.002]}>
        <planeGeometry args={[largura * 0.8, altura * 0.12]} />
        <meshStandardMaterial color={PRETO} roughness={0.6} />
      </mesh>
      {/* Ventoinha frontal: o círculo escuro que se enxerga em qualquer
          gabinete visto de frente. */}
      <mesh position={[-largura * 0.22, altura * 0.35, profundidade / 2 + 0.003]}>
        <ringGeometry args={[Math.min(0.03, largura * 0.14), Math.min(0.05, largura * 0.22), 16]} />
        <meshStandardMaterial color={PRETO} roughness={0.8} />
      </mesh>
      {/* Painel lateral, um tom mais escuro — quebra o bloco de cor única. */}
      <mesh position={[largura / 2 + 0.002, altura / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[profundidade * 0.88, altura * 0.86]} />
        <meshStandardMaterial color={sombrear(cor, -10)} roughness={0.55} metalness={0.3} />
      </mesh>
      <mesh position={[largura * 0.3, altura * 0.28, profundidade / 2 + 0.004]}>
        <circleGeometry args={[Math.min(0.012, largura * 0.06), 12]} />
        <meshStandardMaterial
          color={ligado ? "#4ade80" : "#475569"}
          emissive={ligado ? "#22c55e" : "#000000"}
          emissiveIntensity={ligado ? 1.6 : 0}
        />
      </mesh>
    </group>
  );
}

function Monitor({ cor, largura, altura, ligado }: PropsModelo) {
  const tela = altura * 0.72;
  return (
    <group>
      {/* base + haste: é o que dá a leitura de "monitor" de longe */}
      <mesh castShadow position={[0, 0.008, 0]}>
        <cylinderGeometry args={[largura * 0.18, largura * 0.2, 0.016, 20]} />
        <meshStandardMaterial color={GRAFITE} roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh castShadow position={[0, altura * 0.16, 0]}>
        <boxGeometry args={[largura * 0.07, altura * 0.3, 0.02]} />
        <meshStandardMaterial color={GRAFITE} roughness={0.5} metalness={0.5} />
      </mesh>
      {/* moldura */}
      <mesh castShadow position={[0, altura - tela / 2, 0]}>
        <boxGeometry args={[largura, tela, 0.022]} />
        <meshStandardMaterial color={cor} roughness={0.4} metalness={0.3} />
      </mesh>
      {/* tela: acende quando a máquina está em uso */}
      <mesh position={[0, altura - tela / 2, 0.013]}>
        <planeGeometry args={[largura * 0.93, tela * 0.88]} />
        <meshStandardMaterial
          color={ligado ? "#1d4ed8" : VIDRO}
          emissive={ligado ? "#3b82f6" : "#000000"}
          emissiveIntensity={ligado ? 0.55 : 0}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
}

function Notebook({ cor, largura, profundidade, ligado }: PropsModelo) {
  const esp = 0.012;
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, esp / 2, 0]}>
        <boxGeometry args={[largura, esp, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.4} metalness={0.4} />
      </mesh>
      {/* teclado */}
      <mesh position={[0, esp + 0.001, profundidade * 0.1]}>
        <planeGeometry args={[largura * 0.82, profundidade * 0.55]} />
        <meshStandardMaterial color={PRETO} roughness={0.8} />
      </mesh>
      {/* tampa inclinada: 100° é o ângulo em que um notebook fica aberto */}
      <group position={[0, esp, -profundidade / 2]} rotation={[-Math.PI * 0.56, 0, 0]}>
        <mesh castShadow position={[0, profundidade / 2, 0]}>
          <boxGeometry args={[largura, profundidade, esp]} />
          <meshStandardMaterial color={cor} roughness={0.4} metalness={0.4} />
        </mesh>
        <mesh position={[0, profundidade / 2, esp / 2 + 0.001]}>
          <planeGeometry args={[largura * 0.9, profundidade * 0.86]} />
          <meshStandardMaterial
            color={ligado ? "#1d4ed8" : VIDRO}
            emissive={ligado ? "#3b82f6" : "#000000"}
            emissiveIntensity={ligado ? 0.5 : 0}
          />
        </mesh>
      </group>
    </group>
  );
}

function Impressora({ cor, largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura * 0.4, 0]}>
        <boxGeometry args={[largura, altura * 0.8, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.6} />
      </mesh>
      {/* tampa do scanner, um degrau mais estreita */}
      <mesh castShadow position={[0, altura * 0.87, 0]}>
        <boxGeometry args={[largura * 0.92, altura * 0.16, profundidade * 0.88]} />
        <meshStandardMaterial color={GRAFITE} roughness={0.5} />
      </mesh>
      {/* bandeja de saída */}
      <mesh position={[0, altura * 0.5, profundidade * 0.52]} rotation={[-0.35, 0, 0]}>
        <boxGeometry args={[largura * 0.7, 0.01, profundidade * 0.35]} />
        <meshStandardMaterial color={METAL} roughness={0.7} />
      </mesh>
    </group>
  );
}

/** Servidor, rack e storage: caixa alta com fileiras de slots. */
function Rack({ cor, largura, profundidade, altura }: PropsModelo) {
  const slots = Math.max(3, Math.min(10, Math.round(altura / 0.22)));
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.5} metalness={0.45} />
      </mesh>
      {Array.from({ length: slots }).map((_, i) => (
        <group key={i} position={[0, altura * ((i + 0.7) / slots), profundidade / 2 + 0.003]}>
          <mesh>
            <planeGeometry args={[largura * 0.86, altura / slots * 0.5]} />
            <meshStandardMaterial color={PRETO} roughness={0.7} />
          </mesh>
          <mesh position={[largura * 0.33, 0, 0.002]}>
            <circleGeometry args={[0.008, 10]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Switch, roteador, firewall, nobreak: caixa baixa com LEDs em fila. */
function Caixote({ cor, largura, profundidade, altura, ligado }: PropsModelo) {
  const leds = Math.max(2, Math.min(8, Math.round(largura / 0.06)));
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.5} metalness={0.4} />
      </mesh>
      {Array.from({ length: leds }).map((_, i) => (
        <mesh
          key={i}
          position={[largura * (-0.4 + (0.8 * i) / Math.max(1, leds - 1)), altura * 0.62, profundidade / 2 + 0.002]}
        >
          <circleGeometry args={[0.006, 8]} />
          <meshStandardMaterial
            color={ligado ? "#4ade80" : "#334155"}
            emissive={ligado ? "#22c55e" : "#000000"}
            emissiveIntensity={ligado ? 1.5 : 0}
          />
        </mesh>
      ))}
    </group>
  );
}

function Tela({ cor, largura, profundidade, altura, ligado }: PropsModelo) {
  return (
    <group>
      <mesh castShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, Math.max(profundidade, 0.04)]} />
        <meshStandardMaterial color={cor} roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh position={[0, altura / 2, Math.max(profundidade, 0.04) / 2 + 0.002]}>
        <planeGeometry args={[largura * 0.94, altura * 0.9]} />
        <meshStandardMaterial
          color={ligado ? "#0f3d8c" : VIDRO}
          emissive={ligado ? "#2563eb" : "#000000"}
          emissiveIntensity={ligado ? 0.5 : 0}
        />
      </mesh>
    </group>
  );
}

function Camera3D({ cor, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow position={[0, altura * 0.7, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[altura * 0.28, altura * 0.28, altura * 0.9, 16]} />
        <meshStandardMaterial color={cor} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, altura * 0.7, altura * 0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[altura * 0.14, altura * 0.2, altura * 0.2, 16]} />
        <meshStandardMaterial color={VIDRO} roughness={0.1} metalness={0.8} />
      </mesh>
      <mesh position={[0, altura * 0.2, 0]}>
        <boxGeometry args={[altura * 0.16, altura * 0.4, altura * 0.16]} />
        <meshStandardMaterial color={GRAFITE} />
      </mesh>
    </group>
  );
}

function Telefone({ cor, largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura * 0.25, 0]} rotation={[-0.2, 0, 0]}>
        <boxGeometry args={[largura, altura * 0.5, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.6} />
      </mesh>
      <mesh castShadow position={[-largura * 0.3, altura * 0.6, 0]}>
        <boxGeometry args={[largura * 0.28, altura * 0.35, profundidade * 0.85]} />
        <meshStandardMaterial color={PRETO} roughness={0.7} />
      </mesh>
    </group>
  );
}

/**
 * O bloco sólido — parede, divisória, escada e o que não tiver modelo próprio.
 *
 * Com `vaos`, deixa de ser UMA caixa e vira uma caixa por pedaço que sobrou:
 * é assim que a porta de vidro abre um rasgo na parede em vez de ficar
 * encostada nela. Sem vão nenhum é exatamente a caixa de antes — um pedaço
 * só, do começo ao fim.
 */
function Generico({ cor, largura, profundidade, altura, vaos }: PropsModelo) {
  const aberturas = vaos ?? [];
  const trechos = trechosSolidos(largura, aberturas);
  // O modelo nasce centrado; os trechos vêm medidos da ponta esquerda.
  const centroDe = (de: number, ate: number) => de + (ate - de) / 2 - largura / 2;

  return (
    <group>
      {trechos.map((t) => (
        <mesh key={`t${t.de}`} castShadow receiveShadow position={[centroDe(t.de, t.ate), altura / 2, 0]}>
          <boxGeometry args={[t.ate - t.de, altura, profundidade]} />
          <meshStandardMaterial color={cor} roughness={0.55} metalness={0.25} />
        </mesh>
      ))}

      {/* A VERGA: o pedaço de parede que fica ACIMA da porta.
          Porta tem 2,10 m e a parede 2,80 — sem esta faixa o recorte viraria
          um rasgo até o teto, que é pior do que porta nenhuma. Vão que sobe
          até o alto (a porta de vidro, por exemplo) não gera verga: aí não
          sobra parede em cima. */}
      {aberturas.map((v) => {
        const sobra = altura - v.altura;
        if (v.altura <= 0 || sobra <= 0.02) return null;
        return (
          <mesh
            key={`v${v.de}`}
            castShadow
            receiveShadow
            position={[centroDe(v.de, v.ate), v.altura + sobra / 2, 0]}
          >
            <boxGeometry args={[v.ate - v.de, sobra, profundidade]} />
            <meshStandardMaterial color={cor} roughness={0.55} metalness={0.25} />
          </mesh>
        );
      })}
    </group>
  );
}

function Teclado({ cor, largura, profundidade, altura }: PropsModelo) {
  // As teclas são UM plano escuro, não 80 caixinhas: a essa escala ninguém
  // distingue tecla individual, e 80 meshes por teclado multiplicariam o
  // número de objetos da cena por nada.
  return (
    <group rotation={[-0.05, 0, 0]}>
      <mesh castShadow receiveShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.6} />
      </mesh>
      <mesh position={[0, altura + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[largura * 0.92, profundidade * 0.78]} />
        <meshStandardMaterial color={PRETO} roughness={0.85} />
      </mesh>
    </group>
  );
}

function MouseModelo({ cor, largura, profundidade, altura }: PropsModelo) {
  // Meia esfera achatada: a silhueta de um mouse visto de cima é essa.
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura * 0.45, 0]} scale={[largura / 2, altura * 0.9, profundidade / 2]}>
        <sphereGeometry args={[1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={cor} roughness={0.45} />
      </mesh>
      <mesh position={[0, altura * 0.9, -profundidade * 0.1]}>
        <boxGeometry args={[0.006, 0.002, profundidade * 0.35]} />
        <meshStandardMaterial color={PRETO} />
      </mesh>
    </group>
  );
}

function HeadsetModelo({ cor, largura, altura }: PropsModelo) {
  const raio = largura * 0.45;
  return (
    <group>
      {/* arco */}
      <mesh castShadow position={[0, altura * 0.72, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[raio, largura * 0.055, 8, 20, Math.PI]} />
        <meshStandardMaterial color={cor} roughness={0.5} />
      </mesh>
      {/* conchas */}
      {[-1, 1].map((lado) => (
        <mesh key={lado} castShadow position={[lado * raio, altura * 0.35, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[altura * 0.3, altura * 0.3, largura * 0.16, 14]} />
          <meshStandardMaterial color={PRETO} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function WebcamModelo({ cor, largura, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow position={[0, altura * 0.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[largura * 0.42, largura * 0.42, largura * 0.5, 16]} />
        <meshStandardMaterial color={cor} roughness={0.45} />
      </mesh>
      <mesh position={[0, altura * 0.6, largura * 0.26]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[largura * 0.16, largura * 0.16, 0.004, 12]} />
        <meshStandardMaterial color={VIDRO} roughness={0.05} metalness={0.9} />
      </mesh>
      {/* clipe que prende no monitor */}
      <mesh castShadow position={[0, altura * 0.15, 0]}>
        <boxGeometry args={[largura * 0.5, altura * 0.3, largura * 0.3]} />
        <meshStandardMaterial color={GRAFITE} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Escolhe a forma pelo tipo. É o único lugar que mapeia tipo → geometria. */
export function ModeloDoAtivo({
  ativo,
  largura,
  profundidade,
  altura,
}: {
  ativo: TiAtivo;
  largura: number;
  profundidade: number;
  altura: number;
}) {
  const def = tipoAtivo(ativo.tipo);
  const cor = ativo.cor || def.cor;
  // "Ligado" acende tela e LED. Só `em_uso` acende: um mapa em que a máquina
  // em manutenção pisca de verde mente sobre o estado do parque.
  const ligado = ativo.status === "em_uso";
  const p = { cor, largura, profundidade, altura, ligado };

  switch (ativo.tipo) {
    case "desktop": return <Desktop {...p} />;
    case "monitor": return <Monitor {...p} />;
    case "notebook": return <Notebook {...p} />;
    case "impressora":
    case "scanner": return <Impressora {...p} />;
    case "servidor":
    case "rack":
    case "storage": return <Rack {...p} />;
    case "switch":
    case "roteador":
    case "firewall":
    case "nobreak":
    case "estabilizador":
    case "access_point": return <Caixote {...p} />;
    case "tv":
    case "projetor": return <Tela {...p} />;
    case "camera": return <Camera3D {...p} />;
    case "telefone_ip": return <Telefone {...p} />;
    case "teclado": return <Teclado {...p} />;
    case "mouse": return <MouseModelo {...p} />;
    case "headset": return <HeadsetModelo {...p} />;
    case "webcam": return <WebcamModelo {...p} />;
    case "dock": return <Caixote {...p} />;
    default: return <Generico {...p} />;
  }
}

// ── Cenário ───────────────────────────────────────────────────────────

function Mesa({ cor, largura, profundidade, altura }: PropsModelo) {
  const esp = 0.04;
  const pe = 0.06;
  const pes: [number, number][] = [
    [largura / 2 - pe, profundidade / 2 - pe],
    [-largura / 2 + pe, profundidade / 2 - pe],
    [largura / 2 - pe, -profundidade / 2 + pe],
    [-largura / 2 + pe, -profundidade / 2 + pe],
  ];
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura - esp / 2, 0]}>
        <boxGeometry args={[largura, esp, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.65} />
      </mesh>
      {pes.map(([x, z], i) => (
        <mesh key={i} castShadow position={[x, (altura - esp) / 2, z]}>
          <boxGeometry args={[pe, altura - esp, pe]} />
          <meshStandardMaterial color={GRAFITE} roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Cadeira({ cor, largura, profundidade, altura }: PropsModelo) {
  const assento = altura * 0.46;
  const raioBase = largura * 0.32;
  return (
    <group>
      {/* assento levemente mais fundo que largo, com a frente arredondada
          sugerida pelo chanfro do cilindro achatado */}
      <mesh castShadow receiveShadow position={[0, assento, 0]}>
        <boxGeometry args={[largura * 0.9, 0.08, profundidade * 0.88]} />
        <meshStandardMaterial color={cor} roughness={0.85} />
      </mesh>

      {/* encosto inclinado para trás — cadeira de escritório não tem encosto
          a 90°, e é essa inclinação que a distingue de uma cadeira comum */}
      <group position={[0, assento + 0.04, -profundidade * 0.38]} rotation={[0.14, 0, 0]}>
        <mesh castShadow position={[0, altura * 0.26, 0]}>
          <boxGeometry args={[largura * 0.82, altura * 0.5, 0.07]} />
          <meshStandardMaterial color={cor} roughness={0.85} />
        </mesh>
        {/* apoio lombar */}
        <mesh castShadow position={[0, altura * 0.12, 0.05]}>
          <boxGeometry args={[largura * 0.7, altura * 0.12, 0.05]} />
          <meshStandardMaterial color={sombrear(cor, -8)} roughness={0.9} />
        </mesh>
      </group>

      {/* braços */}
      {[-1, 1].map((lado) => (
        <group key={lado}>
          <mesh castShadow position={[lado * largura * 0.46, assento + altura * 0.11, -profundidade * 0.05]}>
            <boxGeometry args={[0.05, 0.05, profundidade * 0.45]} />
            <meshStandardMaterial color={PRETO} roughness={0.6} />
          </mesh>
          <mesh castShadow position={[lado * largura * 0.46, assento + altura * 0.05, -profundidade * 0.22]}>
            <boxGeometry args={[0.04, altura * 0.13, 0.04]} />
            <meshStandardMaterial color={GRAFITE} metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      ))}

      {/* coluna a gás */}
      <mesh castShadow position={[0, assento / 2, 0]}>
        <cylinderGeometry args={[0.028, 0.035, assento, 12]} />
        <meshStandardMaterial color={METAL} metalness={0.75} roughness={0.28} />
      </mesh>

      {/* base de 5 pontas COM rodízio na ponta — é o detalhe que faz ler como
          cadeira de escritório, e não como banco giratório */}
      {Array.from({ length: 5 }).map((_, i) => {
        const a = (i / 5) * Math.PI * 2;
        const px = Math.cos(a) * raioBase;
        const pz = Math.sin(a) * raioBase;
        return (
          <group key={i}>
            {/* O giro é do MESH, não da geometria: geometry não aceita
                rotation, e a perna precisa apontar para fora do centro. */}
            <mesh castShadow position={[px, 0.055, pz]} rotation={[0, -a, 0]}>
              <boxGeometry args={[raioBase * 1.15, 0.035, 0.045]} />
              <meshStandardMaterial color={GRAFITE} metalness={0.5} roughness={0.5} />
            </mesh>
            <mesh castShadow position={[px * 1.5, 0.025, pz * 1.5]}>
              <sphereGeometry args={[0.026, 10, 8]} />
              <meshStandardMaterial color={PRETO} roughness={0.6} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Armario({ cor, largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.7} />
      </mesh>
      {/* duas portas com puxador: sem isso é um bloco de madeira */}
      {[-1, 1].map((lado) => (
        <group key={lado}>
          <mesh position={[lado * largura * 0.24, altura / 2, profundidade / 2 + 0.003]}>
            <planeGeometry args={[largura * 0.44, altura * 0.9]} />
            <meshStandardMaterial color={MADEIRA_ESCURA} roughness={0.6} />
          </mesh>
          <mesh position={[lado * largura * 0.06, altura / 2, profundidade / 2 + 0.02]}>
            <cylinderGeometry args={[0.012, 0.012, altura * 0.14, 8]} />
            <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.25} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Sofa({ cor, largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura * 0.28, 0]}>
        <boxGeometry args={[largura, altura * 0.4, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, altura * 0.62, -profundidade * 0.38]}>
        <boxGeometry args={[largura, altura * 0.55, profundidade * 0.24]} />
        <meshStandardMaterial color={cor} roughness={0.9} />
      </mesh>
      {[-1, 1].map((lado) => (
        <mesh key={lado} castShadow position={[lado * (largura / 2 - 0.06), altura * 0.5, 0]}>
          <boxGeometry args={[0.12, altura * 0.45, profundidade * 0.95]} />
          <meshStandardMaterial color={cor} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Planta({ largura, altura }: PropsModelo) {
  const raio = largura * 0.32;
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura * 0.14, 0]}>
        <cylinderGeometry args={[raio * 0.85, raio, altura * 0.28, 14]} />
        <meshStandardMaterial color="#a8553a" roughness={0.85} />
      </mesh>
      <mesh castShadow position={[0, altura * 0.55, 0]}>
        <cylinderGeometry args={[0.02, 0.03, altura * 0.5, 8]} />
        <meshStandardMaterial color="#4d7c2f" roughness={0.9} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          castShadow
          position={[Math.cos((i / 3) * 6.28) * raio * 0.5, altura * (0.72 + i * 0.08), Math.sin((i / 3) * 6.28) * raio * 0.5]}
        >
          <sphereGeometry args={[raio * (0.78 - i * 0.12), 10, 8]} />
          <meshStandardMaterial color={i % 2 ? "#3f9142" : "#2f7d33"} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function Porta({ cor, largura, profundidade, altura }: PropsModelo) {
  const batente = 0.06;
  const espessuraFolha = 0.045;
  const folhaLargura = largura - batente * 2;
  const folhaAltura = altura - batente;
  return (
    <group>
      {[-1, 1].map((lado) => (
        <mesh key={lado} castShadow position={[lado * (largura / 2 - batente / 2), altura / 2, 0]}>
          <boxGeometry args={[batente, altura, profundidade]} />
          <meshStandardMaterial color={cor ? sombrear(cor, -12) : "#9a6b3f"} roughness={0.7} />
        </mesh>
      ))}
      <mesh castShadow position={[0, altura - batente / 2, 0]}>
        <boxGeometry args={[largura, batente, profundidade]} />
        <meshStandardMaterial color={cor ? sombrear(cor, -12) : "#9a6b3f"} roughness={0.7} />
      </mesh>
      {/* A folha nasceu entreaberta (rotation -0.7) porque, centrada na
       * espessura do batente, ela sumia dentro da parede. Depois passou a ficar
       * ADIANTADA numa das faces, para escapar da parede — e aí a porta ficava
       * certa de um lado e, do outro, só o batente: a folha morava na face de
       * trás. Agora ela é CENTRADA, que é o único jeito de a porta ser a mesma
       * pelos dois lados.
       *
       * O que resolveu o sumiço na parede não é mais a folga: é o RECORTE.
       * A porta abre vão de verdade na parede em que está encostada (ver
       * `vaosNaParede`), então não há mais parede ocupando este espaço. */}
      <group position={[0, folhaAltura / 2, 0]}>
        <mesh castShadow>
          <boxGeometry args={[folhaLargura, folhaAltura, espessuraFolha]} />
          <meshStandardMaterial color={cor || "#c08a52"} roughness={0.65} />
        </mesh>
        {/* Almofadas e maçaneta nas DUAS faces.
            Porta tem frente e verso iguais, e no mapa se olha dos dois lados:
            com o relevo só numa face, a porta virava uma tábua lisa quando a
            câmera passava para o outro lado da parede. O laço externo é a
            face (+z / −z); o interno, a almofada de cima e a de baixo. */}
        {[1, -1].map((face) => (
          <group key={face}>
            {[1, -1].map((metade) => (
              <mesh
                key={metade}
                position={[0, metade * folhaAltura * 0.22, (face * espessuraFolha) / 2]}
              >
                <boxGeometry args={[folhaLargura * 0.66, folhaAltura * 0.3, 0.008]} />
                <meshStandardMaterial color="#b07c47" roughness={0.7} />
              </mesh>
            ))}
            {/* maçaneta do lado oposto às dobradiças, na altura de sempre (~1,05 m) */}
            <mesh
              castShadow
              rotation={[Math.PI / 2, 0, 0]}
              position={[
                folhaLargura / 2 - 0.07,
                1.05 - folhaAltura / 2,
                face * (espessuraFolha / 2 + 0.02),
              ]}
            >
              <cylinderGeometry args={[0.018, 0.018, 0.05, 10]} />
              <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.3} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/**
 * O vidro desta cena — e por que ele não é um material "realista".
 *
 * Não existe environment map aqui (ver `Luzes`, em Cena3D: o HDR de CDN foi
 * cortado de propósito). E vidro de verdade se enxerga quase só por REFLEXO:
 * material liso, com `roughness` baixo, num mundo sem nada para refletir
 * renderiza PRETO. Foi exatamente isso que aconteceu — o pano de vidro saiu
 * um paredão escuro.
 *
 * Então o vidro aqui é fingido, e de propósito: rugosidade média (tem difusa
 * para as luzes pegarem), `metalness` zero e um `emissive` fraco que garante
 * um piso de claridade mesmo na face que não recebe luz nenhuma. É o que faz
 * ele parecer vidro num render sem reflexo.
 *
 * `depthWrite={false}`: superfície transparente que escreve profundidade
 * apaga o que está atrás dela dependendo da ordem de desenho — a mesa vista
 * através da divisória sumia conforme o ângulo da câmera.
 */
function VidroMaterial({ opacidade = 0.24, cor }: { opacidade?: number; cor?: string }) {
  return (
    <meshStandardMaterial
      // A cor escolhida no inspetor tinge o vidro; sem escolha, o azulado
      // padrão. Antes o vidro ignorava a cor e o seletor não fazia nada.
      color={cor || "#dbeefb"}
      emissive={cor || "#bfe0f5"}
      emissiveIntensity={0.35}
      transparent
      opacity={opacidade}
      roughness={0.18}
      metalness={0}
      depthWrite={false}
      side={DoubleSide}
    />
  );
}

/**
 * Alumínio dos caixilhos.
 *
 * Mesma armadilha do vidro: `metalness` alto sem environment map dá metal
 * preto. Aqui ele é quase todo difuso, num tom claro — lê como alumínio
 * anodizado e, principalmente, não vira uma grade escura por cima do vidro,
 * que era metade do motivo de o pano parecer sólido.
 */
function AluminioMaterial({ cor }: { cor?: string } = {}) {
  return <meshStandardMaterial color={cor || "#c4ced9"} metalness={0.15} roughness={0.55} />;
}

/**
 * Escada em L (um quarto de volta), subindo para o andar de cima.
 *
 * Era um bloco cinza — o `Generico` — porque escada nunca teve modelo
 * próprio. Num mapa que já mostra mesa, cadeira e monitor, o bloco lia como
 * "armário grande", e ninguém achava por onde se sobe.
 *
 * COMO ELA É MONTADA
 *   Dois lances e um patamar, que é o que faz o L: o primeiro lance corre no
 *   eixo X e sobe METADE da altura; o patamar vira a esquina; o segundo corre
 *   no eixo Z e sobe a outra metade. É o desenho de escada que cabe em caixa
 *   de escritório — o lance reto único precisaria de uns 5 m de corrida para
 *   vencer o mesmo pé-direito.
 *
 *   Cada degrau é uma caixa que vai do CHÃO até a altura dele, não uma laje
 *   solta no ar. Sai mais barato (uma geometria por degrau, sem espelho nem
 *   viga) e dá a silhueta maciça que se reconhece de longe — inclusive de
 *   cima, no modo 2D, onde o que se vê é a escadinha de degraus.
 *
 * A ALTURA vem da peça (`altura_z`), não de uma constante: escada que sobe
 * sempre 60 cm não leva a lugar nenhum. O padrão do catálogo passou a ser o
 * pé-direito típico; quem tiver um andar mais alto ajusta no inspetor e os
 * degraus se redistribuem sozinhos.
 */
function Escada({ cor, largura, profundidade, altura }: PropsModelo) {
  // Largura do lance: a parte da caixa que vira degrau. O resto do L é o
  // vão da volta.
  const w = Math.min(largura, profundidade) * 0.42;
  const meia = altura / 2;

  // ~18 cm por degrau é o passo confortável de verdade — e é o que faz a
  // contagem mudar junto com a altura, em vez de esticar degrau gigante.
  const degrausDe = (subida: number) => Math.max(2, Math.round(subida / 0.18));

  const n1 = degrausDe(meia);
  const n2 = degrausDe(meia);
  const corrida1 = largura - w;
  const corrida2 = profundidade - w;
  const passo1 = corrida1 / n1;
  const passo2 = corrida2 / n2;

  // Onde o L se dobra: canto (−X, −Z) da caixa. O primeiro lance sobe indo
  // PARA A ESQUERDA e a volta é à esquerda — que é o sentido da escada real
  // do escritório. Espelhar de verdade, e não com `scale={[-1,1,1]}`: escala
  // negativa inverte a orientação das faces e estraga sombra e iluminação.
  const zLance1 = -profundidade / 2 + w / 2;
  const xLance2 = -largura / 2 + w / 2;

  const corDegrau = sombrear(cor, -4);
  const corPatamar = sombrear(cor, 4);

  return (
    <group>
      {/* lance 1 — corre em X, sobe até a metade */}
      {Array.from({ length: n1 }, (_, i) => {
        const topo = ((i + 1) * meia) / n1;
        return (
          <mesh
            key={`a${i}`}
            castShadow
            receiveShadow
            position={[largura / 2 - (i + 0.5) * passo1, topo / 2, zLance1]}
          >
            <boxGeometry args={[passo1, topo, w]} />
            <meshStandardMaterial color={corDegrau} roughness={0.8} />
          </mesh>
        );
      })}

      {/* patamar — a esquina do L, na altura em que o primeiro lance termina */}
      <mesh castShadow receiveShadow position={[xLance2, meia / 2, zLance1]}>
        <boxGeometry args={[w, meia, w]} />
        <meshStandardMaterial color={corPatamar} roughness={0.8} />
      </mesh>

      {/* lance 2 — vira 90° e corre em Z, da metade até o andar de cima */}
      {Array.from({ length: n2 }, (_, j) => {
        const topo = meia + ((j + 1) * meia) / n2;
        return (
          <mesh
            key={`b${j}`}
            castShadow
            receiveShadow
            position={[xLance2, topo / 2, -profundidade / 2 + w + (j + 0.5) * passo2]}
          >
            <boxGeometry args={[w, topo, passo2]} />
            <meshStandardMaterial color={corDegrau} roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * Pano de vidro: divisória envidraçada de escritório.
 *
 * O vidro sozinho some — um plano transparente sem nada em volta lê como
 * "buraco na parede", não como vidro. O que o entrega são as BORDAS: perfil
 * de alumínio em cima e embaixo, e montantes de metro em metro. Por isso os
 * montantes são calculados, e não fixos: um pano de 6 m com dois montantes
 * pareceria vidro de aquário, e um de 1 m com seis pareceria gradil.
 */
function ParedeVidro({ cor, largura, profundidade, altura, vaos }: PropsModelo) {
  // Sem verga aqui: o que recorta um pano de vidro é a porta de vidro, que
  // tem a altura toda do pano. Sobra nenhuma para fechar em cima.
  const trechos = trechosSolidos(largura, vaos ?? []);
  return (
    <group>
      {trechos.map((t) => {
        const comprimento = t.ate - t.de;
        return (
          <PanoDeVidro
            key={t.de}
            cor={cor}
            largura={comprimento}
            profundidade={profundidade}
            altura={altura}
            deslocamento={t.de + comprimento / 2 - largura / 2}
          />
        );
      })}
    </group>
  );
}

/** Um trecho contínuo de pano de vidro, já sem os vãos. */
function PanoDeVidro({
  cor,
  largura,
  profundidade,
  altura,
  deslocamento,
}: {
  cor?: string;
  largura: number;
  profundidade: number;
  altura: number;
  deslocamento: number;
}) {
  const perfil = 0.06;
  const montante = 0.05;
  // Um montante a cada ~1,2 m, que é a largura de chapa que se usa de verdade.
  const vaos = Math.max(1, Math.round(largura / 1.2));
  const passo = largura / vaos;

  return (
    <group position={[deslocamento, 0, 0]}>
      {/* vidro: um pano só, com folga para não brigar com os perfis */}
      <mesh position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura - perfil, altura - perfil * 2, profundidade * 0.3]} />
        <VidroMaterial cor={cor} />
      </mesh>

      {/* perfis de piso e teto */}
      {[perfil / 2, altura - perfil / 2].map((y) => (
        <mesh key={y} castShadow position={[0, y, 0]}>
          <boxGeometry args={[largura, perfil, profundidade]} />
          <AluminioMaterial />
        </mesh>
      ))}

      {/* montantes, inclusive as duas pontas */}
      {Array.from({ length: vaos + 1 }, (_, i) => -largura / 2 + i * passo).map((x) => (
        <mesh key={x} castShadow position={[x, altura / 2, 0]}>
          <boxGeometry args={[montante, altura, profundidade]} />
          <AluminioMaterial />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Porta de vidro de correr — desenhada para EMENDAR no pano de vidro.
 *
 * O que diz "de correr", e não "de abrir", são duas coisas: o TRILHO
 * atravessando por cima do vão inteiro, e as duas folhas em PLANOS
 * DIFERENTES de profundidade — porta de correr tem uma folha passando na
 * frente da outra, e é esse desencontro que o olho reconhece. No mesmo plano
 * seria uma porta dupla comum.
 *
 * Fica fechada, como a porta comum desta cena: folha em ângulo vira uma
 * lâmina atravessando o piso quando a peça está solta no mapa.
 *
 * A EMENDA COM A PAREDE é o resto do desenho, e é o motivo de a peça ter a
 * altura do pano (280) em vez da altura de porta (210):
 *
 *   · montantes de ponta a ponta, do piso ao teto, no mesmo perfil e na mesma
 *     espessura da `ParedeVidro` — encostando as duas peças, os montantes se
 *     encontram e a divisória segue como uma coisa só;
 *   · bandeira de vidro FIXA acima das folhas, preenchendo o que sobra até o
 *     alto. Sem ela a porta abria um rasgo de 70 cm de nada entre o topo dela
 *     e o teto — que é o que dava aquele aspecto de caixa avulsa plantada no
 *     meio do pano.
 *
 * Quem quiser a porta solta, sem bandeira, baixa a altura no inspetor: com
 * pouca sobra o vidro de cima simplesmente não é desenhado.
 */
function PortaVidro({ cor, largura, profundidade, altura }: PropsModelo) {
  const perfil = 0.06;
  const montante = 0.05;
  const espessura = 0.03;
  // Altura de porta de verdade — mas nunca maior que a peça.
  const folhaAltura = Math.min(2.1, altura - perfil * 2);
  const folhaLargura = (largura - montante * 2) / 2;
  // O desencontro das folhas: uma à frente, outra atrás do eixo.
  const recuo = profundidade * 0.22;
  const sobra = altura - folhaAltura - perfil;
  const temBandeira = sobra > 0.15;

  return (
    <group>
      {/* perfis de piso e teto: os mesmos da ParedeVidro, para casar */}
      {[perfil / 2, altura - perfil / 2].map((y) => (
        <mesh key={y} castShadow position={[0, y, 0]}>
          <boxGeometry args={[largura, perfil, profundidade]} />
          <AluminioMaterial />
        </mesh>
      ))}

      {/* montantes das pontas: é por aqui que a porta encosta no pano */}
      {[-1, 1].map((lado) => (
        <mesh key={lado} castShadow position={[(lado * (largura - montante)) / 2, altura / 2, 0]}>
          <boxGeometry args={[montante, altura, profundidade]} />
          <AluminioMaterial />
        </mesh>
      ))}

      {/* trilho, na altura em que as folhas terminam */}
      <mesh castShadow position={[0, folhaAltura + perfil / 2, 0]}>
        <boxGeometry args={[largura, perfil, profundidade]} />
        <AluminioMaterial />
      </mesh>

      {/* bandeira fixa: fecha o vão até o teto */}
      {temBandeira && (
        <mesh position={[0, folhaAltura + perfil + sobra / 2, 0]}>
          <boxGeometry args={[largura - montante * 2, sobra, profundidade * 0.3]} />
          <VidroMaterial cor={cor} />
        </mesh>
      )}

      {[-1, 1].map((lado) => (
        <group key={lado} position={[(lado * folhaLargura) / 2, folhaAltura / 2, lado * recuo]}>
          <mesh>
            <boxGeometry args={[folhaLargura, folhaAltura, espessura]} />
            <VidroMaterial opacidade={0.3} cor={cor} />
          </mesh>
          {/* moldura fina: sem ela a folha some contra o fundo */}
          {[-1, 1].map((borda) => (
            <mesh key={borda} castShadow position={[(borda * folhaLargura) / 2, 0, 0]}>
              <boxGeometry args={[0.035, folhaAltura, espessura * 1.6]} />
              <AluminioMaterial />
            </mesh>
          ))}
          {/* puxador vertical, no encontro das folhas — é onde a mão vai */}
          <mesh castShadow position={[(-lado * folhaLargura) / 2 + lado * 0.06, 0, espessura]}>
            <boxGeometry args={[0.025, folhaAltura * 0.35, 0.025]} />
            <AluminioMaterial />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Janela({ largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      {/* Mesmo vidro do pano: a janela sofria do mesmo escurecimento, só que
          menos visível porque é uma peça pequena. Ver VidroMaterial. */}
      <mesh position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, profundidade * 0.6]} />
        <VidroMaterial opacidade={0.3} />
      </mesh>
      <mesh castShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, 0.05, profundidade]} />
        <AluminioMaterial />
      </mesh>
    </group>
  );
}

/** Piso de área (sala, copa, recepção): mancha colorida rente ao chão. */
function AreaPiso({ cor, largura, profundidade }: PropsModelo) {
  return (
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
      <planeGeometry args={[largura, profundidade]} />
      <meshStandardMaterial color={cor} roughness={0.95} />
    </mesh>
  );
}

function MesaEmL({ cor, largura, profundidade, altura }: PropsModelo) {
  const esp = 0.04;
  const braco = profundidade * 0.45;
  return (
    <group>
      {/* tampo maior, na frente */}
      <mesh castShadow receiveShadow position={[0, altura - esp / 2, profundidade / 2 - braco / 2]}>
        <boxGeometry args={[largura, esp, braco]} />
        <meshStandardMaterial color={cor} roughness={0.65} />
      </mesh>
      {/* retorno lateral, formando o L */}
      <mesh castShadow receiveShadow position={[-largura / 2 + braco / 2, altura - esp / 2, -braco / 2]}>
        <boxGeometry args={[braco, esp, profundidade - braco]} />
        <meshStandardMaterial color={cor} roughness={0.65} />
      </mesh>
      {[
        [largura / 2 - 0.05, profundidade / 2 - 0.05],
        [-largura / 2 + 0.05, profundidade / 2 - 0.05],
        [-largura / 2 + 0.05, -profundidade / 2 + 0.05],
      ].map(([x, z], i) => (
        <mesh key={i} castShadow position={[x, (altura - esp) / 2, z]}>
          <boxGeometry args={[0.06, altura - esp, 0.06]} />
          <meshStandardMaterial color={GRAFITE} metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function MesaReuniao({ cor, largura, profundidade, altura }: PropsModelo) {
  const esp = 0.05;
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura - esp / 2, 0]}>
        <boxGeometry args={[largura, esp, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.5} />
      </mesh>
      {/* duas bases em vez de quatro pés: é o que sustenta mesa longa */}
      {[-1, 1].map((lado) => (
        <group key={lado}>
          <mesh castShadow position={[lado * largura * 0.28, (altura - esp) / 2, 0]}>
            <boxGeometry args={[0.1, altura - esp, profundidade * 0.15]} />
            <meshStandardMaterial color={GRAFITE} metalness={0.5} roughness={0.45} />
          </mesh>
          <mesh castShadow position={[lado * largura * 0.28, 0.02, 0]}>
            <boxGeometry args={[0.5, 0.04, profundidade * 0.7]} />
            <meshStandardMaterial color={GRAFITE} metalness={0.5} roughness={0.45} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Gaveteiro({ cor, largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.7} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <group key={i}>
          <mesh position={[0, altura * (0.18 + i * 0.3), profundidade / 2 + 0.003]}>
            <planeGeometry args={[largura * 0.88, altura * 0.24]} />
            <meshStandardMaterial color={MADEIRA_ESCURA} roughness={0.6} />
          </mesh>
          <mesh position={[0, altura * (0.18 + i * 0.3), profundidade / 2 + 0.015]}>
            <boxGeometry args={[largura * 0.35, 0.012, 0.02]} />
            <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.25} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Estante({ cor, largura, profundidade, altura }: PropsModelo) {
  const prateleiras = Math.max(3, Math.round(altura / 0.4));
  return (
    <group>
      {/* laterais e fundo — estante é vazada, não um bloco */}
      {[-1, 1].map((lado) => (
        <mesh key={lado} castShadow receiveShadow position={[lado * (largura / 2 - 0.015), altura / 2, 0]}>
          <boxGeometry args={[0.03, altura, profundidade]} />
          <meshStandardMaterial color={cor} roughness={0.7} />
        </mesh>
      ))}
      <mesh castShadow position={[0, altura / 2, -profundidade / 2 + 0.01]}>
        <boxGeometry args={[largura, altura, 0.02]} />
        <meshStandardMaterial color={sombrear(cor, -12)} roughness={0.8} />
      </mesh>
      {Array.from({ length: prateleiras }).map((_, i) => (
        <mesh key={i} castShadow receiveShadow position={[0, (altura * (i + 0.5)) / prateleiras, 0]}>
          <boxGeometry args={[largura - 0.05, 0.025, profundidade * 0.94]} />
          <meshStandardMaterial color={cor} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function QuadroBranco({ largura, profundidade, altura }: PropsModelo) {
  return (
    <group position={[0, altura * 0.55, 0]}>
      <mesh castShadow>
        <boxGeometry args={[largura, altura * 0.75, Math.max(profundidade, 0.04)]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0, Math.max(profundidade, 0.04) / 2 + 0.002]}>
        <planeGeometry args={[largura * 0.94, altura * 0.68]} />
        <meshStandardMaterial color="#fbfdff" roughness={0.25} />
      </mesh>
      {/* calha das canetas */}
      <mesh position={[0, -altura * 0.4, Math.max(profundidade, 0.04) / 2]}>
        <boxGeometry args={[largura * 0.9, 0.025, 0.05]} />
        <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Geladeira({ cor, largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.35} metalness={0.55} />
      </mesh>
      {/* fresta do freezer + dois puxadores verticais */}
      <mesh position={[0, altura * 0.68, profundidade / 2 + 0.003]}>
        <planeGeometry args={[largura * 0.96, 0.012]} />
        <meshStandardMaterial color={GRAFITE} />
      </mesh>
      {[0.35, 0.82].map((h, i) => (
        <mesh key={i} castShadow position={[largura * 0.32, altura * h, profundidade / 2 + 0.025]}>
          <boxGeometry args={[0.03, altura * 0.22, 0.03]} />
          <meshStandardMaterial color={METAL} metalness={0.85} roughness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function Bebedouro({ cor, largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura * 0.36, 0]}>
        <boxGeometry args={[largura, altura * 0.72, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.5} />
      </mesh>
      {/* o galão azul em cima é o que identifica o bebedouro de longe */}
      <mesh castShadow position={[0, altura * 0.86, 0]}>
        <cylinderGeometry args={[largura * 0.3, largura * 0.34, altura * 0.28, 14]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.75} roughness={0.15} />
      </mesh>
      <mesh position={[0, altura * 0.5, profundidade / 2 + 0.01]}>
        <boxGeometry args={[largura * 0.3, 0.04, 0.04]} />
        <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Poltrona({ cor, largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, altura * 0.3, 0]}>
        <boxGeometry args={[largura, altura * 0.35, profundidade]} />
        <meshStandardMaterial color={cor} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, altura * 0.65, -profundidade * 0.36]}>
        <boxGeometry args={[largura, altura * 0.6, profundidade * 0.26]} />
        <meshStandardMaterial color={cor} roughness={0.9} />
      </mesh>
      {[-1, 1].map((lado) => (
        <mesh key={lado} castShadow position={[lado * (largura / 2 - 0.05), altura * 0.52, 0]}>
          <boxGeometry args={[0.1, altura * 0.3, profundidade * 0.9]} />
          <meshStandardMaterial color={cor} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export function ModeloDoElemento({
  elemento,
  largura,
  profundidade,
  altura,
  vaos,
}: {
  elemento: TiElemento;
  largura: number;
  profundidade: number;
  altura: number;
  /**
   * Recortes desta peça, em metros da ponta esquerda. Ver `vaosNaParede`.
   *
   * `altura` é até onde o vão sobe: acima dela a parede continua (a verga).
   * O tipo tem que casar com o de `PropsModelo` — foi separar os dois que
   * deixou o spread quebrado quando a altura entrou.
   */
  vaos?: { de: number; ate: number; altura: number }[];
}) {
  const def = tipoElemento(elemento.tipo);
  const cor = elemento.cor || def.cor;
  const p = { cor, largura, profundidade, altura, vaos };

  switch (elemento.tipo) {
    case "mesa":
    case "bancada": return <Mesa {...p} />;
    case "mesa_l": return <MesaEmL {...p} />;
    case "mesa_reuniao": return <MesaReuniao {...p} />;
    case "gaveteiro": return <Gaveteiro {...p} />;
    case "estante": return <Estante {...p} />;
    case "quadro_branco": return <QuadroBranco {...p} />;
    case "geladeira": return <Geladeira {...p} />;
    case "bebedouro": return <Bebedouro {...p} />;
    case "poltrona": return <Poltrona {...p} />;
    case "cadeira": return <Cadeira {...p} />;
    case "armario": return <Armario {...p} />;
    case "sofa": return <Sofa {...p} />;
    case "rack": return <Armario {...p} />;
    case "planta_decorativa": return <Planta {...p} />;
    case "porta": return <Porta {...p} />;
    case "janela": return <Janela {...p} />;
    case "escada": return <Escada {...p} />;
    case "parede_vidro": return <ParedeVidro {...p} />;
    case "porta_vidro": return <PortaVidro {...p} />;
    case "sala":
    case "recepcao":
    case "copa":
    case "banheiro":
    case "impressora_area": return <AreaPiso {...p} />;
    // parede, divisória, escada e o que vier: bloco sólido.
    default: return <Generico {...p} />;
  }
}

/**
 * Contorno de seleção — o amarelo que mostra o que está pego.
 *
 * São DOIS desenhos, porque o que funciona numa vista não funciona na outra:
 *
 *   3D  — caixa de arame em volta da peça. A gaiola só se lê como volume
 *         porque a câmera está de lado.
 *   2D  — moldura chapada no contorno da peça. A MESMA caixa de arame vista
 *         de cima vira um emaranhado: as oito arestas verticais colapsam nos
 *         quatro cantos e as diagonais que o `wireframe` desenha em cada face
 *         (o modo arame mostra os triângulos, não os quadriláteros) se
 *         cruzam todas no meio, escondendo justamente a peça selecionada.
 */
export function Selecao({
  largura,
  profundidade,
  altura,
  plano = false,
  cor = "#f59e0b",
}: {
  largura: number;
  profundidade: number;
  altura: number;
  /** Vista 2D: desenha a moldura chapada em vez da caixa de arame. */
  plano?: boolean;
  /** Âmbar marca o que está pego; vermelho, o que o clique vai apagar. */
  cor?: string;
}) {
  const args = useMemo<[number, number, number]>(
    () => [largura * 1.06 + 0.02, Math.max(altura, M(4)) * 1.06 + 0.02, profundidade * 1.06 + 0.02],
    [largura, profundidade, altura],
  );

  if (plano) return <MolduraPlana largura={largura} profundidade={profundidade} altura={altura} cor={cor} />;

  return (
    <mesh position={[0, Math.max(altura, M(4)) / 2, 0]}>
      <boxGeometry args={args} />
      <meshBasicMaterial color={cor} wireframe transparent opacity={0.9} />
    </mesh>
  );
}

/**
 * A moldura do 2D: quatro barras finas no contorno da peça.
 *
 * Barras, e não um `lineSegments`: linha em WebGL tem 1 pixel de espessura
 * independente do zoom, some ao afastar a planta e não engorda ao aproximar.
 * A barra é geometria de verdade, então acompanha o zoom.
 *
 * `depthTest={false}` porque a moldura tem que aparecer inteira mesmo quando
 * a peça está por baixo de outra — selecionar a mesa com um monitor em cima
 * mostrava só metade do contorno.
 */
function MolduraPlana({
  largura,
  profundidade,
  altura,
  cor = "#f59e0b",
}: {
  largura: number;
  profundidade: number;
  altura: number;
  cor?: string;
}) {
  // Espessura proporcional, com piso e teto: no equipamento pequeno uma barra
  // fixa engolia a peça; na sala de 8 m ela sumia.
  const esp = Math.min(0.12, Math.max(0.035, Math.min(largura, profundidade) * 0.06));
  const y = Math.max(altura, M(4)) + 0.03;
  const L = largura + esp;
  const P = profundidade + esp;

  return (
    <group position={[0, y, 0]} renderOrder={999}>
      {[-1, 1].map((lado) => (
        <mesh key={`x${lado}`} position={[0, 0, (lado * P) / 2]}>
          <boxGeometry args={[L + esp, 0.02, esp]} />
          <meshBasicMaterial color={cor} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
      {[-1, 1].map((lado) => (
        <mesh key={`z${lado}`} position={[(lado * L) / 2, 0, 0]}>
          <boxGeometry args={[esp, 0.02, P + esp]} />
          <meshBasicMaterial color={cor} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
    </group>
  );
}

// ── Cor ───────────────────────────────────────────────────────────────
// Uma função de seis linhas em vez de uma dependência de manipulação de cor:
// os modelos só precisam escurecer um pouco o tom base para dar profundidade
// (o fundo da estante, por exemplo, não pode ter a mesma cor das laterais —
// sem isso a estante lê como um bloco maciço).

/** Clareia (delta > 0) ou escurece (delta < 0) um hex, em pontos percentuais. */
function ajustarCor(hex: string, delta: number): string {
  const limpo = hex.replace("#", "");
  if (limpo.length !== 6) return hex;
  const n = parseInt(limpo, 16);
  const canal = (deslocamento: number) => {
    const v = (n >> deslocamento) & 0xff;
    return Math.max(0, Math.min(255, Math.round(v + (delta / 100) * 255)));
  };
  return `rgb(${canal(16)}, ${canal(8)}, ${canal(0)})`;
}

export const sombrear = (hex: string, p: number) => ajustarCor(hex, p);
