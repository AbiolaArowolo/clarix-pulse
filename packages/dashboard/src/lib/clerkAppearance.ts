// Shared Clerk widget theming so <SignIn/> and <SignUp/> blend into Clarix
// Pulse's existing dark-panel visual language instead of showing Clerk's
// default light card chrome. Colors mirror the classes the old hand-rolled
// login/register forms used (see index.css's [data-theme="light"] overrides,
// which already remap these exact Tailwind utility classes for light mode).
export const clerkAppearance = {
  variables: {
    colorPrimary: '#22d3ee',
    colorBackground: 'transparent',
    colorInputBackground: 'rgba(2, 6, 23, 0.9)',
    colorInputText: '#f1f5f9',
    colorText: '#f1f5f9',
    colorTextSecondary: '#cbd5e1',
    colorTextOnPrimaryBackground: '#083344',
    colorDanger: '#f87171',
    colorSuccess: '#34d399',
    colorNeutral: '#94a3b8',
    borderRadius: '1rem',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    spacingUnit: '1rem',
  },
  elements: {
    rootBox: 'w-full',
    cardBox: 'w-full shadow-none bg-transparent',
    card: 'w-full bg-transparent shadow-none p-0 gap-4',
    header: 'hidden',
    footer: 'bg-transparent shadow-none pt-4',
    footerAction: 'text-slate-400',
    footerActionLink: 'text-cyan-300 hover:text-cyan-200',
    dividerRow: 'my-4',
    dividerLine: 'bg-slate-800',
    dividerText: 'text-slate-500 text-xs uppercase tracking-[0.14em]',
    formFieldLabel: 'text-sm text-slate-300',
    formFieldInput:
      'w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400',
    formFieldAction: 'text-cyan-300 hover:text-cyan-200 text-xs font-medium',
    formFieldHintText: 'text-xs text-slate-500',
    formFieldErrorText: 'text-xs text-red-300',
    formButtonPrimary:
      'w-full rounded-2xl border border-cyan-400/35 bg-cyan-400/12 px-4 py-3 text-sm font-semibold text-cyan-50 normal-case shadow-none transition-colors hover:border-cyan-300 hover:bg-cyan-400/12',
    socialButtonsBlockButton:
      'rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white',
    socialButtonsBlockButtonText: 'text-sm font-medium',
    identityPreview: 'rounded-2xl border border-slate-700 bg-slate-950/90',
    identityPreviewText: 'text-sm text-slate-200',
    identityPreviewEditButton: 'text-cyan-300',
    formResendCodeLink: 'text-cyan-300 hover:text-cyan-200',
    otpCodeFieldInput: 'border-slate-700 bg-slate-950/90 text-slate-100',
    alertText: 'text-red-100 text-sm',
    alert: 'rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3',
    formHeaderTitle: 'text-white text-lg font-semibold',
    formHeaderSubtitle: 'text-slate-400 text-sm',
    badge: 'bg-slate-800 text-slate-300',
    // Clerk's default "Secured by Clerk" branding footer is hidden to keep
    // the panel consistent with the rest of the app's chrome.
    footerPages: 'hidden',
  },
} as const;
