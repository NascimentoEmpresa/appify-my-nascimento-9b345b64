import { useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, FileText, Fuel, Gauge, Loader2, Paperclip, Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  LABEL_TURNO, abrirArquivoVeiculo, formatarData, hojeISO,
  useContratosParaAgendamento, useDefinirContratosDaViagem, useFecharKm, useRegistrarAbastecimento, useViagem,
  type ContratoSimples,
} from "@/hooks/useAgendamentoVeiculos";

// =====================================================================
// A VIAGEM (22/09/2026) — o que o chamado dos abastecimentos pediu.
//
// Abre ao clicar num agendamento. Reúne num lugar só:
//   • KM inicial (com a foto do painel) e o fechamento com o KM final;
//   • os contratos que a viagem atende — dá para acrescentar e tirar, porque
//     o mesmo carro atende vários contratos na mesma saída;
//   • as notas de abastecimento, cada uma com descrição, valor e OS
//     CONTRATOS que ela atende (os da viagem já vêm marcados).
// =====================================================================

const moeda = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ViagemDialog({ agendamentoId, aberto, onFechar, souDono }: {
  agendamentoId: string | null; aberto: boolean; onFechar: () => void; souDono: boolean;
}) {
  const q = useViagem(aberto ? agendamentoId : null);
  const fecharKm = useFecharKm();
  const salvarContratos = useDefinirContratosDaViagem();
  const registrar = useRegistrarAbastecimento();
  const [incluirInativos, setIncluirInativos] = useState(false);
  const contratos = useContratosParaAgendamento(incluirInativos);

  // KM final
  const [kmFinal, setKmFinal] = useState("");
  const [fotoFinal, setFotoFinal] = useState<File | null>(null);
  // Nota de abastecimento
  const [notaAberta, setNotaAberta] = useState(false);
  const [nota, setNota] = useState({ descricao: "", data: hojeISO(), valor: "", litros: "", km: "", arquivo: null as File | null });
  const [notaContratos, setNotaContratos] = useState<string[]>([]);
  // Contratos da viagem
  const [editandoContratos, setEditandoContratos] = useState(false);
  const [viagemContratos, setViagemContratos] = useState<string[]>([]);

  const v = q.data;
  const nomesDaViagem = useMemo(() => (v?.contratos ?? []).map((c) => c.nome), [v]);

  // Ao abrir: a nota já vem com os contratos da viagem marcados (é o que o
  // chamado pediu — "o contrato tem que puxar automaticamente").
  useEffect(() => {
    setNotaContratos(nomesDaViagem);
    setViagemContratos(nomesDaViagem);
  }, [nomesDaViagem]);
  useEffect(() => {
    if (!aberto) { setNotaAberta(false); setEditandoContratos(false); setKmFinal(""); setFotoFinal(null); setNota({ descricao: "", data: hojeISO(), valor: "", litros: "", km: "", arquivo: null }); }
  }, [aberto]);

  /** Nome → {codigo, nome, administrativo} usando a lista do banco, com fallback no que já está na viagem. */
  const porNome = (nome: string): ContratoSimples => {
    const daLista = (contratos.data ?? []).find((c) => c.nome === nome);
    if (daLista) return { codigo: daLista.codigo, nome: daLista.nome, administrativo: !!daLista.administrativo };
    const daViagem = (v?.contratos ?? []).find((c) => c.nome === nome);
    return daViagem ?? { codigo: null, nome, administrativo: false };
  };

  const enviarKmFinal = async () => {
    if (!agendamentoId || !fotoFinal) return;
    await fecharKm.mutateAsync({ id: agendamentoId, km: Number(kmFinal), foto: fotoFinal });
    setKmFinal(""); setFotoFinal(null);
  };

  const enviarNota = async () => {
    if (!agendamentoId || !nota.arquivo) return;
    await registrar.mutateAsync({
      id: agendamentoId,
      arquivo: nota.arquivo,
      contratos: notaContratos.map(porNome),
      descricao: nota.descricao,
      data: nota.data,
      valor: nota.valor ? Number(nota.valor.replace(",", ".")) : null,
      litros: nota.litros ? Number(nota.litros.replace(",", ".")) : null,
      km: nota.km ? Number(nota.km) : null,
    });
    setNota({ descricao: "", data: hojeISO(), valor: "", litros: "", km: "", arquivo: null });
    setNotaAberta(false);
  };

  const salvarContratosDaViagem = async () => {
    if (!agendamentoId) return;
    await salvarContratos.mutateAsync({ id: agendamentoId, contratos: viagemContratos.map(porNome) });
    setEditandoContratos(false);
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fuel className="h-5 w-5 text-primary" />
            {v ? `Viagem nº ${v.numero} · ${v.veiculo_nome}` : "Viagem"}
          </DialogTitle>
          <DialogDescription>
            {v ? `${formatarData(v.data_inicio)}${v.data_fim !== v.data_inicio ? ` a ${formatarData(v.data_fim)}` : ""} · ${LABEL_TURNO[v.turno]} · ${v.solicitante_nome ?? ""}` : "Carregando…"}
          </DialogDescription>
        </DialogHeader>

        {q.isLoading && <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando a viagem…</p>}
        {q.isError && <p className="py-6 text-sm text-destructive">Não consegui carregar esta viagem.</p>}

        {v && (
          <div className="space-y-5">
            {/* ── KM ─────────────────────────────────────────────── */}
            <section className="rounded-xl border border-border p-4">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-bold"><Gauge className="h-4 w-4 text-primary" /> Quilometragem</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="KM inicial" valor={v.km_inicial != null ? `${v.km_inicial.toLocaleString("pt-BR")} km` : "—"}
                       acao={v.km_inicial_foto ? () => abrirArquivoVeiculo(v.km_inicial_foto!) : undefined} />
                <Campo rotulo="KM final" valor={v.km_final != null ? `${v.km_final.toLocaleString("pt-BR")} km` : "pendente"}
                       acao={v.km_final_foto ? () => abrirArquivoVeiculo(v.km_final_foto!) : undefined} />
              </div>
              {v.rodados != null && (
                <p className="mt-2 text-sm text-muted-foreground">Rodou <b className="text-foreground">{v.rodados.toLocaleString("pt-BR")} km</b> nesta viagem.</p>
              )}

              {v.km_final == null && souDono && (
                <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-500/10">
                  <p className="text-sm font-semibold">Fechar a viagem</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="km-final">KM final (painel) *</Label>
                      <Input id="km-final" inputMode="numeric" value={kmFinal} placeholder={v.km_inicial ? `maior que ${v.km_inicial}` : "Ex.: 84980"}
                             onChange={(e) => setKmFinal(e.target.value.replace(/\D/g, ""))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="foto-final">Foto do painel *</Label>
                      <label htmlFor="foto-final" className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:bg-muted/50">
                        <Camera className="h-4 w-4 shrink-0 text-amber-600" />
                        <span className="truncate">{fotoFinal ? fotoFinal.name : "Tirar foto / escolher"}</span>
                      </label>
                      <input id="foto-final" type="file" accept="image/*" capture="environment" className="hidden"
                             onChange={(e) => setFotoFinal(e.target.files?.[0] ?? null)} />
                    </div>
                  </div>
                  <Button size="sm" className="gap-1.5" disabled={!kmFinal || !fotoFinal || fecharKm.isPending} onClick={enviarKmFinal}>
                    {fecharKm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Registrar KM final
                  </Button>
                </div>
              )}
            </section>

            {/* ── Contratos da viagem ────────────────────────────── */}
            <section className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-primary" /> Contratos atendidos</h4>
                {souDono && (
                  <Button size="sm" variant="ghost" onClick={() => setEditandoContratos((x) => !x)}>
                    {editandoContratos ? "Cancelar" : "Editar"}
                  </Button>
                )}
              </div>
              {!editandoContratos ? (
                <div className="flex flex-wrap gap-1.5">
                  {v.contratos.map((c) => <Badge key={c.nome} variant="secondary">{c.nome}</Badge>)}
                  {v.contratos.length === 0 && <span className="text-sm text-muted-foreground">Nenhum contrato vinculado.</span>}
                </div>
              ) : (
                <ListaContratos
                  opcoes={(contratos.data ?? []).map((c) => c.nome)}
                  extras={nomesDaViagem}
                  marcados={viagemContratos}
                  onAlternar={(n) => setViagemContratos((l) => l.includes(n) ? l.filter((x) => x !== n) : [...l, n])}
                  incluirInativos={incluirInativos}
                  onIncluirInativos={setIncluirInativos}
                  rodape={
                    <Button size="sm" className="gap-1.5" disabled={!viagemContratos.length || salvarContratos.isPending} onClick={salvarContratosDaViagem}>
                      <Save className="h-4 w-4" /> Salvar contratos
                    </Button>
                  }
                />
              )}
            </section>

            {/* ── Notas de abastecimento ─────────────────────────── */}
            <section className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-bold"><Fuel className="h-4 w-4 text-primary" /> Notas de abastecimento</h4>
                {souDono && !notaAberta && (
                  <Button size="sm" className="gap-1.5" onClick={() => { setNotaContratos(nomesDaViagem); setNotaAberta(true); }}>
                    <Plus className="h-4 w-4" /> Anexar nota de gasolina
                  </Button>
                )}
              </div>

              {v.abastecimentos.length === 0 && !notaAberta && (
                <p className="text-sm text-muted-foreground">Nenhuma nota anexada nesta viagem.</p>
              )}

              <ul className="space-y-2">
                {v.abastecimentos.map((b) => (
                  <li key={b.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-semibold">{formatarData(b.data)}</span>
                      <span className="text-sm font-bold text-foreground">{moeda(b.valor)}</span>
                      {b.litros != null && <span className="text-xs text-muted-foreground">{b.litros} L</span>}
                      {b.km != null && <span className="text-xs text-muted-foreground">KM {b.km.toLocaleString("pt-BR")}</span>}
                      <button type="button" onClick={() => abrirArquivoVeiculo(b.storage_path)}
                              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                        <Paperclip className="h-3.5 w-3.5" /> {b.nome_arquivo}
                      </button>
                    </div>
                    {b.descricao && <p className="mt-1 text-sm text-muted-foreground">{b.descricao}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {b.contratos.map((c) => <Badge key={c.nome} variant="outline" className="text-[10px]">{c.nome}</Badge>)}
                    </div>
                    {b.criado_por_nome && <p className="mt-1 text-[11px] text-muted-foreground">anexada por {b.criado_por_nome}</p>}
                  </li>
                ))}
              </ul>

              {notaAberta && (
                <div className="mt-3 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="nota-arquivo">Nota do abastecimento *</Label>
                      <label htmlFor="nota-arquivo" className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:bg-muted/50">
                        <Camera className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">{nota.arquivo ? nota.arquivo.name : "Foto da notinha ou PDF"}</span>
                      </label>
                      <input id="nota-arquivo" type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
                             onChange={(e) => setNota((n) => ({ ...n, arquivo: e.target.files?.[0] ?? null }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="nota-data">Data do abastecimento</Label>
                      <Input id="nota-data" type="date" max={hojeISO()} value={nota.data} onChange={(e) => setNota((n) => ({ ...n, data: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="nota-valor">Valor (R$)</Label>
                      <Input id="nota-valor" inputMode="decimal" placeholder="250,75" value={nota.valor} onChange={(e) => setNota((n) => ({ ...n, valor: e.target.value.replace(/[^\d,.]/g, "") }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="nota-litros">Litros (opcional)</Label>
                      <Input id="nota-litros" inputMode="decimal" placeholder="42,5" value={nota.litros} onChange={(e) => setNota((n) => ({ ...n, litros: e.target.value.replace(/[^\d,.]/g, "") }))} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="nota-desc">Descrição</Label>
                      <Textarea id="nota-desc" rows={2} placeholder="Ex.: Posto Shell BR-116, tanque cheio na ida." value={nota.descricao}
                                onChange={(e) => setNota((n) => ({ ...n, descricao: e.target.value }))} />
                    </div>
                  </div>

                  <div>
                    <Label className="mb-1.5 block">Contratos que este abastecimento atende *</Label>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Já vêm marcados os contratos da viagem. Dá para desmarcar e acrescentar — o que você marcar aqui também passa a valer para a viagem.
                    </p>
                    <ListaContratos
                      opcoes={(contratos.data ?? []).map((c) => c.nome)}
                      extras={nomesDaViagem}
                      marcados={notaContratos}
                      onAlternar={(n) => setNotaContratos((l) => l.includes(n) ? l.filter((x) => x !== n) : [...l, n])}
                      incluirInativos={incluirInativos}
                      onIncluirInativos={setIncluirInativos}
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setNotaAberta(false)}>Cancelar</Button>
                    <Button size="sm" className="gap-1.5" disabled={!nota.arquivo || !notaContratos.length || registrar.isPending} onClick={enviarNota}>
                      {registrar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                      Anexar nota
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Campo({ rotulo, valor, acao }: { rotulo: string; valor: string; acao?: () => void }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="text-sm font-semibold text-foreground">{valor}</p>
      {acao && <button type="button" onClick={acao} className="mt-1 text-xs font-semibold text-primary hover:underline">ver foto do painel</button>}
    </div>
  );
}

/** Lista de contratos com busca — usada para a viagem e para a nota. */
function ListaContratos({ opcoes, extras, marcados, onAlternar, incluirInativos, onIncluirInativos, rodape }: {
  opcoes: string[]; extras: string[]; marcados: string[]; onAlternar: (nome: string) => void;
  incluirInativos: boolean; onIncluirInativos: (v: boolean) => void; rodape?: React.ReactNode;
}) {
  const [busca, setBusca] = useState("");
  // Contrato que já está na viagem entra mesmo se não veio na lista (inativo).
  const lista = useMemo(() => {
    const todos = [...new Set([...extras, ...opcoes])];
    const b = busca.trim().toLowerCase();
    return b ? todos.filter((n) => n.toLowerCase().includes(b)) : todos;
  }, [opcoes, extras, busca]);

  return (
    <div className="space-y-2">
      <Input placeholder="Buscar contrato…" value={busca} onChange={(e) => setBusca(e.target.value)} className="h-9" />
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
        {lista.map((nome) => (
          <label key={nome} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
            <Checkbox checked={marcados.includes(nome)} onCheckedChange={() => onAlternar(nome)} />
            <span className="min-w-0 flex-1 truncate">{nome}</span>
          </label>
        ))}
        {lista.length === 0 && <p className="p-2 text-xs text-muted-foreground">Nenhum contrato encontrado.</p>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={incluirInativos} onCheckedChange={(v) => onIncluirInativos(v === true)} /> Mostrar contratos inativos
        </label>
        {rodape}
      </div>
    </div>
  );
}
