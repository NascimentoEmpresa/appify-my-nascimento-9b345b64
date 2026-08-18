import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useContratosCatalogo } from "@/hooks/useSupCatalogo";
import { ModalManutencao } from "@/components/suprimentos/ModalManutencao";
import {
  useBens, useSalvarBem, useExcluirBem, usePostosDoContrato, useFotosDosBens,
  LABEL_CATEGORIA, SEM_CONTRATO, rotuloIndisponivel, type Bem, type Categoria,
} from "@/hooks/useSupPatrimonio";
import {
  Search, Plus, Car, Wrench, ChevronDown, ChevronRight, Pencil, Trash2,
  MapPin, FileText, ShieldAlert, Boxes, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Patrimônio — frota e maquinário, em cascata Contrato → Posto → Item.
 *
 * Espelha a tela principal do legado (REPLICAR-MODULO-COMPRAS.md §9.3), com
 * dois grupos grandes (Veículos e Máquinas/Equipamentos).
 *
 * Bem sem contrato — a frota da sede — cai num grupo "Administrativo / Sede",
 * agrupado pela lotação. Não existe licitação por trás dele, e forçar um
 * contrato de mentira só sujaria a tabela que Licitações alimenta.
 */

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Nó da árvore: contrato → posto → bens. */
interface NoPosto { chave: string; nome: string; bens: Bem[] }
interface NoContrato { chave: string; nome: string; postos: NoPosto[] }

export default function Patrimonio() {
  const { data: empresaId } = useEmpresaId();
  const { data: bens = [], isLoading, error } = useBens(empresaId ?? null);
  // Bucket privado: as fotos da grade são assinadas em UMA chamada, não uma
  // por card. Mapa caminho → URL temporária.
  const { data: fotos = {} } = useFotosDosBens(bens);
  const [busca, setBusca] = useState("");
  const [modoEdicao, setModoEdicao] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<Partial<Bem> | null>(null);
  const [manutencaoDe, setManutencaoDe] = useState<Bem | null>(null);

  const termo = busca.trim();

  /** Monta a árvore por categoria. */
  const arvore = useMemo(() => {
    const porCategoria: Record<Categoria, NoContrato[]> = { veiculo: [], equipamento: [] };
    for (const cat of ["veiculo", "equipamento"] as Categoria[]) {
      const doTipo = bens.filter((b) => b.categoria === cat);
      const mapa = new Map<string, NoContrato>();
      for (const b of doTipo) {
        const cChave = b.contrato?.id ?? SEM_CONTRATO;
        const cNome = b.contrato?.nome ?? "Administrativo / Sede";
        if (!mapa.has(cChave)) mapa.set(cChave, { chave: cChave, nome: cNome, postos: [] });
        const c = mapa.get(cChave)!;

        // Sem contrato o agrupamento é pela lotação, que é o que identifica
        // onde o bem fica quando não há posto de contrato.
        const pNome = b.contrato ? (b.posto?.nome ?? "Sem posto") : (b.lotacao || "Sem lotação");
        let p = c.postos.find((x) => x.nome === pNome);
        if (!p) { p = { chave: `${cChave}|${pNome}`, nome: pNome, bens: [] }; c.postos.push(p); }
        p.bens.push(b);
      }
      porCategoria[cat] = [...mapa.values()]
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        .map((c) => ({ ...c, postos: c.postos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) }));
    }
    return porCategoria;
  }, [bens]);

  /** Um bem casa com a busca por qualquer coisa visível nele. */
  const casaBem = (b: Bem) =>
    !termo || norm([b.nome, b.identificador, b.descricao, b.lotacao,
      b.contrato?.nome, b.posto?.nome].filter(Boolean).join(" ")).includes(norm(termo));

  /**
   * Busca com expansão automática (§9.3) — o comportamento mais interessante
   * da tela. Cada nível responde "eu contenho o termo, no meu nome ou no de
   * algum descendente?" e, se sim, renderiza ABERTO, ignorando o estado
   * manual. Resolve a árvore com busca: o usuário digita e vê o resultado,
   * sem adivinhar em qual galho procurar.
   */
  const contemTermo = (nome: string) => !!termo && norm(nome).includes(norm(termo));
  const postoVisivel = (p: NoPosto, cNome: string) =>
    !termo || contemTermo(cNome) || contemTermo(p.nome) || p.bens.some(casaBem);
  const contratoVisivel = (c: NoContrato) =>
    !termo || contemTermo(c.nome) || c.postos.some((p) => postoVisivel(p, c.nome));
  const estaAberto = (chave: string) => (termo ? true : !!abertos[chave]);
  const alternar = (chave: string) => setAbertos((s) => ({ ...s, [chave]: !s[chave] }));

  /** Bens de um posto, já filtrados: se o nome do galho casa, mostra todos. */
  const bensDoPosto = (p: NoPosto, cNome: string) =>
    !termo || contemTermo(cNome) || contemTermo(p.nome) ? p.bens : p.bens.filter(casaBem);

  // `em_manutencao` significa INDISPONÍVEL; o motivo separa os dois grupos.
  // Registro antigo veio sem motivo — era manutenção, o único que existia.
  const totais = useMemo(() => ({
    veiculos: bens.filter((b) => b.categoria === "veiculo").length,
    equipamentos: bens.filter((b) => b.categoria === "equipamento").length,
    emManutencao: bens.filter((b) => b.em_manutencao && (b.motivo_indisponivel ?? "manutencao") === "manutencao").length,
    emContrato: bens.filter((b) => b.em_manutencao && b.motivo_indisponivel === "contrato").length,
    outroMotivo: bens.filter((b) => b.em_manutencao && b.motivo_indisponivel === "outro").length,
  }), [bens]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patrimônio"
        subtitle="Veículos, máquinas e equipamentos, por contrato e posto."
        module="Suprimentos"
        breadcrumb={["Patrimônio"]}
        actions={
          <>
            <Button variant={modoEdicao ? "default" : "outline"} onClick={() => setModoEdicao((v) => !v)}>
              <Pencil className="mr-2 h-4 w-4" /> {modoEdicao ? "Concluir edição" : "Editar"}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/app/suprimentos/manutencao">
                <ClipboardList className="mr-2 h-4 w-4" /> Painel de Manutenções
              </Link>
            </Button>
            <Button onClick={() => setEditando({ categoria: "veiculo" })}>
              <Plus className="mr-2 h-4 w-4" /> Novo bem
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[18rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)}
                 placeholder="Buscar contrato, posto, veículo, equipamento, nº de série…" className="pl-9" />
        </div>
        <Badge variant="outline" className="gap-1"><Car className="h-3.5 w-3.5" /> {totais.veiculos} veículos</Badge>
        <Badge variant="outline" className="gap-1"><Wrench className="h-3.5 w-3.5" /> {totais.equipamentos} equipamentos</Badge>
        {totais.emManutencao > 0 && (
          <Badge variant="outline" className="border-amber-400/50 text-amber-700 dark:text-amber-300">
            {totais.emManutencao} em manutenção
          </Badge>
        )}
        {totais.emContrato > 0 && (
          <Badge variant="outline" className="border-sky-400/50 text-sky-700 dark:text-sky-300">
            {totais.emContrato} em contrato
          </Badge>
        )}
        {totais.outroMotivo > 0 && (
          <Badge variant="outline" className="border-rose-400/50 text-rose-700 dark:text-rose-300">
            {totais.outroMotivo} por outro motivo
          </Badge>
        )}
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <p className="font-medium">Não foi possível carregar o patrimônio.</p>
          <p className="max-w-md text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : bens.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Boxes className="h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">Nenhum bem cadastrado.</p>
          <p className="text-sm text-muted-foreground">Comece cadastrando um veículo ou equipamento.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(["veiculo", "equipamento"] as Categoria[]).map((cat) => {
            const contratos = arvore[cat].filter(contratoVisivel);
            const Icone = cat === "veiculo" ? Car : Wrench;
            const chaveCat = `cat:${cat}`;
            return (
              <Card key={cat} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => alternar(chaveCat)}
                  className="flex w-full items-center gap-2 bg-muted/60 px-4 py-3 text-left font-semibold hover:bg-muted"
                >
                  <Icone className="h-4 w-4" />
                  {LABEL_CATEGORIA[cat]}
                  <Badge variant="secondary" className="ml-1">
                    {arvore[cat].reduce((s, c) => s + c.postos.reduce((t, p) => t + p.bens.length, 0), 0)}
                  </Badge>
                  {estaAberto(chaveCat)
                    ? <ChevronDown className="ml-auto h-4 w-4" />
                    : <ChevronRight className="ml-auto h-4 w-4" />}
                </button>

                {estaAberto(chaveCat) && (
                  <CardContent className="space-y-2 p-3">
                    {contratos.length === 0 && (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {termo ? "Nada encontrado aqui." : "Nenhum bem nesta categoria."}
                      </p>
                    )}
                    {contratos.map((c) => {
                      const chaveC = `${cat}:${c.chave}`;
                      const postos = c.postos.filter((p) => postoVisivel(p, c.nome));
                      return (
                        <div key={c.chave} className="rounded-md border">
                          <button
                            type="button"
                            onClick={() => alternar(chaveC)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                            {estaAberto(chaveC)
                              ? <ChevronDown className="h-4 w-4 shrink-0" />
                              : <ChevronRight className="h-4 w-4 shrink-0" />}
                          </button>

                          {estaAberto(chaveC) && (
                            <div className="space-y-2 border-t p-2">
                              {postos.map((p) => {
                                const chaveP = `${cat}:${p.chave}`;
                                const lista = bensDoPosto(p, c.nome);
                                return (
                                  <div key={p.chave} className="rounded-md border">
                                    <button
                                      type="button"
                                      onClick={() => alternar(chaveP)}
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60"
                                    >
                                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                      <span className="min-w-0 flex-1 truncate font-medium">{p.nome}</span>
                                      <Badge variant="secondary" className="shrink-0 text-[10px]">{lista.length}</Badge>
                                      {estaAberto(chaveP)
                                        ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                                        : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                                    </button>

                                    {estaAberto(chaveP) && (
                                      <div className="grid gap-2 border-t p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                        {lista.map((b) => (
                                          <CardBem
                                            key={b.id}
                                            bem={b}
                                            modoEdicao={modoEdicao}
                                            fotoUrl={b.foto_path ? fotos[b.foto_path] : undefined}
                                            onAbrir={() => setManutencaoDe(b)}
                                            onEditar={() => setEditando(b)}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <DialogBem
        bem={editando}
        empresaId={empresaId ?? null}
        onFechar={() => setEditando(null)}
      />
      <ModalManutencao bem={manutencaoDe} onFechar={() => setManutencaoDe(null)} />
    </div>
  );
}

/** Card do bem. O identificador vem em destaque porque é o que distingue
 *  duas unidades do mesmo modelo — há 3 "ROÇADEIRA STHIL FS 220" na base. */
function CardBem({
  bem, modoEdicao, onAbrir, onEditar, fotoUrl,
}: {
  bem: Bem; modoEdicao: boolean; onAbrir: () => void; onEditar: () => void;
  fotoUrl?: string;
}) {
  const Icone = bem.categoria === "veiculo" ? Car : Wrench;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onAbrir}
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors hover:bg-muted/60",
          bem.em_manutencao && "border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20",
        )}
      >
        {/* A foto ocupa o lugar do ícone: boa parte da frota entrou sem placa
            ou nº de série, e "MONTANA" ao lado de "ONIX" não diz qual é. */}
        {fotoUrl ? (
          <img
            src={fotoUrl}
            alt={`Foto de ${bem.nome}`}
            loading="lazy"
            className="mb-1 h-20 w-full rounded object-cover"
          />
        ) : (
          <Icone className={cn("h-5 w-5", bem.em_manutencao ? "text-amber-600" : "text-muted-foreground")} />
        )}
        <span className="line-clamp-2 text-sm font-medium">{bem.nome}</span>
        <span className="line-clamp-1 font-mono text-[11px] text-muted-foreground">
          {bem.identificador ?? "sem identificador"}
        </span>
        {bem.em_manutencao && (
          bem.motivo_indisponivel === "contrato"
            ? <Badge variant="outline" className="border-sky-400/60 text-[10px] text-sky-700 dark:text-sky-300">em contrato</Badge>
            : bem.motivo_indisponivel === "outro"
              // O texto escrito à mão é o rótulo: "indisponível" sozinho não
              // diria nada a quem está varrendo a frota. `title` guarda o
              // motivo inteiro, porque o card corta em uma linha.
              ? <Badge variant="outline" title={rotuloIndisponivel(bem)}
                       className="max-w-full border-rose-400/60 text-[10px] text-rose-700 dark:text-rose-300">
                  <span className="truncate">{rotuloIndisponivel(bem)}</span>
                </Badge>
              : <Badge variant="outline" className="border-amber-400/60 text-[10px] text-amber-700 dark:text-amber-300">em manutenção</Badge>
        )}
      </button>
      {modoEdicao && (
        <Button
          size="icon" variant="secondary"
          className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full shadow"
          onClick={onEditar}
          aria-label={`Editar ${bem.nome}`}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/** Cadastro e edição do bem. */
function DialogBem({
  bem, empresaId, onFechar,
}: { bem: Partial<Bem> | null; empresaId: string | null; onFechar: () => void }) {
  const { data: contratos = [] } = useContratosCatalogo(empresaId);
  const salvar = useSalvarBem();
  const excluir = useExcluirBem();
  const [form, setForm] = useState<Partial<Bem>>({});
  const [idAtual, setIdAtual] = useState<string | null>(null);

  const chave = bem?.id ?? (bem ? "novo" : null);
  if (bem && chave !== idAtual) { setIdAtual(chave); setForm({ ...bem }); }

  const { data: postos = [] } = usePostosDoContrato(form.contrato_id ?? null);

  return (
    <Dialog open={!!bem} onOpenChange={(o) => { if (!o) { setIdAtual(null); onFechar(); } }}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar bem" : "Novo bem"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <div>
              <Label>Categoria *</Label>
              <Select value={form.categoria ?? "veiculo"}
                      onValueChange={(v) => setForm((s) => ({ ...s, categoria: v as Categoria }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="veiculo">Veículo</SelectItem>
                  <SelectItem value="equipamento">Máquina / Equipamento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nome / descrição *</Label>
              <Input value={form.nome ?? ""} onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
                     placeholder="Ex.: Hilux 2022, Roçadeira STHIL FS 220" />
            </div>
          </div>

          <div>
            <Label>Identificador</Label>
            <Input value={form.identificador ?? ""}
                   onChange={(e) => setForm((s) => ({ ...s, identificador: e.target.value }))}
                   placeholder="Placa, nº de série ou patrimônio" className="font-mono" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              É o que distingue duas unidades do mesmo modelo. Pode ficar vazio.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Contrato</Label>
              <Select
                value={form.contrato_id ?? SEM_CONTRATO}
                onValueChange={(v) => setForm((s) => ({
                  ...s,
                  contrato_id: v === SEM_CONTRATO ? null : v,
                  posto_id: null,
                }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_CONTRATO}>— Administrativo / Sede —</SelectItem>
                  {contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.contrato_id ? (
              <div>
                <Label>Posto</Label>
                <Select value={form.posto_id ?? SEM_CONTRATO}
                        onValueChange={(v) => setForm((s) => ({ ...s, posto_id: v === SEM_CONTRATO ? null : v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_CONTRATO}>— sem posto —</SelectItem>
                    {postos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Lotação</Label>
                <Input value={form.lotacao ?? ""}
                       onChange={(e) => setForm((s) => ({ ...s, lotacao: e.target.value }))}
                       placeholder="Ex.: ADM, Oficina, Sede" />
              </div>
            )}
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea rows={2} value={form.observacoes ?? ""}
                      onChange={(e) => setForm((s) => ({ ...s, observacoes: e.target.value }))} />
          </div>

          {form.id && (
            <p className="text-[11px] text-muted-foreground">
              O status de manutenção e as notas são editados clicando no card.
            </p>
          )}
        </div>

        <DialogFooter className="items-center">
          {form.id && (
            <Button
              variant="ghost" className="mr-auto text-destructive"
              onClick={() => {
                if (confirm(`Excluir "${form.nome}"? Os anexos e o histórico vão junto.`)) {
                  excluir.mutate(form.id!, { onSuccess: () => { setIdAtual(null); onFechar(); } });
                }
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
            </Button>
          )}
          <Button variant="outline" onClick={() => { setIdAtual(null); onFechar(); }}>Cancelar</Button>
          <Button
            disabled={salvar.isPending}
            onClick={() => salvar.mutate({ ...form, empresa_id: empresaId ?? undefined },
              { onSuccess: () => { setIdAtual(null); onFechar(); } })}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
