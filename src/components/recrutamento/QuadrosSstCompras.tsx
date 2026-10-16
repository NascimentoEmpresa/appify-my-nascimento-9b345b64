// =====================================================================
// Recrutamento › kanban › SST + COMPRAS — um quadro para cada lado
// (16/10/2026).
//
// Pedido do Pablo (com print do card): "quando clico em Status compras,
// aparece lá no fundo só uma animação diferente e nada acontece, deixa um
// card pra cada aqui quando estiver em SST + compras, pode aumentar pq só vai
// ter um candidato nessa fase mesmo sempre. ajusta o layout pra não ficar
// esse TANTO de informação, ficar mais intuitivo." E: "adiciona um botão de
// enviar agendamento com o ícone do whatsapp, pra enviar pro número do
// candidato".
//
// Antes o card tinha, ao mesmo tempo: "✓ SST aprovou", duas pílulas (SST ·
// data / Compras), dois botões "Status SST"/"Status Compras" e "Aguardando
// Compras" — a mesma informação três vezes. Agora são dois quadros, cada um
// com o que importa daquele lado e o botão dele. Clicar no quadro abre o
// detalhe (StatusSstDialog / PedidoComprasCandidato). Só lê o que o card já
// tem — sem consulta nova.
// =====================================================================
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { CalendarDays, CheckCircle2, ChevronRight, Clock, Loader2, MapPin, Package, Stethoscope, XCircle } from "lucide-react";
import { resumoAgendamentoAso, situacaoSst, type AgendamentoAso } from "@/lib/recrutamento/agendamentoAso";

