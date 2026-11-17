import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  abrirLaudo, alvoDe, useAnexarLaudo, useFichaToxico, useRegistrarAcompanhamento, useRegistrarExame, useRemoverLaudo, useSalvarToxico,
  type DocToxico,
} from "@/hooks/useExamesToxicologicos";
import { fmtTamanho } from "@/lib/solicitacoes/anexos";
import {
  CATEGORIAS_CNH, MESES_VALIDADE, cnhExibida, fmtData, hojeIso, responsavelExibido, validadeSugerida, type ItemToxico,
} from "@/lib/sst/exameToxicologico";
import { SeloSituacao } from "@/components/sst/SeloSituacaoToxico";

// =====================================================================
// Ficha do motorista nos Exames Toxicológicos (SIS-2026-0887): o exame novo
// (com o laudo), a cobrança ao encarregado, os dados, os laudos e o histórico.
// A pessoa sem exame ainda não tem registro: a primeira gravação o cria.
// =====================================================================

const avisarErro = (e: unknown) => toast.error((e as Error).message);
const SEM_CNH = "sem";
const CAMPOS = ["categoria_cnh", "local_trabalho", "responsavel", "clinica", "observacao", "data_ultimo_exame", "data_validade"] as const;
type Form = Record<(typeof CAMPOS)[number], string>;

