import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Grid, Html, OrbitControls, SoftShadows } from "@react-three/drei";
import * as THREE from "three";
import type { TiAtivo, TiCelula, TiElemento, TiPlanta } from "@/hooks/useTiMapa";
import { PASSO_PADRAO_CM, statusAtivo, tipoAtivo, tipoElemento } from "../mapa/catalogo";
import {
  M,
  alturaDeApoio,
  alturaDoAndar,
  bordaParaRemover,
  celulasDoRetangulo,
  chaveCelula,
  contornoParaExpandir,
  alturaDoElemento,
  camaraDePlanta,
  camaraInicial,
  celulasDoArrasto,
  cantoDaPeca,
  centroDaPeca,
  dimensoesAtivo,
  pontasDaParede,
  rad,
  redimensionarPorCanto,
  retanguloDoTraco,
  snap,
  vaosNaParede,
} from "./apoio";
import { ModeloDoAtivo, ModeloDoElemento, Selecao } from "./Modelos";

/**
 * A cena 3D do escritório.
 *
 * COMO ELA SE ORGANIZA
 *   O mundo é medido em METROS (o banco guarda centímetros; `M()` converte na
 *   borda). O canto superior esquerdo da planta é a origem: um objeto em
 *   x=300, y=150 no banco aparece em x=3, z=1.5 na cena. O eixo Y é a altura,
 *   e a base de todo modelo nasce em y=0 — quem levanta o objeto para cima da
 *   mesa é `alturaDeApoio`, não o modelo.
 *
 *   O MESMO componente serve as duas telas. `editavel` decide se arrastar,
 *   desenhar e apagar existem: no Mapa ele é falso e a cena vira um passeio.
 *
 * ARRASTAR SEM TRAVAR — a regra mais importante deste arquivo
 *   Enquanto o dedo está no objeto, a posição vive AQUI, em estado local
 *   (`previa`), e a cena redesenha sozinha. A gravação no banco acontece UMA
 *   vez, no soltar (`onSoltarElemento` / `onSoltarAtivo`).
 *
 *   A primeira versão chamava a mutation a cada `pointermove`: um UPDATE no
 *   Supabase por pixel arrastado, dezenas por segundo. A parede andava aos
 *   trancos, o histórico enchia de linhas e o banco levava a culpa. Se
 *   precisar mexer aqui, mantenha a regra: **mover é local, soltar é que
 *   persiste**.
 *
 * DESENHAR PAREDE
 *   Parede não se cria clicando e digitando o comprimento. Com a ferramenta
 *   ativa, arrasta-se do começo ao fim do traço e a peça nasce com o
 *   comprimento e o ângulo do arrasto — é como se desenha uma planta.
 *
 * frameloop="demand": a cena só redesenha quando algo muda (arrasto, câmera,
 * dado novo). Sem isso o canvas fica em 60 fps eternos consumindo GPU com o
 * escritório parado na tela.
 */

/**
 * Como a planta é editada.
 *
 * Não são dois editores: é a MESMA cena com outra câmera. Arrastar, desenhar
 * parede, esticar sala e o histórico são um código só — o 2D troca a câmera
 * por uma ortográfica olhando de cima e tranca o giro, que é exatamente o que
 * diferencia uma planta baixa de uma maquete. Duplicar o editor para ter as
 * duas vistas seria duplicar também todo bug de arrasto.
 */
export type ModoCena = "2d" | "3d";

export type SelecaoCena =
  | { tipo: "elemento"; id: string }
  | { tipo: "ativo"; id: string }
  | null;

/** Um traço feito no chão, em cm: do ponto inicial ao final. */
export interface TracoNoChao {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Verdadeiro quando foi um clique seco, sem arrastar. */
  clique: boolean;
}

interface Props {
  planta: TiPlanta;
  elementos: TiElemento[];
  ativos: TiAtivo[];
  selecao: SelecaoCena;
  /**
   * TUDO que está pego, inclusive a peça de `selecao`.
   *
   * `selecao` continua sendo a peça "principal" — é dela que o inspetor
   * mostra tamanho, cor e giro, porque um inspetor de cinco peças ao mesmo
   * tempo não teria o que mostrar. `grupo` é o que se arrasta e o que se
   * duplica junto: uma mesa com as quatro cadeiras é um bloco que se repete
   * em vários setores, e mover isso peça por peça era o trabalho.
   */
  grupo?: SelecaoCena[];
  /** `aditivo` = Shift na mão: soma (ou tira) do grupo em vez de trocar. */
  onSelecionar: (s: SelecaoCena, aditivo?: boolean) => void;
  /**
   * Onde o Ctrl+V vai colar, em cm — o ponto vermelho no chão.
   *
   * Mora na cena, e não na barra, porque é uma marca no MUNDO: anda com a
   * câmera, encaixa na grade e fica onde o dedo apontou, que é o ponto todo
   * de "cola AQUI".
   */
  alvoColagem?: { x: number; y: number } | null;
  /** Clique no chão com o cursor na mão — é o que escolhe o alvo. */
  onCliqueNoChao?: (x: number, y: number) => void;
  editavel: boolean;
  /** Vista: planta baixa (2d) ou maquete (3d). Padrão: 3d. */
  modo?: ModoCena;
  destaque?: string;
  mostrarGrade?: boolean;
  mostrarRotulos?: boolean;
  /** Ferramenta ativa (só o rótulo importa aqui: se há algo para desenhar). */
  desenhando?: boolean;
  /**
   * O arrasto em curso é de PISO (modo obra), não de peça.
   *
   * Muda só o desenho da prévia: quem cria o piso é a tela, no
   * `onDesenharNoChao` — a cena continua sem saber o que a ferramenta faz.
   */
  pintandoPiso?: boolean;
  /**
   * Borracha de estrutura ligada: o clique APAGA a parede em vez de pegá-la.
   *
   * Fica separado de `desenhando` porque a borracha não desenha nada — mas
   * também não pode deixar selecionar nem arrastar, senão o clique que era
   * para apagar sai empurrando a parede.
   */
  apagandoEstrutura?: boolean;
  onApagarElemento?: (id: string) => void;
  /**
   * Modo obra ligado — piso e parede, não mobília.
   *
   * A cena usa isto só para pôr o tapete de fora (ver `TapeteDeObra`): é o
   * que permite COMEÇAR um arrasto onde ainda não há piso.
   */
  obra?: boolean;
  /**
   * Passo (cm) com que as peças andam ao serem arrastadas. NÃO é o quadrado do
   * piso: mover um monitor pede centímetros, o piso cresce de metro em metro.
   */
  passoCm?: number;
  /** Traço concluído no chão — cria a peça. */
  onDesenharNoChao?: (t: TracoNoChao) => void;
  /** Fim do arrasto: a hora (única) de gravar. */
  onSoltarElemento?: (id: string, x: number, y: number) => void;
  onSoltarAtivo?: (id: string, x: number, y: number) => void;
  /** Fim do redimensionamento (puxar parede pela ponta, esticar sala pela quina). */
  onRedimensionar?: (id: string, patch: Partial<TiElemento>) => void;
  /**
   * Os quadrados que formam o piso. Vazio = planta antiga, ainda retangular:
   * a cena desenha o retângulo inteiro (ver `celulasDoRetangulo`).
   */
  celulas?: TiCelula[];
  /** Clique num "+" (ocupar) ou "−" (liberar) de UM quadrado de 1 m². */
  onDefinirCelula?: (cx: number, cy: number, ocupar: boolean) => void;
  onAbrirFicha?: (ativoId: string) => void;
  /**
   * Andares abaixo/acima, desenhados translúcidos e SEM interação.
   *
   * Servem de referência ("a sala do 2º fica em cima de qual?") sem virar um
   * segundo editor: quem edita é sempre o andar corrente, e peça de outro
   * andar não deve responder a clique nem entrar no raycast do arrasto.
   */
  andaresVizinhos?: {
    planta: TiPlanta;
    elementos: TiElemento[];
    ativos: TiAtivo[];
    celulas?: TiCelula[];
  }[];
  /** Todas as plantas — a cena precisa delas para calcular a altura do andar. */
  plantas?: TiPlanta[];
}

