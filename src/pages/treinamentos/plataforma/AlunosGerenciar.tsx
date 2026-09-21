import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2, Mail, Search, UserCheck, UserX, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { MENU, type StatusAluno } from "./tipos";
import { Paginacao, StatusAlunoBadge, TrnCarregando, TrnEstilo, TrnHero, TrnKpi, TrnVazio, fmtData, fmtDataHora } from "./ui";

// =====================================================================
// TREINAMENTOS — Alunos › Gerenciar (21/09/2026).
//
// Substitui o "Adicionar novo" do membox. Aqui aluno É colaborador: a
// lista vem do cadastro da Senior (EMPREGADOS) e entra sozinha na admissão
// (trigger trg_trn_aluno_do_empregado, migrations 193/194). Quem está
// "Trabalhando" é ativo; afastado ou demitido é inativo. Não se cadastra
// aluno à mão nem se sincroniza à mão: o gatilho em EMPREGADOS faz tudo
// (a RPC trn_sincronizar_alunos fica pra uso interno/manutenção).
//
// São 13 mil alunos: os números do topo vêm de uma chamada (resumo) e a
// lista é PAGINADA NO BANCO com os filtros (mig 195) — puxar tudo pra
// filtrar aqui levava mais de 10 s.
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
  total: number;
}
interface Resumo {
  ativos: number; inativos: number; afastados: number; demitidos: number; bloqueados: number;
  sem_email_ativos: number; ultima_sync: string | null;
  contratos: { nome: string; n: number; ativos: number }[]; situacoes: string[];
}

const fmtCpf = (v: string | null) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : (v ?? "—");
};

/** Espera a pessoa parar de digitar antes de ir ao banco. */
function useDebounce<T>(valor: T, ms = 350): T {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

export default function AlunosGerenciar() {
  const { data: resumo } = useQuery({
    queryKey: ["trn-alunos-resumo"],
    queryFn: async (): Promise<Resumo> => {
      const { data, error } = await (supabase as any).rpc("trn_alunos_gerenciar_resumo");
      if (error) throw error;
      return data as Resumo;
    },
  });

  const [busca, setBusca] = useState("");
  const buscaLenta = useDebounce(busca);
  const [fStatus, setFStatus] = useState<"" | "ativo" | "inativo" | "bloqueado" | "pendente">("");
  const [fSituacao, setFSituacao] = useState("");
  const [fContratos, setFContratos] = useState<string[]>([]);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  useEffect(() => { setPagina(1); }, [buscaLenta, fStatus, fSituacao, fContratos, porPagina]);

  const { data: paginaDados, isLoading, isFetching } = useQuery({
    queryKey: ["trn-alunos-gerenciar", buscaLenta, fStatus, fSituacao, fContratos, pagina, porPagina],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<AlunoGerenciar[]> => {
      const { data, error } = await (supabase as any).rpc("trn_alunos_gerenciar", {
        _busca: buscaLenta || null, _status: fStatus || null, _situacao: fSituacao || null,
        _contratos: fContratos.length ? fContratos : null, _offset: (pagina - 1) * porPagina, _limite: porPagina,
      });
      if (error) throw error;
      return (data ?? []) as AlunoGerenciar[];
    },
  });
  const itens = paginaDados ?? [];
  const totalFiltrado = itens[0]?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / porPagina));

  // O dropdown de contratos conta por linha; aqui as "linhas" são o resumo
  // (uma por aluno, só com o contrato) — barato e não puxa a lista inteira.
  const linhasContrato = useMemo(
    () => (resumo?.contratos ?? []).flatMap((c) => Array.from({ length: c.n }, () => ({ contrato: c.nome }))),
    [resumo],
  );


  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.alunosNovo} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para gerenciar os alunos.</Card>}>
        <TrnHero
          eyebrow="Treinamentos › Alunos"
          titulo="Gerenciar alunos"
          texto="Aluno é colaborador: a lista vem do cadastro da Senior e acompanha sozinha a admissão, o afastamento e a demissão. Quem está Trabalhando é ativo; afastado ou demitido fica inativo."
          pilulas={resumo ? [`${resumo.ativos} ativo(s)`, `${resumo.inativos} inativo(s)`, resumo.ultima_sync ? `Cadastro atualizado em ${fmtDataHora(resumo.ultima_sync)}` : "Cadastro ainda não lido"] : undefined}
          acoes={<Link to="/app/treinamentos/alunos"><Users className="h-4 w-4" /> Todos os alunos</Link>}
        />

        <div className="trn-kpis">
          <TrnKpi rotulo="Ativos" valor={resumo?.ativos ?? "…"} sub="Situação Trabalhando" icone={<UserCheck className="h-5 w-5" />} />
          <TrnKpi rotulo="Inativos" valor={resumo?.inativos ?? "…"} sub={resumo ? `${resumo.afastados} afastado(s) · ${resumo.demitidos} demitido(s)` : undefined} icone={<UserX className="h-5 w-5" />} />
          <TrnKpi rotulo="Contratos" valor={resumo?.contratos.length ?? "…"} sub="com colaborador na plataforma" icone={<Building2 className="h-5 w-5" />} />
          <TrnKpi rotulo="Sem e-mail no cadastro" valor={resumo?.sem_email_ativos ?? "…"} sub="só entre os ativos (Trabalhando)" icone={<Mail className="h-5 w-5" />} />
        </div>

        <div className="trn-card mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Pesquisar por nome, CPF, e-mail, cargo ou contrato" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <FiltroContratos linhas={linhasContrato} campo="contrato" selecionados={fContratos} onChange={setFContratos} />
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
                {(resumo?.situacoes ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? <TrnCarregando texto="Carregando alunos…" /> : totalFiltrado === 0 && !busca && !fStatus && !fSituacao && !fContratos.length ? (
          <TrnVazio titulo="Nenhum aluno ainda" texto="Os colaboradores entram sozinhos a partir do cadastro da Senior." />
        ) : (
          <div className={`trn-card overflow-hidden p-0 ${isFetching ? "opacity-70" : ""}`}>
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
                  {itens.map((a) => (
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
                  {itens.length === 0 && (
                    <tr><td colSpan={10} className="py-8 text-center text-sm text-muted-foreground">Nada bate com o filtro atual.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Paginacao pagina={pagina} total={totalPaginas} porPagina={porPagina} setPorPagina={setPorPagina} setPagina={setPagina} quantidade={totalFiltrado} rotulo="alunos" />
          </div>
        )}
      </AcessoGate>
    </div>
  );
}
