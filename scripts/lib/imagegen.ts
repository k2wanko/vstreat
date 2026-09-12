import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The one place an image generator is invoked.
 *
 * Which command runs is the fork's business, so the contract is a command
 * line rather than an API: it takes a prompt file and writes an image to the
 * path it is given. Everything a particular provider does oddly - a wrapper
 * that prints its output path instead of honouring --out, a model name that
 * has to be read off a config file - belongs inside that command, not here.
 *
 *   <command> --prompt-file <path> --out <path> [--ref <path>:<label>]...
 *             [--aspect <w:h>] [--model <name>]
 *
 * Exit 0 means a readable image is at --out. Nothing on stdout is contractual.
 */

export type Reference = { path: string; label: string };

type Config = {
  imageGen?: { command?: string; args?: string[]; env?: Record<string, string>; timeoutMs?: number; model?: string | null };
};

const CONFIG_FILE = 'vstreat.config.json';
const EXAMPLE = 'vstreat.config.example.json';

async function settings(): Promise<Required<NonNullable<Config['imageGen']>>> {
  const fromEnv = process.env.VSTREAT_IMAGE_GEN;
  const file = existsSync(CONFIG_FILE) ? ((JSON.parse(await readFile(CONFIG_FILE, 'utf8')) as Config).imageGen ?? {}) : {};
  const command = fromEnv ?? file.command;
  if (!command) {
    throw new Error(
      `no image generator configured.\n` +
        `  Set VSTREAT_IMAGE_GEN, or copy ${EXAMPLE} to ${CONFIG_FILE} and name your command there.\n` +
        `  To try the pipeline without spending a generation: VSTREAT_IMAGE_GEN=./adapters/mock.sh\n` +
        `  See adapters/README.md for what a command has to do.`,
    );
  }
  return {
    command,
    args: file.args ?? [],
    env: file.env ?? {},
    timeoutMs: file.timeoutMs ?? 600_000,
    model: file.model ?? null,
  };
}

export async function generate(opts: {
  promptFile: string;
  out: string;
  refs?: Reference[];
  aspect?: string;
}): Promise<void> {
  const cfg = await settings();
  await mkdir(dirname(opts.out), { recursive: true });
  const argv = [
    cfg.command,
    ...cfg.args,
    '--prompt-file',
    opts.promptFile,
    '--out',
    opts.out,
    ...(opts.aspect ? ['--aspect', opts.aspect] : []),
    ...(cfg.model ? ['--model', cfg.model] : []),
    ...(opts.refs ?? []).flatMap((r) => ['--ref', `${r.path}:${r.label}`]),
  ];

  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...cfg.env } });
  const timer = setTimeout(() => proc.kill(), cfg.timeoutMs);
  const [, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);

  if (code !== 0) {
    throw new Error(`image generator "${cfg.command}" exited ${code} (timeout is ${cfg.timeoutMs} ms)\n${stderr.slice(-2000)}`);
  }
  // The most likely way a hand-written adapter is wrong, so it gets a message
  // of its own that says what the adapter did rather than what is missing.
  if (!existsSync(opts.out)) {
    throw new Error(
      `adapter "${cfg.command}" exited 0 but wrote no file at ${opts.out}.\n` +
        `  An adapter must write the image to the path it is given in --out.\n` +
        `  See adapters/README.md.\n${stderr.slice(-1000)}`,
    );
  }
}