export function Cena3D(props: Props) {
  const { planta, onSelecionar, modo = "3d" } = props;
  const planta2d = modo === "2d";
  const camera = useMemo(
    () =>
      planta2d
        ? camaraDePlanta(planta.largura_cm, planta.altura_cm)
        : camaraInicial(planta.largura_cm, planta.altura_cm),
    [planta2d, planta.largura_cm, planta.altura_cm],
  );

  return (
    <Canvas
      /**
       * Trocar de modo remonta o canvas.
       *
       * `orthographic` decide QUAL classe de câmera o R3F instancia; alternar a
       * prop no mesmo canvas deixa OrbitControls e raycaster apontando para a
       * câmera antiga, e o resultado é uma cena que não responde mais ao mouse.
       * A remontagem custa um quadro e não tem esse buraco.
       */
      key={modo}
      orthographic={planta2d}
      shadows="soft"
      frameloop="demand"
      dpr={[1, 1.75]}
      camera={
        planta2d
          ? // O zoom sai daqui com um chute; quem enquadra de verdade é
            // <EnquadrarPlanta>, que só sabe o tamanho do canvas lá dentro.
            { position: camera, zoom: 40, near: 0.1, far: 8000 }
          : { position: camera, fov: 42, near: 0.05, far: 8000 }
      }
      // ACESFilmic + sRGB: sem tonemapping o branco das paredes "estoura" e o
      // ambiente fica lavado, com aquele aspecto de render de estudo. É o
      // ajuste mais barato que aproxima a cena de um render de jogo.
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      /**
       * Clicar no vazio desmarca.
       *
       * `onPointerMissed` é o evento do R3F para "o clique não acertou objeto
       * nenhum" — o equivalente 3D de clicar no fundo da tela. Sem ele a peça
       * ficava selecionada para sempre, com as alças por cima de tudo, e a
       * única saída era o X da barra ou o Esc.
       */
      onPointerMissed={() => onSelecionar(null)}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color("#e8eef5");
        /**
         * A névoa acompanha o TAMANHO DA PLANTA.
         *
         * Era fixa em 55–190 m. Num andar de 37 m isso significa que, ao
         * afastar a câmera, a cena vai virando cor de fundo e some por
         * completo aos 190 — e o efeito na mão de quem usa é "o zoom parou",
         * porque continuar rolando não muda mais nada na tela.
         *
         * Amarrada à diagonal do andar, ela volta a ser o que devia ser: um
         * fundo que dá profundidade, não uma parede invisível.
         */
        const alcance = Math.max(M(planta.largura_cm), M(planta.altura_cm));
        scene.fog = planta2d ? null : new THREE.Fog("#e8eef5", alcance * 2.5, alcance * 14);
      }}
    >
      <Suspense fallback={null}>
        <Conteudo {...props} />
      </Suspense>
    </Canvas>
  );
}

/**
 * Em qual vista a cena está, para quem é desenhado lá no fundo da árvore.
 *
 * Um contexto, e não mais uma prop: as etiquetas nascem dentro de meia dúzia
 * de componentes diferentes (peça, equipamento, prévia, andar vizinho), e
 * furar `modo` por todos eles só para o rótulo saber o tamanho certo espalha
 * uma prop por arquivo inteiro.
 */
const ContextoDaVista = createContext<ModoCena>("3d");

/**
 * Etiqueta em HTML sobre a cena — sempre esta, nunca `Html` direto.
 *
 * `distanceFactor` encolhe a etiqueta conforme ela se afasta. Só que, quando
 * a câmera é ORTOGRÁFICA, o drei calcula esse fator multiplicando pelo ZOOM
 * da câmera — e o zoom do modo 2D é da ordem de 60 px por metro. A etiqueta
 * saía ~1000× maior que a tela.
 *
 * E não era só feio: `Html` é DOM de verdade por cima do WebGL, então o
 * borrão gigante ficava na frente do canvas e ENGOLIA OS CLIQUES — clicar no
 * chão parava de fazer qualquer coisa. Os dois sintomas, uma causa só.
 *
 * No 2D a etiqueta vai sem fator nenhum e fica do tamanho da tela, que é como
 * um rótulo de planta baixa se comporta.
 */
function Etiqueta({ distanceFactor, ...resto }: ComponentProps<typeof Html>) {
  const vista = useContext(ContextoDaVista);
  return <Html {...resto} distanceFactor={vista === "2d" ? undefined : distanceFactor} />;
}

