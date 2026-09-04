import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Eye,
  Grid3x3,
  Hammer,
  Layers,
  LayoutDashboard,
  Map as MapIcon,
  MousePointer2,
  Plus,
  Save,
  Search,
  Sparkles,
  Table2,
  Tag,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { cn } from "@/lib/utils";
import {
  useAtivosTi,
  useElementosTi,
  useExcluirAtivo,
  useExcluirElemento,
  usePlantasTi,
  usePosicionarAtivo,
  useSalvarAtivo,
  useSalvarElemento,
  useSalvarPlanta,
  type TiAtivo,
  type TiAtivoInput,
  type TiElemento,
  type TiPlanta,
} from "@/hooks/useTiMapa";
import { AtivoDialog } from "./mapa/AtivoDialog";
import { Inventario } from "./mapa/Inventario";
import { PainelTi } from "./mapa/PainelTi";
import {
  PALETA,
  STATUS_ATIVO,
  TIPOS_ELEMENTO,
  cmParaMetros,
  statusAtivo,
  tipoAtivo,
  tipoElemento,
} from "./mapa/catalogo";
import { PlantaCanvas, type Ferramenta, type SelecaoMapa } from "./mapa/PlantaCanvas";

/**
 * T.I › Mapa de Hardware.
 *
 * Três abas sobre a MESMA base: o Mapa responde "onde está", o Inventário
 * responde "quantos e quais", o Painel responde "o que precisa de mim hoje".
 * Nenhuma delas recarrega dados da outra — os ativos são buscados uma vez e
 * as três derivam a sua visão em memória.
 *
 * Acesso (README da raiz): a tela é `ti_mapa_hardware`; desenhar a planta
 * pede `ti_mapa_editar` e mexer em equipamento pede `ti_ativo_gerenciar`.
 * Os três são menus reais em app_menu (os dois últimos como menu fantasma,
 * rota NULL), criados na migration 20260930000060 — quem libera é o admin em
 * Administração › Acesso por Usuário, nunca um `if` de cargo aqui dentro.
 */

