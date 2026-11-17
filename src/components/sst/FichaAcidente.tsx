import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, FileText, Link2, Loader2, RotateCcw, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  abrirAnexoAcidente, buscarColaboradoresAcidente, sugestaoAcidente, useAnexarAcidente, useConcluirAcidente, useContratosAcidente,
  useExcluirAcidente, useFichaAcidente, useLigarAfastamento, useRemoverAnexoAcidente, useSalvarAcidente,
  type AfastamentoSugerido, type ColaboradorAcidente, type DocAcidente,
} from "@/hooks/useAcidentes";
import { fmtTamanho } from "@/lib/solicitacoes/anexos";
import { EMPRESAS, ROTULO_TIPO, contratoExibido, fmtData, hojeIso, type Acidente, type TipoAcidente } from "@/lib/sst/acidentes";
import { cn } from "@/lib/utils";

// =====================================================================
// Ficha do acidente (SIS-2026-0889): registrar um novo, ou abrir um
// existente com os dados, a CAT e os anexos, a ligação com o afastamento
// e o histórico. Concluir só passa quando nada falta (o banco confere).
// =====================================================================

const avisarErro = (e: unknown) => toast.error((e as Error).message);
const NENHUM = "nenhum";

interface Form {
  empresa: string; contrato_id: string; encarregado: string; data_acidente: string; tipo: string; descricao: string;
  houve_afastamento: "sim" | "nao"; dias_afastamento: string; encaminhado_inss: "sim" | "nao";
  cat_emitida: "" | "sim" | "nao"; numero_cat: string; cat_motivo_sem: string; morte_invalidez: boolean; observacoes: string;
}

const FORM_VAZIO: Form = {
  empresa: "", contrato_id: "", encarregado: "", data_acidente: hojeIso(), tipo: "", descricao: "",
  houve_afastamento: "nao", dias_afastamento: "", encaminhado_inss: "nao",
  cat_emitida: "", numero_cat: "", cat_motivo_sem: "", morte_invalidez: false, observacoes: "",
};

const formDe = (a: Acidente): Form => ({
  empresa: a.empresa ?? "", contrato_id: a.contrato_id ?? "", encarregado: a.encarregado ?? "", data_acidente: a.data_acidente,
  tipo: a.tipo ?? "", descricao: a.descricao ?? "",
  houve_afastamento: a.houve_afastamento ? "sim" : "nao", dias_afastamento: a.dias_afastamento?.toString() ?? "",
  encaminhado_inss: a.encaminhado_inss ? "sim" : "nao",
  cat_emitida: a.cat_emitida == null ? "" : a.cat_emitida ? "sim" : "nao", numero_cat: a.numero_cat ?? "",
  cat_motivo_sem: a.cat_motivo_sem ?? "", morte_invalidez: a.morte_invalidez, observacoes: a.observacoes ?? "",
});

/** Sem afastamento, dias e INSS vão vazios; sem CAT, o número vai vazio — o banco recusaria. */
const payloadDe = (f: Form): Record<string, unknown> => {
  const afastou = f.houve_afastamento === "sim";
  return {
    empresa: f.empresa, contrato_id: f.contrato_id, encarregado: f.encarregado, data_acidente: f.data_acidente, tipo: f.tipo,
    descricao: f.descricao, houve_afastamento: afastou, dias_afastamento: afastou ? f.dias_afastamento : "",
    encaminhado_inss: afastou && f.encaminhado_inss === "sim",
    cat_emitida: f.cat_emitida === "" ? "" : f.cat_emitida === "sim",
    numero_cat: f.cat_emitida === "sim" ? f.numero_cat : "", cat_motivo_sem: f.cat_emitida === "nao" ? f.cat_motivo_sem : "",
    morte_invalidez: f.morte_invalidez, observacoes: f.observacoes,
  };
};