function Conteudo({
  planta,
  elementos,
  ativos,
  selecao,
  grupo = [],
  alvoColagem,
  onCliqueNoChao,
  onSelecionar,
  editavel,
  modo = "3d",
  destaque,
  mostrarGrade = true,
  mostrarRotulos = true,
  desenhando = false,
  pintandoPiso = false,
  apagandoEstrutura = false,
  onApagarElemento,
  obra = false,
  passoCm = PASSO_PADRAO_CM,
  onDesenharNoChao,
  onSoltarElemento,
  onSoltarAtivo,
  onRedimensionar,
  celulas,
  onDefinirCelula,
  onAbrirFicha,
  andaresVizinhos = [],
  plantas = [],
}: Props) {
  const L = M(planta.largura_cm);
  const P = M(planta.altura_cm);
  // O andar corrente é desenhado na altura dele, não em y=0: assim ele fica no
  // lugar certo em relação aos vizinhos quando os dois estão visíveis.
  const base = M(alturaDoAndar(plantas.length ? plantas : [planta], planta.nivel ?? 0));
  const centro = useMemo<[number, number, number]>(() => [L / 2, base, P / 2], [L, base, P]);

  const { invalidate } = useThree();
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);

  // Posição durante o arrasto: local, sem tocar no banco. Ver o cabeçalho.
  const [previa, setPrevia] = useState<Record<string, { x: number; y: number }>>({});
  /**
   * O arrasto em curso.
   *
   * `membros` é quem se move, com a posição em cm de CADA UM no instante em
   * que o dedo encostou; `ancora` é a posição da peça efetivamente agarrada.
   * O movimento é aplicado como DELTA sobre essas posições originais, e não
   * recalculado peça a peça pelo ponteiro — é isso que mantém a mesa e as
   * cadeiras na mesma distância entre si do começo ao fim do arrasto.
   */
  const [arrasto, setArrasto] = useState<
    {
      tipo: "elemento" | "ativo";
      id: string;
      alturaBase: number;
      dx: number;
      dz: number;
      ancora: { x: number; y: number };
      membros: { tipo: "elemento" | "ativo"; id: string; x: number; y: number }[];
    } | null
  >(null);
  const [traco, setTraco] = useState<TracoNoChao | null>(null);
  /**
   * Espelho do traço em ref.
   *
   * O traço termina por dois caminhos (o `pointerup` global e o do próprio
   * piso, para clique rápido), e `setState` não é síncrono: os dois leriam
   * `traco` ainda preenchido e criariam DUAS peças. A ref é limpa na hora,
   * então o segundo caminho não faz nada.
   */
  const tracoRef = useRef<TracoNoChao | null>(null);
  // Puxar parede / esticar sala: guarda a peça e a alça pega.
  const [resize, setResize] = useState<{ el: TiElemento; alca: "a" | "b" | "nw" | "ne" | "sw" | "se" } | null>(null);
  const [previaResize, setPreviaResize] = useState<Partial<TiElemento> | null>(null);
  const [livre, setLivre] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const d = (e: KeyboardEvent) => e.key === "Alt" && setLivre(true);
    const u = (e: KeyboardEvent) => e.key === "Alt" && setLivre(false);
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
    };
  }, []);

  /**
   * Dado novo = um quadro novo.
   *
   * Com  o canvas só redesenha quando alguém pede. É o que
   * mantém a GPU quieta com o escritório parado na tela — e é também o que
   * fazia a peça recém-criada NÃO APARECER: os dados chegavam, o React
   * re-renderizava a árvore, e o desenho só saía quando algo por acaso pedia
   * um quadro (girar a câmera, passar o mouse) ou ao recarregar a página.
   *
   * Toda entrada de dado que muda a cena precisa passar por aqui.
   */
  useEffect(() => {
    invalidate();
  }, [elementos, ativos, celulas, planta, andaresVizinhos, mostrarGrade, mostrarRotulos, destaque, selecao, invalidate]);

  /**
   * Trocar de peça zera o que estava em curso.
   *
   * Sem isto, um redimensionamento interrompido (o mouse soltou fora do
   * canvas, por exemplo) deixava o estado de resize preso na peça antiga, e a
   * nova seleção convivia com a marcação da anterior — duas peças pareciam
   * selecionadas ao mesmo tempo.
   */
  useEffect(() => {
    setResize(null);
    setPreviaResize(null);
    setArrasto(null);
  }, [selecao?.tipo, selecao?.id]);

  /**
   * A câmera fica travada enquanto (e somente enquanto) há algo em curso.
   *
   * Antes cada caminho travava ao começar e destravava ao terminar — e bastava
   * um caminho não terminar para a câmera ficar travada para sempre. Foi o que
   * aconteceu ao APAGAR uma peça: ela sumia, o "soltar" nunca rodava, e o mapa
   * parava de girar até recarregar a página.
   *
   * Declarar o estado desejado, em vez de comandar as duas pontas, elimina a
   * classe de bug: não existe caminho de saída para esquecer.
   */
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = !(arrasto || traco || resize);
  }, [arrasto, traco, resize]);

  /**
   * O alvo da câmera é definido UMA VEZ por planta, não a cada render.
   *
   * Ele era passado como prop (`target={centro}`), e prop de R3F é reaplicada
   * em todo render — que aqui acontece a cada seleção, arrasto, hover e dado
   * novo. Na prática: a pessoa arrastava a câmera para o canto da sala e o
   * alvo voltava para o meio da planta no quadro seguinte. Zoom perto ficava
   * impossível de controlar, porque o pivô nunca era onde ela estava olhando.
   *
   * Agora o OrbitControls é dono do próprio alvo; a cena só o reposiciona
   * quando a planta (ou o andar) muda, que é quando faz sentido reenquadrar.
   */
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.target.set(centro[0], centro[1], centro[2]);
    c.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planta.id, modo]);

  /**
   * Largar a ferramenta joga fora o traço em curso.
   *
   * O traço trava a câmera enquanto existe (efeito acima). Se a pessoa começa
   * a desenhar e troca de ferramenta no meio — ou volta para o cursor — o
   * `pointerup` que fecharia o traço nunca chega, ele fica pendurado, e a
   * câmera fica congelada até recarregar a página. É a mesma classe de bug
   * que o comentário do efeito acima descreve: sobra um caminho de saída sem
   * ninguém para percorrê-lo.
   */
  useEffect(() => {
    if (desenhando) return;
    tracoRef.current = null;
    setTraco(null);
  }, [desenhando]);

  /** Está no grupo? Comparação por tipo E id: os dois têm uuid próprio. */
  const noGrupo = useCallback(
    (tipo: "elemento" | "ativo", id: string) =>
      grupo.some((g) => g?.tipo === tipo && g.id === id),
    [grupo],
  );

  /** Onde a peça está AGORA, em cm — a mesma medida que o banco guarda. */
  const posicaoEmCm = useCallback(
    (tipo: "elemento" | "ativo", id: string) => {
      if (tipo === "elemento") {
        const el = elementos.find((e) => e.id === id);
        return el ? centroDaPeca(el) : null;
      }
      const a = ativos.find((z) => z.id === id);
      return a?.pos_x == null || a?.pos_y == null ? null : { x: Number(a.pos_x), y: Number(a.pos_y) };
    },
    [elementos, ativos],
  );

  const iniciarArrasto = (
    tipo: "elemento" | "ativo",
    id: string,
    alturaBase: number,
    ponto: THREE.Vector3,
    posX: number,
    posZ: number,
  ) => {
    if (!editavel || desenhando) return;

    const ancora = posicaoEmCm(tipo, id);
    if (!ancora) return;

    /**
     * Arrastar uma peça do grupo leva o grupo inteiro; arrastar uma de fora
     * leva só ela.
     *
     * A segunda metade importa tanto quanto a primeira: sem ela, com cinco
     * peças marcadas, encostar em qualquer sexta peça arrastaria as seis — e
     * a pessoa não teria como mover uma coisa só sem antes desmarcar tudo.
     */
    const membros = noGrupo(tipo, id)
      ? grupo
          .map((g) => (g ? { tipo: g.tipo, id: g.id, ...posicaoEmCm(g.tipo, g.id) } : null))
          .filter((m): m is { tipo: "elemento" | "ativo"; id: string; x: number; y: number } =>
            !!m && typeof m.x === "number" && typeof m.y === "number")
      : [{ tipo, id, x: ancora.x, y: ancora.y }];

    setArrasto({ tipo, id, alturaBase, dx: ponto.x - posX, dz: ponto.z - posZ, ancora, membros });
  };

  const moverLocal = useCallback(
    (x: number, z: number) => {
      setArrasto((a) => {
        if (!a) return a;
        // O ponteiro decide onde vai a peça AGARRADA; as outras andam o mesmo
        // tanto. Encaixar cada uma na grade separadamente entortaria o
        // conjunto — a cadeira andaria 25 cm e a mesa 50, a cada quadro.
        const alvoX = snap(x * 100, livre, passoCm);
        const alvoY = snap(z * 100, livre, passoCm);
        const dx = alvoX - a.ancora.x;
        const dy = alvoY - a.ancora.y;
        setPrevia((p) => {
          const novo = { ...p };
          for (const m of a.membros) novo[m.id] = { x: m.x + dx, y: m.y + dy };
          return novo;
        });
        return a;
      });
      invalidate();
    },
    [livre, passoCm, invalidate],
  );

  /**
   * Fecha o traço e cria a peça — uma vez só, venha o `pointerup` de onde vier.
   *
   * O clique RÁPIDO no chão não criava nada: o `pointerup` global é registrado
   * num efeito, que roda depois do render, e um clique de menos de um quadro
   * termina antes de o listener existir. Para quem usa, era o pior sintoma
   * possível — clicar no chão com a peça na mão simplesmente não fazia nada.
   * Agora o próprio piso também fecha o traço.
   */
  const finalizarTraco = useCallback(() => {
    const t = tracoRef.current;
    if (!t) return;
    tracoRef.current = null;
    setTraco(null);
    onDesenharNoChao?.(t);
    invalidate();
  }, [onDesenharNoChao, invalidate]);

  const soltar = useCallback(() => {
    setArrasto((a) => {
      if (a) {
        setPrevia((p) => {
          // ESTA é a única gravação do arrasto inteiro — uma por peça movida,
          // no soltar. Ver o cabeçalho do arquivo: mover é local.
          for (const m of a.membros) {
            const pos = p[m.id];
            if (!pos) continue;
            if (m.tipo === "elemento") onSoltarElemento?.(m.id, pos.x, pos.y);
            else onSoltarAtivo?.(m.id, pos.x, pos.y);
          }
          return p;
        });
      }
      return null;
    });
  }, [onSoltarElemento, onSoltarAtivo]);

  // A prévia some quando o dado novo chega pela query. Limpar na hora faria a
  // peça piscar de volta na posição antiga até o refetch responder.
  useEffect(() => {
    if (arrasto || Object.keys(previa).length === 0) return;
    const t = window.setTimeout(() => setPrevia({}), 600);
    return () => window.clearTimeout(t);
  }, [arrasto, previa, elementos, ativos]);

  // Planta antiga (sem célula) desenha como o retângulo que sempre foi.
  const celulasDoPiso = useMemo(
    () => (celulas && celulas.length > 0 ? celulas : celulasDoRetangulo(planta.largura_cm, planta.altura_cm)),
    [celulas, planta.largura_cm, planta.altura_cm],
  );

  /**
   * A peça selecionada COMO ELA ESTÁ NA TELA agora — já com o que estiver
   * sendo arrastado ou esticado.
   *
   * As alças e a caixa de seleção se penduram nisto. Antes olhavam só o dado
   * do banco: enquanto a peça era arrastada, o contorno e as bolinhas ficavam
   * parados no lugar antigo, como se fossem de outro objeto.
   */
  const elementoSelecionado = useMemo(() => {
    if (selecao?.tipo !== "elemento") return null;
    const cru = elementos.find((e) => e.id === selecao.id);
    if (!cru) return null;

    const comResize =
      previaResize && resize?.el.id === cru.id ? ({ ...cru, ...previaResize } as TiElemento) : cru;

    const p = previa[cru.id];
    if (!p) return comResize;
    const canto = cantoDaPeca(p.x, p.y, comResize.largura, comResize.altura);
    return { ...comResize, x: canto.x, y: canto.y } as TiElemento;
  }, [selecao, elementos, previaResize, resize, previa]);

  const termo = (destaque ?? "").trim().toLowerCase();
  const casa = useCallback(
    (a: TiAtivo) =>
      !termo ||
      [a.nome, a.codigo, a.patrimonio, a.ip, a.hostname, a.responsavel_nome, a.setor]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo)),
    [termo],
  );

  /**
   * Onde cada parede fica vazada por causa de uma porta encostada nela.
   *
   * Vive AQUI, e não no modelo, porque só a cena enxerga as outras peças: o
   * `ModeloDoElemento` recebe um elemento por vez e não teria como saber que
   * há uma porta de vidro atravessada na parede.
   *
   * Sai vazio quando não existe nenhuma abertura na planta, que é o caso da
   * esmagadora maioria — aí nem se percorre a lista de paredes.
   */
  const vaosPorParede = useMemo(() => {
    const mapa = new Map<string, { de: number; ate: number; altura: number }[]>();
    const aberturas = elementos.filter((e) => tipoElemento(e.tipo).recorta);
    if (!aberturas.length) return mapa;

    for (const parede of elementos) {
      if (!tipoElemento(parede.tipo).recortavel) continue;
      const vaos = vaosNaParede(
        parede,
        aberturas.filter((a) => a.id !== parede.id),
      );
      // Os modelos desenham em metros; a conta é feita em cm, como o banco.
      // A conta é feita em cm, como o banco; os modelos desenham em metros.
      if (vaos.length) {
        mapa.set(
          parede.id,
          vaos.map((v) => ({ de: M(v.de), ate: M(v.ate), altura: M(v.altura) })),
        );
      }
    }
    return mapa;
  }, [elementos]);

  const aplicarResize = (px: number, py: number) => {
    if (!resize) return;
    const { el, alca } = resize;
    if (alca === "a" || alca === "b") {
      // Puxar a parede pela ponta: a outra ponta fica onde está.
      const { a, b } = pontasDaParede(el);
      const fixo = alca === "a" ? b : a;
      const r = retanguloDoTraco(fixo.x, fixo.y, px, py, Number(el.altura));
      setPreviaResize({ x: r.x, y: r.y, largura: Math.max(10, r.largura), rotacao: r.rotacao });
    } else {
      setPreviaResize(redimensionarPorCanto(el, alca, px, py));
    }
    invalidate();
  };

  return (
    <ContextoDaVista.Provider value={modo}>
      <Luzes largura={L} profundidade={P} />
      {/* Sombra macia nas bordas: sombra dura de mapa entrega que é primitiva. */}
      <SoftShadows size={28} samples={8} focus={0.9} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        /**
         * Zoom NA DIREÇÃO DO CURSOR, não do alvo.
         *
         * Sem isto, aproximar sempre puxa para o centro da planta: para olhar
         * um canto era preciso zoom + arrastar + zoom + arrastar. Com o
         * cursor mandando, aponta-se e aproxima.
         */
        zoomToCursor
        panSpeed={1.3}
        rotateSpeed={0.9}
        // No 2D o giro sai de cena: é o que separa "planta baixa" de "maquete
        // vista de cima". Sobram arrastar com o botão direito e o zoom.
        enableRotate={modo !== "2d"}
        maxPolarAngle={Math.PI * 0.49}
        // Câmera ortográfica não anda para perto nem para longe (o zoom é
        // outra coisa), então o limite de distância só teria a chance de puxar
        // a câmera para baixo sem motivo.
        // Limites largos de propósito: o teto antigo (2,5× a planta) parava
        // o afastamento antes de caber o andar inteiro na tela, e o piso de
        // 1,5 m impedia de chegar perto de um monitor.
        // Sem teto prático: qualquer limite aqui vira "o zoom parou" sem
        // explicação nenhuma na tela. Quem enquadra é a pessoa.
        minDistance={0.15}
        maxDistance={6000}
        minZoom={0.2}
        maxZoom={5000}
        /**
         * Zoom mais rápido e amortecimento mais curto.
         *
         * Com `zoomSpeed` 1 e `dampingFactor` 0.15 cada passo da rodinha
         * andava pouco e ainda levava meio segundo deslizando até parar — num
         * andar de 37 m, atravessar a distância toda virava dezenas de
         * rolagens. O amortecimento continua (o corte seco enjoa), só que
         * converge bem mais rápido.
         */
        zoomSpeed={2}
        dampingFactor={0.3}
        /**
         * Na obra, cada botão do mouse faz UMA coisa.
         *
         * O padrão do OrbitControls é o esquerdo girar a câmera. Com uma
         * ferramenta de desenho na mão isso vira o pior dos mundos: o mesmo
         * arrasto que abre o piso também gira o escritório, e o traço sai
         * torto porque o chão se move debaixo dele. O direito era ainda pior
         * — arrastava a câmera E desenhava junto, porque o `pointerdown` do
         * chão não olhava qual botão tinha sido apertado.
         *
         * Então, um botão por tarefa: ESQUERDO só desenha (aqui ele não faz
         * nada, e quem responde é o piso), DIREITO só gira a câmera, MEIO só
         * arrasta o ponto para onde ela olha. `undefined` é como o
         * OrbitControls desliga um botão — ele cai no `default` e não entra
         * em estado nenhum.
         *
         * O zoom saiu do botão do meio e ficou só na rodinha, que é onde a mão
         * procura — e assim o meio fica livre para o que é usado o tempo todo
         * ao desenhar: andar pela planta sem mudar o ângulo.
         *
         * No 2D o giro está desligado, então o direito não faz nada ali de
         * propósito: planta baixa que gira deixa de ser planta baixa.
         *
         * ⚠ FORA da obra o objeto é escrito por extenso, com os padrões do
         * OrbitControls, em vez de `undefined`. Passar `undefined` não
         * "volta ao padrão": o R3F escreve `controls.mouseButtons = undefined`
         * e, no clique seguinte, o OrbitControls estoura ao ler
         * `mouseButtons.LEFT`. O erro acontece dentro do listener de
         * `pointerdown`, então ele nem chega a registrar o resto — e a câmera
         * inteira para: não gira, não arrasta, não dá zoom. Bastava entrar na
         * obra e voltar para o cursor.
         *
         * Fora da obra fica o padrão: lá o esquerdo é que arrasta as peças, e
         * girar com ele é o que se espera de uma maquete.
         */
        mouseButtons={
          obra
            ? {
                LEFT: undefined,
                MIDDLE: THREE.MOUSE.PAN,
                RIGHT: THREE.MOUSE.ROTATE,
              }
            : {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN,
              }
        }
        enableDamping
      />
      {modo === "2d" && <EnquadrarPlanta largura={L} profundidade={P} />}

      {/* Andares vizinhos: referência translúcida, sem interação. */}
      {andaresVizinhos.map((a) => (
        <AndarFantasma
          key={a.planta.id}
          planta={a.planta}
          elementos={a.elementos}
          ativos={a.ativos}
          celulas={a.celulas}
          base={M(alturaDoAndar(plantas.length ? plantas : [a.planta], a.planta.nivel ?? 0))}
        />
      ))}

      {/* O andar que está sendo editado/visto. Só o Y muda: X e Z continuam
          sendo as coordenadas do banco, e é por isso que o arrasto (que
          trabalha em coordenadas de mundo) não precisa saber de andar. */}
      <group position={[0, base, 0]}>
      {obra && editavel && <TapeteDeObra largura={L} profundidade={P} aoComecar={(t) => {
        tracoRef.current = t;
        setTraco(t);
        invalidate();
      }} aoTerminar={finalizarTraco} livre={livre} passoCm={passoCm} />}
      <Piso
        planta={planta}
        celulas={celulasDoPiso}
        mostrarGrade={mostrarGrade}
        editavel={editavel}
        desenhando={desenhando}
        livre={livre}
        passoCm={passoCm}
        onComecarTraco={(t) => {
          tracoRef.current = t;
          setTraco(t);
          invalidate();
        }}
        onTerminarTraco={finalizarTraco}
        onDesmarcar={() => onSelecionar(null)}
        onCliqueNoChao={onCliqueNoChao}
      />

      {/*
        A sombra de contato é o que "assenta" o móvel no chão. Sem ela, mesmo
        com a sombra projetada, os objetos parecem flutuar um centímetro acima
        do piso — é o detalhe que separa um render bom de um render estranho.
      */}
      <ContactShadows
        position={[L / 2, 0.015, P / 2]}
        scale={Math.max(L, P) * 1.2}
        resolution={1024}
        blur={2.4}
        opacity={0.42}
        far={3}
        frames={1}
      />

      {/*
        Os marcadores de piso aparecem com a grade ligada e SEM ferramenta na
        mão: com uma peça selecionada para desenhar, eles roubariam o clique
        que deveria começar a parede.
      */}
      {editavel && mostrarGrade && !desenhando && onDefinirCelula && (
        <MarcadoresDeCelula celulas={celulasDoPiso} onDefinir={onDefinirCelula} />
      )}

      <PonteiroNoPlano
        ativo={!!arrasto || !!traco || !!resize}
        altura={(arrasto?.alturaBase ?? 0) + base}
        onMover={(x, z) => {
          if (resize) {
            aplicarResize(snap(x * 100, livre, passoCm), snap(z * 100, livre, passoCm));
          } else if (arrasto) {
            moverLocal(x - arrasto.dx, z - arrasto.dz);
          } else if (traco) {
            const x2 = snap(x * 100, livre, passoCm);
            const y2 = snap(z * 100, livre, passoCm);
            setTraco((t) => {
              const novo = t ? { ...t, x2, y2, clique: false } : t;
              tracoRef.current = novo;
              return novo;
            });
            invalidate();
          }
        }}
        onSoltar={() => {
          if (resize) {
            if (previaResize) onRedimensionar?.(resize.el.id, previaResize);
            setResize(null);
            setPreviaResize(null);
            invalidate();
            return;
          }
          finalizarTraco();
          soltar();
        }}
      />

      {alvoColagem && <AlvoDeColagem x={M(alvoColagem.x)} z={M(alvoColagem.y)} />}

      {/* Apagando não se desenha nada: a borracha mantém `desenhando` ligado
          só para travar arrasto e seleção, e a prévia de parede aí em cima do
          cursor seria a promessa de uma peça que não vai nascer. */}
      {traco && !apagandoEstrutura && <FantasmaDoTraco traco={traco} piso={pintandoPiso} />}

      {elementos.map((cru) => {
        // Enquanto a alça está sendo puxada, a peça desenha com a medida
        // provisória — o banco só recebe no soltar.
        const el =
          previaResize && resize?.el.id === cru.id ? ({ ...cru, ...previaResize } as TiElemento) : cru;
        const def = tipoElemento(el.tipo);
        const largura = M(Number(el.largura));
        const profundidade = M(Number(el.altura));
        const altura = M(alturaDoElemento(el));
        // Marcado conta como selecionado para o CONTORNO: quem pegou cinco
        // peças precisa ver as cinco, não só a última clicada.
        const selecionado =
          (selecao?.tipo === "elemento" && selecao.id === el.id) || noGrupo("elemento", el.id);
        const pos = previa[el.id];
        // ⚠ `previa` guarda o CENTRO (é o que o arrasto calcula); `el.x`/`el.y`
        // guardam o CANTO (é o que o banco grava). Somar largura/2 nos dois
        // fazia a peça saltar meia largura no instante em que se começava a
        // arrastar — a mesa "pulava" para fora da sala.
        const centro = pos ?? centroDaPeca(el);
        const x = M(centro.x);
        const z = M(centro.y);
        return (
          <group
            key={el.id}
            position={[x, 0, z]}
            rotation={[0, rad(Number(el.rotacao)), 0]}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              /**
               * A borracha vem PRIMEIRO, antes de desenhar, selecionar ou
               * arrastar: é o clique inteiro, não um caso a mais.
               *
               * Só estrutura some. Móvel e equipamento devolvem o clique sem
               * fazer nada — apagar a mesa sem querer, no meio de levantar
               * uma parede, é o tipo de erro que ninguém percebe na hora.
               */
              if (apagandoEstrutura) {
                if (e.button !== 0) return;
                e.stopPropagation();
                if (tipoElemento(el.tipo).familia === "estrutura") onApagarElemento?.(el.id);
                return;
              }
              /**
               * Com uma peça na mão, clicar EM CIMA de um móvel de apoio conta
               * como clicar naquele ponto do móvel.
               *
               * Sem isto o raio atravessava a mesa e ia bater no piso ATRÁS
               * dela (a câmera é inclinada, então há paralaxe): o usuário
               * clicava sobre o tampo e a impressora nascia no chão, alguns
               * metros adiante. Aqui o ponto usado é o da superfície clicada —
               * só X e Z importam, a altura quem resolve é `alturaDeApoio`.
               */
              if (desenhando) {
                if (!tipoElemento(el.tipo).apoia) return;
                e.stopPropagation();
                const px = snap(e.point.x * 100, livre, passoCm);
                const pz = snap(e.point.z * 100, livre, passoCm);
                tracoRef.current = { x1: px, y1: pz, x2: px, y2: pz, clique: true };
                setTraco(tracoRef.current);
                invalidate();
                return;
              }
              e.stopPropagation();
              // Shift soma ao grupo em vez de trocar a seleção — e nesse caso
              // não começa arrasto: quem está montando a seleção clica várias
              // vezes seguidas, e sair arrastando a cada clique faria a peça
              // andar sozinha enquanto ele escolhe.
              onSelecionar({ tipo: "elemento", id: el.id }, e.shiftKey);
              if (!e.shiftKey) iniciarArrasto("elemento", el.id, 0, e.point, x, z);
            }}
            onPointerUp={(e: ThreeEvent<PointerEvent>) => {
              if (apagandoEstrutura) return;
              if (!desenhando || !tipoElemento(el.tipo).apoia) return;
              e.stopPropagation();
              finalizarTraco();
            }}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              if (!apagandoEstrutura) return;
              e.stopPropagation();
              setHover(el.id);
            }}
            onPointerOut={() => {
              if (apagandoEstrutura) setHover((h) => (h === el.id ? null : h));
            }}
          >
            <ModeloDoElemento
              elemento={el}
              largura={largura}
              profundidade={profundidade}
              altura={altura}
              vaos={vaosPorParede.get(el.id)}
            />
            {selecionado && (
              <Selecao largura={largura} profundidade={profundidade} altura={altura} plano={modo === "2d"} />
            )}
            {/* Com a borracha na mão, o que está sob o cursor fica marcado em
                vermelho — sem isso o clique é uma aposta, ainda mais no 2D,
                onde parede fina e divisória se parecem. */}
            {apagandoEstrutura && hover === el.id && def.familia === "estrutura" && (
              <Selecao
                largura={largura}
                profundidade={profundidade}
                altura={altura}
                plano={modo === "2d"}
                cor="#ef4444"
              />
            )}
            {def.familia === "area" && el.rotulo && (
              <Etiqueta center distanceFactor={22} position={[0, 0.05, 0]}>
                <span className="whitespace-nowrap rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-700">
                  {el.rotulo}
                </span>
              </Etiqueta>
            )}
            {selecionado && def.familia !== "area" && el.rotulo && (
              <Etiqueta center distanceFactor={14} position={[0, altura + 0.25, 0]}>
                <span className="whitespace-nowrap rounded bg-slate-900/85 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  {el.rotulo}
                </span>
              </Etiqueta>
            )}
          </group>
        );
      })}

      {ativos
        .filter((a) => a.planta_id === planta.id && a.pos_x != null && a.pos_y != null)
        .map((a) => {
          const { largura, profundidade, altura } = dimensoesAtivo(a);
          const pos = previa[a.id];
          const alvo = pos ? ({ ...a, pos_x: pos.x, pos_y: pos.y } as TiAtivo) : a;
          const base = M(alturaDeApoio(alvo, elementos));
          const x = M(Number(alvo.pos_x));
          const z = M(Number(alvo.pos_y));
          const selecionado =
            (selecao?.tipo === "ativo" && selecao.id === a.id) || noGrupo("ativo", a.id);
          const apagado = !!termo && !casa(a);
          const st = statusAtivo(a.status);

          return (
            <group
              key={a.id}
              position={[x, base, z]}
              rotation={[0, rad(Number(a.rotacao)), 0]}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                if (desenhando) return;
                e.stopPropagation();
                onSelecionar({ tipo: "ativo", id: a.id }, e.shiftKey);
                if (!e.shiftKey) iniciarArrasto("ativo", a.id, base, e.point, x, z);
              }}
              onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                onAbrirFicha?.(a.id);
              }}
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHover(a.id);
                invalidate();
              }}
              onPointerOut={() => {
                setHover((h) => (h === a.id ? null : h));
                invalidate();
              }}
            >
              <group visible={!apagado}>
                <ModeloDoAtivo ativo={a} largura={largura} profundidade={profundidade} altura={altura} />
              </group>
              {selecionado && (
              <Selecao largura={largura} profundidade={profundidade} altura={altura} plano={modo === "2d"} />
            )}

              {!apagado && (
                <mesh position={[0, altura + 0.09, 0]}>
                  <sphereGeometry args={[0.045, 12, 10]} />
                  <meshStandardMaterial color={st.cor} emissive={st.cor} emissiveIntensity={0.75} />
                </mesh>
              )}

              {!apagado && (mostrarRotulos || hover === a.id || selecionado) && (
                <Etiqueta center distanceFactor={13} position={[0, altura + 0.3, 0]} zIndexRange={[20, 0]}>
                  <span
                    className="pointer-events-none whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold text-white shadow"
                    style={{ background: hover === a.id || selecionado ? "#0f172a" : "rgba(15,23,42,0.72)" }}
                  >
                    {a.nome}
                    {hover === a.id && a.responsavel_nome ? ` · ${a.responsavel_nome}` : ""}
                  </span>
                </Etiqueta>
              )}
            </group>
          );
        })}

      {/* Alças de manipulação: puxar a parede pelas pontas, esticar a sala
          pelas quinas. Ficam por último para desenhar por cima das peças. */}
      {editavel && !desenhando && elementoSelecionado && (
        <Alcas
          el={elementoSelecionado}
          previa={previaResize}
          onPegar={(alca) => {
            setResize({ el: elementoSelecionado, alca });
            setPreviaResize(null);
                  }}
        />
      )}
      </group>
    </ContextoDaVista.Provider>
  );
}

