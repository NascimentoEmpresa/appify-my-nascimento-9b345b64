import { useLayoutEffect, useMemo, useRef } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import {
  alturaColuna,
  alturaTravessa,
  centroCaixote,
  linhaOculta,
  localParaMundo,
  pontoDaPlaquinha,
  type ColunaMapa,
  type CorredorMapa,
} from "@/lib/suprimentos/enderecoEstoque";
import { CORES, MEDIDAS, corDoMaterial, pilhasDoCaixote } from "./cena";
import type { CaixoteOcupado } from "@/hooks/useSupEstoqueMapa";

/**
 * As prateleiras do galpão, montadas como as das fotos: montante vertical de
 * cada lado do vão, tábua horizontal em cada linha, travessa grossa na frente
 * com a plaquinha branca, e o fundo fechado.
 *
 * A unidade é a COLUNA (uma pilha de caixotes), não um retângulo de estante —
 * porque no galpão real as pilhas não têm todas a mesma altura nem terminam
 * na mesma linha. Ver o cabeçalho de 20260930000200.
 *
 * Tudo é desenhado com `InstancedMesh`: mais de cem colunas de seis linhas dão
 * centenas de caixotes, e cada caixote tem cinco peças. Uma malha por tipo de
 * peça, com uma instância por repetição, mantém a cena em poucas draw calls em
 * vez de alguns milhares. É o que deixa o giro fluido num PC do escritório.
 */

interface Peca {
  /** Centro da peça, no espaço do galpão. */
  pos: [number, number, number];
  /** Dimensões da caixa antes de girar. */
  tam: [number, number, number];
  /** Giro em torno de Y, em radianos (o mesmo da coluna). */
  rotY: number;
  cor?: string;
}

export interface CaixoteRef {
  corredorId: string;
  colunaId: string;
  rua: string;
  /** O "coluna" do padrão coluna:linha. */
  coluna: number;
  /** O "linha" do padrão coluna:linha. */
  nivel: number;
}

interface Props {
  corredores: CorredorMapa[];
  porCaixote: Map<string, CaixoteOcupado>;
  /** Caixote que a busca acendeu. */
  destaque: CaixoteRef | null;
  /** Caixote clicado. */
  selecionado: CaixoteRef | null;
  /** Coluna selecionada no editor — acende inteira. */
  colunaEmEdicao: string | null;
  onClicarCaixote: (c: CaixoteRef) => void;
}

