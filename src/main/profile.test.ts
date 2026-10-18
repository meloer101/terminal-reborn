import { describe, expect, it } from 'vitest'
import { pidFromDaemonRecord, pidFromSingletonLock, planProfile, type ProfileInput } from './profile'

const appData = '/Users/u/Library/Application Support'
const wavi = `${appData}/Wavi`
const legacy = `${appData}/Terminal Reborn`

function input(over: Partial<ProfileInput> & { present?: string[]; busy?: string[] } = {}): ProfileInput {
  const present = new Set(over.present ?? [])
  const busy = new Set(over.busy ?? [])
  return { appData, name: 'Wavi', packaged: true, exists: (p) => present.has(p), inUse: (d) => busy.has(d), ...over }
}

describe('planProfile', () => {
  it('uses the e2e override as is', () => {
    expect(planProfile(input({ override: '/tmp/p', present: [legacy] }))).toEqual({ dir: '/tmp/p' })
  })

  it('gives dev runs a profile of their own', () => {
    expect(planProfile(input({ packaged: false, present: [legacy] }))).toEqual({ dir: `${appData}/Wavi Dev` })
  })

  it('moves the Terminal Reborn profile to Wavi when nothing runs from it', () => {
    expect(planProfile(input({ present: [legacy] }))).toEqual({ dir: wavi, migrateFrom: legacy })
  })

  it('keeps using the old profile while its daemon or app still runs', () => {
    expect(planProfile(input({ present: [legacy], busy: [legacy] }))).toEqual({ dir: legacy })
  })

  it('never touches the old profile once Wavi has one', () => {
    expect(planProfile(input({ present: [legacy, wavi] }))).toEqual({ dir: wavi })
  })

  it('starts fresh when there is no old profile', () => {
    expect(planProfile(input())).toEqual({ dir: wavi })
  })
})

describe('pid parsing', () => {
  it('reads the daemon record', () => {
    expect(pidFromDaemonRecord('{"pid":89413,"protocol":1}')).toBe(89413)
    expect(pidFromDaemonRecord('{"pid":"1"}')).toBeNull()
    expect(pidFromDaemonRecord('not json')).toBeNull()
  })

  it('reads the Chromium singleton lock target', () => {
    expect(pidFromSingletonLock('Macbook1deMacBook-Air.local-95169')).toBe(95169)
    expect(pidFromSingletonLock('garbage')).toBeNull()
  })
})