export function IconeWhatsApp({ tamanho = 12, cor = "#fff" }: { tamanho?: number; cor?: string }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill={cor} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

type Tom = { cor: string; fundo: string; borda: string };
const VERDE: Tom = { cor: "#15803d", fundo: "#f0fdf4", borda: "#bbf7d0" };
const AMBAR: Tom = { cor: "#b45309", fundo: "#fffbeb", borda: "#fde68a" };
const AZUL: Tom = { cor: "#0369a1", fundo: "#f0f9ff", borda: "#bae6fd" };
const VERMELHO: Tom = { cor: "#b91c1c", fundo: "#fef2f2", borda: "#fecaca" };
const CINZA: Tom = { cor: "#64748b", fundo: "#f8fafc", borda: "#e2e8f0" };

const ROTULO_PEDIDO: Record<string, string> = {
  "EM PREPARACAO": "Em preparação", "EM SEPARACAO": "Em separação", "AGUARDANDO ENVIO": "Aguardando envio",
  "RETIRADO PARA ENTREGA": "Saiu para entrega", "AGUARDANDO COMPRA": "Aguardando compra", "DESPACHADO": "Despachado", "CANCELADO": "Cancelado",
};

function Quadro({ titulo, icone, tom, chip, onAbrir, rotuloAbrir, children }: {
  titulo: string; icone: ReactNode; tom: Tom; chip: string; onAbrir: () => void; rotuloAbrir: string; children: ReactNode;
}) {
  return (
    <div role="button" tabIndex={0} onClick={onAbrir} onKeyDown={(e) => { if (e.key === "Enter") onAbrir(); }} title={rotuloAbrir}
      style={{ background: "#fff", border: `1px solid ${tom.borda}`, borderLeft: `4px solid ${tom.cor}`, borderRadius: 10, padding: "9px 10px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: tom.cor, display: "inline-flex" }}>{icone}</span>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "#0f172a", flex: 1 }}>{titulo}</span>
        <ChevronRight size={14} color="#94a3b8" aria-hidden />
      </div>
      <span style={{ alignSelf: "flex-start", fontSize: 11, fontWeight: 800, color: tom.cor, background: tom.fundo, border: `1px solid ${tom.borda}`, borderRadius: 20, padding: "2px 9px" }}>{chip}</span>
      {children}
    </div>
  );
}

const linhaInfo: CSSProperties = { fontSize: 11.5, color: "#334155", display: "flex", alignItems: "flex-start", gap: 5, lineHeight: 1.35 };

export function QuadrosSstCompras({ candidato, pedido, podeEnviar, enviando, onAbrirSst, onAbrirCompras, onEnviarAgendamento }: {
  candidato: AgendamentoAso & { compras_ok?: boolean | null; compras_dispensado?: boolean | null };
  pedido?: { protocolo: string; status: string } | null;
  /** Tem telefone e quem vê pode recrutar. */
  podeEnviar: boolean;
  enviando: boolean;
  onAbrirSst: () => void;
  onAbrirCompras: () => void;
  onEnviarAgendamento: () => void;
}) {
  const c = candidato;
  const sit = situacaoSst(c);
  const tomSst = sit === "Agendado" ? VERDE : sit === "Reprovado pelo SST" ? VERMELHO : sit === "Recebido — a agendar" ? AZUL : AMBAR;
  const iconeSst = sit === "Agendado" ? <CheckCircle2 size={12} aria-hidden /> : sit === "Reprovado pelo SST" ? <XCircle size={12} aria-hidden /> : <Clock size={12} aria-hidden />;

  const comprasOk = c.compras_ok === true;
  const comprasNao = c.compras_ok === false;
  const tomCompras = comprasOk ? VERDE : comprasNao ? VERMELHO : c.compras_dispensado ? CINZA : AMBAR;
  const chipCompras = comprasOk ? "Compras aprovou" : comprasNao ? "Reprovado no Compras"
    : pedido ? ROTULO_PEDIDO[pedido.status] ?? pedido.status : c.compras_dispensado ? "Sem pedido de materiais" : "Aguardando o Compras";

  const enviar = (e: MouseEvent) => { e.stopPropagation(); onEnviarAgendamento(); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
      <Quadro titulo="SST · Exame admissional" icone={<Stethoscope size={14} aria-hidden />} tom={tomSst}
        chip={sit === "Agendado" && c.sst_ok === true ? "Agendado · SST aprovou" : sit}
        onAbrir={onAbrirSst} rotuloAbrir="Ver o status do SST e o agendamento completo (copiar mapa e agendamento)">
        {c.sst_data_exame ? (
          <>
            <div style={{ ...linhaInfo, fontWeight: 800, fontSize: 12.5, color: "#0f172a" }}><CalendarDays size={13} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />{resumoAgendamentoAso(c)}</div>
            {c.sst_local_exame && (
              <div style={linhaInfo} title={c.sst_local_exame}>
                <MapPin size={13} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{c.sst_local_exame}</span>
              </div>
            )}
            <button type="button" onClick={enviar} disabled={!podeEnviar || enviando}
              title={podeEnviar ? "Enviar data, horário, local e mapa do exame para o WhatsApp do candidato" : "Candidato sem telefone válido"}
              style={{ marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "7px 8px", borderRadius: 8, border: "none",
                background: podeEnviar ? "#25d366" : "#cbd5e1", color: "#fff", fontSize: 11.5, fontWeight: 800, cursor: podeEnviar && !enviando ? "pointer" : "default" }}>
              {enviando ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <IconeWhatsApp tamanho={13} />}
              {enviando ? "Enviando…" : "Enviar agendamento"}
            </button>
          </>
        ) : (
          <div style={{ ...linhaInfo, color: "#64748b" }}>
            {iconeSst}
            {sit === "Reprovado pelo SST" ? (c.sst_obs || "O SST reprovou o candidato.")
              : sit === "Recebido — a agendar" ? "O SST recebeu e vai agendar o exame."
              : "Esperando o SST receber."}
          </div>
        )}
      </Quadro>

      <Quadro titulo="Compras · Materiais" icone={<Package size={14} aria-hidden />} tom={tomCompras} chip={chipCompras}
        onAbrir={onAbrirCompras} rotuloAbrir="Ver o pedido de materiais (itens, status e histórico)">
        <div style={{ ...linhaInfo, color: "#64748b" }}>
          {pedido ? <>Pedido <b style={{ color: "#0f172a", fontFamily: "ui-monospace, monospace" }}>{pedido.protocolo}</b></>
            : c.compras_dispensado ? "Seguiu sem pedido de materiais." : "Pedido ainda não gerado."}
        </div>
      </Quadro>
    </div>
  );
}