// ── Peças da cena ─────────────────────────────────────────────────────

/**
 * Enquadra a planta inteira na tela no modo 2D.
 *
 * Em câmera ortográfica quem define o tamanho do que aparece é o `zoom` — em
 * pixels por metro —, e para calculá-lo é preciso saber a largura do canvas.
 * Isso só existe DENTRO do Canvas, por isso o cálculo mora num componente
 * filho e não na prop `camera`.
 *
 * Enquadra ao montar e quando a planta muda, nunca a cada quadro: refazer o
 * zoom depois disso desfaria o que o usuário acabou de fazer com a rodinha.
 * Trocar de modo remonta o Canvas, então montar já é "entrou no 2D".
 */
function EnquadrarPlanta({ largura, profundidade }: { largura: number; profundidade: number }) {
  const { camera, size, invalidate } = useThree();
  const tamanho = useRef(size);
  tamanho.current = size;

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    if (!cam.isOrthographicCamera) return;
    const { width, height } = tamanho.current;
    // 1.15 = uma folga em volta, para a planta não encostar na borda.
    cam.zoom = Math.min(width / (largura * 1.15), height / (profundidade * 1.15));
    cam.updateProjectionMatrix();
    invalidate();
  }, [largura, profundidade, camera, invalidate]);

  return null;
}

