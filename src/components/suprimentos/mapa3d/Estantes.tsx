import { useLayoutEffect, useMemo, useRef } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import {
  ALTURA_RODAPE_M,
  alturaModulo,
  caixoteOculto,
  centroCaixote,
  larguraModulo,
  localParaMundo,
  type ModuloMapa,
} from "@/lib/suprimentos/enderecoEstoque";
import { CORES, MEDIDAS, corDoMaterial, pilhasDoCaixote } from "./cena";
import type { CaixoteOcupado } from "@/hooks/useSupEstoqueMapa";

/**
 * As estantes do galpão, montadas como as do vídeo: montante vertical entre
 * cada vão, prateleira horizontal em cada nível, travessa na frente com as
 * plaquinhas brancas, e o fundo fechado.
 *
 * Tudo isso é desenhado com `InstancedMesh` — sete estantes de 15 colunas por
 * 6 níveis dão mais de 600 caixotes, e cada caixote tem cinco peças. Uma malha
 * por peça, com uma instância por repetição, mantém a cena em ~10 draw calls
 * em vez de alguns milhares. É o que deixa o giro fluido num PC do escritório.
 */

interface Peca {
  /** Centro da peça, no espaço do galpão. */
  pos: [number, number, number];
  /** Dimensões da caixa antes de girar. */
  tam: [number, number, number];
  /** Giro em torno de Y, em radianos (o mesmo da estante). */
  rotY: number;
  cor?: string;
}

export interface CaixoteRef {
  moduloId: string;
  rua: string;
  nivel: number;
  coluna: number;
}

interface Props {
  modulos: ModuloMapa[];
  porCaixote: Map<string, CaixoteOcupado>;
  /** Caixote que a busca acendeu. */
  destaque: CaixoteRef | null;
  /** Caixote clicado. */
  selecionado: CaixoteRef | null;
  /** Estante selecionada no editor. */
  moduloEmEdicao: string | null;
  onClicarCaixote: (c: CaixoteRef) => void;
}

