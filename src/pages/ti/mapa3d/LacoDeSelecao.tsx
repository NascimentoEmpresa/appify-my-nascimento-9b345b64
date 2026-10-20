import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { TiAtivo, TiElemento, TiPlanta } from "@/hooks/useTiMapa";
import { normalizarArea, pecasNaArea } from "./apoio";
import type { SelecaoCena } from "./Cena3D";

/**
 * O laço de seleção da planta baixa.
 *
 * Arrastar o botão esquerdo no vazio desenha um retângulo e pega tudo que
 * couber dentro dele. Existe só no 2D, e de propósito: no 3D o mesmo botão
 * gira a maquete, e um retângulo desenhado sobre uma cena em perspectiva não
 * corresponde a área nenhuma do chão — o que a tela mostra como "quadrado" é
 * um trapézio no piso, e a seleção sairia diferente do traço prometido.
 *
 * ⚠ O RETÂNGULO É DOM CRU, MEXIDO NA MÃO — E TEM QUE SER
 *   Este componente vive DENTRO do <Canvas>, e lá quem reconcilia a árvore é
 *   o react-three-fiber, não o react-dom: tudo o que se devolve dali é
 *   esperado ser objeto de cena (mesh, group, geometria). A primeira versão
 *   devolvia `createPortal(<div/>, ...)` do react-dom, e o resultado era a
 *   TELA INTEIRA EM BRANCO no primeiro arrasto — o reconciler do R3F tentava
 *   montar uma div como filha da cena 3D e derrubava a árvore toda, sem erro
 *   nenhum visível na página.
 *
 *   Por isso a marca é criada com `document.createElement`, pendurada ao lado
 *   do canvas e movida escrevendo em `style`. O componente devolve `null`:
 *   ele não põe nada na cena. De quebra sai de graça o que mais importa num
 *   arrasto — mover o retângulo não custa render nenhum do React, e a cena
 *   (que roda em `frameloop="demand"`) não redesenha à toa.
 *
 * A CONVERSÃO
 *   Os dois cantos vão de pixel para o piso por um raio lançado da câmera até
 *   o plano do andar. Serve para ortográfica e perspectiva e continua certo
 *   em qualquer zoom — nada aqui supõe a câmera num lugar específico.
 */

/**
 * Abaixo disto o gesto ainda é um clique, não um arrasto (em pixels).
 *
 * Exportado porque o piso decide pelo MESMO número se o gesto que terminou
 * nele foi um clique: dois limiares diferentes abririam uma faixa de arrastos
 * curtos que seriam laço para um e clique para o outro.
 */
export const LIMIAR_ARRASTO_PX = 5;

