import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2, Copy, Grid3x3, Hammer, Layers, Layers3, MousePointer2, Move3d, Package,
  Plus, Redo2, RotateCw, Ruler, Tag, Trash2, Undo2, X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { cn } from "@/lib/utils";
import {
  useAtivosTi, useElementosDeVariasTi, useElementosTi, useExcluirAtivo, useExcluirElemento,
  usePlantasTi, usePosicionarAtivo, useRecriarElemento, useSalvarAtivo, useSalvarElemento,
  useSalvarPlanta, useSetoresTi,
  type TiAtivo, type TiAtivoInput, type TiElemento, type TiPlanta,
} from "@/hooks/useTiMapa";
import { AtivoDialog } from "./mapa/AtivoDialog";
import {
  PALETA, STATUS_ATIVO, TIPOS_ELEMENTO, cmParaMetros, statusAtivo, tipoAtivo, tipoElemento,
} from "./mapa/catalogo";
import { alturaDoElemento, retanguloDeCantos, retanguloDoTraco } from "./mapa3d/apoio";
import { Cena3D, type SelecaoCena, type TracoNoChao } from "./mapa3d/Cena3D";
import { useHistoricoMapa, type Aplicador } from "./mapa3d/historico";

/**
 * T.I › Construir o mapa — o editor da planta em 3D.
 *
 * Tela separada do Mapa por causa da permissão: quem só precisa VER onde as
 * pessoas sentam não deve conseguir mover uma parede sem querer. Aqui é o
 * contrário — tudo é editável, e a cena recebe `editavel`.
 *
 * COMO SE CONSTRÓI (o fluxo é sempre o mesmo, para peça e para equipamento):
 *   1. escolhe na coluna da esquerda o que quer colocar;
 *   2. clica no chão, onde quer;
 *   3. ajusta arrastando, e afina os números no inspetor da direita.
 *
 * REMOVER está em TRÊS lugares, de propósito — na primeira versão a única
 * saída era a tecla Delete e ninguém encontrou: botão vermelho no rodapé do
 * inspetor, botão na barra de cima enquanto há algo selecionado, e a tecla
 * Delete para quem já sabe. Nenhum deles apaga direto: todos passam pela
 * confirmação, porque apagar equipamento leva junto o histórico dele.
 */

/** "Térreo", "1º andar", "Subsolo 2" — o número vira o nome que se fala. */
export function nomeDoAndar(nivel: number): string {
  if (nivel === 0) return "Térreo";
  if (nivel > 0) return `${nivel}º andar`;
  return nivel === -1 ? "Subsolo" : `Subsolo ${Math.abs(nivel)}`;
}

type Ferramenta =
  | { tipo: "selecao" }
  | { tipo: "elemento"; valor: string }
  | { tipo: "ativo"; id: string; nome: string };

