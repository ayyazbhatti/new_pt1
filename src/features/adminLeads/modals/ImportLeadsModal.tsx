import { useState, useCallback } from 'react'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { createLead } from '../api/leads.api'
import type { LeadSource } from '../types/leads'
import { LEAD_SOURCE_LABELS } from '../types/leads'

const VALID_SOURCES = Object.keys(LEAD_SOURCE_LABELS) as LeadSource[]

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''))
    const row: Record<string, string> = {}
    header.forEach((h, j) => {
      row[h] = values[j] ?? ''
    })
    rows.push(row)
  }
  return rows
}

function normalizeSource(value: string): LeadSource {
  const v = value.trim().toLowerCase().replace(/\s+/g, '_')
  if (VALID_SOURCES.includes(v as LeadSource)) return v as LeadSource
  const byLabel = Object.entries(LEAD_SOURCE_LABELS).find(
    ([, label]) => label.toLowerCase() === value.trim().toLowerCase()
  )
  if (byLabel) return byLabel[0] as LeadSource
  return 'other'
}

interface ImportRow {
  name: string
  email: string
  phone?: string
  company?: string
  source: LeadSource
  campaign?: string
  notes?: string
}

function mapRowToPayload(row: Record<string, string>): ImportRow | null {
  const name = (row.name ?? row.full_name ?? '').trim()
  const email = (row.email ?? '').trim()
  if (!email) return null
  const source = normalizeSource(row.source ?? row.lead_source ?? 'other')
  return {
    name: name || email,
    email,
    phone: (row.phone ?? '').trim() || undefined,
    company: (row.company ?? '').trim() || undefined,
    source,
    campaign: (row.campaign ?? '').trim() || undefined,
    notes: (row.notes ?? '').trim() || undefined,
  }
}

interface ImportLeadsModalProps {
  modalKey: string
  onSuccess: (importedCount: number) => void
}

export function ImportLeadsModal({ modalKey, onSuccess }: ImportLeadsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([])
  const [submitting, setSubmitting] = useState(false)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) {
      setParsedRows([])
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const rows = parseCSV(text)
      const mapped = rows.map(mapRowToPayload).filter((r): r is ImportRow => r !== null)
      setParsedRows(mapped)
    }
    reader.readAsText(f)
  }, [])

  const handleImport = useCallback(async () => {
    if (parsedRows.length === 0) {
      toast.error('Select a CSV file with at least one valid row (email required).')
      return
    }
    setSubmitting(true)
    let imported = 0
    let failed = 0
    for (const payload of parsedRows) {
      try {
        await createLead({
          name: payload.name,
          email: payload.email,
          phone: payload.phone,
          company: payload.company,
          source: payload.source,
          campaign: payload.campaign,
          notes: payload.notes,
        })
        imported++
      } catch {
        failed++
      }
    }
    setSubmitting(false)
    closeModal(modalKey)
    if (imported > 0) {
      toast.success(`${imported} lead${imported === 1 ? '' : 's'} imported.${failed ? ` ${failed} failed.` : ''}`)
      onSuccess(imported)
    } else {
      toast.error(failed ? `Import failed for all ${failed} rows.` : 'No valid rows to import.')
    }
  }, [parsedRows, closeModal, modalKey, onSuccess])

  const preview = parsedRows.slice(0, 10)
  const totalCount = parsedRows.length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>CSV file</Label>
        <p className="text-xs text-text-muted mt-1 mb-2">
          Headers: name (or full_name), email, phone, company, source, campaign, notes. Email is required.{' '}
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              const template = 'name,email,phone,company,source,campaign,notes\nJane Doe,jane@example.com,+1234567890,Acme Inc,website,Q1 Campaign,Interested in demo'
              const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'leads-import-template.csv'
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Download template
          </button>
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="block w-full text-sm text-text file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-surface-2 file:text-text"
        />
      </div>
      {preview.length > 0 && (
        <>
          <div>
            <Label>Preview (first {preview.length} row{preview.length === 1 ? '' : 's'})</Label>
            <div className="mt-2 max-h-48 overflow-auto rounded border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 font-medium text-text-muted">Name</th>
                    <th className="px-2 py-1.5 font-medium text-text-muted">Email</th>
                    <th className="px-2 py-1.5 font-medium text-text-muted">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1.5">{row.name || '—'}</td>
                      <td className="px-2 py-1.5">{row.email}</td>
                      <td className="px-2 py-1.5">{LEAD_SOURCE_LABELS[row.source]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalCount > preview.length && (
              <p className="text-xs text-text-muted mt-1">… and {totalCount - preview.length} more (total: {totalCount})</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => closeModal(modalKey)}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={submitting}>
              {submitting ? 'Importing…' : `Import ${totalCount} lead${totalCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