export default function MapaHardware() {
  const [abaPrincipal, setAbaPrincipal] = useState("mapa");
  const [plantaId, setPlantaId] = useState<string | null>(null);
  const [selecao, setSelecao] = useState<SelecaoMapa>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>({ tipo: "selecao" });
  const [busca, setBusca] = useState("");
  const [mostrarGrid, setMostrarGrid] = useState(true);
  const [mostrarRotulos, setMostrarRotulos] = useState(true);
  const [ativoAberto, setAtivoAberto] = useState<TiAtivo | null | undefined>(undefined);
  const [plantaDialog, setPlantaDialog] = useState<Partial<TiPlanta> | null>(null);
  const [confirmar, setConfirmar] = useState<{ tipo: "ativo" | "elemento"; id: string; nome: string } | null>(null);

  const { data: plantas = [], isLoading: carregandoPlantas } = usePlantasTi();
  const { data: ativos = [], isLoading: carregandoAtivos } = useAtivosTi();
  const { data: elementos = [] } = useElementosTi(plantaId);

  const salvarAtivo = useSalvarAtivo();
  const posicionar = usePosicionarAtivo();
  const excluirAtivo = useExcluirAtivo();
  const salvarElemento = useSalvarElemento();
  const excluirElemento = useExcluirElemento();
  const salvarPlanta = useSalvarPlanta();

  const { data: podeEditarPlanta = false } = useScreenAccess("ti_mapa_editar", "alterar");
  const { data: podeCriarPlanta = false } = useScreenAccess("ti_mapa_editar", "incluir");
  const { data: podeApagarElemento = false } = useScreenAccess("ti_mapa_editar", "excluir");
  const { data: podeGerenciar = false } = useScreenAccess("ti_ativo_gerenciar", "alterar");
  const { data: podeIncluir = false } = useScreenAccess("ti_ativo_gerenciar", "incluir");
  const { data: podeExcluirAtivo = false } = useScreenAccess("ti_ativo_gerenciar", "excluir");

  // Primeira planta vira a corrente assim que a lista chega.
  useEffect(() => {
    if (!plantaId && plantas.length > 0) setPlantaId(plantas[0].id);
  }, [plantas, plantaId]);

  const planta = useMemo(() => plantas.find((p) => p.id === plantaId) ?? null, [plantas, plantaId]);

  const naBandeja = useMemo(
    () => ativos.filter((a) => a.status !== "descartado" && (!a.planta_id || a.pos_x == null)),
    [ativos],
  );

  const elementoSelecionado = useMemo(
    () => (selecao?.tipo === "elemento" ? elementos.find((e) => e.id === selecao.id) ?? null : null),
    [selecao, elementos],
  );
  const ativoSelecionado = useMemo(
    () => (selecao?.tipo === "ativo" ? ativos.find((a) => a.id === selecao.id) ?? null : null),
    [selecao, ativos],
  );

  const abrirAtivo = useCallback(
    (id: string) => {
      const a = ativos.find((x) => x.id === id) ?? null;
      if (a) setAtivoAberto(a);
    },
    [ativos],
  );

  const apagarSelecionado = useCallback(() => {
    if (selecao?.tipo === "elemento" && elementoSelecionado && podeApagarElemento) {
      setConfirmar({
        tipo: "elemento",
        id: elementoSelecionado.id,
        nome: elementoSelecionado.rotulo || tipoElemento(elementoSelecionado.tipo).label,
      });
    }
    if (selecao?.tipo === "ativo" && ativoSelecionado && podeExcluirAtivo) {
      setConfirmar({ tipo: "ativo", id: ativoSelecionado.id, nome: ativoSelecionado.nome });
    }
  }, [selecao, elementoSelecionado, ativoSelecionado, podeApagarElemento, podeExcluirAtivo]);

  // Atalhos do editor. Ignora quando o foco está num campo — senão apagar
  // texto do nome de uma sala apagaria a sala.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const digitando = !!alvo && ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName);
      if (digitando || alvo?.isContentEditable) return;
      if (e.key === "Escape") {
        setFerramenta({ tipo: "selecao" });
        setSelecao(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selecao) {
        e.preventDefault();
        apagarSelecionado();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selecao, apagarSelecionado]);

  const confirmarExclusao = () => {
    if (!confirmar) return;
    if (confirmar.tipo === "ativo") {
      excluirAtivo.mutate(confirmar.id);
      setAtivoAberto(undefined);
    } else if (plantaId) {
      excluirElemento.mutate({ id: confirmar.id, plantaId });
    }
    setSelecao(null);
    setConfirmar(null);
  };

  const salvarFicha = (dados: TiAtivoInput & { id?: string }) => {
    salvarAtivo.mutate(dados, { onSuccess: () => setAtivoAberto(undefined) });
  };

  const carregando = carregandoPlantas || carregandoAtivos;

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Mapa de Hardware"
        module="T.I"
        breadcrumb={["Mapa de Hardware"]}
        subtitle="A planta do escritório com cada equipamento no lugar em que ele está — configuração, rede, responsável e histórico atrás de cada ícone."
        actions={
          <>
            {podeIncluir && (
              <Button onClick={() => setAtivoAberto(null)}>
                <Plus className="mr-1.5 h-4 w-4" /> Novo equipamento
              </Button>
            )}
          </>
        }
      />

      <Tabs value={abaPrincipal} onValueChange={setAbaPrincipal}>
        <TabsList>
          <TabsTrigger value="mapa" className="gap-1.5">
            <MapIcon className="h-4 w-4" /> Mapa
          </TabsTrigger>
          <TabsTrigger value="inventario" className="gap-1.5">
            <Table2 className="h-4 w-4" /> Inventário
            <Badge variant="secondary" className="ml-1">{ativos.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="painel" className="gap-1.5">
            <LayoutDashboard className="h-4 w-4" /> Painel
          </TabsTrigger>
        </TabsList>

        {/* ── MAPA ──────────────────────────────────────────────────── */}
        <TabsContent value="mapa" className="mt-4">
          {carregando && (
            <Card className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">
              Carregando o escritório…
            </Card>
          )}

          {!carregando && !planta && (
            <Card className="flex h-[70vh] flex-col items-center justify-center gap-3 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-semibold">Nenhuma planta cadastrada</p>
                <p className="text-sm text-muted-foreground">
                  Crie a planta do escritório para começar a posicionar os equipamentos.
                </p>
              </div>
              {podeCriarPlanta && (
                <Button onClick={() => setPlantaDialog({ nome: "", largura_cm: 2400, altura_cm: 1600 })}>
                  <Plus className="mr-1.5 h-4 w-4" /> Criar planta
                </Button>
              )}
            </Card>
          )}

          {!carregando && planta && (
            <div className="space-y-3">
              <BarraFerramentas
                planta={planta}
                plantas={plantas}
                onTrocarPlanta={(id) => { setPlantaId(id); setSelecao(null); }}
                ferramenta={ferramenta}
                setFerramenta={setFerramenta}
                podeEditarPlanta={podeEditarPlanta}
                podeCriarPlanta={podeCriarPlanta}
                onEditarPlanta={() => setPlantaDialog(planta)}
                onNovaPlanta={() => setPlantaDialog({ nome: "", largura_cm: 2400, altura_cm: 1600 })}
                busca={busca}
                setBusca={setBusca}
                mostrarGrid={mostrarGrid}
                setMostrarGrid={setMostrarGrid}
                mostrarRotulos={mostrarRotulos}
                setMostrarRotulos={setMostrarRotulos}
              />

              <div className="grid gap-3 xl:grid-cols-[250px_minmax(0,1fr)_290px]">
                <PainelEsquerdo
                  ferramenta={ferramenta}
                  setFerramenta={setFerramenta}
                  podeEditarPlanta={podeEditarPlanta}
                  podeGerenciar={podeGerenciar}
                  bandeja={naBandeja}
                  onAbrirAtivo={abrirAtivo}
                />

                <div className="h-[74vh] min-h-[520px]">
                  <PlantaCanvas
                    planta={planta}
                    elementos={elementos}
                    ativos={ativos}
                    selecao={selecao}
                    onSelecionar={setSelecao}
                    ferramenta={ferramenta}
                    podeEditarPlanta={podeEditarPlanta}
                    podeMoverAtivos={podeGerenciar}
                    destaque={busca}
                    mostrarGrid={mostrarGrid}
                    mostrarRotulos={mostrarRotulos}
                    onCriarElemento={(e) => {
                      salvarElemento.mutate({ ...e, planta_id: planta.id });
                      setFerramenta({ tipo: "selecao" });
                    }}
                    onMoverElemento={(id, patch) => {
                      const atual = elementos.find((el) => el.id === id);
                      if (!atual) return;
                      salvarElemento.mutate({ ...atual, ...patch });
                    }}
                    onMoverAtivo={(id, pos) => posicionar.mutate({ id, planta_id: planta.id, ...pos })}
                    onSoltarAtivoNaPlanta={(id, pos) => posicionar.mutate({ id, planta_id: planta.id, ...pos })}
                    onAbrirAtivo={abrirAtivo}
                  />
                </div>

                <Inspetor
                  elemento={elementoSelecionado}
                  ativo={ativoSelecionado}
                  planta={planta}
                  podeEditarPlanta={podeEditarPlanta}
                  podeGerenciar={podeGerenciar}
                  podeApagar={selecao?.tipo === "ativo" ? podeExcluirAtivo : podeApagarElemento}
                  onAlterarElemento={(patch) => {
                    if (!elementoSelecionado) return;
                    salvarElemento.mutate({ ...elementoSelecionado, ...patch });
                  }}
                  onAlterarAtivo={(patch) => {
                    if (!ativoSelecionado) return;
                    salvarAtivo.mutate({ ...(ativoSelecionado as TiAtivoInput), id: ativoSelecionado.id, ...patch });
                  }}
                  onTirarDoMapa={() => {
                    if (!ativoSelecionado) return;
                    posicionar.mutate({ id: ativoSelecionado.id, planta_id: null, pos_x: null, pos_y: null });
                    setSelecao(null);
                  }}
                  onAbrirFicha={() => ativoSelecionado && setAtivoAberto(ativoSelecionado)}
                  onApagar={apagarSelecionado}
                />
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── INVENTÁRIO ────────────────────────────────────────────── */}
        <TabsContent value="inventario" className="mt-4">
          <Inventario
            ativos={ativos}
            plantas={plantas}
            onAbrir={abrirAtivo}
            onIrParaMapa={(a) => {
              if (!a.planta_id) return;
              setPlantaId(a.planta_id);
              setSelecao({ tipo: "ativo", id: a.id });
              setAbaPrincipal("mapa");
            }}
          />
        </TabsContent>

        {/* ── PAINEL ────────────────────────────────────────────────── */}
        <TabsContent value="painel" className="mt-4">
          <PainelTi ativos={ativos} onAbrir={abrirAtivo} />
        </TabsContent>
      </Tabs>

      <AtivoDialog
        aberto={ativoAberto !== undefined}
        onFechar={() => setAtivoAberto(undefined)}
        ativo={ativoAberto ?? null}
        plantas={plantas}
        ativos={ativos}
        podeEditar={ativoAberto ? podeGerenciar : podeIncluir}
        podeExcluir={podeExcluirAtivo}
        salvando={salvarAtivo.isPending}
        onSalvar={salvarFicha}
        onExcluir={(id) => {
          const a = ativos.find((x) => x.id === id);
          setConfirmar({ tipo: "ativo", id, nome: a?.nome ?? "equipamento" });
        }}
      />

      <PlantaDialog
        valor={plantaDialog}
        onFechar={() => setPlantaDialog(null)}
        salvando={salvarPlanta.isPending}
        onSalvar={(p) =>
          salvarPlanta.mutate(p, {
            onSuccess: (id) => {
              setPlantaId(id);
              setPlantaDialog(null);
            },
          })
        }
      />

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{confirmar?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar?.tipo === "ativo"
                ? "O equipamento sai do inventário junto com o histórico dele. Se a máquina só saiu de uso, prefira marcar o status como Descartado — assim o histórico fica."
                : "O elemento some da planta. Os equipamentos posicionados sobre ele continuam onde estão."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarExclusao}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Barra de ferramentas ──────────────────────────────────────────────

interface BarraProps {
  planta: TiPlanta;
  plantas: TiPlanta[];
  onTrocarPlanta: (id: string) => void;
  ferramenta: Ferramenta;
  setFerramenta: (f: Ferramenta) => void;
  podeEditarPlanta: boolean;
  podeCriarPlanta: boolean;
  onEditarPlanta: () => void;
  onNovaPlanta: () => void;
  busca: string;
  setBusca: (v: string) => void;
  mostrarGrid: boolean;
  setMostrarGrid: (v: boolean) => void;
  mostrarRotulos: boolean;
  setMostrarRotulos: (v: boolean) => void;
}

function BarraFerramentas(p: BarraProps) {
  return (
    <Card className="flex flex-wrap items-center gap-2 p-2">
      <Select value={p.planta.id} onValueChange={p.onTrocarPlanta}>
        <SelectTrigger className="w-[210px]">
          <Building2 className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {p.plantas.map((pl) => (
            <SelectItem key={pl.id} value={pl.id}>{pl.nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="hidden text-xs text-muted-foreground sm:inline">
        {cmParaMetros(p.planta.largura_cm)} × {cmParaMetros(p.planta.altura_cm)}
      </span>

      {p.podeEditarPlanta && (
        <Button variant="ghost" size="sm" onClick={p.onEditarPlanta}>
          <Save className="mr-1.5 h-4 w-4" /> Editar planta
        </Button>
      )}
      {p.podeCriarPlanta && (
        <Button variant="ghost" size="sm" onClick={p.onNovaPlanta}>
          <Plus className="mr-1.5 h-4 w-4" /> Nova planta
        </Button>
      )}

      <Separator orientation="vertical" className="h-6" />

      <Button
        variant={p.ferramenta.tipo === "selecao" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => p.setFerramenta({ tipo: "selecao" })}
      >
        <MousePointer2 className="mr-1.5 h-4 w-4" /> Selecionar
      </Button>
      <Button
        variant={p.mostrarGrid ? "secondary" : "ghost"}
        size="icon"
        className="h-8 w-8"
        title="Grade de 25 cm"
        onClick={() => p.setMostrarGrid(!p.mostrarGrid)}
      >
        <Grid3x3 className="h-4 w-4" />
      </Button>
      <Button
        variant={p.mostrarRotulos ? "secondary" : "ghost"}
        size="icon"
        className="h-8 w-8"
        title="Nomes dos equipamentos"
        onClick={() => p.setMostrarRotulos(!p.mostrarRotulos)}
      >
        <Tag className="h-4 w-4" />
      </Button>

      <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={p.busca}
          onChange={(e) => p.setBusca(e.target.value)}
          placeholder="Achar no mapa: nome, IP, pessoa…"
          className="h-9 pl-8"
        />
      </div>
    </Card>
  );
}

// ── Painel esquerdo: construção + bandeja ─────────────────────────────

function PainelEsquerdo({
  ferramenta,
  setFerramenta,
  podeEditarPlanta,
  podeGerenciar,
  bandeja,
  onAbrirAtivo,
}: {
  ferramenta: Ferramenta;
  setFerramenta: (f: Ferramenta) => void;
  podeEditarPlanta: boolean;
  podeGerenciar: boolean;
  bandeja: TiAtivo[];
  onAbrirAtivo: (id: string) => void;
}) {
  const grupos = useMemo(
    () => [
      { titulo: "Estrutura", itens: TIPOS_ELEMENTO.filter((t) => t.familia === "estrutura") },
      { titulo: "Ambientes", itens: TIPOS_ELEMENTO.filter((t) => t.familia === "area") },
      { titulo: "Mobília", itens: TIPOS_ELEMENTO.filter((t) => t.familia === "mobilia" || t.familia === "texto") },
    ],
    [],
  );

  return (
    <div className="flex h-[74vh] min-h-[520px] flex-col gap-3">
      {podeEditarPlanta && (
        <Card className="flex min-h-0 flex-1 flex-col">
          <p className="flex items-center gap-1.5 border-b p-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Hammer className="h-3.5 w-3.5" /> Construir
          </p>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-2.5">
              {grupos.map((g) => (
                <div key={g.titulo}>
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{g.titulo}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {g.itens.map((t) => {
                      const Icone = t.icone;
                      const ativa = ferramenta.tipo === "elemento" && ferramenta.valor === t.valor;
                      return (
                        <button
                          key={t.valor}
                          type="button"
                          onClick={() =>
                            setFerramenta(ativa ? { tipo: "selecao" } : { tipo: "elemento", valor: t.valor })
                          }
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-md border p-2 text-[11px] font-medium transition",
                            ativa
                              ? "border-primary bg-primary/10 text-primary"
                              : "hover:border-primary/40 hover:bg-muted",
                          )}
                        >
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded"
                            style={{ background: t.cor, color: "#fff" }}
                          >
                            <Icone className="h-3.5 w-3.5" />
                          </span>
                          <span className="truncate">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      )}

      <Card className={cn("flex min-h-0 flex-col", podeEditarPlanta ? "h-[38%]" : "flex-1")}>
        <p className="flex items-center gap-1.5 border-b p-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Layers className="h-3.5 w-3.5" /> Fora do mapa
          <Badge variant="secondary" className="ml-auto">{bandeja.length}</Badge>
        </p>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
            {bandeja.length === 0 && (
              <p className="p-2 text-[11px] text-muted-foreground">
                Todo equipamento cadastrado já está posicionado.
              </p>
            )}
            {bandeja.map((a) => {
              const def = tipoAtivo(a.tipo);
              const Icone = def.icone;
              return (
                <div
                  key={a.id}
                  draggable={podeGerenciar}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/ti-ativo", a.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDoubleClick={() => onAbrirAtivo(a.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-1.5 text-xs",
                    podeGerenciar ? "cursor-grab active:cursor-grabbing hover:bg-muted" : "opacity-80",
                  )}
                  title={podeGerenciar ? "Arraste para o mapa" : a.nome}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-white"
                    style={{ background: a.cor || def.cor }}
                  >
                    <Icone className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.nome}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {a.codigo} · {statusAtivo(a.status).label}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}

// ── Inspetor (painel direito) ─────────────────────────────────────────

function Inspetor({
  elemento,
  ativo,
  planta,
  podeEditarPlanta,
  podeGerenciar,
  podeApagar,
  onAlterarElemento,
  onAlterarAtivo,
  onTirarDoMapa,
  onAbrirFicha,
  onApagar,
}: {
  elemento: TiElemento | null;
  ativo: TiAtivo | null;
  planta: TiPlanta;
  podeEditarPlanta: boolean;
  podeGerenciar: boolean;
  podeApagar: boolean;
  onAlterarElemento: (patch: Partial<TiElemento>) => void;
  onAlterarAtivo: (patch: Partial<TiAtivoInput>) => void;
  onTirarDoMapa: () => void;
  onAbrirFicha: () => void;
  onApagar: () => void;
}) {
  const [rotuloLocal, setRotuloLocal] = useState("");
  useEffect(() => setRotuloLocal(elemento?.rotulo ?? ""), [elemento?.id, elemento?.rotulo]);

  if (!elemento && !ativo) {
    return (
      <Card className="flex h-[74vh] min-h-[520px] flex-col items-center justify-center gap-2 p-6 text-center">
        <Sparkles className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">Nada selecionado</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Clique numa peça para ver e ajustar as propriedades dela. Arraste com o
          botão esquerdo para mover, use a roda do mouse para dar zoom e segure
          <kbd className="mx-1 rounded border px-1">Alt</kbd> para ignorar a grade.
        </p>
        <Separator className="my-2" />
        <ul className="w-full space-y-1 text-left text-[11px] text-muted-foreground">
          {STATUS_ATIVO.slice(0, 5).map((s) => (
            <li key={s.valor} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.cor }} />
              <span className="font-medium text-foreground">{s.label}</span>
              <span className="truncate">{s.descricao}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  return (
    <Card className="flex h-[74vh] min-h-[520px] flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {elemento && (
            <>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Elemento da planta</p>
                <p className="text-base font-semibold">{tipoElemento(elemento.tipo).label}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Rótulo</Label>
                <Input
                  value={rotuloLocal}
                  disabled={!podeEditarPlanta}
                  onChange={(e) => setRotuloLocal(e.target.value)}
                  onBlur={() => {
                    if (rotuloLocal !== (elemento.rotulo ?? "")) onAlterarElemento({ rotulo: rotuloLocal || null });
                  }}
                  placeholder="Sala do Financeiro"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <CampoNumero label="X (cm)" valor={elemento.x} disabled={!podeEditarPlanta} onChange={(v) => onAlterarElemento({ x: v })} />
                <CampoNumero label="Y (cm)" valor={elemento.y} disabled={!podeEditarPlanta} onChange={(v) => onAlterarElemento({ y: v })} />
                <CampoNumero label="Largura" valor={elemento.largura} disabled={!podeEditarPlanta} onChange={(v) => onAlterarElemento({ largura: Math.max(5, v) })} />
                <CampoNumero label="Altura" valor={elemento.altura} disabled={!podeEditarPlanta} onChange={(v) => onAlterarElemento({ altura: Math.max(5, v) })} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Rotação</Label>
                <div className="flex gap-1">
                  {[0, 45, 90, 135].map((g) => (
                    <Button
                      key={g}
                      size="sm"
                      variant={Number(elemento.rotacao) === g ? "secondary" : "outline"}
                      className="flex-1 px-0 text-xs"
                      disabled={!podeEditarPlanta}
                      onClick={() => onAlterarElemento({ rotacao: g })}
                    >
                      {g}°
                    </Button>
                  ))}
                </div>
              </div>

              <SeletorCor
                valor={elemento.cor ?? tipoElemento(elemento.tipo).cor}
                disabled={!podeEditarPlanta}
                onEscolher={(cor) => onAlterarElemento({ cor })}
              />

              <p className="text-[11px] text-muted-foreground">
                Ocupa {cmParaMetros(elemento.largura)} × {cmParaMetros(elemento.altura)} dentro de uma planta de{" "}
                {cmParaMetros(planta.largura_cm)} × {cmParaMetros(planta.altura_cm)}.
              </p>
            </>
          )}

          {ativo && (
            <>
              <div className="flex items-start gap-2">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ background: ativo.cor || tipoAtivo(ativo.tipo).cor }}
                >
                  {(() => {
                    const Icone = tipoAtivo(ativo.tipo).icone;
                    return <Icone className="h-5 w-5" />;
                  })()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold leading-tight">{ativo.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {ativo.codigo} · {tipoAtivo(ativo.tipo).label}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select
                  value={ativo.status}
                  disabled={!podeGerenciar}
                  onValueChange={(v) => onAlterarAtivo({ status: v as TiAtivo["status"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ATIVO.map((s) => (
                      <SelectItem key={s.valor} value={s.valor}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: s.cor }} />
                          {s.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <dl className="space-y-1.5 text-xs">
                <Linha rotulo="Responsável" valor={ativo.responsavel_nome} />
                <Linha rotulo="Setor" valor={ativo.setor} />
                <Linha rotulo="IP" valor={ativo.ip ? `${ativo.ip}${ativo.ip_tipo ? ` (${ativo.ip_tipo})` : ""}` : null} />
                <Linha rotulo="Hostname" valor={ativo.hostname} />
                <Linha rotulo="Processador" valor={ativo.cpu} />
                <Linha rotulo="Memória" valor={ativo.ram_gb ? `${ativo.ram_gb} GB` : null} />
                <Linha
                  rotulo="Disco"
                  valor={ativo.armazenamento_gb ? `${ativo.armazenamento_gb} GB ${ativo.armazenamento_tipo ?? ""}`.trim() : null}
                />
                <Linha rotulo="Sistema" valor={ativo.sistema_operacional} />
                <Linha rotulo="Patrimônio" valor={ativo.patrimonio} />
              </dl>

              <div className="grid grid-cols-2 gap-2">
                <CampoNumero label="Rotação" valor={ativo.rotacao} disabled={!podeGerenciar} onChange={(v) => onAlterarAtivo({ rotacao: v })} />
                <CampoNumero label="Escala" valor={ativo.escala} passo={0.1} disabled={!podeGerenciar} onChange={(v) => onAlterarAtivo({ escala: Math.min(3, Math.max(0.4, v)) })} />
              </div>

              <SeletorCor
                valor={ativo.cor ?? tipoAtivo(ativo.tipo).cor}
                disabled={!podeGerenciar}
                onEscolher={(cor) => onAlterarAtivo({ cor })}
              />
            </>
          )}
        </div>
      </ScrollArea>

      <div className="flex flex-wrap gap-1.5 border-t p-2.5">
        {ativo && (
          <>
            <Button size="sm" variant="secondary" className="flex-1" onClick={onAbrirFicha}>
              <Eye className="mr-1.5 h-4 w-4" /> Ficha
            </Button>
            {podeGerenciar && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline" onClick={onTirarDoMapa}>
                      Tirar do mapa
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Volta para a bandeja, sem apagar o cadastro.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </>
        )}
        {podeApagar && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onApagar}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className={cn("min-w-0 flex-1 truncate", !valor && "text-muted-foreground/60")}>{valor || "—"}</dd>
    </div>
  );
}

function CampoNumero({
  label,
  valor,
  onChange,
  disabled,
  passo = 5,
}: {
  label: string;
  valor: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  passo?: number;
}) {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => setTexto(String(valor)), [valor]);
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={passo}
        className="h-8"
        value={texto}
        disabled={disabled}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => {
          const n = Number(texto);
          if (Number.isFinite(n) && n !== valor) onChange(n);
          else setTexto(String(valor));
        }}
      />
    </div>
  );
}

function SeletorCor({
  valor,
  onEscolher,
  disabled,
}: {
  valor: string;
  onEscolher: (cor: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Cor</Label>
      <div className="flex flex-wrap gap-1">
        {PALETA.map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={() => onEscolher(c)}
            className={cn(
              "h-5 w-5 rounded border transition",
              valor?.toLowerCase() === c ? "ring-2 ring-primary ring-offset-1" : "hover:scale-110",
            )}
            style={{ background: c }}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}

// ── Diálogo de planta ─────────────────────────────────────────────────

function PlantaDialog({
  valor,
  onFechar,
  onSalvar,
  salvando,
}: {
  valor: Partial<TiPlanta> | null;
  onFechar: () => void;
  onSalvar: (p: Partial<TiPlanta> & { nome: string }) => void;
  salvando: boolean;
}) {
  const [form, setForm] = useState<Partial<TiPlanta>>({});
  useEffect(() => setForm(valor ?? {}), [valor]);

  return (
    <Dialog open={!!valor} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{valor?.id ? "Editar planta" : "Nova planta"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nome</Label>
            <Input
              value={form.nome ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              placeholder="Escritório — 2º andar"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Descrição</Label>
            <Textarea
              rows={2}
              value={form.descricao ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Largura (cm)</Label>
              <Input
                type="number"
                step="50"
                value={form.largura_cm ?? 2400}
                onChange={(e) => setForm((f) => ({ ...f, largura_cm: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Altura (cm)</Label>
              <Input
                type="number"
                step="50"
                value={form.altura_cm ?? 1600}
                onChange={(e) => setForm((f) => ({ ...f, altura_cm: Number(e.target.value) }))}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            As medidas são reais, em centímetros — {cmParaMetros(Number(form.largura_cm ?? 2400))} ×{" "}
            {cmParaMetros(Number(form.altura_cm ?? 1600))}. Meça a sala uma vez e o mapa
            inteiro passa a valer como planta.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            disabled={!form.nome?.trim() || salvando}
            onClick={() => onSalvar({ ...form, nome: form.nome!.trim() })}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