/**
 * A iluminação — a parte que mais separa "caixas cinzas" de "escritório".
 *
 * Três luzes, como num estúdio: a PRINCIPAL projeta a sombra e dá a direção;
 * a de PREENCHIMENTO, do lado oposto e sem sombra, evita que o lado escuro
 * vire um borrão preto; e a hemisférica traz o azul do céu por cima e o
 * quente do piso por baixo, que é o que dá sensação de ambiente fechado.
 *
 * `Environment preset` fica de fora de propósito: ele baixa um HDR de CDN, e
 * este ERP roda em rede interna — uma dependência de rede para iluminar a
 * cena é uma tela quebrada esperando acontecer. O reflexo vem do
 * `envMapIntensity` dos materiais com o ambiente procedural.
 */
function Luzes({ largura, profundidade }: { largura: number; profundidade: number }) {
  const alcance = Math.max(largura, profundidade) * 0.75 + 8;
  return (
    <>
      <hemisphereLight args={["#eaf2ff", "#c9b79c", 0.85]} />
      <ambientLight intensity={0.28} />

      {/* principal */}
      <directionalLight
        castShadow
        position={[largura * 0.55 + 9, Math.max(largura, profundidade) * 0.85 + 12, profundidade * 0.3 - 7]}
        intensity={1.5}
        color="#fff6e8"
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
        shadow-camera-left={-alcance}
        shadow-camera-right={alcance}
        shadow-camera-top={alcance}
        shadow-camera-bottom={-alcance}
        shadow-camera-far={alcance * 4}
      />

      {/* preenchimento: sem sombra, só para o lado escuro não sumir */}
      <directionalLight
        position={[-largura * 0.4 - 6, Math.max(largura, profundidade) * 0.4 + 6, profundidade + 8]}
        intensity={0.45}
        color="#dce9ff"
      />
    </>
  );
}

