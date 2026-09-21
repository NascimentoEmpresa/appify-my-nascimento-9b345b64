import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useTrnImportarAlunos } from "@/hooks/useTreinamentosPlataforma";
import { MENU } from "./tipos";
import { TrnEstilo, TrnHero } from "./ui";

// =====================================================================
// TREINAMENTOS — Alunos › Importar (planilha .xlsx, como no membox).
//
// Colunas da planilha modelo: Nome*, E-mail*, Telefone, Documento,
// Observações, Tags ("A; B; C"), Cursos ("nome ou slug; …"). Cabeçalhos
// são casados sem acento e sem caixa, então a planilha exportada do próprio
// membox ("Nome", "E-mail", "Tags"…) entra sem retrabalho. Quem grava é a
// RPC `trn_importar_alunos`: aluno existente (mesmo e-mail) é atualizado,
// tags somam ou substituem conforme o toggle.
// =====================================================================

const COLUNAS_MODELO = ["Nome", "E-mail", "Telefone", "Documento", "Observações", "Tags", "Cursos"];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const MAPA: Record<string, string> = {
  nome: "nome", nomedoaluno: "nome", aluno: "nome",
  email: "email", emaildoaluno: "email",
  telefone: "telefone", celular: "telefone", whatsapp: "telefone",
  documento: "documento", cpf: "documento",
  observacoes: "observacoes", observacao: "observacoes", obs: "observacoes",
  tags: "tags", tag: "tags", posto: "tags", contrato: "tags",
  cursos: "cursos", curso: "cursos",
};

