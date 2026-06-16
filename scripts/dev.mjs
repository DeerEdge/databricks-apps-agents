import { rmSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

// Stop any stale DatabricksHack Next dev processes (Windows-safe).
try {
  execSync(
    "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='node.exe'\\\" | Where-Object { $_.CommandLine -match 'DatabricksHack' -and $_.CommandLine -match 'next' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }\"",
    { cwd: root, stdio: "ignore" },
  );
} catch {
  // No matching processes.
}

try {
  rmSync(path.join(root, ".next"), { recursive: true, force: true });
} catch {
  // First run or already clean.
}

const result = spawnSync(process.execPath, [nextBin, "dev", "--turbo"], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
