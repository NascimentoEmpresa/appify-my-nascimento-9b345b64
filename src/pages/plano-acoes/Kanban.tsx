import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { usePlanoAcoes, type PlanoAcaoRow } from "@/hooks/usePlanoAcoes";
import { usePlanoAcaoPermissao } from "@/hooks/usePlanoAcaoPermissao";
import { usePlanoAcaoFilterOptions, matchResponsavel } from "@/hooks/usePlanoAcaoFilterOptions";
import { STATUS_LABELS, STATUS_COR, STATUS_ORDEM, PRIORIDADE_COR, PRIORIDADE_LABEL } from "@/types/planoAcao";
import { ForbiddenCard } from "./Lista";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { podeValidarPlanoAcao } from "@/lib/podeValidarPlanoAcao";

const COLUNAS = STATUS_ORDEM;

export default function PlanoAcoesKanban() {
  const { data: rows = [], isLoading } = usePlanoAcoes();
  const { can, loading } = usePlanoAcaoPermissao();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [fComite, setFComite] = useState<string>("__all");
  const [fArea, setFArea] = useState<string>("__all");
  const [fSetor, setFSetor] = useState<string>("__all");
  const [fResp, setFResp] = useState<string>("__all");
  const [fEmpresa, setFEmpresa] = useState<string>("__all");
  const { comites, areas, setores, responsaveis, empresas } = usePlanoAcaoFilterOptions(rows);

  useEffect(() => {
    if (fComite !== "__all" && !comites.some(o => o.value === fComite)) setFComite("__all");
    if (fArea !== "__all" && !areas.some(o => o.value === fArea)) setFArea("__all");
    if (fSetor !== "__all" && !setores.some(o => o.value === fSetor)) setFSetor("__all");
    if (fResp !== "__all" && !responsaveis.some(o => o.value === fResp)) setFResp("__all");
    if (fEmpresa !== "__all" && !empresas.some(o => o.value === fEmpresa)) setFEmpresa("__all");
  }, [comites, areas, setores, responsaveis, empresas, fComite, fArea, fSetor, fResp, fEmpresa]);

  const filteredRows = useMemo(() => rows.filter(r => {
    if (fComite !== "__all" && r.comite !== fComite) return false;
    if (fArea !== "__all" && r.area !== fArea) return false;
    if (fSetor !== "__all" && r.setor !== fSetor) return false;
    if (!matchResponsavel(r, fResp)) return false;
    if (fEmpresa !== "__all" && r.empresa_id !== fEmpresa) return false;
    return true;
  }), [rows, fComite, fArea, fSetor, fResp, fEmpresa]);

  const grouped = useMemo(() => {
    const m = new Map<string, PlanoAcaoRow[]>();
    COLUNAS.forEach(c => m.set(c, []));
    filteredRows.forEach(r => {
      const k = m.has(r.status_normalizado) ? r.status_normalizado : "a_definir";
      m.get(k)!.push(r);
    });
    return m;
  }, [filteredRows]);

  if (loading) return null;
  if (!can("visualizar")) return <ForbiddenCard />;

  const onDrop = async (e: React.DragEvent, novoStatus: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id || !can("editar")) return;
    // "Atrasada" só é definida automaticamente (cron), nunca por drag-and-drop.
    if (novoStatus === "atrasada") {
      toast({ title: "Não permitido", description: "O status Atrasada é definido automaticamente pelo sistema, não pode ser escolhido manualmente.", variant: "destructive" });
      return;
    }
    // Regra: ao concluir, vai para aguardando_validacao; só quem criou a
    // ação (ou o Responsável, se legada) valida de fato.
    let statusFinal = novoStatus;
    if (novoStatus === "concluida_validada") {
      const row = rows.find(r => r.id === id);
      if (!row || !podeValidarPlanoAcao(row, user?.id)) {
        statusFinal = "aguardando_validacao";
      }
    }
    const { error } = await supabase.from("plano_acao").update({ status_normalizado: statusFinal }).eq("id", id);
    if (error) {
      toast({ title: "Erro ao mover", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Status atualizado", description: STATUS_LABELS[statusFinal] });
      qc.invalidateQueries({ queryKey: ["plano_acoes"] });
    }
  };

  return (
    <div>
      <PageHeader
        title="Kanban — Plano de Ações"
        subtitle="Arraste cards entre colunas para alterar o status. Histórico é registrado automaticamente."
        module="Plano de Ações"
        breadcrumb={["Kanban"]}
        actions={<Link to="/app/plano-acoes" className="text-sm text-primary hover:underline">← Lista</Link>}
      />
      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      <Card className="mb-4 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SearchableSelect value={fComite === "__all" ? "" : fComite} onChange={v => setFComite(v || "__all")} options={comites} placeholder="Todos os comitês" searchPlaceholder="Buscar comitê..." allowClear />
          <SearchableSelect value={fArea === "__all" ? "" : fArea} onChange={v => setFArea(v || "__all")} options={areas} placeholder="Todas as áreas" searchPlaceholder="Buscar área..." allowClear />
          <SearchableSelect value={fSetor === "__all" ? "" : fSetor} onChange={v => setFSetor(v || "__all")} options={setores} placeholder="Todos os setores" searchPlaceholder="Buscar setor..." allowClear />
          <SearchableSelect value={fResp === "__all" ? "" : fResp} onChange={v => setFResp(v || "__all")} options={responsaveis} placeholder="Todos os responsáveis" searchPlaceholder="Buscar responsável..." allowClear />
          <SearchableSelect value={fEmpresa === "__all" ? "" : fEmpresa} onChange={v => setFEmpresa(v || "__all")} options={empresas} placeholder="Todas as empresas" searchPlaceholder="Buscar empresa..." allowClear />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{filteredRows.length} de {rows.length} ações</p>
      </Card>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUNAS.map(col => (
          <div
            key={col}
            className="min-w-[280px] flex-1"
            onDragOver={e => e.preventDefault()}
            onDrop={e => onDrop(e, col)}
          >
            <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider">{STATUS_LABELS[col]}</span>
              <Badge variant="outline" className="text-[10px]">{grouped.get(col)?.length ?? 0}</Badge>
            </div>
            <div className="space-y-2">
              {grouped.get(col)?.map(r => (
                <Card
                  key={r.id}
                  draggable={can("editar")}
                  onDragStart={e => e.dataTransfer.setData("text/plain", r.id)}
                  className={`cursor-grab p-3 ${STATUS_COR[col].split(" ").filter(c => c.startsWith("border-")).join(" ") || ""}`}
                >
                  <Link to={`/app/plano-acoes/${r.id}`} className="block">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">{r.id_importacao ?? "—"}</span>
                      {r.prioridade_normalizada && (
                        <Badge variant="outline" className={`text-[9px] ${PRIORIDADE_COR[r.prioridade_normalizada]}`}>
                          {PRIORIDADE_LABEL[r.prioridade_normalizada]}
                        </Badge>
                      )}
                    </div>
                    <p className="line-clamp-3 text-xs">{r.titulo || r.problema || "(sem título)"}</p>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="truncate">{r.responsavel_nome_origem ?? "Sem responsável"}</span>
                      <span>{r.area ?? r.comite ?? ""}</span>
                    </div>
                  </Link>
                </Card>
              ))}
              {grouped.get(col)?.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                  vazio
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {!can("editar") && (
        <p className="mt-3 text-xs text-muted-foreground">
          Você não tem permissão para mover cards. Apenas visualização.
        </p>
      )}
    </div>
  );
}