export function LacoDeSelecao({
  ligado,
  planta,
  elementos,
  ativos,
  base,
  arrastandoRef,
  gestoEmPecaRef,
  onSelecionarArea,
}: {
  ligado: boolean;
  planta: TiPlanta;
  elementos: TiElemento[];
  ativos: TiAtivo[];
  /** Altura (em metros) do andar corrente — o plano onde o laço é medido. */
  base: number;
  /**
   * Avisa o Canvas que houve arrasto.
   *
   * Sem isto o `onPointerMissed` do R3F (o "clicou no vazio, desmarque tudo")
   * dispara no soltar e apaga a seleção no mesmo instante em que ela é feita
   * — o laço marcava dez peças e entregava zero.
   */
  arrastandoRef: React.MutableRefObject<boolean>;
  /**
   * O gesto em curso começou numa peça — então não é laço, é arrasto.
   *
   * Quem levanta é a cena (ver `gestoEmPecaRef` lá); aqui só se lê e, no
   * soltar, se abaixa de novo.
   */
  gestoEmPecaRef: React.MutableRefObject<boolean>;
  onSelecionarArea: (itens: SelecaoCena[], aditivo: boolean) => void;
}) {
  const { camera, gl } = useThree();

  // Em refs, não em estado: estes valores são lidos e escritos no meio de um
  // `pointermove`, que roda a cada pixel e não pode esperar um render.
  const inicioRef = useRef<{ sx: number; sy: number } | null>(null);
  const passouRef = useRef(false);

  useEffect(() => {
    if (!ligado) return;
    const tela = gl.domElement;
    // O R3F já entrega o pai do canvas posicionado, então basta pendurar a
    // marca nele e falar em coordenadas da moldura.
    const moldura = tela.parentElement;
    if (!moldura) return;

    const marca = document.createElement("div");
    marca.style.cssText = [
      "position:absolute",
      "border:1.5px dashed #2563eb",
      "background:rgba(37,99,235,0.12)",
      // Sem isto a própria marca engoliria o `pointerup` que a encerra.
      "pointer-events:none",
      "z-index:20",
      "display:none",
    ].join(";");
    moldura.appendChild(marca);

    const paraOPiso = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const r = tela.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - r.left) / r.width) * 2 - 1,
        -((clientY - r.top) / r.height) * 2 + 1,
      );
      const raio = new THREE.Raycaster();
      raio.setFromCamera(ndc, camera);
      const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -base);
      const ponto = new THREE.Vector3();
      return raio.ray.intersectPlane(plano, ponto) ? ponto : null;
    };

    const aoDescer = (e: PointerEvent) => {
      // Esquerdo só. O direito arrasta a planta e o meio a acompanha — quem
      // manda nisso é o OrbitControls, e um laço por cima roubaria os dois.
      if (e.button !== 0) return;
      inicioRef.current = { sx: e.clientX, sy: e.clientY };
      passouRef.current = false;
    };

    const aoMover = (e: PointerEvent) => {
      const ini = inicioRef.current;
      if (!ini) return;
      // Pegou uma mesa e saiu andando: é a peça que se move, não um laço.
      if (gestoEmPecaRef.current) return;
      const dx = e.clientX - ini.sx;
      const dy = e.clientY - ini.sy;
      if (!passouRef.current && Math.hypot(dx, dy) < LIMIAR_ARRASTO_PX) return;

      passouRef.current = true;
      arrastandoRef.current = true;

      const r = tela.getBoundingClientRect();
      marca.style.display = "block";
      marca.style.left = Math.min(ini.sx, e.clientX) - r.left + "px";
      marca.style.top = Math.min(ini.sy, e.clientY) - r.top + "px";
      marca.style.width = Math.abs(dx) + "px";
      marca.style.height = Math.abs(dy) + "px";
    };

    const aoSubir = (e: PointerEvent) => {
      const ini = inicioRef.current;
      inicioRef.current = null;
      marca.style.display = "none";
      // Acabou o gesto: a próxima descida começa sem herança nenhuma.
      const eraPeca = gestoEmPecaRef.current;
      const arrastou = passouRef.current;
      gestoEmPecaRef.current = false;
      passouRef.current = false;

      if (!ini || eraPeca || !arrastou) return;

      const a = paraOPiso(ini.sx, ini.sy);
      const b = paraOPiso(e.clientX, e.clientY);
      // Laço solto fora do plano do andar (câmera muito rasante) não
      // seleciona nada, em vez de selecionar errado.
      if (a && b) {
        const area = normalizarArea(a.x * 100, a.z * 100, b.x * 100, b.z * 100);
        onSelecionarArea(pecasNaArea(area, elementos, ativos, planta.id), e.shiftKey);
      }

      // Só depois que o R3F terminar de processar este mesmo `pointerup` — é
      // lá que mora o `onPointerMissed` que precisamos calar.
      setTimeout(() => { arrastandoRef.current = false; }, 0);
    };

    tela.addEventListener("pointerdown", aoDescer);
    // Move e sobe na JANELA: quem arrasta passa do canvas para a barra
    // lateral o tempo todo, e um laço que morre ao sair da moldura é um laço
    // que falha justamente nas seleções grandes.
    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSubir);
    return () => {
      tela.removeEventListener("pointerdown", aoDescer);
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSubir);
      marca.remove();
      // Desligar no meio de um arrasto (trocou de ferramenta, foi para o 3D)
      // não pode deixar marca levantada: sem os listeners, ninguém a abaixa.
      inicioRef.current = null;
      passouRef.current = false;
      gestoEmPecaRef.current = false;
    };
  }, [ligado, gl, camera, base, elementos, ativos, planta.id, arrastandoRef, gestoEmPecaRef, onSelecionarArea]);

  // NADA na cena: ver o aviso no cabeçalho.
  return null;
}
