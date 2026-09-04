import {
  Armchair,
  Bath,
  Blocks,
  Camera,
  Cable,
  Coffee,
  Cpu,
  DoorOpen,
  HardDrive,
  Laptop,
  Lightbulb,
  Monitor,
  Network,
  PcCase,
  Phone,
  Printer,
  Projector,
  Router,
  ScanLine,
  Server,
  ShieldCheck,
  Smartphone,
  Sofa,
  Square,
  TreePine,
  Tv,
  Type,
  Wifi,
  Zap,
  Table2,
  Tablet,
  Boxes,
  Headset,
  BatteryCharging,
  Keyboard,
  Mouse,
  Webcam,
  Cable as CableIcon,
  Presentation,
  Refrigerator,
  GlassWater,
  Armchair as ArmchairIcon,
  LayoutPanelTop,
  Archive,
  Library,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Catálogo do Mapa de Hardware.
 *
 * Um lugar só para "o que existe no mapa e como cada coisa se parece": os
 * CHECKs do banco (supabase/migrations/20260930000060_ti_mapa_hardware.sql)
 * e estas listas têm que andar juntos — tipo aceito aqui e recusado lá vira
 * erro 400 na cara de quem cadastra.
 *
 * Todas as medidas estão em CENTÍMETROS, a mesma unidade das colunas do
 * banco. `largura`/`altura` são o tamanho REAL do móvel/equipamento visto de
 * cima — é o que faz uma mesa de 140 cm parecer uma mesa ao lado de uma
 * parede de 12 cm, em vez de dois retângulos aleatórios.
 */

/**
 * O lado do quadrado do mapa, em cm.
 *
 * 1 metro: é o quadrado que aparece no piso e o passo com que tudo cresce e
 * anda. Já foi 25 cm — mais preciso e pior de usar: quem monta um escritório
 * pensa em "essa sala tem 6 por 4", não em múltiplos de vinte e cinco
 * centímetros, e a peça nunca casava com o quadrado desenhado embaixo dela.
 *
 * Para medida quebrada (a parede de 3,40 m que existe de verdade) existe o
 * Alt, que solta o grid enquanto se arrasta.
 */
export const GRID_CM = 100;

/**
 * O passo com que as PEÇAS andam ao serem arrastadas.
 *
 * Não confunda com `GRID_CM`: aquele é o quadrado do PISO, a unidade em que o
 * escritório cresce. Este é a precisão de posicionamento, e são coisas
 * diferentes — o piso anda de metro em metro porque sala se mede assim, mas
 * encostar um monitor na quina da mesa pede centímetros.
 *
 * Os dois nasceram grudados (o piso virou 1 m e o movimento foi junto), e o
 * resultado foi um editor em que só dava para largar o objeto de metro em
 * metro.
 */
export const PASSOS_DE_MOVIMENTO = [
  { cm: 5, label: "5 cm" },
  { cm: 10, label: "10 cm" },
  { cm: 25, label: "25 cm" },
  { cm: 50, label: "50 cm" },
  { cm: 100, label: "1 m" },
] as const;

/** 25 cm: fino para encaixar móvel, grosso para não virar posicionamento a dedo. */
export const PASSO_PADRAO_CM = 25;

export interface TipoAtivoDef {
  valor: string;
  label: string;
  icone: LucideIcon;
  cor: string;
  /** Pegada no mapa (vista de cima), em cm: largura × profundidade. */
  largura: number;
  altura: number;
  /**
   * Altura VERTICAL real, em cm — a terceira dimensão da cena 3D.
   *
   * Não confunda com `altura`, que é a profundidade vista de cima e existe
   * desde a versão 2D. Um monitor tem 22 cm de profundidade e 45 cm de
   * altura; trocar os dois deita a tela no chão.
   */
  alturaZ: number;
  /** Grupo usado nos filtros e no painel. */
  familia: "computador" | "periferico" | "rede" | "energia" | "outro";
}

export const TIPOS_ATIVO: TipoAtivoDef[] = [
  { valor: "desktop", label: "Desktop", icone: PcCase, cor: "#2563eb", largura: 45, altura: 45, alturaZ: 42, familia: "computador" },
  { valor: "notebook", label: "Notebook", icone: Laptop, cor: "#0ea5e9", largura: 40, altura: 30, alturaZ: 2, familia: "computador" },
  { valor: "monitor", label: "Monitor", icone: Monitor, cor: "#6366f1", largura: 55, altura: 22, alturaZ: 45, familia: "periferico" },
  { valor: "impressora", label: "Impressora", icone: Printer, cor: "#7c3aed", largura: 55, altura: 45, alturaZ: 35, familia: "periferico" },
  { valor: "scanner", label: "Scanner", icone: ScanLine, cor: "#8b5cf6", largura: 45, altura: 35, alturaZ: 20, familia: "periferico" },
  { valor: "servidor", label: "Servidor", icone: Server, cor: "#0f766e", largura: 60, altura: 80, alturaZ: 110, familia: "computador" },
  { valor: "switch", label: "Switch", icone: Network, cor: "#059669", largura: 45, altura: 25, alturaZ: 5, familia: "rede" },
  { valor: "roteador", label: "Roteador", icone: Router, cor: "#10b981", largura: 30, altura: 22, alturaZ: 4, familia: "rede" },
  { valor: "access_point", label: "Access Point", icone: Wifi, cor: "#14b8a6", largura: 25, altura: 25, alturaZ: 4, familia: "rede" },
  { valor: "firewall", label: "Firewall", icone: ShieldCheck, cor: "#ef4444", largura: 45, altura: 25, alturaZ: 5, familia: "rede" },
  { valor: "nobreak", label: "Nobreak", icone: BatteryCharging, cor: "#f59e0b", largura: 30, altura: 20, alturaZ: 18, familia: "energia" },
  { valor: "estabilizador", label: "Estabilizador", icone: Zap, cor: "#eab308", largura: 28, altura: 18, alturaZ: 9, familia: "energia" },
  { valor: "telefone_ip", label: "Telefone IP", icone: Phone, cor: "#64748b", largura: 22, altura: 20, alturaZ: 10, familia: "periferico" },
  { valor: "celular", label: "Celular", icone: Smartphone, cor: "#94a3b8", largura: 12, altura: 16, alturaZ: 1, familia: "periferico" },
  { valor: "tablet", label: "Tablet", icone: Tablet, cor: "#a855f7", largura: 20, altura: 26, alturaZ: 1, familia: "periferico" },
  { valor: "projetor", label: "Projetor", icone: Projector, cor: "#d946ef", largura: 35, altura: 30, alturaZ: 12, familia: "periferico" },
  { valor: "tv", label: "TV / Painel", icone: Tv, cor: "#4f46e5", largura: 120, altura: 12, alturaZ: 70, familia: "periferico" },
  { valor: "camera", label: "Câmera", icone: Camera, cor: "#f43f5e", largura: 18, altura: 18, alturaZ: 10, familia: "rede" },
  { valor: "storage", label: "Storage / NAS", icone: HardDrive, cor: "#0891b2", largura: 40, altura: 40, alturaZ: 25, familia: "computador" },
  { valor: "rack", label: "Rack", icone: Boxes, cor: "#475569", largura: 60, altura: 60, alturaZ: 150, familia: "rede" },
  { valor: "teclado", label: "Teclado", icone: Keyboard, cor: "#475569", largura: 44, altura: 15, alturaZ: 3, familia: "periferico" },
  { valor: "mouse", label: "Mouse", icone: Mouse, cor: "#52525b", largura: 7, altura: 11, alturaZ: 4, familia: "periferico" },
  { valor: "headset", label: "Headset", icone: Headset, cor: "#3f3f46", largura: 18, altura: 18, alturaZ: 20, familia: "periferico" },
  { valor: "webcam", label: "Webcam", icone: Webcam, cor: "#334155", largura: 9, altura: 6, alturaZ: 6, familia: "periferico" },
  { valor: "dock", label: "Dock / Hub", icone: CableIcon, cor: "#57534e", largura: 12, altura: 8, alturaZ: 3, familia: "periferico" },
  { valor: "periferico", label: "Periférico", icone: Headset, cor: "#78716c", largura: 20, altura: 20, alturaZ: 8, familia: "periferico" },
  { valor: "outro", label: "Outro", icone: Cable, cor: "#6b7280", largura: 30, altura: 30, alturaZ: 20, familia: "outro" },
];

export const MAPA_TIPOS_ATIVO: Record<string, TipoAtivoDef> = Object.fromEntries(
  TIPOS_ATIVO.map((t) => [t.valor, t]),
);

export function tipoAtivo(valor: string | null | undefined): TipoAtivoDef {
  return MAPA_TIPOS_ATIVO[valor ?? ""] ?? MAPA_TIPOS_ATIVO.outro;
}

export interface StatusDef {
  valor: string;
  label: string;
  cor: string;
  /** Marca "vivo" no mapa: o LED pisca só em quem exige atenção. */
  pulsa?: boolean;
  descricao: string;
}

export const STATUS_ATIVO: StatusDef[] = [
  { valor: "em_uso", label: "Em uso", cor: "#22c55e", descricao: "Máquina em operação com um responsável." },
  { valor: "disponivel", label: "Disponível", cor: "#38bdf8", descricao: "Em estoque, pronta para entregar." },
  { valor: "manutencao", label: "Manutenção", cor: "#f97316", pulsa: true, descricao: "Parada, em conserto interno ou externo." },
  { valor: "reservado", label: "Reservado", cor: "#a855f7", descricao: "Separada para alguém que ainda vai chegar." },
  { valor: "emprestado", label: "Emprestado", cor: "#eab308", descricao: "Fora do escritório, com previsão de volta." },
  { valor: "inativo", label: "Inativo", cor: "#94a3b8", descricao: "Desligada, sem uso, mas ainda no patrimônio." },
  { valor: "descartado", label: "Descartado", cor: "#ef4444", descricao: "Baixada. Fica no histórico, some do mapa." },
];

export const MAPA_STATUS: Record<string, StatusDef> = Object.fromEntries(
  STATUS_ATIVO.map((s) => [s.valor, s]),
);

export function statusAtivo(valor: string | null | undefined): StatusDef {
  return MAPA_STATUS[valor ?? ""] ?? MAPA_STATUS.inativo;
}

export const CRITICIDADES = [
  { valor: "baixa", label: "Baixa", cor: "#94a3b8" },
  { valor: "media", label: "Média", cor: "#f59e0b" },
  { valor: "alta", label: "Alta", cor: "#ef4444" },
];

export interface TipoElementoDef {
  valor: string;
  label: string;
  icone: LucideIcon;
  /** Preenchimento padrão. */
  cor: string;
  largura: number;
  altura: number;
  /** Altura vertical em cm (parede 280, mesa 75, área de piso ~0). */
  alturaZ: number;
  /** Elemento estrutural desenha borda dura; mobília desenha cantos moles. */
  familia: "estrutura" | "mobilia" | "area" | "texto";
}

export const TIPOS_ELEMENTO: TipoElementoDef[] = [
  { valor: "parede", label: "Parede", icone: Square, cor: "#334155", largura: 400, altura: 15, alturaZ: 280, familia: "estrutura" },
  { valor: "divisoria", label: "Divisória", icone: Blocks, cor: "#94a3b8", largura: 200, altura: 8, alturaZ: 160, familia: "estrutura" },
  { valor: "porta", label: "Porta", icone: DoorOpen, cor: "#b45309", largura: 90, altura: 15, alturaZ: 210, familia: "estrutura" },
  { valor: "janela", label: "Janela", icone: Square, cor: "#7dd3fc", largura: 150, altura: 12, alturaZ: 120, familia: "estrutura" },
  { valor: "escada", label: "Escada", icone: Blocks, cor: "#a1a1aa", largura: 250, altura: 120, alturaZ: 60, familia: "estrutura" },
  { valor: "sala", label: "Sala / Setor", icone: Square, cor: "#dbeafe", largura: 500, altura: 400, alturaZ: 0.2, familia: "area" },
  { valor: "recepcao", label: "Recepção", icone: Armchair, cor: "#fef3c7", largura: 400, altura: 300, alturaZ: 0.2, familia: "area" },
  { valor: "copa", label: "Copa", icone: Coffee, cor: "#fce7f3", largura: 300, altura: 250, alturaZ: 0.2, familia: "area" },
  { valor: "banheiro", label: "Banheiro", icone: Bath, cor: "#e0f2fe", largura: 250, altura: 200, alturaZ: 0.2, familia: "area" },
  { valor: "impressora_area", label: "Área de impressão", icone: Printer, cor: "#ede9fe", largura: 200, altura: 150, alturaZ: 0.2, familia: "area" },
  { valor: "mesa", label: "Mesa", icone: Table2, cor: "#c8a06a", largura: 140, altura: 70, alturaZ: 75, familia: "mobilia" },
  { valor: "cadeira", label: "Cadeira", icone: Armchair, cor: "#64748b", largura: 50, altura: 50, alturaZ: 95, familia: "mobilia" },
  { valor: "armario", label: "Armário", icone: Blocks, cor: "#8b5e34", largura: 120, altura: 45, alturaZ: 180, familia: "mobilia" },
  { valor: "sofa", label: "Sofá", icone: Sofa, cor: "#7c6f64", largura: 180, altura: 80, alturaZ: 80, familia: "mobilia" },
  { valor: "rack", label: "Rack de rede", icone: Boxes, cor: "#1f2937", largura: 80, altura: 80, alturaZ: 150, familia: "mobilia" },
  { valor: "planta_decorativa", label: "Planta", icone: TreePine, cor: "#16a34a", largura: 45, altura: 45, alturaZ: 120, familia: "mobilia" },
  { valor: "mesa_l", label: "Mesa em L", icone: LayoutPanelTop, cor: "#c8a06a", largura: 160, altura: 160, alturaZ: 75, familia: "mobilia" },
  { valor: "mesa_reuniao", label: "Mesa de reunião", icone: Users, cor: "#b08d5c", largura: 300, altura: 120, alturaZ: 75, familia: "mobilia" },
  { valor: "bancada", label: "Bancada", icone: Table2, cor: "#d0ad78", largura: 300, altura: 60, alturaZ: 75, familia: "mobilia" },
  { valor: "poltrona", label: "Poltrona", icone: ArmchairIcon, cor: "#6b7280", largura: 80, altura: 80, alturaZ: 85, familia: "mobilia" },
  { valor: "gaveteiro", label: "Gaveteiro", icone: Archive, cor: "#8b5e34", largura: 45, altura: 50, alturaZ: 60, familia: "mobilia" },
  { valor: "estante", label: "Estante", icone: Library, cor: "#7a5230", largura: 90, altura: 35, alturaZ: 200, familia: "mobilia" },
  { valor: "quadro_branco", label: "Quadro branco", icone: Presentation, cor: "#f8fafc", largura: 200, altura: 8, alturaZ: 120, familia: "mobilia" },
  { valor: "geladeira", label: "Geladeira", icone: Refrigerator, cor: "#e2e8f0", largura: 65, altura: 65, alturaZ: 170, familia: "mobilia" },
  { valor: "bebedouro", label: "Bebedouro", icone: GlassWater, cor: "#cbd5e1", largura: 35, altura: 35, alturaZ: 105, familia: "mobilia" },
  { valor: "texto", label: "Texto / etiqueta", icone: Type, cor: "#0f172a", largura: 200, altura: 40, alturaZ: 1, familia: "texto" },
];

export const MAPA_TIPOS_ELEMENTO: Record<string, TipoElementoDef> = Object.fromEntries(
  TIPOS_ELEMENTO.map((t) => [t.valor, t]),
);

export function tipoElemento(valor: string | null | undefined): TipoElementoDef {
  return MAPA_TIPOS_ELEMENTO[valor ?? ""] ?? MAPA_TIPOS_ELEMENTO.parede;
}

/** Paleta oferecida no inspetor — cores de "jogo", legíveis nos dois temas. */
export const PALETA = [
  "#334155", "#64748b", "#94a3b8", "#c8a06a", "#8b5e34", "#b45309",
  "#dc2626", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9",
  "#2563eb", "#6366f1", "#a855f7", "#ec4899",
];

/** Ícone do módulo, reexportado para a tela não reimportar lucide à toa. */
export const IconeModuloTi = Cpu;
export const IconeLuz = Lightbulb;

/** cm → metros, com vírgula (o brasileiro lê "3,40 m", não "3.4"). */
export function cmParaMetros(cm: number): string {
  return `${(cm / 100).toFixed(2).replace(".", ",")} m`;
}

export function arredondarGrid(valor: number, grid = GRID_CM): number {
  return Math.round(valor / grid) * grid;
}
