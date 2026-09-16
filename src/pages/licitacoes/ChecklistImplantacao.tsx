import { useState, useMemo } from "react";
import { useChecklistItems, useChecklistRespostas, useChecklistSalvar } from "@/hooks/useChecklist";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, XCircle, ArrowRight, Clock, MapPin, X as XIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useDocTipos } from "@/hooks/useDocumentos";
import { usePlanilhaCustos } from "@/hooks/usePlanilhaCusto";

// detecção por categoria ou texto do item
function isDocsItem(item: { categoria?: string | null; item: string }) {
  return (
    item.categoria?.toLowerCase().includes("document") ||
    item.item.toLowerCase().includes("document")
  ) ?? false;
}
function isEnderecosItem(item: { item: string }) {
  return item.item.toLowerCase().includes("endere");
}

const MOMENTO_BALIZADOR: Record<string, string> = {
  "Captação": "4 dias antes da abertura",
  "Grade": "4 dias antes da abertura",
  "Capa de edital": "4 dias antes da abertura",
  "Cadastro de edital": "48h após homologação",
  "Reunião de alinhamento": "48h após homologação + 40 dias antes do contrato",
  "Reunião de implantação": "10 dias antes do contrato",
};

function calcPrazo(prazoLimite: string | null, momento: string | null, dataInicio: string | null): string {
  if (!prazoLimite) return "";
  let resolved = prazoLimite.trim();

  if (/^momento\s*=/i.test(resolved)) {
    resolved = MOMENTO_BALIZADOR[momento ?? ""] ?? resolved;
  }

  const parsePT = (s: string) => {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  };
  const fmtPT = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

  const antesInicio = resolved.match(/(\d+)\s*dias?\s*antes\s*do\s*inicio\s*do\s*contrato/i);
  if (antesInicio && dataInicio) {
    const d = parsePT(dataInicio);
    if (d) { d.setDate(d.getDate() - +antesInicio[1]); return `${fmtPT(d)} (${resolved})`; }
  }
  const aposInicio = resolved.match(/(\d+)\s*dias?\s*após\s*do?\s*inicio\s*do\s*contrato/i);
  if (aposInicio && dataInicio) {
    const d = parsePT(dataInicio);
    if (d) { d.setDate(d.getDate() + +aposInicio[1]); return `${fmtPT(d)} (${resolved})`; }
  }
  const antesCurt = resolved.match(/(\d+)\s*dias?\s*antes\s*do\s*contrato/i);
  if (antesCurt && dataInicio) {
    const d = parsePT(dataInicio);
    if (d) { d.setDate(d.getDate() - +antesCurt[1]); return `${fmtPT(d)} (${resolved})`; }
  }

  return resolved;
}

function DocMultiSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data: tipos = [] } = useDocTipos();
  const selected: string[] = useMemo(() => {
    try { return value ? JSON.parse(value) : []; } catch { return []; }
  }, [value]);

  function toggle(nome: string) {
    const next = selected.includes(nome)
      ? selected.filter((s) => s !== nome)
      : [...selected, nome];
    onChange(next.length ? JSON.stringify(next) : null);
  }

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((nome) => (
            <span key={nome} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {nome}
              <button onClick={() => toggle(nome)} className="hover:text-destructive"><XIcon className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {tipos.map((t) => {
          const ativo = selected.includes(t.nome);
          return (
            <button key={t.id} onClick={() => toggle(t.nome)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-muted/40 ${ativo ? "bg-primary/5 font-medium text-primary" : ""}`}>
              <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${ativo ? "border-primary bg-primary text-white" : "border-border"}`}>
                {ativo && <CheckCircle className="w-2.5 h-2.5" />}
              </span>
              {t.nome}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EnderecosPostos({ contratoNome }: { contratoNome: string }) {
  const { data: planilhaRows = [] } = usePlanilhaCustos();
  const postos = useMemo(() => {
    const seen = new Set<string>();
    return planilhaRows
      .filter((r) => r.orexec === "EXECUTADO" && r.contrato === contratoNome && r.posto)
      .filter((r) => { if (seen.has(r.posto)) return false; seen.add(r.posto); return true; })
      .map((r) => r.posto)
      .sort();
  }, [planilhaRows, contratoNome]);

  if (postos.length === 0)
    return <p className="text-xs text-muted-foreground italic">Nenhum posto encontrado para este contrato na Planilha de Custo.</p>;

  return (
    <div className="rounded-md border border-border divide-y divide-border max-h-48 overflow-y-auto">
      {postos.map((p) => (
        <div key={p} className="flex items-center gap-2 px-3 py-2 text-xs">
          <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span>{p}</span>
        </div>
      ))}
    </div>
  );
}

function CardChecklist({
  item,
  resposta,
  obs: savedObs,
  dataInicio,
  contratoNome,
  onSave,
  saving,
}: {
  item: import("@/hooks/useChecklist").ChecklistItem;
  resposta: string | null;
  obs: string | null;
  dataInicio: string | null;
  contratoNome: string;
  onSave: (resposta: string | null, obs: string | null) => Promise<void>;
  saving: boolean;
}) {
  const isSimNao = item.tipo_resposta.toLowerCase().includes("sim");
  const isDocs = isDocsItem(item);
  const isEnderecos = isEnderecosItem(item);

  const [localResp, setLocalResp] = useState<string | null>(resposta);
  const [localObs, setLocalObs] = useState<string>(savedObs ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const prazo = calcPrazo(item.prazo_limite, item.momento, dataInicio);

  async function handleSave() {
    setState("saving");
    try {
      await onSave(localResp, localObs || null);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  const answered = !!localResp;

  // Parse docs saved as JSON for display in answered check
  const docsCount = useMemo(() => {
    if (!isDocs || !localResp) return 0;
    try { return (JSON.parse(localResp) as string[]).length; } catch { return 0; }
  }, [isDocs, localResp]);

  return (
    <div
      className={`rounded-lg border bg-card p-4 flex flex-col gap-3 shadow-sm transition-colors ${
        answered ? "border-l-4 border-l-orange-400" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {item.responsavel_acao && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-secondary border border-border px-2 py-0.5 rounded">
              <ArrowRight className="w-3 h-3 text-orange-500" />
              {item.responsavel_acao}
            </span>
          )}
          {item.categoria && (
            <span className="text-xs font-semibold text-orange-500 bg-orange-50 px-2 py-0.5 rounded">
              {item.categoria}
            </span>
          )}
        </div>
        {item.momento && (
          <span className="text-xs text-muted-foreground text-right shrink-0">{item.momento}</span>
        )}
      </div>

      {/* Pergunta */}
      <p className="text-sm font-semibold text-foreground leading-snug">{item.item}</p>
      {isDocs && docsCount > 0 && (
        <p className="text-[11px] text-muted-foreground">{docsCount} documento{docsCount !== 1 ? "s" : ""} selecionado{docsCount !== 1 ? "s" : ""}</p>
      )}

      {/* Resposta */}
      {isEnderecos ? (
        <EnderecosPostos contratoNome={contratoNome} />
      ) : isDocs ? (
        <DocMultiSelect value={localResp} onChange={setLocalResp} />
      ) : isSimNao ? (
        <div className="flex gap-2">
          <Button variant="outline" size="sm"
            className={`flex-1 gap-1.5 ${localResp === "Sim" ? "bg-green-50 border-green-500 text-green-700" : ""}`}
            onClick={() => setLocalResp(localResp === "Sim" ? null : "Sim")}>
            <CheckCircle className="w-4 h-4" /> Sim
          </Button>
          <Button variant="outline" size="sm"
            className={`flex-1 gap-1.5 ${localResp === "Não" ? "bg-red-50 border-red-500 text-red-700" : ""}`}
            onClick={() => setLocalResp(localResp === "Não" ? null : "Não")}>
            <XCircle className="w-4 h-4" /> Não
          </Button>
        </div>
      ) : (
        <Textarea placeholder="Digite a resposta…" className="min-h-[54px] text-sm resize-y"
          value={localResp ?? ""} onChange={(e) => setLocalResp(e.target.value || null)} />
      )}

      <Textarea
        placeholder="Observações…"
        className="min-h-[40px] text-xs resize-y"
        value={localObs}
        onChange={(e) => setLocalObs(e.target.value)}
      />

      <Button
        size="sm"
        className={`w-full ${state === "saved" ? "bg-green-600 hover:bg-green-600" : state === "failed" ? "bg-destructive hover:bg-destructive" : ""}`}
        onClick={handleSave}
        disabled={state === "saving"}
      >
        {state === "saving" ? "Salvando…" : state === "saved" ? "✓ Salvo" : state === "failed" ? "✗ Falhou" : "Salvar"}
      </Button>

      {/* Meta block */}
      {(prazo || item.plano_acao || item.onde) && (
        <div className="bg-muted rounded-md px-3 py-2 flex flex-col gap-1 text-xs">
          {item.plano_acao && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[80px] font-semibold">Plano de ação</span>
              <span>{item.plano_acao}</span>
            </div>
          )}
          {item.onde && (
            <div className="flex gap-2">
              <span className="text-muted-foreground min-w-[80px] font-semibold">Onde</span>
              <span>{item.onde}</span>
            </div>
          )}
          {prazo && (
            <div className="flex gap-2 items-start">
              <span className="text-muted-foreground min-w-[80px] font-semibold flex items-center gap-1">
                <Clock className="w-3 h-3" /> Prazo
              </span>
              <span className="text-orange-600 font-medium">{prazo}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChecklistImplantacao() {
  const [contratoId, setContratoId] = useState<string>("");
  const [momentoFiltro, setMomentoFiltro] = useState<string>("");
  const [responsavelFiltro, setResponsavelFiltro] = useState<string>("");

  const { data: items = [] } = useChecklistItems();
  const { data: respostas = [] } = useChecklistRespostas(contratoId || null);

  // SIS-2026-0309: lista de contratos passa a ser de todas as empresas do
  // grupo (antes usava useEmpresaId — empresa do PRÓPRIO usuário, não o
  // seletor global, mas mesma classe de limitação de visão).
  const { data: contratos = [] } = useQuery({
    queryKey: ["implantacao-contratos", "todas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("implantacao_contrato")
        .select("id, nome, data_inicio, status, empresa_id")
        .eq("status", "ativo")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const contrato = contratos.find((c) => c.id === contratoId);
  // Empresa vem do contrato selecionado (propagação pela origem), não mais
  // de uma empresa ambiente.
  const salvar = useChecklistSalvar(contrato?.empresa_id ?? "");

  const respostaMap = useMemo(() => {
    const m: Record<number, { resposta: string | null; obs: string | null }> = {};
    respostas.forEach((r) => { m[r.row_index] = { resposta: r.resposta, obs: r.obs }; });
    return m;
  }, [respostas]);

  const momentos = useMemo(() => [...new Set(items.map((i) => i.momento).filter(Boolean))], [items]);
  const responsaveis = useMemo(() => [...new Set(items.map((i) => i.responsavel_acao).filter(Boolean))].sort(), [items]);

  const visibleItems = useMemo(() => {
    let filtered = items;
    if (momentoFiltro) filtered = filtered.filter((i) => i.momento === momentoFiltro);
    if (responsavelFiltro) filtered = filtered.filter((i) =>
      i.responsavel_acao === responsavelFiltro ||
      (responsavelFiltro !== "Todos" && i.responsavel_acao === "Todos")
    );
    return filtered;
  }, [items, momentoFiltro, responsavelFiltro]);

  const grupos = useMemo(() => {
    const m = new Map<string, typeof items>();
    visibleItems.forEach((item) => {
      const g = item.responsavel_acao || "Sem responsável";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(item);
    });
    return m;
  }, [visibleItems]);

  const totalRespondidos = items.filter((i) => respostaMap[i.row_index]?.resposta).length;
  const pct = items.length ? Math.round((totalRespondidos / items.length) * 100) : 0;

  async function handleSave(rowIndex: number, resposta: string | null, obs: string | null) {
    if (!contratoId) {
      toast({ title: "Selecione um contrato primeiro", variant: "destructive" });
      throw new Error("sem contrato");
    }
    await salvar.mutateAsync({ contratoId, rowIndex, resposta, obs });
  }

  return (
    <div className="p-6 space-y-5 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Checklist de Implantação</h1>
          <p className="text-sm text-muted-foreground">63 itens · responda por contrato</p>
        </div>
        <Select value={contratoId} onValueChange={setContratoId}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="— Selecione o contrato —" />
          </SelectTrigger>
          <SelectContent>
            {contratos.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome.length > 50 ? c.nome.slice(0, 48) + "…" : c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      {contratoId && (
        <div className="flex flex-wrap gap-3 items-center">
          <Badge variant="outline">Total: {items.length}</Badge>
          <Badge variant="outline">Respondidos: {totalRespondidos}</Badge>
          <div className="flex items-center gap-2">
            <Progress value={pct} className="w-40 h-2" />
            <span className="text-xs text-muted-foreground">{pct}%</span>
          </div>
          {contrato?.data_inicio && (
            <Badge variant="secondary">Início: {contrato.data_inicio}</Badge>
          )}
        </div>
      )}

      {/* Filtros */}
      {items.length > 0 && (
        <div className="space-y-2">
          {/* Filtro de momento */}
          <div className="flex flex-wrap gap-2">
            {[{ label: "Todos momentos", value: "" }, ...momentos.map((m) => ({ label: m!, value: m! }))].map(({ label, value }) => (
              <button key={value}
                className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${momentoFiltro === value ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary"}`}
                onClick={() => setMomentoFiltro(value)}>
                {label}
              </button>
            ))}
          </div>
          {/* Filtro de responsável */}
          <div className="flex flex-wrap gap-2">
            {[{ label: "Todos responsáveis", value: "" }, ...responsaveis.map((r) => ({ label: r!, value: r! }))].map(({ label, value }) => (
              <button key={value}
                className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${responsavelFiltro === value ? "bg-orange-500 text-white border-orange-500" : "bg-card border-border text-muted-foreground hover:border-orange-400 hover:text-orange-500"}`}
                onClick={() => setResponsavelFiltro(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {!contratoId && (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 text-muted-foreground">
          <p className="text-lg font-semibold">Selecione um contrato para iniciar</p>
          <p className="text-sm">
            {contratos.length === 0
              ? "Nenhum contrato ativo. Promova uma licitação ganha no módulo de Implantação."
              : "Escolha o contrato na lista acima."}
          </p>
        </div>
      )}

      {/* Grupos por setor */}
      {contratoId &&
        Array.from(grupos.entries()).map(([responsavel, sectorItems]) => {
          const respondidos = sectorItems.filter((i) => respostaMap[i.row_index]?.resposta).length;
          const spct = sectorItems.length ? Math.round((respondidos / sectorItems.length) * 100) : 0;
          return (
            <section key={responsavel} className="space-y-3">
              <div className="flex items-center gap-3 border-b pb-2 flex-wrap">
                <Badge className="bg-orange-500 text-white text-xs uppercase tracking-wide">{responsavel}</Badge>
                <span className="font-bold text-sm">{responsavel}</span>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {respondidos}/{sectorItems.length}
                  </span>
                  <div className="w-20 h-1 bg-border rounded overflow-hidden">
                    <div className="h-full bg-orange-400 rounded transition-all" style={{ width: `${spct}%` }} />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {sectorItems.map((item) => (
                  <CardChecklist
                    key={item.row_index}
                    item={item}
                    resposta={respostaMap[item.row_index]?.resposta ?? null}
                    obs={respostaMap[item.row_index]?.obs ?? null}
                    dataInicio={contrato?.data_inicio ?? null}
                    contratoNome={contrato?.nome ?? ""}
                    onSave={(resp, obs) => handleSave(item.row_index, resp, obs)}
                    saving={salvar.isPending}
                  />
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}