export function Corredores({
  corredores, porCaixote, destaque, selecionado, colunaEmEdicao, onClicarCaixote,
}: Props) {
  const { montantes, tabuas, travessas, fundos, plaquinhas, conteudo, alvos } = useMemo(() => {
    const montantes: Peca[] = [];
    const tabuas: Peca[] = [];
    const travessas: Peca[] = [];
    const fundos: Peca[] = [];
    const plaquinhas: Peca[] = [];
    const conteudo: Peca[] = [];
    const alvos: { peca: Peca; ref: CaixoteRef }[] = [];

    const e = MEDIDAS.tabua;

    for (const corredor of corredores) {
      for (const k of corredor.colunas) {
        const rotY = (k.rotacao_graus * Math.PI) / 180;
        const H = alturaColuna(k);
        const T = alturaTravessa(k);
        const mundo = (x: number, y: number, z: number): [number, number, number] => {
          const p = localParaMundo(k, { x, y, z });
          return [p.x, p.y, p.z];
        };

        // Montantes dos dois lados da coluna, do chão ao topo.
        for (const x of [0, k.largura_m]) {
          montantes.push({
            pos: mundo(x, H / 2, k.profundidade_m / 2),
            tam: [e, H, k.profundidade_m],
            rotY,
          });
        }

        // Tábua de cada linha, mais a tampa.
        for (let n = 0; n <= k.linhas; n++) {
          const y = k.altura_base_m + n * k.altura_linha_m;
          tabuas.push({
            pos: mundo(k.largura_m / 2, y, k.profundidade_m / 2),
            tam: [k.largura_m, e, k.profundidade_m],
            rotY,
          });
        }

        // Rodapé fechado embaixo — a prateleira não flutua.
        tabuas.push({
          pos: mundo(k.largura_m / 2, k.altura_base_m / 2, k.profundidade_m / 2),
          tam: [k.largura_m, k.altura_base_m, k.profundidade_m * 0.9],
          rotY,
        });

        // Fundo.
        fundos.push({
          pos: mundo(k.largura_m / 2, H / 2, e / 2),
          tam: [k.largura_m, H, e],
          rotY,
        });

        for (let n = 1; n <= k.linhas; n++) {
          const yBase = k.altura_base_m + (n - 1) * k.altura_linha_m;

          // Travessa grossa da frente — é ela que dá a cara da prateleira.
          travessas.push({
            pos: mundo(k.largura_m / 2, yBase + T / 2, k.profundidade_m - e / 2),
            tam: [k.largura_m, T, e],
            rotY,
          });

          if (linhaOculta(k, n)) continue;

          const pl = pontoDaPlaquinha(k, n);
          plaquinhas.push({
            pos: [pl.x, pl.y, pl.z],
            tam: [MEDIDAS.plaquinhaLargura, MEDIDAS.plaquinhaAltura, 0.004],
            rotY,
          });

          const centro = centroCaixote(k, n);
          const ref: CaixoteRef = {
            corredorId: corredor.id, colunaId: k.id,
            rua: corredor.codigo, coluna: k.indice, nivel: n,
          };

          alvos.push({
            peca: {
              pos: [centro.x, centro.y, centro.z],
              tam: [k.largura_m - e, k.altura_linha_m - e, k.profundidade_m - e],
              rotY,
            },
            ref,
          });

          const ocupado = porCaixote.get(`${corredor.codigo}|${n}|${k.indice}`);
          if (!ocupado) continue;

          // Pilhas dentro do vão: quanto mais peça física, mais alta a pilha.
          // É leitura de ocupação, não contagem — o número exato fica no
          // painel lateral.
          const pilhas = pilhasDoCaixote(ocupado.fisico);
          const larguraPilha = (k.largura_m - e) * 0.8;
          // A pilha só pode ocupar a parte do vão que a travessa não tampa.
          const vaoLivre = k.altura_linha_m - T - e;
          const alturaPilha = Math.max(0.03, vaoLivre / 3);
          for (let p = 0; p < pilhas; p++) {
            conteudo.push({
              pos: mundo(
                k.largura_m / 2,
                yBase + e + alturaPilha * (p + 0.5),
                k.profundidade_m * 0.46,
              ),
              tam: [larguraPilha, alturaPilha * 0.86, k.profundidade_m * 0.62],
              rotY,
              cor: corDoMaterial(
                ocupado.fichas[p % ocupado.fichas.length]?.codigo_item ??
                  ocupado.fichas[0]?.material ??
                  `${corredor.codigo}${k.indice}${n}`,
              ),
            });
          }
        }
      }
    }

    return { montantes, tabuas, travessas, fundos, plaquinhas, conteudo, alvos };
  }, [corredores, porCaixote]);

  const refPorIndice = useMemo(() => alvos.map((a) => a.ref), [alvos]);

  return (
    <group>
      <Caixas pecas={montantes} cor={CORES.estante} rugosidade={0.72} sombra />
      <Caixas pecas={tabuas} cor={CORES.estante} rugosidade={0.72} sombra />
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

      <RotulosDeCorredor corredores={corredores} colunaEmEdicao={colunaEmEdicao} />

      {colunaEmEdicao && (
        <ColunaAcesa corredores={corredores} colunaId={colunaEmEdicao} cor={CORES.edicao} />
      )}
      <Realce corredores={corredores} alvo={destaque} cor={CORES.destaque} pulsa />
      <Realce corredores={corredores} alvo={selecionado} cor={CORES.destaqueForte} />
    </group>
  );
}

/**
 * A letra do corredor flutuando sobre a primeira coluna dele, e o número de
 * cada coluna logo acima da pilha. É o que deixa a pessoa se achar de longe —
 * e o número é metade do endereço que ela procura (coluna:linha).
 */
