import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  abrirDocumentoControle, useAnexarDocumento, useFichaControle, useRemoverDocumento, useRemoverRecurso,
  useSalvarContato, useSalvarControle, useSalvarRecurso, type FichaControle,
} from "@/hooks/useControleAfastamentos";
import { fmtTamanho } from "@/lib/solicitacoes/anexos";
import {
  COMUNICACOES, DOC_CATEGORIAS, MOTIVOS, RECURSO_SITUACOES, ROTULO_ALERTA, STATUS, STATUS_ASO, alertaRetorno, diasAfastados, fmtData, hojeIso,
  pendenciasDocumentais, possivelLimbo, type CategoriaDoc, type ControleItem,
} from "@/lib/sst/controleAfastamentos";

// =====================================================================
// Ficha do Controle de Afastamentos (mig 20261105030000): dados e benefício,
// contatos, ASO de retorno, recursos, documentos e histórico.
// =====================================================================

const avisarErro = (e: unknown) => toast.error((e as Error).message);
const CAMPOS_FORM = [
  "motivo", "data_inicio", "data_prevista_retorno", "data_retorno_real", "status", "comunicacao_beneficio", "beneficio_encerrado_em",
  "aposentado_afastado", "aposentado_no_vinculo", "aposentadoria_em", "aso_necessario", "aso_solicitado_em", "aso_agendado_em",
  "aso_clinica", "aso_realizado", "aso_recebido_em", "aso_resultado", "observacao",
] as const;
type Form = Record<(typeof CAMPOS_FORM)[number], string | boolean | null>;

/** A ficha como o item da lista, para os alertas usarem a mesma conta. */
const itemDaFicha = (f: FichaControle): ControleItem => ({
  ...f, recursos: f.recursos.map((r) => ({ instancia: r.instancia, situacao: r.situacao })), doc_categorias: f.documentos.map((d) => d.categoria),
});