/**
 * UM mesh para o piso inteiro, montado com dois triângulos por quadrado.
 *
 * A alternativa óbvia — um `<mesh>` por célula — custa centenas de objetos na
 * cena num andar de 20×15, e cada um deles entra no raycast a cada movimento
 * do mouse. Aqui o piso é uma geometria só: o clique continua funcionando (é
 * o mesmo plano) e o custo não cresce com o tamanho do escritório.
 *
 * Compartilhada entre o andar corrente e os andares vizinhos — foi por não
 * ser compartilhada que o Mapa desenhava um retângulo onde o Construir já
 * mostrava o piso recortado.
 */
function useGeometriaDoPiso(celulas: TiCelula[]) {
  const geometria = useMemo(() => {
    const posicoes = new Float32Array(celulas.length * 18);
    const normais = new Float32Array(celulas.length * 18);
    celulas.forEach((c, i) => {
      const x0 = c.cx;
      const z0 = c.cy;
      const x1 = x0 + 1;
      const z1 = z0 + 1;
      // dois triângulos: (x0,z0)-(x1,z0)-(x1,z1) e (x0,z0)-(x1,z1)-(x0,z1)
      const v = [x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1];
      posicoes.set(v, i * 18);
      for (let k = 0; k < 6; k++) normais.set([0, 1, 0], i * 18 + k * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(posicoes, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normais, 3));
    return g;
  }, [celulas]);

  useEffect(() => () => geometria.dispose(), [geometria]);
  return geometria;
}

function Piso({
  planta,
  celulas,
  mostrarGrade,
  editavel,
  desenhando,
  livre,
  passoCm,
  onComecarTraco,
  onTerminarTraco,
  onDesmarcar,
}: {
  planta: TiPlanta;
  celulas: TiCelula[];
  mostrarGrade: boolean;
  editavel: boolean;
  desenhando: boolean;
  livre: boolean;
  passoCm: number;
  onComecarTraco: (t: TracoNoChao) => void;
  onTerminarTraco: () => void;
  onDesmarcar: () => void;
  onCliqueNoChao?: (x: number, y: number) => void;
}) {
  const L = M(planta.largura_cm);
  const P = M(planta.altura_cm);

  const geometria = useGeometriaDoPiso(celulas);

  return (
    <group>
      <mesh
        receiveShadow
        geometry={geometria}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          // Botão direito é da câmera, nunca do desenho — nem para desmarcar.
          if (e.button !== 0) return;
          // Sem ferramenta na mão, clicar no chão é "não quero mais nada
          // selecionado" — o piso conta como área vazia.
          if (!desenhando) {
            onDesmarcar();
            // O MESMO clique que larga a seleção marca onde colar. São a
            // mesma intenção: "não é nenhuma peça, é ali no chão".
            onCliqueNoChao?.(snap(e.point.x * 100, livre, passoCm), snap(e.point.z * 100, livre, passoCm));
            return;
          }
          if (!editavel) return;
          e.stopPropagation();
          const x = snap(e.point.x * 100, livre, passoCm);
          const y = snap(e.point.z * 100, livre, passoCm);
          onComecarTraco({ x1: x, y1: y, x2: x, y2: y, clique: true });
        }}
        onPointerUp={(e: ThreeEvent<PointerEvent>) => {
          if (e.button !== 0) return;
          if (!editavel || !desenhando) return;
          e.stopPropagation();
          onTerminarTraco();
        }}
      >
        <meshStandardMaterial color={planta.cor_piso || "#eef2f7"} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {mostrarGrade && (
        <Grid
          position={[L / 2, 0.006, P / 2]}
          args={[L, P]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#aebbcc"
          sectionSize={5}
          sectionThickness={1.3}
          sectionColor="#7f92a8"
          fadeDistance={Math.max(L, P) * 2.4}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={false}
        />
      )}
    </group>
  );
}

/** A prévia da peça enquanto o traço está sendo puxado, com a medida em metros. */
function FantasmaDoTraco({ traco, piso = false }: { traco: TracoNoChao; piso?: boolean }) {
  if (piso) return <FantasmaDePiso traco={traco} />;
  const r = retanguloDoTraco(traco.x1, traco.y1, traco.x2, traco.y2, 15);
  const largura = M(r.largura);
  const profundidade = M(Math.max(r.profundidade, 10));
  const comprimento = Math.round(r.largura);
  return (
    <group position={[M(r.centroX), 0.4, M(r.centroY)]} rotation={[0, rad(r.rotacao), 0]}>
      <mesh>
        <boxGeometry args={[largura, 0.8, profundidade]} />
        <meshStandardMaterial color="#0ea5e9" transparent opacity={0.45} />
      </mesh>
      <Etiqueta center distanceFactor={14} position={[0, 0.8, 0]}>
        <span className="pointer-events-none whitespace-nowrap rounded bg-sky-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
          {(comprimento / 100).toFixed(2).replace(".", ",")} m
        </span>
      </Etiqueta>
    </group>
  );
}

/**
 * O chão de fora — onde ainda NÃO existe piso.
 *
 * O mesh que recebe o clique do piso é feito das células que existem
 * (`useGeometriaDoPiso`). Isso quer dizer que, fora da planta, não há nada
 * para o ponteiro acertar: o arrasto simplesmente não começava. Justo no caso
 * de EXPANDIR, que é começar do lado de fora e puxar para dentro do vazio.
 *
 * Daí este tapete, só no modo obra: um plano grande, logo ABAIXO do piso, que
 * existe para ser acertado. Fica embaixo de propósito — quando o arrasto
 * começa em cima do piso de verdade, o raycast acerta o piso primeiro e ele
 * interrompe a propagação, então o gesto não começa duas vezes.
 *
 * O tom azul quase invisível não é decoração: é o que mostra até onde dá para
 * construir, num plano que de resto seria um vazio idêntico ao fundo.
 */
function TapeteDeObra({
  largura,
  profundidade,
  livre,
  passoCm,
  aoComecar,
  aoTerminar,
}: {
  largura: number;
  profundidade: number;
  livre: boolean;
  passoCm: number;
  aoComecar: (t: TracoNoChao) => void;
  aoTerminar: () => void;
}) {
  // Folga generosa: expandir um escritório inteiro não pode esbarrar na borda
  // do tapete no meio do arrasto.
  const lado = Math.max(largura, profundidade) * 2 + 60;

  return (
    <mesh
      position={[largura / 2, -0.02, profundidade / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        // Só o esquerdo desenha. Sem esta linha o botão direito arrastava a
        // câmera e abria piso na mesma passada — o mapa saía coberto de
        // quadrados que ninguém pediu.
        if (e.button !== 0) return;
        e.stopPropagation();
        const x = snap(e.point.x * 100, livre, passoCm);
        const y = snap(e.point.z * 100, livre, passoCm);
        aoComecar({ x1: x, y1: y, x2: x, y2: y, clique: true });
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        aoTerminar();
      }}
    >
      <planeGeometry args={[lado, lado]} />
      <meshBasicMaterial color="#0ea5e9" transparent opacity={0.045} depthWrite={false} />
    </mesh>
  );
}

/**
 * O ponto vermelho: onde o Ctrl+V vai soltar o bloco copiado.
 *
 * Disco rente ao chão mais um pino em pé. O disco sozinho some assim que a
 * câmera abaixa (fica de perfil, com um pixel de altura) e some também atrás
 * de qualquer mesa; o pino resolve os dois casos por ser vertical.
 *
 * `depthTest={false}` no pino: o alvo tem que ser visível mesmo quando cai
 * atrás de uma parede — é uma marca de intenção, não um objeto da planta.
 */
function AlvoDeColagem({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.28, 24]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.3, 0.36, 24]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.35, 0]} renderOrder={999}>
        <cylinderGeometry args={[0.025, 0.025, 0.7, 8]} />
        <meshBasicMaterial color="#ef4444" depthTest={false} />
      </mesh>
    </group>
  );
}