export function Estantes({
  modulos, porCaixote, destaque, selecionado, moduloEmEdicao, onClicarCaixote,
}: Props) {
  /**
   * Monta a lista de peças uma vez por mudança de planta. Cada peça já sai
   * posicionada no espaço do galpão — a rotação da estante é aplicada aqui,
   * não na matriz de um grupo, porque instância não herda transformação de
   * grupo quando as instâncias vêm de estantes diferentes.
   */
  const { montantes, prateleiras, travessas, fundos, plaquinhas, conteudo, alvos } = useMemo(() => {
    const montantes: Peca[] = [];
    const prateleiras: Peca[] = [];
    const travessas: Peca[] = [];
    const fundos: Peca[] = [];
    const plaquinhas: Peca[] = [];
    const conteudo: Peca[] = [];
    const alvos: { peca: Peca; ref: CaixoteRef }[] = [];

    const e = MEDIDAS.tabua;

    for (const m of modulos) {
      const rotY = (m.rotacao_graus * Math.PI) / 180;
      const W = larguraModulo(m);
      const H = alturaModulo(m);
      const D = m.profundidade_m;
      const mundo = (x: number, y: number, z: number): [number, number, number] => {
        const p = localParaMundo(m, { x, y, z });
        return [p.x, p.y, p.z];
      };

      // Montantes: um em cada divisa de coluna, subindo a estante inteira.
      for (let c = 0; c <= m.colunas; c++) {
        montantes.push({
          pos: mundo(c * m.largura_vao_m, H / 2, D / 2),
          tam: [e, H, D],
          rotY,
        });
      }

      // Prateleiras: o piso de cada nível, mais a tampa de cima.
      for (let n = 0; n <= m.niveis; n++) {
        const y = ALTURA_RODAPE_M + n * m.altura_nivel_m;
        prateleiras.push({ pos: mundo(W / 2, y, D / 2), tam: [W, e, D], rotY });
      }

      // Rodapé fechado embaixo, como no vídeo (a estante não flutua).
      prateleiras.push({
        pos: mundo(W / 2, ALTURA_RODAPE_M / 2, D / 2),
        tam: [W, ALTURA_RODAPE_M, D * 0.9],
        rotY,
      });

      // Fundo.
      fundos.push({ pos: mundo(W / 2, H / 2, e / 2), tam: [W, H, e], rotY });

      // Travessa da frente de cada nível + as plaquinhas presas nela.
      for (let n = 1; n <= m.niveis; n++) {
        const yBase = ALTURA_RODAPE_M + (n - 1) * m.altura_nivel_m;
        travessas.push({
          pos: mundo(W / 2, yBase + MEDIDAS.travessa / 2, D - e / 2),
          tam: [W, MEDIDAS.travessa, e],
          rotY,
        });

        for (let c = 1; c <= m.colunas; c++) {
          if (caixoteOculto(m, n, c)) continue;
          plaquinhas.push({
            pos: mundo(
              (c - 0.5) * m.largura_vao_m,
              yBase + MEDIDAS.travessa / 2,
              D + 0.002,
            ),
            tam: [MEDIDAS.plaquinhaLargura, MEDIDAS.plaquinhaAltura, 0.004],
            rotY,
          });
        }
      }

      // Conteúdo e alvos de clique, caixote a caixote.
      for (let n = 1; n <= m.niveis; n++) {
        for (let c = 1; c <= m.colunas; c++) {
          if (caixoteOculto(m, n, c)) continue;

          const centro = centroCaixote(m, n, c);
          const ref: CaixoteRef = { moduloId: m.id, rua: m.codigo, nivel: n, coluna: c };

          alvos.push({
            peca: {
              pos: [centro.x, centro.y, centro.z],
              tam: [m.largura_vao_m - e, m.altura_nivel_m - e, D - e],
              rotY,
            },
            ref,
          });

          const ocupado = porCaixote.get(`${m.codigo}|${n}|${c}`);
          if (!ocupado) continue;

          // Pilhas de material dentro do vão: quanto mais peça física, mais
          // alta a pilha. É leitura de ocupação, não contagem — a contagem
          // exata está no painel lateral.
          const pilhas = pilhasDoCaixote(ocupado.fisico);
          const larguraPilha = (m.largura_vao_m - e) * 0.78;
          const alturaPilha = (m.altura_nivel_m - e) * 0.22;
          for (let p = 0; p < pilhas; p++) {
            const yLocal =
              ALTURA_RODAPE_M + (n - 1) * m.altura_nivel_m + e + alturaPilha * (p + 0.5);
            conteudo.push({
              pos: mundo((c - 0.5) * m.largura_vao_m, yLocal, D * 0.46),
              tam: [larguraPilha, alturaPilha * 0.88, D * 0.62],
              rotY,
              cor: corDoMaterial(
                ocupado.fichas[p % ocupado.fichas.length]?.codigo_item ??
                  ocupado.fichas[0]?.material ??
                  `${m.codigo}${n}${c}`,
              ),
            });
          }
        }
      }
    }

    return { montantes, prateleiras, travessas, fundos, plaquinhas, conteudo, alvos };
  }, [modulos, porCaixote]);

  const refPorIndice = useMemo(() => alvos.map((a) => a.ref), [alvos]);

  return (
    <group>
      <Caixas pecas={montantes} cor={CORES.estante} rugosidade={0.72} sombra />
      <Caixas pecas={prateleiras} cor={CORES.estante} rugosidade={0.72} sombra />
      <Caixas pecas={travessas} cor={CORES.travessa} rugosidade={0.6} sombra />
      <Caixas pecas={fundos} cor={CORES.fundoCaixote} rugosidade={0.95} />
      <Caixas pecas={plaquinhas} cor={CORES.plaquinha} rugosidade={0.35} />
      <Caixas pecas={conteudo} cor={CORES.ocupado} rugosidade={0.88} sombra colorido />

      {/* Alvos de clique: existem para o raycast, e não aparecem. Precisam
          ficar `visible`, senão o three nem testa a interseção. */}
      <Caixas
        pecas={alvos.map((a) => a.peca)}
        cor="#ffffff"
        rugosidade={1}
        invisivel
        onClick={(i) => {
          const ref = refPorIndice[i];
          if (ref) onClicarCaixote(ref);
        }}
      />

      {/* Letra da estante, flutuando na frente dela — é o "A" que a pessoa
          procura de longe. */}
      {modulos.map((m) => {
        const p = localParaMundo(m, {
          x: larguraModulo(m) / 2,
          y: alturaModulo(m) + 0.22,
          z: m.profundidade_m,
        });
        return (
          <Text
            key={m.id}
            position={[p.x, p.y, p.z]}
            rotation={[0, (m.rotacao_graus * Math.PI) / 180, 0]}
            fontSize={0.3}
            color={moduloEmEdicao === m.id ? CORES.edicao : "#3f4652"}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.006}
            outlineColor="#ffffff"
          >
            {m.codigo}
          </Text>
        );
      })}

      <Realce modulos={modulos} alvo={destaque} cor={CORES.destaque} pulsa />
      <Realce modulos={modulos} alvo={selecionado} cor={CORES.destaqueForte} />
    </group>
  );
}

