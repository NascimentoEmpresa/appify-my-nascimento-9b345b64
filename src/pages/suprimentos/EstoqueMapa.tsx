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
  Armchair, ArrowDown, ArrowUp, Box, Eye, Loader2, MapPin, Move3d,
  Pencil, Plus, Search, Trash2, TriangleAlert,
} from "lucide-react";
import { MapaCena, pontoDeVistaGeral, pontoDeVistaMesa } from "@/components/suprimentos/mapa3d/MapaCena";
import type { CaixoteRef } from "@/components/suprimentos/mapa3d/Corredores";
import type { Voo } from "@/components/suprimentos/mapa3d/CameraCinematica";
import {
  acharColuna, alturaColuna, centroCaixote, formatarColunaLinha, linhaOculta,
  pontoDeOlhar, posicaoDaProximaColuna, proximoIndice,
  type ColunaMapa, type CorredorMapa,
} from "@/lib/suprimentos/enderecoEstoque";
import {
  useAlmoxarifadosDoMapa, useEnderecarItem, useExcluirColuna, useExcluirCorredor,
  useFichasDoMapa, useLayoutMapa, useOcupacaoDoMapa, useSalvarColunas, useSalvarCorredor,
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
 * já tinha centenas de fichas preenchidas antes desta tela existir. A letra é
 * o CORREDOR, e o caixote é lido como **coluna:linha** — ver o cabeçalho de
 * src/lib/suprimentos/enderecoEstoque.ts.
 */
export default function EstoqueMapa() {
  const [params] = useSearchParams();
  const { data: almoxarifados = [], isLoading: carregandoAlmox } = useAlmoxarifadosDoMapa();

  const [almoxId, setAlmoxId] = useState<string | null>(null);
  useEffect(() => {
    if (!almoxId && almoxarifados.length) setAlmoxId(almoxarifados[0].almoxarifado_id);
  }, [almoxarifados, almoxId]);

  const { data: planta, isLoading: carregandoPlanta } = useLayoutMapa(almoxId);
  const { data: fichas = [], isLoading: carregandoFichas } = useFichasDoMapa(almoxId);
  const layout = planta?.layout ?? null;
  const corredores = planta?.corredores ?? [];
  const marcos = planta?.marcos ?? [];
  const { porCaixote, situacoes, contagem } = useOcupacaoDoMapa(corredores, fichas);

  const { data: podeEditar } = useScreenAccess("sup_estoque_mapa", "alterar");

  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<CaixoteRef | null>(null);
  const [destaque, setDestaque] = useState<CaixoteRef | null>(null);
  const [voo, setVoo] = useState<Voo | null>(null);
  const [modoEditor, setModoEditor] = useState(false);
  const [colunaEmEdicao, setColunaEmEdicao] = useState<string | null>(null);
  const contadorVoo = useRef(0);

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
    const corredor = corredores.find((c) => c.codigo === e.rua);
    const coluna = acharColuna(corredor, e);
    if (!corredor || !coluna) return;

    const ref: CaixoteRef = {
      corredorId: corredor.id, colunaId: coluna.id,
      rua: e.rua, coluna: e.coluna, nivel: e.nivel,
    };
    setDestaque(ref);
    setSelecionado(ref);
    contadorVoo.current += 1;
    setVoo({
      posicao: pontoDeOlhar(coluna, e.nivel),
      alvo: centroCaixote(coluna, e.nivel),
      chave: `ficha-${f.item_estoque_id}-${contadorVoo.current}`,
    });
  }

  function voarPara(pv: { posicao: any; alvo: any }, marca: string) {
    contadorVoo.current += 1;
    setVoo({ ...pv, chave: `${marca}-${contadorVoo.current}` });
  }

  // Entrada por link: ?item=<id> — é o que o botãozinho "ver em 3D" da tela
  // de Estoque & Etiquetas usa.
  const itemDaUrl = params.get("item");
  const jaVoouParaUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!itemDaUrl || !corredores.length || !fichas.length) return;
    if (jaVoouParaUrl.current === itemDaUrl) return;
    const f = fichas.find((x) => x.item_estoque_id === itemDaUrl);
    if (!f) return;
    jaVoouParaUrl.current = itemDaUrl;
    if (f.endereco) irAteAFicha(f);
    else setBusca(f.codigo_item ?? f.material);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemDaUrl, corredores.length, fichas.length]);

  const carregando = carregandoAlmox || carregandoPlanta || carregandoFichas;

  const fichasDoSelecionado = useMemo(() => {
    if (!selecionado) return [];
    return porCaixote.get(`${selecionado.rua}|${selecionado.nivel}|${selecionado.coluna}`)?.fichas ?? [];
  }, [selecionado, porCaixote]);

  return (
    <AcessoGate menu="sup_estoque_mapa" acao="visualizar" fallback={<SemAcesso />}>
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

          <div className="relative min-w-[260px] max-w-md flex-1">
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
              onClick={() => { setModoEditor((v) => !v); setColunaEmEdicao(null); }}
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              {modoEditor ? "Sair da edição" : "Montar prateleira"}
            </Button>
          )}
        </div>

        {carregando ? (
          <Card className="flex flex-1 items-center justify-center">
            <CardContent className="flex items-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Montando o galpão…
            </CardContent>
          </Card>
        ) : planta?.precisaMigration ? (
          <PrecisaMigration />
        ) : !layout ? (
          <SemPlanta />
        ) : (
          <div className="flex min-h-0 flex-1 gap-3">
            <Card className="relative min-w-0 flex-1 overflow-hidden">
              <MapaCena
                layout={layout}
                corredores={corredores}
                marcos={marcos}
                porCaixote={porCaixote}
                destaque={destaque}
                selecionado={selecionado}
                colunaEmEdicao={colunaEmEdicao}
                voo={voo}
                onClicarCaixote={(c) => {
                  setSelecionado(c);
                  if (modoEditor) setColunaEmEdicao(c.colunaId);
                }}
                onClicarVazio={() => { if (!modoEditor) setSelecionado(null); }}
              />
              <LegendaCena contagem={contagem} total={fichas.length} />
            </Card>

            <Card className="flex w-[390px] shrink-0 flex-col">
              <ScrollArea className="flex-1">
                <CardContent className="space-y-4 p-4">
                  {busca.trim().length >= 2 ? (
                    <ResultadosBusca resultados={resultados} situacoes={situacoes} onIr={irAteAFicha} />
                  ) : selecionado ? (
                    <PainelCaixote
                      alvo={selecionado}
                      fichas={fichasDoSelecionado}
                      corredor={corredores.find((c) => c.id === selecionado.corredorId) ?? null}
                    />
                  ) : (
                    <ComoUsar />
                  )}

                  {modoEditor && podeEditar && layout && (
                    <>
                      <Separator />
                      <EditorMinecraft
                        almoxId={almoxId!}
                        layoutId={layout.id}
                        corredores={corredores}
                        colunaEmEdicao={colunaEmEdicao}
                        setColunaEmEdicao={setColunaEmEdicao}
                        caixoteSelecionado={selecionado}
                        fichasDoCaixote={fichasDoSelecionado}
                        fichasSemLugar={fichas.filter((f) => situacoes.get(f.item_estoque_id) !== "no_desenho")}
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
  const fora = total - contagem.no_desenho;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/85 px-3 py-2 text-xs shadow-sm backdrop-blur">
      <div className="font-medium">{contagem.no_desenho} de {total} fichas no desenho</div>
      {fora > 0 && (
        <div className="mt-0.5 flex items-center gap-1 text-amber-600">
          <TriangleAlert className="h-3 w-3" />
          {fora} fora — veja em “Montar prateleira”
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
              {f.endereco && (
                <Badge variant="outline" className="shrink-0 font-mono text-[11px]">
                  {formatarColunaLinha(f.endereco, true)}
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              <span className={f.emFalta ? "font-medium text-red-600" : "text-muted-foreground"}>
                {f.fisico} un. na prateleira
              </span>
              {f.reservado > 0 && <span className="text-muted-foreground">· {f.reservado} reservada(s)</span>}
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
    corredor_ausente: "O corredor dessa letra ainda não existe no desenho.",
    coluna_ausente: "Essa coluna ainda não foi montada no desenho.",
    linha_ausente: "A coluna existe, mas não tem essa linha (ou ela está marcada como vão).",
  };
  return (
    <div className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-600">
      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{texto[situacao]}</span>
    </div>
  );
}

function PainelCaixote({
  alvo, fichas, corredor,
}: {
  alvo: CaixoteRef;
  fichas: FichaMapa[];
  corredor: CorredorMapa | null;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-amber-500" />
          <span className="font-mono text-lg font-semibold">
            {alvo.rua} · {alvo.coluna}:{alvo.nivel}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {corredor?.nome ?? `Corredor ${alvo.rua}`} · coluna {alvo.coluna}, linha {alvo.nivel}
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
      <p>
        O endereço é lido como <b className="font-mono">corredor · coluna:linha</b> —
        <span className="font-mono"> A · 10:3</span> é o corredor A, coluna 10, terceira linha de baixo para cima.
      </p>
      <p>Clique em qualquer vão para ver o que está guardado nele.</p>
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

/**
 * O banco ainda está no formato antigo. Acontece na janela entre aplicar a
 * migration e publicar o frontend — a tela avisa em vez de estourar.
 */
function PrecisaMigration() {
  return (
    <Card className="flex flex-1 items-center justify-center">
      <CardContent className="max-w-md py-16 text-center text-muted-foreground">
        <TriangleAlert className="mx-auto mb-3 h-8 w-8 text-amber-500" />
        <p className="font-medium text-foreground">O banco ainda está na versão anterior da planta.</p>
        <p className="mt-1 text-sm">
          Falta aplicar a migration <span className="font-mono">20260930000200_sup_estoque_mapa_corredor_coluna.sql</span>{" "}
          no SQL Editor. Assim que ela rodar, esta tela volta sozinha.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Editor — montar a prateleira peça por peça
// ---------------------------------------------------------------------------

function EditorMinecraft({
  almoxId, layoutId, corredores, colunaEmEdicao, setColunaEmEdicao,
  caixoteSelecionado, fichasDoCaixote, fichasSemLugar,
}: {
  almoxId: string;
  layoutId: string;
  corredores: CorredorMapa[];
  colunaEmEdicao: string | null;
  setColunaEmEdicao: (id: string | null) => void;
  caixoteSelecionado: CaixoteRef | null;
  fichasDoCaixote: FichaMapa[];
  fichasSemLugar: FichaMapa[];
}) {
  const salvarCorredor = useSalvarCorredor(almoxId);
  const excluirCorredor = useExcluirCorredor(almoxId);
  const salvarColunas = useSalvarColunas(almoxId);
  const excluirColuna = useExcluirColuna(almoxId);
  const enderecar = useEnderecarItem(almoxId);

  const [novaLetra, setNovaLetra] = useState("");
  const [quantas, setQuantas] = useState(1);

  const achado = useMemo(() => {
    for (const c of corredores) {
      const k = c.colunas.find((x) => x.id === colunaEmEdicao);
      if (k) return { corredor: c, coluna: k };
    }
    return null;
  }, [corredores, colunaEmEdicao]);

  const corredorAtivo = achado?.corredor
    ?? corredores.find((c) => c.id === caixoteSelecionado?.corredorId)
    ?? corredores[0]
    ?? null;

  /** "Mais uma coluna pra frente" — encosta na última, mesma medida e rotação. */
  function acrescentarColunas(corredor: CorredorMapa, n: number) {
    const ultima = corredor.colunas[corredor.colunas.length - 1];
    if (!ultima) {
      salvarColunas.mutate([{
        corredor_id: corredor.id, indice: 1,
        pos_x: 1, pos_z: 1, rotacao_graus: 0, linhas: 6,
      }]);
      return;
    }
    const novas: Partial<ColunaMapa>[] = [];
    let base = ultima;
    let indice = proximoIndice(corredor);
    for (let i = 0; i < n; i++) {
      const p = posicaoDaProximaColuna(base);
      const nova: Partial<ColunaMapa> = {
        corredor_id: corredor.id,
        indice: indice++,
        pos_x: p.pos_x,
        pos_z: p.pos_z,
        rotacao_graus: base.rotacao_graus,
        largura_m: base.largura_m,
        profundidade_m: base.profundidade_m,
        altura_linha_m: base.altura_linha_m,
        altura_base_m: base.altura_base_m,
        linhas: base.linhas,
      };
      novas.push(nova);
      base = { ...base, ...nova } as ColunaMapa;
    }
    salvarColunas.mutate(novas);
  }

  /** Sobe ou desce uma linha em TODAS as colunas do corredor de uma vez. */
  function mudarLinhasDoCorredor(corredor: CorredorMapa, delta: number) {
    const alteradas = corredor.colunas
      .map((k) => ({ ...k, linhas: Math.min(20, Math.max(1, k.linhas + delta)) }))
      .filter((k, i) => k.linhas !== corredor.colunas[i].linhas);
    if (!alteradas.length) return;
    salvarColunas.mutate(alteradas);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Pencil className="h-4 w-4" /> Montar prateleira
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Cada peça é uma <b>coluna</b> de caixotes. O endereço de um vão é{" "}
          <span className="font-mono">coluna:linha</span>.
        </p>
      </div>

      {/* Corredor */}
      <div className="space-y-1.5">
        <Label className="text-xs">Corredor</Label>
        <div className="flex flex-wrap gap-1.5">
          {corredores.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={c.id === corredorAtivo?.id ? "default" : "outline"}
              className="h-7 w-8 p-0 font-mono"
              onClick={() => setColunaEmEdicao(c.colunas[0]?.id ?? null)}
            >
              {c.codigo}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Corredor novo (uma letra)</Label>
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
          disabled={!novaLetra || corredores.some((c) => c.codigo === novaLetra) || salvarCorredor.isPending}
          onClick={() =>
            salvarCorredor.mutate(
              { layout_id: layoutId, codigo: novaLetra, nome: `Corredor ${novaLetra}`, ordem: 90 },
              { onSuccess: () => setNovaLetra("") },
            )
          }
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {corredorAtivo && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-semibold">Corredor {corredorAtivo.codigo}</span>
            <span className="text-[11px] text-muted-foreground">
              {corredorAtivo.colunas.length} coluna(s)
            </span>
          </div>

          {/* Acrescentar colunas — o "mais pra frente" do pedido */}
          <div className="space-y-1.5">
            <Label className="text-xs">Acrescentar colunas no fim</Label>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 w-16"
                type="number"
                min={1}
                max={20}
                value={quantas}
                onChange={(e) => setQuantas(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              />
              <Button
                size="sm"
                className="h-8 flex-1"
                disabled={salvarColunas.isPending}
                onClick={() => acrescentarColunas(corredorAtivo, quantas)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {quantas === 1 ? "coluna" : `${quantas} colunas`}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Nascem encostadas na última, com a mesma medida e virada — é como a prateleira cresce de verdade.
            </p>
          </div>

          {/* Linha inteira, em todas as colunas */}
          <div className="space-y-1.5">
            <Label className="text-xs">Linha em todo o corredor</Label>
            <div className="flex gap-1.5">
              <Button
                size="sm" variant="outline" className="h-8 flex-1"
                disabled={salvarColunas.isPending}
                onClick={() => mudarLinhasDoCorredor(corredorAtivo, +1)}
              >
                <ArrowUp className="mr-1 h-3.5 w-3.5" /> Subir uma
              </Button>
              <Button
                size="sm" variant="outline" className="h-8 flex-1"
                disabled={salvarColunas.isPending}
                onClick={() => mudarLinhasDoCorredor(corredorAtivo, -1)}
              >
                <ArrowDown className="mr-1 h-3.5 w-3.5" /> Descer uma
              </Button>
            </div>
          </div>

          <Button
            size="sm" variant="ghost"
            className="h-7 w-full text-red-600 hover:text-red-700"
            disabled={excluirCorredor.isPending}
            onClick={() => {
              if (!confirm(`Remover o corredor ${corredorAtivo.codigo} e as ${corredorAtivo.colunas.length} colunas dele? Os endereços dos itens não são apagados.`)) return;
              excluirCorredor.mutate(corredorAtivo.id, { onSuccess: () => setColunaEmEdicao(null) });
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover corredor
          </Button>
        </div>
      )}

      {/* Coluna selecionada */}
      {achado && (
        <ColunaSelecionada
          coluna={achado.coluna}
          onSalvar={(mudanca) => salvarColunas.mutate([{ ...achado.coluna, ...mudanca }])}
          onExcluir={() => {
            if (!confirm(`Remover a coluna ${achado.coluna.indice} do corredor ${achado.corredor.codigo}?`)) return;
            excluirColuna.mutate(achado.coluna.id, { onSuccess: () => setColunaEmEdicao(null) });
          }}
          salvando={salvarColunas.isPending}
        />
      )}

      {/* Endereçar item pelo desenho */}
      {caixoteSelecionado && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-medium">
            Caixote <span className="font-mono">{caixoteSelecionado.rua} · {caixoteSelecionado.coluna}:{caixoteSelecionado.nivel}</span>
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

function ColunaSelecionada({
  coluna, onSalvar, onExcluir, salvando,
}: {
  coluna: ColunaMapa;
  onSalvar: (m: Partial<ColunaMapa>) => void;
  onExcluir: () => void;
  salvando: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border border-cyan-500/40 bg-cyan-500/5 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">Coluna {coluna.indice}</span>
        <span className="text-[11px] text-muted-foreground">
          {alturaColuna(coluna).toFixed(2)} m de altura
        </span>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Linhas desta coluna</Label>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm" variant="outline" className="h-8 w-8 p-0"
            disabled={salvando || coluna.linhas <= 1}
            onClick={() => onSalvar({ linhas: coluna.linhas - 1 })}
          >
            −
          </Button>
          <span className="w-8 text-center font-mono text-sm">{coluna.linhas}</span>
          <Button
            size="sm" variant="outline" className="h-8 w-8 p-0"
            disabled={salvando || coluna.linhas >= 20}
            onClick={() => onSalvar({ linhas: coluna.linhas + 1 })}
          >
            +
          </Button>
        </div>
      </div>

      {/* Tirar/pôr um caixote do meio sem mexer na numeração */}
      <div className="space-y-1.5">
        <Label className="text-xs">Vãos (clique para tapar/abrir)</Label>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: coluna.linhas }, (_, i) => coluna.linhas - i).map((linha) => {
            const oculta = linhaOculta(coluna, linha);
            return (
              <Button
                key={linha}
                size="sm"
                variant={oculta ? "secondary" : "outline"}
                className={"h-6 w-7 p-0 text-[11px] font-mono " + (oculta ? "opacity-50 line-through" : "")}
                disabled={salvando}
                onClick={() =>
                  onSalvar({
                    linhas_ocultas: oculta
                      ? coluna.linhas_ocultas.filter((l) => l !== linha)
                      : [...coluna.linhas_ocultas, linha],
                  })
                }
              >
                {linha}
              </Button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Riscado = vão que não existe (passagem, quadro de luz, pilar). A numeração das outras linhas não muda.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CampoNumero label="Posição X (m)" valor={coluna.pos_x} passo={0.1}
          onMudar={(v) => onSalvar({ pos_x: v })} />
        <CampoNumero label="Posição Z (m)" valor={coluna.pos_z} passo={0.1}
          onMudar={(v) => onSalvar({ pos_z: v })} />
        <CampoNumero label="Largura (m)" valor={coluna.largura_m} passo={0.02}
          onMudar={(v) => onSalvar({ largura_m: v })} />
        <CampoNumero label="Altura da linha (m)" valor={coluna.altura_linha_m} passo={0.02}
          onMudar={(v) => onSalvar({ altura_linha_m: v })} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Para onde a frente aponta</Label>
        <div className="flex gap-1.5">
          {[0, 90, 180, 270].map((g) => (
            <Button
              key={g}
              size="sm"
              variant={coluna.rotacao_graus === g ? "default" : "outline"}
              className="h-7 flex-1 px-1 text-xs"
              disabled={salvando}
              onClick={() => onSalvar({ rotacao_graus: g })}
            >
              {g}°
            </Button>
          ))}
        </div>
      </div>

      <Button
        size="sm" variant="ghost"
        className="h-7 w-full text-red-600 hover:text-red-700"
        onClick={onExcluir}
      >
        <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover esta coluna
      </Button>
    </div>
  );
}

function CampoNumero({
  label, valor, passo, onMudar,
}: {
  label: string;
  valor: number;
  passo: number;
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