export default function ConstruirMapa() {
  const [plantaId, setPlantaId] = useState<string | null>(null);
  const [selecao, setSelecao] = useState<SelecaoCena>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>({ tipo: "selecao" });
  const [grade, setGrade] = useState(true);
  const [verTodosAndares, setVerTodosAndares] = useState(false);
  const [rotulos, setRotulos] = useState(true);
  const [plantaDialog, setPlantaDialog] = useState<Partial<TiPlanta> | null>(null);
  const [fichaAberta, setFichaAberta] = useState<TiAtivo | null | undefined>(undefined);
  const [confirmar, setConfirmar] = useState<{ tipo: "ativo" | "elemento"; id: string; nome: string } | null>(null);

  const { data: plantas = [], isLoading } = usePlantasTi();
  const { data: ativos = [] } = useAtivosTi();

  const planta = useMemo(
    () => plantas.find((p) => p.id === plantaId) ?? plantas[0] ?? null,
    [plantas, plantaId],
  );
  const { data: elementos = [] } = useElementosTi(planta?.id);

  const salvarElemento = useSalvarElemento();
  const excluirElemento = useExcluirElemento();
  const posicionar = usePosicionarAtivo();
  const salvarAtivo = useSalvarAtivo();
  const excluirAtivo = useExcluirAtivo();
  const salvarPlanta = useSalvarPlanta();
  const recriarElemento = useRecriarElemento();
  const { data: setores = [] } = useSetoresTi();

  // Os outros andares, só quando pedidos — a query nem sai enquanto o modo
  // está desligado.
  const idsVizinhos = useMemo(
    () => (verTodosAndares ? plantas.filter((p) => p.id !== planta?.id).map((p) => p.id) : []),
    [verTodosAndares, plantas, planta?.id],
  );
  const { data: elementosVizinhos = [] } = useElementosDeVariasTi(idsVizinhos);
  const andaresVizinhos = useMemo(
    () =>
      plantas
        .filter((p) => idsVizinhos.includes(p.id))
        .map((p) => ({
          planta: p,
          elementos: elementosVizinhos.filter((e) => e.planta_id === p.id),
          ativos: ativos.filter((a) => a.planta_id === p.id),
        })),
    [plantas, idsVizinhos, elementosVizinhos, ativos],
  );

  const { data: podeGerenciarAtivo = false } = useScreenAccess("ti_ativo_gerenciar", "alterar");
  const { data: podeIncluirAtivo = false } = useScreenAccess("ti_ativo_gerenciar", "incluir");
  const { data: podeExcluirAtivo = false } = useScreenAccess("ti_ativo_gerenciar", "excluir");
  const { data: podeExcluirElemento = false } = useScreenAccess("ti_construir", "excluir");

  const elementoSel = useMemo(
    () => (selecao?.tipo === "elemento" ? elementos.find((e) => e.id === selecao.id) ?? null : null),
    [selecao, elementos],
  );
  const ativoSel = useMemo(
    () => (selecao?.tipo === "ativo" ? ativos.find((a) => a.id === selecao.id) ?? null : null),
    [selecao, ativos],
  );

  const bandeja = useMemo(
    () => ativos.filter((a) => a.status !== "descartado" && (!a.planta_id || a.pos_x == null)),
    [ativos],
  );

  /**
   * O que o Ctrl+Z executa. Estas mutations NÃO registram no histórico — se
   * registrassem, desfazer empilharia uma ação nova e o segundo Ctrl+Z
   * refaria o que o primeiro acabou de desfazer.
   */
  const aplicador: Aplicador = {
    criarElemento: (el) => recriarElemento.mutate(el),
    atualizarElemento: (el) => salvarElemento.mutate(el),
    removerElemento: (id) => {
      if (planta) excluirElemento.mutate({ id, plantaId: planta.id });
    },
    atualizarAtivo: (a) => salvarAtivo.mutate({ ...(a as TiAtivoInput), id: a.id }),
  };
  const historico = useHistoricoMapa(aplicador);

  /** Cria a peça e guarda no histórico o que foi criado. */
  const criarElemento = (novo: Partial<TiElemento> & { planta_id: string; tipo: string }) =>
    salvarElemento.mutate(novo, {
      onSuccess: (el) => historico.registrar({ tipo: "criar_elemento", depois: el }),
    });

  /** Altera a peça guardando o ANTES — é o que o Ctrl+Z restaura. */
  const alterarElemento = (antes: TiElemento, patch: Partial<TiElemento>) => {
    const depois = { ...antes, ...patch } as TiElemento;
    salvarElemento.mutate(depois, {
      onSuccess: () => historico.registrar({ tipo: "atualizar_elemento", antes, depois }),
    });
  };

  /** Move/altera equipamento guardando o antes. */
  const alterarAtivo = (antes: TiAtivo, patch: Partial<TiAtivo>) => {
    const depois = { ...antes, ...patch } as TiAtivo;
    salvarAtivo.mutate(
      { ...(depois as TiAtivoInput), id: antes.id },
      { onSuccess: () => historico.registrar({ tipo: "atualizar_ativo", antes, depois }) },
    );
  };

  const nomeSelecionado = elementoSel
    ? elementoSel.rotulo || tipoElemento(elementoSel.tipo).label
    : ativoSel?.nome ?? "";

  const pedirRemocao = useCallback(() => {
    if (elementoSel && podeExcluirElemento) {
      setConfirmar({ tipo: "elemento", id: elementoSel.id, nome: nomeSelecionado });
    } else if (ativoSel && podeExcluirAtivo) {
      setConfirmar({ tipo: "ativo", id: ativoSel.id, nome: ativoSel.nome });
    }
  }, [elementoSel, ativoSel, podeExcluirElemento, podeExcluirAtivo, nomeSelecionado]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo && (["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName) || alvo.isContentEditable)) return;

      // Desfazer/refazer. Ctrl+Y e Ctrl+Shift+Z são a mesma coisa — o segundo
      // é o que a mão de quem usa editor gráfico procura primeiro.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        historico.desfazer();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        historico.refazer();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;

      if (e.key === "Escape") { setFerramenta({ tipo: "selecao" }); setSelecao(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && selecao) { e.preventDefault(); pedirRemocao(); }
      if (e.key.toLowerCase() === "r" && selecao) girar(45);
      if (e.key.toLowerCase() === "d" && elementoSel) duplicar();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecao, pedirRemocao, elementoSel, ativoSel, historico]);

  const girar = (passo: number) => {
    if (elementoSel) {
      alterarElemento(elementoSel, { rotacao: (Number(elementoSel.rotacao) + passo) % 360 });
    } else if (ativoSel && podeGerenciarAtivo) {
      alterarAtivo(ativoSel, { rotacao: (Number(ativoSel.rotacao) + passo) % 360 });
    }
  };

  /**
   * O traço no chão vira peça.
   *
   * Parede, divisória e janela nascem do ARRASTO: comprimento e ângulo saem
   * do traço, como se desenha numa planta. Clicar e digitar o comprimento num
   * campo — o que esta tela fazia antes — é o caminho mais lento possível
   * para desenhar uma sala.
   *
   * Ambiente (sala, copa) usa os dois cantos como retângulo. Mobília aceita os
   * dois jeitos: clique seco põe no tamanho de catálogo, arrasto dimensiona.
   *
   * A ferramenta CONTINUA ativa depois de criar — quem está levantando as
   * paredes de uma sala desenha quatro seguidas; voltar para o cursor a cada
   * peça obrigava a reescolher a mesma ferramenta o tempo todo. Esc larga.
   */
  const desenharNoChao = (t: TracoNoChao) => {
    if (!planta) return;

    if (ferramenta.tipo === "ativo") {
      posicionar.mutate({ id: ferramenta.id, planta_id: planta.id, pos_x: t.x2, pos_y: t.y2 });
      setFerramenta({ tipo: "selecao" });
      return;
    }
    if (ferramenta.tipo !== "elemento") return;

    const def = tipoElemento(ferramenta.valor);
    const arrastou = Math.hypot(t.x2 - t.x1, t.y2 - t.y1) > 30;

    if (!arrastou) {
      // Clique seco: peça no tamanho de catálogo, centrada no ponto.
      criarElemento({
        planta_id: planta.id,
        tipo: ferramenta.valor,
        x: Math.round(t.x1 - def.largura / 2),
        y: Math.round(t.y1 - def.altura / 2),
        largura: def.largura,
        altura: def.altura,
        altura_z: def.alturaZ,
      });
      return;
    }

    if (def.familia === "estrutura") {
      const r = retanguloDoTraco(t.x1, t.y1, t.x2, t.y2, def.altura);
      criarElemento({
        planta_id: planta.id,
        tipo: ferramenta.valor,
        x: r.x,
        y: r.y,
        largura: Math.max(10, r.largura),
        altura: r.profundidade,
        rotacao: r.rotacao,
        altura_z: def.alturaZ,
      });
      return;
    }

    const r = retanguloDeCantos(t.x1, t.y1, t.x2, t.y2);
    criarElemento({
      planta_id: planta.id,
      tipo: ferramenta.valor,
      x: r.x,
      y: r.y,
      largura: Math.max(10, r.largura),
      altura: Math.max(10, r.profundidade),
      altura_z: def.alturaZ,
    });
  };

  /** Copia a peça selecionada 50 cm ao lado — o jeito rápido de fazer fileira de mesas. */
  const duplicar = () => {
    if (!planta || !elementoSel) return;
    const { id, ...resto } = elementoSel;
    criarElemento({ ...resto, planta_id: planta.id, x: Number(elementoSel.x) + 50, y: Number(elementoSel.y) + 50 });
  };

  const confirmarRemocao = () => {
    if (!confirmar) return;
    if (confirmar.tipo === "ativo") {
      // Equipamento removido NÃO entra no Ctrl+Z: o DELETE leva o histórico
      // dele junto (CASCADE) e recriar a linha não traz os eventos de volta.
      // Prometer um desfazer que restaura pela metade é pior do que não ter.
      excluirAtivo.mutate(confirmar.id);
    } else if (planta) {
      const antes = elementos.find((e) => e.id === confirmar.id);
      excluirElemento.mutate(
        { id: confirmar.id, plantaId: planta.id },
        { onSuccess: () => antes && historico.registrar({ tipo: "remover_elemento", antes }) },
      );
    }
    setSelecao(null);
    setConfirmar(null);
  };

  const podeRemoverAgora = (elementoSel && podeExcluirElemento) || (ativoSel && podeExcluirAtivo);

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Construir o mapa"
        module="T.I"
        breadcrumb={["Construir o mapa"]}
        subtitle="Monte o escritório: escolha uma peça à esquerda, clique no chão para colocar e arraste para ajustar."
        actions={
          <>
            {podeIncluirAtivo && (
              <Button variant="outline" onClick={() => setFichaAberta(null)}>
                <Plus className="mr-1.5 h-4 w-4" /> Novo equipamento
              </Button>
            )}
            <Button onClick={() => setPlantaDialog(planta ?? { nome: "", largura_cm: 2400, altura_cm: 1600 })}>
              <Ruler className="mr-1.5 h-4 w-4" /> {planta ? "Medidas da planta" : "Criar planta"}
            </Button>
          </>
        }
      />

      {isLoading && (
        <Card className="flex h-[72vh] items-center justify-center text-sm text-muted-foreground">Carregando…</Card>
      )}

      {!isLoading && !planta && (
        <Card className="flex h-[72vh] flex-col items-center justify-center gap-3 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">Comece criando a planta</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Meça o escritório (largura e profundidade, em metros) e crie a planta. Depois é
            só colocar paredes, mesas e equipamentos em cima dela.
          </p>
          <Button onClick={() => setPlantaDialog({ nome: "", largura_cm: 2400, altura_cm: 1600 })}>
            <Plus className="mr-1.5 h-4 w-4" /> Criar planta
          </Button>
        </Card>
      )}

      {!isLoading && planta && (
        <div className="space-y-3">
          {/* ---- barra ---- */}
          <Card className="flex flex-wrap items-center gap-2 p-2">
            {plantas.length > 1 && (
              <Select value={planta.id} onValueChange={(v) => { setPlantaId(v); setSelecao(null); }}>
                <SelectTrigger className="w-[200px]">
                  <Building2 className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plantas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {nomeDoAndar(p.nivel)} · {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {cmParaMetros(planta.largura_cm)} × {cmParaMetros(planta.altura_cm)}
            </span>

            {plantas.length > 1 && (
              <Button
                variant={verTodosAndares ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setVerTodosAndares(!verTodosAndares)}
                title="Mostrar os outros andares como referência"
              >
                <Layers3 className="mr-1.5 h-4 w-4" /> Todos os andares
              </Button>
            )}

            <Separator orientation="vertical" className="h-6" />

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!historico.podeDesfazer}
              onClick={historico.desfazer}
              title={historico.podeDesfazer ? `Desfazer ${historico.proximoDesfazer} (Ctrl+Z)` : "Nada para desfazer"}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!historico.podeRefazer}
              onClick={historico.refazer}
              title={historico.podeRefazer ? `Refazer ${historico.proximoRefazer} (Ctrl+Y)` : "Nada para refazer"}
            >
              <Redo2 className="h-4 w-4" />
            </Button>

            <Separator orientation="vertical" className="h-6" />

            <Button
              variant={ferramenta.tipo === "selecao" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFerramenta({ tipo: "selecao" })}
            >
              <MousePointer2 className="mr-1.5 h-4 w-4" /> Selecionar
            </Button>
            <Button variant={grade ? "secondary" : "ghost"} size="icon" className="h-8 w-8"
                    title="Grade de 25 cm" onClick={() => setGrade(!grade)}>
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button variant={rotulos ? "secondary" : "ghost"} size="icon" className="h-8 w-8"
                    title="Nomes dos equipamentos" onClick={() => setRotulos(!rotulos)}>
              <Tag className="h-4 w-4" />
            </Button>

            {selecao && (
              <>
                <Separator orientation="vertical" className="h-6" />
                <Badge variant="secondary" className="max-w-[180px] truncate">{nomeSelecionado}</Badge>
                <Button variant="outline" size="sm" onClick={() => girar(45)}>
                  <RotateCw className="mr-1.5 h-4 w-4" /> Girar
                </Button>
                {elementoSel && (
                  <Button variant="outline" size="sm" onClick={duplicar}>
                    <Copy className="mr-1.5 h-4 w-4" /> Duplicar
                  </Button>
                )}
                {/* Remover, lugar 1 de 3: sempre visível enquanto há seleção. */}
                {podeRemoverAgora && (
                  <Button variant="destructive" size="sm" onClick={pedirRemocao}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> Remover
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelecao(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}

            {ferramenta.tipo !== "selecao" && (
              <span className="ml-auto flex items-center gap-2 rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white">
                <Move3d className="h-3.5 w-3.5" />
                {ferramenta.tipo === "elemento" && tipoElemento(ferramenta.valor).familia === "estrutura"
                  ? "Arraste no chão para desenhar"
                  : "Clique no chão para colocar"}
                {ferramenta.tipo === "ativo" ? ` “${ferramenta.nome}”` : ` ${tipoElemento(ferramenta.valor).label}`}
                <button type="button" onClick={() => setFerramenta({ tipo: "selecao" })} className="ml-1 opacity-80 hover:opacity-100">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </Card>

          <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
            {/* ---- paleta ---- */}
            <div className="flex h-[72vh] min-h-[520px] flex-col gap-3">
              <Card className="flex min-h-0 flex-[3] flex-col">
                <p className="flex items-center gap-1.5 border-b p-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Hammer className="h-3.5 w-3.5" /> Peças
                </p>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-3 p-2.5">
                    {(["estrutura", "area", "mobilia"] as const).map((fam) => (
                      <div key={fam}>
                        <p className="mb-1.5 text-[11px] font-medium capitalize text-muted-foreground">
                          {fam === "estrutura" ? "Estrutura" : fam === "area" ? "Ambientes" : "Mobília"}
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {TIPOS_ELEMENTO.filter((t) => t.familia === fam || (fam === "mobilia" && t.familia === "texto")).map((t) => {
                            const Icone = t.icone;
                            const ativa = ferramenta.tipo === "elemento" && ferramenta.valor === t.valor;
                            return (
                              <button
                                key={t.valor}
                                type="button"
                                onClick={() => setFerramenta(ativa ? { tipo: "selecao" } : { tipo: "elemento", valor: t.valor })}
                                className={cn(
                                  "flex flex-col items-center gap-1 rounded-md border p-2 text-[11px] font-medium transition",
                                  ativa ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/40 hover:bg-muted",
                                )}
                              >
                                <span className="flex h-6 w-6 items-center justify-center rounded text-white" style={{ background: t.cor }}>
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

              <Card className="flex min-h-0 flex-[2] flex-col">
                <p className="flex items-center gap-1.5 border-b p-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Package className="h-3.5 w-3.5" /> Fora do mapa
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
                      const ativa = ferramenta.tipo === "ativo" && ferramenta.id === a.id;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setFerramenta(ativa ? { tipo: "selecao" } : { tipo: "ativo", id: a.id, nome: a.nome })}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md border p-1.5 text-left text-xs transition",
                            ativa ? "border-primary bg-primary/10" : "hover:bg-muted",
                          )}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-white"
                                style={{ background: a.cor || def.cor }}>
                            <Icone className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{a.nome}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">{a.codigo}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </Card>
            </div>

            {/* ---- cena ---- */}
            <div className="h-[72vh] min-h-[520px] overflow-hidden rounded-xl border">
              <Cena3D
                planta={planta}
                elementos={elementos}
                ativos={ativos}
                selecao={selecao}
                onSelecionar={(s) => { if (ferramenta.tipo === "selecao") setSelecao(s); }}
                editavel
                mostrarGrade={grade}
                mostrarRotulos={rotulos}
                desenhando={ferramenta.tipo !== "selecao"}
                onDesenharNoChao={desenharNoChao}
                plantas={plantas}
                andaresVizinhos={andaresVizinhos}
                onSoltarElemento={(id, x, y) => {
                  const el = elementos.find((e) => e.id === id);
                  if (!el) return;
                  // Uma gravação por arrasto, no soltar. O arrasto entrega o
                  // CENTRO; o banco guarda o canto.
                  alterarElemento(el, { x: x - Number(el.largura) / 2, y: y - Number(el.altura) / 2 });
                }}
                onSoltarAtivo={(id, x, y) => {
                  const a = ativos.find((z) => z.id === id);
                  if (a) alterarAtivo(a, { planta_id: planta.id, pos_x: x, pos_y: y });
                }}
                onRedimensionar={(id, patch) => {
                  const el = elementos.find((e) => e.id === id);
                  if (el) alterarElemento(el, patch);
                }}
                onAbrirFicha={(id) => {
                  const a = ativos.find((z) => z.id === id);
                  if (a) setFichaAberta(a);
                }}
              />
            </div>

            {/* ---- inspetor ---- */}
            <Card className="flex h-[72vh] min-h-[520px] flex-col">
              {!elementoSel && !ativoSel ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                  <Layers className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm font-medium">Nada selecionado</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Clique numa peça da cena para ajustar tamanho, altura, giro e cor —
                    ou para removê-la.
                  </p>
                  <Separator className="my-2" />
                  <ul className="space-y-1 text-left text-[11px] text-muted-foreground">
                    <li><b>Arraste no chão</b> com Parede na mão para desenhar</li>
                    <li><b>Arrastar</b> a peça move no chão</li>
                    <li><b>Alt</b> enquanto arrasta ignora a grade</li>
                    <li><b>Puxe as bolinhas laranja</b> para esticar a peça</li>
                    <li><b>R</b> gira 45°, <b>D</b> duplica, <b>Delete</b> remove</li>
                    <li><b>Ctrl+Z</b> desfaz, <b>Ctrl+Y</b> refaz</li>
                    <li><b>Duplo clique</b> num equipamento abre a ficha</li>
                  </ul>
                </div>
              ) : (
                <>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-4 p-3">
                      {elementoSel && (
                        <InspetorElemento
                          el={elementoSel}
                          setores={setores}
                          onAlterar={(patch) => alterarElemento(elementoSel, patch)}
                        />
                      )}
                      {ativoSel && (
                        <InspetorAtivo
                          ativo={ativoSel}
                          podeEditar={podeGerenciarAtivo}
                          onPosicao={(patch) => alterarAtivo(ativoSel, patch)}
                          onCampo={(patch) => alterarAtivo(ativoSel, patch)}
                          onAbrirFicha={() => setFichaAberta(ativoSel)}
                          onTirarDoMapa={() => {
                            posicionar.mutate({ id: ativoSel.id, planta_id: null, pos_x: null, pos_y: null });
                            setSelecao(null);
                          }}
                        />
                      )}
                    </div>
                  </ScrollArea>

                  {/* Remover, lugar 2 de 3: rodapé fixo do inspetor. */}
                  {podeRemoverAgora && (
                    <div className="border-t p-3">
                      <Button variant="destructive" className="w-full" onClick={pedirRemocao}>
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Remover {elementoSel ? "esta peça" : "este equipamento"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        </div>
      )}

      <AtivoDialog
        aberto={fichaAberta !== undefined}
        onFechar={() => setFichaAberta(undefined)}
        ativo={fichaAberta ?? null}
        plantas={plantas}
        ativos={ativos}
        podeEditar={fichaAberta ? podeGerenciarAtivo : podeIncluirAtivo}
        podeExcluir={podeExcluirAtivo}
        salvando={salvarAtivo.isPending}
        onSalvar={(dados) => salvarAtivo.mutate(dados, { onSuccess: () => setFichaAberta(undefined) })}
        onExcluir={(id) => {
          const a = ativos.find((x) => x.id === id);
          setConfirmar({ tipo: "ativo", id, nome: a?.nome ?? "equipamento" });
          setFichaAberta(undefined);
        }}
      />

      <PlantaDialog
        valor={plantaDialog}
        onFechar={() => setPlantaDialog(null)}
        salvando={salvarPlanta.isPending}
        onSalvar={(p) => salvarPlanta.mutate(p, { onSuccess: (id) => { setPlantaId(id); setPlantaDialog(null); } })}
      />

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover “{confirmar?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar?.tipo === "ativo"
                ? "O equipamento sai do inventário junto com o histórico dele. Se a máquina só saiu de uso, o certo é mudar o status para Descartado — aí ela some do mapa e o histórico fica."
                : "A peça some da planta. Os equipamentos que estavam sobre ela continuam onde estão, apoiados no chão."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarRemocao} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Inspetores ────────────────────────────────────────────────────────

function InspetorElemento({
  el,
  setores,
  onAlterar,
}: {
  el: TiElemento;
  setores: string[];
  onAlterar: (patch: Partial<TiElemento>) => void;
}) {
  const def = tipoElemento(el.tipo);
  const [rotulo, setRotulo] = useState(el.rotulo ?? "");
  useEffect(() => setRotulo(el.rotulo ?? ""), [el.id, el.rotulo]);

  return (
    <>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Peça da planta</p>
        <p className="text-base font-semibold">{def.label}</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Nome (aparece no mapa)</Label>
        <Input
          value={rotulo}
          onChange={(e) => setRotulo(e.target.value)}
          onBlur={() => rotulo !== (el.rotulo ?? "") && onAlterar({ rotulo: rotulo || null })}
          placeholder="Sala do Financeiro"
        />
      </div>

      {/* Setor só faz sentido em área de piso: parede não pertence a um setor.
          A lista vem de EMPREGADOS (fonte única de setor deste ERP), mas o
          campo aceita texto livre — sala de setor que ainda não tem gente
          alocada existe, e travar no combo impediria de nomeá-la. */}
      {def.familia === "area" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Setor desta sala</Label>
          <Input
            list="ti-setores"
            defaultValue={el.setor ?? ""}
            placeholder="Financeiro, RH, Comercial…"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (el.setor ?? "")) onAlterar({ setor: v || null });
            }}
          />
          <datalist id="ti-setores">
            {setores.map((x) => <option key={x} value={x} />)}
          </datalist>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Numero label="Largura (cm)" valor={Number(el.largura)} onChange={(v) => onAlterar({ largura: Math.max(5, v) })} />
        <Numero label="Profundidade (cm)" valor={Number(el.altura)} onChange={(v) => onAlterar({ altura: Math.max(5, v) })} />
        <Numero label="Altura (cm)" valor={alturaDoElemento(el)} onChange={(v) => onAlterar({ altura_z: Math.max(1, v) })} />
        <Numero label="Giro (graus)" valor={Number(el.rotacao)} passo={15} onChange={(v) => onAlterar({ rotacao: v })} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Numero label="X (cm)" valor={Number(el.x)} onChange={(v) => onAlterar({ x: v })} />
        <Numero label="Y (cm)" valor={Number(el.y)} onChange={(v) => onAlterar({ y: v })} />
      </div>

      <Cores valor={el.cor ?? def.cor} onEscolher={(cor) => onAlterar({ cor })} />

      <p className="text-[11px] text-muted-foreground">
        Ocupa {cmParaMetros(Number(el.largura))} × {cmParaMetros(Number(el.altura))} e tem{" "}
        {cmParaMetros(alturaDoElemento(el))} de altura.
      </p>
    </>
  );
}

function InspetorAtivo({
  ativo,
  podeEditar,
  onPosicao,
  onCampo,
  onAbrirFicha,
  onTirarDoMapa,
}: {
  ativo: TiAtivo;
  podeEditar: boolean;
  onPosicao: (patch: { pos_z?: number | null; rotacao?: number }) => void;
  onCampo: (patch: Partial<TiAtivoInput>) => void;
  onAbrirFicha: () => void;
  onTirarDoMapa: () => void;
}) {
  const def = tipoAtivo(ativo.tipo);
  const Icone = def.icone;
  return (
    <>
      <div className="flex items-start gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: ativo.cor || def.cor }}>
          <Icone className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-tight">{ativo.nome}</p>
          <p className="truncate text-xs text-muted-foreground">{ativo.codigo} · {def.label}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={ativo.status} disabled={!podeEditar} onValueChange={(v) => onCampo({ status: v as TiAtivo["status"] })}>
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

      <div className="grid grid-cols-2 gap-2">
        <Numero label="Giro (graus)" valor={Number(ativo.rotacao)} passo={15} onChange={(v) => onPosicao({ rotacao: v })} />
        <Numero label="Tamanho" valor={Number(ativo.escala)} passo={0.1} onChange={(v) => onCampo({ escala: Math.min(3, Math.max(0.4, v)) })} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Altura de apoio</Label>
        <div className="flex gap-2">
          <Input
            type="number"
            className="h-8"
            placeholder="automática"
            value={ativo.pos_z ?? ""}
            onChange={(e) => onPosicao({ pos_z: e.target.value === "" ? null : Number(e.target.value) })}
          />
          <Button variant="outline" size="sm" onClick={() => onPosicao({ pos_z: null })}>Auto</Button>
        </div>
        <p className="text-[11px] leading-tight text-muted-foreground">
          Em automático, o equipamento pousa sozinho sobre a mesa ou o armário embaixo dele.
        </p>
      </div>

      <Cores valor={ativo.cor ?? def.cor} onEscolher={(cor) => onCampo({ cor })} />

      <div className="flex flex-col gap-1.5">
        <Button variant="secondary" size="sm" onClick={onAbrirFicha}>Abrir ficha completa</Button>
        <Button variant="outline" size="sm" onClick={onTirarDoMapa}>Tirar do mapa (volta para a bandeja)</Button>
      </div>
    </>
  );
}

function Numero({
  label, valor, onChange, passo = 5,
}: { label: string; valor: number; onChange: (v: number) => void; passo?: number }) {
  const [txt, setTxt] = useState(String(valor));
  useEffect(() => setTxt(String(valor)), [valor]);
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number" step={passo} className="h-8" value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => {
          const n = Number(txt);
          if (Number.isFinite(n) && n !== valor) onChange(n);
          else setTxt(String(valor));
        }}
      />
    </div>
  );
}

function Cores({ valor, onEscolher }: { valor: string; onEscolher: (c: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Cor</Label>
      <div className="flex flex-wrap gap-1">
        {PALETA.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onEscolher(c)}
            className={cn("h-5 w-5 rounded border transition", valor?.toLowerCase() === c ? "ring-2 ring-primary ring-offset-1" : "hover:scale-110")}
            style={{ background: c }}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}

function PlantaDialog({
  valor, onFechar, onSalvar, salvando,
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
          <DialogTitle>{valor?.id ? "Medidas da planta" : "Nova planta"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nome</Label>
            <Input value={form.nome ?? ""} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                   placeholder="Escritório — 2º andar" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Descrição</Label>
            <Textarea rows={2} value={form.descricao ?? ""} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} />
          </div>
          {/* Em METROS, não em centímetros: quem mede escritório fala "24 por
              16". O campo pedia cm e alguém digitou 260 querendo 26 m — a
              planta virou uma sala de 2,6 m. A conversão fica aqui, na borda. */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Largura (m)</Label>
              <Input
                type="number" step="0.5" min="1"
                value={((form.largura_cm ?? 2400) / 100).toString()}
                onChange={(e) => setForm((f) => ({ ...f, largura_cm: Math.round(Number(e.target.value) * 100) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Profundidade (m)</Label>
              <Input
                type="number" step="0.5" min="1"
                value={((form.altura_cm ?? 1600) / 100).toString()}
                onChange={(e) => setForm((f) => ({ ...f, altura_cm: Math.round(Number(e.target.value) * 100) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Pé-direito (m)</Label>
              <Input
                type="number" step="0.1" min="1"
                value={((form.pe_direito_cm ?? 280) / 100).toString()}
                onChange={(e) => setForm((f) => ({ ...f, pe_direito_cm: Math.round(Number(e.target.value) * 100) }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Andar</Label>
            <Select
              value={String(form.nivel ?? 0)}
              onValueChange={(v) => setForm((f) => ({ ...f, nivel: Number(v) }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[-2, -1, 0, 1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>{nomeDoAndar(n)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-tight text-muted-foreground">
              É por aqui que a cena empilha os andares: o 1º fica na altura do pé-direito do térreo.
              Cada andar é uma planta — não dá para dois ocuparem o mesmo nível.
            </p>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {cmParaMetros(Number(form.largura_cm ?? 2400))} × {cmParaMetros(Number(form.altura_cm ?? 1600))} de piso,
            com {cmParaMetros(Number(form.pe_direito_cm ?? 280))} de altura.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button disabled={!form.nome?.trim() || salvando} onClick={() => onSalvar({ ...form, nome: form.nome!.trim() })}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
