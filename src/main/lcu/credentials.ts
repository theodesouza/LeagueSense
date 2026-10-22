import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface LcuCredentials {
  port: number
  /** Token de autenticação do cliente em execução. Nunca registrar em logs. */
  password: string
  scheme: 'https' | 'http'
  source: 'lockfile' | 'process'
}

/** `LeagueClient:PID:PORTA:SENHA:https` */
export function parseLockfile(content: string): LcuCredentials | null {
  const parts = content.trim().split(':')
  if (parts.length < 5) return null
  const port = Number(parts[2])
  const password = parts[3]
  const scheme = parts[4]
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !password) return null
  if (scheme !== 'https' && scheme !== 'http') return null
  return { port, password, scheme, source: 'lockfile' }
}

/** `--app-port=NNN --remoting-auth-token=TOKEN` na linha de comando do LeagueClientUx. */
export function parseCommandLine(cmd: string): LcuCredentials | null {
  const port = /--app-port=(\d+)/.exec(cmd)?.[1]
  const token = /--remoting-auth-token=([\w-]+)/.exec(cmd)?.[1]
  if (!port || !token) return null
  const n = Number(port)
  if (n < 1 || n > 65535) return null
  return { port: n, password: token, scheme: 'https', source: 'process' }
}

export interface DiscoverDeps {
  platform: NodeJS.Platform
  readFile: (path: string) => Promise<string>
  /** Executa um comando e devolve o stdout. */
  exec: (file: string, args: string[]) => Promise<string>
  /** Pastas de instalação a testar (padrão + configuradas). */
  installDirs: string[]
  /** Se falso, não consulta processos (caro); só os arquivos `lockfile`. */
  allowProcessScan: boolean
}

export function defaultInstallDirs(platform: NodeJS.Platform, extra: string[] = []): string[] {
  const dirs = [...extra]
  if (platform === 'win32') {
    for (const drive of ['C', 'D', 'E']) {
      dirs.push(`${drive}:\\Riot Games\\League of Legends`)
    }
    dirs.push('C:\\Program Files\\Riot Games\\League of Legends', 'C:\\Program Files (x86)\\Riot Games\\League of Legends')
  } else if (platform === 'darwin') {
    dirs.push('/Applications/League of Legends.app/Contents/LoL')
  }
  return dirs
}

const PS_QUERY = "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine"

/** Descobre porta e token do cliente: primeiro arquivos `lockfile` (barato), depois o processo. */
export async function discoverCredentials(deps: DiscoverDeps): Promise<LcuCredentials | null> {
  for (const dir of deps.installDirs) {
    try {
      const creds = parseLockfile(await deps.readFile(join(dir, 'lockfile')))
      if (creds) return creds
    } catch {
      /* não existe nessa pasta */
    }
  }
  if (!deps.allowProcessScan) return null
  try {
    let out = ''
    if (deps.platform === 'win32') {
      out = await deps.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY])
    } else {
      out = await deps.exec('ps', ['-ax', '-o', 'command'])
    }
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('--app-port=') && !line.includes('--remoting-auth-token=')) continue
      const c = parseCommandLine(line)
      if (c) return c
    }
  } catch {
    /* sem permissão / comando ausente */
  }
  return null
}

export function nodeDiscoverDeps(installDirs: string[], allowProcessScan: boolean): DiscoverDeps {
  return {
    platform: process.platform,
    readFile: (p) => readFile(p, 'utf8'),
    exec: (file, args) =>
      new Promise((resolve, reject) => {
        execFile(file, args, { timeout: 6000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
      }),
    installDirs,
    allowProcessScan
  }
}
