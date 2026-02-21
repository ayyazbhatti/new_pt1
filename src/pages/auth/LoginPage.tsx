import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { useAuthStore } from '@/shared/store/auth.store'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { PasswordField } from '@/shared/components/auth/PasswordField'
import { AuthCard } from '@/shared/components/auth/AuthCard'
import { AuthHeader } from '@/shared/components/auth/AuthHeader'
import { AuthFooterLinks } from '@/shared/components/auth/AuthFooterLinks'
import { AuthFooter } from '@/shared/components/auth/AuthFooter'
import { Label } from '@/shared/components/auth/Label'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  rememberMe: z.boolean().optional(),
})

type LoginFormData = z.infer<typeof loginSchema>

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      rememberMe: false,
    },
  })

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true)
    try {
      await login(data.email, data.password)
      toast.success('Welcome back!')
      navigate('/')
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (error instanceof Error ? error.message : null) ||
        'Login failed. Check your email and password, and that your account is active.'
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen h-screen overflow-hidden bg-[#0f1218] flex items-center justify-center p-6">
      <AuthCard>
        <AuthHeader title="Sign in" subtitle="Access your trading terminal" />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              {...register('email')}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-[#ef4444]">{errors.email.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <PasswordField
              id="password"
              placeholder="Enter your password"
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-[#ef4444]">{errors.password.message}</p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <Controller
              name="rememberMe"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                  />
                  <span className="text-sm text-[#aab2c5]">Remember me</span>
                </label>
              )}
            />
            <Link
              to="/forgot-password"
              className="text-sm text-[#4f8cff] hover:text-[#4f8cff]/80 transition-colors"
            >
              Forgot password?
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        <AuthFooterLinks
          primaryText="Don't have an account?"
          primaryLink="/register"
          primaryLinkText="Create account"
        />

        <AuthFooter />
      </AuthCard>
    </div>
  )
}

