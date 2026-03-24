import { useState } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui'
import { Card } from '@/shared/ui/card'
import { click2call } from '../api/voiso.api'
import { getApiErrorMessage } from '@/shared/api/http'
import { toast } from '@/shared/components/common'
import { Phone, Loader2, ExternalLink } from 'lucide-react'

const VOISO_PANEL_URL = 'https://cc-ams03.voiso.com/'

export function AdminVoisoPage() {
  const [agent, setAgent] = useState('')
  const [number, setNumber] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const agentTrim = agent.trim()
    const numberClean = number.replace(/\D/g, '')
    if (!agentTrim || !numberClean) {
      toast.error('Agent extension and destination number are required.')
      return
    }
    setLoading(true)
    try {
      await click2call({ agent: agentTrim, number: numberClean })
      toast.success('Call initiated. The agent’s phone should ring.')
      setNumber('')
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ContentShell>
      <PageHeader
        title="Voiso"
        description="Open the Voiso agent panel in a separate tab and use this page to initiate outbound calls."
      />

      <div className="space-y-6">
        {/* Click to Call form */}
        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Phone className="h-5 w-5 text-muted-foreground" />
            Click to Call
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Enter the agent extension (e.g. 1007) and the destination number in E.164 without + (e.g. 393511775043).
            The agent must be logged in to the Voiso panel (open it via the link below) for the call to connect.
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <div className="space-y-1.5 min-w-0 flex-1 sm:max-w-[12rem]">
              <label htmlFor="voiso-agent" className="text-sm font-medium text-muted-foreground">
                Agent extension
              </label>
              <Input
                id="voiso-agent"
                type="text"
                placeholder="e.g. 1007"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5 min-w-0 flex-1 sm:max-w-[14rem]">
              <label htmlFor="voiso-number" className="text-sm font-medium text-muted-foreground">
                Destination number (E.164, no +)
              </label>
              <Input
                id="voiso-number"
                type="tel"
                placeholder="393511775043"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" disabled={loading} className="gap-2 shrink-0">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Calling…
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4" />
                  Call
                </>
              )}
            </Button>
          </form>
        </Card>

        {/* Voiso panel link — Voiso blocks embedding (X-Frame-Options), so we only offer open in new tab */}
        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-muted-foreground" />
            Voiso agent panel
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Voiso does not allow their login page to be embedded. Open the panel in a new tab, log in there, and keep that tab open so the agent stays active for Click to Call.
          </p>
          <a
            href={VOISO_PANEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open Voiso panel in new tab
            <ExternalLink className="h-4 w-4" />
          </a>
        </Card>
      </div>
    </ContentShell>
  )
}
