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

export const GRID_CM = 25;

export interface TipoAtivoDef {
  valor: string;
  label: string;
  icone: LucideIcon;
  cor: string;
  /** Pegada no mapa, em cm. */
  largura: number;
  altura: number;
  /** Grupo usado nos filtros e no painel. */
  familia: "computador" | "periferico" | "rede" | "energia" | "outro";
}

export const TIPOS_ATIVO: TipoAtivoDef[] = [
  { valor: "desktop", label: "Desktop", icone: PcCase, cor: "#2563eb", largura: 45, altura: 45, familia: "computador" },
  { valor: "notebook", label: "Notebook", icone: Laptop, cor: "#0ea5e9", largura: 40, altura: 30, familia: "computador" },
  { valor: "monitor", label: "Monitor", icone: Monitor, cor: "#6366f1", largura: 55, altura: 22, familia: "periferico" },
  { valor: "impressora", label: "Impressora", icone: Printer, cor: "#7c3aed", largura: 55, altura: 45, familia: "periferico" },
  { valor: "scanner", label: "Scanner", icone: ScanLine, cor: "#8b5cf6", largura: 45, altura: 35, familia: "periferico" },
  { valor: "servidor", label: "Servidor", icone: Server, cor: "#0f766e", largura: 60, altura: 80, familia: "computador" },
  { valor: "switch", label: "Switch", icone: Network, cor: "#059669", largura: 45, altura: 25, familia: "rede" },
  { valor: "roteador", label: "Roteador", icone: Router, cor: "#10b981", largura: 30, altura: 22, familia: "rede" },
  { valor: "access_point", label: "Access Point", icone: Wifi, cor: "#14b8a6", largura: 25, altura: 25, familia: "rede" },
  { valor: "firewall", label: "Firewall", icone: ShieldCheck, cor: "#ef4444", largura: 45, altura: 25, familia: "rede" },
  { valor: "nobreak", label: "Nobreak", icone: BatteryCharging, cor: "#f59e0b", largura: 30, altura: 20, familia: "energia" },
  { valor: "estabilizador", label: "Estabilizador", icone: Zap, cor: "#eab308", largura: 28, altura: 18, familia: "energia" },
  { valor: "telefone_ip", label: "Telefone IP", icone: Phone, cor: "#64748b", largura: 22, altura: 20, familia: "periferico" },
  { valor: "celular", label: "Celular", icone: Smartphone, cor: "#94a3b8", largura: 12, altura: 16, familia: "periferico" },
  { valor: "tablet", label: "Tablet", icone: Tablet, cor: "#a855f7", largura: 20, altura: 26, familia: "periferico" },
  { valor: "projetor", label: "Projetor", icone: Projector, cor: "#d946ef", largura: 35, altura: 30, familia: "periferico" },
  { valor: "tv", label: "TV / Painel", icone: Tv, cor: "#4f46e5", largura: 120, altura: 12, familia: "periferico" },
  { valor: "camera", label: "Câmera", icone: Camera, cor: "#f43f5e", largura: 18, altura: 18, familia: "rede" },
  { valor: "storage", label: "Storage / NAS", icone: HardDrive, cor: "#0891b2", largura: 40, altura: 40, familia: "computador" },
  { valor: "rack", label: "Rack", icone: Boxes, cor: "#475569", largura: 60, altura: 60, familia: "rede" },
  { valor: "periferico", label: "Periférico", icone: Headset, cor: "#78716c", largura: 20, altura: 20, familia: "periferico" },
  { valor: "outro", label: "Outro", icone: Cable, cor: "#6b7280", largura: 30, altura: 30, familia: "outro" },
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
  /** Elemento estrutural desenha borda dura; mobília desenha cantos moles. */
  familia: "estrutura" | "mobilia" | "area" | "texto";
}

export const TIPOS_ELEMENTO: TipoElementoDef[] = [
  { valor: "parede", label: "Parede", icone: Square, cor: "#334155", largura: 400, altura: 15, familia: "estrutura" },
  { valor: "divisoria", label: "Divisória", icone: Blocks, cor: "#94a3b8", largura: 200, altura: 8, familia: "estrutura" },
  { valor: "porta", label: "Porta", icone: DoorOpen, cor: "#b45309", largura: 90, altura: 15, familia: "estrutura" },
  { valor: "janela", label: "Janela", icone: Square, cor: "#7dd3fc", largura: 150, altura: 12, familia: "estrutura" },
  { valor: "escada", label: "Escada", icone: Blocks, cor: "#a1a1aa", largura: 250, altura: 120, familia: "estrutura" },
  { valor: "sala", label: "Sala / Setor", icone: Square, cor: "#dbeafe", largura: 500, altura: 400, familia: "area" },
  { valor: "recepcao", label: "Recepção", icone: Armchair, cor: "#fef3c7", largura: 400, altura: 300, familia: "area" },
  { valor: "copa", label: "Copa", icone: Coffee, cor: "#fce7f3", largura: 300, altura: 250, familia: "area" },
  { valor: "banheiro", label: "Banheiro", icone: Bath, cor: "#e0f2fe", largura: 250, altura: 200, familia: "area" },
  { valor: "impressora_area", label: "Área de impressão", icone: Printer, cor: "#ede9fe", largura: 200, altura: 150, familia: "area" },
  { valor: "mesa", label: "Mesa", icone: Table2, cor: "#c8a06a", largura: 140, altura: 70, familia: "mobilia" },
  { valor: "cadeira", label: "Cadeira", icone: Armchair, cor: "#64748b", largura: 50, altura: 50, familia: "mobilia" },
  { valor: "armario", label: "Armário", icone: Blocks, cor: "#8b5e34", largura: 120, altura: 45, familia: "mobilia" },
  { valor: "sofa", label: "Sofá", icone: Sofa, cor: "#7c6f64", largura: 180, altura: 80, familia: "mobilia" },
  { valor: "rack", label: "Rack de rede", icone: Boxes, cor: "#1f2937", largura: 80, altura: 80, familia: "mobilia" },
  { valor: "planta_decorativa", label: "Planta", icone: TreePine, cor: "#16a34a", largura: 45, altura: 45, familia: "mobilia" },
  { valor: "texto", label: "Texto / etiqueta", icone: Type, cor: "#0f172a", largura: 200, altura: 40, familia: "texto" },
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
