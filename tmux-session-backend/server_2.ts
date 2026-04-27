/**
 * server_2.ts — Test de conexión SSH
 * Corre: npx ts-node server_2.ts
 */

import "dotenv/config";
import { Client } from "ssh2";
import fs from "fs";
import path from "path";

// ── Toma el primer servidor del .env ─────────────────────────────────────────

let SSH_SERVERS: any[] = [];
try {
  SSH_SERVERS = JSON.parse(process.env.SSH_SERVERS || "[]");
} catch {
  console.error("❌ SSH_SERVERS inválido en .env");
  process.exit(1);
}

if (SSH_SERVERS.length === 0) {
  console.error("❌ No hay servidores en SSH_SERVERS");
  process.exit(1);
}

const srv = SSH_SERVERS[0]; // prueba con el primero (Wialon)

console.log("─────────────────────────────────────────");
console.log(`Probando conexión SSH a: ${srv.label}`);
console.log(`  Host:     ${srv.host}:${srv.port || 22}`);
console.log(`  Usuario:  ${srv.user}`);
console.log(`  Llave:    ${srv.keyPath || "(ninguna)"}`);
console.log(`  Password: ${srv.password ? "sí" : "no"}`);
console.log(`  Passphrase: ${srv.passphrase ? "sí" : "no"}`);
console.log("─────────────────────────────────────────");

// ── Verificar que la llave existe ────────────────────────────────────────────

if (srv.keyPath) {
  const keyPath = path.resolve(srv.keyPath);
  if (!fs.existsSync(keyPath)) {
    console.error(`❌ Llave no encontrada en: ${keyPath}`);
    process.exit(1);
  }
  const keyContent = fs.readFileSync(keyPath, "utf8");
  console.log(`✅ Llave encontrada (${keyContent.length} bytes)`);
  console.log(`   Primeros 40 chars: ${keyContent.substring(0, 40)}...`);
  console.log(`   Últimos  20 chars: ...${keyContent.trim().slice(-20)}`);
  console.log("");
}

// ── Intentar conexión ────────────────────────────────────────────────────────

const ssh = new Client();

const cfg: any = {
  host:     srv.host,
  port:     srv.port || 22,
  username: srv.user,
  readyTimeout: 15000, // 15 segundos máximo
  debug: (msg: string) => console.log(`[debug] ${msg}`),
};

if (srv.keyPath) {
  cfg.privateKey = fs.readFileSync(path.resolve(srv.keyPath));
  if (srv.passphrase) cfg.passphrase = srv.passphrase;
}
if (srv.password) cfg.password = srv.password;

ssh.on("ready", () => {
  console.log("✅ ¡SSH CONECTADO EXITOSAMENTE!");
  console.log("");
  console.log("Ejecutando: tmux ls");

  ssh.exec("tmux ls", (err, stream) => {
    if (err) {
      console.error("❌ Error ejecutando comando:", err.message);
      ssh.end();
      return;
    }

    let out = "";
    stream.on("data", (d: Buffer) => { out += d.toString(); });
    stream.stderr.on("data", (d: Buffer) => { out += d.toString(); });
    stream.on("close", () => {
      console.log("Sesiones tmux disponibles:");
      console.log(out || "(ninguna)");
      ssh.end();
      process.exit(0);
    });
  });
});

ssh.on("error", (err: Error) => {
  console.error("❌ ERROR SSH:", err.message);
  process.exit(1);
});

ssh.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
  console.log("🔑 El servidor pide autenticación interactiva (keyboard-interactive)");
  prompts.forEach((p: any) => console.log("  Prompt:", p.prompt));
  // intenta con la password si hay
  if (srv.password) {
    finish([srv.password]);
  } else {
    finish([]);
  }
});

ssh.on("close", () => {
  console.log("[ssh] Conexión cerrada");
});

console.log("Conectando...");
ssh.connect(cfg);

// Timeout de seguridad
setTimeout(() => {
  console.error("❌ Timeout — no se pudo conectar en 20 segundos");
  process.exit(1);
}, 20000);