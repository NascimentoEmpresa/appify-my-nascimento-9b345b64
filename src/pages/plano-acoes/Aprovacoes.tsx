import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { supabase } from "@/integrations/supabase/client";
import { usePlanoAcoes } from "@/hooks/usePlanoAcoes";
import { usePlanoAcaoPermissao } from "@/hooks/usePlanoAcaoPermissao";
import { usePlanoAcaoFilterOptions, matchResponsavel } from "@/hooks/usePlanoAcaoFilterOptions";
import { ForbiddenCard } from "./Lista";
import { STATUS_LABELS, STATUS_COR } from "@/types/planoAcao";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { podeValidarPlanoAcao } from "@/lib/podeValidarPlanoAcao";

export default function PlanoAcoesAprovacoes() {
  const { data: rows = [] } = usePlanoAcoes();
  const { can, loading } = usePlanoAcaoPermissao();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [fComite, setFComite] = useState<string>("__all");
  const [fArea, setFArea] = useState<string>("__all");
  const [fResp, setFResp] = useState<string>("__all");
  const [fEmpresa, setFEmpresa] = useState<string>("__all");
  const { comites, areas, responsaveis, empresas } = usePlanoAcaoFilterOptions(rows);

  useEffect(() => {
    if (fComite !== "__all" && !comites.some(o => o.value === fComite)) setFComite("__all");
    if (fArea !== "__all" && !areas.some(o => o.value === fArea)) setFArea("__all");
    if (fResp !== "__all" && !responsaveis.some(o => o.value === fResp)) setFResp("__all");
    if (fEmpresa !== "__all" && !empresas.some(o => o.value === fEmpresa)) setFEmpresa("__all");
  }, [comites, areas, responsaveis, empresas, fComite, fArea, fResp, fEmpresa]);

  const filteredRows = useMemo(() => rows.filter(r => {
    if (fComite !== "__all" && r.comite !== fComite) return false;
    if (fArea !== "__all" && r.area !== fArea) return false;
    if (!matchResponsavel(r, fResp)) return false;
    if (fEmpresa !== "__all" && r.empresa_id !== fEmpresa) return false;
    return true;
  }), [rows, fComite, fArea, fResp, fEmpresa]);

  if (loading) return null;
  if (!can("visualizar")) return <ForbiddenCard />;

  const aguard = filteredRows.filter(r => r.status_normalizado === "aguardando_validacao");
  const pendEv = filteredRows.filter(r => r.status_normalizado === "concluida_pendente_evidencia");

  const validar = async (id: string) => {
    const { error } = await supabase.from("plano_acao").update({ status_normalizado: "concluida_validada" }).eq("id", id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: "Ação validada" }); qc.invalidateQueries({ queryKey: ["plano_acoes"] }); }
  };
  const devolver = async (id: string) => {
    const { error } = await supabase.from("plano_acao").update({ status_normalizado: "em_andamento" }).eq("id", id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: "Devolvida para execução" }); qc.invalidateQueries({ queryKey: ["plano_acoes"] }); }
  };

  const renderList = (list: typeof rows, titulo: string, mostrarBotoes: boolean) => (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo} <Badge variant="secondary">{list.length}</Badge>
      </h3>
      <div className="space-y-2">
        {list.map(r => (
          <div key={r.id} className="flex items-start justify-between gap-3 rounded border border-border p-3">
            <div className="min-w-0 flex-1">
              <Link to={`/app/plano-acoes/${r.id}`} className="font-medium hover:text-primary">
                {r.titulo || r.problema || "(sem título)"}
              </Link>
              <p className="text-xs text-muted-foreground">
                {r.id_importacao} · {r.area} · {r.responsavel_nome_origem ?? "Sem responsável"}
              </p>
              <Badge variant="outline" className={`mt-1 text-[10px] ${STATUS_COR[r.status_normalizado]}`}>
                {STATUS_LABELS[r.status_normalizado]}
              </Badge>
            </div>
            {mostrarBotoes && (can("aprovar") || podeValidarPlanoAcao(r, user?.id)) && (
              <div className="flex gap-2">
                {can("aprovar") && <Button size="sm" variant="outline" onClick={() => devolver(r.id)}>Devolver</Button>}
                {/* "Validar" (Concluída — Validada) só quem criou a ação, ou o
                    Responsável em ações legadas sem criado_por registrado. */}
                {podeValidarPlanoAcao(r, user?.id) && <Button size="sm" onClick={() => validar(r.id)}>Validar</Button>}
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma ação nesta categoria.</p>}
      </div>
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Aprovações"
        subtitle="Ações aguardando validação e pendentes de evidência"
        module="Plano de Ações"
        breadcrumb={["Aprovações"]}
        actions={<Button asChild variant="outline" size="sm"><Link to="/app/plano-acoes">← Lista</Link></Button>}
      />
      <Card className="mb-4 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SearchableSelect value={fComite === "__all" ? "" : fComite} onChange={v => setFComite(v || "__all")} options={comites} placeholder="Todos os comitês" searchPlaceholder="Buscar comitê..." allowClear />
          <SearchableSelect value={fArea === "__all" ? "" : fArea} onChange={v => setFArea(v || "__all")} options={areas} placeholder="Todas as áreas" searchPlaceholder="Buscar área..." allowClear />
          <SearchableSelect value={fResp === "__all" ? "" : fResp} onChange={v => setFResp(v || "__all")} options={responsaveis} placeholder="Todos os responsáveis" searchPlaceholder="Buscar responsável..." allowClear />
          <SearchableSelect value={fEmpresa === "__all" ? "" : fEmpresa} onChange={v => setFEmpresa(v || "__all")} options={empresas} placeholder="Todas as empresas" searchPlaceholder="Buscar empresa..." allowClear />
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {renderList(aguard, "Aguardando validação", true)}
        {renderList(pendEv, "Concluídas — pend. evidência (legado)", false)}
      </div>
    </div>
  );
}
