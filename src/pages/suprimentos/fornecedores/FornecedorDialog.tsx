import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Trash2, Eye, X, ClipboardList, MapPin, Landmark, FileCheck2,
  UserSquare2, Building2, Search, Users, Globe2, BadgeCheck, ShieldAlert,
  AlertTriangle, FileText, Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { toast } from "sonner";
import { ContasBancariasTab } from "./ContasBancariasTab";
import { usePermissoes } from "@/context/PermissoesContext";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fornecedor: any | null;
  onSaved: () => void;
  readOnly?: boolean;
}

const empty: any = {
  tipo: "pj",
  cnpj_cpf: "",
  razao_social: "",
  nome_fantasia: "",
  cnae_principal: "",
  socios: [] as Array<{ nome: string; cpf?: string; participacao?: string }>,
  contato: "",
  email: "",
  telefone: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  inscricao_estadual: "",
  endereco: "",
  observacoes: "",
  pix_chave: "",
  pix_tipo: "",
  ativo: true,
  is_global: false,
};

const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");
const inferTipo = (doc: string): "pj" | "pf" => (onlyDigits(doc).length === 11 ? "pf" : "pj");

/* ============ Header da seção (ícone azul + título + descrição) ============ */
function SectionHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h4 className="text-sm font-semibold leading-tight">{title}</h4>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

