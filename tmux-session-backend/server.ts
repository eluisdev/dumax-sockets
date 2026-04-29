import "dotenv/config";
import express, { Request, Response } from "express";
import http from "http";
import cors from "cors";
import { Server, Socket } from "socket.io";
import { Client, ConnectConfig, ClientChannel } from "ssh2";
import fs from "fs";
import path from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SshServer {
  id: string;
  label: string;
  host: string;
  port?: number;
  user: string;
  keyPath?: string;
  keyEnv?: string;       // name of env var holding the raw private key (preferred for cloud deploys)
  passphrase?: string;
  password?: string;
  basePath?: string;     // optional: root folder where session subfolders live (overrides label heuristic)
}

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4001;

// Hardcoded allowed origins + any extras from env
const HARDCODED_ORIGINS = [
  "https://tdc-development-846de.web.app",
  "https://app.dumaxst.com",
  "http://localhost:3000",
  "https://system.dumaxst.com",
  "http://system.dumaxst.com"
];

const envOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = [...new Set([...HARDCODED_ORIGINS, ...envOrigins])];

let SSH_SERVERS: SshServer[] = [];
try {
  SSH_SERVERS = JSON.parse(process.env.SSH_SERVERS || "[]");
} catch {
  console.error("[config] SSH_SERVERS inválido en .env — debe ser JSON");
}

// SSH connection timeout (ms)
const SSH_CONNECT_TIMEOUT = 15_000;
// SSH keepalive interval (ms) — send a heartbeat every 30s to prevent drops
const SSH_KEEPALIVE_INTERVAL = 30_000;
// Max auto-reconnect attempts before giving up
const SSH_MAX_RECONNECT = 5;

// ─── App ─────────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"], credentials: true },
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    connections: io.engine.clientsCount,
    servers: SSH_SERVERS.map(s => ({ id: s.id, label: s.label })),
  });
});

