/**
 * Guards the single-SDK-instance invariant behind the fsIntercept alias.
 *
 * The facade imports '@firebase/firestore' directly — the same module the
 * 'firebase/firestore' shim re-exports. That is only ONE instance as long as
 * our explicit pin matches the exact version `firebase` itself pins. If a
 * future `npm i firebase@latest` bumps firebase's pin while ours stays stale,
 * npm nests a SECOND copy under firebase/node_modules and every Firestore op
 * fails at runtime with "Type does not match the expected instance".
 * This test turns that silent production bomb into a red CI run.
 */
import { describe, expect, it } from 'vitest'
import ourPkg from '../../../package.json'
import firebasePkg from 'firebase/package.json'
import installedPkg from '@firebase/firestore/package.json'

describe('@firebase/firestore version lock', () => {
  it("our pin == firebase's pin == installed version", () => {
    const ours = ourPkg.dependencies['@firebase/firestore']
    const firebasePin = firebasePkg.dependencies['@firebase/firestore']
    const installed = installedPkg.version

    const hint =
      `@firebase/firestore pin drifted (ours=${ours}, firebase pins=${firebasePin}, ` +
      `installed=${installed}). After upgrading the firebase package, update the ` +
      `"@firebase/firestore" entry in package.json to firebase's exact pin and reinstall — ` +
      `otherwise npm nests a second SDK copy and every Firestore op throws ` +
      `"Type does not match the expected instance" at runtime.`

    expect(ours, hint).toBe(firebasePin)
    expect(installed, hint).toBe(firebasePin)
  })
})
