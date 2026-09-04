import { useMemo } from "react";
import { M } from "./apoio";
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

function Generico({ cor, largura, profundidade, altura }: PropsModelo) {
  return (
    <mesh castShadow receiveShadow position={[0, altura / 2, 0]}>
      <boxGeometry args={[largura, altura, profundidade]} />
      <meshStandardMaterial color={cor} roughness={0.55} metalness={0.25} />
    </mesh>
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

function Porta({ largura, profundidade, altura }: PropsModelo) {
  const batente = 0.06;
  return (
    <group>
      {[-1, 1].map((lado) => (
        <mesh key={lado} castShadow position={[lado * (largura / 2 - batente / 2), altura / 2, 0]}>
          <boxGeometry args={[batente, altura, profundidade]} />
          <meshStandardMaterial color="#9a6b3f" roughness={0.7} />
        </mesh>
      ))}
      <mesh castShadow position={[0, altura - batente / 2, 0]}>
        <boxGeometry args={[largura, batente, profundidade]} />
        <meshStandardMaterial color="#9a6b3f" roughness={0.7} />
      </mesh>
      {/* a folha, entreaberta — porta fechada some no meio da parede */}
      <group position={[-largura / 2 + batente, 0, 0]} rotation={[0, -0.7, 0]}>
        <mesh castShadow position={[largura / 2, altura / 2, 0]}>
          <boxGeometry args={[largura - batente * 2, altura - batente, 0.035]} />
          <meshStandardMaterial color="#c08a52" roughness={0.65} />
        </mesh>
      </group>
    </group>
  );
}

function Janela({ largura, profundidade, altura }: PropsModelo) {
  return (
    <group>
      <mesh position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, altura, profundidade * 0.6]} />
        <meshStandardMaterial color="#bfe6ff" transparent opacity={0.35} roughness={0.05} metalness={0.1} />
      </mesh>
      <mesh castShadow position={[0, altura / 2, 0]}>
        <boxGeometry args={[largura, 0.05, profundidade]} />
        <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.4} />
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
}: {
  elemento: TiElemento;
  largura: number;
  profundidade: number;
  altura: number;
}) {
  const def = tipoElemento(elemento.tipo);
  const cor = elemento.cor || def.cor;
  const p = { cor, largura, profundidade, altura };

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
    case "sala":
    case "recepcao":
    case "copa":
    case "banheiro":
    case "impressora_area": return <AreaPiso {...p} />;
    // parede, divisória, escada e o que vier: bloco sólido.
    default: return <Generico {...p} />;
  }
}

/** Contorno de seleção — a caixa amarela que mostra o que está pego. */
export function Selecao({
  largura,
  profundidade,
  altura,
}: {
  largura: number;
  profundidade: number;
  altura: number;
}) {
  const args = useMemo<[number, number, number]>(
    () => [largura * 1.06 + 0.02, Math.max(altura, M(4)) * 1.06 + 0.02, profundidade * 1.06 + 0.02],
    [largura, profundidade, altura],
  );
  return (
    <mesh position={[0, Math.max(altura, M(4)) / 2, 0]}>
      <boxGeometry args={args} />
      <meshBasicMaterial color="#f59e0b" wireframe transparent opacity={0.9} />
    </mesh>
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
