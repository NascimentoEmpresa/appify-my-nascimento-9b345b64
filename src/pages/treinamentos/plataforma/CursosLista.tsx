import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Plus, Star, Users } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { urlMidia, useTrnCategorias, useTrnCursos } from "@/hooks/useTreinamentosPlataforma";
import { MENU } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero, TrnVazio } from "./ui";

// =====================================================================
// TREINAMENTOS — Cursos › Visualizar (a vitrine de cartões do membox).
// Busca, filtro por publicação/categoria, cartão com capa, badges e os
// números (alunos, avaliação). O cartão abre a visualização do curso
// (módulos e aulas).
// =====================================================================

export default function CursosLista() {
  const { data: cursos = [], isLoading } = useTrnCursos();
  const { data: categorias = [] } = useTrnCategorias();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<string>("publicados");

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return cursos.filter((c) => {
      if (b && !c.nome.toLowerCase().includes(b)) return false;
      if (filtro === "publicados" && !c.publicado) return false;
      if (filtro === "rascunhos" && c.publicado) return false;
      if (filtro.startsWith("cat:") && c.categoria_id !== filtro.slice(4)) return false;
      if (filtro === "semcat" && c.categoria_id) return false;
      return true;
    });
  }, [cursos, busca, filtro]);
  const semCategoria = cursos.filter((c) => !c.categoria_id).length;

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.cursos} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para ver os cursos.</Card>}>
        <TrnHero titulo="Todos os cursos" texto={`${cursos.filter((c) => c.publicado).length} publicado(s) de ${cursos.length}. Cada curso tem módulos e aulas; o aluno entra por matrícula ou acesso completo.`}
                 acoes={<AcessoGate menu={MENU.cursosNovo} acao="visualizar"><Link to="/app/treinamentos/cursos/novo"><Plus className="h-4 w-4" /> Adicionar curso</Link></AcessoGate>} />

        <div className="trn-card mb-4 flex flex-wrap gap-3">
          <Input className="min-w-[240px] flex-1" placeholder="Buscar curso" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="publicados">Todos os cursos publicados</SelectItem>
              <SelectItem value="rascunhos">Rascunhos (não publicados)</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="semcat">Sem categoria ({semCategoria})</SelectItem>
              {categorias.map((c) => <SelectItem key={c.id} value={`cat:${c.id}`}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? <TrnCarregando texto="Carregando cursos…" /> : cursos.length === 0 ? (
          <TrnVazio titulo="Nenhum curso ainda" texto="Crie o primeiro curso: nome, descrição, capa, e depois módulos e aulas." acao={<Button asChild><Link to="/app/treinamentos/cursos/novo">Adicionar curso</Link></Button>} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lista.map((c) => {
              const capa = urlMidia(c.capa_path);
              return (
                <Link key={c.id} to={`/app/treinamentos/cursos/${c.id}`} className="trn-curso-card transition hover:shadow-lg">
                  <div className="capa">{capa ? <img src={capa} alt={c.nome} /> : c.nome}</div>
                  <div className="corpo">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`trn-badge ${c.publicado ? "ok" : "off"}`}>{c.publicado ? "Publicado" : "Rascunho"}</span>
                      {c.em_breve && <span className="trn-badge warn">Em breve</span>}
                      <span className="trn-badge info">{c.modulos_como_cursos ? "Módulos na vitrine" : "Formato composto"}</span>
                      {c.categoria && <span className="trn-badge off">{c.categoria}</span>}
                      <a href={`/app/treinamentos/cursos/${c.id}`} onClick={(e) => e.stopPropagation()} className="ml-auto text-slate-400" title={`/${c.slug}`}><ExternalLink className="h-3.5 w-3.5" /></a>
                    </div>
                    <h3>{c.nome}</h3>
                    <p>{c.descricao || "Sem descrição."}</p>
                    <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.alunos} aluno(s)</span>
                      <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-500" /> {c.avaliacao != null ? `${Number(c.avaliacao).toFixed(1)} (${c.avaliacoes})` : "—"}</span>
                      <span className="ml-auto">{c.modulos} mód. · {c.aulas} aula(s)</span>
                    </div>
                  </div>
                </Link>
              );
            })}
            {lista.length === 0 && <div className="trn-vazio sm:col-span-3">Nenhum curso bate com o filtro.</div>}
          </div>
        )}
      </AcessoGate>
    </div>
  );
}
