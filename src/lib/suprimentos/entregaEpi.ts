export interface ItemEntregaEpi {
  pedido_item_id: string;
  descricao: string;
  tamanho: string | null;
  codigo: string;
  ca: string | null;
  ca_validade: string | null;
  quantidade: number;
}

export interface DocumentoEntregaEpi {
  id: string;
  path: string;
  legivel: boolean;
  observacao: string | null;
  anexado_em: string;
}

export type SituacaoEntregaEpi =
  | "aguardando_confirmacao" | "aguardando_ficha" | "ficha_ilegivel" | "ficha_recebida" | "confirmado";

export const ROTULO_SITUACAO_EPI: Record<SituacaoEntregaEpi, string> = {
  aguardando_confirmacao: "Aguardando confirmação",
  aguardando_ficha: "Aguardando ficha",
  ficha_ilegivel: "Ficha ilegível",
  ficha_recebida: "Ficha recebida",
  confirmado: "Confirmado pelo colaborador",
};

export interface EntregaEpi {
  id: string;
  pedido_id: string;
  protocolo: string;
  cpf: string;
  colaborador_nome: string;
  matricula: string | null;
  empresa_nome: string | null;
  contrato_nome: string;
  posto_nome: string;
  funcao_nome: string;
  solicitado_em: string;
  separado_em: string | null;
  enviado_em: string | null;
  registrado_em: string;
  entregador_nome: string;
  modo: "eletronico" | "fisico";
  itens: ItemEntregaEpi[];
  confirmado_em: string | null;
  confirmacao_hash: string | null;
  declaracao_versao: number;
  situacao: SituacaoEntregaEpi;
  documentos: DocumentoEntregaEpi[];
}

export const DECLARACAO_EPI =
  "Confirmo que recebi os EPIs descritos acima, nas quantidades indicadas, e recebi orientação sobre uso adequado, limitações, guarda, conservação, limpeza, manutenção e substituição. Comprometo-me a usar os equipamentos conforme as orientações recebidas e comunicar dano, perda ou necessidade de troca.";

export function dataHoraEpi(valor: string | null): string {
  return valor ? new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export function dataEpi(valor: string | null): string {
  if (!valor) return "—";
  const [ano, mes, dia] = valor.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export interface ComprovanteEpiImpressao {
  protocolo: string;
  colaborador: string;
  matricula: string | null;
  empresa: string | null;
  contrato: string;
  posto: string;
  responsavel: string;
  itens: ItemEntregaEpi[];
  confirmadoEm: string | null;
  hash: string | null;
}

const escapar = (valor: unknown) => String(valor ?? "—").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c] ?? c));

export function imprimirComprovanteEpi(dados: ComprovanteEpiImpressao) {
  const linhas = dados.itens.map((i) => `<tr><td>${escapar(i.descricao)}</td><td>${escapar(i.tamanho)}</td><td>${i.quantidade}</td><td>${escapar(i.codigo)}</td><td>${escapar(i.ca)}</td><td>${escapar(dataEpi(i.ca_validade))}</td></tr>`).join("");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovante EPI ${escapar(dados.protocolo)}</title>
    <style>body{font:14px Arial,sans-serif;color:#17212b;margin:32px}h1{font-size:20px}p{line-height:1.5}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{border:1px solid #9aa6b2;padding:7px;text-align:left}th{background:#eef2f5}.hash{word-break:break-all;font-size:11px}@media print{body{margin:12mm}}</style></head><body>
    <h1>Comprovante de entrega de EPI</h1><p><b>Protocolo:</b> ${escapar(dados.protocolo)}<br><b>Colaborador:</b> ${escapar(dados.colaborador)}<br><b>Matrícula:</b> ${escapar(dados.matricula)}<br><b>Empresa:</b> ${escapar(dados.empresa)}<br><b>Contrato / posto:</b> ${escapar(dados.contrato)} / ${escapar(dados.posto)}<br><b>Responsável pela entrega:</b> ${escapar(dados.responsavel)}</p>
    <table><thead><tr><th>EPI</th><th>Tamanho</th><th>Qtd.</th><th>Lote</th><th>CA</th><th>Validade CA</th></tr></thead><tbody>${linhas}</tbody></table>
    <p>${escapar(DECLARACAO_EPI)}</p><p><b>Confirmação eletrônica:</b> ${escapar(dataHoraEpi(dados.confirmadoEm))}</p>
    <p class="hash"><b>SHA-256:</b> ${escapar(dados.hash)}</p><script>window.onload=()=>window.print();</script></body></html>`;
  const janela = window.open("", "_blank");
  if (!janela) throw new Error("Permita a abertura da janela de impressão.");
  janela.opener = null;
  janela.document.write(html);
  janela.document.close();
}