/**
 * A prévia do modo obra: os quadrados de 1 m² que o arrasto vai pegar.
 *
 * Mostra o retângulo JÁ ENCAIXADO na grade, e não o traço solto do mouse.
 * A conta de quais quadrados entram é a mesma que grava (`celulasDoArrasto`),
 * de propósito: prévia que usa uma regra e gravação que usa outra é como se
 * descobre, depois de soltar, que pegou uma fileira a mais.
 */
function FantasmaDePiso({ traco }: { traco: TracoNoChao }) {
  const celulas = celulasDoArrasto(traco.x1, traco.y1, traco.x2, traco.y2);
  const cxs = celulas.map((c) => c.cx);
  const cys = celulas.map((c) => c.cy);
  const x0 = Math.min(...cxs);
  const y0 = Math.min(...cys);
  const largura = Math.max(...cxs) - x0 + 1;
  const profundidade = Math.max(...cys) - y0 + 1;

  return (
    <group position={[x0 + largura / 2, 0.05, y0 + profundidade / 2]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[largura, profundidade]} />
        <meshBasicMaterial color="#0ea5e9" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <Etiqueta center distanceFactor={16} position={[0, 0.4, 0]}>
        {/* pointer-events-none: etiqueta de prévia nunca pode roubar o clique
            de quem ainda está arrastando — ela nasce debaixo do cursor. */}
        <span className="pointer-events-none whitespace-nowrap rounded bg-sky-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
          {largura} × {profundidade} m · {celulas.length} m²
        </span>
      </Etiqueta>
    </group>
  );
}

/**
 * Projeta o ponteiro num plano matemático e reporta a posição no mundo.
 *
 * Serve tanto para arrastar quanto para desenhar. Plano matemático, e não um
 * mesh invisível de colisão: o mesh para de receber evento assim que o cursor
 * passa por cima de outra peça, e o objeto "gruda" no meio do caminho.
 */
function PonteiroNoPlano({
  ativo,
  altura,
  onMover,
  onSoltar,
}: {
  ativo: boolean;
  altura: number;
  onMover: (x: number, z: number) => void;
  onSoltar: () => void;
}) {
  const { camera, gl } = useThree();
  const alvo = useRef(new THREE.Vector3());
  const raycaster = useRef(new THREE.Raycaster());
  const ponteiro = useRef(new THREE.Vector2());

  useEffect(() => {
    if (!ativo) return;
    const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -altura);
    const el = gl.domElement;

    const mover = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ponteiro.current.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(ponteiro.current, camera);
      if (raycaster.current.ray.intersectPlane(plano, alvo.current)) {
        onMover(alvo.current.x, alvo.current.z);
      }
    };

    el.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", onSoltar);
    return () => {
      el.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", onSoltar);
    };
  }, [ativo, altura, camera, gl, onMover, onSoltar]);

  return null;
}

/**
 * Um andar que não está sendo editado: translúcido, sem sombra e sem eventos.
 *
 * `raycast={() => null}` em vez de `pointerEvents`: three não tem CSS, e sem
 * desligar o raycast o clique atravessaria para a peça do outro andar — que é
 * exatamente o acidente que a translucidez promete evitar.
 */
function AndarFantasma({
  planta,
  elementos,
  ativos,
  celulas,
  base,
}: {
  planta: TiPlanta;
  elementos: TiElemento[];
  ativos: TiAtivo[];
  celulas?: TiCelula[];
  base: number;
}) {
  const L = M(planta.largura_cm);
  const doPiso = useMemo(
    () =>
      celulas && celulas.length > 0
        ? celulas
        : celulasDoRetangulo(planta.largura_cm, planta.altura_cm),
    [celulas, planta.largura_cm, planta.altura_cm],
  );
  const geometria = useGeometriaDoPiso(doPiso);
  return (
    <group position={[0, base, 0]} raycast={() => null}>
      <mesh geometry={geometria} raycast={() => null}>
        <meshStandardMaterial
          color={planta.cor_piso || "#eef2f7"}
          transparent
          opacity={0.35}
          roughness={1}
          side={THREE.DoubleSide}
        />
      </mesh>
      <group>
        {elementos.map((el) => {
          const largura = M(Number(el.largura));
          const profundidade = M(Number(el.altura));
          const altura = M(alturaDoElemento(el));
          return (
            <group
              key={el.id}
              position={[M(Number(el.x)) + largura / 2, 0, M(Number(el.y)) + profundidade / 2]}
              rotation={[0, rad(Number(el.rotacao)), 0]}
              raycast={() => null}
            >
              <ModeloDoElemento elemento={el} largura={largura} profundidade={profundidade} altura={altura} />
            </group>
          );
        })}
        {ativos
          .filter((a) => a.planta_id === planta.id && a.pos_x != null)
          .map((a) => {
            const { largura, profundidade, altura } = dimensoesAtivo(a);
            return (
              <group
                key={a.id}
                position={[M(Number(a.pos_x)), M(alturaDeApoio(a, elementos)), M(Number(a.pos_y))]}
                rotation={[0, rad(Number(a.rotacao)), 0]}
                raycast={() => null}
              >
                <ModeloDoAtivo ativo={a} largura={largura} profundidade={profundidade} altura={altura} />
              </group>
            );
          })}
      </group>
      <Etiqueta center distanceFactor={26} position={[L / 2, 0.4, -0.6]}>
        <span className="whitespace-nowrap rounded bg-slate-900/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {planta.nome}
        </span>
      </Etiqueta>
    </group>
  );
}

