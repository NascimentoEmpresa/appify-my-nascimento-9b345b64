import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import {
  BUCKET_CONVENCOES, abrirAnexoConvencao, enviarAnexoConvencao, useSalvarConvencao,
  type Convencao, type ConvencaoInput,
} from "@/hooks/useConvencoes";
import { supabase } from "@/integrations/supabase/client";
import {
  BASES_CALCULO, BENEFICIOS_CCT, pendenciasConvencao, periodoEfetivo,
  type BaseCalculo, type DefBeneficio, type DescontoColaborador, type MapaBeneficios, type ModoLider,
  type Periodo, type ValorBeneficio,
} from "@/lib/licitacoes/convencoes";
import { IconeBeneficio } from "./IconeBeneficio";

// Cadastrar / Editar Convenção Coletiva (layout de referência do chamado):
// 1. Informações da Convenção · 2. Benefícios. Salvar com pendência é
// permitido — o cadastro fica "Pendente" e a lista avisa; o que não pode é
// vazio virar "Não contém".
//
// 03/11/2026: a tela concentra só a convenção e os benefícios. Saíram o
// contrato e os postos (o vínculo CCT → contrato/posto é na Planilha de
// Custo), o decreto municipal (cadastro próprio, FormDecreto) e o VT (vem do
// decreto). Convenção antiga que tinha contrato/decreto/VT guarda esses
// dados ao salvar — a tela só não os mostra mais.

export interface Anexo { path: string | null; nome: string | null; tamanho: number | null; novo?: File | null }

