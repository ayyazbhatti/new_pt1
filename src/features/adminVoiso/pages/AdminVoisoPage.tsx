import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui'
import { Card } from '@/shared/ui/card'
import { click2call, getVoisoPanelConfig } from '../api/voiso.api'
import { getApiErrorMessage } from '@/shared/api/http'
import { toast } from '@/shared/components/common'
import { Phone, Loader2, ExternalLink, AlertTriangle } from 'lucide-react'

const DEFAULT_VOISO_PANEL_URL = 'https://cc-ams03.voiso.com/omnichannel/embedded'
const FALLBACK_VOISO_PANEL_URL = (import.meta.env.VITE_VOISO_PANEL_URL as string | undefined)?.trim() || DEFAULT_VOISO_PANEL_URL

export function AdminVoisoPage() {
  const [agent, setAgent] = useState('')
  const [number, setNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const panelConfigQuery = useQuery({
    queryKey: ['admin', 'voiso', 'panel-config'],
    queryFn: getVoisoPanelConfig,
  })
  const voisoPanelUrl = panelConfigQuery.data?.panelUrl?.trim() || FALLBACK_VOISO_PANEL_URL
  const voisoStandaloneUrl = voisoPanelUrl.replace(/\/omnichannel\/embedded\/?$/, '/')
  const voisoEnabled = panelConfigQuery.data?.enabled ?? true

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
        description="Use the embedded Voiso agent panel and initiate outbound calls from one page."
      />

      <div className="space-y-6">
        {/* Click to Call form */}
        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Phone className="h-5 w-5 text-muted-foreground" />
            Click to Call
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Enter the agent extension (e.g. 1007) and the destination number in E.164 without + (e.g.
            393511775043). The agent must be logged in and available in the embedded Voiso panel below for the call to
            connect.
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

        <Card className="overflow-hidden">
          <div className="p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <ExternalLink className="h-5 w-5 text-muted-foreground" />
                  Voiso agent panel
                </h2>
                <p className="text-sm text-muted-foreground">
                  Log in to Voiso here, set your status to available, and keep this page open while handling Click to
                  Call requests.
                </p>
              </div>
              <a
                href={voisoStandaloneUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                Open full panel
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>

          {panelConfigQuery.isError ? (
            <div className="mx-4 mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive sm:mx-6 sm:mb-6">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Could not load Voiso panel settings.</p>
                <p>Check the Voiso configuration in Settings, or use the default embedded panel URL.</p>
              </div>
            </div>
          ) : !voisoPanelUrl ? (
            <div className="mx-4 mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive sm:mx-6 sm:mb-6">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Voiso panel URL is not configured.</p>
                <p>Set VITE_VOISO_PANEL_URL to your Voiso embedded workspace URL and rebuild the frontend.</p>
              </div>
            </div>
          ) : !voisoEnabled ? (
            <div className="mx-4 mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning sm:mx-6 sm:mb-6">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Voiso integration is disabled.</p>
                <p>Enable it in Settings → Voiso before placing Click to Call requests.</p>
              </div>
            </div>
          ) : (
            <div className="border-t border-border bg-background">
              <iframe
                src={voisoPanelUrl}
                allow="microphone; camera; autoplay; clipboard-read; clipboard-write; display-capture"
                className="h-[720px] w-full border-0"
                title="Voiso Agent Panel"
              />
            </div>
          )}
        </Card>
      </div>
    </ContentShell>
  )
}
