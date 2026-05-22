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
        <section className="settings-section">
          <div className="settings-section-head">
            <h4>구글 연동</h4>
          </div>
          <p className="drive-hint">
            <code>.env.local</code>에 <code>VITE_GOOGLE_CLIENT_ID</code>를 설정하세요.
          </p>
        </section>
        <section className="settings-section">
          <div className="settings-section-head">
            <h4>구글드라이브 저장/불러오기</h4>
          </div>
          <div className="settings-section-actions">
            <button className="btn btn-primary" disabled>
              드라이브 저장
            </button>
            <button className="btn" disabled>
              드라이브 불러오기
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
      <section className="settings-section">
        <div className="settings-section-head">
          <h4>구글 연동</h4>
          {connected ? (
            <span className="drive-backup-acct">{email ? `${email} 연결됨` : '연결됨'}</span>
          ) : null}
        </div>
        {connected ? (
          <div className="settings-section-actions">
            <button className="btn btn-sm" onClick={handleDisconnect} disabled={Boolean(busy)}>
              연결 해제
            </button>
          </div>
        ) : (
          <div className="settings-section-actions">
            <button className="btn" onClick={handleConnect} disabled={busy === 'connect'}>
              {busy === 'connect' ? '연결 중…' : '구글 드라이브 연결'}
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h4>구글드라이브 저장/불러오기</h4>
        </div>
        <div className="settings-section-actions">
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!connected || Boolean(busy)}
          >
            {busy === 'save' ? '저장 중…' : '드라이브 저장'}
          </button>
          <button className="btn" onClick={handleLoad} disabled={!connected || Boolean(busy)}>
            {busy === 'load' ? '불러오는 중…' : '드라이브 불러오기'}
          </button>
        </div>
      </section>

      {message ? <span className="drive-backup-msg">{message}</span> : null}
    </div>
  )
}
