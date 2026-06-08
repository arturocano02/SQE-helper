'use client'

import { useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'

export default function AdminUploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ count: number; topic_slug?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    setResult(null)

    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch('/api/admin/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setUploading(false)
    }
  }

  return (
    <main className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-primary">Upload Content</h1>
            <p className="text-secondary text-sm">Generate draft questions from FLK notes</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm text-secondary hover:text-primary transition">← Dashboard</Link>
            <Link href="/admin/content/questions" className="text-sm text-secondary hover:text-primary transition">Question Bank →</Link>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-surface border border-border rounded-lg p-8">
          <h2 className="font-serif text-xl text-primary mb-2">Upload FLK Notes</h2>
          <p className="text-secondary text-sm mb-6">
            Upload a PDF, Word (.docx), or plain text file. Claude will extract rules and generate draft MCQ questions and flashcards.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-secondary mb-2">Choose file</label>
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-secondary
                  file:mr-4 file:py-2 file:px-4 file:rounded
                  file:border file:border-border file:bg-surface2
                  file:text-primary hover:file:bg-surface file:cursor-pointer"
              />
              {file && <p className="mt-1 text-xs text-muted">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
            </div>

            <Button onClick={handleUpload} loading={uploading} disabled={!file}>
              {uploading ? 'Processing...' : 'Upload & Generate Questions'}
            </Button>
          </div>

          {result && (
            <div className="mt-6 p-4 bg-success/10 border border-success/30 rounded">
              <p className="text-success font-medium">✓ Done</p>
              <p className="text-secondary text-sm mt-1">
                Generated <strong className="text-primary">{result.count}</strong> draft questions.{' '}
                <Link href="/admin/content/questions" className="text-accent hover:underline">
                  Review them →
                </Link>
              </p>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-error/10 border border-error/30 rounded">
              <p className="text-error text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
