import { todayStr } from './format'
import { exportDocument, importDocument } from './store'

export const BACKUP_MIME = 'application/json'
export const BACKUP_ACCEPT = '.json,application/json'

export function isBackupDocument(value) {
  return Boolean(value && typeof value === 'object' && value.stages && typeof value.stages === 'object')
}

export function createBackupText() {
  return JSON.stringify(exportDocument(), null, 2)
}

export function backupFileName(date = todayStr()) {
  return `가계부_${date}.json`
}

export function parseBackupText(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text || ''))
  } catch {
    throw new Error('JSON 파일을 읽지 못했습니다. 형식을 확인해 주세요.')
  }

  if (!isBackupDocument(parsed)) {
    throw new Error('가계부 백업 JSON이 아닙니다.')
  }

  return parsed
}

export function countBackupItems(document) {
  const stages = document?.stages || {}
  return (
    (stages.income?.entries?.length || 0) +
    (stages.income?.fixed?.templates?.length || 0) +
    (stages.expense?.entries?.length || 0) +
    (stages.expense?.fixed?.templates?.length || 0) +
    (stages.investment?.products?.length || 0) +
    (stages.mockInvest?.portfolio?.trades?.length || 0)
  )
}

export function importBackupDocument(document) {
  return importDocument(document)
}