/* ============ Card de toggle (Ativo / Global) ============ */
function ToggleCard({
  icon: Icon, title, description, checked, onChange, disabled, dashed,
}: { icon: any; title: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; dashed?: boolean; }) {
  return (
    <div className={cn(
      "flex items-center justify-between gap-3 rounded-xl border bg-card p-4 transition-colors",
      dashed && "border-dashed bg-muted/30",
      checked && !dashed && "border-primary/40 bg-primary/5",
    )}>
      <div className="flex items-start gap-3">
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          checked ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/* ============ Item do Resumo lateral ============ */
function ResumoItem({
  icon: Icon, label, value, badge, tone = "muted",
}: { icon: any; label: string; value: string; badge?: string; tone?: "muted" | "warn" | "ok" }) {
  const badgeTone =
    tone === "warn" ? "bg-amber-100 text-amber-800 border-amber-200" :
    tone === "ok" ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
    "bg-muted text-muted-foreground border-border";
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">{label}</p>
          {badge && <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", badgeTone)}>{badge}</span>}
        </div>
        <p className="truncate text-xs text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}

export function FornecedorDialog({ open, onOpenChange, fornecedor, onSaved, readOnly = false }: Props) {
  const { data: empresaId } = useEmpresaId();
  const { can } = usePermissoes();
  const canSetGlobal = can("excluir", "suprimentos", "fornecedor");
  const canEdit = !readOnly && can(fornecedor ? "alterar" : "incluir", "suprimentos", "fornecedor");
  const isLocked = readOnly || !canEdit;

  const [form, setForm] = useState<any>(empty);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [tab, setTab] = useState("gerais");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const init = fornecedor
        ? { ...empty, ...fornecedor, socios: Array.isArray(fornecedor.socios) ? fornecedor.socios : [] }
        : empty;
      setForm(init);
      setSavedId(fornecedor?.id ?? null);
      setTab("gerais");
    }
  }, [open, fornecedor]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const setSocio = (idx: number, patch: any) =>
    setForm((f: any) => ({ ...f, socios: f.socios.map((s: any, i: number) => (i === idx ? { ...s, ...patch } : s)) }));
  const addSocio = () => setForm((f: any) => ({ ...f, socios: [...f.socios, { nome: "" }] }));
  const removeSocio = (idx: number) =>
    setForm((f: any) => ({ ...f, socios: f.socios.filter((_: any, i: number) => i !== idx) }));

  /* --------- Pendências / validações para o painel lateral --------- */
  const pendencias = useMemo(() => {
    const arr: string[] = [];
    if (!form.razao_social?.trim()) arr.push("Razão Social");
    if (!form.cnpj_cpf?.trim()) arr.push("CNPJ/CPF");
    return arr;
  }, [form.razao_social, form.cnpj_cpf]);

  const docLen = onlyDigits(form.cnpj_cpf).length;
  const docValido = docLen === 11 || docLen === 14;

  const doSave = async (rascunho = false) => {
    if (!form.razao_social?.trim() || !form.cnpj_cpf?.trim()) {
      toast.error("CNPJ/CPF e Razão Social são obrigatórios");
      return;
    }
    setSaving(true);
    const payload: any = { ...form };
    payload.tipo = inferTipo(form.cnpj_cpf);
    if (!savedId && empresaId) payload.empresa_id = empresaId;
    if (payload.is_global && !canSetGlobal) delete payload.is_global;

    const { data, error } = savedId
      ? await supabase.from("fornecedor").update(payload).eq("id", savedId).select().single()
      : await supabase.from("fornecedor").insert(payload).select().single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(rascunho ? "Rascunho salvo" : "Fornecedor salvo");
    setSavedId(data.id);
    onSaved();
  };

  const title = isLocked
    ? "Visualizar fornecedor"
    : savedId ? "Editar fornecedor" : "Novo fornecedor";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] lg:max-w-[1400px] h-[92vh] max-h-[92vh] gap-0 overflow-hidden p-0 flex flex-col">
        {/* ============ Header ============ */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            {isLocked && <Eye className="h-4 w-4 text-muted-foreground" />}
            <h2 className="text-lg font-semibold">{title}</h2>
            {isLocked && <Badge variant="secondary">Somente leitura</Badge>}
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ============ Tabs ============ */}
        <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b bg-muted/30 px-6 pt-4">
            <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b-0 bg-transparent p-0">
              {[
                { v: "gerais", icon: UserSquare2, label: "Dados Gerais" },
                { v: "local", icon: MapPin, label: "Localização & Contato" },
                { v: "fin", icon: Landmark, label: "Financeiro & PIX", needSave: !savedId },
                { v: "docs", icon: FileCheck2, label: "Documentos & Compliance", needSave: !savedId },
              ].map((t) => (
                <TabsTrigger
                  key={t.v}
                  value={t.v}
                  disabled={t.needSave && !savedId && (t.v === "fin" || t.v === "docs") ? false : false}
                  className="relative gap-2 rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
                >
                  <t.icon className="h-4 w-4" />
                  {t.label}
                  {t.needSave && (
                    <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      salve antes
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* ============ Body: 2 colunas (form + resumo) ============ */}
          <div className="grid flex-1 grid-cols-12 gap-6 overflow-y-auto bg-muted/10 px-6 py-5">
            <div className="col-span-12 lg:col-span-8 space-y-5">

              {/* ===== Aba 1 ===== */}
              <TabsContent value="gerais" className="m-0 space-y-5">
                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <SectionHeader icon={ClipboardList} title="Informações principais" subtitle="Dados básicos para identificação e classificação do fornecedor." />
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-3">
                      <Label className="mb-1.5 block text-xs font-medium">Tipo</Label>
                      <Select value={form.tipo} onValueChange={(v) => set("tipo", v)} disabled={isLocked}>
                        <SelectTrigger><Building2 className="mr-2 h-4 w-4 text-muted-foreground" /><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pj">Pessoa Jurídica</SelectItem>
                          <SelectItem value="pf">Pessoa Física</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 md:col-span-4">
                      <Label className="mb-1.5 block text-xs font-medium">CNPJ/CPF <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="00.000.000/0000-00"
                        maxLength={20}
                        value={form.cnpj_cpf}
                        onChange={(e) => setForm((f: any) => ({ ...f, cnpj_cpf: e.target.value, tipo: inferTipo(e.target.value) }))}
                        disabled={isLocked}
                      />
                    </div>
                    <div className="col-span-12 md:col-span-5">
                      <Label className="mb-1.5 block text-xs font-medium">CNAE Principal</Label>
                      <div className="relative">
                        <Input placeholder="ex: 4744-0/05" className="pr-9" maxLength={20} value={form.cnae_principal ?? ""} onChange={(e) => set("cnae_principal", e.target.value)} disabled={isLocked} />
                        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </div>

                    <div className="col-span-12 -mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px]">i</span>
                      Auto-detectado pelo nº de dígitos.
                    </div>

                    <div className="col-span-12 md:col-span-7">
                      <Label className="mb-1.5 block text-xs font-medium">Razão Social <span className="text-destructive">*</span></Label>
                      <Input placeholder="Informe a razão social" maxLength={200} value={form.razao_social} onChange={(e) => set("razao_social", e.target.value)} disabled={isLocked} />
                    </div>
                    <div className="col-span-12 md:col-span-5">
                      <Label className="mb-1.5 block text-xs font-medium">Nome Fantasia</Label>
                      <Input placeholder="Informe o nome fantasia" maxLength={200} value={form.nome_fantasia ?? ""} onChange={(e) => set("nome_fantasia", e.target.value)} disabled={isLocked} />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <SectionHeader icon={Users} title="Classificação & Abrangência" subtitle="Defina o status e o escopo deste fornecedor." />
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <ToggleCard
                      icon={BadgeCheck}
                      title="Ativo"
                      description="Fornecedor ativo e disponível para operações."
                      checked={!!form.ativo}
                      onChange={(v) => set("ativo", v)}
                      disabled={isLocked}
                    />
                    <ToggleCard
                      icon={Globe2}
                      title="Fornecedor Global (grupo)"
                      description="Visível a todas as empresas do grupo."
                      checked={!!form.is_global}
                      onChange={(v) => set("is_global", v)}
                      disabled={isLocked || !canSetGlobal}
                      dashed
                    />
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Users className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold leading-tight">Sócios da empresa</h4>
                        <p className="text-xs text-muted-foreground">Informações disponíveis no quadro societário.</p>
                      </div>
                    </div>
                    {!isLocked && (
                      <Button type="button" variant="outline" size="sm" onClick={addSocio}>
                        <Plus className="mr-1 h-4 w-4" /> Adicionar sócio
                      </Button>
                    )}
                  </div>

                  {form.socios.length === 0 ? (
                    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center">
                      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Users className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-medium">Nenhum sócio cadastrado.</p>
                      <p className="text-xs text-muted-foreground">Clique em "Adicionar sócio" para incluir informações do quadro societário.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {form.socios.map((s: any, i: number) => (
                        <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-md border bg-background p-3">
                          <div className="col-span-12 md:col-span-6"><Label className="text-xs">Nome</Label><Input value={s.nome ?? ""} onChange={(e) => setSocio(i, { nome: e.target.value })} disabled={isLocked} /></div>
                          <div className="col-span-6 md:col-span-3"><Label className="text-xs">CPF</Label><Input value={s.cpf ?? ""} onChange={(e) => setSocio(i, { cpf: e.target.value })} disabled={isLocked} /></div>
                          <div className="col-span-5 md:col-span-2"><Label className="text-xs">Participação %</Label><Input value={s.participacao ?? ""} onChange={(e) => setSocio(i, { participacao: e.target.value })} disabled={isLocked} /></div>
                          <div className="col-span-1">
                            {!isLocked && (
                              <Button type="button" variant="ghost" size="icon" onClick={() => removeSocio(i)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ===== Aba 2 ===== */}
              <TabsContent value="local" className="m-0 space-y-5">
                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <SectionHeader icon={MapPin} title="Endereço" subtitle="Localização principal do fornecedor." />
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-3"><Label className="mb-1.5 block text-xs font-medium">CEP</Label><Input maxLength={10} value={form.cep ?? ""} onChange={(e) => set("cep", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-12 md:col-span-7"><Label className="mb-1.5 block text-xs font-medium">Logradouro</Label><Input maxLength={200} value={form.logradouro ?? ""} onChange={(e) => set("logradouro", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-12 md:col-span-2"><Label className="mb-1.5 block text-xs font-medium">Número</Label><Input maxLength={20} value={form.numero ?? ""} onChange={(e) => set("numero", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-12 md:col-span-4"><Label className="mb-1.5 block text-xs font-medium">Complemento</Label><Input maxLength={100} value={form.complemento ?? ""} onChange={(e) => set("complemento", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-12 md:col-span-4"><Label className="mb-1.5 block text-xs font-medium">Bairro</Label><Input maxLength={100} value={form.bairro ?? ""} onChange={(e) => set("bairro", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-9 md:col-span-3"><Label className="mb-1.5 block text-xs font-medium">Cidade</Label><Input maxLength={100} value={form.cidade ?? ""} onChange={(e) => set("cidade", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-3 md:col-span-1"><Label className="mb-1.5 block text-xs font-medium">UF</Label><Input maxLength={2} value={form.uf ?? ""} onChange={(e) => set("uf", e.target.value.toUpperCase())} disabled={isLocked} /></div>
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <SectionHeader icon={UserSquare2} title="Contato" subtitle="Pessoa e canais de comunicação." />
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-6"><Label className="mb-1.5 block text-xs font-medium">Inscrição Estadual</Label><Input maxLength={30} value={form.inscricao_estadual ?? ""} onChange={(e) => set("inscricao_estadual", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-12 md:col-span-6"><Label className="mb-1.5 block text-xs font-medium">Contato (responsável)</Label><Input maxLength={100} value={form.contato ?? ""} onChange={(e) => set("contato", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-12 md:col-span-6"><Label className="mb-1.5 block text-xs font-medium">Telefone</Label><Input maxLength={30} value={form.telefone ?? ""} onChange={(e) => set("telefone", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-12 md:col-span-6"><Label className="mb-1.5 block text-xs font-medium">E-mail</Label><Input type="email" maxLength={255} value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} disabled={isLocked} /></div>
                    <div className="col-span-12"><Label className="mb-1.5 block text-xs font-medium">Observações</Label><Textarea rows={3} maxLength={1000} value={form.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)} disabled={isLocked} /></div>
                  </div>
                </div>
              </TabsContent>

              {/* ===== Aba 3 ===== */}
              <TabsContent value="fin" className="m-0 space-y-5">
                {!savedId ? (
                  <div className="rounded-xl border border-dashed bg-card p-10 text-center">
                    <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-amber-500" />
                    <p className="text-sm font-semibold">Salve o cadastro para liberar esta aba.</p>
                    <p className="text-xs text-muted-foreground">As informações financeiras só podem ser cadastradas após salvar os dados básicos.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border bg-card p-5 shadow-sm">
                      <SectionHeader icon={Landmark} title="Chave PIX principal" subtitle="Chave preferencial para pagamentos automáticos." />
                      <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 md:col-span-3">
                          <Label className="mb-1.5 block text-xs font-medium">Tipo da chave</Label>
                          <Select value={form.pix_tipo ?? ""} onValueChange={(v) => set("pix_tipo", v)} disabled={isLocked}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cpf_cnpj">CPF/CNPJ</SelectItem>
                              <SelectItem value="email">E-mail</SelectItem>
                              <SelectItem value="telefone">Telefone</SelectItem>
                              <SelectItem value="aleatoria">Aleatória</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-12 md:col-span-9">
                          <Label className="mb-1.5 block text-xs font-medium">Chave PIX</Label>
                          <Input maxLength={200} value={form.pix_chave ?? ""} onChange={(e) => set("pix_chave", e.target.value)} disabled={isLocked} />
                        </div>
                      </div>
                    </div>

                    {empresaId && (
                      <div className="rounded-xl border bg-card p-5 shadow-sm">
                        <SectionHeader icon={Landmark} title="Contas bancárias" subtitle="Contas para emissão de pagamentos." />
                        <ContasBancariasTab fornecedorId={savedId} empresaId={empresaId} />
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              {/* ===== Aba 4 ===== */}
              <TabsContent value="docs" className="m-0 space-y-5">
                {!savedId ? (
                  <div className="rounded-xl border border-dashed bg-card p-10 text-center">
                    <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-amber-500" />
                    <p className="text-sm font-semibold">Salve o cadastro para anexar documentos.</p>
                    <p className="text-xs text-muted-foreground">Após salvar você poderá enviar contratos sociais, cartões CNPJ e certidões.</p>
                  </div>
                ) : (
                  <div className="rounded-xl border bg-card p-5 shadow-sm">
                    <SectionHeader icon={FileText} title="Documentos & Compliance" subtitle="Anexos, certidões e endereço completo." />
                    <div className="grid grid-cols-12 gap-4">
                      <div className="col-span-12"><Label className="mb-1.5 block text-xs font-medium">Endereço (texto livre, legado)</Label><Textarea rows={2} maxLength={500} value={form.endereco ?? ""} onChange={(e) => set("endereco", e.target.value)} disabled={isLocked} /></div>
                    </div>
                    <div className="mt-4 rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center">
                      <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                      <p className="text-sm font-medium">Anexos em breve</p>
                      <p className="text-xs text-muted-foreground">Use o módulo de Documentos para anexar arquivos por enquanto.</p>
                    </div>
                  </div>
                )}
              </TabsContent>
            </div>

            {/* ============ Sidebar: Resumo do cadastro ============ */}
            <aside className="col-span-12 lg:col-span-4">
              <div className="sticky top-0 space-y-3 rounded-xl border bg-card p-5 shadow-sm">
                <div>
                  <h4 className="text-sm font-semibold">Resumo do cadastro</h4>
                  <p className="text-xs text-muted-foreground">Acompanhe o status e a validação das informações informadas.</p>
                </div>

                <ResumoItem
                  icon={ClipboardList}
                  label="Status do cadastro"
                  value={savedId ? "Salvo" : "Não finalizado"}
                  badge={savedId ? "Salvo" : "Rascunho"}
                  tone={savedId ? "ok" : "muted"}
                />
                <ResumoItem
                  icon={BadgeCheck}
                  label="Validação fiscal"
                  value={docValido ? "CNPJ/CPF com dígitos válidos" : "CNPJ/CPF não validado"}
                  badge={docValido ? "OK" : "Pendente"}
                  tone={docValido ? "ok" : "warn"}
                />
                <ResumoItem
                  icon={UserSquare2}
                  label="Tipo de fornecedor"
                  value={form.tipo === "pf" ? "Pessoa Física" : "Pessoa Jurídica"}
                />
                <ResumoItem
                  icon={Globe2}
                  label="Abrangência"
                  value={form.is_global ? "Global (grupo)" : "Empresa atual"}
                  badge={form.is_global ? "Global" : "Local"}
                />

                {pendencias.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/20">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                      <div>
                        <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                          Campos obrigatórios pendentes: {pendencias.length}
                        </p>
                        <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">
                          Revise os campos marcados com * para continuar.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </Tabs>

        {/* ============ Footer ============ */}
        <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {!isLocked && (
            <>
              <Button variant="outline" onClick={() => doSave(true)} disabled={saving}>
                {saving ? "Salvando…" : "Salvar rascunho"}
              </Button>
              <Button onClick={() => doSave(false)} disabled={saving}>
                {saving ? "Salvando…" : savedId ? "Atualizar fornecedor" : "Salvar fornecedor"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
