import { useMemo, useState } from "react";
import { Building2, Boxes, Eye, Layers3, Search, Tag, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  useAtivosTi, useCelulasDeVariasTi, useCelulasTi, useElementosDeVariasTi, useElementosTi,
  usePlantasTi, type TiAtivo,
} from "@/hooks/useTiMapa";
import { statusAtivo, tipoAtivo } from "./mapa/catalogo";
import { Cena3D, LegendaStatus, type SelecaoCena } from "./mapa3d/Cena3D";
import { nomeDoAndar } from "./ConstruirMapa";

/**
 * T.I › Mapa 3D — a tela de VER.
 *
 * É a que se libera para o escritório inteiro: mostra onde cada pessoa senta,
 * onde está cada computador e como o andar é organizado, e não deixa mover,
 * apagar nem abrir dado de patrimônio. Quem precisa de valor de compra, nota
 * fiscal e número de série vai ao Inventário, que é outro menu, com outro
 * cadeado — foi exatamente para isso que as telas foram separadas.
 *
 * A ficha que abre aqui é resumida de propósito: nome, tipo, status, setor e
 * responsável. Nada de custo, série ou acesso remoto.
 */
export default function MapaTi() {
  const [plantaId, setPlantaId] = useState<string | null>(null);
  const [selecao, setSelecao] = useState<SelecaoCena>(null);
  const [busca, setBusca] = useState("");
  const [rotulos, setRotulos] = useState(true);
  const [verTodosAndares, setVerTodosAndares] = useState(false);

  const { data: plantas = [], isLoading: carregandoPlantas } = usePlantasTi();
  const { data: ativos = [], isLoading: carregandoAtivos } = useAtivosTi();

  const plantaAtual = useMemo(
    () => plantas.find((p) => p.id === plantaId) ?? plantas[0] ?? null,
    [plantas, plantaId],
  );
  const { data: elementos = [] } = useElementosTi(plantaAtual?.id);
  // Sem isto o Mapa desenhava o retângulo de compatibilidade enquanto o
  // Construir já mostrava o piso recortado: as duas telas usam a MESMA cena,
  // e o que faltava era a informação, não o código.
  const { data: celulas = [] } = useCelulasTi(plantaAtual?.id);

  // Os outros andares só são buscados quando alguém pede para vê-los.
  const idsVizinhos = useMemo(
    () => (verTodosAndares ? plantas.filter((p) => p.id !== plantaAtual?.id).map((p) => p.id) : []),
    [verTodosAndares, plantas, plantaAtual?.id],
  );
  const { data: elementosVizinhos = [] } = useElementosDeVariasTi(idsVizinhos);
  const { data: celulasVizinhas = [] } = useCelulasDeVariasTi(idsVizinhos);
  const andaresVizinhos = useMemo(
    () =>
      plantas
        .filter((p) => idsVizinhos.includes(p.id))
        .map((p) => ({
          planta: p,
          elementos: elementosVizinhos.filter((e) => e.planta_id === p.id),
          ativos: ativos.filter((a) => a.planta_id === p.id),
          celulas: celulasVizinhas.filter((c) => c.planta_id === p.id),
        })),
    [plantas, idsVizinhos, elementosVizinhos, celulasVizinhas, ativos],
  );

  const doMapa = useMemo(
    () => ativos.filter((a) => a.planta_id === plantaAtual?.id && a.pos_x != null),
    [ativos, plantaAtual?.id],
  );

  const selecionado = useMemo(
    () => (selecao?.tipo === "ativo" ? ativos.find((a) => a.id === selecao.id) ?? null : null),
    [selecao, ativos],
  );

  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    return doMapa
      .filter((a) =>
        [a.nome, a.codigo, a.ip, a.responsavel_nome, a.setor, a.patrimonio]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [doMapa, busca]);

  const pessoas = useMemo(
    () => new Set(doMapa.map((a) => a.responsavel_nome).filter(Boolean)).size,
    [doMapa],
  );

  const carregando = carregandoPlantas || carregandoAtivos;

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Mapa 3D do escritório"
        module="T.I"
        breadcrumb={["Mapa 3D"]}
        subtitle="Gire com o botão esquerdo, aproxime com a roda e clique num equipamento para saber de quem é."
        actions={
          plantas.length > 1 ? (
            <Select value={plantaAtual?.id ?? ""} onValueChange={(v) => { setPlantaId(v); setSelecao(null); }}>
              <SelectTrigger className="w-[220px]">
                <Building2 className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {plantas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{nomeDoAndar(p.nivel)} · {p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      />

      {carregando && (
        <Card className="flex h-[72vh] items-center justify-center text-sm text-muted-foreground">
          Montando o escritório…
        </Card>
      )}

      {!carregando && !plantaAtual && (
        <Card className="flex h-[72vh] flex-col items-center justify-center gap-2 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">Nenhuma planta cadastrada ainda</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Quem tem a tela “Construir o mapa” monta a planta do escritório; ela aparece aqui em seguida.
          </p>
        </Card>
      )}

      {!carregando && plantaAtual && (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-2">
            <Card className="flex flex-wrap items-center gap-2 p-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Achar alguém ou algum equipamento…"
                  className="h-9 pl-8"
                />
              </div>
              <Button
                variant={rotulos ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setRotulos(!rotulos)}
                title="Mostrar ou esconder os nomes"
              >
                <Tag className="mr-1.5 h-4 w-4" /> Nomes
              </Button>
              {plantas.length > 1 && (
                <Button
                  variant={verTodosAndares ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setVerTodosAndares(!verTodosAndares)}
                  title="Ver o prédio inteiro, com os andares empilhados"
                >
                  <Layers3 className="mr-1.5 h-4 w-4" /> Andares
                </Button>
              )}
              <Separator orientation="vertical" className="h-6" />
              <LegendaStatus />
            </Card>

            {resultados.length > 0 && (
              <Card className="p-1.5">
                <p className="px-1.5 pb-1 text-[11px] text-muted-foreground">
                  {resultados.length} resultado(s) — clique para focar
                </p>
                <div className="flex flex-wrap gap-1">
                  {resultados.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelecao({ tipo: "ativo", id: a.id })}
                      className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs hover:bg-muted"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: statusAtivo(a.status).cor }} />
                      {a.nome}
                    </button>
                  ))}
                </div>
              </Card>
            )}

            <div className="h-[72vh] min-h-[520px] overflow-hidden rounded-xl border">
              <Cena3D
                planta={plantaAtual}
                elementos={elementos}
                ativos={ativos}
                selecao={selecao}
                onSelecionar={setSelecao}
                editavel={false}
                destaque={busca}
                mostrarRotulos={rotulos}
                mostrarGrade={false}
                celulas={celulas}
                plantas={plantas}
                andaresVizinhos={andaresVizinhos}
              />
            </div>
          </div>

          <div className="space-y-3">
            <Card className="grid grid-cols-2 gap-2 p-3">
              <Indicador icone={Boxes} label="Equipamentos" valor={doMapa.length} />
              <Indicador icone={Users} label="Pessoas" valor={pessoas} />
            </Card>

            <Card className="flex h-[62vh] min-h-[420px] flex-col">
              {selecionado ? (
                <FichaResumida ativo={selecionado} />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                  <Eye className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm font-medium">Clique num equipamento</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Você verá de quem ele é e em que setor fica. Para girar a cena,
                    arraste com o botão esquerdo; para andar pelo escritório, arraste
                    com o direito.
                  </p>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Indicador({ icone: Icone, label, valor }: { icone: typeof Boxes; label: string; valor: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight tabular-nums">{valor}</p>
      </div>
    </div>
  );
}

/**
 * A ficha do Mapa — deliberadamente curta.
 *
 * Custo, nota fiscal, número de série e acesso remoto NÃO entram: esta é a
 * tela aberta ao escritório. Quem precisa disso tem o Inventário.
 */
function FichaResumida({ ativo }: { ativo: TiAtivo }) {
  const def = tipoAtivo(ativo.tipo);
  const st = statusAtivo(ativo.status);
  const Icone = def.icone;
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow"
            style={{ background: ativo.cor || def.cor }}
          >
            <Icone className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight">{ativo.nome}</p>
            <p className="truncate text-xs text-muted-foreground">{def.label}</p>
            <Badge className="mt-1 border-0 text-white" style={{ background: st.cor }}>{st.label}</Badge>
          </div>
        </div>

        <Separator />

        <dl className="space-y-2 text-sm">
          <Linha rotulo="Responsável" valor={ativo.responsavel_nome} />
          <Linha rotulo="Setor" valor={ativo.setor} />
          <Linha rotulo="Marca" valor={[ativo.marca, ativo.modelo].filter(Boolean).join(" ")} />
          <Linha rotulo="Sistema" valor={ativo.sistema_operacional} />
        </dl>

        <p className="rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
          Dados de patrimônio (valor, nota fiscal, número de série) ficam no Inventário,
          que tem permissão própria.
        </p>
      </div>
    </ScrollArea>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={cn("min-w-0 flex-1 truncate text-sm", !valor && "text-muted-foreground/60")}>
        {valor || "—"}
      </dd>
    </div>
  );
}
