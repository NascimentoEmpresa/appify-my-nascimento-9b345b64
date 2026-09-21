import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Mail, RefreshCw, Search, UserCheck, UserX, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { rpcTodasAsLinhas } from "@/hooks/useTreinamentosPlataforma";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FiltroContratos, passaNoFiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { MENU, type StatusAluno } from "./tipos";
import { Paginacao, StatusAlunoBadge, TrnCarregando, TrnEstilo, TrnHero, TrnKpi, TrnVazio, fmtData, fmtDataHora, usePaginacao } from "./ui";

// =====================================================================
// TREINAMENTOS — Alunos › Gerenciar (21/09/2026).
//
// Substitui o "Adicionar novo" do membox. Aqui aluno É colaborador: a
// lista vem do cadastro da Senior (EMPREGADOS) e entra sozinha na admissão
// (trigger trg_trn_aluno_do_empregado, migration 20260930000193). Quem está
// "Trabalhando" é ativo; afastado ou demitido é inativo. Não se cadastra
// aluno à mão — o botão "Sincronizar" refaz a leitura do cadastro inteiro
// pra quem quiser conferir agora, sem esperar o gatilho.
//
// A rota (/app/treinamentos/alunos/novo) e o menu (treinamentos_alunos_novo)
// ficaram os mesmos de propósito: é o código que carrega a permissão de quem
// já tinha, e trocá-lo obrigaria a remarcar pessoa por pessoa.
// =====================================================================

interface AlunoGerenciar {
  id: string; nome: string; email: string; documento: string | null; status: StatusAluno;
  situacao: string | null; contrato: string | null; cargo: string | null; empregado_id: number | null;
  origem: string; acesso_completo: boolean; cursos: number; ultimo_acesso_em: string | null;
  sincronizado_em: string | null; admissao: string | null; afastamento: string | null; email_sintetico: boolean;
}

const fmtCpf = (v: string | null) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : (v ?? "—");
};

