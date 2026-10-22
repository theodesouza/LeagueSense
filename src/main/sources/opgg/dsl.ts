/**
 * Parser do formato textual das respostas do OP.GG MCP (verificado em 22/10/2026).
 *
 *   class Root: data
 *   class Data: positions
 *   class Top: champion,play,win
 *
 *   Root(Data(Positions([Top("Ahri",22867,11614), ...])))
 *
 * Cada `class X: a,b,c` declara os campos de X; `X(1,2,3)` instancia com argumentos
 * posicionais. Valores: strings JSON, números, true/false/null, listas `[...]` e instâncias.
 */
export class DslParseError extends Error {
  constructor(message: string, readonly position: number) {
    super(`${message} (posição ${position})`)
    this.name = 'DslParseError'
  }
}

export type DslValue = string | number | boolean | null | DslValue[] | { [k: string]: DslValue }

const MAX_DEPTH = 64

export function parseDsl(text: string): DslValue {
  const classes = new Map<string, string[]>()
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]!
    const m = /^class\s+([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(line)
    if (m) {
      classes.set(m[1]!, m[2]!.split(',').map((f) => f.trim()).filter(Boolean))
    } else if (line.trim() === '') {
      continue
    } else break
  }
  const src = lines.slice(i).join('\n')
  if (!src.trim()) throw new DslParseError('expressão ausente', 0)

  let pos = 0
  const ws = (): void => {
    while (pos < src.length && /\s/.test(src[pos]!)) pos++
  }
  const fail = (msg: string): never => {
    throw new DslParseError(msg, pos)
  }

  const parseString = (): string => {
    const start = pos
    pos++ // abre aspas
    while (pos < src.length) {
      const ch = src[pos]!
      if (ch === '\\') pos += 2
      else if (ch === '"') {
        pos++
        try {
          return JSON.parse(src.slice(start, pos)) as string
        } catch {
          return fail('string inválida')
        }
      } else pos++
    }
    return fail('string não terminada')
  }

  const parseValue = (depth: number): DslValue => {
    if (depth > MAX_DEPTH) fail('aninhamento excessivo')
    ws()
    const ch = src[pos]
    if (ch === undefined) return fail('fim inesperado')
    if (ch === '"') return parseString()
    if (ch === '[') {
      pos++
      const out: DslValue[] = []
      ws()
      if (src[pos] === ']') {
        pos++
        return out
      }
      for (;;) {
        out.push(parseValue(depth + 1))
        ws()
        if (src[pos] === ',') {
          pos++
          continue
        }
        if (src[pos] === ']') {
          pos++
          return out
        }
        return fail("esperado ',' ou ']'")
      }
    }
    const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(pos, pos + 40))
    if (num) {
      pos += num[0].length
      return Number(num[0])
    }
    const ident = /^[A-Za-z_][\w]*/.exec(src.slice(pos, pos + 80))
    if (!ident) return fail(`caractere inesperado '${ch}'`)
    const name = ident[0]
    pos += name.length
    if (src[pos] !== '(') {
      if (name === 'true') return true
      if (name === 'false') return false
      if (name === 'null') return null
      return fail(`identificador '${name}' sem argumentos`)
    }
    pos++ // '('
    const args: DslValue[] = []
    ws()
    if (src[pos] === ')') {
      pos++
    } else {
      for (;;) {
        args.push(parseValue(depth + 1))
        ws()
        if (src[pos] === ',') {
          pos++
          continue
        }
        if (src[pos] === ')') {
          pos++
          break
        }
        fail("esperado ',' ou ')'")
      }
    }
    const fields = classes.get(name)
    const obj: { [k: string]: DslValue } = {}
    args.forEach((a, idx) => {
      obj[fields?.[idx] ?? `_${idx}`] = a
    })
    return obj
  }

  const value = parseValue(0)
  ws()
  if (pos < src.length) fail('conteúdo após a expressão')
  return value
}
