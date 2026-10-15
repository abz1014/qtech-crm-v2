import { z } from 'zod'

/*
 * Change password (self-service): the pure model. The new password needs 12 characters; the current
 * one is only checked for being present (the server decides whether it is right). The calls are in api.ts.
 */
export const NEW_PASSWORD_MIN = 12

export const passwordSchema = z
  .object({
    current: z.string().min(1, 'Enter your current password.'),
    next: z.string().min(NEW_PASSWORD_MIN, `Use at least ${NEW_PASSWORD_MIN} characters.`),
    confirm: z.string().min(1, 'Type the new password again.'),
  })
  .superRefine((v, ctx) => {
    if (v.next && v.confirm && v.next !== v.confirm) {
      ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'The two new passwords do not match.' })
    }
    if (v.next.length >= NEW_PASSWORD_MIN && v.next === v.current) {
      ctx.addIssue({ code: 'custom', path: ['next'], message: 'Choose a password different from your current one.' })
    }
  })
export type PasswordValues = z.infer<typeof passwordSchema>

export const WRONG_CURRENT = 'Current password is incorrect.'
export const WEAK_NEW = 'That password is too easy to guess. Choose a longer or less common one.'