app.get("/api/servers", (_req: Request, res: Response) => {
  res.json(SSH_SERVERS.map(s => ({ id: s.id, label: s.label, host: s.host })));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getServerConfig(serverId: string): SshServer | null {
  return SSH_SERVERS.find(s => s.id === serverId) || null;
}

function buildSshConfig(srv: SshServer): ConnectConfig {
  const cfg: ConnectConfig = {
    host:           srv.host,
    port:           srv.port || 22,
    username:       srv.user,
    readyTimeout:   SSH_CONNECT_TIMEOUT,
    keepaliveInterval: SSH_KEEPALIVE_INTERVAL,
    keepaliveCountMax: 3,
  };

  // 1. Llave desde variable de entorno (preferido en producción/Render)
  if (srv.keyEnv && process.env[srv.keyEnv]) {
    const raw = process.env[srv.keyEnv]!;
    // Algunos hosts escapan los \n al guardar la llave en una sola línea
    cfg.privateKey = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
    if (srv.passphrase) cfg.passphrase = srv.passphrase;
  }
  // 2. Llave desde archivo (desarrollo local)
  else if (srv.keyPath) {
    try {
      cfg.privateKey = fs.readFileSync(path.resolve(srv.keyPath));
      if (srv.passphrase) cfg.passphrase = srv.passphrase;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ssh] No se pudo leer llave: ${srv.keyPath}`, msg);
    }
  }

  if (srv.password) cfg.password = srv.password;

  return cfg;
}

function execSsh(ssh: Client, cmd: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SSH exec timeout")), timeoutMs);
    ssh.exec(cmd, (err: Error | undefined, stream: ClientChannel) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let out = "";
      stream.on("data", (d: Buffer) => { out += d.toString(); });
      stream.stderr?.on("data", () => {});
      stream.on("close", () => { clearTimeout(timer); resolve(out); });
    });
  });
}

// Resolve where session folders live for a given server.
// Per-server `basePath` (in SSH_SERVERS env) wins; otherwise we infer from the label.
function getBasePath(srv: SshServer): string {
  if (srv.basePath) return srv.basePath;
  const label = srv.label.toLowerCase();
  if (label.includes("wialon")) return "~/apps/wialonWebHooks";
  // v2 antes que v4/dumax: "Dumax V2" caería en la rama dumax y devolvería el path equivocado
  if (label.includes("v2")) return "~/apps/webservices";
  if (label.includes("v4") || label.includes("dumax")) return "~/webservices";
  return "";
}

function buildAwkCmd(session: string, pane: string, imei: string, plate = "", histLines = 5000): string {
  const target = `${session}:${pane}`;
  const plateLower = plate.toLowerCase();
  const searchTerm = plate ? `${imei}|${plateLower}` : imei;
  return [
    `tmux capture-pane -p -J -S -${histLines} -t ${target} 2>/dev/null`,
    `| awk -v q="${searchTerm}"`,
    `'BEGIN{IGNORECASE=1;xml=0;hit=0;buf=""}`,
    `/<\\?xml|<[a-zA-Z_-]+:Envelope|<Envelope/{xml=1;buf="";hit=0}`,
    `xml{buf=buf $0 "\\n"}`,
    `xml && $0~q{hit=1}`,
    `xml && /<\\/[a-zA-Z_-]+:Envelope>|<\\/Envelope>/{`,
    `  if(hit){print "%%XML_START%%";print buf;print "%%XML_END%%";exit}`,
    `  xml=0;hit=0;buf=""`,
    `}'`,
  ].join(" ");
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on("connection", (socket: Socket) => {
  const sid = socket.id.slice(0, 8);
  console.log(`[socket:${sid}] connected from ${socket.handshake.headers.origin || "unknown"}`);

  let ssh:          Client | null                         = null;
  let streamTimer:  ReturnType<typeof setInterval> | null = null;
  let searchTimer:  ReturnType<typeof setTimeout>  | null = null;
  let sshReady    = false;
  let lastServerId: string | null = null;
  let reconnectCount = 0;
  let intentionalDisconnect = false;
  // Track current stream so we can resume after reconnect
  let activeStream: { session: string; pane: string; lines: number } | null = null;

  function stopStream() {
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
  }

  function stopSearch() {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
  }

  function stopAll() {
    stopStream();
    stopSearch();
  }

  function destroySsh() {
    stopAll();
    if (ssh) {
      try {
        // Detach handlers so the close of the OLD client never triggers
        // the auto-reconnect path (root cause of duplicate "reconectando" toasts
        // when switching servers e.g. Wialon → DUMAX v4).
        ssh.removeAllListeners("close");
        ssh.removeAllListeners("error");
        ssh.removeAllListeners("ready");
        ssh.end();
      } catch {}
      ssh = null;
    }
    sshReady = false;
  }

  function connectSsh(serverId: string, isReconnect = false) {
    // Treat any in-flight switch as intentional so no stray reconnect fires.
    intentionalDisconnect = true;
    destroySsh();
    intentionalDisconnect = false;
    reconnectCount = 0;

    const srv = getServerConfig(serverId);
    if (!srv) {
      socket.emit("ssh_error", `Servidor "${serverId}" no encontrado`);
      return;
    }

    lastServerId = serverId;
    const cfg = buildSshConfig(srv);
    ssh = new Client();

    const tag = isReconnect ? "reconnect" : "connect";
    console.log(`[socket:${sid}] SSH ${tag} → ${srv.label} (${srv.host})`);

    ssh.on("ready", () => {
      sshReady = true;
      reconnectCount = 0;
      socket.emit("ssh_connected", { label: srv.label, host: srv.host, reconnected: isReconnect });

      // Resume stream if we were streaming before reconnect
      if (isReconnect && activeStream) {
        console.log(`[socket:${sid}] resuming stream on ${activeStream.session}`);
        doStartStream(activeStream.session, activeStream.pane, activeStream.lines);
      }
    });

    ssh.on("error", (err: Error) => {
      console.error(`[socket:${sid}] SSH error: ${err.message}`);
      sshReady = false;
      socket.emit("ssh_error", `SSH error en ${srv.label}: ${err.message}`);
    });

    ssh.on("close", () => {
      sshReady = false;
      stopAll();

      if (intentionalDisconnect) {
        console.log(`[socket:${sid}] SSH closed (intentional)`);
        socket.emit("ssh_disconnected", { reason: "manual" });
        return;
      }

      // Unexpected close → attempt auto-reconnect
      console.log(`[socket:${sid}] SSH dropped unexpectedly (attempt ${reconnectCount + 1}/${SSH_MAX_RECONNECT})`);

      if (reconnectCount < SSH_MAX_RECONNECT && lastServerId) {
        reconnectCount++;
        const delay = Math.min(2000 * reconnectCount, 10_000);
        socket.emit("ssh_reconnecting", {
          attempt: reconnectCount,
          max: SSH_MAX_RECONNECT,
          delayMs: delay,
          label: srv.label,
        });
        setTimeout(() => {
          if (socket.connected && lastServerId) {
            connectSsh(lastServerId, true);
          }
        }, delay);
      } else {
        socket.emit("ssh_disconnected", { reason: "max_reconnect_exceeded" });
      }
    });

    ssh.connect(cfg);
  }

  function doStartStream(session: string, pane: string, lines: number) {
    if (!sshReady || !ssh) return;
    stopStream();

    const cmd = `tmux capture-pane -p -J -S -${lines} -t ${session}:${pane} 2>/dev/null`;
    let lastOut = "";
    let inFlight = false;

    const poll = async () => {
      if (!sshReady || !ssh || inFlight) return;
      inFlight = true;
      try {
        const out = await execSsh(ssh, cmd);
        if (out !== lastOut) {
          lastOut = out;
          socket.emit("stream_data", out);
        }
      } catch (e) {
        console.error(`[socket:${sid}] stream poll error: ${(e as Error).message}`);
      } finally {
        inFlight = false;
      }
    };

    poll();
    streamTimer = setInterval(poll, 3000);
    socket.emit("stream_started", `${session}:${pane}`);
  }

  // ── Eventos ───────────────────────────────────────────────────────────────

  socket.on("connect_server", ({ serverId }: { serverId: string }) => {
    reconnectCount = 0;
    connectSsh(serverId);
  });

  socket.on("start_stream", ({ session, pane = "0.0", lines = 300 }: {
    session: string; pane?: string; lines?: number;
  }) => {
    if (!sshReady || !ssh) { socket.emit("error_msg", "SSH no conectado"); return; }
    activeStream = { session, pane, lines };
    doStartStream(session, pane, lines);
  });

  socket.on("stop_stream", () => {
    activeStream = null;
    stopStream();
    socket.emit("stream_stopped");
  });

  // Switch session: stops current stream/search, notifies, and optionally restarts stream
  socket.on("switch_session", ({ session, pane = "0.0", resumeStream = false }: {
    session: string; pane?: string; resumeStream?: boolean;
  }) => {
    const wasStreaming = !!streamTimer;
    const wasSearching = !!searchTimer;
    stopAll();

    if (wasStreaming) socket.emit("stream_stopped");
    if (wasSearching) socket.emit("xml_status", { status: "cancelled", msg: "Búsqueda cancelada por cambio de sesión", attempt: 0, max: 30 });

    socket.emit("session_switched", { session, pane, wasStreaming, wasSearching });

    if ((resumeStream || wasStreaming) && sshReady && ssh) {
      activeStream = { session, pane, lines: 300 };
      doStartStream(session, pane, 300);
    } else {
      activeStream = null;
    }
  });

  socket.on("capture_xml", ({ session, pane = "0.0", imei, plate = "" }: {
    session: string; pane?: string; imei: string; plate?: string;
  }) => {
    if (!sshReady || !ssh) { socket.emit("error_msg", "SSH no conectado"); return; }
    stopSearch();

    const MAX  = 30;
    const WAIT = 20000;
    let n = 0;

    socket.emit("xml_status", { status: "searching", msg: `Iniciando búsqueda de ${imei}...`, attempt: 0, max: MAX });

    const search = async () => {
      if (!sshReady || !ssh) {
        socket.emit("xml_status", { status: "cancelled", msg: "SSH desconectado durante búsqueda", attempt: n, max: MAX });
        return;
      }
      n++;
      socket.emit("xml_status", { status: "searching", msg: `Intento ${n}/${MAX} — ${imei}`, attempt: n, max: MAX });

      try {
        const cmd = buildAwkCmd(session, pane, imei, plate);
        const out = await execSsh(ssh!, cmd);
        const outStr = String(out);

        if (outStr.includes("%%XML_START%%")) {
          const xml = outStr.split("%%XML_START%%")[1].split("%%XML_END%%")[0].trim();
          socket.emit("xml_found", { imei, plate, xml, attempt: n });
          return;
        }
      } catch (e) {
        console.error(`[socket:${sid}] xml search error (attempt ${n}): ${(e as Error).message}`);
      }

      if (n >= MAX) {
        socket.emit("xml_status", {
          status: "not_found",
          msg: `No se encontró ${imei} en 10 minutos`,
          attempt: n,
          max: MAX,
        });
        return;
      }

      searchTimer = setTimeout(search, WAIT);
    };

    search();
  });

  // Restart session:
  //   1. Lista los binarios YYYYMMDDHHMM_* en la carpeta de la sesión y toma el más reciente.
  //   2. Verifica que el pane esté en un prompt de shell (no escribir dentro de un proceso vivo).
  //   3. Inyecta `cd {sessionDir} && ./{binary}` con tmux send-keys, simulando lo que el usuario
  //      hace a mano cuando el WS muere.
  // El stream live ya está leyendo el mismo pane, así que el output del nuevo proceso aparece
  // automáticamente en el frontend sin acciones adicionales.
  socket.on("restart_session", async ({ session }: { session: string }) => {
    if (!sshReady || !ssh || !lastServerId) {
      socket.emit("restart_session_result", { ok: false, error: "SSH no conectado" });
      return;
    }
    const srv = getServerConfig(lastServerId);
    if (!srv) {
      socket.emit("restart_session_result", { ok: false, error: "Servidor no encontrado" });
      return;
    }
    const basePath = getBasePath(srv);
    if (!basePath) {
      socket.emit("restart_session_result", {
        ok: false,
        error: `Sin basePath para servidor "${srv.label}". Configúralo en SSH_SERVERS.`,
      });
      return;
    }

    // Sanity check: solo permitimos chars seguros en session/binary/path para no abrir
    // shell-injection a través de send-keys.
    const SAFE = /^[A-Za-z0-9_./~-]+$/;
    if (!SAFE.test(session)) {
      socket.emit("restart_session_result", { ok: false, error: `Nombre de sesión inválido: ${session}` });
      return;
    }

    const sessionDir = `${basePath}/${session}`;
    const pane = "0.0";

    // Listar candidatos por patrón timestamp YYYYMMDDHHMM_*, desc por nombre.
    const listCmd = [
      `ls -1 ${sessionDir} 2>/dev/null`,
      `| grep -E '^[0-9]{12}_'`,
      `| sort -r`,
      `| head -5`,
    ].join(" ");

    try {
      const out = await execSsh(ssh, listCmd);
      const candidates = out.split("\n").map((s) => s.trim()).filter(Boolean);

      if (candidates.length === 0) {
        socket.emit("restart_session_result", {
          ok: false,
          error: `No se detectó binario ejecutable con patrón YYYYMMDDHHMM_* en ${sessionDir}`,
          sessionDir,
          basePath,
        });
        return;
      }

      const binary = candidates[0];
      if (!SAFE.test(binary)) {
        socket.emit("restart_session_result", {
          ok: false,
          error: `Nombre de binario inválido: ${binary}`,
          sessionDir,
          binary,
        });
        return;
      }

      // Safety: capturar el pane y verificar que la última línea no vacía sea un prompt
      // de shell. Si no lo es, hay un proceso corriendo y NO debemos teclear el comando
      // dentro de su stdin.
      const paneTarget = `${session}:${pane}`;
      const captureCmd = `tmux capture-pane -p -J -t ${paneTarget} 2>/dev/null | tail -20`;
      const paneOut = await execSsh(ssh, captureCmd);
      const paneLines = paneOut.split("\n").map((l) => l.trim()).filter(Boolean);
      const lastLine = paneLines[paneLines.length - 1] || "";
      const promptRe = /^[A-Za-z][\w.-]*@[\w.-]+:\S*\$(\s|$)/;

      if (!promptRe.test(lastLine)) {
        socket.emit("restart_session_result", {
          ok: false,
          error: "El pane no está en un prompt de shell — parece haber un proceso vivo. Cancelado para no escribir dentro del proceso.",
          sessionDir,
          binary,
          candidates,
          lastLine,
        });
        return;
      }

      // Ejecutar: tecleamos el comando + Enter en el pane existente. El shell del
      // pane resolverá `~` y correrá el binario.
      const command = `cd ${sessionDir} && ./${binary}`;
      const sendKeysCmd = `tmux send-keys -t ${paneTarget} '${command}' Enter`;
      await execSsh(ssh, sendKeysCmd);

      console.log(`[socket:${sid}] restart_session → ${paneTarget} :: ${command}`);

      socket.emit("restart_session_result", {
        ok: true,
        executed: true,
        session,
        sessionDir,
        basePath,
        binary,
        candidates,
        command,
      });
    } catch (e) {
      socket.emit("restart_session_result", {
        ok: false,
        error: (e as Error).message,
        sessionDir,
      });
    }
  });

  socket.on("cancel_search", () => {
    stopSearch();
    socket.emit("xml_status", { status: "cancelled", msg: "Búsqueda cancelada", attempt: 0, max: 30 });
  });

  socket.on("disconnect_server", () => {
    intentionalDisconnect = true;
    activeStream = null;
    destroySsh();
    socket.emit("ssh_disconnected", { reason: "manual" });
  });

  socket.on("disconnect", (reason: string) => {
    console.log(`[socket:${sid}] disconnected: ${reason}`);
    intentionalDisconnect = true;
    activeStream = null;
    destroySsh();
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log("─────────────────────────────────────────");
  console.log(`  TmuxMonitor backend  →  puerto ${PORT}`);
  console.log(`  CORS permitido       →  ${ALLOWED_ORIGINS.length} orígenes`);
  ALLOWED_ORIGINS.forEach(o => console.log(`    ✓ ${o}`));
  console.log(`  Servidores SSH       →  ${SSH_SERVERS.length} configurados`);
  SSH_SERVERS.forEach((s: SshServer) => {
    console.log(`    • ${s.label} (${s.user}@${s.host}:${s.port || 22})`);
  });
  console.log(`  SSH keepalive        →  ${SSH_KEEPALIVE_INTERVAL / 1000}s`);
  console.log(`  SSH reconnect max    →  ${SSH_MAX_RECONNECT} intentos`);
  console.log("─────────────────────────────────────────");
});