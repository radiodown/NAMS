export const APP_STORAGE_PREFIX = 'nams-'
export const DOCUMENT_STORAGE_KEY = `${APP_STORAGE_PREFIX}store`

function getStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readStorageText(key) {
  try {
    return getStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeStorageText(key, value) {
  try {
    getStorage()?.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStorageText(key) {
  try {
    getStorage()?.removeItem(key)
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function clearAppStorage() {
  const storage = getStorage()
  if (!storage) return

  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key?.startsWith(APP_STORAGE_PREFIX) || key?.startsWith('nams.')) {
        storage.removeItem(key)
      }
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}
