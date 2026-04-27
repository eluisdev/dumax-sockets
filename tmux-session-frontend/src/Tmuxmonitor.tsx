import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import html2canvas from "html2canvas";
import logo from "./assets/Logo.png";

// SOCKET_URL viene de VITE_SOCKET_URL en producción (Netlify env var).
// En dev usa el backend local por defecto.
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) || "http://localhost:4001";

const SESSION_PRESETS: { server: string; sessions: string[] }[] = [
  {
    server: "Wialon",
    sessions: [
      "AAMER_CANACAR_GECKOTECH_WS", "AAMER_TRANSPLACE_WS", "ACTRANSPORTE_CANACAR_GECKOTECH_WS",
      "AEANDRADE_Dicka_RC", "AMESIS", "AUTOEXXPRES45_SOLISTICA_RC", "BOSQUES2017_DHL_RC",
      "BOSQUES2017_NISSAN_RC_WS", "CAMACHO2018_SOFTYS_RC", "CDPUERTO_SKY_WS",
      "DAGO_HomeDepot_RC_WS", "DAGO_arcelormittal_SITRACK", "EARANDA25_RC_WS",
      "ELISEO_sitrack_ws", "FLOCAEXPRESS_SITRACK_WS", "FRGC2020", "FRGC2020_BLACSOLUTIONS_WS",
      "FRGC2020_MABE_skyangel_WS", "FRGCWS_Walmart", "Frgc2020_webtracker_WS",
      "Frgc_bafar_WideTech_WS", "GAMI_MABE_SKYANGEL_WS", "GAMI_QS3_WS", "GAMI_TRANSPLACE_RC_WS",
      "GOPASA_Transplace_RC", "JAGO_WS_RC", "JPRADO_BLACSOLUTIONS_WS", "MAVILA_WS_SIS",
      "OMARLAG_UNIGIS_KIMBERLY", "PACIFICOOL_RC_WS", "PENINSULAYSUR_ENVASESUNIVERSALES_RC_WS",
      "PNT_CHEDAUI_RC_WS", "PNT_RC_Walmart_WS", "R-HHS_KROHN_WS", "SESE_NEXO", "SESE_SOAPUI_WS",
      "TRANSPORTESCARIZAR_RC_WS", "TRANSPORTESMUMA_UNIGIS_WS", "TRANSPORTESRAQUEL_LEMADWS",
      "TRANSPORTESRAQUEL_RC_DHLWS", "TRANSPORTESRAQUEL_SOLISTICA_RC", "TRANSPORTESRAQUEL_WS_ASSISTCARGO",
      "TRANSVERO_Driving_WS", "TRCMTY_RC_Walmart", "WS_Sitrack", "XTCS_HOMEDEPOT_RC_WS",
      "camacho2018_ungis", "estadisticas_api", "fletexpress_project44_api", "frikarmex_pack2go_RC_ws",
      "r-tsterke_WHIRPOOL_RC_WS"
    ]
  },
  {
    server: "DUMAX v4",
    sessions: [
      "AMESIS", "ASERRANO_LANDSTAR_WS", "CLO-ORIVER_RC_WS", "GrupoPeak_CLOROX_RC_WS",
      "JJVAZQUEZ_BARCEL_alephri_ws", "JJVAZQUEZ_BIMBO_RC_WS", "LOESA_RC_WS", "MADERASSLP_LANDSTAR_WS",
      "RAFAGAS_SOLISTICA_RC", "RFERNANDEZC_ENVASESUNIVERSALES_RC_WS", "SORIA24_RXO_RC_WS",
      "TLBTRANSPORTES_ENVASESUNIVERSALES_RC", "TNREGIO_RC_WS", "TRANSPORTESCARIZAR_RC_WS",
      "Telopez_CHEP_ALTOTRACKWS", "gochat", "gomail", "gops_topfly", "grupopeak_pack2go_RC_ws",
      "javearredondo_transplace_RC_WS", "kronh_telopez", "mapi", "quecklink", "tcp_gops",
      "telopez_bimbo", "transgaly_SHIELD_RC_WS", "udp_gops"
    ]
  },
  {
    server: "V2",
    sessions: [
      "ASGP_PENSKE_QS3WS", "AVERGARA_UNIGIS_WS", "AYVIWS_RC", "BOSQUES_RC_DHLWS",
      "CANYWS_CTTMX_SUKARNE", "FRGC2020_SORIANA_WS", "FRGC2020_SORIANA_WS_REST",
      "HERON_SOLUCIONES_ASSISTCARGO_WS_UNIGIS", "HERON_SOLUCIONES_RECURSOCONFIABLE_SOLISTICA_WS",
      "IMEC_CHURCHILL_KAFLA", "NEW_PASA", "PASA", "PCAMARENA", "POVATRANSPORT_SKY_MABEWS",
      "RGC_CTTMX_SUKARNEWS", "SEREVE_UNIGIS_KIMBERLYCLARKWS", "Salmar", "SuKarne",
      "TMAXIMA_FREIGHTVERIFYWS", "TRANSPORTESRAQUEL_LEMADWS", "TransportesRaquel",
      "VILLASENOR_RECURSOCONFIABLE_WS", "WSTESPEJEL_UNIGIS_ALEGOJI", "XTCS_ALTOMOVUP_FCA",
      "XTCS_RECURSOCONFIABLE_HOME_DEPOT_WS", "XTCS_solistica_recursoconfiableWS", "Xoxocotla",
      "alegoji_unigis_alpuraWS", "alpha19_essity_rc", "altotrack", "bafar_jumber_cttmxWS",
      "balandranWS_RC", "central_rc", "copesu_unigis_alpuraws", "floca_express_RC", "flocaexpress",
      "gemaws2020", "imec", "impuls", "joseggomez", "krnonh", "larmont", "lemad_BOSQUES2017WS",
      "old_xoxocotla", "pcamarena_blac_alimentosWS", "povatransport_unigis_mabews", "queue_handler",
      "recursoconfiable_RC", "ruja", "sukarne_rc", "t_pinguino", "telopez_chep_altotrack",
      "telopez_solistica_recursoconfiableWS", "tmarin_unigis", "tmartinezWS_RC", "trafimex_rc",
      "travilsa_rc", "villarica_RC", "wsRecursoConfiable_rc", "wsrecursco_RC", "wszukarmex"
    ]
  }
];

