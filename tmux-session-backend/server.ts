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
}

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT          = process.env.PORT || 4001;
const FRONTEND_URLS = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

let SSH_SERVERS: SshServer[] = [];
try {
  SSH_SERVERS = JSON.parse(process.env.SSH_SERVERS || "[]");
} catch {
  console.error("[config] SSH_SERVERS inválido en .env — debe ser JSON");
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: FRONTEND_URLS, credentials: true }));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: FRONTEND_URLS, methods: ["GET", "POST"], credentials: true },
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, servers: SSH_SERVERS.map(s => ({ id: s.id, label: s.label })) });
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
    host:     srv.host,
    port:     srv.port || 22,
    username: srv.user,
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

function execSsh(ssh: Client, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ssh.exec(cmd, (err: Error | undefined, stream: ClientChannel) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d: Buffer) => { out += d.toString(); });
      stream.stderr?.on("data", () => {});
      stream.on("close", () => resolve(out));
    });
  });
}

function buildAwkCmd(session: string, pane: string, imei: string, plate = "", histLines = 5000): string {
  const target = `${session}:${pane}`;
  const plateLower = plate.toLowerCase();
  const searchTerm = plate ? `${imei}|${plateLower}` : imei;
  return [
    `tmux capture-pane -p -J -S -${histLines} -t ${target} 2>/dev/null`,
    `| awk -v q="${searchTerm}"`,
    `'BEGIN{IGNORECASE=1;xml=0;hit=0;buf=""}`,
    `/<\\?xml|<soap-env:envelope|<Envelope/{xml=1;buf="";hit=0}`,
    `xml{buf=buf $0 "\\n"}`,
    `xml && $0~q{hit=1}`,
    `xml && /<\\/soap-env:envelope>|<\\/Envelope>/{`,
    `  if(hit){print "%%XML_START%%";print buf;print "%%XML_END%%";exit}`,
    `  xml=0;hit=0;buf=""`,
    `}'`,
  ].join(" ");
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on("connection", (socket: Socket) => {

  let ssh:         Client | null                          = null;
  let streamTimer: ReturnType<typeof setInterval>  | null = null;
  let searchTimer: ReturnType<typeof setTimeout>   | null = null;
  let sshReady = false;

  function stopAll() {
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
    if (searchTimer) { clearTimeout(searchTimer);  searchTimer = null; }
  }

  function connectSsh(serverId: string) {
    if (ssh) { ssh.end(); ssh = null; }
    sshReady = false;
    stopAll();

    const srv = getServerConfig(serverId);
    if (!srv) {
      socket.emit("ssh_error", `Servidor "${serverId}" no encontrado`);
      return;
    }

    const cfg = buildSshConfig(srv);
    ssh = new Client();

    ssh.on("ready", () => {
      sshReady = true;
      socket.emit("ssh_connected", { label: srv.label, host: srv.host });
    });

    ssh.on("error", (err: Error) => {
      sshReady = false;
      socket.emit("ssh_error", `SSH error en ${srv.label}: ${err.message}`);
    });

    ssh.on("close", () => {
      sshReady = false;
      socket.emit("ssh_disconnected");
      stopAll();
    });

    ssh.connect(cfg);
  }

  // ── Eventos ───────────────────────────────────────────────────────────────

  socket.on("connect_server", ({ serverId }: { serverId: string }) => {
    connectSsh(serverId);
  });

  socket.on("start_stream", ({ session, pane = "0.0", lines = 300 }: {
    session: string; pane?: string; lines?: number;
  }) => {
    if (!sshReady || !ssh) { socket.emit("error_msg", "SSH no conectado"); return; }
    if (streamTimer) clearInterval(streamTimer);

    const cmd = `tmux capture-pane -p -J -S -${lines} -t ${session}:${pane} 2>/dev/null`;

    const poll = async () => {
      if (!sshReady || !ssh) return;
      try {
        const out = await execSsh(ssh, cmd);
        socket.emit("stream_data", out);
      } catch (_) {}
    };

    poll();
    streamTimer = setInterval(poll, 2000);
    socket.emit("stream_started", `${session}:${pane}`);
  });

  socket.on("stop_stream", () => {
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
    socket.emit("stream_stopped");
  });

  socket.on("capture_xml", ({ session, pane = "0.0", imei, plate = "" }: {
    session: string; pane?: string; imei: string; plate?: string;
  }) => {
    if (!sshReady || !ssh) { socket.emit("error_msg", "SSH no conectado"); return; }
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }

    const MAX  = 30;
    const WAIT = 20000;
    let n = 0;

    socket.emit("xml_status", { status: "searching", msg: `Iniciando búsqueda de ${imei}...`, attempt: 0, max: MAX });

    const search = async () => {
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
      } catch (_) {}

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

  socket.on("cancel_search", () => {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    socket.emit("xml_status", { status: "cancelled", msg: "Búsqueda cancelada", attempt: 0, max: 30 });
  });

  socket.on("disconnect_server", () => {
    stopAll();
    if (ssh) { ssh.end(); ssh = null; }
    sshReady = false;
    socket.emit("ssh_disconnected");
  });

  socket.on("disconnect", () => {
    stopAll();
    if (ssh) { ssh.end(); ssh = null; }
    sshReady = false;
    socket.emit("ssh_disconnected");
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log("─────────────────────────────────────────");
  console.log(`  TmuxMonitor backend  →  puerto ${PORT}`);
  console.log(`  CORS permitido       →  ${FRONTEND_URLS.join(", ")}`);
  console.log(`  Servidores SSH       →  ${SSH_SERVERS.length} configurados`);
  SSH_SERVERS.forEach((s: SshServer) => {
    console.log(`    • ${s.label} (${s.user}@${s.host}:${s.port || 22})`);
  });
  console.log("─────────────────────────────────────────");
});