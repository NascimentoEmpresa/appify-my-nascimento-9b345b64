import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ModalExportarDados } from "@/components/exportar/ModalExportarDados";
import { baixar, carregarDadosExportacao, gerarExcel, gerarHtml, nomeArquivo, type Linha } from "./exportar";

// "Exportar dados" do Patrimônio (21/09/2026): o modal é o comum; aqui só se
// diz quais registros existem e como buscar/montar o arquivo (./exportar.ts).

interface PatrimonioOpcao { id: number; codigo?: string; descricao: string; cidade?: string }

interface Props {
  db: SupabaseClient;
  patrimonios: PatrimonioOpcao[];
  /** Abrir já com "apenas um" marcado nesse patrimônio (botão do drawer). */
  inicialId?: number | null;
  seloDaConta: (o: Linha) => string;
  autor: string;
  onFechar: () => void;
  onAviso: (msg: string, tipo: "ok" | "err") => void;
}

const numCodigo = (c?: string) => parseInt(String(c ?? "").replace(/\D/g, ""), 10) || 1e9;

export function ExportarPatrimonios({ db, patrimonios, inicialId, seloDaConta, autor, onFechar, onAviso }: Props) {
  const registros = useMemo(() => [...patrimonios]
    .sort((a, b) => numCodigo(a.codigo) - numCodigo(b.codigo))
    .map(p => ({ id: String(p.id), titulo: `${p.codigo ? `${p.codigo} · ` : ""}${p.descricao}`, detalhe: p.cidade })), [patrimonios]);

  return (
    <ModalExportarDados
      nome={{ um: "patrimônio", varios: "patrimônios" }}
      conteudo="Sai a ficha do patrimônio e tudo o que está nas abas: contas, parcelas, acessos, contatos, documentos, histórico e comentários."
      registros={registros}
      inicialId={inicialId != null ? String(inicialId) : null}
      onFechar={onFechar}
      onErro={msg => onAviso(msg, "err")}
      onExportar={async (formato, id) => {
        const dados = await carregarDadosExportacao(db, id == null ? null : Number(id));
        if (!dados.patrimonios.length) throw new Error("nenhum patrimônio para exportar.");
        const opcoes = { seloDaConta, autor };
        const nome = nomeArquivo(dados, id != null);
        if (formato === "excel") baixar(gerarExcel(dados, opcoes), `${nome}.xlsx`);
        else baixar(gerarHtml(dados, opcoes), `${nome}.html`);
        onAviso("Exportação gerada — confira os downloads.", "ok");
      }}
    />
  );
}
