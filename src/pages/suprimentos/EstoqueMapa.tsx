import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  Armchair, Box, Eye, Loader2, MapPin, Move3d, Pencil, Plus, Search, Trash2, TriangleAlert,
} from "lucide-react";
import { MapaCena, pontoDeVistaGeral, pontoDeVistaMesa } from "@/components/suprimentos/mapa3d/MapaCena";
import type { CaixoteRef } from "@/components/suprimentos/mapa3d/Estantes";
import type { Voo } from "@/components/suprimentos/mapa3d/CameraCinematica";
import {
  centroCaixote, formatarEndereco, larguraModulo, parseEndereco, pontoDeOlhar,
  type ModuloMapa,
} from "@/lib/suprimentos/enderecoEstoque";
import {
  useAlmoxarifadosDoMapa, useEnderecarItem, useExcluirModulo, useFichasDoMapa,
  useLayoutMapa, useOcupacaoDoMapa, useSalvarModulo,
  type FichaMapa, type SituacaoFicha,
} from "@/hooks/useSupEstoqueMapa";

/**
 * Mapa 3D do Estoque (SIS-2026-0442).
 *
 * A tela responde uma pergunta só: "onde está este item?". Tudo o mais
 * (editor da planta, endereçamento pelo desenho) existe para que essa
 * resposta continue verdadeira com o tempo.
 *
 * O endereço não nasce aqui: é o texto de `sup_estoque_item.localizacao`, que
 * já tinha 747 fichas preenchidas antes desta tela existir. Ver o cabeçalho
 * da migration 20260930000197 para o levantamento.
 */
