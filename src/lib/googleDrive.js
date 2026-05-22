// Google Drive backup — sign in with Google (GIS) and keep the nams-store
// document as a single `nams-backup.json` file in the user's own Drive.
//
// Requires a web OAuth client ID in `VITE_GOOGLE_CLIENT_ID` (.env.local).
// Without it the integration stays disabled and the rest of the app is
// unaffected.
import { exportDocument } from './store'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const BACKUP_NAME = 'nams-backup.json'

export function isConfigured() {
  return Boolean(CLIENT_ID)
}

// --- Google Identity Services -----------------------------------------------
let gisPromise = null

function loadGis() {
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google 인증 스크립트를 불러오지 못했습니다.'))
    document.head.appendChild(script)
  })
  return gisPromise
}

// Warm up the GIS script so the sign-in popup opens promptly on click.
export function preload() {
  if (isConfigured()) loadGis().catch(() => {})
}

let tokenClient = null
let pendingReject = null
let accessToken = ''
let tokenExpiry = 0

async function ensureTokenClient() {
  await loadGis()
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: () => {},
      error_callback: (err) => {
        if (pendingReject) {
          pendingReject(new Error(err?.message || '인증이 취소되었습니다.'))
          pendingReject = null
        }
      },
    })
  }
  return tokenClient
}

function hasValidToken() {
  return Boolean(accessToken) && Date.now() < tokenExpiry - 60000
}

function requestToken() {
  return new Promise((resolve, reject) => {
    ensureTokenClient().then((client) => {
      pendingReject = reject
      client.callback = (response) => {
        pendingReject = null
        if (response.error) {
          reject(new Error(response.error_description || response.error))
          return
        }
        accessToken = response.access_token
        tokenExpiry = Date.now() + (Number(response.expires_in) || 3600) * 1000
        resolve(accessToken)
      }
      client.requestAccessToken({ prompt: '' })
    }, reject)
  })
}

async function getAccessToken() {
  if (hasValidToken()) return accessToken
  return requestToken()
}

export function signOut() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {})
  }
  accessToken = ''
  tokenExpiry = 0
}

// --- Drive REST -------------------------------------------------------------
async function driveFetch(url, options = {}) {
  const token = await getAccessToken()
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    if (res.status === 401) {
      accessToken = ''
      tokenExpiry = 0
    }
    const detail = await res.text().catch(() => '')
    throw new Error(`Drive API ${res.status} ${detail.slice(0, 160)}`)
  }
  return res
}

async function findBackupId() {
  const params = new URLSearchParams({
    q: `name='${BACKUP_NAME}' and trashed=false`,
    spaces: 'drive',
    fields: 'files(id,modifiedTime)',
    orderBy: 'modifiedTime desc',
  })
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params}`)
  const data = await res.json()
  return data.files?.[0]?.id || ''
}

// Sign in and return the connected account (email is best-effort).
export async function connect() {
  await getAccessToken()
  let email = ''
  try {
    const res = await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user')
    const data = await res.json()
    email = data?.user?.emailAddress || ''
  } catch {
    // about.get may be unavailable — the connection itself still works
  }
  return { email }
}

// Upload the current document, overwriting the existing backup file if any.
export async function saveBackup() {
  const content = JSON.stringify(exportDocument(), null, 2)
  const fileId = await findBackupId()
  if (fileId) {
    await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: content,
      }
    )
    return
  }
  const boundary = `nams-${Math.random().toString(36).slice(2)}`
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify({ name: BACKUP_NAME, mimeType: 'application/json' })}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    `${content}\r\n` +
    `--${boundary}--`
  await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
}

// Download the backup document. Returns the parsed object, or null if none.
export async function loadBackup() {
  const fileId = await findBackupId()
  if (!fileId) return null
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)
  return JSON.parse(await res.text())
}
