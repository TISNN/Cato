import { spawn } from "node:child_process";

/**
 * 执行外部命令，永不抛异常——失败信息放在返回值里。
 * 与 server.mjs 里只服务于文件正文提取的 commandText 不同：这里需要
 * 超时、截断标记与退出码，因为外部转录引擎可能长时间无输出或写爆缓冲区。
 */
export function runCommand(command, args, options = {}) {
  const {
    cwd,
    env,
    timeoutMs = 120_000,
    maxStdout = 4_000_000,
    maxStderr = 20_000,
  } = options;
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return resolve({
        ok: false,
        code: null,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : "无法启动命令。",
        timedOut: false,
        truncated: false,
      });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < maxStdout) stdout += chunk;
      else truncated = true;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < maxStderr) stderr += chunk;
    });
    child.on("error", (error) =>
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: error.message,
        timedOut: false,
        truncated,
      }),
    );
    child.on("close", (code) =>
      finish({
        ok: code === 0,
        code,
        stdout,
        stderr,
        error: code === 0 ? "" : stderr.trim() || `退出码 ${code ?? "未知"}`,
        timedOut: false,
        truncated,
      }),
    );

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          ok: false,
          code: null,
          stdout,
          stderr,
          error: `执行超时（${Math.round(timeoutMs / 1000)} 秒）。`,
          timedOut: true,
          truncated,
        });
      }, timeoutMs);
      timer.unref?.();
    }
  });
}

/**
 * 在一组候选里找出第一个真实存在的可执行文件。
 * 候选可以写成 "mlx_whisper --model xxx" 这种带参数的完整命令。
 * 用 `command -v` 而不是 try-spawn，避免把「命令存在但参数不对」误判为未安装。
 */
export async function locateCommand(candidates) {
  const list = candidates.filter((entry) => typeof entry === "string" && entry.trim());
  for (const entry of list) {
    const parts = entry.trim().split(/\s+/u);
    const [binary, ...presetArgs] = parts;
    if (!binary) continue;
    if (binary.includes("/")) {
      const probe = await runCommand(binary, [...presetArgs, "--version"], {
        timeoutMs: 15_000,
        maxStdout: 4_000,
      });
      // 路径型候选：只要不是 ENOENT 就算可用，有些引擎不认 --version。
      if (probe.code !== null) {
        return { command: binary, args: presetArgs, path: binary, version: readVersion(probe) };
      }
      continue;
    }
    const which = await runCommand("sh", ["-c", 'command -v -- "$1"', "sh", binary], {
      timeoutMs: 10_000,
      maxStdout: 4_000,
    });
    if (!which.ok) continue;
    const resolved = which.stdout.trim().split("\n")[0];
    if (!resolved) continue;
    const probe = await runCommand(resolved, [...presetArgs, "--version"], {
      timeoutMs: 15_000,
      maxStdout: 4_000,
    });
    return {
      command: resolved,
      args: presetArgs,
      path: resolved,
      version: readVersion(probe),
    };
  }
  return null;
}

function readVersion(result) {
  if (!result) return "";
  const source = `${result.stdout || ""}\n${result.stderr || ""}`;
  const match = source.match(/\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?/u);
  return match ? match[0] : "";
}
