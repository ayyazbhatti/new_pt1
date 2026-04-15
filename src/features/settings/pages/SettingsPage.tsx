import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { cn } from '@/shared/utils'
import {
  Settings,
  Palette,
  Mail,
  Plug,
  Shield,
  RefreshCw,
  Save,
  Send,
  Loader2,
  Edit,
} from 'lucide-react'
import { DataTable, type ColumnDef } from '@/shared/ui/table'
import { ModalShell } from '@/shared/ui/modal'
import { toast } from '@/shared/components/common'
import { useCanAccess } from '@/shared/utils/permissions'
import {
  getEmailConfig,
  updateEmailConfig,
  sendTestEmail,
} from '../api/emailConfig.api'
import { getEmailTemplates, updateEmailTemplate } from '../api/emailTemplates.api'
import { IntegrationsSettingsTab } from '../components/IntegrationsSettingsTab'

const SETTINGS_TABS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'email-config', label: 'Email Configuration', icon: Mail },
  { id: 'email-templates', label: 'Email Templates', icon: Mail },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'security', label: 'Security', icon: Shield },
] as const

const EMAIL_TEMPLATE_META: { id: string; label: string; description: string }[] = [
  { id: 'welcome', label: 'Welcome email', description: 'Sent when a user completes registration' },
  { id: 'password_reset', label: 'Password reset', description: 'Sent when user requests a password reset' },
  { id: 'email_verification', label: 'Email verification', description: "Sent to verify the user's email address" },
  { id: 'deposit_confirmation', label: 'Deposit confirmation', description: 'Sent when a deposit is received' },
  { id: 'withdrawal_confirmation', label: 'Withdrawal confirmation', description: 'Sent when a withdrawal request is submitted' },
]

