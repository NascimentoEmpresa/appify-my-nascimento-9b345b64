import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { usePlanoAcoes, type PlanoAcaoRow } from "@/hooks/usePlanoAcoes";
import { usePlanoAcaoPermissao } from "@/hooks/usePlanoAcaoPermissao";
import { usePlanoAcaoFilterOptions, matchResponsavel, matchTexto, manterValidos } from "@/hooks/usePlanoAcaoFilterOptions";
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

  const [fComite, setFComite] = useState<string[]>([]);
  const [fArea, setFArea] = useState<string[]>([]);
  const [fSetor, setFSetor] = useState<string[]>([]);
  const [fResp, setFResp] = useState<string[]>([]);
  const [fEmpresa, setFEmpresa] = useState<string[]>([]);
  const { comites, areas, setores, responsaveis, empresas } = usePlanoAcaoFilterOptions(rows);

  // manterValidos devolve a mesma referência quando nada muda — sem re-render.
  useEffect(() => {
    setFComite(prev => manterValidos(prev, comites));
    setFArea(prev => manterValidos(prev, areas));
    setFSetor(prev => manterValidos(prev, setores));
    setFResp(prev => manterValidos(prev, responsaveis));
    setFEmpresa(prev => manterValidos(prev, empresas));
  }, [comites, areas, setores, responsaveis, empresas]);

  const filteredRows = useMemo(() => rows.filter(r => {
    if (!matchTexto(r.comite, fComite)) return false;
    if (!matchTexto(r.area, fArea)) return false;
    if (!matchTexto(r.setor, fSetor)) return false;
    if (!matchResponsavel(r, fResp)) return false;
    if (fEmpresa.length > 0 && !fEmpresa.includes(r.empresa_id)) return false;
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
          <SearchableMultiSelect value={fComite} onChange={setFComite} options={comites} placeholder="Todos os comitês" searchPlaceholder="Buscar comitê..." maxBadges={2} />
          <SearchableMultiSelect value={fArea} onChange={setFArea} options={areas} placeholder="Todas as áreas" searchPlaceholder="Buscar área..." maxBadges={2} />
          <SearchableMultiSelect value={fSetor} onChange={setFSetor} options={setores} placeholder="Todos os setores" searchPlaceholder="Buscar setor..." maxBadges={2} />
          <SearchableMultiSelect value={fResp} onChange={setFResp} options={responsaveis} placeholder="Todos os responsáveis" searchPlaceholder="Buscar responsável..." maxBadges={2} />
          <SearchableMultiSelect value={fEmpresa} onChange={setFEmpresa} options={empresas} placeholder="Todas as empresas" searchPlaceholder="Buscar empresa..." maxBadges={2} />
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
