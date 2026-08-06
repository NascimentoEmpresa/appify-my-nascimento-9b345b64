import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useList, useUpsert, useRemove } from "@/hooks/useGenericCrud";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { Plus, Pencil, Trash2 } from "lucide-react";

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select" | "boolean";
  options?: { value: string; label: string }[];
  required?: boolean;
  default?: any;
  placeholder?: string;
};

export type ColumnDef = {
  key: string;
  label: string;
  render?: (row: any) => ReactNode;
  className?: string;
};

interface Props {
  table: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  columns: ColumnDef[];
  orderBy?: string;
  ascending?: boolean;
  /** Filtra a lista no client. */
  filter?: (row: any) => boolean;
  /** Inclui valores fixos em todo insert (ex.: tipo='produto'). */
  defaults?: Record<string, any>;
  /** Renderiza extra no header (ex.: filtros). */
  headerExtra?: ReactNode;
}

/** Substitui o value "" das opções do tipo "— nenhum —", que o Radix proíbe. */
const SEM_VALOR = "__sem_valor__";

export function EntityCrudPage({
  table, title, description, fields, columns, orderBy, ascending, filter, defaults = {}, headerExtra,
}: Props) {
  const { data: rows = [], isLoading } = useList<any>(table, { orderBy, ascending });
  const upsert = useUpsert(table);
  const remove = useRemove(table);
  const { data: empresaId } = useEmpresaId();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const filtered = filter ? rows.filter(filter) : rows;

  const openNew = () => {
    const init: any = { ...defaults };
    fields.forEach((f) => { if (f.default !== undefined) init[f.key] = f.default; });
    setEditing(init);
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing({ ...row });
    setOpen(true);
  };

  const save = async () => {
    const payload: any = { ...editing };
    // O sentinela nunca chega ao banco: vira null, que é o que "— nenhum —"
    // significa numa FK opcional.
    for (const f of fields) {
      if (f.type === "select" && payload[f.key] === SEM_VALOR) payload[f.key] = null;
    }
    if (!payload.id && !payload.empresa_id && empresaId) payload.empresa_id = empresaId;
    if (!payload.id) Object.assign(payload, defaults);
    await upsert.mutateAsync(payload);
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={description} actions={
        <div className="flex gap-2">
          {headerExtra}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Novo</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editing?.id ? "Editar" : "Novo registro"}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-2">
                {fields.map((f) => (
                  <div key={f.key} className={f.type === "textarea" ? "col-span-2" : ""}>
                    <Label htmlFor={f.key}>{f.label}{f.required && " *"}</Label>
                    {f.type === "textarea" ? (
                      <Textarea id={f.key} value={editing?.[f.key] ?? ""} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} />
                    ) : f.type === "select" ? (
                      // Radix lança exceção se algum SelectItem tiver value=""
                      // ("must have a value prop that is not an empty string"),
                      // porque string vazia é o que ele usa para limpar a
                      // seleção. Várias telas declaram uma opção "— nenhum —"
                      // com value "" e derrubavam o app inteiro para tela
                      // branca ao abrir o formulário. Aqui a opção vazia vira
                      // um sentinela, convertido de volta para null ao salvar.
                      <Select
                        value={editing?.[f.key] ? String(editing[f.key]) : SEM_VALOR}
                        onValueChange={(v) => setEditing({ ...editing, [f.key]: v === SEM_VALOR ? null : v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          {f.options?.map((o) => (
                            <SelectItem key={o.value || SEM_VALOR} value={o.value || SEM_VALOR}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : f.type === "boolean" ? (
                      <Select value={editing?.[f.key] === false ? "false" : "true"} onValueChange={(v) => setEditing({ ...editing, [f.key]: v === "true" })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">Sim</SelectItem>
                          <SelectItem value="false">Não</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={f.key}
                        type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                        step={f.type === "number" ? "0.01" : undefined}
                        placeholder={f.placeholder}
                        value={editing?.[f.key] ?? ""}
                        onChange={(e) => setEditing({
                          ...editing,
                          [f.key]: f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value,
                        })}
                      />
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={save} disabled={upsert.isPending}>{upsert.isPending ? "Salvando..." : "Salvar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      } />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{filtered.length} registro(s)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum registro. Clique em <Badge variant="outline">Novo</Badge> para começar.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => <TableHead key={c.key} className={c.className}>{c.label}</TableHead>)}
                  <TableHead className="w-24 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className={c.className}>{c.render ? c.render(r) : (r[c.key] ?? "—")}</TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("Remover este registro?")) remove.mutate(r.id); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const fmtBRL = (v: any) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtDate = (v: any) => v ? new Date(v).toLocaleDateString("pt-BR") : "—";