export default function AlunosImportar() {
  const navigate = useNavigate();
  const importar = useTrnImportarAlunos();
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [linhas, setLinhas] = useState<Record<string, string>[]>([]);
  const [colunasLidas, setColunasLidas] = useState<string[]>([]);
  const [substituir, setSubstituir] = useState(false);
  const [resultado, setResultado] = useState<{ criados: number; atualizados: number; erros: { linha: number; erro: string }[] } | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const baixarModelo = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUNAS_MODELO, ["MARIA DA SILVA", "maria@exemplo.com", "+55 54 99999-9999", "000.000.000-00", "", "FURG HU; REALIZADOS", "NR-1; Integração de funcionários"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Alunos");
    XLSX.writeFile(wb, "modelo-importacao-alunos.xlsx");
  };

  const ler = async (file: File) => {
    setArquivo(file); setResultado(null);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const bruto = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    if (!bruto.length) { toast.error("A planilha está vazia."); setLinhas([]); return; }
    const cabecalhos = Object.keys(bruto[0]);
    setColunasLidas(cabecalhos);
    const mapeadas = bruto.map((r) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        const alvo = MAPA[norm(k)];
        if (alvo) out[alvo] = String(v ?? "").trim();
      }
      return out;
    }).filter((r) => r.nome || r.email);
    setLinhas(mapeadas);
    const semEmail = mapeadas.filter((r) => !r.email).length;
    if (!mapeadas.some((r) => r.email)) toast.error("Não achei a coluna E-mail — confira o cabeçalho da planilha.");
    else if (semEmail) toast.warning(`${semEmail} linha(s) sem e-mail vão ser ignoradas.`);
  };

  const enviar = async () => {
    if (!linhas.length) return toast.error("Escolha a planilha primeiro.");
    try {
      const r = await importar.mutateAsync({ linhas, substituirTags: substituir });
      setResultado(r);
      toast.success(`${r.criados} criado(s), ${r.atualizados} atualizado(s)${r.erros.length ? `, ${r.erros.length} com erro` : ""}.`);
      if (!r.erros.length) setTimeout(() => navigate("/app/treinamentos/alunos"), 1200);
    } catch (e: any) { toast.error(e?.message ?? "Não deu para importar."); }
  };

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.alunosImportar} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para importar alunos.</Card>}>
        <TrnHero eyebrow="Treinamentos › Alunos" titulo="Importar alunos" texto="Adicione alunos em massa a partir de uma planilha .xlsx — inclusive a lista exportada do membox."
                 acoes={<Link to="/app/treinamentos/alunos" className="sec">← Todos os alunos</Link>} />
        <div className="trn-lateral">
          <div className="trn-form">
            <div className="grupo">
              <h4>Adicionar arquivo</h4>
              <button type="button" className="mb-3 flex items-center gap-1 text-sm font-semibold text-orange-600 hover:underline" onClick={baixarModelo}>
                <Download className="h-4 w-4" /> Baixe aqui a planilha modelo com o formato correto
              </button>
              <div
                className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-10 text-center text-sm ${arrastando ? "border-orange-400 bg-orange-50" : "border-slate-300"}`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files?.[0]; if (f) ler(f); }}
              >
                <FileSpreadsheet className="mb-2 h-8 w-8 text-slate-400" />
                {arquivo ? <b>{arquivo.name} — {linhas.length} linha(s) lida(s)</b> : "Arraste e solte a planilha (.xlsx) aqui ou clique para selecionar"}
                <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); }} />
              </div>
              {colunasLidas.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">Colunas encontradas: {colunasLidas.join(", ")}.</p>
              )}
            </div>

            <div className="grupo">
              <h4>Substituir os dados de Tags?</h4>
              <label className="flex items-center gap-2 text-sm"><Switch checked={substituir} onCheckedChange={setSubstituir} /> Substituir e remover dados existentes de Tags</label>
              <div className="mt-2 rounded-lg bg-orange-50 p-3 text-xs text-slate-700">
                <b>Habilitado:</b> para alunos que já existem na plataforma e vierem na planilha (atualização), as tags são <b>substituídas</b> pelas da planilha.<br />
                <b>Desabilitado (padrão):</b> as tags da planilha são <b>somadas</b> às já vinculadas, sem duplicar.
              </div>
            </div>

            {linhas.length > 0 && (
              <div className="grupo">
                <h4>Prévia ({Math.min(linhas.length, 8)} de {linhas.length})</h4>
                <div className="overflow-x-auto">
                  <table className="trn-tab">
                    <thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>Documento</th><th>Tags</th><th>Cursos</th></tr></thead>
                    <tbody>{linhas.slice(0, 8).map((l, i) => <tr key={i}><td>{l.nome}</td><td>{l.email || <span className="text-rose-600">sem e-mail</span>}</td><td>{l.telefone}</td><td>{l.documento}</td><td>{l.tags}</td><td>{l.cursos}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}

            {resultado && (
              <div className="grupo">
                <h4>Resultado</h4>
                <p className="text-sm"><b>{resultado.criados}</b> aluno(s) criado(s) · <b>{resultado.atualizados}</b> atualizado(s) · <b>{resultado.erros.length}</b> erro(s)</p>
                {resultado.erros.length > 0 && (
                  <ul className="mt-2 max-h-48 overflow-y-auto text-xs text-rose-700">
                    {resultado.erros.map((e, i) => <li key={i}>Linha {e.linha}: {e.erro}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              Este processo pode levar alguns segundos. Depois de clicar em "Importar alunos" aguarde a confirmação — você será levado(a) para a lista de alunos.
            </div>
            <AcessoGate menu={MENU.alunosImportar} acao="incluir" fallback={<p className="text-xs text-muted-foreground">Você pode ver, mas não tem a ação de incluir.</p>}>
              <div><Button disabled={importar.isPending || !linhas.length} onClick={enviar}><Upload className="mr-2 h-4 w-4" /> Importar alunos</Button></div>
            </AcessoGate>
          </div>

          <div className="trn-ajuda">
            <h4>Importe novos alunos</h4>
            Esta área permite adicionar alunos em massa, ideal quando há muitos alunos a cadastrar — por exemplo, a lista exportada do membox.
            <h5>Colunas</h5>
            {COLUNAS_MODELO.join(" · ")}. Nome e E-mail são obrigatórios; o resto é opcional.
            <h5>Tags e Cursos</h5>
            Separe por ponto e vírgula. Tag que não existe é criada. Curso é casado pelo nome ou pelo slug — o que não bater é ignorado sem travar a linha.
          </div>
        </div>
      </AcessoGate>
    </div>
  );
}
