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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { PasswordField } from '@/shared/components/auth/PasswordField'
import { AuthCard } from '@/shared/components/auth/AuthCard'
import { AuthHeader } from '@/shared/components/auth/AuthHeader'
import { AuthFooterLinks } from '@/shared/components/auth/AuthFooterLinks'
import { AuthFooter } from '@/shared/components/auth/AuthFooter'
import { Label } from '@/shared/components/auth/Label'

const registerSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Invalid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/\d/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
    country: z.string().optional(),
    referralCode: z.string().optional(),
    agreeToTerms: z.boolean().refine((val) => val === true, {
      message: 'You must agree to the Terms & Risk Disclosure',
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type RegisterFormData = z.infer<typeof registerSchema>

const countries = ['Pakistan', 'UAE', 'UK', 'US', 'Turkey']

export function RegisterPage() {
  const navigate = useNavigate()
  const { register: registerUser } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      agreeToTerms: false,
    },
  })

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true)
    try {
      await registerUser({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
        confirmPassword: data.confirmPassword,
        country: data.country,
        referralCode: data.referralCode,
      })
      toast.success('Account created successfully!')
      navigate('/')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Registration failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen h-screen overflow-hidden bg-[#0f1218] flex items-center justify-center p-6">
      <AuthCard>
        <AuthHeader title="Create account" subtitle="Open your trading account in minutes" />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                placeholder="John"
                {...register('firstName')}
              />
              {errors.firstName && (
                <p className="mt-1 text-sm text-[#ef4444]">{errors.firstName.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                placeholder="Doe"
                {...register('lastName')}
              />
              {errors.lastName && (
                <p className="mt-1 text-sm text-[#ef4444]">{errors.lastName.message}</p>
              )}
            </div>
          </div>

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
              placeholder="At least 8 characters with a number"
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-[#ef4444]">{errors.password.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <PasswordField
              id="confirmPassword"
              placeholder="Confirm your password"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <p className="mt-1 text-sm text-[#ef4444]">{errors.confirmPassword.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="country">Country (Optional)</Label>
            <Controller
              name="country"
              control={control}
              render={({ field }) => (
                <Select value={field.value || ''} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {countries.map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div>
            <Label htmlFor="referralCode">Referral Code (Optional)</Label>
            <Input
              id="referralCode"
              placeholder="Enter referral code"
              {...register('referralCode')}
            />
          </div>

          <div>
            <Controller
              name="agreeToTerms"
              control={control}
              render={({ field }) => (
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-[#aab2c5]">
                    I agree to{' '}
                    <Link
                      to="/terms"
                      className="text-[#4f8cff] hover:text-[#4f8cff]/80 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Terms & Risk Disclosure
                    </Link>
                  </span>
                </label>
              )}
            />
            {errors.agreeToTerms && (
              <p className="mt-1 text-sm text-[#ef4444]">{errors.agreeToTerms.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Creating account...' : 'Create account'}
          </Button>
        </form>

        <AuthFooterLinks
          primaryText="Already have an account?"
          primaryLink="/login"
          primaryLinkText="Sign in"
        />

        <AuthFooter />
      </AuthCard>
    </div>
  )
}