export function FichaControleDialog({ id, podeAlterar, onFechar }: { id: number; podeAlterar: boolean; onFechar: () => void }) {
  const { data: ficha, isLoading } = useFichaControle(id);
  const salvar = useSalvarControle();
  const [form, setForm] = useState<Form | null>(null);

  // Só relê o formulário ao abrir e depois de salvar (o banco pode ter mudado o
  // status do ASO). Registrar um contato ou documento recarrega a ficha, e isso
  // não pode apagar o que está sendo digitado nas outras abas.
  const reler = useRef(true);
  useEffect(() => {
    if (!ficha || !reler.current) return;
    reler.current = false;
    setForm(Object.fromEntries(CAMPOS_FORM.map((c) => [c, ficha[c] ?? ""])) as Form);
  }, [ficha]);

  const campo = (c: keyof Form, v: string | boolean) => setForm((f) => (f ? { ...f, [c]: v } : f));
  const texto = (c: keyof Form) => String(form?.[c] ?? "");
  const gravar = () => {
    reler.current = true;
    return salvar.mutateAsync({ id, ...form }).then(() => toast.success("Afastamento salvo."), (e) => { reler.current = false; avisarErro(e); });
  };

  const item = ficha ? itemDaFicha(ficha) : null;
  const alerta = item ? alertaRetorno(item) : null;
  const limbo = item ? possivelLimbo(item) : null;
  const pendencias = item ? pendenciasDocumentais(item) : [];
  const voltouNaSenior = ficha?.senior_situacao === "Trabalhando" && !["Retornado", "Afastamento encerrado"].includes(ficha.status);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ficha?.nome ?? "Afastamento"}</DialogTitle>
          <DialogDescription>
            {ficha ? `${ficha.contrato_nome ?? ficha.filial_nome ?? "Sem contrato"} · ${ficha.funcao ?? "Sem função"} · ${diasAfastados(ficha)} dia(s) afastado(s)` : "Carregando…"}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !ficha || !form ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{ficha.status}</Badge>
              {alerta && <Badge className={alerta === "atingida" ? "bg-red-600" : alerta === "3d" ? "bg-orange-500" : "bg-amber-500"}>{ROTULO_ALERTA[alerta]}</Badge>}
              {ficha.origem === "senior" && <Badge variant="outline">Trazido da Senior</Badge>}
            </div>
            {limbo && <Aviso titulo="Possível limbo previdenciário">{limbo}</Aviso>}
            {voltouNaSenior && <Aviso titulo="A Senior mostra Trabalhando">Confirme o retorno e o ASO: este controle não marca o retorno sozinho.</Aviso>}
            {pendencias.length > 0 && <Aviso titulo="Pendências documentais">{pendencias.join("; ")}.</Aviso>}

            <Tabs defaultValue="dados">
              <TabsList className="flex h-auto flex-wrap justify-start">
                <TabsTrigger value="dados">Dados e benefício</TabsTrigger>
                <TabsTrigger value="contato">Contato ({ficha.contatos.length})</TabsTrigger>
                <TabsTrigger value="aso">ASO de retorno</TabsTrigger>
                <TabsTrigger value="recursos">Recursos ({ficha.recursos.length})</TabsTrigger>
                <TabsTrigger value="documentos">Documentos ({ficha.documentos.length})</TabsTrigger>
                <TabsTrigger value="historico">Histórico</TabsTrigger>
              </TabsList>

              <TabsContent value="dados" className="space-y-4 pt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Lista rotulo="Status" valor={texto("status")} opcoes={STATUS} aoMudar={(v) => campo("status", v)} disabled={!podeAlterar} />
                  <Lista rotulo="Motivo do afastamento" valor={texto("motivo")} opcoes={comAtual(MOTIVOS, texto("motivo"))} aoMudar={(v) => campo("motivo", v)} disabled={!podeAlterar} />
                  <Data rotulo="Data de início" valor={texto("data_inicio")} aoMudar={(v) => campo("data_inicio", v)} disabled={!podeAlterar} />
                  <Data rotulo="Data prevista de retorno" valor={texto("data_prevista_retorno")} aoMudar={(v) => campo("data_prevista_retorno", v)} disabled={!podeAlterar} />
                  <Data rotulo="Data do retorno" valor={texto("data_retorno_real")} aoMudar={(v) => campo("data_retorno_real", v)} disabled={!podeAlterar} />
                </div>

                <Secao titulo="Benefício">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Lista rotulo="Comunicação de Benefício" valor={texto("comunicacao_beneficio")} opcoes={COMUNICACOES} aoMudar={(v) => campo("comunicacao_beneficio", v)} disabled={!podeAlterar} />
                    <Data rotulo="Benefício encerrado em" ajuda="Com retorno em aberto, sinaliza possível limbo." valor={texto("beneficio_encerrado_em")} aoMudar={(v) => campo("beneficio_encerrado_em", v)} disabled={!podeAlterar} />
                  </div>
                </Secao>

                <Secao titulo="Situações especiais">
                  <Marca rotulo="Colaborador aposentado e afastado" valor={!!form.aposentado_afastado} aoMudar={(v) => campo("aposentado_afastado", v)} disabled={!podeAlterar} />
                  <Marca rotulo="Colaborador que se aposentou durante o vínculo com a empresa" valor={!!form.aposentado_no_vinculo} aoMudar={(v) => campo("aposentado_no_vinculo", v)} disabled={!podeAlterar} />
                  {(form.aposentado_afastado || form.aposentado_no_vinculo) && (
                    <div className="sm:w-1/2"><Data rotulo="Data da aposentadoria" valor={texto("aposentadoria_em")} aoMudar={(v) => campo("aposentadoria_em", v)} disabled={!podeAlterar} /></div>
                  )}
                  <p className="text-xs text-muted-foreground">Recursos ao INSS e judiciais ficam na aba Recursos.</p>
                </Secao>

                <div>
                  <Label htmlFor="ctrl-obs">Observações</Label>
                  <Textarea id="ctrl-obs" className="mt-1" value={texto("observacao")} disabled={!podeAlterar} onChange={(e) => campo("observacao", e.target.value)} />
                </div>
                {podeAlterar && <Salvar onClick={gravar} salvando={salvar.isPending} />}
              </TabsContent>

              <TabsContent value="contato" className="pt-3"><AbaContato ficha={ficha} podeAlterar={podeAlterar} /></TabsContent>

              <TabsContent value="aso" className="space-y-4 pt-3">
                <Marca rotulo="ASO de retorno necessário" valor={!!form.aso_necessario} aoMudar={(v) => campo("aso_necessario", v)} disabled={!podeAlterar} />
                {form.aso_necessario && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Enquanto o ASO não estiver realizado e com resultado, o status fica em "{STATUS_ASO}".
                      Apto passa para "Aguardando retorno"; inapto volta para "Afastado".
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Data rotulo="Data da solicitação do exame" valor={texto("aso_solicitado_em")} aoMudar={(v) => campo("aso_solicitado_em", v)} disabled={!podeAlterar} />
                      <Data rotulo="Data agendada" valor={texto("aso_agendado_em")} aoMudar={(v) => campo("aso_agendado_em", v)} disabled={!podeAlterar} />
                      <div>
                        <Label htmlFor="ctrl-clinica">Clínica responsável</Label>
                        <Input id="ctrl-clinica" className="mt-1" value={texto("aso_clinica")} disabled={!podeAlterar} onChange={(e) => campo("aso_clinica", e.target.value)} />
                      </div>
                      <Data rotulo="Recebido em" valor={texto("aso_recebido_em")} aoMudar={(v) => campo("aso_recebido_em", v)} disabled={!podeAlterar} />
                    </div>
                    <Marca rotulo="ASO realizado / recebido" valor={!!form.aso_realizado} aoMudar={(v) => campo("aso_realizado", v)} disabled={!podeAlterar} />
                    {form.aso_realizado && (
                      <div className="sm:w-1/2">
                        <Lista rotulo="Resultado" valor={texto("aso_resultado")} opcoes={["apto", "inapto"]} aoMudar={(v) => campo("aso_resultado", v)} disabled={!podeAlterar} />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">O documento do ASO é anexado na aba Documentos, categoria "ASO de retorno".</p>
                  </>
                )}
                {podeAlterar && <Salvar onClick={gravar} salvando={salvar.isPending} />}
              </TabsContent>

              <TabsContent value="recursos" className="pt-3"><AbaRecursos ficha={ficha} podeAlterar={podeAlterar} /></TabsContent>
              <TabsContent value="documentos" className="pt-3"><AbaDocumentos ficha={ficha} podeAlterar={podeAlterar} /></TabsContent>

              <TabsContent value="historico" className="pt-3">
                <ul className="space-y-2 text-sm">
                  {ficha.eventos.map((e) => (
                    <li key={e.id} className="rounded-md border px-3 py-2">
                      <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("pt-BR")} · {e.autor_nome ?? "Sistema"}</span>
                      <p>{e.descricao}</p>
                    </li>
                  ))}
                </ul>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AbaContato({ ficha, podeAlterar }: { ficha: FichaControle; podeAlterar: boolean }) {
  const salvar = useSalvarContato();
  const [data, setData] = useState(hojeIso());
  const [obs, setObs] = useState("");
  const [retorno, setRetorno] = useState("");
  const registrar = () => salvar.mutateAsync({ id: ficha.id, data, obs, retorno: retorno || null }).then(() => {
    setObs(""); setRetorno(""); toast.success("Contato registrado.");
  }, avisarErro);
  return (
    <div className="space-y-4">
      {podeAlterar && (
        <Secao titulo="Registrar contato">
          <div className="grid gap-3 sm:grid-cols-2">
            <Data rotulo="Data do contato" valor={data} aoMudar={setData} />
            <Data rotulo="Data informada para possível retorno" valor={retorno} aoMudar={setRetorno} />
          </div>
          <div>
            <Label htmlFor="ctrl-contato">Observação do contato</Label>
            <Textarea id="ctrl-contato" className="mt-1" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
          <Salvar onClick={registrar} salvando={salvar.isPending} rotulo="Registrar contato" />
        </Secao>
      )}
      {ficha.contatos.length === 0 ? <Vazio>Nenhum contato registrado.</Vazio> : (
        <ul className="space-y-2 text-sm">
          {ficha.contatos.map((c) => (
            <li key={c.id} className="rounded-md border px-3 py-2">
              <p className="font-medium">{fmtData(c.data_contato)}{c.retorno_informado_em ? ` · possível retorno em ${fmtData(c.retorno_informado_em)}` : ""}</p>
              <p className="whitespace-pre-wrap">{c.observacao}</p>
              <p className="text-xs text-muted-foreground">{c.autor_nome}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AbaRecursos({ ficha, podeAlterar }: { ficha: FichaControle; podeAlterar: boolean }) {
  const salvar = useSalvarRecurso();
  const remover = useRemoverRecurso();
  const VAZIO = { instancia: "inss", tipo: "", situacao: "em_andamento", protocolo: "", data_recurso: "", observacao: "" };
  const [novo, setNovo] = useState(VAZIO);
  const adicionar = () => salvar.mutateAsync({ afastamento_id: ficha.id, ...novo }).then(() => { setNovo(VAZIO); toast.success("Recurso registrado."); }, avisarErro);
  const rotuloSituacao = (v: string) => RECURSO_SITUACOES.find((s) => s.valor === v)?.rotulo ?? v;
  return (
    <div className="space-y-4">
      {podeAlterar && (
        <Secao titulo="Novo recurso">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Recurso</Label>
              <Select value={novo.instancia} onValueChange={(v) => setNovo({ ...novo, instancia: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="inss">Administrativo ao INSS</SelectItem><SelectItem value="judicial">Judicial</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ctrl-rec-tipo">Tipo</Label>
              <Input id="ctrl-rec-tipo" className="mt-1" value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })} />
            </div>
            <div>
              <Label>Situação</Label>
              <Select value={novo.situacao} onValueChange={(v) => setNovo({ ...novo, situacao: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{RECURSO_SITUACOES.map((s) => <SelectItem key={s.valor} value={s.valor}>{s.rotulo}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Data rotulo="Data" valor={novo.data_recurso} aoMudar={(v) => setNovo({ ...novo, data_recurso: v })} />
            <div>
              <Label htmlFor="ctrl-rec-prot">Protocolo / processo</Label>
              <Input id="ctrl-rec-prot" className="mt-1" value={novo.protocolo} onChange={(e) => setNovo({ ...novo, protocolo: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ctrl-rec-obs">Observação</Label>
              <Input id="ctrl-rec-obs" className="mt-1" value={novo.observacao} onChange={(e) => setNovo({ ...novo, observacao: e.target.value })} />
            </div>
          </div>
          <Salvar onClick={adicionar} salvando={salvar.isPending} rotulo="Adicionar recurso" />
        </Secao>
      )}
      {ficha.recursos.length === 0 ? <Vazio>Nenhum recurso registrado.</Vazio> : (
        <ul className="space-y-2 text-sm">
          {ficha.recursos.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.instancia === "inss" ? "INSS" : "Judicial"} · {r.tipo}</p>
                <p className="text-xs text-muted-foreground">
                  {[r.protocolo, r.data_recurso && fmtData(r.data_recurso), r.observacao].filter(Boolean).join(" · ")}
                </p>
              </div>
              {podeAlterar ? (
                <Select value={r.situacao} onValueChange={(v) => salvar.mutateAsync({ ...r, situacao: v }).catch(avisarErro)}>
                  <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{RECURSO_SITUACOES.map((s) => <SelectItem key={s.valor} value={s.valor}>{s.rotulo}</SelectItem>)}</SelectContent>
                </Select>
              ) : <Badge variant="outline">{rotuloSituacao(r.situacao)}</Badge>}
              {podeAlterar && (
                <Button type="button" variant="ghost" size="sm" aria-label={`Remover recurso ${r.tipo}`} onClick={() => remover.mutateAsync(r.id).catch(avisarErro)}>
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

function AbaDocumentos({ ficha, podeAlterar }: { ficha: FichaControle; podeAlterar: boolean }) {
  const anexar = useAnexarDocumento();
  const remover = useRemoverDocumento();
  const [categoria, setCategoria] = useState<CategoriaDoc>("atestado");
  const enviar = async (lista: FileList | null) => {
    for (const arquivo of Array.from(lista ?? [])) {
      await anexar.mutateAsync({ id: ficha.id, categoria, arquivo }).then(() => toast.success(`${arquivo.name} anexado.`), avisarErro);
    }
  };
  const rotulo = (c: string) => DOC_CATEGORIAS.find((d) => d.valor === c)?.rotulo ?? c;
  return (
    <div className="space-y-4">
      {podeAlterar && (
        <Secao titulo="Anexar documento">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Categoria</Label>
              <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaDoc)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_CATEGORIAS.map((d) => <SelectItem key={d.valor} value={d.valor}>{d.rotulo}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ctrl-doc">Arquivo (até 25 MB)</Label>
              <Input id="ctrl-doc" type="file" multiple className="mt-1" disabled={anexar.isPending}
                onChange={(e) => { const f = e.target.files; enviar(f).finally(() => { e.target.value = ""; }); }} />
            </div>
          </div>
          {anexar.isPending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</p>}
        </Secao>
      )}
      {ficha.documentos.length === 0 ? <Vazio>Nenhum documento anexado.</Vazio> : (
        <ul className="space-y-2 text-sm">
          {ficha.documentos.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <button type="button" className="min-w-0 flex-1 truncate text-left text-primary underline-offset-2 hover:underline"
                onClick={() => abrirDocumentoControle(d).catch(avisarErro)}>{d.nome}</button>
              <Badge variant="outline">{rotulo(d.categoria)}</Badge>
              <span className="text-xs text-muted-foreground">{fmtTamanho(d.tamanho)}</span>
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

const comAtual = (lista: readonly string[], atual: string): string[] => (atual && !lista.includes(atual) ? [atual, ...lista] : [...lista]);

function Lista({ rotulo, valor, opcoes, aoMudar, disabled }: { rotulo: string; valor: string; opcoes: readonly string[]; aoMudar: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <Label>{rotulo}</Label>
      <Select value={valor} onValueChange={aoMudar} disabled={disabled}>
        <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>{opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function Data({ rotulo, valor, aoMudar, disabled, ajuda }: { rotulo: string; valor: string; aoMudar: (v: string) => void; disabled?: boolean; ajuda?: string }) {
  return (
    <label className="block text-sm font-medium">
      {rotulo}
      <Input type="date" className="mt-1 font-normal" value={valor} disabled={disabled} onChange={(e) => aoMudar(e.target.value)} />
      {ajuda && <span className="mt-1 block text-xs font-normal text-muted-foreground">{ajuda}</span>}
    </label>
  );
}

function Marca({ rotulo, valor, aoMudar, disabled }: { rotulo: string; valor: boolean; aoMudar: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={valor} disabled={disabled} onCheckedChange={(v) => aoMudar(v === true)} /> {rotulo}
    </label>
  );
}

const Secao = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div className="space-y-3 rounded-lg border p-3"><h3 className="text-sm font-semibold">{titulo}</h3>{children}</div>
);
const Aviso = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p><span className="font-semibold">{titulo}:</span> {children}</p>
  </div>
);
const Vazio = ({ children }: { children: React.ReactNode }) => <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
const Salvar = ({ onClick, salvando, rotulo = "Salvar" }: { onClick: () => void; salvando: boolean; rotulo?: string }) => (
  <div className="flex justify-end">
    <Button type="button" onClick={onClick} disabled={salvando}>{salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{rotulo}</Button>
  </div>
);