export const ANEXO_VAZIO: Anexo = { path: null, nome: null, tamanho: null, novo: null };
const MB = (n: number | null | undefined) => (n ? `${(n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : "");

export function Secao({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2.5 text-[15px] font-bold text-[#0f3171] dark:text-blue-300">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">{n}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

export function Campo({ label, obrigatorio, children, className }: { label: string; obrigatorio?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-xs font-medium text-foreground">{label}{obrigatorio && <span className="text-red-600"> *</span>}</label>
      {children}
    </div>
  );
}

export function CampoAnexo({ anexo, onEscolher, onRemover, somenteLeitura, rotulo }: {
  anexo: Anexo; onEscolher: (f: File) => void; onRemover: () => void; somenteLeitura?: boolean; rotulo: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const nome = anexo.novo?.name ?? anexo.nome;
  const tamanho = anexo.novo?.size ?? anexo.tamanho;
  if (!nome) {
    return somenteLeitura
      ? <p className="flex h-[52px] items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">Sem anexo</p>
      : (
        <>
          <button type="button" onClick={() => input.current?.click()}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-md border border-dashed text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary">
            <Upload className="h-4 w-4" /> Anexar {rotulo} (PDF)
          </button>
          <input ref={input} type="file" accept=".pdf,image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onEscolher(f); e.target.value = ""; }} />
        </>
      );
  }
  return (
    <div className="flex h-[52px] items-center gap-2.5 rounded-md border px-3">
      <span className="flex h-8 w-8 items-center justify-center rounded bg-red-50 text-red-600 dark:bg-red-950/40"><FileText className="h-4 w-4" /></span>
      <button type="button" disabled={!anexo.path} onClick={() => anexo.path && abrirAnexoConvencao(anexo.path).then((e) => e && toast.error(e))}
        className="min-w-0 flex-1 text-left disabled:cursor-default" title={anexo.path ? "Abrir o arquivo" : "Será enviado ao salvar"}>
        <p className="truncate text-xs font-medium text-foreground">{nome}</p>
        <p className="text-[11px] text-muted-foreground">{MB(tamanho)}{anexo.novo ? " · envia ao salvar" : ""}</p>
      </button>
      {!somenteLeitura && (
        <button type="button" onClick={onRemover} title="Remover anexo" className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export const PERIODO_LABEL: Record<Periodo, string> = { dia: "Por dia", mes: "Por mês" };

const GRADE = "grid grid-cols-[minmax(150px,1.2fr)_minmax(150px,1fr)_minmax(150px,1fr)_64px] items-center gap-2";

/** Percentual digitado (sem lista fixa), 0–100. */
function CampoPercentual({ valor, onChange, disabled }: { valor: number | null | undefined; onChange: (n: number | null) => void; disabled?: boolean }) {
  return (
    <div className="relative">
      <Input type="number" inputMode="decimal" min={0} max={100} step="0.01" value={valor ?? ""} disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        placeholder="0" className="h-8 pr-7 text-xs" />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
  );
}

function CampoBase({ valor, onChange, disabled }: { valor: BaseCalculo | null | undefined; onChange: (b: BaseCalculo) => void; disabled?: boolean }) {
  return (
    <Select value={valor ?? ""} onValueChange={(b) => onChange(b as BaseCalculo)} disabled={disabled}>
      <SelectTrigger className="h-8 text-xs" aria-label="Base de cálculo"><SelectValue placeholder="Base de cálculo" /></SelectTrigger>
      <SelectContent>{BASES_CALCULO.map((b) => <SelectItem key={b.valor} value={b.valor}>{b.nome}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function CampoModo({ valor, onChange, disabled }: { valor: ModoLider | null | undefined; onChange: (m: ModoLider) => void; disabled?: boolean }) {
  return (
    <Select value={valor ?? ""} onValueChange={(m) => onChange(m as ModoLider)} disabled={disabled}>
      <SelectTrigger className="h-8 w-[104px] shrink-0 text-xs"><SelectValue placeholder="Modo" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="valor">Valor</SelectItem>
        <SelectItem value="porcentagem">Porcentagem</SelectItem>
      </SelectContent>
    </Select>
  );
}

const Rotulo = ({ children }: { children: ReactNode }) => <div className="pl-7 text-[11px] font-medium text-muted-foreground">{children}</div>;

/** Uma linha da tabela de benefícios (Benefício | Valor | Tipo/Base | Não contém). */
function LinhaBeneficio({ def, v, onChange, somenteLeitura }: {
  def: DefBeneficio; v: ValorBeneficio; onChange: (v: ValorBeneficio) => void; somenteLeitura?: boolean;
}) {
  const off = somenteLeitura || !!v.nao_contem;
  const set = (p: Partial<ValorBeneficio>) => onChange({ ...v, ...p });
  const periodo = (
    def.periodos && def.periodos.length > 1 ? (
      <Select value={v.periodo ?? ""} onValueChange={(p) => set({ periodo: p as Periodo })} disabled={off}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>{def.periodos.map((p) => <SelectItem key={p} value={p}>{PERIODO_LABEL[p]}</SelectItem>)}</SelectContent>
      </Select>
    ) : (
      <div className="flex h-8 items-center rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">{PERIODO_LABEL[periodoEfetivo(def, v) ?? "mes"]}</div>
    )
  );
  const valor = (
    <CurrencyInput value={v.valor ? String(v.valor) : ""} onChange={(s) => set({ valor: s ? Number(s) : null })}
      disabled={off} className="h-8 text-xs" />
  );
  const percentual = <CampoPercentual valor={v.percentual} onChange={(n) => set({ percentual: n })} disabled={off} />;
  const base = <CampoBase valor={v.base} onChange={(b) => set({ base: b })} disabled={off} />;

  let colunas: ReactNode;
  let extra: ReactNode = null;
  if (def.tipo === "percentual") {
    colunas = <>{percentual}{base}</>;
  } else if (def.tipo === "lider") {
    colunas = (
      <>
        <div className="flex gap-1.5">
          <CampoModo valor={v.modo} disabled={off} onChange={(m) => set({ modo: m, valor: null, percentual: null, base: null })} />
          <div className="min-w-0 flex-1">
            {v.modo === "porcentagem" ? percentual : v.modo === "valor" ? valor
              : <div className="flex h-8 items-center rounded-md border bg-muted/40 px-2 text-[11px] text-muted-foreground">Escolha o modo</div>}
          </div>
        </div>
        {periodo}
      </>
    );
    // A base é sobre o que a porcentagem incide — no Valor não existe.
    if (v.modo === "porcentagem") extra = <div className={GRADE}><Rotulo>Base de cálculo</Rotulo><div className="col-span-2">{base}</div><span /></div>;
  } else {
    colunas = <>{valor}{periodo}</>;
    if (def.desconto) extra = <LinhaDesconto d={v.desconto ?? {}} onChange={(d) => set({ desconto: d })} desligado={off} somenteLeitura={somenteLeitura} nome={def.nome} />;
  }

  return (
    <div className={cn("space-y-1 py-1", v.nao_contem && "opacity-70")}>
      <div className={GRADE}>
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <IconeBeneficio chave={def.chave} tamanho="sm" />{def.nome}
        </div>
        {colunas}
        <div className="flex justify-center">
          <Checkbox checked={!!v.nao_contem} disabled={somenteLeitura} aria-label={`${def.nome}: não contém`}
            onCheckedChange={(c) => onChange(c ? { nao_contem: true } : { nao_contem: false })} />
        </div>
      </div>
      {extra}
    </div>
  );
}

/** VA: quanto é descontado do colaborador (valor ou porcentagem, ou "Não contém"). */
function LinhaDesconto({ d, onChange, desligado, somenteLeitura, nome }: {
  d: DescontoColaborador; onChange: (d: DescontoColaborador) => void; desligado: boolean; somenteLeitura?: boolean; nome: string;
}) {
  const off = desligado || !!d.nao_contem;
  return (
    <div className={GRADE}>
      <Rotulo>Desconto do colaborador</Rotulo>
      <div className="flex gap-1.5">
        <CampoModo valor={d.modo} disabled={off} onChange={(m) => onChange({ nao_contem: false, modo: m })} />
        <div className="min-w-0 flex-1">
          {d.modo === "porcentagem"
            ? <CampoPercentual valor={d.percentual} onChange={(n) => onChange({ ...d, percentual: n })} disabled={off} />
            : d.modo === "valor"
              ? <CurrencyInput value={d.valor ? String(d.valor) : ""} onChange={(s) => onChange({ ...d, valor: s ? Number(s) : null })} disabled={off} className="h-8 text-xs" />
              : <div className="flex h-8 items-center rounded-md border bg-muted/40 px-2 text-[11px] text-muted-foreground">Escolha o modo</div>}
        </div>
      </div>
      <span />
      <div className="flex justify-center">
        <Checkbox checked={!!d.nao_contem} disabled={somenteLeitura || desligado} aria-label={`${nome}: desconto do colaborador não contém`}
          onCheckedChange={(c) => onChange(c ? { nao_contem: true } : { nao_contem: false })} />
      </div>
    </div>
  );
}

export function FormConvencao({ aberto, onFechar, convencao, somenteLeitura, existentes }: {
  aberto: boolean;
  onFechar: () => void;
  /** null = nova. */
  convencao: Convencao | null;
  somenteLeitura?: boolean;
  /** Para sugerir categoria e sindicato já usados. */
  existentes: Convencao[];
}) {
  const salvar = useSalvarConvencao();
  const { data: empresas = [] } = useEmpresasGrupo();

  const [empresaId, setEmpresaId] = useState("");
  const [categoria, setCategoria] = useState("");
  const [sindicato, setSindicato] = useState("");
  const [vigIni, setVigIni] = useState("");
  const [vigFim, setVigFim] = useState("");
  const [cct, setCct] = useState<Anexo>(ANEXO_VAZIO);
  const [beneficios, setBeneficios] = useState<MapaBeneficios>({});
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const c = convencao;
    setEmpresaId(c?.empresa_id ?? "");
    setCategoria(c?.categoria_profissional ?? "");
    setSindicato(c?.sindicato ?? "");
    setVigIni(c?.vigencia_inicio ?? "");
    setVigFim(c?.vigencia_fim ?? "");
    setCct(c ? { path: c.cct_arquivo_path, nome: c.cct_arquivo_nome, tamanho: c.cct_arquivo_tamanho } : ANEXO_VAZIO);
    setBeneficios(c?.beneficios ?? {});
    setObs(c?.observacoes ?? "");
  }, [aberto, convencao]);

  const sugestoes = (campo: "categoria_profissional" | "sindicato") =>
    Array.from(new Set(existentes.map((e) => e[campo]).filter(Boolean) as string[])).sort();

  // Pendências do que está na tela (anexo novo conta como anexado).
  const pendencias = pendenciasConvencao({
    tipo: "cct", empresa_id: empresaId, categoria_profissional: categoria, sindicato,
    vigencia_inicio: vigIni, vigencia_fim: vigFim,
    cct_arquivo_path: cct.path || (cct.novo ? "novo" : null),
    beneficios,
  });

  const confirmar = async () => {
    if (!empresaId) { toast.error("Escolha a empresa."); return; }
    if (vigIni && vigFim && vigFim < vigIni) { toast.error("A vigência termina antes de começar."); return; }
    setEnviando(true);
    try {
      const cctFinal: Anexo = cct.novo
        ? { ...(await enviarAnexoConvencao(convencao?.contrato_id ?? null, "cct", cct.novo)), novo: null }
        : cct;
      // Contrato, decreto embutido e município de cadastro antigo seguem como
      // estavam: a tela não os mostra mais, mas não é ela quem os apaga.
      const input: ConvencaoInput & { id?: string } = {
        id: convencao?.id,
        tipo: "cct",
        empresa_id: empresaId, contrato_id: convencao?.contrato_id ?? null,
        identificacao: convencao?.identificacao ?? null,
        categoria_profissional: categoria.trim() || null, sindicato: sindicato.trim() || null,
        municipio: convencao?.municipio ?? null, uf: convencao?.uf ?? null,
        vigencia_inicio: vigIni || null, vigencia_fim: vigFim || null,
        cct_arquivo_path: cctFinal.path, cct_arquivo_nome: cctFinal.nome, cct_arquivo_tamanho: cctFinal.tamanho,
        decreto_numero: convencao?.decreto_numero ?? null,
        decreto_arquivo_path: convencao?.decreto_arquivo_path ?? null,
        decreto_arquivo_nome: convencao?.decreto_arquivo_nome ?? null,
        decreto_arquivo_tamanho: convencao?.decreto_arquivo_tamanho ?? null,
        beneficios, observacoes: obs.trim() || null,
      };
      await salvar.mutateAsync(input);
      // Arquivo trocado ou removido: o antigo sai do storage depois do save
      // (a versão anterior da convenção guarda só o caminho).
      if (convencao?.cct_arquivo_path && convencao.cct_arquivo_path !== cctFinal.path) {
        await supabase.storage.from(BUCKET_CONVENCOES).remove([convencao.cct_arquivo_path]).catch(() => undefined);
      }
      toast.success(pendencias.length ? "Salvo — o cadastro segue Pendente até completar o que falta." : "Convenção salva.");
      onFechar();
    } catch (e) {
      toast.error("Não foi possível salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Sheet open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[640px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" />
            {somenteLeitura ? "Convenção Coletiva" : convencao ? "Editar Convenção Coletiva" : "Cadastrar Convenção Coletiva"}
            {convencao && <span className="text-xs font-normal text-muted-foreground">· versão {convencao.versao}</span>}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <Secao n={1} titulo="Informações da Convenção">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Empresa" obrigatorio className="sm:col-span-2">
                <Select value={empresaId} onValueChange={setEmpresaId} disabled={somenteLeitura}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
                </Select>
              </Campo>
              <Campo label="Categoria Profissional" obrigatorio>
                <Input list="conv-categorias" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ex.: Limpeza e Conservação" disabled={somenteLeitura} className="h-9" />
                <datalist id="conv-categorias">{sugestoes("categoria_profissional").map((s) => <option key={s} value={s} />)}</datalist>
              </Campo>
              <Campo label="Sindicato" obrigatorio>
                <Input list="conv-sindicatos" value={sindicato} onChange={(e) => setSindicato(e.target.value)} placeholder="Ex.: Sindilimp RS" disabled={somenteLeitura} className="h-9" />
                <datalist id="conv-sindicatos">{sugestoes("sindicato").map((s) => <option key={s} value={s} />)}</datalist>
              </Campo>
              {/* Vigência e anexo em linha inteira (28/10/2026): duas datas
                  numa meia coluna de 600px não cabem — o input de data tem
                  largura mínima própria (~126px com o ícone) e a segunda
                  passava por cima do campo de anexo ao lado. */}
              <Campo label="Vigência da CCT" obrigatorio className="min-w-0 sm:col-span-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Input type="date" value={vigIni} onChange={(e) => setVigIni(e.target.value)} disabled={somenteLeitura} className="h-9 min-w-0 flex-1" />
                  <span className="shrink-0 text-xs text-muted-foreground">a</span>
                  <Input type="date" value={vigFim} onChange={(e) => setVigFim(e.target.value)} disabled={somenteLeitura} className="h-9 min-w-0 flex-1" />
                </div>
              </Campo>
              <Campo label="Anexo da Convenção Coletiva" obrigatorio className="min-w-0 sm:col-span-2">
                <CampoAnexo anexo={cct} rotulo="a convenção" somenteLeitura={somenteLeitura}
                  onEscolher={(f) => setCct((a) => ({ ...a, novo: f }))}
                  onRemover={() => setCct(ANEXO_VAZIO)} />
              </Campo>
            </div>
            <p className="text-[11px] text-muted-foreground">
              O vínculo da convenção com o contrato e o posto é feito na Planilha de Custo (coluna CCT do posto).
            </p>
          </Secao>

          <Secao n={2} titulo="Benefícios da Convenção">
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className={cn(GRADE, "pb-1 text-xs font-medium text-muted-foreground")}>
                  <span>Benefício</span><span>Valor / %</span><span>Tipo / Base de cálculo</span><span className="text-center">Não contém</span>
                </div>
                {BENEFICIOS_CCT.map((def) => (
                  <LinhaBeneficio key={def.chave} def={def} v={beneficios[def.chave] ?? {}} somenteLeitura={somenteLeitura}
                    onChange={(v) => setBeneficios((b) => ({ ...b, [def.chave]: v }))} />
                ))}
              </div>
            </div>
            <Campo label="Observações">
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} placeholder="Digite observações, se necessário…" disabled={somenteLeitura} />
            </Campo>
            {pendencias.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Pendências ({pendencias.length}) — o cadastro fica como Pendente</p>
                <ul className="list-disc space-y-0.5 pl-5">{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            )}
          </Secao>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            {somenteLeitura ? <><X className="mr-1 h-4 w-4" />Fechar</> : "Cancelar"}
          </Button>
          {!somenteLeitura && (
            <Button onClick={confirmar} disabled={enviando} className="min-w-[96px] bg-[#0f3171] hover:bg-[#0c2860]">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
