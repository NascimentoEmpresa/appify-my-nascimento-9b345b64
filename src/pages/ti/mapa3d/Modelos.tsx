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
  const assento = altura * 0.48;
  return (
    <group>
      <mesh castShadow position={[0, assento, 0]}>
        <boxGeometry args={[largura * 0.9, 0.07, profundidade * 0.9]} />
        <meshStandardMaterial color={cor} roughness={0.75} />
      </mesh>
      <mesh castShadow position={[0, assento + altura * 0.26, -profundidade * 0.4]}>
        <boxGeometry args={[largura * 0.85, altura * 0.5, 0.06]} />
        <meshStandardMaterial color={cor} roughness={0.75} />
      </mesh>
      <mesh castShadow position={[0, assento / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.03, assento, 10]} />
        <meshStandardMaterial color={GRAFITE} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* base de 5 pontas, como toda cadeira de escritório */}
      {Array.from({ length: 5 }).map((_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          // O giro é do MESH, não da geometria: geometry não aceita rotation,
          // e a perna precisa apontar para fora do centro da base.
          <mesh
            key={i}
            castShadow
            position={[Math.cos(a) * largura * 0.3, 0.03, Math.sin(a) * largura * 0.3]}
            rotation={[0, -a, 0]}
          >
            <boxGeometry args={[largura * 0.36, 0.04, 0.04]} />
            <meshStandardMaterial color={GRAFITE} metalness={0.5} roughness={0.5} />
          </mesh>
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
    case "mesa": return <Mesa {...p} />;
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
