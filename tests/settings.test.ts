import { describe, expect, it } from 'vitest'
import { parsePreferences } from '../src/main/settings'
import { DEFAULT_PREFERENCES } from '@core/types'

describe('preferências: envio da build', () => {
  it('padrão: itens e runas ligados, feitiços desligados', () => {
    expect(parsePreferences({}).sendBuild).toEqual({ items: true, runes: true, spells: false })
    expect(DEFAULT_PREFERENCES.sendBuild.spells).toBe(false)
  })
  it('arquivo antigo (sem o campo) ou corrompido nunca derruba o app', () => {
    expect(parsePreferences({ elo: 'GOLD' }).sendBuild).toEqual(DEFAULT_PREFERENCES.sendBuild)
    expect(parsePreferences({ sendBuild: 'lixo' }).sendBuild).toEqual(DEFAULT_PREFERENCES.sendBuild)
    expect(parsePreferences({ sendBuild: { items: 1, runes: false, spells: 'x' } }).sendBuild).toEqual({ items: true, runes: false, spells: false })
  })
  it('respeita o que o usuário ligou', () => {
    expect(parsePreferences({ sendBuild: { items: false, runes: false, spells: true } }).sendBuild).toEqual({ items: false, runes: false, spells: true })
  })
})