/**
 * Os marcadores que moldam o piso, um por quadrado de 1 m².
 *
 *   "+" fora, encostado no piso  → aquele metro quadrado passa a existir;
 *   "−" nos quadrados de borda   → aquele metro quadrado deixa de existir.
 *
 * É assim que um retângulo vira um L: clicar num "+" da direita embaixo
 * acrescenta SÓ aquele quadrado, não a fileira inteira.
 *
 * Célula cercada por todos os lados não recebe "−" — tirar um quadrado do
 * meio abriria um buraco no piso, que ninguém quer de propósito.
 */
function MarcadoresDeCelula({
  celulas,
  onDefinir,
}: {
  celulas: TiCelula[];
  onDefinir: (cx: number, cy: number, ocupar: boolean) => void;
}) {
  const fora = useMemo(() => contornoParaExpandir(celulas), [celulas]);
  const borda = useMemo(() => bordaParaRemover(celulas), [celulas]);

  return (
    <group>
      {fora.map((c) => (
        <MarcadorNoChao
          key={`mais-${chaveCelula(c.cx, c.cy)}`}
          cx={c.cx}
          cy={c.cy}
          modo="mais"
          onClicar={() => onDefinir(c.cx, c.cy, true)}
        />
      ))}
      {borda.map((c) => (
        <MarcadorNoChao
          key={`menos-${chaveCelula(c.cx, c.cy)}`}
          cx={c.cx}
          cy={c.cy}
          modo="menos"
          onClicar={() => onDefinir(c.cx, c.cy, false)}
        />
      ))}
    </group>
  );
}

/** Um quadrado clicável com "+" ou "−" desenhado — acende ao passar o mouse. */
function MarcadorNoChao({
  cx,
  cy,
  modo,
  onClicar,
}: {
  cx: number;
  cy: number;
  modo: "mais" | "menos";
  onClicar: () => void;
}) {
  const [aceso, setAceso] = useState(false);
  const mais = modo === "mais";
  // O "−" fica quase invisível parado: ele mora EM CIMA do piso existente, e
  // um marcador forte em cada quadrado de borda poluiria a planta inteira.
  const opacidade = aceso ? 0.5 : mais ? 0.18 : 0.05;
  const cor = aceso ? (mais ? "#0ea5e9" : "#ef4444") : "#94a3b8";
  const corSinal = aceso ? "#ffffff" : mais ? "#64748b" : "#94a3b8";

  return (
    <group
      position={[cx + 0.5, 0.03, cy + 0.5]}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onClicar();
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setAceso(true);
      }}
      onPointerOut={() => setAceso(false)}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshBasicMaterial color={cor} transparent opacity={opacidade} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.42, 0.09]} />
        <meshBasicMaterial color={corSinal} transparent opacity={aceso ? 1 : 0.7} depthWrite={false} />
      </mesh>
      {mais && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.09, 0.42]} />
          <meshBasicMaterial color={corSinal} transparent opacity={aceso ? 1 : 0.7} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** Uma bola de puxar: esfera visível + esfera invisível maior, para acertar. */
function Alca({
  posicao,
  onPegar,
}: {
  posicao: [number, number, number];
  onPegar: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const pegar = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onPegar();
  };

  /**
   * Tamanho constante NA TELA, não no mundo.
   *
   * Com tamanho fixo em metros, a alça vira uma bola gigante cobrindo meia
   * sala quando a câmera aproxima, e um ponto invisível quando ela afasta. A
   * escala acompanha a distância da câmera, então ela ocupa sempre os mesmos
   * pixels — como a alça de qualquer editor.
   */
  useFrame(({ camera }) => {
    if (!ref.current) return;
    const d = camera.position.distanceTo(ref.current.getWorldPosition(new THREE.Vector3()));
    const k = THREE.MathUtils.clamp(d / 14, 0.35, 2.4);
    ref.current.scale.setScalar(k);
  });

  return (
    <group ref={ref} position={posicao}>
      {/* A área de clique é maior que a bola desenhada — mirar numa esfera de
          15 cm num mapa de 20 m é frustrante —, mas só um pouco: com 38 cm de
          raio ela cobria a peça VIZINHA, e o clique em outra mesa era engolido
          pela alça da mesa que já estava selecionada. Era isso que fazia a
          seleção parecer presa. */}
      <mesh onPointerDown={pegar} visible={false}>
        <sphereGeometry args={[0.2, 8, 6]} />
      </mesh>
      <mesh onPointerDown={pegar}>
        <sphereGeometry args={[0.15, 16, 14]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.6} />
      </mesh>
      {/* Anel no chão, para a alça ser vista mesmo com a peça na frente. */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.28, 20]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

/**
 * As alças de manipulação da peça selecionada.
 *
 * Peça alongada (parede, divisória, janela) ganha DUAS alças, nas pontas:
 * puxar uma delas muda comprimento e ângulo de uma vez, que é como se ajusta
 * parede. As demais ganham QUATRO, nas quinas, e esticam o retângulo com o
 * canto oposto parado.
 *
 * Enquanto se puxa, a medida aparece em metros ao lado — sem isso, "aumentar
 * um quadrado" vira tentativa e erro contra o grid.
 */
function Alcas({
  el,
  previa,
  onPegar,
}: {
  el: TiElemento;
  previa: Partial<TiElemento> | null;
  onPegar: (alca: "a" | "b" | "nw" | "ne" | "sw" | "se") => void;
}) {
  const peca = previa ? ({ ...el, ...previa } as TiElemento) : el;
  const def = tipoElemento(peca.tipo);
  const altura = M(alturaDoElemento(peca)) + 0.15;
  const metros = (cm: number) => `${(cm / 100).toFixed(2).replace(".", ",")} m`;

  if (def.familia === "estrutura") {
    const { a, b } = pontasDaParede(peca);
    return (
      <>
        <Alca posicao={[M(a.x), altura, M(a.y)]} onPegar={() => onPegar("a")} />
        <Alca posicao={[M(b.x), altura, M(b.y)]} onPegar={() => onPegar("b")} />
        {/* Só enquanto se puxa: parada, a etiqueta competia com o nome do
            equipamento e cobria a peça vizinha. */}
        {previa && (
          <Etiqueta
            center
            distanceFactor={16}
            position={[M((a.x + b.x) / 2), altura + 0.35, M((a.y + b.y) / 2)]}
          >
            <span className="pointer-events-none whitespace-nowrap rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white shadow">
              {metros(Number(peca.largura))}
            </span>
          </Etiqueta>
        )}
      </>
    );
  }

  const x0 = M(Number(peca.x));
  const y0 = M(Number(peca.y));
  const x1 = x0 + M(Number(peca.largura));
  const y1 = y0 + M(Number(peca.altura));
  const quinas: [("nw" | "ne" | "sw" | "se"), number, number][] = [
    ["nw", x0, y0],
    ["ne", x1, y0],
    ["sw", x0, y1],
    ["se", x1, y1],
  ];
  return (
    <>
      {quinas.map(([nome, px, pz]) => (
        <Alca key={nome} posicao={[px, altura, pz]} onPegar={() => onPegar(nome)} />
      ))}
      {previa && (
        <Etiqueta center distanceFactor={16} position={[(x0 + x1) / 2, altura + 0.35, (y0 + y1) / 2]}>
          <span className="pointer-events-none whitespace-nowrap rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white shadow">
            {metros(Number(peca.largura))} × {metros(Number(peca.altura))}
          </span>
        </Etiqueta>
      )}
    </>
  );
}

export function LegendaStatus() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {["em_uso", "manutencao", "disponivel", "reservado", "inativo"].map((s) => {
        const d = statusAtivo(s);
        return (
          <span key={s} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: d.cor }} />
            {d.label}
          </span>
        );
      })}
    </div>
  );
}

export const iconeDoTipo = (tipo: string) => tipoAtivo(tipo).icone;