function RotulosDeCorredor({
  corredores, colunaEmEdicao,
}: {
  corredores: CorredorMapa[];
  colunaEmEdicao: string | null;
}) {
  return (
    <>
      {corredores.map((corredor) => {
        const primeira = corredor.colunas[0];
        if (!primeira) return null;
        const p = localParaMundo(primeira, {
          x: primeira.largura_m / 2,
          y: alturaColuna(primeira) + 0.3,
          z: primeira.profundidade_m,
        });
        return (
          <group key={corredor.id}>
            <Text
              position={[p.x, p.y, p.z]}
              rotation={[0, (primeira.rotacao_graus * Math.PI) / 180, 0]}
              fontSize={0.34}
              color="#3f4652"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.007}
              outlineColor="#ffffff"
            >
              {corredor.codigo}
            </Text>

            {corredor.colunas.map((k) => {
              const t = localParaMundo(k, {
                x: k.largura_m / 2,
                y: alturaColuna(k) + 0.09,
                z: k.profundidade_m,
              });
              return (
                <Text
                  key={k.id}
                  position={[t.x, t.y, t.z]}
                  rotation={[0, (k.rotacao_graus * Math.PI) / 180, 0]}
                  fontSize={0.075}
                  color={k.id === colunaEmEdicao ? CORES.edicao : "#7b8794"}
                  anchorX="center"
                  anchorY="middle"
                >
                  {String(k.indice)}
                </Text>
              );
            })}
          </group>
        );
      })}
    </>
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
      m4.compose(new THREE.Vector3(...p.pos), quat, new THREE.Vector3(...p.tam));
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
          ? (ev) => {
              ev.stopPropagation();
              if (ev.instanceId !== undefined) onClick(ev.instanceId);
            }
          : undefined
      }
      onPointerOver={onClick ? () => (document.body.style.cursor = "pointer") : undefined}
      onPointerOut={onClick ? () => (document.body.style.cursor = "auto") : undefined}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        // `instanceColor` MULTIPLICA a cor do material. Com uma base escura,
        // toda pilha sairia quase preta — por isso a base é branca quando
        // quem manda na cor é a instância.
        color={colorido ? "#ffffff" : cor}
        roughness={rugosidade}
        transparent={invisivel}
        opacity={invisivel ? 0 : 1}
        depthWrite={!invisivel}
      />
    </instancedMesh>
  );
}

function acharColunaPorId(corredores: CorredorMapa[], colunaId: string) {
  for (const c of corredores) {
    const k = c.colunas.find((x) => x.id === colunaId);
    if (k) return { corredor: c, coluna: k };
  }
  return null;
}

/** A coluna inteira acesa — mostra no editor qual pilha está selecionada. */
function ColunaAcesa({
  corredores, colunaId, cor,
}: {
  corredores: CorredorMapa[];
  colunaId: string;
  cor: string;
}) {
  const achado = acharColunaPorId(corredores, colunaId);
  if (!achado) return null;
  const k = achado.coluna;
  const H = alturaColuna(k);
  const c = localParaMundo(k, { x: k.largura_m / 2, y: H / 2, z: k.profundidade_m / 2 });

  return (
    <mesh position={[c.x, c.y, c.z]} rotation={[0, (k.rotacao_graus * Math.PI) / 180, 0]}>
      <boxGeometry args={[k.largura_m * 1.03, H * 1.01, k.profundidade_m * 1.03]} />
      <meshStandardMaterial
        color={cor}
        emissive={cor}
        emissiveIntensity={0.5}
        transparent
        opacity={0.17}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * A moldura que acende no caixote procurado, com o endereço em coluna:linha
 * escrito na plaquinha. É o que o olho persegue depois que a câmera pousa.
 */
function Realce({
  corredores, alvo, cor, pulsa,
}: {
  corredores: CorredorMapa[];
  alvo: CaixoteRef | null;
  cor: string;
  pulsa?: boolean;
}) {
  if (!alvo) return null;
  const achado = acharColunaPorId(corredores, alvo.colunaId);
  if (!achado) return null;

  const k = achado.coluna;
  const centro = centroCaixote(k, alvo.nivel);
  const rotY = (k.rotacao_graus * Math.PI) / 180;
  // Recuo maior que o da plaquinha: o texto tem de ficar NA FRENTE dela.
  const etiqueta = pontoDaPlaquinha(k, alvo.nivel, 0.018);

  return (
    <>
      {/* O endereço no padrão coluna:linha, escrito na plaquinha. No galpão
          real toda plaquinha tem texto; escrever em todas seria caro (são
          centenas), e escrever nesta resolve o que importa: quem acabou de
          pousar lê o endereço na madeira, não só no painel. */}
      <Text
        position={[etiqueta.x, etiqueta.y, etiqueta.z]}
        rotation={[0, rotY, 0]}
        fontSize={0.036}
        color="#1f2937"
        anchorX="center"
        anchorY="middle"
      >
        {`${alvo.coluna}:${alvo.nivel}`}
      </Text>

      <group position={[centro.x, centro.y, centro.z]} rotation={[0, rotY, 0]}>
        <mesh>
          <boxGeometry args={[k.largura_m * 0.99, k.altura_linha_m * 0.99, k.profundidade_m * 0.99]} />
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
        <lineSegments>
          <edgesGeometry
            args={[new THREE.BoxGeometry(k.largura_m, k.altura_linha_m, k.profundidade_m)]}
          />
          <lineBasicMaterial color={cor} toneMapped={false} />
        </lineSegments>
      </group>
    </>
  );
}