export default function AlunosGerenciar() {
  const qc = useQueryClient();
  const { data: alunos = [], isLoading } = useQuery({
    queryKey: ["trn-alunos-gerenciar"],
    // Em páginas de 1000: o PostgREST corta a resposta nesse tamanho.
    queryFn: () => rpcTodasAsLinhas<AlunoGerenciar>("trn_alunos_gerenciar"),
  });
  const sincronizar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("trn_sincronizar_alunos");
      if (error) throw error;
      return data as { percorridos: number; novos: number; ativos: number; inativos: number };
    },
    onSuccess: (r) => {
      toast.success(`Cadastro lido: ${r.percorridos} colaborador(es), ${r.novos} aluno(s) novo(s). Ativos: ${r.ativos} · Inativos: ${r.inativos}.`);
      qc.invalidateQueries({ queryKey: ["trn-alunos-gerenciar"] });
      qc.invalidateQueries({ queryKey: ["trn-alunos"] });
      qc.invalidateQueries({ queryKey: ["trn-dashboard"] });
    },
    onError: (e: Error) => toast.error("Não deu para sincronizar: " + e.message),
  });

  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState<"" | "ativo" | "inativo" | "bloqueado" | "pendente">("");
  const [fSituacao, setFSituacao] = useState("");
  const [fContratos, setFContratos] = useState<string[]>([]);

  const situacoes = useMemo(() => [...new Set(alunos.map((a) => a.situacao).filter(Boolean) as string[])].sort(), [alunos]);
  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return alunos.filter((a) => {
      if (fStatus && a.status !== fStatus) return false;
      if (fSituacao && a.situacao !== fSituacao) return false;
      if (!passaNoFiltroContratos(a, "contrato", fContratos)) return false;
      if (b && !`${a.nome} ${a.email} ${a.documento ?? ""} ${a.cargo ?? ""} ${a.contrato ?? ""}`.toLowerCase().includes(b)) return false;
      return true;
    });
  }, [alunos, busca, fStatus, fSituacao, fContratos]);
  const pag = usePaginacao(filtrados, 25);

  const ativos = alunos.filter((a) => a.status === "ativo").length;
  const inativos = alunos.filter((a) => a.status === "inativo").length;
  const afastados = alunos.filter((a) => a.status === "inativo" && a.situacao !== "Demitido").length;
  const demitidos = alunos.filter((a) => a.situacao === "Demitido").length;
  const semEmail = alunos.filter((a) => a.email_sintetico).length;
  const ultimaSync = alunos.reduce<string | null>((m, a) => (a.sincronizado_em && (!m || a.sincronizado_em > m) ? a.sincronizado_em : m), null);

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.alunosNovo} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para gerenciar os alunos.</Card>}>
        <TrnHero
          eyebrow="Treinamentos › Alunos"
          titulo="Gerenciar alunos"
          texto="Aluno é colaborador: a lista vem do cadastro da Senior e entra sozinha na admissão. Quem está Trabalhando é ativo; afastado ou demitido fica inativo."
          pilulas={[`${ativos} ativo(s)`, `${inativos} inativo(s)`, ultimaSync ? `Última leitura do cadastro: ${fmtDataHora(ultimaSync)}` : "Cadastro ainda não lido"]}
          acoes={<>
            <AcessoGate menu={MENU.alunosNovo} acao="alterar">
              <button onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending}>
                <RefreshCw className={`h-4 w-4 ${sincronizar.isPending ? "animate-spin" : ""}`} /> {sincronizar.isPending ? "Lendo o cadastro…" : "Sincronizar com o cadastro"}
              </button>
            </AcessoGate>
            <Link to="/app/treinamentos/alunos" className="sec"><Users className="h-4 w-4" /> Todos os alunos</Link>
          </>}
        />

        <div className="trn-kpis">
          <TrnKpi rotulo="Ativos" valor={ativos} sub="Situação Trabalhando" icone={<UserCheck className="h-5 w-5" />} />
          <TrnKpi rotulo="Inativos" valor={inativos} sub={`${afastados} afastado(s) · ${demitidos} demitido(s)`} icone={<UserX className="h-5 w-5" />} />
          <TrnKpi rotulo="Contratos" valor={new Set(alunos.map((a) => a.contrato).filter(Boolean)).size} sub="com colaborador na plataforma" icone={<Building2 className="h-5 w-5" />} />
          <TrnKpi rotulo="Sem e-mail no cadastro" valor={semEmail} sub="usam o e-mail gerado pelo ERP" icone={<Mail className="h-5 w-5" />} />
        </div>

        <div className="trn-card mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Pesquisar por nome, CPF, e-mail, cargo ou contrato" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <FiltroContratos linhas={alunos} campo="contrato" selecionados={fContratos} onChange={setFContratos} />
            <Select value={fStatus || "__"} onValueChange={(v) => setFStatus(v === "__" ? "" : (v as typeof fStatus))}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">Ativos e inativos</SelectItem>
                <SelectItem value="ativo">Ativos</SelectItem>
                <SelectItem value="inativo">Inativos</SelectItem>
                <SelectItem value="bloqueado">Bloqueados</SelectItem>
                <SelectItem value="pendente">Pendentes</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fSituacao || "__"} onValueChange={(v) => setFSituacao(v === "__" ? "" : v)}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Situação (Senior)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__">Todas as situações</SelectItem>
                {situacoes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? <TrnCarregando texto="Carregando alunos…" /> : alunos.length === 0 ? (
          <TrnVazio titulo="Nenhum aluno ainda" texto="Clique em “Sincronizar com o cadastro” para trazer os colaboradores da Senior." />
        ) : (
          <div className="trn-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="trn-tab">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>CPF</th>
                    <th>Contrato</th>
                    <th>Cargo</th>
                    <th>Situação (Senior)</th>
                    <th>Aluno</th>
                    <th>Acesso</th>
                    <th>Cursos</th>
                    <th>Admissão</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pag.itens.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="font-semibold">{a.nome}</div>
                        <div className="text-xs text-muted-foreground">
                          {a.email_sintetico ? <span title="O cadastro não tem e-mail; o ERP gerou um identificador">{a.email} · sem e-mail no cadastro</span> : a.email}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{fmtCpf(a.documento)}</td>
                      <td className="max-w-[220px] text-xs">{a.contrato ?? "—"}</td>
                      <td className="max-w-[180px] text-xs">{a.cargo ?? "—"}</td>
                      <td className="whitespace-nowrap text-xs">
                        {a.situacao ?? "—"}
                        {a.situacao === "Demitido" && a.afastamento ? <div className="text-muted-foreground">em {fmtData(a.afastamento)}</div> : null}
                      </td>
                      <td><StatusAlunoBadge status={a.status} /></td>
                      <td className="text-xs">{a.acesso_completo ? "Completo" : "Personalizado"}</td>
                      <td>{a.cursos}</td>
                      <td className="whitespace-nowrap text-xs">{a.admissao ? fmtData(a.admissao) : "—"}</td>
                      <td className="whitespace-nowrap text-right">
                        <Link to={`/app/treinamentos/alunos/${a.id}`} className="text-xs font-semibold text-primary underline-offset-2 hover:underline">Abrir</Link>
                      </td>
                    </tr>
                  ))}
                  {pag.itens.length === 0 && (
                    <tr><td colSpan={10} className="py-8 text-center text-sm text-muted-foreground">Nada bate com o filtro atual.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Paginacao pagina={pag.pagina} total={pag.total} porPagina={pag.porPagina} setPorPagina={pag.setPorPagina} setPagina={pag.setPagina} quantidade={filtrados.length} rotulo="alunos" />
          </div>
        )}
      </AcessoGate>
    </div>
  );
}
