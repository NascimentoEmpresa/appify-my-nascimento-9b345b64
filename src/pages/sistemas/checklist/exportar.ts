import { opcaoDe, type Etapa, type LinhaModulo } from "@/lib/sistemas/checklistModulos";
import { fmtDataHora } from "./ui";

// "Exportar Relatório": planilha com uma aba de MÓDULOS (como a lista do
// painel) e outra com cada TELA (submódulo). Passando um módulo só, sai só ele.

const rot = (etapa: Etapa, v: string | null | undefined) => opcaoDe(etapa, v)?.rotulo ?? "Pendente";
const pctTxt = (x: number | null) => (x == null ? "" : `${Math.round(x * 100)}%`);

export async function exportarChecklist(modulos: LinhaModulo[], nomeUsuario: Map<string, string>, nomeArquivo?: string) {
  const XLSX = await import("xlsx");
  const nome = (id: string | null | undefined) => (id ? nomeUsuario.get(id) ?? "" : "");
  const resumo = modulos.filter((m) => m.modulo.ativo || modulos.length === 1).map((m) => ({
    "Módulo": m.modulo.nome, "Área": m.area,
    "Status do desenvolvimento": rot("dev", m.status.status_dev), "Implantação": rot("implantacao", m.status.status_implantacao),
    "Treinamento": rot("treinamento", m.status.status_treinamento), "Validação do usuário": rot("validacao", m.status.status_validacao),
    "Responsável": nome(m.responsavelId), "Usuário-chave": nome(m.usuarioChaveId),
    "Última atualização": m.ultimaAtualizacao ? fmtDataHora(m.ultimaAtualizacao) : "", "Efetividade": pctTxt(m.efetividade),
    "Submódulos ativos": m.ativas, "Submódulos preenchidos": m.preenchidas,
    "Com acesso (pessoas)": m.comAcesso, "Usaram 30d (pessoas)": m.ativos30d, "Bugs abertos": m.bugsAbertos, "Chamados abertos": m.chamadosAbertos,
    "Observações": m.item?.observacoes ?? "",
  }));
  const telas = modulos.flatMap((m) => m.telas.map((t) => ({
    "Módulo": m.modulo.nome, "Submódulo (tela)": t.tela.nome, "Rota": t.tela.rota, "Ativa": t.tela.ativo ? "Sim" : "Não",
    "Desenvolvimento": rot("dev", t.item?.status_dev), "Implantação": rot("implantacao", t.item?.status_implantacao),
    "Treinamento": rot("treinamento", t.item?.status_treinamento), "Validação do usuário": rot("validacao", t.item?.status_validacao),
    "Responsável": nome(t.item?.responsavel_id ?? m.responsavelId), "Usuário-chave": nome(t.item?.usuario_chave_id ?? m.usuarioChaveId),
    "Previsão de entrega": t.item?.previsao_entrega ?? "", "Implantado em": t.item?.data_implantacao ?? "",
    "Treinado em": t.item?.data_treinamento ?? "", "Validado em": t.item?.data_validacao ?? "",
    "Com acesso": t.tela.com_acesso, "Usaram (30d)": t.tela.ativos_30d, "Acessos (30d)": t.tela.acessos_30d,
    "Bugs abertos": t.bugsAbertos, "Efetividade": pctTxt(t.efetividade),
    "Observações": t.item?.observacoes ?? "", "Atualizado por": t.item?.atualizado_por ?? "", "Atualizado em": t.item ? fmtDataHora(t.item.atualizado_em) : "",
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Módulos");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(telas), "Submódulos");
  XLSX.writeFile(wb, `${nomeArquivo ?? "efetividade-modulos"}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
