import { useEffect, useState } from 'react'
import {
  isConfigured,
  preload,
  connect,
  signOut,
  saveBackup,
  loadBackup,
  getSavedConnection,
} from '../lib/googleDrive'
import { importDocument } from '../lib/store'

// Google Drive backup controls — connect a Google account, then save/load the
// nams-store document to a single file in the user's Drive.
function GoogleDriveIcon() {
  return (
    <svg className="drive-icon" viewBox="0 0 24 21" aria-hidden="true">
      <path fill="#34a853" d="M8.1 0h7.8l8.1 14h-7.8L8.1 0Z" />
      <path fill="#fbbc04" d="M8.1 0 0 14l3.9 7L12 7 8.1 0Z" />
      <path fill="#4285f4" d="M3.9 21h16.2l3.9-7H7.8l-3.9 7Z" />
    </svg>
  )
}

function DriveActionIcon({ type }) {
  if (type === 'save') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 8 5-5 5 5" />
        <path d="M5 15v4h14v-4" />
      </svg>
    )
  }
  if (type === 'load') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21V9" />
        <path d="m7 16 5 5 5-5" />
        <path d="M5 9V5h14v4" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07" />
    </svg>
  )
}

export default function DriveBackup() {
  const configured = isConfigured()
  const savedConnection = configured ? getSavedConnection() : null
  const [connected, setConnected] = useState(Boolean(savedConnection?.connected))
  const [email, setEmail] = useState(savedConnection?.email || '')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (configured) preload()
  }, [configured])

  if (!configured) {
    return (
      <div className="drive-backup">
        <section className="settings-section drive-section">
          <div className="settings-section-head">
            <h4 className="drive-title">
              <GoogleDriveIcon />
              구글 드라이브 연동
            </h4>
            <p className="drive-hint">
              <code>.env.local</code>에 <code>VITE_GOOGLE_CLIENT_ID</code>를 설정하세요.
            </p>
          </div>
          <div className="drive-section-actions">
            <button className="btn drive-action-btn" disabled>
              <DriveActionIcon type="connect" />
              연결
            </button>
            <button className="btn btn-primary drive-action-btn" disabled>
              <DriveActionIcon type="save" />
              저장
            </button>
            <button className="btn drive-action-btn" disabled>
              <DriveActionIcon type="load" />
              불러오기
            </button>
          </div>
        </section>
      </div>
    )
  }

  async function handleConnect() {
    setBusy('connect')
    setMessage('')
    try {
      const result = await connect()
      setConnected(true)
      setEmail(result.email)
    } catch (e) {
      setMessage(`연결 실패: ${e?.message || e}`)
    } finally {
      setBusy('')
    }
  }

  async function handleSave() {
    setBusy('save')
    setMessage('')
    try {
      await saveBackup()
      setMessage('드라이브에 저장했습니다.')
    } catch (e) {
      setMessage(`저장 실패: ${e?.message || e}`)
    } finally {
      setBusy('')
    }
  }

  async function handleLoad() {
    setBusy('load')
    setMessage('')
    try {
      const doc = await loadBackup()
      if (!doc) {
        setMessage('드라이브에 백업 파일이 없습니다.')
        return
      }
      if (!doc.stages || typeof doc.stages !== 'object') {
        setMessage('백업 파일 형식이 올바르지 않습니다.')
        return
      }
      if (!window.confirm('드라이브의 백업으로 현재 데이터를 모두 교체합니다.\n계속할까요?')) {
        return
      }
      importDocument(doc)
      window.location.reload()
    } catch (e) {
      setMessage(`불러오기 실패: ${e?.message || e}`)
    } finally {
      setBusy('')
    }
  }

  function handleDisconnect() {
    signOut()
    setConnected(false)
    setEmail('')
    setMessage('')
  }

  return (
    <div className="drive-backup">
      <section className="settings-section drive-section">
        <div className="settings-section-head">
          <h4 className="drive-title">
            <GoogleDriveIcon />
            구글 드라이브 연동
          </h4>
          {connected ? (
            <span className="drive-backup-acct">{email ? `${email} 연결됨` : '연결됨'}</span>
          ) : null}
        </div>
        <div className="drive-section-actions">
          {connected ? (
            <button
              className="btn drive-action-btn"
              onClick={handleDisconnect}
              disabled={Boolean(busy)}
            >
              <DriveActionIcon type="connect" />
              해제
            </button>
          ) : (
            <button
              className="btn drive-action-btn"
              onClick={handleConnect}
              disabled={busy === 'connect'}
            >
              <DriveActionIcon type="connect" />
              {busy === 'connect' ? '연결 중' : '연결'}
            </button>
          )}
          <button
            className="btn btn-primary drive-action-btn"
            onClick={handleSave}
            disabled={!connected || Boolean(busy)}
          >
            <DriveActionIcon type="save" />
            {busy === 'save' ? '저장 중' : '저장'}
          </button>
          <button
            className="btn drive-action-btn"
            onClick={handleLoad}
            disabled={!connected || Boolean(busy)}
          >
            <DriveActionIcon type="load" />
            {busy === 'load' ? '불러오는 중' : '불러오기'}
          </button>
        </div>
      </section>

      {message ? <span className="drive-backup-msg">{message}</span> : null}
    </div>
  )
}
