import { useState, useRef, useEffect } from 'react'
import { ContentShell } from '@/shared/layout'
import { useAuthStore } from '@/shared/store/auth.store'
import {
  requestPasswordResetOTP,
  verifyPasswordResetOTP,
  confirmPasswordReset,
  updateProfile,
} from '@/shared/api/auth.api'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'

const profileQueryKey = ['profile', 'me'] as const
type PwdStep = 'initial' | 'otp-sent' | 'otp-verified'

const inputClasses =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-white text-xs sm:text-sm focus:border-blue-500 focus:outline-none disabled:text-slate-400'
const labelClasses = 'block text-xs sm:text-sm text-slate-400 mb-1'
const btnPrimaryClasses =
  'px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-white text-xs sm:text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed'
const btnSecondaryClasses =
  'px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-white text-xs sm:text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50'

export function AdminProfilePage() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const queryClient = useQueryClient()

  const userEmail = user?.email ?? ''
  const initialName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || ''

  const [name, setName] = useState(initialName)
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')
  const [saveLoading, setSaveLoading] = useState(false)

  const [pwdStep, setPwdStep] = useState<PwdStep>('initial')
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', ''])
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdMsg, setPwdMsg] = useState('')
  const [pwdErr, setPwdErr] = useState('')

  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    setName(initialName)
  }, [initialName])

  const canSave = name.trim() !== '' && name.trim() !== initialName && !saveLoading

  const handleSaveProfile = async () => {
    setProfileErr('')
    setProfileMsg('')
    setSaveLoading(true)
    try {
      const parts = name.trim().split(/\s+/)
      const first_name = parts[0] ?? ''
      const last_name = parts.slice(1).join(' ') ?? ''
      const data = await updateProfile({ first_name, last_name })
      setUser({
        ...user!,
        firstName: data.firstName,
        lastName: data.lastName,
      })
      queryClient.setQueryData(profileQueryKey, data)
      setProfileMsg('Profile updated successfully')
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? (err as Error)?.message ?? 'Failed to update profile'
      setProfileErr(message)
    } finally {
      setSaveLoading(false)
    }
  }

  const handleRequestOTP = async () => {
    setPwdErr('')
    setPwdMsg('')
    setPwdLoading(true)
    try {
      const res = await requestPasswordResetOTP(userEmail)
      if (res.success !== false && !res.error) {
        setPwdMsg('OTP sent to your email.')
        setPwdStep('otp-sent')
        setOtp(['', '', '', '', '', ''])
        setTimeout(() => otpRefs.current[0]?.focus(), 100)
      } else {
        setPwdErr(res.error ?? res.message ?? 'Failed to send OTP')
      }
    } catch (err: unknown) {
      setPwdErr((err as Error)?.message ?? 'Failed to send OTP')
    } finally {
      setPwdLoading(false)
    }
  }

  const handleVerifyOTP = async () => {
    const code = otp.join('')
    if (code.length !== 6) return
    setPwdErr('')
    setPwdMsg('')
    setPwdLoading(true)
    try {
      const res = await verifyPasswordResetOTP(userEmail, code)
      if (res.success && res.reset_token) {
        setResetToken(res.reset_token)
        setPwdMsg('OTP verified. Enter your new password below.')
        setPwdStep('otp-verified')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setPwdErr(res.error ?? res.message ?? 'Invalid OTP')
      }
    } catch (err: unknown) {
      setPwdErr((err as Error)?.message ?? 'Verification failed')
    } finally {
      setPwdLoading(false)
    }
  }

  const handleResendOTP = async () => {
    setPwdErr('')
    setPwdMsg('')
    setPwdLoading(true)
    try {
      const res = await requestPasswordResetOTP(userEmail)
      if (res.success !== false && !res.error) {
        setPwdMsg('OTP resent.')
        setOtp(['', '', '', '', '', ''])
        setTimeout(() => otpRefs.current[0]?.focus(), 100)
      } else {
        setPwdErr(res.error ?? res.message ?? 'Failed to resend OTP')
      }
    } catch (err: unknown) {
      setPwdErr((err as Error)?.message ?? 'Failed to resend OTP')
    } finally {
      setPwdLoading(false)
    }
  }

  const handleConfirmPasswordReset = async () => {
    if (newPassword.length < 8) {
      setPwdErr('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwdErr('Passwords do not match')
      return
    }
    setPwdErr('')
    setPwdMsg('')
    setPwdLoading(true)
    try {
      const res = await confirmPasswordReset(resetToken, newPassword)
      if (res.success !== false && !res.error) {
        setPwdMsg('Password updated successfully.')
        setTimeout(() => {
          setPwdStep('initial')
          setOtp(['', '', '', '', '', ''])
          setResetToken('')
          setNewPassword('')
          setConfirmPassword('')
          setPwdMsg('')
          setPwdErr('')
        }, 3000)
      } else {
        setPwdErr(res.error ?? res.message ?? 'Failed to update password')
      }
    } catch (err: unknown) {
      setPwdErr((err as Error)?.message ?? 'Failed to update password')
    } finally {
      setPwdLoading(false)
    }
  }

  const handleCancelPasswordFlow = () => {
    setPwdStep('initial')
    setOtp(['', '', '', '', '', ''])
    setResetToken('')
    setNewPassword('')
    setConfirmPassword('')
    setPwdMsg('')
    setPwdErr('')
  }

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
      const arr = pasted.split('')
      setOtp([...arr, '', '', '', '', ''].slice(0, 6))
      otpRefs.current[5]?.focus()
    }
  }

  if (!user) {
    return (
      <ContentShell>
        <div className="space-y-4 sm:space-y-6">
          <p className="text-slate-400">Loading…</p>
        </div>
      </ContentShell>
    )
  }

  return (
    <ContentShell>
      <div className="space-y-4 sm:space-y-6">
        <header>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Admin Profile</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            View your profile and manage security (change password)
          </p>
        </header>

        {/* Profile Information */}
        <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 sm:p-5 md:p-6">
          <h2 className="mb-3 sm:mb-4 text-base sm:text-lg font-semibold text-white">
            Profile Information
          </h2>
          {profileMsg && (
            <p className="mb-2 sm:mb-3 text-xs sm:text-sm text-green-400">{profileMsg}</p>
          )}
          {profileErr && (
            <p className="mb-2 sm:mb-3 text-xs sm:text-sm text-red-400">{profileErr}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
            <div>
              <label className={labelClasses}>Email</label>
              <input
                type="email"
                value={userEmail}
                disabled
                className={inputClasses}
                readOnly
              />
            </div>
            <div>
              <label className={labelClasses}>Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setProfileMsg('')
                  setProfileErr('')
                }}
                placeholder="Your name"
                className={inputClasses}
              />
            </div>
          </div>
          <div className="mt-3 sm:mt-4">
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={!canSave}
              className={btnPrimaryClasses}
            >
              {saveLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </section>

        {/* Security */}
        <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 sm:p-5 md:p-6">
          <h2 className="mb-3 sm:mb-4 text-base sm:text-lg font-semibold text-white">Security</h2>
          {pwdMsg && (
            <p className="mb-2 sm:mb-3 text-xs sm:text-sm text-green-400">{pwdMsg}</p>
          )}
          {pwdErr && (
            <p className="mb-2 sm:mb-3 text-xs sm:text-sm text-red-400">{pwdErr}</p>
          )}

          {pwdStep === 'initial' && (
            <>
              <p className="mb-3 sm:mb-4 text-xs sm:text-sm text-slate-300">
                Change your password. An OTP will be sent to your email.
              </p>
              <button
                type="button"
                onClick={handleRequestOTP}
                disabled={pwdLoading}
                className={btnPrimaryClasses}
              >
                {pwdLoading ? 'Sending OTP...' : 'Change Password'}
              </button>
            </>
          )}

          {pwdStep === 'otp-sent' && (
            <>
              <p className="mb-3 text-xs text-slate-500">
                Check your email for the 6-digit code. If you don&apos;t see it, check spam or
                configure SMTP in Admin → Settings → Email.
              </p>
              <div className="mb-3 sm:mb-4">
                <label className={labelClasses}>Email</label>
                <input
                  type="email"
                  value={userEmail}
                  disabled
                  className={inputClasses}
                  readOnly
                />
              </div>
              <label className={labelClasses}>Enter 6-Digit OTP</label>
              <div className="mb-4 flex justify-center gap-1.5 sm:gap-2 md:justify-start">
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
                    className="h-10 w-10 rounded-lg border border-slate-600 bg-slate-700 text-center text-base font-bold text-white focus:border-blue-500 focus:outline-none sm:h-12 sm:w-12 sm:text-xl"
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={handleVerifyOTP}
                  disabled={otp.join('').length !== 6 || pwdLoading}
                  className={btnPrimaryClasses}
                >
                  Verify OTP
                </button>
                <button
                  type="button"
                  onClick={handleResendOTP}
                  disabled={pwdLoading}
                  className={btnSecondaryClasses}
                >
                  Resend OTP
                </button>
                <button
                  type="button"
                  onClick={handleCancelPasswordFlow}
                  disabled={pwdLoading}
                  className={btnSecondaryClasses}
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {pwdStep === 'otp-verified' && (
            <>
              <div className="mb-4 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClasses}>New Password</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password (min 8 characters)"
                      className={`${inputClasses} pr-8 sm:pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 sm:right-3"
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    >
                      {showNewPassword ? (
                        <EyeOff className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      ) : (
                        <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      )}
                    </button>
                  </div>
                </div>
                <div>
                  <label className={labelClasses}>Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className={`${inputClasses} pr-8 sm:pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 sm:right-3"
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      ) : (
                        <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={handleConfirmPasswordReset}
                  disabled={
                    !newPassword.trim() || !confirmPassword.trim() || pwdLoading
                  }
                  className={btnPrimaryClasses}
                >
                  {pwdLoading ? 'Updating...' : 'Update Password'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelPasswordFlow}
                  disabled={pwdLoading}
                  className={btnSecondaryClasses}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </ContentShell>
  )
}
