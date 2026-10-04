// Sets a new password for a partner-panel admin login (the owner by default). Same scrypt format the app uses.
// Run on the server; the password comes on stdin (never in the command line or the shell history):
//     printf '%s' 'NewPassword' | node /tmp/admin-password.mjs owner
//     printf '%s' 'NewPassword' | node /tmp/admin-password.mjs <username>
// Also switches that login's 2-step code off (turn it back on in Admin → Security) and clears the attempt limiter.
import { randomBytes, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";

const who = String(process.argv[2] || "owner");
if (!/^[A-Za-z0-9_.@-]{1,80}$/.test(who)) { console.error("bad username"); process.exit(1); }
const pw = (await new Promise((r) => { let d = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => r(d)); })).replace(/\r?\n$/, "");
if (pw.length < 12) { console.error("password must be at least 12 characters"); process.exit(1); }
const salt = randomBytes(16);
const hash = `scrypt$${salt.toString("base64")}$${scryptSync(pw, salt, 64).toString("base64")}`;
const where = who === "owner" ? "role = 'owner'" : `lower(username) = lower('${who}')`;
const sql = `update admins set password_hash = '${hash}', totp_enabled = false, totp_secret = null, active = true where ${where} returning id, username, name, role; delete from login_attempts;`;
const out = execFileSync("psql", ["-U", "postgres", "-d", "shubhora_partner", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
process.stdout.write(out);
console.log(/\(0 rows\)/.test(out) ? "no such admin — check the username" : `password set for ${who}. Log in at /partners/admin/login (staff form).`);
