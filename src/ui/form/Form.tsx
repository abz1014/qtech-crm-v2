/*
 * Form, FormField, FormSummary: the pieces that render a form built with useSubmitForm
 * (src/ui/form/useSubmitForm.ts holds the guard, the request id and the error mapping).
 */
import type { ReactElement, ReactNode } from 'react'
import {
  FormProvider,
  useController,
  useFormContext,
  type ControllerRenderProps,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form'
import type { MappedError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Field, type FieldSource } from '@/ui/form/Field'
import type { SubmitForm } from '@/ui/form/useSubmitForm'

interface FormProps<TIn extends FieldValues, TOut> {
  sf: SubmitForm<TIn, TOut>
  /** Field name to its label, for the "Fix 2 fields" summary. */
  labels?: Partial<Record<string, string>>
  children: ReactNode
  className?: string
}

export function Form<TIn extends FieldValues, TOut>({ sf, labels = {}, children, className }: FormProps<TIn, TOut>) {
  const { form } = sf
  return (
    <FormProvider {...(form as unknown as UseFormReturn<TIn>)}>
      <form id={sf.formId} noValidate onSubmit={sf.submit} className={className} aria-busy={sf.pending || undefined}>
        <fieldset disabled={sf.pending} className="m-0 grid min-w-0 gap-4 border-0 p-0">
          <FormSummary labels={labels} />
          {sf.formError ? <FormErrorBanner error={sf.formError} entity={sf.entity} /> : null}
          {children}
        </fieldset>
      </form>
    </FormProvider>
  )
}

/** "Fix 2 fields to continue", with each field a control that moves focus to it. Shown after a submit that failed validation. */
export function FormSummary({ labels }: { labels: Partial<Record<string, string>> }) {
  const {
    formState: { errors, isSubmitted },
    setFocus,
  } = useFormContext()
  const names = Object.keys(errors).filter(n => errors[n]?.type !== 'server')
  if (!isSubmitted || names.length === 0) return null
  return (
    <Banner tone="danger" title={`Fix ${names.length} ${names.length === 1 ? 'field' : 'fields'} to continue`}>
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 ? (i === names.length - 1 ? ' and ' : ', ') : ''}
          <button type="button" onClick={() => setFocus(n)} className="rounded text-primary underline decoration-1 underline-offset-2">
            {labels[n] ?? n}
          </button>
        </span>
      ))}
      {names.length === 1 ? ' needs a value.' : ' need a value.'}
    </Banner>
  )
}

export function FormErrorBanner({ error, entity }: { error: MappedError; entity?: string }) {
  return (
    <Banner tone="danger" title={entity ? `Couldn't save the ${entity}` : "Couldn't save"}>
      {error.message}
    </Banner>
  )
}

interface FormFieldProps<TV extends FieldValues, N extends Path<TV>> {
  name: N
  label: ReactNode
  requirement?: 'required' | 'optional'
  help?: ReactNode
  /** FE-2: where a pre-filled value came from ("Today", "from PO-26-0009"). */
  source?: FieldSource
  className?: string
  /** Dress a message that needs a link ("Open it" on a unique violation). Receives the plain message. */
  renderError?: (message: string) => ReactNode
  children: (field: ControllerRenderProps<TV, N>) => ReactElement
}

/** Field + RHF controller: label, control, this field's error and the pre-fill note in one place. */
export function FormField<TV extends FieldValues, N extends Path<TV> = Path<TV>>({
  name,
  label,
  requirement,
  help,
  source,
  className,
  renderError,
  children,
}: FormFieldProps<TV, N>) {
  const { control } = useFormContext<TV>()
  const { field, fieldState } = useController({ control, name })
  return (
    <Field
      label={label}
      requirement={requirement}
      help={help}
      source={source}
      edited={fieldState.isDirty}
      error={fieldState.error?.message && renderError ? renderError(fieldState.error.message) : fieldState.error?.message}
      className={className}
    >
      {children(field)}
    </Field>
  )
}