/**
 * Uma malha instanciada para um monte de caixas iguais em forma e diferentes
 * em tamanho/posição. A geometria é um cubo de 1 m; o tamanho vira escala na
 * matriz de cada instância.
 */
function Caixas({
  pecas, cor, rugosidade, sombra, colorido, invisivel, onClick,
}: {
  pecas: Peca[];
  cor: string;
  rugosidade: number;
  sombra?: boolean;
  colorido?: boolean;
  invisivel?: boolean;
  onClick?: (indice: number) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const eixo = new THREE.Vector3(0, 1, 0);
    const cor3 = new THREE.Color();

    pecas.forEach((p, i) => {
      quat.setFromAxisAngle(eixo, p.rotY);
      m4.compose(
        new THREE.Vector3(...p.pos),
        quat,
        new THREE.Vector3(...p.tam),
      );
      malha.setMatrixAt(i, m4);
      if (colorido) malha.setColorAt(i, cor3.set(p.cor ?? cor));
    });

    malha.instanceMatrix.needsUpdate = true;
    if (colorido && malha.instanceColor) malha.instanceColor.needsUpdate = true;
    malha.computeBoundingSphere();
  }, [pecas, colorido, cor]);

  if (pecas.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[undefined as any, undefined as any, pecas.length]}
      castShadow={!!sombra}
      receiveShadow={!!sombra}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              if (e.instanceId !== undefined) onClick(e.instanceId);
            }
          : undefined
      }
      onPointerOver={onClick ? () => (document.body.style.cursor = "pointer") : undefined}
      onPointerOut={onClick ? () => (document.body.style.cursor = "auto") : undefined}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        // `instanceColor` MULTIPLICA a cor do material. Com uma cor de base
        // escura, toda pilha sairia quase preta — por isso a base é branca
        // quando quem manda na cor é a instância.
        color={colorido ? "#ffffff" : cor}
        roughness={rugosidade}
        transparent={invisivel}
        opacity={invisivel ? 0 : 1}
        depthWrite={!invisivel}
      />
    </instancedMesh>
  );
}

/**
 * A moldura que acende no caixote procurado. Fica ligeiramente maior que o
 * vão para aparecer por cima das peças da estante, e pulsa quando é resultado
 * de busca — é o que o olho persegue depois que a câmera pousa.
 */
function Realce({
  modulos, alvo, cor, pulsa,
}: {
  modulos: ModuloMapa[];
  alvo: CaixoteRef | null;
  cor: string;
  pulsa?: boolean;
}) {
  const m = alvo ? modulos.find((x) => x.id === alvo.moduloId) : null;
  if (!alvo || !m) return null;

  const centro = centroCaixote(m, alvo.nivel, alvo.coluna);
  const rotY = (m.rotacao_graus * Math.PI) / 180;

  // A plaquinha deste vão, para escrever o endereço nela. No galpão real toda
  // plaquinha tem texto; escrever em todas seria caro (são mais de 600), e
  // escrever só nesta resolve o que importa: quem acabou de pousar lê o
  // endereço na madeira, e não só no painel da direita.
  const etiqueta = localParaMundo(m, {
    x: (alvo.coluna - 0.5) * m.largura_vao_m,
    y: ALTURA_RODAPE_M + (alvo.nivel - 1) * m.altura_nivel_m + MEDIDAS.travessa / 2,
    z: m.profundidade_m + 0.006,
  });
  const endereco = `${m.codigo}-${String(alvo.nivel).padStart(2, "0")}-${String(alvo.coluna).padStart(2, "0")}`;

  return (
    <>
      <Text
        position={[etiqueta.x, etiqueta.y, etiqueta.z]}
        rotation={[0, rotY, 0]}
        fontSize={0.038}
        color="#1f2937"
        anchorX="center"
        anchorY="middle"
      >
        {endereco}
      </Text>
    <group position={[centro.x, centro.y, centro.z]} rotation={[0, rotY, 0]}>
      <mesh>
        <boxGeometry
          args={[m.largura_vao_m * 0.99, m.altura_nivel_m * 0.99, m.profundidade_m * 0.99]}
        />
        <meshStandardMaterial
          color={cor}
          emissive={cor}
          emissiveIntensity={pulsa ? 0.85 : 0.45}
          transparent
          opacity={pulsa ? 0.34 : 0.22}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Contorno, para o vão ficar legível mesmo com a estante cheia */}
      <lineSegments>
        <edgesGeometry
          args={[
            new THREE.BoxGeometry(
              m.largura_vao_m * 1.0,
              m.altura_nivel_m * 1.0,
              m.profundidade_m * 1.0,
            ),
          ]}
        />
        <lineBasicMaterial color={cor} toneMapped={false} />
      </lineSegments>
    </group>
    </>
  );
}