export function FichaAcidenteDialog({ acidente, podeAlterar, podeExcluir, onFechar, onCriado }: {
  acidente: Acidente | null; podeAlterar: boolean; podeExcluir: boolean; onFechar: () => void; onCriado: (id: number) => void;
}) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        {acidente ? (
          <Existente a={acidente} podeAlterar={podeAlterar} podeExcluir={podeExcluir} onFechar={onFechar} />
        ) : (
          <Novo onCriado={onCriado} onFechar={onFechar} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Novo ────────────────────────────────────────────────────────────────
function Novo({ onCriado, onFechar }: { onCriado: (id: number) => void; onFechar: () => void }) {
  const salvar = useSalvarAcidente();
  const anexar = useAnexarAcidente();
  const [colab, setColab] = useState<ColaboradorAcidente | null>(null);
  const [form, setForm] = useState<Form>(FORM_VAZIO);
  const [encarregados, setEncarregados] = useState<string[]>([]);
  const [cat, setCat] = useState<File | null>(null);

  const escolher = (c: ColaboradorAcidente | null) => {
    setColab(c);
    setEncarregados([]);
    if (!c) return;
    // Empresa, contrato e encarregado sugeridos; tudo continua editável.
    sugestaoAcidente(c.id).then((s) => {
      setEncarregados(s.encarregados);
      setForm((f) => ({ ...f, empresa: s.empresa ?? f.empresa, contrato_id: s.contrato_id ?? f.contrato_id,
        encarregado: f.encarregado || (s.encarregados.length === 1 ? s.encarregados[0] : "") }));
    }, avisarErro);
  };

  const registrar = async () => {
    if (!colab) { toast.error("Escolha o colaborador."); return; }
    try {
      const id = await salvar.mutateAsync({ empregado_id: colab.id, ...payloadDe(form) });
      if (cat) await anexar.mutateAsync({ id, arquivo: cat, categoria: "cat" }).catch(avisarErro);
      toast.success("Acidente registrado.");
      onCriado(id);
    } catch (e) { avisarErro(e); }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Registrar acidente de trabalho</DialogTitle>
        <DialogDescription>Escolha o colaborador: empresa, contrato e encarregado vêm sugeridos do cadastro, e dá para trocar.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <BuscaColaborador escolhido={colab} onEscolher={escolher} />
        <Campos form={form} setForm={setForm} encarregados={encarregados} />
        <div>
          <Label htmlFor="acid-cat-novo">CAT (opcional agora — PDF ou imagem, até 25 MB)</Label>
          <Input id="acid-cat-novo" type="file" accept=".pdf,image/*" className="mt-1" onChange={(e) => setCat(e.target.files?.[0] ?? null)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={registrar} disabled={salvar.isPending || anexar.isPending}>
            {(salvar.isPending || anexar.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registrar acidente
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Existente ───────────────────────────────────────────────────────────
function Existente({ a, podeAlterar, podeExcluir, onFechar }: { a: Acidente; podeAlterar: boolean; podeExcluir: boolean; onFechar: () => void }) {
  const { data: ficha } = useFichaAcidente(a.id);
  const concluir = useConcluirAcidente();
  const excluir = useExcluirAcidente();
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const pendencias = ficha?.pendencias ?? [];

  const alternarConclusao = () => concluir.mutateAsync({ id: a.id, concluir: !a.concluido })
    .then(() => toast.success(a.concluido ? "Acidente reaberto." : "Acidente concluído."), avisarErro);
  const apagar = () => excluir.mutateAsync(a.id).then(() => { toast.success("Registro excluído."); onFechar(); }, avisarErro);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{a.nome}</DialogTitle>
        <DialogDescription>
          {[`Acidente de ${fmtData(a.data_acidente)}`, a.tipo && ROTULO_TIPO[a.tipo], contratoExibido(a) ?? "Sem contrato", a.empresa].filter(Boolean).join(" · ")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeloConclusao concluido={a.concluido} />
          {!a.vinculado && <Badge variant="outline" className="border-amber-400 text-amber-800">Sem vínculo com colaborador</Badge>}
          {a.desligado && <Badge variant="outline">Desligado na Senior</Badge>}
          {a.origem === "planilha" && <Badge variant="outline">Importado da planilha</Badge>}
          {a.morte_invalidez && <Badge variant="destructive">Morte / invalidez</Badge>}
        </div>

        {a.concluido ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            <span>Concluído{a.concluido_em ? ` em ${fmtData(a.concluido_em)}` : ""}{a.concluido_por ? ` por ${a.concluido_por}` : ""}.</span>
            {podeAlterar && (
              <Button size="sm" variant="outline" onClick={alternarConclusao} disabled={concluir.isPending}>
                <RotateCcw className="mr-2 h-4 w-4" /> Reabrir
              </Button>
            )}
          </div>
        ) : (
          <div className={cn("space-y-2 rounded-lg border p-3 text-sm",
            pendencias.length ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900")}>
            {pendencias.length ? (
              <>
                <p className="font-semibold">Para concluir, falta:</p>
                <ul className="list-disc pl-5">{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
              </>
            ) : <p className="font-semibold">Tudo preenchido: pronto para concluir.</p>}
            {podeAlterar && (
              <div className="flex justify-end">
                <Button size="sm" onClick={alternarConclusao} disabled={concluir.isPending || !ficha || pendencias.length > 0}>
                  {concluir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CircleCheck className="mr-2 h-4 w-4" />} Concluir
                </Button>
              </div>
            )}
          </div>
        )}

        <Tabs defaultValue="dados">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="cat">CAT e anexos ({ficha?.documentos.length ?? a.documentos})</TabsTrigger>
            <TabsTrigger value="afastamento">Afastamento</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="dados" className="pt-3"><AbaDados a={a} podeAlterar={podeAlterar} /></TabsContent>
          <TabsContent value="cat" className="pt-3"><AbaAnexos a={a} docs={ficha?.documentos ?? []} podeAlterar={podeAlterar} /></TabsContent>
          <TabsContent value="afastamento" className="pt-3"><AbaAfastamento a={a} lista={ficha?.afastamentos ?? []} podeAlterar={podeAlterar} /></TabsContent>
          <TabsContent value="historico" className="pt-3">
            {!ficha || ficha.historico.length === 0 ? <Vazio>Nada registrado ainda.</Vazio> : (
              <ul className="space-y-2 text-sm">
                {ficha.historico.map((h) => (
                  <li key={h.id} className="rounded-md border px-3 py-2">
                    <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")} · {h.autor_nome ?? "Sistema"}</span>
                    <p>{h.descricao}</p>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>

        {podeExcluir && (
          <div className="flex justify-end border-t pt-3">
            {confirmandoExclusao ? (
              <div className="flex items-center gap-2 text-sm">
                <span>Excluir este acidente, a CAT e o histórico? Não dá para desfazer.</span>
                <Button size="sm" variant="outline" onClick={() => setConfirmandoExclusao(false)}>Não</Button>
                <Button size="sm" variant="destructive" onClick={apagar} disabled={excluir.isPending}>Excluir</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmandoExclusao(true)}>
                <Trash2 className="mr-2 h-4 w-4" /> Excluir registro
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function AbaDados({ a, podeAlterar }: { a: Acidente; podeAlterar: boolean }) {
  const salvar = useSalvarAcidente();
  const [form, setForm] = useState<Form>(() => formDe(a));
  // Acompanha o que o banco devolve depois de salvar ou de ligar um afastamento.
  const assinatura = JSON.stringify(formDe(a));
  useEffect(() => setForm(formDe(a)), [assinatura]); // eslint-disable-line react-hooks/exhaustive-deps
  const [encarregados, setEncarregados] = useState<string[]>([]);
  useEffect(() => {
    if (!podeAlterar || a.empregado_id == null) return;
    let vivo = true;
    sugestaoAcidente(a.empregado_id).then((s) => { if (vivo) setEncarregados(s.encarregados); }, () => undefined);
    return () => { vivo = false; };
  }, [a.empregado_id, podeAlterar]);

  const gravar = () => salvar.mutateAsync({ id: a.id, ...payloadDe(form) }).then(() => toast.success("Dados salvos."), avisarErro);
  const ligar = (c: ColaboradorAcidente | null) => {
    if (!c) return;
    salvar.mutateAsync({ id: a.id, empregado_id: c.id }).then(() => toast.success(`Registro ligado a ${c.nome}.`), avisarErro);
  };

  return (
    <div className="space-y-4">
      {!a.vinculado && podeAlterar && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Na planilha estava <span className="font-semibold">{a.nome}</span>, e esse nome não bateu com um colaborador só do cadastro.
            Procure a pessoa certa para ligar o acidente à ficha dela.
          </p>
          <BuscaColaborador escolhido={null} onEscolher={ligar} />
        </div>
      )}
      {a.contrato_texto && !a.contrato_id && (
        <p className="text-xs text-muted-foreground">Contrato escrito na planilha: <span className="font-medium">{a.contrato_texto}</span>. Escolha o contrato do ERP abaixo, se houver.</p>
      )}
      <Campos form={form} setForm={setForm} encarregados={encarregados} disabled={!podeAlterar} />
      {podeAlterar && (
        <div className="flex justify-end">
          <Button onClick={gravar} disabled={salvar.isPending}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
        </div>
      )}
    </div>
  );
}

function AbaAnexos({ a, docs, podeAlterar }: { a: Acidente; docs: DocAcidente[]; podeAlterar: boolean }) {
  const anexar = useAnexarAcidente();
  const remover = useRemoverAnexoAcidente();
  const [categoria, setCategoria] = useState<DocAcidente["categoria"]>("cat");
  const enviar = async (lista: FileList | null) => {
    for (const arquivo of Array.from(lista ?? [])) {
      await anexar.mutateAsync({ id: a.id, arquivo, categoria }).then(() => toast.success(`${arquivo.name} anexado.`), avisarErro);
    }
  };
  return (
    <div className="space-y-4">
      {podeAlterar && (
        <div className="space-y-3 rounded-lg border p-3">
          <h3 className="text-sm font-semibold">Anexar arquivo</h3>
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <Select value={categoria} onValueChange={(v) => setCategoria(v as DocAcidente["categoria"])}>
              <SelectTrigger aria-label="Tipo do arquivo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cat">CAT</SelectItem>
                <SelectItem value="outro">Outro documento</SelectItem>
              </SelectContent>
            </Select>
            <Input type="file" multiple accept=".pdf,image/*" disabled={anexar.isPending} aria-label="Escolher arquivo"
              onChange={(e) => { const f = e.target.files; enviar(f).finally(() => { e.target.value = ""; }); }} />
          </div>
          {anexar.isPending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</p>}
          <p className="text-xs text-muted-foreground">A CAT anexada aqui também aparece na Ficha do Colaborador (Espaço do Colaborador), na aba Acidentes.</p>
        </div>
      )}
      {docs.length === 0 ? <Vazio>Nenhum arquivo anexado.</Vazio> : (
        <ul className="space-y-2 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Badge variant="outline" className={cn(d.categoria === "cat" && "border-sky-400 text-sky-800")}>{d.categoria === "cat" ? "CAT" : "Outro"}</Badge>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-primary underline-offset-2 hover:underline"
                onClick={() => abrirAnexoAcidente(d).catch(avisarErro)}>{d.nome}</button>
              <span className="text-xs text-muted-foreground">{fmtData(d.created_at)} · {fmtTamanho(d.tamanho)}</span>
              {podeAlterar && (
                <Button type="button" variant="ghost" size="sm" aria-label={`Remover ${d.nome}`} onClick={() => remover.mutateAsync(d.id).catch(avisarErro)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AbaAfastamento({ a, lista, podeAlterar }: { a: Acidente; lista: AfastamentoSugerido[]; podeAlterar: boolean }) {
  const ligar = useLigarAfastamento();
  const agir = (x: AfastamentoSugerido) => ligar.mutateAsync({ id: a.id, origem: x.origem, afastamentoId: x.ligado ? null : x.id })
    .then(() => toast.success(x.ligado ? "Afastamento desligado." : "Afastamento ligado ao acidente."), avisarErro);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Atestados (Afastamentos e Telemedicina) e casos do Controle de Afastamentos da mesma pessoa, de 3 dias antes a 30 dias depois do acidente.
        Ligar marca "houve afastamento" e, se os dias estiverem em branco, traz os dias do atestado. Nada é criado nem alterado nas telas de afastamento.
      </p>
      {!a.vinculado ? <Vazio>Ligue o registro a um colaborador (aba Dados) para ver os afastamentos dele.</Vazio>
        : lista.length === 0 ? <Vazio>Nenhum afastamento desta pessoa perto da data do acidente.</Vazio> : (
          <ul className="space-y-2">
            {lista.map((x) => (
              <li key={`${x.origem}-${x.id}`} className={cn("flex flex-wrap items-center gap-2 rounded-md border px-3 py-2", x.ligado && "border-sky-400 bg-sky-50")}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{x.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    Início {fmtData(x.data_inicio)}
                    {x.dias != null && (x.origem === "atestado" ? ` · ${x.dias} dia(s)` : ` · ${x.dias} dia(s) até agora`)}
                  </p>
                </div>
                {x.ligado && <Badge variant="outline" className="border-sky-400 text-sky-800">Ligado</Badge>}
                {podeAlterar && (
                  <Button size="sm" variant="outline" onClick={() => agir(x)} disabled={ligar.isPending}>
                    {x.ligado ? <><Unlink className="mr-2 h-4 w-4" /> Desligar</> : <><Link2 className="mr-2 h-4 w-4" /> Ligar</>}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

// ── Peças ───────────────────────────────────────────────────────────────
function Campos({ form, setForm, encarregados, disabled }: {
  form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>; encarregados: string[]; disabled?: boolean;
}) {
  const { data: contratos = [] } = useContratosAcidente();
  const campo = <K extends keyof Form>(c: K, v: Form[K]) => setForm((f) => ({ ...f, [c]: v }));
  const opcoesContrato = useMemo(() => contratos.map((c) => ({ value: c.id, label: c.nome, hint: c.encerrado ? "encerrado" : undefined, muted: c.encerrado })), [contratos]);
  const empresas = useMemo(() => [...new Set([...EMPRESAS, ...(form.empresa ? [form.empresa] : [])])], [form.empresa]);
  const afastou = form.houve_afastamento === "sim";
  const listaEnc = useRef(`acid-enc-${Math.random().toString(36).slice(2)}`).current;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Data do acidente
          <Input type="date" className="mt-1 font-normal" value={form.data_acidente} max={hojeIso()} disabled={disabled}
            onChange={(e) => campo("data_acidente", e.target.value)} />
        </label>
        <div>
          <Label>Tipo de acidente</Label>
          <Select value={form.tipo || NENHUM} onValueChange={(v) => campo("tipo", v === NENHUM ? "" : v)} disabled={disabled}>
            <SelectTrigger className="mt-1" aria-label="Tipo de acidente"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Não informado</SelectItem>
              {(Object.keys(ROTULO_TIPO) as TipoAcidente[]).map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Empresa</Label>
          <Select value={form.empresa || NENHUM} onValueChange={(v) => campo("empresa", v === NENHUM ? "" : v)} disabled={disabled}>
            <SelectTrigger className="mt-1" aria-label="Empresa"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Não informada</SelectItem>
              {empresas.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Contrato</Label>
          <SearchableSelect value={form.contrato_id} onChange={(v) => campo("contrato_id", v)} options={opcoesContrato} disabled={disabled}
            allowClear clearValue="" placeholder="Escolha o contrato" searchPlaceholder="Buscar contrato…" triggerClassName="mt-1 w-full" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`${listaEnc}-in`}>Encarregado</Label>
          <Input id={`${listaEnc}-in`} list={listaEnc} className="mt-1" value={form.encarregado} disabled={disabled}
            placeholder={encarregados.length ? "Escolha da lista ou digite" : "Nome do encarregado"} onChange={(e) => campo("encarregado", e.target.value)} />
          <datalist id={listaEnc}>{encarregados.map((n) => <option key={n} value={n} />)}</datalist>
          {encarregados.length > 0 && (
            <span className="mt-1 block text-xs text-muted-foreground">Sugestões: o superior no Organograma e os encarregados/supervisores da mesma filial.</span>
          )}
        </div>
      </div>
      <div>
        <Label htmlFor="acid-desc">Descrição do ocorrido</Label>
        <Textarea id="acid-desc" className="mt-1" rows={3} value={form.descricao} disabled={disabled} onChange={(e) => campo("descricao", e.target.value)}
          placeholder="O que aconteceu, onde e como" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SimNao rotulo="Houve afastamento?" valor={form.houve_afastamento} disabled={disabled}
          aoMudar={(v) => setForm((f) => ({ ...f, houve_afastamento: v, ...(v === "nao" ? { dias_afastamento: "", encaminhado_inss: "nao" as const } : {}) }))} />
        <label className="block text-sm font-medium">
          Dias de afastamento
          <Input type="number" min={0} className="mt-1 font-normal" value={form.dias_afastamento} disabled={disabled || !afastou}
            onChange={(e) => campo("dias_afastamento", e.target.value)} />
        </label>
        <SimNao rotulo="Encaminhado ao INSS?" valor={form.encaminhado_inss} disabled={disabled || !afastou} aoMudar={(v) => campo("encaminhado_inss", v)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>CAT emitida?</Label>
          <Select value={form.cat_emitida || NENHUM} onValueChange={(v) => campo("cat_emitida", (v === NENHUM ? "" : v) as Form["cat_emitida"])} disabled={disabled}>
            <SelectTrigger className="mt-1" aria-label="CAT emitida"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Ainda não informado</SelectItem>
              <SelectItem value="sim">Sim</SelectItem>
              <SelectItem value="nao">Não</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.cat_emitida === "sim" && (
          <label className="block text-sm font-medium sm:col-span-2">
            Número da CAT
            <Input className="mt-1 font-normal" value={form.numero_cat} disabled={disabled} placeholder="Ex.: ID1036440090000002024031111362"
              onChange={(e) => campo("numero_cat", e.target.value)} />
          </label>
        )}
        {form.cat_emitida === "nao" && (
          <label className="block text-sm font-medium sm:col-span-2">
            Por que a CAT não foi emitida?
            <Input className="mt-1 font-normal" value={form.cat_motivo_sem} disabled={disabled} onChange={(e) => campo("cat_motivo_sem", e.target.value)} />
          </label>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={form.morte_invalidez} disabled={disabled} onCheckedChange={(v) => campo("morte_invalidez", v === true)} /> Houve morte ou invalidez
      </label>
      <div>
        <Label htmlFor="acid-obs">Observações</Label>
        <Textarea id="acid-obs" className="mt-1" rows={2} value={form.observacoes} disabled={disabled} onChange={(e) => campo("observacoes", e.target.value)} />
      </div>
    </div>
  );
}

function SimNao({ rotulo, valor, aoMudar, disabled }: { rotulo: string; valor: "sim" | "nao"; aoMudar: (v: "sim" | "nao") => void; disabled?: boolean }) {
  return (
    <div>
      <Label>{rotulo}</Label>
      <Select value={valor} onValueChange={(v) => aoMudar(v as "sim" | "nao")} disabled={disabled}>
        <SelectTrigger className="mt-1" aria-label={rotulo}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="sim">Sim</SelectItem>
          <SelectItem value="nao">Não</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** Nome ou CPF; desligados aparecem (o acidente pode ser lançado depois da saída), marcados. */
export function BuscaColaborador({ escolhido, onEscolher }: { escolhido: ColaboradorAcidente | null; onEscolher: (c: ColaboradorAcidente | null) => void }) {
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<ColaboradorAcidente[]>([]);
  useEffect(() => {
    if (escolhido || busca.trim().length < 3) { setLista([]); return; }
    let vivo = true;
    const t = setTimeout(() => {
      buscarColaboradoresAcidente(busca).then((r) => { if (vivo) setLista(r); }, avisarErro);
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca, escolhido]);

  return (
    <div>
      <Label htmlFor="acid-colab">Colaborador</Label>
      {escolhido ? (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <span>{escolhido.nome} · {escolhido.cargo ?? "Sem função"} · {escolhido.filial ?? "Sem filial"}{escolhido.desligado ? " · desligado" : ""}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => { onEscolher(null); setBusca(""); }}>Trocar</Button>
        </div>
      ) : (
        <>
          <Input id="acid-colab" className="mt-1" placeholder="Nome ou CPF (mín. 3 letras)" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {lista.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border">
              {lista.map((c) => (
                <li key={c.id}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { onEscolher(c); setBusca(""); }}>
                    <span className="font-medium">{c.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.desligado ? "Desligado" : c.situacao ?? "—"} · {c.cargo ?? "Sem função"} · {c.filial ?? "Sem filial"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export const SeloConclusao = ({ concluido }: { concluido: boolean }) => (
  <Badge variant="outline" className={concluido ? "border-emerald-400 text-emerald-800" : "border-amber-400 text-amber-800"}>
    {concluido ? "Concluído" : "Em aberto"}
  </Badge>
);

const Vazio = ({ children }: { children: React.ReactNode }) => <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