type EmailTemplateRow = {
  id: string
  label: string
  description: string
  subject: string
  body: string
}

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as SettingsTabId) || 'general'
  const canEditSettings = useCanAccess('settings:edit')

  const [siteName, setSiteName] = useState('LandBricks')
  const [supportEmail, setSupportEmail] = useState('support@landbricks.com')
  const [defaultCurrency, setDefaultCurrency] = useState('USD')
  const [timezone, setTimezone] = useState('America/New_York')
  const [whatsapp, setWhatsapp] = useState('+1234567890')
  const [phone, setPhone] = useState('+1 (234) 567-8900')
  const [facebook, setFacebook] = useState('https://facebook.com/...')
  const [instagram, setInstagram] = useState('https://instagram.com/...')
  const [twitter, setTwitter] = useState('https://twitter.com/...')

  // Email configuration state (local form; synced from API when loaded)
  const [smtpHost, setSmtpHost] = useState('smtp.example.com')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpEncryption, setSmtpEncryption] = useState<'none' | 'tls' | 'ssl'>('tls')
  const [smtpUsername, setSmtpUsername] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [mailFromEmail, setMailFromEmail] = useState('noreply@example.com')
  const [mailFromName, setMailFromName] = useState('Platform')
  const [testEmailTo, setTestEmailTo] = useState('')

  const defaultEmailTemplates: Record<string, { subject: string; body: string }> = useMemo(
    () => ({
      welcome: {
        subject: 'Welcome to {{site_name}}',
        body: 'Hi {{user_name}},\n\nWelcome! Your account has been created. Log in to get started.\n\nBest,\n{{site_name}} Team',
      },
      password_reset: {
        subject: 'Reset your password',
        body: 'Hi {{user_name}},\n\nUse the link below to reset your password. It expires in 24 hours.\n\n{{reset_link}}\n\nIf you did not request this, ignore this email.\n\n{{site_name}}',
      },
      email_verification: {
        subject: 'Verify your email address',
        body: 'Hi {{user_name}},\n\nPlease verify your email by clicking the link below:\n\n{{verification_link}}\n\n{{site_name}}',
      },
      deposit_confirmation: {
        subject: 'Deposit received – {{site_name}}',
        body: 'Hi {{user_name}},\n\nWe have received your deposit of {{amount}} {{currency}}.\n\nReference: {{reference}}\n\n{{site_name}}',
      },
      withdrawal_confirmation: {
        subject: 'Withdrawal request received – {{site_name}}',
        body: 'Hi {{user_name}},\n\nYour withdrawal request for {{amount}} {{currency}} has been received and is being processed.\n\nReference: {{reference}}\n\n{{site_name}}',
      },
    }),
    []
  )

  const templatesQuery = useQuery({
    queryKey: ['admin', 'settings', 'email-templates'],
    queryFn: getEmailTemplates,
    enabled: tab === 'email-templates',
  })
  const mergedTemplates = useMemo(
    () => ({ ...defaultEmailTemplates, ...(templatesQuery.data ?? {}) }),
    [defaultEmailTemplates, templatesQuery.data]
  )
  const emailTemplateRows = useMemo<EmailTemplateRow[]>(
    () =>
      EMAIL_TEMPLATE_META.map(({ id, label, description }) => ({
        id,
        label,
        description,
        subject: mergedTemplates[id]?.subject ?? '',
        body: mergedTemplates[id]?.body ?? '',
      })),
    [mergedTemplates]
  )

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  useEffect(() => {
    if (editingTemplateId) {
      setEditSubject(mergedTemplates[editingTemplateId]?.subject ?? '')
      setEditBody(mergedTemplates[editingTemplateId]?.body ?? '')
    }
  }, [editingTemplateId, mergedTemplates])

  const queryClient = useQueryClient()
  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, subject, body }: { id: string; subject: string; body: string }) =>
      updateEmailTemplate(id, { subject, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'email-templates'] })
      setEditingTemplateId(null)
      toast.success('Template updated')
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update template')
    },
  })

  const setTab = (id: SettingsTabId) => setSearchParams({ tab: id })

  const emailConfigQuery = useQuery({
    queryKey: ['admin', 'settings', 'email-config'],
    queryFn: getEmailConfig,
    enabled: tab === 'email-config',
  })
  const { data: emailConfig, isLoading: emailConfigLoading } = emailConfigQuery

  useEffect(() => {
    if (tab !== 'email-config' || !emailConfig) return
    setSmtpHost(emailConfig.smtp_host)
    setSmtpPort(String(emailConfig.smtp_port))
    setSmtpEncryption(
      (emailConfig.smtp_encryption as 'none' | 'tls' | 'ssl') || 'tls'
    )
    setSmtpUsername(emailConfig.smtp_username ?? '')
    setSmtpPassword('') // never show stored password; leave blank
    setMailFromEmail(emailConfig.from_email)
    setMailFromName(emailConfig.from_name)
  }, [tab, emailConfig])

  const saveEmailConfigMutation = useMutation({
    mutationFn: (payload: {
      smtp_host: string
      smtp_port: number
      smtp_encryption: string
      smtp_username: string
      smtp_password?: string
      from_email: string
      from_name: string
    }) =>
      updateEmailConfig({
        smtp_host: payload.smtp_host,
        smtp_port: payload.smtp_port,
        smtp_encryption: payload.smtp_encryption,
        smtp_username: payload.smtp_username,
        ...(payload.smtp_password ? { smtp_password: payload.smtp_password } : {}),
        from_email: payload.from_email,
        from_name: payload.from_name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'email-config'] })
      toast.success('Email configuration saved')
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save email configuration')
    },
  })

  const testEmailMutation = useMutation({
    mutationFn: sendTestEmail,
    onSuccess: (_, to) => {
      toast.success(`Test email sent to ${to}`)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to send test email')
    },
  })

  const handleSendTestEmail = async () => {
    const email = testEmailTo.trim()
    if (!email) {
      toast.error('Enter an email address to send the test to')
      return
    }
    testEmailMutation.mutate(email)
  }

  const handleSaveEmailConfig = () => {
    const port = parseInt(smtpPort, 10)
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      toast.error('Please enter a valid port (1–65535)')
      return
    }
    saveEmailConfigMutation.mutate({
      smtp_host: smtpHost,
      smtp_port: port,
      smtp_encryption: smtpEncryption,
      smtp_username: smtpUsername,
      smtp_password: smtpPassword || undefined,
      from_email: mailFromEmail,
      from_name: mailFromName,
    })
  }

  const handleResetEmailConfig = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'email-config'] })
    toast.success('Reset to saved configuration')
  }

  const tabMeta: Record<SettingsTabId, { title: string; description: string }> = {
    general: {
      title: 'General Settings',
      description: 'Configure site identity, contact information, and operational settings',
    },
    'email-config': {
      title: 'Email Configuration',
      description: 'Configure SMTP and sender settings for transactional and notification emails',
    },
    theme: { title: 'Theme', description: 'Appearance and theme' },
    'email-templates': { title: 'Email Templates', description: 'Customize email templates' },
    integrations: { title: 'Integrations', description: 'Third-party integrations' },
    security: { title: 'Security', description: 'Security settings' },
  }
  const currentMeta = tabMeta[tab] ?? tabMeta.general

  return (
    <ContentShell>
      <PageHeader
        title={currentMeta.title}
        description={currentMeta.description}
      />

      <div className="mt-6 flex gap-8">
        {/* Sub-navigation - sticky, no scroll */}
        <nav className="w-56 shrink-0 self-start overflow-visible sticky top-6">
          <ul className="space-y-0.5 rounded-lg border border-border bg-surface-1 p-1 overflow-visible">
            {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors',
                    tab === id
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {tab === 'general' && (
            <div className="space-y-8">
              {/* Site Identity */}
              <Card className="p-6">
                <h3 className="text-base font-semibold text-text">Site Identity</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Basic information about your platform
                </p>
                <div className="mt-6 grid gap-5 sm:grid-cols-1">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Site Name
                    </label>
                    <Input
                      value={siteName}
                      onChange={(e) => setSiteName(e.target.value)}
                      placeholder="Site name"
                    />
                    <p className="mt-1.5 text-xs text-text-muted">
                      The name displayed throughout the platform.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Support Email
                    </label>
                    <Input
                      type="email"
                      value={supportEmail}
                      onChange={(e) => setSupportEmail(e.target.value)}
                      placeholder="support@example.com"
                    />
                    <p className="mt-1.5 text-xs text-text-muted">
                      Email address for user support inquiries.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Default Currency
                    </label>
                    <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD - US Dollar</SelectItem>
                        <SelectItem value="EUR">EUR - Euro</SelectItem>
                        <SelectItem value="GBP">GBP - British Pound</SelectItem>
                        <SelectItem value="JPY">JPY - Japanese Yen</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Timezone
                    </label>
                    <Select value={timezone} onValueChange={setTimezone}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                        <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                        <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                        <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                        <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
                        <SelectItem value="Europe/Paris">Central European Time</SelectItem>
                        <SelectItem value="Asia/Dubai">Dubai (GST)</SelectItem>
                        <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                        <SelectItem value="UTC">UTC</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>

              {/* Contact / Social */}
              <Card className="p-6">
                <h3 className="text-base font-semibold text-text">Contact / Social</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Contact information and social media links
                </p>
                <div className="mt-6 grid gap-5 sm:grid-cols-1">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      WhatsApp
                    </label>
                    <Input
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      placeholder="+1234567890"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Phone
                    </label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 (234) 567-8900"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Facebook
                    </label>
                    <Input
                      value={facebook}
                      onChange={(e) => setFacebook(e.target.value)}
                      placeholder="https://facebook.com/..."
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Instagram
                    </label>
                    <Input
                      value={instagram}
                      onChange={(e) => setInstagram(e.target.value)}
                      placeholder="https://instagram.com/..."
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Twitter
                    </label>
                    <Input
                      value={twitter}
                      onChange={(e) => setTwitter(e.target.value)}
                      placeholder="https://twitter.com/..."
                    />
                  </div>
                </div>
              </Card>

              {/* Maintenance (placeholder) */}
              <Card className="p-6">
                <h3 className="text-base font-semibold text-text">Operations</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Maintenance mode and announcement settings
                </p>
                <p className="mt-4 text-sm text-text-muted">
                  Configure maintenance mode and global announcements here. (Coming soon)
                </p>
              </Card>

              {/* Actions */}
              {canEditSettings && (
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSiteName('LandBricks')
                      setSupportEmail('support@landbricks.com')
                      setDefaultCurrency('USD')
                      setTimezone('America/New_York')
                      setWhatsapp('+1234567890')
                      setPhone('+1 (234) 567-8900')
                      setFacebook('https://facebook.com/...')
                      setInstagram('https://instagram.com/...')
                      setTwitter('https://twitter.com/...')
                    }}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reset
                  </Button>
                  <Button type="button">
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </Button>
                </div>
              )}
            </div>
          )}

          {tab === 'email-config' && (
            <div className="space-y-8">
              {emailConfigLoading && (
                <div className="flex items-center gap-2 text-sm text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading email configuration…
                </div>
              )}
              {/* SMTP Server */}
              <Card className="p-6">
                <h3 className="text-base font-semibold text-text">SMTP Server</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Outgoing mail server connection settings
                </p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      SMTP Host
                    </label>
                    <Input
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder="smtp.example.com"
                      disabled={!canEditSettings}
                    />
                    <p className="mt-1.5 text-xs text-text-muted">
                      Hostname or IP of your SMTP server.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Port
                    </label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                      placeholder="587"
                      disabled={!canEditSettings}
                    />
                    <p className="mt-1.5 text-xs text-text-muted">
                      Usually 587 (TLS), 465 (SSL), or 25 (none).
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Encryption
                    </label>
                    <Select
                      value={smtpEncryption}
                      onValueChange={(v: 'none' | 'tls' | 'ssl') => setSmtpEncryption(v)}
                      disabled={!canEditSettings}
                    >
                      <SelectTrigger className="w-full sm:max-w-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="tls">TLS (STARTTLS)</SelectItem>
                        <SelectItem value="ssl">SSL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>

              {/* SMTP Credentials */}
              <Card className="p-6">
                <h3 className="text-base font-semibold text-text">SMTP Credentials</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Authentication for the SMTP server (leave blank to keep current password)
                </p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Username
                    </label>
                    <Input
                      type="text"
                      value={smtpUsername}
                      onChange={(e) => setSmtpUsername(e.target.value)}
                      placeholder="user@example.com"
                      autoComplete="off"
                      disabled={!canEditSettings}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Password
                    </label>
                    <Input
                      type="password"
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      disabled={!canEditSettings}
                    />
                    <p className="mt-1.5 text-xs text-text-muted">
                      Stored securely. Leave empty to keep existing password.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Sender / From */}
              <Card className="p-6">
                <h3 className="text-base font-semibold text-text">Sender (From)</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Default sender used for system and notification emails
                </p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      From Email
                    </label>
                    <Input
                      type="email"
                      value={mailFromEmail}
                      onChange={(e) => setMailFromEmail(e.target.value)}
                      placeholder="noreply@example.com"
                      disabled={!canEditSettings}
                    />
                    <p className="mt-1.5 text-xs text-text-muted">
                      Must be allowed by your SMTP provider.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      From Name
                    </label>
                    <Input
                      value={mailFromName}
                      onChange={(e) => setMailFromName(e.target.value)}
                      placeholder="Platform"
                      disabled={!canEditSettings}
                    />
                    <p className="mt-1.5 text-xs text-text-muted">
                      Display name recipients see in their inbox.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Test Email Configuration */}
              <Card className="p-6">
                <h3 className="text-base font-semibold text-text">Test Email Configuration</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Send a test email to verify your SMTP settings are working correctly
                </p>
                <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1.5 block text-sm font-medium text-text">
                      Send test email to
                    </label>
                    <Input
                      type="email"
                      value={testEmailTo}
                      onChange={(e) => setTestEmailTo(e.target.value)}
                      placeholder="admin@example.com"
                      disabled={testEmailMutation.isPending || !canEditSettings}
                    />
                    <p className="mt-1.5 text-xs text-text-muted">
                      A test message will be sent to this address using the current configuration.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendTestEmail}
                    disabled={testEmailMutation.isPending || !canEditSettings}
                    className="shrink-0 sm:self-end"
                  >
                    {testEmailMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        Send Test Email
                      </>
                    )}
                  </Button>
                </div>
              </Card>

              {canEditSettings && (
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleResetEmailConfig}
                    disabled={emailConfigLoading || saveEmailConfigMutation.isPending}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reset
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSaveEmailConfig}
                    disabled={emailConfigLoading || saveEmailConfigMutation.isPending}
                  >
                    {saveEmailConfigMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {tab === 'integrations' && (
            <IntegrationsSettingsTab canEdit={canEditSettings} />
          )}

          {tab === 'email-templates' && (
            <div className="space-y-8">
              {templatesQuery.isLoading && (
                <div className="flex items-center gap-2 text-sm text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading email templates…
                </div>
              )}
              <DataTable<EmailTemplateRow>
                data={emailTemplateRows}
                columns={[
                  {
                    accessorKey: 'label',
                    header: 'Template',
                    cell: ({ row }) => (
                      <span className="font-medium text-text">{row.original.label}</span>
                    ),
                  },
                  {
                    accessorKey: 'description',
                    header: 'Description',
                    cell: ({ row }) => (
                      <span className="text-text-muted text-sm">{row.original.description}</span>
                    ),
                  },
                  {
                    accessorKey: 'subject',
                    header: 'Subject',
                    cell: ({ row }) => (
                      <span
                        className="max-w-[220px] truncate block text-sm"
                        title={row.original.subject || undefined}
                      >
                        {row.original.subject || '—'}
                      </span>
                    ),
                  },
                  {
                    accessorKey: 'body',
                    header: 'Body',
                    cell: ({ row }) => (
                      <span
                        className="max-w-[280px] truncate block text-sm text-text-muted"
                        title={row.original.body || undefined}
                      >
                        {row.original.body || '—'}
                      </span>
                    ),
                  },
                  ...(canEditSettings
                    ? [
                        {
                          id: 'actions',
                          header: '',
                          cell: ({ row }: { row: { original: { id: string } } }) => (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingTemplateId(row.original.id)}
                              className="h-8 gap-1.5"
                            >
                              <Edit className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          ),
                        },
                      ]
                    : []),
                ]}
                bordered
                dense
              />

              <Card className="p-6">
                <h3 className="text-base font-semibold text-text">Email Templates</h3>
                <p className="mt-1 text-sm text-text-muted">
                  Customize the subject and body of transactional emails. Use placeholders like{' '}
                  <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">{'{{user_name}}'}</code>,{' '}
                  <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">{'{{site_name}}'}</code>,{' '}
                  <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">{'{{reset_link}}'}</code>. Click Edit to change a template.
                </p>
              </Card>

              {editingTemplateId && (
                <ModalShell
                  open={!!editingTemplateId}
                  onOpenChange={(open) => !open && setEditingTemplateId(null)}
                  title={EMAIL_TEMPLATE_META.find((t) => t.id === editingTemplateId)?.label ?? 'Edit template'}
                  size="md"
                >
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-text">Subject</label>
                      <Input
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        placeholder="Email subject"
                        disabled={updateTemplateMutation.isPending}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-text">Body (plain text)</label>
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        placeholder="Email body..."
                        rows={10}
                        disabled={updateTemplateMutation.isPending}
                        className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent disabled:opacity-70"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEditingTemplateId(null)}
                        disabled={updateTemplateMutation.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        disabled={updateTemplateMutation.isPending}
                        onClick={() =>
                          updateTemplateMutation.mutate({
                            id: editingTemplateId,
                            subject: editSubject,
                            body: editBody,
                          })
                        }
                      >
                        {updateTemplateMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving…
                          </>
                        ) : (
                          'Save'
                        )}
                      </Button>
                    </div>
                  </div>
                </ModalShell>
              )}
            </div>
          )}

          {tab !== 'general' &&
            tab !== 'email-config' &&
            tab !== 'email-templates' &&
            tab !== 'integrations' && (
            <Card className="p-8">
              <p className="text-sm text-text-muted">
                {SETTINGS_TABS.find((t) => t.id === tab)?.label} settings — coming soon.
              </p>
            </Card>
          )}
        </div>
      </div>
    </ContentShell>
  )
}