export function FichaExameToxicologicoDialog({ item, podeAlterar, onFechar }: { item: ItemToxico; podeAlterar: boolean; onFechar: () => void }) {
  const { data: ficha } = useFichaToxico(item.toxicologico_id);
  const cnh = cnhExibida(item);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.nome}</DialogTitle>
          <DialogDescription>
            {[item.contrato_nome ?? "Sem contrato", item.local_trabalho, item.cargo ?? "Sem função", cnh.cnh && `CNH ${cnh.cnh}`].filter(Boolean).join(" · ")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SeloSituacao item={item} />
            {item.desligado && <Badge variant="outline">Desligado na Senior</Badge>}
            {!item.desligado && item.situacao_senior && item.situacao_senior !== "Trabalhando" && <Badge variant="outline">{item.situacao_senior}</Badge>}
            {!item.precisa_exame && <Badge variant="outline">Não precisa do exame (CNH {cnh.cnh ?? "A/B"})</Badge>}
          </div>

          <Tabs defaultValue={podeAlterar ? "exame" : "dados"}>
            <TabsList className="flex h-auto flex-wrap justify-start">
              {podeAlterar && <TabsTrigger value="exame">Registrar exame</TabsTrigger>}
              {podeAlterar && <TabsTrigger value="cobranca">Cobrança e contato</TabsTrigger>}
              <TabsTrigger value="dados">Dados</TabsTrigger>
              <TabsTrigger value="laudos">Laudos ({ficha?.documentos.length ?? item.documentos})</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>
            {podeAlterar && <TabsContent value="exame" className="pt-3"><AbaExame item={item} /></TabsContent>}
            {podeAlterar && <TabsContent value="cobranca" className="pt-3"><AbaCobranca item={item} /></TabsContent>}
            <TabsContent value="dados" className="pt-3"><AbaDados item={item} podeAlterar={podeAlterar} /></TabsContent>
            <TabsContent value="laudos" className="pt-3"><AbaLaudos item={item} docs={ficha?.documentos ?? []} podeAlterar={podeAlterar} /></TabsContent>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AbaExame({ item }: { item: ItemToxico }) {
  const registrar = useRegistrarExame();
  const anexar = useAnexarLaudo();
  const [exame, setExame] = useState(hojeIso());
  const [validade, setValidade] = useState(validadeSugerida(hojeIso()));
  const [clinica, setClinica] = useState("");
  const [laudo, setLaudo] = useState<File | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  // A validade acompanha a data do exame até alguém digitar outra.
  const [validadeDigitada, setValidadeDigitada] = useState(false);
  const mudarExame = (v: string) => { setExame(v); if (!validadeDigitada && v) setValidade(validadeSugerida(v)); };

  const salvar = async () => {
    try {
      const id = await registrar.mutateAsync({ ...alvoDe(item), data_exame: exame, data_validade: validade, clinica });
      if (laudo) await anexar.mutateAsync({ id, arquivo: laudo });
      toast.success(`Exame registrado: válido até ${fmtData(validade)}.`);
      setClinica(""); setLaudo(null); setValidadeDigitada(false);
      if (arquivo.current) arquivo.current.value = "";
    } catch (e) { avisarErro(e); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Exame atual: {item.data_validade ? `válido até ${fmtData(item.data_validade)}` : "nenhum registrado"}
        {item.data_ultimo_exame && ` (feito em ${fmtData(item.data_ultimo_exame)})`}.
      </p>
      <Secao titulo="Novo exame">
        <div className="grid gap-3 sm:grid-cols-2">
          <Data rotulo="Data do exame" valor={exame} aoMudar={mudarExame} />
          <Data rotulo="Nova data de validade" valor={validade} aoMudar={(v) => { setValidade(v); setValidadeDigitada(true); }}
            ajuda={`Sugestão: exame + ${MESES_VALIDADE} meses. Confira no laudo.`} />
          <div>
            <Label htmlFor="tox-clinica">Clínica / laboratório</Label>
            <Input id="tox-clinica" className="mt-1" value={clinica} onChange={(e) => setClinica(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tox-laudo">Laudo (PDF ou imagem, até 25 MB)</Label>
            <Input id="tox-laudo" ref={arquivo} type="file" accept=".pdf,image/*" className="mt-1" onChange={(e) => setLaudo(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Um exame mais antigo que o atual fica no histórico, mas não muda a validade.</p>
        <Salvar onClick={salvar} salvando={registrar.isPending || anexar.isPending} rotulo="Registrar exame" />
      </Secao>
    </div>
  );
}

function AbaCobranca({ item }: { item: ItemToxico }) {
  const registrar = useRegistrarAcompanhamento();
  const [cobranca, setCobranca] = useState(hojeIso());
  const [contato, setContato] = useState("");
  const [obs, setObs] = useState("");
  const resp = responsavelExibido(item);
  const salvar = () => registrar.mutateAsync({ ...alvoDe(item), data_cobranca: cobranca, data_contato: contato, observacao: obs })
    .then(() => { setObs(""); setContato(""); toast.success("Acompanhamento registrado."); }, avisarErro);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Responsável pela atualização: <span className="font-medium text-foreground">{resp.nome ?? "não informado"}</span>
        {resp.doOrganograma && " (superior no Organograma)"}.
        {" "}Última cobrança: {fmtData(item.ultima_cobranca_em)} · último contato: {fmtData(item.ultimo_contato_em)}.
      </p>
      <Secao titulo="Registrar cobrança / contato">
        <div className="grid gap-3 sm:grid-cols-2">
          <Data rotulo="Data da cobrança ao encarregado" valor={cobranca} aoMudar={setCobranca} />
          <Data rotulo="Data do último contato" valor={contato} aoMudar={setContato} />
        </div>
        <div>
          <Label htmlFor="tox-obs-cob">Observação</Label>
          <Textarea id="tox-obs-cob" className="mt-1" value={obs} onChange={(e) => setObs(e.target.value)}
            placeholder="Ex.: encarregado avisou que o colaborador faz o exame na próxima semana" />
        </div>
        <Salvar onClick={salvar} salvando={registrar.isPending} rotulo="Registrar" />
      </Secao>
    </div>
  );
}

function AbaDados({ item, podeAlterar }: { item: ItemToxico; podeAlterar: boolean }) {
  const salvar = useSalvarToxico();
  const doItem = (): Form => Object.fromEntries(CAMPOS.map((c) => [c, String(item[c] ?? "")])) as Form;
  const [form, setForm] = useState<Form>(doItem);
  // Acompanha o que o banco devolve (depois de salvar, ou de um exame novo em
  // outra aba); cobrança e laudo não mexem nestes campos.
  const assinatura = CAMPOS.map((c) => item[c] ?? "").join("|");
  useEffect(() => setForm(doItem()), [assinatura]); // eslint-disable-line react-hooks/exhaustive-deps
  const campo = (c: keyof Form, v: string) => setForm((f) => ({ ...f, [c]: v }));
  const sugestao = item.superior_organograma ? `Organograma: ${item.superior_organograma}` : "Quem o SST cobra";
  const gravar = () => salvar.mutateAsync({ ...alvoDe(item), ...form }).then(() => toast.success("Dados salvos."), avisarErro);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Categoria da CNH</Label>
          <Select value={form.categoria_cnh || SEM_CNH} onValueChange={(v) => campo("categoria_cnh", v === SEM_CNH ? "" : v)} disabled={!podeAlterar}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_CNH}>Não informada{item.cnh_do_cargo ? ` (cargo diz ${item.cnh_do_cargo})` : ""}</SelectItem>
              {CATEGORIAS_CNH.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="mt-1 block text-xs text-muted-foreground">C, D ou E precisam do exame. A ou B saem da contagem.</span>
        </div>
        <Texto id="tox-local" rotulo="Local de trabalho" valor={form.local_trabalho} aoMudar={(v) => campo("local_trabalho", v)} disabled={!podeAlterar} />
        <Texto id="tox-resp" rotulo="Responsável pela atualização" valor={form.responsavel} aoMudar={(v) => campo("responsavel", v)}
          disabled={!podeAlterar} placeholder={sugestao} />
        <Texto id="tox-cli" rotulo="Clínica / laboratório" valor={form.clinica} aoMudar={(v) => campo("clinica", v)} disabled={!podeAlterar} />
        <Data rotulo="Data do último exame" valor={form.data_ultimo_exame} aoMudar={(v) => campo("data_ultimo_exame", v)} disabled={!podeAlterar} />
        <Data rotulo="Data de validade" valor={form.data_validade} aoMudar={(v) => campo("data_validade", v)} disabled={!podeAlterar}
          ajuda="Para corrigir um erro. Exame novo vai em Registrar exame." />
      </div>
      <div>
        <Label htmlFor="tox-obs">Observação</Label>
        <Textarea id="tox-obs" className="mt-1" value={form.observacao} disabled={!podeAlterar} onChange={(e) => campo("observacao", e.target.value)} />
      </div>
      {podeAlterar && <Salvar onClick={gravar} salvando={salvar.isPending} />}
    </div>
  );
}

function AbaLaudos({ item, docs, podeAlterar }: { item: ItemToxico; docs: DocToxico[]; podeAlterar: boolean }) {
  const anexar = useAnexarLaudo();
  const remover = useRemoverLaudo();
  const id = item.toxicologico_id;
  const enviar = async (lista: FileList | null) => {
    if (id == null) return;
    for (const arquivo of Array.from(lista ?? [])) {
      await anexar.mutateAsync({ id, arquivo }).then(() => toast.success(`${arquivo.name} anexado.`), avisarErro);
    }
  };
  return (
    <div className="space-y-4">
      {podeAlterar && (id == null ? (
        <p className="text-sm text-muted-foreground">Registre o exame (o laudo pode ir junto) para anexar arquivos.</p>
      ) : (
        <Secao titulo="Anexar laudo">
          <Input type="file" multiple accept=".pdf,image/*" disabled={anexar.isPending} aria-label="Anexar laudo"
            onChange={(e) => { const f = e.target.files; enviar(f).finally(() => { e.target.value = ""; }); }} />
          {anexar.isPending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</p>}
        </Secao>
      ))}
      {docs.length === 0 ? <Vazio>Nenhum laudo anexado.</Vazio> : (
        <ul className="space-y-2 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <button type="button" className="min-w-0 flex-1 truncate text-left text-primary underline-offset-2 hover:underline"
                onClick={() => abrirLaudo(d).catch(avisarErro)}>{d.nome}</button>
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

function Texto({ id, rotulo, valor, aoMudar, disabled, placeholder }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <div>
      <Label htmlFor={id}>{rotulo}</Label>
      <Input id={id} className="mt-1" value={valor} disabled={disabled} placeholder={placeholder} onChange={(e) => aoMudar(e.target.value)} />
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

const Secao = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div className="space-y-3 rounded-lg border p-3"><h3 className="text-sm font-semibold">{titulo}</h3>{children}</div>
);
const Vazio = ({ children }: { children: React.ReactNode }) => <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
const Salvar = ({ onClick, salvando, rotulo = "Salvar" }: { onClick: () => void; salvando: boolean; rotulo?: string }) => (
  <div className="flex justify-end">
    <Button type="button" onClick={onClick} disabled={salvando}>{salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{rotulo}</Button>
  </div>
);
