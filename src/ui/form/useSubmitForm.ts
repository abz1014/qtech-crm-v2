import { useId, useRef, useState, type FormEvent } from 'react'
import { useForm, type DefaultValues, type FieldValues, type Path, type Resolver, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { mapPgError, type MappedError } from '@/lib/pgErrors'
import { useDirtyFlag } from '@/lib/pwa/dirtyForms'

/*
 * Form (INVENTORY: U07; D08 section 04). React Hook Form + Zod, with:
 *
 *  - A submit guard. The first submit takes a lock before anything async happens;
 *    a second press, Enter again or a double click while the request is in flight
 *    is dropped, so one gesture is one request. While locked every control is
 *    read-only (a disabled fieldset) and the submit Button shows its busy state.
 *  - A client-generated request id, passed to `onSubmit` as `requestId`. Use it
 *    as the new row's UUID (or the RPC's id argument): a retry after a dropped
 *    network reuses the same id, so a request that did arrive is not repeated. A
 *    new id is made only when the values changed or the last attempt succeeded.
 *    A 23505 on that primary key is treated as "already saved", i.e. success.
 *  - Postgres errors in plain words (src/lib/pgErrors.ts). On any failure the
 *    form keeps what was typed, shows a banner naming what happened, and the
 *    primary button can read "Try again".
 *
 *   const sf = useSubmitForm({ schema, defaultValues, entity: 'company',
 *     onSubmit: (v, { requestId }) => insertCompany({ id: requestId, ...v }) })
 *   <Form sf={sf} labels={{ name: 'Company name' }}> <FormField name="name" label="Company name" requirement="required">{f => <TextField {...f} />}</FormField> </Form>
 *   <Button type="submit" form={sf.formId} variant="primary" busy={sf.pending}>Add company</Button>
 */
export interface SubmitContext {
  requestId: string
}

export interface FieldRoute {
  /** Show the message under this field instead of in the banner (a unique violation names the name field). */
  field?: string
  message?: string
}

interface UseSubmitFormOptions<S extends z.ZodTypeAny> {
  schema: S
  defaultValues: DefaultValues<z.input<S>>
  onSubmit: (values: z.output<S>, ctx: SubmitContext) => unknown | Promise<unknown>
  onSuccess?: (values: z.output<S>) => void
  /** What is being saved, for the banner title ("company": "Couldn't save the company"). */
  entity?: string
  /** Route a mapped error to one field (return { field, message }) or leave it in the banner (return undefined). */
  routeError?: (error: MappedError) => FieldRoute | undefined
}

export interface SubmitForm<TIn extends FieldValues = FieldValues, TOut = TIn> {
  form: UseFormReturn<TIn, unknown, TOut>
  /** The onSubmit for the <form>. Guarded. */
  submit: (e?: FormEvent<HTMLFormElement>) => Promise<void>
  pending: boolean
  /** The last attempt failed: the primary button can read "Try again". */
  failed: boolean
  formError: MappedError | null
  entity?: string
  /** id for the <form>, so footer buttons outside it can submit with the `form` attribute. */
  formId: string
}

export function useSubmitForm<S extends z.ZodTypeAny>({
  schema,
  defaultValues,
  onSubmit,
  onSuccess,
  entity,
  routeError,
}: UseSubmitFormOptions<S>): SubmitForm<z.input<S> & FieldValues, z.output<S>> {
  type TIn = z.input<S> & FieldValues
  const form = useForm<TIn, unknown, z.output<S>>({
    resolver: zodResolver(schema) as unknown as Resolver<TIn, unknown, z.output<S>>,
    defaultValues: defaultValues as DefaultValues<TIn>,
  })
  useDirtyFlag(form.formState.isDirty)
  const formId = useId()
  const lock = useRef(false)
  const attempt = useRef<{ id: string; signature: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [formError, setFormError] = useState<MappedError | null>(null)

  const run = form.handleSubmit(async values => {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setFormError(null)
    const signature = JSON.stringify(values)
    if (attempt.current?.signature !== signature) attempt.current = { id: crypto.randomUUID(), signature }
    try {
      await onSubmit(values, { requestId: attempt.current.id })
      attempt.current = null
      setFailed(false)
      onSuccess?.(values)
    } catch (err) {
      const mapped = mapPgError(err, { entity })
      if (mapped.kind === 'already-saved') {
        attempt.current = null
        setFailed(false)
        onSuccess?.(values)
      } else {
        const routed = routeError?.(mapped)
        if (routed?.field) {
          form.setError(routed.field as Path<TIn>, { type: 'server', message: routed.message ?? mapped.message }, { shouldFocus: true })
        } else {
          setFormError(mapped)
        }
        setFailed(true)
      }
    } finally {
      lock.current = false
      setPending(false)
    }
  })

  const submit = async (e?: FormEvent<HTMLFormElement>) => {
    if (lock.current) {
      e?.preventDefault() // same-frame second press: dropped before validation even starts
      return
    }
    await run(e)
  }

  return { form, submit, pending, failed, formError, entity, formId }
}
