import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { Upload } from "lucide-react";

interface Identidade {
  empresa_id: string;
  nome_empresarial: string | null;
  subtitulo: string | null;
  logo_path: string | null;
  cor_primaria: string | null;
  cor_secundaria: string | null;
  cor_destaque: string | null;
}

export function IdentidadeTab() {
  const qc = useQueryClient();
  const { can, empresaId } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");

  const empresasQ = useQuery({
    queryKey: ["empresas-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id,codigo,razao_social").order("razao_social");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [empresaSel, setEmpresaSel] = useState<string>("");
  const eid = empresaSel || empresaId || (empresasQ.data?.[0]?.id ?? "");

  const idQ = useQuery({
    enabled: !!eid,
    queryKey: ["identidade_visual", eid],
    queryFn: async () => {
      const { data, error } = await supabase.from("identidade_visual").select("*").eq("empresa_id", eid).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Identidade | null;
    },
  });

  const [form, setForm] = useState<Identidade>({
    empresa_id: eid, nome_empresarial: "", subtitulo: "",
    logo_path: null, cor_primaria: "#1e3a8a", cor_secundaria: "#0d7a5f", cor_destaque: "#c9a84c",
  });

  useEffect(() => {
    if (idQ.data) {
      setForm(idQ.data);
    } else if (eid) {
      setForm({ empresa_id: eid, nome_empresarial: "", subtitulo: "", logo_path: null,
                cor_primaria: "#1e3a8a", cor_secundaria: "#0d7a5f", cor_destaque: "#c9a84c" });
    }
  }, [idQ.data, eid]);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (form.logo_path) {
        const { data } = await supabase.storage.from("identidade-visual").createSignedUrl(form.logo_path, 3600);
        if (!cancelled) setLogoUrl(data?.signedUrl ?? null);
      } else { setLogoUrl(null); }
    })();
    return () => { cancelled = true; };
  }, [form.logo_path]);

  const upload = async (file: File) => {
    if (!eid) return;
    const ext = file.name.split(".").pop() ?? "png";
    const path = `${eid}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("identidade-visual").upload(path, file, { upsert: true });
    if (error) { toast({ title: "Erro no upload", description: error.message, variant: "destructive" }); return; }
    setForm({ ...form, logo_path: path });
    toast({ title: "Logotipo carregado", description: "Lembre-se de clicar em Salvar." });
  };

  const salvar = async () => {
    const payload = { ...form, empresa_id: eid };
    const { error } = await supabase.from("identidade_visual").upsert(payload, { onConflict: "empresa_id" });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Identidade visual salva" });
    qc.invalidateQueries({ queryKey: ["identidade_visual", eid] });
  };

  return (
    <section className="card-elevated p-5 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-bold">Identidade visual</h2>
          <p className="text-xs text-muted-foreground">Logotipo, nomes e cores institucionais por empresa.</p>
        </div>
        <select value={eid} onChange={(e) => setEmpresaSel(e.target.value)} className="h-9 rounded-md border border-border bg-card px-3 text-xs">
          {(empresasQ.data ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.codigo} — {e.razao_social}</option>)}
        </select>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Logotipo</p>
          <div className="mt-3 flex items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-8">
            {logoUrl
              ? <img src={logoUrl} alt="Logotipo" className="h-20 w-20 object-contain" />
              : <p className="text-xs text-muted-foreground">Nenhum logotipo carregado.</p>}
          </div>
          {podeGerenciar && (
            <label className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-xs hover:bg-secondary">
              <Upload className="h-3.5 w-3.5" /> Carregar logotipo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          )}
          {form.logo_path && <p className="mt-2 truncate text-[11px] font-mono text-muted-foreground">{form.logo_path}</p>}
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <Label>Nome empresarial</Label>
            <Input value={form.nome_empresarial ?? ""} onChange={(e) => setForm({ ...form, nome_empresarial: e.target.value })} disabled={!podeGerenciar} />
          </div>
          <div>
            <Label>Subtítulo institucional</Label>
            <Input value={form.subtitulo ?? ""} onChange={(e) => setForm({ ...form, subtitulo: e.target.value })} disabled={!podeGerenciar} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["cor_primaria", "cor_secundaria", "cor_destaque"] as const).map((c) => (
              <div key={c}>
                <Label className="capitalize">{c.replace("cor_", "")}</Label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={(form as any)[c] ?? "#000000"}
                    onChange={(e) => setForm({ ...form, [c]: e.target.value } as any)}
                    disabled={!podeGerenciar}
                    className="h-9 w-9 rounded border border-border"
                  />
                  <Input value={(form as any)[c] ?? ""} onChange={(e) => setForm({ ...form, [c]: e.target.value } as any)} disabled={!podeGerenciar} className="h-9 text-xs" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {podeGerenciar && (
        <div className="flex justify-end">
          <Button onClick={salvar}>Salvar identidade</Button>
        </div>
      )}
    </section>
  );
}
