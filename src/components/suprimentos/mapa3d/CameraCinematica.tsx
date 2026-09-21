import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Ponto3D } from "@/lib/suprimentos/enderecoEstoque";

/**
 * O voo da câmera: sai de onde o pessoal está sentado e pousa na frente do
 * caixote do item.
 *
 * Do pedido (SIS-2026-0442): "tipo puxar em um efeito de zoom desde o local
 * onde o pessoal fica sentado mexendo nos pc até a baia do item, tudo em 3d
 * dando um zoom".
 *
 * Duas decisões que fazem a diferença entre "parece câmera" e "parece
 * teletransporte":
 *
 *   1. O caminho é um arco, não uma reta. A câmera sobe acima das estantes no
 *      meio do percurso e desce sobre a baia — em linha reta ela atravessaria
 *      a estante da frente, e o corte pelo meio da madeira estraga a ilusão.
 *   2. O alvo do olhar viaja junto, interpolado à parte. Assim a cena gira
 *      enquanto se aproxima, em vez de chegar e só então virar o pescoço.
 *
 * Enquanto voa, o controle de órbita fica desligado: mouse e animação
 * disputando a mesma câmera brigam e tremem.
 */

export interface Voo {
  /** Onde a câmera vai parar. */
  posicao: Ponto3D;
  /** Para onde ela vai estar olhando quando parar. */
  alvo: Ponto3D;
  /** Muda quando é para voar de novo — inclusive para o mesmo lugar. */
  chave: string;
  /** Segundos. Um pouco mais lento quando é longe. */
  duracao?: number;
}

interface Props {
  voo: Voo | null;
  controles: React.MutableRefObject<any>;
  /** Altura do forro, em metros — define por onde o voo longo passa. */
  peDireito: number;
  /** Avisa a tela quando pousou, para ela soltar o texto do caixote. */
  aoPousar?: () => void;
}

const v = (p: Ponto3D) => new THREE.Vector3(p.x, p.y, p.z);

/** Começa devagar, acelera no meio, freia no fim. */
function suavizar(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function CameraCinematica({ voo, controles, peDireito, aoPousar }: Props) {
  const { camera } = useThree();
  const anim = useRef<{
    t: number;
    duracao: number;
    de: THREE.Vector3;
    meio: THREE.Vector3;
    para: THREE.Vector3;
    deAlvo: THREE.Vector3;
    paraAlvo: THREE.Vector3;
  } | null>(null);

  useEffect(() => {
    if (!voo) return;

    const de = camera.position.clone();
    const para = v(voo.posicao);
    const deAlvo = controles.current?.target?.clone() ?? new THREE.Vector3();
    const paraAlvo = v(voo.alvo);

    // ONDE O ARCO PASSA — a parte que mais custou a acertar.
    //
    // As estantes deste galpão vão do chão ao forro (6 níveis de 48 cm + o
    // rodapé dão ~2,97 m num pé-direito de 3,10 m). Não existe altura DENTRO
    // da sala por onde a câmera passe por cima delas: um arco "alto o
    // suficiente" ainda atravessa a madeira no meio do caminho — foi o que
    // apareceu no primeiro teste, um quadro inteiro de dentro de uma estante.
    //
    // Então o voo longo sai da sala por cima: sobe acima do forro, cruza o
    // galpão vendo a planta inteira de cima (o forro é desenhado só por
    // baixo, então de cima a sala fica aberta) e desce no corredor certo.
    // Além de não atravessar nada, a subida serve de mapa: a pessoa vê para
    // que canto do estoque está indo.
    //
    // Salto curto — clicar num vão vizinho — não faz esse contorno: subir 6 m
    // para andar 2 seria ridículo, e dentro do mesmo corredor não há estante
    // no caminho.
    const distancia = de.distanceTo(para);
    const meio = de.clone().add(para).multiplyScalar(0.5);

    const saltoCurto = distancia < 5;
    // Altura que a curva REALMENTE atinge (no meio, t=0.5) é
    // 0,25·de + 0,5·meio + 0,25·para — por isso o ponto de controle é
    // calculado de trás para frente, a partir do topo desejado.
    const topoDesejado = saltoCurto
      ? Math.max(de.y, para.y) + distancia * 0.12
      : peDireito + 2.6;
    meio.y = (topoDesejado - 0.25 * de.y - 0.25 * para.y) / 0.5;

    anim.current = {
      t: 0,
      duracao: voo.duracao ?? Math.min(3.2, 1.5 + distancia * 0.075),
      de, meio, para, deAlvo, paraAlvo,
    };

    if (controles.current) controles.current.enabled = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voo?.chave]);

  useFrame((_, delta) => {
    const a = anim.current;
    if (!a) return;

    a.t = Math.min(1, a.t + delta / a.duracao);
    const e = suavizar(a.t);

    // Bézier quadrática: de → meio → para.
    const u = 1 - e;
    const p = new THREE.Vector3()
      .addScaledVector(a.de, u * u)
      .addScaledVector(a.meio, 2 * u * e)
      .addScaledVector(a.para, e * e);
    camera.position.copy(p);

    const alvo = a.deAlvo.clone().lerp(a.paraAlvo, e);
    if (controles.current) {
      controles.current.target.copy(alvo);
      controles.current.update();
    } else {
      camera.lookAt(alvo);
    }

    if (a.t >= 1) {
      anim.current = null;
      if (controles.current) controles.current.enabled = true;
      aoPousar?.();
    }
  });

  return null;
}