export default function EstoqueMapa() {
  const [params, setParams] = useSearchParams();
  const { data: almoxarifados = [], isLoading: carregandoAlmox } = useAlmoxarifadosDoMapa();

  const [almoxId, setAlmoxId] = useState<string | null>(null);
  useEffect(() => {
    if (!almoxId && almoxarifados.length) setAlmoxId(almoxarifados[0].almoxarifado_id);
  }, [almoxarifados, almoxId]);

  const { data: planta, isLoading: carregandoPlanta } = useLayoutMapa(almoxId);
  const { data: fichas = [], isLoading: carregandoFichas } = useFichasDoMapa(almoxId);
  const layout = planta?.layout ?? null;
  const modulos = planta?.modulos ?? [];
  const { porCaixote, situacoes, contagem } = useOcupacaoDoMapa(modulos, fichas);

  const { data: podeEditar } = useScreenAccess("sup_estoque_mapa", "alterar");

  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<CaixoteRef | null>(null);
  const [destaque, setDestaque] = useState<CaixoteRef | null>(null);
  const [voo, setVoo] = useState<Voo | null>(null);
  const [modoEditor, setModoEditor] = useState(false);
  const [moduloEmEdicao, setModuloEmEdicao] = useState<string | null>(null);
  const contadorVoo = useRef(0);

  // ---- busca -------------------------------------------------------------
  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2) return [];
    return fichas
      .filter((f) =>
        [f.codigo_item, f.material, f.material_base, f.tamanho, f.localizacao]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
      .slice(0, 40);
  }, [busca, fichas]);

  /** Acha o caixote de uma ficha e voa até ele. É o caminho principal da tela. */
  function irAteAFicha(f: FichaMapa) {
    const e = f.endereco;
    if (!e) return;
    const m = modulos.find((x) => x.codigo === e.rua);
    if (!m) return;

    const ref: CaixoteRef = { moduloId: m.id, rua: e.rua, nivel: e.nivel, coluna: e.coluna };
    setDestaque(ref);
    setSelecionado(ref);
    contadorVoo.current += 1;
    setVoo({
      posicao: pontoDeOlhar(m, e.nivel, e.coluna),
      alvo: centroCaixote(m, e.nivel, e.coluna),
      chave: `ficha-${f.item_estoque_id}-${contadorVoo.current}`,
    });
  }

  function voarPara(pv: { posicao: any; alvo: any }, marca: string) {
    contadorVoo.current += 1;
    setVoo({ ...pv, chave: `${marca}-${contadorVoo.current}` });
  }

  // Entrada por link: /app/suprimentos/estoque-mapa?item=<id> — é o que o
  // botãozinho "ver em 3D" da tela de Estoque & Etiquetas usa.
  const itemDaUrl = params.get("item");
  const jaVoouParaUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!itemDaUrl || !modulos.length || !fichas.length) return;
    if (jaVoouParaUrl.current === itemDaUrl) return;
    const f = fichas.find((x) => x.item_estoque_id === itemDaUrl);
    if (!f) return;
    jaVoouParaUrl.current = itemDaUrl;
    if (f.endereco) irAteAFicha(f);
    else setBusca(f.codigo_item ?? f.material);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemDaUrl, modulos.length, fichas.length]);

  const carregando = carregandoAlmox || carregandoPlanta || carregandoFichas;

  const fichasDoSelecionado = useMemo(() => {
    if (!selecionado) return [];
    return porCaixote.get(`${selecionado.rua}|${selecionado.nivel}|${selecionado.coluna}`)?.fichas ?? [];
  }, [selecionado, porCaixote]);

  return (
    <AcessoGate
      menu="sup_estoque_mapa"
      acao="visualizar"
      fallback={<SemAcesso />}
    >
      <div className="flex h-[calc(100vh-4rem)] flex-col gap-3 p-4">
        <PageHeader
          title="Mapa 3D do Estoque"
          subtitle="O galpão desenhado como ele é. Procure o item e a câmera vai até a baia dele."
          module="Suprimentos"
          breadcrumb={["Estoque", "Mapa 3D"]}
          className="mb-0"
        />

        <div className="flex flex-wrap items-center gap-2">
          {almoxarifados.length > 1 && (
            <Select value={almoxId ?? ""} onValueChange={setAlmoxId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Almoxarifado" />
              </SelectTrigger>
              <SelectContent>
                {almoxarifados.map((a) => (
                  <SelectItem key={a.almoxarifado_id} value={a.almoxarifado_id}>{a.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="relative min-w-[260px] flex-1 max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Código, material ou endereço (ex.: A-03-10)"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          {layout && (
            <>
              <Button variant="outline" size="sm" onClick={() => voarPara(pontoDeVistaMesa(layout), "mesa")}>
                <Armchair className="mr-1.5 h-4 w-4" /> Da bancada
              </Button>
              <Button variant="outline" size="sm" onClick={() => voarPara(pontoDeVistaGeral(layout), "geral")}>
                <Eye className="mr-1.5 h-4 w-4" /> Visão geral
              </Button>
            </>
          )}

          {podeEditar && (
            <Button
              variant={modoEditor ? "default" : "outline"}
              size="sm"
              onClick={() => { setModoEditor((v) => !v); setModuloEmEdicao(null); }}
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              {modoEditor ? "Sair da edição" : "Editar desenho"}
            </Button>
          )}
        </div>

        {carregando ? (
          <Card className="flex flex-1 items-center justify-center">
            <CardContent className="flex items-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Montando o galpão…
            </CardContent>
          </Card>
        ) : !layout ? (
          <SemPlanta />
        ) : (
          <div className="flex min-h-0 flex-1 gap-3">
            <Card className="relative min-w-0 flex-1 overflow-hidden">
              <MapaCena
                layout={layout}
                modulos={modulos}
                porCaixote={porCaixote}
                destaque={destaque}
                selecionado={selecionado}
                moduloEmEdicao={moduloEmEdicao}
                voo={voo}
                onClicarCaixote={(c) => {
                  setSelecionado(c);
                  if (modoEditor) setModuloEmEdicao(c.moduloId);
                }}
                onClicarVazio={() => { if (!modoEditor) setSelecionado(null); }}
              />
              <LegendaCena contagem={contagem} total={fichas.length} />
            </Card>

            <Card className="flex w-[380px] shrink-0 flex-col">
              <ScrollArea className="flex-1">
                <CardContent className="space-y-4 p-4">
                  {busca.trim().length >= 2 ? (
                    <ResultadosBusca
                      resultados={resultados}
                      situacoes={situacoes}
                      onIr={irAteAFicha}
                    />
                  ) : selecionado ? (
                    <PainelCaixote
                      alvo={selecionado}
                      fichas={fichasDoSelecionado}
                      modulo={modulos.find((m) => m.id === selecionado.moduloId) ?? null}
                    />
                  ) : (
                    <ComoUsar />
                  )}

                  {modoEditor && podeEditar && layout && (
                    <>
                      <Separator />
                      <EditorDoDesenho
                        almoxId={almoxId!}
                        layoutId={layout.id}
                        modulos={modulos}
                        moduloEmEdicao={moduloEmEdicao}
                        setModuloEmEdicao={setModuloEmEdicao}
                        caixoteSelecionado={selecionado}
                        fichasDoCaixote={fichasDoSelecionado}
                        fichasSemLugar={fichas.filter((f) => {
                          const s = situacoes.get(f.item_estoque_id);
                          return s && s !== "no_desenho";
                        })}
                      />
                    </>
                  )}
                </CardContent>
              </ScrollArea>
            </Card>
          </div>
        )}
      </div>
    </AcessoGate>
  );
}

// ---------------------------------------------------------------------------

function LegendaCena({ contagem, total }: { contagem: Record<SituacaoFicha, number>; total: number }) {
  const foraDoDesenho = total - contagem.no_desenho;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/85 px-3 py-2 text-xs shadow-sm backdrop-blur">
      <div className="font-medium">{contagem.no_desenho} de {total} fichas no desenho</div>
      {foraDoDesenho > 0 && (
        <div className="mt-0.5 flex items-center gap-1 text-amber-600">
          <TriangleAlert className="h-3 w-3" />
          {foraDoDesenho} fora — veja em “Editar desenho”
        </div>
      )}
    </div>
  );
}

function ResultadosBusca({
  resultados, situacoes, onIr,
}: {
  resultados: FichaMapa[];
  situacoes: Map<string, SituacaoFicha>;
  onIr: (f: FichaMapa) => void;
}) {
  if (!resultados.length) {
    return <p className="text-sm text-muted-foreground">Nada com esse texto no estoque.</p>;
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{resultados.length} resultado(s)</h3>
      {resultados.map((f) => {
        const s = situacoes.get(f.item_estoque_id) ?? "sem_endereco";
        return (
          <button
            key={f.item_estoque_id}
            onClick={() => onIr(f)}
            disabled={s !== "no_desenho"}
            className="w-full rounded-md border p-2.5 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{f.material}</div>
                <div className="text-xs text-muted-foreground">
                  {f.codigo_item ?? "sem código"}{f.tamanho ? ` · ${f.tamanho}` : ""}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0 font-mono text-[11px]">
                {f.localizacao ?? "—"}
              </Badge>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              <span className={f.emFalta ? "font-medium text-red-600" : "text-muted-foreground"}>
                {f.fisico} un. na prateleira
              </span>
              {f.reservado > 0 && (
                <span className="text-muted-foreground">· {f.reservado} reservada(s)</span>
              )}
            </div>
            {s !== "no_desenho" && <AvisoSituacao situacao={s} />}
          </button>
        );
      })}
    </div>
  );
}

function AvisoSituacao({ situacao }: { situacao: SituacaoFicha }) {
  const texto: Record<SituacaoFicha, string> = {
    no_desenho: "",
    sem_endereco: "Sem endereço cadastrado — não dá para mostrar no desenho.",
    endereco_ilegivel: "O endereço escrito não é um endereço (ex.: “TESTE”, “N/A”).",
    estante_ausente: "A estante dessa letra ainda não existe no desenho.",
    fora_da_grade: "O nível/coluna passa do tamanho que a estante tem no desenho.",
  };
  return (
    <div className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-600">
      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{texto[situacao]}</span>
    </div>
  );
}

function PainelCaixote({
  alvo, fichas, modulo,
}: {
  alvo: CaixoteRef;
  fichas: FichaMapa[];
  modulo: ModuloMapa | null;
}) {
  const endereco = formatarEndereco({ rua: alvo.rua, nivel: alvo.nivel, coluna: alvo.coluna });
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-amber-500" />
          <span className="font-mono text-lg font-semibold">{endereco}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {modulo?.nome ?? `Estante ${alvo.rua}`} · nível {alvo.nivel} · coluna {alvo.coluna}
        </p>
      </div>

      {fichas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Caixote vazio.</p>
      ) : (
        <div className="space-y-2">
          {fichas.map((f) => (
            <div key={f.item_estoque_id} className="rounded-md border p-2.5">
              <div className="text-sm font-medium">{f.material}</div>
              <div className="text-xs text-muted-foreground">
                {f.codigo_item ?? "sem código"}{f.tamanho ? ` · ${f.tamanho}` : ""}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                <span>Físico <b>{f.fisico}</b></span>
                <span>Disponível <b>{f.disponivel}</b></span>
                {f.reservado > 0 && <span className="text-muted-foreground">Reservado {f.reservado}</span>}
                {f.emFalta && <span className="font-medium text-red-600">abaixo do mínimo</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComoUsar() {
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <h3 className="text-sm font-semibold text-foreground">Como usar</h3>
      <p>Digite o código ou o nome do material na busca. A câmera sai da bancada e voa até o caixote.</p>
      <p>Clique em qualquer vão da estante para ver o que está guardado nele.</p>
      <p>Arraste para girar, role para aproximar, segure o botão direito para deslocar.</p>
    </div>
  );
}

function SemAcesso() {
  return (
    <div className="p-8 text-center text-muted-foreground">
      <Box className="mx-auto mb-2 h-8 w-8" />
      <p>Você não tem acesso ao mapa do estoque.</p>
      <p className="text-sm">Peça a liberação em Administração › Acesso por usuário.</p>
    </div>
  );
}

function SemPlanta() {
  return (
    <Card className="flex flex-1 items-center justify-center">
      <CardContent className="max-w-md py-16 text-center text-muted-foreground">
        <Move3d className="mx-auto mb-3 h-8 w-8" />
        <p className="font-medium text-foreground">Este almoxarifado ainda não tem planta desenhada.</p>
        <p className="mt-1 text-sm">
          A planta é criada pela migration do mapa. Se ela já foi aplicada, confira se
          este almoxarifado tem fichas de estoque.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function EditorDoDesenho({
  almoxId, layoutId, modulos, moduloEmEdicao, setModuloEmEdicao,
  caixoteSelecionado, fichasDoCaixote, fichasSemLugar,
}: {
  almoxId: string;
  layoutId: string;
  modulos: ModuloMapa[];
  moduloEmEdicao: string | null;
  setModuloEmEdicao: (id: string | null) => void;
  caixoteSelecionado: CaixoteRef | null;
  fichasDoCaixote: FichaMapa[];
  fichasSemLugar: FichaMapa[];
}) {
  const salvar = useSalvarModulo(almoxId);
  const excluir = useExcluirModulo(almoxId);
  const enderecar = useEnderecarItem(almoxId);
  const m = modulos.find((x) => x.id === moduloEmEdicao) ?? null;

  const [novaLetra, setNovaLetra] = useState("");

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Pencil className="h-4 w-4" /> Editar desenho
      </h3>

      {/* Escolha da estante */}
      <div className="space-y-1.5">
        <Label className="text-xs">Estante</Label>
        <div className="flex flex-wrap gap-1.5">
          {modulos.map((x) => (
            <Button
              key={x.id}
              size="sm"
              variant={x.id === moduloEmEdicao ? "default" : "outline"}
              className="h-7 w-8 p-0 font-mono"
              onClick={() => setModuloEmEdicao(x.id === moduloEmEdicao ? null : x.id)}
            >
              {x.codigo}
            </Button>
          ))}
        </div>
      </div>

      {/* Adicionar estante nova */}
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Nova estante (uma letra)</Label>
          <Input
            className="h-8"
            maxLength={1}
            placeholder="H"
            value={novaLetra}
            onChange={(e) => setNovaLetra(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
          />
        </div>
        <Button
          size="sm"
          disabled={!novaLetra || modulos.some((x) => x.codigo === novaLetra) || salvar.isPending}
          onClick={() => {
            salvar.mutate(
              {
                layout_id: layoutId, codigo: novaLetra,
                nome: `Estante ${novaLetra}`,
                pos_x: 1.6, pos_z: 8.4, rotacao_graus: 0,
                colunas: 8, niveis: 5,
                ordem: 90,
              },
              { onSuccess: () => setNovaLetra("") },
            );
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {m && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-semibold">Estante {m.codigo}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-red-600 hover:text-red-700"
              disabled={excluir.isPending}
              onClick={() => {
                if (!confirm(`Remover a estante ${m.codigo} do desenho? Os endereços dos itens não são apagados.`)) return;
                excluir.mutate(m.id, { onSuccess: () => setModuloEmEdicao(null) });
              }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <CampoNumero label="Colunas" valor={m.colunas} passo={1} min={1} max={40}
              onMudar={(v) => salvar.mutate({ ...m, layout_id: layoutId, colunas: v })} />
            <CampoNumero label="Níveis" valor={m.niveis} passo={1} min={1} max={12}
              onMudar={(v) => salvar.mutate({ ...m, layout_id: layoutId, niveis: v })} />
            <CampoNumero label="Posição X (m)" valor={m.pos_x} passo={0.25}
              onMudar={(v) => salvar.mutate({ ...m, layout_id: layoutId, pos_x: v })} />
            <CampoNumero label="Posição Z (m)" valor={m.pos_z} passo={0.25}
              onMudar={(v) => salvar.mutate({ ...m, layout_id: layoutId, pos_z: v })} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Para onde a frente aponta</Label>
            <div className="flex gap-1.5">
              {[0, 90, 180, 270].map((g) => (
                <Button
                  key={g}
                  size="sm"
                  variant={m.rotacao_graus === g ? "default" : "outline"}
                  className="h-7 flex-1 px-1 text-xs"
                  onClick={() => salvar.mutate({ ...m, layout_id: layoutId, rotacao_graus: g })}
                >
                  {g}°
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Mede {larguraModulo(m).toFixed(2)} m de largura.
            </p>
          </div>
        </div>
      )}

      {/* Endereçar item pelo desenho */}
      {caixoteSelecionado && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-medium">
            Caixote{" "}
            <span className="font-mono">
              {formatarEndereco({
                rua: caixoteSelecionado.rua,
                nivel: caixoteSelecionado.nivel,
                coluna: caixoteSelecionado.coluna,
              })}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Escolha um item sem lugar para guardá-lo aqui. Isso escreve a localização
            na ficha, igual à tela de entrada.
          </p>
          {fichasSemLugar.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma ficha sem lugar. 👏</p>
          ) : (
            <ScrollArea className="max-h-48">
              <div className="space-y-1.5 pr-2">
                {fichasSemLugar.slice(0, 60).map((f) => (
                  <button
                    key={f.item_estoque_id}
                    disabled={enderecar.isPending}
                    onClick={() =>
                      enderecar.mutate({
                        item_estoque_id: f.item_estoque_id,
                        endereco: {
                          rua: caixoteSelecionado.rua,
                          nivel: caixoteSelecionado.nivel,
                          coluna: caixoteSelecionado.coluna,
                        },
                      })
                    }
                    className="w-full rounded border px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-60"
                  >
                    <div className="truncate font-medium">{f.material}</div>
                    <div className="text-muted-foreground">
                      {f.codigo_item ?? "sem código"}
                      {f.localizacao ? ` · hoje: ${f.localizacao}` : " · sem endereço"}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}

          {fichasDoCaixote.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[11px] font-medium text-muted-foreground">Guardado aqui</div>
              {fichasDoCaixote.map((f) => (
                <div key={f.item_estoque_id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{f.material}</span>
                  <Button
                    size="sm" variant="ghost"
                    className="h-6 px-1.5 text-[11px] text-muted-foreground"
                    disabled={enderecar.isPending}
                    onClick={() => enderecar.mutate({ item_estoque_id: f.item_estoque_id, endereco: null })}
                  >
                    tirar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CampoNumero({
  label, valor, passo, min, max, onMudar,
}: {
  label: string;
  valor: number;
  passo: number;
  min?: number;
  max?: number;
  onMudar: (v: number) => void;
}) {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => setTexto(String(valor)), [valor]);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-8"
        type="number"
        step={passo}
        min={min}
        max={max}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => {
          const n = Number(texto);
          if (Number.isFinite(n) && n !== valor) onMudar(n);
          else setTexto(String(valor));
        }}
      />
    </div>
  );
}
