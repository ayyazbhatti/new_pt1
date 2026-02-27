import { useState, useRef, useEffect } from 'react'
import { ContentShell } from '@/shared/layout'
import { useAuthStore } from '@/shared/store/auth.store'
import {
  requestPasswordResetOTP,
  verifyPasswordResetOTP,
  confirmPasswordReset,
} from '@/shared/api/auth.api'
import { updateProfile } from '@/shared/api/auth.api'
import { useQueryClient } from '@tanstack/react-query'
import { profileQueryKey } from '../hooks/useProfile'
import { Eye, EyeOff } from 'lucide-react'

type PwdStep = 'initial' | 'otp-sent' | 'otp-verified'

const inputClasses =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-white text-xs sm:text-sm focus:border-blue-500 focus:outline-none disabled:text-slate-400'
const labelClasses = 'block text-xs sm:text-sm text-slate-400 mb-1'
const btnPrimaryClasses =
  'px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-white text-xs sm:text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed'
const btnSecondaryClasses =
  'px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-white text-xs sm:text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50'

export function UserProfilePage() {
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

  const canSave =
    name.trim() !== '' &&
    name.trim() !== initialName &&
    !saveLoading

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

  const handleNameChange = () => {
    setProfileMsg('')
    setProfileErr('')
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
        <h1 className="text-xl sm:text-2xl font-bold text-white">Profile Settings</h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          Manage your personal information and security
        </p>
      </header>

      {/* Profile Information */}
      <section className="bg-slate-800 rounded-lg p-4 sm:p-5 md:p-6 border border-slate-700">
        <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">
          Profile Information
        </h2>
        {profileMsg && (
          <p className="text-green-400 text-xs sm:text-sm mb-2 sm:mb-3">{profileMsg}</p>
        )}
        {profileErr && (
          <p className="text-red-400 text-xs sm:text-sm mb-2 sm:mb-3">{profileErr}</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
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
                handleNameChange()
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
      <section className="bg-slate-800 rounded-lg p-4 sm:p-5 md:p-6 border border-slate-700">
        <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Security</h2>
        {pwdMsg && (
          <p className="text-green-400 text-xs sm:text-sm mb-2 sm:mb-3">{pwdMsg}</p>
        )}
        {pwdErr && (
          <p className="text-red-400 text-xs sm:text-sm mb-2 sm:mb-3">{pwdErr}</p>
        )}

        {pwdStep === 'initial' && (
          <>
            <p className="text-xs sm:text-sm text-slate-300 mb-3 sm:mb-4">
              Click the button below to reset your password. An OTP will be sent to your email.
            </p>
            <button
              type="button"
              onClick={handleRequestOTP}
              disabled={pwdLoading}
              className={btnPrimaryClasses}
            >
              {pwdLoading ? 'Sending OTP...' : 'Reset Password'}
            </button>
          </>
        )}

        {pwdStep === 'otp-sent' && (
          <>
            <p className="text-xs text-slate-500 mb-3">
              If you don&apos;t see the email, check spam or ask an admin to configure SMTP (Admin → Settings → Email).
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
            <div className="flex gap-1.5 sm:gap-2 justify-center md:justify-start mb-4">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => setOtpDigit(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  onPaste={i === 0 ? handleOtpPaste : undefined}
                  className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-700 border border-slate-600 rounded-lg text-center text-white text-base sm:text-xl font-bold focus:border-blue-500 focus:outline-none"
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-4">
              <div>
                <label className={labelClasses}>New Password</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className={`${inputClasses} pr-8 sm:pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? (
                      <EyeOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
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
                    className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
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
                  !newPassword.trim() ||
                  !confirmPassword.trim() ||
                  pwdLoading
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
