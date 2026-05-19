import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/shared/components/common'
import {
  confirmPasswordReset,
  requestPasswordResetOTP,
  verifyPasswordResetOTP,
} from '@/shared/api/auth.api'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { PasswordField } from '@/shared/components/auth/PasswordField'
import { AuthCard } from '@/shared/components/auth/AuthCard'
import { AuthHeader } from '@/shared/components/auth/AuthHeader'
import { AuthFooterLinks } from '@/shared/components/auth/AuthFooterLinks'
import { AuthFooter } from '@/shared/components/auth/AuthFooter'
import { Label } from '@/shared/components/auth/Label'

type Step = 'email' | 'otp-sent' | 'otp-verified'

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', ''])
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  const setOtpDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otp]
    next[index] = digit
    setOtp(next)
    if (digit && index < 5) {
      setTimeout(() => otpRefs.current[index + 1]?.focus(), 0)
    }
  }

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      setOtp(pasted.split(''))
      otpRefs.current[5]?.focus()
    }
  }

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Email is required')
      return
    }
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const res = await requestPasswordResetOTP(trimmed)
      if (res.success !== false && !res.error) {
        setMessage('If an account exists for this email, a 6-digit code has been sent.')
        setStep('otp-sent')
        setOtp(['', '', '', '', '', ''])
        setTimeout(() => otpRefs.current[0]?.focus(), 100)
      } else {
        setError(res.error ?? res.message ?? 'Failed to send code')
      }
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOTP = async () => {
    const code = otp.join('')
    if (code.length !== 6) return
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const res = await verifyPasswordResetOTP(email.trim(), code)
      if (res.success && res.reset_token) {
        setResetToken(res.reset_token)
        setMessage('Code verified. Choose a new password.')
        setStep('otp-verified')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setError(res.error ?? res.message ?? 'Invalid code')
      }
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handleResendOTP = async () => {
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const res = await requestPasswordResetOTP(email.trim())
      if (res.success !== false && !res.error) {
        setMessage('Code resent.')
        setOtp(['', '', '', '', '', ''])
        setTimeout(() => otpRefs.current[0]?.focus(), 100)
      } else {
        setError(res.error ?? res.message ?? 'Failed to resend code')
      }
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to resend code')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const res = await confirmPasswordReset(resetToken, newPassword)
      if (res.success !== false && !res.error) {
        toast.success('Password updated. You can sign in now.')
        navigate('/login')
      } else {
        setError(res.error ?? res.message ?? 'Failed to update password')
      }
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen h-screen overflow-hidden bg-[#0f1218] flex items-center justify-center p-6">
      <AuthCard>
        <AuthHeader
          title="Reset password"
          subtitle={
            step === 'email'
              ? 'Enter your email to receive a verification code'
              : step === 'otp-sent'
                ? 'Enter the 6-digit code from your email'
                : 'Choose a new password'
          }
        />

        {message && <p className="text-sm text-[#22c55e] mb-3">{message}</p>}
        {error && <p className="text-sm text-[#ef4444] mb-3">{error}</p>}

        {step === 'email' && (
          <form onSubmit={handleRequestOTP} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Send verification code'}
            </Button>
          </form>
        )}

        {step === 'otp-sent' && (
          <div className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} disabled readOnly />
            </div>
            <div>
              <Label>6-digit code</Label>
              <div className="flex gap-2 justify-center mt-2">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => setOtpDigit(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    onPaste={i === 0 ? handleOtpPaste : undefined}
                    className="w-11 h-11 bg-[#1a1f2e] border border-[#2a3142] rounded-lg text-center text-white text-lg font-semibold focus:border-[#4f8cff] focus:outline-none"
                  />
                ))}
              </div>
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={otp.join('').length !== 6 || loading}
              onClick={handleVerifyOTP}
            >
              {loading ? 'Verifying...' : 'Verify code'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loading}
              onClick={handleResendOTP}
            >
              Resend code
            </Button>
          </div>
        )}

        {step === 'otp-verified' && (
          <form onSubmit={handleConfirm} className="space-y-4">
            <div>
              <Label htmlFor="newPassword">New password</Label>
              <PasswordField
                id="newPassword"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <PasswordField
                id="confirmPassword"
                autoComplete="new-password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Updating...' : 'Update password'}
            </Button>
          </form>
        )}

        <AuthFooterLinks
          primaryText="Remember your password?"
          primaryLink="/login"
          primaryLinkText="Back to sign in"
        />

        <AuthFooter />
      </AuthCard>
    </div>
  )
}