type SshStatus = "disconnected" | "connecting" | "connected" | "error";
type XmlStatus = "idle" | "searching" | "found" | "not_found" | "cancelled";

interface ServerOption { id: string; label: string; host: string; }
interface XmlCapture { id: string; imei: string; plate: string; xml: string; attempt: number; ts: Date; }
interface XmlStatusMsg { status: string; msg: string; attempt?: number; max?: number; }

function field(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i"));
  return m?.[1]?.trim() ?? "—";
}

function StatusDot({ status }: { status: SshStatus }) {
  const cls: Record<SshStatus, string> = {
    connected: "bg-green-500 shadow-[0_0_6px_#16a34a]",
    connecting: "bg-amber-500",
    error: "bg-red-500",
    disconnected: "bg-slate-400",
  };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls[status]}`} />;
}

function ProgressBar({ current, max }: { current: number; max: number }) {
  return (
    <div className="bg-slate-200 rounded h-1 overflow-hidden my-1.5">
      <div
        className="h-full bg-green-500 rounded transition-all duration-400"
        style={{ width: `${Math.min((current / max) * 100, 100)}%` }}
      />
    </div>
  );
}

function XmlSummary({ xml }: { xml: string }) {
  const sections: { title: string; icon: string; rows: [string, string][] }[] = [
    {
      title: "Identificación",
      icon: "🔖",
      rows: [
        ["Asset", field(xml, "asset")],
        ["Serial", field(xml, "serialNumber")],
        ["IMEI", field(xml, "imei")],
        ["Unit ID", field(xml, "unitId")],
        ["Placa", field(xml, "plate")],
        ["VIN", field(xml, "vin")],
        ["Driver ID", field(xml, "driverId")],
      ],
    },
    {
      title: "Fecha / Hora",
      icon: "🕐",
      rows: [
        ["Fecha GPS", field(xml, "date").replace("T", " ").replace("Z", " UTC")],
        ["Fecha Servidor", field(xml, "serverDate").replace("T", " ").replace("Z", " UTC")],
        ["Timestamp", field(xml, "timestamp")],
      ],
    },
    {
      title: "Ubicación",
      icon: "📍",
      rows: [
        ["Latitud", field(xml, "latitude")],
        ["Longitud", field(xml, "longitude")],
        ["Altitud", field(xml, "altitude") + " m"],
        ["Velocidad", field(xml, "speed") + " km/h"],
        ["Dirección", field(xml, "direction") + "°"],
        ["Heading", field(xml, "heading") + "°"],
        ["Odómetro", field(xml, "odometer") + " km"],
        ["Satélites", field(xml, "satellites")],
        ["HDOP", field(xml, "hdop")],
        ["Dirección", field(xml, "address")],
        ["GeoFence", field(xml, "geoFence")],
      ],
    },
    {
      title: "Estado / IO",
      icon: "⚡",
      rows: [
        ["Ignición", field(xml, "ignition")],
        ["Evento", field(xml, "event")],
        ["Tipo Evento", field(xml, "eventType")],
        ["Código Evento", field(xml, "eventCode")],
        ["Alarma", field(xml, "alarm")],
        ["Razón", field(xml, "reason")],
        ["Input Digital", field(xml, "digitalInput")],
        ["Output Digital", field(xml, "digitalOutput")],
        ["Input Análogo", field(xml, "analogInput")],
      ],
    },
    {
      title: "Energía / Sensores",
      icon: "🔋",
      rows: [
        ["Voltaje Ext.", field(xml, "mainPower") + " V"],
        ["Batería Int.", field(xml, "internalBattery") + " V"],
        ["Batería", field(xml, "batteryVoltage") + " V"],
        ["Temperatura", field(xml, "temperature") + " °C"],
        ["Combustible", field(xml, "fuelLevel")],
        ["RSSI", field(xml, "rssi")],
      ],
    },
  ];

  return (
    <div className="overflow-auto flex-1 px-0.5">
      {sections.map(sec => {
        const visible = sec.rows.filter(([, v]) => v !== "—" && v !== "— m" && v !== "— km/h" && v !== "— °" && v !== "— V" && v !== "— °C" && v !== "— km");
        if (visible.length === 0) return null;
        return (
          <div key={sec.title} className="mb-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1 border-b border-slate-200 pb-1">
              <span>{sec.icon}</span> {sec.title}
            </div>
            <div className="flex flex-col gap-1">
              {visible.map(([l, v]) => (
                <div key={l} className="flex justify-between items-baseline gap-2">
                  <span className="text-[11px] text-slate-500 shrink-0">{l}</span>
                  <span className="text-xs text-slate-800 font-mono text-right break-all">{v}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TmuxMonitor() {
  const socketRef = useRef<Socket | null>(null);
  const [socketReady, setSocketReady] = useState(false);

  const [servers, setServers] = useState<ServerOption[]>([]);
  const [serverId, setServerId] = useState("");

  const [sshStatus, setSshStatus] = useState<SshStatus>("disconnected");
  const [sshMsg, setSshMsg] = useState("Sin conexión");

  const [session, setSession] = useState("TRCMTY_RC_Walmart");
  const pane = "0.0";
  const [customSession, setCustom] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);

  const [streaming, setStreaming] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [terminalSearch, setTerminalSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const [imei, setImei] = useState("");
  const [plate, setPlate] = useState("");
  const [xmlStatus, setXmlStatus] = useState<XmlStatus>("idle");
  const [xmlMsg, setXmlMsg] = useState("");
  const [progress, setProgress] = useState({ n: 0, max: 30 });
  const [captures, setCaptures] = useState<XmlCapture[]>([]);
  const [selected, setSelected] = useState<XmlCapture | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const xmlDetailRef = useRef<HTMLDivElement>(null);

  // ── Cargar servidores ─────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${SOCKET_URL}/api/servers`)
      .then(r => r.json())
      .then((list: ServerOption[]) => {
        setServers(list);
        if (list.length > 0) setServerId(list[0].id);
      })
      .catch(() => {});
  }, []);

  // ── Socket ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketReady(true);
      setSshMsg("Socket listo — presiona Conectar SSH");
    });

    socket.on("disconnect", () => {
      setSocketReady(false);
      setSshStatus("disconnected");
      setSshMsg("Socket desconectado");
      setStreaming(false);
    });

    socket.on("ssh_connected", ({ label, host }: { label: string; host: string }) => {
      setSshStatus("connected");
      setSshMsg(`${label} — ${host}`);
    });

    socket.on("ssh_disconnected", () => {
      setSshStatus("disconnected");
      setSshMsg("SSH cerrado");
      setStreaming(false);
    });

    socket.on("ssh_error", (msg: string) => {
      setSshStatus("error");
      setSshMsg(msg);
    });

    socket.on("error_msg", (msg: string) => {
      setSshMsg(msg);
    });

    socket.on("stream_data", (data: string) => {
      setLines(data.split("\n"));
    });

    socket.on("stream_started", () => {
      setStreaming(true);
    });

    socket.on("stream_stopped", () => {
      setStreaming(false);
    });

    socket.on("xml_status", (msg: XmlStatusMsg) => {
      setXmlStatus(msg.status as XmlStatus);
      setXmlMsg(msg.msg);
      if (msg.attempt !== undefined) setProgress({ n: msg.attempt, max: msg.max ?? 30 });
    });

    socket.on("xml_found", ({ imei: fi, plate: fp, xml, attempt }: {
      imei: string; plate: string; xml: string; attempt: number;
    }) => {
      setXmlStatus("found");
      setXmlMsg(`Encontrado en intento ${attempt}`);
      const c: XmlCapture = { id: Date.now().toString(), imei: fi, plate: fp, xml, attempt, ts: new Date() };
      setCaptures(prev => [c, ...prev]);
      setSelected(c);
      setShowRaw(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [lines, autoScroll]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const connectServer = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setSshMsg("Socket no listo, espera un momento");
      return;
    }
    setSshStatus("connecting");
    setSshMsg("Conectando SSH...");
    socket.emit("connect_server", { serverId });
  }, [serverId, socketReady]);

  const disconnectServer = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    setSshMsg("Desconectando...");
    socket.emit("disconnect_server");
  }, []);

  const startStream = useCallback(() => {
    socketRef.current?.emit("start_stream", { session, pane });
  }, [session, pane]);

  const stopStream = useCallback(() => {
    socketRef.current?.emit("stop_stream");
  }, []);

  const captureXml = useCallback(() => {
    if (!imei.trim()) return;
    setProgress({ n: 0, max: 30 });
    socketRef.current?.emit("capture_xml", { session, pane, imei: imei.trim(), plate });
  }, [session, pane, imei, plate]);

  const cancelSearch = useCallback(() => {
    socketRef.current?.emit("cancel_search");
  }, []);

  const copyXml = useCallback(() => {
    if (!selected) return;
    navigator.clipboard.writeText(selected.xml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [selected]);

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.target = "_self";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch {} }, 200);
  };

  const downloadXml = useCallback(() => {
    if (!selected) return;
    try {
      const blob = new Blob([selected.xml], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const filename = `XML_${selected.plate || selected.imei}_${selected.ts.toISOString().slice(0,19).replace(/:/g,"-")}.xml`;
      triggerDownload(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      alert("Error al descargar XML: " + (err as Error).message);
    }
  }, [selected]);

  const screenshotXml = useCallback(async () => {
    if (!selected) return;

    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-9999px;top:0;background:#1e293b;color:#e2e8f0;font-family:Consolas,'Courier New',monospace;font-size:13px;line-height:1.6;padding:24px 32px;white-space:pre-wrap;word-break:break-all;min-width:800px;max-width:1200px;";

    const header = document.createElement("div");
    header.style.cssText = "margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #475569;";
    header.innerHTML = '<div style="font-size:16px;font-weight:bold;color:#f8fafc;margin-bottom:4px">XML Captura &mdash; ' + (selected.plate || "N/A") + '</div><div style="font-size:12px;color:#94a3b8">IMEI: ' + selected.imei + ' &nbsp;|&nbsp; ' + selected.ts.toLocaleString() + '</div>';
    container.appendChild(header);

    const pre = document.createElement("pre");
    pre.style.cssText = "margin:0;white-space:pre-wrap;word-break:break-all;color:#e2e8f0;font-size:13px;line-height:1.6;";
    pre.textContent = selected.xml;
    container.appendChild(pre);

    document.body.appendChild(container);
    try {
      const canvas = await html2canvas(container, { backgroundColor: "#1e293b", scale: 2, logging: false });
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) { alert("No se pudo generar el PNG"); return; }
      const url = URL.createObjectURL(blob);
      const filename = `Captura_${selected.plate || selected.imei}_${selected.ts.toISOString().slice(0,19).replace(/:/g,"-")}.png`;
      triggerDownload(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      alert("Error al generar captura: " + (err as Error).message);
    } finally {
      try { document.body.removeChild(container); } catch {}
    }
  }, [selected]);

  // ── Get sessions for selected server ──────────────────────────────────────
  const getServerType = (srvId: string): string => {
    const srv = servers.find(s => s.id === srvId);
    if (!srv) return "";
    const label = srv.label.toLowerCase();
    if (label.includes("wialon")) return "Wialon";
    if (label.includes("dumax") || label.includes("v4")) return "DUMAX v4";
    if (label.includes("v2")) return "V2";
    return "";
  };

  const currentServerType = getServerType(serverId);
  const filteredPresets = currentServerType
    ? SESSION_PRESETS.filter(g => g.server === currentServerType)
    : SESSION_PRESETS;

  // ── Render ────────────────────────────────────────────────────────────────

  // ── Dumax brand tokens ────────────────────────────────────────────────────
  const inpDark = "bg-[#3A3A3A] border border-[#4A4A4A] rounded text-slate-100 text-sm px-2.5 py-1.5 outline-none focus:border-[#74FA4C]";
  const inpLight = "bg-white border border-slate-300 rounded text-slate-800 text-sm px-2.5 py-1.5 outline-none focus:border-[#74FA4C]";
  const btnPrimary = "bg-[#74FA4C] hover:bg-[#4ade80] border border-[#4ade80] rounded text-sm px-3.5 py-1.5 text-[#1A1A1A] font-semibold cursor-pointer disabled:bg-[#4A4A4A] disabled:border-[#5A5A5A] disabled:text-slate-400 disabled:cursor-not-allowed transition-colors";
  const btnGhost = "bg-transparent border border-slate-300 rounded text-xs px-2.5 py-1 text-slate-500 cursor-pointer hover:bg-slate-100";

  return (
    <div className="h-screen w-full bg-slate-100 text-slate-800 font-sans flex flex-col overflow-hidden">

      {/* TOP BAR */}
      <div className="bg-[#1A1A1A] px-6 h-14 flex items-center gap-3 shrink-0 border-b border-[#4A4A4A] shadow-sm">

        {/* Brand + socket indicator */}
        <div className="flex items-center gap-2.5 mr-1">
          <img src={logo} alt="Dumax" className="h-9 w-auto object-contain shrink-0" />
        </div>

        <div className="w-px h-8 bg-[#4A4A4A]" />

        {/* SSH group */}
        <div className="flex items-center gap-2">
          <select
            value={serverId}
            onChange={e => {
              setServerId(e.target.value);
              const srvType = getServerType(e.target.value);
              const preset = SESSION_PRESETS.find(g => g.server === srvType);
              if (preset && preset.sessions.length > 0) {
                setSession(preset.sessions[0]);
              }
            }}
            className={`${inpDark} min-w-[200px]`}
          >
            {servers.length === 0
              ? <option value="">Cargando servidores...</option>
              : servers.map(s => <option key={s.id} value={s.id}>{s.label} — {s.host}</option>)
            }
          </select>

          {sshStatus === "connected" ? (
            <div className="flex items-center gap-1.5">
              <button onClick={connectServer} disabled={!serverId} className={btnPrimary} title="Reconectar">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
              <button onClick={disconnectServer} className="bg-red-500 hover:bg-red-600 border border-red-600 rounded text-sm px-3 py-1.5 text-white font-medium cursor-pointer flex items-center gap-1.5" title="Desconectar SSH">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                Desconectar
              </button>
            </div>
          ) : (
            <button onClick={connectServer} disabled={!serverId || !socketReady} className={btnPrimary}>
              {sshStatus === "connecting" ? "Conectando..." : "Conectar SSH"}
            </button>
          )}

          {/* SSH status pill */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
            sshStatus === "connected" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" :
            sshStatus === "connecting" ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" :
            sshStatus === "error" ? "bg-red-500/15 text-red-400 border border-red-500/30" :
            "bg-[#3A3A3A] text-slate-400 border border-[#4A4A4A]"
          }`}>
            <StatusDot status={sshStatus} />
            <span className="max-w-[220px] truncate" title={sshMsg}>{sshMsg}</span>
          </div>
        </div>

        <div className="w-px h-8 bg-[#4A4A4A]" />

        {/* Session selector chip */}
        <div className="relative">
          {customSession ? (
            <div className="flex items-center gap-1">
              <input
                placeholder="nombre exacto..."
                value={session}
                onChange={e => setSession(e.target.value)}
                className={`${inpDark} w-56`}
                autoFocus
              />
              <button onClick={() => { setCustom(false); setSession("TRCMTY_RC_Walmart"); }} className="text-xs text-slate-400 hover:text-slate-200 px-1" title="Cancelar">✕</button>
            </div>
          ) : (
            <button
              onClick={() => setShowSessionDropdown(s => !s)}
              className={`${inpDark} w-64 text-left flex items-center justify-between gap-2 cursor-pointer hover:border-[#74FA4C]`}
              title={session}
            >
              <span className="truncate text-slate-100">{session || "Seleccionar sesión..."}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 shrink-0"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          )}
          {showSessionDropdown && !customSession && (
            <div className="absolute top-full left-0 mt-1 w-96 bg-[#2B2B2B] border border-[#4A4A4A] rounded shadow-xl z-50 overflow-hidden">
              <input
                autoFocus
                placeholder="🔍 Buscar sesión..."
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
                className="w-full bg-[#1A1A1A] border-b border-[#4A4A4A] text-slate-100 text-sm px-3 py-2 outline-none placeholder:text-slate-500 focus:border-[#74FA4C]"
              />
              <div className="max-h-80 overflow-auto">
                <div
                  onClick={() => { setCustom(true); setSession(""); setShowSessionDropdown(false); setSessionSearch(""); }}
                  className="px-3 py-2 text-xs text-amber-400 hover:bg-[#3A3A3A] cursor-pointer border-b border-[#4A4A4A]"
                >
                  + Escribir sesión manualmente...
                </div>
                {currentServerType && (
                  <div className="px-3 py-1 text-[10px] text-[#74FA4C] bg-[#1A1A1A] border-b border-[#4A4A4A]">
                    🟢 Mostrando sesiones de: {currentServerType}
                  </div>
                )}
                {filteredPresets.map(group => {
                  const filtered = group.sessions.filter(s =>
                    !sessionSearch || s.toLowerCase().includes(sessionSearch.toLowerCase())
                  );
                  if (filtered.length === 0) return null;
                  return (
                    <div key={group.server}>
                      <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-[#1A1A1A] sticky top-0">
                        {group.server} ({filtered.length})
                      </div>
                      {filtered.map(s => (
                        <div
                          key={s}
                          onClick={() => { setSession(s); setSessionSearch(""); setShowSessionDropdown(false); }}
                          className={`px-3 py-1.5 text-xs cursor-pointer hover:bg-[#3A3A3A] ${session === s ? 'bg-[#74FA4C] text-[#1A1A1A] font-semibold' : 'text-slate-200'}`}
                        >
                          {s}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {showSessionDropdown && (
            <div className="fixed inset-0 z-40" onClick={() => { setShowSessionDropdown(false); setSessionSearch(""); }} />
          )}
        </div>

        {!streaming
          ? <button onClick={startStream} disabled={sshStatus !== "connected"} className={btnPrimary}>▶ Live</button>
          : <button onClick={stopStream} className="bg-transparent border border-[#4A4A4A] rounded text-xs px-2.5 py-1.5 text-slate-300 cursor-pointer hover:bg-[#3A3A3A] transition-colors">⏸ Pausar</button>
        }

        <div className="flex-1" />

        {/* Terminal search */}
        <div className="relative flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 text-slate-400 pointer-events-none"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            placeholder="Buscar en terminal..."
            value={terminalSearch}
            onChange={e => setTerminalSearch(e.target.value)}
            className={`${inpDark} w-48 pl-8`}
          />
          {terminalSearch && (
            <span className="absolute right-2.5 text-[10px] text-amber-400 font-medium pointer-events-none">
              {lines.filter(l => l.toLowerCase().includes(terminalSearch.toLowerCase())).length}
            </span>
          )}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none px-2.5 py-1.5 rounded hover:bg-[#3A3A3A]/60 transition-colors">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="accent-[#74FA4C]" />
          auto-scroll
        </label>
      </div>

      {/* BODY */}
      <div className="flex-1 grid grid-cols-[1fr_380px] overflow-hidden">

        {/* TERMINAL */}
        <div className="flex flex-col border-r border-[#4A4A4A] overflow-hidden bg-[#1A1A1A]">

          <div className="px-4 py-1.5 border-b border-[#4A4A4A] text-[11px] text-slate-300 flex items-center gap-2 shrink-0 bg-[#1A1A1A]">
            <span className="font-semibold text-white">TERMINAL</span>
            <span className="text-[#4A4A4A]">|</span>
            <span className="text-slate-400 truncate" title={`${session}:${pane}`}>{session}:{pane}</span>
            {streaming && <span className="text-[#74FA4C] text-[10px] animate-[blink_2s_infinite] shrink-0">● LIVE</span>}
            <div className="flex-1" />
            {terminalSearch && (
              <span className="text-[10px] text-amber-400 shrink-0">
                {lines.filter(l => l.toLowerCase().includes(terminalSearch.toLowerCase())).length} coincidencias
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto p-3 text-sm leading-relaxed whitespace-pre-wrap break-words bg-[#1A1A1A] text-slate-100 font-mono">
            {lines.length === 0
              ? <span className="text-slate-500">
                  {sshStatus === "connected" ? "Presiona ▶ Live para iniciar el stream..." : "Conecta un servidor SSH para comenzar..."}
                </span>
              : lines.map((line, i) => {
                  if (terminalSearch && line.toLowerCase().includes(terminalSearch.toLowerCase())) {
                    const parts = line.split(new RegExp(`(${terminalSearch})`, 'gi'));
                    return (
                      <div key={i} className="bg-[#74FA4C]/10">
                        {parts.map((part, j) =>
                          part.toLowerCase() === terminalSearch.toLowerCase()
                            ? <mark key={j} className="bg-[#74FA4C] text-[#1A1A1A] px-0.5 rounded font-semibold">{part}</mark>
                            : part
                        )}
                      </div>
                    );
                  }
                  return <div key={i}>{line}</div>;
                })
            }
            <div ref={bottomRef} />
          </div>
        </div>

        {/* XML PANEL */}
        <div className="flex flex-col overflow-hidden bg-slate-50 min-w-0">

          <div className="px-4 py-1.5 border-b border-[#4A4A4A] text-[11px] text-slate-300 flex items-center gap-2 shrink-0 bg-[#1A1A1A] font-semibold">
            <span className="text-white">XML CAPTURE</span>
            {xmlStatus === "searching" && <span className="text-amber-400 text-[10px]">● BUSCANDO</span>}
            {xmlStatus === "found" && <span className="text-[#74FA4C] text-[10px]">● ENCONTRADO</span>}
            {xmlStatus === "not_found" && <span className="text-red-400 text-[10px]">● NO ENCONTRADO</span>}
            {xmlStatus === "cancelled" && <span className="text-slate-400 text-[10px]">● CANCELADO</span>}
          </div>

          {/* Search form */}
          <div className="p-3 border-b border-slate-200 shrink-0 bg-white">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">IMEI + Placa</div>
            <div className="flex gap-1.5 mb-2">
              <input placeholder="IMEI" value={imei} onChange={e => setImei(e.target.value)}
                maxLength={20} className={`${inpLight} flex-1 min-w-0`} />
              <input placeholder="Placa" value={plate} onChange={e => setPlate(e.target.value.toUpperCase())}
                className={`${inpLight} w-20`} />
            </div>

            {xmlStatus !== "searching"
              ? <button onClick={captureXml} disabled={sshStatus !== "connected" || !imei.trim()} className={`${btnPrimary} w-full`}>
                  Capturar XML — 10 min / 30 intentos
                </button>
              : <div>
                  <ProgressBar current={progress.n} max={progress.max} />
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-slate-500">{xmlMsg}</span>
                    <button onClick={cancelSearch} className="bg-transparent border border-red-300 rounded text-xs px-2 py-0.5 text-red-500 cursor-pointer hover:bg-red-50">
                      Cancelar
                    </button>
                  </div>
                </div>
            }
            {xmlStatus !== "searching" && xmlMsg && (
              <div className="mt-1.5 text-[11px] text-slate-500">{xmlMsg}</div>
            )}
          </div>

          {/* Captures list */}
          <div className="px-3 py-2 border-b border-slate-200 shrink-0">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Capturas ({captures.length})</span>
          </div>

          <div className={`overflow-auto ${selected ? "max-h-40" : "flex-1"}`}>
            {captures.length === 0
              ? <div className="p-3 text-xs text-slate-400">Sin capturas aún.</div>
              : captures.map(c => (
                <div key={c.id} onClick={() => { setSelected(c); setShowRaw(false); }}
                  className={`px-3 py-2 cursor-pointer border-b border-slate-100 border-l-[3px] ${selected?.id === c.id ? "bg-[#f0fdf4] border-l-[#74FA4C]" : "bg-white border-l-transparent hover:bg-slate-50"}`}>
                  <div className="flex justify-between mb-0.5">
                    <span className="text-[13px] font-semibold text-slate-800">{c.plate || "—"}</span>
                    <span className="text-[11px] text-slate-400">{c.ts.toLocaleTimeString()}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">{c.imei}</div>
                  <div className="text-[10px] text-slate-400">intento {c.attempt}</div>
                </div>
              ))
            }
          </div>

          {/* Detail */}
          {selected && (
            <div ref={xmlDetailRef} className="border-t border-slate-200 p-3 flex-1 overflow-auto flex flex-col bg-white min-w-0">
              <div className="flex justify-between items-center mb-2.5">
                <span className="text-[13px] font-semibold text-slate-800">
                  {selected.plate} · <span className="font-mono text-slate-500">···{selected.imei.slice(-6)}</span>
                </span>
                <div className="flex gap-1.5">
                  <button onClick={() => setShowRaw(r => !r)} className={btnGhost}>
                    {showRaw ? "resumen" : "XML raw"}
                  </button>
                  <button onClick={copyXml} className={`${btnGhost} ${copied ? "text-[#16a34a]" : ""}`}>
                    {copied ? "✓ copiado" : "copiar"}
                  </button>
                </div>
              </div>
              {showRaw
                ? <div className="flex-1 overflow-auto bg-slate-50 border border-slate-200 rounded p-2.5 text-[11px] text-slate-600 font-mono whitespace-pre-wrap leading-relaxed">
                    {selected.xml}
                  </div>
                : <XmlSummary xml={selected.xml} />
              }
              {/* Download buttons */}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={screenshotXml}
                  className="flex-1 bg-[#2B2B2B] hover:bg-[#1A1A1A] border border-[#4A4A4A] rounded text-sm px-3 py-2 text-white font-medium cursor-pointer flex items-center justify-center gap-2 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                  Captura PNG
                </button>
                <button
                  onClick={downloadXml}
                  className="flex-1 bg-[#74FA4C] hover:bg-[#4ade80] border border-[#4ade80] rounded text-sm px-3 py-2 text-[#1A1A1A] font-semibold cursor-pointer flex items-center justify-center gap-2 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Descargar XML
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}