import { useState, useEffect } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { UserCircle, Mail, User, Shield, Badge, Pencil } from 'lucide-react'
import { cn } from '@/shared/utils'
import { useProfile, useUpdateProfile } from '../hooks/useProfile'

function InfoRow({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ElementType
}) {
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="rounded-lg bg-surface-2 p-2">
        <Icon className="h-4 w-4 text-text-muted" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {label}
        </p>
        <p className="mt-0.5 font-medium text-text">{value || '—'}</p>
      </div>
    </div>
  )
}

export function UserProfilePage() {
  const { data: profile, isLoading, error, refetch } = useProfile()
  const updateProfileMutation = useUpdateProfile()
  const [editing, setEditing] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  useEffect(() => {
    if (profile) {
      setFirstName(profile.firstName ?? '')
      setLastName(profile.lastName ?? '')
    }
  }, [profile])

  const displayName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
      profile.email
    : '—'

  const handleSave = () => {
    updateProfileMutation.mutate(
      { first_name: firstName, last_name: lastName },
      {
        onSuccess: () => {
          setEditing(false)
        },
      }
    )
  }

  const handleCancel = () => {
    setFirstName(profile?.firstName ?? '')
    setLastName(profile?.lastName ?? '')
    setEditing(false)
  }

  return (
    <ContentShell>
      <PageHeader
        title="Profile"
        description="Your account information"
      />

      {error && (
        <Card className="mb-6 border-danger/30 bg-danger/10 p-4">
          <p className="text-sm text-danger">
            {(error as Error).message}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          Loading profile…
        </div>
      ) : profile ? (
        <Card className="overflow-hidden p-6">
          {/* Header: avatar, name, email, role */}
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent/10">
              <UserCircle className="h-10 w-10 text-accent" />
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h2 className="text-xl font-semibold text-text">
                {displayName}
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                {profile.email ?? '—'}
              </p>
              {profile.role && (
                <span
                  className={cn(
                    'mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium',
                    profile.role === 'admin'
                      ? 'bg-accent/20 text-accent'
                      : 'bg-surface-2 text-text-muted'
                  )}
                >
                  {profile.role}
                </span>
              )}
            </div>
          </div>

          {/* Personal information */}
          <div className="mt-6 border-t border-border pt-6">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold text-text">
                <User className="h-4 w-4 text-accent" />
                Personal information
              </h3>
              {!editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                  className="text-text-muted"
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit
                </Button>
              )}
            </div>
            {editing ? (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-muted">
                    First name
                  </label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                    className="max-w-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-muted">
                    Last name
                  </label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                    className="max-w-xs"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={
                      updateProfileMutation.isPending ||
                      (firstName === (profile?.firstName ?? '') &&
                        lastName === (profile?.lastName ?? ''))
                    }
                  >
                    {updateProfileMutation.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancel}
                    disabled={updateProfileMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 divide-y divide-border">
                <InfoRow
                  label="First name"
                  value={profile?.firstName ?? ''}
                  icon={User}
                />
                <InfoRow
                  label="Last name"
                  value={profile?.lastName ?? ''}
                  icon={User}
                />
                <InfoRow label="Email" value={profile?.email ?? ''} icon={Mail} />
              </div>
            )}
          </div>

          {/* Account (read-only) */}
          <div className="mt-6 border-t border-border pt-6">
            <h3 className="flex items-center gap-2 text-base font-semibold text-text">
              <Shield className="h-4 w-4 text-accent" />
              Account
            </h3>
            <div className="mt-4 divide-y divide-border">
              <InfoRow label="User ID" value={profile?.id ?? ''} icon={Badge} />
              <InfoRow
                label="Status"
                value={profile?.status ?? ''}
                icon={Shield}
              />
              <InfoRow label="Role" value={profile?.role ?? ''} icon={Shield} />
              {profile?.permissionProfileName && (
                <InfoRow
                  label="Permission profile"
                  value={profile.permissionProfileName}
                  icon={Shield}
                />
              )}
              {profile?.tradingAccess && (
                <InfoRow
                  label="Trading access"
                  value={profile.tradingAccess}
                  icon={Shield}
                />
              )}
            </div>
          </div>
        </Card>
      ) : null}
    </ContentShell>
  )
}
